import { Boxes, Layers, Palette, Route as RouteIcon, Shapes, Video } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getKmpCameraHeader, type KmpEntity, type Vec3 } from '../lib/kmp';
import { getPathInfo, getReferenceCounts } from '../lib/kmpEdit';
import { describeEntity, replaceArchiveFile, validateTrack, type TrackDocument } from '../lib/track';
import objectNamesById from '../generated/mkwObjectNames.json';
import { getAreaInspectorResources } from './areas/areaInspectorConfig';
import { useCameraMode } from './camera/CameraMode';
import { useKmpMode } from './kmp/KmpMode';
import { useMaterialMode } from './material/MaterialMode';
import { useModelMode } from './model/ModelMode';
import type { EditorModeContext, ModeUi } from './modes/types';
import { useVisualMode } from './visual/VisualMode';
import { ContentBrowser, type ContentBrowserActions } from './contentBrowser/ContentBrowser';
import { PlaceAssetsRail } from './contentBrowser/PlaceAssetsRail';
import { downloadBytes } from './downloadFile';
import { libraryAssetSourcePath } from '../lib/assetLibrary';
import { extractModelBrres } from '../lib/brres/extractModel';
import { useAssetLibrary } from './state/useAssetLibrary';
import { buildFillBetweenPositions, getFillBetweenSelection } from './fillBetween';
import { FillBetweenPanel } from './inspector/FillBetweenPanel';
import { InspectorPanel } from './inspector/InspectorPanel';
import { getTrackPostEffectResources } from './inspector/postEffectResources';
import { SelectedEntityInspector } from './inspector/SelectedEntityInspector';
import { Noclip3DViewport, type SceneReloadEvent, type TransformTool, type ViewMode } from './Noclip3DViewport';
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
import { PlaytestHud } from './playtest/PlaytestHud';
import { PlaytestMenu } from './playtest/PlaytestMenu';
import { PLAYTEST_STATUS_MESSAGE, usePlaytestSession } from './playtest/usePlaytestSession';
import './playtest/playtest.css';
import { ModelStudio } from './studio/ModelStudio';
import type { StudioLaunchRequest } from './studio/studioLaunch';
import type { StudioTrackBridge } from './studio/useStudioSession';
import { TopBar } from './topbar/TopBar';
import { clearRecentTracks, readRecentTracks, rememberRecentTrack, type RecentTrack } from './topbar/recentFiles';
import { PanelRail } from './components/Panel';
import { ShortcutOverlay } from './components/ShortcutOverlay';
import { WelcomeOverlay } from './components/WelcomeOverlay';
import { StatusBar, useFrameRate, type StatusBarStat } from './components/StatusBar';
import { shouldToastStatus, classifyStatusMessage, splitStatusMessage } from './components/statusMessage';
import { ToastProvider, ToastViewport, useToastStore } from './components/Toast';

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
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [dragTarget, setDragTarget] = useState(false);
  const [recentTracks, setRecentTracks] = useState<RecentTrack[]>(readRecentTracks);
  /** Bumped by "Refresh track"; the viewport rebuilds its scene whenever this changes. */
  const [sceneRevision, setSceneRevision] = useState(0);
  const [refreshingTrack, setRefreshingTrack] = useState(false);
  /**
   * The Model Studio. It is a workspace over the editor rather than a mode, so the track editor
   * stays mounted underneath and comes back exactly as it was; `studio` is only what it opened
   * with, plus the archive it writes back into when it was opened from the track.
   */
  const [studio, setStudio] = useState<{ open: boolean; initial: { fileName: string; bytes: Uint8Array } | null; archivePath: string | null }>({
    open: false,
    initial: null,
    archivePath: null,
  });
  const studioTouchedTrackRef = useRef(false);
  const refreshingTrackRef = useRef(false);
  const toasts = useToastStore();

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

  const library = useAssetLibrary({ setStatus, showToast: toasts.showToast });
  const browser = useBrowserFolders({ track, objFlow, commonArchive, courseAssetDb, libraryAssets: library.assets });
  const { setBrowserFolder } = browser;

  /** Bytes of one of the loaded track's archives, as loaded (model-mode edits are baked on export). */
  const findTrackArchive = useCallback(
    (path: string): Uint8Array | null => {
      const entries = trackRef.current?.archiveEntries ?? [];
      const exact = entries.find((entry) => entry.type === 'file' && entry.path === path && entry.data);
      const loose = exact ?? entries.find((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith(path.replace(/^\.?\/*/, '').toLowerCase()) && entry.data);
      return loose?.data ?? null;
    },
    [trackRef],
  );

  /** A track archive, or one model out of it as a standalone `.brres`. */
  const trackAssetBytes = useCallback(
    (path: string, modelName: string | null): { fileName: string; bytes: Uint8Array } | null => {
      const archive = findTrackArchive(path);
      if (!archive) {
        toasts.showToast({ tone: 'warning', title: 'Archive not found', detail: `${path} is not in the loaded track.` });
        return null;
      }
      const fileName = path.split('/').pop() ?? path;
      if (modelName === null) return { fileName, bytes: archive };
      try {
        return { fileName: `${modelName}.brres`, bytes: extractModelBrres(archive, modelName).data };
      } catch (error) {
        toasts.showToast({ tone: 'error', title: `Could not export ${modelName}`, detail: error instanceof Error ? error.message : String(error) });
        return null;
      }
    },
    [findTrackArchive, toasts],
  );

  const browserActions = useMemo<ContentBrowserActions>(
    () => ({
      importLibraryFiles: (files) => {
        void library.importFiles(files).then((added) => {
          if (added.length > 0) setBrowserFolder('library');
        });
      },
      removeLibraryAsset: (id) => void library.remove(id),
      renameLibraryAsset: (id, name) => void library.rename(id, name),
      exportLibraryAsset: (id) => {
        const asset = library.get(id);
        if (asset) downloadBytes(asset.fileName, asset.bytes);
      },
      exportTrackAsset: (path, modelName) => {
        const result = trackAssetBytes(path, modelName);
        if (!result) return;
        downloadBytes(result.fileName, result.bytes);
        setStatus(`Exported ${result.fileName} (${result.bytes.length.toLocaleString()} bytes).`);
      },
      saveTrackAssetToLibrary: (path, modelName) => {
        const result = trackAssetBytes(path, modelName);
        if (!result) return;
        void library.importBytes(result.fileName, result.bytes).then((record) => {
          if (!record) return;
          setBrowserFolder('library');
          setStatus(`Saved ${record.name} to My Assets.`);
        });
      },
    }),
    [library, setBrowserFolder, trackAssetBytes],
  );

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

  // ------------------------------------------------------- refresh and unsaved changes

  /** The welcome panel's "Open a track" button and `Ctrl+O` both go through this picker. */
  const openTrackInputRef = useRef<HTMLInputElement | null>(null);
  const openTrackPicker = useCallback(() => openTrackInputRef.current?.click(), []);

  /**
   * "Refresh track": rebuild the 3D viewport from the track document as it is now.
   *
   * Most edits reach the viewport live, but some cannot — a material on a model the scene never
   * loaded, a replaced texture of a different size, a whole archive that was swapped. Bumping
   * `sceneRevision` makes the viewport pack the edited archives and build the scene again, so what
   * is on screen is what would be exported. The camera, the mode and the selection all survive it.
   */
  const refreshTrack = useCallback(() => {
    if (!trackRef.current) {
      setStatus('Open a track before refreshing the viewport.');
      return;
    }
    if (refreshingTrackRef.current) return;
    refreshingTrackRef.current = true;
    setRefreshingTrack(true);
    setStatus('Rebuilding the track with your edits...');
    setSceneRevision((value) => value + 1);
  }, [trackRef]);

  const onSceneReload = useCallback((event: SceneReloadEvent) => {
    if (event.phase === 'start') {
      setStatus(event.message);
      return;
    }
    refreshingTrackRef.current = false;
    setRefreshingTrack(false);
    setStatus(event.message);
  }, []);

  /**
   * The track as it was the last time the user exported it. Anything else means there are edits
   * they have not saved, which the top bar marks so Export is never a surprise.
   */
  const [exportedTrack, setExportedTrack] = useState<TrackDocument | null>(null);
  const unsavedChanges = track !== null && track !== exportedTrack && history.historyState.undo > 0;
  const exportTrackDocument = useCallback(() => {
    const exported = downloadExport();
    if (exported) setExportedTrack(trackRef.current);
    return exported;
    // `downloadExport` closes over the current track, so it is re-created on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadExport, trackRef]);
  const playtest = usePlaytestSession({
    track,
    commonArchive,
    commonArchiveUrl,
    layout,
    showToast: toasts.showToast,
  });

  // ------------------------------------------------------------------ Model Studio

  /**
   * Opens the Model Studio. With no argument it opens on the demo character, which is what the
   * top-bar button does; with a track archive path it opens that archive and wires its material
   * edits back into this track document, so they land in the same undo history as an in-place
   * edit and are in the bytes Export writes.
   */
  const openModelStudio = useCallback(
    (request?: StudioLaunchRequest) => {
      if (request?.file) {
        setStudio({ open: true, initial: request.file, archivePath: null });
        return;
      }
      const path = request?.trackArchivePath;
      if (!path) {
        setStudio({ open: true, initial: null, archivePath: null });
        return;
      }
      // The renderer names archives with noclip's `./` prefix and the track document stores them
      // without it, so the studio is given the document's own spelling — that is the key
      // `replaceArchiveFile` matches on when an edit comes back.
      const wanted = path.replace(/^\.\//, '').toLowerCase();
      const entry = (trackRef.current?.archiveEntries ?? []).find(
        (candidate) => candidate.type === 'file' && candidate.data !== undefined && candidate.path.replace(/^\.\//, '').toLowerCase() === wanted,
      );
      if (!entry?.data) {
        setStatus(`${path} is not in the loaded track, so it cannot be opened in the Model Studio.`);
        return;
      }
      studioTouchedTrackRef.current = false;
      setStudio({
        open: true,
        initial: { fileName: entry.path.split('/').pop() ?? entry.path, bytes: entry.data },
        archivePath: entry.path,
      });
    },
    [trackRef],
  );

  const openModelInStudioFromFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      void file.arrayBuffer().then((buffer) => {
        setStudio({ open: true, initial: { fileName: file.name, bytes: new Uint8Array(buffer) }, archivePath: null });
      });
    },
    [],
  );

  /**
   * How the studio writes back into the track: the same `replaceArchiveFile` +
   * `history.applyEditorChange` path Material mode and Visual mode use, so undo, export and the
   * "unsaved changes" dot all see a studio edit as an ordinary one.
   */
  const studioTrackBridge = useMemo<StudioTrackBridge | null>(() => {
    if (!studio.open || studio.archivePath === null || !track || !studio.initial) return null;
    return {
      origin: { kind: 'track', archivePath: studio.archivePath, trackName: track.fileName },
      bytes: studio.initial.bytes,
      commit: (bytes, message) => {
        const current = trackRef.current;
        if (!current || studio.archivePath === null) return;
        studioTouchedTrackRef.current = true;
        history.applyEditorChange(
          replaceArchiveFile(current, studio.archivePath, bytes),
          selection.selectedIdRef.current,
          true,
          selection.selectedIdsRef.current,
        );
        setStatus(message);
      },
    };
  }, [history, selection, studio.archivePath, studio.initial, studio.open, track, trackRef]);

  const closeModelStudio = useCallback(() => {
    setStudio({ open: false, initial: null, archivePath: null });
    if (!studioTouchedTrackRef.current) return;
    studioTouchedTrackRef.current = false;
    // The track viewport is showing the archive as it was before the studio rewrote it, and the
    // studio can edit far more than one live-swappable material, so the honest thing is the
    // Refresh flow: rebuild the scene from the track as it now is.
    refreshTrack();
  }, [refreshTrack]);

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
    clipboard,
    selected,
    selectedEntities,
    selectedInspector,
    validation,
    objectOptions,
    canBatchReplaceObjects,
    entityLabel,
    setStatus,
    tool,
    viewMode,
    setEditorMode,
    refreshScene: refreshTrack,
    sceneRefreshing: refreshingTrack,
    openModelStudio,
  };
  const kmpModeUi = useKmpMode(modeContext);
  const cameraModeUi = useCameraMode(modeContext);
  const modelModeUi = useModelMode(modeContext);
  const visualModeUi = useVisualMode(modeContext);
  const materialModeUi = useMaterialMode(modeContext);
  const modeUi: ModeUi =
    editorMode === 'camera'
      ? cameraModeUi
      : editorMode === 'model'
        ? modelModeUi
        : editorMode === 'visual'
          ? visualModeUi
          : editorMode === 'material'
            ? materialModeUi
            : kmpModeUi;

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
    downloadExport: exportTrackDocument,
    refreshTrack,
    openTrackPicker,
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

  // ---------------------------------------------------------------- shell chrome

  const trackName = track?.fileName ?? null;
  const { trackUrl, smokeTrackUrl } = trackDocument;

  // A track can only be re-opened later if it came from a URL; file-picked tracks are
  // remembered by name only (browsers never hand a page back a path).
  useEffect(() => {
    if (!trackName) return;
    const startupUrl = trackUrl ?? smokeTrackUrl;
    const url = startupUrl && decodeURIComponent(startupUrl).endsWith(trackName) ? startupUrl : undefined;
    setRecentTracks(rememberRecentTrack({ name: trackName, url }));
  }, [smokeTrackUrl, trackName, trackUrl]);

  // The status line is the shell's only free-text channel. Failures and finished long jobs
  // also get a toast so they survive the next status update.
  const lastToastedStatus = useRef('');
  const { showToast } = toasts;
  useEffect(() => {
    if (status === lastToastedStatus.current || !shouldToastStatus(status)) return;
    lastToastedStatus.current = status;
    const { summary, detail } = splitStatusMessage(status);
    showToast({ tone: classifyStatusMessage(status), title: summary, detail: detail || undefined });
  }, [showToast, status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (document.documentElement.dataset.playtest === 'active') return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
      event.preventDefault();
      setShortcutsOpen((value) => !value);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const fps = useFrameRate(track !== null);
  const statusStats = useMemo<StatusBarStat[]>(() => {
    const stats: StatusBarStat[] = [];
    if (trackSummary) {
      stats.push({ id: 'entities', label: 'Records', value: String(trackSummary.entityCount), title: `${trackSummary.entityCount} editable track records` });
      stats.push({ id: 'routes', label: 'Routes', value: String(trackSummary.routeCount), title: `${trackSummary.routeCount} movement routes` });
    }
    if (selectedIds.length > 0) {
      stats.push({ id: 'selection', label: 'Selected', value: String(selectedIds.length) });
    }
    if (track) {
      stats.push({
        id: 'issues',
        label: 'Issues',
        value: `${validationCounts.errorCount} / ${validationCounts.warningCount}`,
        tone: validationCounts.errorCount > 0 ? 'error' : validationCounts.warningCount > 0 ? 'warning' : 'default',
        title: `${validationCounts.errorCount} errors, ${validationCounts.warningCount} warnings — see the Track tab`,
      });
    }
    if (unsavedChanges) {
      stats.push({ id: 'unsaved', label: 'Edits', value: 'Not exported', tone: 'warning', title: 'This track has changes you have not exported yet' });
    }
    if (fps !== null) stats.push({ id: 'fps', label: 'FPS', value: String(fps), title: 'Viewport frames per second' });
    return stats;
  }, [fps, selectedIds.length, track, trackSummary, unsavedChanges, validationCounts]);

  // The left dock hosts a different panel per mode, so its collapsed rail is labelled per mode.
  const leftDock = useMemo(() => {
    if (editorMode === 'camera') return { title: 'Cameras', icon: <Video size={15} /> };
    if (editorMode === 'model') return { title: 'Outliner', icon: <Boxes size={15} /> };
    if (editorMode === 'visual') return { title: 'Archives', icon: <Layers size={15} /> };
    if (editorMode === 'material') return { title: 'Materials', icon: <Palette size={15} /> };
    return { title: 'Place Assets', icon: <Shapes size={15} /> };
  }, [editorMode]);

  /** The newest recent entry that can actually be re-opened (file picks have no URL). */
  const reopenableRecentTrack = useMemo(() => recentTracks.find((entry) => entry.url) ?? null, [recentTracks]);

  const openRecent = useCallback(
    (entry: RecentTrack) => {
      if (!entry.url) return;
      const url = new URL(window.location.href);
      url.searchParams.delete('smokeTrack');
      url.searchParams.set('track', entry.url);
      window.location.href = url.toString();
    },
    [],
  );

  return (
    <ToastProvider value={toasts}>
    <main
      ref={layout.appShellRef}
      className={dragTarget ? 'appShell isDragTarget' : 'appShell'}
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer.types.includes('Files')) setDragTarget(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragTarget(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragTarget(false);
        if (event.dataTransfer.files.length > 0) void trackDocument.openFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={openTrackInputRef}
        hidden
        type="file"
        accept=".szs"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          void trackDocument.openFiles(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
      <TopBar
        topBarRef={layout.topBarRef}
        historyState={history.historyState}
        editorMode={editorMode}
        inspectorOpen={layout.inspectorOpen}
        leftDockOpen={layout.placeAssetsOpen}
        browserOpen={layout.browserOpen}
        canExport={track !== null}
        trackName={trackName}
        recentTracks={recentTracks}
        onOpenFiles={(files) => void trackDocument.openFiles(files)}
        onImportCommonArchive={(files) => void trackDocument.importCommonArchive(files)}
        onOpenRecent={openRecent}
        onClearRecent={() => setRecentTracks(clearRecentTracks())}
        onUndo={history.undoEdit}
        onRedo={history.redoEdit}
        onToggleInspector={() => layout.setInspectorOpen((value) => !value)}
        onToggleLeftDock={() => layout.setPlaceAssetsOpen((value) => !value)}
        onToggleBrowser={() => layout.setBrowserOpen((value) => !value)}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onExport={exportTrackDocument}
        onRefreshTrack={refreshTrack}
        refreshingTrack={refreshingTrack}
        unsavedChanges={unsavedChanges}
        onChangeEditorMode={setEditorMode}
        onOpenModelStudio={() => openModelStudio()}
        onOpenModelInStudio={openModelInStudioFromFiles}
        playtestControl={
          <PlaytestMenu
            options={playtest.options}
            onChangeOptions={playtest.setOptions}
            disabledReason={playtest.disabledReason}
            loading={playtest.loading}
            onStart={playtest.start}
          />
        }
      />

      <div ref={layout.shellBodyRef} className={layout.inspectorOpen ? 'shellBody' : 'shellBody inspectorCollapsed'} style={layout.workspaceStyle}>
        <div ref={layout.workspaceRef} className={layout.placeAssetsOpen ? 'workspace' : 'workspace placeAssetsCollapsed'}>
          {layout.placeAssetsOpen ? (
            modeUi.leftPanel ?? (
              <PlaceAssetsRail
                onToggle={() => layout.setPlaceAssetsOpen(false)}
                quickObjectOptions={quickObjectOptions}
                objFlow={objFlow}
                commonArchive={commonArchive}
                commonBrresSummaries={commonBrresSummaries}
              />
            )
          ) : (
            <PanelRail title={leftDock.title} icon={leftDock.icon} onExpand={() => layout.setPlaceAssetsOpen(true)} />
          )}
          {layout.placeAssetsOpen && (
            <div
              className={layout.sidebarResizing === 'placeAssets' ? 'dockHandle dockHandleLeft isActive' : 'dockHandle dockHandleLeft'}
              onPointerDown={(event) => layout.beginSidebarResize('placeAssets', event)}
              onDoubleClick={() => layout.resetSidebarSize('placeAssets')}
              role="separator"
              aria-orientation="vertical"
              aria-label={`Resize ${leftDock.title.toLowerCase()} panel`}
              title="Drag to resize · double-click to reset"
            />
          )}
          <Noclip3DViewport
            track={track}
            selectedId={selectedId}
            selectedIds={selectedIds}
            mode={editorMode === 'material' ? 'visual' : editorMode}
            fillBetweenPreviewPositions={fillBetweenPreviewPositions}
            smokeCommonUrl={trackDocument.smokeCommonUrl}
            commonArchiveUrl={commonArchiveUrl}
            sceneRevision={sceneRevision}
            onSceneReload={onSceneReload}
            loadProgress={trackDocument.loadProgress}
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
            onPlaceLibraryAsset={(assetId, position) => {
              const asset = library.get(assetId);
              if (!asset) return;
              modelModeUi.placeModelAsset({ sourcePath: libraryAssetSourcePath(asset), label: asset.name, data: asset.bytes }, position);
              // Placed scenery is edited in Model mode, so go there to show the gizmo on it.
              if (editorMode !== 'model') setEditorMode('model');
            }}
            onAddKmpPoint={editActions.addKmpPoint}
            onInsertRoutePoint={editActions.insertRoutePoint}
            onInteractionStart={history.beginEditSession}
            onInteractionEnd={history.endEditSession}
            playtestSession={playtest.viewportSession}
            overlay={
              playtest.active ? (
                <PlaytestHud loading={playtest.loading} hudRef={playtest.hudRef} onRestart={playtest.restart} onExit={playtest.stop} />
              ) : track === null ? (
                <WelcomeOverlay
                  onOpenTrack={openTrackPicker}
                  recentTrackName={reopenableRecentTrack?.name ?? null}
                  onOpenRecent={reopenableRecentTrack ? () => openRecent(reopenableRecentTrack) : undefined}
                />
              ) : null
            }
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

        {layout.inspectorOpen ? (
        <InspectorPanel
          inspectorOpen={layout.inspectorOpen}
          onBeginResize={(event) => layout.beginSidebarResize('inspector', event)}
          onResetSize={() => layout.resetSidebarSize('inspector')}
          onClose={() => layout.setInspectorOpen(false)}
          inspectorSection={inspectorSection}
          onChangeInspectorSection={setInspectorSection}
          editorMode={editorMode}
          modeContent={modeUi.inspector}
          track={track}
          trackSummary={trackSummary}
          selected={selected}
          selectedEntities={selectedEntities}
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
        ) : (
          <PanelRail
            side="right"
            title="Inspector"
            icon={<RouteIcon size={15} />}
            onExpand={() => layout.setInspectorOpen(true)}
          />
        )}

        {/* A mode may take the bottom dock over (Material mode puts the shader graph there); the
            shell keeps owning its size, so the content browser comes back exactly as it was. */}
        {modeUi.bottomDock ? (
          modeUi.bottomDock({
            open: layout.browserOpen,
            height: layout.browserHeight,
            collapsedHeight: CONTENT_BROWSER_COLLAPSED_HEIGHT,
            resizing: layout.browserResizing,
            onBeginResize: layout.beginBrowserResize,
            onResetSize: layout.resetBrowserSize,
            onToggleOpen: () => layout.setBrowserOpen((value) => !value),
          })
        ) : (
        <ContentBrowser
          open={layout.browserOpen}
          height={layout.browserHeight}
          collapsedHeight={CONTENT_BROWSER_COLLAPSED_HEIGHT}
          resizing={layout.browserResizing}
          onBeginResize={layout.beginBrowserResize}
          onResetSize={layout.resetBrowserSize}
          onToggleOpen={() => layout.setBrowserOpen((value) => !value)}
          folders={browser.browserFolders}
          activeFolderId={browser.activeBrowserFolder?.id}
          filteredFolder={browser.filteredBrowserFolder}
          query={browser.browserQuery}
          onChangeQuery={browser.setBrowserQuery}
          onChangeFolder={browser.setBrowserFolder}
          track={track}
          commonArchive={commonArchive}
          commonBrresSummaries={commonBrresSummaries}
          actions={browserActions}
        />
        )}
      </div>

      <StatusBar message={playtest.active ? PLAYTEST_STATUS_MESSAGE : status} stats={statusStats} />
      <ToastViewport toasts={toasts.toasts} onDismiss={toasts.dismissToast} />
      <ShortcutOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {studio.open && (
        <ModelStudio
          onClose={closeModelStudio}
          trackBridge={studioTrackBridge}
          initialOpen={studio.initial}
          onSaveToAssets={(fileName, bytes) => library.importBytes(fileName, bytes)}
        />
      )}
    </main>
    </ToastProvider>
  );
}
