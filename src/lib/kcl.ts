import { BinReader } from './binary';
import { buildTriangleBvh, type RayHit, type TriangleBvh } from './kclRaycast';
import type { Vec3 } from './kmp';

export interface KclTriangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  /** The raw 16-bit collision flag word. Use {@link describeKclFlag} to decode it. */
  flag: number;
  /** Name of the base collision type (`flag & 0x1F`). */
  typeName: string;
  normal: Vec3;
  /**
   * Index of this prism in the KCL's own triangle section. Degenerate prisms are dropped
   * during parsing, so this is not the same as the index in {@link KclMesh.triangles}, and
   * it is what the KCL octree stores. Meshes built by hand may leave it undefined.
   */
  prismIndex?: number;
}

/** The fixed 0x3C-byte KCL header, as documented on https://wiki.tockdom.com/wiki/KCL. */
export interface KclHeader {
  positionOffset: number;
  normalOffset: number;
  /** Raw value at 0x08. Real triangle data starts at `triangleOffset + 0x10`. */
  triangleOffset: number;
  octreeOffset: number;
  /** How far the collision extends behind each face. */
  thickness: number;
  /** World-space corner the octree grid starts at. */
  areaMin: Vec3;
  xMask: number;
  yMask: number;
  zMask: number;
  /** log2 of the octree's leaf cell size. */
  coordShift: number;
  yShift: number;
  zShift: number;
  /** Radius used by the game's sphere-vs-prism test. */
  sphereRadius: number;
}

export interface KclMesh {
  triangles: KclTriangle[];
  warnings: string[];
  header?: KclHeader;
  /** The file bytes, kept so the octree can be queried without re-parsing. */
  source?: Uint8Array;
  /** Number of prisms in the KCL, including any that were dropped as degenerate. */
  prismCount?: number;
}

export interface KclFeatureSnapResult {
  position: Vec3;
  kind: 'vertex' | 'edge';
}

export const collisionTypes = [
  'Road',
  'Slippery Road (sand/dirt)',
  'Weak Off-Road',
  'Off-Road',
  'Heavy Off-Road',
  'Slippery Road (ice)',
  'Boost Panel',
  'Boost Ramp',
  'Slow Ramp',
  'Item Road',
  'Solid Fall',
  'Moving Water',
  'Wall',
  'Invisible Wall',
  'Item Wall',
  'Wall 2',
  'Fall Boundary',
  'Cannon Activator',
  'Force Recalculation',
  'Half-pipe Ramp',
  'Player-Only Wall',
  'Moving Road',
  'Sticky Road',
  'Road 2',
  'Sound Trigger',
  'Weak Wall',
  'Effect Trigger',
  'Item State Modifier',
  'Half-pipe Invis Wall',
  'Rotating Road',
  'Special Wall',
  'Invisible Wall 2',
];

/** Base collision types that stop a kart. */
const WALL_TYPES = new Set([0x0c, 0x0d, 0x0e, 0x0f, 0x14, 0x19, 0x1c, 0x1e, 0x1f]);
/** Base collision types a kart drives on. */
const DRIVABLE_TYPES = new Set([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x13, 0x15, 0x16, 0x17, 0x1d]);
/** Base collision types that are pure triggers with no physical surface. */
const TRIGGER_TYPES = new Set([0x10, 0x11, 0x12, 0x18, 0x1a, 0x1b]);

/**
 * Overlay colours, chosen so that roads, off-road, walls, hazards and triggers each read as
 * a family and stay distinguishable for the common forms of colour blindness.
 */
