/**
 * Pieces tool (P). The piece armed in the palette follows the cursor as a ghost snapped to a lane
 * of the road underneath; click to place it. Q / E change the lane.
 */
import { addPiece } from '../../../lib/create/ops';
import type { CreatePointerEvent, CreateProject, PieceKind } from '../../../lib/create/types';
import { parseHandle } from '../overlay/handles';
import { laneLabel, placementForLane, resolveLane } from './lanes';
import { groundHit, isPrimaryButton, roadUnder } from './pick';
import { emptyStep, type ArmedItem, type HintSpec, type HoverTarget, type ToolCtx, type ToolKey, type ToolModule, type ToolStep } from './types';

export type PieceState = Record<string, never>;

export function armedPiece(armed: ArmedItem | null): Extract<ArmedItem, { kind: 'piece' }> | null {
  return armed?.kind === 'piece' ? armed : null;
}

function placementAt(event: CreatePointerEvent, ctx: ToolCtx) {
  const piece = armedPiece(ctx.armed);
  const hit = groundHit(event, ctx);
  if (!piece || !hit) return null;
  const under = roadUnder(ctx.project, hit, 500);
  if (!under) return null;
  const lane = resolveLane(ctx.laneMode, piece.piece, under.projection.lateralNorm);
  const placement = placementForLane(piece.piece, lane, under.projection.sample.width, piece.objectId);
  return { piece, under, lane, placement };
}

const pieceNoun = (kind: PieceKind): string =>
  kind === 'boostPanel' ? 'boost panel' : kind === 'boostRamp' ? 'boost ramp' : kind === 'trickRamp' ? 'trick ramp' : kind === 'itemRow' ? 'item box row' : 'object';

function pointerStep(event: CreatePointerEvent, ctx: ToolCtx, state: PieceState): ToolStep<PieceState> {
  const handle = parseHandle(event.handleId);
  if (event.phase === 'hover') {
    if (handle?.type === 'piece') return emptyStep(state, { hover: { kind: 'piece', pieceId: handle.pieceId }, cursor: 'pointer' });
    const at = placementAt(event, ctx);
    if (!at) return emptyStep(state, { cursor: ctx.armed?.kind === 'piece' ? 'not-allowed' : 'default' });
    return emptyStep(state, {
      preview: {
        kind: 'piece',
        roadId: at.under.road.id,
        param: at.under.projection.param,
        lateral: at.placement.lateral,
        width: at.placement.width,
        length: at.placement.length,
        pieceKind: at.piece.piece,
        lane: at.lane,
      },
      cursor: 'copy',
    });
  }
  if (event.phase === 'leave') return emptyStep(state);
  if (event.phase === 'down') {
    if (!isPrimaryButton(event)) return emptyStep(state);
    if (handle?.type === 'piece') {
      return emptyStep(state, { consumed: true, commands: [{ type: 'select', selection: [{ kind: 'piece', pieceId: handle.pieceId }] }] });
    }
    const at = placementAt(event, ctx);
    if (!at) {
      if (!armedPiece(ctx.armed)) {
        return emptyStep(state, { consumed: true, commands: [{ type: 'flash', message: 'Pick a piece in the palette below first.' }] });
      }
      return emptyStep(state, { consumed: true, commands: [{ type: 'flash', message: 'Pieces go on the road. Move the cursor over it.' }] });
    }
    const base: CreateProject = ctx.project;
    const roadId = at.under.road.id;
    const param = at.under.projection.param;
    const placement = at.placement;
    const result = addPiece(base, { ...placement, kind: at.piece.piece, roadId, param });
    return emptyStep(state, {
      consumed: true,
      commands: [
        {
          type: 'edit',
          label: `Place ${at.piece.label.toLowerCase()}`,
          mutate: (p) => (p === base ? result.project : addPiece(p, { ...placement, kind: at.piece.piece, roadId, param }).project),
        },
        { type: 'select', selection: [{ kind: 'piece', pieceId: result.id }] },
      ],
    });
  }
  if (event.phase === 'up' || event.phase === 'cancel') return emptyStep(state, { consumed: true });
  return emptyStep(state, { consumed: true });
}

function keyStep(key: ToolKey): ToolStep<PieceState> | null {
  if (key === 'Escape') return emptyStep({}, { consumed: true, commands: [{ type: 'setTool', tool: 'select' }] });
  return null;
}

function hint(ctx: ToolCtx, _state: PieceState, hover: HoverTarget | null): HintSpec {
  const piece = armedPiece(ctx.armed);
  if (ctx.project.roads.length === 0) return { text: 'Draw a road first (R), then place boosts and item boxes on it.', chips: [], tone: 'warn' };
  if (!piece) return { text: 'Pick a piece in the palette below, then click the road to place it.', chips: [], tone: 'warn' };
  if (hover?.kind === 'piece') return { text: 'Click to select this piece. Use the Select tool (V) to move it.', chips: [] };
  return {
    text: `Click the road to place a ${pieceNoun(piece.piece)}. Lane: ${laneLabel(ctx.laneMode)}.`,
    chips: [{ keys: 'Q / E', label: 'change lane' }, { keys: 'Esc', label: 'stop placing' }],
  };
}

export const pieceTool: ToolModule<PieceState> = {
  id: 'pieces',
  initial: () => ({}),
  pointer: pointerStep,
  key: keyStep,
  hint,
  leave: (_ctx, state) => emptyStep(state),
};
