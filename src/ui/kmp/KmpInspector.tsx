import { useState, type ReactNode } from 'react';
import {
  Box,
  Camera,
  Copy,
  Crosshair,
  Flag,
  ListOrdered,
  MoveVertical,
  Package,
  Repeat,
  Rocket,
  Route,
  Settings2,
  Trash2,
  TriangleAlert,
  Wand2,
} from 'lucide-react';
import type { KmpEntity } from '../../lib/kmp';
import type { NoclipBrresSummary } from '../../lib/noclipBrres';
import type { CommonResourceArchive } from '../../lib/objflow';
import type { TrackIssue } from '../../lib/kmpValidation';
import type { MenuItem, MenuSection } from '../components/Menu';
import { ObjectThumbnail } from '../contentBrowser/ObjectThumbnail';
import type { ObjectOption } from '../objects/objectCatalog';
import { ObjectIdSelect } from '../inspector/fields/ObjectIdSelect';
import { InspectorActionsHost } from '../inspector/InspectorActionsContext';
import { InspectorActionsMenu, InspectorHeader } from '../inspector/InspectorHeader';
import { describeKmpRecord } from '../inspector/recordSummary';
import '../inspector/inspector.css';
import type { KmpSelectionContext } from './kmpSelectionContext';

export interface KmpQuickFix {
  label: string;
  run: () => void;
}

export interface KmpInspectorProps {
  /** The primary selected record, or null when nothing is selected. */
  entity: KmpEntity | null;
  /** Every selected record, for the batch tools. */
  entities: KmpEntity[];
  entityLabel: (entity: KmpEntity) => string;
  /** The shared per-record property inspector, already bound to the edit actions. */
  selectedInspector: ReactNode;
  context: KmpSelectionContext;
  issues: readonly TrackIssue[];
  /** Warnings raised while the archive was loaded; shown next to the validation list. */
  loadWarnings: readonly string[];
  objectOptions: ObjectOption[];
  /** True when every selected record is an object, so a batch type swap makes sense. */
  canBatchReplaceObjects: boolean;
  hasCollision: boolean;
  /** Supplies the object thumbnail in the header. Optional so the panel works without game data. */
  commonArchive?: CommonResourceArchive | null;
  commonBrresSummaries?: Record<string, NoclipBrresSummary>;

  onSelectEntity: (entityId: string) => void;
  onSelectMatchingObjects: () => void;
  onReplaceObjectTypes: (objectId: number) => void;
  onDeleteSelection: () => void;
  onDuplicateSelection: () => void;
  onSnapToCollision: () => void;

  // Path graph tools -----------------------------------------------------------
  onInsertPointBefore: () => void;
  onInsertPointAfter: () => void;
  onDeletePoint: () => void;
  onSplitGroup: () => void;
  onMergeGroup: () => void;
  onReverseGroup: () => void;
  onReversePath: () => void;
  onDeleteGroup: () => void;
  onChangeGroupLinks: (side: 'prev' | 'next', links: number[]) => void;

  // Checkpoint tools -----------------------------------------------------------
  onSetCheckpointKind: (kind: 'lap' | 'key' | 'normal') => void;
  onAssignNearestRespawn: () => void;
  onAssignAllRespawns: () => void;
  onCreateRespawnHere: () => void;
  onRenumberKeyCheckpoints: () => void;

  // Route tools ----------------------------------------------------------------
  onAppendRoutePoint: () => void;
  onReverseRoute: () => void;

  /** Maps an issue to its one-click repair, when there is one. */
  quickFix: (issue: TrackIssue) => KmpQuickFix | null;
  onFixAll: () => void;
}

/**
 * Inspector body for KMP mode.
 *
 * One header names the selection and holds every rare or destructive command in a single "⋯"
 * menu — including the ones the property sheet registers from inside. Below it come only the
 * tools that apply to what is selected, then the property sheet itself, then the export check.
 */
