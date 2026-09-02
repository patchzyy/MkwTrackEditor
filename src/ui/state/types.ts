import type { TrackDocument } from '../../lib/track';

/** One undo/redo step: the whole track document plus the selection that produced it. */
export interface EditorSnapshot {
  track: TrackDocument | null;
  selectedId: string | null;
  selectedIds: string[];
}

export type InspectorSection = 'object' | 'track';
export type EditorModeStub = 'model' | 'visual' | 'kmp' | 'camera';
