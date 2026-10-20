import { Boxes, Box, Copy, Eye, EyeOff, MousePointerClick, RotateCcw, Trash2 } from 'lucide-react';
import { MESH_SELECTION_GRANULARITIES, type MeshSelectionGranularity } from '../../lib/brresEditor';
import type { MenuSection } from '../components/Menu';
import { VectorInputs } from '../inspector/fields/VectorInputs';
import { InspectorHeader, type InspectorHeaderAction } from '../inspector/InspectorHeader';
import { DetailsCategory, DetailsEmpty, PropertyRow } from '../inspector/PropertySheet';
import type { OpenModelStudio } from '../studio/studioLaunch';
import type { ModelEditing } from './useModelEditing';

const GRANULARITY_LABELS: Record<MeshSelectionGranularity, string> = {
  component: 'Single piece',
  shape: 'Whole mesh',
  node: 'Whole bone',
};

const GRANULARITY_HINTS: Record<MeshSelectionGranularity, string> = {
  component: 'Clicking picks one connected piece, like one tree out of a row of trees.',
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
  const mesh = editing.active ? editing.meshByDrawOp.get(editing.active.drawOpIndex) : undefined;

  const granularity = !placed && (
    <DetailsCategory name="What a click selects" help={GRANULARITY_HINTS[editing.granularity]} defaultOpen={!hasSelection}>
      <div className="modelGranularity" role="group" aria-label="Selection size">
        {MESH_SELECTION_GRANULARITIES.map((value) => (
          <button
            key={value}
            type="button"
            className={editing.granularity === value ? 'modelGranularityOption active' : 'modelGranularityOption'}
            title={GRANULARITY_HINTS[value]}
            onClick={() => editing.setGranularity(value)}
          >
            {GRANULARITY_LABELS[value]}
          </button>
        ))}
      </div>
    </DetailsCategory>
  );

  if (!hasSelection) {
    return (
      <div className="modelInspector">
        <DetailsEmpty icon={<MousePointerClick size={22} />}>Click a piece of the track in the viewport, or a row on the left, to edit it</DetailsEmpty>
        {granularity}
      </div>
    );
  }

  const headerActions: InspectorHeaderAction[] = [
    {
      id: 'visibility',
      label: editing.activeHidden ? 'Show it again' : 'Hide it in the viewport',
      icon: editing.activeHidden ? <Eye size={14} /> : <EyeOff size={14} />,
      onClick: () => editing.setHidden(!editing.activeHidden),
    },
  ];
  if (!placed) {
    headerActions.push({ id: 'duplicate', label: 'Duplicate', icon: <Copy size={14} />, onClick: editing.duplicateSelection, disabled: !editing.active });
  }
  headerActions.push({
    id: 'delete',
    label: placed ? 'Remove it from the track' : 'Delete it from the exported track',
    icon: <Trash2 size={14} />,
    onClick: editing.deleteSelection,
    danger: true,
  });

  const menuItems: MenuSection['items'] = [];
  if (!placed) menuItems.push({ id: 'restore', label: 'Restore to how it was', icon: <RotateCcw size={14} />, onSelect: editing.resetSelection });
  if (onOpenModelStudio && editing.active) {
    menuItems.push({
      id: 'studio',
      label: 'Open in Model Studio',
      icon: <Boxes size={14} />,
      onSelect: () => onOpenModelStudio({ trackArchivePath: editing.active!.archivePath }),
    });
  }

  const title = placed ? placed.label ?? placed.sourcePath : editing.activeLabel;
  const multi = editing.selection.length > 1;

  return (
    <div className="modelInspector">
      <InspectorHeader
        media={<Box size={20} aria-hidden="true" />}
        title={title}
        typeName={placed ? (placed.sourceShape ? 'Copy of track geometry' : 'Imported object') : 'Track mesh'}
        description={
          (placed
            ? 'Removing a placed object takes it straight back out of the track.'
            : 'Deleting a mesh drops its draw call from the exported model. Restore puts it back exactly as it was.') +
          (multi ? ' Hide and delete apply to every selected mesh; the numbers edit the last one.' : '')
        }
        chips={[multi ? `${editing.selection.length} selected` : null]}
        actions={headerActions}
        sections={[{ id: 'model-actions', items: menuItems }]}
      />

      {editing.activeDeleted ? (
        <p className="modelInspectorNotice">This mesh is deleted and will not be in the exported track. Use Restore in the menu above to bring it back.</p>
      ) : (
        <DetailsCategory name="Transform">
          <div className="propertyGrid">
            <PropertyRow label="Position" wide help="How far it is moved from where it sits in the track.">
              <VectorInputs
                value={editing.activeTransform.translation}
                step={10}
                onChange={(translation) => editing.setActiveTransform({ ...editing.activeTransform, translation })}
              />
            </PropertyRow>
            <PropertyRow label="Rotation" wide help="In degrees, added on top of its current rotation.">
              <VectorInputs
                value={editing.activeTransform.rotation}
                step={5}
                onChange={(rotation) => editing.setActiveTransform({ ...editing.activeTransform, rotation })}
              />
            </PropertyRow>
            <PropertyRow label="Scale" wide help="1 keeps its current size.">
              <VectorInputs
                value={editing.activeTransform.scale}
                step={0.1}
                onChange={(scale) => editing.setActiveTransform({ ...editing.activeTransform, scale })}
              />
            </PropertyRow>
          </div>
        </DetailsCategory>
      )}

      <DetailsCategory name={placed ? 'Source' : 'Mesh'}>
        <div className="propertyGrid">
          {placed ? (
            <PropertyRow label="From">
              <span className="propValue">{placed.sourcePath.split(/[\\/]/).pop() ?? placed.sourcePath}</span>
            </PropertyRow>
          ) : (
            <>
              <PropertyRow label="Material">
                <span className="propValue">{mesh?.materialName || '-'}</span>
              </PropertyRow>
              <PropertyRow label="Bone">
                <span className="propValue">{editing.active ? editing.meshList?.nodeNames.get(editing.active.nodeId) ?? `${editing.active.nodeId}` : '-'}</span>
              </PropertyRow>
              <PropertyRow label="Triangles">
                <span className="propValue">{(mesh?.triangleCount ?? 0).toLocaleString()}</span>
              </PropertyRow>
            </>
          )}
        </div>
      </DetailsCategory>

      {granularity}
    </div>
  );
}