export function KmpInspector(props: KmpInspectorProps) {
  const { entity, entities, context, issues, loadWarnings } = props;
  const errorCount = issues.filter((issue) => issue.level === 'error').length;
  const warningCount = issues.filter((issue) => issue.level === 'warning').length + loadWarnings.length;

  return (
    <div className="kmpInspector">
      <InspectorActionsHost
        render={(recordSections) => (
          <>
            <SelectionHeader {...props} recordSections={recordSections} />
            {entities.length > 1 && <BatchTools {...props} />}
            {context.path && <PathTools {...props} path={context.path} />}
            {context.checkpoint && <CheckpointTools {...props} checkpoint={context.checkpoint} />}
            {context.route && <RouteTools {...props} route={context.route} />}
            {entity ? (
              <section className="kmpToolGroup">{props.selectedInspector}</section>
            ) : (
              <p className="muted">Pick something in the track list or the viewport to edit it.</p>
            )}
          </>
        )}
      />

      <section className="kmpToolGroup kmpValidation">
        <h3>Before you export</h3>
        <div className="validationSummary">
          <span className={`validationBadge${errorCount > 0 ? ' error' : ''}`}>{errorCount} errors</span>
          <span className={`validationBadge${warningCount > 0 ? ' warning' : ''}`}>{warningCount} warnings</span>
        </div>
        <button type="button" className="inlineAction" disabled={!issues.some((issue) => props.quickFix(issue))} onClick={props.onFixAll}>
          Fix all repairable issues
        </button>
        <p className="muted">Applies available fixes in one undo step. Missing files and layout issues need manual edits. Review any generated routes before exporting.</p>
        <div className="validationList">
          {issues.length === 0 && loadWarnings.length === 0 && <p className="muted">Nothing to fix — this track is ready to export.</p>}
          {issues.map((issue, index) => {
            const fix = props.quickFix(issue);
            return (
              <div className={`validationIssue ${issue.level}${issue.entityId ? ' isSelectable' : ''}`} key={`${issue.code}-${issue.entityId ?? ''}-${index}`}>
                <TriangleAlert size={14} />
                <div className="validationCopy">
                  {issue.entityId ? (
                    <button type="button" className="kmpIssueLink" onClick={() => props.onSelectEntity(issue.entityId!)}>
                      {issue.message}
                    </button>
                  ) : (
                    <strong>{issue.message}</strong>
                  )}
                  {fix && (
                    <button type="button" className="inlineAction kmpIssueFix" onClick={fix.run}>
                      {fix.label}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {loadWarnings.map((warning, index) => (
            <div className="validationIssue warning" key={`load-${index}`}>
              <TriangleAlert size={14} />
              <div className="validationCopy">
                <strong>{warning}</strong>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** A small square for the selection: the real object render when there is one, an icon otherwise. */
function SelectionMedia({ entity, commonArchive, commonBrresSummaries }: Pick<KmpInspectorProps, 'entity' | 'commonArchive' | 'commonBrresSummaries'>) {
  if (!entity) return null;
  if (entity.section === 'GOBJ' && entity.objectId !== undefined && commonArchive?.objFlow) {
    const flow = commonArchive.objFlow.byId.get(entity.objectId);
    if (flow) return <ObjectThumbnail object={flow} common={commonArchive} summaries={commonBrresSummaries ?? {}} />;
  }
  const icon = recordIcon(entity.section);
  return (
    <div className="thumbnail kmp" data-state="available">
      {icon}
    </div>
  );
}

function recordIcon(section: string) {
  switch (section) {
    case 'GOBJ':
      return <Package size={20} aria-hidden="true" />;
    case 'CAME':
      return <Camera size={20} aria-hidden="true" />;
    case 'AREA':
      return <Box size={20} aria-hidden="true" />;
    case 'JGPT':
      return <Crosshair size={20} aria-hidden="true" />;
    case 'CNPT':
      return <Rocket size={20} aria-hidden="true" />;
    case 'ENPT':
    case 'ITPT':
    case 'POTI':
      return <Route size={20} aria-hidden="true" />;
    case 'STGI':
      return <Settings2 size={20} aria-hidden="true" />;
    default:
      return <Flag size={20} aria-hidden="true" />;
  }
}

/** Name, type and the single actions menu. `recordSections` comes from the property sheet. */
function SelectionHeader({
  entity,
  entities,
  entityLabel,
  hasCollision,
  commonArchive,
  commonBrresSummaries,
  onSnapToCollision,
  onDuplicateSelection,
  onDeleteSelection,
  onSelectMatchingObjects,
  recordSections,
}: KmpInspectorProps & { recordSections: MenuSection[] }) {
  const multiple = entities.length > 1;
  const summary = entity ? describeKmpRecord(entity) : null;
  // A track has exactly one settings record; copying or deleting it makes no sense.
  const unique = summary?.kind === 'stage';
  const title = entity ? entityLabel(entity) : 'Nothing selected';
  const selectionItems: MenuItem[] = [];
  if (entity && !unique) {
    selectionItems.push({
      id: 'snap',
      label: 'Drop onto the track surface',
      icon: <MoveVertical size={14} />,
      disabled: !hasCollision,
      disabledReason: 'This track has no collision data',
      onSelect: onSnapToCollision,
    });
  }
  const sections: MenuSection[] = [];
  if (selectionItems.length > 0) sections.push({ id: 'selection', title: multiple ? `${entities.length} selected` : undefined, items: selectionItems });
  sections.push(...recordSections);
  if (entity && !unique && !recordSections.some((section) => section.items.some((item) => item.id === 'delete'))) {
    sections.push({ id: 'kmp-danger', items: [{ id: 'delete', label: 'Delete', icon: <Trash2 size={14} />, danger: true, onSelect: onDeleteSelection }] });
  }

  return (
    <section className="kmpToolGroup kmpSelectionHeader">
      {multiple && <h3>{entities.length} selected</h3>}
      <InspectorHeader
        media={<SelectionMedia entity={entity} commonArchive={commonArchive} commonBrresSummaries={commonBrresSummaries} />}
        title={title}
        typeName={summary && !title.toLowerCase().includes(summary.typeName.toLowerCase()) ? summary.typeName : undefined}
        description={multiple ? `${entities.length} records selected. Position, rotation and size changes apply the same difference to each. Other property edits apply to selected records in the primary record's section.` : summary?.description}
        primary={entity && !unique ? { label: 'Duplicate', icon: <Copy size={14} />, onClick: onDuplicateSelection } : undefined}
        sections={sections}
      />
      {entity?.section === 'GOBJ' && (
        <div className="kmpButtonRow">
          <button type="button" className="button" onClick={onSelectMatchingObjects}>
            Select all with same object ID
          </button>
        </div>
      )}
    </section>
  );
}

function BatchTools({ entities, objectOptions, canBatchReplaceObjects, onReplaceObjectTypes, onDeleteSelection, onDuplicateSelection, onSnapToCollision, hasCollision }: KmpInspectorProps) {
  const [objectId, setObjectId] = useState<number | null>(null);
  const effectiveObjectId = objectId ?? entities.find((candidate) => candidate.objectId !== undefined)?.objectId ?? null;
  return (
    <section className="kmpToolGroup">
      <div className="kmpButtonRow">
        <button type="button" className="button" onClick={onDuplicateSelection}>Duplicate selected</button>
        <button type="button" className="button" onClick={onDeleteSelection}>Delete selected</button>
        <button type="button" className="button" disabled={!hasCollision} onClick={onSnapToCollision}>Drop selected onto track</button>
      </div>
      {canBatchReplaceObjects && effectiveObjectId !== null && (
        <>
          <h3>Change them all to</h3>
          <ObjectIdSelect value={effectiveObjectId} options={objectOptions} onChange={setObjectId} />
          <div className="kmpButtonRow">
            <button type="button" className="button" onClick={() => onReplaceObjectTypes(effectiveObjectId)}>
              Replace {entities.length} objects
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Path editing for the selected enemy / item / checkpoint point. The three edits an author
 * makes constantly stay as buttons; reversing and deleting whole groups move into the menu.
 */
function PathTools({
  path,
  onInsertPointBefore,
  onInsertPointAfter,
  onDeletePoint,
  onSplitGroup,
  onMergeGroup,
  onReverseGroup,
  onReversePath,
  onDeleteGroup,
  onChangeGroupLinks,
}: KmpInspectorProps & { path: NonNullable<KmpSelectionContext['path']> }) {
  return (
    <section className="kmpToolGroup">
      <h3>
        {capitalize(path.pathLabel)} · group {path.groupIndex + 1} of {path.groupCount}
      </h3>
      <p className="kmpToolHint">
        Point {path.localIndex + 1} of {path.groupSize}. New points are placed halfway to their neighbour and dropped onto the track.
      </p>
      <div className="kmpButtonRow">
        <button type="button" className="button" onClick={onInsertPointBefore} title={`Add a ${path.pointLabel} before this one`}>
          Insert before
        </button>
        <button type="button" className="button" onClick={onInsertPointAfter} title={`Add a ${path.pointLabel} after this one`}>
          Insert after
        </button>
        <button type="button" className="button" onClick={onDeletePoint} title={`Delete this ${path.pointLabel}`}>
          Delete point
        </button>
      </div>
      <div className="kmpButtonRow">
        <button
          type="button"
          className="button"
          disabled={!path.canSplit}
          title={path.canSplit ? 'Start a new group at this point' : 'Pick a point that is not the first one in its group'}
          onClick={onSplitGroup}
        >
          Split here
        </button>
        <button
          type="button"
          className="button"
          disabled={!path.canMerge}
          title={path.canMerge ? 'Join this group with the one it leads into' : 'Only a group with exactly one plain continuation can be joined'}
          onClick={onMergeGroup}
        >
          Join with next
        </button>
        <GroupOverflowMenu onReverseGroup={onReverseGroup} onReversePath={onReversePath} onDeleteGroup={onDeleteGroup} pathLabel={path.pathLabel} />
      </div>

      <h3>Connections</h3>
      <p className="kmpToolHint">
        {path.canLink
          ? 'Up to six groups can follow this one. Drag a group end handle onto another group in the viewport to connect or disconnect them.'
          : 'This group already has the maximum of six outgoing connections.'}
      </p>
      <LinkEditor label="Comes from" links={path.prevGroups} groupCount={path.groupCount} onChange={(links) => onChangeGroupLinks('prev', links)} />
      <LinkEditor label="Leads to" links={path.nextGroups} groupCount={path.groupCount} onChange={(links) => onChangeGroupLinks('next', links)} />
    </section>
  );
}

/** The rarely used whole-group commands, out of the button row. */
function GroupOverflowMenu({
  pathLabel,
  onReverseGroup,
  onReversePath,
  onDeleteGroup,
}: {
  pathLabel: string;
  onReverseGroup: () => void;
  onReversePath: () => void;
  onDeleteGroup: () => void;
}) {
  return (
    <InlineMenuButton
      label="More group actions"
      sections={[
        {
          id: 'group',
          items: [
            { id: 'reverse-group', label: 'Reverse this group', icon: <Repeat size={14} />, onSelect: onReverseGroup },
            { id: 'reverse-path', label: `Reverse the whole ${pathLabel}`, icon: <Repeat size={14} />, onSelect: onReversePath },
            { id: 'delete-group', label: 'Delete this group', icon: <Trash2 size={14} />, danger: true, onSelect: onDeleteGroup },
          ],
        },
      ]}
    />
  );
}

/** Adds and removes one side of a group's links, clamped to the game's limit of six. */
function LinkEditor({
  label,
  links,
  groupCount,
  onChange,
}: {
  label: string;
  links: number[];
  groupCount: number;
  onChange: (links: number[]) => void;
}) {
  const [pending, setPending] = useState('');
  const options = Array.from({ length: groupCount }, (_, index) => index).filter((index) => !links.includes(index));
  return (
    <div className="kmpLinkEditor">
      <span className="kmpLinkLabel">{label}</span>
      <div className="kmpLinkChips">
        {links.length === 0 && <span className="muted">nothing</span>}
        {links.map((groupIndex) => (
          <button
            key={groupIndex}
            type="button"
            className="kmpLinkChip"
            title={`Remove the connection to group ${groupIndex + 1}`}
            onClick={() => onChange(links.filter((value) => value !== groupIndex))}
          >
            Group {groupIndex + 1} ✕
          </button>
        ))}
      </div>
      <div className="kmpButtonRow">
        <select aria-label={`Add a ${label.toLowerCase()} connection`} value={pending} onChange={(event) => setPending(event.currentTarget.value)}>
          <option value="">Add group…</option>
          {options.map((index) => (
            <option key={index} value={String(index)}>
              Group {index + 1}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button"
          disabled={pending === '' || links.length >= 6}
          onClick={() => {
            onChange([...links, Number(pending)]);
            setPending('');
          }}
        >
          Connect
        </button>
      </div>
    </div>
  );
}

function CheckpointTools({
  checkpoint,
  onSetCheckpointKind,
  onAssignNearestRespawn,
  onAssignAllRespawns,
  onCreateRespawnHere,
  onRenumberKeyCheckpoints,
  onSelectEntity,
}: KmpInspectorProps & { checkpoint: NonNullable<KmpSelectionContext['checkpoint']> }) {
  return (
    <section className="kmpToolGroup">
      <h3>Lap counting</h3>
      <p className="kmpToolHint">
        {checkpoint.kind === 'lap'
          ? 'This is the finish line. Exactly one checkpoint may be the lap counter.'
          : checkpoint.kind === 'key'
            ? `Key checkpoint ${checkpoint.keyNumber}. Drivers must cross the key checkpoints in order for a lap to count.`
            : 'An ordinary checkpoint: it tracks race position but does not gate the lap.'}
      </p>
      <div className="kmpButtonRow">
        {(['lap', 'key', 'normal'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className={`button${checkpoint.kind === kind ? ' isActive' : ''}`}
            aria-pressed={checkpoint.kind === kind}
            onClick={() => onSetCheckpointKind(kind)}
          >
            {kind === 'lap' ? 'Finish line' : kind === 'key' ? 'Key' : 'Ordinary'}
          </button>
        ))}
        <InlineMenuButton
          label="More lap actions"
          sections={[
            {
              id: 'laps',
              items: [
                {
                  id: 'renumber',
                  label: 'Renumber the key checkpoints',
                  icon: <ListOrdered size={14} />,
                  onSelect: onRenumberKeyCheckpoints,
                },
              ],
            },
          ]}
        />
      </div>

      <h3>Respawn</h3>
      <p className="kmpToolHint">
        {checkpoint.respawnIndex === null
          ? 'No respawn point: drivers who fall here are sent to the first one in the track.'
          : `Drivers who fall here come back at respawn point ${checkpoint.respawnIndex + 1}.`}
      </p>
      <div className="kmpButtonRow">
        <button type="button" className="button" disabled={checkpoint.respawnCount === 0} onClick={onAssignNearestRespawn}>
          Use nearest respawn
        </button>
        <button type="button" className="button" onClick={onCreateRespawnHere}>
          New respawn here
        </button>
        {checkpoint.respawnIndex !== null && (
          <button type="button" className="button" onClick={() => onSelectEntity(`JGPT-${checkpoint.respawnIndex}`)}>
            Show respawn
          </button>
        )}
        <InlineMenuButton
          label="More respawn actions"
          sections={[
            {
              id: 'respawns',
              items: [
                {
                  id: 'fill',
                  label: 'Fill in every missing respawn',
                  icon: <Wand2 size={14} />,
                  disabled: checkpoint.respawnCount === 0,
                  disabledReason: 'This track has no respawn points yet',
                  onSelect: onAssignAllRespawns,
                },
              ],
            },
          ]}
        />
      </div>
    </section>
  );
}

function RouteTools({ route, onAppendRoutePoint, onReverseRoute }: KmpInspectorProps & { route: NonNullable<KmpSelectionContext['route']> }) {
  return (
    <section className="kmpToolGroup">
      <h3>
        Path {route.routeIndex + 1} · point {route.pointIndex + 1} of {route.pointCount}
      </h3>
      <div className="kmpButtonRow">
        <button type="button" className="button" onClick={onAppendRoutePoint}>
          Add point at end
        </button>
        <InlineMenuButton
          label="More path actions"
          sections={[{ id: 'route', items: [{ id: 'reverse', label: 'Reverse this path', icon: <Repeat size={14} />, onSelect: onReverseRoute }] }]}
        />
      </div>
    </section>
  );
}

/** A "⋯" button that sits at the end of a tool row, sharing the header's menu implementation. */
function InlineMenuButton({ label, sections }: { label: string; sections: MenuSection[] }) {
  return (
    <span className="kmpRowMenu">
      <InspectorActionsMenu label={label} sections={sections} />
    </span>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
