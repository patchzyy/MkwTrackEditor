import { describe, expect, it } from 'vitest';
import { encodeHandle } from '../overlay/handles';
import { pieceItemForTest, sceneryItemForTest, sculptItemForTest, surfaceItemForTest } from './testing.armed';
import { ev, freshOval, ToolRunner } from './testing';
import { ERASER_ITEM } from './armed';
import { splitBlocked } from './sectionTool';
import { appendStrokePoint } from './paintTool';
import { effectiveSculptMode } from './sculptTool';
import { sectionRanges } from '../../../lib/create/sections';

describe('sections tool', () => {
  it('previews a split line on hover and splits on click', () => {
    const r = new ToolRunner('sections', freshOval());
    const hover = r.send(ev('hover', { x: 0, z: 15000 }));
    expect(hover.preview).toMatchObject({ kind: 'split', blocked: false });
    r.click({ x: 0, z: 15000 });
    expect(r.session.project.roads[0].sections).toHaveLength(2);
    expect(r.session.selection[0]).toMatchObject({ kind: 'section' });
    expect(r.session.history[0].label).toBe('Split road into sections');
  });

  it('refuses a split too close to an existing edge and selects the section instead', () => {
    const r = new ToolRunner('sections', freshOval());
    r.click({ x: 0, z: 15000 });
    const road = r.session.project.roads[0];
    const edge = road.sections.find((s) => s.start > 0)!.start;
    expect(splitBlocked(road, edge + 0.02)).toBe(true);
    expect(splitBlocked(road, edge + 2)).toBe(false);
  });

  it('dragging a boundary handle moves the section edge as one gesture', () => {
    const r = new ToolRunner('sections', freshOval());
    r.click({ x: 0, z: 15000 });
    const road = r.session.project.roads[0];
    const section = road.sections.find((s) => s.start > 0)!;
    const handleId = encodeHandle({ type: 'boundary', roadId: road.id, sectionId: section.id });
    r.drag({ x: 0, z: 15000 }, { x: 14000, z: 15000 }, 5, { handleId });
    const moved = r.session.project.roads[0].sections.find((s) => s.id === section.id)!;
    expect(moved.start).toBeGreaterThan(section.start + 0.5);
    expect(r.session.history.at(-1)?.label).toBe('Move section edge');
    expect(sectionRanges(r.session.project.roads[0])).toHaveLength(2);
  });

  it('selects a section from its label handle', () => {
    const r = new ToolRunner('sections', freshOval());
    r.click({ x: 0, z: 15000 });
    const road = r.session.project.roads[0];
    const handleId = encodeHandle({ type: 'section', roadId: road.id, sectionId: road.sections[0].id });
    r.send(ev('down', { x: 0, z: 0 }, { handleId }));
    expect(r.session.selection).toEqual([{ kind: 'section', roadId: road.id, sectionId: road.sections[0].id }]);
  });
});

