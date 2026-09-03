/**
 * The playtest camera controller.
 *
 * Two sources of pose, in order of preference:
 *
 *  1. `runtime.readCameraState()` — Kinoko's own `Render::KartCamera`, when the build exposes it.
 *  2. the TS chase camera in `playtestChaseCamera.ts` — behind the kart along its forward axis,
 *     above it, looking at a point ahead, smoothed, with extra distance at speed.
 *
 * Like `PreviewCameraController` in the viewport it ignores the input manager entirely, so the
 * editor's fly controls cannot fight the race camera. The viewport writes the pose every
 * animation frame and restores the previous controller when the session ends.
 */

import { mat4, vec3 } from 'gl-matrix';
import { CameraUpdateResult, type Camera, type CameraController } from '../../../vendor/noclip.website/src/Camera';
import type { PlaytestCameraState, PlaytestVec3 } from '../../lib/playtest/types';
import {
  DEFAULT_CHASE_CAMERA_PARAMS,
  createChaseCameraState,
  stepChaseCamera,
  type ChaseCameraKart,
  type ChaseCameraParams,
} from './playtestChaseCamera';

const CAMERA_WORLD_UP = vec3.fromValues(0, 1, 0);
/** The MKWii scene renders at 0.1x game units. */
const PLAYTEST_SCENE_SCALE = 0.1;
const DEFAULT_FOV_Y_DEGREES = 60;

export class PlaytestCameraController implements CameraController {
  public camera!: Camera;
  public forceUpdate = false;
  /** Viewport aspect ratio, refreshed by the viewport before each frame. */
  public aspect = 16 / 9;
  public params: ChaseCameraParams = { ...DEFAULT_CHASE_CAMERA_PARAMS };
  public readonly chase = createChaseCameraState();
  private dirty = true;
  private readonly scratchEye = vec3.create();
  private readonly scratchTarget = vec3.create();

  /** Follows the kart with the TS chase camera. `frames` is real elapsed time in 60 Hz frames. */
  public followKart(kart: ChaseCameraKart, frames: number): void {
    stepChaseCamera(this.chase, kart, this.params, frames);
    this.look(this.chase.position, this.chase.target, DEFAULT_FOV_Y_DEGREES);
  }

  /** Uses the pose the runtime computed instead, keeping the chase state ready as a fallback. */
  public applyRuntimeCamera(state: PlaytestCameraState): void {
    this.chase.position.x = state.position.x;
    this.chase.position.y = state.position.y;
    this.chase.position.z = state.position.z;
    this.chase.target.x = state.target.x;
    this.chase.target.y = state.target.y;
    this.chase.target.z = state.target.z;
    this.chase.initialized = true;
    this.look(state.position, state.target, state.fovY);
  }

  private look(position: PlaytestVec3, target: PlaytestVec3, fovYDegrees: number): void {
    const camera = this.camera;
    if (!camera) return;
    vec3.set(this.scratchEye, position.x * PLAYTEST_SCENE_SCALE, position.y * PLAYTEST_SCENE_SCALE, position.z * PLAYTEST_SCENE_SCALE);
    vec3.set(this.scratchTarget, target.x * PLAYTEST_SCENE_SCALE, target.y * PLAYTEST_SCENE_SCALE, target.z * PLAYTEST_SCENE_SCALE);
    // `mat4.targetTo` degenerates when the eye and the target coincide.
    if (vec3.squaredDistance(this.scratchEye, this.scratchTarget) < 1e-8) this.scratchTarget[2] += 1;
    mat4.targetTo(camera.worldMatrix, this.scratchEye, this.scratchTarget, CAMERA_WORLD_UP);
    vec3.zero(camera.linearVelocity);
    const fovY = (Math.max(1, Math.min(179, fovYDegrees)) * Math.PI) / 180;
    camera.setPerspective(fovY, this.aspect, 4, 500000);
    camera.worldMatrixUpdated();
    this.dirty = true;
    this.forceUpdate = true;
  }

  public cameraUpdateForced(): void {
    this.dirty = true;
  }

  public update(): CameraUpdateResult {
    if (!this.dirty) return CameraUpdateResult.Unchanged;
    this.dirty = false;
    return CameraUpdateResult.Changed;
  }

  public setSceneMoveSpeedMult(): void {
  }

  public getKeyMoveSpeed(): number | null {
    return null;
  }

  public setKeyMoveSpeed(): void {
  }
}
