import { beforeAll, describe, expect, it } from 'vitest';
import type { CreateKit, CreateProject } from './types';
import { useDeterministicIds } from './ids';
import { createSyntheticKit } from './__tests__/syntheticKit';
import { createProjectFromTemplate } from './templates';
import { analyzeProject, countItemBoxes, MAX_OBJECTS } from './analyze';
import {
  addPiece,
  addProp,
  addRoad,
  deletePiece,
  setRoadClosed,
  setStart,
  splitSection,
  updateRoadPoint,
  updateSection,
} from './ops';
import { generateKmp } from './kmpGen';
import { createEmptyKmpFile } from '../kmpFile';

let kit: CreateKit;
beforeAll(() => {
  useDeterministicIds();
  kit = createSyntheticKit();
});

const tpl = (id: string): CreateProject => createProjectFromTemplate(id, { name: 'x', themeId: 'test', laps: 3 }, kit);
const codes = (p: CreateProject) => analyzeProject(p, kit).issues.map((i) => i.code);

describe('analyzeProject', () => {
  it('a blank design needs a road', () => {
    const a = analyzeProject(tpl('blank'), kit);
    expect(a.issues.map((i) => i.code)).toContain('road.none');
    expect(a.issues[0].level).toBe('error');
    expect(a.checklist.world.state).toBe('done');
    expect(a.checklist.roadLoop.state).toBe('todo');
    expect(a.checklist.startLine.state).toBe('todo');
    expect(a.checklist.itemBoxes.state).toBe('todo');
    expect(a.checklist.drivable.state).toBe('todo');
  });

  it('writes messages for people, with a fix', () => {
    const open = tpl('oval');
    const opened = setRoadClosed(open, open.roads[0].id, false);
    const found = analyzeProject(opened, kit).issues.find((i) => i.code === 'road.not-closed')!;
    expect(found.message).toBe('The road does not form a loop yet.');
    expect(found.fix).toMatch(/Click the first point/);
    expect(found.target).toEqual({ kind: 'road', roadId: open.roads[0].id });
    expect(found.level).toBe('error');
    for (const i of analyzeProject(opened, kit).issues) expect(i.message + ' ' + (i.fix ?? '')).not.toMatch(/KMP|KCL|CKPT|ENPT|GOBJ|BRRES|MDL0/);
  });

  it('flags a road with too few points, a very short lap and a very long one', () => {
    const two = addRoad(tpl('blank'), { points: [{ position: { x: 0, y: 0, z: 0 } }, { position: { x: 9000, y: 0, z: 0 } }] }).project;
    expect(codes(two)).toContain('road.too-few-points');
    const tiny = addRoad(tpl('blank'), {
      points: [
        { position: { x: 0, y: 0, z: 0 } },
        { position: { x: 9000, y: 0, z: 0 } },
        { position: { x: 9000, y: 0, z: 9000 } },
        { position: { x: 0, y: 0, z: 9000 } },
      ],
      closed: true,
    }).project;
    expect(codes(tiny)).toContain('road.too-short');
    const huge = { ...tpl('oval') };
    huge.roads = [{ ...huge.roads[0], points: huge.roads[0].points.map((pt) => ({ ...pt, position: { x: pt.position.x * 3, y: 0, z: pt.position.z * 3 } })) }];
    expect(codes(huge)).toContain('road.too-long');
  });

  it('calls a lap under about 20 seconds too short, and a road folded onto itself an overlap', () => {
    const loop = (w: number, h: number) =>
      addRoad(tpl('blank'), {
        points: [
          { position: { x: 0, y: 0, z: 0 } },
          { position: { x: w, y: 0, z: 0 } },
          { position: { x: w, y: 0, z: h } },
          { position: { x: 0, y: 0, z: h } },
        ],
        closed: true,
      }).project;
    // About 18 seconds of driving: short. About 30 seconds: fine.
    expect(codes(loop(21000, 21000))).toContain('road.too-short');
    expect(codes(loop(34000, 34000))).not.toContain('road.too-short');
    // A long, flat loop whose two sides lie closer together than the road is wide.
    const hairpin = addRoad(tpl('blank'), {
      points: [0, 15000, 30000, 45000].map((x) => ({ position: { x, y: 0, z: 0 } })).concat([45000, 30000, 15000, 0].map((x) => ({ position: { x, y: 0, z: 1200 } }))),
      closed: true,
    }).project;
    const folded = analyzeProject(hairpin, kit).issues.find((i) => i.code === 'road.overlaps-itself');
    expect(folded?.level).toBe('warning');
    expect(folded?.target?.kind).toBe('point');
    expect(codes(loop(34000, 34000))).not.toContain('road.overlaps-itself');
    // The shipped layouts never overlap themselves.
    for (const id of ['oval', 'kidney', 'figure-eight', 'twisty', 'hills']) expect(codes(tpl(id))).not.toContain('road.overlaps-itself');
  });

  it('flags corners tighter than the road is wide, with a point to show', () => {
    const p = tpl('oval');
    const pts = p.roads[0].points.map((pt, i) => (i === 4 ? { ...pt, position: { x: pt.position.x, y: 0, z: pt.position.z } } : pt));
    const pinched = { ...p, roads: [{ ...p.roads[0], points: pts.map((pt, i) => ({ ...pt, position: { x: pt.position.x * 0.12, y: 0, z: pt.position.z * 0.12 + (i % 2) * 300 } })) }] };
    const issue = analyzeProject(pinched, kit).issues.find((i) => i.code === 'road.tight-corner');
    expect(issue).toBeDefined();
    expect(issue!.target?.kind).toBe('point');
  });

  it('knows the difference between a bridge and a crossing at the same height', () => {
    const good = tpl('figure-eight');
    expect(codes(good)).not.toContain('road.crossing-same-height');
    expect(codes(good)).not.toContain('road.bridge-too-low');
    expect(codes(good)).not.toContain('road.crossing-not-bridge');

    // Flatten the bridge: the road now crosses itself at the same height.
    const flat = { ...good, roads: [{ ...good.roads[0], points: good.roads[0].points.map((pt) => ({ ...pt, position: { ...pt.position, y: 0 } })) }] };
    const flatIssue = analyzeProject(flat, kit).issues.find((i) => i.code === 'road.crossing-same-height')!;
    expect(flatIssue.level).toBe('error');
    expect(flatIssue.fix).toMatch(/bridge/);

    // A low bridge.
    const low = { ...good, roads: [{ ...good.roads[0], points: good.roads[0].points.map((pt) => ({ ...pt, position: { ...pt.position, y: pt.position.y * 0.45 } })) }] };
    expect(codes(low)).toContain('road.bridge-too-low');

    // High enough but not marked as a bridge.
    const road = good.roads[0];
    const noBridge = { ...good, roads: [{ ...road, sections: [{ ...road.sections[0], kind: 'road' as const }] }] };
    expect(codes(noBridge)).toContain('road.crossing-not-bridge');
  });

  it('wants a ramp in front of a gap, and a gap a kart can jump', () => {
    let p = tpl('oval');
    const rid = p.roads[0].id;
    const a = splitSection(p, rid, 8.2);
    p = a.project;
    const b = splitSection(p, rid, 8.8);
    p = updateSection(b.project, rid, b.id, { kind: 'gap' });
    p = updateSection(p, rid, a.id, { kind: 'road' });
    expect(codes(p)).toContain('section.gap-without-ramp');
    const withRamp = addPiece(p, { kind: 'boostRamp', roadId: rid, param: 7.9, lateral: 0, width: 2000, length: 2400, height: 400 }).project;
    expect(codes(withRamp)).not.toContain('section.gap-without-ramp');
    // A gap longer than a kart can clear.
    const q = splitSection(withRamp, rid, 9.4);
    const longGap = updateSection(q.project, rid, q.id, { kind: 'gap' });
    const far = splitSection(longGap, rid, 10.4).project;
    expect(analyzeProject(far, kit).issues.find((i) => i.code === 'section.gap-too-long')?.level).toBe('warning');
  });

  it('flags very short sections', () => {
    let p = tpl('oval');
    const rid = p.roads[0].id;
    p = splitSection(p, rid, 5.0).project;
    p = splitSection(p, rid, 5.04).project; // 5.04 is not within 0.02 of 5.0, so this really splits
    expect(analyzeProject(p, kit).issues.find((i) => i.code === 'section.too-short')).toBeDefined();
  });

  it('checks the start line', () => {
    const p = tpl('oval');
    expect(codes({ ...p, start: { roadId: 'missing', param: 0 } })).toContain('start.missing');
    // On a bend: the grid would line up across the corner.
    const tight = { ...p, roads: [{ ...p.roads[0], points: p.roads[0].points.map((pt) => ({ ...pt, position: { x: pt.position.x * 0.5, y: 0, z: pt.position.z * 0.5 } })) }] };
    const bend = setStart(tight, p.roads[0].id, 7.5);
    expect(analyzeProject(bend, kit).issues.find((i) => i.code === 'start.on-bend')?.level).toBe('warning');
    // Narrow road at the start.
    const narrowPts = p.roads[0].points.map((pt) => ({ ...pt, width: 2500 }));
    expect(codes({ ...p, roads: [{ ...p.roads[0], points: narrowPts }] })).toContain('start.narrow');
    // On a gap.
    const rid = p.roads[0].id;
    const split = splitSection(p, rid, p.start.param - 0.3);
    const split2 = splitSection(split.project, rid, p.start.param + 0.3);
    const gap = updateSection(split2.project, rid, split.id, { kind: 'gap' });
    expect(analyzeProject(gap, kit).issues.find((i) => i.code === 'start.on-gap')?.level).toBe('error');
    // Start on a side road.
    const side = addRoad(p, { points: [{ position: { x: 0, y: 0, z: 0 } }, { position: { x: 5000, y: 0, z: 0 } }, { position: { x: 9000, y: 0, z: 2000 } }] });
    expect(codes(setStart(side.project, side.id, 0.5))).toContain('start.not-main');
  });

  it('wants the start line to have room behind it on an open road', () => {
    const open = setRoadClosed(tpl('oval'), tpl('oval').roads[0].id, false);
    const p = setStart(setRoadClosed(open, open.roads[0].id, false), open.roads[0].id, 0.2);
    expect(codes(p)).toContain('start.no-room');
  });

  it('checks pieces', () => {
    let p = tpl('oval');
    const rid = p.roads[0].id;
    expect(codes({ ...p, pieces: [...p.pieces, { ...p.pieces[0], id: 'orphan', roadId: 'gone' }] })).toContain('piece.off-road');
    p = addPiece(p, { kind: 'boostPanel', roadId: rid, param: 2, lateral: 1.4, width: 1000, length: 1500 }).project;
    expect(codes(p)).toContain('piece.beyond-edge');
    const gapA = splitSection(p, rid, 11.0);
    const gapB = splitSection(gapA.project, rid, 12.0);
    let q = updateSection(gapB.project, rid, gapA.id, { kind: 'gap' });
    q = addPiece(q, { kind: 'boostPanel', roadId: rid, param: 11.5, lateral: 0, width: 1000, length: 1500 }).project;
    expect(codes(q)).toContain('piece.in-gap');
  });

  it('wants item boxes, and counts them', () => {
    const p = tpl('oval');
    expect(countItemBoxes(p)).toBe(15);
    const stripped = p.pieces.filter((x) => x.kind === 'itemRow').reduce((q, piece) => deletePiece(q, piece.id), p);
    expect(codes(stripped)).toContain('items.none');
    expect(analyzeProject(stripped, kit).checklist.itemBoxes.state).toBe('todo');
    expect(analyzeProject(p, kit).checklist.itemBoxes.detail).toMatch(/15 item boxes/);
  });

  it('warns about too many objects', () => {
    let p = tpl('oval');
    for (let i = 0; i < MAX_OBJECTS + 5; i++) {
      p = addProp(p, { objectId: 0x133, position: { x: i, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, snapToGround: true }).project;
    }
    expect(codes(p)).toContain('objects.too-many');
  });

  it('warns about narrow and steep roads', () => {
    const p = tpl('oval');
    const road = p.roads[0];
    expect(codes(updateRoadPoint(p, road.id, road.points[3].id, { width: 1200 }))).toContain('road.narrow');
    const steep = updateRoadPoint(p, road.id, road.points[6].id, { position: { ...road.points[6].position, y: 9000 } });
    expect(codes(steep)).toContain('road.steep');
  });

  it('folds in what the race rules object to, and generation notes', () => {
    const p = tpl('oval');
    const empty = createEmptyKmpFile();
    const a = analyzeProject(p, kit, { kmp: empty, issues: [{ level: 'warning', code: 'branch.overlap', message: 'x' }] });
    expect(a.issues.some((i) => i.code === 'track.checkpoint.missing' && i.level === 'error')).toBe(true);
    expect(a.issues.some((i) => i.code === 'branch.overlap')).toBe(true);
    expect(a.checklist.drivable.state).toBe('warn');
    const gen = generateKmp(p, kit);
    expect(analyzeProject(p, kit, { kmp: gen.kmp, issues: gen.issues }).issues).toEqual([]);
  });

  it('reports a missing world', () => {
    const a = analyzeProject({ ...tpl('oval'), themeId: 'ghost' }, kit);
    expect(a.issues[0].code).toBe('world.missing');
    expect(a.checklist.world.state).toBe('warn');
  });

  it('sorts errors before warnings', () => {
    const p = setRoadClosed(tpl('oval'), tpl('oval').roads[0].id, false);
    const levels = analyzeProject({ ...p, pieces: [] }, kit).issues.map((i) => i.level);
    const firstWarning = levels.indexOf('warning');
    if (firstWarning >= 0) expect(levels.slice(firstWarning).includes('error')).toBe(false);
  });
});
