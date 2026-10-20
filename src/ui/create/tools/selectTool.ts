/**
 * Select tool (V). Click anything to select it; drag road points, pieces, props and the start line.
 * Shift-drag a road point raises or lowers it. Shift-click adds to the selection.
 */
import { setStart, updatePiece, updateProp, updateRoadPoint } from '../../../lib/create/ops';
import { projectOntoRoad, roadLength, roadParamToDistance } from '../../../lib/create/spline';
import type { CreatePointerEvent, CreateProject, CreateSelection, Vec3 } from '../../../lib/create/types';
import { parseHandle } from '../overlay/handles';
import { groundHit, isPrimaryButton, isSelected, nearestRoadWithin, pickProp, rayPlane, rayVerticalPlane, roadUnder, sectionIdAt, toggleSelection } from './pick';
import { emptyStep, type HintSpec, type HoverTarget, type ToolCtx, type ToolKey, type ToolModule, type ToolPreview, type ToolStep } from './types';

const DRAG_THRESHOLD_PX = 4;
/** Top view (and a camera looking straight down) cannot read a height off the screen: 1 px = this many units. */
export const HEIGHT_UNITS_PER_PIXEL = 20;
/** A point may sit this far below / above the design ground (units), however far the cursor goes. */
export const MIN_POINT_HEIGHT = -3000;
export const MAX_POINT_HEIGHT = 15000;
/** One metre, for the height label (the kart is about 2 m long). */
export const UNITS_PER_METRE = 100;
/** How far along the road, either side of the start line centre, a click still counts as on the line (units). */
const START_BAND_HALF_LENGTH = 450;
/** A click this close (screen px) to a road point own dot still picks the point, even on the start line. */
const POINT_PRIORITY_PX = 6;

type MoveItem =
  | { kind: 'point'; roadId: string; pointId: string; origin: Vec3 }
  | { kind: 'prop'; propId: string; origin: Vec3 }
  | { kind: 'piece'; pieceId: string }
  | { kind: 'start' };

interface Press {
  target: CreateSelection | null;
  startScreen: { x: number; y: number };
  mode: 'plane' | 'height';
  planeY: number;
  anchorHit: Vec3 | null;
  anchorScreenY: number;
  /** Cursor height minus the dragged point height when height mode began (vertical-plane drag); null = use screen pixels. */
  anchorHeight: number | null;
  /** Accumulated planar move (XZ) and height move (Y) in world units. */
  dxz: { x: number; z: number };
  dy: number;
  /** Planar/height contribution frozen when the mode flips mid-drag. */
  baseDxz: { x: number; z: number };
  baseDy: number;
  unitsPerPixel: number;
  group: MoveItem[];
  moved: boolean;
  began: boolean;
  additive: boolean;
  wasSelected: boolean;
}

export interface SelectState {
  press: Press | null;
}

/** What is under the cursor, as a selection (or a hover-only target). */
/** True when `hit` lies on the checkered band of the start line. */
function onStartBand(hit: Vec3 | null, ctx: ToolCtx): boolean {
  if (!hit) return false;
  const road = ctx.project.roads.find((r) => r.id === ctx.project.start.roadId);
  if (!road || road.points.length < 2) return false;
  const projection = projectOntoRoad(road, hit);
  if (!projection || projection.distanceToCenter > projection.sample.width / 2) return false;
  const length = roadLength(road);
  if (!(length > 0)) return false;
  const delta = Math.abs(roadParamToDistance(road, projection.param) - roadParamToDistance(road, ctx.project.start.param));
  return Math.min(delta, length - delta) <= START_BAND_HALF_LENGTH;
}

export function pickTarget(event: CreatePointerEvent, ctx: ToolCtx): CreateSelection | null {
  const handle = parseHandle(event.handleId);
  // The start line sits on the road, so the road section (or a road point) under it would always win.
  // A click on its band picks the line instead, unless the cursor is right on a point's own dot or
  // on a piece / object handle.
  if ((!handle || handle.type === 'point' || handle.type === 'section' || handle.type === 'boundary') && onStartBand(groundHit(event, ctx), ctx)) {
    const point = handle?.type === 'point' ? ctx.project.roads.find((r) => r.id === handle.roadId)?.points.find((p) => p.id === handle.pointId) : null;
    const dot = point ? ctx.project2d(point.position) : null;
    if (!dot || Math.hypot(dot.x - event.screen.x, dot.y - event.screen.y) > POINT_PRIORITY_PX) return { kind: 'start' };
  }
  if (handle) {
    switch (handle.type) {
      case 'point':
        return { kind: 'point', roadId: handle.roadId, pointId: handle.pointId };
      case 'piece':
        return { kind: 'piece', pieceId: handle.pieceId };
      case 'start':
        return { kind: 'start' };
      case 'prop':
        return { kind: 'prop', propId: handle.propId };
      case 'section':
      case 'boundary':
        return { kind: 'section', roadId: handle.roadId, sectionId: handle.sectionId };
      default:
        break;
    }
  }
  const prop = pickProp(ctx.project, event.screen, ctx);
  if (prop) return { kind: 'prop', propId: prop.id };
  const hit = groundHit(event, ctx);
  if (hit) {
    const under = roadUnder(ctx.project, hit, 120);
    if (under) {
      const sectionId = sectionIdAt(under.road, under.projection.param);
      if (sectionId) return { kind: 'section', roadId: under.road.id, sectionId };
      return { kind: 'road', roadId: under.road.id };
    }
  }
  return null;
}

