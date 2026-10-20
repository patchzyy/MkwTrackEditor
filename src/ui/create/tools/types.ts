/**
 * Shared types of the Create-mode tool system.
 *
 * Every tool is a small pure state machine: `(event, ctx, state) -> step`. A step carries the next
 * tool state, whether the event was consumed, the design commands to run (edits, gestures,
 * selection changes...), and what to preview in the viewport. Nothing in `tools/*.ts` touches
 * React, the session or the DOM, so every tool is unit tested with plain objects; `useCreateTools`
 * is the one place that feeds events in and runs the commands.
 */
import type { RoadSamples } from '../../../lib/create/spline';
import type {
  CreateKit,
  CreatePointerEvent,
  CreateProject,
  CreateSelection,
  PieceKind,
  SurfaceCategory,
  SurfaceRef,
  Vec3,
} from '../../../lib/create/types';

export type ToolId = 'select' | 'road' | 'sections' | 'pieces' | 'paint' | 'sculpt' | 'scenery' | 'start';

export const TOOL_ORDER: readonly ToolId[] = ['select', 'road', 'sections', 'pieces', 'paint', 'sculpt', 'scenery', 'start'];

export const TOOL_KEYS: Record<ToolId, string> = {
  select: 'V',
  road: 'R',
  sections: 'S',
  pieces: 'P',
  paint: 'B',
  sculpt: 'H',
  scenery: 'D',
  start: 'G',
};

export const TOOL_LABELS: Record<ToolId, string> = {
  select: 'Select',
  road: 'Road',
  sections: 'Sections',
  pieces: 'Pieces',
  paint: 'Paint',
  sculpt: 'Sculpt',
  scenery: 'Scenery',
  start: 'Start',
};

export type SculptMode = 'raise' | 'lower' | 'smooth' | 'flatten';

/** What a palette tile arms. The matching tool turns on when a tile is armed. */
export type ArmedItem =
  | { kind: 'roadStyle'; styleId: string; label: string }
  | { kind: 'piece'; piece: PieceKind; objectId?: number; label: string }
  | { kind: 'surface'; surface: SurfaceRef | null; category: SurfaceCategory | 'erase'; label: string }
  | { kind: 'sculpt'; mode: SculptMode; label: string }
  | { kind: 'scenery'; objectId: number; label: string; scale: number; spacing: number };

export type LaneMode = 'auto' | 'left' | 'centre' | 'right' | 'full';
export const LANE_ORDER: readonly LaneMode[] = ['auto', 'left', 'centre', 'right', 'full'];
export type Lane = Exclude<LaneMode, 'auto'>;

export interface BrushSettings {
  paintRadius: number;
  sculptRadius: number;
  sculptStrength: number;
  sceneryRadius: number;
}

export const DEFAULT_BRUSH: BrushSettings = {
  paintRadius: 1800,
  sculptRadius: 2600,
  sculptStrength: 140,
  sceneryRadius: 1800,
};

export const BRUSH_LIMITS = { min: 300, max: 9000 } as const;

export interface Modifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export type Mutate = (project: CreateProject) => CreateProject;

/** A design change a tool wants made. The hook runs these against the session in order. */
export type ToolCommand =
  | { type: 'edit'; label: string; mutate: Mutate }
  | { type: 'begin'; label: string }
  | { type: 'update'; mutate: Mutate }
  | { type: 'end' }
  | { type: 'cancel' }
  | { type: 'select'; selection: CreateSelection[] }
  | { type: 'setTool'; tool: ToolId }
  | { type: 'flash'; message: string; tone?: 'warn' | 'ready' };

/** Everything a tool may read. Built by the hook for each event; plain data in tests. */
export interface ToolCtx {
  project: CreateProject;
  kit: CreateKit | null;
  samples: Map<string, RoadSamples>;
  selection: CreateSelection[];
  armed: ArmedItem | null;
  brush: BrushSettings;
  laneMode: LaneMode;
  groundPlaneY: number;
  /** World units covered by one CSS pixel around `point` (camera dependent). */
  unitsPerPixel(point: Vec3): number;
  /** World point to canvas CSS pixels (null behind the camera). */
  project2d(point: Vec3): { x: number; y: number } | null;
}