describe('pieces tool', () => {
  it('places the armed piece on the lane under the cursor', () => {
    const project = freshOval();
    const r = new ToolRunner('pieces', project, { armed: pieceItemForTest('boostPanel') });
    const before = project.pieces.length;
    // Right of centre on the top straight (driving direction is +x, so right is +z).
    const hover = r.send(ev('hover', { x: 5500, z: 15000 + 1300 }));
    expect(hover.preview).toMatchObject({ kind: 'piece', pieceKind: 'boostPanel' });
    r.click({ x: 5500, z: 15000 + 1300 });
    expect(r.session.project.pieces).toHaveLength(before + 1);
    const placed = r.session.project.pieces.at(-1)!;
    expect(placed.kind).toBe('boostPanel');
    expect(Math.abs(placed.lateral)).toBe(0.5);
    expect(r.session.selection).toEqual([{ kind: 'piece', pieceId: placed.id }]);
  });

  it('Q and E cycle the lane the ghost uses', () => {
    const project = freshOval();
    const r = new ToolRunner('pieces', project, { armed: pieceItemForTest('boostPanel'), laneMode: 'full' });
    const step = r.send(ev('hover', { x: 5500, z: 15000 }));
    expect(step.preview).toMatchObject({ lane: 'full' });
    if (step.preview?.kind === 'piece') expect(step.preview.width).toBeGreaterThan(3000);
    r.extras.laneMode = 'left';
    const left = r.send(ev('hover', { x: 5500, z: 15000 }));
    expect(left.preview).toMatchObject({ lane: 'left', lateral: -0.5 });
  });

  it('item rows default to the full width', () => {
    const r = new ToolRunner('pieces', freshOval(), { armed: pieceItemForTest('itemRow') });
    r.click({ x: 5500, z: 15000 });
    const placed = r.session.project.pieces.at(-1)!;
    expect(placed.kind).toBe('itemRow');
    expect(placed.lateral).toBe(0);
    expect(placed.count).toBeGreaterThanOrEqual(4);
  });

  it('does nothing off the road and explains why', () => {
    const r = new ToolRunner('pieces', freshOval(), { armed: pieceItemForTest('boostPanel') });
    r.click({ x: 0, z: 0 });
    expect(r.session.history).toHaveLength(0);
    expect(r.session.flashes.at(-1)).toMatch(/road/i);
  });

  it('asks for a piece when none is armed', () => {
    const r = new ToolRunner('pieces', freshOval());
    r.click({ x: 5500, z: 15000 });
    expect(r.session.flashes.at(-1)).toMatch(/palette/i);
  });
});

describe('paint tool', () => {
  it('one drag is one stroke and one undo step', () => {
    const project = freshOval();
    const r = new ToolRunner('paint', project, { armed: surfaceItemForTest('test.sand') });
    r.drag({ x: -3000, z: 0 }, { x: 6000, z: 0 }, 10);
    expect(r.session.gestures).toBe(1);
    expect(r.session.project.terrainStrokes).toHaveLength(1);
    const stroke = r.session.project.terrainStrokes[0];
    expect(stroke.kind).toBe('paint');
    if (stroke.kind === 'paint') {
      expect(stroke.surface).toEqual({ surfaceId: 'test.sand' });
      expect(stroke.points.length).toBeGreaterThan(2);
    }
  });

  it('Shift erases', () => {
    const r = new ToolRunner('paint', freshOval(), { armed: surfaceItemForTest('test.sand') });
    r.drag({ x: -3000, z: 0 }, { x: 3000, z: 0 }, 6, { shift: true });
    const stroke = r.session.project.terrainStrokes[0];
    expect(stroke.kind === 'paint' && stroke.surface).toBeNull();
  });

  it('the eraser tile erases too', () => {
    const r = new ToolRunner('paint', freshOval(), { armed: ERASER_ITEM });
    r.click({ x: 0, z: 0 });
    const stroke = r.session.project.terrainStrokes[0];
    expect(stroke.kind === 'paint' && stroke.surface).toBeNull();
  });

  it('skips stamps closer than a third of the brush radius', () => {
    let pts = appendStrokePoint([], { x: 0, y: 0, z: 0 }, 1000);
    pts = appendStrokePoint(pts, { x: 100, y: 0, z: 0 }, 1000);
    expect(pts).toHaveLength(1);
    pts = appendStrokePoint(pts, { x: 400, y: 0, z: 0 }, 1000);
    expect(pts).toHaveLength(2);
  });

  it('does not paint when the ground is off, and says so', () => {
    const project = freshOval();
    project.terrain = { ...project.terrain, enabled: false };
    const r = new ToolRunner('paint', project, { armed: surfaceItemForTest('test.sand') });
    r.click({ x: 0, z: 0 });
    expect(r.session.project.terrainStrokes).toHaveLength(0);
    expect(r.session.flashes.at(-1)).toMatch(/ground/i);
  });

  it('Escape mid-stroke cancels it', () => {
    const r = new ToolRunner('paint', freshOval(), { armed: surfaceItemForTest('test.sand') });
    r.send(ev('down', { x: 0, z: 0 }));
    r.send(ev('move', { x: 2000, z: 0 }));
    expect(r.session.project.terrainStrokes).toHaveLength(1);
    r.key('Escape');
    expect(r.session.project.terrainStrokes).toHaveLength(0);
  });
});

