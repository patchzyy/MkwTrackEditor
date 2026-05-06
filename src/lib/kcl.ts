import { BinReader } from './binary';
import type { Vec3 } from './kmp';

export interface KclTriangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  flag: number;
  typeName: string;
  normal: Vec3;
}

export interface KclMesh {
  triangles: KclTriangle[];
  warnings: string[];
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

export function parseKcl(data: Uint8Array): KclMesh {
  const buffer = data.slice().buffer;
  const reader = new BinReader(buffer);
  const warnings: string[] = [];
  if (data.length < 0x40) return { triangles: [], warnings: ['KCL file is too small.'] };

  const posOffset = reader.u32(0);
  const normOffset = reader.u32(4);
  const triOffset = reader.u32(8);
  if (posOffset >= data.length || normOffset >= data.length || triOffset >= data.length) {
    return { triangles: [], warnings: ['KCL header offsets are outside the file.'] };
  }

  const positionCount = Math.max(0, Math.floor((normOffset - posOffset) / 12));
  const positions = Array.from({ length: positionCount }, (_, i) => readVec3(reader, posOffset + i * 12));
  const normalEnd = Math.min(triOffset + 0x10, data.length);
  const normalCount = Math.max(0, Math.floor((normalEnd - normOffset) / 12));
  const normals = Array.from({ length: normalCount }, (_, i) => normalize(readVec3(reader, normOffset + i * 12)));
  const triangleStart = triOffset + 0x10;
  const triangleEnd = reader.u32(12);
  const triangleCount = Math.max(0, Math.floor((Math.min(triangleEnd, data.length) - triangleStart) / 16));
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
    triangles.push({ a, b, c, flag, typeName: collisionTypes[flag & 0x1f] ?? 'Unknown', normal });
  }

  if (triangles.length === 0) warnings.push('KCL parsed, but no raycastable triangles were recovered.');
  return { triangles, warnings };
}

export function raycastDown(mesh: KclMesh, x: number, z: number): Vec3 | null {
  const origin = { x, y: 100000, z };
  const direction = { x: 0, y: -1, z: 0 };
  let best: Vec3 | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const triangle of mesh.triangles) {
    const hit = raycastTriangle(origin, direction, triangle);
    if (hit && hit.distance < bestDistance) {
      best = hit.position;
      bestDistance = hit.distance;
    }
  }
  return best;
}

export function raycastMesh(mesh: KclMesh, origin: Vec3, direction: Vec3): { position: Vec3; distance: number; triangle: KclTriangle } | null {
  let best: { position: Vec3; distance: number; triangle: KclTriangle } | null = null;
  for (const triangle of mesh.triangles) {
    const hit = raycastTriangle(origin, direction, triangle);
    if (hit && (!best || hit.distance < best.distance)) best = { ...hit, triangle };
  }
  return best;
}

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

function raycastTriangle(origin: Vec3, direction: Vec3, triangle: KclTriangle): { position: Vec3; distance: number } | null {
  const edge1 = sub(triangle.b, triangle.a);
  const edge2 = sub(triangle.c, triangle.a);
  const p = cross(direction, edge2);
  const det = dot(edge1, p);
  if (Math.abs(det) < 0.000001) return null;
  const invDet = 1 / det;
  const t = sub(origin, triangle.a);
  const u = dot(t, p) * invDet;
  if (u < 0 || u > 1) return null;
  const q = cross(t, edge1);
  const v = dot(direction, q) * invDet;
  if (v < 0 || u + v > 1) return null;
  const distance = dot(edge2, q) * invDet;
  if (distance < 0) return null;
  return { position: add(origin, scale(direction, distance)), distance };
}

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