const COLLISION_TYPE_COLORS: Array<[number, number, number]> = [
  [0x9a, 0x9a, 0xa4], // 00 Road
  [0xc9, 0xa8, 0x6a], // 01 Slippery road (sand/dirt)
  [0x9f, 0xc0, 0x7a], // 02 Weak off-road
  [0x6f, 0xa2, 0x4e], // 03 Off-road
  [0x44, 0x70, 0x33], // 04 Heavy off-road
  [0xa8, 0xd8, 0xe8], // 05 Slippery road (ice)
  [0xff, 0xd7, 0x33], // 06 Boost panel
  [0xff, 0x9d, 0x2e], // 07 Boost ramp
  [0xff, 0xc0, 0x7a], // 08 Slow ramp
  [0xb2, 0x9a, 0xe0], // 09 Item road
  [0x8b, 0x2f, 0x2f], // 0A Solid fall
  [0x4a, 0x8f, 0xd6], // 0B Moving water
  [0xd8, 0xd2, 0xc4], // 0C Wall
  [0x7d, 0x7d, 0x8c], // 0D Invisible wall
  [0x9a, 0x7f, 0xc4], // 0E Item wall
  [0xc4, 0xbd, 0xac], // 0F Wall 2
  [0xe2, 0x3b, 0x3b], // 10 Fall boundary
  [0xff, 0x7a, 0xc8], // 11 Cannon activator
  [0x4f, 0xd6, 0xd0], // 12 Force recalculation
  [0x8f, 0x6a, 0xd6], // 13 Half-pipe ramp
  [0xe8, 0x8f, 0x8f], // 14 Player-only wall
  [0x3f, 0xb5, 0xa8], // 15 Moving road
  [0xc7, 0xb0, 0x3a], // 16 Sticky road
  [0x86, 0x86, 0x92], // 17 Road 2
  [0xf0, 0xf0, 0xf0], // 18 Sound trigger
  [0xe6, 0xdc, 0xc0], // 19 Weak wall
  [0xff, 0xe9, 0xa8], // 1A Effect trigger
  [0x7a, 0xc8, 0xff], // 1B Item state modifier
  [0xa0, 0x8a, 0xd6], // 1C Half-pipe invisible wall
  [0x3f, 0xa8, 0x9a], // 1D Rotating road
  [0xba, 0xa8, 0x8c], // 1E Special wall
  [0x6b, 0x6b, 0x7a], // 1F Invisible wall 2
];

export interface KclFlagInfo {
  /** `flag & 0x1F`. */
  basicType: number;
  /** Friendly name of the basic type. */
  typeName: string;
  /** `(flag >> 5) & 0x07` — the per-type variant, e.g. which off-road surface sound plays. */
  variant: number;
  /** `(flag >> 8) & 0x07` — which `posteffect` light/shadow set applies. */
  blightEffect: number;
  /** `(flag >> 11) & 0x03` — how deep the wheels sink. */
  wheelDepth: number;
  /** Bit 13: the surface grants a trick when jumped off. */
  trickable: boolean;
  /** Bit 15: karts pass through the wall but bikes do not (used for barrel-roll walls). */
  softWall: boolean;
  /** True for surfaces a kart drives on. */
  drivable: boolean;
  /** True for surfaces that block a kart. */
  wall: boolean;
  /** True for non-physical trigger volumes (sound, effect, cannon, fall boundary). */
  trigger: boolean;
  /** Overlay colour as `[r, g, b]` in 0..255. */
  color: [number, number, number];
}

/** Friendly name of the base collision type held in the low 5 bits of a KCL flag. */
export function kclFlagName(flag: number): string {
  return collisionTypes[flag & 0x1f] ?? 'Unknown';
}

/** Overlay colour for a KCL flag, based on its base collision type. */
export function kclFlagColor(flag: number): [number, number, number] {
  return COLLISION_TYPE_COLORS[flag & 0x1f] ?? [0xff, 0x00, 0xff];
}

/** Decodes every documented bitfield of a KCL collision flag. */
export function describeKclFlag(flag: number): KclFlagInfo {
  const basicType = flag & 0x1f;
  return {
    basicType,
    typeName: kclFlagName(flag),
    variant: (flag >>> 5) & 0x07,
    blightEffect: (flag >>> 8) & 0x07,
    wheelDepth: (flag >>> 11) & 0x03,
    trickable: (flag & 0x2000) !== 0,
    softWall: (flag & 0x8000) !== 0,
    drivable: DRIVABLE_TYPES.has(basicType),
    wall: WALL_TYPES.has(basicType),
    trigger: TRIGGER_TYPES.has(basicType),
    color: kclFlagColor(flag),
  };
}

