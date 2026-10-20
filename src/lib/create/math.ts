/**
 * Small vector helpers shared by the Create-mode generators. Plain `{x, y, z}` objects, so they
 * interoperate with `kmpFile.ts`. Hot loops in the mesh builders use raw numbers instead.
 */
import type { Vec2, Vec3 } from './types';

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const distanceXZ = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clone3 = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });

export function normalize(a: Vec3, fallback: Vec3 = { x: 0, y: 1, z: 0 }): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z);
  if (l < 1e-9) return { ...fallback };
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

export function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Heading (degrees, KMP convention) of a horizontal forward direction: forward = (sin h, cos h). */
export function headingDegrees(forward: { x: number; z: number }): number {
  return Math.atan2(forward.x, forward.z) * RAD2DEG;
}

/** Forward direction (unit, horizontal) of a KMP heading in degrees. */
export function forwardFromHeading(degrees: number): Vec3 {
  const r = degrees * DEG2RAD;
  return { x: Math.sin(r), y: 0, z: Math.cos(r) };
}

/** Horizontal right-hand vector of a forward direction (looking along it, +Y up). */
export function rightOf(forward: { x: number; z: number }): Vec3 {
  const l = Math.hypot(forward.x, forward.z) || 1;
  return { x: -forward.z / l, y: 0, z: forward.x / l };
}

export function wrapDegrees(d: number): number {
  let v = d % 360;
  if (v > 180) v -= 360;
  if (v <= -180) v += 360;
  return v;
}

export const v2 = (x: number, z: number): Vec2 => ({ x, z });

/** Do the 2D segments (a,b) and (c,d) properly intersect (XZ plane)? */
export function segmentsIntersect2D(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): boolean {
  const o1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const o2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const o3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const o4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** Deterministic PRNG (mulberry32). */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
