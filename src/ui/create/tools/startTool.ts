/**
 * Start tool (G). Click the main road to move the start line there.
 */
import { setStart } from '../../../lib/create/ops';
import type { CreatePointerEvent } from '../../../lib/create/types';
import { groundHit, isPrimaryButton, roadUnder } from './pick';
import { emptyStep, type HintSpec, type HoverTarget, type ToolCtx, type ToolKey, type ToolModule, type ToolStep } from './types';

export type StartState = Record<string, never>;

function target(event: CreatePointerEvent, ctx: ToolCtx) {
  const hit = groundHit(event, ctx);
  if (!hit) return null;
  const under = roadUnder(ctx.project, hit, 300);
  if (!under) return null;
  const main = ctx.project.roads[0];
  return { under, onMain: !!main && under.road.id === main.id };
}

function pointerStep(event: CreatePointerEvent, ctx: ToolCtx, state: StartState): ToolStep<StartState> {
  if (event.phase === 'hover') {
    const at = target(event, ctx);
    if (!at) return emptyStep(state, { cursor: 'default' });
    return emptyStep(state, {
      preview: { kind: 'start', roadId: at.under.road.id, param: at.under.projection.param, blocked: !at.onMain },
      cursor: at.onMain ? 'copy' : 'not-allowed',
    });
  }
  if (event.phase === 'down') {
    if (!isPrimaryButton(event)) return emptyStep(state);
    const at = target(event, ctx);
    if (!at) return emptyStep(state, { consumed: true, commands: [{ type: 'flash', message: 'Click the road to put the start line there.' }] });
    if (!at.onMain) {
      return emptyStep(state, { consumed: true, commands: [{ type: 'flash', message: 'The start line can only go on the main road (your first road).' }] });
    }
    const roadId = at.under.road.id;
    const param = at.under.projection.param;
    return emptyStep(state, {
      consumed: true,
      commands: [
        { type: 'edit', label: 'Move start line', mutate: (p) => setStart(p, roadId, param) },
        { type: 'select', selection: [{ kind: 'start' }] },
      ],
    });
  }
  if (event.phase === 'up' || event.phase === 'cancel') return emptyStep(state, { consumed: true });
  return emptyStep(state);
}

function keyStep(key: ToolKey): ToolStep<StartState> | null {
  if (key === 'Escape') return emptyStep({}, { consumed: true, commands: [{ type: 'setTool', tool: 'select' }] });
  return null;
}

function hint(ctx: ToolCtx, _state: StartState, hover: HoverTarget | null): HintSpec {
  if (ctx.project.roads.length === 0) return { text: 'Draw a road first (R). The start line goes on it.', chips: [], tone: 'warn' };
  void hover;
  return { text: 'Click the main road to put the start line there. The race grid lines up behind it.', chips: [{ keys: 'V', label: 'drag it with Select' }] };
}

export const startTool: ToolModule<StartState> = {
  id: 'start',
  initial: () => ({}),
  pointer: pointerStep,
  key: keyStep,
  hint,
  leave: (_ctx, state) => emptyStep(state),
};
