/**
 * `buildKcl`: turns collision triangles into a `course.kcl` the game (and Kinoko) accepts.
 *
 * File layout, as the retail files have it and as `vendor/Kinoko/source/game/field/KColData.cc`
 * reads it:
 *
 *   0x00  header (0x3C bytes)
 *   0x3C  positions    f32 x3, deduplicated first vertices of the prisms
 *         normals      f32 x3, deduplicated face + edge normals
 *         prisms       16 bytes each, 1-based (the header points one slot *before* the first)
 *         octree       root grid of u32 cells, then 8-cell nodes, then the leaf lists
 *
 * A prism is a triangle stored as its first vertex, the face normal, three *outward* edge normals
 * and a height: the distance from the first vertex to the opposite edge, measured along that edge's
 * normal. The game never stores the other two vertices; it rebuilds them. The vertex order that
 * retail uses (verified on every prism of several retail files) is: for a triangle (a, b, c) whose
 * face normal is `(b - a) x (c - a)`, `enrm1` belongs to the edge c-a, `enrm2` to a-b and `enrm3`
 * to the opposite edge b-c. The face normal points to the side that is solid ("up" for a road).
 *
 * The octree: every prism is the triangle extruded `prismThickness` behind its face, and a sphere
 * query reaches up to `sphereRadius` around the cube it starts in, so a leaf lists every prism
 * whose extruded volume touches the leaf cube grown by `sphereRadius` (an exact SAT test). Cells
 * are subdivided while they hold more than `maxTrianglesPerLeaf` prisms.
 */

import type { BuildKcl, GeneratedCollision, KclBuildOptions } from '../types';
import { alignUp, ByteBuffer } from './byteBuffer';

/** Retail values (identical in all 32 Nintendo courses except one battle-stage variant). */
export const KCL_DEFAULT_PRISM_THICKNESS = 300;
export const KCL_DEFAULT_SPHERE_RADIUS = 250;
const DEFAULT_MAX_TRIANGLES_PER_LEAF = 16;
const DEFAULT_MIN_CUBE_SIZE = 512;
/// Room above the highest prism so a kart launched off a ramp stays inside the indexed volume.
const HEADROOM_ABOVE = 2000;

const HEADER_SIZE = 0x3c;
const MAX_INDEX = 0xffff;

export interface KclWriterOptions extends KclBuildOptions {
  /** Radius the header advertises and the octree is grown by. Default 250 (retail). */
  sphereRadius?: number;
}

export const buildKcl: BuildKcl = (collision: GeneratedCollision, options: KclBuildOptions = {}): Uint8Array => {
  const settings = options as KclWriterOptions;
  const thickness = settings.prismThickness ?? KCL_DEFAULT_PRISM_THICKNESS;
  const sphereRadius = settings.sphereRadius ?? KCL_DEFAULT_SPHERE_RADIUS;
  const maxPerLeaf = Math.max(1, settings.maxTrianglesPerLeaf ?? DEFAULT_MAX_TRIANGLES_PER_LEAF);
  const minCube = Math.max(1, nextPowerOfTwo(settings.minCubeSize ?? DEFAULT_MIN_CUBE_SIZE));

  const prisms = makePrisms(collision);
  if (prisms.count > MAX_INDEX - 1) {
    throw new Error(`Collision has ${prisms.count} usable triangles; a KCL file can index at most ${MAX_INDEX - 1}.`);
  }
  const tables = buildTables(prisms);
  const octree = buildOctree(prisms, thickness, sphereRadius, maxPerLeaf, minCube);
  return writeFile(prisms, tables, octree, thickness, sphereRadius);
};

// ---------------------------------------------------------------------------------------------
// Prisms
// ---------------------------------------------------------------------------------------------

