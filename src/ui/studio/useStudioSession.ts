// The Model Studio's session: what is open, what is selected, and every edit made to it.
//
// This is the studio's answer to `MaterialMode.tsx` — the same material-document flow, but over a
// `StudioDocument` instead of a `TrackDocument`, with its own undo stack. The material inspector
// and the shader graph dock are reused untouched, because both already take a `GxMaterialDoc` and
// a change callback and know nothing about tracks.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompiledShader, GxArchiveMaterials, GxMaterialDoc, GxMaterialRef } from '../../lib/gxMaterial';
import { buildPublicAssetUrl } from '../../lib/assetPaths';
import type { ToastApi } from '../components/Toast';
import { autoLayout, countRawStages, type EditorShaderGraph } from '../material/graphModel';
import { loadStoredGraph, saveStoredGraph, sessionGraphKey } from '../material/graphStore';
import { ensureLayerCount, materialDocEquals, withChannelLighting } from '../material/materialDoc';
import { loadMaterialLibrary, type GxMaterialLibrary } from '../material/materialLibrary';
import { materialRefKey } from '../material/materialOutlinerModel';
import type { SceneMeshEntry } from '../material/materialScene';
import {
  defaultStudioTransport,
  advanceTransport,
  type StudioTransport,
} from './animationTransport';
import {
  openStudioDocument,
  replaceStudioBrres,
  StudioOpenError,
  studioBrresLabel,
  type StudioDocument,
  type StudioOrigin,
} from './studioDocument';
import {
  activeStudioAnimations,
  buildStudioTree,
  defaultExpandedStudioIds,
  studioTimelineDuration,
  type StudioArchiveSummary,
  type StudioTreeNode,
} from './studioOutlinerModel';
import { findStudioMaterialMeshes, type StudioRendererScene } from './studioScene';
import { loadStudioRecents, rememberStudioFile, type StudioRecentRecord } from './studioRecent';

const COMPILE_DEBOUNCE_MS = 50;
const HISTORY_LIMIT = 64;
const GRAPH_HISTORY_LIMIT = 64;

/** The bundled Funky Kong + Flame Runner archive, so the studio has content with zero setup. */
export const DEMO_ARCHIVE_NAME = 'PreviewDummies.u8';
const DEMO_ARCHIVE_URL = 'data/MarioKartWii/Race/PreviewDummies.u8';

/** How the studio writes an edit back into a track the editor already has open. */
export interface StudioTrackBridge {
  origin: StudioOrigin;
  /** The archive bytes as the track holds them right now. */
  bytes: Uint8Array;
  /** Puts new bytes into the track document and the editor's undo history. */
  commit: (bytes: Uint8Array, status: string) => void;
}

export interface StudioRenderSettings {
  textures: boolean;
  vertexColors: boolean;
  lighting: boolean;
  wireframe: boolean;
  grid: boolean;
  turntable: boolean;
}

export const defaultStudioRenderSettings: StudioRenderSettings = {
  textures: true,
  vertexColors: true,
  lighting: true,
  wireframe: false,
  grid: true,
  turntable: false,
};

interface StudioHistoryEntry {
  doc: StudioDocument;
  docs: Record<string, GxMaterialDoc>;
}

export interface StudioSession {
  doc: StudioDocument | null;
  loading: boolean;
  status: string;
  setStatus: (message: string) => void;
  library: GxMaterialLibrary | null;

  archives: StudioArchiveSummary[];
  tree: StudioTreeNode[];
  query: string;
  setQuery: (query: string) => void;
  expanded: string[];
  setExpanded: (ids: string[]) => void;

  selectedRef: GxMaterialRef | null;
  selectMaterial: (ref: GxMaterialRef | null) => void;
  materialDoc: GxMaterialDoc | null;
  materialSummary: GxArchiveMaterials | null;
  selectedMeshes: SceneMeshEntry[];
  hoveredMesh: SceneMeshEntry | null;
  setHoveredMesh: (mesh: SceneMeshEntry | null) => void;
  updateMaterial: (next: GxMaterialDoc, options?: { transient?: boolean; status?: string }) => void;
  importTexture: (texture: { name: string; format: number; width: number; height: number; mipCount: number; data: Uint8Array }) => boolean;

