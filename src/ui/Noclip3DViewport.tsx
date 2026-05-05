import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent } from 'react';
import { Move3D, RotateCcw, Scale3D } from 'lucide-react';
import { mat4, vec3, vec4 } from 'gl-matrix';
import ArrayBufferSlice from '../../vendor/noclip.website/src/ArrayBufferSlice';
import { FPSCameraController } from '../../vendor/noclip.website/src/Camera';
import { DataShare } from '../../vendor/noclip.website/src/DataShare';
import type { DataFetcher } from '../../vendor/noclip.website/src/DataFetcher';
import { getMatrixAxisY } from '../../vendor/noclip.website/src/MathHelpers';
import type { Destroyable, SceneContext } from '../../vendor/noclip.website/src/SceneBase';
import { InitErrorCode, initializeViewerWebGL2, resizeCanvas, type SceneGfx, type Viewer } from '../../vendor/noclip.website/src/viewer';
import { createSceneFromU8Buffer } from '../../vendor/noclip.website/src/rres/scenes';
import { buildU8 } from '../lib/u8';
import type { AppendableKmpSection, KmpEntity, Vec3 } from '../lib/kmp';
import { raycastDown, raycastMesh } from '../lib/kcl';
import type { TrackDocument } from '../lib/track';
import { describeEntity } from '../lib/track';

interface Noclip3DViewportProps {
  track: TrackDocument | null;
  selectedId: string | null;
  tool: TransformTool;
  collisionVisible: boolean;
  getEntityLabel?: (entity: KmpEntity) => string;
  onSelect: (id: string | null) => void;
  onMoveEntity: (entity: KmpEntity, position: Vec3) => void;
  onRotateEntity?: (entity: KmpEntity, rotation: Vec3) => void;
  onScaleEntity?: (entity: KmpEntity, scale: Vec3) => void;
  onMoveCheckpointEndpoint?: (entity: KmpEntity, side: 'left' | 'right', position: Vec3) => void;
  onAddObject?: (objectId: number, position: Vec3) => void;
  onAddKmpPoint?: (section: AppendableKmpSection, position: Vec3) => void;
}

export type TransformTool = 'translate' | 'rotate' | 'scale';

type GizmoAxis = 'x' | 'y' | 'z';

interface SceneOverlayPoint {
  id: string;
  section: string;
  position: Vec3;
  selected: boolean;
}

interface SceneOverlayLine {
  id: string;
  section: string;
  a: Vec3;
  b: Vec3;
}

interface SceneOverlayAxis {
  ownerId: string;
  axis: GizmoAxis;
  a: Vec3;
  b: Vec3;
}

interface SceneOverlayCheckpointEndpoint {
  id: string;
  side: 'left' | 'right';
  position: Vec3;
}

interface SceneOverlayCollisionTriangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  typeIndex: number;
}

interface SceneOverlayData {
  tool: TransformTool;
  points: SceneOverlayPoint[];
  lines: SceneOverlayLine[];
  axes: SceneOverlayAxis[];
  checkpointEndpoints: SceneOverlayCheckpointEndpoint[];
  collisionTriangles: SceneOverlayCollisionTriangle[];
}

type SceneOverlayPick =
  | { kind: 'point'; id: string }
  | { kind: 'axis'; id: string; axis: GizmoAxis }
  | { kind: 'checkpointEndpoint'; id: string; side: 'left' | 'right' };

interface CameraFrame {
  eye: vec3;
  target: vec3;
}

interface DragState {
  kind: 'entity';
  id: string;
  startX: number;
  startY: number;
  rotation?: Vec3;
  scale?: Vec3;
}

interface LinearGizmoDragState {
  kind: 'gizmo';
  mode: 'linear';
  id: string;
  axis: GizmoAxis;
  position: Vec3;
  axisOrigin: Vec3;
  axisDirection: Vec3;
  planePoint: Vec3;
  planeNormal: Vec3;
  startAxisOffset: number;
  rotation?: Vec3;
  scale?: Vec3;
}

interface AngularGizmoDragState {
  kind: 'gizmo';
  mode: 'angular';
  id: string;
  axis: GizmoAxis;
  center: Vec3;
  planeNormal: Vec3;
  angleBasisX: Vec3;
  angleBasisY: Vec3;
  startAngle: number;
  rotation: Vec3;
}

type GizmoDragState = LinearGizmoDragState | AngularGizmoDragState;

interface CheckpointDragState {
  kind: 'checkpointEndpoint';
  id: string;
  side: 'left' | 'right';
}

type ActiveDragState = DragState | GizmoDragState | CheckpointDragState;

interface CameraLookDragState {
  lastClientX: number;
  lastClientY: number;
}