interface Prisms {
  count: number;
  /** First vertex of each prism, 3 doubles. */
  origin: Float64Array;
  /** Face normal, then edge normals 1..3, 3 doubles each (12 per prism). */
  normals: Float64Array;
  /** Distance from the first vertex to the opposite edge. */
  height: Float64Array;
  /** All three vertices (9 doubles per prism), for the octree. */
  vertices: Float64Array;
  flags: Uint16Array;
}

function makePrisms(collision: GeneratedCollision): Prisms {
  const triangleCount = Math.floor(collision.indices.length / 3);
  const vertexCount = Math.floor(collision.positions.length / 3);
  const origin = new Float64Array(triangleCount * 3);
  const normals = new Float64Array(triangleCount * 12);
  const height = new Float64Array(triangleCount);
  const vertices = new Float64Array(triangleCount * 9);
  const flags = new Uint16Array(triangleCount);
  let count = 0;

  for (let t = 0; t < triangleCount; t++) {
    const ia = collision.indices[t * 3];
    const ib = collision.indices[t * 3 + 1];
    const ic = collision.indices[t * 3 + 2];
    if (ia >= vertexCount || ib >= vertexCount || ic >= vertexCount) {
      throw new Error(`Collision triangle ${t} references a vertex past the end of the position array.`);
    }
    // float32 -> float64 is exact; the file stores float32, so work with the rounded values.
    const ax = collision.positions[ia * 3], ay = collision.positions[ia * 3 + 1], az = collision.positions[ia * 3 + 2];
    const bx = collision.positions[ib * 3], by = collision.positions[ib * 3 + 1], bz = collision.positions[ib * 3 + 2];
    const cx = collision.positions[ic * 3], cy = collision.positions[ic * 3 + 1], cz = collision.positions[ic * 3 + 2];
    if (![ax, ay, az, bx, by, bz, cx, cy, cz].every(Number.isFinite)) continue;

    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    let fx = aby * acz - abz * acy;
    let fy = abz * acx - abx * acz;
    let fz = abx * acy - aby * acx;
    const area2 = Math.hypot(fx, fy, fz);
    if (!(area2 > 1e-3)) continue; // degenerate: a point or a line
    fx /= area2; fy /= area2; fz /= area2;

    // Outward edge normals, edge direction x face normal.
    const e2 = unit(aby * fz - abz * fy, abz * fx - abx * fz, abx * fy - aby * fx); // edge a->b
    const bcx = cx - bx, bcy = cy - by, bcz = cz - bz;
    const e3 = unit(bcy * fz - bcz * fy, bcz * fx - bcx * fz, bcx * fy - bcy * fx); // edge b->c
    const e1 = unit(-acy * fz + acz * fy, -acz * fx + acx * fz, -acx * fy + acy * fx); // edge c->a
    if (!e1 || !e2 || !e3) continue;

    const h = acx * e3[0] + acy * e3[1] + acz * e3[2];
    if (!(h > 1e-4)) continue;
    // The game rebuilds the other two vertices by dividing by (face x enrm) . enrm3; a sliver makes
    // that ill-conditioned, so drop triangles whose smallest angle is below ~0.01 degrees.
    const d1 = Math.abs(dotCross(fx, fy, fz, e1, e3));
    const d2 = Math.abs(dotCross(fx, fy, fz, e2, e3));
    if (d1 < 2e-4 || d2 < 2e-4) continue;

    const k = count++;
    origin.set([ax, ay, az], k * 3);
    normals.set([fx, fy, fz, ...e1, ...e2, ...e3], k * 12);
    height[k] = h;
    vertices.set([ax, ay, az, bx, by, bz, cx, cy, cz], k * 9);
    flags[k] = collision.flags[t] ?? 0;
  }
  return { count, origin, normals, height, vertices, flags };
}

function unit(x: number, y: number, z: number): [number, number, number] | null {
  const length = Math.hypot(x, y, z);
  if (!(length > 1e-9)) return null;
  return [x / length, y / length, z / length];
}

