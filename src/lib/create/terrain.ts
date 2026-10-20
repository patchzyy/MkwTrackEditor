/**
 * Terrain: a heightfield over everything placed (plus a margin), sculpted by strokes, flattened
 * under and around roads, painted per vertex, and turned into meshes + collision.
 *
 * Under the road footprint (surface + curbs + shoulders, plus a one-and-a-bit cell ring) the ground
 * is sunk `TERRAIN_SINK` units below the road surface, so road and ground never overlap in collision
 * or z-fight. Beyond that ring the ground blends smoothly back to the natural height over a falloff
 * that scales with the height difference, which gives raised roads grassy embankments and roads
 * through hills proper cuttings.
 */
import type {
  CompiledGeometry,
  CreateKit,
  CreateProject,
  KitSurface,
  TerrainStroke,
  Vec2,
} from './types';
import { clamp, smoothstep } from './math';
import { CollisionBuilder, MeshBuilder, type BoundsAccumulator, growBounds } from './meshBuilder';
import { TERRAIN_RELIEF, createMeshLight } from './lighting';
import { FLAG_FALL_BOUNDARY, FLAG_INVISIBLE_WALL, KCL_TYPE } from './kclTypes';
import { sampleRoadRange, roadParamEnd } from './spline';
import { FALL_RIBBON_MARGIN, footprintHalfWidth, sectionRanges } from './sections';

export const TERRAIN_SINK = 30;
/** Never more than this many vertices along an axis; the cell size grows to fit. */
export const MAX_GRID_DIM = 190;
const POND_DEPTH = 70;
/** How far below a bridge deck or a gap the ground is dug away. */
const BRIDGE_PIT_DEPTH = 1200;
const GAP_PIT_DEPTH = 1500;
const FALLOFF_MIN = 600;
const FALLOFF_MAX = 3200;

export interface TerrainField {
  enabled: boolean;
  /** Effective cell size (>= the requested one when the world is huge). */
  cell: number;
  cols: number;
  rows: number;
  x0: number;
  z0: number;
  heights: Float32Array;
  /** Per vertex: index into `surfaceIds` (0 = the terrain's base surface). */
  surfaceIndex: Uint8Array;
  surfaceIds: string[];
  /** 1 where the ground is sunk under a road. */
  sunk: Uint8Array;
  /** 1 under a bridge or gap (and a margin around it): falling there ends the run. */
  voidZone: Uint8Array;
  minY: number;
  maxY: number;
  /** Height of the ground at (x, z); `-Infinity` when the terrain is disabled. */
  heightAt(x: number, z: number): number;
}

export function emptyTerrainField(): TerrainField {
  return {
    enabled: false,
    cell: 1,
    cols: 0,
    rows: 0,
    x0: 0,
    z0: 0,
    heights: new Float32Array(0),
    surfaceIndex: new Uint8Array(0),
    surfaceIds: [],
    sunk: new Uint8Array(0),
    voidZone: new Uint8Array(0),
    minY: 0,
    maxY: 0,
    heightAt: () => Number.NEGATIVE_INFINITY,
  };
}

