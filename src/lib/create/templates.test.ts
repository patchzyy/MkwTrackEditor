import { beforeAll, describe, expect, it } from 'vitest';
import type { CreateKit } from './types';
import { useDeterministicIds } from './ids';
import { createSyntheticKit } from './__tests__/syntheticKit';
import { LAYOUT_TEMPLATES, createBlankProject, createProjectFromTemplate, getLayoutTemplate } from './templates';
import { projectOntoRoad, roadLength, sampleRoad } from './spline';
import { analyzeProject, estimateLapSeconds } from './analyze';
import { generateKmp } from './kmpGen';
import { migrateProject } from './ops';
import { getRoadStyle } from './roadStyles';

let kit: CreateKit;
beforeAll(() => {
  useDeterministicIds();
  kit = createSyntheticKit();
});

const real = LAYOUT_TEMPLATES.filter((t) => t.id !== 'blank');

describe('LAYOUT_TEMPLATES', () => {
  it('lists the six starting layouts in order with friendly text', () => {
    expect(LAYOUT_TEMPLATES.map((t) => t.id)).toEqual(['blank', 'oval', 'kidney', 'figure-eight', 'twisty', 'hills']);
    for (const t of LAYOUT_TEMPLATES) {
      expect(t.label.length).toBeGreaterThan(2);
      expect(t.description.length).toBeGreaterThan(15);
      expect(t.description).not.toMatch(/KMP|KCL|CKPT|BRRES|ENPT|GOBJ/);
    }
    expect(getLayoutTemplate('oval')?.label).toBe('Oval');
    expect(getLayoutTemplate('nope')).toBeNull();
  });

  it('gives every non-blank layout a closed thumbnail outline inside the unit square', () => {
    expect(getLayoutTemplate('blank')!.preview).toEqual([]);
    for (const t of real) {
      expect(t.preview.length).toBeGreaterThanOrEqual(12);
      for (const p of t.preview) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.z).toBeGreaterThanOrEqual(0);
        expect(p.z).toBeLessThanOrEqual(1);
      }
      const xs = t.preview.map((p) => p.x);
      const zs = t.preview.map((p) => p.z);
      // Fills the square along its longer side.
      expect(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs))).toBeGreaterThan(0.8);
    }
  });
});

describe.each(real.map((t) => t.id))('template %s', (id) => {
  const make = () => createProjectFromTemplate(id, { name: 'Test', themeId: 'test', laps: 3 }, kit);

  it('is a closed, retail-sized loop that takes 30-50 seconds a lap', () => {
    const p = make();
    const road = p.roads[0];
    expect(road.closed).toBe(true);
    expect(road.points.length).toBeGreaterThanOrEqual(12);
    const length = roadLength(road);
    expect(length).toBeGreaterThan(140000);
    expect(length).toBeLessThan(260000);
    const seconds = estimateLapSeconds(length);
    expect(seconds).toBeGreaterThan(30);
    expect(seconds).toBeLessThan(55);
  });

  it('has corners the road can actually turn', () => {
    const p = make();
    let minRadius = Infinity;
    let maxSlope = 0;
    for (const s of sampleRoad(p.roads[0], { step: 300 })) {
      if (Math.abs(s.curvature) > 1e-9) minRadius = Math.min(minRadius, 1 / Math.abs(s.curvature));
      maxSlope = Math.max(maxSlope, Math.abs(s.tangent.y) / Math.hypot(s.tangent.x, s.tangent.z));
    }
    expect(minRadius).toBeGreaterThan(4200);
    expect(maxSlope).toBeLessThan(0.3);
  });

  it('has a start line, item boxes, a boost panel and no problems at all', () => {
    const p = make();
    expect(p.start.roadId).toBe(p.roads[0].id);
    expect(p.pieces.filter((x) => x.kind === 'itemRow').length).toBeGreaterThanOrEqual(2);
    expect(p.pieces.some((x) => x.kind === 'boostPanel')).toBe(true);
    for (const piece of p.pieces) {
      expect(piece.roadId).toBe(p.roads[0].id);
      expect(piece.param).toBeGreaterThanOrEqual(0);
      expect(piece.param).toBeLessThan(p.roads[0].points.length);
      expect(Math.abs(piece.lateral)).toBeLessThanOrEqual(1);
    }
    const gen = generateKmp(p, kit);
    const analysis = analyzeProject(p, kit, { kmp: gen.kmp, issues: gen.issues });
    expect(analysis.issues).toEqual([]);
    expect(Object.values(analysis.checklist).every((c) => c.state === 'done')).toBe(true);
  });

  it('uses the chosen world, name and laps, and survives JSON', () => {
    const p = createProjectFromTemplate(id, { name: 'Rainbow Rumble', themeId: 'test2', laps: 5 }, kit);
    expect(p.name).toBe('Rainbow Rumble');
    expect(p.themeId).toBe('test2');
    expect(p.settings.laps).toBe(5);
    expect(migrateProject(JSON.parse(JSON.stringify(p))).roads[0].points).toEqual(p.roads[0].points);
  });
});

describe('every template is fully green', () => {
  const styles = ['circuit', 'walled', 'barrier', 'trail', 'bridge', 'castle', 'sky'];
  it.each(real.flatMap((t) => styles.map((s) => [t.id, s] as const)))('%s with the %s road style has no warnings or errors', (id, styleId) => {
    let p = createProjectFromTemplate(id, { name: 'x', themeId: 'test', laps: 3 }, kit);
    const width = getRoadStyle(styleId).defaultWidth;
    p = { ...p, roads: [{ ...p.roads[0], styleId, points: p.roads[0].points.map((pt) => ({ ...pt, width })) }] };
    const gen = generateKmp(p, kit);
    expect(analyzeProject(p, kit, { kmp: gen.kmp, issues: gen.issues }).issues).toEqual([]);
  });
});