  graph: EditorShaderGraph | null;
  compiled: CompiledShader | null;
  graphDrivesMaterial: boolean;
  graphHistoryState: { undo: number; redo: number };
  setGraph: (graph: EditorShaderGraph, options?: { record?: boolean; undoFrom?: EditorShaderGraph; edited?: boolean }) => void;
  stepGraphHistory: (direction: 'undo' | 'redo') => void;
  resetGraphFromStages: () => void;
  convertRawStages: () => void;
  rawStagesConvertible: boolean;
  applyPreset: (presetId: string) => void;
  runAutoLayout: () => void;

  transport: StudioTransport;
  setTransport: (next: StudioTransport) => void;
  timelineDuration: number;
  activeAnimations: Array<{ archivePath: string; kind: string; name: string; duration: number }>;
  toggleAnimation: (archivePath: string, kind: string, name: string, enabled: boolean) => void;

  renderSettings: StudioRenderSettings;
  setRenderSettings: (next: StudioRenderSettings) => void;
  setArchiveVisible: (archivePath: string, visible: boolean) => void;
  setModelVisible: (archivePath: string, modelName: string, visible: boolean) => void;

  historyState: { undo: number; redo: number };
  undo: () => void;
  redo: () => void;

  recents: StudioRecentRecord[];
  openFile: (file: File) => Promise<void>;
  openBytes: (fileName: string, bytes: Uint8Array, origin?: StudioOrigin | null, remember?: boolean) => Promise<void>;
  openDemo: () => Promise<void>;

  attachScene: (scene: StudioRendererScene | null) => void;
  /** Changes when the animated pose changes. Diagnostics only (the browser probe reads it). */
  poseSignature: () => number | null;
  /** Bumped when the loaded set changed, so the viewport re-frames. */
  frameRequest: number;
  /** True once at least one edit has been written into the open document. */
  edited: boolean;
}

