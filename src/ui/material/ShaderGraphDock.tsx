import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  LayoutGrid,
  Maximize,
  Minimize,
  Redo2,
  RotateCcw,
  Scan,
  Undo2,
  Wand2,
} from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CompiledShader, GxMaterialDoc, GxMaterialRef, GxTextureSummary, ShaderGraphPreset } from '../../lib/gxMaterial';
import { Button, EmptyState, IconButton, MenuSurface, Tabs } from '../components';
import { GraphEditor } from './GraphEditor';
import { GraphHelpCard } from './GraphHelpCard';
import { StagesTable } from './StagesTable';
import type { EditorShaderGraph } from './graphModel';
import type { MaterialDockTab } from './MaterialMode';
import type { MaterialDocChange } from './MaterialInspector';
import { describeShader } from './materialDoc';
import { useArchiveTextures } from './useArchiveTextures';

export interface ShaderGraphDockProps {
  open: boolean;
  height: number;
  collapsedHeight: number;
  resizing: boolean;
  onBeginResize: (event: ReactPointerEvent<HTMLElement>) => void;
  onResetSize: () => void;
  onToggleOpen: () => void;

  tab: MaterialDockTab;
  onChangeTab: (tab: MaterialDockTab) => void;
  materialRef: GxMaterialRef | null;
  doc: GxMaterialDoc | null;
  graph: EditorShaderGraph | null;
  compiled: CompiledShader | null;
  /**
   * True once the graph has been edited, at which point it — not the material's stored stages —
   * is what gets written. Until then the dock shows the material's own stages, because a freshly
   * decompiled graph is a view of them and its compile is only a round trip.
   */
  graphDrivesMaterial: boolean;
  presets: ShaderGraphPreset[];
  historyState: { undo: number; redo: number };
  textures: readonly GxTextureSummary[];
  archivePath: string;
  archiveBytes: Uint8Array | null;
  onChangeGraph: (graph: EditorShaderGraph, options?: { record?: boolean; undoFrom?: EditorShaderGraph }) => void;
  onUndo: () => void;
  onRedo: () => void;
  onResetFromStages: () => void;
  /** Re-reads the material's steps into a fresh graph; offered on every "Special step" card. */
  onConvertRawStages: () => void;
  /** True when that fresh read would leave fewer read-only cards than the graph on screen. */
  rawStagesConvertible: boolean;
  onApplyPreset: (presetId: string) => void;
  onAutoLayout: () => void;
  onChangeDoc: MaterialDocChange;
  /** Called whenever the graph's node selection changes, including clearing to `[]`. */
  onSelectionChange?: (nodeIds: string[]) => void;
  /** When `key` changes, the graph selects `nodeIds` and frames them. */
  selectionRequest?: { nodeIds: string[]; key: number } | null;
}

/**
 * Bottom dock for Material mode and the Model Studio. Two views of the same thing: the node
 * graph an author works in, and the TEV stages it compiles to.
 *
 * The header is one tidy row, Unreal-style: the view tabs, then the graph's tools — a "Start
 * from…" menu of presets, reset, auto layout, frame, undo/redo, help and fullscreen — and on the
 * right the honest status line: how many stages and textures the material draws with, or the
 * first error when the graph does not compile (the material then keeps the last stages that did).
 */