/** ((face x edge) . opposite), the divisor the game uses to rebuild a vertex. */
function dotCross(fx: number, fy: number, fz: number, edge: [number, number, number], opposite: [number, number, number]): number {
  const cx = fy * edge[2] - fz * edge[1];
  const cy = fz * edge[0] - fx * edge[2];
  const cz = fx * edge[1] - fy * edge[0];
  return cx * opposite[0] + cy * opposite[1] + cz * opposite[2];
}

// ---------------------------------------------------------------------------------------------
// Position and normal tables
// ---------------------------------------------------------------------------------------------

interface Tables {
  positions: Float32Array;
  normals: Float32Array;
  /** Per prism: position index, face normal index, edge normal indices 1..3. */
  positionIndex: Uint16Array;
  normalIndex: Uint16Array;
}

function buildTables(prisms: Prisms): Tables {
  const positionPool = new Map<string, number>();
  const positions: number[] = [];
  const positionIndex = new Uint16Array(prisms.count);

  const addPosition = (x: number, y: number, z: number): number => {
    const key = `${x},${y},${z}`;
    let index = positionPool.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      positionPool.set(key, index);
      positions.push(x, y, z);
    }
    return index;
  };
  for (let k = 0; k < prisms.count; k++) {
    positionIndex[k] = addPosition(Math.fround(prisms.origin[k * 3]), Math.fround(prisms.origin[k * 3 + 1]), Math.fround(prisms.origin[k * 3 + 2]));
    if (positions.length / 3 > MAX_INDEX) {
      throw new Error('Collision has more than 65535 distinct first vertices; a KCL file cannot index them. Reduce the collision mesh.');
    }
  }

  // Normals: exact deduplication first; if a curved mesh makes more than 65535 distinct normals,
  // snap them to a coarser angular grid until they fit.
  let tables: { normals: number[]; normalIndex: Uint16Array } | null = null;
  for (const bits of [Infinity, 16, 14, 12, 10, 8]) {
    tables = tryNormals(prisms, bits);
    if (tables) break;
  }
  if (!tables) throw new Error('Collision has too many distinct surface directions for a KCL file even after snapping. Simplify the mesh.');
  return { positions: new Float32Array(positions), normals: new Float32Array(tables.normals), positionIndex, normalIndex: tables.normalIndex };
}

function tryNormals(prisms: Prisms, bits: number): { normals: number[]; normalIndex: Uint16Array } | null {
  const pool = new Map<string, number>();
  const normals: number[] = [];
  const normalIndex = new Uint16Array(prisms.count * 4);
  const scale = Number.isFinite(bits) ? 2 ** bits : 0;
  for (let k = 0; k < prisms.count; k++) {
    for (let n = 0; n < 4; n++) {
      let x = prisms.normals[k * 12 + n * 3];
      let y = prisms.normals[k * 12 + n * 3 + 1];
      let z = prisms.normals[k * 12 + n * 3 + 2];
      if (scale) {
        x = Math.round(x * scale) / scale;
        y = Math.round(y * scale) / scale;
        z = Math.round(z * scale) / scale;
        const length = Math.hypot(x, y, z) || 1;
        x /= length; y /= length; z /= length;
      }
      x = Math.fround(x); y = Math.fround(y); z = Math.fround(z);
      const key = `${x},${y},${z}`;
      let index = pool.get(key);
      if (index === undefined) {
        index = normals.length / 3;
        if (index > MAX_INDEX) return null;
        pool.set(key, index);
        normals.push(x, y, z);
      }
      normalIndex[k * 4 + n] = index;
    }
  }
  return { normals, normalIndex };
}

// ---------------------------------------------------------------------------------------------
// Octree
// ---------------------------------------------------------------------------------------------

interface OctreeCell {
  /** Sorted 1-based prism ids when the cell is a leaf. */
  leaf?: number[];
  children?: OctreeCell[];
}

