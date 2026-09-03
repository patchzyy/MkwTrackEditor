import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { replaceArchiveFile, type TrackDocument } from '../../lib/track';
import type { CompiledShader, GxArchiveMaterials, GxMaterialDoc, GxMaterialRef } from '../../lib/gxMaterial';
import { REFRESH_TRACK_SHORTCUT, RefreshTrackButton, useToast } from '../components';
import type { EditorModeContext, ModeUi } from '../modes/types';
import { MaterialInspector } from './MaterialInspector';
import { MaterialOutliner } from './MaterialOutliner';
import { MaterialViewOverlay } from './MaterialViewOverlay';
import { ShaderGraphDock } from './ShaderGraphDock';
import {
  autoLayout,
  emptyGraph,
  type EditorShaderGraph,
} from './graphModel';
import { loadStoredGraph, saveStoredGraph, sessionGraphKey } from './graphStore';
import { ensureLayerCount, materialDocEquals, withChannelLighting } from './materialDoc';
import { loadMaterialLibrary, type GxMaterialLibrary } from './materialLibrary';
import {
  buildMaterialTree,
  findArchiveBytes,
  listMaterialArchives,
  materialRefEquals,
  materialRefKey,
} from './materialOutlinerModel';
import {
  findMaterialMeshes,
  highlightMaterialMeshes,
  soloMaterialMeshes,
  type MaterialRendererScene,
  type SceneMeshEntry,
} from './materialScene';
import './material.css';

/** How long after the last graph edit the compiler runs. Short enough to feel immediate. */
const COMPILE_DEBOUNCE_MS = 50;
/** Undo steps kept per material's graph. */
const GRAPH_HISTORY_LIMIT = 64;
/**
 * What the status line says when an edit is saved into the track but the running viewport could
 * not be updated in place — the model is not one the scene draws, or the archive changed too much
 * to patch. The edit is not lost; the picture just needs a rebuild.
 */
const HOT_SWAP_FAILED_HINT = `The viewport cannot show this one live, so press Refresh (${REFRESH_TRACK_SHORTCUT}) to rebuild it.`;

/** The file name of an archive, for a sentence that should not read like a path. */
function archiveFileName(path: string): string {
  return path.split('/').pop() ?? path;
}

export type MaterialDockTab = 'graph' | 'stages';

/**
 * Material mode: authoring one BRRES material — its layers, lighting channels, colours, blend and
 * depth state, and the TEV shader as a node graph.
 *
 * The split is the one `src/lib/gxMaterial/types.ts` describes: this half never touches MDL0
 * bytes and never implements TEV semantics. It decodes a material into a `GxMaterialDoc`, edits
 * that document, asks the library to lower the graph to stages and to write the document back,
 * and pushes the rewritten archive at the renderer's `reloadEditorMaterial` so the viewport
 * updates without a scene rebuild.
 */