export function ShaderGraphDock({
  open,
  height,
  collapsedHeight,
  resizing,
  onBeginResize,
  onResetSize,
  onToggleOpen,
  tab,
  onChangeTab,
  materialRef,
  doc,
  graph,
  compiled,
  graphDrivesMaterial,
  presets,
  historyState,
  textures,
  archivePath,
  archiveBytes,
  onChangeGraph,
  onUndo,
  onRedo,
  onResetFromStages,
  onConvertRawStages,
  rawStagesConvertible,
  onApplyPreset,
  onAutoLayout,
  onChangeDoc,
  onSelectionChange,
  selectionRequest,
}: ShaderGraphDockProps) {
  const [fitRequest, setFitRequest] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const textureInfos = useArchiveTextures(archiveBytes, textures);

  // Fullscreen is a view of the graph; Escape leaves it unless something inside wants the key.
  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('.graphPalette, .uiMenu')) return;
      setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  const error = compiled?.diagnostics.find((diagnostic) => diagnostic.severity === 'error') ?? null;
  const warningCount = compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length ?? 0;
  // Which stage list the material actually draws with right now.
  const stages = graphDrivesMaterial && compiled?.ok ? compiled.tevStages : (doc?.tevStages ?? []);
  const status = compiled && !compiled.ok && graphDrivesMaterial
    ? `Not compiling — ${error?.message ?? 'the graph is invalid'}`
    : doc
      ? describeShader(stages.length, doc.samplers.length)
      : '';
  const showGraphTools = open && materialRef && tab === 'graph';
  const contextKey = materialRef ? `${materialRef.archivePath}|${materialRef.modelName}|${materialRef.materialName}` : '';
  const expanded = open && fullscreen;

  return (
    <section
      className={[
        open ? 'contentBrowser' : 'contentBrowser collapsed',
        'materialDock',
        resizing && 'resizing',
        expanded && 'materialDock--fullscreen',
      ].filter(Boolean).join(' ')}
      style={expanded ? undefined : { height: `${open ? height : collapsedHeight}px` }}
      aria-label="Shader graph"
    >
      {!expanded && (
        <div
          className="contentBrowserResizeHandle"
          onPointerDown={onBeginResize}
          onDoubleClick={onResetSize}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the shader graph"
          title="Drag to resize · double-click to reset"
        />
      )}
      <header className="browserHeader materialDockHeader">
        <div className="materialDockTitle">
          <h2>Shader</h2>
          <Tabs
            label="Shader views"
            value={tab}
            options={[
              { value: 'graph', label: 'Graph' },
              { value: 'stages', label: 'Stages', badge: stages.length },
            ]}
            onChange={(value) => onChangeTab(value as MaterialDockTab)}
          />
        </div>

        {showGraphTools && (
          <div className="materialDockTools" role="toolbar" aria-label="Graph tools">
            {presets.length > 0 && <PresetMenu presets={presets} onApplyPreset={onApplyPreset} />}
            <span className="materialDockDivider" aria-hidden="true" />
            <IconButton size="sm" variant="ghost" icon={<Undo2 size={14} />} tooltip="Undo" shortcut="Ctrl+Z" disabled={historyState.undo === 0} disabledReason="Nothing to undo in this graph." onClick={onUndo} />
            <IconButton size="sm" variant="ghost" icon={<Redo2 size={14} />} tooltip="Redo" shortcut="Ctrl+Y" disabled={historyState.redo === 0} disabledReason="Nothing to redo in this graph." onClick={onRedo} />
            <span className="materialDockDivider" aria-hidden="true" />
            <Button
              size="sm"
              variant="ghost"
              icon={<LayoutGrid size={13} />}
              tooltip="Lay the nodes out left to right, ending at the Material node"
              onClick={() => {
                onAutoLayout();
                setFitRequest((value) => value + 1);
              }}
            >
              Auto layout
            </Button>
            <IconButton size="sm" variant="ghost" icon={<Scan size={14} />} tooltip="Frame the whole graph" shortcut="Home" onClick={() => setFitRequest((value) => value + 1)} />
            <IconButton
              size="sm"
              variant="ghost"
              icon={<RotateCcw size={14} />}
              tooltip="Reset: rebuild the graph from the material's stages"
              onClick={onResetFromStages}
            />
            <span className="materialDockDivider" aria-hidden="true" />
            <IconButton size="sm" variant="ghost" icon={<CircleHelp size={14} />} tooltip="Controls and tips" active={helpOpen} onClick={() => setHelpOpen((value) => !value)} />
            <IconButton
              size="sm"
              variant="ghost"
              icon={fullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
              tooltip={fullscreen ? 'Leave fullscreen' : 'Fullscreen graph'}
              shortcut={fullscreen ? 'Esc' : undefined}
              active={fullscreen}
              onClick={() => {
                setFullscreen((value) => !value);
                setFitRequest((value) => value + 1);
              }}
            />
          </div>
        )}

        <div className="materialDockStatus">
          {error && graphDrivesMaterial && <AlertTriangle size={13} className="materialDockStatusIcon" aria-hidden="true" />}
          <span className={error && graphDrivesMaterial ? 'materialDockStatusText error' : 'materialDockStatusText'} title={status}>{status}</span>
          {warningCount > 0 && <span className="materialTag">{warningCount} note{warningCount === 1 ? '' : 's'}</span>}
          {!expanded && (
            <IconButton
              size="sm"
              variant="ghost"
              icon={open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
              tooltip={open ? 'Hide the shader panel' : 'Show the shader panel'}
              onClick={onToggleOpen}
            />
          )}
        </div>
      </header>

      {open && (
        <div className="materialDockBody" role="tabpanel" aria-label={tab === 'graph' ? 'Shader graph' : 'TEV stages'}>
          {!materialRef || !doc ? (
            <EmptyState
              icon={<Wand2 size={22} />}
              title="No material selected"
              description="Pick a material on the left and its shader graph appears here."
            />
          ) : tab === 'stages' ? (
            <StagesTable stages={stages} />
          ) : graph ? (
            <>
              <GraphEditor
                graph={graph}
                doc={doc}
                compiled={compiled}
                textures={textureInfos}
                archivePath={archivePath}
                archiveBytes={archiveBytes}
                onChangeGraph={onChangeGraph}
                onChangeDoc={onChangeDoc}
                onUndo={onUndo}
                onRedo={onRedo}
                onConvertRawStages={onConvertRawStages}
                rawStagesConvertible={rawStagesConvertible}
                fitRequest={fitRequest}
                contextKey={contextKey}
                onSelectionChange={onSelectionChange}
                selectionRequest={selectionRequest}
                emptyAction={presets.length > 0 ? <PresetMenu presets={presets} onApplyPreset={onApplyPreset} variant="default" /> : undefined}
              />
              {helpOpen && <GraphHelpCard onClose={() => setHelpOpen(false)} />}
            </>
          ) : (
            <EmptyState icon={<Wand2 size={22} />} title="Building the graph" description="Reading this material's TEV stages…" />
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The presets, one menu instead of a row of chips: still one click to open and one to pick, but it
 * no longer takes a strip of the graph's height. Each item says what the preset makes.
 */
function PresetMenu({
  presets,
  onApplyPreset,
  variant = 'ghost',
}: {
  presets: ShaderGraphPreset[];
  onApplyPreset: (presetId: string) => void;
  variant?: 'ghost' | 'default';
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number; bottom: number; right: number } | null>(null);
  // The menu closes on any press outside it, the button included; without this, pressing the
  // button to close the menu would close it and then open it again on the click.
  const closedAtRef = useRef(0);
  return (
    <>
      <Button
        ref={buttonRef}
        size="sm"
        variant={variant}
        icon={<Wand2 size={13} />}
        active={anchor !== null}
        tooltip="Replace this graph with a ready-made shader"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={() => {
          if (performance.now() - closedAtRef.current < 250) return;
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) setAnchor({ top: rect.top, left: rect.left, bottom: rect.bottom + 4, right: rect.right });
        }}
      >
        Start from…
      </Button>
      {anchor && (
        <MenuSurface
          anchor={anchor}
          label="Shader presets"
          minWidth={280}
          onClose={() => {
            closedAtRef.current = performance.now();
            setAnchor(null);
          }}
          sections={[
            {
              id: 'presets',
              title: 'Start from a preset',
              items: presets.map((preset) => ({
                id: preset.id,
                label: (
                  <span className="materialPresetItem">
                    <strong>{preset.title}</strong>
                    <span>{preset.description}</span>
                  </span>
                ),
                onSelect: () => onApplyPreset(preset.id),
              })),
            },
          ]}
        />
      )}
    </>
  );
}