function buildGroup(target: CreateSelection, ctx: ToolCtx): MoveItem[] {
  const project = ctx.project;
  const inSelection = isSelected(ctx.selection, target);
  switch (target.kind) {
    case 'point': {
      const picks = inSelection ? ctx.selection.filter((s): s is Extract<CreateSelection, { kind: 'point' }> => s.kind === 'point') : [target];
      const items: MoveItem[] = [];
      for (const s of picks) {
        const point = project.roads.find((r) => r.id === s.roadId)?.points.find((p) => p.id === s.pointId);
        if (point) items.push({ kind: 'point', roadId: s.roadId, pointId: s.pointId, origin: { ...point.position } });
      }
      return items;
    }
    case 'prop': {
      const picks = inSelection ? ctx.selection.filter((s): s is Extract<CreateSelection, { kind: 'prop' }> => s.kind === 'prop') : [target];
      const items: MoveItem[] = [];
      for (const s of picks) {
        const prop = project.props.find((p) => p.id === s.propId);
        if (prop) items.push({ kind: 'prop', propId: s.propId, origin: { ...prop.position } });
      }
      return items;
    }
    case 'piece':
      return [{ kind: 'piece', pieceId: target.pieceId }];
    case 'start':
      return [{ kind: 'start' }];
    default:
      return [];
  }
}

/** Applies the accumulated drag to the design as it was when the drag began. */
export function applyMoveGroup(base: CreateProject, group: readonly MoveItem[], dxz: { x: number; z: number }, dy: number, hit: Vec3 | null): CreateProject {
  let p = base;
  for (const item of group) {
    if (item.kind === 'point') {
      p = updateRoadPoint(p, item.roadId, item.pointId, { position: { x: item.origin.x + dxz.x, y: item.origin.y + dy, z: item.origin.z + dxz.z } });
    } else if (item.kind === 'prop') {
      p = updateProp(p, item.propId, { position: { x: item.origin.x + dxz.x, y: item.origin.y + dy, z: item.origin.z + dxz.z } });
    } else if (item.kind === 'piece' && hit) {
      const near = nearestRoadWithin(p, hit, 9000);
      if (near) {
        const lateral = Math.max(-1, Math.min(1, near.projection.lateralNorm));
        p = updatePiece(p, item.pieceId, { roadId: near.road.id, param: near.projection.param, lateral });
      }
    } else if (item.kind === 'start' && hit) {
      const main = p.roads[0];
      const proj = main ? projectOntoRoad(main, hit) : null;
      if (main && proj) p = setStart(p, main.id, proj.param);
    }
  }
  return p;
}

function movingLabel(group: readonly MoveItem[], heightMode: boolean): string {
  const first = group[0];
  if (!first) return 'Move';
  if (first.kind === 'point') return heightMode ? 'Raise road point' : group.length > 1 ? 'Move road points' : 'Move road point';
  if (first.kind === 'prop') return group.length > 1 ? 'Move objects' : 'Move object';
  if (first.kind === 'piece') return 'Move piece';
  return 'Move start line';
}

/** Keeps every dragged point between `MIN_POINT_HEIGHT` and `MAX_POINT_HEIGHT` of the design ground. */
export function clampHeightDelta(dy: number, group: readonly MoveItem[], groundY: number): number {
  let lowest = Infinity;
  let highest = -Infinity;
  for (const item of group) {
    if (item.kind !== 'point') continue;
    lowest = Math.min(lowest, item.origin.y);
    highest = Math.max(highest, item.origin.y);
  }
  if (!Number.isFinite(lowest)) return dy;
  const lo = groundY + MIN_POINT_HEIGHT - lowest;
  const hi = groundY + MAX_POINT_HEIGHT - highest;
  return Math.max(Math.min(lo, 0), Math.min(Math.max(hi, 0), dy));
}

/** "+12 m" / "-3.5 m" / "0 m": height over the ground in metres. */
export function formatHeight(units: number): string {
  const metres = units / UNITS_PER_METRE;
  const rounded = Math.abs(metres) < 10 ? Math.round(metres * 10) / 10 : Math.round(metres);
  return `${rounded > 0 ? '+' : ''}${rounded} m`;
}

