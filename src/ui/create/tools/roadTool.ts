/**
 * Road tool (R). Click the ground to add points to a road (a new road, or the open road that is
 * selected). A rubber band shows the next stretch. Click the first point to close the loop; click
 * the road between two points to insert one. Enter or Esc finishes.
 */
import { addRoad, appendRoadPoint, deleteRoad, deleteRoadPoint, insertRoadPoint, setRoadClosed } from '../../../lib/create/ops';
import type { CreatePointerEvent, CreateProject, CreateSelection, Road, Vec3 } from '../../../lib/create/types';
import { parseHandle } from '../overlay/handles';
import { isPrimaryButton, rayPlane, roadUnder } from './pick';
import { emptyStep, type HintSpec, type HoverTarget, type Mutate, type ToolCommand, type ToolCtx, type ToolKey, type ToolModule, type ToolStep } from './types';

export interface RoadState {
  /** The open road new points are appended to. */
  drawingRoadId: string | null;
  /** Which end of it grows. */
  end: 'end' | 'start';
}

const MIN_POINTS_TO_CLOSE = 3;

const cmdEdit = (label: string, mutate: Mutate): ToolCommand => ({ type: 'edit', label, mutate });

/**
 * Runs `compute` once against the design the event was made on, and hands the session a mutation
 * that reuses that result (so ids stay stable) unless the design moved on in between.
 */
function precompute<T extends { project: CreateProject }>(base: CreateProject, compute: (p: CreateProject) => T): { result: T; mutate: Mutate } {
  const result = compute(base);
  return { result, mutate: (p) => (p === base ? result.project : compute(p).project) };
}

function findRoad(project: CreateProject, id: string | null): Road | null {
  return id ? project.roads.find((r) => r.id === id) ?? null : null;
}

/** The open road a click on the ground would extend, if any, and which of its ends grows. */
export function activeRoad(ctx: ToolCtx, state: RoadState): { road: Road; end: 'end' | 'start' } | null {
  const drawing = findRoad(ctx.project, state.drawingRoadId);
  if (drawing && !drawing.closed) return { road: drawing, end: state.end };
  if (ctx.selection.length !== 1) return null;
  const sel = ctx.selection[0];
  if (sel.kind === 'road') {
    const road = findRoad(ctx.project, sel.roadId);
    return road && !road.closed && road.points.length >= 1 ? { road, end: 'end' } : null;
  }
  if (sel.kind === 'point') {
    const road = findRoad(ctx.project, sel.roadId);
    if (!road || road.closed || road.points.length < 1) return null;
    if (road.points[road.points.length - 1].id === sel.pointId) return { road, end: 'end' };
    if (road.points[0].id === sel.pointId && road.points.length > 1) return { road, end: 'start' };
  }
  return null;
}

function tipOf(road: Road, end: 'end' | 'start'): Vec3 {
  return (end === 'end' ? road.points[road.points.length - 1] : road.points[0]).position;
}

/** The plane new points are placed on: the height of the point we are extending, else the ground. */
function drawPlaneY(ctx: ToolCtx, active: { road: Road; end: 'end' | 'start' } | null): number {
  return active ? tipOf(active.road, active.end).y : ctx.groundPlaneY;
}

function canClose(active: { road: Road } | null): boolean {
  return !!active && active.road.points.length >= MIN_POINTS_TO_CLOSE;
}

