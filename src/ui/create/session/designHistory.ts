/**
 * Undo/redo for the design. Pure: every function takes a history and returns the next one.
 *
 * A history entry is a whole `CreateProject` snapshot (plain JSON, structurally shared by the ops,
 * so a snapshot costs only what changed). Drags and brush strokes are *gestures*: `beginGesture`
 * remembers the design as it was, `updateGesture` swaps the visible design without touching the
 * stacks, and `endGesture` commits the whole drag as one undo step.
 */
import type { CreateProject } from '../../../lib/create/types';

export const DESIGN_HISTORY_LIMIT = 200;

export interface HistoryEntry {
  /** The design on the far side of the step. */
  project: CreateProject;
  /** What the step did ("Move road point"). */
  label: string;
}

export interface DesignGesture {
  /** The design when the gesture began. `updateGesture` always derives from this. */
  base: CreateProject;
  label: string;
}

export interface DesignHistory {
  present: CreateProject;
  /** `past.at(-1)` is what Undo restores; its label names the step Undo will take back. */
  past: HistoryEntry[];
  /** `future.at(-1)` is what Redo restores; its label names the step Redo will bring back. */
  future: HistoryEntry[];
  gesture: DesignGesture | null;
}

export function createDesignHistory(project: CreateProject): DesignHistory {
  return { present: project, past: [], future: [], gesture: null };
}

function pushPast(past: HistoryEntry[], entry: HistoryEntry, limit: number): HistoryEntry[] {
  const next = [...past, entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Replaces the design without recording anything (loading, or bookkeeping that is not an edit). */
export function replacePresent(history: DesignHistory, project: CreateProject): DesignHistory {
  return { ...history, present: project };
}

/** One undoable edit. Ends a running gesture first, and ignores a change that changed nothing. */
export function commitEdit(history: DesignHistory, next: CreateProject, label: string, limit = DESIGN_HISTORY_LIMIT): DesignHistory {
  const settled = history.gesture ? endGesture(history, limit) : history;
  if (next === settled.present) return settled;
  return {
    present: next,
    past: pushPast(settled.past, { project: settled.present, label }, limit),
    future: [],
    gesture: null,
  };
}

export function beginGesture(history: DesignHistory, label: string, limit = DESIGN_HISTORY_LIMIT): DesignHistory {
  const settled = history.gesture ? endGesture(history, limit) : history;
  return { ...settled, gesture: { base: settled.present, label } };
}

/** Live preview of a gesture: no history entry, the present is derived from the gesture's base. */
export function updateGesture(history: DesignHistory, mutate: (projectAtBegin: CreateProject) => CreateProject): DesignHistory {
  if (!history.gesture) return history;
  const next = mutate(history.gesture.base);
  return next === history.present ? history : { ...history, present: next };
}

/** Commits the gesture as one step (nothing is recorded when it changed nothing). */
export function endGesture(history: DesignHistory, limit = DESIGN_HISTORY_LIMIT): DesignHistory {
  const gesture = history.gesture;
  if (!gesture) return history;
  if (history.present === gesture.base) return { ...history, gesture: null };
  return {
    present: history.present,
    past: pushPast(history.past, { project: gesture.base, label: gesture.label }, limit),
    future: [],
    gesture: null,
  };
}

/** Drops the gesture and restores the design from before `beginGesture`. */
export function cancelGesture(history: DesignHistory): DesignHistory {
  const gesture = history.gesture;
  if (!gesture) return history;
  return { ...history, present: gesture.base, gesture: null };
}

export function canUndo(history: DesignHistory): boolean {
  return history.past.length > 0 || (history.gesture !== null && history.present !== history.gesture.base);
}

export function canRedo(history: DesignHistory): boolean {
  return history.future.length > 0;
}

export function undoLabel(history: DesignHistory): string | null {
  if (history.gesture && history.present !== history.gesture.base) return history.gesture.label;
  return history.past.at(-1)?.label ?? null;
}

export function redoLabel(history: DesignHistory): string | null {
  return history.future.at(-1)?.label ?? null;
}

export function undo(history: DesignHistory, limit = DESIGN_HISTORY_LIMIT): DesignHistory {
  const settled = endGesture(history, limit);
  const entry = settled.past.at(-1);
  if (!entry) return settled;
  return {
    present: entry.project,
    past: settled.past.slice(0, -1),
    future: [...settled.future, { project: settled.present, label: entry.label }].slice(-limit),
    gesture: null,
  };
}

export function redo(history: DesignHistory, limit = DESIGN_HISTORY_LIMIT): DesignHistory {
  const settled = endGesture(history, limit);
  const entry = settled.future.at(-1);
  if (!entry) return settled;
  return {
    present: entry.project,
    past: pushPast(settled.past, { project: settled.present, label: entry.label }, limit),
    future: settled.future.slice(0, -1),
    gesture: null,
  };
}
