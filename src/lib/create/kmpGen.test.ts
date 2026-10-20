import { beforeAll, describe, expect, it } from 'vitest';
import { readKmpFile, writeKmpFile, KMP_NULL_INDEX_8, type KmpFile } from '../kmpFile';
import { validateKmpFile } from '../kmpValidation';
import { computeLapPathValidity, getCheckpointGraph, checkpointCenter, checkpointHeadingDegrees } from '../kmpGraph';
import type { CreateKit, CreateProject } from './types';
import { useDeterministicIds } from './ids';
import { createSyntheticKit } from './__tests__/syntheticKit';
import { LAYOUT_TEMPLATES, createProjectFromTemplate } from './templates';
import { generateKmp, START_OFFSET } from './kmpGen';
import { evaluateRoadAt, projectOntoRoad, roadLength } from './spline';
import { addRoad, updateGeneration, updateRoad, updateSettings, addPiece } from './ops';
import { segmentsIntersect2D, headingDegrees } from './math';
import { compileGeometry } from './compile';
import { createSurfaceQuery } from './raycast';

let kit: CreateKit;
beforeAll(() => {
  useDeterministicIds();
  kit = createSyntheticKit();
});

const templates = LAYOUT_TEMPLATES.filter((t) => t.id !== 'blank');
const make = (id: string): CreateProject => createProjectFromTemplate(id, { name: 't', themeId: 'test', laps: 3 }, kit);

