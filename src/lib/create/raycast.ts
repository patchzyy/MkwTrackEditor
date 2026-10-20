/**
 * Ray queries against the design's own collision (not the stale scene): used by the editing tools to
 * place things on the ground, and by KMP generation to snap props.
 */
import { TriangleBvh } from '../kclRaycast';
import type { CreateHit, CreateRay, GeneratedCollision } from './types';
import { isDrivableFlag } from './kclTypes';
import type { GroundQuery } from './props';

export interface SurfaceQuery {
  raycast(ray: CreateRay): CreateHit | null;
  /** Height of the ground under (x, z), looking down from `fromY`. */
  groundAt: GroundQuery;
  triangleCount: number;
}

/**
 * Builds the BVH over everything a kart (or a cursor) can stand on: drivable surfaces that face
 * up. Walls, ceilings and fall planes are left out, so the pointer never lands on an invisible wall.
 */
export function createSurfaceQuery(collision: GeneratedCollision): SurfaceQuery {
  const { positions, indices, flags } = collision;
  const tris: Array<{ a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number }; c: { x: number; y: number; z: number } }> = [];
  const normals: number[] = [];
  for (let t = 0; t < flags.length; t++) {
    if (!isDrivableFlag(flags[t])) continue;
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;
    const ax = positions[i0];
    const ay = positions[i0 + 1];
    const az = positions[i0 + 2];
    const ux = positions[i1] - ax;
    const uy = positions[i1 + 1] - ay;
    const uz = positions[i1 + 2] - az;
    const vx = positions[i2] - ax;
    const vy = positions[i2 + 1] - ay;
    const vz = positions[i2 + 2] - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) continue;
    nx /= l;
    ny /= l;
    nz /= l;
    if (ny < 0.2) continue; // steeper than ~78° or facing down: not ground
    tris.push({ a: { x: ax, y: ay, z: az }, b: { x: positions[i1], y: positions[i1 + 1], z: positions[i1 + 2] }, c: { x: positions[i2], y: positions[i2 + 1], z: positions[i2 + 2] } });
    normals.push(nx, ny, nz);
  }
  const bvh = new TriangleBvh(tris);
  const raycast = (ray: CreateRay): CreateHit | null => {
    const len = Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z);
    if (len < 1e-12) return null;
    const hit = bvh.raycast(ray.origin, ray.direction);
    if (!hit) return null;
    const ti = hit.triangleIndex * 3;
    return {
      position: { x: hit.position.x, y: hit.position.y, z: hit.position.z },
      normal: { x: normals[ti], y: normals[ti + 1], z: normals[ti + 2] },
      distance: hit.distance * len,
    };
  };
  const groundAt: GroundQuery = (x, fromY, z) => {
    const hit = bvh.raycast({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    return hit ? hit.position.y : null;
  };
  return { raycast, groundAt, triangleCount: tris.length };
}

/** `createRaycaster(collision)`: `(ray) => CreateHit | null` (the shape `CreateViewProps.raycast` wants). */
export function createRaycaster(collision: GeneratedCollision): (ray: CreateRay) => CreateHit | null {
  return createSurfaceQuery(collision).raycast;
}