export function useMaterialMode(ctx: EditorModeContext): ModeUi {
  const active = ctx.editorMode === 'material';
  const { track, history, selection, setStatus, refreshScene, sceneRefreshing } = ctx;
  const toast = useToast();

  const sceneRef = useRef<MaterialRendererScene | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);

  const [library, setLibrary] = useState<GxMaterialLibrary | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selectedRef, setSelectedRef] = useState<GxMaterialRef | null>(null);
  const [hoveredRef, setHoveredRef] = useState<GxMaterialRef | null>(null);
  const [dockTab, setDockTab] = useState<MaterialDockTab>('graph');
  const [solo, setSolo] = useState(false);

  /**
   * The archives that have been listed, and the exact bytes they were listed from. Listing walks
   * the whole BRRES, so it runs once per archive and is *not* redone after an edit: the decoded
   * documents below are the source of truth from then on, and the only summary field an edit can
   * change (the material's name) is patched in place.
   */
  const [archives, setArchives] = useState<Record<string, GxArchiveMaterials>>({});
  const pinnedBytesRef = useRef(new Map<string, Uint8Array>());

  /** Working documents, keyed by material. Committing an edit updates the entry here too. */
  const [docs, setDocs] = useState<Record<string, GxMaterialDoc>>({});
  /**
   * The documents that go with each version of the track. Undo and redo swap the whole
   * `TrackDocument` out from under this mode, and re-decoding the material from the restored bytes
   * would mean re-parsing a multi-megabyte BRRES on every Ctrl+Z. Remembering the document that
   * produced each version instead makes the round trip free and exact. A `WeakMap` because the
   * history's snapshots are the only thing keeping those track objects alive.
   */
  const docsByTrackRef = useRef(new WeakMap<TrackDocument, Record<string, GxMaterialDoc>>());
  const [graphs, setGraphs] = useState<Record<string, EditorShaderGraph>>({});
  const [compiled, setCompiled] = useState<CompiledShader | null>(null);
  const graphHistoryRef = useRef(new Map<string, { undo: EditorShaderGraph[]; redo: EditorShaderGraph[] }>());
  const warnedRef = useRef(new Set<string>());
  /**
   * Graphs the user has actually edited. Compiling a freshly decompiled graph is a round trip
   * that may not be bit-exact, so only an edited graph is allowed to overwrite the material's
   * stages — otherwise merely selecting a material would rewrite it.
   */
  const editedGraphsRef = useRef(new Set<string>());
  /**
   * The sentence the next automatic "compiled graph becomes the stages" write should use. Set by
   * the actions that change the graph and the material together, so the generic line does not
   * replace theirs.
   */
  const pendingGraphStatusRef = useRef<string | null>(null);

  const archiveEntries = useMemo(() => listMaterialArchives(track), [track]);
  const selectedKey = selectedRef ? materialRefKey(selectedRef) : null;
  const doc = selectedKey ? (docs[selectedKey] ?? null) : null;
  const graph = selectedRef ? (graphs[sessionGraphKey(selectedRef)] ?? null) : null;

  // ------------------------------------------------------------------ library and archives

  useEffect(() => {
    if (!active || library !== null || libraryError !== null) return;
    let cancelled = false;
    void loadMaterialLibrary().then(
      (module) => { if (!cancelled) setLibrary(module); },
      (error: unknown) => { if (!cancelled) setLibraryError(error instanceof Error ? error.message : String(error)); },
    );
    return () => { cancelled = true; };
  }, [active, library, libraryError]);

  // A new track invalidates everything that was read out of the old one.
  useEffect(() => {
    pinnedBytesRef.current = new Map();
    warnedRef.current = new Set();
    graphHistoryRef.current = new Map();
    setArchives({});
    setDocs({});
    setGraphs({});
    setSelectedRef(null);
    setCompiled(null);
  }, [track?.fileName]);

  // The first archive (the course model) is opened on entering the mode; anything else waits for
  // the user to expand it, because listing an archive parses the whole BRRES.
  useEffect(() => {
    if (!active || expanded.length > 0 || archiveEntries.length === 0) return;
    setExpanded([archiveEntries[0].path]);
  }, [active, archiveEntries, expanded.length]);

  useEffect(() => {
    if (!active || !library || !track) return;
    const missing = expanded.filter((path) => archives[path] === undefined);
    if (missing.length === 0) return;
    const next: Record<string, GxArchiveMaterials> = {};
    for (const path of missing) {
      const bytes = findArchiveBytes(track, path);
      if (!bytes) continue;
      try {
        next[path] = library.listArchiveMaterials(path, bytes);
        pinnedBytesRef.current.set(path, bytes);
      } catch (error) {
        setStatus(`The ${archiveFileName(path)} archive could not be read, so its materials are not listed.`);
        toast.showToast({
          tone: 'warning',
          title: `${archiveFileName(path)} could not be read`,
          detail: error instanceof Error ? error.message : String(error),
        });
        next[path] = { archivePath: path, models: [], textures: [] };
      }
    }
    if (Object.keys(next).length > 0) setArchives((current) => ({ ...current, ...next }));
  }, [active, archives, expanded, library, setStatus, toast, track]);

  const tree = useMemo(
    () => buildMaterialTree(archiveEntries, new Map(Object.entries(archives)), query),
    [archiveEntries, archives, query],
  );
  const selectedArchive = selectedRef ? (archives[selectedRef.archivePath] ?? null) : null;

  // ------------------------------------------------------------------ decode on selection

  const decodeSelected = useCallback(
    (ref: GxMaterialRef): GxMaterialDoc | null => {
      if (!library) return null;
      const bytes = pinnedBytesRef.current.get(ref.archivePath) ?? findArchiveBytes(track, ref.archivePath);
      if (!bytes) return null;
      try {
        return library.decodeMaterial(bytes, ref.modelName, ref.materialName);
      } catch (error) {
        setStatus(`${ref.materialName} could not be read, so it cannot be edited.`);
        return null;
      }
    },
    [library, setStatus, track],
  );

  useEffect(() => {
    if (!active || !selectedRef || !library) return;
    const key = materialRefKey(selectedRef);
    if (docs[key]) return;
    const decoded = decodeSelected(selectedRef);
    if (!decoded) return;
    setDocs((current) => {
      const next = { ...current, [key]: decoded };
      if (track) docsByTrackRef.current.set(track, next);
      return next;
    });
  }, [active, decodeSelected, docs, library, selectedRef, track]);

  /**
   * Undo and redo restore an older `TrackDocument`; the working documents have to follow, or the
   * inspector keeps showing the edit that was just undone.
   */
  useEffect(() => {
    if (!active || !track) return;
    const stored = docsByTrackRef.current.get(track);
    if (!stored) return;
    setDocs((current) => (current === stored ? current : { ...current, ...stored }));
  }, [active, track]);

  // A material's graph starts as the decompiled stages, unless an authored one was stored for
  // exactly these stages in a previous session.
  useEffect(() => {
    if (!active || !selectedRef || !library || !doc) return;
    const key = sessionGraphKey(selectedRef);
    if (graphs[key]) return;
    let cancelled = false;
    // A freshly decompiled graph is laid out by the editor rather than trusted as it comes: the
    // decompiler orders nodes by stage but does not know how tall this editor draws them, so
    // without this the source nodes of one stage sit on top of the next stage's cluster.
    const fallback = autoLayout(library.decompileShader(doc));
    void loadStoredGraph(selectedRef, doc.tevStages).then((stored) => {
      if (cancelled) return;
      setGraphs((current) => (current[key] ? current : { ...current, [key]: stored ?? fallback }));
    });
    return () => { cancelled = true; };
  }, [active, doc, graphs, library, selectedRef]);

  // ------------------------------------------------------------------ compile

  useEffect(() => {
    if (!active || !library || !graph || !doc) return;
    const timer = window.setTimeout(() => {
      setCompiled(library.compileShaderGraph(graph, doc));
    }, COMPILE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [active, doc, graph, library]);

  // ------------------------------------------------------------------ committing edits

  const surfaceWarnings = useCallback(
    (warnings: readonly string[]) => {
      for (const message of warnings) {
        if (warnedRef.current.has(message)) continue;
        warnedRef.current.add(message);
        toast.showToast({ tone: 'warning', title: 'Material editor', detail: message });
      }
    },
    [toast],
  );

  const pushToRenderer = useCallback((ref: GxMaterialRef, bytes: Uint8Array): boolean => {
    return sceneRef.current?.reloadEditorMaterial?.(`./${ref.archivePath.replace(/^\.\//, '')}`, ref.modelName, ref.materialName, bytes) ?? false;
  }, []);

  /**
   * One committed edit: write the document into the archive, put the new bytes in the track
   * document (which is what undo and export both read), and hot-swap the material in the viewport.
   * `transient` edits — a slider mid-drag — only update the working document, so a whole drag
   * coalesces into the single history entry its release produces.
   */
  const updateDoc = useCallback(
    (next: GxMaterialDoc, options: { transient?: boolean; status?: string } = {}) => {
      const ref = selectedRef;
      if (!ref) return;
      const key = materialRefKey(ref);
      const nextDocs = { ...docs, [key]: next };
      setDocs(nextDocs);
      if (options.transient || !library || !track) return;

      const bytes = findArchiveBytes(track, ref.archivePath);
      if (!bytes) return;
      try {
        const result = library.applyMaterial(bytes, ref.modelName, ref.materialName, next);
        const nextTrack = replaceArchiveFile(track, ref.archivePath, result.brres);
        // Both versions of the track remember the documents that go with them, so undo and redo
        // put the inspector back where it was without re-decoding anything.
        docsByTrackRef.current.set(track, docs);
        docsByTrackRef.current.set(nextTrack, nextDocs);
        history.applyEditorChange(
          nextTrack,
          selection.selectedIdRef.current,
          true,
          selection.selectedIdsRef.current,
        );
        surfaceWarnings(result.warnings);
        const live = pushToRenderer(ref, result.brres);
        if (options.status) setStatus(live ? options.status : `${options.status} ${HOT_SWAP_FAILED_HINT}`);
      } catch (error) {
        setStatus(`${ref.materialName} could not be saved into the track, so nothing was changed.`);
        toast.showToast({
          tone: 'error',
          title: `${ref.materialName} could not be saved`,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [docs, history, library, pushToRenderer, selectedRef, selection, setStatus, surfaceWarnings, track],
  );

  // ------------------------------------------------------------------ graph editing

  const setGraph = useCallback(
    (next: EditorShaderGraph, options: { record?: boolean; undoFrom?: EditorShaderGraph; edited?: boolean } = {}) => {
      const ref = selectedRef;
      if (!ref) return;
      const key = sessionGraphKey(ref);
      if (options.record !== false) {
        const entry = graphHistoryRef.current.get(key) ?? { undo: [], redo: [] };
        // `undoFrom` is how a drag coalesces: the moves during the drag are not recorded, and the
        // release records the graph as it was before the drag started.
        const before = options.undoFrom ?? graphs[key];
        if (before) {
          entry.undo = [...entry.undo.slice(-(GRAPH_HISTORY_LIMIT - 1)), before];
          entry.redo = [];
          graphHistoryRef.current.set(key, entry);
        }
      }
      if (options.edited === false) editedGraphsRef.current.delete(key);
      else if (options.record !== false) editedGraphsRef.current.add(key);
      setGraphs((current) => ({ ...current, [key]: next }));
    },
    [graphs, selectedRef],
  );

  const stepGraphHistory = useCallback(
    (direction: 'undo' | 'redo') => {
      const ref = selectedRef;
      if (!ref) return;
      const key = sessionGraphKey(ref);
      const entry = graphHistoryRef.current.get(key);
      const current = graphs[key];
      if (!entry || !current) return;
      const stack = direction === 'undo' ? entry.undo : entry.redo;
      const snapshot = stack.at(-1);
      if (!snapshot) return;
      if (direction === 'undo') {
        entry.undo = entry.undo.slice(0, -1);
        entry.redo = [...entry.redo.slice(-(GRAPH_HISTORY_LIMIT - 1)), current];
      } else {
        entry.redo = entry.redo.slice(0, -1);
        entry.undo = [...entry.undo.slice(-(GRAPH_HISTORY_LIMIT - 1)), current];
      }
      graphHistoryRef.current.set(key, entry);
      setGraphs((currentGraphs) => ({ ...currentGraphs, [key]: snapshot }));
      setStatus(direction === 'undo' ? 'Undid the last change to the shader graph.' : 'Redid the last change to the shader graph.');
    },
    [graphs, selectedRef, setStatus],
  );

  const graphHistoryState = useMemo(() => {
    const entry = selectedRef ? graphHistoryRef.current.get(sessionGraphKey(selectedRef)) : undefined;
    return { undo: entry?.undo.length ?? 0, redo: entry?.redo.length ?? 0 };
  }, [graphs, selectedRef]);

  /** A compiled graph becomes the material's stages, as one history entry. */
  const applyCompiled = useCallback(() => {
    if (!doc || !compiled || !compiled.ok) return;
    const next = { ...doc, tevStages: compiled.tevStages.map((stage) => ({ ...stage })) };
    if (materialDocEquals(next, doc)) return;
    // A preset changes the graph and the material in one action, so the write the compiler
    // triggers a moment later has to keep the preset's own sentence instead of the generic one.
    const status = pendingGraphStatusRef.current ?? `Updated ${doc.name} to match the shader graph.`;
    pendingGraphStatusRef.current = null;
    updateDoc(next, { status });
  }, [compiled, doc, updateDoc]);

  // Writing the compiled stages back is what makes the graph the thing that draws. It only runs
  // when the compile succeeded; a broken graph keeps the last good stages on screen.
  const lastAppliedRef = useRef<string>('');
  useEffect(() => {
    if (!active || !doc || !compiled?.ok || !selectedRef) return;
    if (!editedGraphsRef.current.has(sessionGraphKey(selectedRef))) return;
    const fingerprint = JSON.stringify(compiled.tevStages);
    if (fingerprint === JSON.stringify(doc.tevStages)) {
      lastAppliedRef.current = fingerprint;
      return;
    }
    if (fingerprint === lastAppliedRef.current) return;
    lastAppliedRef.current = fingerprint;
    applyCompiled();
  }, [active, applyCompiled, compiled, doc, selectedRef]);

  // Authored layouts survive reopening the track, but only while the stages still match.
  useEffect(() => {
    if (!active || !selectedRef || !graph || !doc) return;
    const timer = window.setTimeout(() => void saveStoredGraph(selectedRef, doc.tevStages, graph), 600);
    return () => window.clearTimeout(timer);
  }, [active, doc, graph, selectedRef]);

  const resetGraphFromStages = useCallback(() => {
    if (!library || !doc) return;
    // A re-decompile is a view of the stages the material already has, not a new shader, so it
    // does not count as an edit and must not write the compiler's round trip back over them.
    setGraph(autoLayout(library.decompileShader(doc)), { edited: false });
    setStatus(`Rebuilt the graph from ${doc.name} as it is now.`);
  }, [doc, library, setGraph, setStatus]);

  const applyPreset = useCallback(
    (presetId: string) => {
      if (!library || !doc) return;
      const preset = library.SHADER_GRAPH_PRESETS.find((entry) => entry.id === presetId);
      if (!preset) return;
      pendingGraphStatusRef.current = `Applied the "${preset.title}" shader.`;
      setGraph(preset.graph);

      // A preset can need more than a graph: extra layers to sample, and — for the lit ones —
      // lighting on channel 0, which is material state the graph has no way to express.
      const fallbackTexture = doc.samplers[0]?.texture ?? selectedArchive?.textures[0]?.name ?? '';
      let next = ensureLayerCount(doc, preset.samplerCount, fallbackTexture);
      if (library.PRESET_WANTS_LIGHTING.has(preset.id)) next = withChannelLighting(next);
      if (materialDocEquals(next, doc)) {
        setStatus(`Applied the "${preset.title}" shader.`);
        return;
      }
      updateDoc(next, { status: `Applied the "${preset.title}" shader.` });
    },
    [doc, library, selectedArchive, setGraph, setStatus, updateDoc],
  );

  const runAutoLayout = useCallback(() => {
    if (!graph) return;
    setGraph(autoLayout(graph));
    setStatus('Laid the shader graph out left to right.');
  }, [graph, setGraph, setStatus]);

  // ------------------------------------------------------------------ viewport

  const onVisualSceneChange = useCallback((scene: MaterialRendererScene | null) => {
    sceneRef.current = scene;
    setSceneVersion((version) => version + 1);
  }, []);

  const selectedMeshes = useMemo<SceneMeshEntry[]>(
    () => (active && selectedRef ? findMaterialMeshes(sceneRef.current, selectedRef.archivePath, selectedRef.modelName, selectedRef.materialName) : []),
    [active, selectedRef, sceneVersion],
  );
  const hoveredMeshes = useMemo<SceneMeshEntry[]>(
    () => (active && hoveredRef && !materialRefEquals(hoveredRef, selectedRef)
      ? findMaterialMeshes(sceneRef.current, hoveredRef.archivePath, hoveredRef.modelName, hoveredRef.materialName)
      : []),
    [active, hoveredRef, selectedRef, sceneVersion],
  );

  useEffect(() => {
    if (!active) return;
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setEditorMeshHighlight?.([
      ...selectedMeshes.map((mesh) => ({ target: mesh, selected: true })),
      ...hoveredMeshes.map((mesh) => ({ target: mesh, selected: false })),
    ]);
  }, [active, hoveredMeshes, selectedMeshes]);

  useEffect(() => {
    if (!active) return;
    soloMaterialMeshes(sceneRef.current, solo ? selectedMeshes : []);
  }, [active, selectedMeshes, solo]);

  // Leaving the mode must not leave the viewport soloed or wearing a highlight.
  useEffect(() => {
    if (active) return;
    highlightMaterialMeshes(sceneRef.current, [], false);
    soloMaterialMeshes(sceneRef.current, []);
    setSolo(false);
  }, [active]);

  const frameSelection = useCallback(() => {
    if (selectedMeshes.length === 0) {
      setStatus('The viewport is not drawing this material, so there is nothing to frame.');
      return;
    }
    setStatus(`${selectedMeshes.length} mesh${selectedMeshes.length === 1 ? '' : 'es'} use this material.`);
  }, [selectedMeshes.length, setStatus]);

  const selectMaterial = useCallback(
    (ref: GxMaterialRef | null) => {
      setSelectedRef(ref);
      if (ref) setStatus(`Selected ${ref.materialName}.`);
    },
    [setStatus],
  );

  // ------------------------------------------------------------------ textures

  const importTexture = useCallback(
    (options: { name: string; format: number; width: number; height: number; mipCount: number; data: Uint8Array }): boolean => {
      const ref = selectedRef;
      if (!ref || !library || !track) return false;
      const bytes = findArchiveBytes(track, ref.archivePath);
      if (!bytes) return false;
      const next = library.addTexture(bytes, {
        name: options.name,
        format: options.format as never,
        width: options.width,
        height: options.height,
        mipCount: options.mipCount,
        data: options.data,
      });
      history.applyEditorChange(
        replaceArchiveFile(track, ref.archivePath, next),
        selection.selectedIdRef.current,
        true,
        selection.selectedIdsRef.current,
      );
      const live = sceneRef.current?.addEditorTexture?.(options.name, options) ?? false;
      if (next === bytes) {
        surfaceWarnings(['The texture writer is not wired up yet, so an imported texture previews in the viewport but is not stored in the archive.']);
      }
      setStatus(live ? `Imported ${options.name}.` : `Imported ${options.name}. ${HOT_SWAP_FAILED_HINT}`);
      return true;
    },
    [history, library, selectedRef, selection, setStatus, surfaceWarnings, track],
  );

  if (!active) return {};

  const archiveTextures = selectedArchive?.textures ?? [];
  const materialIssues = library && doc ? library.collectMaterialIssues(doc) : [];
  const archiveBytes = selectedRef ? (pinnedBytesRef.current.get(selectedRef.archivePath) ?? findArchiveBytes(track, selectedRef.archivePath)) : null;

  return {
    viewportProps: {
      mode: 'visual',
      showKmpEditorOverlay: false,
      onVisualSceneChange,
    },
    leftPanel: (
      <MaterialOutliner
        tree={tree}
        query={query}
        onChangeQuery={setQuery}
        expanded={expanded}
        onChangeExpanded={setExpanded}
        selected={selectedRef}
        onSelect={selectMaterial}
        onHover={setHoveredRef}
        loading={library === null && libraryError === null}
        error={libraryError}
        hasTrack={track !== null}
      />
    ),
    inspector: (
      <MaterialInspector
        materialRef={selectedRef}
        doc={doc}
        issues={materialIssues}
        textures={archiveTextures}
        archivePath={selectedRef?.archivePath ?? ''}
        archiveBytes={archiveBytes}
        meshCount={selectedMeshes.length}
        summary={selectedArchive?.models.find((model) => model.modelName === selectedRef?.modelName)?.materials.find((material) => material.materialName === selectedRef?.materialName) ?? null}
        onChange={updateDoc}
        onImportTexture={importTexture}
        hasTrack={track !== null}
      />
    ),
    topRightOverlay: (
      <>
        <MaterialViewOverlay
          materialRef={selectedRef}
          meshCount={selectedMeshes.length}
          solo={solo}
          onToggleSolo={() => setSolo((value) => !value)}
          onFrame={frameSelection}
        />
        <div className="viewportOverlayPanel viewportRefreshPanel">
          <RefreshTrackButton onRefresh={refreshScene} refreshing={sceneRefreshing} hasTrack={track !== null} />
          <p className="viewportOverlayHint">
            {sceneRefreshing
              ? 'Building the track again with your edits...'
              : 'Rebuilds the track so every edited material and texture is on screen.'}
          </p>
        </div>
      </>
    ),
    bottomDock: (dock) => (
      <ShaderGraphDock
        {...dock}
        tab={dockTab}
        onChangeTab={setDockTab}
        materialRef={selectedRef}
        doc={doc}
        graph={graph ?? (selectedRef ? emptyGraph() : null)}
        compiled={compiled}
        graphDrivesMaterial={selectedRef !== null && editedGraphsRef.current.has(sessionGraphKey(selectedRef))}
        presets={library?.SHADER_GRAPH_PRESETS ?? []}
        historyState={graphHistoryState}
        textures={archiveTextures}
        archivePath={selectedRef?.archivePath ?? ''}
        archiveBytes={archiveBytes}
        onChangeGraph={setGraph}
        onUndo={() => stepGraphHistory('undo')}
        onRedo={() => stepGraphHistory('redo')}
        onResetFromStages={resetGraphFromStages}
        onApplyPreset={applyPreset}
        onAutoLayout={runAutoLayout}
        onChangeDoc={updateDoc}
      />
    ),
  };
}
