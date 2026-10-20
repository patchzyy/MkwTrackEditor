/**
 * Pure helpers behind the viewport's Create mode (`createView` prop): turning a canvas point into a
 * world ray, hitting the ground plane, picking overlay handles on screen, and diffing the preview
 * models. Everything here is plain maths on plain data so it can be unit tested without WebGL.
 *
 * Units: the app and `src/lib/create` speak game units; the renderer draws at `RENDER_SCALE` (0.1)
 * of that. Every function here takes and returns game units except where a parameter says scene.
 */

import type {
  CreateFrameOptions,
  CreateHit,
  CreateOverlayPoint,
  CreatePreviewModel,
  CreateRay,
  Vec3,
} from '../../lib/create/types';

export const CREATE_RENDER_SCALE = 0.1;

/** Extra reach, in CSS pixels, of a handle's hit test beyond its drawn radius. */
export const HANDLE_PICK_SLACK_PX = 6;

type Mat4Like = ArrayLike<number>;

export interface CameraBasis {
  /** Scene-space clip-from-world matrix (column-major, gl-matrix layout). */
  clipFromWorld: Mat4Like;
  /** The camera's projection matrix (clip from view). */
  projectionMatrix: Mat4Like;
  /** Scene-space camera world matrix (column-major). */
  worldMatrix: Mat4Like;
  orthographic: boolean;
}

/**
 * The world ray under a canvas point, in game units. `x`/`y` are CSS pixels relative to the canvas,
 * `width`/`height` the canvas's CSS size.
 *
 * Built from the camera's axes and the projection's scale terms, never from unprojected depth, so it
 * is independent of the depth convention (reversed Z, infinite far plane) and as precise as the
 * axes are. A perspective ray starts at the eye; an orthographic ray starts on the plane through
 * the eye, so `distance` along it means the same thing in both.
 */
export function canvasPointToRay(camera: CameraBasis, x: number, y: number, width: number, height: number): CreateRay | null {
  if (!(width > 0) || !(height > 0)) return null;
  const ndcX = (x / width) * 2 - 1;
  const ndcY = 1 - (y / height) * 2;
  const pm = camera.projectionMatrix;
  const w = camera.worldMatrix;
  if (!(Math.abs(pm[0]) > 1e-12) || !(Math.abs(pm[5]) > 1e-12)) return null;
  // The camera's own axes: unit vectors, so they are precise in float32 where unprojecting a point
  // through the combined clip matrix (translation in the tens of thousands) is not.
  const right: [number, number, number] = [w[0], w[1], w[2]];
  const up: [number, number, number] = [w[4], w[5], w[6]];
  const back: [number, number, number] = [w[8], w[9], w[10]];
  const eye: [number, number, number] = [w[12], w[13], w[14]];

  let dir: [number, number, number];
  let origin: [number, number, number];
  if (camera.orthographic) {
    // clip.x = m0 * xv + m12 (no perspective divide): the view-space position on the eye plane.
    const xv = (ndcX - pm[12]) / pm[0];
    const yv = (ndcY - pm[13]) / pm[5];
    dir = [-back[0], -back[1], -back[2]];
    origin = [eye[0] + right[0] * xv + up[0] * yv, eye[1] + right[1] * xv + up[1] * yv, eye[2] + right[2] * xv + up[2] * yv];
  } else {
    // clip.x = m0 * xv + m8 * zv, w = -zv  =>  xv / -zv = (ndcX + m8) / m0.
    const tx = (ndcX + pm[8]) / pm[0];
    const ty = (ndcY + pm[9]) / pm[5];
    dir = [right[0] * tx + up[0] * ty - back[0], right[1] * tx + up[1] * ty - back[1], right[2] * tx + up[2] * ty - back[2]];
    origin = eye;
  }
  const dl = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(dl > 1e-12)) return null;
  const s = 1 / CREATE_RENDER_SCALE;
  return {
    origin: { x: origin[0] * s, y: origin[1] * s, z: origin[2] * s },
    direction: { x: dir[0] / dl, y: dir[1] / dl, z: dir[2] / dl },
  };
}