/** Axis-aligned bounds (XZ) of everything that needs ground under it. */
export function worldBounds(project: CreateProject): { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number } {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minY: Infinity, maxY: -Infinity };
  const grow = (x: number, z: number, r: number, y?: number) => {
    if (x - r < b.minX) b.minX = x - r;
    if (x + r > b.maxX) b.maxX = x + r;
    if (z - r < b.minZ) b.minZ = z - r;
    if (z + r > b.maxZ) b.maxZ = z + r;
    if (y !== undefined) {
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
  };
  for (const road of project.roads) {
    const end = roadParamEnd(road);
    if (end <= 0 && road.points.length === 0) continue;
    // Cheap bounds: control points are enough for the XZ extent, widened by the widest cross-section.
    let reach = 0;
    for (const p of road.points) reach = Math.max(reach, p.width / 2 + 1800);
    for (const p of road.points) grow(p.position.x, p.position.z, reach, p.position.y);
    // Curves bulge past their control points; sample coarsely to catch it.
    for (const s of sampleRoadRange(road, 0, end, { step: 1500, maxAngleDegrees: 25 })) grow(s.position.x, s.position.z, reach, s.position.y);
  }
  for (const prop of project.props) grow(prop.position.x, prop.position.z, 600, prop.position.y);
  for (const stroke of project.terrainStrokes) for (const p of stroke.points) grow(p.x, p.z, stroke.radius);
  if (!Number.isFinite(b.minX)) {
    b.minX = -5000;
    b.maxX = 5000;
    b.minZ = -5000;
    b.maxZ = 5000;
  }
  if (!Number.isFinite(b.minY)) {
    b.minY = project.terrain.baseHeight;
    b.maxY = project.terrain.baseHeight;
  }
  return b;
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function pickSurfaceIndex(field: { surfaceIds: string[] }, id: string): number {
  let i = field.surfaceIds.indexOf(id);
  if (i < 0) {
    if (field.surfaceIds.length >= 255) return 0;
    field.surfaceIds.push(id);
    i = field.surfaceIds.length - 1;
  }
  return i;
}

function strokeSegments(points: Vec2[]): Array<[Vec2, Vec2]> {
  if (points.length === 0) return [];
  if (points.length === 1) return [[points[0], points[0]]];
  const out: Array<[Vec2, Vec2]> = [];
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i], points[i + 1]]);
  return out;
}

/** Builds the heightfield (and paint raster) for a project. Disabled terrain yields an inert field. */
export interface TerrainFieldOptions {
  /** Multiplies the cell size (draft compiles use a coarser grid). Default 1. */
  coarse?: number;
  /** Already computed `worldBounds(project)`, to save recomputing it. */
  bounds?: ReturnType<typeof worldBounds>;
}

