import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listArchiveMaterialsBrief, listModelSlots } from '../../lib/materialSlots';
import type { SurfaceHighlight, SurfacePick, SurfacePickingOptions } from '../../lib/surfacePick';
import {
  ensureTrackLocalArchive,
  findTrackArchiveEntry,
  replaceArchiveFile,
  resolveArchiveBytes,
  type TrackDocument,
} from '../../lib/track';
import type { CompiledShader, GxArchiveMaterials, GxMaterialDoc, GxMaterialRef } from '../../lib/gxMaterial';
import { useToast } from '../components';
import { getKnownObjectName, humanizeObjectName } from '../labels';
import type { EditorModeContext, ModeUi } from '../modes/types';
import { MaterialInspector } from './MaterialInspector';
import { MaterialOutliner } from './MaterialOutliner';
import { ModelMaterialsStrip } from './ModelMaterialsStrip';
import { ShaderGraphDock } from './ShaderGraphDock';
import {
  autoLayout,
  countRawStages,
  emptyGraph,
  type EditorGraphNode,
  type EditorShaderGraph,
} from './graphModel';
import { loadStoredGraph, saveStoredGraph, sessionGraphKey } from './graphStore';
import {
  buildModelMaterialRows,
  contextFromPick,
  contextTitle,
  friendlyFileName,
  type MaterialContext,
} from './materialContext';
import { ensureLayerCount, materialDocEquals, withChannelLighting } from './materialDoc';
import { loadMaterialLibrary, type GxMaterialLibrary } from './materialLibrary';
import {
  archiveKey,
  buildMaterialTree,
  findArchiveBytes,
  listMaterialArchives,
  materialRefEquals,
  materialRefKey,
  type ExtraMaterialArchive,
  type MaterialArchiveEntry,
} from './materialOutlinerModel';
import {
  findMaterialMeshes,
  soloMaterialMeshes,
  toSceneArchivePath,
  type MaterialRendererScene,
  type SceneMeshEntry,
} from './materialScene';
import { useIdleCommit } from './useIdleCommit';
import './material.css';

/** How long after the last graph edit the compiler runs. Short enough to feel immediate. */
const COMPILE_DEBOUNCE_MS = 50;
/** Undo steps kept per material's graph. */
const GRAPH_HISTORY_LIMIT = 64;

/** A material whose edits are in the editor but not yet in the track or the viewport. */
interface DirtyMaterial {
  ref: GxMaterialRef;
  doc: GxMaterialDoc;
  /** What to call the model in status lines ("Item Box"). */
  label: string;
}

export type MaterialDockTab = 'graph' | 'stages';

/**
 * Material mode: click a surface in the viewport and edit the material it is painted with — its
 * layers, lighting channels, colours, blend and depth state, and the TEV shader as a node graph.
 *
 * The split is the one `src/lib/gxMaterial/types.ts` describes: this half never touches MDL0
 * bytes and never implements TEV semantics. It decodes a material into a `GxMaterialDoc`, edits
 * that document, asks the library to lower the graph to stages and to write the document back.
 *
 * Edits are **held until the author pauses** (`IDLE_COMMIT_MS`): every change updates the working
 * document at once (the inspector and graph never lag) and restarts a countdown; when it runs out,
 * the dirty materials are written into the track as one undo step and hot-swapped into the
 * viewport, falling back to a scene rebuild when the swap cannot apply. Undo, Export, the top bar,
 * switching material and leaving the mode all flush the countdown first.
 */