const MKW_RENDER_SCALE = 0.1;
function getInitialCameraFrame(track: TrackDocument): CameraFrame {
  const min = vec3.fromValues(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const max = vec3.fromValues(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

  const expand = (point: { x: number; y: number; z: number }) => {
    min[0] = Math.min(min[0], point.x);
    min[1] = Math.min(min[1], point.y);
    min[2] = Math.min(min[2], point.z);
    max[0] = Math.max(max[0], point.x);
    max[1] = Math.max(max[1], point.y);
    max[2] = Math.max(max[2], point.z);
  };

  for (const triangle of track.kcl?.triangles ?? []) {
    expand(triangle.a);
    expand(triangle.b);
    expand(triangle.c);
  }
  for (const entity of track.kmp?.entities ?? []) expand(entity.position);

  if (!Number.isFinite(min[0]) || !Number.isFinite(max[0])) {
    return {
      eye: vec3.fromValues(0, 900, 2200),
      target: vec3.fromValues(0, 0, 0),
    };
  }

  const center = vec3.fromValues(
    ((min[0] + max[0]) * 0.5) * MKW_RENDER_SCALE,
    ((min[1] + max[1]) * 0.5) * MKW_RENDER_SCALE,
    ((min[2] + max[2]) * 0.5) * MKW_RENDER_SCALE,
  );
  const spanX = (max[0] - min[0]) * MKW_RENDER_SCALE;
  const spanY = (max[1] - min[1]) * MKW_RENDER_SCALE;
  const spanZ = (max[2] - min[2]) * MKW_RENDER_SCALE;
  const radius = Math.max(240, Math.hypot(spanX, spanZ) * 0.65, spanY * 1.1);

  return {
    eye: vec3.fromValues(center[0] + radius * 0.55, center[1] + radius * 0.45, center[2] + radius * 1.35),
    target: center,
  };
}

export function Noclip3DViewport({
  track,
  selectedId,
  tool,
  collisionVisible,
  getEntityLabel = describeEntity,
  onSelect,
  onMoveEntity,
  onRotateEntity,
  onScaleEntity,
  onMoveCheckpointEndpoint,
  onAddObject,
  onAddKmpPoint,
}: Noclip3DViewportProps) {
  const smokeMode = typeof window !== 'undefined' && new URL(window.location.href).searchParams.has('smokeTrack');
  const smokeAddObjectId =
    typeof window !== 'undefined'
      ? (() => {
          const value = new URL(window.location.href).searchParams.get('smokeAddObject');
          const parsed = value ? Number(value) : NaN;
          return Number.isFinite(parsed) ? parsed : null;
        })()
      : null;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uiContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const sceneRef = useRef<SceneGfx | null>(null);
  const destroyablePoolRef = useRef<Destroyable[]>([]);
  const frameRef = useRef<number | null>(null);
  const smokeProbeFrameRef = useRef(0);
  const smokePlacementDoneRef = useRef(false);
  const smokePlacementUsedCollisionRef = useRef(false);
  const smokeViewportSampleRef = useRef<'pending' | 'blank' | 'nonblank'>('pending');
  const trackRef = useRef<TrackDocument | null>(null);
  const collisionVisibleRef = useRef(collisionVisible);
  const selectedIdRef = useRef<string | null>(selectedId);
  const toolRef = useRef<TransformTool>(tool);
  const draggingEntityRef = useRef<ActiveDragState | null>(null);
  const cameraLookDragRef = useRef<CameraLookDragState | null>(null);
  const [status, setStatus] = useState('Drop a Mario Kart Wii .szs track anywhere in the editor');
  const [viewerReady, setViewerReady] = useState(false);
  const [smokeViewportSample, setSmokeViewportSample] = useState<'pending' | 'blank' | 'nonblank'>('pending');
  const [smokeSelectedGobjRendered, setSmokeSelectedGobjRendered] = useState<'pending' | 'yes' | 'no'>('pending');
  const [smokeSelectedGobjSnapped, setSmokeSelectedGobjSnapped] = useState<'pending' | 'yes' | 'no'>('pending');
  const selected = track?.kmp?.entities.find((entity) => entity.id === selectedId) ?? null;
  const sceneKey = track ? getSceneKey(track) : null;
  trackRef.current = track;
  collisionVisibleRef.current = collisionVisible;
  selectedIdRef.current = selectedId;
  toolRef.current = tool;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    async function bootViewer() {
      const result = await initializeViewerWebGL2(canvas);
      if (cancelled) return;
      if (result.error !== InitErrorCode.SUCCESS || !result.viewer) {
        setStatus('WebGL2 is unavailable; noclip renderer cannot start in this browser.');
        return;
      }
      viewerRef.current = result.viewer;
      setViewerReady(true);
      const resizeObserver = new ResizeObserver(() => resizeToDisplay());
      resizeObserver.observe(canvas);
      resizeToDisplay();
      const tick = (time: number) => {
        result.viewer!.update({ time, webXRContext: null });
        if (smokeMode && smokeViewportSampleRef.current !== 'nonblank' && smokeProbeFrameRef.current++ % 12 === 0) {
          const sample = sampleViewportState(canvas);
          if (sample && sample !== smokeViewportSampleRef.current) {
            smokeViewportSampleRef.current = sample;
            setSmokeViewportSample(sample);
          }
        }
        if (smokeMode && selectedIdRef.current?.startsWith('GOBJ-')) {
          const scene = sceneRef.current as (SceneGfx & { hasEditorGobjIndex?: (index: number) => boolean }) | null;
          const match = /^GOBJ-(\d+)$/.exec(selectedIdRef.current);
          const selectedIndex = match ? Number(match[1]) : -1;
          const rendered = selectedIndex >= 0 && scene?.hasEditorGobjIndex ? scene.hasEditorGobjIndex(selectedIndex) : false;
          setSmokeSelectedGobjRendered(rendered ? 'yes' : 'no');
          setSmokeSelectedGobjSnapped(smokePlacementUsedCollisionRef.current ? 'yes' : 'no');
        }
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);

      return () => resizeObserver.disconnect();
    }

    let cleanupResize: (() => void) | undefined;
    void bootViewer().then((cleanup) => {
      cleanupResize = cleanup;
    });

    function resizeToDisplay() {
      const rect = canvas.getBoundingClientRect();
      resizeCanvas(canvas, Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)), window.devicePixelRatio || 1);
    }

    return () => {
      cancelled = true;
      cleanupResize?.();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      const viewer = viewerRef.current;
      if (viewer) {
        sceneRef.current?.destroy(viewer.gfxDevice);
        for (const item of destroyablePoolRef.current) item.destroy(viewer.gfxDevice);
      }
      sceneRef.current = null;
      viewerRef.current = null;
      destroyablePoolRef.current = [];
      setViewerReady(false);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const releaseCameraLook = () => {
      if (!cameraLookDragRef.current) return;
      viewerRef.current?.inputManager.onGrabReleased();
      cameraLookDragRef.current = null;
      if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
    };

    const handleMouseDown = (event: globalThis.MouseEvent) => {
      if (event.button !== 2 || draggingEntityRef.current) return;
      if (event.target !== canvas) return;
      event.preventDefault();
      canvas.focus();
      cameraLookDragRef.current = {
        lastClientX: event.clientX,
        lastClientY: event.clientY,
      };
      if (viewerRef.current) viewerRef.current.inputManager.buttons = event.buttons;
      canvas.requestPointerLock?.();
    };

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const drag = cameraLookDragRef.current;
      const viewer = viewerRef.current;
      if (!drag || !viewer) return;
      if (!(event.buttons & 2) && document.pointerLockElement !== canvas) {
        releaseCameraLook();
        return;
      }
      const dx = document.pointerLockElement === canvas ? event.movementX : event.clientX - drag.lastClientX;
      const dy = document.pointerLockElement === canvas ? event.movementY : event.clientY - drag.lastClientY;
      viewer.inputManager.buttons = event.buttons || 2;
      applyDirectCameraLook(viewer, dx, dy);
      cameraLookDragRef.current = {
        lastClientX: event.clientX,
        lastClientY: event.clientY,
      };
    };

    const handleMouseUp = (event: globalThis.MouseEvent) => {
      if (event.button === 2) releaseCameraLook();
    };

    const handleContextMenu = (event: globalThis.MouseEvent) => {
      if (event.target === canvas) event.preventDefault();
    };

    const handleBlur = () => {
      releaseCameraLook();
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleBlur);
      releaseCameraLook();
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    const uiContainer = uiContainerRef.current;
    if (!viewerReady || !viewer || !uiContainer) return;
    const sceneTrack = trackRef.current;
    if (!sceneTrack) {
      setStatus('Drop a Mario Kart Wii .szs track anywhere in the editor');
      viewer.setScene(null);
      return;
    }

    let cancelled = false;
    async function loadScene() {
      try {
        setStatus('Loading track in noclip Mario Kart Wii renderer...');
        sceneRef.current?.destroy(viewer.gfxDevice);
        for (const item of destroyablePoolRef.current) item.destroy(viewer.gfxDevice);
        destroyablePoolRef.current = [];

        const archiveBytes = buildU8(sceneTrack.archiveEntries);
        const dataShare = new DataShare();
        const dataFetcher = makeLocalDataFetcher();
        const context: SceneContext = {
          device: viewer.gfxDevice,
          dataFetcher,
          dataShare,
          uiContainer,
          destroyablePool: destroyablePoolRef.current,
          inputManager: viewer.inputManager,
          viewerInput: viewer.viewerRenderInput,
          initialSceneTime: 0,
        };
        const scene = await createSceneFromU8Buffer(context, new ArrayBufferSlice(archiveBytes.buffer, archiveBytes.byteOffset, archiveBytes.byteLength));
        if (cancelled) {
          scene.destroy(viewer.gfxDevice);
          return;
        }
        sceneRef.current = scene;
        viewer.setScene(scene);
        syncSceneOverlay(sceneTrack, selectedIdRef.current);
        viewer.setCameraController(new FPSCameraController());
        const initialCamera = getInitialCameraFrame(sceneTrack);
        mat4.targetTo(viewer.camera.worldMatrix, initialCamera.eye, initialCamera.target, vec3.fromValues(0, 1, 0));
        viewer.camera.worldMatrixUpdated();
        setStatus(`${sceneTrack.fileName} rendered with noclip Mario Kart Wii renderer`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    }

    void loadScene();
    return () => {
      cancelled = true;
    };
  }, [sceneKey, viewerReady]);

  useEffect(() => {
    syncRenderedGobjTransforms(track);
  }, [track?.kmp?.entities]);

  useEffect(() => {
    syncSceneOverlay(track, selectedId);
  }, [track?.kmp, track?.kcl, selectedId, collisionVisible, tool]);

  useEffect(() => {
    if (!smokeMode || smokeAddObjectId === null || smokePlacementDoneRef.current || !onAddObject) return;
    if (!track?.kmp || !viewerReady || !sceneRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const placement = placeFromScreenDetailed(rect.left + rect.width * 0.5, rect.top + rect.height * 0.5, 0);
    if (!placement) return;
    smokePlacementDoneRef.current = true;
    smokePlacementUsedCollisionRef.current = placement.source !== 'plane';
    onAddObject(smokeAddObjectId, placement.position);
  }, [onAddObject, smokeAddObjectId, smokeMode, track?.kmp, viewerReady]);

  function placeFromScreen(clientX: number, clientY: number, planeY = 0): Vec3 | null {
    return placeFromScreenDetailed(clientX, clientY, planeY)?.position ?? null;
  }

  function placeFromScreenDetailed(clientX: number, clientY: number, planeY = 0): { position: Vec3; source: 'mesh' | 'down' | 'plane' } | null {
    const viewer = viewerRef.current;
    const canvas = canvasRef.current;
    if (!viewer || !canvas) return null;
    const ray = screenToWorldRay(clientX, clientY, canvas, viewer);
    if (ray && trackRef.current?.kcl) {
      const hit = raycastMesh(
        trackRef.current.kcl,
        { x: ray.origin.x / MKW_RENDER_SCALE, y: ray.origin.y / MKW_RENDER_SCALE, z: ray.origin.z / MKW_RENDER_SCALE },
        ray.direction,
      );
      if (hit) return { position: hit.position, source: 'mesh' };
    }
    const point = screenToWorldOnPlane(clientX, clientY, canvas, viewer, planeY * MKW_RENDER_SCALE);
    if (!point) return null;
    const unscaled = { x: point.x / MKW_RENDER_SCALE, y: point.y / MKW_RENDER_SCALE, z: point.z / MKW_RENDER_SCALE };
    const snapped = trackRef.current?.kcl ? raycastDown(trackRef.current.kcl, unscaled.x, unscaled.z) : null;
    if (snapped) return { position: snapped, source: 'down' };
    return { position: unscaled, source: 'plane' };
  }

  function startEntityDrag(entity: KmpEntity, clientX: number, clientY: number) {
    onSelect(entity.id);
    draggingEntityRef.current = { kind: 'entity', id: entity.id, startX: clientX, startY: clientY, rotation: entity.rotation, scale: entity.scale };
  }

  function updateActiveDrag(clientX: number, clientY: number) {
    const drag = draggingEntityRef.current;
    if (!drag) return;
    if (drag.kind === 'gizmo') {
      handleGizmoPointerMove(clientX, clientY, drag);
      return;
    }
    if (drag.kind === 'checkpointEndpoint') {
      handleCheckpointEndpointPointerMove(clientX, clientY, drag);
      return;
    }
    const entity = trackRef.current?.kmp?.entities.find((candidate) => candidate.id === drag.id);
    if (!entity) return;
    if (tool === 'translate') {
      const next = placeFromScreen(clientX, clientY, entity.position.y);
      if (next) {
        syncRenderedGobjTransform(entity, next, entity.rotation, entity.scale);
        onMoveEntity(entity, next);
      }
      return;
    }
    if (tool === 'rotate' && drag.rotation && entity.rotation) {
      const delta = clientX - drag.startX;
      const rotation = { ...drag.rotation, y: drag.rotation.y + delta };
      syncRenderedGobjTransform(entity, entity.position, rotation, entity.scale);
      onRotateEntity?.(entity, rotation);
      return;
    }
    if (tool === 'scale' && drag.scale && entity.scale) {
      const factor = Math.max(0.05, 1 + (drag.startY - clientY) / 140);
      const scale = { x: drag.scale.x * factor, y: drag.scale.y * factor, z: drag.scale.z * factor };
      syncRenderedGobjTransform(entity, entity.position, entity.rotation, scale);
      onScaleEntity?.(entity, scale);
    }
  }

  function handleCanvasPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || draggingEntityRef.current) return;
    const scene = sceneRef.current as SceneGfx & {
      pickEditorHandle?: (normalizedX: number, normalizedY: number) => SceneOverlayPick | null;
    } | null;
    const scenePick = pickSceneHandle(scene, event.clientX, event.clientY, event.currentTarget);
    if (scenePick?.kind === 'axis') {
      const entity = trackRef.current?.kmp?.entities.find((candidate) => candidate.id === scenePick.id);
      const drag = entity && viewerRef.current ? createGizmoDragState(entity, scenePick.axis, toolRef.current, event.clientX, event.clientY, event.currentTarget, viewerRef.current) : null;
      if (!entity || !drag) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect(entity.id);
      draggingEntityRef.current = drag;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (scenePick?.kind === 'checkpointEndpoint') {
      const entity = trackRef.current?.kmp?.entities.find((candidate) => candidate.id === scenePick.id);
      if (!entity?.checkpoint) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect(entity.id);
      draggingEntityRef.current = { kind: 'checkpointEndpoint', id: entity.id, side: scenePick.side };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const entity = pickEntityFromPick(scenePick) ?? pickEntityFromScreenPosition(event.clientX, event.clientY);
    if (!entity) return;
    event.preventDefault();
    event.stopPropagation();
    startEntityDrag(entity, event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCanvasPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    updateActiveDrag(event.clientX, event.clientY);
  }

  function clearActiveDrag(event?: PointerEvent<HTMLCanvasElement>) {
    draggingEntityRef.current = null;
    if (!event && cameraLookDragRef.current) {
      viewerRef.current?.inputManager.onGrabReleased();
      cameraLookDragRef.current = null;
    }
  }

function handleGizmoPointerMove(clientX: number, clientY: number, drag: GizmoDragState) {
  const entity = trackRef.current?.kmp?.entities.find((candidate) => candidate.id === drag.id);
  const viewer = viewerRef.current;
  const canvas = canvasRef.current;
  if (!entity || !viewer || !canvas) return;
  if (drag.mode === 'angular') {
    const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, drag.center, drag.planeNormal);
    if (!hit) return;
    const angle = ringAngleForHit(hit, drag.center, drag.angleBasisX, drag.angleBasisY);
    if (angle === null) return;
    const deltaDegrees = normalizeAngle(angle - drag.startAngle) * (180 / Math.PI);
    const rotation = addAxisDelta(drag.rotation, drag.axis, deltaDegrees);
    syncRenderedGobjTransform(entity, entity.position, rotation, entity.scale);
    onRotateEntity?.(entity, rotation);
    return;
  }
  const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, drag.planePoint, drag.planeNormal);
  if (!hit) return;
  const worldDelta = (dot(subVec3(hit, drag.axisOrigin), drag.axisDirection) - drag.startAxisOffset) / MKW_RENDER_SCALE;
  if (toolRef.current === 'translate') {
    const position = addAxisDelta(drag.position, drag.axis, worldDelta);
      syncRenderedGobjTransform(entity, position, entity.rotation, entity.scale);
      onMoveEntity(entity, position);
      return;
  }
  if (toolRef.current === 'scale' && drag.scale) {
    const factor = Math.max(0.05, 1 + worldDelta / 350);
    const scale = multiplyAxis(drag.scale, drag.axis, factor);
    syncRenderedGobjTransform(entity, entity.position, entity.rotation, scale);
    onScaleEntity?.(entity, scale);
    }
  }

  function handleCheckpointEndpointPointerMove(clientX: number, clientY: number, drag: CheckpointDragState) {
    const entity = trackRef.current?.kmp?.entities.find((candidate) => candidate.id === drag.id);
    if (!entity?.checkpoint) return;
    const current = entity.checkpoint[drag.side];
    const next = placeFromScreen(clientX, clientY, current.y);
    if (next) onMoveCheckpointEndpoint?.(entity, drag.side, next);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const rawObjectId = event.dataTransfer.getData('application/mkw-object-id');
    const rawKmpSection = event.dataTransfer.getData('application/mkw-point-section') as AppendableKmpSection | '';
    if (!rawObjectId && !rawKmpSection) return;
    const position = placeFromScreen(event.clientX, event.clientY, 0);
    if (!position) return;
    if (rawKmpSection) {
      onAddKmpPoint?.(rawKmpSection, position);
      return;
    }
    const objectId = Number(rawObjectId);
    if (Number.isFinite(objectId)) onAddObject?.(objectId, position);
  }

  function handleCanvasClick(event: MouseEvent<HTMLCanvasElement>) {
    const track = trackRef.current;
    const canvas = canvasRef.current;
    if (!track?.kmp || !canvas || draggingEntityRef.current) return;
    const scene = sceneRef.current as SceneGfx & {
      pickEditorHandle?: (normalizedX: number, normalizedY: number) => SceneOverlayPick | null;
    } | null;
    const scenePick = pickSceneHandle(scene, event.clientX, event.clientY, canvas);
    const picked = pickEntityFromPick(scenePick) ?? pickEntityFromScreenPosition(event.clientX, event.clientY);
    onSelect(picked?.id ?? null);
  }

  function handleCanvasContextMenu(event: MouseEvent<HTMLCanvasElement>) {
    event.preventDefault();
  }

  function pickEntityFromPick(pick: SceneOverlayPick | null): KmpEntity | null {
    if (!pick) return null;
    return trackRef.current?.kmp?.entities.find((entity) => entity.id === pick.id) ?? null;
  }

  function pickEntityFromScreenPosition(clientX: number, clientY: number): KmpEntity | null {
    const track = trackRef.current;
    const viewer = viewerRef.current;
    const canvas = canvasRef.current;
    if (!track?.kmp || !viewer || !canvas) return null;
    return pickEntityFromScreen(track.kmp.entities, clientX, clientY, canvas, viewer);
  }

  function syncRenderedGobjTransforms(nextTrack: TrackDocument | null) {
    if (!nextTrack?.kmp || !sceneRef.current) return;
    for (const entity of nextTrack.kmp.entities) syncRenderedGobjTransform(entity, entity.position, entity.rotation, entity.scale);
  }

  function syncRenderedGobjTransform(entity: KmpEntity, position: Vec3, rotation?: Vec3, scale?: Vec3) {
    if (entity.section !== 'GOBJ' || !rotation || !scale) return;
    const scene = sceneRef.current as SceneGfx & {
      updateEditorGobjTransform?: (index: number, translation: Vec3, rotation: Vec3, scale: Vec3) => boolean;
    } | null;
    scene?.updateEditorGobjTransform?.(entity.index, position, rotation, scale);
  }

  function syncSceneOverlay(nextTrack: TrackDocument | null, nextSelectedId: string | null) {
    const scene = sceneRef.current as SceneGfx & {
      setEditorOverlayData?: (data: SceneOverlayData) => void;
    } | null;
    scene?.setEditorOverlayData?.(buildSceneOverlayData(nextTrack, nextSelectedId, collisionVisibleRef.current, toolRef.current));
  }

  return (
    <section className="viewport" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <div ref={uiContainerRef} className="noclipUiHost" />
      <div className="viewportToolbar">
        <span className="rendererBadge">noclip Mario Kart Wii renderer</span>
        <ToolBadge tool={tool} />
        <span>WASD fly · drag with mouse look · BRRES/GX/TEV scene</span>
      </div>
      <canvas
        ref={canvasRef}
        className="noclipCanvas"
        onClick={handleCanvasClick}
        onContextMenu={handleCanvasContextMenu}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={clearActiveDrag}
        onPointerCancel={clearActiveDrag}
      />
      {smokeMode && <div hidden data-viewport-sample={smokeViewportSample} data-smoke-selected-gobj-rendered={smokeSelectedGobjRendered} data-smoke-selected-gobj-snapped={smokeSelectedGobjSnapped} />}
      <div className="rendererStatus">{status}</div>
      {selected && <div className="selectionHud">{getEntityLabel(selected)}</div>}
    </section>
  );
}

