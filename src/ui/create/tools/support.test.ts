import { describe, expect, it } from 'vitest';
import { parseHandle, encodeHandle } from '../overlay/handles';
import { defaultArmedFor, isPaintable, pieceItem, roadStyleItem, sceneryForTheme, sculptItem, surfaceItem, toolForItem } from './armed';
import { selectionBounds } from './bounds';
import { dropItem, previewForDrop } from './drop';
import { brushKeyFor, isTypingTarget, mapKey, resizeBrush } from './keys';
import { laneFromLateral, nextLaneMode, placementForLane, resolveLane } from './lanes';
import { makeCtx, fakeSession, freshOval, kit, runCommands } from './testing';
import { sampleRoad } from '../../../lib/create/spline';

describe('handles', () => {
  it('round-trips every handle kind', () => {
    const refs = [
      { type: 'point', roadId: 'road_1', pointId: 'pt_2' },
      { type: 'close', roadId: 'road_1' },
      { type: 'piece', pieceId: 'pc_3' },
      { type: 'prop', propId: 'prop_4' },
      { type: 'start' },
      { type: 'boundary', roadId: 'road_1', sectionId: 'sec_5' },
      { type: 'section', roadId: 'road_1', sectionId: 'sec_5' },
    ] as const;
    for (const ref of refs) expect(parseHandle(encodeHandle(ref))).toEqual(ref);
    expect(parseHandle('viz|ghost')).toBeNull();
    expect(parseHandle(null)).toBeNull();
  });
});

describe('lanes', () => {
  it('snaps a lateral offset to the nearest third of the road', () => {
    expect(laneFromLateral(-0.9)).toBe('left');
    expect(laneFromLateral(0.1)).toBe('centre');
    expect(laneFromLateral(0.6)).toBe('right');
  });

  it('auto resolves per piece kind, a forced lane always wins', () => {
    expect(resolveLane('auto', 'boostPanel', 0.8)).toBe('right');
    expect(resolveLane('auto', 'itemRow', 0.8)).toBe('full');
    expect(resolveLane('auto', 'boostRamp', -0.8)).toBe('centre');
    expect(resolveLane('left', 'itemRow', 0.8)).toBe('left');
  });

  it('builds placements that fit the road', () => {
    const left = placementForLane('boostPanel', 'left', 3600);
    expect(left.lateral).toBe(-0.5);
    expect(left.width).toBeLessThanOrEqual(1200);
    const full = placementForLane('boostRamp', 'full', 3600);
    expect(full.width).toBe(3300);
    const row = placementForLane('itemRow', 'centre', 3600);
    expect(row.count).toBeGreaterThanOrEqual(4);
    const singleBox = placementForLane('object', 'right', 3600, 0x65);
    expect(singleBox).toMatchObject({ lateral: 0.5, objectId: 0x65 });
  });

  it('cycles through the lane modes in both directions', () => {
    expect(nextLaneMode('auto', 1)).toBe('left');
    expect(nextLaneMode('auto', -1)).toBe('full');
    expect(nextLaneMode('full', 1)).toBe('auto');
  });
});

