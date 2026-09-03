// Pure CAME (KMP camera) semantics: type metadata, pose interpolation and the
// opening-camera chain.
//
// Reference: https://wiki.tockdom.com/wiki/KMP_Editing/Cameras and
// https://wiki.tockdom.com/wiki/KMP_(File_Format)#CAME, cross-checked against
// Lorenzi's KMP editor (src/viewer/viewerCameras.js).
//
// Units, straight from the wiki:
//   * `time` is in frames (the game runs at 60 fps).
//   * CAME `vCam` / `vZoom` / `vView` are "units per 100 frames".
//   * POTI route point speeds are "units per frame".

import type { Vec3 } from './kmp';

export type CameraTypeId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface CameraTypeInfo {
  id: number;
  /** Internal name, as used by Lorenzi's editor and the wiki. */
  name: string;
  /** Friendly label for the UI. */
  label: string;
  /** 'opening' cameras play before the race, 'replay' after it. */
  usage: 'opening' | 'replay' | 'goal' | 'unused';
  /** Whether the camera position follows a POTI route. */
  routed: boolean;
  /** Gizmo colour, linear RGB 0..1. */
  color: [number, number, number];
  description: string;
}

export const CAMERA_TYPES: CameraTypeInfo[] = [
  { id: 0, name: 'Goal', label: 'Goal', usage: 'goal', routed: false, color: [1.0, 0.84, 0.25], description: 'Default replay camera; follows and looks at the player from the view start offset.' },
  { id: 1, name: 'FixSearch', label: 'Fixed, tracks player', usage: 'replay', routed: false, color: [0.35, 0.85, 1.0], description: 'Stays at the view start position and always looks at the player.' },
  { id: 2, name: 'PathSearch', label: 'On route, tracks player', usage: 'replay', routed: true, color: [0.25, 0.72, 0.95], description: 'Moves along its route and always looks at the player.' },
  { id: 3, name: 'KartFollow', label: 'Follows the kart', usage: 'replay', routed: false, color: [0.45, 0.95, 0.6], description: 'View start is a position relative to the player; follows and looks at the player.' },
  { id: 4, name: 'KartPathFollow', label: 'Fixed pan', usage: 'opening', routed: false, color: [1.0, 0.62, 0.35], description: 'From its position, looks at view start and pans to view end.' },
  { id: 5, name: 'OP_FixMoveAt', label: 'Opening pan (fixed)', usage: 'opening', routed: true, color: [1.0, 0.45, 0.72], description: 'Opening camera. Looks at view start and pans to view end; follows a route when one is set.' },
  { id: 6, name: 'OP_PathMoveAt', label: 'Opening pan (route)', usage: 'opening', routed: true, color: [0.86, 0.4, 1.0], description: 'Opening camera that travels along its route while panning from view start to view end.' },
  { id: 7, name: 'MiniGame', label: 'Mini game', usage: 'unused', routed: false, color: [0.7, 0.7, 0.75], description: 'Unused by the retail game.' },
  { id: 8, name: 'MissionSuccess', label: 'Mission success', usage: 'unused', routed: false, color: [0.7, 0.7, 0.75], description: 'Unused by the retail game.' },
  { id: 9, name: 'Unknown', label: 'Unknown', usage: 'unused', routed: false, color: [0.6, 0.6, 0.66], description: 'Unknown / unused.' },
];

const UNKNOWN_CAMERA_TYPE: CameraTypeInfo = {
  id: -1,
  name: 'Unknown',
  label: 'Unknown',
  usage: 'unused',
  routed: false,
  color: [0.6, 0.6, 0.66],
  description: 'Unrecognised camera type.',
};

export function getCameraTypeInfo(type: number): CameraTypeInfo {
  return CAMERA_TYPES[type] ?? UNKNOWN_CAMERA_TYPE;
}

export function isOpeningCameraType(type: number): boolean {
  return type === 4 || type === 5 || type === 6;
}

export const NO_CAMERA_LINK = 0xff;

export interface CameraRoutePoint {
  position: Vec3;
  /** POTI point setting 1: speed in units per frame. */
  speed: number;
}

