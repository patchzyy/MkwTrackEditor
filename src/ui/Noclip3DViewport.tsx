import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent } from 'react';
import { Eye, EyeOff, Move3D, RotateCcw, Scale3D } from 'lucide-react';
import { mat4, vec3, vec4 } from 'gl-matrix';
import ArrayBufferSlice from '../../vendor/noclip.website/src/ArrayBufferSlice';
import { FPSCameraController, OrthoCameraController } from '../../vendor/noclip.website/src/Camera';
import { DataShare } from '../../vendor/noclip.website/src/DataShare';
import type { DataFetcher } from '../../vendor/noclip.website/src/DataFetcher';
import { getMatrixAxisY } from '../../vendor/noclip.website/src/MathHelpers';
import type { Destroyable, SceneContext } from '../../vendor/noclip.website/src/SceneBase';
import { InitErrorCode, initializeViewerWebGL2, resizeCanvas, type SceneGfx, type Viewer } from '../../vendor/noclip.website/src/viewer';
import { createSceneFromU8Buffer } from '../../vendor/noclip.website/src/rres/scenes';
import { buildU8 } from '../lib/u8';
import type { AppendableKmpSection, KmpEntity, Vec3 } from '../lib/kmp';
import { raycastDown, raycastMesh, snapPointToTriangleFeature } from '../lib/kcl';
import type { TrackDocument } from '../lib/track';
import { describeEntity } from '../lib/track';