describe.each(templates.map((t) => t.id))('generated KMP: %s', (id) => {
  let project: CreateProject;
  let kmp: KmpFile;
  beforeAll(() => {
    project = make(id);
    kmp = generateKmp(project, kit).kmp;
  });

  it('passes validation with zero errors', () => {
    const issues = validateKmpFile(kmp);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    // Nothing else the editor would nag about either.
    expect(issues.filter((i) => i.level === 'warning' && !i.code.startsWith('object.'))).toEqual([]);
  });

  it('survives a write/read round trip', () => {
    const again = readKmpFile(writeKmpFile(kmp));
    expect(again.checkpoints.length).toBe(kmp.checkpoints.length);
    expect(again.enemyPoints.length).toBe(kmp.enemyPoints.length);
    expect(again.cameras.length).toBe(kmp.cameras.length);
    expect(again.routes.length).toBe(kmp.routes.length);
    expect(again.firstOpeningCamera).toBe(kmp.firstOpeningCamera);
    expect(validateKmpFile(again).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('puts the lap line exactly at the start line, perpendicular to the road', () => {
    const road = project.roads[0];
    const start = evaluateRoadAt(road, project.start.param);
    const cp0 = kmp.checkpoints[0];
    expect(cp0.type).toBe(0);
    const c = checkpointCenter(cp0);
    expect(Math.hypot(c.x - start.position.x, c.z - start.position.z)).toBeLessThan(1);
    const heading = checkpointHeadingDegrees(cp0);
    const roadHeading = headingDegrees(start.tangent);
    let d = Math.abs(heading - roadHeading) % 360;
    if (d > 180) d = 360 - d;
    expect(d).toBeLessThan(1);
    // It spans the whole road with room to spare.
    expect(Math.hypot(cp0.x2 - cp0.x1, cp0.z2 - cp0.z1)).toBeGreaterThan(start.width * 1.8);
  });

  it('numbers key checkpoints 1..K in order and spaces checkpoints like the setting', () => {
    const keys = kmp.checkpoints.filter((c) => c.type !== KMP_NULL_INDEX_8 && c.type !== 0).map((c) => c.type);
    expect(keys).toEqual(Array.from({ length: keys.length }, (_, i) => i + 1));
    expect(keys.length).toBe(project.generation.keyCheckpoints);
    const lap = roadLength(project.roads[0]);
    expect(Math.abs(lap / kmp.checkpoints.length - project.generation.checkpointSpacing)).toBeLessThan(project.generation.checkpointSpacing * 0.25);
    const validity = computeLapPathValidity(getCheckpointGraph(kmp));
    expect(validity.closedLoop).toBe(true);
    expect(validity.missingKeyCheckpoints).toEqual([]);
    expect(validity.keyCheckpointsInOrder).toBe(true);
    expect(validity.hasLapCounter).toBe(true);
  });

  it('never lets neighbouring checkpoint lines cross', () => {
    const n = kmp.checkpoints.length;
    for (let i = 0; i < n; i++) {
      const a = kmp.checkpoints[i];
      const b = kmp.checkpoints[(i + 1) % n];
      expect(segmentsIntersect2D(a.x1, a.z1, a.x2, a.z2, b.x1, b.z1, b.x2, b.z2)).toBe(false);
    }
  });

  it('every checkpoint line covers the road under it', () => {
    const road = project.roads[0];
    for (const cp of kmp.checkpoints) {
      const c = checkpointCenter(cp);
      const proj = projectOntoRoad(road, c, { heightWeight: 0 })!;
      expect(proj.distanceToCenter).toBeLessThan(2);
      const half = Math.hypot(cp.x2 - cp.x1, cp.z2 - cp.z1) / 2;
      expect(half).toBeGreaterThan(proj.sample.width / 2);
    }
  });

  it('places respawns on the road facing forward and assigns them to checkpoints', () => {
    const road = project.roads[0];
    expect(kmp.respawnPoints.length).toBe(Math.ceil(kmp.checkpoints.length / project.generation.respawnEvery));
    for (const r of kmp.respawnPoints) {
      const proj = projectOntoRoad(road, r.position, { heightWeight: 0 })!;
      expect(proj.distanceToCenter).toBeLessThan(5);
      expect(r.position.y - proj.position.y).toBeGreaterThan(0);
      let d = Math.abs(r.rotation.y - headingDegrees(proj.sample.tangent)) % 360;
      if (d > 180) d = 360 - d;
      expect(d).toBeLessThan(2);
    }
    let last = 0;
    for (const cp of kmp.checkpoints) {
      expect(cp.respawnIndex).toBeLessThan(kmp.respawnPoints.length);
      expect(cp.respawnIndex).toBeGreaterThanOrEqual(last);
      last = cp.respawnIndex;
    }
    expect(kmp.checkpoints[0].respawnIndex).toBe(0);
  });

  it('sets the start point behind the line, facing forward, on the road', () => {
    const road = project.roads[0];
    expect(kmp.startPoints).toHaveLength(1);
    const kt = kmp.startPoints[0];
    const start = evaluateRoadAt(road, project.start.param);
    const dist = Math.hypot(kt.position.x - start.position.x, kt.position.z - start.position.z);
    expect(dist).toBeGreaterThan(START_OFFSET * 0.9);
    expect(dist).toBeLessThan(START_OFFSET * 1.1);
    const forward = { x: start.tangent.x, z: start.tangent.z };
    const behind = (kt.position.x - start.position.x) * forward.x + (kt.position.z - start.position.z) * forward.z;
    expect(behind).toBeLessThan(0);
    const proj = projectOntoRoad(road, kt.position, { heightWeight: 0 })!;
    expect(Math.abs(proj.lateralNorm)).toBeLessThan(0.05);
    expect(kt.playerIndex).toBe(-1);
  });

  it('lays enemy and item routes along the centre of the road at the configured spacing', () => {
    const road = project.roads[0];
    const lap = roadLength(road);
    for (const [points, spacing] of [
      [kmp.enemyPoints, project.generation.enemySpacing],
      [kmp.itemPoints, project.generation.itemSpacing],
    ] as const) {
      expect(Math.abs(lap / points.length - spacing)).toBeLessThan(spacing * 0.25);
      for (const p of points) {
        const proj = projectOntoRoad(road, p.position, { heightWeight: 0 })!;
        expect(proj.distanceToCenter).toBeLessThan(5);
        expect(p.range).toBeGreaterThan(0);
      }
    }
    expect(kmp.enemyGroups).toHaveLength(1);
    expect(kmp.enemyGroups[0].next[0]).toBe(0);
  });

  it('writes stage info from the settings', () => {
    const stage = kmp.stage[0];
    expect(stage.lapCount).toBe(3);
    expect(stage.polePosition).toBe(0);
    const p2 = updateSettings(updateSettings(project, { laps: 5, polePosition: 'right', narrowStart: true, lensFlare: false }), {});
    const s2 = generateKmp(p2, kit).kmp.stage[0];
    expect(s2.lapCount).toBe(5);
    expect(s2.polePosition).toBe(1);
    expect(s2.driverDistance).toBe(1);
    expect(s2.lensFlareFlash).toBe(1);
  });

  it('has an opening camera chain that ends, a goal camera and valid routes', () => {
    expect(kmp.cameras[0].type).toBe(0);
    let cur = kmp.firstOpeningCamera;
    const chain: number[] = [];
    while (cur !== KMP_NULL_INDEX_8) {
      chain.push(cur);
      cur = kmp.cameras[cur].nextIndex;
      expect(chain.length).toBeLessThan(10);
    }
    expect(chain.length).toBe(3);
    const frames = chain.reduce((n, i) => n + kmp.cameras[i].time, 0);
    expect(frames).toBeGreaterThan(500);
    expect(frames).toBeLessThan(1100);
    for (const i of chain) {
      const cam = kmp.cameras[i];
      expect(cam.type).toBe(5);
      if (cam.routeIndex !== KMP_NULL_INDEX_8) expect(kmp.routes[cam.routeIndex].points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('places item boxes exactly on the road surface', () => {
    const boxes = kmp.objects.filter((o) => o.objectId === 0x65);
    expect(boxes.length).toBeGreaterThanOrEqual(10);
    const road = project.roads[0];
    const query = createSurfaceQuery(compileGeometry(project, kit).collision);
    for (const b of boxes) {
      const proj = projectOntoRoad(road, b.position, { heightWeight: 0 })!;
      expect(Math.abs(proj.lateralNorm)).toBeLessThan(1);
      const ground = query.groundAt(b.position.x, b.position.y + 50, b.position.z)!;
      expect(Math.abs(b.position.y - ground)).toBeLessThan(3);
    }
  });
});

describe('generated KMP: extras', () => {
  it('produces a valid but minimal KMP when there is no road', () => {
    const p = make('blank');
    const out = generateKmp(p, kit);
    expect(out.kmp.checkpoints).toHaveLength(0);
    expect(out.kmp.stage).toHaveLength(1);
  });

  it('keeps hand-edited sections that are locked', () => {
    const p = make('oval');
    const first = generateKmp(p, kit).kmp;
    const edited = readKmpFile(writeKmpFile(first));
    edited.enemyPoints[3] = { ...edited.enemyPoints[3], range: 99, setting1: 7 };
    edited.objects = edited.objects.slice(0, 2);
    const locked = updateGeneration(p, { lockedKmpSections: ['enemy', 'objects'] });
    const out = generateKmp(locked, kit, { previous: edited }).kmp;
    expect(out.enemyPoints[3].range).toBe(99);
    expect(out.enemyPoints[3].setting1).toBe(7);
    expect(out.objects).toHaveLength(2);
    // Everything else is regenerated.
    expect(out.checkpoints.length).toBe(first.checkpoints.length);
    expect(validateKmpFile(out).filter((i) => i.level === 'error')).toEqual([]);
    const unlocked = generateKmp(p, kit, { previous: edited }).kmp;
    expect(unlocked.enemyPoints[3].range).not.toBe(99);
  });

  it('keeps the previous routes when cameras are locked, so their route indices stay valid', () => {
    const p = make('oval');
    const first = generateKmp(p, kit).kmp;
    const locked = updateGeneration(p, { lockedKmpSections: ['cameras'] });
    const out = generateKmp(locked, kit, { previous: first }).kmp;
    expect(out.cameras).toHaveLength(first.cameras.length);
    expect(validateKmpFile(out).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('turns hazards into objects with their own route', () => {
    let p = make('oval');
    p = addPiece(p, { kind: 'object', roadId: p.roads[0].id, param: 9.5, lateral: 0, width: 0, length: 0, objectId: 0x191, settings: [600, 40, 120, 0, 0, 0, 0, 0] }).project;
    const kmp = generateKmp(p, kit).kmp;
    const goomba = kmp.objects.find((o) => o.objectId === 0x191)!;
    expect(goomba).toBeDefined();
    expect(goomba.routeIndex).not.toBe(0xffff);
    const route = kmp.routes[goomba.routeIndex];
    expect(route.points.length).toBe(2);
    expect(route.smooth).toBe(0);
    expect(goomba.settings.slice(0, 3)).toEqual([600, 40, 120]);
    expect(validateKmpFile(kmp).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('splits path groups for a shortcut road and joins them again', () => {
    let p = make('oval');
    const main = p.roads[0];
    // A shortcut between main points 6 and 9, pulled towards the inside of the track.
    const pts = [6, 7, 8, 9].map((i) => ({ position: { x: main.points[i].position.x * 0.8, y: 0, z: main.points[i].position.z * 0.8 } }));
    const added = addRoad(p, { points: pts, styleId: main.styleId, closed: false, name: 'Shortcut' });
    p = updateRoad(added.project, added.id, { branch: { fromRoadId: main.id, fromParam: 6, toRoadId: main.id, toParam: 9 } });
    const out = generateKmp(p, kit);
    const kmp = out.kmp;
    expect(out.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(validateKmpFile(kmp).filter((i) => i.level === 'error')).toEqual([]);
    // before | main stretch + shortcut | after
    expect(kmp.checkpointGroups.length).toBe(4);
    expect(kmp.enemyGroups.length).toBe(4);
    expect(kmp.itemGroups.length).toBe(4);
    const g = getCheckpointGraph(kmp).groups;
    expect(g[0].next.length).toBe(2);
    expect(g[3].prev.length).toBe(2);
    expect(g[3].next).toEqual([0]);
    const validity = computeLapPathValidity(getCheckpointGraph(kmp));
    expect(validity.closedLoop).toBe(true);
    expect(validity.duplicateKeyCheckpoints).toEqual([]);
    expect(validity.issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('keeps the checkpoint count under the format limits on a huge track', () => {
    let p = make('oval');
    p = updateGeneration(p, { checkpointSpacing: 1500, enemySpacing: 1200, itemSpacing: 1200 });
    const kmp = generateKmp(p, kit).kmp;
    expect(kmp.checkpoints.length).toBeLessThan(255);
    expect(kmp.enemyPoints.length).toBeLessThan(255);
    expect(kmp.itemPoints.length).toBeLessThan(255);
    expect(validateKmpFile(kmp).filter((i) => i.level === 'error')).toEqual([]);
  });
});
