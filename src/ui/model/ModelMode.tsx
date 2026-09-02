import { useMemo } from 'react';
import { toSceneNodeViewportTransformSelection, toSceneNodeViewportTransformSelections } from '../../lib/brresRenderAdapter';
import type { EditorModeContext, ModeUi } from '../modes/types';

/**
 * Model mode: pick and edit course geometry (meshes, components, bones) and import objects as
 * course geometry. Owns everything under `src/ui/model/`.
 *
 * Today this only carries over the legacy bone ("archive node") transform selection. The mesh
 * picking/editing renderer API is already available; see `docs/viewport-api.md`.
 */
export function useModelMode(ctx: EditorModeContext): ModeUi {
  const active = ctx.editorMode === 'model';
  const { projectState, selection } = ctx;
  const selectedArchiveNode = useMemo(
    () => projectState?.archiveNodes.find((node) => node.id === selection.selectedId) ?? null,
    [projectState, selection.selectedId],
  );
  const transformSelection = useMemo(
    () => (active && selectedArchiveNode ? toSceneNodeViewportTransformSelection(selectedArchiveNode) : null),
    [active, selectedArchiveNode],
  );
  const transformSelections = useMemo(
    () => (active ? toSceneNodeViewportTransformSelections(projectState?.sceneNodes ?? []) : []),
    [active, projectState],
  );
  if (!active) return {};
  return {
    viewportProps: {
      mode: 'model',
      showKmpEditorOverlay: false,
      transformSelection,
      transformSelections,
    },
  };
}