interface Noclip3DViewportProps {
  track: TrackDocument | null;
  selectedId: string | null;
  selectedIds: string[];
  smokeCommonUrl?: string | null;
  tool: TransformTool;
  viewMode: ViewMode;
  collisionVisible: boolean;
  getEntityLabel?: (entity: KmpEntity) => string;
  onSelect: (id: string | null, options?: { additive?: boolean }) => void;
  onSelectMany?: (ids: string[], options?: { additive?: boolean }) => void;
  onMoveEntity: (entity: KmpEntity, position: Vec3) => void;
  onRotateEntity?: (entity: KmpEntity, rotation: Vec3) => void;
  onScaleEntity?: (entity: KmpEntity, scale: Vec3) => void;
  onMoveCheckpointEndpoint?: (entity: KmpEntity, side: 'left' | 'right', position: Vec3) => void;
  onAddObject?: (objectId: number, position: Vec3) => void;
  onAddKmpPoint?: (section: AppendableKmpSection, position: Vec3) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

export type TransformTool = 'translate' | 'rotate' | 'scale';
export type ViewMode = 'normal' | 'dev' | 'topdown' | 'ortho';

type GizmoAxis = 'x' | 'y' | 'z';
type GizmoPlane = 'xy' | 'xz' | 'yz';

interface SceneOverlayPoint {
  id: string;
  section: string;
  position: Vec3;
  markerText?: string;
  selected: boolean;
  hovered: boolean;
  invalid: boolean;
}

interface SceneOverlayLine {
  id: string;
  section: string;
  routeKey?: string;
  a: Vec3;
  b: Vec3;
}

interface SceneOverlayAxis {
  ownerId: string;
  axis: GizmoAxis;
  a: Vec3;
  b: Vec3;
}

interface SceneOverlayPlane {
  ownerId: string;
  plane: GizmoPlane;
  a: Vec3;
  b: Vec3;
  c: Vec3;
  d: Vec3;
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

interface SceneOverlayCheckpointWall {
  id: string;
  left: Vec3;
  right: Vec3;
  topY: number;
  selected: boolean;
  invalid: boolean;
}

interface SceneOverlayAreaVolume {
  id: string;
  shape: number;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  selected: boolean;
  hovered: boolean;
  invalid: boolean;
}

interface SceneOverlayData {
  tool: TransformTool;
  points: SceneOverlayPoint[];
  lines: SceneOverlayLine[];
  axes: SceneOverlayAxis[];
  planes: SceneOverlayPlane[];
  checkpointEndpoints: SceneOverlayCheckpointEndpoint[];
  collisionTriangles: SceneOverlayCollisionTriangle[];
  checkpointWalls: SceneOverlayCheckpointWall[];
  areaVolumes: SceneOverlayAreaVolume[];
}

type SceneOverlayPick =
  | { kind: 'point'; id: string }
  | { kind: 'center'; id: string }
  | { kind: 'plane'; id: string; plane: GizmoPlane }
  | { kind: 'axis'; id: string; axis: GizmoAxis }
  | { kind: 'checkpointEndpoint'; id: string; side: 'left' | 'right' };

interface CameraFrame {
  eye: vec3;
  target: vec3;
}

interface TrackViewBounds {
  center: vec3;
  radius: number;
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

interface PlanarGizmoDragState {
  kind: 'gizmo';
  mode: 'planar';
  id: string;
  position: Vec3;
  planePoint: Vec3;
  planeNormal: Vec3;
  startHit: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
}

interface UniformScaleGizmoDragState {
  kind: 'gizmo';
  mode: 'uniformScale';
  id: string;
  center: Vec3;
  planeNormal: Vec3;
  startHit: Vec3;
  startRadius: number;
  scale: Vec3;
}

interface PlanarScaleGizmoDragState {
  kind: 'gizmo';
  mode: 'planarScale';
  id: string;
  plane: GizmoPlane;
  center: Vec3;
  planePoint: Vec3;
  planeNormal: Vec3;
  startU: number;
  startV: number;
  scale: Vec3;
}

type GizmoDragState = LinearGizmoDragState | AngularGizmoDragState | PlanarGizmoDragState | UniformScaleGizmoDragState | PlanarScaleGizmoDragState;

interface CheckpointDragState {
  kind: 'checkpointEndpoint';
  id: string;
  side: 'left' | 'right';
}

type ActiveDragState = DragState | GizmoDragState | CheckpointDragState;

interface CameraLookDragState {
  lastClientX: number;
  lastClientY: number;
  pointerId: number;
}

interface MarqueeSelectionState {
  additive: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface RouteVisibilityItem {
  key: RouteVisibilityKey;
  label: string;
}

type RouteVisibilityKey = 'ENPT' | 'ITPT' | 'CKPT' | 'POTI_OBJECT' | 'POTI_CAMERA' | 'JGPT' | 'AREA' | 'CAME';
type DofMode = 'full' | 'reduced' | 'off';

const MKW_RENDER_SCALE = 0.1;

function getTrackViewBounds(track: TrackDocument): TrackViewBounds | null {
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

  if (!Number.isFinite(min[0]) || !Number.isFinite(max[0])) return null;

  const center = vec3.fromValues(
    ((min[0] + max[0]) * 0.5) * MKW_RENDER_SCALE,
    ((min[1] + max[1]) * 0.5) * MKW_RENDER_SCALE,
    ((min[2] + max[2]) * 0.5) * MKW_RENDER_SCALE,
  );
  const spanX = (max[0] - min[0]) * MKW_RENDER_SCALE;
  const spanY = (max[1] - min[1]) * MKW_RENDER_SCALE;
  const spanZ = (max[2] - min[2]) * MKW_RENDER_SCALE;
  const radius = Math.max(240, Math.hypot(spanX, spanZ) * 0.65, spanY * 1.1);

  return { center, radius };
}

function getInitialCameraFrame(track: TrackDocument): CameraFrame {
  const bounds = getTrackViewBounds(track);
  if (!bounds) {
    return {
      eye: vec3.fromValues(0, 900, 2200),
      target: vec3.fromValues(0, 0, 0),
    };
  }

  return {
    eye: vec3.fromValues(bounds.center[0] + bounds.radius * 0.55, bounds.center[1] + bounds.radius * 0.45, bounds.center[2] + bounds.radius * 1.35),
    target: bounds.center,
  };
}

export function Noclip3DViewport({
  track,
  selectedId,
  selectedIds,
  smokeCommonUrl = null,
  tool,
  viewMode,
  collisionVisible,
  getEntityLabel = describeEntity,
  onSelect,
  onSelectMany,
  onMoveEntity,
  onRotateEntity,
  onScaleEntity,
  onMoveCheckpointEndpoint,
  onAddObject,
  onAddKmpPoint,
  onInteractionStart,
  onInteractionEnd,
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
  const viewportRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uiContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const sceneRef = useRef<SceneGfx | null>(null);
  const destroyablePoolRef = useRef<Destroyable[]>([]);
  const frameRef = useRef<number | null>(null);
  const smokeProbeFrameRef = useRef(0);
  const smokePlacementDoneRef = useRef(false);
  const smokePlacementUsedCollisionRef = useRef(false);
  const smokeMouseLookDoneRef = useRef(false);
  const smokeViewportSampleRef = useRef<'pending' | 'blank' | 'nonblank'>('pending');
  const trackRef = useRef<TrackDocument | null>(null);
  const collisionVisibleRef = useRef(collisionVisible);
  const selectedIdRef = useRef<string | null>(selectedId);
  const selectedIdsRef = useRef<string[]>(selectedIds);
  const toolRef = useRef<TransformTool>(tool);
  const viewModeRef = useRef<ViewMode>(viewMode);
  const hoveredIdRef = useRef<string | null>(null);
  const draggingEntityRef = useRef<ActiveDragState | null>(null);
  const cameraLookDragRef = useRef<CameraLookDragState | null>(null);
  const [status, setStatus] = useState('Drop a Mario Kart Wii .szs track anywhere in the editor');
  const [viewerReady, setViewerReady] = useState(false);
  const [smokeViewportSample, setSmokeViewportSample] = useState<'pending' | 'blank' | 'nonblank'>('pending');
  const [smokeSelectedGobjRendered, setSmokeSelectedGobjRendered] = useState<'pending' | 'yes' | 'no'>('pending');
  const [smokeSelectedGobjSnapped, setSmokeSelectedGobjSnapped] = useState<'pending' | 'yes' | 'no'>('pending');
  const [smokeMouseLookWorked, setSmokeMouseLookWorked] = useState<'pending' | 'yes' | 'no'>('pending');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [routePanelOpen, setRoutePanelOpen] = useState(false);
  const [dofMode, setDofMode] = useState<DofMode>('full');
  const [routeVisibility, setRouteVisibility] = useState<Record<RouteVisibilityKey, boolean>>({
    ENPT: true,
    ITPT: true,
    CKPT: true,
    POTI_OBJECT: true,
    POTI_CAMERA: true,
    JGPT: true,
    AREA: true,
    CAME: true,
  });
  const [marqueeSelection, setMarqueeSelection] = useState<MarqueeSelectionState | null>(null);
  const marqueeSelectionRef = useRef<MarqueeSelectionState | null>(null);
  const suppressNextClickRef = useRef(false);
  const selected = track?.kmp?.entities.find((entity) => entity.id === selectedId) ?? null;
  const sceneKey = track ? getSceneKey(track) : null;
  const gobjSignature = track ? getGobjSignature(track) : 'nogobj';
  const routeItems = track ? getRouteVisibilityItems(track) : [];
  trackRef.current = track;
  collisionVisibleRef.current = collisionVisible;
  selectedIdRef.current = selectedId;
  selectedIdsRef.current = selectedIds;
  toolRef.current = tool;
  viewModeRef.current = viewMode;
  hoveredIdRef.current = hoveredId;

  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;
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
      resizeObserver.observe(viewport);
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
      const rect = viewport.getBoundingClientRect();
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
    const handleBlur = () => releaseCameraLook();
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('blur', handleBlur);
      releaseCameraLook();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleNativePointerDown = (event: globalThis.PointerEvent) => {
      if (event.button !== 2 || draggingEntityRef.current || !supportsMouseLook(viewModeRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      canvas.focus();
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {}
      cameraLookDragRef.current = {
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        pointerId: event.pointerId,
      };
      if (viewerRef.current) viewerRef.current.inputManager.buttons = event.buttons;
      try {
        canvas.requestPointerLock?.();
      } catch {}
    };

    const handleNativePointerMove = (event: globalThis.PointerEvent) => {
      const cameraLook = cameraLookDragRef.current;
      if (!cameraLook || event.pointerId !== cameraLook.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const viewer = viewerRef.current;
      if (!viewer) return;
      const dx = document.pointerLockElement === canvas ? event.movementX : event.clientX - cameraLook.lastClientX;
      const dy = document.pointerLockElement === canvas ? event.movementY : event.clientY - cameraLook.lastClientY;
      viewer.inputManager.buttons = event.buttons || 2;
      applyDirectCameraLook(viewer, dx, dy);
      cameraLookDragRef.current = {
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        pointerId: event.pointerId,
      };
    };

    const handleNativePointerRelease = (event: globalThis.PointerEvent) => {
      const cameraLook = cameraLookDragRef.current;
      if (!cameraLook || event.pointerId !== cameraLook.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      releaseCameraLook(canvas);
    };

    const handleNativeContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    canvas.addEventListener('pointerdown', handleNativePointerDown);
    canvas.addEventListener('pointermove', handleNativePointerMove);
    canvas.addEventListener('pointerup', handleNativePointerRelease);
    canvas.addEventListener('pointercancel', handleNativePointerRelease);
    canvas.addEventListener('contextmenu', handleNativeContextMenu);
    return () => {
      canvas.removeEventListener('pointerdown', handleNativePointerDown);
      canvas.removeEventListener('pointermove', handleNativePointerMove);
      canvas.removeEventListener('pointerup', handleNativePointerRelease);
      canvas.removeEventListener('pointercancel', handleNativePointerRelease);
      canvas.removeEventListener('contextmenu', handleNativeContextMenu);
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
        const dataFetcher = makeLocalDataFetcher(smokeCommonUrl);
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
        applyViewMode(sceneTrack, true);
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
    const viewer = viewerRef.current;
    const scene = sceneRef.current as SceneGfx & {
      rebuildEditorGobjs?: (device: unknown, kmpBuffer: ArrayBufferSlice) => void;
    } | null;
    if (!viewer || !scene?.rebuildEditorGobjs || !track?.kmp) return;
    scene.rebuildEditorGobjs(
      viewer.gfxDevice,
      new ArrayBufferSlice(track.kmp.original.buffer, track.kmp.original.byteOffset, track.kmp.original.byteLength),
    );
  }, [gobjSignature, track?.kmp]);

  useEffect(() => {
    syncSceneOverlay(track, selectedId);
  }, [track?.kmp, track?.kcl, selectedId, selectedIds, hoveredId, collisionVisible, tool, routeVisibility, viewMode]);

  useEffect(() => {
    const trackValue = trackRef.current;
    const hoveredEntity = hoveredIdRef.current
      ? trackValue?.kmp?.entities.find((entity) => entity.id === hoveredIdRef.current) ?? null
      : null;
    if (!hoveredEntity) return;
    const routeUsage = getPotiRouteUsage(trackValue?.kmp ?? null);
    const forcedVisibleObjectRoutes = getForcedVisibleObjectRoutes(trackValue?.kmp ?? null, selectedIdsRef.current, routeUsage);
    if (!isEntityVisibleForRouteFilter(hoveredEntity, routeVisibility, trackValue?.kmp ?? null, routeUsage, forcedVisibleObjectRoutes)) setHoveredId(null);
  }, [routeVisibility, track?.kmp, selectedIds]);

  useEffect(() => {
    applyViewMode(track, false);
  }, [viewMode, viewerReady]);

  useEffect(() => {
    const scene = sceneRef.current as SceneGfx & {
      setEditorDOFMode?: (mode: DofMode) => void;
    } | null;
    scene?.setEditorDOFMode?.(dofMode);
  }, [dofMode, viewerReady, sceneKey]);

  useEffect(() => {
    setRouteVisibility((current) => {
      const next: Record<string, boolean> = {};
      const currentKeys = Object.keys(current);
      let changed = currentKeys.length !== routeItems.length;
      for (const item of routeItems) {
        next[item.key] = current[item.key] ?? true;
        if (next[item.key] !== current[item.key]) changed = true;
      }
      for (const key of currentKeys) {
        if (!routeItems.some((item) => item.key === key)) {
          changed = true;
          break;
        }
      }
      return changed ? next : current;
    });
  }, [routeItems]);

  useEffect(() => {
    if (!smokeMode || smokeAddObjectId === null || smokePlacementDoneRef.current || !onAddObject) return;
    let cancelled = false;
    let frame = 0;
    const tryPlace = () => {
      if (cancelled || smokePlacementDoneRef.current) return;
      if (!track?.kmp || !viewerReady || !sceneRef.current || !canvasRef.current) {
        frame = requestAnimationFrame(tryPlace);
        return;
      }
      const rect = canvasRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        frame = requestAnimationFrame(tryPlace);
        return;
      }
      const smokeAnchor = track.kmp.entities.find((entity) => entity.position) ?? null;
      const anchorClient =
        smokeAnchor && viewerRef.current ? projectWorldToClient(smokeAnchor.position, canvasRef.current, viewerRef.current) : null;
      const placement = placeFromScreenDetailed(anchorClient?.x ?? rect.left + rect.width * 0.5, anchorClient?.y ?? rect.top + rect.height * 0.5, 0);
      if (!placement || placement.source === 'plane') {
        frame = requestAnimationFrame(tryPlace);
        return;
      }
      smokePlacementDoneRef.current = true;
      smokePlacementUsedCollisionRef.current = placement.source !== 'plane';
      onAddObject(smokeAddObjectId, placement.position);
    };
    tryPlace();
    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
    };
  }, [onAddObject, smokeAddObjectId, smokeMode, track?.kmp, viewerReady]);

  useEffect(() => {
    if (!smokeMode || smokeMouseLookDoneRef.current) return;
    let cancelled = false;
    let frame = 0;
    let attempts = 0;
    const tryMouseLook = () => {
      if (cancelled || smokeMouseLookDoneRef.current) return;
      const canvas = canvasRef.current;
      const viewer = viewerRef.current;
      if (!viewerReady || !canvas || !viewer) {
        frame = requestAnimationFrame(tryMouseLook);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        frame = requestAnimationFrame(tryMouseLook);
        return;
      }
      const startX = rect.left + rect.width * 0.5;
      const startY = rect.top + rect.height * 0.5;
      const pointerId = 91 + attempts;
      const before = getCameraSmokeSignature(viewer);
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 2,
          buttons: 2,
          clientX: startX,
          clientY: startY,
          pointerId,
          pointerType: 'mouse',
        }),
      );
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          button: -1,
          buttons: 2,
          clientX: startX + 56,
          clientY: startY + 24,
          pointerId,
          pointerType: 'mouse',
        }),
      );
      canvas.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          button: 2,
          buttons: 0,
          clientX: startX + 56,
          clientY: startY + 24,
          pointerId,
          pointerType: 'mouse',
        }),
      );
      requestAnimationFrame(() => {
        if (cancelled || smokeMouseLookDoneRef.current) return;
        const after = getCameraSmokeSignature(viewer);
        if (before !== after) {
          smokeMouseLookDoneRef.current = true;
          setSmokeMouseLookWorked('yes');
          return;
        }
        attempts++;
        if (attempts >= 12) {
          smokeMouseLookDoneRef.current = true;
          setSmokeMouseLookWorked('no');
          return;
        }
        frame = requestAnimationFrame(tryMouseLook);
      });
    };
    tryMouseLook();
    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
    };
  }, [smokeMode, viewerReady]);

  function placeFromScreen(clientX: number, clientY: number, planeY = 0, snapToFeatures = false): Vec3 | null {
    return placeFromScreenDetailed(clientX, clientY, planeY, snapToFeatures)?.position ?? null;
  }

  function placeFromScreenDetailed(clientX: number, clientY: number, planeY = 0, snapToFeatures = false): { position: Vec3; source: 'mesh' | 'down' | 'plane' } | null {
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
      if (hit) {
        const snappedPosition = snapToFeatures ? snapPointToTriangleFeature(hit.position, hit.triangle).position : hit.position;
        return { position: snappedPosition, source: 'mesh' };
      }
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
    onInteractionStart?.();
    draggingEntityRef.current = { kind: 'entity', id: entity.id, startX: clientX, startY: clientY, rotation: entity.rotation, scale: entity.scale };
  }

  function updateActiveDrag(clientX: number, clientY: number, snapToFeatures = false) {
    const drag = draggingEntityRef.current;
    if (!drag) return;
    if (drag.kind === 'gizmo') {
      handleGizmoPointerMove(clientX, clientY, drag, snapToFeatures);
      return;
    }
    if (drag.kind === 'checkpointEndpoint') {
      handleCheckpointEndpointPointerMove(clientX, clientY, drag, snapToFeatures);
      return;
    }
    const entity = trackRef.current?.kmp?.entities.find((candidate) => candidate.id === drag.id);
    if (!entity) return;
    if (tool === 'translate') {
      const next = placeFromScreen(clientX, clientY, entity.position.y, snapToFeatures);
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
    if (event.button === 2) return;
    if (event.button !== 0 || draggingEntityRef.current) return;
    const scene = sceneRef.current as SceneGfx & {
      pickEditorHandle?: (normalizedX: number, normalizedY: number) => SceneOverlayPick | null;
    } | null;
    const scenePick = pickSceneHandle(scene, event.clientX, event.clientY, event.currentTarget);
    const entity = pickEntityFromPick(scenePick) ?? pickEntityFromScreenPosition(event.clientX, event.clientY);
    if (event.shiftKey && !scenePick && !entity) {
      event.preventDefault();
      event.stopPropagation();
      const nextMarquee = { additive: true, startX: event.clientX, startY: event.clientY, currentX: event.clientX, currentY: event.clientY };
      marqueeSelectionRef.current = nextMarquee;
      setMarqueeSelection(nextMarquee);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.shiftKey) return;
    if (scenePick?.kind === 'center') {
      const drag = entity && viewerRef.current ? createCenterGizmoDragState(entity, toolRef.current, event.clientX, event.clientY, event.currentTarget, viewerRef.current) : null;
      if (!entity || !drag) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect(entity.id);
      onInteractionStart?.();
      draggingEntityRef.current = drag;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (scenePick?.kind === 'plane') {
      const drag = entity && viewerRef.current ? createPlaneGizmoDragState(entity, scenePick.plane, toolRef.current, event.clientX, event.clientY, event.currentTarget, viewerRef.current) : null;
      if (!entity || !drag) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect(entity.id);
      onInteractionStart?.();
      draggingEntityRef.current = drag;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (scenePick?.kind === 'axis') {
      const drag = entity && viewerRef.current ? createGizmoDragState(entity, scenePick.axis, toolRef.current, event.clientX, event.clientY, event.currentTarget, viewerRef.current) : null;
      if (!entity || !drag) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect(entity.id);
      onInteractionStart?.();
      draggingEntityRef.current = drag;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (scenePick?.kind === 'checkpointEndpoint') {
      if (!entity?.checkpoint) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect(entity.id);
      onInteractionStart?.();
      draggingEntityRef.current = { kind: 'checkpointEndpoint', id: entity.id, side: scenePick.side };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (!entity) return;
    event.preventDefault();
    event.stopPropagation();
    startEntityDrag(entity, event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCanvasPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (cameraLookDragRef.current && event.pointerId === cameraLookDragRef.current.pointerId) return;
    if (marqueeSelectionRef.current) {
      const nextMarquee = { ...marqueeSelectionRef.current, currentX: event.clientX, currentY: event.clientY };
      marqueeSelectionRef.current = nextMarquee;
      setMarqueeSelection(nextMarquee);
      return;
    }
    if (draggingEntityRef.current) {
      updateActiveDrag(event.clientX, event.clientY, event.shiftKey);
      return;
    }
    updateHoveredEntity(event.clientX, event.clientY, event.currentTarget);
  }

  function clearActiveDrag(event?: PointerEvent<HTMLCanvasElement>) {
    if (cameraLookDragRef.current && (!event || event.pointerId === cameraLookDragRef.current.pointerId || event.button === 2)) {
      releaseCameraLook(event?.currentTarget ?? canvasRef.current);
      return;
    }
    if (marqueeSelectionRef.current) {
      completeMarqueeSelection(event?.currentTarget ?? canvasRef.current);
      return;
    }
    const hadDrag = draggingEntityRef.current !== null;
    draggingEntityRef.current = null;
    if (hadDrag) onInteractionEnd?.();
  }

  function handleCanvasPointerLeave() {
    if (marqueeSelectionRef.current) return;
    if (hoveredIdRef.current !== null) setHoveredId(null);
  }

function handleGizmoPointerMove(clientX: number, clientY: number, drag: GizmoDragState, snapToFeatures = false) {
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
  if (drag.mode === 'planar') {
    const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, drag.planePoint, drag.planeNormal);
    if (!hit) return;
    let position = {
      x: drag.position.x + (hit.x - drag.startHit.x) / MKW_RENDER_SCALE,
      y: drag.position.y + (hit.y - drag.startHit.y) / MKW_RENDER_SCALE,
      z: drag.position.z + (hit.z - drag.startHit.z) / MKW_RENDER_SCALE,
    };
    if (snapToFeatures) position = snapDraggedPositionToCollision(position);
    syncRenderedGobjTransform(entity, position, entity.rotation, entity.scale);
    onMoveEntity(entity, position);
    return;
  }
  if (drag.mode === 'uniformScale') {
    const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, scaleVec3(drag.center, MKW_RENDER_SCALE), drag.planeNormal);
    if (!hit) return;
    const center = scaleVec3(drag.center, MKW_RENDER_SCALE);
    const radius = Math.hypot(hit.x - center.x, hit.y - center.y, hit.z - center.z);
    const factor = Math.max(0.05, Math.min(20, radius / drag.startRadius));
    const scale = {
      x: drag.scale.x * factor,
      y: drag.scale.y * factor,
      z: drag.scale.z * factor,
    };
    syncRenderedGobjTransform(entity, entity.position, entity.rotation, scale);
    onScaleEntity?.(entity, scale);
    return;
  }
  if (drag.mode === 'planarScale') {
    const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, drag.planePoint, drag.planeNormal);
    if (!hit) return;
    const local = {
      x: (hit.x - drag.planePoint.x) / MKW_RENDER_SCALE,
      y: (hit.y - drag.planePoint.y) / MKW_RENDER_SCALE,
      z: (hit.z - drag.planePoint.z) / MKW_RENDER_SCALE,
    };
    const currentU = drag.plane === 'xy' || drag.plane === 'xz' ? local.x : local.y;
    const currentV = drag.plane === 'xy' ? local.y : local.z;
    const factorU = Math.max(0.05, Math.min(20, Math.abs(currentU) / Math.max(0.1, Math.abs(drag.startU))));
    const factorV = Math.max(0.05, Math.min(20, Math.abs(currentV) / Math.max(0.1, Math.abs(drag.startV))));
    const scale =
      drag.plane === 'xy'
        ? { x: drag.scale.x * factorU, y: drag.scale.y * factorV, z: drag.scale.z }
        : drag.plane === 'xz'
          ? { x: drag.scale.x * factorU, y: drag.scale.y, z: drag.scale.z * factorV }
          : { x: drag.scale.x, y: drag.scale.y * factorU, z: drag.scale.z * factorV };
    syncRenderedGobjTransform(entity, entity.position, entity.rotation, scale);
    onScaleEntity?.(entity, scale);
    return;
  }
  const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, drag.planePoint, drag.planeNormal);
  if (!hit) return;
  const worldDelta = (dot(subVec3(hit, drag.axisOrigin), drag.axisDirection) - drag.startAxisOffset) / MKW_RENDER_SCALE;
  if (toolRef.current === 'translate') {
    let position = addAxisDelta(drag.position, drag.axis, worldDelta);
    if (snapToFeatures) position = snapDraggedPositionToCollision(position);
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

function snapDraggedPositionToCollision(position: Vec3): Vec3 {
  const kcl = trackRef.current?.kcl;
  if (!kcl) return position;
  const hit = raycastDown(kcl, position.x, position.z);
  if (!hit) return position;
  return snapPointToTriangleFeature(hit, hit.triangle).position;
}

  function handleCheckpointEndpointPointerMove(clientX: number, clientY: number, drag: CheckpointDragState, snapToFeatures = false) {
    const entity = trackRef.current?.kmp?.entities.find((candidate) => candidate.id === drag.id);
    if (!entity?.checkpoint) return;
    const current = entity.checkpoint[drag.side];
    const next = placeFromScreen(clientX, clientY, current.y, snapToFeatures);
    if (next) onMoveCheckpointEndpoint?.(entity, drag.side, next);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const rawObjectId = event.dataTransfer.getData('application/mkw-object-id');
    const rawKmpSection = event.dataTransfer.getData('application/mkw-point-section') as AppendableKmpSection | '';
    if (!rawObjectId && !rawKmpSection) return;
    const position = placeFromScreen(event.clientX, event.clientY, 0, event.shiftKey);
    if (!position) return;
    if (rawKmpSection) {
      onAddKmpPoint?.(rawKmpSection, position);
      return;
    }
    const objectId = Number(rawObjectId);
    if (Number.isFinite(objectId)) onAddObject?.(objectId, position);
  }

  function handleCanvasClick(event: MouseEvent<HTMLCanvasElement>) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    const track = trackRef.current;
    const canvas = canvasRef.current;
    if (!track?.kmp || !canvas || draggingEntityRef.current) return;
    const scene = sceneRef.current as SceneGfx & {
      pickEditorHandle?: (normalizedX: number, normalizedY: number) => SceneOverlayPick | null;
    } | null;
    const scenePick = pickSceneHandle(scene, event.clientX, event.clientY, canvas);
    const picked = pickEntityFromPick(scenePick) ?? pickEntityFromScreenPosition(event.clientX, event.clientY);
    onSelect(picked?.id ?? null, { additive: event.shiftKey });
  }

  function handleCanvasContextMenu(event: MouseEvent<HTMLCanvasElement>) {
    event.preventDefault();
  }

  function releaseCameraLook(canvas: HTMLCanvasElement | null = canvasRef.current) {
    const drag = cameraLookDragRef.current;
    if (!drag) return;
    if (canvas?.hasPointerCapture?.(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    viewerRef.current?.inputManager.onGrabReleased();
    cameraLookDragRef.current = null;
    if (canvas && document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
  }

  function completeMarqueeSelection(canvas: HTMLCanvasElement | null) {
    const marquee = marqueeSelectionRef.current;
    marqueeSelectionRef.current = null;
    setMarqueeSelection(null);
    suppressNextClickRef.current = true;
    if (!canvas || !marquee) return;
    const scene = sceneRef.current as SceneGfx & {
      pickEditorPointsInRect?: (normalizedX0: number, normalizedY0: number, normalizedX1: number, normalizedY1: number) => string[];
    } | null;
    const selectedIds = pickScenePointsInRect(scene, marquee, canvas);
    onSelectMany?.(selectedIds, { additive: marquee.additive });
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
    const routeUsage = getPotiRouteUsage(track.kmp);
    return pickEntityFromScreen(
      getVisibleEntitiesForRouteFilter(track.kmp.entities, routeVisibility, track.kmp, routeUsage),
      clientX,
      clientY,
      canvas,
      viewer,
    );
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
    scene?.setEditorOverlayData?.(
      buildSceneOverlayData(
        nextTrack,
        nextSelectedId,
        selectedIdsRef.current,
        hoveredIdRef.current,
        collisionVisibleRef.current,
        toolRef.current,
        routeVisibility,
        viewModeRef.current,
        getViewerCameraPosition(viewerRef.current),
      ),
    );
  }

  function updateHoveredEntity(clientX: number, clientY: number, canvas: HTMLCanvasElement) {
    const scene = sceneRef.current as SceneGfx & {
      pickEditorHandle?: (normalizedX: number, normalizedY: number) => SceneOverlayPick | null;
    } | null;
    const scenePick = pickSceneHandle(scene, clientX, clientY, canvas);
    const hovered = pickEntityFromPick(scenePick) ?? pickEntityFromScreenPosition(clientX, clientY);
    const nextHoveredId = hovered?.id ?? null;
    if (nextHoveredId !== hoveredIdRef.current) setHoveredId(nextHoveredId);
  }

  function applyViewMode(nextTrack: TrackDocument | null, resetFrame: boolean) {
    const viewer = viewerRef.current;
    const scene = sceneRef.current as SceneGfx & {
      setEditorViewMode?: (mode: ViewMode) => void;
    } | null;
    if (!viewer || !nextTrack || !scene) return;

    const nextMode = viewModeRef.current;
    scene.setEditorViewMode?.(nextMode);
    if (nextMode === 'normal' || nextMode === 'dev') {
      const shouldResetCamera = resetFrame || !(viewer.cameraController instanceof FPSCameraController);
      if (!(viewer.cameraController instanceof FPSCameraController)) viewer.setCameraController(new FPSCameraController());
      viewer.camera.setPerspective(Math.PI / 3, getViewerAspect(viewer), 4, 500000);
      if (shouldResetCamera) {
        const initialCamera = getInitialCameraFrame(nextTrack);
        mat4.targetTo(viewer.camera.worldMatrix, initialCamera.eye, initialCamera.target, vec3.fromValues(0, 1, 0));
      }
      viewer.camera.worldMatrixUpdated();
      return;
    }

    const bounds = getTrackViewBounds(nextTrack) ?? {
      center: vec3.fromValues(0, 0, 0),
      radius: 480,
    };
    const controller = viewer.cameraController instanceof OrthoCameraController ? viewer.cameraController : new OrthoCameraController();
    if (!(viewer.cameraController instanceof OrthoCameraController)) viewer.setCameraController(controller);
    vec3.copy(controller.translation, bounds.center);
    controller.txVel = 0;
    controller.tyVel = 0;
    controller.shouldOrbit = false;
    controller.z = -Math.max(220, bounds.radius * 2.4);
    controller.zTarget = controller.z;
    if (nextMode === 'topdown') {
      controller.x = -Math.PI * 0.5;
      controller.xTarget = controller.x;
      controller.y = Math.PI - 0.001;
      controller.yTarget = controller.y;
    } else {
      controller.x = -Math.PI * 0.75;
      controller.xTarget = controller.x;
      controller.y = Math.PI * 0.68;
      controller.yTarget = controller.y;
    }
    controller.forceUpdate = true;
    controller.update(viewer.inputManager, 0);
  }

  return (
    <section ref={viewportRef} className="viewport" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <div ref={uiContainerRef} className="noclipUiHost" />
      <div className="viewportToolbar">
        <ToolBadge tool={tool} />
      </div>
      <div className="routeVisibilityHud">
        <button
          type="button"
          className="iconButton routeVisibilityButton"
          onClick={() => setRoutePanelOpen((value) => !value)}
          aria-label={routePanelOpen ? 'Hide route visibility' : 'Show route visibility'}
          title={routePanelOpen ? 'Hide route visibility' : 'Show route visibility'}
        >
          {routeItems.some((item) => routeVisibility[item.key] === false) ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        {routePanelOpen && (
          <div className="routeVisibilityPanel">
            <strong>Visibility</strong>
            {routeItems.length === 0 ? (
              <span className="routeVisibilityEmpty">No routes in the loaded track.</span>
            ) : (
              routeItems.map((item) => (
                <label key={item.key} className="routeVisibilityRow">
                  <input
                    type="checkbox"
                    checked={routeVisibility[item.key] ?? true}
                    onChange={() =>
                      setRouteVisibility((current) => ({
                        ...current,
                        [item.key]: !(current[item.key] ?? true),
                      }))
                    }
                  />
                  <span>{item.label}</span>
                </label>
              ))
            )}
            <div className="routePanelSection">
              <strong>Depth Of Field</strong>
              <div className="routeModeButtons">
                <button
                  type="button"
                  className={dofMode === 'full' ? 'routeModeButton active' : 'routeModeButton'}
                  onClick={() => setDofMode('full')}
                >
                  Full
                </button>
                <button
                  type="button"
                  className={dofMode === 'reduced' ? 'routeModeButton active' : 'routeModeButton'}
                  onClick={() => setDofMode('reduced')}
                >
                  Reduced
                </button>
                <button
                  type="button"
                  className={dofMode === 'off' ? 'routeModeButton active' : 'routeModeButton'}
                  onClick={() => setDofMode('off')}
                >
                  Off
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className="noclipCanvas"
        onClick={handleCanvasClick}
        onContextMenu={handleCanvasContextMenu}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerLeave={handleCanvasPointerLeave}
        onPointerUp={clearActiveDrag}
        onPointerCancel={clearActiveDrag}
      />
      {marqueeSelection && <div className="marqueeSelection" style={getMarqueeStyle(marqueeSelection, canvasRef.current)} />}
      {smokeMode && (
        <div
          hidden
          data-viewport-sample={smokeViewportSample}
          data-smoke-selected-gobj-rendered={smokeSelectedGobjRendered}
          data-smoke-selected-gobj-snapped={smokeSelectedGobjSnapped}
          data-smoke-mouselook={smokeMouseLookWorked}
        />
      )}
      <div className="rendererStatus">{status}</div>
      {selected && <div className="selectionHud">{getEntityLabel(selected)}</div>}
    </section>
  );
}

function getSceneKey(track: TrackDocument): string {
  return track.sourceId ?? `${track.fileName}:${track.brresFiles.join('|')}:${track.kcl?.triangles.length ?? 0}`;
}

function getGobjSignature(track: TrackDocument): string {
  return (
    track.kmp?.entities
      .filter((entity) => entity.section === 'GOBJ')
      .map((entity) =>
        [
          entity.index,
          entity.objectId ?? -1,
          entity.position.x,
          entity.position.y,
          entity.position.z,
          entity.rotation?.x ?? 0,
          entity.rotation?.y ?? 0,
          entity.rotation?.z ?? 0,
          entity.scale?.x ?? 1,
          entity.scale?.y ?? 1,
          entity.scale?.z ?? 1,
          entity.routeIndex ?? -1,
          entity.presenceFlags ?? -1,
          ...(entity.objectSettings ?? []),
        ].join(':'),
      )
      .join('|') ?? 'nogobj'
  );
}

function buildSceneOverlayData(
  track: TrackDocument | null,
  selectedId: string | null,
  selectedIds: string[],
  hoveredId: string | null,
  collisionVisible: boolean,
  tool: TransformTool,
  routeVisibility: Record<string, boolean>,
  viewMode: ViewMode,
  cameraPosition: Vec3 | null,
): SceneOverlayData {
  if (!track?.kmp) return { tool, points: [], lines: [], axes: [], planes: [], checkpointEndpoints: [], collisionTriangles: [], checkpointWalls: [], areaVolumes: [] };
  const showCollision = collisionVisible || viewMode === 'dev';
  const selectedSet = new Set(selectedIds);
  if (selectedId) selectedSet.add(selectedId);
  const routeUsage = getPotiRouteUsage(track.kmp);
  const forcedVisibleObjectRoutes = getForcedVisibleObjectRoutes(track.kmp, selectedSet, routeUsage);
  const visibleEntities = getVisibleEntitiesForRouteFilter(track.kmp.entities, routeVisibility, track.kmp, routeUsage, forcedVisibleObjectRoutes);
  const invalidIds = collectInvalidEntityIds(track);

  const points = visibleEntities
    .map((entity) => ({
      id: entity.id,
      section: String(entity.section),
      position: entity.position,
      markerText:
        entity.section === 'POTI' &&
        entity.routePoint &&
        getPotiRouteVisibilityKey(entity.routePoint.routeIndex, routeUsage) === 'POTI_OBJECT'
          ? String(entity.routePoint.routeIndex)
          : undefined,
      selected: selectedSet.has(entity.id),
      hovered: entity.id === hoveredId && entity.id !== selectedId,
      invalid: false,
    }));
  for (const point of points) point.invalid = invalidIds.has(point.id);

  const lines: SceneOverlayLine[] = [];
  for (const graph of track.kmp.pathGraphs) {
    if (routeVisibility[graph.pointSection] === false) continue;
    const graphPoints = track.kmp.entities.filter((entity) => entity.section === graph.pointSection);
    for (const group of graph.groups) {
      const routeKey = graph.pointSection;
      for (let pointIndex = group.startIndex; pointIndex < group.startIndex + group.pointCount - 1; pointIndex++) {
        const a = graphPoints[pointIndex];
        const b = graphPoints[pointIndex + 1];
        if (!a || !b) continue;
        lines.push({ id: `${routeKey}-seq-${pointIndex}`, routeKey, section: graph.pointSection, a: a.position, b: b.position });
      }
      for (const nextGroupIndex of group.nextGroups) {
        const a = graphPoints[group.startIndex + group.pointCount - 1];
        const nextGroup = graph.groups.find((candidate) => candidate.index === nextGroupIndex);
        const b = nextGroup ? graphPoints[nextGroup.startIndex] : null;
        if (!a || !b) continue;
        lines.push({ id: `${routeKey}-next-${nextGroupIndex}`, routeKey, section: graph.pointSection, a: a.position, b: b.position });
      }
    }
  }
  for (const route of track.kmp.routes) {
    const routeKey = getPotiRouteVisibilityKey(route.index, routeUsage);
    if (!isPotiRouteVisible(route.index, routeVisibility, routeUsage, forcedVisibleObjectRoutes)) continue;
    for (let i = 0; i < route.points.length - 1; i++) {
      lines.push({
        id: `POTI-${route.index}-${i}`,
        routeKey,
        section: 'POTI',
        a: route.points[i].position,
        b: route.points[i + 1].position,
      });
    }
  }
  for (const entity of track.kmp.entities.filter((candidate) => candidate.section === 'CKPT' && candidate.checkpoint)) {
    if (routeVisibility.CKPT === false) continue;
    lines.push({
      id: `CKPT-span-${entity.id}`,
      routeKey: 'CKPT',
      section: 'CKPT',
      a: entity.checkpoint!.left,
      b: entity.checkpoint!.right,
    });
  }

  const axes: SceneOverlayAxis[] = [];
  const planes: SceneOverlayPlane[] = [];
  const checkpointEndpoints: SceneOverlayCheckpointEndpoint[] = [];
  const collisionTriangles: SceneOverlayCollisionTriangle[] =
    showCollision && track.kcl
      ? track.kcl.triangles.map((triangle) => ({
          a: triangle.a,
          b: triangle.b,
          c: triangle.c,
          typeIndex: triangle.flag & 0x1f,
        }))
      : [];
  const selected = selectedId ? track.kmp.entities.find((entity) => entity.id === selectedId) ?? null : null;
  const checkpointWalls =
    selected?.section === 'CKPT'
      ? visibleEntities
          .filter((entity): entity is KmpEntity & { section: 'CKPT'; checkpoint: NonNullable<KmpEntity['checkpoint']> } => entity.section === 'CKPT' && !!entity.checkpoint)
          .map((entity) => ({
            id: entity.id,
            left: entity.checkpoint.left,
            right: entity.checkpoint.right,
            topY: getCheckpointWallTopY(track),
            selected: entity.id === selected.id,
            invalid: invalidIds.has(entity.id),
          }))
      : [];
  const areaVolumes: SceneOverlayAreaVolume[] = visibleEntities
    .filter((entity): entity is KmpEntity & { section: 'AREA'; area: NonNullable<KmpEntity['area']>; rotation: Vec3; scale: Vec3 } => (
      entity.section === 'AREA' &&
      !!entity.area &&
      !!entity.rotation &&
      !!entity.scale &&
      selectedSet.has(entity.id)
    ))
    .map((entity) => ({
      id: entity.id,
      shape: entity.area.shape,
      position: entity.position,
      rotation: entity.rotation,
      scale: entity.scale,
      selected: selectedSet.has(entity.id),
      hovered: entity.id === hoveredId && entity.id !== selectedId,
      invalid: invalidIds.has(entity.id),
    }));
  const selectedHiddenByRouteFilter = !!selected && !isEntityVisibleForRouteFilter(selected, routeVisibility, track.kmp, routeUsage, forcedVisibleObjectRoutes);
  if (selected && !selectedHiddenByRouteFilter) {
    const length = getGizmoLength(selected, cameraPosition);
    const planeSize = length * 0.28;
    axes.push(
      { ownerId: selected.id, axis: 'x', a: selected.position, b: { x: selected.position.x + length, y: selected.position.y, z: selected.position.z } },
      { ownerId: selected.id, axis: 'y', a: selected.position, b: { x: selected.position.x, y: selected.position.y + length, z: selected.position.z } },
      { ownerId: selected.id, axis: 'z', a: selected.position, b: { x: selected.position.x, y: selected.position.y, z: selected.position.z + length } },
    );
    if (tool === 'translate' || tool === 'scale') {
      planes.push(
        {
          ownerId: selected.id,
          plane: 'xy',
          a: selected.position,
          b: { x: selected.position.x + planeSize, y: selected.position.y, z: selected.position.z },
          c: { x: selected.position.x + planeSize, y: selected.position.y + planeSize, z: selected.position.z },
          d: { x: selected.position.x, y: selected.position.y + planeSize, z: selected.position.z },
        },
        {
          ownerId: selected.id,
          plane: 'xz',
          a: selected.position,
          b: { x: selected.position.x + planeSize, y: selected.position.y, z: selected.position.z },
          c: { x: selected.position.x + planeSize, y: selected.position.y, z: selected.position.z + planeSize },
          d: { x: selected.position.x, y: selected.position.y, z: selected.position.z + planeSize },
        },
        {
          ownerId: selected.id,
          plane: 'yz',
          a: selected.position,
          b: { x: selected.position.x, y: selected.position.y + planeSize, z: selected.position.z },
          c: { x: selected.position.x, y: selected.position.y + planeSize, z: selected.position.z + planeSize },
          d: { x: selected.position.x, y: selected.position.y, z: selected.position.z + planeSize },
        },
      );
    }
    if (selected.checkpoint) {
      checkpointEndpoints.push(
        { id: selected.id, side: 'left', position: selected.checkpoint.left },
        { id: selected.id, side: 'right', position: selected.checkpoint.right },
      );
    }
  }

  return { tool, points, lines, axes, planes, checkpointEndpoints, collisionTriangles, checkpointWalls, areaVolumes };
}

function getCheckpointWallTopY(track: TrackDocument): number {
  let maxY = 0;
  for (const triangle of track.kcl?.triangles ?? []) {
    maxY = Math.max(maxY, triangle.a.y, triangle.b.y, triangle.c.y);
  }
  for (const entity of track.kmp?.entities ?? []) {
    maxY = Math.max(maxY, entity.position.y);
    if (entity.checkpoint) maxY = Math.max(maxY, entity.checkpoint.left.y, entity.checkpoint.right.y);
  }
  return Math.max(4000, maxY + 2000);
}

function isEntityVisibleForRouteFilter(
  entity: KmpEntity,
  routeVisibility: Record<string, boolean>,
  kmp: KmpDocument | null,
  routeUsage?: PotiRouteUsage,
  forcedVisibleObjectRoutes?: ReadonlySet<number>,
): boolean {
  if (entity.section === 'STGI') return false;
  if (entity.section === 'ENPT') return routeVisibility.ENPT !== false;
  if (entity.section === 'ITPT') return routeVisibility.ITPT !== false;
  if (entity.section === 'CKPT') return routeVisibility.CKPT !== false;
  if (entity.section === 'JGPT') return routeVisibility.JGPT !== false;
  if (entity.section === 'AREA') return routeVisibility.AREA !== false;
  if (entity.section === 'CAME') return routeVisibility.CAME !== false;
  if (entity.section === 'POTI' && entity.routePoint) {
    return isPotiRouteVisible(entity.routePoint.routeIndex, routeVisibility, routeUsage ?? getPotiRouteUsage(kmp), forcedVisibleObjectRoutes);
  }
  return true;
}

function getVisibleEntitiesForRouteFilter(
  entities: readonly KmpEntity[],
  routeVisibility: Record<string, boolean>,
  kmp: KmpDocument | null,
  routeUsage?: PotiRouteUsage,
  forcedVisibleObjectRoutes?: ReadonlySet<number>,
): KmpEntity[] {
  return entities.filter((entity) => isEntityVisibleForRouteFilter(entity, routeVisibility, kmp, routeUsage, forcedVisibleObjectRoutes));
}

function supportsMouseLook(viewMode: ViewMode): boolean {
  return viewMode === 'normal' || viewMode === 'dev';
}

function getViewerAspect(viewer: Viewer): number {
  if (viewer.canvas.width > 0 && viewer.canvas.height > 0) return viewer.canvas.width / viewer.canvas.height;
  return viewer.camera.aspect || 1;
}

function getRouteVisibilityItems(track: TrackDocument): RouteVisibilityItem[] {
  if (!track.kmp) return [];
  const items: RouteVisibilityItem[] = [];
  const routeUsage = getPotiRouteUsage(track.kmp);
  if (track.kmp.pathGraphs.some((graph) => graph.pointSection === 'ENPT')) items.push({ key: 'ENPT', label: 'Enemy Routes' });
  if (track.kmp.pathGraphs.some((graph) => graph.pointSection === 'ITPT')) items.push({ key: 'ITPT', label: 'Item Routes' });
  if (track.kmp.pathGraphs.some((graph) => graph.pointSection === 'CKPT')) items.push({ key: 'CKPT', label: 'Checkpoint Routes' });
  if (track.kmp.routes.length > 0 && (routeUsage.objectRoutes.size > 0 || routeUsage.unusedRoutes.size > 0)) items.push({ key: 'POTI_OBJECT', label: 'Object Routes' });
  if (track.kmp.routes.length > 0 && routeUsage.cameraRoutes.size > 0) items.push({ key: 'POTI_CAMERA', label: 'Camera Routes' });
  if (track.kmp.entities.some((entity) => entity.section === 'JGPT')) items.push({ key: 'JGPT', label: 'Respawn Points' });
  if (track.kmp.entities.some((entity) => entity.section === 'AREA')) items.push({ key: 'AREA', label: 'Area Triggers' });
  if (track.kmp.entities.some((entity) => entity.section === 'CAME')) items.push({ key: 'CAME', label: 'Cameras' });
  return items;
}

interface PotiRouteUsage {
  objectRoutes: Set<number>;
  cameraRoutes: Set<number>;
  unusedRoutes: Set<number>;
}

function getPotiRouteUsage(kmp: KmpDocument | null): PotiRouteUsage {
  const objectRoutes = new Set<number>();
  const cameraRoutes = new Set<number>();
  const unusedRoutes = new Set<number>();
  if (!kmp) return { objectRoutes, cameraRoutes, unusedRoutes };
  for (const route of kmp.routes) unusedRoutes.add(route.index);
  for (const entity of kmp.entities) {
    if (entity.routeIndex === undefined || entity.routeIndex === 0xffff) continue;
    unusedRoutes.delete(entity.routeIndex);
    if (entity.section === 'CAME') cameraRoutes.add(entity.routeIndex);
    else if (entity.section === 'GOBJ') objectRoutes.add(entity.routeIndex);
  }
  return { objectRoutes, cameraRoutes, unusedRoutes };
}

function getPotiRouteVisibilityKey(routeIndex: number, routeUsage: PotiRouteUsage): RouteVisibilityKey {
  if (routeUsage.cameraRoutes.has(routeIndex) && !routeUsage.objectRoutes.has(routeIndex)) return 'POTI_CAMERA';
  return 'POTI_OBJECT';
}

function getForcedVisibleObjectRoutes(
  kmp: KmpDocument | null,
  selectedIds: Iterable<string>,
  routeUsage: PotiRouteUsage,
): Set<number> {
  const forcedRoutes = new Set<number>();
  if (!kmp) return forcedRoutes;
  for (const id of selectedIds) {
    const entity = kmp.entities.find((candidate) => candidate.id === id);
    if (!entity) continue;
    if (entity.section === 'GOBJ' && entity.routeIndex !== undefined && entity.routeIndex !== 0xffff) {
      if (getPotiRouteVisibilityKey(entity.routeIndex, routeUsage) === 'POTI_OBJECT') forcedRoutes.add(entity.routeIndex);
      continue;
    }
    if (entity.section === 'POTI' && entity.routePoint) {
      if (getPotiRouteVisibilityKey(entity.routePoint.routeIndex, routeUsage) === 'POTI_OBJECT') forcedRoutes.add(entity.routePoint.routeIndex);
    }
  }
  return forcedRoutes;
}

function isPotiRouteVisible(
  routeIndex: number,
  routeVisibility: Record<string, boolean>,
  routeUsage: PotiRouteUsage,
  forcedVisibleObjectRoutes?: ReadonlySet<number>,
): boolean {
  if (forcedVisibleObjectRoutes?.has(routeIndex)) return true;
  const objectVisible = routeVisibility.POTI_OBJECT !== false;
  const cameraVisible = routeVisibility.POTI_CAMERA !== false;
  const usedByObject = routeUsage.objectRoutes.has(routeIndex) || routeUsage.unusedRoutes.has(routeIndex);
  const usedByCamera = routeUsage.cameraRoutes.has(routeIndex);
  if (usedByObject && usedByCamera) return objectVisible || cameraVisible;
  if (usedByCamera) return cameraVisible;
  return objectVisible;
}

function collectInvalidEntityIds(track: TrackDocument): Set<string> {
  const invalidIds = new Set<string>();
  if (!track.kmp) return invalidIds;
  const count = (section: string) => track.kmp?.sections.find((candidate) => candidate.name === section)?.count ?? 0;
  const potiCount = track.kmp.routes.length || count('POTI');
  const cameraCount = count('CAME');
  const enemyPointCount = count('ENPT');
  const checkpointCount = count('CKPT');
  const respawnCount = count('JGPT');

  for (const entity of track.kmp.entities) {
    if (entity.checkpoint) {
      if (
        (entity.checkpoint.respawnIndex !== 0xff && entity.checkpoint.respawnIndex >= respawnCount) ||
        (entity.checkpoint.prev !== 0xff && entity.checkpoint.prev >= checkpointCount) ||
        (entity.checkpoint.next !== 0xff && entity.checkpoint.next >= checkpointCount)
      ) {
        invalidIds.add(entity.id);
      }
    }
    if (entity.section === 'GOBJ' && entity.routeIndex !== undefined && entity.routeIndex !== 0xffff && entity.routeIndex >= potiCount) {
      invalidIds.add(entity.id);
    }
    if (entity.area) {
      if (
        (entity.area.routeIndex !== 0xff && entity.area.routeIndex >= potiCount) ||
        (entity.area.cameraIndex !== 0xff && entity.area.cameraIndex >= cameraCount) ||
        (entity.area.enemyIndex !== 0xff && entity.area.enemyIndex >= enemyPointCount)
      ) {
        invalidIds.add(entity.id);
      }
    }
    if (entity.camera) {
      if (
        (entity.camera.routeIndex !== 0xff && entity.camera.routeIndex >= potiCount) ||
        (entity.camera.nextCam !== 0xff && entity.camera.nextCam >= cameraCount)
      ) {
        invalidIds.add(entity.id);
      }
    }
  }

  return invalidIds;
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

function createCenterGizmoDragState(
  entity: KmpEntity,
  tool: TransformTool,
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  viewer: Viewer,
): GizmoDragState | null {
  const planePoint = scaleVec3(entity.position, MKW_RENDER_SCALE);
  const planeNormal = getCameraForward(canvas, viewer);
  const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, planePoint, planeNormal);
  if (!hit) return null;
  if (tool === 'scale' && entity.scale) {
    const startRadius = Math.max(1, Math.hypot(hit.x - planePoint.x, hit.y - planePoint.y, hit.z - planePoint.z));
    return {
      kind: 'gizmo',
      mode: 'uniformScale',
      id: entity.id,
      center: entity.position,
      planeNormal,
      startHit: hit,
      startRadius,
      scale: entity.scale,
    };
  }
  return {
    kind: 'gizmo',
    mode: 'planar',
    id: entity.id,
    position: entity.position,
    planePoint,
    planeNormal,
    startHit: hit,
    rotation: entity.rotation,
    scale: entity.scale,
  };
}

function createPlaneGizmoDragState(
  entity: KmpEntity,
  plane: GizmoPlane,
  tool: TransformTool,
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  viewer: Viewer,
): GizmoDragState | null {
  const planePoint = scaleVec3(entity.position, MKW_RENDER_SCALE);
  const planeNormal = plane === 'xy' ? { x: 0, y: 0, z: 1 } : plane === 'xz' ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, planePoint, planeNormal);
  if (!hit) return null;
  if (tool === 'scale' && entity.scale) {
    const local = {
      x: (hit.x - planePoint.x) / MKW_RENDER_SCALE,
      y: (hit.y - planePoint.y) / MKW_RENDER_SCALE,
      z: (hit.z - planePoint.z) / MKW_RENDER_SCALE,
    };
    return {
      kind: 'gizmo',
      mode: 'planarScale',
      id: entity.id,
      plane,
      center: entity.position,
      planePoint,
      planeNormal,
      startU: plane === 'xy' || plane === 'xz' ? local.x : local.y,
      startV: plane === 'xy' ? local.y : local.z,
      scale: entity.scale,
    };
  }
  return {
    kind: 'gizmo',
    mode: 'planar',
    id: entity.id,
    position: entity.position,
    planePoint,
    planeNormal,
    startHit: hit,
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

function pickScenePointsInRect(
  scene: (SceneGfx & { pickEditorPointsInRect?: (normalizedX0: number, normalizedY0: number, normalizedX1: number, normalizedY1: number) => string[] }) | null,
  marquee: MarqueeSelectionState,
  canvas: HTMLCanvasElement,
): string[] {
  if (!scene?.pickEditorPointsInRect) return [];
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return [];
  const normalizedX0 = clamp01((marquee.startX - rect.left) / rect.width);
  const normalizedY0 = clamp01((marquee.startY - rect.top) / rect.height);
  const normalizedX1 = clamp01((marquee.currentX - rect.left) / rect.width);
  const normalizedY1 = clamp01((marquee.currentY - rect.top) / rect.height);
  return scene.pickEditorPointsInRect(normalizedX0, normalizedY0, normalizedX1, normalizedY1);
}

function getMarqueeStyle(marquee: MarqueeSelectionState, canvas: HTMLCanvasElement | null) {
  const rect = canvas?.getBoundingClientRect();
  const offsetLeft = rect?.left ?? 0;
  const offsetTop = rect?.top ?? 0;
  const left = Math.min(marquee.startX, marquee.currentX) - offsetLeft;
  const top = Math.min(marquee.startY, marquee.currentY) - offsetTop;
  const width = Math.abs(marquee.currentX - marquee.startX);
  const height = Math.abs(marquee.currentY - marquee.startY);
  return {
    left,
    top,
    width,
    height,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pickRadius(entity: KmpEntity): number {
  if (entity.section === 'GOBJ') return Math.max(260, Math.min(1800, Math.max(entity.scale?.x ?? 1, entity.scale?.y ?? 1, entity.scale?.z ?? 1) * 0.65));
  if (entity.section === 'CKPT') return 520;
  if (entity.section === 'AREA') return Math.max(360, Math.min(2000, Math.max(entity.scale?.x ?? 1, entity.scale?.y ?? 1, entity.scale?.z ?? 1) * 0.35));
  return 260;
}

function getGizmoLength(entity: KmpEntity, cameraPosition: Vec3 | null): number {
  const scaleLength = entity.scale ? Math.max(entity.scale.x, entity.scale.y, entity.scale.z) * 1.4 : 0;
  const baseLength = Math.max(250, Math.min(1500, scaleLength || 500));
  if (!cameraPosition) return baseLength;
  const dx = entity.position.x - cameraPosition.x;
  const dy = entity.position.y - cameraPosition.y;
  const dz = entity.position.z - cameraPosition.z;
  const distanceLength = Math.hypot(dx, dy, dz) * 0.14;
  return Math.max(250, Math.min(2600, Math.max(baseLength, distanceLength)));
}

function getViewerCameraPosition(viewer: Viewer | null): Vec3 | null {
  if (!viewer) return null;
  const world = viewer.camera.worldMatrix;
  return {
    x: world[12] / MKW_RENDER_SCALE,
    y: world[13] / MKW_RENDER_SCALE,
    z: world[14] / MKW_RENDER_SCALE,
  };
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

function projectWorldToClient(position: Vec3, canvas: HTMLCanvasElement, viewer: Viewer): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const clip = vec4.transformMat4(
    vec4.create(),
    vec4.fromValues(position.x * MKW_RENDER_SCALE, position.y * MKW_RENDER_SCALE, position.z * MKW_RENDER_SCALE, 1),
    viewer.camera.clipFromWorldMatrix,
  );
  if (!Number.isFinite(clip[3]) || Math.abs(clip[3]) < 0.00001) return null;
  const ndcX = clip[0] / clip[3];
  const ndcY = clip[1] / clip[3];
  if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) return null;
  return {
    x: rect.left + (ndcX * 0.5 + 0.5) * rect.width,
    y: rect.top + (0.5 - ndcY * 0.5) * rect.height,
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

function getCameraSmokeSignature(viewer: Viewer): string {
  const matrix = viewer.camera.worldMatrix;
  return [matrix[0], matrix[1], matrix[2], matrix[4], matrix[5], matrix[6], matrix[8], matrix[9], matrix[10], matrix[12], matrix[13], matrix[14]]
    .map((value) => value.toFixed(4))
    .join(',');
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

function makeLocalDataFetcher(smokeCommonUrl?: string | null): DataFetcher {
  return {
    fetchData: async (path: string) => {
      const url = smokeCommonUrl && path === 'MarioKartWii/Race/Common.szs' ? smokeCommonUrl : `/data/${path}`;
      const response = await fetch(url);
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
