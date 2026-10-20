/**
 * Test helpers for the tool modules: a fake session that runs `ToolCommand`s, a top-down pointer
 * event builder and a context factory. Not imported by app code.
 */
import { createSyntheticKit } from '../../../lib/create/__tests__/syntheticKit';
import { useDeterministicIds } from '../../../lib/create/ids';
import { createBlankProject, createProjectFromTemplate } from '../../../lib/create/templates';
import { sampleRoad } from '../../../lib/create/spline';
import type { CreateKit, CreatePointerEvent, CreateProject, CreateSelection, Vec3 } from '../../../lib/create/types';
import { TOOL_MODULES } from './registry';
import { DEFAULT_BRUSH, type ArmedItem, type LaneMode, type ToolCommand, type ToolCtx, type ToolId, type ToolStep } from './types';

export const kit: CreateKit = createSyntheticKit();

export function freshOval(): CreateProject {
  useDeterministicIds(1);
  return createProjectFromTemplate('oval', { name: 'T', themeId: 'test', laps: 3 }, kit);
}

export function freshBlank(): CreateProject {
  useDeterministicIds(1);
  return createBlankProject({ name: 'T', themeId: 'test', laps: 3 }, kit);
}

export interface FakeSession {
  project: CreateProject;
  selection: CreateSelection[];
  tool: ToolId | null;
  flashes: string[];
  history: Array<{ label: string; project: CreateProject }>;
  gestureBase: CreateProject | null;
  gestureLabel: string | null;
  gestureActive: boolean;
  gestures: number;
  cancelled: number;
}

export function fakeSession(project: CreateProject): FakeSession {
  return { project, selection: [], tool: null, flashes: [], history: [], gestureBase: null, gestureLabel: null, gestureActive: false, gestures: 0, cancelled: 0 };
}

/** Runs tool commands the way `useCreateTools` does. */
export function runCommands(session: FakeSession, commands: readonly ToolCommand[]): void {
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'edit':
        session.project = cmd.mutate(session.project);
        session.history.push({ label: cmd.label, project: session.project });
        break;
      case 'begin':
        session.gestureBase = session.project;
        session.gestureLabel = cmd.label;
        session.gestureActive = true;
        break;
      case 'update':
        if (session.gestureBase) session.project = cmd.mutate(session.gestureBase);
        break;
      case 'end':
        if (session.gestureActive) {
          session.history.push({ label: session.gestureLabel ?? '', project: session.project });
          session.gestures++;
        }
        session.gestureBase = null;
        session.gestureActive = false;
        break;
      case 'cancel':
        if (session.gestureBase) session.project = session.gestureBase;
        session.gestureBase = null;
        session.gestureActive = false;
        session.cancelled++;
        break;
      case 'select':
        session.selection = cmd.selection;
        break;
      case 'setTool':
        session.tool = cmd.tool;
        break;
      case 'flash':
        session.flashes.push(cmd.message);
        break;
    }
  }
}

/** A unit-per-pixel of 10 and a projector that maps world X/Z to screen with that scale. */
export const UNITS_PER_PIXEL = 10;
export const project2d = (p: Vec3) => ({ x: p.x / UNITS_PER_PIXEL + 500, y: p.z / UNITS_PER_PIXEL + 400 });
export const unproject2d = (s: { x: number; y: number }): { x: number; z: number } => ({ x: (s.x - 500) * UNITS_PER_PIXEL, z: (s.y - 400) * UNITS_PER_PIXEL });

export function makeCtx(session: FakeSession, extras: Partial<ToolCtx> & { armed?: ArmedItem | null; laneMode?: LaneMode } = {}): ToolCtx {
  const samples = new Map(session.project.roads.map((r) => [r.id, sampleRoad(r)]));
  return {
    project: session.project,
    kit,
    samples,
    selection: session.selection,
    armed: null,
    brush: { ...DEFAULT_BRUSH },
    laneMode: 'auto',
    groundPlaneY: session.project.terrain.baseHeight,
    unitsPerPixel: () => UNITS_PER_PIXEL,
    project2d,
    ...extras,
  };
}

export function ev(phase: CreatePointerEvent['phase'], world: { x: number; z: number; y?: number }, extra: Partial<CreatePointerEvent> = {}): CreatePointerEvent {
  const y = world.y ?? 0;
  const screen = project2d({ x: world.x, y, z: world.z });
  return {
    phase,
    button: phase === 'hover' || phase === 'leave' ? 0 : 0,
    shift: false,
    ctrl: false,
    alt: false,
    screen,
    ray: { origin: { x: world.x, y: y + 20000, z: world.z }, direction: { x: 0, y: -1, z: 0 } },
    hit: { position: { x: world.x, y, z: world.z }, normal: { x: 0, y: 1, z: 0 }, distance: 20000 },
    handleId: null,
    ...extra,
  };
}

/** Drives one tool through events against a fake session, rebuilding the context before each. */
export class ToolRunner {
  state: unknown;
  last: ToolStep<unknown> | null = null;
  readonly session: FakeSession;
  extras: Partial<ToolCtx> & { armed?: ArmedItem | null; laneMode?: LaneMode };
  constructor(readonly tool: ToolId, project: CreateProject, extras: Partial<ToolCtx> & { armed?: ArmedItem | null; laneMode?: LaneMode } = {}) {
    this.session = fakeSession(project);
    this.state = TOOL_MODULES[tool].initial();
    this.extras = extras;
  }
  ctx(): ToolCtx {
    return makeCtx(this.session, this.extras);
  }
  send(event: CreatePointerEvent): ToolStep<unknown> {
    const step = TOOL_MODULES[this.tool].pointer(event, this.ctx(), this.state);
    this.state = step.state;
    this.last = step;
    runCommands(this.session, step.commands);
    return step;
  }
  key(key: Parameters<(typeof TOOL_MODULES)['select']['key']>[0]): ToolStep<unknown> | null {
    const step = TOOL_MODULES[this.tool].key(key, this.ctx(), this.state);
    if (step) {
      this.state = step.state;
      this.last = step;
      runCommands(this.session, step.commands);
    }
    return step;
  }
  click(world: { x: number; z: number; y?: number }, extra: Partial<CreatePointerEvent> = {}): void {
    this.send(ev('hover', world, extra));
    this.send(ev('down', world, extra));
    this.send(ev('up', world, extra));
  }
  drag(from: { x: number; z: number; y?: number }, to: { x: number; z: number; y?: number }, steps = 5, extra: Partial<CreatePointerEvent> = {}): void {
    this.send(ev('down', from, extra));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.send(ev('move', { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t, y: (from.y ?? 0) + ((to.y ?? from.y ?? 0) - (from.y ?? 0)) * t }, extra));
    }
    this.send(ev('up', to, extra));
  }
}