export interface CameraPreviewDef {
  /** CAME entry index. */
  index: number;
  /** Stable entity id, so callers can map back to their document. */
  id?: string;
  type: number;
  nextCam: number;
  routeIndex: number;
  /** Camera point speed, units per 100 frames. */
  vCam: number;
  /** Zoom speed, units per 100 frames. */
  vZoom: number;
  /** View point speed, units per 100 frames. */
  vView: number;
  /** Field of view in degrees at t = 0. */
  zoomStart: number;
  /** Target field of view in degrees. */
  zoomEnd: number;
  /** Duration in frames. */
  time: number;
  position: Vec3;
  rotation: Vec3;
  viewStart: Vec3;
  viewEnd: Vec3;
  /** Resolved POTI route points, when `routeIndex` is set. */
  route?: CameraRoutePoint[] | null;
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  /** Vertical field of view in degrees. */
  fovDegrees: number;
  /** Roll around the view axis, in degrees (CAME rotation Z). */
  roll: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** Total length of a POTI polyline. */
export function getRouteLength(points: readonly CameraRoutePoint[]): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) total += distance(points[i].position, points[i + 1].position);
  return total;
}

/** Position at `distanceAlong` units from the first route point (clamped at both ends). */
export function samplePolylineByDistance(points: readonly CameraRoutePoint[], distanceAlong: number): Vec3 {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  if (points.length === 1 || distanceAlong <= 0) return { ...points[0].position };
  let remaining = distanceAlong;
  for (let i = 0; i + 1 < points.length; i++) {
    const segment = distance(points[i].position, points[i + 1].position);
    if (segment <= 1e-6) continue;
    if (remaining <= segment) return lerpVec3(points[i].position, points[i + 1].position, remaining / segment);
    remaining -= segment;
  }
  return { ...points[points.length - 1].position };
}

/**
 * Distance travelled along a route after `frames`, using the per-point speeds
 * (units per frame). Point `i`'s speed drives the segment from `i` to `i + 1`.
 * A speed of 0 falls back to `fallbackSpeed`.
 */
export function getRouteDistanceAtFrame(points: readonly CameraRoutePoint[], frames: number, fallbackSpeed = 0): number {
  if (points.length < 2 || frames <= 0) return 0;
  let remainingFrames = frames;
  let travelled = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const segment = distance(points[i].position, points[i + 1].position);
    const speed = points[i].speed > 0 ? points[i].speed : fallbackSpeed;
    if (speed <= 0) return travelled;
    const segmentFrames = segment / speed;
    if (remainingFrames <= segmentFrames) return travelled + remainingFrames * speed;
    remainingFrames -= segmentFrames;
    travelled += segment;
  }
  return travelled;
}

/** Number of frames a camera needs to travel its whole route. */
export function getRouteTravelFrames(points: readonly CameraRoutePoint[], fallbackSpeed = 0): number {
  let frames = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const segment = distance(points[i].position, points[i + 1].position);
    const speed = points[i].speed > 0 ? points[i].speed : fallbackSpeed;
    if (speed <= 0) return Number.POSITIVE_INFINITY;
    frames += segment / speed;
  }
  return frames;
}

/** Camera position at `frames`. Routed cameras travel the route, others stay put. */
export function sampleCameraPosition(def: CameraPreviewDef, frames: number): Vec3 {
  const route = def.route;
  if (route && route.length > 1) {
    const travelled = getRouteDistanceAtFrame(route, Math.max(0, frames), def.vCam / 100);
    return samplePolylineByDistance(route, travelled);
  }
  if (route && route.length === 1) return { ...route[0].position };
  return { ...def.position };
}

/**
 * View point at `frames`: it starts at `viewStart` and slides to `viewEnd`
 * at `vView / 100` units per frame, then stops.
 */
export function sampleCameraViewPoint(def: CameraPreviewDef, frames: number): Vec3 {
  const span = distance(def.viewStart, def.viewEnd);
  if (span <= 1e-6) return { ...def.viewStart };
  const speed = def.vView / 100;
  if (speed <= 0) return { ...def.viewStart };
  const travelled = Math.min(span, Math.max(0, frames) * speed);
  return lerpVec3(def.viewStart, def.viewEnd, travelled / span);
}