function hoverOf(target: CreateSelection | null): HoverTarget | null {
  return target;
}

function cursorFor(target: CreateSelection | null): string {
  if (!target) return 'default';
  if (target.kind === 'section' || target.kind === 'road') return 'default';
  return 'grab';
}

function pointerStep(event: CreatePointerEvent, ctx: ToolCtx, state: SelectState): ToolStep<SelectState> {
  const press = state.press;

  if (event.phase === 'hover') {
    const target = pickTarget(event, ctx);
    return emptyStep(state, { hover: hoverOf(target), cursor: cursorFor(target) });
  }
  if (event.phase === 'leave') return emptyStep(state);

  if (event.phase === 'down') {
    if (!isPrimaryButton(event)) return emptyStep(state);
    const target = pickTarget(event, ctx);
    const commands: ToolStep<SelectState>['commands'] = [];
    const additive = event.shift || event.ctrl;
    const wasSelected = target ? isSelected(ctx.selection, target) : false;
    // Shift / Ctrl only toggle membership when it turns out to be a click (see `up`), so that
    // Shift-dragging a point can raise it without first deselecting it.
    if (target && !additive && !(wasSelected && ctx.selection.length > 1)) commands.push({ type: 'select', selection: [target] });
    const hit = groundHit(event, ctx);
    const group = target ? buildGroup(target, ctx) : [];
    const origin = group[0] && group[0].kind !== 'piece' && group[0].kind !== 'start' ? group[0].origin : hit ?? { x: 0, y: ctx.groundPlaneY, z: 0 };
    const planeY = group[0] && (group[0].kind === 'point' || group[0].kind === 'prop') ? group[0].origin.y : ctx.groundPlaneY;
    // Shift held at the press: the drag is a height drag from the very first pixel.
    const startsHeight = event.shift && group.length > 0 && group.every((g) => g.kind === 'point');
    const startHeightOrigin = startsHeight && group[0].kind === 'point' ? group[0].origin : null;
    const startHeightHere = startHeightOrigin ? rayVerticalPlane(event.ray, startHeightOrigin)?.y ?? null : null;
    const next: Press = {
      target,
      startScreen: { ...event.screen },
      mode: startsHeight ? 'height' : 'plane',
      planeY,
      anchorHit: rayPlane(event.ray, planeY) ?? hit,
      anchorScreenY: event.screen.y,
      anchorHeight: startHeightHere !== null && startHeightOrigin ? startHeightHere - startHeightOrigin.y : null,
      dxz: { x: 0, z: 0 },
      dy: 0,
      baseDxz: { x: 0, z: 0 },
      baseDy: 0,
      unitsPerPixel: ctx.unitsPerPixel(origin),
      group,
      moved: false,
      began: false,
      additive,
      wasSelected,
    };
    return emptyStep({ press: next }, { consumed: true, commands, hover: hoverOf(target), cursor: cursorFor(target) });
  }

  if (!press) return emptyStep(state, { consumed: true });

  if (event.phase === 'cancel') {
    const commands: ToolStep<SelectState>['commands'] = press.began ? [{ type: 'cancel' }] : [];
    return emptyStep({ press: null }, { consumed: true, commands });
  }

  if (event.phase === 'move') {
    const dist = Math.hypot(event.screen.x - press.startScreen.x, event.screen.y - press.startScreen.y);
    if (!press.moved && dist < DRAG_THRESHOLD_PX) return emptyStep(state, { consumed: true, cursor: 'grabbing' });
    if (press.group.length === 0) return emptyStep(state, { consumed: true });
    const heightWanted = event.shift && press.group.every((g) => g.kind === 'point');
    const next: Press = { ...press, moved: true };
    const heightOrigin = press.group[0]?.kind === 'point' ? press.group[0].origin : null;
    // The cursor height on a vertical plane through the point, facing the camera: dragging up by N
    // screen pixels raises the point by what N pixels are worth at the point. Null from straight
    // above (top view), where the screen carries no height; then a fixed rate applies.
    const heightHere = heightOrigin ? rayVerticalPlane(event.ray, heightOrigin)?.y ?? null : null;
    if (heightWanted !== (press.mode === 'height')) {
      // Re-anchor so flipping Shift mid-drag never makes the item jump.
      next.mode = heightWanted ? 'height' : 'plane';
      next.baseDxz = { ...press.dxz };
      next.baseDy = press.dy;
      next.anchorScreenY = event.screen.y;
      next.anchorHeight = heightHere !== null && heightOrigin ? heightHere - (heightOrigin.y + press.dy) : null;
      next.anchorHit = rayPlane(event.ray, press.planeY) ?? groundHit(event, ctx);
    }
    let heightPreview: ToolPreview | null = null;
    if (next.mode === 'height' && heightOrigin) {
      const raw =
        next.anchorHeight !== null && heightHere !== null
          ? heightHere - next.anchorHeight - heightOrigin.y
          : next.baseDy + (next.anchorScreenY - event.screen.y) * HEIGHT_UNITS_PER_PIXEL;
      next.dy = clampHeightDelta(raw, press.group, ctx.groundPlaneY);
      const at = { x: heightOrigin.x + next.dxz.x, y: heightOrigin.y + next.dy, z: heightOrigin.z + next.dxz.z };
      heightPreview = { kind: 'height', position: at, groundY: ctx.groundPlaneY, text: formatHeight(at.y - ctx.groundPlaneY) };
    } else {
      const here = rayPlane(event.ray, next.planeY) ?? groundHit(event, ctx);
      if (here && next.anchorHit) {
        next.dxz = { x: next.baseDxz.x + (here.x - next.anchorHit.x), z: next.baseDxz.z + (here.z - next.anchorHit.z) };
      }
    }
    const commands: ToolStep<SelectState>['commands'] = [];
    if (!press.began) {
      if (press.target && !press.wasSelected) commands.push({ type: 'select', selection: [press.target] });
      commands.push({ type: 'begin', label: movingLabel(press.group, next.mode === 'height') });
      next.began = true;
    }
    const hit = groundHit(event, ctx);
    const { group, dxz, dy } = next;
    commands.push({ type: 'update', mutate: (base) => applyMoveGroup(base, group, dxz, dy, hit) });
    return emptyStep({ press: next }, { consumed: true, commands, cursor: 'grabbing', hover: hoverOf(press.target), preview: heightPreview });
  }

  if (event.phase === 'up') {
    const commands: ToolStep<SelectState>['commands'] = [];
    if (press.began) commands.push({ type: 'end' });
    else if (!press.moved) {
      if (press.additive) {
        if (press.target) commands.push({ type: 'select', selection: toggleSelection(ctx.selection, press.target) });
      } else if (!press.target) commands.push({ type: 'select', selection: [] });
      else if (press.wasSelected && ctx.selection.length > 1) commands.push({ type: 'select', selection: [press.target] });
    }
    return emptyStep({ press: null }, { consumed: true, commands, hover: hoverOf(press.target), cursor: cursorFor(press.target) });
  }
  return emptyStep(state, { consumed: true });
}

