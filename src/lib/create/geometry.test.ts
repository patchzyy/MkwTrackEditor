import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledGeometry, CreateKit, CreateProject } from './types';
import { useDeterministicIds } from './ids';
import { createSyntheticKit } from './__tests__/syntheticKit';
import { createProjectFromTemplate } from './templates';
import { compileGeometry, createGeometryCache, hashMeshes } from './compile';
import { createRaycaster } from './raycast';
import { projectOntoRoad, sampleRoad, evaluateRoadAt } from './spline';
import { buildTerrainField } from './terrain';
import { HORIZON_FAR, HORIZON_REACH } from './horizon';
import { addRoad, addTerrainStroke, updateSection, splitSection, updateTerrain, updateRoad, updateRoadPoint } from './ops';
import { isDrivableFlag, isWallFlag, isFallFlag } from './kclTypes';

let kit: CreateKit;
beforeAll(() => {
  useDeterministicIds();
  kit = createSyntheticKit();
});

const project = (template: string, mut?: (p: CreateProject) => CreateProject) => {
  let p = createProjectFromTemplate(template, { name: 't', themeId: 'test', laps: 3 }, kit);
  if (mut) p = mut(p);
  return p;
};

function triNormal(c: CompiledGeometry['collision'], t: number): [number, number, number] {
  const { positions: P, indices: I } = c;
  const a = I[t * 3] * 3;
  const b = I[t * 3 + 1] * 3;
  const d = I[t * 3 + 2] * 3;
  const ux = P[b] - P[a];
  const uy = P[b + 1] - P[a + 1];
  const uz = P[b + 2] - P[a + 2];
  const vx = P[d] - P[a];
  const vy = P[d + 1] - P[a + 1];
  const vz = P[d + 2] - P[a + 2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

describe('compileGeometry', () => {
  it('produces meshes for road, pieces and terrain with valid typed arrays', () => {
    const g = compileGeometry(project('oval'), kit);
    const chunks = new Set(g.meshes.map((m) => m.chunk));
    expect(chunks.has('terrain')).toBe(true);
    expect(chunks.has('pieces')).toBe(true);
    expect([...chunks].some((c) => c.startsWith('road:'))).toBe(true);
    const names = new Set<string>();
    for (const m of g.meshes) {
      expect(names.has(m.name)).toBe(false);
      names.add(m.name);
      expect(m.positions.length % 3).toBe(0);
      expect(m.normals.length).toBe(m.positions.length);
      expect(m.uvs.length / 2).toBe(m.positions.length / 3);
      expect(m.colors.length / 4).toBe(m.positions.length / 3);
      expect(m.indices.length % 3).toBe(0);
      for (const i of m.indices) expect(i).toBeLessThan(m.positions.length / 3);
      for (const v of m.positions) expect(Number.isFinite(v)).toBe(true);
      for (const v of m.uvs) expect(Number.isFinite(v)).toBe(true);
    }
    expect(g.collision.indices.length).toBe(g.collision.flags.length * 3);
    expect(g.bounds.max.x).toBeGreaterThan(g.bounds.min.x);
  });

  it('drivable collision faces up and has no degenerate triangles', () => {
    for (const t of ['oval', 'hills', 'figure-eight']) {
      const g = compileGeometry(project(t), kit);
      let drivable = 0;
      for (let i = 0; i < g.collision.flags.length; i++) {
        const [nx, ny, nz] = triNormal(g.collision, i);
        expect(Number.isFinite(nx + ny + nz)).toBe(true);
        const flag = g.collision.flags[i];
        if (isDrivableFlag(flag) && !isFallFlag(flag)) {
          drivable++;
          expect(ny).toBeGreaterThan(0.2);
        }
      }
      expect(drivable).toBeGreaterThan(1000);
    }
  });

  it('render triangles on the road face up (same winding rule as collision)', () => {
    const g = compileGeometry(project('oval', (p) => updateTerrain(p, { enabled: false })), kit);
    const roadMesh = g.meshes.find((m) => m.surfaceId === 'test.road')!;
    let up = 0;
    for (let t = 0; t < roadMesh.indices.length; t += 3) {
      const a = roadMesh.indices[t] * 3;
      const b = roadMesh.indices[t + 1] * 3;
      const c = roadMesh.indices[t + 2] * 3;
      const P = roadMesh.positions;
      const ux = P[b] - P[a];
      const uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a];
      const vz = P[c + 2] - P[a + 2];
      const ny = uz * vx - ux * vz;
      if (ny > 0) up++;
    }
    expect(up / (roadMesh.indices.length / 3)).toBeGreaterThan(0.99);
  });

  it('road sections meet without open edges inside the road (seamless boundaries)', () => {
    let p = project('oval');
    const id = p.roads[0].id;
    p = splitSection(p, id, 5.3).project;
    p = splitSection(p, id, 11.7).project;
    p = updateSection(p, id, p.roads[0].sections[1].id, { surface: { slot: 'roadAlt' } });
    const g = compileGeometry(updateTerrain(p, { enabled: false }), kit);
    const key = (x: number, y: number, z: number) => `${Math.round(x * 20)},${Math.round(y * 20)},${Math.round(z * 20)}`;
    const edges = new Map<string, { n: number; a: number[]; b: number[] }>();
    const { positions: P, indices: I, flags: F } = g.collision;
    for (let t = 0; t < F.length; t++) {
      const type = F[t] & 0x1f;
      if (type !== 0 && type !== 3 && type !== 2) continue; // road, curb, shoulder
      for (let e = 0; e < 3; e++) {
        const i0 = I[t * 3 + e] * 3;
        const i1 = I[t * 3 + ((e + 1) % 3)] * 3;
        const ka = key(P[i0], P[i0 + 1], P[i0 + 2]);
        const kb = key(P[i1], P[i1 + 1], P[i1 + 2]);
        const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const rec = edges.get(k);
        if (rec) rec.n++;
        else edges.set(k, { n: 1, a: [P[i0], P[i0 + 1], P[i0 + 2]], b: [P[i1], P[i1 + 1], P[i1 + 2]] });
      }
    }
    const road = p.roads[0];
    let open = 0;
    let interiorOpen = 0;
    for (const rec of edges.values()) {
      if (rec.n !== 1) continue;
      open++;
      const mid = { x: (rec.a[0] + rec.b[0]) / 2, y: (rec.a[1] + rec.b[1]) / 2, z: (rec.a[2] + rec.b[2]) / 2 };
      const proj = projectOntoRoad(road, mid)!;
      if (Math.abs(proj.lateral) < proj.sample.width / 2 + 60) interiorOpen++;
    }
    expect(open).toBeGreaterThan(100);
    expect(interiorOpen).toBe(0);
  });

  it('road UVs tile an integer number of times around a closed loop', () => {
    const g = compileGeometry(project('oval', (p) => updateTerrain(p, { enabled: false })), kit);
    const mesh = g.meshes.find((m) => m.surfaceId === 'test.road')!;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < mesh.uvs.length; i += 2) {
      min = Math.min(min, mesh.uvs[i]);
      max = Math.max(max, mesh.uvs[i]);
    }
    expect(min).toBeCloseTo(0, 3);
    expect(Math.abs(max - Math.round(max))).toBeLessThan(0.01);
    expect(max).toBeGreaterThan(100);
  });

  it('the terrain is sunk below every point of the road footprint', () => {
    const p = project('hills');
    const field = buildTerrainField(p, kit);
    let worst = Infinity;
    for (const s of sampleRoad(p.roads[0], { step: 400 })) {
      for (const lat of [-0.95, -0.5, 0, 0.5, 0.95]) {
        const x = s.position.x + s.right.x * lat * (s.width / 2);
        const z = s.position.z + s.right.z * lat * (s.width / 2);
        const y = s.position.y + s.right.y * lat * (s.width / 2);
        worst = Math.min(worst, y - field.heightAt(x, z));
      }
    }
    expect(worst).toBeGreaterThan(15);
  });

  it('walls get wall collision facing the road, bridges and gaps get fall boundaries', () => {
    const walled = project('oval', (p) => updateRoad(p, p.roads[0].id, { styleId: 'walled' }));
    const g = compileGeometry(walled, kit);
    let walls = 0;
    const road = walled.roads[0];
    for (let i = 0; i < g.collision.flags.length; i++) {
      if (!isWallFlag(g.collision.flags[i])) continue;
      const [nx, , nz] = triNormal(g.collision, i);
      const p = g.collision.positions;
      const a = g.collision.indices[i * 3] * 3;
      const proj = projectOntoRoad(road, { x: p[a], z: p[a + 2] }, { heightWeight: 0 })!;
      if (Math.abs(proj.lateralNorm) < 0.9 || Math.abs(proj.lateralNorm) > 1.2) continue; // skip world boundary walls
      const edgeY = proj.position.y + proj.sample.right.y * proj.lateral;
      const cy = (p[a + 1] + p[g.collision.indices[i * 3 + 1] * 3 + 1] + p[g.collision.indices[i * 3 + 2] * 3 + 1]) / 3;
      if (cy < edgeY + 60) continue; // skirts hang below the road edge, walls rise above it
      walls++;
      const sgn = Math.sign(proj.lateral);
      expect((nx * proj.sample.right.x + nz * proj.sample.right.z) * sgn).toBeLessThan(-0.5);
    }
    expect(walls).toBeGreaterThan(500);

    const eight = project('figure-eight');
    const ge = compileGeometry(eight, kit);
    expect([...ge.collision.flags].some((f) => (f & 0x1f) === 0x10)).toBe(true);
    const g2 = compileGeometry(updateTerrain(project('oval'), { enabled: false }), kit);
    expect(g2.meshes.some((m) => m.chunk === 'terrain')).toBe(false);
    expect([...g2.collision.flags].some((f) => (f & 0x1f) === 0x10)).toBe(true);
  });

  it('painted strokes become separate terrain meshes with the right surface', () => {
    let p = project('oval');
    p = addTerrainStroke(p, { kind: 'paint', surface: { slot: 'sand' }, radius: 2500, points: [{ x: 0, z: 40000 }, { x: 6000, z: 41000 }] }).project;
    p = addTerrainStroke(p, { kind: 'paint', surface: { slot: 'water' }, radius: 3000, points: [{ x: -20000, z: -40000 }] }).project;
    const g = compileGeometry(p, kit);
    const terrain = g.meshes.filter((m) => m.chunk === 'terrain').map((m) => m.surfaceId);
    expect(terrain).toContain('test.ground');
    expect(terrain).toContain('test.sand');
    expect(terrain).toContain('test.water');
    const waterTriangles = [...g.collision.flags].filter((f) => (f & 0x1f) === 0x10).length;
    expect(waterTriangles).toBeGreaterThan(5);
    expect([...g.collision.flags].some((f) => f === 0x0001)).toBe(true);
  });

  it('sculpting raises the ground', () => {
    let p = project('oval');
    const base = buildTerrainField(p, kit).heightAt(0, 60000);
    p = addTerrainStroke(p, { kind: 'sculpt', mode: 'raise', radius: 5000, strength: 120, points: [{ x: 0, z: 60000 }] }).project;
    p = addTerrainStroke(p, { kind: 'sculpt', mode: 'raise', radius: 5000, strength: 120, points: [{ x: 0, z: 60000 }] }).project;
    expect(buildTerrainField(p, kit).heightAt(0, 60000)).toBeGreaterThan(base + 150);
  });

  it('is deterministic', () => {
    const p = project('kidney');
    const a = compileGeometry(p, kit);
    const b = compileGeometry(p, kit);
    expect(a.meshes.length).toBe(b.meshes.length);
    expect(Buffer.from(a.collision.positions.buffer).equals(Buffer.from(b.collision.positions.buffer))).toBe(true);
  });

  it('copes with tight corners without NaN', () => {
    const p = project('oval', (q) => {
      const pts = q.roads[0].points.map((pt, i) => ({ ...pt, position: { x: pt.position.x * 0.04, y: pt.position.y, z: pt.position.z * 0.04 + (i % 2) * 40 } }));
      return { ...q, roads: [{ ...q.roads[0], points: pts }] };
    });
    const g = compileGeometry(p, kit);
    for (const m of g.meshes) for (const v of m.positions) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('section kinds', () => {
  const withKind = (kind: 'bridge' | 'gap' | 'tunnel') => {
    let p = project('kidney');
    const rid = p.roads[0].id;
    const a = splitSection(p, rid, 3);
    const b = splitSection(a.project, rid, 9);
    p = updateSection(b.project, rid, a.id, { kind });
    return p;
  };

  it('digs the ground away under a bridge and a gap, but only there', () => {
    for (const kind of ['bridge', 'gap'] as const) {
      const p = withKind(kind);
      const field = buildTerrainField(p, kit);
      const under = evaluateRoadAt(p.roads[0], 6);
      const beside = evaluateRoadAt(p.roads[0], 1.5);
      expect(under.position.y - field.heightAt(under.position.x, under.position.z)).toBeGreaterThan(1000);
      expect(beside.position.y - field.heightAt(beside.position.x, beside.position.z)).toBeLessThan(60);
    }
  });

  it('a bridge has a deck with an underside and a fall boundary under it; a gap has no deck at all', () => {
    const bridge = compileGeometry(withKind('bridge'), kit);
    expect(bridge.meshes.some((m) => m.surfaceId === 'test.underside' && m.chunk.startsWith('road:'))).toBe(true);
    const gap = compileGeometry(withKind('gap'), kit);
    const none = compileGeometry(project('kidney'), kit);
    const roadTris = (g: CompiledGeometry) => g.meshes.filter((m) => m.surfaceId === 'test.road' && m.chunk.startsWith('road:')).reduce((n, m) => n + m.indices.length, 0);
    expect(roadTris(gap)).toBeLessThan(roadTris(none) * 0.8);
    const falls = (g: CompiledGeometry) => [...g.collision.flags].filter((f) => (f & 0x1f) === 0x10).length;
    expect(falls(gap)).toBeGreaterThan(falls(none) + 20);
    expect(falls(bridge)).toBeGreaterThan(falls(none) + 20);
  });

  it('a tunnel is closed: full-height walls and a ceiling a kart cannot reach', () => {
    const p = withKind('tunnel');
    const g = compileGeometry(p, kit);
    const road = p.roads[0];
    let ceiling = 0;
    for (let i = 0; i < g.collision.flags.length; i++) {
      if (!isWallFlag(g.collision.flags[i])) continue;
      const [, ny] = triNormal(g.collision, i);
      if (ny > -0.9) continue;
      const a = g.collision.indices[i * 3] * 3;
      const proj = projectOntoRoad(road, { x: g.collision.positions[a], z: g.collision.positions[a + 2] }, { heightWeight: 0 })!;
      if (Math.abs(proj.lateralNorm) > 1.7) continue;
      ceiling++;
      expect(g.collision.positions[a + 1] - proj.position.y).toBeGreaterThan(800);
    }
    expect(ceiling).toBeGreaterThan(50);
  });
});

describe('draft compiles', () => {
  it('are much lighter, skip the minimap, and keep the same chunks', () => {
    const p = project('hills');
    const full = compileGeometry(p, kit);
    const draft = compileGeometry(p, kit, { draft: true, cache: createGeometryCache() });
    expect(new Set(draft.meshes.map((m) => m.chunk))).toEqual(new Set(full.meshes.map((m) => m.chunk)));
    expect(draft.collision.flags.length).toBeLessThan(full.collision.flags.length * 0.7);
    expect(draft.minimap).toEqual([]);
    expect(full.minimap.length).toBeGreaterThan(0);
  });

  it('reuse roads that did not change, and the terrain when only a piece moved', () => {
    const cache = createGeometryCache();
    let p = project('oval');
    const rid = p.roads[0].id;
    p = addRoad(p, { points: [{ position: { x: -30000, y: 0, z: 70000 } }, { position: { x: -20000, y: 0, z: 72000 } }, { position: { x: -10000, y: 0, z: 70000 } }], name: 'Side' }).project;
    const a = compileGeometry(p, kit, { draft: true, cache });
    const roadMeshes = (g: CompiledGeometry, roadId: string) => g.meshes.filter((m) => m.chunk === 'road:' + roadId);
    const terrainOf = (g: CompiledGeometry) => g.meshes.filter((m) => m.chunk === 'terrain');
    // Move a piece: every road and the terrain come back as the very same mesh objects.
    const moved = { ...p, pieces: p.pieces.map((x, i) => (i === 0 ? { ...x, param: x.param + 0.3 } : x)) };
    const b = compileGeometry(moved, kit, { draft: true, cache });
    expect(roadMeshes(b, rid)[0]).toBe(roadMeshes(a, rid)[0]);
    expect(terrainOf(b)[0]).toBe(terrainOf(a)[0]);
    // Drag a point of the side road: the main road is reused, the side road and the terrain are rebuilt.
    const side = p.roads[1];
    const dragged = updateRoadPoint(p, side.id, side.points[1].id, { position: { x: -20000, y: 0, z: 72500 } });
    const c = compileGeometry(dragged, kit, { draft: true, cache });
    expect(roadMeshes(c, rid)[0]).toBe(roadMeshes(a, rid)[0]);
    expect(roadMeshes(c, side.id)[0]).not.toBe(roadMeshes(a, side.id)[0]);
    expect(terrainOf(c)[0]).not.toBe(terrainOf(a)[0]);
    // The cache is ignored outside draft mode, so a normal compile is always complete.
    const full = compileGeometry(dragged, kit, { cache });
    expect(roadMeshes(full, rid)[0]).not.toBe(roadMeshes(a, rid)[0]);
  });
});

describe('horizon', () => {
  it('is a separate chunk of non-drivable ground that reaches far past the terrain', () => {
    const p = project('oval');
    const g = compileGeometry(p, kit);
    const ring = g.meshes.filter((m) => m.chunk === 'horizon');
    expect(ring.length).toBeGreaterThan(0);
    expect(ring.every((m) => m.surfaceId === 'test.ground')).toBe(true);
    let min = Infinity;
    let max = -Infinity;
    let top = -Infinity;
    for (const m of ring) {
      for (let i = 0; i < m.positions.length; i += 3) {
        min = Math.min(min, m.positions[i]);
        max = Math.max(max, m.positions[i]);
        top = Math.max(top, m.positions[i + 1]);
      }
    }
    const field = buildTerrainField(p, kit);
    const terrainWidth = (field.cols - 1) * field.cell;
    expect(max - min).toBeGreaterThan(terrainWidth + 150000);
    expect(top).toBeGreaterThan(500); // it rises towards the horizon
    // Not part of the framing bounds, and not in the collision with a wall boundary.
    expect(g.bounds.max.x - g.bounds.min.x).toBeLessThan(terrainWidth + 1000);
    const lethal = (q: CreateProject) => [...compileGeometry(q, kit).collision.flags].filter((f) => (f & 0x1f) === 0x10).length;
    expect(lethal(updateTerrain(p, { boundary: 'fall' }))).toBeGreaterThan(lethal(p) + 500);
  });

  it('carries on as flat ground to the far distance, meeting the ring edge with no step', () => {
    const p = project('oval');
    const g = compileGeometry(p, kit);
    const ring = g.meshes.filter((m) => m.chunk === 'horizon');
    let min = Infinity;
    let max = -Infinity;
    const ys = new Set<number>();
    for (const m of ring) {
      for (let i = 0; i < m.positions.length; i += 3) {
        min = Math.min(min, m.positions[i]);
        max = Math.max(max, m.positions[i]);
        // Vertices on the far slabs, and on the ring's own outer edge, all sit at one height.
        if (Math.abs(m.positions[i]) >= HORIZON_FAR || Math.abs(m.positions[i + 2]) >= HORIZON_FAR) ys.add(Math.round(m.positions[i + 1] * 100));
      }
    }
    expect(min).toBeLessThanOrEqual(-HORIZON_FAR);
    expect(max).toBeGreaterThanOrEqual(HORIZON_FAR);
    expect(ys.size).toBe(1);
    // The ring's outermost vertices (just inside the slabs) are at that same height.
    const [outer] = [...ys].map((y) => y / 100);
    const field = buildTerrainField(p, kit);
    const edge = Math.ceil(field.x0 / 20000) * 20000 - HORIZON_REACH;
    let edgeCount = 0;
    for (const m of ring) {
      for (let i = 0; i < m.positions.length; i += 3) {
        if (Math.abs(m.positions[i] - edge) < 1 && Math.abs(m.positions[i + 1] - outer) > 0.5) edgeCount++;
      }
    }
    expect(edgeCount).toBe(0);
  });

  it('never changes while roads are dragged, so it is not rebuilt', () => {
    const p = project('oval');
    const road = p.roads[0];
    const moved = updateRoadPoint(p, road.id, road.points[4].id, { position: { ...road.points[4].position, x: road.points[4].position.x + 700 } });
    expect(hashMeshes(compileGeometry(moved, kit).meshes.filter((m) => m.chunk === 'horizon'))).toBe(hashMeshes(compileGeometry(p, kit).meshes.filter((m) => m.chunk === 'horizon')));
  });

  it('is left out of sky worlds (no ground)', () => {
    const g = compileGeometry(updateTerrain(project('oval'), { enabled: false }), kit);
    expect(g.meshes.some((m) => m.chunk === 'horizon')).toBe(false);
  });
});

describe('createRaycaster', () => {
  it('hits the road and reports a normal, distance and position', () => {
    const p = project('oval');
    const g = compileGeometry(p, kit);
    const cast = createRaycaster(g.collision);
    const s = evaluateRoadAt(p.roads[0], 3.3);
    const hit = cast({ origin: { x: s.position.x, y: s.position.y + 5000, z: s.position.z }, direction: { x: 0, y: -2, z: 0 } });
    expect(hit).not.toBeNull();
    expect(Math.abs(hit!.position.y - s.position.y)).toBeLessThan(2);
    expect(hit!.normal.y).toBeGreaterThan(0.9);
    expect(Math.abs(hit!.distance - 5000)).toBeLessThan(2);
  });

  it('ignores walls and fall planes', () => {
    const p = project('oval', (q) => updateRoad(q, q.roads[0].id, { styleId: 'walled' }));
    const g = compileGeometry(p, kit);
    const cast = createRaycaster(g.collision);
    const s = evaluateRoadAt(p.roads[0], 3.3);
    const hit = cast({ origin: { x: s.position.x, y: s.position.y + 200, z: s.position.z }, direction: { x: s.right.x, y: 0, z: s.right.z } });
    expect(hit).toBeNull();
  });
});