export function parseKcl(data: Uint8Array): KclMesh {
  const buffer = data.slice().buffer;
  const reader = new BinReader(buffer);
  const warnings: string[] = [];
  if (data.length < 0x3c) return { triangles: [], warnings: ['KCL file is too small.'] };

  const posOffset = reader.u32(0);
  const normOffset = reader.u32(4);
  const triOffset = reader.u32(8);
  const octreeOffset = reader.u32(12);
  if (posOffset >= data.length || normOffset >= data.length || triOffset >= data.length) {
    return { triangles: [], warnings: ['KCL header offsets are outside the file.'] };
  }

  const header: KclHeader = {
    positionOffset: posOffset,
    normalOffset: normOffset,
    triangleOffset: triOffset,
    octreeOffset,
    thickness: reader.f32(0x10),
    areaMin: readVec3(reader, 0x14),
    xMask: reader.u32(0x20),
    yMask: reader.u32(0x24),
    zMask: reader.u32(0x28),
    coordShift: reader.u32(0x2c),
    yShift: reader.u32(0x30),
    zShift: reader.u32(0x34),
    sphereRadius: data.length >= 0x3c ? reader.f32(0x38) : 0,
  };

  const positionCount = Math.max(0, Math.floor((normOffset - posOffset) / 12));
  const positions = Array.from({ length: positionCount }, (_, i) => readVec3(reader, posOffset + i * 12));
  // The triangle-section offset is stored biased by -0x10, so normals end and triangles
  // begin at `triOffset + 0x10`.
  const triangleStart = triOffset + 0x10;
  const normalEnd = Math.min(triangleStart, data.length);
  const normalCount = Math.max(0, Math.floor((normalEnd - normOffset) / 12));
  const normals = Array.from({ length: normalCount }, (_, i) => normalize(readVec3(reader, normOffset + i * 12)));
  const triangleEnd = Math.min(octreeOffset > triangleStart ? octreeOffset : data.length, data.length);
  const triangleCount = Math.max(0, Math.floor((triangleEnd - triangleStart) / 16));
  const triangles: KclTriangle[] = [];

  for (let i = 0; i < triangleCount; i++) {
    const offset = triangleStart + i * 16;
    const length = reader.f32(offset);
    const posIndex = reader.u16(offset + 4);
    const dirIndex = reader.u16(offset + 6);
    const normAIndex = reader.u16(offset + 8);
    const normBIndex = reader.u16(offset + 10);
    const normCIndex = reader.u16(offset + 12);
    const flag = reader.u16(offset + 14);
    if (!Number.isFinite(length) || length <= 0) continue;
    const origin = positions[posIndex];
    const direction = normals[dirIndex];
    const normalA = normals[normAIndex];
    const normalB = normals[normBIndex];
    const normalC = normals[normCIndex];
    if (!origin || !direction || !normalA || !normalB || !normalC) continue;

    const crossA = cross(normalA, direction);
    const crossB = cross(normalB, direction);
    const dotB = dot(crossB, normalC);
    const dotA = dot(crossA, normalC);
    if (Math.abs(dotA) < 1e-7 || Math.abs(dotB) < 1e-7) continue;

    const a = origin;
    const b = add(origin, scale(crossB, length / dotB));
    const c = add(origin, scale(crossA, length / dotA));
    if (!isFiniteVec(a) || !isFiniteVec(b) || !isFiniteVec(c)) continue;

    const normal = normalize(cross(sub(b, a), sub(c, a)));
    triangles.push({ a, b, c, flag, typeName: kclFlagName(flag), normal, prismIndex: i });
  }

  if (triangles.length === 0) warnings.push('KCL parsed, but no raycastable triangles were recovered.');
  if (octreeOffset >= data.length) warnings.push('KCL spatial index offset is outside the file.');
  // Degenerate prisms are common and harmless (KCL builders emit them for slivers), so they
  // are reported through `prismCount` rather than as a user-facing warning.
  return { triangles, warnings, header, source: data, prismCount: triangleCount };
}

// ---------------------------------------------------------------------------
// Raycasting
// ---------------------------------------------------------------------------

/**
 * BVHs are cached per mesh object rather than stored on it, so meshes built by hand in tests
 * or by other modules get the same acceleration without having to know it exists.
 */
const bvhCache = new WeakMap<KclMesh, { bvh: TriangleBvh; triangles: KclTriangle[] }>();

/** Returns the mesh's BVH, building it on first use. */
export function getKclBvh(mesh: KclMesh): TriangleBvh {
  const cached = bvhCache.get(mesh);
  if (cached && cached.triangles === mesh.triangles) return cached.bvh;
  const bvh = buildTriangleBvh(mesh.triangles);
  bvhCache.set(mesh, { bvh, triangles: mesh.triangles });
  return bvh;
}

const prismIndexCache = new WeakMap<KclMesh, { map: Map<number, number>; triangles: KclTriangle[] }>();