function pointerStep(event: CreatePointerEvent, ctx: ToolCtx, state: RoadState): ToolStep<RoadState> {
  const active = activeRoad(ctx, state);
  const handle = parseHandle(event.handleId);
  const planeY = drawPlaneY(ctx, active);
  const ground = rayPlane(event.ray, planeY) ?? event.hit?.position ?? null;

  if (event.phase === 'hover' || event.phase === 'move' || event.phase === 'leave') {
    if (event.phase === 'leave') return emptyStep(state);
    if (handle?.type === 'close' && active && canClose(active)) {
      return emptyStep(state, {
        hover: { kind: 'close', roadId: active.road.id },
        preview: { kind: 'rubber', from: tipOf(active.road, active.end), to: active.road.points[active.end === 'end' ? 0 : active.road.points.length - 1].position, ghost: false },
        cursor: 'pointer',
        consumed: event.phase === 'move',
      });
    }
    if (handle?.type === 'point') {
      return emptyStep(state, { hover: { kind: 'point', roadId: handle.roadId, pointId: handle.pointId }, cursor: 'pointer', consumed: event.phase === 'move' });
    }
    if (!ground) return emptyStep(state, { cursor: 'crosshair' });
    if (active) {
      return emptyStep(state, {
        preview: { kind: 'rubber', from: tipOf(active.road, active.end), to: ground, ghost: true },
        cursor: 'crosshair',
        consumed: event.phase === 'move',
      });
    }
    const hit = event.hit?.position ?? ground;
    const under = roadUnder(ctx.project, hit, 0);
    if (under) {
      return emptyStep(state, {
        preview: { kind: 'insert', roadId: under.road.id, param: under.projection.param, position: under.projection.position },
        hover: { kind: 'road', roadId: under.road.id },
        cursor: 'copy',
      });
    }
    return emptyStep(state, { preview: { kind: 'rubber', from: ground, to: ground, ghost: true }, cursor: 'crosshair' });
  }

  if (event.phase === 'down') {
    if (!isPrimaryButton(event)) return emptyStep(state);
    // Close the loop.
    if (handle?.type === 'close' && active && canClose(active)) {
      const roadId = active.road.id;
      return emptyStep(
        { drawingRoadId: null, end: 'end' },
        {
          consumed: true,
          commands: [
            cmdEdit('Close the road loop', (p) => setRoadClosed(p, roadId, true)),
            { type: 'select', selection: [{ kind: 'road', roadId }] },
            // The loop is done: go back to Select so the next stray click does not start another road.
            { type: 'setTool', tool: 'select' },
            { type: 'flash', message: 'Loop closed. Your road is selected: drag its points to reshape it, or press F5 to test drive.', tone: 'ready' },
          ],
        },
      );
    }
    // Resume drawing from the end of an open road, or select a point.
    if (handle?.type === 'point') {
      const road = findRoad(ctx.project, handle.roadId);
      if (road && !road.closed && road.points.length >= 2) {
        const last = road.points[road.points.length - 1].id === handle.pointId;
        const first = road.points[0].id === handle.pointId;
        if (last || first) {
          return emptyStep(
            { drawingRoadId: road.id, end: last ? 'end' : 'start' },
            {
              consumed: true,
              commands: [{ type: 'select', selection: [{ kind: 'road', roadId: road.id }] }, { type: 'flash', message: 'Continue drawing from this end of the road.' }],
            },
          );
        }
      }
      return emptyStep(state, { consumed: true, commands: [{ type: 'select', selection: [{ kind: 'point', roadId: handle.roadId, pointId: handle.pointId }] }] });
    }
    if (!ground) return emptyStep(state, { consumed: true });

    if (active) {
      const road = active.road;
      const end = active.end;
      const position = { x: Math.round(ground.x), y: Math.round(ground.y), z: Math.round(ground.z) };
      const { mutate } = precompute(ctx.project, (p) => appendRoadPoint(p, road.id, position, { atStart: end === 'start' }));
      return emptyStep(
        { drawingRoadId: road.id, end },
        { consumed: true, commands: [cmdEdit('Add road point', mutate), { type: 'select', selection: [{ kind: 'road', roadId: road.id }] }] },
      );
    }

    const hit = event.hit?.position ?? ground;
    const under = roadUnder(ctx.project, hit, 0);
    if (under) {
      const roadId = under.road.id;
      const param = under.projection.param;
      const { result, mutate } = precompute(ctx.project, (p) => insertRoadPoint(p, roadId, param));
      if (!result.id) return emptyStep(state, { consumed: true });
      return emptyStep(state, {
        consumed: true,
        commands: [cmdEdit('Insert road point', mutate), { type: 'select', selection: [{ kind: 'point', roadId, pointId: result.id }] }],
      });
    }

    // A brand-new road.
    const position = { x: Math.round(ground.x), y: Math.round(ground.y), z: Math.round(ground.z) };
    const styleId = ctx.armed?.kind === 'roadStyle' ? ctx.armed.styleId : undefined;
    const { result, mutate } = precompute(ctx.project, (p) => addRoad(p, { points: [{ position }], styleId }));
    return emptyStep(
      { drawingRoadId: result.id, end: 'end' },
      {
        consumed: true,
        commands: [cmdEdit('Start a road', mutate), { type: 'select', selection: [{ kind: 'road', roadId: result.id }] }],
      },
    );
  }

  if (event.phase === 'up' || event.phase === 'cancel') return emptyStep(state, { consumed: true });
  return emptyStep(state);
}