export function buildTerrainField(project: CreateProject, kit: CreateKit, options: TerrainFieldOptions = {}): TerrainField {
  const settings = project.terrain;
  if (!settings.enabled) return emptyTerrainField();

  const wb = options.bounds ?? worldBounds(project);
  const margin = Math.max(0, settings.margin);
  let cell = Math.max(50, settings.cellSize) * Math.max(1, options.coarse ?? 1);
  const spanX = wb.maxX - wb.minX + margin * 2;
  const spanZ = wb.maxZ - wb.minZ + margin * 2;
  // A huge world coarsens the grid, in quarter-octave steps so that dragging a point does not re-lattice everything.
  const needed = Math.max(spanX, spanZ) / (MAX_GRID_DIM - 1);
  if (needed > cell) cell *= Math.pow(2, Math.ceil(Math.log2(needed / cell) * 4) / 4);
  // Snap the origin to the cell grid so the lattice does not swim while the design is edited.
  const x0 = Math.floor((wb.minX - margin) / cell) * cell;
  const z0 = Math.floor((wb.minZ - margin) / cell) * cell;
  const cols = Math.ceil((wb.maxX + margin - x0) / cell) + 1;
  const rows = Math.ceil((wb.maxZ + margin - z0) / cell) + 1;
  const count = cols * rows;

  const base = kit.resolveSurface(settings.surface, project.themeId);
  const surfaceIds: string[] = [base.id];
  const surfaceIndex = new Uint8Array(count);
  const natural = new Float32Array(count).fill(settings.baseHeight);

  // ── 1. strokes, in order ──────────────────────────────────────────────────────────────────
  for (const stroke of project.terrainStrokes) {
    if (stroke.kind === 'paint') {
      const index = stroke.surface ? pickSurfaceIndex({ surfaceIds }, kit.resolveSurface(stroke.surface, project.themeId).id) : 0;
      applyPaint(surfaceIndex, cols, rows, x0, z0, cell, stroke.radius, stroke.points, index);
    } else {
      applySculpt(natural, cols, rows, x0, z0, cell, stroke);
    }
  }

  // ── 2. flatten under and around roads ─────────────────────────────────────────────────────
  const bestE = new Float32Array(count).fill(Infinity);
  const roadY = new Float32Array(count);
  const bestF = new Float32Array(count);
  const naturalAt = (x: number, z: number): number => {
    const fx = clamp((x - x0) / cell, 0, cols - 1);
    const fz = clamp((z - z0) / cell, 0, rows - 1);
    const i = Math.min(Math.floor(fx), cols - 2);
    const j = Math.min(Math.floor(fz), rows - 2);
    const tx = fx - i;
    const tz = fz - j;
    return (
      natural[j * cols + i] * (1 - tx) * (1 - tz) +
      natural[j * cols + i + 1] * tx * (1 - tz) +
      natural[(j + 1) * cols + i] * (1 - tx) * tz +
      natural[(j + 1) * cols + i + 1] * tx * tz
    );
  };
  const ring = cell * 1.2;
  const F0 = Math.max(FALLOFF_MIN, cell * 1.5);
  for (const road of project.roads) {
    for (const range of sectionRanges(road)) {
      if (range.kind !== 'road' && range.kind !== 'tunnel') continue;
      const samples = sampleRoadRange(road, range.from, range.to, { step: Math.max(300, cell * 1.6), maxAngleDegrees: 14 });
      for (let k = 0; k + 1 < samples.length; k++) {
        const s0 = samples[k];
        const s1 = samples[k + 1];
        const f0 = footprintHalfWidth(s0, range);
        const f1 = footprintHalfWidth(s1, range);
        const ax = s0.position.x;
        const az = s0.position.z;
        const bx = s1.position.x;
        const bz = s1.position.z;
        // How far the ground has to climb or sink to meet the road here decides how wide the blend is.
        const midY = (s0.position.y + s1.position.y) / 2 - TERRAIN_SINK;
        const delta = Math.abs(naturalAt((ax + bx) / 2, (az + bz) / 2) - midY);
        const segFalloff = clamp(delta * 1.5, F0, FALLOFF_MAX);
        const reach = Math.max(f0, f1) + ring + segFalloff;
        const reach2 = reach * reach;
        const iMin = Math.max(0, Math.floor((Math.min(ax, bx) - reach - x0) / cell));
        const iMax = Math.min(cols - 1, Math.ceil((Math.max(ax, bx) + reach - x0) / cell));
        const jMin = Math.max(0, Math.floor((Math.min(az, bz) - reach - z0) / cell));
        const jMax = Math.min(rows - 1, Math.ceil((Math.max(az, bz) + reach - z0) / cell));
        const dx = bx - ax;
        const dz = bz - az;
        const len2 = dx * dx + dz * dz;
        for (let j = jMin; j <= jMax; j++) {
          const pz = z0 + j * cell;
          for (let i = iMin; i <= iMax; i++) {
            const px = x0 + i * cell;
            let t = len2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const cx = ax + dx * t;
            const cz = az + dz * t;
            const ddx = px - cx;
            const ddz = pz - cz;
            const d2 = ddx * ddx + ddz * ddz;
            if (d2 > reach2) continue;
            const d = Math.sqrt(d2);
            const foot = f0 + (f1 - f0) * t;
            const e = d - foot;
            const idx = j * cols + i;
            if (e >= bestE[idx]) continue;
            bestE[idx] = e;
            bestF[idx] = segFalloff;
            // Surface height of the road at this lateral position (honours bank).
            const rx = s0.right.x + (s1.right.x - s0.right.x) * t;
            const ry = s0.right.y + (s1.right.y - s0.right.y) * t;
            const rz = s0.right.z + (s1.right.z - s0.right.z) * t;
            const rh = Math.hypot(rx, rz) || 1;
            const lat = clamp(((px - cx) * rx + (pz - cz) * rz) / rh, -foot, foot);
            roadY[idx] = s0.position.y + (s1.position.y - s0.position.y) * t + (ry / rh) * lat;
          }
        }
      }
    }
  }

  const heights = new Float32Array(count);
  const sunk = new Uint8Array(count);
  for (let idx = 0; idx < count; idx++) {
    const e = bestE[idx];
    const nat = natural[idx];
    if (!Number.isFinite(e)) {
      heights[idx] = nat;
      continue;
    }
    const target = roadY[idx] - TERRAIN_SINK;
    if (e <= ring) {
      heights[idx] = target;
      sunk[idx] = 1;
      continue;
    }
    const delta = Math.abs(nat - target);
    const falloff = Math.min(clamp(delta * 1.5, F0, FALLOFF_MAX), bestF[idx]);
    const t = (e - ring) / falloff;
    if (t >= 1) heights[idx] = nat;
    else {
      const w = 1 - smoothstep(t);
      heights[idx] = nat + (target - nat) * w;
    }
  }

  // ── 2b. the zone under bridges and gaps ────────────────────────────────────────────────────
  const voidZone = new Uint8Array(count);
  const voidDeck = new Float32Array(count);
  const voidNear = new Float32Array(count).fill(Infinity);
  const voidDepth = new Float32Array(count);
  for (const road of project.roads) {
    for (const range of sectionRanges(road)) {
      if (range.kind !== 'bridge' && range.kind !== 'gap') continue;
      const samples = sampleRoadRange(road, range.from, range.to, { step: Math.max(300, cell * 1.6), maxAngleDegrees: 14 });
      for (let k = 0; k + 1 < samples.length; k++) {
        const s0 = samples[k];
        const s1 = samples[k + 1];
        const f0 = footprintHalfWidth(s0, range) + FALL_RIBBON_MARGIN;
        const f1 = footprintHalfWidth(s1, range) + FALL_RIBBON_MARGIN;
        const reach = Math.max(f0, f1);
        const ax = s0.position.x;
        const az = s0.position.z;
        const bx = s1.position.x;
        const bz = s1.position.z;
        const iMin = Math.max(0, Math.floor((Math.min(ax, bx) - reach - x0) / cell));
        const iMax = Math.min(cols - 1, Math.ceil((Math.max(ax, bx) + reach - x0) / cell));
        const jMin = Math.max(0, Math.floor((Math.min(az, bz) - reach - z0) / cell));
        const jMax = Math.min(rows - 1, Math.ceil((Math.max(az, bz) + reach - z0) / cell));
        const dx = bx - ax;
        const dz = bz - az;
        const len2 = dx * dx + dz * dz;
        for (let j = jMin; j <= jMax; j++) {
          const pz = z0 + j * cell;
          for (let i = iMin; i <= iMax; i++) {
            const px = x0 + i * cell;
            let t = len2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ddx = px - (ax + dx * t);
            const ddz = pz - (az + dz * t);
            const lim = f0 + (f1 - f0) * t;
            const d2 = ddx * ddx + ddz * ddz;
            if (d2 > lim * lim) continue;
            const idx = j * cols + i;
            voidZone[idx] = 1;
            if (d2 < voidNear[idx]) {
              voidNear[idx] = d2;
              voidDeck[idx] = s0.position.y + (s1.position.y - s0.position.y) * t;
              voidDepth[idx] = range.kind === 'gap' ? GAP_PIT_DEPTH : BRIDGE_PIT_DEPTH;
            }
          }
        }
      }
    }
  }

  // Dig the chasm: under a bridge or gap the ground falls away, except where another road runs underneath.
  for (let idx = 0; idx < count; idx++) {
    if (!voidZone[idx] || sunk[idx]) continue;
    const floor = voidDeck[idx] - voidDepth[idx];
    if (heights[idx] > floor) heights[idx] = floor;
  }

  // ── 3. ponds: water and lava sit lower than the ground around them ───────────────────────
  const liquid = new Uint8Array(surfaceIds.length);
  surfaceIds.forEach((id, i) => {
    const s = kit.surface(id);
    if (s && (s.category === 'water' || s.category === 'lava')) liquid[i] = 1;
  });
  if (liquid.some((v) => v === 1)) {
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const idx = j * cols + i;
        if (!liquid[surfaceIndex[idx]] || sunk[idx]) continue;
        let edgeCase = false;
        if (i > 0 && !liquid[surfaceIndex[idx - 1]]) edgeCase = true;
        if (i < cols - 1 && !liquid[surfaceIndex[idx + 1]]) edgeCase = true;
        if (j > 0 && !liquid[surfaceIndex[idx - cols]]) edgeCase = true;
        if (j < rows - 1 && !liquid[surfaceIndex[idx + cols]]) edgeCase = true;
        heights[idx] -= edgeCase ? POND_DEPTH * 0.5 : POND_DEPTH;
      }
    }
  }

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    if (heights[i] < minY) minY = heights[i];
    if (heights[i] > maxY) maxY = heights[i];
  }

  const field: TerrainField = {
    enabled: true,
    cell,
    cols,
    rows,
    x0,
    z0,
    heights,
    surfaceIndex,
    surfaceIds,
    sunk,
    voidZone,
    minY,
    maxY,
    heightAt(x: number, z: number) {
      const fx = clamp((x - x0) / cell, 0, cols - 1);
      const fz = clamp((z - z0) / cell, 0, rows - 1);
      const i = Math.min(Math.floor(fx), cols - 2);
      const j = Math.min(Math.floor(fz), rows - 2);
      const tx = fx - i;
      const tz = fz - j;
      const h00 = heights[j * cols + i];
      const h10 = heights[j * cols + i + 1];
      const h01 = heights[(j + 1) * cols + i];
      const h11 = heights[(j + 1) * cols + i + 1];
      return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
    },
  };
  return field;
}

