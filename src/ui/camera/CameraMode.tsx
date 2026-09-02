import type { EditorModeContext, ModeUi } from '../modes/types';

/**
 * Camera (CAME) mode. Owns everything under `src/ui/camera/`.
 * The renderer side (gizmos, view-point handles, preview playback) is already implemented in
 * the viewport; see `docs/viewport-api.md`.
 */
export function useCameraMode(ctx: EditorModeContext): ModeUi {
  const active = ctx.editorMode === 'camera';
  if (!active) return {};
  return {
    viewportProps: { mode: 'camera' },
    leftPanel: (
      <aside className="placeAssetsPanel">
        <div className="panelHeader placeAssetsHeader">
          <div>
            <h2>Cameras</h2>
            <p className="panelSubtle">Camera tools are not wired yet.</p>
          </div>
        </div>
      </aside>
    ),
  };
}
