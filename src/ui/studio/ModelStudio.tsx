import {
  ArrowLeft,
  Boxes,
  ChevronDown,
  Clock,
  Download,
  FolderOpen,
  Focus,
  Grid3x3,
  Library,
  Lightbulb,
  Redo2,
  RotateCw,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import type { GxMaterialSummary } from '../../lib/gxMaterial';
import { Button, EmptyState, IconButton, LoadingOverlay, MenuSurface, Tooltip, useToast, type MenuSection } from '../components';
import { downloadBytes } from '../downloadFile';
import { MaterialInspector } from '../material/MaterialInspector';
import type { MaterialDockTab } from '../material/MaterialMode';
import { ShaderGraphDock } from '../material/ShaderGraphDock';
import { emptyGraph, type EditorGraphNode } from '../material/graphModel';
import { materialRefKey } from '../material/materialOutlinerModel';
import { StudioOutliner } from './StudioOutliner';
import { StudioTips } from './StudioTips';
import { StudioTransportBar } from './StudioTransportBar';
import { StudioViewport, type StudioViewportApi } from './StudioViewport';
import { exportStudioBrres, exportStudioDocument, describeStudioDocument } from './studioDocument';
import { useStudioSession, type StudioTrackBridge } from './useStudioSession';
import './studio.css';

export interface ModelStudioProps {
  /** Closes the studio and returns to the track editor with its state untouched. */
  onClose: () => void;
  /** Set when the studio was opened on an archive that belongs to the loaded track. */
  trackBridge: StudioTrackBridge | null;
  /** "Save to My Assets" — the content browser's custom model library. */
  onSaveToAssets?: (fileName: string, bytes: Uint8Array) => Promise<unknown>;
  /** Opened as soon as the studio mounts, when the caller already has bytes for it. */
  initialOpen?: { fileName: string; bytes: Uint8Array } | null;
}

/** The graph never gets smaller than this, and the preview above it never gets smaller than that. */
const DOCK_MIN_HEIGHT = 180;
const VIEWPORT_MIN_HEIGHT = 180;
const DOCK_COLLAPSED_HEIGHT = 34;
/** The share of the centre column the graph starts with: Unreal's graph is the main canvas. */
const DOCK_DEFAULT_SHARE = 0.5;
const DETAILS_MIN_WIDTH = 280;
const DETAILS_MAX_WIDTH = 560;
const DETAILS_DEFAULT_WIDTH = 340;
const DOCK_HEIGHT_KEY = 'mkw.studio.graphHeight';
const DETAILS_WIDTH_KEY = 'mkw.studio.detailsWidth';
const TIPS_SEEN_KEY = 'mkw.studio.tipsSeen';

/** Half the centre column, before it has been measured: the window minus header, status and transport. */
function defaultDockHeight(): number {
  const height = typeof window === 'undefined' ? 900 : window.innerHeight;
  return Math.max(DOCK_MIN_HEIGHT, Math.round((height - 110) * DOCK_DEFAULT_SHARE));
}

function readStoredNumber(key: string): number | null {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function storeValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Without storage the layout just starts at its defaults next time.
  }
}

/**
 * The Model Studio: a full-window workspace over the track editor for looking at a model, playing
 * its animations and authoring its materials.
 *
 * The shape is Unreal's Material editor with a mesh instead of a material ball: its own window,
 * an asset outliner on the left, the preview (with its animation transport) on top of the centre
 * column and the shader graph — the main canvas — under it, split by a draggable bar, and a
 * contextual **Details** panel on the right that shows whatever is selected in the graph. It works
 * with no track loaded, and when it was opened *from* a track its edits go straight back into that
 * track's archive.
 */
