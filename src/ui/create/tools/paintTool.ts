/**
 * Paint tool (B). Paints the terrain with the surface armed in the palette; one drag is one stroke
 * and one undo step. `[` / `]` change the brush size, Shift erases.
 */
import { addTerrainStroke } from '../../../lib/create/ops';
import type { CreatePointerEvent, SurfaceCategory, SurfaceRef, Vec2, Vec3 } from '../../../lib/create/types';
import { groundHit, isPrimaryButton } from './pick';
import { emptyStep, surfaceTint, type ArmedItem, type HintSpec, type ToolCtx, type ToolKey, type ToolModule, type ToolStep } from './types';

export interface PaintState {
  stroke: null | { points: Vec2[]; surface: SurfaceRef | null; radius: number };
}

export function armedSurface(armed: ArmedItem | null): Extract<ArmedItem, { kind: 'surface' }> | null {
  return armed?.kind === 'surface' ? armed : null;
}

/** Brush stamps closer than this fraction of the radius are skipped, so a slow drag stays light. */
export const STROKE_SPACING = 0.3;

export function appendStrokePoint(points: Vec2[], p: Vec3, radius: number): Vec2[] {
  const last = points[points.length - 1];
  if (last && Math.hypot(p.x - last.x, p.z - last.z) < radius * STROKE_SPACING) return points;
  return [...points, { x: Math.round(p.x), z: Math.round(p.z) }];
}

function terrainOff(ctx: ToolCtx): boolean {
  return !ctx.project.terrain.enabled;
}

function pointerStep(event: CreatePointerEvent, ctx: ToolCtx, state: PaintState): ToolStep<PaintState> {
  const armed = armedSurface(ctx.armed);
  const hit = groundHit(event, ctx);
  const erasing = event.shift || armed?.category === 'erase';
  const radius = ctx.brush.paintRadius;
  const category: SurfaceCategory | undefined = armed && armed.category !== 'erase' ? armed.category : undefined;
  const preview: ToolStep<PaintState>['preview'] = hit
    ? { kind: 'brush', center: hit, radius, style: erasing ? 'erase' : 'paint', category, tint: armed && armed.surface && 'surfaceId' in armed.surface ? surfaceTint(armed.surface.surfaceId, category) : undefined }
    : null;

  if (event.phase === 'hover') return emptyStep(state, { preview, cursor: 'crosshair' });
  if (event.phase === 'leave') return emptyStep(state);

  if (event.phase === 'down') {
    if (!isPrimaryButton(event)) return emptyStep(state);
    if (terrainOff(ctx)) {
      return emptyStep(state, { consumed: true, commands: [{ type: 'flash', message: 'The ground is switched off. Turn it on in the Track settings to paint.' }] });
    }
    if (!armed) {
      return emptyStep(state, { consumed: true, commands: [{ type: 'flash', message: 'Pick a surface in the Terrain tab of the palette first.' }] });
    }
    if (!hit) return emptyStep(state, { consumed: true });
    const surface = erasing ? null : armed.surface;
    const stroke = { points: appendStrokePoint([], hit, 0), surface, radius };
    return emptyStep(
      { stroke },
      {
        consumed: true,
        preview,
        cursor: 'crosshair',
        commands: [
          { type: 'begin', label: erasing ? 'Erase paint' : `Paint ${armed.label.toLowerCase()}` },
          { type: 'update', mutate: (base) => addTerrainStroke(base, { kind: 'paint', surface, radius, points: stroke.points }).project },
        ],
      },
    );
  }

  const current = state.stroke;
  if (!current) return emptyStep(state, { consumed: true });

  if (event.phase === 'move') {
    if (!hit) return emptyStep(state, { consumed: true, preview });
    const points = appendStrokePoint(current.points, hit, current.radius);
    if (points === current.points) return emptyStep(state, { consumed: true, preview, cursor: 'crosshair' });
    const next = { ...current, points };
    return emptyStep(
      { stroke: next },
      {
        consumed: true,
        preview,
        cursor: 'crosshair',
        commands: [{ type: 'update', mutate: (base) => addTerrainStroke(base, { kind: 'paint', surface: next.surface, radius: next.radius, points: next.points }).project }],
      },
    );
  }
  if (event.phase === 'up') return emptyStep({ stroke: null }, { consumed: true, preview, commands: [{ type: 'end' }] });
  if (event.phase === 'cancel') return emptyStep({ stroke: null }, { consumed: true, commands: [{ type: 'cancel' }] });
  return emptyStep(state, { consumed: true });
}

function keyStep(key: ToolKey, _ctx: ToolCtx, state: PaintState): ToolStep<PaintState> | null {
  if (key === 'Escape') {
    if (state.stroke) return emptyStep({ stroke: null }, { consumed: true, commands: [{ type: 'cancel' }] });
    return emptyStep(state, { consumed: true, commands: [{ type: 'setTool', tool: 'select' }] });
  }
  return null;
}

function hint(ctx: ToolCtx, _state: PaintState, _hover: unknown, mods: { shift: boolean }): HintSpec {
  if (!ctx.project.terrain.enabled) return { text: 'The ground is switched off, so there is nothing to paint. Turn it on in the Track settings.', chips: [], tone: 'warn' };
  const armed = armedSurface(ctx.armed);
  if (!armed) return { text: 'Pick a surface in the Terrain tab below, then drag over the ground to paint it.', chips: [], tone: 'warn' };
  if (mods.shift || armed.category === 'erase') return { text: 'Drag to erase paint and show the base ground again.', chips: [{ keys: '[ ]', label: 'brush size' }] };
  return {
    text: `Drag over the ground to paint ${armed.label.toLowerCase()}.`,
    chips: [{ keys: '[ ]', label: 'brush size' }, { keys: 'Shift', label: 'erase' }],
  };
}

export const paintTool: ToolModule<PaintState> = {
  id: 'paint',
  initial: () => ({ stroke: null }),
  pointer: pointerStep,
  key: keyStep,
  hint,
  leave: (_ctx, state) => emptyStep({ stroke: null }, { commands: state.stroke ? [{ type: 'cancel' }] : [] }),
};
