import { mat4, vec3, type ReadonlyVec3 } from 'gl-matrix';
import { CameraUpdateResult, FPSCameraController } from '../../../vendor/noclip.website/src/Camera';
import type InputManager from '../../../vendor/noclip.website/src/InputManager';

export type NavigationPreset = 'editor' | 'blender27' | 'blender';
const STORAGE_KEY = 'mkw.viewport.navigation';

export function readNavigationPreset(): NavigationPreset {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === 'blender27' || value === 'blender') return value;
  } catch { /* Storage may be unavailable. */ }
  return 'editor';
}

export function saveNavigationPreset(value: NavigationPreset): void {
  try { window.localStorage.setItem(STORAGE_KEY, value); } catch { /* Keep the session setting. */ }
}

/** Blender's turntable navigation in the track's Y-up coordinate system. */
export class BlenderCameraController extends FPSCameraController {
  public pivot = vec3.create();
  public distance = 1000;
  public yaw = 0;
  public pitch = 0;
  public orthographic = false;
  private readonly eye = vec3.create();
  private readonly up = vec3.create();

  public setFrame(eye: ReadonlyVec3, target: ReadonlyVec3): void {
    vec3.copy(this.pivot, target);
    const offset = vec3.subtract(vec3.create(), eye, target);
    this.distance = Math.max(1, vec3.length(offset));
    this.yaw = Math.atan2(offset[0], offset[2]);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, offset[1] / this.distance)));
  }

  public override cameraUpdateForced(): void {
    super.cameraUpdateForced();
    if (!this.camera) return;
    const m = this.camera.worldMatrix;
    this.setFrame([m[12], m[13], m[14]], [
      m[12] - m[8] * this.distance,
      m[13] - m[9] * this.distance,
      m[14] - m[10] * this.distance,
    ]);
  }

  public orbit(dx: number, dy: number): void {
    this.yaw -= dx / 200;
    this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch + dy / 200));
  }

  public pan(dx: number, dy: number, height: number): void {
    const scale = 2 * this.distance * Math.tan(Math.PI / 6) / Math.max(1, height);
    const m = this.camera.worldMatrix;
    for (let i = 0; i < 3; i++) this.pivot[i] += (-dx * m[i] + dy * m[4 + i]) * scale;
  }

  public zoom(steps: number): void {
    this.distance = Math.max(1, Math.min(1e7, this.distance * Math.exp(steps * 0.12)));
  }

  public axisView(axis: 'front' | 'right' | 'top', opposite: boolean): void {
    this.orthographic = true;
    this.yaw = axis === 'right' ? Math.PI / 2 : 0;
    this.pitch = axis === 'top' ? Math.PI / 2 : 0;
    if (opposite) {
      if (axis === 'top') this.pitch = -this.pitch;
      else this.yaw += Math.PI;
    }
  }

  public override update(_input: InputManager, _dt: number): CameraUpdateResult {
    const cos = Math.cos(this.pitch);
    vec3.set(this.eye,
      this.pivot[0] + this.distance * Math.sin(this.yaw) * cos,
      this.pivot[1] + this.distance * Math.sin(this.pitch),
      this.pivot[2] + this.distance * Math.cos(this.yaw) * cos,
    );
    // The spherical tangent is stable even at an exact top/bottom view.
    vec3.set(this.up, -Math.sin(this.yaw) * Math.sin(this.pitch), cos, -Math.cos(this.yaw) * Math.sin(this.pitch));
    mat4.targetTo(this.camera.worldMatrix, this.eye, this.pivot, this.up);
    if (this.orthographic) this.camera.setOrthographic(this.distance * Math.tan(Math.PI / 6), this.camera.aspect, -500000, 500000);
    else this.camera.setPerspective(Math.PI / 3, this.camera.aspect, 4, 500000);
    this.camera.worldMatrixUpdated();
    return CameraUpdateResult.Changed;
  }
}
