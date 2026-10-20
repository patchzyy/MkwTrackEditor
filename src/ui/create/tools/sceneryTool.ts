/**
 * Scenery tool (D). Click to place the armed object; drag to scatter a patch of them; Shift-drag
 * to erase objects under the brush.
 */
import { addProp, eraseProps, scatterProps } from '../../../lib/create/ops';
import { createRandom } from '../../../lib/create/math';
import type { CreatePointerEvent, CreateProject, Vec2, Vec3 } from '../../../lib/create/types';
import { groundHit, isPrimaryButton } from './pick';
import { emptyStep, type ArmedItem, type HintSpec, type ToolCtx, type ToolKey, type ToolModule, type ToolStep } from './types';

type Scenery = Extract<ArmedItem, { kind: 'scenery' }>;

export interface SceneryState {
  press: null | {
    startScreen: { x: number; y: number };
    startHit: Vec3;
    mode: 'pending' | 'scatter' | 'erase';
    centres: Vec2[];
    seed: number;
    radius: number;
    object: Scenery | null;
  };
}

const DRAG_THRESHOLD_PX = 6;

export function armedScenery(armed: ArmedItem | null): Scenery | null {
  return armed?.kind === 'scenery' ? armed : null;
}

function seedOf(p: Vec3): number {
  return (Math.imul(Math.round(p.x), 73856093) ^ Math.imul(Math.round(p.z), 19349663)) >>> 0;
}

/** One prop at `at`, with a random turn and a little size variation. */
export function placeOneProp(base: CreateProject, object: Scenery, at: Vec3): { project: CreateProject; id: string } {
  const rand = createRandom(seedOf(at));
  const scale = object.scale * (0.9 + rand() * 0.2);
  return addProp(base, {
    objectId: object.objectId,
    position: { x: Math.round(at.x), y: Math.round(at.y), z: Math.round(at.z) },
    rotation: { x: 0, y: Math.round(rand() * 360), z: 0 },
    scale: { x: scale, y: scale, z: scale },
    snapToGround: true,
  });
}

/** Applies every scatter / erase stamp of a gesture to the design as it was when the gesture began. */
export function applyStamps(base: CreateProject, mode: 'scatter' | 'erase', centres: readonly Vec2[], radius: number, object: Scenery | null, seed: number): CreateProject {
  let p = base;
  centres.forEach((c, i) => {
    if (mode === 'erase') p = eraseProps(p, c, radius);
    else if (object) p = scatterProps(p, { objectId: object.objectId, center: c, radius, spacing: object.spacing, seed: seed + i * 977, scale: object.scale }).project;
  });
  return p;
}

function farEnough(centres: readonly Vec2[], p: Vec3, minDistance: number): boolean {
  const last = centres[centres.length - 1];
  return !last || Math.hypot(p.x - last.x, p.z - last.z) >= minDistance;
}

