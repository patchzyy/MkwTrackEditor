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
  Redo2,
  RotateCw,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import type { GxMaterialSummary } from '../../lib/gxMaterial';
import { Button, EmptyState, IconButton, LoadingOverlay, MenuSurface, Toggle, Tooltip, useToast, type MenuSection } from '../components';
import { downloadBytes } from '../downloadFile';
import { MaterialInspector } from '../material/MaterialInspector';
import type { MaterialDockTab } from '../material/MaterialMode';
import { ShaderGraphDock } from '../material/ShaderGraphDock';
import { emptyGraph } from '../material/graphModel';
import { StudioOutliner } from './StudioOutliner';
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

const DOCK_MIN_HEIGHT = 180;
const DOCK_MAX_HEIGHT = 620;
const DOCK_COLLAPSED_HEIGHT = 34;

/**
 * The Model Studio: a full-window workspace over the track editor for looking at a model, playing
 * its animations and authoring its materials.
 *
 * The shape is the one Unreal uses for an asset editor — the Skeletal Mesh editor, the Material
 * editor — rather than a fifth viewport mode: its own window, its own preview viewport with its
 * own camera, an asset outliner on the left, a details panel on the right, an animation transport
 * under the preview and the shader graph in the bottom dock. It works with no track loaded, and
 * when it was opened *from* a track its edits go straight back into that track's archive.
 */
export function ModelStudio({ onClose, trackBridge, onSaveToAssets, initialOpen = null }: ModelStudioProps) {
  const toast = useToast();
  const session = useStudioSession({ toast, trackBridge });
  const [dockOpen, setDockOpen] = useState(true);
  const [dockHeight, setDockHeight] = useState(260);
  const [dockResizing, setDockResizing] = useState(false);
  const [dockTab, setDockTab] = useState<MaterialDockTab>('graph');
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
      const typing = target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (event.key === 'Escape' && !typing) {
        event.preventDefault();
        onClose();
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || typing) return;
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
  }, [onClose, session]);

  // ------------------------------------------------------------------ dev hook

  // `window.__mkwStudio` is what `scripts/studio-probe.mjs` drives. It is the studio's equivalent
  // of the viewport's `__mkwViewport`: enough to open a file, read what is loaded, drive the
  // transport and sample the rendered pixels, and nothing the product depends on.
  const sessionRef = useRef(session);
  sessionRef.current = session;
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

  const beginDockResize = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = dockHeight;
      setDockResizing(true);
      const move = (moveEvent: PointerEvent) => {
        const next = Math.min(DOCK_MAX_HEIGHT, Math.max(DOCK_MIN_HEIGHT, startHeight - (moveEvent.clientY - startY)));
        setDockHeight(next);
      };
      const up = () => {
        setDockResizing(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [dockHeight],
  );

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
          <span className="studioHeaderSubtitle">{subtitle}</span>
        </span>
        <span className="studioHeaderSpacer" />
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
        <Button icon={<FolderOpen size={14} />} size="sm" onClick={() => fileInputRef.current?.click()} tooltip="Open a .brres, .szs or .u8 model archive">
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

      <div className="studioBody">
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

        <div className="studioCenter">
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
              <div className="studioViewOverlay">
                <div className="studioViewOverlayRow">
                  <Tooltip label="Frame the model (F)" side="left">
                    <span>
                      <IconButton
                        tooltip={session.selectedMeshes.length > 0 ? 'Frame the selected material' : 'Frame the model'}
                        shortcut="F"
                        size="sm"
                        icon={<Focus size={13} />}
                        onClick={() => {
                          const mesh = session.selectedMeshes[0];
                          if (mesh) viewportApiRef.current?.frameMesh(mesh);
                          else viewportApiRef.current?.frameAll();
                        }}
                      />
                    </span>
                  </Tooltip>
                  <IconButton
                    tooltip="Turntable"
                    size="sm"
                    icon={<RotateCw size={13} />}
                    active={session.renderSettings.turntable}
                    onClick={() => session.setRenderSettings({ ...session.renderSettings, turntable: !session.renderSettings.turntable })}
                  />
                  <IconButton
                    tooltip="Ground grid"
                    size="sm"
                    icon={<Grid3x3 size={13} />}
                    active={session.renderSettings.grid}
                    onClick={() => session.setRenderSettings({ ...session.renderSettings, grid: !session.renderSettings.grid })}
                  />
                </div>
                <div className="studioViewOverlayToggles">
                  <Toggle
                    label="Textures"
                    checked={session.renderSettings.textures}
                    onChange={(textures) => session.setRenderSettings({ ...session.renderSettings, textures })}
                  />
                  <Toggle
                    label="Lighting"
                    checked={session.renderSettings.lighting}
                    onChange={(lighting) => session.setRenderSettings({ ...session.renderSettings, lighting })}
                  />
                  <Toggle
                    label="Vertex colours"
                    checked={session.renderSettings.vertexColors}
                    onChange={(vertexColors) => session.setRenderSettings({ ...session.renderSettings, vertexColors })}
                  />
                  <Toggle
                    label="Wireframe"
                    checked={session.renderSettings.wireframe}
                    onChange={(wireframe) => session.setRenderSettings({ ...session.renderSettings, wireframe })}
                  />
                </div>
                {session.selectedRef && (
                  <p className="studioViewOverlayHint">
                    {session.selectedRef.materialName} · {session.selectedMeshes.length} mesh
                    {session.selectedMeshes.length === 1 ? '' : 'es'}
                  </p>
                )}
              </div>
            }
          />

          <StudioTransportBar
            transport={session.transport}
            onChange={session.setTransport}
            duration={session.timelineDuration}
            active={session.activeAnimations}
          />

          <div
            className={dockResizing ? 'studioDockHandle isActive' : 'studioDockHandle'}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the shader panel"
            title="Drag to resize · double-click to reset"
            onPointerDown={beginDockResize}
            onDoubleClick={() => setDockHeight(260)}
          />

          <ShaderGraphDock
            open={dockOpen}
            height={dockHeight}
            collapsedHeight={DOCK_COLLAPSED_HEIGHT}
            resizing={dockResizing}
            onBeginResize={beginDockResize}
            onResetSize={() => setDockHeight(260)}
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
          />
        </div>

        <div className="studioInspector">
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
            />
          )}
        </div>
      </div>

      <div className="studioStatusBar" role="status">
        <span>{session.status}</span>
        <span className="studioStatusSpacer" />
        {session.doc && <span className="studioStatusHint">Left-drag orbits · right-drag pans · wheel zooms · F frames · click selects</span>}
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
