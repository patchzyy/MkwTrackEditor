/**
 * The horizon: a far, coarse ring of ground around the terrain so the skybox meets land instead of a
 * green rectangle floating in a white void.
 *
 * Past the detailed ring the ground carries on as four flat slabs out to `HORIZON_FAR`, so a camera that
 * is dollied out or flown low and far away still looks at land instead of the empty (white) clear colour.
 * The ring's hills fade out towards its outer edge, so the slabs meet it at one constant height with no crack.
 *
 * It is render-only (a kart can never reach it behind the world wall); with a `fall` boundary the ring is
 * deadly instead, so driving off the edge ends the run. It lives in its own chunk (`horizon`) and its
 * shape depends only on quantised numbers (the terrain rectangle shrunk to a 20k grid, the base
 * height, the ground surface), so dragging things around never rebuilds it.
 */
import type { CreateKit, CreateProject, GeneratedMesh } from './types';
import { MeshBuilder, CollisionBuilder } from './meshBuilder';
import { TERRAIN_RELIEF, createMeshLight } from './lighting';
import { smoothstep } from './math';
import { FLAG_FALL_BOUNDARY } from './kclTypes';
import type { TerrainField } from './terrain';

export const HORIZON_CHUNK = 'horizon';
/** The ring reaches this far past the terrain. */
export const HORIZON_REACH = 100000;
/** The flat slabs beyond the ring reach this far from the origin (game units; the camera's far plane is 5M). */
export const HORIZON_FAR = 2000000;
const QUANT = 20000;
const CELL = 10000;
/** The ring starts this far below the terrain's base height, so the two never z-fight. */
const HORIZON_DROP = 25;

export interface HorizonResult {
  meshes: GeneratedMesh[];
  collision: CollisionBuilder;
}

