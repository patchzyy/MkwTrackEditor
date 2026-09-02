import { useEffect, useMemo, useState } from 'react';
import { getKmpCameraHeader, type KmpEntity, type Vec3 } from '../lib/kmp';
import { getPathInfo, getReferenceCounts } from '../lib/kmpEdit';
import { describeEntity, validateTrack } from '../lib/track';
import objectNamesById from '../generated/mkwObjectNames.json';
import { getAreaInspectorResources } from './areas/areaInspectorConfig';
import { useCameraMode } from './camera/CameraMode';
import { useKmpMode } from './kmp/KmpMode';
import { useModelMode } from './model/ModelMode';
import type { EditorModeContext, ModeUi } from './modes/types';
import { useVisualMode } from './visual/VisualMode';
import { ContentBrowser } from './contentBrowser/ContentBrowser';
import { PlaceAssetsRail } from './contentBrowser/PlaceAssetsRail';
import { buildFillBetweenPositions, getFillBetweenSelection } from './fillBetween';
import { FillBetweenPanel } from './inspector/FillBetweenPanel';
import { InspectorPanel } from './inspector/InspectorPanel';
import { getTrackPostEffectResources } from './inspector/postEffectResources';
import { SelectedEntityInspector } from './inspector/SelectedEntityInspector';
import { Noclip3DViewport, type TransformTool, type ViewMode } from './Noclip3DViewport';
import { browserObjectTitle, isBrowsableObjectChoice, featuredObjectIds, type ObjectOption } from './objects/objectCatalog';
import { getObjectInspectorProfile, getObjectVariantOptions } from './objects/objectProfiles';
import type { EditorModeStub, InspectorSection } from './state/types';
import { useBrowserFolders } from './state/useBrowserFolders';
import { useClipboard } from './state/useClipboard';
import { useEditorHistory } from './state/useEditorHistory';
import { useEditorShortcuts } from './state/useEditorShortcuts';
import { useKmpEditActions } from './state/useKmpEditActions';
import { CONTENT_BROWSER_COLLAPSED_HEIGHT, usePanelLayout } from './state/usePanelLayout';
import { usePostEffectActions } from './state/usePostEffectActions';
import { useSelection } from './state/useSelection';
import { useSmokeHarness } from './state/useSmokeHarness';
import { useTrackDocument } from './state/useTrackDocument';
import { useTrackExport } from './state/useTrackExport';
import { TopBar } from './topbar/TopBar';

/**
 * Editor shell. All state lives in the `state/` hooks and every panel is its own component; this
 * file only wires them together and lays them out.
 */