function applyPaint(
  surfaceIndex: Uint8Array,
  cols: number,
  rows: number,
  x0: number,
  z0: number,
  cell: number,
  radius: number,
  points: Vec2[],
  value: number,
): void {
  for (const [a, b] of strokeSegments(points)) {
    const iMin = Math.max(0, Math.floor((Math.min(a.x, b.x) - radius - x0) / cell));
    const iMax = Math.min(cols - 1, Math.ceil((Math.max(a.x, b.x) + radius - x0) / cell));
    const jMin = Math.max(0, Math.floor((Math.min(a.z, b.z) - radius - z0) / cell));
    const jMax = Math.min(rows - 1, Math.ceil((Math.max(a.z, b.z) + radius - z0) / cell));
    for (let j = jMin; j <= jMax; j++) {
      for (let i = iMin; i <= iMax; i++) {
        if (distToSegment(x0 + i * cell, z0 + j * cell, a.x, a.z, b.x, b.z) <= radius) surfaceIndex[j * cols + i] = value;
      }
    }
  }
}

function applySculpt(
  heights: Float32Array,
  cols: number,
  rows: number,
  x0: number,
  z0: number,
  cell: number,
  stroke: Extract<TerrainStroke, { kind: 'sculpt' }>,
): void {
  const radius = stroke.radius;
  if (radius <= 0) return;
  const source = stroke.mode === 'smooth' ? heights.slice() : null;
  const spacing = Math.max(radius * 0.3, cell * 0.5);
  const stamp = (cx: number, cz: number) => {
    const iMin = Math.max(0, Math.floor((cx - radius - x0) / cell));
    const iMax = Math.min(cols - 1, Math.ceil((cx + radius - x0) / cell));
    const jMin = Math.max(0, Math.floor((cz - radius - z0) / cell));
    const jMax = Math.min(rows - 1, Math.ceil((cz + radius - z0) / cell));
    for (let j = jMin; j <= jMax; j++) {
      for (let i = iMin; i <= iMax; i++) {
        const d = Math.hypot(x0 + i * cell - cx, z0 + j * cell - cz);
        if (d >= radius) continue;
        const f = smoothstep(1 - d / radius);
        const idx = j * cols + i;
        switch (stroke.mode) {
          case 'raise':
            heights[idx] += stroke.strength * f;
            break;
          case 'lower':
            heights[idx] -= stroke.strength * f;
            break;
          case 'flatten':
            heights[idx] += ((stroke.targetHeight ?? 0) - heights[idx]) * Math.min(1, f);
            break;
          case 'smooth': {
            const src = source as Float32Array;
            let sum = 0;
            let n = 0;
            if (i > 0) { sum += src[idx - 1]; n++; }
            if (i < cols - 1) { sum += src[idx + 1]; n++; }
            if (j > 0) { sum += src[idx - cols]; n++; }
            if (j < rows - 1) { sum += src[idx + cols]; n++; }
            if (n > 0) heights[idx] += (sum / n - heights[idx]) * Math.min(1, f * 0.6);
            break;
          }
        }
      }
    }
  };
  for (const [a, b] of strokeSegments(stroke.points)) {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / spacing));
    for (let k = 0; k <= n; k++) {
      const t = n === 0 ? 0 : k / n;
      stamp(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Meshes and collision
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface TerrainGeometryResult {
  meshes: CompiledGeometry['meshes'];
  collision: CollisionBuilder;
}

function surfaceFlagFor(surface: KitSurface): number {
  // Water and lava must always end the run; honour the kit's flag when it already does.
  if (surface.category === 'water' || surface.category === 'lava') {
    const t = surface.kclFlag & 0x1f;
    if (t === KCL_TYPE.SOLID_FALL || t === KCL_TYPE.FALL_BOUNDARY || t === KCL_TYPE.MOVING_WATER) return surface.kclFlag;
    return (surface.kclFlag & ~0x1f) | KCL_TYPE.FALL_BOUNDARY;
  }
  return surface.kclFlag;
}

/**
 * Turns the field into render meshes (one per surface) and collision triangles. Paint boundaries
 * follow 45° diagonals: each cell picks the diagonal that keeps the most triangles single-surface.
 */
export function buildTerrainGeometry(field: TerrainField, project: CreateProject, kit: CreateKit): TerrainGeometryResult {
  const mb = new MeshBuilder('terrain', 'terrain', createMeshLight(kit, project.themeId, TERRAIN_RELIEF));
  const cb = new CollisionBuilder();
  if (!field.enabled || field.cols < 2 || field.rows < 2) return { meshes: [], collision: cb };
  const { cols, rows, cell, x0, z0, heights, surfaceIndex, surfaceIds, voidZone, sunk } = field;
  const count = cols * rows;

  const surfaces: KitSurface[] = surfaceIds.map((id) => kit.surface(id) ?? kit.resolveSurface(project.terrain.surface, project.themeId));
  const flags = surfaces.map(surfaceFlagFor);
  const localIndex: Array<Int32Array | null> = surfaceIds.map(() => null);
  const idsOf = surfaces.map((s) => s.id);
  const invU = surfaces.map((s) => 1 / s.textureWorldSize[0]);
  const invV = surfaces.map((s) => 1 / s.textureWorldSize[1]);

  // Smooth vertex normals from the height gradient, once for the whole grid.
  const normals = new Float32Array(count * 3);
  for (let j = 0; j < rows; j++) {
    const jl = j > 0 ? j - 1 : 0;
    const jr = j < rows - 1 ? j + 1 : rows - 1;
    for (let i = 0; i < cols; i++) {
      const il = i > 0 ? i - 1 : 0;
      const ir = i < cols - 1 ? i + 1 : cols - 1;
      const dhx = (heights[j * cols + ir] - heights[j * cols + il]) / ((ir - il) * cell);
      const dhz = (heights[jr * cols + i] - heights[jl * cols + i]) / ((jr - jl) * cell);
      const l = Math.sqrt(dhx * dhx + 1 + dhz * dhz);
      const o = (j * cols + i) * 3;
      normals[o] = -dhx / l;
      normals[o + 1] = 1 / l;
      normals[o + 2] = -dhz / l;
    }
  }

  const local = (surfaceId: number, v: number): number => {
    let cache = localIndex[surfaceId];
    if (!cache) {
      cache = new Int32Array(count).fill(-1);
      localIndex[surfaceId] = cache;
    }
    let li = cache[v];
    if (li < 0) {
      const i = v % cols;
      const j = (v - i) / cols;
      const px = x0 + i * cell;
      const pz = z0 + j * cell;
      const o = v * 3;
      li = mb.vertex(idsOf[surfaceId], px, heights[v], pz, normals[o], normals[o + 1], normals[o + 2], px * invU[surfaceId], pz * invV[surfaceId], 255);
      cache[v] = li;
    }
    return li;
  };

  const emit = (surfaceId: number, a: number, b: number, c: number) => {
    mb.triangle(idsOf[surfaceId], local(surfaceId, a), local(surfaceId, b), local(surfaceId, c));
    const ia = a % cols;
    const ib = b % cols;
    const ic = c % cols;
    cb.triangleUp(
      x0 + ia * cell, heights[a], z0 + (a - ia) / cols * cell,
      x0 + ib * cell, heights[b], z0 + (b - ib) / cols * cell,
      x0 + ic * cell, heights[c], z0 + (c - ic) / cols * cell,
      flags[surfaceId],
    );
  };

  const majority = (s0: number, s1: number, s2: number): number => (s0 === s1 || s0 === s2 ? s0 : s1 === s2 ? s1 : s0);

  // Flat, single-surface stretches of ground (the margins of the world) merge into big quads: they are
  // coplanar, so neighbouring finer triangles meet them without cracks, and the triangle count drops a lot.
  const cellCols = cols - 1;
  const cellRows = rows - 1;
  const covered = new Uint8Array(cellCols * cellRows);
  const flatHeight = new Float32Array(cellCols * cellRows);
  const flat = new Uint8Array(cellCols * cellRows);
  for (let j = 0; j < cellRows; j++) {
    for (let i = 0; i < cellCols; i++) {
      const v00 = j * cols + i;
      const v11 = v00 + cols + 1;
      const h = heights[v00];
      const s0 = surfaceIndex[v00];
      if (
        Math.abs(heights[v00 + 1] - h) < 0.02 &&
        Math.abs(heights[v00 + cols] - h) < 0.02 &&
        Math.abs(heights[v11] - h) < 0.02 &&
        surfaceIndex[v00 + 1] === s0 &&
        surfaceIndex[v00 + cols] === s0 &&
        surfaceIndex[v11] === s0 &&
        !sunk[v00] && !sunk[v00 + 1] && !sunk[v00 + cols] && !sunk[v11] &&
        !voidZone[v00] && !voidZone[v00 + 1] && !voidZone[v00 + cols] && !voidZone[v11]
      ) {
        flat[j * cellCols + i] = 1;
        flatHeight[j * cellCols + i] = h;
      }
    }
  }
  for (const size of [8, 4, 2]) {
    for (let bj = 0; bj + size <= cellRows; bj += size) {
      for (let bi = 0; bi + size <= cellCols; bi += size) {
        const first = bj * cellCols + bi;
        if (!flat[first] || covered[first]) continue;
        const h = flatHeight[first];
        const s0 = surfaceIndex[bj * cols + bi];
        let ok = true;
        for (let dj = 0; dj < size && ok; dj++) {
          for (let di = 0; di < size; di++) {
            const c = (bj + dj) * cellCols + bi + di;
            if (!flat[c] || covered[c] || Math.abs(flatHeight[c] - h) > 0.02 || surfaceIndex[(bj + dj) * cols + bi + di] !== s0) {
              ok = false;
              break;
            }
          }
        }
        if (!ok) continue;
        for (let dj = 0; dj < size; dj++) for (let di = 0; di < size; di++) covered[(bj + dj) * cellCols + bi + di] = 1;
        const xa = x0 + bi * cell;
        const xb = x0 + (bi + size) * cell;
        const za = z0 + bj * cell;
        const zb = z0 + (bj + size) * cell;
        const id = idsOf[s0];
        const q00 = mb.vertex(id, xa, h, za, 0, 1, 0, xa * invU[s0], za * invV[s0], 255);
        const q10 = mb.vertex(id, xb, h, za, 0, 1, 0, xb * invU[s0], za * invV[s0], 255);
        const q01 = mb.vertex(id, xa, h, zb, 0, 1, 0, xa * invU[s0], zb * invV[s0], 255);
        const q11 = mb.vertex(id, xb, h, zb, 0, 1, 0, xb * invU[s0], zb * invV[s0], 255);
        mb.facingQuad(id, q00, q10, q01, q11, 0, 1, 0);
        cb.triangleUp(xa, h, za, xa, h, zb, xb, h, zb, flags[s0]);
        cb.triangleUp(xa, h, za, xb, h, zb, xb, h, za, flags[s0]);
      }
    }
  }

  for (let j = 0; j + 1 < rows; j++) {
    for (let i = 0; i + 1 < cols; i++) {
      if (covered[j * cellCols + i]) continue;
      const v00 = j * cols + i;
      const v10 = v00 + 1;
      const v01 = v00 + cols;
      const v11 = v01 + 1;
      const s00 = surfaceIndex[v00];
      const s10 = surfaceIndex[v10];
      const s01 = surfaceIndex[v01];
      const s11 = surfaceIndex[v11];
      let useDiag1: boolean;
      if (s00 === s10 && s10 === s01 && s01 === s11) {
        // Uniform cell: pick the diagonal that follows the terrain best.
        useDiag1 = Math.abs(heights[v00] - heights[v11]) <= Math.abs(heights[v01] - heights[v10]);
      } else {
        const pure1 = (s00 === s01 && s01 === s11 ? 1 : 0) + (s00 === s11 && s11 === s10 ? 1 : 0); // diagonal v00-v11
        const pure2 = (s00 === s01 && s01 === s10 ? 1 : 0) + (s01 === s11 && s11 === s10 ? 1 : 0); // diagonal v01-v10
        if (pure1 !== pure2) useDiag1 = pure1 > pure2;
        else useDiag1 = Math.abs(heights[v00] - heights[v11]) <= Math.abs(heights[v01] - heights[v10]);
      }
      if (useDiag1) {
        emit(majority(s00, s01, s11), v00, v01, v11);
        emit(majority(s00, s11, s10), v00, v11, v10);
      } else {
        emit(majority(s00, s01, s10), v00, v01, v10);
        emit(majority(s01, s11, s10), v01, v11, v10);
      }
    }
  }
  return { meshes: mb.build(), collision: cb };
}

/** Invisible wall around the terrain, or a fall plane under it, depending on `boundary`. */
export function buildBoundaryCollision(field: TerrainField, project: CreateProject, cb: CollisionBuilder, bounds: BoundsAccumulator): void {
  if (!field.enabled) return;
  const x1 = field.x0;
  const x2 = field.x0 + (field.cols - 1) * field.cell;
  const z1 = field.z0;
  const z2 = field.z0 + (field.rows - 1) * field.cell;
  const lo = field.minY - 600;
  const hi = Math.max(field.maxY, bounds.max.y === -Infinity ? field.maxY : bounds.max.y) + 4000;
  if (project.terrain.boundary === 'wall') {
    // Inward-facing walls. Normal = (b-a)×(c-a).
    wallQuad(cb, x1, z1, x2, z1, lo, hi, FLAG_INVISIBLE_WALL, +1); // south wall faces +Z
    wallQuad(cb, x2, z1, x2, z2, lo, hi, FLAG_INVISIBLE_WALL, +1);
    wallQuad(cb, x2, z2, x1, z2, lo, hi, FLAG_INVISIBLE_WALL, +1);
    wallQuad(cb, x1, z2, x1, z1, lo, hi, FLAG_INVISIBLE_WALL, +1);
  } else {
    fallPlane(cb, x1 - 20000, z1 - 20000, x2 + 20000, z2 + 20000, field.minY - 2500);
  }
}

/** A vertical quad from (ax,az) to (bx,bz) between heights lo..hi. `facing` +1 = the side to the left of a→b. */
export function wallQuad(cb: CollisionBuilder, ax: number, az: number, bx: number, bz: number, lo: number, hi: number, flag: number, facing: 1 | -1): void {
  // Left of the direction a→b (looking down -Y... computed from the cross product below).
  // For a→b = +X, the triangle (a_lo, b_lo, a_hi) has normal (+X)×(+Y) = +Z.
  if (facing === 1) {
    cb.triangle(ax, lo, az, bx, lo, bz, ax, hi, az, flag);
    cb.triangle(bx, lo, bz, bx, hi, bz, ax, hi, az, flag);
  } else {
    cb.triangle(ax, lo, az, ax, hi, az, bx, lo, bz, flag);
    cb.triangle(bx, lo, bz, ax, hi, az, bx, hi, bz, flag);
  }
}

/** Large upward-facing fall-boundary rectangle. */
export function fallPlane(cb: CollisionBuilder, x1: number, z1: number, x2: number, z2: number, y: number): void {
  cb.triangleUp(x1, y, z1, x2, y, z1, x2, y, z2, FLAG_FALL_BOUNDARY);
  cb.triangleUp(x1, y, z1, x2, y, z2, x1, y, z2, FLAG_FALL_BOUNDARY);
}

export function terrainBoundsOf(field: TerrainField, bounds: BoundsAccumulator): void {
  if (!field.enabled) return;
  growBounds(bounds, field.x0, field.minY, field.z0);
  growBounds(bounds, field.x0 + (field.cols - 1) * field.cell, field.maxY, field.z0 + (field.rows - 1) * field.cell);
}
