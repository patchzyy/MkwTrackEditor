import { mat4, vec3 } from 'gl-matrix';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { InitErrorCode, initializeViewerWebGL2, resizeCanvas, type SceneGfx, type Viewer } from '../../../vendor/noclip.website/src/viewer';
import { StudioScene } from '../../../vendor/noclip.website/src/MarioKartWii/StudioScene';
import type { SceneMeshEntry } from '../material/materialScene';
import type { StudioMeshPick, StudioRendererScene } from './studioScene';

export interface StudioPixelSample {
  r: number;
  g: number;
  b: number;
  count: number;
}

/**
 * What the studio viewport hands back to its host, once WebGL is up.
 *
 * `capture` and `samplePixels` are promises because the swap chain is created without
 * `preserveDrawingBuffer`: the only moment the canvas holds readable pixels is inside the
 * animation frame that just drew them, so both requests are queued and answered there.
 */
export interface StudioViewportApi {
  /** A PNG data URL of the next drawn frame. */
  capture: () => Promise<string | null>;
  /** Average RGB of a box of pixels, in 0..255. Used by the browser probes. */
  samplePixels: (box?: { x: number; y: number; width: number; height: number }) => Promise<StudioPixelSample | null>;
  frameAll: () => void;
  frameMesh: (mesh: SceneMeshEntry) => void;
  getCamera: () => { target: number[]; distance: number; yaw: number; pitch: number };
  orbit: (deltaYaw: number, deltaPitch: number) => void;
  zoom: (factor: number) => void;
}

export interface StudioViewportProps {
  /** Bumped by the host when the loaded archives changed and the camera should re-frame. */
  frameRequest: number;
  turntable: boolean;
  gridVisible: boolean;
  onSceneChange: (scene: StudioRendererScene | null) => void;
  onReady: (api: StudioViewportApi | null) => void;
  onPickMesh: (pick: StudioMeshPick | null) => void;
  onHoverMesh: (pick: StudioMeshPick | null) => void;
  onStatus: (message: string) => void;
  overlay?: ReactNode;
}

const MIN_PITCH = -1.45;
const MAX_PITCH = 1.45;
const TURNTABLE_RADIANS_PER_SECOND = 0.35;

const scratchEye = vec3.create();
const scratchTarget = vec3.create();
const scratchRight = vec3.create();
const scratchUp = vec3.create();
const worldUp = vec3.fromValues(0, 1, 0);

/**
 * The studio's own viewport: its own canvas, its own noclip `Viewer`, its own `StudioScene`, and
 * an orbit camera that never takes pointer lock.
 *
 * It is deliberately not `Noclip3DViewport`. That component is the track editor's — KMP gizmos,
 * collision, drag-and-drop placement, camera playback, a fly camera with pointer lock — and none
 * of it applies to turning a model around and looking at it. What the two share is everything
 * below the scene: the same renderer, the same `Viewer`, the same `initializeViewerWebGL2`.
 *
 * Camera model, the one every asset viewer uses:
 *
 * | Gesture | Effect |
 * | --- | --- |
 * | Left-drag | Orbit |
 * | Middle- or right-drag, or Shift+left-drag | Pan |
 * | Wheel | Dolly in and out about the model |
 * | `F` | Frame everything (or the selected mesh) |
 * | Click | Select the mesh under the cursor; hovering highlights it |
 */
