/**
 * Sculpt tool (H). Drag to raise the ground; Shift lowers, Ctrl smooths. The mode armed in the
 * palette (raise / lower / smooth / flatten) is the default. One drag is one stroke.
 */
import { addTerrainStroke } from '../../../lib/create/ops';
import type { CreatePointerEvent, Vec2 } from '../../../lib/create/types';
import { groundHit, isPrimaryButton } from './pick';
import { appendStrokePoint } from './paintTool';
import { emptyStep, type HintSpec, type Modifiers, type SculptMode, type ToolCtx, type ToolKey, type ToolModule, type ToolStep } from './types';

export interface SculptState {
  stroke: null | { points: Vec2[]; mode: SculptMode; radius: number; strength: number; targetHeight?: number };
}

/** The mode a stroke starts in, given the palette's default and the held modifiers. */
export function effectiveSculptMode(base: SculptMode, mods: Pick<Modifiers, 'shift' | 'ctrl'>): SculptMode {
  if (mods.ctrl) return 'smooth';
  if (mods.shift) return base === 'lower' ? 'raise' : 'lower';
  return base;
}

function baseMode(ctx: ToolCtx): SculptMode {
  return ctx.armed?.kind === 'sculpt' ? ctx.armed.mode : 'raise';
}

const strokeMutation = (stroke: NonNullable<SculptState['stroke']>) => (base: Parameters<typeof addTerrainStroke>[0]) =>
  addTerrainStroke(base, {
    kind: 'sculpt',
    mode: stroke.mode,
    radius: stroke.radius,
    strength: stroke.strength,
    ...(stroke.mode === 'flatten' ? { targetHeight: stroke.targetHeight ?? 0 } : {}),
    points: stroke.points,
  }).project;

const MODE_LABEL: Record<SculptMode, string> = { raise: 'Raise ground', lower: 'Lower ground', smooth: 'Smooth ground', flatten: 'Flatten ground' };

function pointerStep(event: CreatePointerEvent, ctx: ToolCtx, state: SculptState): ToolStep<SculptState> {
  const hit = groundHit(event, ctx);
  const mode = state.stroke?.mode ?? effectiveSculptMode(baseMode(ctx), event);
  const radius = state.stroke?.radius ?? ctx.brush.sculptRadius;
  const preview: ToolStep<SculptState>['preview'] = hit ? { kind: 'brush', center: hit, radius, style: mode } : null;

  if (event.phase === 'hover') return emptyStep(state, { preview, cursor: 'crosshair' });
  if (event.phase === 'leave') return emptyStep(state);

  if (event.phase === 'down') {
    if (!isPrimaryButton(event)) return emptyStep(state);
    if (!ctx.project.terrain.enabled) {
      return emptyStep(state, { consumed: true, commands: [{ type: 'flash', message: 'The ground is switched off. Turn it on in the Track settings to sculpt.' }] });
    }
    if (!hit) return emptyStep(state, { consumed: true });
    const stroke = {
      points: appendStrokePoint([], hit, 0),
      mode,
      radius: ctx.brush.sculptRadius,
      strength: ctx.brush.sculptStrength,
      targetHeight: Math.round(hit.y),
    };
    return emptyStep(
      { stroke },
      {
        consumed: true,
        preview,
        cursor: 'crosshair',
        commands: [{ type: 'begin', label: MODE_LABEL[mode] }, { type: 'update', mutate: strokeMutation(stroke) }],
      },
    );
  }

  const current = state.stroke;
  if (!current) return emptyStep(state, { consumed: true });
  if (event.phase === 'move') {
    if (!hit) return emptyStep(state, { consumed: true, preview });
    const points = appendStrokePoint(current.points, hit, current.radius);
    if (points === current.points) return emptyStep(state, { consumed: true, preview });
    const next = { ...current, points };
    return emptyStep({ stroke: next }, { consumed: true, preview, commands: [{ type: 'update', mutate: strokeMutation(next) }] });
  }
  if (event.phase === 'up') return emptyStep({ stroke: null }, { consumed: true, preview, commands: [{ type: 'end' }] });
  if (event.phase === 'cancel') return emptyStep({ stroke: null }, { consumed: true, commands: [{ type: 'cancel' }] });
  return emptyStep(state, { consumed: true });
}

function keyStep(key: ToolKey, _ctx: ToolCtx, state: SculptState): ToolStep<SculptState> | null {
  if (key === 'Escape') {
    if (state.stroke) return emptyStep({ stroke: null }, { consumed: true, commands: [{ type: 'cancel' }] });
    return emptyStep(state, { consumed: true, commands: [{ type: 'setTool', tool: 'select' }] });
  }
  return null;
}

function hint(ctx: ToolCtx, _state: SculptState, _hover: unknown, mods: Modifiers): HintSpec {
  if (!ctx.project.terrain.enabled) return { text: 'The ground is switched off, so there is nothing to sculpt. Turn it on in the Track settings.', chips: [], tone: 'warn' };
  const mode = effectiveSculptMode(baseMode(ctx), mods);
  const verb = mode === 'raise' ? 'raise hills' : mode === 'lower' ? 'dig valleys' : mode === 'smooth' ? 'smooth the ground' : 'level the ground';
  return {
    text: `Drag over the ground to ${verb}.`,
    chips: [{ keys: 'Shift', label: 'lower' }, { keys: 'Ctrl', label: 'smooth' }, { keys: '[ ]', label: 'brush size' }],
  };
}

export const sculptTool: ToolModule<SculptState> = {
  id: 'sculpt',
  initial: () => ({ stroke: null }),
  pointer: pointerStep,
  key: keyStep,
  hint,
  leave: (_ctx, state) => emptyStep({ stroke: null }, { commands: state.stroke ? [{ type: 'cancel' }] : [] }),
};
