import { useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { buildPublicAssetUrl } from '../../lib/assetPaths';
import { buildEditorProjectState, type EditorProjectState } from '../../lib/brresEditor';
import { resolveCommonResourceArchive, scoreCommonPreviewResource } from '../../lib/commonAssets';
import { loadCourseAssetDatabase, type CourseAssetDatabase } from '../../lib/courseAssets';
import { parseNoclipBrresSummary, type NoclipBrresSummary } from '../../lib/noclipBrres';
import { getObjFlowResourceNames, type CommonResourceArchive } from '../../lib/objflow';
import { loadPersistedCommonSzs, savePersistedCommonSzs } from '../../lib/persistedCommon';
import type { TrackDocument } from '../../lib/track';
import { loadTrack } from '../../lib/trackLoader';
import type { TrackLoadProgress } from '../../lib/trackLoadProgress';
import { getBrresThumbnail } from '../../lib/thumbnail';
import type { U8Entry } from '../../lib/u8';
import type { EditorHistory } from './useEditorHistory';

/** URL query parameters the editor understands. */
export interface EditorUrlParams {
  /** Loads a track on startup. Plain viewer/editor behaviour, no smoke-test instrumentation. */
  trackUrl: string | null;
  /** Loads a track on startup *and* enables the browser smoke-test behaviour. */
  smokeTrackUrl: string | null;
  smokeCallbackUrl: string | null;
  smokeCommonUrl: string | null;
  smokeMode: boolean;
}

export interface TrackDocumentState extends EditorUrlParams {
  track: TrackDocument | null;
  /**
   * Live progress of the track currently being read, or `null` when nothing is loading. The
   * viewport turns this into the loading overlay and continues the same bar with its own
   * scene-build progress.
   */
  loadProgress: TrackLoadProgress | null;
  /** Mirrors `track` so callbacks can read the newest document synchronously. */
  trackRef: MutableRefObject<TrackDocument | null>;
  setTrack: Dispatch<SetStateAction<TrackDocument | null>>;
  projectState: EditorProjectState | null;
  commonArchive: CommonResourceArchive | null;
  commonArchiveUrl: string | null;
  commonBrresSummaries: Record<string, NoclipBrresSummary>;
  commonLoadStatus: string;
  courseAssetDb: CourseAssetDatabase | null;
  objFlow: CommonResourceArchive['objFlow'] | null;
  openFiles: (files: FileList | null) => Promise<void>;
  importCommonArchive: (files: FileList | null) => Promise<void>;
  /** Wires the history stack in; called from the component body before any effect runs. */
  bindHistory: (history: EditorHistory) => void;
}

function readUrlParam(name: string): string | null {
  return typeof window === 'undefined' ? null : new URL(window.location.href).searchParams.get(name);
}

/**
 * Owns the loaded track document plus the shared game asset archives (Common.szs, the extracted
 * course asset database and the BRRES previews used by the content browser).
 */
export function useTrackDocument({ setStatus }: { setStatus: Dispatch<SetStateAction<string>> }): TrackDocumentState {
  const trackUrl = useMemo(() => readUrlParam('track'), []);
  const smokeTrackUrl = useMemo(() => readUrlParam('smokeTrack'), []);
  const smokeCallbackUrl = useMemo(() => readUrlParam('smokeCallback'), []);
  const smokeCommonUrl = useMemo(() => readUrlParam('smokeCommon'), []);
  const smokeMode = smokeTrackUrl !== null;

  const [track, setTrack] = useState<TrackDocument | null>(null);
  const [projectState, setProjectState] = useState<EditorProjectState | null>(null);
  const [commonArchive, setCommonArchive] = useState<CommonResourceArchive | null>(null);
  const [commonArchiveUrl, setCommonArchiveUrl] = useState<string | null>(null);
  const [courseAssetDb, setCourseAssetDb] = useState<CourseAssetDatabase | null>(null);
  const [commonBrresSummaries, setCommonBrresSummaries] = useState<Record<string, NoclipBrresSummary>>({});
  const [commonLoadStatus, setCommonLoadStatus] = useState('idle');
  const [loadProgress, setLoadProgress] = useState<TrackLoadProgress | null>(null);

  const trackRef = useRef<TrackDocument | null>(track);
  /**
   * The entry list the current `projectState` was built from. The worker already built it for the
   * track it just read, so the effect below must not immediately throw that away and parse every
   * BRRES a second time on the main thread.
   */
  const projectStateEntriesRef = useRef<U8Entry[] | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const commonArchiveObjectUrlRef = useRef<string | null>(null);
  const historyRef = useRef<EditorHistory | null>(null);

  trackRef.current = track;

  // Dev-only read hook, so a browser probe can assert on the document an edit produced instead
  // of inferring it from the UI. Never present in a production build.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    (window as unknown as { __mkwTrackDocument?: TrackDocument | null }).__mkwTrackDocument = track;
  }

  const objFlow = commonArchive?.objFlow ?? null;

  function bindHistory(history: EditorHistory) {
    historyRef.current = history;
  }

  function replaceCommonArchiveObjectUrl(bytes: Uint8Array) {
    if (commonArchiveObjectUrlRef.current) URL.revokeObjectURL(commonArchiveObjectUrlRef.current);
    const next = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' }));
    commonArchiveObjectUrlRef.current = next;
    setCommonArchiveUrl(next);
  }

  function acceptLoadedTrack(loaded: TrackDocument, fileName: string) {
    const history = historyRef.current;
    history?.applyEditorSnapshot({ track: loaded, selectedId: null, selectedIds: [] });
    history?.resetHistory();
    setStatus(`Loaded ${fileName}: ${loaded.archiveEntries.length} files, ${loaded.kmp?.entities.length ?? 0} editable track records`);
  }

  /**
   * The one way a track gets opened: file picker, drag-and-drop, `?track=` and `?smokeTrack=` all
   * come through here. Reading happens in `trackLoad.worker.ts` when the browser has workers, so
   * the page keeps painting and the overlay's bar moves with real progress.
   */
  async function openTrackBytes(bytes: Uint8Array, fileName: string, options: { brresSummaryLimit?: number } = {}) {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setLoadProgress({ stage: 'fetching', label: `Opening ${fileName}`, fraction: 0 });
    try {
      const { track: loaded, projectState: loadedProjectState } = await loadTrack(bytes, fileName, {
        brresSummaryLimit: options.brresSummaryLimit,
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) setLoadProgress(progress);
        },
      });
      if (controller.signal.aborted) return;
      // Seed the Model-mode project state the worker already built, and record which entry list
      // it belongs to so the effect below leaves it alone.
      projectStateEntriesRef.current = loaded.archiveEntries;
      setProjectState(loadedProjectState);
      acceptLoadedTrack(loaded, fileName);
      void fillInModelPreviews(loaded);
    } catch (error) {
      if (controller.signal.aborted) return;
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null;
        setLoadProgress(null);
      }
    }
  }

  /**
   * The worker has no DOM, so it reads the model archives without rendering a preview for them.
   * The content browser wants those previews, but nothing is waiting on them: render them here
   * afterwards, one per animation frame (the thumbnail service already paces itself), and patch
   * them into the document in one go.
   *
   * Smallest archive first, so the tiles that are cheap to draw appear straight away. Measured
   * on a production build of a retail track: 16-48 ms for the object archives, 125 ms for
   * `vrcorn_model.brres` and 117 ms for a 4 MB `course_model.brres`. A render cannot be
   * interrupted, so those are real hitches -- but they land after the track is on screen and the
   * user can already drive the camera around, instead of in the middle of the load.
   */
  async function fillInModelPreviews(loaded: TrackDocument) {
    const missing = Object.entries(loaded.brresSummaries)
      .filter(([, summary]) => !summary.previewDataUrl && !summary.error)
      .map(([path]) => ({ path, data: loaded.archiveEntries.find((entry) => entry.path === path)?.data }))
      .filter((candidate): candidate is { path: string; data: Uint8Array } => !!candidate.data)
      .sort((a, b) => a.data.byteLength - b.data.byteLength);
    if (missing.length === 0) return;
    const previews = new Map<string, string>();
    for (const { path, data } of missing) {
      const preview = await getBrresThumbnail(data);
      if (preview) previews.set(path, preview);
      // A newer track started loading; these previews are for a document nobody is looking at.
      if (trackRef.current?.sourceId !== loaded.sourceId) return;
    }
    if (previews.size === 0) return;
    setTrack((current) => {
      if (!current || current.sourceId !== loaded.sourceId) return current;
      const brresSummaries = { ...current.brresSummaries };
      for (const [path, previewDataUrl] of previews) {
        const summary = brresSummaries[path];
        if (summary) brresSummaries[path] = { ...summary, previewDataUrl };
      }
      return { ...current, brresSummaries };
    });
  }

  useEffect(() => () => {
    if (commonArchiveObjectUrlRef.current) URL.revokeObjectURL(commonArchiveObjectUrlRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!track) {
      projectStateEntriesRef.current = null;
      setProjectState(null);
      return;
    }
    // The archives are what the project state is derived from, so a change that leaves them alone
    // (a selection, a KMP edit, the model previews arriving) must not re-parse every BRRES.
    if (projectStateEntriesRef.current === track.archiveEntries) return;
    const entries = track.archiveEntries;
    void buildEditorProjectState(track).then((state) => {
      if (cancelled) return;
      projectStateEntriesRef.current = entries;
      setProjectState(state);
    });
    return () => {
      cancelled = true;
    };
  }, [track]);

  useEffect(() => {
    let cancelled = false;
    async function loadCommonAssets() {
      try {
        if (!smokeCommonUrl) {
          try {
            if (!cancelled) setCommonLoadStatus('checking saved common assets');
            const stored = await loadPersistedCommonSzs();
            if (cancelled) return;
            if (stored) {
              if (!cancelled) setCommonLoadStatus('loading saved common assets');
              const common = await resolveCommonResourceArchive(stored, smokeMode);
              if (cancelled) return;
              replaceCommonArchiveObjectUrl(stored);
              setCommonArchive(common);
              setCommonLoadStatus(`ready: ${common.objFlow.entries.length} objects, ${common.resourceEntries.length} resources`);
              setStatus((current) => (current === 'No track loaded' ? `Loaded saved Common.szs: ${common.objFlow.entries.length} game objects` : current));
              return;
            }
          } catch {
            if (!cancelled) setCommonLoadStatus('saved common assets failed; trying bundled assets');
          }
        }
        if (!cancelled) setCommonLoadStatus('fetching bundled common assets');
        const response = await fetch(smokeCommonUrl ?? buildPublicAssetUrl('data/MarioKartWii/Race/Common.szs'));
        if (!response.ok) {
          if (!cancelled) {
            setCommonLoadStatus(`fetch failed: HTTP ${response.status}`);
            if (smokeMode) setStatus(`Bundled common asset archive fetch failed: HTTP ${response.status}`);
          }
          return;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const common = await resolveCommonResourceArchive(bytes, smokeMode);
        if (!cancelled) {
          replaceCommonArchiveObjectUrl(bytes);
          setCommonArchive(common);
          setCommonLoadStatus(`ready: ${common.objFlow.entries.length} objects, ${common.resourceEntries.length} resources`);
          setStatus((current) => (current === 'No track loaded' ? `Loaded bundled common assets: ${common.objFlow.entries.length} game objects` : current));
        }
      } catch (error) {
        if (!cancelled) {
          setCommonLoadStatus(error instanceof Error ? `load failed: ${error.message}` : `load failed: ${String(error)}`);
          if (smokeMode) setStatus(error instanceof Error ? `Bundled common asset load failed: ${error.message}` : `Bundled common asset load failed: ${String(error)}`);
        }
        // Manual Common.szs loading remains available if the bundled file is absent.
      }
    }
    void loadCommonAssets();
    return () => {
      cancelled = true;
    };
  }, [smokeMode, smokeCommonUrl]);

  useEffect(() => {
    let cancelled = false;
    void loadCourseAssetDatabase().then((next) => {
      if (!cancelled && next) setCourseAssetDb(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Smoke-test track loading. Keeps the reduced BRRES summary budget the smoke scripts rely on.
  useEffect(() => {
    const url = smokeTrackUrl;
    if (!url) return;
    let cancelled = false;
    async function loadSmokeTrack() {
      try {
        setStatus('Loading browser smoke track...');
        setLoadProgress({ stage: 'fetching', label: 'Downloading the track', fraction: 0 });
        const response = await fetch(url!);
        if (!response.ok) throw new Error(`Smoke track fetch failed: HTTP ${response.status}`);
        const pathName = new URL(url!, window.location.href).pathname;
        const fileName = decodeURIComponent(pathName.split('/').pop() || 'smoke.szs');
        if (cancelled) return;
        await openTrackBytes(new Uint8Array(await response.arrayBuffer()), fileName, { brresSummaryLimit: 4 });
      } catch (error) {
        if (!cancelled) {
          setLoadProgress(null);
          setStatus(error instanceof Error ? error.message : String(error));
        }
      }
    }
    void loadSmokeTrack();
    return () => {
      cancelled = true;
    };
  }, [smokeTrackUrl]);

  // Plain `?track=<url>` startup loading: same result as opening the file by hand, with none of
  // the smoke-test instrumentation.
  useEffect(() => {
    const url = trackUrl;
    if (!url || smokeTrackUrl) return;
    let cancelled = false;
    async function loadStartupTrack() {
      try {
        const pathName = new URL(url!, window.location.href).pathname;
        const fileName = decodeURIComponent(pathName.split('/').pop() || 'track.szs');
        setStatus(`Loading ${fileName}...`);
        setLoadProgress({ stage: 'fetching', label: `Downloading ${fileName}`, fraction: 0 });
        const response = await fetch(url!);
        if (!response.ok) throw new Error(`Track fetch failed: HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;
        await openTrackBytes(bytes, fileName);
      } catch (error) {
        if (!cancelled) {
          setLoadProgress(null);
          setStatus(error instanceof Error ? error.message : String(error));
        }
      }
    }
    void loadStartupTrack();
    return () => {
      cancelled = true;
    };
  }, [trackUrl, smokeTrackUrl]);

  useEffect(() => {
    const archive = commonArchive;
    if (!archive) {
      setCommonBrresSummaries({});
      return;
    }
    let cancelled = false;
    async function parseCommonSummaries() {
      const referencedResources = new Set(archive!.objFlow.entries.flatMap((entry) => getObjFlowResourceNames(entry).map((name) => name.toLowerCase())));
      const brresEntries = archive!.resourceEntries
        .filter((entry) => entry.type === 'file' && entry.data && entry.path.toLowerCase().endsWith('.brres'))
        .sort((a, b) => scoreCommonPreviewResource(b, referencedResources) - scoreCommonPreviewResource(a, referencedResources))
        .slice(0, smokeMode ? 12 : 180);
      const summaries: Record<string, NoclipBrresSummary> = {};
      for (const entry of brresEntries) {
        if (cancelled || !entry.data) return;
        try {
          const key = entry.path.split('/').pop()?.toLowerCase() ?? entry.path.toLowerCase();
          summaries[key] = await parseNoclipBrresSummary(entry.data);
          if (!cancelled) setCommonBrresSummaries({ ...summaries });
        } catch {
          // Some object resources are special-purpose BRRES files; keep the browser usable if one fails.
        }
      }
      if (!cancelled) setCommonBrresSummaries(summaries);
    }
    void parseCommonSummaries();
    return () => {
      cancelled = true;
    };
  }, [commonArchive, smokeMode]);

  async function openFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    try {
      setStatus(`Loading ${file.name}...`);
      setLoadProgress({ stage: 'fetching', label: `Opening ${file.name}`, fraction: 0 });
      const bytes = new Uint8Array(await file.arrayBuffer());
      await openTrackBytes(bytes, file.name);
    } catch (error) {
      setLoadProgress(null);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function importCommonArchive(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    try {
      setCommonLoadStatus('importing Common.szs');
      setStatus(`Importing ${file.name}...`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const common = await resolveCommonResourceArchive(bytes, smokeMode);
      replaceCommonArchiveObjectUrl(bytes);
      setCommonArchive(common);
      setCommonLoadStatus(`ready: ${common.objFlow.entries.length} objects, ${common.resourceEntries.length} resources`);
      try {
        await savePersistedCommonSzs(bytes);
        setStatus(`Imported Common.szs: ${common.objFlow.entries.length} game objects`);
      } catch {
        setStatus(`Imported Common.szs for this session, but browser storage save failed.`);
      }
    } catch (error) {
      setCommonLoadStatus(error instanceof Error ? `import failed: ${error.message}` : `import failed: ${String(error)}`);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    trackUrl,
    smokeTrackUrl,
    smokeCallbackUrl,
    smokeCommonUrl,
    smokeMode,
    track,
    trackRef,
    setTrack,
    loadProgress,
    projectState,
    commonArchive,
    commonArchiveUrl,
    commonBrresSummaries,
    commonLoadStatus,
    courseAssetDb,
    objFlow,
    openFiles,
    importCommonArchive,
    bindHistory,
  };
}