export function buildHorizon(field: TerrainField, project: CreateProject, kit: CreateKit): HorizonResult {
  const cb = new CollisionBuilder();
  if (!field.enabled) return { meshes: [], collision: cb };
  const x1 = field.x0 + (field.cols - 1) * field.cell;
  const z1 = field.z0 + (field.rows - 1) * field.cell;
  // The hole is the terrain rectangle shrunk inwards to the quantisation grid: the ring then always
  // tucks under the terrain edge, and only changes when the terrain grows or shrinks by a whole step.
  const hx0 = Math.ceil(field.x0 / QUANT) * QUANT;
  const hx1 = Math.floor(x1 / QUANT) * QUANT;
  const hz0 = Math.ceil(field.z0 / QUANT) * QUANT;
  const hz1 = Math.floor(z1 / QUANT) * QUANT;
  const hasHole = hx1 > hx0 && hz1 > hz0;
  const ox0 = (hasHole ? hx0 : Math.round(field.x0 / QUANT) * QUANT) - HORIZON_REACH;
  const oz0 = (hasHole ? hz0 : Math.round(field.z0 / QUANT) * QUANT) - HORIZON_REACH;
  const ox1 = (hasHole ? hx1 : Math.round(x1 / QUANT) * QUANT) + HORIZON_REACH;
  const oz1 = (hasHole ? hz1 : Math.round(z1 / QUANT) * QUANT) + HORIZON_REACH;
  const nx = Math.round((ox1 - ox0) / CELL);
  const nz = Math.round((oz1 - oz0) / CELL);

  const surface = kit.resolveSurface({ slot: 'ground' }, project.themeId);
  const base = project.terrain.baseHeight - HORIZON_DROP;
  const heightAt = (x: number, z: number): number => {
    const dx = hasHole ? Math.max(hx0 - x, x - hx1, 0) : 0;
    const dz = hasHole ? Math.max(hz0 - z, z - hz1, 0) : 0;
    const d = Math.max(dx, dz);
    const ramp = smoothstep((d - 12000) / (HORIZON_REACH - 12000));
    // Low rolling hills, in absolute coordinates so the shape does not move when the terrain does.
    const n = 0.5 + 0.5 * Math.sin(x * 0.000041 + 1.3) * Math.sin(z * 0.000033 + 0.7);
    const m = 0.5 + 0.5 * Math.sin(x * 0.000017 - 0.4 + z * 0.000013);
    // The hills calm down towards the outer edge, where the flat slabs take over at the mean height.
    const calm = 1 - smoothstep((d - 0.55 * HORIZON_REACH) / (0.45 * HORIZON_REACH));
    return base + ramp * (500 + 2300 * (0.5 + calm * (0.6 * n + 0.4 * m - 0.5)));
  };

  const mb = new MeshBuilder(HORIZON_CHUNK, 'horizon', createMeshLight(kit, project.themeId, TERRAIN_RELIEF));
  const cols = nx + 1;
  const heights = new Float32Array(cols * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) heights[j * cols + i] = heightAt(ox0 + i * CELL, oz0 + j * CELL);
  const normalAt = (i: number, j: number): [number, number, number] => {
    const il = Math.max(0, i - 1);
    const ir = Math.min(nx, i + 1);
    const jl = Math.max(0, j - 1);
    const jr = Math.min(nz, j + 1);
    const dhx = (heights[j * cols + ir] - heights[j * cols + il]) / ((ir - il) * CELL);
    const dhz = (heights[jr * cols + i] - heights[jl * cols + i]) / ((jr - jl) * CELL);
    const l = Math.sqrt(dhx * dhx + 1 + dhz * dhz);
    return [-dhx / l, 1 / l, -dhz / l];
  };
  const cache = new Int32Array(cols * (nz + 1)).fill(-1);
  const vertex = (i: number, j: number): number => {
    const k = j * cols + i;
    if (cache[k] >= 0) return cache[k];
    const [a, b, c] = normalAt(i, j);
    const x = ox0 + i * CELL;
    const z = oz0 + j * CELL;
    cache[k] = mb.vertex(surface.id, x, heights[k], z, a, b, c, x / surface.textureWorldSize[0], z / surface.textureWorldSize[1], 255);
    return cache[k];
  };
  const lethal = project.terrain.boundary === 'fall';
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = ox0 + (i + 0.5) * CELL;
      const cz = oz0 + (j + 0.5) * CELL;
      if (hasHole && cx > hx0 && cx < hx1 && cz > hz0 && cz < hz1) continue;
      const v00 = vertex(i, j);
      const v10 = vertex(i + 1, j);
      const v01 = vertex(i, j + 1);
      const v11 = vertex(i + 1, j + 1);
      mb.facingQuad(surface.id, v00, v10, v01, v11, 0, 1, 0);
      if (lethal) {
        const p = (ii: number, jj: number): [number, number, number] => [ox0 + ii * CELL, heights[jj * cols + ii], oz0 + jj * CELL];
        const a = p(i, j);
        const b = p(i + 1, j);
        const c = p(i, j + 1);
        const d = p(i + 1, j + 1);
        cb.triangleUp(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], FLAG_FALL_BOUNDARY);
        cb.triangleUp(a[0], a[1], a[2], d[0], d[1], d[2], b[0], b[1], b[2], FLAG_FALL_BOUNDARY);
      }
    }
  }

  // The flat slabs beyond the ring: north, south, west and east of its outer rectangle.
  const outerHeight = hasHole ? base + 500 + 2300 * 0.5 : base;
  const far = HORIZON_FAR;
  const slab = (x0: number, z0: number, x1: number, z1: number) => {
    const corner = (x: number, z: number) => mb.vertex(surface.id, x, outerHeight, z, 0, 1, 0, x / surface.textureWorldSize[0], z / surface.textureWorldSize[1], 255);
    mb.facingQuad(surface.id, corner(x0, z0), corner(x1, z0), corner(x0, z1), corner(x1, z1), 0, 1, 0);
  };
  slab(-far, -far, far, oz0);
  slab(-far, oz1, far, far);
  slab(-far, oz0, ox0, oz1);
  slab(ox1, oz0, far, oz1);
  return { meshes: mb.build(), collision: cb };
}
