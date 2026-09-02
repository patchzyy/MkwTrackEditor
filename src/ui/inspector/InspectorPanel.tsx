import { PanelRightClose, TriangleAlert } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { BrresEditorNode } from '../../lib/brresEditor';
import type { KmpEntity, Vec3 } from '../../lib/kmp';
import type { TrackDocument, validateTrack } from '../../lib/track';
import { friendlySectionLabel, friendlyTrackAssetName, presentValidationIssue } from '../labels';
import type { ObjectOption } from '../objects/objectCatalog';
import type { EditorModeStub, InspectorSection } from '../state/types';
import type { PostEffectActions } from '../state/usePostEffectActions';
import { BatchSelectionPanel } from './BatchSelectionPanel';
import { DetailsSummaryBar } from './DetailsSummaryBar';
import { KmpOverview } from './KmpOverview';
import { PostEffectsPanel } from './PostEffectsPanel';
import type { PostEffectResources } from './postEffectResources';

/** Right sidebar: object/track detail tabs, batch tools, validation and post-effect editors. */
export function InspectorPanel({
  inspectorOpen,
  onBeginResize,
  onClose,
  inspectorSection,
  onChangeInspectorSection,
  editorMode,
  track,
  trackSummary,
  selected,
  selectedEntities,
  selectedArchiveNode,
  selectedInspector,
  selectedInspectorSection,
  entityLabel,
  objectOptions,
  canBatchReplaceObjects,
  batchOffset,
  onChangeBatchOffset,
  onApplyBatchOffset,
  batchObjectId,
  onChangeBatchObjectId,
  onApplyBatchObjectId,
  onDeleteSelected,
  onSelectEntity,
  postEffectResources,
  postEffectActions,
  validation,
  validationCounts,
}: {
  inspectorOpen: boolean;
  onBeginResize: (event: ReactPointerEvent<HTMLElement>) => void;
  onClose: () => void;
  inspectorSection: InspectorSection;
  onChangeInspectorSection: (section: InspectorSection) => void;
  editorMode: EditorModeStub;
  track: TrackDocument | null;
  trackSummary: { entityCount: number; groupCount: number; routeCount: number } | null;
  selected: KmpEntity | null;
  selectedEntities: KmpEntity[];
  selectedArchiveNode: BrresEditorNode | null;
  selectedInspector: ReactNode;
  selectedInspectorSection: InspectorSection;
  entityLabel: (entity: KmpEntity) => string;
  objectOptions: ObjectOption[];
  canBatchReplaceObjects: boolean;
  batchOffset: Vec3;
  onChangeBatchOffset: (value: Vec3) => void;
  onApplyBatchOffset: () => void;
  batchObjectId: number | null;
  onChangeBatchObjectId: (value: number | null) => void;
  onApplyBatchObjectId: (objectId: number) => void;
  onDeleteSelected: () => void;
  onSelectEntity: (id: string, options?: { additive?: boolean }) => void;
  postEffectResources: PostEffectResources;
  postEffectActions: PostEffectActions;
  validation: ReturnType<typeof validateTrack>;
  validationCounts: { errorCount: number; warningCount: number };
}) {
  return (
  <aside className="inspector">
    {inspectorOpen && <div className="sidebarResizeHandle sidebarResizeHandleLeft" onPointerDown={onBeginResize} />}
    <div className="panelHeader">
      <h2>Scene</h2>
      <button className="iconButton" type="button" onClick={onClose} title="Hide inspector" aria-label="Hide inspector">
        <PanelRightClose size={16} />
      </button>
    </div>
    <div className="rightSidebarPanels">
      <section className="sidebarPane detailsPane">
        <div className="paneHeader">
          <h2>Details</h2>
        </div>
        <div className="paneBody">
          <div className="segmented inspectorSections" role="tablist" aria-label="Inspector sections">
            <button
              type="button"
              className={inspectorSection === 'object' ? 'active' : ''}
              onClick={() => onChangeInspectorSection('object')}
              role="tab"
              aria-selected={inspectorSection === 'object'}
            >
              Object Settings
            </button>
            <button
              type="button"
              className={inspectorSection === 'track' ? 'active' : ''}
              onClick={() => onChangeInspectorSection('track')}
              role="tab"
              aria-selected={inspectorSection === 'track'}
            >
              Track Settings
            </button>
          </div>
          {inspectorSection === 'object' ? (
            <>
              {selectedArchiveNode && editorMode === 'model' && (
                <DetailsSummaryBar
                  items={[
                    { label: 'Selection', value: selectedArchiveNode.name },
                    { label: 'Model', value: selectedArchiveNode.modelName },
                    { label: 'Archive', value: friendlyTrackAssetName(selectedArchiveNode.archivePath) },
                    { label: 'Node', value: `#${selectedArchiveNode.nodeId}` },
                  ]}
                />
              )}
              {selected && selectedInspectorSection === 'object' && (
                <DetailsSummaryBar
                  items={[
                    { label: 'Selection', value: entityLabel(selected) },
                    { label: 'Section', value: friendlySectionLabel(selected.section) },
                    { label: 'Index', value: `#${selected.index}` },
                    { label: 'Multi-Select', value: selectedEntities.length > 1 ? `${selectedEntities.length} active` : '' },
                    {
                      label: 'Path',
                      value: selected.routePoint ? `Route ${selected.routePoint.routeIndex} · Node ${selected.routePoint.pointIndex}` : selected.routeIndex !== undefined && selected.routeIndex !== 0xffff ? `Route ${selected.routeIndex}` : '',
                    },
                  ]}
                />
              )}
              {selectedEntities.length > 1 && (
                <BatchSelectionPanel
                  count={selectedEntities.length}
                  offset={batchOffset}
                  onChangeOffset={onChangeBatchOffset}
                  onApplyOffset={onApplyBatchOffset}
                  objectOptions={canBatchReplaceObjects ? objectOptions : []}
                  objectId={batchObjectId}
                  onChangeObjectId={onChangeBatchObjectId}
                  onApplyObjectId={batchObjectId !== null ? () => onApplyBatchObjectId(batchObjectId) : undefined}
                  onDelete={onDeleteSelected}
                />
              )}
              {selectedInspector && selectedInspectorSection === 'object' ? (
                <>
                  <h2>Selection</h2>
                  {selectedInspector}
                </>
              ) : selected?.section === 'STGI' ? (
                <p className="muted">Track settings are in the Track Settings section below.</p>
              ) : (
                <p className="muted">Select an object, route node, checkpoint, start point, camera, cannon point, or respawn point in the viewport.</p>
              )}
              {selectedEntities.length > 1 && <p className="muted">{selectedEntities.length} selected. Details are showing the primary selection, with batch tools above.</p>}
            </>
          ) : (
            <>
              {trackSummary && (
                <DetailsSummaryBar
                  items={[
                    { label: 'Entities', value: String(trackSummary.entityCount) },
                    { label: 'Path Groups', value: String(trackSummary.groupCount) },
                    { label: 'Routes', value: String(trackSummary.routeCount) },
                    { label: 'Archive Warnings', value: String(track?.warnings.length ?? 0) },
                  ]}
                />
              )}
              {selectedInspector && selectedInspectorSection === 'track' && (
                <>
                  <h2>Selection</h2>
                  {selectedInspector}
                </>
              )}
              {track?.kmp && <KmpOverview kmp={track.kmp} onSelect={onSelectEntity} />}
              {track && (
                <PostEffectsPanel resources={postEffectResources} {...postEffectActions} />
              )}
              <h2>Validation</h2>
              <div className="validationSummary">
                <span className={`validationBadge${validationCounts.errorCount > 0 ? ' error' : ''}`}>{validationCounts.errorCount} errors</span>
                <span className={`validationBadge${validationCounts.warningCount > 0 ? ' warning' : ''}`}>{validationCounts.warningCount} warnings</span>
              </div>
              <div className="validationList">
                {validation.length === 0 && <p className="muted">No validation issues for the loaded data.</p>}
                {validation.map((item, index) => {
                  const presented = presentValidationIssue(item.message);
                  return (
                  <div className={`validationIssue ${item.level}`} key={`${item.message}-${index}`}>
                    <TriangleAlert size={14} />
                    <div className="validationCopy">
                      <strong>{presented.summary}</strong>
                      {presented.detail && <span>{presented.detail}</span>}
                    </div>
                  </div>
                )})}
                {track?.warnings.map((warning, index) => (
                  <div className="validationIssue warning" key={`${warning}-${index}`}>
                    <TriangleAlert size={14} />
                    <div className="validationCopy">
                      <strong>Track load warning</strong>
                      <span>{warning}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  </aside>
  );
}