describe('figure-eight', () => {
  it('crosses itself with a real bridge over the first pass', () => {
    const p = createProjectFromTemplate('figure-eight', { name: 'x', themeId: 'test', laps: 3 }, kit);
    const kinds = p.roads[0].sections.map((s) => s.kind);
    expect(kinds).toEqual(['road', 'bridge', 'road']);
    const ys = p.roads[0].points.map((pt) => pt.position.y);
    expect(Math.max(...ys)).toBeGreaterThan(1200);
    expect(ys.filter((y) => y < 1).length).toBeGreaterThan(10);
  });
});

describe('default scenery', () => {
  const sceneryKit = createSyntheticKit({ scenery: true });
  const make = (id: string, themeId = 'test') => createProjectFromTemplate(id, { name: 'x', themeId, laps: 3 }, sceneryKit);

  it.each(real.map((t) => t.id))('%s gets a tasteful, deterministic scatter well back from the road', (id) => {
    const p = make(id);
    expect(p.props.length).toBeGreaterThanOrEqual(15);
    expect(p.props.length).toBeLessThanOrEqual(110);
    expect(new Set(p.props.map((x) => x.objectId)).size).toBeGreaterThanOrEqual(2);
    for (const prop of p.props) {
      expect([303, 307, 306]).toContain(prop.objectId); // trees and flowers, never crates
      expect(prop.snapToGround).toBe(true);
      const proj = projectOntoRoad(p.roads[0], prop.position, { heightWeight: 0 })!;
      // At least 3000 units beyond the outer edge of the widest road cross-section (road + curb + shoulder).
      expect(proj.distanceToCenter).toBeGreaterThan(proj.sample.width / 2 + 880 + 3000);
    }
    const again = make(id);
    expect(again.props.map((x) => [x.objectId, x.position.x, x.position.z, x.rotation.y, x.scale.x])).toEqual(p.props.map((x) => [x.objectId, x.position.x, x.position.z, x.rotation.y, x.scale.x]));
  });

  it('keeps the start grid clear and stays fully green', () => {
    for (const t of real) {
      const p = make(t.id);
      const gen = generateKmp(p, sceneryKit);
      for (const prop of p.props) {
        for (const kt of gen.kmp.startPoints) expect(Math.hypot(prop.position.x - kt.position.x, prop.position.z - kt.position.z)).toBeGreaterThan(6000);
      }
      expect(analyzeProject(p, sceneryKit, { kmp: gen.kmp, issues: gen.issues }).issues).toEqual([]);
    }
  });

  it('uses the theme own scenery, and nothing when the theme has none', () => {
    expect(make('oval', 'test2').props.every((x) => x.objectId === 303)).toBe(true);
    expect(createProjectFromTemplate('oval', { name: 'x', themeId: 'test', laps: 3 }, createSyntheticKit()).props).toEqual([]);
  });
});

describe('blank and theme defaults', () => {
  it('blank has no road and an unset start', () => {
    const p = createProjectFromTemplate('blank', { name: 'Empty', themeId: 'test', laps: 3 }, kit);
    expect(p.roads).toEqual([]);
    expect(p.start.roadId).toBe('');
    expect(p.pieces).toEqual([]);
  });

  it('follows the theme for terrain and the default road style', () => {
    const skyKit = createSyntheticKit({ terrain: false });
    const p = createProjectFromTemplate('oval', { name: 'x', themeId: 'test', laps: 3 }, skyKit);
    expect(p.terrain.enabled).toBe(false);
    expect(createBlankProject({ name: 'x', themeId: 'test', laps: 99 }, kit).settings.laps).toBe(9);
    expect(p.roads[0].styleId).toBe('circuit');
  });

  it('starts the ground at the theme base height, with the road and props on it', () => {
    const tall = createSyntheticKit({ baseHeights: [470, 11600], scenery: true });
    for (const id of real.map((t) => t.id)) {
      const p = createProjectFromTemplate(id, { name: 'x', themeId: 'test', laps: 3 }, tall);
      expect(p.terrain.baseHeight).toBe(470);
      // Every road point is the template's own relative height on top of the ground.
      const flat = createProjectFromTemplate(id, { name: 'x', themeId: 'test', laps: 3 }, kit);
      p.roads[0].points.forEach((point, i) => expect(point.position.y).toBeCloseTo(470 + flat.roads[0].points[i].position.y, 6));
      for (const prop of p.props) expect(prop.position.y).toBe(470);
      // And a second world starts at its own height.
      expect(createProjectFromTemplate(id, { name: 'x', themeId: 'test2', laps: 3 }, tall).terrain.baseHeight).toBe(11600);
    }
    expect(createBlankProject({ name: 'x', themeId: 'test2', laps: 3 }, tall).terrain.baseHeight).toBe(11600);
    // A theme without a base height keeps the default of 0, as does a missing kit.
    expect(createBlankProject({ name: 'x', themeId: 'test', laps: 3 }, kit).terrain.baseHeight).toBe(0);
    expect(createBlankProject({ name: 'x', themeId: 'test', laps: 3 }).terrain.baseHeight).toBe(0);
  });

  it('unknown templates give a blank project', () => {
    expect(createProjectFromTemplate('does-not-exist', { name: 'x', themeId: 'test', laps: 3 }, kit).roads).toEqual([]);
  });
});