/** Maps a KCL prism index onto the index in `mesh.triangles`, skipping dropped prisms. */
function getPrismIndexMap(mesh: KclMesh): Map<number, number> {
  const cached = prismIndexCache.get(mesh);
  if (cached && cached.triangles === mesh.triangles) return cached.map;
  const map = new Map<number, number>();
  for (let i = 0; i < mesh.triangles.length; i++) map.set(mesh.triangles[i].prismIndex ?? i, i);
  prismIndexCache.set(mesh, { map, triangles: mesh.triangles });
  return map;
}

/** Discards a cached BVH, e.g. after mutating a mesh's triangle array in place. */
export function invalidateKclBvh(mesh: KclMesh): void {
  bvhCache.delete(mesh);
}

/** World-space bounding box of the collision mesh, or null when it is empty. */
export function kclBounds(mesh: KclMesh): { min: Vec3; max: Vec3 } | null {
  return getKclBvh(mesh).bounds();
}

export interface KclRayHit {
  position: Vec3;
  distance: number;
  triangle: KclTriangle;
  triangleIndex: number;
}

export function raycastMesh(mesh: KclMesh, origin: Vec3, direction: Vec3, maxDistance = Infinity): KclRayHit | null {
  const hit = getKclBvh(mesh).raycast(origin, direction, maxDistance);
  return toKclHit(mesh, hit);
}

/**
 * Drops a ray straight down onto the collision mesh and returns where it lands.
 * Starts above the mesh's own bounding box so tracks placed far from the origin still work.
 */
export function raycastDown(mesh: KclMesh, x: number, z: number, fromY?: number): Vec3 | null {
  const bvh = getKclBvh(mesh);
  const bounds = bvh.bounds();
  const startY = fromY ?? (bounds ? bounds.max.y + 1000 : 100000);
  return bvh.raycast({ x, y: startY, z }, { x: 0, y: -1, z: 0 })?.position ?? null;
}

/** Like {@link raycastDown} but also reports which surface was hit. */
export function raycastDownDetailed(mesh: KclMesh, x: number, z: number, fromY?: number): KclRayHit | null {
  const bvh = getKclBvh(mesh);
  const bounds = bvh.bounds();
  const startY = fromY ?? (bounds ? bounds.max.y + 1000 : 100000);
  return toKclHit(mesh, bvh.raycast({ x, y: startY, z }, { x: 0, y: -1, z: 0 }));
}

function toKclHit(mesh: KclMesh, hit: RayHit | null): KclRayHit | null {
  if (!hit) return null;
  return {
    position: hit.position as Vec3,
    distance: hit.distance,
    triangle: mesh.triangles[hit.triangleIndex],
    triangleIndex: hit.triangleIndex,
  };
}

/**
 * Finds the nearest vertex or edge point of a triangle, for hold-to-snap placement.
 * A vertex wins ties, since snapping to a corner is almost always what the user meant.
 */
export function snapPointToTriangleFeature(position: Vec3, triangle: KclTriangle): KclFeatureSnapResult {
  const vertices = [triangle.a, triangle.b, triangle.c];
  let bestVertex = vertices[0];
  let bestVertexDistanceSq = distanceSq(position, bestVertex);
  for (let i = 1; i < vertices.length; i++) {
    const candidateDistanceSq = distanceSq(position, vertices[i]);
    if (candidateDistanceSq < bestVertexDistanceSq) {
      bestVertex = vertices[i];
      bestVertexDistanceSq = candidateDistanceSq;
    }
  }

  const edgeCandidates = [
    closestPointOnSegment(position, triangle.a, triangle.b),
    closestPointOnSegment(position, triangle.b, triangle.c),
    closestPointOnSegment(position, triangle.c, triangle.a),
  ];
  let bestEdge = edgeCandidates[0];
  let bestEdgeDistanceSq = distanceSq(position, bestEdge);
  for (let i = 1; i < edgeCandidates.length; i++) {
    const candidateDistanceSq = distanceSq(position, edgeCandidates[i]);
    if (candidateDistanceSq < bestEdgeDistanceSq) {
      bestEdge = edgeCandidates[i];
      bestEdgeDistanceSq = candidateDistanceSq;
    }
  }

  return bestVertexDistanceSq <= bestEdgeDistanceSq ? { position: bestVertex, kind: 'vertex' } : { position: bestEdge, kind: 'edge' };
}

/**
 * Nearest vertex or edge across every triangle within `radius` of `position`. This is what
 * "hold to snap to edges and vertices" needs: the triangle under the cursor is often not the
 * one that owns the corner the user is aiming at.
 */