/** Finish drawing: a road with fewer than two points is not a road, so it is dropped. */
function finish(ctx: ToolCtx, state: RoadState, keepSelection: CreateSelection[]): ToolStep<RoadState> {
  const road = findRoad(ctx.project, state.drawingRoadId);
  const commands: ToolCommand[] = [];
  if (road && road.points.length < 2) {
    commands.push(cmdEdit('Cancel road', (p) => deleteRoad(p, road.id)), { type: 'select', selection: [] });
  } else if (road) {
    commands.push({ type: 'select', selection: keepSelection.length ? keepSelection : [{ kind: 'road', roadId: road.id }] });
  }
  return emptyStep({ drawingRoadId: null, end: 'end' }, { consumed: true, commands });
}

function keyStep(key: ToolKey, ctx: ToolCtx, state: RoadState): ToolStep<RoadState> | null {
  if (key === 'Enter' || key === 'Escape') {
    if (!state.drawingRoadId) {
      return key === 'Escape' ? emptyStep(state, { consumed: true, commands: [{ type: 'setTool', tool: 'select' }] }) : null;
    }
    return finish(ctx, state, []);
  }
  if (key === 'Backspace') {
    const active = activeRoad(ctx, state);
    if (!active || !state.drawingRoadId) return null;
    const road = active.road;
    const point = active.end === 'end' ? road.points[road.points.length - 1] : road.points[0];
    if (!point) return null;
    if (road.points.length <= 1) return finish(ctx, state, []);
    return emptyStep(state, { consumed: true, commands: [cmdEdit('Remove last road point', (p) => deleteRoadPoint(p, road.id, point.id))] });
  }
  return null;
}

function hint(ctx: ToolCtx, state: RoadState, hover: HoverTarget | null): HintSpec {
  const active = activeRoad(ctx, state);
  if (hover?.kind === 'close') {
    return { text: 'Click the first point to close the loop.', chips: [{ keys: 'Enter', label: 'leave it open' }], tone: 'ready' };
  }
  if (active) {
    const n = active.road.points.length;
    const text =
      n < 2
        ? 'Click the ground to add the second point.'
        : n < MIN_POINTS_TO_CLOSE
          ? 'Click to keep going.'
          : 'Click to add points. Click the first point to close the loop.';
    return { text, chips: [{ keys: 'Backspace', label: 'undo last point' }, { keys: 'Enter', label: 'finish' }, { keys: 'Esc', label: 'finish' }] };
  }
  if (ctx.project.roads.length === 0) {
    return { text: 'Click the ground to place the first point of your road.', chips: [{ keys: 'T', label: 'top view is easiest' }] };
  }
  return {
    text: 'Click the ground to start a new road. Click an existing road to add a point on it.',
    chips: [{ keys: 'V', label: 'select instead' }],
  };
}

export const roadTool: ToolModule<RoadState> = {
  id: 'road',
  initial: () => ({ drawingRoadId: null, end: 'end' }),
  pointer: pointerStep,
  key: keyStep,
  hint,
  leave: (ctx, state) => finish(ctx, state, ctx.selection.slice()),
};