function getSceneKey(track: TrackDocument): string {
  const base = track.sourceId ?? `${track.fileName}:${track.brresFiles.join('|')}:${track.kcl?.triangles.length ?? 0}`;
  const gobjSignature =
    track.kmp?.entities
      .filter((entity) => entity.section === 'GOBJ')
      .map((entity) =>
        [
          entity.index,
          entity.objectId ?? -1,
          entity.routeIndex ?? -1,
          entity.presenceFlags ?? -1,
          ...(entity.objectSettings ?? []),
        ].join(':'),
      )
      .join('|') ?? 'nogobj';
  return `${base}:gobj:${gobjSignature}`;
}

function buildSceneOverlayData(track: TrackDocument | null, selectedId: string | null, collisionVisible: boolean, tool: TransformTool): SceneOverlayData {
  if (!track?.kmp) return { tool, points: [], lines: [], axes: [], checkpointEndpoints: [], collisionTriangles: [] };

  const points = track.kmp.entities
    .filter((entity) => entity.section !== 'STGI')
    .map((entity) => ({
      id: entity.id,
      section: String(entity.section),
      position: entity.position,
      selected: entity.id === selectedId,
    }));

  const lines: SceneOverlayLine[] = [];
  for (const graph of track.kmp.pathGraphs) {
    const graphPoints = track.kmp.entities.filter((entity) => entity.section === graph.pointSection);
    graph.edges.forEach((edge, index) => {
      const a = graphPoints[edge.from];
      const b = graphPoints[edge.to];
      if (!a || !b) return;
      lines.push({ id: `${graph.pointSection}-${index}`, section: graph.pointSection, a: a.position, b: b.position });
    });
  }
  for (const route of track.kmp.routes) {
    for (let i = 0; i < route.points.length - 1; i++) {
      lines.push({
        id: `POTI-${route.index}-${i}`,
        section: 'POTI',
        a: route.points[i].position,
        b: route.points[i + 1].position,
      });
    }
  }
  for (const entity of track.kmp.entities.filter((candidate) => candidate.section === 'CKPT' && candidate.checkpoint)) {
    lines.push({
      id: `CKPT-span-${entity.id}`,
      section: 'CKPT',
      a: entity.checkpoint!.left,
      b: entity.checkpoint!.right,
    });
  }

  const axes: SceneOverlayAxis[] = [];
  const checkpointEndpoints: SceneOverlayCheckpointEndpoint[] = [];
  const collisionTriangles: SceneOverlayCollisionTriangle[] =
    collisionVisible && track.kcl
      ? track.kcl.triangles.map((triangle) => ({
          a: triangle.a,
          b: triangle.b,
          c: triangle.c,
          typeIndex: triangle.flag & 0x1f,
        }))
      : [];
  const selected = selectedId ? track.kmp.entities.find((entity) => entity.id === selectedId) ?? null : null;
  if (selected) {
    const length = getGizmoLength(selected);
    axes.push(
      { ownerId: selected.id, axis: 'x', a: selected.position, b: { x: selected.position.x + length, y: selected.position.y, z: selected.position.z } },
      { ownerId: selected.id, axis: 'y', a: selected.position, b: { x: selected.position.x, y: selected.position.y + length, z: selected.position.z } },
      { ownerId: selected.id, axis: 'z', a: selected.position, b: { x: selected.position.x, y: selected.position.y, z: selected.position.z + length } },
    );
    if (selected.checkpoint) {
      checkpointEndpoints.push(
        { id: selected.id, side: 'left', position: selected.checkpoint.left },
        { id: selected.id, side: 'right', position: selected.checkpoint.right },
      );
    }
  }

  return { tool, points, lines, axes, checkpointEndpoints, collisionTriangles };
}

