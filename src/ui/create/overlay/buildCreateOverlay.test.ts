import { describe, expect, it } from 'vitest';
import { sampleRoad } from '../../../lib/create/spline';
import { splitSection } from '../../../lib/create/ops';
import type { CreateProject, CreateSelection } from '../../../lib/create/types';
import { freshOval } from '../tools/testing';
import type { HoverTarget, ToolId, ToolPreview } from '../tools/types';
import { encodeHandle } from './handles';
import { buildCreateOverlay, OVERLAY_COLORS } from './buildCreateOverlay';

function build(project: CreateProject, extra: { selection?: CreateSelection[]; tool?: ToolId; hover?: HoverTarget | null; preview?: ToolPreview | null; activeRoadId?: string | null; closeHover?: boolean } = {}) {
  const samples = new Map(project.roads.map((r) => [r.id, sampleRoad(r)]));
  return buildCreateOverlay({ project, samples, selection: extra.selection ?? [], tool: extra.tool ?? 'select', hover: extra.hover ?? null, preview: extra.preview ?? null, activeRoadId: extra.activeRoadId, closeHover: extra.closeHover });
}

const pointIds = (o: ReturnType<typeof build>) => o.points.filter((p) => p.id.startsWith('pt|') || p.id.startsWith('close|')).map((p) => p.id);

