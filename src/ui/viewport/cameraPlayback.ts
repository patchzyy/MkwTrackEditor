// Drives the viewport camera from a CAME pose during preview playback.

import { mat4, vec3 } from 'gl-matrix';
import type { CameraPose } from '../../lib/cameraPreview';

export const MKW_FRAMES_PER_SECOND = 60;

const scratchEye = vec3.create();
const scratchTarget = vec3.create();
const scratchUp = vec3.create();
const scratchForward = vec3.create();
const scratchRight = vec3.create();
const WORLD_UP = vec3.fromValues(0, 1, 0);

/**
 * Builds the camera-to-world matrix for a CAME pose.
 * `sceneScale` converts KMP/game units into scene units (0.1 for MKW).
 */
export function computePreviewCameraMatrix(dst: mat4, pose: CameraPose, sceneScale: number): mat4 {
  vec3.set(scratchEye, pose.position.x * sceneScale, pose.position.y * sceneScale, pose.position.z * sceneScale);
  vec3.set(scratchTarget, pose.target.x * sceneScale, pose.target.y * sceneScale, pose.target.z * sceneScale);

  vec3.sub(scratchForward, scratchTarget, scratchEye);
  if (vec3.squaredLength(scratchForward) < 1e-9) {
    vec3.set(scratchForward, 0, 0, 1);
    vec3.add(scratchTarget, scratchEye, scratchForward);
  }
  vec3.normalize(scratchForward, scratchForward);

  vec3.copy(scratchUp, WORLD_UP);
  // Guard against a straight-up / straight-down view axis.
  if (Math.abs(vec3.dot(scratchForward, WORLD_UP)) > 0.9999) vec3.set(scratchUp, 0, 0, 1);

  const roll = pose.roll ?? 0;
  if (Math.abs(roll) > 1e-4) {
    vec3.cross(scratchRight, scratchForward, scratchUp);
    if (vec3.squaredLength(scratchRight) < 1e-9) vec3.set(scratchRight, 1, 0, 0);
    vec3.normalize(scratchRight, scratchRight);
    vec3.cross(scratchUp, scratchRight, scratchForward);
    vec3.normalize(scratchUp, scratchUp);
    const radians = (roll * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    vec3.set(
      scratchUp,
      scratchUp[0] * cos + scratchRight[0] * sin,
      scratchUp[1] * cos + scratchRight[1] * sin,
      scratchUp[2] * cos + scratchRight[2] * sin,
    );
  }

  mat4.targetTo(dst, scratchEye, scratchTarget, scratchUp);
  return dst;
}

/** Vertical field of view in radians, clamped to something a projection matrix accepts. */
export function toCameraFovY(fovDegrees: number): number {
  return (Math.max(1, Math.min(179, fovDegrees)) * Math.PI) / 180;
}

/** Advances the preview clock. `deltaMs` is real time; the result is in MKW frames. */
export function advancePreviewFrames(currentFrames: number, deltaMs: number): number {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return currentFrames;
  // Cap the step so a stalled tab does not jump the whole pan.
  const clampedMs = Math.min(deltaMs, 250);
  return currentFrames + (clampedMs / 1000) * MKW_FRAMES_PER_SECOND;
}