function pointerStep(event: CreatePointerEvent, ctx: ToolCtx, state: SceneryState): ToolStep<SceneryState> {
  const hit = groundHit(event, ctx);
  const object = armedScenery(ctx.armed);
  const radius = ctx.brush.sceneryRadius;
  const erasing = event.shift;
  const preview: ToolStep<SceneryState>['preview'] = hit ? { kind: 'brush', center: hit, radius, style: erasing ? 'sceneryErase' : 'scenery' } : null;

  if (event.phase === 'hover') return emptyStep(state, { preview, cursor: object || erasing ? 'copy' : 'not-allowed' });
  if (event.phase === 'leave') return emptyStep(state);

  if (event.phase === 'down') {
    if (!isPrimaryButton(event)) return emptyStep(state);
    if (!hit) return emptyStep(state, { consumed: true });
    if (!object && !erasing) {
      return emptyStep(state, { consumed: true, commands: [{ type: 'flash', message: 'Pick an object in the Scenery tab of the palette first.' }] });
    }
    const press: NonNullable<SceneryState['press']> = {
      startScreen: { ...event.screen },
      startHit: hit,
      mode: erasing ? 'erase' : 'pending',
      centres: erasing ? [{ x: hit.x, z: hit.z }] : [],
      seed: seedOf(hit),
      radius,
      object,
    };
    const commands: ToolStep<SceneryState>['commands'] = [];
    if (erasing) {
      commands.push({ type: 'begin', label: 'Erase scenery' });
      commands.push({ type: 'update', mutate: (base) => applyStamps(base, 'erase', press.centres, radius, null, press.seed) });
    }
    return emptyStep({ press }, { consumed: true, preview, commands, cursor: 'copy' });
  }

  const press = state.press;
  if (!press) return emptyStep(state, { consumed: true });

  if (event.phase === 'move') {
    if (!hit) return emptyStep(state, { consumed: true, preview });
    if (press.mode === 'pending') {
      const dist = Math.hypot(event.screen.x - press.startScreen.x, event.screen.y - press.startScreen.y);
      if (dist < DRAG_THRESHOLD_PX) return emptyStep(state, { consumed: true, preview });
      const centres = [{ x: press.startHit.x, z: press.startHit.z }];
      const next = { ...press, mode: 'scatter' as const, centres };
      const spacing = press.object?.spacing ?? 600;
      if (farEnough(centres, hit, Math.max(spacing * 2, radius * 0.6))) centres.push({ x: hit.x, z: hit.z });
      return emptyStep({ press: next }, {
        consumed: true,
        preview,
        commands: [
          { type: 'begin', label: `Scatter ${press.object?.label.toLowerCase() ?? 'objects'}` },
          { type: 'update', mutate: (base) => applyStamps(base, 'scatter', next.centres, next.radius, next.object, next.seed) },
        ],
      });
    }
    const minStep = press.mode === 'erase' ? press.radius * 0.35 : Math.max((press.object?.spacing ?? 600) * 2, press.radius * 0.6);
    if (!farEnough(press.centres, hit, minStep)) return emptyStep(state, { consumed: true, preview });
    const centres = [...press.centres, { x: hit.x, z: hit.z }];
    const next = { ...press, centres };
    const mode = press.mode;
    return emptyStep({ press: next }, {
      consumed: true,
      preview,
      commands: [{ type: 'update', mutate: (base) => applyStamps(base, mode, centres, next.radius, next.object, next.seed) }],
    });
  }

  if (event.phase === 'up') {
    if (press.mode === 'pending') {
      // A plain click: one object where the cursor is.
      if (!press.object || !hit) return emptyStep({ press: null }, { consumed: true });
      const base = ctx.project;
      const object = press.object;
      const result = placeOneProp(base, object, hit);
      return emptyStep({ press: null }, {
        consumed: true,
        preview,
        commands: [
          { type: 'edit', label: `Place ${object.label.toLowerCase()}`, mutate: (p) => (p === base ? result.project : placeOneProp(p, object, hit).project) },
          { type: 'select', selection: [{ kind: 'prop', propId: result.id }] },
        ],
      });
    }
    return emptyStep({ press: null }, { consumed: true, preview, commands: [{ type: 'end' }] });
  }
  if (event.phase === 'cancel') {
    return emptyStep({ press: null }, { consumed: true, commands: press.mode === 'pending' ? [] : [{ type: 'cancel' }] });
  }
  return emptyStep(state, { consumed: true });
}

function keyStep(key: ToolKey, _ctx: ToolCtx, state: SceneryState): ToolStep<SceneryState> | null {
  if (key === 'Escape') {
    if (state.press && state.press.mode !== 'pending') return emptyStep({ press: null }, { consumed: true, commands: [{ type: 'cancel' }] });
    return emptyStep({ press: null }, { consumed: true, commands: [{ type: 'setTool', tool: 'select' }] });
  }
  return null;
}

function hint(ctx: ToolCtx): HintSpec {
  const object = armedScenery(ctx.armed);
  if (!object) return { text: 'Pick an object in the Scenery tab below, then click the ground to place it.', chips: [{ keys: 'Shift', label: 'drag to erase' }], tone: 'warn' };
  return {
    text: `Click to place ${object.label.toLowerCase()}. Drag to scatter a patch of them.`,
    chips: [{ keys: 'Shift', label: 'drag to erase' }, { keys: '[ ]', label: 'brush size' }],
  };
}

export const sceneryTool: ToolModule<SceneryState> = {
  id: 'scenery',
  initial: () => ({ press: null }),
  pointer: pointerStep,
  key: keyStep,
  hint,
  leave: (_ctx, state) => emptyStep({ press: null }, { commands: state.press && state.press.mode !== 'pending' ? [{ type: 'cancel' }] : [] }),
};
