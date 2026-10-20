import { describe, expect, it } from 'vitest';
import { analyzeProject } from '../../../lib/create/analyze';
import { encodeHandle } from '../overlay/handles';
import { roadStyleItemForTest } from './testing.armed';
import { ev, freshBlank, freshOval, kit, ToolRunner } from './testing';

const hexagon = [
  { x: 0, z: -9000 },
  { x: 14000, z: -4000 },
  { x: 14000, z: 9000 },
  { x: 0, z: 14000 },
  { x: -14000, z: 9000 },
  { x: -14000, z: -4000 },
];

describe('road tool', () => {
  it('the first click starts a road, later clicks extend it, clicking the first point closes the loop', () => {
    const r = new ToolRunner('road', freshBlank());
    for (const p of hexagon) r.click(p);
    const road = r.session.project.roads[0];
    expect(road.points).toHaveLength(6);
    expect(road.closed).toBe(false);
    expect(r.session.project.start.roadId).toBe(road.id);

    const handleId = encodeHandle({ type: 'close', roadId: road.id });
    r.send(ev('hover', hexagon[0], { handleId }));
    expect(r.last?.hover).toEqual({ kind: 'close', roadId: road.id });
    r.send(ev('down', hexagon[0], { handleId }));
    r.send(ev('up', hexagon[0], { handleId }));
    expect(r.session.project.roads[0].closed).toBe(true);
    expect(r.session.selection).toEqual([{ kind: 'road', roadId: road.id }]);
    // The loop is done: the tool hands over to Select so a stray click cannot start another road.
    expect(r.session.tool).toBe('select');
    expect(analyzeProject(r.session.project, kit).issues.filter((i) => i.level === 'error' && i.code.startsWith('road.loop'))).toHaveLength(0);
  });

  it('shows a rubber band from the last point to the cursor while drawing', () => {
    const r = new ToolRunner('road', freshBlank());
    r.click(hexagon[0]);
    r.click(hexagon[1]);
    const step = r.send(ev('hover', { x: 5000, z: 2000 }));
    expect(step.preview?.kind).toBe('rubber');
    if (step.preview?.kind === 'rubber') {
      expect(step.preview.from.x).toBe(14000);
      expect(step.preview.to.x).toBeCloseTo(5000, 3);
    }
  });

  it('offers a close ring only once there are three points', () => {
    const r = new ToolRunner('road', freshBlank());
    r.click(hexagon[0]);
    r.click(hexagon[1]);
    const roadId = r.session.project.roads[0].id;
    const handleId = encodeHandle({ type: 'close', roadId });
    r.send(ev('hover', hexagon[0], { handleId }));
    expect(r.last?.hover?.kind).not.toBe('close');
    r.click(hexagon[2]);
    r.send(ev('hover', hexagon[0], { handleId }));
    expect(r.last?.hover?.kind).toBe('close');
  });

  it('every click is one undo step', () => {
    const r = new ToolRunner('road', freshBlank());
    for (const p of hexagon.slice(0, 4)) r.click(p);
    expect(r.session.history.map((h) => h.label)).toEqual(['Start a road', 'Add road point', 'Add road point', 'Add road point']);
  });

  it('inserts a point when clicking a road that is not being drawn', () => {
    const project = freshOval();
    const r = new ToolRunner('road', project);
    const hover = r.send(ev('hover', { x: 5500, z: 15000 }));
    expect(hover.preview?.kind).toBe('insert');
    r.click({ x: 5500, z: 15000 });
    expect(r.session.project.roads[0].points).toHaveLength(project.roads[0].points.length + 1);
    expect(r.session.selection[0].kind).toBe('point');
    expect(r.session.history[0].label).toBe('Insert road point');
  });

  it('Enter finishes drawing and drops a one-point road', () => {
    const r = new ToolRunner('road', freshBlank());
    r.click(hexagon[0]);
    expect(r.session.project.roads).toHaveLength(1);
    r.key('Enter');
    expect(r.session.project.roads).toHaveLength(0);
    r.click(hexagon[0]);
    r.click(hexagon[1]);
    r.key('Enter');
    expect(r.session.project.roads).toHaveLength(1);
    expect(r.session.selection[0]).toEqual({ kind: 'road', roadId: r.session.project.roads[0].id });
  });

  it('Backspace removes the last point while drawing', () => {
    const r = new ToolRunner('road', freshBlank());
    for (const p of hexagon.slice(0, 3)) r.click(p);
    r.key('Backspace');
    expect(r.session.project.roads[0].points).toHaveLength(2);
  });

  it('continues an open selected road from its end', () => {
    const r = new ToolRunner('road', freshBlank());
    for (const p of hexagon.slice(0, 3)) r.click(p);
    r.key('Enter');
    r.click({ x: -3000, z: 12000 });
    expect(r.session.project.roads).toHaveLength(1);
    expect(r.session.project.roads[0].points).toHaveLength(4);
  });

  it('starts a new road on empty ground when the selected road is closed', () => {
    const project = freshOval();
    const r = new ToolRunner('road', project);
    r.session.selection = [{ kind: 'road', roadId: project.roads[0].id }];
    r.click({ x: 0, z: 0 });
    expect(r.session.project.roads).toHaveLength(2);
  });

  it('a new road uses the armed road style', () => {
    const r = new ToolRunner('road', freshBlank(), { armed: roadStyleItemForTest('trail') });
    r.click(hexagon[0]);
    expect(r.session.project.roads[0].styleId).toBe('trail');
  });

  it('keeps new points on the plane of the road being extended', () => {
    const r = new ToolRunner('road', freshBlank());
    r.click({ x: 0, z: 0, y: 0 });
    r.send(ev('down', { x: 5000, z: 0, y: 0 }, { hit: { position: { x: 5000, y: 777, z: 0 }, normal: { x: 0, y: 1, z: 0 }, distance: 1 } }));
    r.send(ev('up', { x: 5000, z: 0, y: 0 }));
    expect(r.session.project.roads[0].points[1].position.y).toBe(0);
  });
});