interface Octree {
  areaMin: [number, number, number];
  /** Root grid size in cells and log2 of the cube edge. */
  cells: [number, number, number];
  shift: number;
  /** log2 of the covered range per axis. */
  rangeBits: [number, number, number];
  root: OctreeCell[];
}

/**
 * Per-prism separating-axis data, so testing a prism against many boxes is a handful of
 * multiplications: for 16 axes, the axis and the prism's projected interval, plus its AABB.
 */
const AXES = 16;
interface PrismSat {
  bounds: Float32Array; // min xyz, max xyz per prism (6)
  axes: Float32Array; // AXES * 3 per prism
  intervals: Float32Array; // AXES * 2 per prism
  valid: Uint8Array; // one flag per axis: 0 when the axis degenerated to a zero vector
}

function buildSat(prisms: Prisms, thickness: number): PrismSat {
  const n = prisms.count;
  const bounds = new Float32Array(n * 6);
  const axes = new Float32Array(n * AXES * 3);
  const intervals = new Float32Array(n * AXES * 2);
  const valid = new Uint8Array(n * AXES);
  const verts = new Float64Array(18);
  const axis = new Float64Array(3);
  const boxAxes: Array<[number, number, number]> = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  for (let k = 0; k < n; k++) {
    const fx = prisms.normals[k * 12], fy = prisms.normals[k * 12 + 1], fz = prisms.normals[k * 12 + 2];
    for (let v = 0; v < 3; v++) {
      for (let c = 0; c < 3; c++) {
        const value = prisms.vertices[k * 9 + v * 3 + c];
        verts[v * 3 + c] = value;
        verts[9 + v * 3 + c] = value - thickness * prisms.normals[k * 12 + c];
      }
    }
    for (let c = 0; c < 3; c++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let v = 0; v < 6; v++) {
        lo = Math.min(lo, verts[v * 3 + c]);
        hi = Math.max(hi, verts[v * 3 + c]);
      }
      bounds[k * 6 + c] = lo;
      bounds[k * 6 + 3 + c] = hi;
    }
    // Axis list: face normal, 3 side normals, 3 edges x 3 box axes, face normal x 3 box axes.
    let slot = 0;
    const put = (x: number, y: number, z: number): void => {
      const length = Math.hypot(x, y, z);
      const index = k * AXES + slot++;
      if (!(length > 1e-6)) return; // leave invalid
      axis[0] = x / length; axis[1] = y / length; axis[2] = z / length;
      let lo = Infinity;
      let hi = -Infinity;
      for (let v = 0; v < 6; v++) {
        const d = verts[v * 3] * axis[0] + verts[v * 3 + 1] * axis[1] + verts[v * 3 + 2] * axis[2];
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      axes[index * 3] = axis[0]; axes[index * 3 + 1] = axis[1]; axes[index * 3 + 2] = axis[2];
      intervals[index * 2] = lo;
      intervals[index * 2 + 1] = hi;
      valid[index] = 1;
    };
    put(fx, fy, fz);
    for (let e = 1; e <= 3; e++) put(prisms.normals[k * 12 + e * 3], prisms.normals[k * 12 + e * 3 + 1], prisms.normals[k * 12 + e * 3 + 2]);
    // Triangle edges a->b, b->c, c->a.
    for (let e = 0; e < 3; e++) {
      const p = e * 3;
      const q = ((e + 1) % 3) * 3;
      const dx = verts[q] - verts[p], dy = verts[q + 1] - verts[p + 1], dz = verts[q + 2] - verts[p + 2];
      for (const [bx, by, bz] of boxAxes) put(dy * bz - dz * by, dz * bx - dx * bz, dx * by - dy * bx);
    }
    for (const [bx, by, bz] of boxAxes) put(fy * bz - fz * by, fz * bx - fx * bz, fx * by - fy * bx);
  }
  return { bounds, axes, intervals, valid };
}