export function ModelStudio({ onClose, trackBridge, onSaveToAssets, initialOpen = null }: ModelStudioProps) {
  const toast = useToast();
  const session = useStudioSession({ toast, trackBridge });
  const [dockOpen, setDockOpen] = useState(true);
  const centerRef = useRef<HTMLDivElement | null>(null);
  const [dockHeight, setDockHeight] = useState(() => readStoredNumber(DOCK_HEIGHT_KEY) ?? defaultDockHeight());
  const [dockResizing, setDockResizing] = useState(false);
  const [dockTab, setDockTab] = useState<MaterialDockTab>('graph');
  const [detailsWidth, setDetailsWidth] = useState(() => readStoredNumber(DETAILS_WIDTH_KEY) ?? DETAILS_DEFAULT_WIDTH);
  const [detailsResizing, setDetailsResizing] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [tipsSeen, setTipsSeen] = useState(() => readStoredNumber(TIPS_SEEN_KEY) !== null);
  const [dragTarget, setDragTarget] = useState(false);
  const viewportApiRef = useRef<StudioViewportApi | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recentTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const openedInitialRef = useRef(false);

  const { openBytes, openDemo } = session;

  useEffect(() => {
    if (openedInitialRef.current) return;
    openedInitialRef.current = true;
    if (initialOpen) void openBytes(initialOpen.fileName, initialOpen.bytes, trackBridge?.origin ?? null, false);
    else void openDemo();
    // Runs once: the studio always opens with something on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------ keyboard

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target !== null && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
      // The graph has keys of its own: Escape clears its selection (and leaves its fullscreen, its
      // palette, its help) and Ctrl+Z / Ctrl+Y step its own history. This listener runs first, in
      // the capture phase, so it has to stand aside for them rather than close the studio or undo
      // twice.
      const inGraph = target instanceof Element && target.closest('.materialDock') !== null;
      if (event.key === 'Escape' && !typing) {
        if (tipsOpen) {
          event.preventDefault();
          setTipsOpen(false);
          return;
        }
        if (inGraph || document.querySelector('.materialDock--fullscreen, .graphPalette, .graphHelp, .uiMenu, .uiPopover')) return;
        event.preventDefault();
        onClose();
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || typing || inGraph) return;
      if (event.key === 'z' || event.key === 'Z') {
        event.preventDefault();
        if (event.shiftKey) session.redo();
        else session.undo();
      } else if (event.key === 'y' || event.key === 'Y') {
        event.preventDefault();
        session.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose, session, tipsOpen]);

  // ------------------------------------------------------------------ graph selection

  // What is selected in the shader graph decides what the Details panel shows. The graph owns the
  // selection and reports it; a request goes the other way when Details wants a node selected (a
  // texture row clicked in the overview). The key only ever grows, so every request is a new one.
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectionRequest, setSelectionRequest] = useState<{ nodeIds: string[]; key: number } | null>(null);
  const selectionKeyRef = useRef(0);
  const materialKey = session.selectedRef ? materialRefKey(session.selectedRef) : '';
  useEffect(() => {
    setSelectedNodeIds([]);
    setSelectionRequest(null);
  }, [materialKey]);

  const requestNodeSelection = useCallback((nodeIds: string[]) => {
    setSelectedNodeIds(nodeIds);
    selectionKeyRef.current += 1;
    setSelectionRequest({ nodeIds, key: selectionKeyRef.current });
    if (nodeIds.length > 0) {
      setDockOpen(true);
      setDockTab('graph');
    }
  }, []);

  const { graph: sessionGraph, setGraph: setSessionGraph } = session;
  /** A node edited in Details: one graph edit, recorded for undo and previewed like any other. */
  const changeNode = useCallback(
    (next: EditorGraphNode) => {
      if (!sessionGraph) return;
      setSessionGraph({ ...sessionGraph, nodes: sessionGraph.nodes.map((node) => (node.id === next.id ? next : node)) });
    },
    [sessionGraph, setSessionGraph],
  );

  // ------------------------------------------------------------------ dev hook

  // `window.__mkwStudio` is what `scripts/studio-probe.mjs` drives. It is the studio's equivalent
  // of the viewport's `__mkwViewport`: enough to open a file, read what is loaded, drive the
  // transport and sample the rendered pixels, and nothing the product depends on.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  selectedNodeIdsRef.current = selectedNodeIds;
  const requestNodeSelectionRef = useRef(requestNodeSelection);
  requestNodeSelectionRef.current = requestNodeSelection;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const hook = {
      ready: () => sessionRef.current.doc !== null && viewportApiRef.current !== null,
      document: () => {
        const doc = sessionRef.current.doc;
        return doc === null
          ? null
          : {
              fileName: doc.fileName,
              kind: doc.kind,
              dirty: doc.dirty,
              origin: doc.origin,
              brresFiles: doc.brresFiles.map((file) => ({ path: file.path, label: file.label, size: file.bytes.byteLength })),
            };
      },
      archives: () =>
        sessionRef.current.archives.map((archive) => ({
          archivePath: archive.archivePath,
          label: archive.label,
          visible: archive.visible,
          models: archive.models.map((model) => ({ modelName: model.modelName, visible: model.visible, materialCount: model.materialCount })),
          materialCount: archive.materials?.models.reduce((sum, model) => sum + model.materials.length, 0) ?? 0,
          textureCount: archive.materials?.textures.length ?? 0,
          animations: archive.animations.map((animation) => ({ kind: animation.kind, name: animation.name, duration: animation.duration, enabled: animation.enabled })),
        })),
      openDemo: () => sessionRef.current.openDemo(),
      openUrl: async (url: string, fileName?: string) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url} could not be fetched (${response.status})`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        await sessionRef.current.openBytes(fileName ?? (url.split('/').pop() ?? 'model.szs'), bytes, null, false);
        return bytes.byteLength;
      },
      selectMaterial: (archivePath: string, modelName: string, materialName: string) =>
        sessionRef.current.selectMaterial({ archivePath, modelName, materialName }),
      selection: () => sessionRef.current.selectedRef,
      materialDoc: () => sessionRef.current.materialDoc,
      updateMaterial: (next: unknown, status?: string) => sessionRef.current.updateMaterial(next as never, { status }),
      meshes: () => sessionRef.current.selectedMeshes,
      /** Every material in what is open, so a probe can walk them all rather than click a tree. */
      materials: () =>
        sessionRef.current.archives.flatMap((archive) =>
          (archive.materials?.models ?? []).flatMap((model) =>
            model.materials.map((material) => ({
              archivePath: archive.archivePath,
              modelName: model.modelName,
              materialName: material.materialName,
              stageCount: material.stageCount,
            })),
          ),
        ),
      // Enough of the shader graph for a probe to say whether the editor could draw this material
      // as nodes, and to press the "Special step" card's way out.
      graph: () => {
        const graph = sessionRef.current.graph;
        return graph === null
          ? null
          : {
              nodes: graph.nodes.map((node) => ({ id: node.id, type: node.type })),
              edges: graph.edges.length,
              rawStages: graph.nodes.filter((node) => node.type === 'rawStage').length,
              rawReasons: graph.nodes.flatMap((node) => (node.type === 'rawStage' ? [node.reason ?? ''] : [])),
            };
      },
      rawStagesConvertible: () => sessionRef.current.rawStagesConvertible,
      /** The graph nodes the Details panel is showing, and a way to select some the way Details does. */
      selectedNodes: () => selectedNodeIdsRef.current,
      selectNodes: (nodeIds: string[]) => requestNodeSelectionRef.current(nodeIds),
      convertRawStages: () => sessionRef.current.convertRawStages(),
      setGraphNode: (nodeId: string, patch: Record<string, unknown>) => {
        const graph = sessionRef.current.graph;
        if (!graph) return false;
        if (!graph.nodes.some((node) => node.id === nodeId)) return false;
        sessionRef.current.setGraph({
          ...graph,
          nodes: graph.nodes.map((node) => (node.id === nodeId ? ({ ...node, ...patch } as typeof node) : node)),
        });
        return true;
      },
      toggleAnimation: (archivePath: string, kind: string, name: string, enabled: boolean) =>
        sessionRef.current.toggleAnimation(archivePath, kind, name, enabled),
      transport: () => sessionRef.current.transport,
      setTransport: (next: unknown) => sessionRef.current.setTransport({ ...sessionRef.current.transport, ...(next as object) }),
      duration: () => sessionRef.current.timelineDuration,
      poseSignature: () => sessionRef.current.poseSignature(),
      undo: () => sessionRef.current.undo(),
      redo: () => sessionRef.current.redo(),
      history: () => sessionRef.current.historyState,
      status: () => sessionRef.current.status,
      exportBytes: () => {
        const doc = sessionRef.current.doc;
        if (!doc) return null;
        const result = exportStudioDocument(doc);
        return { fileName: result.fileName, bytes: Array.from(result.bytes.slice(0, 0)), length: result.bytes.byteLength, hash: fnv1a(result.bytes) };
      },
      /** Export what is open and open the result again, to check an edit survived the round trip. */
      reopenExport: async () => {
        const doc = sessionRef.current.doc;
        if (!doc) return false;
        const result = exportStudioDocument(doc);
        await sessionRef.current.openBytes(result.fileName, result.bytes, null, false);
        return true;
      },
      samplePixels: (box?: { x: number; y: number; width: number; height: number }) => viewportApiRef.current?.samplePixels(box) ?? null,
      capture: () => viewportApiRef.current?.capture() ?? null,
      frameAll: () => viewportApiRef.current?.frameAll(),
      camera: () => viewportApiRef.current?.getCamera() ?? null,
      orbit: (yaw: number, pitch: number) => viewportApiRef.current?.orbit(yaw, pitch),
      zoom: (factor: number) => viewportApiRef.current?.zoom(factor),
      close: onClose,
    };
    (window as unknown as { __mkwStudio?: unknown }).__mkwStudio = hook;
    return () => {
      delete (window as unknown as { __mkwStudio?: unknown }).__mkwStudio;
    };
  }, [onClose]);

  // ------------------------------------------------------------------ dock resize

  /** The tallest the graph may be: whatever still leaves the preview and its transport usable. */
  const maxDockHeight = useCallback(() => {
    const center = centerRef.current;
    if (!center) return Number.POSITIVE_INFINITY;
    const transport = center.querySelector('.studioTransport')?.getBoundingClientRect().height ?? 40;
    return Math.max(DOCK_MIN_HEIGHT, Math.floor(center.clientHeight - transport - VIEWPORT_MIN_HEIGHT));
  }, []);

  const beginDockResize = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = dockHeight;
      const limit = maxDockHeight();
      let latest = startHeight;
      setDockResizing(true);
      const move = (moveEvent: PointerEvent) => {
        latest = Math.round(Math.min(limit, Math.max(DOCK_MIN_HEIGHT, startHeight - (moveEvent.clientY - startY))));
        setDockHeight(latest);
      };
      const up = () => {
        setDockResizing(false);
        storeValue(DOCK_HEIGHT_KEY, String(latest));
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [dockHeight, maxDockHeight],
  );

  const resetDockHeight = useCallback(() => {
    const center = centerRef.current;
    const next = center ? Math.round(center.clientHeight * DOCK_DEFAULT_SHARE) : defaultDockHeight();
    const clamped = Math.min(Math.max(DOCK_MIN_HEIGHT, next), maxDockHeight());
    setDockHeight(clamped);
    storeValue(DOCK_HEIGHT_KEY, String(clamped));
  }, [maxDockHeight]);

  // With nothing remembered, the graph starts at half the measured column (the first render could
  // only estimate it from the window). A height remembered from a taller window must not push the
  // preview off the screen in this one.
  useEffect(() => {
    const center = centerRef.current;
    if (!center) return;
    if (readStoredNumber(DOCK_HEIGHT_KEY) === null) {
      setDockHeight(Math.max(DOCK_MIN_HEIGHT, Math.round(center.clientHeight * DOCK_DEFAULT_SHARE)));
    }
    const clamp = () => setDockHeight((current) => Math.min(current, maxDockHeight()));
    clamp();
    const observer = new ResizeObserver(clamp);
    observer.observe(center);
    return () => observer.disconnect();
  }, [maxDockHeight]);

  const beginDetailsResize = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = detailsWidth;
      let latest = startWidth;
      setDetailsResizing(true);
      const move = (moveEvent: PointerEvent) => {
        latest = Math.round(Math.min(DETAILS_MAX_WIDTH, Math.max(DETAILS_MIN_WIDTH, startWidth - (moveEvent.clientX - startX))));
        setDetailsWidth(latest);
      };
      const up = () => {
        setDetailsResizing(false);
        storeValue(DETAILS_WIDTH_KEY, String(latest));
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [detailsWidth],
  );

  const toggleTips = useCallback(() => {
    setTipsOpen((open) => !open);
    if (!tipsSeen) {
      setTipsSeen(true);
      storeValue(TIPS_SEEN_KEY, '1');
    }
  }, [tipsSeen]);

  // ------------------------------------------------------------------ file actions

  const openFiles = useCallback(
    async (files: FileList | File[] | null) => {
      const list = Array.from(files ?? []);
      if (list.length === 0) return;
      await session.openFile(list[0]);
      if (list.length > 1) {
        toast.showToast({ tone: 'info', title: 'One model at a time', detail: `The studio opened ${list[0].name} and ignored the rest.` });
      }
    },
    [session, toast],
  );

  const exportDocument = useCallback(() => {
    if (!session.doc) return;
    const result = exportStudioDocument(session.doc);
    downloadBytes(result.fileName, result.bytes);
    session.setStatus(
      session.doc.dirty
        ? `Exported ${result.fileName} with your edits.`
        : `Exported ${result.fileName} unchanged — byte for byte what was opened.`,
    );
  }, [session]);

  const exportSelectedBrres = useCallback(() => {
    const doc = session.doc;
    const archivePath = session.selectedRef?.archivePath ?? doc?.brresFiles[0]?.path;
    if (!doc || !archivePath) return;
    const result = exportStudioBrres(doc, archivePath);
    if (!result) return;
    downloadBytes(result.fileName, result.bytes);
    session.setStatus(`Exported ${result.fileName}.`);
  }, [session]);

  const saveToAssets = useCallback(async () => {
    const doc = session.doc;
    const archivePath = session.selectedRef?.archivePath ?? doc?.brresFiles[0]?.path;
    if (!doc || !archivePath || !onSaveToAssets) return;
    const result = exportStudioBrres(doc, archivePath);
    if (!result) return;
    await onSaveToAssets(result.fileName, result.bytes);
    session.setStatus(`Saved ${result.fileName} to My Assets, ready to place in a track.`);
  }, [onSaveToAssets, session]);

  // ------------------------------------------------------------------ derived

  const materialSummary = useMemo<GxMaterialSummary | null>(() => {
    const ref = session.selectedRef;
    if (!ref || !session.materialSummary) return null;
    return (
      session.materialSummary.models
        .find((model) => model.modelName === ref.modelName)
        ?.materials.find((material) => material.materialName === ref.materialName) ?? null
    );
  }, [session.materialSummary, session.selectedRef]);

  const archiveBytes = useMemo(
    () => session.doc?.brresFiles.find((file) => file.path === session.selectedRef?.archivePath)?.bytes ?? null,
    [session.doc, session.selectedRef],
  );

  const issues = useMemo(
    () => (session.library && session.materialDoc ? session.library.collectMaterialIssues(session.materialDoc) : []),
    [session.library, session.materialDoc],
  );

  const recentRect = recentOpen ? recentTriggerRef.current?.getBoundingClientRect() : undefined;
  const recentAnchor = recentRect ? { top: recentRect.top, left: recentRect.left, bottom: recentRect.bottom + 4, right: recentRect.right } : null;
  const recentSections: MenuSection[] = [
    {
      id: 'recent',
      items: session.recents.map((entry) => ({
        id: entry.id,
        label: entry.fileName,
        icon: <Clock size={15} />,
        onSelect: () => {
          setRecentOpen(false);
          void session.openBytes(entry.fileName, entry.bytes, null, false);
        },
      })),
    },
  ];

  const title = session.doc?.fileName ?? 'Model Studio';
  const subtitle = trackBridge
    ? `From ${trackBridge.origin.trackName} · ${trackBridge.origin.archivePath}`
    : session.doc
      ? describeStudioDocument(session.doc)
      : 'Open a model to get started.';

  // ------------------------------------------------------------------ render

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragTarget(false);
    void openFiles(event.dataTransfer?.files ?? null);
  }

  const renderToggle = (key: 'textures' | 'lighting' | 'vertexColors' | 'wireframe', label: string, tooltip: string) => {
    const on = session.renderSettings[key];
    return (
      <Tooltip label={tooltip} side="bottom">
        <button
          type="button"
          className={on ? 'studioViewChip is-on' : 'studioViewChip'}
          aria-pressed={on}
          onClick={() => session.setRenderSettings({ ...session.renderSettings, [key]: !on })}
        >
          {label}
        </button>
      </Tooltip>
    );
  };

  return (
    <div
      className={`studioRoot${dragTarget ? ' is-dragTarget' : ''}`}
      role="dialog"
      aria-label="Model Studio"
      aria-modal="true"
      onDragOver={(event) => {
        event.preventDefault();
        setDragTarget(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragTarget(false);
      }}
      onDrop={handleDrop}
    >
      <header className="studioHeader">
        <Button icon={<ArrowLeft size={15} />} onClick={onClose} tooltip="Return to the track editor (Esc)">
          Back to track editor
        </Button>
        <span className="studioHeaderTitle">
          <Boxes size={15} aria-hidden="true" />
          <strong>{title}</strong>
          {session.doc?.dirty && (
            <span className="studioHeaderDirty" title="Edited since it was opened">
              Edited
            </span>
          )}
          <span className="studioHeaderSubtitle">{subtitle}</span>
        </span>
        <span className="studioHeaderSpacer" />
        <span className="studioHeaderGroup">
          <IconButton
            tooltip="Undo"
            shortcut="Ctrl+Z"
            size="sm"
            icon={<Undo2 size={14} />}
            disabled={session.historyState.undo === 0}
            onClick={session.undo}
          />
          <IconButton
            tooltip="Redo"
            shortcut="Ctrl+Y"
            size="sm"
            icon={<Redo2 size={14} />}
            disabled={session.historyState.redo === 0}
            onClick={session.redo}
          />
        </span>
        <span className="studioHeaderDivider" aria-hidden="true" />
        <span className="studioHeaderGroup">
          <Button icon={<FolderOpen size={14} />} size="sm" onClick={() => fileInputRef.current?.click()} tooltip="Open a .brres, .szs or .u8 model archive — or drop one anywhere">
            Open model
          </Button>
          <Button
            ref={recentTriggerRef}
            icon={<Clock size={14} />}
            size="sm"
            active={recentOpen}
            disabled={session.recents.length === 0}
            disabledReason="Nothing opened in the studio yet"
            aria-haspopup="menu"
            aria-expanded={recentOpen}
            tooltip="Files opened in the studio before, kept in this browser"
            onClick={() => setRecentOpen((value) => !value)}
          >
            Recent
            <ChevronDown size={12} className="uiButtonChevron" />
          </Button>
          {recentOpen && recentAnchor && (
            <MenuSurface
              label="Recent studio files"
              anchor={recentAnchor}
              sections={recentSections}
              onClose={() => setRecentOpen(false)}
              minWidth={240}
            />
          )}
          <Button icon={<Sparkles size={14} />} size="sm" onClick={() => void session.openDemo()} tooltip="Load the bundled Funky Kong and Flame Runner">
            Demo character
          </Button>
        </span>
        <span className="studioHeaderDivider" aria-hidden="true" />
        <span className="studioHeaderGroup">
          <Button
            icon={<Lightbulb size={14} />}
            size="sm"
            variant="ghost"
            active={tipsOpen}
            className={tipsSeen ? undefined : 'studioTipsTrigger is-new'}
            aria-haspopup="dialog"
            aria-expanded={tipsOpen}
            tooltip="How the studio works, in a minute"
            onClick={toggleTips}
          >
            Tips
          </Button>
          {onSaveToAssets && (
            <Button
              icon={<Library size={14} />}
              size="sm"
              disabled={session.doc === null}
              onClick={() => void saveToAssets()}
              tooltip="Keep this model in My Assets so it can be placed in a track"
            >
              Save to My Assets
            </Button>
          )}
          <Button
            icon={<Download size={14} />}
            size="sm"
            variant="primary"
            disabled={session.doc === null}
            onClick={exportDocument}
            tooltip={session.doc?.kind === 'brres' ? 'Download this .brres' : 'Download the whole archive'}
          >
            Export
          </Button>
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".brres,.szs,.u8"
          className="studioFileInput"
          aria-label="Open a model archive"
          onChange={(event) => {
            void openFiles(event.currentTarget.files);
            event.currentTarget.value = '';
          }}
        />
      </header>

      {tipsOpen && <StudioTips onClose={() => setTipsOpen(false)} />}

      <div className="studioBody" style={{ gridTemplateColumns: `var(--studio-outliner-width) minmax(0, 1fr) ${detailsWidth}px` }}>
        <StudioOutliner
          tree={session.tree}
          query={session.query}
          onChangeQuery={session.setQuery}
          expanded={session.expanded}
          onChangeExpanded={session.setExpanded}
          selected={session.selectedRef}
          onSelectMaterial={session.selectMaterial}
          onToggleArchive={session.setArchiveVisible}
          onToggleModel={session.setModelVisible}
          onToggleAnimation={session.toggleAnimation}
          hasDocument={session.doc !== null}
        />

        <div className="studioCenter" ref={centerRef}>
          <StudioViewport
            frameRequest={session.frameRequest}
            turntable={session.renderSettings.turntable}
            gridVisible={session.renderSettings.grid}
            onSceneChange={session.attachScene}
            onReady={(api) => {
              viewportApiRef.current = api;
            }}
            onPickMesh={(pick) => {
              if (!pick) {
                session.setStatus('Nothing under the cursor.');
                return;
              }
              session.selectMaterial({ archivePath: pick.archivePath, modelName: pick.modelName, materialName: pick.materialName });
              session.setStatus(`Selected ${pick.materialName} on ${pick.shapeName}.`);
            }}
            onHoverMesh={session.setHoveredMesh}
            onStatus={session.setStatus}
            overlay={
              <>
                <div className="studioViewToolbar" role="toolbar" aria-label="Preview">
                  <IconButton
                    tooltip={session.selectedMeshes.length > 0 ? 'Frame the selected material' : 'Frame the model'}
                    tooltipSide="bottom"
                    shortcut="F"
                    size="sm"
                    variant="ghost"
                    icon={<Focus size={13} />}
                    onClick={() => {
                      const mesh = session.selectedMeshes[0];
                      if (mesh) viewportApiRef.current?.frameMesh(mesh);
                      else viewportApiRef.current?.frameAll();
                    }}
                  />
                  <IconButton
                    tooltip="Turntable: spin the model slowly"
                    tooltipSide="bottom"
                    size="sm"
                    variant="ghost"
                    icon={<RotateCw size={13} />}
                    active={session.renderSettings.turntable}
                    onClick={() => session.setRenderSettings({ ...session.renderSettings, turntable: !session.renderSettings.turntable })}
                  />
                  <IconButton
                    tooltip="Ground grid"
                    tooltipSide="bottom"
                    size="sm"
                    variant="ghost"
                    icon={<Grid3x3 size={13} />}
                    active={session.renderSettings.grid}
                    onClick={() => session.setRenderSettings({ ...session.renderSettings, grid: !session.renderSettings.grid })}
                  />
                  <span className="studioViewToolbarDivider" aria-hidden="true" />
                  {renderToggle('textures', 'Textures', 'Draw the textures, or flat surfaces without them')}
                  {renderToggle('lighting', 'Lighting', "Light the model with the studio's three-point rig")}
                  {renderToggle('vertexColors', 'Vertex colours', "Use the mesh's painted vertex colours")}
                  {renderToggle('wireframe', 'Wireframe', 'Draw the triangle edges over the model')}
                </div>
                {session.selectedRef && (
                  <p className="studioViewSelection">
                    <strong>{session.selectedRef.materialName}</strong>
                    {session.selectedMeshes.length} mesh{session.selectedMeshes.length === 1 ? '' : 'es'}
                  </p>
                )}
                <p className="studioViewNavHint" aria-hidden="true">
                  Drag to orbit · right-drag to pan · scroll to zoom · F to frame · click to pick
                </p>
              </>
            }
          />

          <StudioTransportBar
            transport={session.transport}
            onChange={session.setTransport}
            duration={session.timelineDuration}
            active={session.activeAnimations}
          />

          <ShaderGraphDock
            open={dockOpen}
            height={dockHeight}
            collapsedHeight={DOCK_COLLAPSED_HEIGHT}
            resizing={dockResizing}
            onBeginResize={beginDockResize}
            onResetSize={resetDockHeight}
            onToggleOpen={() => setDockOpen((value) => !value)}
            tab={dockTab}
            onChangeTab={setDockTab}
            materialRef={session.selectedRef}
            doc={session.materialDoc}
            graph={session.graph ?? (session.selectedRef ? emptyGraph() : null)}
            compiled={session.compiled}
            graphDrivesMaterial={session.graphDrivesMaterial}
            presets={session.library?.SHADER_GRAPH_PRESETS ?? []}
            historyState={session.graphHistoryState}
            textures={session.materialSummary?.textures ?? []}
            archivePath={session.selectedRef?.archivePath ?? ''}
            archiveBytes={archiveBytes}
            onChangeGraph={session.setGraph}
            onUndo={() => session.stepGraphHistory('undo')}
            onRedo={() => session.stepGraphHistory('redo')}
            onResetFromStages={session.resetGraphFromStages}
            onConvertRawStages={session.convertRawStages}
            rawStagesConvertible={session.rawStagesConvertible}
            onApplyPreset={session.applyPreset}
            onAutoLayout={session.runAutoLayout}
            onChangeDoc={session.updateMaterial}
            onSelectionChange={setSelectedNodeIds}
            selectionRequest={selectionRequest}
          />
        </div>

        <aside className="studioDetails" aria-label="Details">
          <div
            className={detailsResizing ? 'studioDetailsHandle isActive' : 'studioDetailsHandle'}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the details panel"
            title="Drag to resize · double-click to reset"
            onPointerDown={beginDetailsResize}
            onDoubleClick={() => {
              setDetailsWidth(DETAILS_DEFAULT_WIDTH);
              storeValue(DETAILS_WIDTH_KEY, String(DETAILS_DEFAULT_WIDTH));
            }}
          />
          <header className="placeAssetsHeader studioPanelHeader">
            <h2>Details</h2>
          </header>
          <div className="studioDetailsBody">
            {session.doc === null ? (
              <EmptyState
                icon={<Boxes size={22} />}
                title="Nothing open"
                description="Open a model archive or load the demo character to start editing its materials."
              />
            ) : (
              <MaterialInspector
                materialRef={session.selectedRef}
                doc={session.materialDoc}
                issues={issues}
                summary={materialSummary}
                textures={session.materialSummary?.textures ?? []}
                archivePath={session.selectedRef?.archivePath ?? ''}
                archiveBytes={archiveBytes}
                meshCount={session.selectedMeshes.length}
                onChange={session.updateMaterial}
                onImportTexture={session.importTexture}
                hasTrack
                graph={session.graph}
                selectedNodeIds={selectedNodeIds}
                onSelectNodes={requestNodeSelection}
                onChangeNode={changeNode}
              />
            )}
          </div>
        </aside>
      </div>

      <div className="studioStatusBar" role="status">
        <span className="studioStatusText">{session.status}</span>
        <span className="studioStatusSpacer" />
        {trackBridge && <span className="studioStatusHint">Edits go straight into {trackBridge.origin.trackName}</span>}
      </div>

      {session.loading && <LoadingOverlay title="Opening the model" detail="Reading the archive and uploading its textures." />}
    </div>
  );
}

/** FNV-1a over the exported bytes: the probes compare exports without shipping them over CDP. */
function fnv1a(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
