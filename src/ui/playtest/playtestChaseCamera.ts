/**
 * The chase-camera maths, in game units.
 *
 * Split out of `playtestCamera.ts` on purpose: that file imports the vendored noclip `Camera`
 * module, which touches `window` at import time and so cannot be loaded from a node test. This
 * file is pure arithmetic and has its own unit tests.
 */

import type { PlaytestKartState, PlaytestQuat, PlaytestVec3 } from '../../lib/playtest/types';

export interface ChaseCameraParams {
  /** Distance behind the kart at a standstill, in game units. */
  distance: number;
  /** Height above the kart's origin. */
  height: number;
  /** How far ahead of the kart the camera looks. */
  targetAhead: number;
  /** Height of the look-at point above the kart's origin. */
  targetHeight: number;
  /** Extra distance at full speed, blended in by `speed / speedReference`. */
  speedDistance: number;
  /** Speed (units per frame) at which `speedDistance` is fully applied. */
  speedReference: number;
  /** Fraction of the remaining gap closed per 60 Hz frame. 1 disables smoothing. */
  positionSmoothing: number;
  targetSmoothing: number;
}

/** Tuned against the bundled dummy kart so it fills roughly as much of the frame as in-game. */
export const DEFAULT_CHASE_CAMERA_PARAMS: Readonly<ChaseCameraParams> = Object.freeze({
  distance: 480,
  height: 185,
  targetAhead: 600,
  targetHeight: 70,
  speedDistance: 170,
  speedReference: 16,
  positionSmoothing: 0.22,
  targetSmoothing: 0.3,
});

export interface ChaseCameraState {
  position: PlaytestVec3;
  target: PlaytestVec3;
  /** False until the first step, which snaps instead of easing in from the origin. */
  initialized: boolean;
}

export function createChaseCameraState(): ChaseCameraState {
  return { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, initialized: false };
}

/** Rotates `v` by the unit quaternion `q`. */
export function rotateByQuat(q: PlaytestQuat, v: PlaytestVec3): PlaytestVec3 {
  // t = 2 * (q.xyz x v); v' = v + q.w * t + q.xyz x t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** The kart's forward axis. Mario Kart Wii karts face local +Z, the same way a KMP rotation does. */
export function kartForward(rotation: PlaytestQuat): PlaytestVec3 {
  return rotateByQuat(rotation, { x: 0, y: 0, z: 1 });
}

export type ChaseCameraKart = Pick<PlaytestKartState, 'position' | 'mainRotation' | 'speed'>;

/** Where the camera would sit and look with no smoothing at all. */
export function chaseCameraGoal(
  kart: ChaseCameraKart,
  params: ChaseCameraParams = DEFAULT_CHASE_CAMERA_PARAMS,
): { position: PlaytestVec3; target: PlaytestVec3 } {
  const forward = kartForward(kart.mainRotation);
  // Flattened: the camera stays level even when the kart is pitched, which reads far better
  // than a camera that dives into the road on a downhill.
  const flatLength = Math.hypot(forward.x, forward.z);
  const fx = flatLength > 1e-5 ? forward.x / flatLength : 0;
  const fz = flatLength > 1e-5 ? forward.z / flatLength : 1;
  const speedBlend = Math.min(1, Math.max(0, Math.abs(kart.speed) / Math.max(1e-5, params.speedReference)));
  const distance = params.distance + params.speedDistance * speedBlend;
  return {
    position: {
      x: kart.position.x - fx * distance,
      y: kart.position.y + params.height,
      z: kart.position.z - fz * distance,
    },
    target: {
      x: kart.position.x + fx * params.targetAhead,
      y: kart.position.y + params.targetHeight,
      z: kart.position.z + fz * params.targetAhead,
    },
  };
}

/**
 * Converts a per-frame smoothing factor into the factor for `frames` frames, so the camera eases
 * at the same rate whether the display runs at 30, 60 or 144 Hz.
 */
export function smoothingForFrames(perFrame: number, frames: number): number {
  const clamped = Math.min(1, Math.max(0, perFrame));
  if (clamped >= 1) return 1;
  if (!(frames > 0)) return 0;
  return 1 - Math.pow(1 - clamped, frames);
}

function ease(current: number, goal: number, alpha: number): number {
  return current + (goal - current) * alpha;
}

/**
 * Advances the chase camera by `frames` 60 Hz frames. Mutates and returns `state`, so one object
 * can serve the whole session.
 */
export function stepChaseCamera(
  state: ChaseCameraState,
  kart: ChaseCameraKart,
  params: ChaseCameraParams = DEFAULT_CHASE_CAMERA_PARAMS,
  frames = 1,
): ChaseCameraState {
  const goal = chaseCameraGoal(kart, params);
  if (!state.initialized) {
    state.position.x = goal.position.x;
    state.position.y = goal.position.y;
    state.position.z = goal.position.z;
    state.target.x = goal.target.x;
    state.target.y = goal.target.y;
    state.target.z = goal.target.z;
    state.initialized = true;
    return state;
  }
  const positionAlpha = smoothingForFrames(params.positionSmoothing, frames);
  const targetAlpha = smoothingForFrames(params.targetSmoothing, frames);
  state.position.x = ease(state.position.x, goal.position.x, positionAlpha);
  state.position.y = ease(state.position.y, goal.position.y, positionAlpha);
  state.position.z = ease(state.position.z, goal.position.z, positionAlpha);
  state.target.x = ease(state.target.x, goal.target.x, targetAlpha);
  state.target.y = ease(state.target.y, goal.target.y, targetAlpha);
  state.target.z = ease(state.target.z, goal.target.z, targetAlpha);
  return state;
}