export function App() {
  const layout = usePanelLayout();
  const selection = useSelection();
  const [status, setStatus] = useState('No track loaded');
  const [tool, setTool] = useState<TransformTool>('translate');
  const [viewMode, setViewMode] = useState<ViewMode>('normal');
  const [editorMode, setEditorMode] = useState<EditorModeStub>('kmp');
  const [collisionVisible, setCollisionVisible] = useState(false);
  const [inspectorSection, setInspectorSection] = useState<InspectorSection>('object');
  const [batchOffset, setBatchOffset] = useState<Vec3>({ x: 0, y: 0, z: 0 });
  const [batchObjectId, setBatchObjectId] = useState<number | null>(null);
  const [fillBetweenCount, setFillBetweenCount] = useState(3);
  const [fillBetweenPanelOpen, setFillBetweenPanelOpen] = useState(false);

  const trackDocument = useTrackDocument({ setStatus });
  const history = useEditorHistory({ selection, trackDocument, setStatus });
  trackDocument.bindHistory(history);

  const { track, trackRef, projectState, commonArchive, commonArchiveUrl, commonBrresSummaries, commonLoadStatus, courseAssetDb, objFlow } = trackDocument;
  const { selectedId, selectedIds } = selection;

  // Viewport drags keep the in-progress document out of React state, so analysis panels read the
  // pre-drag document instead of the transient preview.
  const analysisTrack = history.transientViewportEditRef.current ? history.editSessionRef.current?.track ?? track : track;
  const selected = useMemo(() => track?.kmp?.entities.find((entity) => entity.id === selectedId) ?? null, [track, selectedId]);
  const selectedEntities = useMemo(() => {
    if (!track?.kmp || selectedIds.length === 0) return [];
    const selectedSet = new Set(selectedIds);
    return track.kmp.entities.filter((entity) => selectedSet.has(entity.id));
  }, [track, selectedIds]);
  const selectedPathInfo = useMemo(() => (selected && track?.kmp ? getPathInfo(track.kmp, selected) : null), [track, selected]);
  const canBatchReplaceObjects = useMemo(
    () => selectedEntities.length > 1 && selectedEntities.every((entity) => entity.section === 'GOBJ' && entity.objectId !== undefined),
    [selectedEntities],
  );
  const fillBetweenSelection = useMemo(() => getFillBetweenSelection(selectedEntities), [selectedEntities]);
  const fillBetweenPreviewPositions = useMemo(
    () => (fillBetweenPanelOpen && fillBetweenSelection
      ? buildFillBetweenPositions(
          fillBetweenSelection.endpoints[0].position,
          fillBetweenSelection.endpoints[1].position,
          fillBetweenCount,
        )
      : []),
    [fillBetweenCount, fillBetweenPanelOpen, fillBetweenSelection],
  );
  const cameraHeader = useMemo(() => (analysisTrack?.kmp ? getKmpCameraHeader(analysisTrack.kmp) : null), [analysisTrack]);
  const referenceCounts = useMemo(() => getReferenceCounts(analysisTrack?.kmp ?? null), [analysisTrack?.kmp]);
  const validation = useMemo(() => (analysisTrack ? validateTrack(analysisTrack, { common: commonArchive }) : []), [analysisTrack, commonArchive]);
  const areaInspectorResources = useMemo(() => getAreaInspectorResources(analysisTrack), [analysisTrack]);
  const postEffectResources = useMemo(() => getTrackPostEffectResources(analysisTrack), [analysisTrack]);
  const selectedObjectProfile = useMemo(() => (selected?.section === 'GOBJ' ? getObjectInspectorProfile(selected, objFlow) : null), [objFlow, selected]);
  const selectedArchiveNode = useMemo(
    () => projectState?.archiveNodes.find((node) => node.id === selectedId) ?? null,
    [projectState, selectedId],
  );
  const validationCounts = useMemo(() => {
    const errorCount = validation.filter((item) => item.level === 'error').length;
    const warningCount = validation.filter((item) => item.level === 'warning').length + (track?.warnings.length ?? 0);
    return { errorCount, warningCount };
  }, [track?.warnings.length, validation]);
  const objectOptions = useMemo<ObjectOption[]>(() => {
    const selectedObjectId = selected?.section === 'GOBJ' ? selected.objectId ?? null : null;
    const ids = new Set<number>();
    for (const key of Object.keys(objectNamesById as Record<string, string>)) {
      const parsed = Number(key);
      if (Number.isFinite(parsed)) ids.add(parsed);
    }
    for (const entry of objFlow?.entries ?? []) ids.add(entry.objectId);
    return [...ids]
      .map((id) => {
        const flow = objFlow?.byId.get(id);
        return {
          id,
          label: browserObjectTitle({ objectId: id, name: flow?.name ?? '', resources: flow?.resources ?? '' }),
          detail: flow?.resources || flow?.name || 'Unknown object',
        };
      })
      .filter((option) => option.id === selectedObjectId || isBrowsableObjectChoice(option.id, option.label, option.detail))
      .sort((a, b) => a.label.localeCompare(b.label) || a.id - b.id);
  }, [objFlow, selected]);
  const selectedObjectVariantOptions = useMemo(
    () => (selected?.section === 'GOBJ' && selectedObjectProfile ? getObjectVariantOptions(selectedObjectProfile, objectOptions) : []),
    [objectOptions, selected, selectedObjectProfile],
  );
  const quickObjectOptions = useMemo(
    () =>
      [...featuredObjectIds]
        .map((id) => objectOptions.find((option) => option.id === id))
        .filter((option): option is ObjectOption => option !== undefined),
    [objectOptions],
  );
  const trackSummary = useMemo(() => {
    if (!track?.kmp) return null;
    return {
      entityCount: track.kmp.entities.length,
      groupCount: track.kmp.pathGraphs.reduce((sum, graph) => sum + graph.groups.length, 0),
      routeCount: track.kmp.routes.length,
    };
  }, [track?.kmp]);

  function entityLabel(entity: KmpEntity): string {
    if (entity.section !== 'GOBJ' || entity.objectId === undefined) return describeEntity(entity);
    const title = browserObjectTitle({ objectId: entity.objectId, name: objFlow?.byId.get(entity.objectId)?.name ?? '', resources: objFlow?.byId.get(entity.objectId)?.resources ?? '' });
    return `${title} #${entity.index}`;
  }

  const browser = useBrowserFolders({ track, projectState, objFlow, commonArchive, courseAssetDb });
  const editActions = useKmpEditActions({
    track,
    trackRef,
    projectState,
    objFlow,
    selection,
    history,
    setStatus,
    selected,
    selectedEntities,
    selectedPathInfo,
    canBatchReplaceObjects,
    batchOffset,
    fillBetweenSelection,
    fillBetweenCount,
    entityLabel,
  });
  const postEffectActions = usePostEffectActions({ track, postEffectResources, selection, history, setStatus });
  const clipboard = useClipboard({ track, selected, selectedEntities, selection, history, setStatus, entityLabel });
  const { downloadExport } = useTrackExport({ track, commonArchive, setStatus });

  // Each editor mode contributes its own panels and viewport props. All four hooks run every
  // render (hook rules); only the active one returns anything.
  const modeContext: EditorModeContext = {
    editorMode,
    track,
    trackRef,
    projectState,
    objFlow,
    commonArchive,
    commonBrresSummaries,
    selection,
    history,
    editActions,
    selected,
    selectedEntities,
    entityLabel,
    setStatus,
    tool,
    viewMode,
    setEditorMode,
  };
  const kmpModeUi = useKmpMode(modeContext);
  const cameraModeUi = useCameraMode(modeContext);
  const modelModeUi = useModelMode(modeContext);
  const visualModeUi = useVisualMode(modeContext);
  const modeUi: ModeUi =
    editorMode === 'camera' ? cameraModeUi : editorMode === 'model' ? modelModeUi : editorMode === 'visual' ? visualModeUi : kmpModeUi;

  useEffect(() => {
    if (!selected) return;
    setInspectorSection(selected.section === 'STGI' ? 'track' : 'object');
  }, [selected]);

  useEffect(() => {
    if (canBatchReplaceObjects) {
      setBatchObjectId(selectedEntities[0]?.objectId ?? null);
    } else {
      setBatchObjectId(null);
    }
  }, [canBatchReplaceObjects, selectedEntities]);

  useEffect(() => {
    if (!fillBetweenSelection) setFillBetweenPanelOpen(false);
  }, [fillBetweenSelection]);

  useEditorShortcuts({
    selection,
    selected,
    track,
    objFlow,
    fillBetweenSelection,
    setTool,
    setStatus,
    setFillBetweenPanelOpen,
    undoEdit: history.undoEdit,
    redoEdit: history.redoEdit,
    copySelectedEntity: clipboard.copySelectedEntity,
    pasteClipboardEntity: clipboard.pasteClipboardEntity,
    duplicateSelectedEntity: clipboard.duplicateSelectedEntity,
    deleteSelectedEntity: editActions.deleteSelectedEntity,
    downloadExport,
  });

  useSmokeHarness({
    smokeMode: trackDocument.smokeMode,
    smokeCallbackUrl: trackDocument.smokeCallbackUrl,
    status,
    commonLoadStatus,
    track,
    trackRef,
    selected,
    commonArchive,
    commonBrresSummaries,
    courseAssetDb,
    copySelectedEntity: clipboard.copySelectedEntity,
    duplicateSelectedEntity: clipboard.duplicateSelectedEntity,
    undoEdit: history.undoEdit,
    redoEdit: history.redoEdit,
  });

  const selectedInspectorSection: InspectorSection = selected?.section === 'STGI' ? 'track' : 'object';
  const selectedInspector = selected ? (
    <SelectedEntityInspector
      entity={selected}
      pathInfo={selectedPathInfo}
      cameraHeader={cameraHeader}
      referenceCounts={referenceCounts}
      areaInspectorResources={areaInspectorResources}
      objectProfile={selectedObjectProfile}
      objectOptions={objectOptions}
      objectVariantOptions={selectedObjectVariantOptions}
      actions={editActions}
    />
  ) : null;

  return (
    <main
      ref={layout.appShellRef}
      className="appShell"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void trackDocument.openFiles(event.dataTransfer.files);
      }}
    >
      <TopBar
        topBarRef={layout.topBarRef}
        historyState={history.historyState}
        status={status}
        editorMode={editorMode}
        inspectorOpen={layout.inspectorOpen}
        canExport={track !== null}
        onOpenFiles={(files) => void trackDocument.openFiles(files)}
        onImportCommonArchive={(files) => void trackDocument.importCommonArchive(files)}
        onUndo={history.undoEdit}
        onRedo={history.redoEdit}
        onToggleInspector={() => layout.setInspectorOpen((value) => !value)}
        onExport={downloadExport}
        onChangeEditorMode={setEditorMode}
      />

      <div ref={layout.shellBodyRef} className={layout.inspectorOpen ? 'shellBody' : 'shellBody inspectorCollapsed'} style={layout.workspaceStyle}>
        <div ref={layout.workspaceRef} className={layout.placeAssetsOpen ? 'workspace' : 'workspace placeAssetsCollapsed'}>
          {modeUi.leftPanel ?? (
            <PlaceAssetsRail
              open={layout.placeAssetsOpen}
              onToggle={() => layout.setPlaceAssetsOpen((value) => !value)}
              onBeginResize={(event) => layout.beginSidebarResize('placeAssets', event)}
              quickObjectOptions={quickObjectOptions}
              objFlow={objFlow}
              commonArchive={commonArchive}
              commonBrresSummaries={commonBrresSummaries}
            />
          )}
          <Noclip3DViewport
            track={track}
            selectedId={selectedId}
            selectedIds={selectedIds}
            mode={editorMode}
            fillBetweenPreviewPositions={fillBetweenPreviewPositions}
            smokeCommonUrl={trackDocument.smokeCommonUrl}
            commonArchiveUrl={commonArchiveUrl}
            tool={tool}
            viewMode={viewMode}
            collisionVisible={collisionVisible}
            onChangeTool={setTool}
            onChangeViewMode={setViewMode}
            onChangeCollisionVisible={(visible) => {
              setCollisionVisible(visible);
              if (visible && viewMode !== 'dev') setViewMode('dev');
            }}
            getEntityLabel={entityLabel}
            onSelect={(id, options) => selection.selectEntity(id, options?.additive)}
            onSelectMany={(ids, options) => selection.selectEntities(ids, options?.additive)}
            onSelectTransformSelection={selection.selectOnly}
            onMoveEntity={editActions.moveEntity}
            onRotateEntity={editActions.rotateEntity}
            onScaleEntity={editActions.scaleEntity}
            onMoveTransformSelection={(target, position) => editActions.updateViewportTransformSelection(target, { translation: position })}
            onRotateTransformSelection={(target, rotation) => editActions.updateViewportTransformSelection(target, { rotation })}
            onScaleTransformSelection={(target, scale) => editActions.updateViewportTransformSelection(target, { scale })}
            onMoveCheckpointEndpoint={editActions.moveCheckpointEndpoint}
            onAddObject={editActions.addObject}
            onAddKmpPoint={editActions.addKmpPoint}
            onInsertRoutePoint={editActions.insertRoutePoint}
            onInteractionStart={history.beginEditSession}
            onInteractionEnd={history.endEditSession}
            topRightOverlay={
              modeUi.topRightOverlay ?? (fillBetweenPanelOpen && fillBetweenSelection ? (
                <FillBetweenPanel
                  objectLabel={browserObjectTitle({
                    objectId: fillBetweenSelection.objectId,
                    name: objFlow?.byId.get(fillBetweenSelection.objectId)?.name ?? '',
                    resources: objFlow?.byId.get(fillBetweenSelection.objectId)?.resources ?? '',
                  })}
                  count={fillBetweenCount}
                  onChangeCount={setFillBetweenCount}
                  onApply={editActions.applyFillBetween}
                  onClose={() => setFillBetweenPanelOpen(false)}
                />
              ) : null)
            }
            {...modeUi.viewportProps}
          />
        </div>

        <InspectorPanel
          inspectorOpen={layout.inspectorOpen}
          onBeginResize={(event) => layout.beginSidebarResize('inspector', event)}
          onClose={() => layout.setInspectorOpen(false)}
          inspectorSection={inspectorSection}
          onChangeInspectorSection={setInspectorSection}
          editorMode={editorMode}
          modeContent={modeUi.inspector}
          track={track}
          trackSummary={trackSummary}
          selected={selected}
          selectedEntities={selectedEntities}
          selectedArchiveNode={selectedArchiveNode}
          selectedInspector={selectedInspector}
          selectedInspectorSection={selectedInspectorSection}
          entityLabel={entityLabel}
          objectOptions={objectOptions}
          canBatchReplaceObjects={canBatchReplaceObjects}
          batchOffset={batchOffset}
          onChangeBatchOffset={setBatchOffset}
          onApplyBatchOffset={editActions.offsetSelectedEntities}
          batchObjectId={batchObjectId}
          onChangeBatchObjectId={setBatchObjectId}
          onApplyBatchObjectId={editActions.replaceSelectedObjectTypes}
          onDeleteSelected={editActions.deleteSelectedEntity}
          onSelectEntity={(id, options) => selection.selectEntity(id, options?.additive)}
          postEffectResources={postEffectResources}
          postEffectActions={postEffectActions}
          validation={validation}
          validationCounts={validationCounts}
        />

        <ContentBrowser
          open={layout.browserOpen}
          height={layout.browserHeight}
          collapsedHeight={CONTENT_BROWSER_COLLAPSED_HEIGHT}
          resizing={layout.browserResizing}
          onBeginResize={layout.beginBrowserResize}
          onToggleOpen={() => layout.setBrowserOpen((value) => !value)}
          folders={browser.browserFolders}
          activeFolderId={browser.activeBrowserFolder?.id}
          filteredFolder={browser.filteredBrowserFolder}
          query={browser.browserQuery}
          onChangeQuery={browser.setBrowserQuery}
          onChangeFolder={browser.setBrowserFolder}
          track={track}
          objFlow={objFlow}
          commonArchive={commonArchive}
          commonBrresSummaries={commonBrresSummaries}
          selectedId={selectedId}
          onSelectArchiveNode={(nodeId) => {
            setEditorMode('model');
            selection.selectOnly(nodeId);
          }}
        />
      </div>
    </main>
  );
}