export function useStudioSession({
  toast,
  trackBridge,
}: {
  toast: ToastApi;
  trackBridge: StudioTrackBridge | null;
}): StudioSession {
  const [library, setLibrary] = useState<GxMaterialLibrary | null>(null);
  const [doc, setDoc] = useState<StudioDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Open a model, or start with the demo character.');
  const [materials, setMaterials] = useState<Record<string, GxArchiveMaterials>>({});
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selectedRef, setSelectedRef] = useState<GxMaterialRef | null>(null);
  const [hoveredMesh, setHoveredMesh] = useState<SceneMeshEntry | null>(null);
  const [docs, setDocs] = useState<Record<string, GxMaterialDoc>>({});
  const [graphs, setGraphs] = useState<Record<string, EditorShaderGraph>>({});
  const [compiled, setCompiled] = useState<CompiledShader | null>(null);
  const [transport, setTransportState] = useState<StudioTransport>(defaultStudioTransport);
  const [renderSettings, setRenderSettingsState] = useState<StudioRenderSettings>(defaultStudioRenderSettings);
  const [frameRequest, setFrameRequest] = useState(0);
  const [recents, setRecents] = useState<StudioRecentRecord[]>([]);
  const [undoStack, setUndoStack] = useState<StudioHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<StudioHistoryEntry[]>([]);

  const sceneRef = useRef<StudioRendererScene | null>(null);
  const graphHistoryRef = useRef(new Map<string, { undo: EditorShaderGraph[]; redo: EditorShaderGraph[] }>());
  const editedGraphsRef = useRef(new Set<string>());
  const pendingGraphStatusRef = useRef<string | null>(null);
  const warnedRef = useRef(new Set<string>());
  const trackBridgeRef = useRef(trackBridge);
  trackBridgeRef.current = trackBridge;

  // ------------------------------------------------------------------ library and recents

  useEffect(() => {
    let cancelled = false;
    void loadMaterialLibrary().then(
      (module) => { if (!cancelled) setLibrary(module); },
      (error: unknown) => {
        if (cancelled) return;
        toast.showToast({ tone: 'error', title: 'The material library could not be loaded', detail: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => { cancelled = true; };
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    void loadStudioRecents().then((entries) => { if (!cancelled) setRecents(entries); });
    return () => { cancelled = true; };
  }, []);

  // ------------------------------------------------------------------ opening

  const attachScene = useCallback((scene: StudioRendererScene | null) => {
    sceneRef.current = scene;
    setSceneEpoch((value) => value + 1);
  }, []);

  const loadIntoScene = useCallback(
    (next: StudioDocument, materialLibrary: GxMaterialLibrary | null) => {
      const scene = sceneRef.current;
      if (scene) {
        for (const archive of scene.listStudioArchives?.() ?? []) scene.unloadStudioArchive?.(archive.archivePath);
        for (const file of next.brresFiles) {
          try {
            scene.loadStudioArchive?.(file.path, file.bytes);
          } catch (error) {
            toast.showToast({
              tone: 'warning',
              title: `${file.label} could not be drawn`,
              detail: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      const listed: Record<string, GxArchiveMaterials> = {};
      if (materialLibrary) {
        for (const file of next.brresFiles) {
          try {
            listed[file.path] = materialLibrary.listArchiveMaterials(file.path, file.bytes);
          } catch (error) {
            toast.showToast({
              tone: 'warning',
              title: `${file.label} could not be read`,
              detail: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
      setMaterials(listed);
      setSceneEpoch((value) => value + 1);
      setFrameRequest((value) => value + 1);
    },
    [toast],
  );

  const openBytes = useCallback(
    async (fileName: string, bytes: Uint8Array, origin: StudioOrigin | null = null, remember = true) => {
      setLoading(true);
      try {
        const materialLibrary = library ?? (await loadMaterialLibrary());
        if (library === null) setLibrary(materialLibrary);
        const next = openStudioDocument(fileName, bytes, origin);
        setDoc(next);
        setDocs({});
        setGraphs({});
        setSelectedRef(null);
        setCompiled(null);
        setUndoStack([]);
        setRedoStack([]);
        setQuery('');
        // Cleared so the "expand the archives and their models" effect runs for the new document.
        setExpanded([]);
        graphHistoryRef.current = new Map();
        editedGraphsRef.current = new Set();
        warnedRef.current = new Set();
        setTransportState(defaultStudioTransport);
        loadIntoScene(next, materialLibrary);
        setStatus(
          origin === null
            ? `Opened ${next.fileName} — ${next.brresFiles.length} model file${next.brresFiles.length === 1 ? '' : 's'}.`
            : `Opened ${studioBrresLabel(origin.archivePath)} from ${origin.trackName}. Edits go straight back into the track.`,
        );
        if (remember && origin === null) {
          const record = await rememberStudioFile(fileName, bytes);
          if (record) setRecents((current) => [record, ...current.filter((entry) => entry.id !== record.id)].slice(0, 8));
        }
      } catch (error) {
        const message = error instanceof StudioOpenError ? error.message : error instanceof Error ? error.message : String(error);
        setStatus(message);
        toast.showToast({ tone: 'error', title: `${fileName} could not be opened`, detail: message });
      } finally {
        setLoading(false);
      }
    },
    [library, loadIntoScene, toast],
  );

  const openFile = useCallback(
    async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await openBytes(file.name, bytes);
    },
    [openBytes],
  );

  const openDemo = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(buildPublicAssetUrl(DEMO_ARCHIVE_URL));
      if (!response.ok) throw new Error(`The bundled demo character could not be fetched (${response.status}).`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      await openBytes(DEMO_ARCHIVE_NAME, bytes, null, false);
      setStatus('Opened the demo character: Funky Kong on a Flame Runner.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      toast.showToast({ tone: 'error', title: 'The demo character could not be opened', detail: message });
    } finally {
      setLoading(false);
    }
  }, [openBytes, toast]);

  // ------------------------------------------------------------------ the outliner model

  const sceneArchives = useMemo(() => {
    void sceneEpoch;
    return sceneRef.current?.listStudioArchives?.() ?? [];
    // `sceneEpoch` is the change signal: the scene object is mutable and does not re-render on its own.
  }, [sceneEpoch]);

  const archives = useMemo<StudioArchiveSummary[]>(() => {
    if (doc === null) return [];
    return doc.brresFiles.map((file) => {
      const sceneArchive = sceneArchives.find((entry) => entry.archivePath === file.path) ?? null;
      const models = sceneArchive?.models ?? [];
      return {
        archivePath: file.path,
        label: file.label,
        visible: models.length === 0 || models.some((model) => model.visible),
        models: models.map((model) => ({
          modelName: model.modelName,
          visible: model.visible,
          materialCount: model.materialCount,
          shapeCount: model.shapeCount,
          nodeCount: model.nodeCount,
        })),
        materials: materials[file.path] ?? null,
        animations: (sceneArchive?.animations ?? []).map((animation) => ({
          kind: animation.kind,
          name: animation.name,
          duration: animation.duration,
          enabled: animation.enabled,
          supported: animation.supported,
        })),
      };
    });
  }, [doc, materials, sceneArchives]);

  useEffect(() => {
    if (archives.length === 0) return;
    setExpanded((current) => (current.length > 0 ? current : defaultExpandedStudioIds(archives)));
  }, [archives]);

  const tree = useMemo(() => buildStudioTree(archives, query), [archives, query]);
  const timelineDuration = useMemo(() => studioTimelineDuration(archives), [archives]);
  const activeAnimations = useMemo(() => activeStudioAnimations(archives), [archives]);

  // ------------------------------------------------------------------ material selection

  const selectedKey = selectedRef ? materialRefKey(selectedRef) : null;
  const materialDoc = selectedKey ? docs[selectedKey] ?? null : null;
  const materialSummary = selectedRef ? materials[selectedRef.archivePath] ?? null : null;
  const graph = selectedRef ? graphs[sessionGraphKey(selectedRef)] ?? null : null;

  const archiveBytes = useCallback(
    (archivePath: string): Uint8Array | null => doc?.brresFiles.find((file) => file.path === archivePath)?.bytes ?? null,
    [doc],
  );

  useEffect(() => {
    if (!selectedRef || !library) return;
    const key = materialRefKey(selectedRef);
    if (docs[key]) return;
    const bytes = archiveBytes(selectedRef.archivePath);
    if (!bytes) return;
    try {
      const decoded = library.decodeMaterial(bytes, selectedRef.modelName, selectedRef.materialName);
      setDocs((current) => ({ ...current, [key]: decoded }));
    } catch (error) {
      setStatus(`${selectedRef.materialName} could not be read, so it cannot be edited.`);
    }
  }, [archiveBytes, docs, library, selectedRef]);

  useEffect(() => {
    if (!selectedRef || !library || !materialDoc) return;
    const key = sessionGraphKey(selectedRef);
    if (graphs[key]) return;
    let cancelled = false;
    const fallback = autoLayout(library.decompileShader(materialDoc));
    void loadStoredGraph(selectedRef, materialDoc.tevStages).then((stored) => {
      if (cancelled) return;
      // A graph stored before this build learned a node still holds read-only "Special step"
      // cards for steps it can now draw properly; prefer the fresh read and lose only the layout.
      const chosen = stored && countRawStages(stored) <= countRawStages(fallback) ? stored : fallback;
      setGraphs((current) => (current[key] ? current : { ...current, [key]: chosen }));
    });
    return () => { cancelled = true; };
  }, [graphs, library, materialDoc, selectedRef]);

  useEffect(() => {
    if (!library || !graph || !materialDoc) return;
    const timer = window.setTimeout(() => setCompiled(library.compileShaderGraph(graph, materialDoc)), COMPILE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [graph, library, materialDoc]);

  const selectedMeshes = useMemo<SceneMeshEntry[]>(() => {
    void sceneEpoch;
    if (!selectedRef) return [];
    return findStudioMaterialMeshes(sceneRef.current, selectedRef.archivePath, selectedRef.modelName, selectedRef.materialName);
  }, [sceneEpoch, selectedRef]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const highlights = [
      ...selectedMeshes.map((mesh) => ({ target: mesh, selected: true })),
      ...(hoveredMesh && !selectedMeshes.some((mesh) => mesh.drawOpIndex === hoveredMesh.drawOpIndex && mesh.modelName === hoveredMesh.modelName)
        ? [{ target: hoveredMesh, selected: false }]
        : []),
    ];
    scene.setEditorMeshHighlight?.(highlights);
  }, [hoveredMesh, selectedMeshes]);

  const selectMaterial = useCallback((ref: GxMaterialRef | null) => {
    setSelectedRef(ref);
    if (ref) setStatus(`Selected ${ref.materialName}.`);
  }, []);

  // ------------------------------------------------------------------ editing

  const surfaceWarnings = useCallback(
    (warnings: readonly string[]) => {
      for (const message of warnings) {
        if (warnedRef.current.has(message)) continue;
        warnedRef.current.add(message);
        toast.showToast({ tone: 'warning', title: 'Model Studio', detail: message });
      }
    },
    [toast],
  );

  const pushHistory = useCallback((entry: StudioHistoryEntry) => {
    setUndoStack((current) => [...current.slice(-(HISTORY_LIMIT - 1)), entry]);
    setRedoStack([]);
  }, []);

  const updateMaterial = useCallback(
    (next: GxMaterialDoc, options: { transient?: boolean; status?: string } = {}) => {
      const ref = selectedRef;
      if (!ref || !doc) return;
      const key = materialRefKey(ref);
      const nextDocs = { ...docs, [key]: next };
      setDocs(nextDocs);
      if (options.transient || !library) return;

      const bytes = archiveBytes(ref.archivePath);
      if (!bytes) return;
      try {
        const result = library.applyMaterial(bytes, ref.modelName, ref.materialName, next);
        pushHistory({ doc, docs });
        const nextDoc = replaceStudioBrres(doc, ref.archivePath, result.brres);
        setDoc(nextDoc);
        surfaceWarnings(result.warnings);
        const live = sceneRef.current?.reloadEditorMaterial?.(ref.archivePath, ref.modelName, ref.materialName, result.brres) ?? false;
        setSceneEpoch((value) => value + 1);
        const bridge = trackBridgeRef.current;
        if (bridge && bridge.origin.archivePath === nextDoc.origin?.archivePath) {
          bridge.commit(result.brres, options.status ?? `Edited ${ref.materialName}.`);
        }
        if (options.status) {
          setStatus(live ? options.status : `${options.status} The studio viewport could not show it live.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`${ref.materialName} could not be saved, so nothing was changed.`);
        toast.showToast({ tone: 'error', title: `${ref.materialName} could not be saved`, detail: message });
      }
    },
    [archiveBytes, doc, docs, library, pushHistory, selectedRef, surfaceWarnings, toast],
  );

  const importTexture = useCallback(
    (texture: { name: string; format: number; width: number; height: number; mipCount: number; data: Uint8Array }): boolean => {
      const ref = selectedRef;
      if (!ref || !doc || !library) return false;
      const bytes = archiveBytes(ref.archivePath);
      if (!bytes) return false;
      const nextBytes = library.addTexture(bytes, {
        name: texture.name,
        format: texture.format as never,
        width: texture.width,
        height: texture.height,
        mipCount: texture.mipCount,
        data: texture.data,
      });
      pushHistory({ doc, docs });
      const nextDoc = replaceStudioBrres(doc, ref.archivePath, nextBytes);
      setDoc(nextDoc);
      try {
        setMaterials((current) => ({ ...current, [ref.archivePath]: library.listArchiveMaterials(ref.archivePath, nextBytes) }));
      } catch {
        // The listing is a convenience; the bytes are already written.
      }
      const live = sceneRef.current?.addEditorTexture?.(texture.name, texture) ?? false;
      const bridge = trackBridgeRef.current;
      if (bridge && bridge.origin.archivePath === nextDoc.origin?.archivePath) bridge.commit(nextBytes, `Imported ${texture.name}.`);
      setSceneEpoch((value) => value + 1);
      setStatus(live ? `Imported ${texture.name}.` : `Imported ${texture.name}, but the viewport could not upload it.`);
      return true;
    },
    [archiveBytes, doc, docs, library, pushHistory, selectedRef],
  );

  // ------------------------------------------------------------------ graph

  const setGraph = useCallback(
    (next: EditorShaderGraph, options: { record?: boolean; undoFrom?: EditorShaderGraph; edited?: boolean } = {}) => {
      const ref = selectedRef;
      if (!ref) return;
      const key = sessionGraphKey(ref);
      if (options.record !== false) {
        const entry = graphHistoryRef.current.get(key) ?? { undo: [], redo: [] };
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
    [graphs, selectedRef],
  );

  const graphHistoryState = useMemo(() => {
    const entry = selectedRef ? graphHistoryRef.current.get(sessionGraphKey(selectedRef)) : undefined;
    return { undo: entry?.undo.length ?? 0, redo: entry?.redo.length ?? 0 };
  }, [graphs, selectedRef]);

  const lastAppliedRef = useRef('');
  useEffect(() => {
    if (!materialDoc || !compiled?.ok || !selectedRef) return;
    if (!editedGraphsRef.current.has(sessionGraphKey(selectedRef))) return;
    const fingerprint = JSON.stringify(compiled.tevStages);
    if (fingerprint === JSON.stringify(materialDoc.tevStages)) {
      lastAppliedRef.current = fingerprint;
      return;
    }
    if (fingerprint === lastAppliedRef.current) return;
    lastAppliedRef.current = fingerprint;
    const next = { ...materialDoc, tevStages: compiled.tevStages.map((stage) => ({ ...stage })) };
    if (materialDocEquals(next, materialDoc)) return;
    const message = pendingGraphStatusRef.current ?? `Updated ${materialDoc.name} to match the shader graph.`;
    pendingGraphStatusRef.current = null;
    updateMaterial(next, { status: message });
  }, [compiled, materialDoc, selectedRef, updateMaterial]);

  // Only ever store a graph that really compiles to the material's current stages: the key is
  // those stages, so filing an edited graph under the pre-edit key would show it again for a
  // material it no longer describes.
  useEffect(() => {
    if (!selectedRef || !graph || !materialDoc) return;
    if (!compiled?.ok || JSON.stringify(compiled.tevStages) !== JSON.stringify(materialDoc.tevStages)) return;
    const timer = window.setTimeout(() => void saveStoredGraph(selectedRef, materialDoc.tevStages, graph), 600);
    return () => window.clearTimeout(timer);
  }, [compiled, graph, materialDoc, selectedRef]);

  const resetGraphFromStages = useCallback(() => {
    if (!library || !materialDoc) return;
    setGraph(autoLayout(library.decompileShader(materialDoc)), { edited: false });
    setStatus(`Rebuilt the graph from ${materialDoc.name} as it is now.`);
  }, [library, materialDoc, setGraph]);

  /** What a fresh read of this material's steps would still leave as read-only cards. */
  const freshRawStages = useMemo(
    () => (library && materialDoc ? countRawStages(library.decompileShader(materialDoc)) : 0),
    [library, materialDoc],
  );
  const rawStagesConvertible = countRawStages(graph) > freshRawStages;

  const convertRawStages = useCallback(() => {
    if (!library || !materialDoc) return;
    setGraph(autoLayout(library.decompileShader(materialDoc)), { edited: false });
    setStatus(
      freshRawStages === 0
        ? 'Rebuilt the graph — every step of this material is drawn as nodes now.'
        : `Rebuilt the graph. ${freshRawStages} step${freshRawStages === 1 ? '' : 's'} still cannot be drawn as nodes; the Stages tab shows ${freshRawStages === 1 ? 'it' : 'them'} in full.`,
    );
  }, [freshRawStages, library, materialDoc, setGraph]);

  const applyPreset = useCallback(
    (presetId: string) => {
      if (!library || !materialDoc) return;
      const preset = library.SHADER_GRAPH_PRESETS.find((entry) => entry.id === presetId);
      if (!preset) return;
      pendingGraphStatusRef.current = `Applied the "${preset.title}" shader.`;
      setGraph(preset.graph);
      const fallbackTexture = materialDoc.samplers[0]?.texture ?? materialSummary?.textures[0]?.name ?? '';
      let next = ensureLayerCount(materialDoc, preset.samplerCount, fallbackTexture);
      if (library.PRESET_WANTS_LIGHTING.has(preset.id)) next = withChannelLighting(next);
      if (materialDocEquals(next, materialDoc)) {
        setStatus(`Applied the "${preset.title}" shader.`);
        return;
      }
      updateMaterial(next, { status: `Applied the "${preset.title}" shader.` });
    },
    [library, materialDoc, materialSummary, setGraph, updateMaterial],
  );

  const runAutoLayout = useCallback(() => {
    if (!graph) return;
    setGraph(autoLayout(graph));
    setStatus('Laid the shader graph out left to right.');
  }, [graph, setGraph]);

  // ------------------------------------------------------------------ transport and toggles

  const setTransport = useCallback((next: StudioTransport) => {
    setTransportState(next);
    const scene = sceneRef.current;
    scene?.setStudioTransport?.({ playing: next.playing, speed: next.speed, loop: next.loop });
    if (!next.playing) scene?.setEditorSceneTimeFrames?.(next.frame);
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    scene?.setStudioTransport?.({ playing: transport.playing, speed: transport.speed, loop: transport.loop });
  }, [sceneEpoch, transport.loop, transport.playing, transport.speed]);

  // While it is playing the scene owns the clock; the UI mirrors it so the readout ticks.
  useEffect(() => {
    if (!transport.playing) return;
    let handle = 0;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      setTransportState((current) => {
        const scene = sceneRef.current;
        const frame = scene?.getEditorSceneTimeFrames?.();
        if (frame !== undefined) return current.frame === frame ? current : { ...current, frame };
        return advanceTransport(current, delta, timelineDuration);
      });
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [timelineDuration, transport.playing]);

  const toggleAnimation = useCallback((archivePath: string, kind: string, name: string, enabled: boolean) => {
    sceneRef.current?.setEditorAnimationEnabled?.(archivePath, kind, name, enabled);
    setSceneEpoch((value) => value + 1);
    setStatus(enabled ? `Playing ${name}.` : `Stopped ${name}.`);
  }, []);

  const setRenderSettings = useCallback((next: StudioRenderSettings) => {
    setRenderSettingsState(next);
    const scene = sceneRef.current;
    scene?.setEditorTexturesEnabled?.(next.textures);
    scene?.setEditorVertexColorsEnabled?.(next.vertexColors);
    scene?.setEditorLightingEnabled?.(next.lighting);
    scene?.setEditorWireframe?.(next.wireframe);
    scene?.setStudioGridVisible?.(next.grid);
  }, []);

  const setArchiveVisible = useCallback((archivePath: string, visible: boolean) => {
    sceneRef.current?.setEditorSceneModelVisible?.(archivePath, visible);
    setSceneEpoch((value) => value + 1);
  }, []);

  const setModelVisible = useCallback((archivePath: string, modelName: string, visible: boolean) => {
    sceneRef.current?.setStudioModelVisible?.(archivePath, modelName, visible);
    setSceneEpoch((value) => value + 1);
  }, []);

  // ------------------------------------------------------------------ undo

  const restore = useCallback(
    (entry: StudioHistoryEntry, direction: 'undo' | 'redo') => {
      const previous = doc;
      setDoc(entry.doc);
      setDocs(entry.docs);
      // An edited graph *drives* its material: left in place, it would compile straight back over
      // the stages just restored and undo would seem to do nothing. So a material the step changed
      // drops its edited graph, which is then re-read for the restored stages — the stored layout
      // when there is one, exactly as when the material is first opened.
      const staleGraphs = [...new Set([...Object.keys(docs), ...Object.keys(entry.docs)])].filter(
        (key) => docs[key] !== entry.docs[key] && editedGraphsRef.current.has(key),
      );
      if (staleGraphs.length > 0) {
        for (const key of staleGraphs) {
          editedGraphsRef.current.delete(key);
          graphHistoryRef.current.delete(key);
        }
        setGraphs((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !staleGraphs.includes(key))));
      }
      const scene = sceneRef.current;
      if (scene && previous) {
        for (const file of entry.doc.brresFiles) {
          const before = previous.brresFiles.find((candidate) => candidate.path === file.path);
          if (before && before.bytes === file.bytes) continue;
          // Bytes changed: put them back in the viewport by reloading just that archive.
          try {
            scene.loadStudioArchive?.(file.path, file.bytes);
          } catch {
            // Handled by the status line below.
          }
        }
      }
      const bridge = trackBridgeRef.current;
      if (bridge && entry.doc.origin?.archivePath === bridge.origin.archivePath) {
        const file = entry.doc.brresFiles[0];
        if (file) bridge.commit(file.bytes, direction === 'undo' ? 'Undid the studio edit.' : 'Redid the studio edit.');
      }
      setSceneEpoch((value) => value + 1);
      setStatus(direction === 'undo' ? 'Undid the last edit.' : 'Redid the last edit.');
    },
    [doc, docs],
  );

  const undo = useCallback(() => {
    const entry = undoStack.at(-1);
    if (!entry || !doc) return;
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current.slice(-(HISTORY_LIMIT - 1)), { doc, docs }]);
    restore(entry, 'undo');
  }, [doc, docs, restore, undoStack]);

  const redo = useCallback(() => {
    const entry = redoStack.at(-1);
    if (!entry || !doc) return;
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current.slice(-(HISTORY_LIMIT - 1)), { doc, docs }]);
    restore(entry, 'redo');
  }, [doc, docs, redoStack, restore]);

  return {
    doc,
    loading,
    status,
    setStatus,
    library,
    archives,
    tree,
    query,
    setQuery,
    expanded,
    setExpanded,
    selectedRef,
    selectMaterial,
    materialDoc,
    materialSummary,
    selectedMeshes,
    hoveredMesh,
    setHoveredMesh,
    updateMaterial,
    importTexture,
    graph,
    compiled,
    graphDrivesMaterial: selectedRef !== null && editedGraphsRef.current.has(sessionGraphKey(selectedRef)),
    graphHistoryState,
    setGraph,
    stepGraphHistory,
    resetGraphFromStages,
    convertRawStages,
    rawStagesConvertible,
    applyPreset,
    runAutoLayout,
    transport,
    setTransport,
    timelineDuration,
    activeAnimations,
    toggleAnimation,
    renderSettings,
    setRenderSettings,
    setArchiveVisible,
    setModelVisible,
    historyState: { undo: undoStack.length, redo: redoStack.length },
    undo,
    redo,
    recents,
    openFile,
    openBytes,
    openDemo,
    attachScene,
    poseSignature: () => sceneRef.current?.getStudioPoseSignature?.() ?? null,
    frameRequest,
    edited: doc?.dirty ?? false,
  };
}