function keyStep(key: ToolKey, _ctx: ToolCtx, state: SelectState): ToolStep<SelectState> | null {
  if (key === 'Escape') {
    if (state.press?.began) return emptyStep({ press: null }, { consumed: true, commands: [{ type: 'cancel' }] });
    return emptyStep({ press: null }, { consumed: true, commands: [{ type: 'select', selection: [] }] });
  }
  return null;
}

function hint(ctx: ToolCtx, state: SelectState, hover: HoverTarget | null): HintSpec {
  if (state.press?.began) {
    const heightMode = state.press.mode === 'height';
    return {
      text: heightMode ? 'Drag up or down to raise or lower the point.' : 'Drag to move it. Let go to drop it.',
      chips: [{ keys: 'Shift', label: 'raise / lower' }, { keys: 'Esc', label: 'cancel' }],
    };
  }
  if (hover?.kind === 'point') {
    return { text: 'Drag to move this road point.', chips: [{ keys: 'Shift', label: 'drag to raise it' }, { keys: 'Del', label: 'remove' }] };
  }
  if (hover?.kind === 'piece') return { text: 'Drag to slide this piece along the road.', chips: [{ keys: 'Del', label: 'remove' }] };
  if (hover?.kind === 'prop') return { text: 'Drag to move this object.', chips: [{ keys: 'Del', label: 'remove' }] };
  if (hover?.kind === 'start') return { text: 'Drag the start line along the main road.', chips: [] };
  if (ctx.selection.length > 0) {
    return { text: 'Drag handles to reshape. Click empty ground to deselect.', chips: [{ keys: 'Shift', label: 'add to selection' }, { keys: 'Del', label: 'delete' }, { keys: 'F', label: 'frame' }] };
  }
  return {
    text: 'Click a road, point, piece or object to select it.',
    chips: [{ keys: 'Shift', label: 'drag a point to raise it' }, { keys: 'R', label: 'draw a road' }],
  };
}

export const selectTool: ToolModule<SelectState> = {
  id: 'select',
  initial: () => ({ press: null }),
  pointer: pointerStep,
  key: keyStep,
  hint,
  leave: (_ctx, state) => emptyStep({ press: null }, { commands: state.press?.began ? [{ type: 'cancel' }] : [] }),
};