describe('sculpt tool', () => {
  it('raises by default, lowers with Shift and smooths with Ctrl', () => {
    expect(effectiveSculptMode('raise', { shift: false, ctrl: false })).toBe('raise');
    expect(effectiveSculptMode('raise', { shift: true, ctrl: false })).toBe('lower');
    expect(effectiveSculptMode('lower', { shift: true, ctrl: false })).toBe('raise');
    expect(effectiveSculptMode('raise', { shift: true, ctrl: true })).toBe('smooth');
  });

  it('a drag makes one sculpt stroke with the brush strength', () => {
    const r = new ToolRunner('sculpt', freshOval(), { armed: sculptItemForTest('raise') });
    r.drag({ x: -3000, z: 0 }, { x: 5000, z: 0 }, 8);
    expect(r.session.gestures).toBe(1);
    const stroke = r.session.project.terrainStrokes[0];
    expect(stroke).toMatchObject({ kind: 'sculpt', mode: 'raise', strength: 140 });
  });

  it('Shift-drag digs', () => {
    const r = new ToolRunner('sculpt', freshOval(), { armed: sculptItemForTest('raise') });
    r.drag({ x: 0, z: 0 }, { x: 4000, z: 0 }, 5, { shift: true });
    expect(r.session.project.terrainStrokes[0]).toMatchObject({ mode: 'lower' });
  });

  it('flatten remembers the height where the drag began', () => {
    const r = new ToolRunner('sculpt', freshOval(), { armed: sculptItemForTest('flatten') });
    r.drag({ x: 0, z: 0, y: 640 }, { x: 4000, z: 0, y: 640 }, 4);
    expect(r.session.project.terrainStrokes[0]).toMatchObject({ mode: 'flatten', targetHeight: 640 });
  });
});

describe('scenery tool', () => {
  it('a click places one object and selects it', () => {
    const r = new ToolRunner('scenery', freshOval(), { armed: sceneryItemForTest() });
    r.click({ x: 3000, z: 3000 });
    expect(r.session.project.props).toHaveLength(1);
    expect(r.session.project.props[0]).toMatchObject({ objectId: 303, snapToGround: true });
    expect(r.session.selection[0]).toEqual({ kind: 'prop', propId: r.session.project.props[0].id });
  });

  it('a drag scatters many objects as one undo step, away from the road', () => {
    const r = new ToolRunner('scenery', freshOval(), { armed: sceneryItemForTest() });
    r.drag({ x: -8000, z: 4000 }, { x: 8000, z: 4000 }, 12);
    expect(r.session.gestures).toBe(1);
    expect(r.session.project.props.length).toBeGreaterThan(5);
    expect(r.session.history).toHaveLength(1);
  });

  it('Shift-drag erases the objects under the brush', () => {
    const r = new ToolRunner('scenery', freshOval(), { armed: sceneryItemForTest() });
    r.drag({ x: -8000, z: 4000 }, { x: 8000, z: 4000 }, 12);
    const count = r.session.project.props.length;
    r.drag({ x: -8000, z: 4000 }, { x: 8000, z: 4000 }, 12, { shift: true });
    expect(r.session.project.props.length).toBeLessThan(count);
  });

  it('tells the user to pick an object first', () => {
    const r = new ToolRunner('scenery', freshOval());
    r.click({ x: 3000, z: 3000 });
    expect(r.session.project.props).toHaveLength(0);
    expect(r.session.flashes.at(-1)).toMatch(/palette/i);
  });
});

describe('start tool', () => {
  it('moves the start line to the clicked spot on the main road', () => {
    const r = new ToolRunner('start', freshOval());
    r.click({ x: 22000, z: 15000 });
    expect(r.session.project.start.param).toBeGreaterThan(2.5);
    expect(r.session.selection).toEqual([{ kind: 'start' }]);
  });

  it('ignores other roads with an explanation', () => {
    const project = freshOval();
    const r = new ToolRunner('start', project);
    r.click({ x: 0, z: 0 });
    expect(r.session.project.start).toEqual(project.start);
    expect(r.session.flashes.at(-1)).toMatch(/road/i);
  });
});
