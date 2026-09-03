import { useMemo, useState } from 'react';
import type { EditorModeContext, ModeUi } from '../modes/types';
import { ModelInspector } from './ModelInspector';
import { ModelOutliner } from './ModelOutliner';
import { collectPlaceableModels, PlaceObjectPanel } from './PlaceObjectPanel';
import { useModelEditing, type ModelEditing } from './useModelEditing';
import './model.css';

/**
 * Model mode: pick and edit the track's own geometry, and place object models into it as
 * scenery. Owns everything under `src/ui/model/`.
 *
 * The viewport does the picking and the gizmos; this hook owns the selection, turns the
 * viewport's callbacks into document edits, and supplies the outliner and inspector. Edits live
 * on the track document, so undo/redo and export get them for free.
 */
export interface ModelModeUi extends ModeUi {
  /**
   * Places a model as course scenery. Available in every mode so the content browser can drop
   * a custom model into the viewport without first switching to Model mode.
   */
  placeModelAsset: ModelEditing['placeObject'];
}

export function useModelMode(ctx: EditorModeContext): ModelModeUi {
  const active = ctx.editorMode === 'model';
  const editing = useModelEditing(ctx, active);
  const [picking, setPicking] = useState(false);

  const placeableAssets = useMemo(
    () => (active && picking ? collectPlaceableModels(ctx.commonArchive) : []),
    [active, ctx.commonArchive, picking],
  );

  if (!active) return { placeModelAsset: editing.placeObject };

  return {
    placeModelAsset: editing.placeObject,
    viewportProps: {
      mode: 'model',
      showKmpEditorOverlay: false,
      meshGranularity: editing.granularity,
      meshEdits: ctx.track?.meshEdits ?? [],
      importedMeshes: editing.placedObjects,
      resolveImportedMeshSource: editing.resolveImportSource,
      meshSelection: editing.selection,
      onSelectMesh: (target, options) => editing.selectMeshes(options?.targets ?? (target ? [target] : []), false),
      onTransformMesh: (target, transform) => editing.setMeshTransform(target, transform),
      onChangeMeshGranularity: editing.setGranularity,
      // Model mode edits meshes, not MDL0 bone nodes; the legacy node gizmos would fight the
      // mesh gizmo for the same click.
      transformSelection: null,
      transformSelections: [],
    },
    leftPanel: <ModelOutliner editing={editing} onPlaceObject={() => setPicking(true)} />,
    inspector: <ModelInspector editing={editing} />,
    topRightOverlay: picking ? (
      <PlaceObjectPanel
        assets={placeableAssets}
        onClose={() => setPicking(false)}
        onPlace={(asset) => {
          editing.placeObject({ sourcePath: asset.sourcePath, label: asset.label, data: asset.data });
          setPicking(false);
        }}
      />
    ) : null,
  };
}