/** Exact SAT: does prism `k` (triangle extruded behind its face) touch the box? */
function prismTouchesBox(sat: PrismSat, k: number, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
  const eps = 0.5;
  const b = sat.bounds;
  const o = k * 6;
  if (b[o] > maxX + eps || b[o + 3] < minX - eps) return false;
  if (b[o + 1] > maxY + eps || b[o + 4] < minY - eps) return false;
  if (b[o + 2] > maxZ + eps || b[o + 5] < minZ - eps) return false;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const hx = (maxX - minX) / 2, hy = (maxY - minY) / 2, hz = (maxZ - minZ) / 2;
  for (let a = 0; a < AXES; a++) {
    const index = k * AXES + a;
    if (!sat.valid[index]) continue;
    const ax = sat.axes[index * 3], ay = sat.axes[index * 3 + 1], az = sat.axes[index * 3 + 2];
    const radius = hx * Math.abs(ax) + hy * Math.abs(ay) + hz * Math.abs(az);
    const centre = cx * ax + cy * ay + cz * az;
    if (sat.intervals[index * 2] > centre + radius + eps || sat.intervals[index * 2 + 1] < centre - radius - eps) return false;
  }
  return true;
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function log2(value: number): number {
  return Math.round(Math.log2(value));
}

function buildOctree(prisms: Prisms, thickness: number, sphereRadius: number, maxPerLeaf: number, minCube: number): Octree {
  const sat = buildSat(prisms, thickness);

  // Bounds of every prism volume, grown by the sphere radius like retail.
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < prisms.count; k++) {
    for (let c = 0; c < 3; c++) {
      lo[c] = Math.min(lo[c], sat.bounds[k * 6 + c]);
      hi[c] = Math.max(hi[c], sat.bounds[k * 6 + 3 + c]);
    }
  }
  if (prisms.count === 0) {
    lo.fill(0);
    hi.fill(0);
  }
  const areaMin = [0, 1, 2].map((c) => Math.fround(Math.floor(lo[c] - sphereRadius))) as [number, number, number];
  const extent = [0, 1, 2].map((c) => hi[c] + sphereRadius + (c === 1 ? HEADROOM_ABOVE : 0) - areaMin[c] + 1);
  const maxExtent = Math.max(...extent);

  let shift = Math.min(15, Math.max(12, Math.ceil(Math.log2(maxExtent / 8))));
  shift = Math.max(shift, log2(minCube));
  const rangeFor = (c: number, cubeShift: number) => Math.max(1 << cubeShift, nextPowerOfTwo(Math.ceil(extent[c])));
  for (;;) {
    const cells = [0, 1, 2].reduce((product, c) => product * (rangeFor(c, shift) >> shift), 1);
    if (cells <= 4096 || shift >= 24) break;
    shift++;
  }
  const ranges = [0, 1, 2].map((c) => rangeFor(c, shift));
  const cells = ranges.map((range) => range >> shift) as [number, number, number];
  const cube = 1 << shift;

  // Bucket prisms into the root cells their grown AABB overlaps, then refine each cell exactly.
  const rootCount = cells[0] * cells[1] * cells[2];
  const buckets: number[][] = Array.from({ length: rootCount }, () => []);
  for (let k = 0; k < prisms.count; k++) {
    const range = [0, 1, 2].map((c) => {
      const first = Math.max(0, Math.floor((sat.bounds[k * 6 + c] - sphereRadius - areaMin[c]) / cube));
      const last = Math.min(cells[c] - 1, Math.floor((sat.bounds[k * 6 + 3 + c] + sphereRadius - areaMin[c]) / cube));
      return [first, last];
    });
    for (let z = range[2][0]; z <= range[2][1]; z++) {
      for (let y = range[1][0]; y <= range[1][1]; y++) {
        for (let x = range[0][0]; x <= range[0][1]; x++) buckets[x + cells[0] * (y + cells[1] * z)].push(k);
      }
    }
  }

  const build = (candidates: number[], x: number, y: number, z: number, size: number): OctreeCell => {
    const minX = areaMin[0] + x - sphereRadius, minY = areaMin[1] + y - sphereRadius, minZ = areaMin[2] + z - sphereRadius;
    const maxX = areaMin[0] + x + size + sphereRadius, maxY = areaMin[1] + y + size + sphereRadius, maxZ = areaMin[2] + z + size + sphereRadius;
    const inside = candidates.filter((k) => prismTouchesBox(sat, k, minX, minY, minZ, maxX, maxY, maxZ));
    if (inside.length <= maxPerLeaf || size <= minCube) return { leaf: inside.map((k) => k + 1) };
    const half = size / 2;
    const children: OctreeCell[] = [];
    let reduced = false;
    const childLists: number[][] = [];
    for (let i = 0; i < 8; i++) {
      const cx = x + (i & 1) * half, cy = y + ((i >> 1) & 1) * half, cz = z + ((i >> 2) & 1) * half;
      const cMinX = areaMin[0] + cx - sphereRadius, cMinY = areaMin[1] + cy - sphereRadius, cMinZ = areaMin[2] + cz - sphereRadius;
      const list = inside.filter((k) => prismTouchesBox(sat, k, cMinX, cMinY, cMinZ, cMinX + half + 2 * sphereRadius, cMinY + half + 2 * sphereRadius, cMinZ + half + 2 * sphereRadius));
      if (list.length < inside.length) reduced = true;
      childLists.push(list);
    }
    // Subdividing a cell whose children all hold everything the parent does only wastes space.
    if (!reduced) return { leaf: inside.map((k) => k + 1) };
    for (let i = 0; i < 8; i++) {
      const cx = x + (i & 1) * half, cy = y + ((i >> 1) & 1) * half, cz = z + ((i >> 2) & 1) * half;
      children.push(build(childLists[i], cx, cy, cz, half));
    }
    return { children };
  };

  const root: OctreeCell[] = [];
  for (let z = 0; z < cells[2]; z++) {
    for (let y = 0; y < cells[1]; y++) {
      for (let x = 0; x < cells[0]; x++) {
        root.push(build(buckets[x + cells[0] * (y + cells[1] * z)], x * cube, y * cube, z * cube, cube));
      }
    }
  }
  return { areaMin, cells, shift, rangeBits: ranges.map(log2) as [number, number, number], root };
}

