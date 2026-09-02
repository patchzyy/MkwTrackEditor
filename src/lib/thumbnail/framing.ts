/**
 * Pure camera-framing math for model thumbnails.
 *
 * Given a model-space bounding box, work out where to put a fixed "studio" camera so the
 * whole model fills the frame with a small margin. Kept free of any renderer imports so it
 * can be unit tested in Node.
 */

export type Vec3Tuple = [number, number, number];

export interface Bounds3 {
  min: Vec3Tuple;
  max: Vec3Tuple;
}

export interface StudioFramingOptions {
  /** Vertical field of view, radians. */
  fovY?: number;
  /** Viewport aspect ratio (width / height). */
  aspect?: number;
  /** Camera azimuth around the model's +Y axis, radians. */
  yaw?: number;
  /** Camera elevation above the model's horizon, radians. */
  pitch?: number;
  /** How much of the frame the model should occupy, 0..1. */
  fill?: number;
}

export interface StudioFraming {
  eye: Vec3Tuple;
  target: Vec3Tuple;
  up: Vec3Tuple;
  near: number;
  far: number;
  fovY: number;
  aspect: number;
  /** Distance from the eye to the bounding box centre. */
  distance: number;
  /** Radius of the bounding sphere around the box. */
  radius: number;
}

export const DEFAULT_FRAMING_OPTIONS: Required<StudioFramingOptions> = {
  fovY: (35 * Math.PI) / 180,
  aspect: 1,
  yaw: (34 * Math.PI) / 180,
  pitch: (21 * Math.PI) / 180,
  fill: 0.86,
};

export function makeEmptyBounds(): Bounds3 {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

export function isUsableBounds(bounds: Bounds3 | null | undefined): bounds is Bounds3 {
  if (!bounds) return false;
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(bounds.min[i]) || !Number.isFinite(bounds.max[i])) return false;
    if (bounds.max[i] < bounds.min[i]) return false;
  }
  return boundsRadius(bounds) > 0;
}

export function expandBoundsByPoint(bounds: Bounds3, x: number, y: number, z: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
  if (x < bounds.min[0]) bounds.min[0] = x;
  if (y < bounds.min[1]) bounds.min[1] = y;
  if (z < bounds.min[2]) bounds.min[2] = z;
  if (x > bounds.max[0]) bounds.max[0] = x;
  if (y > bounds.max[1]) bounds.max[1] = y;
  if (z > bounds.max[2]) bounds.max[2] = z;
}

export function expandBoundsByBounds(bounds: Bounds3, other: Bounds3): void {
  expandBoundsByPoint(bounds, other.min[0], other.min[1], other.min[2]);
  expandBoundsByPoint(bounds, other.max[0], other.max[1], other.max[2]);
}

export function boundsCenter(bounds: Bounds3): Vec3Tuple {
  return [
    (bounds.min[0] + bounds.max[0]) * 0.5,
    (bounds.min[1] + bounds.max[1]) * 0.5,
    (bounds.min[2] + bounds.max[2]) * 0.5,
  ];
}

export function boundsRadius(bounds: Bounds3): number {
  const dx = bounds.max[0] - bounds.min[0];
  const dy = bounds.max[1] - bounds.min[1];
  const dz = bounds.max[2] - bounds.min[2];
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return 0;
  return Math.hypot(dx, dy, dz) * 0.5;
}

function normalize(v: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length === 0) return [0, 0, 1];
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Direction pointing from the model centre towards the camera.
 */
export function framingViewOffsetDirection(yaw: number, pitch: number): Vec3Tuple {
  const cosPitch = Math.cos(pitch);
  return normalize([Math.sin(yaw) * cosPitch, Math.sin(pitch), Math.cos(yaw) * cosPitch]);
}

/**
 * Place a camera so the whole bounding box is inside the frustum.
 *
 * The box corners are projected onto the camera basis, so long thin objects (trees, poles)
 * are framed tightly instead of being fit to their bounding sphere.
 */
export function computeStudioFraming(bounds: Bounds3, options: StudioFramingOptions = {}): StudioFraming {
  const { fovY, aspect, yaw, pitch, fill } = { ...DEFAULT_FRAMING_OPTIONS, ...options };
  const center = boundsCenter(bounds);
  const radius = boundsRadius(bounds);

  const offsetDirection = framingViewOffsetDirection(yaw, pitch);
  const forward: Vec3Tuple = [-offsetDirection[0], -offsetDirection[1], -offsetDirection[2]];
  const worldUp: Vec3Tuple = Math.abs(forward[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  const right = normalize(cross(forward, worldUp));
  const up = normalize(cross(right, forward));

  // Half extents of the bounding box measured along the camera basis.
  let halfRight = 0;
  let halfUp = 0;
  let halfDepth = 0;
  for (let corner = 0; corner < 8; corner++) {
    const px = (corner & 1 ? bounds.max : bounds.min)[0] - center[0];
    const py = (corner & 2 ? bounds.max : bounds.min)[1] - center[1];
    const pz = (corner & 4 ? bounds.max : bounds.min)[2] - center[2];
    halfRight = Math.max(halfRight, Math.abs(px * right[0] + py * right[1] + pz * right[2]));
    halfUp = Math.max(halfUp, Math.abs(px * up[0] + py * up[1] + pz * up[2]));
    halfDepth = Math.max(halfDepth, Math.abs(px * forward[0] + py * forward[1] + pz * forward[2]));
  }

  const safeFill = Math.min(0.999, Math.max(0.05, fill));
  const tanHalfFovY = Math.tan(fovY * 0.5);
  const tanHalfFovX = tanHalfFovY * Math.max(0.001, aspect);
  const fitDistance = Math.max(halfRight / tanHalfFovX, halfUp / tanHalfFovY) / safeFill;
  const distance = Math.max(fitDistance + halfDepth, radius * 0.01, 1e-4);

  const eye: Vec3Tuple = [
    center[0] + offsetDirection[0] * distance,
    center[1] + offsetDirection[1] * distance,
    center[2] + offsetDirection[2] * distance,
  ];

  const near = Math.max(distance - halfDepth * 1.05, distance * 0.005, 1e-5);
  const far = distance + halfDepth * 1.05 + Math.max(radius, 1e-4);

  return { eye, target: center, up, near, far, fovY, aspect, distance, radius };
}