/** The ray against the horizontal plane `y = planeY`, or null when it is parallel or points away. */
export function rayPlaneHit(ray: CreateRay, planeY: number): CreateHit | null {
  const dy = ray.direction.y;
  if (Math.abs(dy) < 1e-9) return null;
  const t = (planeY - ray.origin.y) / dy;
  if (!Number.isFinite(t) || t < 0) return null;
  return {
    position: { x: ray.origin.x + ray.direction.x * t, y: planeY, z: ray.origin.z + ray.direction.z * t },
    normal: { x: 0, y: 1, z: 0 },
    distance: t,
  };
}

/** `raycast(ray)` if it hits, else the ground plane. */
export function resolveHit(
  ray: CreateRay,
  raycast: ((ray: CreateRay) => CreateHit | null) | undefined,
  groundPlaneY: number,
): CreateHit | null {
  if (raycast) {
    const hit = raycast(ray);
    if (hit) return hit;
  }
  return rayPlaneHit(ray, groundPlaneY);
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** Clip-space w: the distance along the view axis in a perspective view. */
  depth: number;
}

/** A game-unit point to canvas CSS pixels, or null behind the camera. */
export function projectToCanvas(
  clipFromWorld: Mat4Like,
  point: { x: number; y: number; z: number },
  width: number,
  height: number,
): ScreenPoint | null {
  const m = clipFromWorld;
  const X = point.x * CREATE_RENDER_SCALE, Y = point.y * CREATE_RENDER_SCALE, Z = point.z * CREATE_RENDER_SCALE;
  const cx = m[0] * X + m[4] * Y + m[8] * Z + m[12];
  const cy = m[1] * X + m[5] * Y + m[9] * Z + m[13];
  const cw = m[3] * X + m[7] * Y + m[11] * Z + m[15];
  if (!(cw > 1e-6) || !Number.isFinite(cw)) return null;
  const x = (cx / cw * 0.5 + 0.5) * width;
  const y = (0.5 - cy / cw * 0.5) * height;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, depth: cw };
}

/**
 * The pickable overlay point under a canvas point: the nearest one whose drawn radius plus
 * `HANDLE_PICK_SLACK_PX` reaches it. Two handles within 2 px of each other in screen distance (a
 * closed loop's first and last point, say) resolve to the one nearer the camera.
 */
export function pickOverlayHandle(
  points: ReadonlyArray<CreateOverlayPoint>,
  clipFromWorld: Mat4Like,
  width: number,
  height: number,
  x: number,
  y: number,
  slack = HANDLE_PICK_SLACK_PX,
): string | null {
  let bestId: string | null = null;
  let bestDistance = Infinity;
  let bestDepth = Infinity;
  for (const point of points) {
    if (!point.pickable) continue;
    const screen = projectToCanvas(clipFromWorld, point.position, width, height);
    if (!screen) continue;
    const distance = Math.hypot(screen.x - x, screen.y - y);
    if (distance > point.radius + slack) continue;
    const closer = distance < bestDistance - 2 || (Math.abs(distance - bestDistance) <= 2 && screen.depth < bestDepth);
    if (bestId === null || closer) {
      bestId = point.id;
      bestDistance = distance;
      bestDepth = screen.depth;
    }
  }
  return bestId;
}

export interface PreviewModelDiff {
  /** Keys that are no longer wanted. */
  remove: string[];
  /** Models that are new or whose revision / bytes / model name changed. */
  upsert: CreatePreviewModel[];
}

export interface AppliedPreviewModel {
  revision: number;
  modelName: string;
  brres: Uint8Array;
}