describe('buildCreateOverlay', () => {
  it('draws a dashed centre line and direction chevrons for every road', () => {
    const o = build(freshOval());
    const dashed = o.lines.filter((l) => l.dashed);
    expect(dashed).toHaveLength(1);
    expect(dashed[0].points.length).toBeGreaterThan(100);
    const chevrons = o.lines.filter((l) => l.points.length === 3 && !l.dashed);
    // ~182 000 units of road, one chevron per ~1500.
    expect(chevrons.length).toBeGreaterThan(100);
    expect(chevrons.length).toBeLessThan(140);
  });

  it('chevrons point along the driving direction', () => {
    const project = freshOval();
    const o = build(project);
    const chevron = o.lines.find((l) => l.points.length === 3 && !l.dashed)!;
    const [wingL, tip, wingR] = chevron.points;
    // The first road runs along +x on the top straight, so the tip is ahead of both wings.
    expect(tip.x).toBeGreaterThan(wingL.x);
    expect(tip.x).toBeGreaterThan(wingR.x);
  });

  it('shows road edges only when the road is selected', () => {
    const project = freshOval();
    const plain = build(project);
    const selected = build(project, { selection: [{ kind: 'road', roadId: project.roads[0].id }] });
    expect(selected.lines.length).toBe(plain.lines.length + 2);
  });

  it('control points are 9px white pickable dots; hover is 11px; selected is 12px accent with a ring', () => {
    const project = freshOval();
    const road = project.roads[0];
    const plain = build(project, { tool: 'road' });
    const dot = plain.points.find((p) => p.id === encodeHandle({ type: 'point', roadId: road.id, pointId: road.points[2].id }))!;
    expect(dot).toMatchObject({ radius: 9, pickable: true });
    expect(dot.color).toEqual(OVERLAY_COLORS.white);

    const hovered = build(project, { tool: 'road', hover: { kind: 'point', roadId: road.id, pointId: road.points[2].id } });
    expect(hovered.points.find((p) => p.id === dot.id)!.radius).toBe(11);

    const selected = build(project, { selection: [{ kind: 'point', roadId: road.id, pointId: road.points[2].id }] });
    const sel = selected.points.find((p) => p.id === dot.id)!;
    expect(sel).toMatchObject({ radius: 12, ring: true });
    expect(sel.color).toEqual(OVERLAY_COLORS.road);
  });

  it('labels the first point of an open road and offers the close ring while drawing', () => {
    const project = freshOval();
    const road = project.roads[0];
    const open = { ...project, roads: [{ ...road, closed: false, points: road.points.slice(0, 8) }] };
    const o = build(open, { tool: 'road', activeRoadId: road.id });
    const first = o.points.find((p) => p.id === encodeHandle({ type: 'close', roadId: road.id }))!;
    expect(first.ring).toBe(true);
    expect(first.pickable).toBe(true);
    const idle = build(open, { tool: 'select', selection: [{ kind: 'road', roadId: road.id }] });
    expect(idle.points.find((p) => p.id === encodeHandle({ type: 'point', roadId: road.id, pointId: road.points[0].id }))!.label).toBe('Start of road');
    const closing = build(open, { tool: 'road', activeRoadId: road.id, closeHover: true });
    expect(closing.points.find((p) => p.id === first.id)!.label).toBe('Click to close the loop');
  });

  it('keeps the road uncluttered: no control points in Select until the road is selected or hovered', () => {
    const project = freshOval();
    const road = project.roads[0];
    expect(pointIds(build(project, { tool: 'select' }))).toHaveLength(0);
    expect(pointIds(build(project, { tool: 'select', hover: { kind: 'section', roadId: road.id, sectionId: road.sections[0].id } }))).toHaveLength(road.points.length);
    expect(pointIds(build(project, { tool: 'select', selection: [{ kind: 'road', roadId: road.id }] }))).toHaveLength(road.points.length);
  });

  it('shrinks control points when they crowd together on screen', () => {
    const project = freshOval();
    const samples = new Map(project.roads.map((r) => [r.id, sampleRoad(r)]));
    const sizeAt = (upp: number) =>
      buildCreateOverlay({ project, samples, selection: [], tool: 'road', hover: null, preview: null, unitsPerPixel: () => upp }).points.find((p) => p.id.startsWith('pt|'))!.radius;
    expect(sizeAt(5)).toBe(9);
    expect(sizeAt(400)).toBeLessThan(9);
    expect(sizeAt(5000)).toBe(4);
  });

  it('hides control points in the brush tools but keeps selected ones', () => {
    const project = freshOval();
    const road = project.roads[0];
    expect(pointIds(build(project, { tool: 'paint' }))).toHaveLength(0);
    const sel = build(project, { tool: 'paint', selection: [{ kind: 'point', roadId: road.id, pointId: road.points[0].id }] });
    expect(pointIds(sel)).toHaveLength(1);
  });

  it('draws the rubber band dashed with a ghost point', () => {
    const project = freshOval();
    const o = build(project, { tool: 'road', preview: { kind: 'rubber', from: { x: 0, y: 0, z: 0 }, to: { x: 4000, y: 0, z: 1000 }, ghost: true } });
    expect(o.lines.at(-1)).toMatchObject({ dashed: true });
    expect(o.points.find((p) => p.id === 'viz|ghost')).toBeTruthy();
  });

  it('draws the insert ghost on the curve', () => {
    const o = build(freshOval(), { tool: 'road', preview: { kind: 'insert', roadId: 'x', param: 0.5, position: { x: 5, y: 0, z: 15000 } } });
    expect(o.points.find((p) => p.id === 'viz|insert')).toMatchObject({ pickable: false, ring: true });
  });

  it('ticks section edges in violet and tints the selected section 18% and the hovered one 8%', () => {
    const base = freshOval();
    const split = splitSection(base, base.roads[0].id, 6.5);
    const project = splitSection(split.project, base.roads[0].id, 14.5).project;
    const road = project.roads[0];
    const [a, b] = [road.sections[1], road.sections[2]];
    const plain = build(project, { tool: 'sections' });
    const violet = plain.lines.filter((l) => l.points.length === 2 && l.color[2] > 0.9 && l.color[0] > 0.6 && l.color[1] < 0.6);
    expect(violet).toHaveLength(3);
    expect(plain.triangles).toHaveLength(2);

    const withSel = build(project, { selection: [{ kind: 'section', roadId: road.id, sectionId: a.id }], hover: { kind: 'section', roadId: road.id, sectionId: b.id } });
    const tints = withSel.triangles.filter((t) => t.color[2] > 0.9 && t.color[3] < 0.2);
    expect(tints.map((t) => t.color[3]).sort()).toEqual([OVERLAY_COLORS.sectionHoverTint[3], OVERLAY_COLORS.sectionTint[3]].sort());
    expect(tints[0].positions.length % 9).toBe(0);
  });

  it('the Sections tool exposes boundary and label handles and a split line preview', () => {
    const base = freshOval();
    const project = splitSection(base, base.roads[0].id, 6.5).project;
    const road = project.roads[0];
    const o = build(project, { tool: 'sections', preview: { kind: 'split', roadId: road.id, param: 12.2, blocked: false } });
    expect(o.points.filter((p) => p.id.startsWith('bnd|'))).toHaveLength(2);
    expect(o.points.filter((p) => p.id.startsWith('sec|')).map((p) => p.label)).toEqual(['Road', 'Road']);
    expect(o.points.find((p) => p.id === 'viz|split')!.label).toBe('Split here');
  });

  it('shows pieces as amber footprints with pickable handles, ghosts at 35%', () => {
    const project = freshOval();
    const o = build(project, { tool: 'pieces' });
    const handles = o.points.filter((p) => p.id.startsWith('piece|'));
    expect(handles).toHaveLength(project.pieces.length);
    expect(handles[0].color[0]).toBe(OVERLAY_COLORS.piece[0]);

    const road = project.roads[0];
    const ghost = build(project, { tool: 'pieces', preview: { kind: 'piece', roadId: road.id, param: 4.5, lateral: 0.5, width: 1100, length: 1500, pieceKind: 'boostPanel', lane: 'right' } });
    const filled = ghost.triangles.filter((t) => t.color[3] === OVERLAY_COLORS.pieceGhost[3]);
    expect(filled).toHaveLength(1);
    expect(filled[0].positions).toHaveLength(18);
    const lane = ghost.triangles.filter((t) => t.color[3] === OVERLAY_COLORS.pieceLane[3]);
    expect(lane).toHaveLength(1);
  });

  it('draws the start line as a checkered band plus 12 grid slots', () => {
    const project = freshOval();
    const o = build(project, { tool: 'start' });
    expect(o.triangles.filter((t) => t.color[3] === OVERLAY_COLORS.checkWhite[3])).toHaveLength(1);
    expect(o.triangles.filter((t) => t.color[3] === OVERLAY_COLORS.black[3])).toHaveLength(1);
    const slots = o.lines.filter((l) => l.closed && l.points.length === 4 && l.color[3] === OVERLAY_COLORS.slot[3]);
    expect(slots).toHaveLength(12);
    expect(o.points.find((p) => p.id === 'start')).toMatchObject({ pickable: true });
  });

  it('draws brush circles on the ground: category colour for paint, red for erase, arrows for sculpt', () => {
    const project = freshOval();
    const center = { x: 100, y: 50, z: 200 };
    const paint = build(project, { tool: 'paint', preview: { kind: 'brush', center, radius: 1800, style: 'paint', category: 'water' } });
    const ring = paint.lines.filter((l) => l.points.length === 49)[1];
    expect(ring.color[2]).toBeGreaterThan(ring.color[0]);
    const erase = build(project, { tool: 'paint', preview: { kind: 'brush', center, radius: 1800, style: 'erase' } });
    expect(erase.lines.filter((l) => l.points.length === 49)[1].color).toEqual(OVERLAY_COLORS.danger);
    const raise = build(project, { tool: 'sculpt', preview: { kind: 'brush', center, radius: 1800, style: 'raise' } });
    const lower = build(project, { tool: 'sculpt', preview: { kind: 'brush', center, radius: 1800, style: 'lower' } });
    const arrowHead = (o: ReturnType<typeof build>) => o.lines.filter((l) => l.points.length === 3 && l.points[1].x === center.x);
    expect(arrowHead(raise)[0].points[1].y).toBeGreaterThan(arrowHead(raise)[0].points[0].y);
    expect(arrowHead(lower)[0].points[1].y).toBeLessThan(arrowHead(lower)[0].points[0].y);
  });

  it('reuses the per-road geometry between builds, so only the ghost changes', () => {
    const project = freshOval();
    const samples = new Map(project.roads.map((r) => [r.id, sampleRoad(r)]));
    const a = buildCreateOverlay({ project, samples, selection: [], tool: 'select', hover: null, preview: null });
    const b = buildCreateOverlay({ project, samples, selection: [], tool: 'select', hover: null, preview: { kind: 'brush', center: { x: 0, y: 0, z: 0 }, radius: 100, style: 'paint' } });
    // The centre-line polyline is the very same array: it came from the cache.
    expect(b.lines.find((l) => l.dashed)!.points).toBe(a.lines.find((l) => l.dashed)!.points);
  });

  it('is cheap enough to rebuild on every pointer move', () => {
    const project = freshOval();
    const samples = new Map(project.roads.map((r) => [r.id, sampleRoad(r)]));
    buildCreateOverlay({ project, samples, selection: [], tool: 'select', hover: null, preview: null });
    const start = performance.now();
    for (let i = 0; i < 200; i++) {
      buildCreateOverlay({ project, samples, selection: [], tool: 'select', hover: null, preview: { kind: 'rubber', from: { x: 0, y: 0, z: 0 }, to: { x: i, y: 0, z: 0 }, ghost: true } });
    }
    expect((performance.now() - start) / 200).toBeLessThan(4);
  });
});