function createGizmoDragState(
  entity: KmpEntity,
  axis: GizmoAxis,
  tool: TransformTool,
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  viewer: Viewer,
): GizmoDragState | null {
  if (tool === 'rotate' && entity.rotation) return createAngularGizmoDragState(entity, axis, clientX, clientY, canvas, viewer);
  const axisDirection = axisDirectionFor(axis);
  const planePoint = scaleVec3(entity.position, MKW_RENDER_SCALE);
  const cameraForward = getCameraForward(canvas, viewer);
  const planeNormal = getAxisDragPlaneNormal(axisDirection, cameraForward);
  if (!planeNormal) return null;
  const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, planePoint, planeNormal);
  if (!hit) return null;
  return {
    kind: 'gizmo',
    mode: 'linear',
    id: entity.id,
    axis,
    position: entity.position,
    axisOrigin: planePoint,
    axisDirection,
    planePoint,
    planeNormal,
    startAxisOffset: dot(subVec3(hit, planePoint), axisDirection),
    rotation: entity.rotation,
    scale: entity.scale,
  };
}

function createAngularGizmoDragState(
  entity: KmpEntity,
  axis: GizmoAxis,
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  viewer: Viewer,
): GizmoDragState | null {
  const center = scaleVec3(entity.position, MKW_RENDER_SCALE);
  const planeNormal = axisDirectionFor(axis);
  const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, center, planeNormal);
  if (!hit || !entity.rotation) return null;
  const { x: angleBasisX, y: angleBasisY } = getRotateRingBasis(axis);
  const startAngle = ringAngleForHit(hit, center, angleBasisX, angleBasisY);
  if (startAngle === null) return null;
  return {
    kind: 'gizmo',
    mode: 'angular',
    id: entity.id,
    axis,
    center,
    planeNormal,
    angleBasisX,
    angleBasisY,
    startAngle,
    rotation: entity.rotation,
  };
}

