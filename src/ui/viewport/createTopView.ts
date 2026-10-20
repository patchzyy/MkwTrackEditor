/**
 * The camera controller behind `CreateCameraApi.setTopView(true)`: a top-down orthographic view,
 * north-up (screen up is world -Z, screen right is +X), for planning a track.
 *
 * It is a plain `CameraController` that ignores noclip's `InputManager` completely. The viewport
 * feeds it explicitly: right/middle (and unconsumed left) drags call `panPixels`, the wheel calls
 * `zoomAtPixel`, and `frameBounds` glides the view onto a box. Everything is in scene units
 * (game units * 0.1).
 */

import { mat4, vec3 } from 'gl-matrix';
import { CameraUpdateResult, type Camera, type CameraController } from '../../../vendor/noclip.website/src/Camera';

/** Half the visible height in scene units, never smaller / larger than this. */
const MIN_HALF_HEIGHT = 4;
const MAX_HALF_HEIGHT = 60000;
/** Eye height above the focus point. The projection is orthographic, so this is only a depth range. */
const EYE_HEIGHT = 250000;
const WHEEL_ZOOM_STEP = 1.14;
/** Time constant, in ms, of the glide towards a framed target. */
const GLIDE_MS = 90;

const scratchEye = vec3.create();
const scratchTarget = vec3.create();
const worldUp = vec3.fromValues(0, 0, -1);

export class CreateTopViewController implements CameraController {
  public camera!: Camera;
  public forceUpdate = true;

  /** Where the view is looking, scene units. */
  public centerX = 0;
  public centerZ = 0;
  /** Half of the visible height, scene units. */
  public halfHeight = 400;

  private targetX = 0;
  private targetZ = 0;
  private targetHalfHeight = 400;
  private gliding = false;
  private lastTimeMs: number | null = null;
  private lastAspect = 0;

  public cameraUpdateForced(): void {
    this.forceUpdate = true;
  }

  public setSceneMoveSpeedMult(): void {
  }

  public getKeyMoveSpeed(): number | null {
    return null;
  }

  public setKeyMoveSpeed(): void {
  }

  /** Jumps to a view without gliding. */
  public setView(centerX: number, centerZ: number, halfHeight: number): void {
    this.centerX = this.targetX = centerX;
    this.centerZ = this.targetZ = centerZ;
    this.halfHeight = this.targetHalfHeight = clampHalfHeight(halfHeight);
    this.gliding = false;
    this.forceUpdate = true;
  }

  /**
   * Fits an axis-aligned box (scene units, x/z only) with a margin. `aspect` is width / height of
   * the canvas. Glides there unless `immediate`.
   */
  public frameBox(minX: number, minZ: number, maxX: number, maxZ: number, aspect: number, immediate: boolean, margin = 1.12): void {
    const halfX = Math.max((maxX - minX) * 0.5, 1);
    const halfZ = Math.max((maxZ - minZ) * 0.5, 1);
    const halfHeight = clampHalfHeight(Math.max(halfZ, halfX / Math.max(aspect, 0.1)) * margin);
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    if (immediate) {
      this.setView(cx, cz, halfHeight);
      return;
    }
    this.targetX = cx;
    this.targetZ = cz;
    this.targetHalfHeight = halfHeight;
    this.gliding = true;
    this.forceUpdate = true;
  }

  /** True while the view is still gliding onto a framed box. */
  public get isGliding(): boolean {
    return this.gliding;
  }

  /** Scene units per CSS pixel of canvas height. */
  public unitsPerPixel(canvasHeightPx: number): number {
    return (this.halfHeight * 2) / Math.max(canvasHeightPx, 1);
  }

  /** Drags the world with the pointer: content follows the mouse. */
  public panPixels(dx: number, dy: number, canvasHeightPx: number): void {
    const upp = this.unitsPerPixel(canvasHeightPx);
    this.centerX -= dx * upp;
    this.centerZ -= dy * upp;
    this.targetX = this.centerX;
    this.targetZ = this.centerZ;
    this.targetHalfHeight = this.halfHeight;
    this.gliding = false;
    this.forceUpdate = true;
  }

  /**
   * One wheel notch (`steps` > 0 zooms out) about a canvas point, so the world point under the
   * cursor stays under it. `px`/`py` are CSS pixels relative to the canvas.
   */
  public zoomAtPixel(steps: number, px: number, py: number, canvasWidthPx: number, canvasHeightPx: number): void {
    const before = this.halfHeight;
    const after = clampHalfHeight(before * Math.pow(WHEEL_ZOOM_STEP, steps));
    if (after === before) return;
    const aspect = canvasWidthPx / Math.max(canvasHeightPx, 1);
    // Offset of the cursor from the centre in NDC, converted to scene units at each zoom level.
    const nx = (px / Math.max(canvasWidthPx, 1)) * 2 - 1;
    const ny = (py / Math.max(canvasHeightPx, 1)) * 2 - 1;
    // Screen right is +X; screen down is +Z.
    this.centerX += nx * aspect * (before - after);
    this.centerZ += ny * (before - after);
    this.halfHeight = after;
    this.targetX = this.centerX;
    this.targetZ = this.centerZ;
    this.targetHalfHeight = after;
    this.gliding = false;
    this.forceUpdate = true;
  }

  public update(_inputManager: unknown, _dt: number): CameraUpdateResult {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsed = this.lastTimeMs === null ? 16 : Math.min(now - this.lastTimeMs, 100);
    this.lastTimeMs = now;

    // A resize changes the aspect without any input; the projection has to follow it.
    let moved = this.forceUpdate || this.lastAspect !== this.camera.aspect;
    this.lastAspect = this.camera.aspect;
    if (this.gliding) {
      const k = 1 - Math.exp(-elapsed / GLIDE_MS);
      this.centerX += (this.targetX - this.centerX) * k;
      this.centerZ += (this.targetZ - this.centerZ) * k;
      this.halfHeight += (this.targetHalfHeight - this.halfHeight) * k;
      const done = Math.abs(this.targetX - this.centerX) < this.halfHeight * 1e-4
        && Math.abs(this.targetZ - this.centerZ) < this.halfHeight * 1e-4
        && Math.abs(this.targetHalfHeight - this.halfHeight) < this.halfHeight * 1e-4;
      if (done) {
        this.centerX = this.targetX;
        this.centerZ = this.targetZ;
        this.halfHeight = this.targetHalfHeight;
        this.gliding = false;
      }
      moved = true;
    }
    if (!moved) return CameraUpdateResult.Unchanged;
    this.forceUpdate = false;

    const camera = this.camera;
    vec3.set(scratchEye, this.centerX, EYE_HEIGHT * 0.5, this.centerZ);
    vec3.set(scratchTarget, this.centerX, 0, this.centerZ);
    mat4.targetTo(camera.worldMatrix, scratchEye, scratchTarget, worldUp);
    camera.setOrthographic(this.halfHeight, camera.aspect, -EYE_HEIGHT * 2, EYE_HEIGHT * 2);
    camera.worldMatrixUpdated();
    return CameraUpdateResult.Changed;
  }
}

function clampHalfHeight(value: number): number {
  return Math.min(MAX_HALF_HEIGHT, Math.max(MIN_HALF_HEIGHT, value));
}
