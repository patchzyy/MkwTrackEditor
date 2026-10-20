import type { NoclipBrresSummary } from '../../../lib/noclipBrres';
import type { CommonResourceArchive } from '../../../lib/objflow';

/** One entry of the editor's "every placeable object" list (the shell's `objectOptions`). */
export interface ObjectChoice {
  id: number;
  label: string;
  detail: string;
}

/**
 * What the panels need to draw object thumbnails (trees, signs, hazards) and to offer every
 * object in the game: the editor's shared object archive, its parsed model previews and the
 * object list. All of it comes from the shell's mode context.
 */
export interface CreateAssets {
  common: CommonResourceArchive | null;
  summaries: Record<string, NoclipBrresSummary>;
  objectOptions?: readonly ObjectChoice[];
}

export const NO_ASSETS: CreateAssets = { common: null, summaries: {} };