function pickEntityFromScreen(entities: KmpEntity[], clientX: number, clientY: number, canvas: HTMLCanvasElement, viewer: Viewer): KmpEntity | null {
  const ray = screenToWorldRay(clientX, clientY, canvas, viewer);
  if (!ray) return null;
  const origin = { x: ray.origin.x / MKW_RENDER_SCALE, y: ray.origin.y / MKW_RENDER_SCALE, z: ray.origin.z / MKW_RENDER_SCALE };
  let best: { entity: KmpEntity; score: number } | null = null;
  for (const entity of entities) {
    if (entity.section === 'STGI') continue;
    const t = dot(subVec3(entity.position, origin), ray.direction);
    if (t < 0) continue;
    const closest = {
      x: origin.x + ray.direction.x * t,
      y: origin.y + ray.direction.y * t,
      z: origin.z + ray.direction.z * t,
    };
    const distance = distanceVec3(entity.position, closest);
    const radius = pickRadius(entity);
    if (distance > radius) continue;
    const score = distance / radius + t * 0.00001;
    if (!best || score < best.score) best = { entity, score };
  }
  return best?.entity ?? null;
}

function pickSceneHandle(
  scene: (SceneGfx & { pickEditorHandle?: (normalizedX: number, normalizedY: number) => SceneOverlayPick | null }) | null,
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
): SceneOverlayPick | null {
  if (!scene?.pickEditorHandle) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const normalizedX = (clientX - rect.left) / rect.width;
  const normalizedY = (clientY - rect.top) / rect.height;
  if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) return null;
  return scene.pickEditorHandle(normalizedX, normalizedY);
}

