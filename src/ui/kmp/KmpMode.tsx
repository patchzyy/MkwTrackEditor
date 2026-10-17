import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Vec3 } from '../../lib/kmp';
import { raycastDown } from '../../lib/kcl';
import type { KmpFile } from '../../lib/kmpFile';
import type { PathPointSection } from '../../lib/kmpGraph';
import type { TrackIssue } from '../../lib/kmpValidation';
import { validateTrack } from '../../lib/track';
import type { EditorModeContext, ModeUi } from '../modes/types';
import type { PathLinkSection } from '../Noclip3DViewport';
import { browserObjectTitle } from '../objects/objectCatalog';
import { KmpInspector, type KmpQuickFix } from './KmpInspector';
import { KmpOutliner } from './KmpOutliner';
import { KmpToolsOverlay } from './KmpToolsOverlay';
import { buildKmpOutliner, kmpOutlinerLabels } from './kmpOutlinerModel';
import { createVisibilityState, outlinerSection, sectionForEntityId, type KmpOutlinerSectionKey, type KmpVisibilityKey, type KmpVisibilityState } from './kmpSections';
import { getKmpSelectionContext } from './kmpSelectionContext';
import { useKmpGraphActions } from './useKmpGraphActions';
import './kmp.css';

/**
 * KMP mode: everything the track's layout data is made of — start points, enemy and item
 * routes, checkpoints, respawns, objects, object routes, areas, cameras, cannons, battle
 * finish points and the track settings.
 *
 * The hook owns the outliner, the tool panel and the two viewport gestures that change what a
 * left-drag does. Every edit goes through `useKmpGraphActions` (structured `KmpFile` writes) or
 * the shared `editActions`, so undo/redo and export get them for free.
 */