// ---------------------------------------------------------------------------------------------
// File
// ---------------------------------------------------------------------------------------------

function writeFile(prisms: Prisms, tables: Tables, octree: Octree, thickness: number, sphereRadius: number): Uint8Array {
  const positionCount = tables.positions.length / 3;
  const normalCount = tables.normals.length / 3;
  const positionOffset = HEADER_SIZE;
  const normalOffset = positionOffset + positionCount * 12;
  const firstPrism = normalOffset + normalCount * 12;
  const blockOffset = firstPrism + prisms.count * 16;

  const nodes = layoutOctree(octree);
  const total = alignUp(blockOffset + nodes.bytes, 4);
  const out = new ByteBuffer(total + 16);
  out.alloc(total);

  out.u32(0x00, positionOffset);
  out.u32(0x04, normalOffset);
  out.u32(0x08, firstPrism - 0x10);
  out.u32(0x0c, blockOffset);
  out.f32(0x10, thickness);
  out.f32(0x14, octree.areaMin[0]);
  out.f32(0x18, octree.areaMin[1]);
  out.f32(0x1c, octree.areaMin[2]);
  out.u32(0x20, (~((1 << octree.rangeBits[0]) - 1)) >>> 0);
  out.u32(0x24, (~((1 << octree.rangeBits[1]) - 1)) >>> 0);
  out.u32(0x28, (~((1 << octree.rangeBits[2]) - 1)) >>> 0);
  out.u32(0x2c, octree.shift);
  out.u32(0x30, octree.rangeBits[0] - octree.shift);
  out.u32(0x34, octree.rangeBits[0] - octree.shift + octree.rangeBits[1] - octree.shift);
  out.f32(0x38, sphereRadius);

  tables.positions.forEach((value, i) => out.f32(positionOffset + i * 4, value));
  tables.normals.forEach((value, i) => out.f32(normalOffset + i * 4, value));
  for (let k = 0; k < prisms.count; k++) {
    const at = firstPrism + k * 16;
    out.f32(at, prisms.height[k]);
    out.u16(at + 4, tables.positionIndex[k]);
    out.u16(at + 6, tables.normalIndex[k * 4]);
    out.u16(at + 8, tables.normalIndex[k * 4 + 1]);
    out.u16(at + 10, tables.normalIndex[k * 4 + 2]);
    out.u16(at + 12, tables.normalIndex[k * 4 + 3]);
    out.u16(at + 14, prisms.flags[k]);
  }
  nodes.write(out, blockOffset);
  return out.data.slice(0, total);
}

