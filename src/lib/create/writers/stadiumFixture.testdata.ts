/**
 * Test-only: a closed stadium-shaped track (road ring with walls and an optional boost panel
 * strip), as render meshes, collision triangles and a minimal KMP. Used by the Kinoko physics
 * tests and the browser check.
 */

import { createEmptyKmpFile, type KmpFile } from '../../kmpFile';
import type { GeneratedCollision, GeneratedMesh } from '../types';
import { KCL_BOOST_PANEL, KCL_ROAD, KCL_WALL, kclFlag } from './kclFlags';

export interface StadiumOptions {
  /** Length of each straight. */
  straight: number;
  /** Radius of the centre line around each end. */
  radius: number;
  roadWidth: number;
  wallHeight: number;
  /** Arc-length range [from, to] (from the start of the bottom straight) whose road is a boost panel. */
  boost?: [number, number];
  /** Samples per straight / per half circle. */
  straightSteps?: number;
  arcSteps?: number;
}

export interface StadiumPoint {
  x: number;
  z: number;
  /** Unit heading in the XZ plane. */
  hx: number;
  hz: number;
  /** Arc length from the start of the bottom straight. */
  s: number;
}

export interface Stadium {
  options: StadiumOptions;
  centerline: StadiumPoint[];
  length: number;
  collision: GeneratedCollision;
  meshes: GeneratedMesh[];
  /** Centre line point at arc length `s` (wraps). */
  at(s: number): StadiumPoint;
}

type Tri = [number[], number[], number[], number];
interface MeshStore {
  positions: number[];
  uvs: number[];
  normals: number[];
  indices: number[];
}

export function buildStadium(options: StadiumOptions): Stadium {
  const { straight, radius, roadWidth, wallHeight } = options;
  const straightSteps = options.straightSteps ?? 8;
  const arcSteps = options.arcSteps ?? 24;
  const half = straight / 2;
  const length = 2 * straight + 2 * Math.PI * radius;

  const centerline: StadiumPoint[] = [];
  const push = (x: number, z: number, hx: number, hz: number) => centerline.push({ x, z, hx, hz, s: 0 });
  // Bottom straight, heading +X at z = -radius.
  for (let i = 0; i < straightSteps; i++) push(-half + (straight * i) / straightSteps, -radius, 1, 0);
  // Right end: heading +X turns toward +Z (clockwise seen from above).
  for (let i = 0; i < arcSteps; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / arcSteps;
    push(half + Math.cos(a) * radius, Math.sin(a) * radius, -Math.sin(a), Math.cos(a));
  }
  // Top straight, heading -X at z = +radius.
  for (let i = 0; i < straightSteps; i++) push(half - (straight * i) / straightSteps, radius, -1, 0);
  // Left end.
  for (let i = 0; i < arcSteps; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / arcSteps;
    push(-half + Math.cos(a) * radius, Math.sin(a) * radius, -Math.sin(a), Math.cos(a));
  }
  for (let i = 0; i + 1 < centerline.length; i++) {
    centerline[i + 1].s = centerline[i].s + Math.hypot(centerline[i + 1].x - centerline[i].x, centerline[i + 1].z - centerline[i].z);
  }

  const halfWidth = roadWidth / 2;
  // Right of heading (hx, hz) is (-hz, hx) in this coordinate system.
  const edge = (p: StadiumPoint, offset: number): [number, number] => [p.x - p.hz * offset, p.z + p.hx * offset];
  const roadTris: Tri[] = [];
  const wallTris: Tri[] = [];
  const road: MeshStore = { positions: [], uvs: [], normals: [], indices: [] };
  const wall: MeshStore = { positions: [], uvs: [], normals: [], indices: [] };

  const orient = (a: number[], b: number[], c: number[], desired: number[]): [number[], number[], number[]] => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    return n[0] * desired[0] + n[1] * desired[1] + n[2] * desired[2] >= 0 ? [a, b, c] : [a, c, b];
  };
  const addQuad = (store: MeshStore, tris: Tri[], quad: number[][], uv: number[][], desired: number[], flag: number): void => {
    const base = store.positions.length / 3;
    quad.forEach((p, i) => {
      store.positions.push(...p);
      store.normals.push(...desired);
      store.uvs.push(...uv[i]);
    });
    for (const corners of [[0, 1, 2], [0, 2, 3]]) {
      const [a, b, c] = orient(quad[corners[0]], quad[corners[1]], quad[corners[2]], desired);
      tris.push([a, b, c, flag]);
      store.indices.push(base + quad.indexOf(a), base + quad.indexOf(b), base + quad.indexOf(c));
    }
  };

  for (let i = 0; i < centerline.length; i++) {
    const p = centerline[i];
    const q = centerline[(i + 1) % centerline.length];
    const sEnd = i + 1 < centerline.length ? q.s : length;
    const boosted = options.boost !== undefined && p.s >= options.boost[0] && sEnd <= options.boost[1] + 1e-6;
    const l0 = edge(p, -halfWidth), r0 = edge(p, halfWidth), l1 = edge(q, -halfWidth), r1 = edge(q, halfWidth);
    const v0 = p.s / 500, v1 = sEnd / 500;
    addQuad(
      road,
      roadTris,
      [[l0[0], 0, l0[1]], [r0[0], 0, r0[1]], [r1[0], 0, r1[1]], [l1[0], 0, l1[1]]],
      [[0, v0], [roadWidth / 500, v0], [roadWidth / 500, v1], [0, v1]],
      [0, 1, 0],
      kclFlag(boosted ? KCL_BOOST_PANEL : KCL_ROAD),
    );
    // Walls on both edges, facing the road.
    const lw = [[l0[0], 0, l0[1]], [l0[0], wallHeight, l0[1]], [l1[0], wallHeight, l1[1]], [l1[0], 0, l1[1]]];
    const rw = [[r0[0], 0, r0[1]], [r0[0], wallHeight, r0[1]], [r1[0], wallHeight, r1[1]], [r1[0], 0, r1[1]]];
    const rightDir = [-p.hz, 0, p.hx];
    const uv = [[v0, 0], [v0, 1], [v1, 1], [v1, 0]];
    addQuad(wall, wallTris, lw, uv, rightDir, kclFlag(KCL_WALL));
    addQuad(wall, wallTris, rw, uv, rightDir.map((x) => -x), kclFlag(KCL_WALL));
  }

  const all = [...roadTris, ...wallTris];
  const collision: GeneratedCollision = {
    positions: new Float32Array(all.length * 9),
    indices: new Uint32Array(all.length * 3),
    flags: new Uint16Array(all.length),
  };
  all.forEach(([a, b, c, flag], i) => {
    collision.positions.set([...a, ...b, ...c], i * 9);
    collision.indices.set([i * 3, i * 3 + 1, i * 3 + 2], i * 3);
    collision.flags[i] = flag;
  });

  const toMesh = (store: MeshStore, name: string, surfaceId: string): GeneratedMesh => ({
    name,
    surfaceId,
    chunk: name,
    positions: new Float32Array(store.positions),
    normals: new Float32Array(store.normals),
    uvs: new Float32Array(store.uvs),
    colors: new Uint8Array((store.positions.length / 3) * 4).fill(255),
    indices: new Uint32Array(store.indices),
  });

  const at = (s: number): StadiumPoint => {
    const wrapped = ((s % length) + length) % length;
    let i = centerline.findIndex((p, k) => wrapped >= p.s && (k + 1 === centerline.length || wrapped < centerline[k + 1].s));
    if (i < 0) i = 0;
    const p = centerline[i];
    const q = centerline[(i + 1) % centerline.length];
    const end = i + 1 < centerline.length ? q.s : length;
    const t = (wrapped - p.s) / (end - p.s || 1);
    const hx = p.hx + (q.hx - p.hx) * t, hz = p.hz + (q.hz - p.hz) * t;
    const hl = Math.hypot(hx, hz) || 1;
    return { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, hx: hx / hl, hz: hz / hl, s: wrapped };
  };

  return { options, centerline, length, collision, meshes: [toMesh(road, 'road', 'road'), toMesh(wall, 'wall', 'wall')], at };
}