function pickRadius(entity: KmpEntity): number {
  if (entity.section === 'GOBJ') return Math.max(260, Math.min(1800, Math.max(entity.scale?.x ?? 1, entity.scale?.y ?? 1, entity.scale?.z ?? 1) * 0.65));
  if (entity.section === 'CKPT') return 520;
  if (entity.section === 'AREA') return Math.max(360, Math.min(2000, Math.max(entity.scale?.x ?? 1, entity.scale?.y ?? 1, entity.scale?.z ?? 1) * 0.35));
  return 260;
}

function getGizmoLength(entity: KmpEntity): number {
  const scaleLength = entity.scale ? Math.max(entity.scale.x, entity.scale.y, entity.scale.z) * 1.4 : 0;
  return Math.max(250, Math.min(1500, scaleLength || 500));
}

function addAxisDelta(vector: Vec3, axis: GizmoAxis, delta: number): Vec3 {
  return {
    x: axis === 'x' ? vector.x + delta : vector.x,
    y: axis === 'y' ? vector.y + delta : vector.y,
    z: axis === 'z' ? vector.z + delta : vector.z,
  };
}

function multiplyAxis(vector: Vec3, axis: GizmoAxis, factor: number): Vec3 {
  return {
    x: axis === 'x' ? vector.x * factor : vector.x,
    y: axis === 'y' ? vector.y * factor : vector.y,
    z: axis === 'z' ? vector.z * factor : vector.z,
  };
}