/** Things the viewport can highlight under the cursor. */
export type HoverTarget =
  | CreateSelection
  | { kind: 'close'; roadId: string }
  | { kind: 'boundary'; roadId: string; sectionId: string };

/**
 * What a tool wants drawn as a ghost. The overlay builder turns these into lines and triangles
 * (`buildCreateOverlay`), so the tools stay free of rendering.
 */
export type ToolPreview =
  | { kind: 'height'; position: Vec3; groundY: number; text: string }
  | { kind: 'rubber'; from: Vec3; to: Vec3; ghost: boolean }
  | { kind: 'insert'; roadId: string; param: number; position: Vec3 }
  | { kind: 'split'; roadId: string; param: number; blocked: boolean }
  | {
      kind: 'piece';
      roadId: string;
      param: number;
      lateral: number;
      width: number;
      length: number;
      pieceKind: PieceKind;
      lane: Lane;
    }
  | { kind: 'start'; roadId: string; param: number; blocked: boolean }
  | {
      kind: 'brush';
      center: Vec3;
      radius: number;
      style: 'paint' | 'erase' | 'raise' | 'lower' | 'smooth' | 'flatten' | 'scenery' | 'sceneryErase';
      category?: SurfaceCategory;
      /** Exact colour of the surface being painted (sand reads tan, snow white...). */
      tint?: [number, number, number];
    };

export interface ToolStep<S> {
  state: S;
  consumed: boolean;
  commands: ToolCommand[];
  preview: ToolPreview | null;
  hover: HoverTarget | null;
  cursor: string;
}

export type ToolKey = 'Enter' | 'Escape' | 'Backspace' | 'q' | 'e' | '[' | ']';

export interface HintSpec {
  /** What the tool does right now, one sentence. */
  text: string;
  /** Modifier / key chips shown after the sentence: `{ keys: 'Shift', label: 'raise' }`. */
  chips: Array<{ keys: string; label: string }>;
  tone?: 'info' | 'warn' | 'ready';
}

export interface ToolModule<S> {
  id: ToolId;
  initial(): S;
  pointer(event: CreatePointerEvent, ctx: ToolCtx, state: S): ToolStep<S>;
  key(key: ToolKey, ctx: ToolCtx, state: S): ToolStep<S> | null;
  hint(ctx: ToolCtx, state: S, hover: HoverTarget | null, mods: Modifiers): HintSpec;
  /** Called when the user switches away mid-gesture (cancels a drag, finishes a road...). */
  leave(ctx: ToolCtx, state: S): ToolStep<S>;
}

export function emptyStep<S>(state: S, partial: Partial<ToolStep<S>> = {}): ToolStep<S> {
  return { state, consumed: false, commands: [], preview: null, hover: null, cursor: 'default', ...partial };
}

/** A colour for a kit surface: by what it looks like (sand, snow, grass...), falling back to its category. */
export function surfaceTint(surfaceId: string | undefined, category: SurfaceCategory | undefined): [number, number, number] {
  const id = (surfaceId ?? '').toLowerCase();
  if (/sand|dirt|desert|pebble/.test(id)) return [0.9, 0.74, 0.4];
  if (/snow|ice/.test(id)) return [0.8, 0.93, 1];
  if (/mud|swamp/.test(id)) return [0.55, 0.38, 0.24];
  if (/space|nebula|glow/.test(id)) return [0.7, 0.5, 1];
  if (/lava/.test(id)) return [1, 0.42, 0.18];
  if (/water/.test(id)) return [0.3, 0.65, 1];
  return surfaceCategoryColor(category);
}

export function surfaceCategoryColor(category: SurfaceCategory | undefined): [number, number, number] {
  switch (category) {
    case 'ground':
      return [0.45, 0.85, 0.4];
    case 'offroad':
      return [0.78, 0.58, 0.34];
    case 'water':
      return [0.3, 0.65, 1.0];
    case 'lava':
      return [1.0, 0.42, 0.18];
    case 'ice':
      return [0.62, 0.92, 1.0];
    case 'road':
      return [0.75, 0.78, 0.85];
    case 'boost':
      return [1.0, 0.8, 0.2];
    default:
      return [0.85, 0.85, 0.85];
  }
}