/** Compares the wanted preview models with what the renderer holds. Keyed by `key`, then `revision`. */
export function diffPreviewModels(wanted: ReadonlyArray<CreatePreviewModel>, applied: ReadonlyMap<string, AppliedPreviewModel>): PreviewModelDiff {
  const wantedKeys = new Set<string>();
  const upsert: CreatePreviewModel[] = [];
  for (const model of wanted) {
    wantedKeys.add(model.key);
    const current = applied.get(model.key);
    if (current && current.revision === model.revision && current.modelName === model.modelName && current.brres === model.brres) continue;
    upsert.push(model);
  }
  const remove: string[] = [];
  for (const key of applied.keys()) if (!wantedKeys.has(key)) remove.push(key);
  return { remove, upsert };
}


// ── Framing ────────────────────────────────────────────────────────────────────────────────────

/** How much of the canvas the framed box fills when the caller does not say (the old sphere fit was ~0.9). */
export const DEFAULT_FRAME_FILL = 0.85;
const MAX_PITCH_DEGREES = 89;
/** Never put the eye closer than this (game units) to the nearest corner of the box. */
const MIN_FRAME_DEPTH = 300;

const DEG = Math.PI / 180;

export interface FrameViewInput extends CreateFrameOptions {
  /** Vertical field of view, radians. */
  fovY: number;
  /** Canvas width / height. */
  aspect: number;
  /** The camera's current forward axis; used for whatever of pitch / yaw the options leave out. */
  currentForward: Vec3;
}

export interface FrameView {
  eye: Vec3;
  target: Vec3;
  /** Unit look direction from the eye to the target. */
  forward: Vec3;
}

/**
 * Where to put a perspective camera so an axis-aligned box fills `fill` of the canvas (the
 * limiting dimension, measured on the box's projected corners) looking along the requested
 * direction. Game units in, game units out.
 *
 * `pitchDegrees` is the angle below the horizon (0 = level, 90 = straight down; clamped to 89 so
 * "right" stays defined). `yawDegrees` is the compass heading of the look direction, clockwise from
 * north: 0 looks towards -Z (the top view's "up"), 90 towards +X. A missing angle keeps the
 * camera's current one, so `{}` just refits along the current view direction.
 */
export function computeFrameView(min: Vec3, max: Vec3, input: FrameViewInput): FrameView {
  const cur = input.currentForward;
  const curHorizontal = Math.hypot(cur.x, cur.z);
  const curPitch = Math.atan2(-cur.y, curHorizontal);
  const curYaw = curHorizontal > 1e-6 ? Math.atan2(cur.x, -cur.z) : 0;
  const pitch = Math.max(-MAX_PITCH_DEGREES, Math.min(MAX_PITCH_DEGREES, input.pitchDegrees ?? curPitch / DEG)) * DEG;
  const yaw = (input.yawDegrees === undefined ? curYaw : input.yawDegrees * DEG);
  const forward: Vec3 = { x: Math.cos(pitch) * Math.sin(yaw), y: -Math.sin(pitch), z: -Math.cos(pitch) * Math.cos(yaw) };
  // right = forward x up(0,1,0), normalised; up = right x forward.
  const right: Vec3 = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
  const up: Vec3 = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  };
  const center: Vec3 = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  const fill = Math.max(0.1, Math.min(1, input.fill ?? DEFAULT_FRAME_FILL));
  const tanY = Math.tan(Math.max(input.fovY, 0.05) / 2) * fill;
  const tanX = tanY * Math.max(input.aspect, 0.1);
  const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

  let distance = MIN_FRAME_DEPTH;
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        const rel = { x: x - center.x, y: y - center.y, z: z - center.z };
        const along = dot(rel, forward);
        // depth = distance + along must make the corner land inside the fill window.
        distance = Math.max(distance, Math.abs(dot(rel, right)) / tanX - along, Math.abs(dot(rel, up)) / tanY - along, MIN_FRAME_DEPTH - along);
      }
    }
  }
  return {
    eye: { x: center.x - forward.x * distance, y: center.y - forward.y * distance, z: center.z - forward.z * distance },
    target: center,
    forward,
  };
}
