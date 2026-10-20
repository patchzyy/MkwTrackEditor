/**
 * The Create-mode session: the one object the Create UI (tools, panels, palette, overlay) talks
 * to. Implemented by `useCreateSession` (workstream E1); consumed by everything else in
 * `src/ui/create/` (workstream E2). Lead-owned contract — see docs/CREATE.md §6.
 */

import type { RoadSamples } from '../../../lib/create/spline';
import type {
  CompileStats,
  CompiledGeometry,
  CreateHit,
  CreateIssue,
  CreateKit,
  CreatePreviewModel,
  CreateProject,
  CreateRay,
  CreateSelection,
} from '../../../lib/create/types';

export interface CreateChecklist {
  world: ChecklistItem;
  roadLoop: ChecklistItem;
  startLine: ChecklistItem;
  itemBoxes: ChecklistItem;
  drivable: ChecklistItem;
  testDrive: ChecklistItem;
}

export interface ChecklistItem {
  state: 'done' | 'todo' | 'warning' | 'error';
  /** Short title ("Road loop"). */
  title: string;
  /** One sentence ("Your road is a closed loop, 4.2 km long."). */
  detail: string;
  /** What "Show me" selects and frames, when there is something to show. (E1 addition.) */
  target?: CreateSelection;
}

export interface CreateProjectSummary {
  id: string;
  name: string;
  themeId: string;
  updatedAt: number;
  /** Main-road outline, normalised 0..1 (x, z), for the home-screen SVG thumbnail. */
  outline: { x: number; z: number }[];
  closed: boolean;
}

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

export interface EditOptions {
  /** Undo-menu label ("Move road point", "Paint sand"). */
  label: string;
}

/** A hand-edit of a generated file made in another mode, detected on return to Create mode. */
export interface CreateConflict {
  /** Archive path (`course.kmp`, `course_model.brres`, ...). */
  path: string;
  /** Friendly description ("checkpoints and routes", "the course model"). */
  what: string;
}

export interface CreateSession {
  // ── Kit ──────────────────────────────────────────────────────────────────────────────────
  kit: CreateKit | null;
  kitError: string | null;
  /** Tries loading the kit again after `kitError`. (E1 addition.) */
  retryKit(): void;

  // ── Projects ─────────────────────────────────────────────────────────────────────────────
  /** The open design, or null on the home screen. */
  project: CreateProject | null;
  projects: CreateProjectSummary[];
  refreshProjects(): Promise<void>;
  newProject(templateId: string, options: { name: string; themeId: string; laps: number }): Promise<void>;
  openProject(id: string): Promise<void>;
  /** Back to the home screen (the design stays saved). */
  closeProject(): void;
  deleteProject(id: string): Promise<void>;
  duplicateProject(id: string): Promise<void>;
  importProjectFile(file: File): Promise<void>;
  /** Renames any saved design (the open one goes through the design history instead). (E1 addition.) */
  renameProject(id: string, name: string): Promise<void>;
  /** Downloads a design as a `.mkwcreate.json` file: the open one, or the saved design `id` (E1 addition). */
  exportProjectFile(id?: string): void;
  saveState: SaveState;

  // ── Editing ──────────────────────────────────────────────────────────────────────────────
  /** Apply a design change as one undo step. */
  edit(mutate: (project: CreateProject) => CreateProject, options: EditOptions): void;
  /**
   * Gestures (drags, brush strokes): `begin` once, `update` every frame (live preview, no
   * history), `end` commits one undo step; `cancel` restores the design from before `begin`.
   */
  beginGesture(options: EditOptions): void;
  updateGesture(mutate: (projectAtBegin: CreateProject) => CreateProject): void;
  endGesture(): void;
  cancelGesture(): void;
  gestureActive: boolean;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;

  // ── Selection ────────────────────────────────────────────────────────────────────────────
  selection: CreateSelection[];
  select(selection: CreateSelection[] | CreateSelection | null, options?: { additive?: boolean }): void;

  // ── Derived (always in sync with `project`) ──────────────────────────────────────────────
  /** Sampled spline per road id (for overlays and tools). */
  samples: Map<string, RoadSamples>;
  geometry: CompiledGeometry | null;
  issues: CreateIssue[];
  checklist: CreateChecklist | null;
  /** Ray against the design's collision (falls back to null; the viewport adds the ground plane). */
  raycast(ray: CreateRay): CreateHit | null;
  previewModels: CreatePreviewModel[];
  /** True while the full compile (KMP/KCL/minimap → track document) is pending or running. */
  compiling: boolean;
  compileError: string | null;
  /** Runs a pending compile right now and puts the result in the track document. (E1 addition.) */
  flushCompile(): void;
  /** Timings of the last compile, for the status line and the probes. (E1 addition.) */
  compileStats: { stats: CompileStats; geometryMillis: number; previewMillis: number; fullMillis: number } | null;

  // ── Track document bridge ────────────────────────────────────────────────────────────────
  conflicts: CreateConflict[];
  /** `keep` locks the hand-edited parts; `rebuild` overwrites them from the design. */
  resolveConflicts(choice: 'keep' | 'rebuild'): void;

  // ── Test drive ───────────────────────────────────────────────────────────────────────────
  /** Flushes the compile, then starts the playtest from the start line. */
  testDrive(): Promise<void>;
  canTestDrive: boolean;
  testDriveDisabledReason: string | null;
  /** The design was test-driven since its last change. */
  testDriven: boolean;

  // ── New-track wizard (E1 addition) ───────────────────────────────────────────────────────
  wizardOpen: boolean;
  openWizard(): void;
  closeWizard(): void;
}