function axisDirectionFor(axis: GizmoAxis): Vec3 {
  if (axis === 'x') return { x: 1, y: 0, z: 0 };
  if (axis === 'y') return { x: 0, y: 1, z: 0 };
  return { x: 0, y: 0, z: 1 };
}

function getRotateRingBasis(axis: GizmoAxis): { x: Vec3; y: Vec3 } {
  if (axis === 'x') return { x: { x: 0, y: 1, z: 0 }, y: { x: 0, y: 0, z: 1 } };
  if (axis === 'y') return { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 0, z: 1 } };
  return { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 } };
}

function scaleVec3(vector: Vec3, scale: number): Vec3 {
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

function subVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function scaleDirection(direction: Vec3, amount: number): Vec3 {
  return { x: direction.x * amount, y: direction.y * amount, z: direction.z * amount };
}

function normalize(vector: Vec3): Vec3 | null {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length < 0.000001) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function distanceVec3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function ringAngleForHit(hit: Vec3, center: Vec3, basisX: Vec3, basisY: Vec3): number | null {
  const offset = subVec3(hit, center);
  const x = dot(offset, basisX);
  const y = dot(offset, basisY);
  if (Math.hypot(x, y) < 0.0001) return null;
  return Math.atan2(y, x);
}

function normalizeAngle(angle: number): number {
  while (angle <= -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  return angle;
}

function screenToWorldRay(clientX: number, clientY: number, canvas: HTMLCanvasElement, viewer: Viewer): { origin: Vec3; direction: Vec3 } | null {
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
  const inv = mat4.invert(mat4.create(), viewer.camera.clipFromWorldMatrix);
  if (!inv) return null;
  const near = vec4.fromValues(ndcX, ndcY, -1, 1);
  const far = vec4.fromValues(ndcX, ndcY, 1, 1);
  vec4.transformMat4(near, near, inv);
  vec4.transformMat4(far, far, inv);
  for (const point of [near, far]) {
    point[0] /= point[3];
    point[1] /= point[3];
    point[2] /= point[3];
  }
  const direction = vec3.normalize(vec3.create(), vec3.fromValues(far[0] - near[0], far[1] - near[1], far[2] - near[2]));
  return {
    origin: { x: near[0], y: near[1], z: near[2] },
    direction: { x: direction[0], y: direction[1], z: direction[2] },
  };
}

function screenToWorldOnPlane(clientX: number, clientY: number, canvas: HTMLCanvasElement, viewer: Viewer, planeY: number): Vec3 | null {
  const ray = screenToWorldRay(clientX, clientY, canvas, viewer);
  if (!ray || Math.abs(ray.direction.y) < 0.00001) return null;
  const t = (planeY - ray.origin.y) / ray.direction.y;
  if (t < 0) return null;
  return {
    x: ray.origin.x + ray.direction.x * t,
    y: planeY,
    z: ray.origin.z + ray.direction.z * t,
  };
}

function intersectScreenWithPlane(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  viewer: Viewer,
  planePoint: Vec3,
  planeNormal: Vec3,
): Vec3 | null {
  const ray = screenToWorldRay(clientX, clientY, canvas, viewer);
  if (!ray) return null;
  const denominator = dot(ray.direction, planeNormal);
  if (Math.abs(denominator) < 0.00001) return null;
  const distance = dot(subVec3(planePoint, ray.origin), planeNormal) / denominator;
  if (!Number.isFinite(distance) || distance < 0) return null;
  return addVec3(ray.origin, scaleDirection(ray.direction, distance));
}

function getCameraForward(canvas: HTMLCanvasElement, viewer: Viewer): Vec3 {
  const rect = canvas.getBoundingClientRect();
  const centerX = rect.left + rect.width * 0.5;
  const centerY = rect.top + rect.height * 0.5;
  return screenToWorldRay(centerX, centerY, canvas, viewer)?.direction ?? { x: 0, y: 0, z: -1 };
}

function getAxisDragPlaneNormal(axisDirection: Vec3, cameraForward: Vec3): Vec3 | null {
  const forwardComponent = subVec3(cameraForward, scaleDirection(axisDirection, dot(cameraForward, axisDirection)));
  const primary = normalize(forwardComponent);
  if (primary) return primary;

  const up = { x: 0, y: 1, z: 0 };
  const upComponent = subVec3(up, scaleDirection(axisDirection, dot(up, axisDirection)));
  const fallback = normalize(upComponent);
  if (fallback) return fallback;

  return normalize(cross(axisDirection, { x: 0, y: 0, z: 1 })) ?? normalize(cross(axisDirection, { x: 1, y: 0, z: 0 }));
}

function applyDirectCameraLook(viewer: Viewer, dx: number, dy: number) {
  const invertXMult = viewer.inputManager.invertX ? -1 : 1;
  const invertYMult = viewer.inputManager.invertY ? -1 : 1;
  const yaw = dx * (-1 / 500) * invertXMult;
  const pitch = dy * (-1 / 500) * invertYMult;
  const viewUp = vec3.create();
  getMatrixAxisY(viewUp, viewer.camera.viewMatrix);
  mat4.rotate(viewer.camera.worldMatrix, viewer.camera.worldMatrix, yaw, viewUp);
  mat4.rotate(viewer.camera.worldMatrix, viewer.camera.worldMatrix, pitch, vec3.fromValues(1, 0, 0));
  viewer.camera.worldMatrixUpdated();
}

function sampleViewportState(canvas: HTMLCanvasElement): 'blank' | 'nonblank' | null {
  const gl = canvas.getContext('webgl2');
  if (!gl) return null;
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  if (width < 32 || height < 32) return null;

  const x0 = Math.max(0, Math.floor(width * 0.12));
  const x1 = Math.min(width, Math.floor(width * 0.7));
  const y0 = Math.max(0, Math.floor(height * 0.22));
  const y1 = Math.min(height, Math.floor(height * 0.78));
  const sampleWidth = Math.max(1, x1 - x0);
  const sampleHeight = Math.max(1, y1 - y0);
  const rgba = new Uint8Array(sampleWidth * sampleHeight * 4);
  gl.readPixels(x0, y0, sampleWidth, sampleHeight, gl.RGBA, gl.UNSIGNED_BYTE, rgba);

  let count = 0;
  let sum = 0;
  let sumSq = 0;
  let nonDark = 0;
  const colors = new Set<string>();
  for (let y = 0; y < sampleHeight; y += 4) {
    for (let x = 0; x < sampleWidth; x += 4) {
      const offset = (y * sampleWidth + x) * 4;
      const r = rgba[offset];
      const g = rgba[offset + 1];
      const b = rgba[offset + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += luma;
      sumSq += luma * luma;
      count++;
      if (luma > 28) nonDark++;
      if (colors.size < 4096) colors.add(`${r >> 3},${g >> 3},${b >> 3}`);
    }
  }

  const mean = sum / Math.max(1, count);
  const variance = sumSq / Math.max(1, count) - mean * mean;
  const channelStdDev = Math.sqrt(Math.max(0, variance));
  const nonDarkRatio = nonDark / Math.max(1, count);
  return colors.size >= 64 && channelStdDev >= 8 && nonDarkRatio >= 0.005 ? 'nonblank' : 'blank';
}

function makeLocalDataFetcher(): DataFetcher {
  return {
    fetchData: async (path: string) => {
      const response = await fetch(`/data/${path}`);
      if (!response.ok) throw new Error(`Failed to load renderer data ${path}: ${response.status}`);
      return new ArrayBufferSlice(await response.arrayBuffer()) as never;
    },
  } as DataFetcher;
}

function ToolBadge({ tool }: { tool: TransformTool }) {
  const Icon = tool === 'translate' ? Move3D : tool === 'rotate' ? RotateCcw : Scale3D;
  return (
    <span className="toolBadge">
      <Icon size={14} />
      {tool}
    </span>
  );
}