describe('keys', () => {
  const key = (k: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...extra });
  it('maps the documented tool letters', () => {
    expect(mapKey(key('v'), 'road')).toEqual({ type: 'tool', tool: 'select' });
    expect(mapKey(key('R'), 'select')).toEqual({ type: 'tool', tool: 'road' });
    expect(mapKey(key('s'), 'select')).toEqual({ type: 'tool', tool: 'sections' });
    expect(mapKey(key('p'), 'select')).toEqual({ type: 'tool', tool: 'pieces' });
    expect(mapKey(key('b'), 'select')).toEqual({ type: 'tool', tool: 'paint' });
    expect(mapKey(key('h'), 'select')).toEqual({ type: 'tool', tool: 'sculpt' });
    expect(mapKey(key('d'), 'select')).toEqual({ type: 'tool', tool: 'scenery' });
    expect(mapKey(key('g'), 'select')).toEqual({ type: 'tool', tool: 'start' });
    expect(mapKey(key('t'), 'select')).toEqual({ type: 'topView' });
    expect(mapKey(key('f'), 'select')).toEqual({ type: 'frame' });
  });

  it('leaves Ctrl, Cmd and Alt combinations to the shell', () => {
    for (const k of ['z', 'y', 'c', 'v', 'd', 's']) {
      expect(mapKey(key(k, { ctrlKey: true }), 'select')).toBeNull();
      expect(mapKey(key(k, { metaKey: true }), 'select')).toBeNull();
    }
    expect(mapKey(key('r', { altKey: true }), 'select')).toBeNull();
  });

  it('Q and E only mean lanes in the Pieces tool', () => {
    expect(mapKey(key('q'), 'pieces')).toEqual({ type: 'lane', direction: -1 });
    expect(mapKey(key('e'), 'pieces')).toEqual({ type: 'lane', direction: 1 });
    expect(mapKey(key('q'), 'select')).toBeNull();
  });

  it('maps brush keys, Delete and the finishing keys', () => {
    expect(mapKey(key('['), 'paint')).toEqual({ type: 'brush', direction: -1 });
    expect(mapKey(key(']'), 'paint')).toEqual({ type: 'brush', direction: 1 });
    expect(mapKey(key('Delete'), 'select')).toEqual({ type: 'delete' });
    expect(mapKey(key('Enter'), 'road')).toEqual({ type: 'toolKey', key: 'Enter' });
    expect(mapKey(key('Escape'), 'road')).toEqual({ type: 'toolKey', key: 'Escape' });
    expect(mapKey(key('Backspace'), 'road')).toEqual({ type: 'toolKey', key: 'Backspace' });
    expect(mapKey(key('x'), 'road')).toBeNull();
  });

  it('never fires while typing', () => {
    const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, isContentEditable: false, closest: () => null, ...extra }) as unknown as EventTarget;
    expect(isTypingTarget(el('INPUT', { type: 'text' }))).toBe(true);
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('SELECT'))).toBe(true);
    expect(isTypingTarget(el('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isTypingTarget(el('DIV'))).toBe(false);
    expect(isTypingTarget(el('DIV', { isContentEditable: true }))).toBe(true);
    expect(isTypingTarget(el('BUTTON', { closest: () => ({}) }))).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('resizes the brush within its limits', () => {
    expect(resizeBrush(1000, 1, 300, 9000)).toBe(1250);
    expect(resizeBrush(1000, -1, 300, 9000)).toBe(800);
    expect(resizeBrush(310, -1, 300, 9000)).toBe(300);
    expect(resizeBrush(8900, 1, 300, 9000)).toBe(9000);
    expect(brushKeyFor('paint')).toBe('paintRadius');
    expect(brushKeyFor('select')).toBeNull();
  });
});

describe('armed items', () => {
  it('belong to the right tool', () => {
    expect(toolForItem(roadStyleItem('circuit'))).toBe('road');
    expect(toolForItem(pieceItem('boostPanel'))).toBe('pieces');
    expect(toolForItem(sculptItem('raise'))).toBe('sculpt');
    expect(toolForItem(surfaceItem(kit.surface('test.sand')!))).toBe('paint');
  });

  it('each tool arms something sensible the first time it is chosen', () => {
    const project = freshOval();
    expect(defaultArmedFor('pieces', null, project, kit)).toMatchObject({ kind: 'piece', piece: 'boostPanel' });
    expect(defaultArmedFor('sculpt', null, project, kit)).toMatchObject({ kind: 'sculpt', mode: 'raise' });
    expect(defaultArmedFor('paint', null, project, kit)).toMatchObject({ kind: 'surface' });
    expect(defaultArmedFor('select', null, project, kit)).toBeNull();
    const existing = pieceItem('trickRamp');
    expect(defaultArmedFor('pieces', existing, project, kit)).toBe(existing);
  });

  it('knows which surface categories can be painted', () => {
    expect(isPaintable('ground')).toBe(true);
    expect(isPaintable('water')).toBe(true);
    expect(isPaintable('road')).toBe(false);
    expect(isPaintable('wall')).toBe(false);
  });

  it('lists only the scenery of the project theme', () => {
    expect(sceneryForTheme({ ...kit, catalog: { ...kit.catalog, scenery: [{ objectId: 1, label: 'a', themeIds: ['test'], scale: 1, spacing: 1 }, { objectId: 2, label: 'b', themeIds: ['other'], scale: 1, spacing: 1 }] } }, 'test')).toHaveLength(1);
  });
});

describe('bounds', () => {
  it('frames the whole design when nothing is selected', () => {
    const project = freshOval();
    const samples = new Map(project.roads.map((r) => [r.id, sampleRoad(r)]));
    const b = selectionBounds(project, samples, [])!;
    expect(b.min.x).toBeLessThan(-37000);
    expect(b.max.x).toBeGreaterThan(37000);
  });

  it('frames a point with a sensible minimum size', () => {
    const project = freshOval();
    const samples = new Map(project.roads.map((r) => [r.id, sampleRoad(r)]));
    const pt = project.roads[0].points[3];
    const b = selectionBounds(project, samples, [{ kind: 'point', roadId: project.roads[0].id, pointId: pt.id }])!;
    expect(b.max.x - b.min.x).toBeGreaterThanOrEqual(6000);
    expect((b.max.x + b.min.x) / 2).toBeCloseTo(pt.position.x, 0);
  });

  it('frames a section by its own stretch of road', () => {
    const project = freshOval();
    const samples = new Map(project.roads.map((r) => [r.id, sampleRoad(r)]));
    const road = project.roads[0];
    const b = selectionBounds(project, samples, [{ kind: 'section', roadId: road.id, sectionId: road.sections[0].id }])!;
    expect(b.max.x - b.min.x).toBeGreaterThan(70000);
  });

  it('returns null for an empty design', () => {
    const project = { ...freshOval(), roads: [], props: [] };
    expect(selectionBounds(project, new Map(), [])).toBeNull();
  });
});

describe('dropping palette tiles', () => {
  it('places a piece on the lane under the drop point', () => {
    const session = fakeSession(freshOval());
    const result = dropItem(pieceItem('boostPanel'), { x: 5500, y: 0, z: 15000 - 1300 }, makeCtx(session));
    runCommands(session, result.commands);
    const placed = session.project.pieces.at(-1)!;
    expect(placed.kind).toBe('boostPanel');
    expect(placed.lateral).toBe(-0.5);
  });

  it('explains when a piece is dropped off the road', () => {
    const session = fakeSession(freshOval());
    runCommands(session, dropItem(pieceItem('boostPanel'), { x: 0, y: 0, z: 0 }, makeCtx(session)).commands);
    expect(session.flashes[0]).toMatch(/road/i);
    expect(session.history).toHaveLength(0);
  });

  it('restyles the road a style tile is dropped on', () => {
    const session = fakeSession(freshOval());
    runCommands(session, dropItem(roadStyleItem('trail'), { x: 0, y: 0, z: 15000 }, makeCtx(session)).commands);
    expect(session.project.roads[0].styleId).toBe('trail');
  });

  it('applies a road surface to the section under the drop point', () => {
    const session = fakeSession(freshOval());
    const item = surfaceItem(kit.surface('test.roadAlt')!);
    runCommands(session, dropItem(item, { x: 0, y: 0, z: 15000 }, makeCtx(session)).commands);
    expect(session.project.roads[0].sections[0].surface).toEqual({ surfaceId: 'test.roadAlt' });
  });

  it('paints a stamp with a ground surface and scatters nothing on a road surface drop miss', () => {
    const session = fakeSession(freshOval());
    runCommands(session, dropItem(surfaceItem(kit.surface('test.sand')!), { x: 100, y: 0, z: 100 }, makeCtx(session)).commands);
    expect(session.project.terrainStrokes).toHaveLength(1);
    const miss = fakeSession(freshOval());
    runCommands(miss, dropItem(surfaceItem(kit.surface('test.roadAlt')!), { x: 0, y: 0, z: 0 }, makeCtx(miss)).commands);
    expect(miss.history).toHaveLength(0);
  });

  it('sculpts and places scenery', () => {
    const session = fakeSession(freshOval());
    runCommands(session, dropItem(sculptItem('raise'), { x: 100, y: 0, z: 100 }, makeCtx(session)).commands);
    expect(session.project.terrainStrokes[0]).toMatchObject({ kind: 'sculpt' });
    runCommands(session, dropItem({ kind: 'scenery', objectId: 303, label: 'Round tree', scale: 1, spacing: 600 }, { x: 100, y: 0, z: 100 }, makeCtx(session)).commands);
    expect(session.project.props).toHaveLength(1);
  });

  it('previews a lane ghost for pieces and a brush for terrain tiles', () => {
    const session = fakeSession(freshOval());
    expect(previewForDrop(pieceItem('boostPanel'), { x: 5500, y: 0, z: 15000 }, makeCtx(session))).toMatchObject({ kind: 'piece' });
    expect(previewForDrop(pieceItem('boostPanel'), { x: 0, y: 0, z: 0 }, makeCtx(session))).toBeNull();
    expect(previewForDrop(sculptItem('lower'), { x: 0, y: 0, z: 0 }, makeCtx(session))).toMatchObject({ kind: 'brush', style: 'lower' });
  });
});