/** A minimal KMP Kinoko accepts: a start grid, a checkpoint loop with lap counter and keys, respawns, routes. */
export function buildStadiumKmp(stadium: Stadium, startS: number, checkpointCount = 32): KmpFile {
  const file = createEmptyKmpFile();
  const start = stadium.at(startS);
  const yaw = (p: StadiumPoint) => (Math.atan2(p.hx, p.hz) * 180) / Math.PI;
  file.startPoints.push({ position: { x: start.x, y: 0, z: start.z }, rotation: { x: 0, y: yaw(start), z: 0 }, playerIndex: -1, padding: 0 });

  const width = stadium.options.roadWidth + 400;
  const respawnCount = 8;
  for (let i = 0; i < respawnCount; i++) {
    const p = stadium.at(startS + (stadium.length * i) / respawnCount);
    file.respawnPoints.push({ position: { x: p.x, y: 100, z: p.z }, rotation: { x: 0, y: yaw(p), z: 0 }, id: i, extraUserData: -1 });
  }
  for (let i = 0; i < checkpointCount; i++) {
    const p = stadium.at(startS + (stadium.length * i) / checkpointCount);
    // Looking along the heading, "left" is (hz, -hx).
    const type = i === 0 ? 0 : i === Math.floor(checkpointCount / 3) ? 1 : i === Math.floor((2 * checkpointCount) / 3) ? 2 : 0xff;
    file.checkpoints.push({
      x1: p.x + p.hz * (width / 2),
      z1: p.z - p.hx * (width / 2),
      x2: p.x - p.hz * (width / 2),
      z2: p.z + p.hx * (width / 2),
      respawnIndex: Math.min(respawnCount - 1, Math.floor((i * respawnCount) / checkpointCount)),
      type,
      prev: i === 0 ? 0xff : i - 1,
      next: i === checkpointCount - 1 ? 0xff : i + 1,
    });
  }
  file.checkpointGroups.push({ start: 0, length: checkpointCount, prev: [0], next: [0], linkFlags: 0 });
  const routePoints = 16;
  for (let i = 0; i < routePoints; i++) {
    const p = stadium.at(startS + (stadium.length * i) / routePoints);
    file.enemyPoints.push({ position: { x: p.x, y: 0, z: p.z }, range: 400, setting1: 0, setting2: 0, setting3: 0 });
    file.itemPoints.push({ position: { x: p.x, y: 0, z: p.z }, range: 400, setting1: 0, setting2: 0 });
  }
  file.enemyGroups.push({ start: 0, length: routePoints, prev: [0], next: [0], linkFlags: 0 });
  file.itemGroups.push({ start: 0, length: routePoints, prev: [0], next: [0], linkFlags: 0 });
  return file;
}