/**
 * Field of view at `frames`: moves from `zoomStart` toward `zoomEnd`
 * at `vZoom / 100` degrees per frame, then stops.
 */
export function sampleCameraZoom(def: CameraPreviewDef, frames: number): number {
  const span = def.zoomEnd - def.zoomStart;
  if (Math.abs(span) <= 1e-6) return def.zoomStart;
  const speed = def.vZoom / 100;
  if (speed <= 0) return def.zoomStart;
  const travelled = Math.min(Math.abs(span), Math.max(0, frames) * speed);
  return def.zoomStart + Math.sign(span) * travelled;
}

/**
 * Full pose for a camera at `frames`.
 *
 * Types 4/5/6 are the opening pans and are fully previewable. Types 0/1/2/3 track
 * the player at runtime, so the preview shows their static pose looking at the view
 * start point (a route-driven type 2 still walks its route).
 */
export function sampleCameraPose(def: CameraPreviewDef, frames: number): CameraPose {
  const position = sampleCameraPosition(def, frames);
  const target = isOpeningCameraType(def.type) || def.type === 2 || def.type === 1
    ? sampleCameraViewPoint(def, frames)
    : { ...def.viewStart };
  const fovDegrees = sampleCameraZoom(def, frames);
  return { position, target, fovDegrees, roll: def.rotation?.z ?? 0 };
}

/** How long the camera has anything left to animate, in frames. */
export function getCameraAnimationFrames(def: CameraPreviewDef): number {
  const viewSpan = distance(def.viewStart, def.viewEnd);
  const viewSpeed = def.vView / 100;
  const viewFrames = viewSpan > 1e-6 && viewSpeed > 0 ? viewSpan / viewSpeed : 0;
  const zoomSpan = Math.abs(def.zoomEnd - def.zoomStart);
  const zoomSpeed = def.vZoom / 100;
  const zoomFrames = zoomSpan > 1e-6 && zoomSpeed > 0 ? zoomSpan / zoomSpeed : 0;
  const routeFrames = def.route && def.route.length > 1 ? getRouteTravelFrames(def.route, def.vCam / 100) : 0;
  const animated = Math.max(viewFrames, zoomFrames, Number.isFinite(routeFrames) ? routeFrames : 0);
  return Math.max(def.time > 0 ? def.time : 0, animated);
}

export interface OpeningCameraStep {
  cameraIndex: number;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
}

/**
 * Walks the `nextCam` chain starting at `firstIndex`, the way the game plays the
 * opening pan. Guards against the loop-back-to-first trick track authors use for testing.
 */
export function buildOpeningCameraChain(defs: readonly CameraPreviewDef[], firstIndex: number): OpeningCameraStep[] {
  const byIndex = new Map<number, CameraPreviewDef>();
  for (const def of defs) byIndex.set(def.index, def);

  const steps: OpeningCameraStep[] = [];
  const visited = new Set<number>();
  let cursor = firstIndex;
  let startFrame = 0;
  while (cursor !== NO_CAMERA_LINK && cursor >= 0 && byIndex.has(cursor) && !visited.has(cursor)) {
    visited.add(cursor);
    const def = byIndex.get(cursor)!;
    const durationFrames = def.time > 0 ? def.time : getCameraAnimationFrames(def);
    steps.push({ cameraIndex: cursor, startFrame, endFrame: startFrame + durationFrames, durationFrames });
    startFrame += durationFrames;
    cursor = def.nextCam;
  }
  return steps;
}

export function getOpeningSequenceDuration(steps: readonly OpeningCameraStep[]): number {
  return steps.length === 0 ? 0 : steps[steps.length - 1].endFrame;
}

/** Which camera is on screen at `frames` and how far into it we are. */
export function sampleOpeningSequence(
  steps: readonly OpeningCameraStep[],
  frames: number,
): { cameraIndex: number; localFrame: number; stepIndex: number } | null {
  if (steps.length === 0) return null;
  if (frames < 0) return { cameraIndex: steps[0].cameraIndex, localFrame: 0, stepIndex: 0 };
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (frames < step.endFrame) return { cameraIndex: step.cameraIndex, localFrame: frames - step.startFrame, stepIndex: i };
  }
  return null;
}