interface OctreeLayout {
  bytes: number;
  write(out: ByteBuffer, blockOffset: number): void;
}

/**
 * Nodes first (root grid, then every 8-cell node breadth first), then the leaf lists. A list is
 * stored as `[prev terminator][ids...][0]`; the leaf points at the u16 *before* its first id,
 * which in a packed run is the previous list's terminating zero. Identical lists are shared and
 * an empty list points at the very first u16 (two zeros in a row).
 */
function layoutOctree(octree: Octree): OctreeLayout {
  interface NodeArray { cells: OctreeCell[]; offset: number }
  const arrays: NodeArray[] = [{ cells: octree.root, offset: 0 }];
  let bytes = octree.root.length * 4;
  for (let i = 0; i < arrays.length; i++) {
    for (const cell of arrays[i].cells) {
      if (!cell.children) continue;
      arrays.push({ cells: cell.children, offset: bytes });
      bytes += 8 * 4;
    }
  }

  // Leaf lists.
  const lists = new Map<string, number>();
  const listOrder: number[][] = [];
  let listBytes = 4; // [dummy 0][0]: the shared empty list
  const listOffsets = new Map<OctreeCell, number>();
  const visit = (cells: OctreeCell[]): void => {
    for (const cell of cells) {
      if (cell.children) {
        visit(cell.children);
        continue;
      }
      const ids = cell.leaf ?? [];
      if (ids.length === 0) {
        listOffsets.set(cell, 0);
        continue;
      }
      const key = ids.join(',');
      let offset = lists.get(key);
      if (offset === undefined) {
        // Points at the previous terminator: the u16 right before this list's first id.
        offset = listBytes - 2;
        lists.set(key, offset);
        listOrder.push(ids);
        listBytes += ids.length * 2 + 2;
      }
      listOffsets.set(cell, offset);
    }
  };
  visit(octree.root);

  const listBase = alignUp(bytes, 4);
  return {
    bytes: listBase + alignUp(listBytes, 4),
    write(out, blockOffset) {
      // Child array offsets are assigned in the same breadth-first order as above.
      let next = 1;
      arrays.forEach((array) => {
        array.cells.forEach((cell, i) => {
          const at = blockOffset + array.offset + i * 4;
          if (cell.children) {
            const child = arrays[next++];
            out.u32(at, child.offset - array.offset);
          } else {
            out.u32(at, ((listBase + listOffsets.get(cell)! - array.offset) | 0x80000000) >>> 0);
          }
        });
      });
      let cursor = blockOffset + listBase + 4;
      for (const ids of listOrder) {
        for (const id of ids) {
          out.u16(cursor, id);
          cursor += 2;
        }
        out.u16(cursor, 0);
        cursor += 2;
      }
    },
  };
}