export function useMaterialMode(ctx: EditorModeContext): ModeUi {
  const active = ctx.editorMode === 'material';
  const { track, history, selection, setStatus, sceneRefreshing, commonArchive } = ctx;
  const toast = useToast();

  // Everything the commit needs is read through this, so a timer that fires later never sees a
  // stale track, history or common archive.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const sceneRef = useRef<MaterialRendererScene | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);

  const [library, setLibrary] = useState<GxMaterialLibrary | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const libraryRef = useRef(library);
  libraryRef.current = library;

  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['course']);
  const [selectedRef, setSelectedRef] = useState<GxMaterialRef | null>(null);
  const [context, setContext] = useState<MaterialContext | null>(null);
  const [hoveredRef, setHoveredRef] = useState<GxMaterialRef | null>(null);
  const [dockTab, setDockTab] = useState<MaterialDockTab>('graph');
  const [solo, setSolo] = useState(false);

  /**
   * The archives that have been listed (keyed by `archiveKey`), and the exact bytes they were
   * listed from. Listing walks the whole BRRES, so it runs once per archive and is *not* redone
   * after an edit: the decoded documents below are the source of truth from then on.
   */
  const [archives, setArchives] = useState<Record<string, GxArchiveMaterials>>({});
  const pinnedBytesRef = useRef(new Map<string, Uint8Array>());

  /** Working documents, keyed by material. An edit updates the entry here at once. */
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

  // ------------------------------------------------------------------ the models the viewport can show

  const onVisualSceneChange = useCallback((scene: MaterialRendererScene | null) => {
    sceneRef.current = scene;
    setSceneVersion((version) => version + 1);
  }, []);

  /**
   * Object models the viewport draws but the track archive does not carry (they come from
   * Common.szs), with the names the author knows them by. The outliner lists these too, so the
   * item box is in the list even though no `itembox.brres` ships with the track.
   */
  const sceneModels = useMemo(() => {
    const extras: ExtraMaterialArchive[] = [];
    const labels = new Map<string, string>();
    if (!active) return { extras, labels };
    const instances = sceneRef.current?.collectEditorSurfaceInstances?.() ?? [];
    for (const instance of instances) {
      if (instance.kind !== 'object' || !instance.archivePath) continue;
      const key = archiveKey(instance.archivePath);
      if (labels.has(key)) continue;
      const label =
        getKnownObjectName(instance.objectId ?? undefined) ??
        (instance.objectName ? humanizeObjectName(instance.objectName) : friendlyFileName(instance.archivePath));
      labels.set(key, label);
      extras.push({ path: instance.archivePath, label });
    }
    return { extras, labels };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sceneVersion, track?.fileName]);

  const archiveEntries = useMemo(
    () => listMaterialArchives(track, sceneModels.extras, sceneModels.labels),
    [track, sceneModels],
  );
  const archiveEntriesRef = useRef<MaterialArchiveEntry[]>(archiveEntries);
  archiveEntriesRef.current = archiveEntries;

  /** Track copy first, then the game's shared files — the order the game and the viewport load in. */
  const bytesFor = useCallback(
    (path: string): Uint8Array | null => {
      const pinned = pinnedBytesRef.current.get(archiveKey(path));
      if (pinned) return pinned;
      if (!track) return null;
      return resolveArchiveBytes(track, commonArchive, path)?.bytes ?? null;
    },
    [commonArchive, track],
  );

  const selectedKey = selectedRef ? materialRefKey(selectedRef) : null;
  const doc = selectedKey ? (docs[selectedKey] ?? null) : null;
  const graph = selectedRef ? (graphs[sessionGraphKey(selectedRef)] ?? null) : null;

  // ------------------------------------------------------------------ library

  useEffect(() => {
    if (!active || library !== null || libraryError !== null) return;
    let cancelled = false;
    void loadMaterialLibrary().then(
      (module) => { if (!cancelled) setLibrary(module); },
      (error: unknown) => { if (!cancelled) setLibraryError(error instanceof Error ? error.message : String(error)); },
    );
    return () => { cancelled = true; };
  }, [active, library, libraryError]);

  // ------------------------------------------------------------------ the idle commit

  const dirtyRef = useRef(new Map<string, DirtyMaterial>());
  /** The documents as they were when the current burst of edits began (what undo goes back to). */
  const baselineDocsRef = useRef<Record<string, GxMaterialDoc>>({});
  /** `docs`, but already holding an edit made a moment ago that React has not rendered yet. */
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const refsByKeyRef = useRef(new Map<string, GxMaterialRef>());
  /** A scene rebuild is wanted as soon as none is running (a hot swap failed). */
  const refreshWantedRef = useRef(false);

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
    return sceneRef.current?.reloadEditorMaterial?.(toSceneArchivePath(ref.archivePath), ref.modelName, ref.materialName, bytes) ?? false;
  }, []);

  /** Rebuilds the viewport from the track; waits its turn when a rebuild is already running. */
  const requestRefresh = useCallback(() => {
    refreshWantedRef.current = true;
    if (ctxRef.current.sceneRefreshing || !ctxRef.current.trackRef.current) return;
    refreshWantedRef.current = false;
    ctxRef.current.refreshScene();
  }, []);

  useEffect(() => {
    if (!sceneRefreshing && refreshWantedRef.current && active) requestRefresh();
  }, [active, requestRefresh, sceneRefreshing]);

  /**
   * Writes every dirty material into the track (one undo step for the whole burst) and puts the
   * result in the viewport. When a Common.szs model is edited for the first time the track gets
   * its own copy of it first, silently, with one line in the status bar.
   */
  const commitPending = () => {
    const lib = libraryRef.current;
    const { trackRef, commonArchive: common, history: historyApi, selection: selectionApi } = ctxRef.current;
    const entries = [...dirtyRef.current.values()];
    dirtyRef.current.clear();
    const base = trackRef.current;
    if (entries.length === 0 || !lib || !base) {
      if (refreshWantedRef.current) requestRefresh();
      return;
    }

    let nextTrack: TrackDocument = base;
    const swaps: Array<{ ref: GxMaterialRef; bytes: Uint8Array }> = [];
    const copied: string[] = [];
    const renames: Array<{ from: GxMaterialRef; to: GxMaterialRef }> = [];
    let workingDocs = docsRef.current;
    const baseline = baselineDocsRef.current;

    for (const entry of entries) {
      const key = materialRefKey(entry.ref);
      try {
        const local = ensureTrackLocalArchive(nextTrack, common, entry.ref.archivePath);
        const file = findTrackArchiveEntry(local.track, local.path);
        if (!file?.data) throw new Error(`The track has no ${entry.ref.archivePath} to write into.`);
        const result = lib.applyMaterial(file.data, entry.ref.modelName, entry.ref.materialName, entry.doc);
        nextTrack = replaceArchiveFile(local.track, local.path, result.brres);
        if (local.copied) copied.push(entry.label);
        const renamed = entry.doc.name !== entry.ref.materialName;
        const written: GxMaterialRef = {
          archivePath: local.path,
          modelName: entry.ref.modelName,
          materialName: renamed ? entry.doc.name : entry.ref.materialName,
        };
        swaps.push({ ref: written, bytes: result.brres });
        refsByKeyRef.current.set(materialRefKey(written), written);
        if (renamed) renames.push({ from: entry.ref, to: written });
        surfaceWarnings(result.warnings);
      } catch (error) {
        // The edit could not be written, so the working copy goes back to what the track holds
        // rather than showing something the viewport and an export will never have.
        if (baseline[key]) workingDocs = { ...workingDocs, [key]: baseline[key] };
        setStatus(`${entry.ref.materialName} could not be saved into the track, so nothing was changed.`);
        toast.showToast({
          tone: 'error',
          title: `${entry.ref.materialName} could not be saved`,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // A rename moves the material's key; the working documents follow it.
    for (const { from, to } of renames) {
      const fromKey = materialRefKey(from);
      const toKey = materialRefKey(to);
      if (fromKey === toKey || !workingDocs[fromKey]) continue;
      const { [fromKey]: moved, ...rest } = workingDocs;
      workingDocs = { ...rest, [toKey]: moved };
    }

    if (workingDocs !== docsRef.current) {
      docsRef.current = workingDocs;
      setDocs(workingDocs);
    }
    if (renames.length > 0) {
      setSelectedRef((current) => {
        const hit = current && renames.find((rename) => materialRefEquals(rename.from, current));
        return hit ? hit.to : current;
      });
      setGraphs((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => !renames.some((rename) => sessionGraphKey(rename.from) === key))),
      );
      setArchives((current) => {
        const next = { ...current };
        for (const { from, to } of renames) {
          const listing = next[archiveKey(from.archivePath)];
          if (!listing) continue;
          next[archiveKey(from.archivePath)] = {
            ...listing,
            models: listing.models.map((model) => ({
              ...model,
              materials: model.materials.map((material) =>
                model.modelName === from.modelName && material.materialName === from.materialName
                  ? { ...material, materialName: to.materialName }
                  : material),
            })),
          };
        }
        return next;
      });
    }

    if (nextTrack !== base) {
      // Both versions of the track remember the documents that go with them, so undo and redo
      // put the inspector back where it was without re-decoding anything.
      docsByTrackRef.current.set(base, baseline);
      docsByTrackRef.current.set(nextTrack, workingDocs);
      historyApi.applyEditorChange(nextTrack, selectionApi.selectedIdRef.current, true, selectionApi.selectedIdsRef.current);
    }

    let swapFailed = false;
    for (const swap of swaps) if (!pushToRenderer(swap.ref, swap.bytes)) swapFailed = true;
    if (copied.length > 0) {
      setStatus(`${copied[0]} now uses a track copy of its model${copied.length > 1 ? ` (and ${copied.length - 1} more)` : ''}.`);
    }
    // The model is one the scene cannot patch in place: rebuild it, keeping camera and selection.
    if (swapFailed) refreshWantedRef.current = true;
    if (refreshWantedRef.current) requestRefresh();
  };

  const idle = useIdleCommit(commitPending);
  const flushPending = idle.flush;
  const cancelPending = idle.cancel;
  const touchPending = idle.touch;

  // Anything that is about to read or change the track commits first, so it sees (or undoes) the
  // author's latest edit: Ctrl+Z / Ctrl+S / Ctrl+O and a press anywhere on the top bar (Undo,
  // Redo, Export, Refresh, the file menu).
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) flushPending();
    };
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest?.('.topBar')) flushPending();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [active, flushPending]);

  // Leaving the mode must not strand an edit that never reached the track.
  useEffect(() => {
    if (!active) flushPending();
  }, [active, flushPending]);

  // A new track invalidates everything that was read out of the old one.
  useEffect(() => {
    cancelPending();
    dirtyRef.current.clear();
    refreshWantedRef.current = false;
    pinnedBytesRef.current = new Map();
    warnedRef.current = new Set();
    graphHistoryRef.current = new Map();
    setArchives({});
    setDocs({});
    setGraphs({});
    setSelectedRef(null);
    setContext(null);
    setExpanded([]);
    setExpandedGroups(['course']);
    setCompiled(null);
  }, [cancelPending, track?.fileName]);

  // ------------------------------------------------------------------ archives

  // The course model is opened on entering the mode; everything else waits for the user (or a
  // click in the viewport), because listing an archive parses the whole BRRES.
  const openedInitialRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active || archiveEntries.length === 0 || !track) return;
    if (openedInitialRef.current === track.fileName) return;
    openedInitialRef.current = track.fileName;
    const course = archiveEntries.find((entry) => entry.role === 'course') ?? archiveEntries[0];
    setExpanded([course.path]);
  }, [active, archiveEntries, track]);

  useEffect(() => {
    if (!active || !library || !track) return;
    const wanted = new Set<string>(expanded);
    // A search has to look in every model, not only the ones that happen to be open.
    if (query.trim()) for (const entry of archiveEntries) wanted.add(entry.path);
    if (selectedRef) wanted.add(selectedRef.archivePath);
    if (context && !context.placed) wanted.add(context.archivePath);
    const next: Record<string, GxArchiveMaterials> = {};
    for (const path of wanted) {
      const key = archiveKey(path);
      if (archives[key] !== undefined || next[key] !== undefined) continue;
      const bytes = bytesFor(path);
      if (!bytes) continue;
      try {
        next[key] = library.listArchiveMaterials(path, bytes);
        pinnedBytesRef.current.set(key, bytes);
      } catch (error) {
        const name = path.split('/').pop() ?? path;
        setStatus(`The ${name} archive could not be read, so its materials are not listed.`);
        toast.showToast({
          tone: 'warning',
          title: `${name} could not be read`,
          detail: error instanceof Error ? error.message : String(error),
        });
        next[key] = { archivePath: path, models: [], textures: [] };
      }
    }
    if (Object.keys(next).length > 0) setArchives((current) => ({ ...current, ...next }));
  }, [active, archiveEntries, archives, bytesFor, context, expanded, library, query, selectedRef, setStatus, toast, track]);

  const tree = useMemo(
    () => buildMaterialTree(archiveEntries, new Map(Object.entries(archives)), query),
    [archiveEntries, archives, query],
  );
  const selectedArchive = selectedRef ? (archives[archiveKey(selectedRef.archivePath)] ?? null) : null;

  // ------------------------------------------------------------------ decode on selection

  const decodeSelected = useCallback(
    (ref: GxMaterialRef): GxMaterialDoc | null => {
      if (!library) return null;
      const bytes = bytesFor(ref.archivePath);
      if (!bytes) return null;
      try {
        return library.decodeMaterial(bytes, ref.modelName, ref.materialName);
      } catch (error) {
        setStatus(`${ref.materialName} could not be read, so it cannot be edited.`);
        return null;
      }
    },
    [bytesFor, library, setStatus],
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
   * inspector keeps showing the edit that was just undone. A material with an edit still waiting
   * for its commit keeps that edit.
   */
  useEffect(() => {
    if (!active || !track) return;
    const stored = docsByTrackRef.current.get(track);
    if (!stored) return;
    setDocs((current) => {
      let changed = false;
      const merged = { ...current };
      for (const [key, value] of Object.entries(stored)) {
        if (dirtyRef.current.has(key) || merged[key] === value) continue;
        merged[key] = value;
        changed = true;
      }
      return changed ? merged : current;
    });
  }, [active, track]);

  /**
   * An archive can also be rewritten by something that is not this mode — the Model Studio edits
   * the same `course_model.brres` and commits it into the same track document. A track version
   * this mode did not produce and whose bytes for a listed archive differ therefore invalidates
   * everything decoded from that archive, or the inspector would keep showing the old material.
   */
  const lastTrackRef = useRef<TrackDocument | null>(null);
  useEffect(() => {
    const previous = lastTrackRef.current;
    lastTrackRef.current = track;
    if (!track || previous === null || previous === track) return;
    if (docsByTrackRef.current.has(track)) return;

    const stalePaths: string[] = [];
    for (const [path, bytes] of pinnedBytesRef.current) {
      const current = findArchiveBytes(track, path);
      if (current !== null && current !== bytes) stalePaths.push(path);
    }
    if (stalePaths.length === 0) return;

    const staleKeys = new Set(stalePaths.map((path) => `${archiveKey(path)}|`));
    const isStale = (key: string) => [...staleKeys].some((prefix) => key.startsWith(prefix));
    for (const path of stalePaths) pinnedBytesRef.current.delete(path);
    setArchives((current) => {
      const next = { ...current };
      for (const path of stalePaths) delete next[archiveKey(path)];
      return next;
    });
    setDocs((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !isStale(key))));
    setGraphs((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !isStale(key))));
  }, [track]);

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
      // A graph stored before this build learned a node still holds the read-only "Special step"
      // cards it needed then. A fresh read draws those steps properly, so it wins: the only thing
      // lost is the layout, and a graph the editor can actually edit is worth more than one.
      const storedRaw = countRawStages(stored);
      const chosen = stored && storedRaw <= countRawStages(fallback) ? stored : fallback;
      setGraphs((current) => (current[key] ? current : { ...current, [key]: chosen }));
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

  // ------------------------------------------------------------------ the viewport follows undo and redo

  /**
   * The viewport has to follow too: every material whose document differs between the version
   * that was showing and the version just restored gets its restored bytes hot-swapped, so an
   * undone edit disappears from the track and a redone one comes back.
   */
  useEffect(() => {
    if (!track) return;
    const stored = docsByTrackRef.current.get(track);
    if (!stored) return;
    const showing = docsRef.current;
    const stale: GxMaterialRef[] = [];
    for (const key of new Set([...Object.keys(showing), ...Object.keys(stored)])) {
      if (showing[key] === stored[key] || dirtyRef.current.has(key)) continue;
      const ref = refsByKeyRef.current.get(key);
      if (ref) stale.push(ref);
    }
    if (stale.length === 0) return;
    // An edited graph drives its material, so left alone it would compile straight back over the
    // stages undo just restored. Those materials drop the graph and re-read it for the restored
    // stages — the stored layout when there is one — as when the material is first opened.
    const staleGraphs = stale.map(sessionGraphKey).filter((key) => editedGraphsRef.current.has(key));
    if (staleGraphs.length > 0) {
      for (const key of staleGraphs) {
        editedGraphsRef.current.delete(key);
        graphHistoryRef.current.delete(key);
      }
      setGraphs((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !staleGraphs.includes(key))));
    }
    let failed = false;
    for (const ref of stale) {
      const bytes = resolveArchiveBytes(track, ctxRef.current.commonArchive, ref.archivePath)?.bytes;
      if (!bytes || !pushToRenderer(ref, bytes)) failed = true;
    }
    if (failed) requestRefresh();
  }, [pushToRenderer, requestRefresh, track]);

  // ------------------------------------------------------------------ editing

  /**
   * One edit: the working document changes at once (so the inspector, the graph and the compiler
   * all see it), the material is marked dirty and the countdown restarts. Nothing is written to
   * the track or the viewport until the author pauses — `commitPending` does that, once, for the
   * whole burst. That is what keeps a slider drag or a long graph session free of lag spikes.
   */
  const updateDoc = useCallback(
    (next: GxMaterialDoc, options: { transient?: boolean; status?: string } = {}) => {
      const ref = selectedRef;
      if (!ref) return;
      const key = materialRefKey(ref);
      refsByKeyRef.current.set(key, ref);
      if (dirtyRef.current.size === 0) baselineDocsRef.current = docsRef.current;
      const nextDocs = { ...docsRef.current, [key]: next };
      docsRef.current = nextDocs;
      setDocs(nextDocs);
      if (options.status) setStatus(options.status);
      if (!library || !track) return;
      dirtyRef.current.set(key, { ref, doc: next, label: context?.title ?? friendlyFileName(ref.archivePath) });
      touchPending();
    },
    [context?.title, library, selectedRef, setStatus, touchPending, track],
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

  /** A compiled graph becomes the material's stages. */
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

  // Authored layouts survive reopening the track, but only while the stages still match — and the
  // key is the material's stages, so a graph is only stored once it really compiles to them. In
  // the window between an edit to the graph and that edit reaching the material, it does not, and
  // saving there would file the new graph under the old material's key.
  useEffect(() => {
    if (!active || !selectedRef || !graph || !doc) return;
    if (!compiled?.ok || JSON.stringify(compiled.tevStages) !== JSON.stringify(doc.tevStages)) return;
    const timer = window.setTimeout(() => void saveStoredGraph(selectedRef, doc.tevStages, graph), 600);
    return () => window.clearTimeout(timer);
  }, [active, compiled, doc, graph, selectedRef]);

  /**
   * How many steps a fresh read of this material would leave as read-only cards. Compared against
   * what the graph on screen holds, it is what tells the "Special step" card whether pressing
   * Convert would actually gain anything.
   */
  const freshRawStages = useMemo(
    () => (library && doc ? countRawStages(library.decompileShader(doc)) : 0),
    [doc, library],
  );
  const rawStagesConvertible = countRawStages(graph) > freshRawStages;

  const convertRawStages = useCallback(() => {
    if (!library || !doc) return;
    setGraph(autoLayout(library.decompileShader(doc)), { edited: false });
    setStatus(
      freshRawStages === 0
        ? 'Rebuilt the graph — every step of this material is drawn as nodes now.'
        : `Rebuilt the graph. ${freshRawStages} step${freshRawStages === 1 ? '' : 's'} still cannot be drawn as nodes; the Stages tab shows ${freshRawStages === 1 ? 'it' : 'them'} in full.`,
    );
  }, [doc, freshRawStages, library, setGraph, setStatus]);

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

  // ------------------------------------------------------------------ graph selection → Details

  // The inspector is a Details panel: it shows whatever is selected in the graph. The graph owns
  // the selection and reports it here; a request goes the other way when the inspector wants a
  // node selected (a texture row clicked in the overview). The key only grows, so each is new.
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectionRequest, setSelectionRequest] = useState<{ nodeIds: string[]; key: number } | null>(null);
  const selectionKeyRef = useRef(0);
  useEffect(() => {
    setSelectedNodeIds([]);
    setSelectionRequest(null);
  }, [selectedKey]);

  const requestNodeSelection = useCallback((nodeIds: string[]) => {
    setSelectedNodeIds(nodeIds);
    selectionKeyRef.current += 1;
    setSelectionRequest({ nodeIds, key: selectionKeyRef.current });
    if (nodeIds.length > 0) setDockTab('graph');
  }, []);

  /** A node edited in the inspector: one graph edit, recorded for undo and compiled like any other. */
  const changeNode = useCallback(
    (next: EditorGraphNode) => {
      if (!graph) return;
      setGraph({ ...graph, nodes: graph.nodes.map((node) => (node.id === next.id ? next : node)) });
    },
    [graph, setGraph],
  );

  // ------------------------------------------------------------------ picking

  /** What the Details panel lists when a row of the outliner is clicked instead of the viewport. */
  const contextForRef = useCallback((ref: GxMaterialRef): MaterialContext => {
    const entry = archiveEntriesRef.current.find((candidate) => archiveKey(candidate.path) === archiveKey(ref.archivePath));
    const kind = entry?.role === 'course' ? 'course' : entry?.role === 'skybox' ? 'skybox' : 'object';
    return {
      archivePath: ref.archivePath,
      modelName: ref.modelName,
      kind,
      title: contextTitle(kind, entry?.label, friendlyFileName(ref.archivePath)),
      source: entry?.source ?? 'track',
    };
  }, []);

  const selectMaterial = useCallback(
    (ref: GxMaterialRef | null, nextContext?: MaterialContext | null) => {
      // The edit being made on the previous material is written (and shown) before moving on.
      flushPending();
      setSelectedRef(ref);
      setSolo(false);
      if (ref) {
        setContext((current) =>
          nextContext ??
          (current && archiveKey(current.archivePath) === archiveKey(ref.archivePath) && current.modelName === ref.modelName ? current : contextForRef(ref)),
        );
      } else {
        setContext(nextContext ?? null);
      }
    },
    [contextForRef, flushPending],
  );

  const onPick = useCallback(
    (pick: SurfacePick | null) => {
      if (!pick) {
        selectMaterial(null, null);
        return;
      }
      const currentTrack = ctxRef.current.trackRef.current;
      // Use the path the track itself spells, so the same material is never two different keys.
      const archivePath = (currentTrack && findTrackArchiveEntry(currentTrack, pick.archivePath)?.path) || pick.archivePath;
      const nextContext = contextFromPick(pick, archivePath);
      if (nextContext.placed) {
        selectMaterial(null, nextContext);
        return;
      }
      selectMaterial({ archivePath, modelName: pick.modelName, materialName: pick.materialName }, nextContext);
    },
    [selectMaterial],
  );

  // Visual mode's "Edit this material" hands over the surface it was showing.
  const pendingPick = ctx.pendingMaterialPick;
  useEffect(() => {
    if (!active || !pendingPick) return;
    ctxRef.current.consumePendingMaterialPick();
    onPick(pendingPick);
  }, [active, onPick, pendingPick]);

  // Selecting something, from either side, opens its folder in the outliner.
  useEffect(() => {
    if (!selectedRef) return;
    const entry = archiveEntriesRef.current.find((candidate) => archiveKey(candidate.path) === archiveKey(selectedRef.archivePath));
    if (!entry) return;
    setExpanded((current) => (current.includes(entry.path) ? current : [...current, entry.path]));
    setExpandedGroups((current) => (current.includes(entry.group) ? current : [...current, entry.group]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  // ------------------------------------------------------------------ viewport

  const selectedMeshes = useMemo<SceneMeshEntry[]>(
    () => (active && selectedRef ? findMaterialMeshes(sceneRef.current, selectedRef.archivePath, selectedRef.modelName, selectedRef.materialName) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, selectedRef, sceneVersion],
  );

  const highlight = useMemo<SurfaceHighlight[]>(() => {
    const list: SurfaceHighlight[] = [];
    if (hoveredRef && !materialRefEquals(hoveredRef, selectedRef)) {
      list.push({
        kind: 'material',
        archivePath: toSceneArchivePath(hoveredRef.archivePath),
        modelName: hoveredRef.modelName,
        materialName: hoveredRef.materialName,
        style: 'hover',
      });
    }
    if (selectedRef) {
      list.push({
        kind: 'material',
        archivePath: toSceneArchivePath(selectedRef.archivePath),
        modelName: selectedRef.modelName,
        materialName: selectedRef.materialName,
        style: 'selected',
      });
    }
    return list;
  }, [hoveredRef, selectedRef]);

  const surfacePicking = useMemo<SurfacePickingOptions>(
    () => ({ onPick, highlight, hoverHighlight: true, includeSkybox: true }),
    [highlight, onPick],
  );

  useEffect(() => {
    if (!active) return;
    soloMaterialMeshes(sceneRef.current, solo ? selectedMeshes : []);
  }, [active, selectedMeshes, solo]);

  // Leaving the mode must not leave the viewport soloed.
  useEffect(() => {
    if (active) return;
    soloMaterialMeshes(sceneRef.current, []);
    setSolo(false);
  }, [active]);

  // ------------------------------------------------------------------ textures

  const importTexture = useCallback(
    (options: { name: string; format: number; width: number; height: number; mipCount: number; data: Uint8Array }): boolean => {
      const ref = selectedRef;
      const lib = libraryRef.current;
      if (!ref || !lib) return false;
      // The archive is about to change shape; whatever was waiting goes in first.
      flushPending();
      const { trackRef, commonArchive: common } = ctxRef.current;
      const base = trackRef.current;
      if (!base) return false;
      try {
        const local = ensureTrackLocalArchive(base, common, ref.archivePath);
        const file = findTrackArchiveEntry(local.track, local.path);
        if (!file?.data) return false;
        const next = lib.addTexture(file.data, {
          name: options.name,
          format: options.format as never,
          width: options.width,
          height: options.height,
          mipCount: options.mipCount,
          data: options.data,
        });
        const nextTrack = replaceArchiveFile(local.track, local.path, next);
        // This is this mode's own write, so the documents carry over and the archive is simply
        // listed again to pick up the new texture.
        docsByTrackRef.current.set(base, docsRef.current);
        docsByTrackRef.current.set(nextTrack, docsRef.current);
        const listKey = archiveKey(local.path);
        pinnedBytesRef.current.delete(listKey);
        setArchives((current) => {
          const { [listKey]: _removed, ...rest } = current;
          return rest;
        });
        history.applyEditorChange(nextTrack, selection.selectedIdRef.current, true, selection.selectedIdsRef.current);
        const live = sceneRef.current?.addEditorTexture?.(options.name, options) ?? false;
        if (next === file.data) {
          surfaceWarnings(['The texture writer is not wired up yet, so an imported texture previews in the viewport but is not stored in the archive.']);
        }
        setStatus(`Imported ${options.name}.${local.copied ? ` ${context?.title ?? 'This model'} now uses a track copy of its model.` : ''}`);
        if (!live) {
          // The scene could not take the texture in place; a rebuild once the author pauses shows it.
          refreshWantedRef.current = true;
          touchPending();
        }
        return true;
      } catch (error) {
        setStatus(`${options.name} could not be imported.`);
        toast.showToast({ tone: 'error', title: 'Texture import failed', detail: error instanceof Error ? error.message : String(error) });
        return false;
      }
    },
    [context?.title, flushPending, history, selectedRef, selection, setStatus, surfaceWarnings, toast, touchPending],
  );

  // ------------------------------------------------------------------ the Details strip

  const contextBytes = useMemo(() => {
    if (!active || !context || context.placed || !track) return null;
    return resolveArchiveBytes(track, commonArchive, context.archivePath)?.bytes ?? null;
  }, [active, commonArchive, context, track]);

  const contextRows = useMemo(() => {
    if (!context || !contextBytes) return [];
    try {
      return buildModelMaterialRows(
        context.archivePath,
        context.modelName,
        listModelSlots(contextBytes, context.modelName),
        listArchiveMaterialsBrief(contextBytes),
      );
    } catch {
      return [];
    }
  }, [context, contextBytes]);

  if (!active) return {};

  const archiveTextures = selectedArchive?.textures ?? [];
  const materialIssues = library && doc ? library.collectMaterialIssues(doc) : [];
  const archiveBytes = selectedRef ? bytesFor(selectedRef.archivePath) : null;
  const selectedSummary =
    selectedArchive?.models
      .find((model) => model.modelName === selectedRef?.modelName)
      ?.materials.find((material) => material.materialName === selectedRef?.materialName) ?? null;
  // Once the track holds its own copy of a shared model, it is no longer "shared".
  const stripContext: MaterialContext | null =
    context && context.source === 'common' && track && findTrackArchiveEntry(track, context.archivePath)
      ? { ...context, source: 'track' }
      : context;
  const previewPhase = sceneRefreshing ? 'rebuilding' : idle.pending ? 'pending' : 'idle';

  return {
    viewportProps: {
      mode: 'visual',
      showKmpEditorOverlay: false,
      onVisualSceneChange,
      surfacePicking,
    },
    prepareExport: () => {
      flushPending();
    },
    leftPanel: (
      <MaterialOutliner
        tree={tree}
        query={query}
        onChangeQuery={setQuery}
        expandedGroups={expandedGroups}
        onChangeExpandedGroups={setExpandedGroups}
        expanded={expanded}
        onChangeExpanded={setExpanded}
        selected={selectedRef}
        onSelect={(ref) => selectMaterial(ref)}
        onHover={setHoveredRef}
        loading={library === null && libraryError === null}
        error={libraryError}
        hasTrack={track !== null}
      />
    ),
    inspector: (
      <div className="materialDetailsColumn">
        {stripContext && (
          <ModelMaterialsStrip
            context={stripContext}
            rows={contextRows}
            selected={selectedRef}
            onSelect={(ref) => selectMaterial(ref, stripContext)}
            archiveBytes={contextBytes}
            textures={archives[archiveKey(stripContext.archivePath)]?.textures ?? []}
            solo={solo}
            onToggleSolo={() => setSolo((value) => !value)}
            soloDisabled={selectedMeshes.length === 0}
            onOpenInStudio={ctx.openModelStudio ? () => ctx.openModelStudio?.({ trackArchivePath: stripContext.archivePath }) : undefined}
            onOpenModelMode={() => ctx.setEditorMode('model')}
          />
        )}
        {(!context || !context.placed) && (
          <MaterialInspector
            materialRef={selectedRef}
            doc={doc}
            issues={materialIssues}
            textures={archiveTextures}
            archivePath={selectedRef?.archivePath ?? ''}
            archiveBytes={archiveBytes}
            meshCount={selectedSummary?.meshes.length ?? 0}
            summary={selectedSummary}
            onChange={updateDoc}
            onImportTexture={importTexture}
            hasTrack={track !== null}
            graph={graph}
            selectedNodeIds={selectedNodeIds}
            onSelectNodes={requestNodeSelection}
            onChangeNode={changeNode}
          />
        )}
      </div>
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
        onConvertRawStages={convertRawStages}
        rawStagesConvertible={rawStagesConvertible}
        onApplyPreset={applyPreset}
        onAutoLayout={runAutoLayout}
        onChangeDoc={updateDoc}
        onSelectionChange={setSelectedNodeIds}
        selectionRequest={selectionRequest}
        preview={{ phase: previewPhase, onUpdateNow: flushPending }}
      />
    ),
  };
}