export function snapPointToNearestFeature(mesh: KclMesh, position: Vec3, radius: number): (KclFeatureSnapResult & { triangleIndex: number }) | null {
  const bvh = getKclBvh(mesh);
  const candidates = bvh.queryBox(
    { x: position.x - radius, y: position.y - radius, z: position.z - radius },
    { x: position.x + radius, y: position.y + radius, z: position.z + radius },
  );
  let best: (KclFeatureSnapResult & { triangleIndex: number }) | null = null;
  let bestDistanceSq = radius * radius;
  // Ties go to a vertex: when a corner and an edge are equally close, the user meant the corner.
  const epsilon = Math.max(1e-6, bestDistanceSq * 1e-9);
  for (const index of candidates) {
    const triangle = mesh.triangles[index];
    if (!triangle) continue;
    const feature = snapPointToTriangleFeature(position, triangle);
    const d = distanceSq(position, feature.position);
    if (d > bestDistanceSq) continue;
    const closer = d < bestDistanceSq - epsilon;
    const betterKind = !best || (feature.kind === 'vertex' && best.kind === 'edge');
    if (!closer && !betterKind) continue;
    bestDistanceSq = Math.min(bestDistanceSq, d);
    best = { ...feature, triangleIndex: index };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Octree
// ---------------------------------------------------------------------------

/**
 * Walks the KCL's own octree and returns the triangle indices the game would test at a
 * world position, or `null` when the position is outside the indexed volume.
 *
 * The editor raycasts with its own BVH (which covers the whole mesh and handles arbitrary
 * ray directions), but reading the octree is a strong check that the header offsets, masks
 * and shifts were parsed correctly, and it answers "what would the game collide with here?".
 *
 * The returned values index {@link KclMesh.triangles}, not the KCL's own prism list.
 */
export function kclOctreeLookup(mesh: KclMesh, position: Vec3): number[] | null {
  const header = mesh.header;
  const data = mesh.source;
  if (!header || !data) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const x = Math.trunc(position.x - header.areaMin.x);
  const y = Math.trunc(position.y - header.areaMin.y);
  const z = Math.trunc(position.z - header.areaMin.z);
  // The masks cover every bit above the indexed volume; a set bit means "outside".
  if ((x & header.xMask) !== 0 || (y & header.yMask) !== 0 || (z & header.zMask) !== 0) return null;
  if (x < 0 || y < 0 || z < 0) return null;

  let shift = header.coordShift;
  let blockOffset = header.octreeOffset;
  let index = ((z >>> shift) << header.zShift) | ((y >>> shift) << header.yShift) | (x >>> shift);

  for (let depth = 0; depth < 32; depth++) {
    const nodeOffset = blockOffset + index * 4;
    if (nodeOffset + 4 > data.length) return null;
    const value = view.getUint32(nodeOffset, false);
    if ((value & 0x80000000) !== 0) {
      let listOffset = blockOffset + (value & 0x7fffffff) + 2;
      const byPrism = getPrismIndexMap(mesh);
      const out: number[] = [];
      while (listOffset + 2 <= data.length) {
        const prism = view.getUint16(listOffset, false);
        // The list is 1-based and terminated by a zero entry.
        if (prism === 0) break;
        const triangleIndex = byPrism.get(prism - 1);
        if (triangleIndex !== undefined) out.push(triangleIndex);
        listOffset += 2;
      }
      return out;
    }
    blockOffset += value;
    shift -= 1;
    if (shift < 0) return null;
    index = (((z >>> shift) & 1) << 2) | (((y >>> shift) & 1) << 1) | ((x >>> shift) & 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

function readVec3(reader: BinReader, offset: number): Vec3 {
  return { x: reader.f32(offset), y: reader.f32(offset + 4), z: reader.f32(offset + 8) };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a: Vec3, value: number): Vec3 {
  return { x: a.x * value, y: a.y * value, z: a.z * value };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function distanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function closestPointOnSegment(point: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub(b, a);
  const abLengthSq = dot(ab, ab);
  if (abLengthSq <= 0.0000001) return a;
  const t = clamp01(dot(sub(point, a), ab) / abLengthSq);
  return add(a, scale(ab, t));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalize(a: Vec3): Vec3 {
  const length = Math.hypot(a.x, a.y, a.z);
  return length > 0 ? scale(a, 1 / length) : { x: 0, y: 0, z: 0 };
}

function isFiniteVec(a: Vec3): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
}