export function useKmpMode(ctx: EditorModeContext): ModeUi {
  const active = ctx.editorMode === 'kmp';
  const { track, trackRef, history, selection, setStatus, objFlow, editActions, clipboard } = ctx;
  const file = track?.kmpFile ?? null;
  const graph = useKmpGraphActions({ track, trackRef, history, selection, setStatus });

  const [visibility, setVisibility] = useState<KmpVisibilityState>(() => createVisibilityState(true));
  const [activeSection, setActiveSection] = useState<KmpOutlinerSectionKey>(() => sectionForEntityId(selection.selectedId)?.key ?? 'start');
  const [linkSection, setLinkSection] = useState<PathLinkSection | null>(null);
  const [drawingCheckpoints, setDrawingCheckpoints] = useState(false);
  const [pathGroupColors, setPathGroupColors] = useState(true);
  const [checkpointQuads, setCheckpointQuads] = useState(false);
  const [frameRequest, setFrameRequest] = useState<{ entityId: string; token: number } | null>(null);

  const sectionVisibility = useMemo(() => {
    const state = createVisibilityState(false);
    for (const key of outlinerSection(activeSection).visibility) state[key] = visibility[key];
    return state;
  }, [activeSection, visibility]);

  useEffect(() => {
    const section = sectionForEntityId(selection.selectedId);
    if (!active || !section || section.key === activeSection) return;
    setActiveSection(section.key);
    setLinkSection(null);
    setDrawingCheckpoints(false);
  }, [active, activeSection, selection.selectedId]);

  function changeSection(section: KmpOutlinerSectionKey) {
    setActiveSection(section);
    selection.selectOnly(null);
    setLinkSection(null);
    setDrawingCheckpoints(false);
  }

  const objectName = useCallback(
    (objectId: number) => browserObjectTitle({ objectId, name: objFlow?.byId.get(objectId)?.name ?? '', resources: objFlow?.byId.get(objectId)?.resources ?? '' }),
    [objFlow],
  );

  const sections = useMemo(
    () => buildKmpOutliner({ file, objectName, issues: ctx.validation }),
    [ctx.validation, file, objectName],
  );

  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'a' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (document.documentElement.dataset.playtest === 'active' || document.documentElement.dataset.viewportCameraLook === 'active') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      event.preventDefault();
      selection.selectEntities(sections.find((section) => section.section === activeSection)!.entityIds);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, activeSection, sections, selection]);

  const context = useMemo(() => getKmpSelectionContext(file, selection.selectedId), [file, selection.selectedId]);
  // The tree is the single source of naming, so the inspector never says "checkpoint #0" for a
  // row the outliner calls "Group 1 · Checkpoint 1".
  const labels = useMemo(() => kmpOutlinerLabels(sections), [sections]);
  const labelFor = useCallback(
    (entity: { id: string }) => labels.get(entity.id) ?? ctx.entityLabel(entity as never),
    [ctx, labels],
  );

  // Leaving the mode must not leave a gesture armed; Escape drops out of one on demand.
  useEffect(() => {
    if (active) return;
    setLinkSection(null);
    setDrawingCheckpoints(false);
  }, [active]);

  useEffect(() => {
    if (!active || (!drawingCheckpoints && !linkSection)) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setDrawingCheckpoints(false);
      setLinkSection(null);
      setStatus('Back to selecting.');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, drawingCheckpoints, linkSection, setStatus]);

  function frame(entityId: string) {
    setFrameRequest((current) => ({ entityId, token: (current?.token ?? 0) + 1 }));
  }

  function selectAndFrame(entityId: string) {
    selection.selectOnly(entityId);
    frame(entityId);
  }

  /** Where a new path point goes: halfway to its neighbour, dropped onto the collision mesh. */
  function insertPosition(section: PathPointSection, globalIndex: number, where: 'before' | 'after'): Vec3 | null {
    if (!file) return null;
    const points = pathPositions(file, section);
    const here = points[globalIndex];
    if (!here) return null;
    const neighbour = points[where === 'before' ? globalIndex - 1 : globalIndex + 1];
    const target = neighbour
      ? { x: (here.x + neighbour.x) / 2, y: (here.y + neighbour.y) / 2, z: (here.z + neighbour.z) / 2 }
      : { ...here };
    const kcl = track?.kcl;
    if (!kcl) return target;
    const hit = raycastDown(kcl, target.x, target.z, target.y + 10000);
    return hit ? { x: target.x, y: hit.y, z: target.z } : target;
  }

  /** Turns a whole prev/next list into the link and unlink calls that get there. */
  function changeGroupLinks(side: 'prev' | 'next', links: number[]) {
    if (!context.path) return;
    const { section, groupIndex, prevGroups, nextGroups } = context.path;
    const before = side === 'next' ? nextGroups : prevGroups;
    const added = links.filter((value) => !before.includes(value));
    const removed = before.filter((value) => !links.includes(value));
    for (const other of added) {
      if (side === 'next') graph.linkPathGroups(section, groupIndex, other);
      else graph.linkPathGroups(section, other, groupIndex);
    }
    for (const other of removed) {
      if (side === 'next') graph.unlinkPathGroups(section, groupIndex, other);
      else graph.unlinkPathGroups(section, other, groupIndex);
    }
  }

  /** One-click repairs for the validation issues that have an obvious fix. */
  function quickFix(issue: TrackIssue): KmpQuickFix | null {
    const entityId = issue.entityId;
    switch (issue.code) {
      case 'object.route-out-of-range':
      case 'area.route-out-of-range':
      case 'camera.route-out-of-range':
        return entityId ? { label: 'Remove the broken link', run: () => graph.clearDanglingRouteReference(entityId) } : null;
      case 'camera.next-out-of-range':
      case 'camera.next-self':
      case 'camera.opening-loop':
      case 'area.camera-out-of-range':
        return entityId ? { label: 'Remove the broken link', run: () => graph.clearDanglingCameraReference(entityId) } : null;
      case 'object.never-visible':
        return entityId ? { label: 'Show it everywhere', run: () => graph.makeObjectAlwaysPresent(indexOf(entityId)) } : null;
      case 'object.route-required':
      case 'camera.route-missing':
        return entityId && entityId.startsWith('GOBJ')
          ? { label: 'Create a route for it', run: () => graph.createRouteForObject(indexOf(entityId)) }
          : null;
      case 'checkpoint.no-respawn':
      case 'checkpoint.respawn-out-of-range':
        return (trackRef.current ?? track)?.kmpFile?.respawnPoints.length
          ? { label: 'Use the nearest respawn everywhere', run: () => graph.assignAllNearestRespawns(false) }
          : null;
      case 'checkpoint.keys-out-of-order':
      case 'checkpoint.duplicate-key':
      case 'checkpoint.missing-key':
        return { label: 'Renumber the key checkpoints', run: graph.renumberKeyCheckpointsInOrder };
      default:
        return null;
    }
  }

  function fixAll() {
    const currentTrack = trackRef.current;
    if (!currentTrack) return;
    const before = validateTrack(currentTrack, { common: ctx.commonArchive });
    let remaining = before;
    const attempted = new Set<string>();
    history.beginEditSession();
    try {
      for (;;) {
        const issue = remaining.find((issue) => !attempted.has(`${issue.code}:${issue.entityId ?? ''}`) && quickFix(issue));
        if (!issue) break;
        attempted.add(`${issue.code}:${issue.entityId ?? ''}`);
        quickFix(issue)!.run();
        remaining = validateTrack(trackRef.current!, { common: ctx.commonArchive });
      }
    } finally {
      history.endEditSession();
    }
    const repaired = before.filter((issue) => !remaining.some((other) => other.code === issue.code && other.entityId === issue.entityId)).length;
    const errors = remaining.filter((issue) => issue.level === 'error').length;
    const warnings = remaining.filter((issue) => issue.level === 'warning').length + (trackRef.current?.warnings.length ?? 0);
    setStatus(`Repaired ${repaired} issue${repaired === 1 ? '' : 's'}. ${errors} errors and ${warnings} warnings remain. Review the validation list and any generated routes before exporting.`);
  }

  if (!active) return {};

  const selectedIds = selection.selectedIds;

  return {
    viewportProps: {
      mode: 'kmp',
      sectionVisibility,
      onChangeSectionVisibility: (key: KmpVisibilityKey, visible: boolean) =>
        setVisibility((current) => ({ ...current, [key]: visible })),
      pathGroupColors,
      showCheckpointQuads: checkpointQuads,
      pathLinkSection: linkSection,
      onLinkPathGroups: (section, from, to) => graph.linkPathGroups(section, from, to),
      onUnlinkPathGroups: (section, from, to) => graph.unlinkPathGroups(section, from, to),
      drawTool: drawingCheckpoints ? 'checkpoint' : 'none',
      onDrawCheckpoint: (start, end) => graph.createCheckpointAcrossTrack(start, end, context.checkpoint?.index ?? null),
      // Drawing stays armed so a whole lap can be laid down in one go; Escape leaves it.
      onDrawToolFinished: () => undefined,
      frameRequest,
    },
    leftPanel: (
      <KmpOutliner
        key={activeSection}
        sections={sections}
        activeSection={activeSection}
        onChangeSection={changeSection}
        selectedId={selection.selectedId}
        selectedIds={selectedIds}
        visibility={visibility}
        onChangeVisibility={(key, visible) => setVisibility((current) => ({ ...current, [key]: visible }))}
        onSelect={(ids, options) => selection.selectEntities(ids, options?.additive)}
        onFrame={frame}
      />
    ),
    inspector: (
      <KmpInspector
        entity={ctx.selected}
        entities={ctx.selectedEntities}
        entityLabel={labelFor}
        selectedInspector={ctx.selectedInspector}
        context={context}
        issues={ctx.validation}
        loadWarnings={track?.warnings ?? []}
        objectOptions={ctx.objectOptions}
        canBatchReplaceObjects={ctx.canBatchReplaceObjects}
        hasCollision={!!track?.kcl}
        commonArchive={ctx.commonArchive}
        commonBrresSummaries={ctx.commonBrresSummaries}
        onSelectEntity={selectAndFrame}
        onSelectMatchingObjects={editActions.selectMatchingObjects}
        onReplaceObjectTypes={editActions.replaceSelectedObjectTypes}
        onDeleteSelection={editActions.deleteSelectedEntity}
        onDuplicateSelection={clipboard.duplicateSelectedEntity}
        onSnapToCollision={() => graph.snapEntitiesToCollision(selectedIds.length > 0 ? selectedIds : selection.selectedId ? [selection.selectedId] : [])}
        onInsertPointBefore={() => {
          const path = context.path;
          const position = path && insertPosition(path.section, path.globalIndex, 'before');
          if (path && position) graph.addPathPoint(path.section, path.groupIndex, path.localIndex, position, 'before');
        }}
        onInsertPointAfter={() => {
          const path = context.path;
          const position = path && insertPosition(path.section, path.globalIndex, 'after');
          if (path && position) graph.addPathPoint(path.section, path.groupIndex, path.localIndex, position, 'after');
        }}
        onDeletePoint={() => context.path && graph.deletePathPoint(context.path.section, context.path.globalIndex)}
        onSplitGroup={() => context.path && graph.splitGroupHere(context.path.section, context.path.groupIndex, context.path.localIndex)}
        onMergeGroup={() => context.path && graph.mergeGroupNext(context.path.section, context.path.groupIndex)}
        onReverseGroup={() => context.path && graph.reversePathGroup(context.path.section, context.path.groupIndex)}
        onReversePath={() => context.path && graph.reverseWholePath(context.path.section)}
        onDeleteGroup={() => context.path && graph.deletePathGroup(context.path.section, context.path.groupIndex)}
        onChangeGroupLinks={changeGroupLinks}
        onSetCheckpointKind={(kind) => context.checkpoint && graph.setCheckpointKind(context.checkpoint.index, kind)}
        onAssignNearestRespawn={() => context.checkpoint && graph.assignNearestRespawn(context.checkpoint.index)}
        onAssignAllRespawns={() => graph.assignAllNearestRespawns(false)}
        onCreateRespawnHere={() => context.checkpoint && graph.createRespawnFromCheckpoint(context.checkpoint.index)}
        onRenumberKeyCheckpoints={graph.renumberKeyCheckpointsInOrder}
        onAppendRoutePoint={() => {
          const route = context.route;
          if (!route || !file) return;
          const last = file.routes[route.routeIndex]?.points.at(-1);
          if (!last) return;
          graph.appendRoutePoint(route.routeIndex, { x: last.position.x + 1000, y: last.position.y, z: last.position.z });
        }}
        onReverseRoute={() => context.route && graph.reverseRoute(context.route.routeIndex)}
        quickFix={quickFix}
        onFixAll={fixAll}
      />
    ),
    topRightOverlay: (
      <KmpToolsOverlay
        canCreateRespawns={!!file?.checkpoints.length && !!file?.enemyPoints.length}
        onCreateRespawns={graph.createRespawnsFromEnemyRoute}
        linkSection={linkSection}
        onChangeLinkSection={(section) => {
          if (section) changeSection(sectionForEntityId(`${section}-0`)!.key);
          setLinkSection(section);
        }}
        drawingCheckpoints={drawingCheckpoints}
        onChangeDrawingCheckpoints={(drawing) => {
          if (drawing) changeSection('checkpoint');
          setDrawingCheckpoints(drawing);
        }}
        pathGroupColors={pathGroupColors}
        onChangePathGroupColors={setPathGroupColors}
        checkpointQuads={checkpointQuads}
        onChangeCheckpointQuads={setCheckpointQuads}
      />
    ),
  };
}

/** Point positions for a path section, in flat track order. Checkpoints use their midpoint. */
function pathPositions(file: KmpFile, section: PathPointSection): Vec3[] {
  if (section === 'ENPT') return file.enemyPoints.map((point) => point.position);
  if (section === 'ITPT') return file.itemPoints.map((point) => point.position);
  return file.checkpoints.map((checkpoint) => ({ x: (checkpoint.x1 + checkpoint.x2) / 2, y: 0, z: (checkpoint.z1 + checkpoint.z2) / 2 }));
}

function indexOf(entityId: string): number {
  return Number(entityId.split('-')[1]);
}
