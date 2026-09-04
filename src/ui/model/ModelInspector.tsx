import { Boxes, Copy, Eye, EyeOff, RotateCcw, Trash2 } from 'lucide-react';
import { MESH_SELECTION_GRANULARITIES, type MeshSelectionGranularity } from '../../lib/brresEditor';
import { DetailsSummaryBar } from '../inspector/DetailsSummaryBar';
import { VectorInputs } from '../inspector/fields/VectorInputs';
import type { OpenModelStudio } from '../studio/studioLaunch';
import type { ModelEditing } from './useModelEditing';

const GRANULARITY_LABELS: Record<MeshSelectionGranularity, string> = {
  component: 'Single piece',
  shape: 'Whole mesh',
  node: 'Whole bone',
};

const GRANULARITY_HINTS: Record<MeshSelectionGranularity, string> = {
  component: 'Clicking picks one connected piece — one tree out of a row of trees.',
  shape: 'Clicking picks the whole mesh the piece belongs to.',
  node: 'Clicking picks everything attached to the same bone.',
};

/**
 * Model mode's inspector. Edits the mesh (or placed object) the viewport last selected.
 *
 * The position, rotation and scale here are an *offset* from where the geometry already sits:
 * that is what the gizmo produces and what the exporter bakes, and it is the only reading that
 * makes sense for a mesh that has no transform of its own.
 */
export function ModelInspector({ editing, onOpenModelStudio }: { editing: ModelEditing; onOpenModelStudio?: OpenModelStudio }) {
  const placed = editing.activePlaced;
  const hasSelection = placed !== null || editing.active !== null;

  return (
    <div className="modelInspector">
      <h2>{placed ? placed.label ?? placed.sourcePath : editing.active ? editing.activeLabel : 'Nothing selected'}</h2>

      {!hasSelection && (
        <p className="panelSubtle">
          Click a piece of the track in the viewport, or a row in the list on the left, to edit it. Use <kbd>]</kbd> and{' '}
          <kbd>[</kbd> to widen or narrow what a click selects, and <kbd>F</kbd> to fly to it.
        </p>
      )}

      {!placed && (
        <section className="modelInspectorSection">
          <h3>What a click selects</h3>
          <div className="modelGranularity" role="group" aria-label="Selection size">
            {MESH_SELECTION_GRANULARITIES.map((value) => (
              <button
                key={value}
                type="button"
                className={editing.granularity === value ? 'modelGranularityOption active' : 'modelGranularityOption'}
                onClick={() => editing.setGranularity(value)}
              >
                {GRANULARITY_LABELS[value]}
              </button>
            ))}
          </div>
          <p className="panelSubtle">{GRANULARITY_HINTS[editing.granularity]}</p>
        </section>
      )}

      {hasSelection && (
        <>
          {editing.selection.length > 1 && (
            <p className="panelSubtle">
              {editing.selection.length} meshes selected. Hiding and deleting apply to all of them; the numbers below
              edit the last one.
            </p>
          )}

          {!placed && editing.active && (
            <DetailsSummaryBar
              items={[
                { label: 'Mesh', value: editing.meshByDrawOp.get(editing.active.drawOpIndex)?.shapeName ?? '—' },
                { label: 'Material', value: editing.meshByDrawOp.get(editing.active.drawOpIndex)?.materialName || '—' },
                { label: 'Bone', value: editing.meshList?.nodeNames.get(editing.active.nodeId) ?? `${editing.active.nodeId}` },
                {
                  label: 'Triangles',
                  value: (editing.meshByDrawOp.get(editing.active.drawOpIndex)?.triangleCount ?? 0).toLocaleString(),
                },
              ]}
            />
          )}

          {placed && (
            <DetailsSummaryBar
              items={[
                { label: 'Kind', value: placed.sourceShape ? 'Copy of track geometry' : 'Imported object' },
                { label: 'From', value: placed.sourcePath.split(/[\\/]/).pop() ?? placed.sourcePath },
              ]}
            />
          )}

          {editing.activeDeleted ? (
            <p className="modelInspectorNotice">
              This mesh is deleted and will not be in the exported track. Restore it to bring it back.
            </p>
          ) : (
            <section className="modelInspectorSection">
              <h3>Move</h3>
              <div className="propertyGrid">
                <label>
                  Position offset
                  <VectorInputs
                    value={editing.activeTransform.translation}
                    step={10}
                    onChange={(translation) => editing.setActiveTransform({ ...editing.activeTransform, translation })}
                  />
                </label>
                <label>
                  Rotation (degrees)
                  <VectorInputs
                    value={editing.activeTransform.rotation}
                    step={5}
                    onChange={(rotation) => editing.setActiveTransform({ ...editing.activeTransform, rotation })}
                  />
                </label>
                <label>
                  Scale
                  <VectorInputs
                    value={editing.activeTransform.scale}
                    step={0.1}
                    onChange={(scale) => editing.setActiveTransform({ ...editing.activeTransform, scale })}
                  />
                </label>
              </div>
            </section>
          )}

          <section className="modelInspectorSection">
            <h3>Actions</h3>
            <div className="modelInspectorActions">
              <button className="inlineAction" type="button" onClick={() => editing.setHidden(!editing.activeHidden)}>
                {editing.activeHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                {editing.activeHidden ? 'Show' : 'Hide'}
              </button>
              {!placed && (
                <button className="inlineAction" type="button" onClick={editing.duplicateSelection} disabled={!editing.active}>
                  <Copy size={14} /> Duplicate
                </button>
              )}
              {onOpenModelStudio && editing.active && (
                <button
                  className="inlineAction"
                  type="button"
                  title="Open this mesh's archive in the Model Studio, where its shaders and animations can be edited."
                  onClick={() => onOpenModelStudio({ trackArchivePath: editing.active!.archivePath })}
                >
                  <Boxes size={14} /> Open in Model Studio
                </button>
              )}
              <button className="inlineAction" type="button" onClick={editing.deleteSelection}>
                <Trash2 size={14} /> {placed ? 'Remove' : 'Delete'}
              </button>
              {!placed && (
                <button className="inlineAction" type="button" onClick={editing.resetSelection}>
                  <RotateCcw size={14} /> Restore
                </button>
              )}
            </div>
            <p className="panelSubtle">
              {placed
                ? 'Removing a placed object takes it straight back out of the track.'
                : 'Deleting a mesh drops its draw call from the exported model; Restore puts it back exactly as it was.'}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
