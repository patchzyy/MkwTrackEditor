import type { EditorModeContext, ModeUi } from '../modes/types';

/**
 * KMP mode: track data editing (start points, routes, checkpoints, objects, areas, respawns,
 * cannons). Owns everything under `src/ui/kmp/`. The shell's default panels (place-assets rail,
 * object/track inspector) are the KMP-mode UI, so this hook only sets the viewport mode.
 */
export function useKmpMode(ctx: EditorModeContext): ModeUi {
  if (ctx.editorMode !== 'kmp') return {};
  return { viewportProps: { mode: 'kmp' } };
}