export function StudioViewport({
  frameRequest,
  turntable,
  gridVisible,
  onSceneChange,
  onReady,
  onPickMesh,
  onHoverMesh,
  onStatus,
  overlay,
}: StudioViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const sceneRef = useRef<StudioScene | null>(null);
  const frameHandleRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Orbit camera state. Kept in a ref because the render loop reads it every frame.
  const cameraRef = useRef({ target: vec3.fromValues(0, 0, 0), distance: 1200, yaw: 0.6, pitch: 0.35 });
  const dragRef = useRef<{ pointerId: number; mode: 'orbit' | 'pan'; x: number; y: number; moved: number } | null>(null);
  const turntableRef = useRef(turntable);
  turntableRef.current = turntable;
  const lastTimeRef = useRef(0);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const hoverKeyRef = useRef<string | null>(null);
  const pickThrottleRef = useRef(0);
  /** Readback requests waiting for the end of the next drawn frame. */
  const readbackRef = useRef<Array<(canvas: HTMLCanvasElement) => void>>([]);

  const onSceneChangeRef = useRef(onSceneChange);
  onSceneChangeRef.current = onSceneChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onPickMeshRef = useRef(onPickMesh);
  onPickMeshRef.current = onPickMesh;
  const onHoverMeshRef = useRef(onHoverMesh);
  onHoverMeshRef.current = onHoverMesh;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  const applyCamera = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const camera = cameraRef.current;
    const cosPitch = Math.cos(camera.pitch);
    vec3.set(
      scratchEye,
      camera.target[0] + camera.distance * cosPitch * Math.sin(camera.yaw),
      camera.target[1] + camera.distance * Math.sin(camera.pitch),
      camera.target[2] + camera.distance * cosPitch * Math.cos(camera.yaw),
    );
    vec3.copy(scratchTarget, camera.target);
    mat4.targetTo(viewer.camera.worldMatrix, scratchEye, scratchTarget, worldUp);
    viewer.camera.worldMatrixUpdated();
  }, []);

  const frameBounds = useCallback(
    (bounds: { center: { x: number; y: number; z: number }; radius: number } | null) => {
      const camera = cameraRef.current;
      if (bounds === null) {
        vec3.set(camera.target, 0, 0, 0);
        camera.distance = 1200;
      } else {
        vec3.set(camera.target, bounds.center.x, bounds.center.y, bounds.center.z);
        // Half the vertical field of view is 30 degrees; a little slack keeps the model off the edges.
        camera.distance = Math.max(20, (bounds.radius / Math.tan(Math.PI / 6)) * 1.25);
      }
      applyCamera();
    },
    [applyCamera],
  );

  const frameAll = useCallback(() => {
    frameBounds(sceneRef.current?.getStudioBounds() ?? null);
  }, [frameBounds]);

  // ------------------------------------------------------------------ boot

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    let cancelled = false;

    const resizeToDisplay = () => {
      const rect = container.getBoundingClientRect();
      resizeCanvas(canvas, Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)), window.devicePixelRatio || 1);
    };

    void (async () => {
      const result = await initializeViewerWebGL2(canvas);
      if (cancelled) return;
      if (result.error !== InitErrorCode.SUCCESS || !result.viewer) {
        setError('WebGL2 is unavailable, so the Model Studio viewport cannot start in this browser.');
        onReadyRef.current(null);
        return;
      }
      const viewer = result.viewer;
      viewerRef.current = viewer;

      const scene = new StudioScene(viewer.gfxDevice);
      sceneRef.current = scene;
      viewer.setScene(scene as unknown as SceneGfx);
      // The studio drives the camera itself; leaving the controller null keeps `Viewer.update`
      // out of it, which is also what stops noclip's fly camera from grabbing the pointer.
      viewer.cameraController = null;

      const observer = new ResizeObserver(() => resizeToDisplay());
      observer.observe(container);
      resizeToDisplay();
      applyCamera();
      onSceneChangeRef.current(scene as unknown as StudioRendererScene);
      const afterNextFrame = <T,>(read: (canvas: HTMLCanvasElement) => T): Promise<T> =>
        new Promise<T>((resolve) => {
          readbackRef.current.push((drawn) => resolve(read(drawn)));
        });

      onReadyRef.current({
        capture: () =>
          afterNextFrame((drawn) => {
            try {
              return drawn.toDataURL('image/png');
            } catch {
              return null;
            }
          }),
        samplePixels: (box) => afterNextFrame((drawn) => samplePixels(drawn, box)),
        frameAll: () => frameBounds(sceneRef.current?.getStudioBounds() ?? null),
        frameMesh: (mesh) => frameBounds(sceneRef.current?.getStudioMeshBounds(mesh) ?? null),
        getCamera: () => ({
          target: [...cameraRef.current.target],
          distance: cameraRef.current.distance,
          yaw: cameraRef.current.yaw,
          pitch: cameraRef.current.pitch,
        }),
        orbit: (deltaYaw, deltaPitch) => {
          cameraRef.current.yaw += deltaYaw;
          cameraRef.current.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, cameraRef.current.pitch + deltaPitch));
          applyCamera();
        },
        zoom: (factor) => {
          cameraRef.current.distance = Math.max(1, cameraRef.current.distance * factor);
          applyCamera();
        },
      });

      const tick = (time: number) => {
        const deltaMs = lastTimeRef.current === 0 ? 0 : time - lastTimeRef.current;
        lastTimeRef.current = time;
        if (turntableRef.current && dragRef.current === null) {
          cameraRef.current.yaw += (deltaMs / 1000) * TURNTABLE_RADIANS_PER_SECOND;
        }
        applyCamera();
        viewer.update({ time, webXRContext: null });
        if (readbackRef.current.length > 0) {
          const pending = readbackRef.current;
          readbackRef.current = [];
          for (const read of pending) read(canvas);
        }
        runHoverPick(time);
        frameHandleRef.current = requestAnimationFrame(tick);
      };
      frameHandleRef.current = requestAnimationFrame(tick);

      return () => observer.disconnect();
    })();

    return () => {
      cancelled = true;
      if (frameHandleRef.current !== null) cancelAnimationFrame(frameHandleRef.current);
      frameHandleRef.current = null;
      const viewer = viewerRef.current;
      const scene = sceneRef.current;
      if (viewer && scene) {
        viewer.setScene(null);
        scene.destroy(viewer.gfxDevice);
      }
      sceneRef.current = null;
      viewerRef.current = null;
      onSceneChangeRef.current(null);
      onReadyRef.current(null);
    };
    // Boot once; every prop the loop reads is behind a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (frameRequest === 0) return;
    frameAll();
  }, [frameAll, frameRequest]);

  useEffect(() => {
    sceneRef.current?.setStudioGridVisible(gridVisible);
  }, [gridVisible]);

  // ------------------------------------------------------------------ picking

  function normalizedFromEvent(clientX: number, clientY: number): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  }

  function runHoverPick(time: number) {
    const point = hoverRef.current;
    const scene = sceneRef.current;
    if (!scene || point === null || dragRef.current !== null) return;
    // Picking walks every triangle, so it runs at most 20 times a second.
    if (time - pickThrottleRef.current < 50) return;
    pickThrottleRef.current = time;
    const pick = scene.pickEditorMesh(point.x, point.y);
    const key = pick === null ? null : `${pick.archivePath}|${pick.modelName}|${pick.drawOpIndex}`;
    if (key === hoverKeyRef.current) return;
    hoverKeyRef.current = key;
    onHoverMeshRef.current(pick as StudioMeshPick | null);
  }

  // ------------------------------------------------------------------ pointer

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    event.preventDefault();
    // Synthetic pointer events (the browser probe) have no real pointer to capture.
    try {
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      // Not capturable; dragging still works through the element's own listeners.
    }
    const pan = event.button === 1 || event.button === 2 || event.shiftKey;
    dragRef.current = { pointerId: event.pointerId, mode: pan ? 'pan' : 'orbit', x: event.clientX, y: event.clientY, moved: 0 };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      hoverRef.current = normalizedFromEvent(event.clientX, event.clientY);
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);

    const camera = cameraRef.current;
    if (drag.mode === 'orbit') {
      camera.yaw -= dx * 0.008;
      camera.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, camera.pitch + dy * 0.008));
    } else {
      // Pan in the camera's own plane, scaled by distance so the model tracks the cursor.
      const viewer = viewerRef.current;
      if (viewer) {
        const world = viewer.camera.worldMatrix;
        vec3.set(scratchRight, world[0], world[1], world[2]);
        vec3.set(scratchUp, world[4], world[5], world[6]);
        const canvas = canvasRef.current;
        const height = canvas ? canvas.clientHeight || 1 : 1;
        const scale = (camera.distance * 2 * Math.tan(Math.PI / 6)) / height;
        vec3.scaleAndAdd(camera.target, camera.target, scratchRight, -dx * scale);
        vec3.scaleAndAdd(camera.target, camera.target, scratchUp, dy * scale);
      }
    }
    applyCamera();
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    } catch {
      // See `handlePointerDown`.
    }
    if (drag.mode !== 'orbit' || drag.moved > 6 || event.button !== 0) return;
    const point = normalizedFromEvent(event.clientX, event.clientY);
    const scene = sceneRef.current;
    if (!point || !scene) return;
    onPickMeshRef.current(scene.pickEditorMesh(point.x, point.y) as StudioMeshPick | null);
  }

  function handleWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    const camera = cameraRef.current;
    const factor = Math.exp(event.deltaY * 0.0012);
    camera.distance = Math.max(1, Math.min(5_000_000, camera.distance * factor));
    applyCamera();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      frameAll();
      onStatusRef.current('Framed the model.');
    }
  }

  return (
    <div ref={containerRef} className="studioViewport" tabIndex={0} onKeyDown={handleKeyDown}>
      <canvas
        ref={canvasRef}
        className="studioCanvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => {
          hoverRef.current = null;
          if (hoverKeyRef.current !== null) {
            hoverKeyRef.current = null;
            onHoverMeshRef.current(null);
          }
        }}
        onWheel={handleWheel}
        onContextMenu={(event) => event.preventDefault()}
      />
      {error && <div className="studioViewportError">{error}</div>}
      {overlay}
    </div>
  );
}

/**
 * Average colour of a box of the canvas, read back through a 2D context. Only the browser probes
 * use it, but it lives here because it needs the canvas element.
 */
function samplePixels(
  canvas: HTMLCanvasElement,
  box?: { x: number; y: number; width: number; height: number },
): { r: number; g: number; b: number; count: number } | null {
  const width = box?.width ?? Math.max(1, Math.floor(canvas.width / 2));
  const height = box?.height ?? Math.max(1, Math.floor(canvas.height / 2));
  const x = box?.x ?? Math.floor((canvas.width - width) / 2);
  const y = box?.y ?? Math.floor((canvas.height - height) / 2);
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const context = scratch.getContext('2d');
  if (!context) return null;
  try {
    context.drawImage(canvas, x, y, width, height, 0, 0, width, height);
  } catch {
    return null;
  }
  const data = context.getImageData(0, 0, width, height).data;
  let r = 0;
  let g = 0;
  let b = 0;
  const count = width * height;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return { r: r / count, g: g / count, b: b / count, count };
}
