/**
 * `useCreateSession`: everything Create mode needs behind one object (see `types.ts`).
 *
 *   kit            loaded once, the first time Create mode is shown
 *   projects       IndexedDB, debounced autosave, import/export files
 *   design         `designHistory.ts` snapshots; drags are one undo step
 *   derived        spline samples, preview geometry + models, raycaster, issues, checklist
 *                  (recomputed at most once per animation frame while a gesture is running)
 *   full compile   ~300 ms after the last change (immediately after a gesture ends): the design
 *                  becomes a real track archive in a worker, then `trackBridge` puts it into the
 *                  `TrackDocument` (first time through `openTrackBytes`, afterwards in place)
 *   conflicts      hand-edits of generated files made in other modes
 *   test drive     flush the compile, then the shared playtest session
 *
 * Almost everything below reads refs rather than state so the callbacks handed to the UI are
 * stable for the whole session.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeProject, type ProjectAnalysis } from '../../../lib/create/analyze';
import { buildPreviewModels, buildTrackArchive, compileGeometry, hashBytes, type PreviewCache } from '../../../lib/create/compile';
import { loadCreateKit } from '../../../lib/create/kit';
import { selectionExists, renameProject as renameProjectOp, updateGeneration } from '../../../lib/create/ops';
import { createRaycaster } from '../../../lib/create/raycast';
import { sampleRoad, type RoadSamples } from '../../../lib/create/spline';
import { createProjectFromTemplate } from '../../../lib/create/templates';
import type {
  BuildModelBrres,
  CompileWriters,
  CompiledGeometry,
  CreateHit,
  CreateIssue,
  CreateKit,
  CreatePreviewModel,
  CreateProject,
  CreateRay,
  CreateSelection,
} from '../../../lib/create/types';
import { readKmpFile, type KmpFile } from '../../../lib/kmpFile';
import type { EditorModeContext } from '../../modes/types';
import { buildChecklist } from './checklist';
import { compileOnThisThread, createCompileClient, type CompileClient } from './compileClient';
import type { CompileOutput } from './compileProtocol';
import { addLockedSections, detectConflicts, hashTrackFiles, sectionsToLock } from './conflicts';
import {
  beginGesture as historyBeginGesture,
  cancelGesture as historyCancelGesture,
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  commitEdit,
  createDesignHistory,
  endGesture as historyEndGesture,
  redo as historyRedo,
  redoLabel as historyRedoLabel,
  replacePresent,
  undo as historyUndo,
  undoLabel as historyUndoLabel,
  updateGesture as historyUpdateGesture,
  type DesignHistory,
} from './designHistory';
import { duplicateProjectData, reidentifyImportedProject, summarizeProject, uniqueProjectName } from './projectFile';
import {
  deleteStoredProject,
  downloadProjectFile,
  listProjectSummaries,
  loadStoredProject,
  projectStorageAvailable,
  readProjectFile,
  saveStoredProject,
} from './projectStore';
import { collectObjectResources, createSourceId, findBytes, isCreateSourceId, mergeCompileIntoTrack, normalizeArchivePath } from './trackBridge';
import type { CreateConflict, CreateProjectSummary, CreateSession, EditOptions, SaveState } from './types';

/** Time after the last edit before the full compile runs. */
export const COMPILE_DELAY_MS = 300;
/** While dragging, the analysis (issues, checklist) is refreshed at most this often. */
export const ANALYSIS_DURING_DRAG_MS = 350;
/** Time after the last edit before the design is written to IndexedDB. */
export const AUTOSAVE_DELAY_MS = 800;

interface Derived {
  samples: Map<string, RoadSamples>;
  geometry: CompiledGeometry | null;
  models: CreatePreviewModel[];
  analysis: ProjectAnalysis | null;
}

const EMPTY_DERIVED: Derived = { samples: new Map(), geometry: null, models: [], analysis: null };

interface LastCompile {
  projectId: string;
  /** The design that was compiled (identity-compared with the present to know if it is current). */
  project: CreateProject;
  output: CompileOutput;
  /** The generated layout as bytes round-trip (comparable with the track document's own). */
  kmpFile: KmpFile;
  /** Hash per generated file; updated when the user keeps a hand-edited file. */
  hashes: Record<string, string>;
  paths: string[];
}

