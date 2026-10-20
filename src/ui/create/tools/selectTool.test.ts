import { describe, expect, it } from 'vitest';
import { encodeHandle } from '../overlay/handles';
import { evaluateRoadAt } from '../../../lib/create/spline';
import { ev, freshOval, ToolRunner } from './testing';
import { clampHeightDelta, formatHeight, HEIGHT_UNITS_PER_PIXEL, MAX_POINT_HEIGHT } from './selectTool';
import { rayVerticalPlane } from './pick';

const first = (p: ReturnType<typeof freshOval>) => p.roads[0].points[1];

describe('select tool', () => {
  it('selects the road section under a click on the road and deselects on empty ground', () => {
    const project = freshOval();
    const r = new ToolRunner('select', project);
    // Well away from the start line, which takes clicks on its own band.
    const away = evaluateRoadAt(project.roads[0], project.start.param + 8).position;
    r.click({ x: away.x, z: away.z, y: away.y });
    expect(r.session.selection).toHaveLength(1);
    expect(r.session.selection[0].kind).toBe('section');
    r.click({ x: 0, z: 0 });
    expect(r.session.selection).toEqual([]);
  });

  it('selects a road point through its overlay handle', () => {
    const project = freshOval();
    const pt = first(project);
    const r = new ToolRunner('select', project);
    const handleId = encodeHandle({ type: 'point', roadId: project.roads[0].id, pointId: pt.id });
    r.send(ev('down', pt.position, { handleId }));
    r.send(ev('up', pt.position, { handleId }));
    expect(r.session.selection).toEqual([{ kind: 'point', roadId: project.roads[0].id, pointId: pt.id }]);
    expect(r.session.history).toHaveLength(0);
  });

  it('dragging a point is one gesture and follows the cursor', () => {
    const project = freshOval();
    const pt = first(project);
    const r = new ToolRunner('select', project);
    const handleId = encodeHandle({ type: 'point', roadId: project.roads[0].id, pointId: pt.id });
    r.drag(pt.position, { x: pt.position.x + 500, z: pt.position.z + 800, y: pt.position.y }, 6, { handleId });
    const moved = r.session.project.roads[0].points[1];
    expect(moved.position.x).toBeCloseTo(pt.position.x + 500, 3);
    expect(moved.position.z).toBeCloseTo(pt.position.z + 800, 3);
    expect(moved.position.y).toBe(pt.position.y);
    expect(r.session.gestures).toBe(1);
    expect(r.session.history).toHaveLength(1);
    expect(r.session.history[0].label).toBe('Move road point');
  });

  it('a click without movement never creates an undo step', () => {
    const project = freshOval();
    const pt = first(project);
    const r = new ToolRunner('select', project);
    const handleId = encodeHandle({ type: 'point', roadId: project.roads[0].id, pointId: pt.id });
    r.send(ev('down', pt.position, { handleId }));
    r.send(ev('move', { x: pt.position.x + 5, z: pt.position.z }, { handleId }));
    r.send(ev('up', pt.position, { handleId }));
    expect(r.session.gestures).toBe(0);
    expect(r.session.project).toBe(project);
  });

  it('Shift-drag raises a point and leaves X and Z alone', () => {
    const project = freshOval();
    const pt = first(project);
    const r = new ToolRunner('select', project);
    const handleId = encodeHandle({ type: 'point', roadId: project.roads[0].id, pointId: pt.id });
    r.send(ev('down', pt.position, { handleId, shift: true }));
    // Drag up the screen by 40 px.
    const base = ev('move', pt.position, { handleId, shift: true });
    for (let i = 1; i <= 5; i++) r.send({ ...base, screen: { x: base.screen.x, y: base.screen.y - i * 8 } });
    r.send(ev('up', pt.position, { handleId, shift: true }));
    const moved = r.session.project.roads[0].points[1];
    expect(moved.position.y).toBeGreaterThan(pt.position.y + 400);
    expect(moved.position.x).toBe(pt.position.x);
    expect(moved.position.z).toBe(pt.position.z);
    expect(r.session.history[0].label).toBe('Raise road point');
  });

  it('Shift-dragging an already selected point raises it instead of deselecting it', () => {
    const project = freshOval();
    const pt = first(project);
    const roadId = project.roads[0].id;
    const r = new ToolRunner('select', project);
    r.session.selection = [{ kind: 'point', roadId, pointId: pt.id }];
    const handleId = encodeHandle({ type: 'point', roadId, pointId: pt.id });
    r.send(ev('down', pt.position, { handleId, shift: true }));
    const base = ev('move', pt.position, { handleId, shift: true });
    for (let i = 1; i <= 4; i++) r.send({ ...base, screen: { x: base.screen.x, y: base.screen.y - i * 10 } });
    r.send(ev('up', pt.position, { handleId, shift: true }));
    expect(r.session.project.roads[0].points[1].position.y).toBeGreaterThan(pt.position.y + 400);
    expect(r.session.selection).toEqual([{ kind: 'point', roadId, pointId: pt.id }]);
  });

  it('Escape during a drag cancels it and restores the design', () => {
    const project = freshOval();
    const pt = first(project);
    const r = new ToolRunner('select', project);
    const handleId = encodeHandle({ type: 'point', roadId: project.roads[0].id, pointId: pt.id });
    r.send(ev('down', pt.position, { handleId }));
    r.send(ev('move', { x: pt.position.x + 900, z: pt.position.z }, { handleId }));
    expect(r.session.project).not.toBe(project);
    r.key('Escape');
    expect(r.session.project).toBe(project);
    r.send(ev('up', pt.position, { handleId }));
    expect(r.session.gestures).toBe(0);
  });

  it('moves every selected point when one of them is dragged', () => {
    const project = freshOval();
    const [a, b] = [project.roads[0].points[1], project.roads[0].points[2]];
    const roadId = project.roads[0].id;
    const r = new ToolRunner('select', project);
    r.session.selection = [
      { kind: 'point', roadId, pointId: a.id },
      { kind: 'point', roadId, pointId: b.id },
    ];
    const handleId = encodeHandle({ type: 'point', roadId, pointId: a.id });
    r.drag(a.position, { x: a.position.x, z: a.position.z + 1000 }, 4, { handleId });
    const pts = r.session.project.roads[0].points;
    expect(pts[1].position.z).toBeCloseTo(a.position.z + 1000, 3);
    expect(pts[2].position.z).toBeCloseTo(b.position.z + 1000, 3);
    expect(r.session.history[0].label).toBe('Move road points');
  });

  it('shift-click toggles a point in the selection', () => {
    const project = freshOval();
    const roadId = project.roads[0].id;
    const [a, b] = [project.roads[0].points[1], project.roads[0].points[2]];
    const r = new ToolRunner('select', project);
    const click = (pt: typeof a, shift: boolean) => {
      const handleId = encodeHandle({ type: 'point', roadId, pointId: pt.id });
      r.send(ev('down', pt.position, { handleId, shift }));
      r.send(ev('up', pt.position, { handleId, shift }));
    };
    click(a, false);
    click(b, true);
    expect(r.session.selection).toHaveLength(2);
    click(a, true);
    expect(r.session.selection).toEqual([{ kind: 'point', roadId, pointId: b.id }]);
  });

  it('drags a piece along the road and re-anchors it by projection', () => {
    const project = freshOval();
    const piece = project.pieces[0];
    const r = new ToolRunner('select', project);
    const handleId = encodeHandle({ type: 'piece', pieceId: piece.id });
    r.drag({ x: 0, z: 15000 }, { x: 8000, z: 15000 }, 5, { handleId });
    const moved = r.session.project.pieces.find((p) => p.id === piece.id)!;
    expect(moved.param).not.toBeCloseTo(piece.param, 1);
    expect(Math.abs(moved.lateral)).toBeLessThan(0.2);
  });

  it('drags the start line along the main road', () => {
    const project = freshOval();
    const r = new ToolRunner('select', project);
    const handleId = encodeHandle({ type: 'start' });
    r.drag({ x: 0, z: 15000 }, { x: 22000, z: 15000 }, 5, { handleId });
    expect(r.session.project.start.param).toBeGreaterThan(2.5);
    expect(r.session.history[0].label).toBe('Move start line');
  });

  it('hovering a road reports the section for the tint', () => {
    const project = freshOval();
    const r = new ToolRunner('select', project);
    const away = evaluateRoadAt(project.roads[0], project.start.param + 8).position;
    const step = r.send(ev('hover', { x: away.x, z: away.z, y: away.y }));
    expect(step.hover?.kind).toBe('section');
  });

  it('passes right-button presses through to the camera', () => {
    const r = new ToolRunner('select', freshOval());
    const step = r.send(ev('down', { x: 0, z: 15000 }, { button: 2 }));
    expect(step.consumed).toBe(false);
  });

  it('picks props by their screen position', () => {
    const project = freshOval();
    project.props.push({ id: 'prop_x', objectId: 303, position: { x: 3000, y: 0, z: 3000 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, snapToGround: true });
    const r = new ToolRunner('select', project);
    r.click({ x: 3000, z: 3000 });
    expect(r.session.selection).toEqual([{ kind: 'prop', propId: 'prop_x' }]);
  });
});

describe('select tool: raising a point', () => {
  const setup = () => {
    const project = freshOval();
    const pt = first(project);
    const roadId = project.roads[0].id;
    const r = new ToolRunner('select', project);
    const handleId = encodeHandle({ type: 'point', roadId, pointId: pt.id });
    return { r, pt, handleId, roadId };
  };

  it('uses a fixed rate from straight above: 1 px is 20 units, and shows the height', () => {
    const { r, pt, handleId } = setup();
    r.send(ev('down', pt.position, { handleId, shift: true }));
    const base = ev('move', pt.position, { handleId, shift: true });
    let last = r.send({ ...base, screen: { x: base.screen.x, y: base.screen.y - 10 } });
    last = r.send({ ...base, screen: { x: base.screen.x, y: base.screen.y - 57 } });
    expect(r.session.project.roads[0].points[1].position.y - pt.position.y).toBeCloseTo(57 * HEIGHT_UNITS_PER_PIXEL, 6);
    expect(last.preview).toMatchObject({ kind: 'height', text: formatHeight(57 * HEIGHT_UNITS_PER_PIXEL) });
    expect(formatHeight(57 * HEIGHT_UNITS_PER_PIXEL)).toBe('+11 m');
  });

  it('follows the cursor on a vertical plane through the point in perspective', () => {
    const { r, pt, handleId } = setup();
    const eye = { x: pt.position.x, y: pt.position.y + 3000, z: pt.position.z + 30000 };
    const rayTo = (target: { x: number; y: number; z: number }) => {
      const d = { x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z };
      const l = Math.hypot(d.x, d.y, d.z);
      return { origin: eye, direction: { x: d.x / l, y: d.y / l, z: d.z / l } };
    };
    r.send(ev('down', pt.position, { handleId, shift: true, ray: rayTo(pt.position) }));
    const base = ev('move', pt.position, { handleId, shift: true });
    for (const lift of [200, 600, 1500]) {
      r.send({ ...base, screen: { x: base.screen.x, y: base.screen.y - lift / 10 }, ray: rayTo({ ...pt.position, y: pt.position.y + lift }) });
    }
    expect(r.session.project.roads[0].points[1].position.y - pt.position.y).toBeCloseTo(1500, 3);
  });

  it('keeps a point between the floor and ceiling and never moves X or Z', () => {
    const { r, pt, handleId } = setup();
    r.send(ev('down', pt.position, { handleId, shift: true }));
    const base = ev('move', pt.position, { handleId, shift: true });
    r.send({ ...base, screen: { x: base.screen.x, y: base.screen.y - 5000 } });
    const up = r.session.project.roads[0].points[1].position;
    expect(up.y).toBe(r.session.project.terrain.baseHeight + MAX_POINT_HEIGHT);
    expect(up.x).toBe(pt.position.x);
    r.send({ ...base, screen: { x: base.screen.x, y: base.screen.y + 5000 } });
    expect(r.session.project.roads[0].points[1].position.y).toBeGreaterThanOrEqual(r.session.project.terrain.baseHeight - 3000);
  });

  it('clampHeightDelta leaves non-point groups alone, and rayVerticalPlane refuses a top-down ray', () => {
    expect(clampHeightDelta(99999, [{ kind: 'start' }], 0)).toBe(99999);
    expect(rayVerticalPlane({ origin: { x: 5, y: 9000, z: 5 }, direction: { x: 0, y: -1, z: 0 } }, { x: 0, y: 0, z: 0 })).toBeNull();
    expect(formatHeight(-350)).toBe('-3.5 m');
    expect(formatHeight(0)).toBe('0 m');
  });
});

describe('select tool: the start line', () => {
  it('takes a click on its band even when a road point sits under it, but not a click on the point dot', () => {
    const project = freshOval();
    const road = project.roads[0];
    const r = new ToolRunner('select', project);
    const at = evaluateRoadAt(road, project.start.param).position;
    const pointId = road.points[0].id;
    const handleId = encodeHandle({ type: 'point', roadId: road.id, pointId });
    // On the band, away from the point's own dot (200 units = 20 px in the test projection).
    const onBand = { x: at.x + 300, y: at.y, z: at.z };
    r.send(ev('down', onBand, { handleId }));
    r.send(ev('up', onBand, { handleId }));
    expect(r.session.selection).toEqual([{ kind: 'start' }]);
    // Right on the dot of that point: the point wins.
    const pt = road.points[0].position;
    r.session.selection = [];
    r.send(ev('down', pt, { handleId }));
    r.send(ev('up', pt, { handleId }));
    expect(r.session.selection).toEqual([{ kind: 'point', roadId: road.id, pointId }]);
  });

  it('also takes a plain click on the band (no handle under the cursor), and leaves the road beyond it alone', () => {
    const project = freshOval();
    const road = project.roads[0];
    const r = new ToolRunner('select', project);
    const at = evaluateRoadAt(road, project.start.param).position;
    r.click({ x: at.x + 150, z: at.z, y: at.y });
    expect(r.session.selection).toEqual([{ kind: 'start' }]);
    const away = evaluateRoadAt(road, project.start.param + 8).position;
    r.click({ x: away.x, z: away.z, y: away.y });
    expect(r.session.selection[0].kind).toBe('section');
  });
});
