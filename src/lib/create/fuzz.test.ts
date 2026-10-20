import { beforeAll, describe, expect, it } from 'vitest';
import { validateKmpFile } from '../kmpValidation';
import type { CreateKit, CreateProject, EdgeWall, SectionKind } from './types';
import { useDeterministicIds } from './ids';
import { createSyntheticKit } from './__tests__/syntheticKit';
import { createBlankProject } from './templates';
import { createRandom } from './math';
import { addPiece, addProp, addRoad, addTerrainStroke, splitSection, updateRoadPoint, updateSection, updateTerrain } from './ops';
import { compileGeometry } from './compile';
import { generateKmp } from './kmpGen';
import { analyzeProject } from './analyze';
import { roadParamEnd } from './spline';

let kit: CreateKit;
beforeAll(() => {
  useDeterministicIds();
  kit = createSyntheticKit();
});

const KINDS: SectionKind[] = ['road', 'bridge', 'gap', 'tunnel', 'road'];
const WALLS: EdgeWall[] = ['none', 'barrier', 'wall', 'fence', 'invisible'];
const STYLES = ['circuit', 'walled', 'barrier', 'trail', 'bridge', 'castle', 'sky'];

function randomProject(seed: number): CreateProject {
  const rand = createRandom(seed);
  const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];
  let p = createBlankProject({ name: `fuzz ${seed}`, themeId: 'test', laps: 1 + Math.floor(rand() * 5) }, kit);
  const count = 3 + Math.floor(rand() * 14);
  const radius = 8000 + rand() * 40000;
  const points = Array.from({ length: count }, (_, i) => {
    const t = (i / count) * Math.PI * 2;
    const r = radius * (0.5 + rand());
    return {
      position: { x: Math.cos(t) * r, y: (rand() - 0.3) * 2500, z: Math.sin(t) * r },
      width: 1500 + rand() * 5000,
      bank: (rand() - 0.5) * 70,
      corner: rand() < 0.15 ? ('sharp' as const) : ('smooth' as const),
    };
  });
  const added = addRoad(p, { points, styleId: pick(STYLES), closed: rand() < 0.85 });
  p = added.project;
  const rid = added.id;
  const end = roadParamEnd(p.roads[0]);
  for (let s = 0; s < Math.floor(rand() * 5); s++) {
    const split = splitSection(p, rid, rand() * end);
    p = updateSection(split.project, rid, split.id, {
      kind: pick(KINDS),
      left: { wall: pick(WALLS), curb: rand() < 0.5, wallHeight: rand() < 0.5 ? 0 : 100 + rand() * 900 },
      right: { wall: pick(WALLS), shoulder: rand() < 0.5 ? { slot: 'sand' } : null, shoulderWidth: rand() * 1500 },
    });
  }
  for (let k = 0; k < Math.floor(rand() * 8); k++) {
    p = addPiece(p, {
      kind: pick(['boostPanel', 'boostRamp', 'trickRamp', 'itemRow', 'object'] as const),
      roadId: rid,
      param: rand() * end,
      lateral: (rand() - 0.5) * 2.4,
      width: 500 + rand() * 4000,
      length: 300 + rand() * 4000,
      height: 100 + rand() * 800,
      count: 1 + Math.floor(rand() * 8),
      objectId: pick([0x191, 0x65, 0x194, 12345]),
    }).project;
  }
  for (let k = 0; k < Math.floor(rand() * 4); k++) {
    const point = { x: (rand() - 0.5) * radius * 3, z: (rand() - 0.5) * radius * 3 };
    p = addTerrainStroke(p, rand() < 0.5
      ? { kind: 'paint', surface: rand() < 0.2 ? null : { slot: pick(['sand', 'water', 'lava', 'mud', 'ice'] as const) }, radius: 500 + rand() * 4000, points: [point, { x: point.x + 3000, z: point.z + 1000 }] }
      : { kind: 'sculpt', mode: pick(['raise', 'lower', 'flatten', 'smooth'] as const), radius: 800 + rand() * 4000, strength: rand() * 400, targetHeight: rand() * 500, points: [point] }).project;
  }
  if (rand() < 0.2) p = updateTerrain(p, { enabled: false });
  if (rand() < 0.3) p = updateTerrain(p, { boundary: 'fall' });
  if (rand() < 0.5) p = addProp(p, { objectId: 0x133, position: { x: 0, y: 100, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, snapToGround: rand() < 0.5 }).project;
  if (rand() < 0.3 && p.roads[0].points.length > 2) {
    const pt = p.roads[0].points[1];
    p = updateRoadPoint(p, rid, pt.id, { position: { ...pt.position, x: pt.position.x + 40000 } });
  }
  return p;
}

function allFinite(arrays: ArrayLike<number>[]): boolean {
  for (const a of arrays) for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}

describe('random designs never break the compiler', () => {
  const seeds = Array.from({ length: 120 }, (_, i) => i + 1);
  it.each(seeds)('seed %i', (seed) => {
    const project = randomProject(seed);
    const geometry = compileGeometry(project, kit);
    for (const m of geometry.meshes) {
      expect(allFinite([m.positions, m.normals, m.uvs])).toBe(true);
      expect(m.indices.length % 3).toBe(0);
      for (let i = 0; i < m.indices.length; i++) if (m.indices[i] >= m.positions.length / 3) throw new Error(`bad index in ${m.name}`);
    }
    expect(allFinite([geometry.collision.positions])).toBe(true);
    expect(geometry.collision.indices.length).toBe(geometry.collision.flags.length * 3);
    const gen = generateKmp(project, kit);
    const kmp = gen.kmp;
    for (const cp of kmp.checkpoints) expect(allFinite([[cp.x1, cp.z1, cp.x2, cp.z2]])).toBe(true);
    for (const e of kmp.enemyPoints) expect(allFinite([[e.position.x, e.position.y, e.position.z]])).toBe(true);
    for (const c of kmp.cameras) expect(allFinite([[c.position.x, c.position.y, c.position.z, c.viewStart.x, c.viewEnd.z, c.time]])).toBe(true);
    if (project.roads[0].closed && project.roads[0].points.length >= 3) {
      const errors = validateKmpFile(kmp).filter((i) => i.level === 'error');
      expect(errors).toEqual([]);
    }
    const analysis = analyzeProject(project, kit, { kmp, issues: gen.issues });
    for (const issue of analysis.issues) {
      expect(issue.message.length).toBeGreaterThan(5);
      expect(`${issue.message} ${issue.fix ?? ''}`).not.toMatch(/KMP|KCL|CKPT|ENPT|GOBJ|BRRES|MDL0|undefined|NaN/);
    }
  });
});