/**
 * The four far corners of a view frustum, for the viewport gizmo.
 * `fovDegrees` is the vertical field of view.
 */
export function computeFrustumCorners(
  position: Vec3,
  target: Vec3,
  fovDegrees: number,
  aspect: number,
  length: number,
): [Vec3, Vec3, Vec3, Vec3] {
  let fx = target.x - position.x;
  let fy = target.y - position.y;
  let fz = target.z - position.z;
  const flen = Math.hypot(fx, fy, fz);
  if (flen <= 1e-6) {
    fx = 0;
    fy = 0;
    fz = 1;
  } else {
    fx /= flen;
    fy /= flen;
    fz /= flen;
  }

  // right = normalize(cross(forward, worldUp)); fall back when looking straight up/down.
  let rx = -fz;
  let ry = 0;
  let rz = fx;
  let rlen = Math.hypot(rx, ry, rz);
  if (rlen <= 1e-6) {
    rx = 1;
    ry = 0;
    rz = 0;
    rlen = 1;
  }
  rx /= rlen;
  ry /= rlen;
  rz /= rlen;

  // up = cross(right, forward)
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;

  const halfHeight = Math.tan((Math.max(1, Math.min(179, fovDegrees)) * Math.PI) / 360) * length;
  const halfWidth = halfHeight * aspect;

  const corner = (sx: number, sy: number): Vec3 => ({
    x: position.x + fx * length + rx * halfWidth * sx + ux * halfHeight * sy,
    y: position.y + fy * length + ry * halfWidth * sx + uy * halfHeight * sy,
    z: position.z + fz * length + rz * halfWidth * sx + uz * halfHeight * sy,
  });

  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
}

// ---------------------------------------------------------------------------
// Frames, seconds and the CAME rotation field
// ---------------------------------------------------------------------------

const FRAMES_PER_SECOND = 60;

/** MKW frames (the game runs at 60 fps) to seconds. */
export function framesToSeconds(frames: number): number {
  return frames / FRAMES_PER_SECOND;
}

/** Seconds to MKW frames. */
export function secondsToFrames(seconds: number): number {
  return seconds * FRAMES_PER_SECOND;
}

/** `12.5` -> `"12.5 frames (0.21 s)"`, for the duration readouts. */
export function formatFrames(frames: number): string {
  const safe = Number.isFinite(frames) ? frames : 0;
  return `${Number(safe.toFixed(2))} frames (${framesToSeconds(safe).toFixed(2)} s)`;
}

function clampNumber(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/**
 * The KMP rotation of a record whose local +Z axis points along `forward`, with no roll.
 *
 * The renderer builds a record's matrix as `Rz * Ry * Rx` (noclip's `computeModelMatrixSRT`),
 * whose third basis vector is `(cosX*sinY, -sinX, cosX*cosY)` when the Z rotation is zero.
 * This inverts that, so `lookDirectionFromEuler(eulerFromLookDirection(f))` gives `f` back.
 */
export function eulerFromLookDirection(forward: Vec3): Vec3 {
  const length = Math.hypot(forward.x, forward.y, forward.z);
  if (length <= 1e-6) return { x: 0, y: 0, z: 0 };
  const fx = forward.x / length;
  const fy = forward.y / length;
  const fz = forward.z / length;
  // `+ 0` keeps a negative zero out of the KMP float.
  return {
    x: -Math.asin(clampNumber(fy, -1, 1)) * RAD_TO_DEG + 0,
    y: Math.atan2(fx, fz) * RAD_TO_DEG + 0,
    z: 0,
  };
}

/** The unit direction a record with this KMP rotation (degrees) faces. Inverse of {@link eulerFromLookDirection}. */
export function lookDirectionFromEuler(rotation: Vec3): Vec3 {
  const pitch = rotation.x * DEG_TO_RAD;
  const yaw = rotation.y * DEG_TO_RAD;
  const cosPitch = Math.cos(pitch);
  return { x: cosPitch * Math.sin(yaw), y: -Math.sin(pitch), z: cosPitch * Math.cos(yaw) };
}