/** The file name the track document (and so Export) carries. */
export function documentFileName(project: CreateProject): string {
  const base = project.name.trim().replace(/[\\/:*?"<>|]+/g, '') || 'My track';
  return `${base}.szs`;
}

export function friendlyKitError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Create mode could not load its building blocks (roads, surfaces and worlds). ${detail}`;
}

function sameModels(a: CreatePreviewModel[], b: CreatePreviewModel[]): boolean {
  return a.length === b.length && a.every((model, i) => model === b[i]);
}

function view(typed: Float32Array | Uint32Array | Uint16Array): Uint8Array {
  return new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
}

/** Cheap fingerprint of a collision mesh, so the raycaster is only rebuilt when it changed. */
export function collisionKey(collision: CompiledGeometry['collision']): string {
  return `${collision.flags.length}:${hashBytes(view(collision.positions))}:${hashBytes(view(collision.indices))}`;
}

function nextFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(callback, 16) as unknown as number;
}

function cancelFrame(id: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
}

export function useCreateSession(ctx: EditorModeContext): CreateSession {
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const active = ctx.editorMode === 'create';

  // ── Kit ──────────────────────────────────────────────────────────────────────────────────
  const [kit, setKit] = useState<CreateKit | null>(null);
  const [kitError, setKitError] = useState<string | null>(null);
  const kitRef = useRef<CreateKit | null>(null);
  const writersRef = useRef<CompileWriters | null>(null);
  const kitPromiseRef = useRef<Promise<CreateKit> | null>(null);

  /** Starts loading the kit (once); everything that needs it awaits the returned promise. */
  const startKit = useCallback((): Promise<CreateKit> => {
    if (kitRef.current) return Promise.resolve(kitRef.current);
    if (kitPromiseRef.current) return kitPromiseRef.current;
    setKitError(null);
    const promise = Promise.all([loadCreateKit(), import('../../../lib/create/writers')]).then(([loaded, writerModule]) => {
      writersRef.current = writerModule.writers;
      kitRef.current = loaded;
      return loaded;
    });
    kitPromiseRef.current = promise;
    promise.then(
      (loaded) => setKit(loaded),
      (error) => {
        kitPromiseRef.current = null;
        setKitError(friendlyKitError(error));
      },
    );
    return promise;
  }, []);

  // The kit is 5 MB: only fetch it once somebody actually opens Create mode.
  useEffect(() => {
    if (active) startKit().catch(() => undefined);
  }, [active, startKit]);

  const retryKit = useCallback(() => {
    kitPromiseRef.current = null;
    startKit().catch(() => undefined);
  }, [startKit]);

  const requireKit = startKit;

  // ── Design state ─────────────────────────────────────────────────────────────────────────
  const [history, setHistoryState] = useState<DesignHistory | null>(null);
  const historyRef = useRef<DesignHistory | null>(null);
  const [selection, setSelection] = useState<CreateSelection[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [projects, setProjects] = useState<CreateProjectSummary[]>([]);
  const [derived, setDerived] = useState<Derived>(EMPTY_DERIVED);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [compileStats, setCompileStats] = useState<CreateSession['compileStats']>(null);
  const [testDrivenFor, setTestDrivenFor] = useState<CreateProject | null>(null);
  const [conflicts, setConflicts] = useState<CreateConflict[]>([]);
  const [lastCompileVersion, setLastCompileVersion] = useState(0);

  const project = history?.present ?? null;

  // Refs that the async work reads.
  const derivedRaf = useRef(0);
  const derivedTimings = useRef({ geometryMillis: 0, previewMillis: 0 });
  const previewCache = useRef<PreviewCache>(new Map());
  const previewRevision = useRef(0);
  const previewByBytes = useRef(new WeakMap<Uint8Array, CreatePreviewModel>());
  const samplesCache = useRef(new WeakMap<object, RoadSamples>());
  const raycasterRef = useRef<((ray: CreateRay) => CreateHit | null) | null>(null);
  const analysisRef = useRef<ProjectAnalysis | null>(null);
  const lastAnalysisAt = useRef(0);
  const collisionKeyRef = useRef('');
  const compileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compileRunning = useRef(false);
  const compileDirty = useRef(false);
  const compileGeneration = useRef(0);
  const compileWaiters = useRef<Array<() => void>>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCompile = useRef<LastCompile | null>(null);
  const keepPaths = useRef(new Set<string>());
  const overwriteOnce = useRef(false);
  const clearMeshEditsOnce = useRef(false);
  const lastThemeId = useRef<string | null>(null);
  const clientRef = useRef<CompileClient | null>(null);
  const driveStartedFor = useRef<CreateProject | null>(null);
  /** The user already agreed to replace the open (unexported) track for the design being opened. */
  const foreignConfirmed = useRef(false);
  const wasPlaytesting = useRef(false);

  const getClient = useCallback((): CompileClient => {
    if (!clientRef.current) {
      clientRef.current = createCompileClient(async () => {
        const loaded = await requireKit();
        const writers = writersRef.current;
        if (!writers) throw new Error('The track writers are not loaded yet.');
        return { kit: loaded, writers };
      });
    }
    return clientRef.current;
  }, [requireKit]);

  // ── Derived data (samples, preview geometry, models, raycaster, analysis) ────────────────

  const runDerived = useCallback(() => {
    derivedRaf.current = 0;
    const present = historyRef.current?.present ?? null;
    const loadedKit = kitRef.current;
    const writers = writersRef.current;
    if (!present || !loadedKit || !writers) {
      setDerived(EMPTY_DERIVED);
      raycasterRef.current = null;
      collisionKeyRef.current = '';
      return;
    }
    try {
      const samples = new Map<string, RoadSamples>();
      for (const road of present.roads) {
        if (road.points.length < 2) continue;
        let cached = samplesCache.current.get(road);
        if (!cached) {
          cached = sampleRoad(road);
          samplesCache.current.set(road, cached);
        }
        samples.set(road.id, cached);
      }

      const t0 = performance.now();
      const geometry = compileGeometry(present, loadedKit);
      const t1 = performance.now();
      // noclip caches models globally by name, so every rebuilt chunk needs a name of its own.
      const names = new WeakMap<Uint8Array, string>();
      const buildModelBrres: BuildModelBrres = (input) => {
        const modelName = `${input.modelName}_r${++previewRevision.current}`;
        const brres = writers.buildModelBrres({ ...input, modelName });
        names.set(brres, modelName);
        return brres;
      };
      const built = buildPreviewModels(geometry, loadedKit, buildModelBrres, previewCache.current);
      const models = built.map((model) => {
        const hit = previewByBytes.current.get(model.brres);
        if (hit && hit.revision === model.revision) return hit;
        const patched: CreatePreviewModel = { ...model, modelName: names.get(model.brres) ?? model.modelName };
        previewByBytes.current.set(model.brres, patched);
        return patched;
      });
      const t2 = performance.now();
      derivedTimings.current = { geometryMillis: t1 - t0, previewMillis: t2 - t1 };

      const key = collisionKey(geometry.collision);
      if (key !== collisionKeyRef.current || !raycasterRef.current) {
        collisionKeyRef.current = key;
        raycasterRef.current = createRaycaster(geometry.collision);
      }

      // The checklist and issues do not need to update on every frame of a drag.
      const dragging = !!historyRef.current?.gesture;
      const stale = performance.now() - lastAnalysisAt.current > ANALYSIS_DURING_DRAG_MS;
      const compiled = lastCompile.current;
      const current = compiled && compiled.project === present ? { kmp: compiled.output.kmp, issues: compiled.output.issues } : null;
      const analysis = dragging && !stale && analysisRef.current ? analysisRef.current : analyzeProject(present, loadedKit, current);
      if (analysis !== analysisRef.current) {
        analysisRef.current = analysis;
        lastAnalysisAt.current = performance.now();
      }

      setDerived((previous) => ({
        samples,
        geometry,
        models: sameModels(previous.models, models) ? previous.models : models,
        analysis,
      }));
      setCompileError(null);
    } catch (error) {
      console.error('[create] preview failed', error);
      setCompileError(`Something in this design could not be previewed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const scheduleDerived = useCallback(() => {
    if (derivedRaf.current) return;
    derivedRaf.current = nextFrame(runDerived);
  }, [runDerived]);

  // ── Autosave ─────────────────────────────────────────────────────────────────────────────

  const upsertSummary = useCallback((summary: CreateProjectSummary) => {
    setProjects((list) => [summary, ...list.filter((entry) => entry.id !== summary.id)].sort((a, b) => b.updatedAt - a.updatedAt));
  }, []);

  const saveNow = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const h = historyRef.current;
    if (!h || !projectStorageAvailable()) return;
    const present = h.present;
    const toSave: CreateProject = { ...present, compiledHashes: lastCompile.current?.projectId === present.id ? lastCompile.current.hashes : present.compiledHashes };
    setSaveState('saving');
    try {
      await saveStoredProject(toSave);
      upsertSummary(summarizeProject(toSave));
      if (historyRef.current?.present === present) setSaveState(saveTimer.current ? 'unsaved' : 'saved');
    } catch (error) {
      console.error('[create] save failed', error);
      setSaveState('error');
      ctxRef.current.setStatus('Could not save your track in this browser. Use "Export design file" to keep a copy.');
    }
  }, [upsertSummary]);

  const scheduleSave = useCallback(() => {
    setSaveState('unsaved');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      if (historyRef.current?.gesture) {
        scheduleSave();
        return;
      }
      void saveNow();
    }, AUTOSAVE_DELAY_MS);
  }, [saveNow]);

  // ── Full compile ─────────────────────────────────────────────────────────────────────────

  const finishWaiters = useCallback(() => {
    const waiting = compileWaiters.current;
    compileWaiters.current = [];
    for (const resolve of waiting) resolve();
  }, []);

  const foreignTrackNeedsConfirm = useCallback((): boolean => {
    const c = ctxRef.current;
    const track = c.trackRef.current;
    if (!track || isCreateSourceId(track.sourceId)) return false;
    return c.history.historyState.undo > 0;
  }, []);

  /** Puts a finished compile into the track document. Returns false when it was held back. */
  const applyOutput = useCallback(
    async (compiledProject: CreateProject, output: CompileOutput, startedAt: number): Promise<boolean> => {
      const c = ctxRef.current;
      const sourceId = createSourceId(compiledProject.id);
      const files = new Map(output.files);
      const kmpBytes = files.get('course.kmp');
      const resources = collectObjectResources(output.kmp, c.commonArchive);
      const track = c.trackRef.current;
      const mine = !!track && track.sourceId === sourceId;
      const previous = lastCompile.current?.projectId === compiledProject.id ? lastCompile.current : null;

      if (mine && track) {
        // Hand-edits made elsewhere must never be overwritten silently.
        if (previous && !overwriteOnce.current) {
          const found = detectConflicts({ compiledHashes: previous.hashes, track, generatedKmp: previous.kmpFile });
          if (found.length > 0) {
            setConflicts(found);
            return false;
          }
        }
        const merged = mergeCompileIntoTrack(track, files, {
          keepPaths: keepPaths.current,
          previousPaths: previous?.paths,
          resources,
          clearMeshEdits: clearMeshEditsOnce.current,
          fileName: documentFileName(compiledProject),
        });
        overwriteOnce.current = false;
        clearMeshEditsOnce.current = false;
        c.applyGeneratedTrack(merged);
      } else {
        for (const [path, bytes] of resources) if (!files.has(path)) files.set(path, bytes);
        // A brand-new document: nothing measured before applies to it.
        lastCompile.current = null;
        const archive = buildTrackArchive({ files }, { compress: false });
        const opened = await c.openTrackBytes(archive, documentFileName(compiledProject), { sourceId });
        if (!opened) return false;
        overwriteOnce.current = false;
        clearMeshEditsOnce.current = false;
        keepPaths.current = new Set();
      }

      lastCompile.current = {
        projectId: compiledProject.id,
        project: compiledProject,
        output,
        kmpFile: kmpBytes ? readKmpFile(kmpBytes) : output.kmp,
        hashes: { ...output.hashes },
        paths: [...files.keys()],
      };
      // Files the user chose to keep are measured as they are, so they are not reported again.
      const nowTrack = c.trackRef.current;
      if (nowTrack && keepPaths.current.size > 0) {
        for (const path of keepPaths.current) {
          const key = Object.keys(lastCompile.current.hashes).find((candidate) => normalizeArchivePath(candidate) === path);
          const bytes = key ? findBytes(nowTrack.archiveEntries, key) : null;
          if (key && bytes) lastCompile.current.hashes[key] = hashBytes(bytes);
        }
      }
      setLastCompileVersion((n) => n + 1);
      setConflicts([]);
      setCompileStats({
        stats: output.stats,
        geometryMillis: derivedTimings.current.geometryMillis,
        previewMillis: derivedTimings.current.previewMillis,
        fullMillis: performance.now() - startedAt,
      });

      const themeChanged = lastThemeId.current !== null && lastThemeId.current !== compiledProject.themeId && mine;
      lastThemeId.current = compiledProject.themeId;
      if (themeChanged) c.refreshScene();
      scheduleDerived();
      return true;
    },
    [scheduleDerived],
  );

  const runCompile = useCallback(async () => {
    if (compileTimer.current) {
      clearTimeout(compileTimer.current);
      compileTimer.current = null;
    }
    const h = historyRef.current;
    if (!h) {
      setCompiling(false);
      finishWaiters();
      return;
    }
    if (h.gesture) return; // The gesture's end schedules the compile.
    if (compileRunning.current) {
      compileDirty.current = true;
      return;
    }
    if (ctxRef.current.editorMode !== 'create') {
      // Not our turn: edits made elsewhere are picked up when Create mode is shown again.
      compileDirty.current = true;
      setCompiling(false);
      finishWaiters();
      return;
    }
    const present = h.present;
    compileRunning.current = true;
    compileDirty.current = false;
    setCompiling(true);
    const generation = ++compileGeneration.current;
    const startedAt = performance.now();
    try {
      const track = ctxRef.current.trackRef.current;
      const mine = !!track && track.sourceId === createSourceId(present.id);
      const previousKmp = present.generation.lockedKmpSections.length > 0 && mine ? track?.kmpFile ?? null : null;
      const output = await getClient().compile({ project: present, previousKmp });
      if (generation !== compileGeneration.current) return;
      if (historyRef.current?.present.id !== present.id) return;
      await applyOutput(present, output, startedAt);
      setCompileError(null);
    } catch (error) {
      console.error('[create] compile failed', error);
      setCompileError(`This design could not be turned into a track: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      compileRunning.current = false;
      const stale = historyRef.current?.present !== present || compileDirty.current;
      if (stale && historyRef.current && !historyRef.current.gesture && ctxRef.current.editorMode === 'create') {
        // More edits arrived while compiling: go again straight away.
        void runCompile();
      } else {
        setCompiling((stale && !!historyRef.current?.gesture) || !!compileTimer.current);
        finishWaiters();
      }
    }
  }, [applyOutput, finishWaiters, getClient]);

  const scheduleCompile = useCallback(
    (delay: number) => {
      if (compileTimer.current) clearTimeout(compileTimer.current);
      setCompiling(true);
      compileTimer.current = setTimeout(() => {
        compileTimer.current = null;
        void runCompile();
      }, delay);
    },
    [runCompile],
  );

  /** Resolves when no compile is pending or running. */
  const settleCompile = useCallback(async () => {
    if (compileTimer.current) {
      clearTimeout(compileTimer.current);
      compileTimer.current = null;
      void runCompile();
    }
    if (!compileRunning.current && !compileDirty.current) return;
    await new Promise<void>((resolve) => {
      compileWaiters.current.push(resolve);
      if (!compileRunning.current) void runCompile();
    });
  }, [runCompile]);

  /** Synchronous compile for Export: a result computed on this thread, now. */
  const flushCompile = useCallback(() => {
    const h = historyRef.current;
    const loadedKit = kitRef.current;
    const writers = writersRef.current;
    if (!h || !loadedKit || !writers) return;
    const c = ctxRef.current;
    const track = c.trackRef.current;
    const mine = !!track && track.sourceId === createSourceId(h.present.id);
    const upToDate = lastCompile.current?.project === h.present && !compileTimer.current && !compileRunning.current && !compileDirty.current;
    if (!mine || upToDate) return;
    try {
      const present = h.present;
      const previousKmp = present.generation.lockedKmpSections.length > 0 ? track?.kmpFile ?? null : null;
      // Anything already in flight is now out of date.
      compileGeneration.current++;
      if (compileTimer.current) {
        clearTimeout(compileTimer.current);
        compileTimer.current = null;
      }
      const startedAt = performance.now();
      const output = compileOnThisThread({ kit: loadedKit, writers }, { project: present, previousKmp });
      const previous = lastCompile.current;
      const mergedTrack = mergeCompileIntoTrack(track!, new Map(output.files), {
        keepPaths: keepPaths.current,
        previousPaths: previous?.projectId === present.id ? previous.paths : undefined,
        resources: collectObjectResources(output.kmp, c.commonArchive),
        fileName: documentFileName(present),
      });
      c.applyGeneratedTrack(mergedTrack);
      lastCompile.current = {
        projectId: present.id,
        project: present,
        output,
        kmpFile: readKmpFile(output.files.find(([path]) => path === 'course.kmp')![1]),
        hashes: { ...output.hashes },
        paths: output.files.map(([path]) => path),
      };
      setLastCompileVersion((n) => n + 1);
      setCompileStats((old) => ({ stats: output.stats, geometryMillis: old?.geometryMillis ?? 0, previewMillis: old?.previewMillis ?? 0, fullMillis: performance.now() - startedAt }));
      setCompiling(false);
    } catch (error) {
      console.error('[create] flush failed', error);
      setCompileError(`This design could not be turned into a track: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  // ── History plumbing ─────────────────────────────────────────────────────────────────────

  const pruneSelection = useCallback((next: CreateProject) => {
    setSelection((current) => {
      const kept = current.filter((entry) => selectionExists(next, entry));
      return kept.length === current.length ? current : kept;
    });
  }, []);

  /** Installs a new history. The one place that reacts to design changes. */
  const apply = useCallback(
    (next: DesignHistory | null, options: { compile?: boolean | 'now'; save?: boolean } = {}) => {
      const previous = historyRef.current;
      historyRef.current = next;
      setHistoryState(next);
      if (!next) return;
      const changed = !previous || previous.present !== next.present;
      if (changed) {
        scheduleDerived();
        pruneSelection(next.present);
        if (next.gesture) {
          // Mid-drag: the full compile waits for the pointer to go up.
          if (compileTimer.current) clearTimeout(compileTimer.current);
          compileTimer.current = null;
          setCompiling(true);
        } else if (options.compile !== false) {
          scheduleCompile(options.compile === 'now' ? 0 : COMPILE_DELAY_MS);
        }
        if (options.save !== false) scheduleSave();
      }
    },
    [pruneSelection, scheduleCompile, scheduleDerived, scheduleSave],
  );

  // ── Public actions ───────────────────────────────────────────────────────────────────────

  const edit = useCallback(
    (mutate: (project: CreateProject) => CreateProject, options: EditOptions) => {
      const h = historyRef.current;
      if (!h) return;
      apply(commitEdit(h, mutate(h.present), options.label));
    },
    [apply],
  );

  const beginGesture = useCallback(
    (options: EditOptions) => {
      const h = historyRef.current;
      if (h) apply(historyBeginGesture(h, options.label));
    },
    [apply],
  );

  const updateGesture = useCallback(
    (mutate: (projectAtBegin: CreateProject) => CreateProject) => {
      const h = historyRef.current;
      if (h?.gesture) apply(historyUpdateGesture(h, mutate));
    },
    [apply],
  );

  const endGesture = useCallback(() => {
    const h = historyRef.current;
    if (!h?.gesture) return;
    const changed = h.present !== h.gesture.base;
    apply(historyEndGesture(h), { compile: false, save: false });
    lastAnalysisAt.current = 0;
    scheduleDerived();
    if (changed) {
      scheduleCompile(0);
      scheduleSave();
    } else {
      setCompiling(!!compileTimer.current || compileRunning.current);
    }
  }, [apply, scheduleCompile, scheduleDerived, scheduleSave]);

  const cancelGesture = useCallback(() => {
    const h = historyRef.current;
    if (h?.gesture) apply(historyCancelGesture(h));
  }, [apply]);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h) apply(historyUndo(h));
  }, [apply]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h) apply(historyRedo(h));
  }, [apply]);

  const select = useCallback(
    (next: CreateSelection[] | CreateSelection | null, options?: { additive?: boolean }) => {
      const list = next === null ? [] : Array.isArray(next) ? next : [next];
      setSelection((current) => {
        if (!options?.additive) return list;
        const same = (a: CreateSelection, b: CreateSelection) => JSON.stringify(a) === JSON.stringify(b);
        const out = [...current];
        for (const entry of list) {
          const at = out.findIndex((x) => same(x, entry));
          if (at >= 0) out.splice(at, 1);
          else out.push(entry);
        }
        return out;
      });
    },
    [],
  );

  // ── Projects ─────────────────────────────────────────────────────────────────────────────

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await listProjectSummaries());
    } catch (error) {
      console.error('[create] could not list designs', error);
      ctxRef.current.setStatus('Could not read your saved tracks from this browser.');
    }
  }, []);

  useEffect(() => {
    // Cheap (summaries only), and the welcome screen offers to carry on with the latest design.
    void refreshProjects();
  }, [active, refreshProjects]);

  const installProject = useCallback(
    (next: CreateProject) => {
      // A pending save belongs to the design that is going away.
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (compileTimer.current) {
        clearTimeout(compileTimer.current);
        compileTimer.current = null;
      }
      compileGeneration.current++;
      lastCompile.current = null;
      keepPaths.current = new Set();
      overwriteOnce.current = false;
      clearMeshEditsOnce.current = false;
      lastThemeId.current = null;
      previewCache.current = new Map();
      analysisRef.current = null;
      raycasterRef.current = null;
      collisionKeyRef.current = '';
      setSelection([]);
      setConflicts([]);
      setTestDrivenFor(null);
      setCompileError(null);
      setCompileStats(null);
      setDerived(EMPTY_DERIVED);
      apply(createDesignHistory(next), { compile: 'now', save: false });
    },
    [apply],
  );

  const flushSaveBeforeLeaving = useCallback(async () => {
    if (historyRef.current) await saveNow();
  }, [saveNow]);

  const confirmLeaveForeignTrack = useCallback((): boolean => {
    if (!foreignTrackNeedsConfirm()) return true;
    const ok = window.confirm('Building a track replaces the track you have open, and it has changes you have not exported. Replace it anyway?');
    foreignConfirmed.current = ok;
    return ok;
  }, [foreignTrackNeedsConfirm]);

  const newProject = useCallback(
    async (templateId: string, options: { name: string; themeId: string; laps: number }) => {
      const loadedKit = await requireKit();
      if (!confirmLeaveForeignTrack()) return;
      await flushSaveBeforeLeaving();
      const created = createProjectFromTemplate(templateId, options, loadedKit);
      await saveStoredProject(created).catch((error) => console.error('[create] first save failed', error));
      upsertSummary(summarizeProject(created));
      installProject(created);
      ctxRef.current.createWizard.setOpen(false);
      setSaveState('saved');
    },
    [confirmLeaveForeignTrack, flushSaveBeforeLeaving, installProject, requireKit, upsertSummary],
  );

  const openProject = useCallback(
    async (id: string) => {
      await requireKit();
      if (historyRef.current?.present.id === id) return;
      const loaded = await loadStoredProject(id).catch((error) => {
        console.error('[create] could not open design', error);
        return null;
      });
      if (!loaded) {
        ctxRef.current.setStatus('Could not open that track: it is no longer saved in this browser.');
        void refreshProjects();
        return;
      }
      if (!confirmLeaveForeignTrack()) return;
      await flushSaveBeforeLeaving();
      installProject(loaded);
      setSaveState('saved');
    },
    [confirmLeaveForeignTrack, flushSaveBeforeLeaving, installProject, refreshProjects, requireKit],
  );

  const closeProject = useCallback(() => {
    void saveNow();
    if (compileTimer.current) {
      clearTimeout(compileTimer.current);
      compileTimer.current = null;
    }
    setCompiling(false);
    setSelection([]);
    setConflicts([]);
    apply(null);
    setDerived(EMPTY_DERIVED);
  }, [apply, saveNow]);

  const deleteProject = useCallback(
    async (id: string) => {
      if (historyRef.current?.present.id === id) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = null;
        apply(null);
        setDerived(EMPTY_DERIVED);
      }
      await deleteStoredProject(id).catch((error) => console.error('[create] delete failed', error));
      setProjects((list) => list.filter((entry) => entry.id !== id));
    },
    [apply],
  );

  const duplicateProject = useCallback(
    async (id: string) => {
      const source = historyRef.current?.present.id === id ? historyRef.current.present : await loadStoredProject(id);
      if (!source) return;
      const copy = duplicateProjectData(source);
      copy.name = uniqueProjectName(copy.name, projects.map((p) => p.name));
      await saveStoredProject(copy);
      upsertSummary(summarizeProject(copy));
    },
    [projects, upsertSummary],
  );

  const renameProject = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const h = historyRef.current;
      if (h?.present.id === id) {
        apply(commitEdit(h, renameProjectOp(h.present, trimmed), 'Rename track'));
        return;
      }
      const stored = await loadStoredProject(id);
      if (!stored) return;
      const renamed = renameProjectOp(stored, trimmed);
      await saveStoredProject(renamed);
      upsertSummary(summarizeProject(renamed));
    },
    [apply, upsertSummary],
  );

  const importProjectFile = useCallback(
    async (file: File) => {
      try {
        await requireKit();
        const parsed = await readProjectFile(file);
        const imported = reidentifyImportedProject(parsed, new Set(projects.map((p) => p.id)));
        if (!confirmLeaveForeignTrack()) return;
        await flushSaveBeforeLeaving();
        await saveStoredProject(imported);
        upsertSummary(summarizeProject(imported));
        installProject(imported);
        setSaveState('saved');
        ctxRef.current.setStatus(`Imported ${imported.name}.`);
      } catch (error) {
        ctxRef.current.setStatus(`Could not import that file: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [confirmLeaveForeignTrack, flushSaveBeforeLeaving, installProject, projects, requireKit, upsertSummary],
  );

  const exportProjectFile = useCallback((id?: string) => {
    const h = historyRef.current;
    if (h && (!id || h.present.id === id)) {
      downloadProjectFile({ ...h.present, compiledHashes: lastCompile.current?.hashes ?? h.present.compiledHashes });
      return;
    }
    if (!id) return;
    void loadStoredProject(id).then((stored) => {
      if (stored) downloadProjectFile(stored);
      else ctxRef.current.setStatus('Could not export that track: it is no longer saved in this browser.');
    });
  }, []);

  // ── Conflicts ────────────────────────────────────────────────────────────────────────────

  const track = ctx.track;
  const detectedConflicts = useMemo<CreateConflict[]>(() => {
    const compiled = lastCompile.current;
    if (!active || !project || !compiled || compiled.projectId !== project.id || !track || track.sourceId !== createSourceId(project.id)) return [];
    return detectConflicts({ compiledHashes: compiled.hashes, track, generatedKmp: compiled.kmpFile });
    // `lastCompileVersion` stands in for the ref's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, project?.id, track, lastCompileVersion]);

  useEffect(() => {
    setConflicts((current) => {
      if (current.length === detectedConflicts.length && current.every((c, i) => c.path === detectedConflicts[i].path && c.what === detectedConflicts[i].what)) return current;
      return detectedConflicts;
    });
  }, [detectedConflicts]);

  const resolveConflicts = useCallback(
    (choice: 'keep' | 'rebuild') => {
      const h = historyRef.current;
      const compiled = lastCompile.current;
      const c = ctxRef.current;
      const doc = c.trackRef.current;
      if (!h || !compiled || !doc) return;
      const current = detectConflicts({ compiledHashes: compiled.hashes, track: doc, generatedKmp: compiled.kmpFile });
      const nowHashes = hashTrackFiles(doc, current.map((entry) => entry.path));
      if (choice === 'keep') {
        const lock = sectionsToLock(current, compiled.kmpFile, doc.kmpFile);
        for (const entry of current) {
          const key = normalizeArchivePath(entry.path);
          if (key !== 'course.kmp') keepPaths.current.add(key);
        }
        if (lock.length > 0) {
          apply(replacePresent(h, updateGeneration(h.present, { lockedKmpSections: addLockedSections(h.present.generation.lockedKmpSections, lock) })), { compile: false });
        }
      } else {
        overwriteOnce.current = true;
        keepPaths.current = new Set();
        if (current.some((entry) => normalizeArchivePath(entry.path) === 'course_model.brres')) clearMeshEditsOnce.current = true;
        if (h.present.generation.lockedKmpSections.length > 0) {
          apply(replacePresent(h, updateGeneration(h.present, { lockedKmpSections: [] })), { compile: false });
        }
      }
      // The hand-edited files are now either kept or about to be replaced on purpose.
      Object.assign(compiled.hashes, nowHashes);
      setLastCompileVersion((n) => n + 1);
      setConflicts([]);
      scheduleCompile(0);
    },
    [apply, scheduleCompile],
  );

  // ── Entering Create mode ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!active || !project || !kit) return;
    const doc = ctxRef.current.trackRef.current;
    const mine = !!doc && doc.sourceId === createSourceId(project.id);
    if (!mine) {
      const agreed = foreignConfirmed.current || confirmLeaveForeignTrack();
      foreignConfirmed.current = false;
      if (!agreed) {
        ctxRef.current.setEditorMode('kmp');
        return;
      }
      scheduleCompile(0);
    } else if (compileDirty.current) {
      scheduleCompile(0);
    }
    scheduleDerived();
    // Runs when Create mode is shown (again) or the open design changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, project?.id, kit]);

  // Leaving the page: write the design down now.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && historyRef.current && saveTimer.current) void saveNow();
    };
    const onPageHide = () => {
      if (historyRef.current && saveTimer.current) void saveNow();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [saveNow]);

  useEffect(
    () => () => {
      if (derivedRaf.current) cancelFrame(derivedRaf.current);
      if (compileTimer.current) clearTimeout(compileTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      clientRef.current?.dispose();
      clientRef.current = null;
    },
    [],
  );

  // ── Test drive ───────────────────────────────────────────────────────────────────────────

  const playtestActive = ctx.playtest.active;
  useEffect(() => {
    if (wasPlaytesting.current && !playtestActive) {
      const driven = driveStartedFor.current;
      driveStartedFor.current = null;
      if (driven && historyRef.current?.present === driven) setTestDrivenFor(driven);
    }
    wasPlaytesting.current = playtestActive;
  }, [playtestActive]);

  const firstError = derived.analysis?.issues.find((issue: CreateIssue) => issue.level === 'error') ?? null;
  const documentIsMine = !!project && !!track && track.sourceId === createSourceId(project.id);
  let testDriveDisabledReason: string | null = null;
  if (!project) testDriveDisabledReason = 'Open or create a track first.';
  else if (kitError) testDriveDisabledReason = 'The building blocks did not load.';
  else if (firstError) testDriveDisabledReason = firstError.message;
  else if (conflicts.length > 0) testDriveDisabledReason = 'Choose what to do with your changes from the other editor first.';
  else if (!documentIsMine) testDriveDisabledReason = 'Your track is still being built.';
  else if (!ctx.playtest.canPlaytest) testDriveDisabledReason = ctx.playtest.disabledReason ?? 'This track cannot be driven yet.';

  const testDrive = useCallback(async () => {
    const h = historyRef.current;
    if (!h) return;
    await settleCompile();
    const c = ctxRef.current;
    const present = historyRef.current?.present;
    if (!present) return;
    if (!c.playtest.canPlaytest) {
      c.setStatus(c.playtest.disabledReason ?? 'This track cannot be driven yet.');
      return;
    }
    driveStartedFor.current = present;
    c.playtest.start();
  }, [settleCompile]);

  // ── Assemble ─────────────────────────────────────────────────────────────────────────────

  const raycast = useCallback((ray: CreateRay) => raycasterRef.current?.(ray) ?? null, []);

  const testDriven = !!project && testDrivenFor === project;
  const checklist = useMemo(() => (derived.analysis ? buildChecklist(derived.analysis.checklist, { testDriven }) : null), [derived.analysis, testDriven]);

  return {
    kit,
    kitError,
    retryKit,
    project,
    projects,
    refreshProjects,
    newProject,
    openProject,
    closeProject,
    deleteProject,
    duplicateProject,
    importProjectFile,
    renameProject,
    exportProjectFile,
    saveState,
    edit,
    beginGesture,
    updateGesture,
    endGesture,
    cancelGesture,
    gestureActive: !!history?.gesture,
    undo,
    redo,
    canUndo: !!history && historyCanUndo(history),
    canRedo: !!history && historyCanRedo(history),
    undoLabel: history ? historyUndoLabel(history) : null,
    redoLabel: history ? historyRedoLabel(history) : null,
    selection,
    select,
    samples: derived.samples,
    geometry: derived.geometry,
    issues: derived.analysis?.issues ?? [],
    checklist,
    raycast,
    previewModels: derived.models,
    compiling,
    compileError,
    flushCompile,
    compileStats,
    conflicts,
    resolveConflicts,
    testDrive,
    canTestDrive: testDriveDisabledReason === null,
    testDriveDisabledReason,
    testDriven,
    wizardOpen: ctx.createWizard.open,
    openWizard: () => ctxRef.current.createWizard.setOpen(true),
    closeWizard: () => ctxRef.current.createWizard.setOpen(false),
  };
}
