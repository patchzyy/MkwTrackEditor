import type { EditorModeContext, ModeUi } from '../modes/types';

/**
 * Visual mode: materials, textures, animations, post effects, lighting. Owns everything under
 * `src/ui/visual/`. KMP overlays are hidden while active.
 */
export function useVisualMode(ctx: EditorModeContext): ModeUi {
  const active = ctx.editorMode === 'visual';
  if (!active) return {};
  return {
    viewportProps: { mode: 'visual', showKmpEditorOverlay: false },
    leftPanel: (
      <aside className="placeAssetsPanel">
        <div className="panelHeader placeAssetsHeader">
          <div>
            <h2>Visual</h2>
            <p className="panelSubtle">Visual tools are not wired yet.</p>
          </div>
        </div>
      </aside>
    ),
  };
}
