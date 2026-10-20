import { beforeEach, describe, expect, it } from 'vitest';
import type { CreateProject, Road } from './types';
import { useDeterministicIds } from './ids';
import { createSyntheticKit } from './__tests__/syntheticKit';
import { createProjectFromTemplate } from './templates';
import {
  addPiece,
  addProp,
  addRoad,
  addTerrainStroke,
  appendRoadPoint,
  deletePiece,
  deleteProp,
  deleteRoad,
  deleteRoadPoint,
  deleteSection,
  deleteSelection,
  deleteTerrainStroke,
  eraseProps,
  insertRoadPoint,
  migrateProject,
  moveSectionStart,
  ProjectMigrationError,
  renameProject,
  reverseRoad,
  scatterProps,
  selectionExists,
  setRoadClosed,
  setStart,
  setTheme,
  splitSection,
  updateGeneration,
  updatePiece,
  updateProp,
  updateRoad,
  updateRoadPoint,
  updateSection,
  updateSettings,
  updateTerrain,
} from './ops';
import { evaluateRoadAt, roadParamEnd } from './spline';
import { CREATE_PROJECT_VERSION } from './types';

const kit = createSyntheticKit();
const blank = () => createProjectFromTemplate('blank', { name: 'Test', themeId: 'test', laps: 3 }, kit);
const oval = () => createProjectFromTemplate('oval', { name: 'Test', themeId: 'test', laps: 3 }, kit);

const square = (p: CreateProject) =>
  addRoad(p, {
    points: [
      { position: { x: 0, y: 0, z: 0 } },
      { position: { x: 20000, y: 0, z: 0 } },
      { position: { x: 20000, y: 0, z: 20000 } },
      { position: { x: 0, y: 0, z: 20000 } },
      { position: { x: -6000, y: 0, z: 10000 } },
    ],
    closed: true,
  });

function whereIs(p: CreateProject, roadId: string, param: number) {
  const road = p.roads.find((r) => r.id === roadId)!;
  return evaluateRoadAt(road, param).position;
}

function expectNear(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, tolerance: number) {
  expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(tolerance);
}

function invariants(road: Road) {
  expect(road.sections.length).toBeGreaterThan(0);
  expect(road.sections[0].start).toBe(0);
  const end = roadParamEnd(road);
  for (let i = 0; i < road.sections.length; i++) {
    if (i > 0) expect(road.sections[i].start).toBeGreaterThan(road.sections[i - 1].start);
    if (end > 0) expect(road.sections[i].start).toBeLessThan(end);
  }
}

beforeEach(() => useDeterministicIds());

