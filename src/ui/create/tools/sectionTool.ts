/**
 * Sections tool (S). Hover the road to see where a split would go; click to split. Click a
 * section's label to select it; drag a section edge along the road.
 */
import { moveSectionStart, splitSection } from '../../../lib/create/ops';
import { MIN_SECTION_LENGTH } from '../../../lib/create/analyze';
import { sectionRanges } from '../../../lib/create/sections';
import { projectOntoRoad, roadLength, roadParamToDistance } from '../../../lib/create/spline';
import type { CreatePointerEvent, CreateProject, Road } from '../../../lib/create/types';
import { parseHandle } from '../overlay/handles';
import { groundHit, isPrimaryButton, roadUnder, sectionIdAt } from './pick';
import { emptyStep, type HintSpec, type HoverTarget, type ToolCtx, type ToolKey, type ToolModule, type ToolStep } from './types';

export interface SectionState {
  drag: null | { roadId: string; sectionId: string; startScreen: { x: number; y: number }; began: boolean };
}

const DRAG_THRESHOLD_PX = 3;

/** True when a split at `param` would leave a sliver (too close to an existing edge or the road's ends). */
export function splitBlocked(road: Road, param: number): boolean {
  const total = roadLength(road);
  const d = roadParamToDistance(road, param);
  if (!road.closed && (d < MIN_SECTION_LENGTH || total - d < MIN_SECTION_LENGTH)) return true;
  for (const range of sectionRanges(road)) {
    const edge = roadParamToDistance(road, range.from);
    let diff = Math.abs(edge - d);
    if (road.closed) diff = Math.min(diff, total - diff);
    if (diff < MIN_SECTION_LENGTH) return true;
  }
  return false;
}

function pointerStep(event: CreatePointerEvent, ctx: ToolCtx, state: SectionState): ToolStep<SectionState> {
  const handle = parseHandle(event.handleId);
  const hit = groundHit(event, ctx);

  if (event.phase === 'hover') {
    if (handle?.type === 'boundary') {
      return emptyStep(state, { hover: { kind: 'boundary', roadId: handle.roadId, sectionId: handle.sectionId }, cursor: 'col-resize' });
    }
    if (handle?.type === 'section') {
      return emptyStep(state, { hover: { kind: 'section', roadId: handle.roadId, sectionId: handle.sectionId }, cursor: 'pointer' });
    }
    const under = hit ? roadUnder(ctx.project, hit, 200) : null;
    if (under) {
      const param = under.projection.param;
      const blocked = splitBlocked(under.road, param);
      const sectionId = sectionIdAt(under.road, param);
      return emptyStep(state, {
        preview: { kind: 'split', roadId: under.road.id, param, blocked },
        hover: sectionId ? { kind: 'section', roadId: under.road.id, sectionId } : null,
        cursor: blocked ? 'pointer' : 'copy',
      });
    }
    return emptyStep(state, { cursor: 'default' });
  }
  if (event.phase === 'leave') return emptyStep(state);

  if (event.phase === 'down') {
    if (!isPrimaryButton(event)) return emptyStep(state);
    if (handle?.type === 'boundary') {
      return emptyStep(
        { drag: { roadId: handle.roadId, sectionId: handle.sectionId, startScreen: { ...event.screen }, began: false } },
        { consumed: true, commands: [{ type: 'select', selection: [{ kind: 'section', roadId: handle.roadId, sectionId: handle.sectionId }] }], cursor: 'col-resize' },
      );
    }
    if (handle?.type === 'section') {
      return emptyStep(state, { consumed: true, commands: [{ type: 'select', selection: [{ kind: 'section', roadId: handle.roadId, sectionId: handle.sectionId }] }] });
    }
    const under = hit ? roadUnder(ctx.project, hit, 200) : null;
    if (!under) return emptyStep(state, { consumed: true, commands: [{ type: 'select', selection: [] }] });
    const roadId = under.road.id;
    const param = under.projection.param;
    if (splitBlocked(under.road, param)) {
      const sectionId = sectionIdAt(under.road, param);
      return emptyStep(state, {
        consumed: true,
        commands: sectionId ? [{ type: 'select', selection: [{ kind: 'section', roadId, sectionId }] }, { type: 'flash', message: 'Too close to another edge to split here. Selected that section instead.' }] : [],
      });
    }
    const base = ctx.project;
    const result = splitSection(base, roadId, param);
    if (!result.id) return emptyStep(state, { consumed: true });
    return emptyStep(state, {
      consumed: true,
      commands: [
        { type: 'edit', label: 'Split road into sections', mutate: (p: CreateProject) => (p === base ? result.project : splitSection(p, roadId, param).project) },
        { type: 'select', selection: [{ kind: 'section', roadId, sectionId: result.id }] },
      ],
    });
  }

  const drag = state.drag;
  if (!drag) return emptyStep(state, { consumed: true });

  if (event.phase === 'move') {
    const dist = Math.hypot(event.screen.x - drag.startScreen.x, event.screen.y - drag.startScreen.y);
    if (!drag.began && dist < DRAG_THRESHOLD_PX) return emptyStep(state, { consumed: true, cursor: 'col-resize' });
    const road = ctx.project.roads.find((r) => r.id === drag.roadId);
    const proj = road && hit ? projectOntoRoad(road, hit) : null;
    const commands: ToolStep<SectionState>['commands'] = [];
    if (!drag.began) commands.push({ type: 'begin', label: 'Move section edge' });
    if (proj) {
      const { roadId, sectionId } = drag;
      const param = proj.param;
      commands.push({ type: 'update', mutate: (base) => moveSectionStart(base, roadId, sectionId, param) });
    }
    return emptyStep({ drag: { ...drag, began: true } }, { consumed: true, commands, cursor: 'col-resize', hover: { kind: 'boundary', roadId: drag.roadId, sectionId: drag.sectionId } });
  }
  if (event.phase === 'up') {
    return emptyStep({ drag: null }, { consumed: true, commands: drag.began ? [{ type: 'end' }] : [] });
  }
  if (event.phase === 'cancel') {
    return emptyStep({ drag: null }, { consumed: true, commands: drag.began ? [{ type: 'cancel' }] : [] });
  }
  return emptyStep(state, { consumed: true });
}

function keyStep(key: ToolKey, _ctx: ToolCtx, state: SectionState): ToolStep<SectionState> | null {
  if (key === 'Escape') {
    if (state.drag?.began) return emptyStep({ drag: null }, { consumed: true, commands: [{ type: 'cancel' }] });
    return emptyStep(state, { consumed: true, commands: [{ type: 'setTool', tool: 'select' }] });
  }
  return null;
}

function hint(ctx: ToolCtx, state: SectionState, hover: HoverTarget | null): HintSpec {
  if (ctx.project.roads.length === 0) return { text: 'Draw a road first (R), then split it into sections here.', chips: [], tone: 'warn' };
  if (state.drag?.began) return { text: 'Drag along the road to move this edge.', chips: [{ keys: 'Esc', label: 'cancel' }] };
  if (hover?.kind === 'boundary') return { text: 'Drag this edge along the road.', chips: [{ keys: 'Click', label: 'select the section' }] };
  return {
    text: 'Click the road to split it into sections. Click a section label to select it.',
    chips: [{ keys: 'Drag', label: 'move an edge' }],
  };
}

export const sectionTool: ToolModule<SectionState> = {
  id: 'sections',
  initial: () => ({ drag: null }),
  pointer: pointerStep,
  key: keyStep,
  hint,
  leave: (_ctx, state) => emptyStep({ drag: null }, { commands: state.drag?.began ? [{ type: 'cancel' }] : [] }),
};
