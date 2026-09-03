import { useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { KmpEntity, Vec3 } from '../../lib/kmp';
import type { TrackIssue } from '../../lib/kmpValidation';
import type { ObjectOption } from '../objects/objectCatalog';
import { ObjectIdSelect } from '../inspector/fields/ObjectIdSelect';
import { VectorInputs } from '../inspector/fields/VectorInputs';
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

  onSelectEntity: (entityId: string) => void;
  onOffsetSelection: (offset: Vec3) => void;
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
}

/**
 * Inspector body for KMP mode.
 *
 * Order matches how a track is actually edited: what is selected, what you can do to it right
 * now, then the full property sheet, then everything the track still gets wrong.
 */
export function KmpInspector(props: KmpInspectorProps) {
  const { entity, entities, context, issues, loadWarnings } = props;
  const errorCount = issues.filter((issue) => issue.level === 'error').length;
  const warningCount = issues.filter((issue) => issue.level === 'warning').length + loadWarnings.length;

  return (
    <div className="kmpInspector">
      <SelectionHeader {...props} />
      {entities.length > 1 && <BatchTools {...props} />}
      {context.path && <PathTools {...props} path={context.path} />}
      {context.checkpoint && <CheckpointTools {...props} checkpoint={context.checkpoint} />}
      {context.route && <RouteTools {...props} route={context.route} />}

      {entity ? (
        <section className="kmpToolGroup">
          <h3>Properties</h3>
          {props.selectedInspector}
        </section>
      ) : (
        <p className="muted">Pick something in the track list or the viewport to edit it.</p>
      )}

      <section className="kmpToolGroup kmpValidation">
        <h3>Before you export</h3>
        <div className="validationSummary">
          <span className={`validationBadge${errorCount > 0 ? ' error' : ''}`}>{errorCount} errors</span>
          <span className={`validationBadge${warningCount > 0 ? ' warning' : ''}`}>{warningCount} warnings</span>
        </div>
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

function SelectionHeader({ entity, entities, entityLabel, hasCollision, onSnapToCollision, onDuplicateSelection, onDeleteSelection }: KmpInspectorProps) {
  return (
    <section className="kmpToolGroup kmpSelectionHeader">
      <h3>{entities.length > 1 ? `${entities.length} selected` : 'Selection'}</h3>
      <p className="kmpSelectionName">{entity ? entityLabel(entity) : 'Nothing selected'}</p>
      <div className="kmpButtonRow">
        <button type="button" className="button" disabled={!entity} onClick={onDuplicateSelection}>
          Duplicate
        </button>
        <button type="button" className="button" disabled={!entity} onClick={onDeleteSelection}>
          Delete
        </button>
        <button
          type="button"
          className="button"
          disabled={!entity || !hasCollision}
          title={hasCollision ? 'Drop the selection straight down onto the track surface' : 'This track has no collision data'}
          onClick={onSnapToCollision}
        >
          Drop to ground
        </button>
      </div>
    </section>
  );
}

function BatchTools({ entities, objectOptions, canBatchReplaceObjects, onOffsetSelection, onReplaceObjectTypes }: KmpInspectorProps) {
  const [offset, setOffset] = useState<Vec3>({ x: 0, y: 0, z: 0 });
  const [objectId, setObjectId] = useState<number | null>(null);
  const effectiveObjectId = objectId ?? entities.find((candidate) => candidate.objectId !== undefined)?.objectId ?? null;
  return (
    <section className="kmpToolGroup">
      <h3>Move them together</h3>
      <VectorInputs value={offset} onChange={setOffset} />
      <div className="kmpButtonRow">
        <button
          type="button"
          className="button"
          disabled={offset.x === 0 && offset.y === 0 && offset.z === 0}
          onClick={() => onOffsetSelection(offset)}
        >
          Move all {entities.length}
        </button>
        <button type="button" className="button" onClick={() => setOffset({ x: 0, y: 0, z: 0 })}>
          Reset
        </button>
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
        <button type="button" className="button" onClick={onReverseGroup} title="Reverse the driving direction of this group">
          Reverse group
        </button>
      </div>
      <div className="kmpButtonRow">
        <button type="button" className="button" onClick={onReversePath} title={`Reverse the whole ${path.pathLabel}`}>
          Reverse whole path
        </button>
        <button type="button" className="button" onClick={onDeleteGroup} title="Delete this group and reconnect its neighbours">
          Delete group
        </button>
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
      </div>
      <div className="kmpButtonRow">
        <button type="button" className="button" onClick={onRenumberKeyCheckpoints} title="Number the key checkpoints 1, 2, 3 … in the order drivers reach them">
          Renumber key checkpoints
        </button>
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
      </div>
      <div className="kmpButtonRow">
        <button type="button" className="button" disabled={checkpoint.respawnCount === 0} onClick={onAssignAllRespawns} title="Fill in every checkpoint that has no respawn point yet">
          Fill in the missing ones
        </button>
      </div>
    </section>
  );
}

function RouteTools({ route, onAppendRoutePoint, onReverseRoute }: KmpInspectorProps & { route: NonNullable<KmpSelectionContext['route']> }) {
  return (
    <section className="kmpToolGroup">
      <h3>
        Route {route.routeIndex + 1} · point {route.pointIndex + 1} of {route.pointCount}
      </h3>
      <div className="kmpButtonRow">
        <button type="button" className="button" onClick={onAppendRoutePoint}>
          Add point at end
        </button>
        <button type="button" className="button" onClick={onReverseRoute}>
          Reverse route
        </button>
      </div>
    </section>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