describe('purity', () => {
  it('never mutates its input', () => {
    const p = oval();
    const snapshot = JSON.stringify(p);
    const road = p.roads[0];
    insertRoadPoint(p, road.id, 3.4);
    deleteRoadPoint(p, road.id, road.points[2].id);
    reverseRoad(p, road.id);
    splitSection(p, road.id, 6.5);
    updateSection(p, road.id, road.sections[0].id, { kind: 'bridge' });
    deleteRoad(p, road.id);
    setRoadClosed(p, road.id, false);
    appendRoadPoint(p, road.id, { x: 1, y: 2, z: 3 });
    scatterProps(p, { objectId: 1, center: { x: 0, z: 50000 }, radius: 8000, spacing: 1500, seed: 3, scale: 1 });
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});

describe('roads and points', () => {
  it('the first road becomes the main road and the start line', () => {
    const p = blank();
    const { project, id } = square(p);
    expect(project.roads).toHaveLength(1);
    expect(project.start.roadId).toBe(id);
    expect(project.roads[0].closed).toBe(true);
    expect(project.roads[0].points).toHaveLength(5);
    expect(project.roads[0].points[0].width).toBe(3600);
    invariants(project.roads[0]);
    const second = addRoad(project, { styleId: 'trail' });
    expect(second.project.roads).toHaveLength(2);
    expect(second.project.start.roadId).toBe(id);
    expect(second.project.roads[1].points[0]).toBeUndefined();
  });

  it('appends points to the end or the start, carrying the width', () => {
    let p = addRoad(blank(), {}).project;
    const rid = p.roads[0].id;
    p = appendRoadPoint(p, rid, { x: 0, y: 0, z: 0 }).project;
    p = appendRoadPoint(p, rid, { x: 5000, y: 0, z: 0 }).project;
    const added = appendRoadPoint(p, rid, { x: -5000, y: 10, z: 0 }, { atStart: true });
    p = added.project;
    expect(p.roads[0].points.map((pt) => pt.position.x)).toEqual([-5000, 0, 5000]);
    expect(p.roads[0].points[0].id).toBe(added.id);
    expect(p.roads[0].points[0].position.y).toBe(10);
  });

  it('inserting a point keeps sections, pieces and the start where they were', () => {
    let p = square(blank()).project;
    const rid = p.roads[0].id;
    p = splitSection(p, rid, 2.0).project;
    p = splitSection(p, rid, 3.6).project;
    p = addPiece(p, { kind: 'boostPanel', roadId: rid, param: 2.5, lateral: 0.2, width: 1000, length: 1500 }).project;
    p = setStart(p, rid, 3.2);
    const before = {
      piece: whereIs(p, rid, p.pieces[0].param),
      start: whereIs(p, rid, p.start.param),
      sections: p.roads[0].sections.map((s) => whereIs(p, rid, s.start)),
    };
    const inserted = insertRoadPoint(p, rid, 1.5);
    const q = inserted.project;
    expect(q.roads[0].points).toHaveLength(6);
    expect(q.roads[0].points[2].id).toBe(inserted.id);
    // Everything after the new point moved up by one.
    expect(q.pieces[0].param).toBeCloseTo(3.5, 5);
    expect(q.start.param).toBeCloseTo(4.2, 5);
    expect(q.roads[0].sections.map((s) => s.start)).toEqual([0, 3, 4.6]);
    // ...and sits at (about) the same place on the road.
    expectNear(whereIs(q, rid, q.pieces[0].param), before.piece, 400);
    expectNear(whereIs(q, rid, q.start.param), before.start, 400);
    q.roads[0].sections.forEach((s, i) => expectNear(whereIs(q, rid, s.start), before.sections[i], 400));
    invariants(q.roads[0]);
  });

  it('inserting inside a section stretch remaps parameters inside that segment', () => {
    let p = square(blank()).project;
    const rid = p.roads[0].id;
    p = addPiece(p, { kind: 'itemRow', roadId: rid, param: 1.25, lateral: 0, width: 2000, length: 0, count: 4 }).project;
    const q = insertRoadPoint(p, rid, 1.5).project;
    // Old 1.25 is half way to the new point at 1.5, so it lands half way along the first half: 1.5.
    expect(q.pieces[0].param).toBeCloseTo(1.5, 5);
    expect(q.pieces[0].param).toBeGreaterThan(1);
    expect(q.pieces[0].param).toBeLessThan(2);
  });

  it('deleting a point merges the two segments around it and shifts later parameters', () => {
    let p = square(blank()).project;
    const rid = p.roads[0].id;
    p = splitSection(p, rid, 3.5).project;
    p = addPiece(p, { kind: 'boostPanel', roadId: rid, param: 4.5, lateral: 0, width: 1000, length: 1500 }).project;
    p = addPiece(p, { kind: 'boostPanel', roadId: rid, param: 1.9, lateral: 0, width: 1000, length: 1500 }).project;
    const q = deleteRoadPoint(p, rid, p.roads[0].points[2].id);
    expect(q.roads[0].points).toHaveLength(4);
    expect(q.pieces[0].param).toBeCloseTo(3.5, 5); // after the deleted point: down by one
    expect(q.pieces[1].param).toBeCloseTo(1.45, 5); // squeezed onto the merged segment 1..3 -> 1..2
    expect(q.roads[0].sections.map((s) => s.start)).toEqual([0, 2.5]);
    invariants(q.roads[0]);
  });

  it('deleting the first point of a closed road keeps every invariant', () => {
    let p = square(blank()).project;
    const rid = p.roads[0].id;
    p = splitSection(p, rid, 0.5).project;
    p = splitSection(p, rid, 3.7).project;
    p = setStart(p, rid, 0.3);
    const q = deleteRoadPoint(p, rid, p.roads[0].points[0].id);
    const road = q.roads[0];
    expect(road.points).toHaveLength(4);
    expect(road.closed).toBe(true);
    invariants(road);
    expect(q.start.param).toBeGreaterThanOrEqual(0);
    expect(q.start.param).toBeLessThan(4);
  });

  it('opens the loop when too few points remain', () => {
    let p = square(blank()).project;
    const rid = p.roads[0].id;
    p = deleteRoadPoint(p, rid, p.roads[0].points[0].id);
    p = deleteRoadPoint(p, rid, p.roads[0].points[0].id);
    expect(p.roads[0].points).toHaveLength(3);
    p = deleteRoadPoint(p, rid, p.roads[0].points[0].id);
    expect(p.roads[0].points).toHaveLength(2);
    expect(p.roads[0].closed).toBe(false);
    invariants(p.roads[0]);
  });

  it('updates a point and clamps its width', () => {
    let p = square(blank()).project;
    const road = p.roads[0];
    p = updateRoadPoint(p, road.id, road.points[1].id, { width: 10, bank: 12, corner: 'sharp', position: { x: 1, y: 2, z: 3 } });
    const pt = p.roads[0].points[1];
    expect(pt.width).toBe(200);
    expect(pt.bank).toBe(12);
    expect(pt.corner).toBe('sharp');
    expect(pt.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(updateRoadPoint(p, road.id, 'nope', { bank: 3 })).toBe(p);
  });

  it('closes and opens a road', () => {
    let p = square(blank()).project;
    const rid = p.roads[0].id;
    p = addPiece(p, { kind: 'boostPanel', roadId: rid, param: 4.6, lateral: 0, width: 1000, length: 1500 }).project;
    const open = setRoadClosed(p, rid, false);
    expect(open.roads[0].closed).toBe(false);
    expect(roadParamEnd(open.roads[0])).toBe(4);
    expect(open.pieces[0].param).toBeLessThanOrEqual(4);
    const closedAgain = setRoadClosed(open, rid, true);
    expect(closedAgain.roads[0].closed).toBe(true);
    expect(setRoadClosed(addRoad(blank(), { points: [{ position: { x: 0, y: 0, z: 0 } }, { position: { x: 1000, y: 0, z: 0 } }] }).project, 'x', true)).toBeDefined();
    const two = addRoad(blank(), { points: [{ position: { x: 0, y: 0, z: 0 } }, { position: { x: 1000, y: 0, z: 0 } }] });
    expect(setRoadClosed(two.project, two.id, true).roads[0].closed).toBe(false);
  });

  it('reversing a road keeps pieces and the start in place, swaps edges and flips banking', () => {
    let p = oval();
    const rid = p.roads[0].id;
    p = updateSection(p, rid, p.roads[0].sections[0].id, { left: { wall: 'wall', wallHeight: 300 } });
    p = splitSection(p, rid, 6.5).project;
    p = updateSection(p, rid, p.roads[0].sections[1].id, { kind: 'bridge' });
    p = addPiece(p, { kind: 'trickRamp', roadId: rid, param: 9.2, lateral: 0.4, width: 1500, length: 2000, height: 400 }).project;
    const before = {
      piece: whereIs(p, rid, p.pieces.find((x) => x.kind === 'trickRamp')!.param),
      start: whereIs(p, rid, p.start.param),
      bank: p.roads[0].points.map((pt) => pt.bank),
    };
    const q = reverseRoad(p, rid);
    expect(q.roads[0].points).toHaveLength(p.roads[0].points.length);
    expect(q.roads[0].points[0].id).toBe(p.roads[0].points[0].id);
    expectNear(whereIs(q, rid, q.pieces.find((x) => x.kind === 'trickRamp')!.param), before.piece, 2);
    expectNear(whereIs(q, rid, q.start.param), before.start, 2);
    expect(q.pieces.find((x) => x.kind === 'trickRamp')!.lateral).toBeCloseTo(-0.4, 6);
    expect(q.roads[0].points[1].bank).toBeCloseTo(-p.roads[0].points[p.roads[0].points.length - 1].bank, 6);
    expect(q.roads[0].sections.some((s) => s.kind === 'bridge')).toBe(true);
    expect(q.roads[0].sections.some((s) => s.right?.wall === 'wall')).toBe(true);
    expect(q.roads[0].sections.some((s) => s.left?.wall === 'wall')).toBe(false);
    invariants(q.roads[0]);
    // Twice is the identity (up to float noise).
    const back = reverseRoad(q, rid);
    expect(back.roads[0].points.map((pt) => pt.id)).toEqual(p.roads[0].points.map((pt) => pt.id));
    expect(back.start.param).toBeCloseTo(p.start.param, 6);
    expect(back.pieces.find((x) => x.kind === 'trickRamp')!.param).toBeCloseTo(p.pieces.find((x) => x.kind === 'trickRamp')!.param, 6);
    expect(back.roads[0].sections.map((s) => s.kind)).toEqual(p.roads[0].sections.map((s) => s.kind));
    expect(back.roads[0].sections.map((s) => s.start).map((v) => Math.round(v * 1e6) / 1e6)).toEqual(p.roads[0].sections.map((s) => s.start));
  });

  it('reversing an open road mirrors the parameters', () => {
    const added = addRoad(blank(), { points: [0, 1, 2, 3].map((i) => ({ position: { x: i * 8000, y: 0, z: (i % 2) * 3000 } })) });
    let p = added.project;
    p = addPiece(p, { kind: 'itemRow', roadId: added.id, param: 0.5, lateral: 0, width: 2000, length: 0, count: 3 }).project;
    const q = reverseRoad(p, added.id);
    expect(q.pieces[0].param).toBeCloseTo(2.5, 6);
    expect(q.roads[0].points[0].id).toBe(p.roads[0].points[3].id);
  });

  it('deleting a road removes its pieces, moves the start and clears shortcut links', () => {
    let p = oval();
    const main = p.roads[0];
    const sc = addRoad(p, { points: [{ position: { x: 0, y: 0, z: 0 } }, { position: { x: 5000, y: 0, z: 0 } }], name: 'Shortcut' });
    p = updateRoad(sc.project, sc.id, { branch: { fromRoadId: main.id, fromParam: 2, toRoadId: main.id, toParam: 5 } });
    expect(p.roads[1].branch).toBeDefined();
    const withOtherPiece = addPiece(p, { kind: 'itemRow', roadId: sc.id, param: 0.5, lateral: 0, width: 1000, length: 0, count: 3 }).project;
    const gone = deleteRoad(withOtherPiece, sc.id);
    expect(gone.roads).toHaveLength(1);
    expect(gone.pieces.some((x) => x.roadId === sc.id)).toBe(false);
    const mainGone = deleteRoad(p, main.id);
    expect(mainGone.roads).toHaveLength(1);
    expect(mainGone.roads[0].branch).toBeUndefined();
    expect(mainGone.start.roadId).toBe(sc.id);
    expect(mainGone.pieces.every((x) => x.roadId === sc.id)).toBe(true);
    expect(deleteRoad(mainGone, sc.id).start.roadId).toBe('');
  });

  it('updates road metadata', () => {
    let p = oval();
    const rid = p.roads[0].id;
    p = updateRoad(p, rid, { name: 'Loop', styleId: 'walled' });
    expect(p.roads[0].name).toBe('Loop');
    expect(p.roads[0].styleId).toBe('walled');
    const open = updateRoad(p, rid, { closed: false });
    expect(open.roads[0].closed).toBe(false);
  });
});

describe('sections', () => {
  it('splits, edits, moves and deletes', () => {
    let p = oval();
    const rid = p.roads[0].id;
    const split = splitSection(p, rid, 5.5);
    p = split.project;
    expect(p.roads[0].sections.map((s) => s.start)).toEqual([0, 5.5]);
    // Splitting at an existing boundary changes nothing.
    expect(splitSection(p, rid, 5.51).project).toBe(p);
    expect(splitSection(p, rid, 5.51).id).toBe(split.id);
    p = updateSection(p, rid, split.id, { kind: 'tunnel', label: 'Cave', surface: { slot: 'roadAlt' }, left: { wall: 'wall' } });
    const sec = p.roads[0].sections[1];
    expect(sec.kind).toBe('tunnel');
    expect(sec.left?.wall).toBe('wall');
    p = updateSection(p, rid, split.id, { left: { curb: false } });
    expect(p.roads[0].sections[1].left).toEqual({ wall: 'wall', curb: false });
    p = updateSection(p, rid, split.id, { left: undefined, surface: undefined });
    expect(p.roads[0].sections[1].left).toBeUndefined();
    expect(p.roads[0].sections[1].surface).toBeUndefined();

    const split2 = splitSection(p, rid, 9.0);
    p = split2.project;
    p = moveSectionStart(p, rid, split.id, 8.99);
    expect(p.roads[0].sections[1].start).toBeLessThan(9);
    expect(p.roads[0].sections[1].start).toBeGreaterThan(8.9);
    p = moveSectionStart(p, rid, split.id, 0);
    expect(p.roads[0].sections[1].start).toBeGreaterThan(0);
    // The first section cannot move.
    expect(moveSectionStart(p, rid, p.roads[0].sections[0].id, 3)).toBe(p);
    p = deleteSection(p, rid, split2.id);
    expect(p.roads[0].sections).toHaveLength(2);
    p = deleteSection(p, rid, p.roads[0].sections[0].id);
    expect(p.roads[0].sections).toHaveLength(1);
    expect(p.roads[0].sections[0].start).toBe(0);
    expect(deleteSection(p, rid, p.roads[0].sections[0].id)).toBe(p);
    invariants(p.roads[0]);
  });
});

describe('start, pieces and props', () => {
  it('moves the start and wraps the parameter', () => {
    let p = oval();
    p = setStart(p, p.roads[0].id, 99.5);
    expect(p.start.param).toBeLessThan(roadParamEnd(p.roads[0]));
    expect(p.start.param).toBeGreaterThanOrEqual(0);
  });

  it('adds, updates and deletes pieces and props', () => {
    let p = oval();
    const rid = p.roads[0].id;
    const piece = addPiece(p, { kind: 'itemRow', roadId: rid, param: 1.5, lateral: 0, width: 2000, length: 0, count: 5 });
    p = updatePiece(piece.project, piece.id, { count: 3, lateral: 0.2 });
    expect(p.pieces.find((x) => x.id === piece.id)).toMatchObject({ count: 3, lateral: 0.2 });
    p = deletePiece(p, piece.id);
    expect(p.pieces.find((x) => x.id === piece.id)).toBeUndefined();

    const prop = addProp(p, { objectId: 0x133, position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, snapToGround: true });
    p = updateProp(prop.project, prop.id, { snapToGround: false });
    expect(p.props[0].snapToGround).toBe(false);
    p = deleteProp(p, prop.id);
    expect(p.props).toHaveLength(0);
  });

  it('scatters deterministically, away from roads, and erases in a circle', () => {
    const p = oval();
    const options = { objectId: 0x133, center: { x: 0, z: 36000 }, radius: 9000, spacing: 1800, seed: 7, scale: 1.2 };
    const a = scatterProps(p, options);
    const b = scatterProps(p, options);
    expect(a.ids.length).toBeGreaterThan(20);
    expect(a.project.props.map((x) => [x.position.x, x.position.z, x.rotation.y])).toEqual(b.project.props.map((x) => [x.position.x, x.position.z, x.rotation.y]));
    expect(scatterProps(p, { ...options, seed: 8 }).project.props[0].position.x).not.toBe(a.project.props[0].position.x);
    for (const prop of a.project.props) {
      expect(Math.hypot(prop.position.x - 0, prop.position.z - 36000)).toBeLessThanOrEqual(9000);
      expect(prop.snapToGround).toBe(true);
      expect(prop.scale.x).toBeGreaterThan(1);
    }
    // Scattering right on the road places nothing on it.
    const onRoad = scatterProps(p, { ...options, center: { x: 0, z: 15000 }, radius: 3000 });
    for (const prop of onRoad.project.props) expect(Math.abs(prop.position.z - 15000)).toBeGreaterThan(3000);
    const erased = eraseProps(a.project, { x: 0, z: 36000 }, 4000);
    expect(erased.props.length).toBeLessThan(a.project.props.length);
    expect(erased.props.every((x) => Math.hypot(x.position.x, x.position.z - 36000) > 4000)).toBe(true);
    expect(eraseProps(a.project, { x: 1e6, z: 1e6 }, 10)).toBe(a.project);
  });
});

describe('terrain, settings and theme', () => {
  it('adds and deletes strokes', () => {
    let p = oval();
    const paint = addTerrainStroke(p, { kind: 'paint', surface: null, radius: 500, points: [{ x: 0, z: 0 }] });
    const sculpt = addTerrainStroke(paint.project, { kind: 'sculpt', mode: 'raise', radius: 900, strength: 40, points: [{ x: 1, z: 1 }] });
    expect(sculpt.project.terrainStrokes.map((s) => s.kind)).toEqual(['paint', 'sculpt']);
    p = deleteTerrainStroke(sculpt.project, paint.id);
    expect(p.terrainStrokes).toHaveLength(1);
    expect(deleteTerrainStroke(p, 'zzz')).toBe(p);
  });

  it('updates settings, terrain and generation options', () => {
    let p = oval();
    p = updateSettings(p, { laps: 12 });
    expect(p.settings.laps).toBe(9);
    p = updateSettings(p, { laps: 0 });
    expect(p.settings.laps).toBe(1);
    p = updateTerrain(p, { enabled: false, boundary: 'fall' });
    expect(p.terrain).toMatchObject({ enabled: false, boundary: 'fall' });
    p = updateGeneration(p, { checkpointSpacing: 4000, lockedKmpSections: ['enemy'] });
    expect(p.generation.checkpointSpacing).toBe(4000);
    p = setTheme(p, 'test2');
    expect(p.themeId).toBe('test2');
    expect(setTheme(p, 'test2')).toBe(p);
    p = renameProject(p, '  ');
    expect(p.name).toBe('Test');
    p = renameProject(p, 'Rainbow Rumble');
    expect(p.name).toBe('Rainbow Rumble');
  });
});

describe('setTheme with a kit', () => {
  const tall = createSyntheticKit({ baseHeights: [470, 11600], scenery: true });
  const make = () => createProjectFromTemplate('oval', { name: 'Test', themeId: 'test', laps: 3 }, tall);

  it('moves a design that still sits at the old base height to the new one', () => {
    const p = setTheme(make(), 'test2', tall);
    expect(p.themeId).toBe('test2');
    expect(p.terrain.baseHeight).toBe(11600);
    for (const point of p.roads[0].points) expect(point.position.y).toBe(11600);
    expect(p.props.length).toBeGreaterThan(0);
    for (const prop of p.props) expect(prop.position.y).toBe(11600);
    // And back again.
    expect(setTheme(p, 'test', tall).roads[0].points[0].position.y).toBe(470);
  });

  it('leaves a design the user moved on purpose, and works without a kit', () => {
    const lifted = updateTerrain(make(), { baseHeight: 900 });
    const p = setTheme(lifted, 'test2', tall);
    expect(p.terrain.baseHeight).toBe(900);
    expect(p.roads[0].points[0].position.y).toBe(470);
    expect(setTheme(make(), 'test2').terrain.baseHeight).toBe(470);
  });
});

describe('deleteSelection', () => {
  it('deletes a mixed selection', () => {
    let p = oval();
    const rid = p.roads[0].id;
    const sec = splitSection(p, rid, 4.5);
    p = sec.project;
    const piece = addPiece(p, { kind: 'boostPanel', roadId: rid, param: 2, lateral: 0, width: 1000, length: 1500 });
    const prop = addProp(piece.project, { objectId: 1, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, snapToGround: true });
    const stroke = addTerrainStroke(prop.project, { kind: 'paint', surface: null, radius: 100, points: [{ x: 0, z: 0 }] });
    p = stroke.project;
    const pointId = p.roads[0].points[3].id;
    const q = deleteSelection(p, [
      { kind: 'section', roadId: rid, sectionId: sec.id },
      { kind: 'piece', pieceId: piece.id },
      { kind: 'prop', propId: prop.id },
      { kind: 'stroke', strokeId: stroke.id },
      { kind: 'point', roadId: rid, pointId },
      { kind: 'start' },
    ]);
    expect(q.roads[0].sections).toHaveLength(1);
    expect(q.pieces.find((x) => x.id === piece.id)).toBeUndefined();
    expect(q.props).toHaveLength(0);
    expect(q.terrainStrokes).toHaveLength(0);
    expect(q.roads[0].points.find((pt) => pt.id === pointId)).toBeUndefined();
    expect(q.start.roadId).toBe(rid);
    const gone = deleteSelection(p, [{ kind: 'road', roadId: rid }, { kind: 'point', roadId: rid, pointId }]);
    expect(gone.roads).toHaveLength(0);
  });

  it('knows whether a selection still exists', () => {
    const p = oval();
    const rid = p.roads[0].id;
    expect(selectionExists(p, { kind: 'road', roadId: rid })).toBe(true);
    expect(selectionExists(p, { kind: 'road', roadId: 'x' })).toBe(false);
    expect(selectionExists(p, { kind: 'point', roadId: rid, pointId: p.roads[0].points[0].id })).toBe(true);
    expect(selectionExists(p, { kind: 'piece', pieceId: p.pieces[0].id })).toBe(true);
    expect(selectionExists(p, { kind: 'start' })).toBe(true);
    expect(selectionExists(blank(), { kind: 'start' })).toBe(false);
  });
});

describe('migrateProject', () => {
  it('round-trips a project through JSON', () => {
    const p = oval();
    const again = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(again.roads[0].points).toEqual(p.roads[0].points);
    expect(again.pieces).toEqual(p.pieces);
    expect(again.version).toBe(CREATE_PROJECT_VERSION);
  });

  it('fills in anything missing and repairs section invariants', () => {
    const fixed = migrateProject({
      name: 'Old',
      roads: [{ points: [{ position: { x: 0, y: 0, z: 0 } }, { position: { x: 1000, y: 0, z: 0 } }, { position: { x: 1000, y: 0, z: 1000 } }], closed: true, sections: [{ id: 'a', start: 1.5, kind: 'road' }] }],
    });
    expect(fixed.roads[0].closed).toBe(true);
    expect(fixed.roads[0].sections[0].start).toBe(0);
    expect(fixed.roads[0].sections).toHaveLength(2);
    expect(fixed.settings.laps).toBe(3);
    expect(fixed.terrain.enabled).toBe(true);
    expect(fixed.start.roadId).toBe(fixed.roads[0].id);
    expect(fixed.generation.checkpointSpacing).toBeGreaterThan(0);
  });

  it('rejects junk and newer files', () => {
    expect(() => migrateProject(null)).toThrow(ProjectMigrationError);
    expect(() => migrateProject({ version: 99 })).toThrow(ProjectMigrationError);
    expect(migrateProject({}).roads).toEqual([]);
  });
});
