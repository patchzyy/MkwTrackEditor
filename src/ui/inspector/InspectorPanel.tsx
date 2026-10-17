import { MousePointerSquareDashed, PanelRightClose, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { KmpEntity, Vec3 } from '../../lib/kmp';
import type { TrackDocument, validateTrack } from '../../lib/track';
import { IconButton } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { SegmentedControl } from '../components/SegmentedControl';
import { friendlySectionLabel, friendlyTrackAssetName, presentValidationIssue } from '../labels';
import type { ObjectOption } from '../objects/objectCatalog';
import type { EditorModeStub, InspectorSection } from '../state/types';
import type { PostEffectActions } from '../state/usePostEffectActions';
import { BatchSelectionPanel } from './BatchSelectionPanel';
import { DetailsSummaryBar } from './DetailsSummaryBar';
import { KmpOverview } from './KmpOverview';
import { PostEffectsPanel } from './PostEffectsPanel';
import type { PostEffectResources } from './postEffectResources';

const SECTION_OPTIONS = [
  { value: 'object' as const, label: 'Object' },
  { value: 'track' as const, label: 'Track' },
];

/** Right sidebar: object/track detail tabs, batch tools, validation and post-effect editors. */
export function InspectorPanel({
  inspectorOpen,
  onBeginResize,
  onResetSize,
  onClose,
  inspectorSection,
  onChangeInspectorSection,
  editorMode,
  modeContent,
  track,
  trackSummary,
  selected,
  selectedEntities,
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
  onResetSize?: () => void;
  onClose: () => void;
  inspectorSection: InspectorSection;
  onChangeInspectorSection: (section: InspectorSection) => void;
  editorMode: EditorModeStub;
  /** When set, the active editor mode replaces the object/track tabs with its own inspector. */
  modeContent?: ReactNode;
  track: TrackDocument | null;
  trackSummary: { entityCount: number; groupCount: number; routeCount: number } | null;
  selected: KmpEntity | null;
  selectedEntities: KmpEntity[];
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
  const selectionCount = selectedEntities.length;
  const hasModeContent = modeContent !== undefined && modeContent !== null;
  return (
    <aside className="inspector" aria-label="Inspector">
      {inspectorOpen && (
        <div
          className="sidebarResizeHandle sidebarResizeHandleLeft"
          onPointerDown={onBeginResize}
          onDoubleClick={onResetSize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize inspector"
          title="Drag to resize · double-click to reset"
        />
      )}
      <div className="panelHeader">
        <div>
          {/* A mode with its own inspector (Material mode's Details) names its own selection;
              the KMP selection underneath has nothing to do with what the panel shows. */}
          <h2>{hasModeContent ? 'Details' : 'Inspector'}</h2>
          {!hasModeContent && (
            <p className="panelSubtle">{selectionCount > 1 ? `${selectionCount} selected` : selected ? entityLabel(selected) : 'Nothing selected'}</p>
          )}
        </div>
        <IconButton size="sm" variant="ghost" icon={<PanelRightClose size={15} />} tooltip="Hide inspector" tooltipSide="left" onClick={onClose} />
      </div>
      <div className="rightSidebarPanels">
        <section className="sidebarPane detailsPane">
          <div className="paneBody">
            {hasModeContent ? (
              modeContent
            ) : (
              <>
                <SegmentedControl
                  className="inspectorSections"
                  label="Inspector sections"
                  value={inspectorSection}
                  options={SECTION_OPTIONS}
                  onChange={onChangeInspectorSection}
                />
                {inspectorSection === 'object' ? (
                  <>
                    {selected && selectedInspectorSection === 'object' && (
                      <DetailsSummaryBar
                        items={[
                          { label: 'Selection', value: entityLabel(selected) },
                          { label: 'Section', value: friendlySectionLabel(selected.section) },
                          { label: 'Index', value: `#${selected.index}` },
                          { label: 'Multi-Select', value: selectionCount > 1 ? `${selectionCount} active` : '' },
                          {
                            label: 'Path',
                            value: selected.routePoint
                              ? `Route ${selected.routePoint.routeIndex} · Node ${selected.routePoint.pointIndex}`
                              : selected.routeIndex !== undefined && selected.routeIndex !== 0xffff
                                ? `Route ${selected.routeIndex}`
                                : '',
                          },
                        ]}
                      />
                    )}
                    {selectionCount > 1 && (
                      <BatchSelectionPanel
                        count={selectionCount}
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
                      <p className="muted">Track settings are in the Track tab.</p>
                    ) : (
                      <EmptyState
                        icon={<MousePointerSquareDashed size={20} />}
                        title="Nothing selected"
                        description="Click something in the viewport — an object, route node, checkpoint, start point, camera, cannon point or respawn point — to edit it here."
                      />
                    )}
                    {selectionCount > 1 && (
                      <p className="muted">{selectionCount} selected. Transform edits apply the same difference to each; other property edits apply to selected records in the primary record's section.</p>
                    )}
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
                    {!track && (
                      <EmptyState
                        icon={<SlidersHorizontal size={20} />}
                        title="No track loaded"
                        description="Open a .szs track to see its settings, graph overview and validation report."
                      />
                    )}
                    {selectedInspector && selectedInspectorSection === 'track' && (
                      <>
                        <h2>Selection</h2>
                        {selectedInspector}
                      </>
                    )}
                    {track?.kmp && <KmpOverview kmp={track.kmp} onSelect={onSelectEntity} />}
                    {track && <PostEffectsPanel resources={postEffectResources} {...postEffectActions} />}
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
                        );
                      })}
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
              </>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
