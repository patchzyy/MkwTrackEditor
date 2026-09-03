import { AlertTriangle, ChevronDown, ChevronUp, LayoutGrid, Maximize2, Redo2, RotateCcw, Undo2, Wand2 } from 'lucide-react';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CompiledShader, GxMaterialDoc, GxMaterialRef, GxTextureSummary, ShaderGraphPreset } from '../../lib/gxMaterial';
import { Button, EmptyState, IconButton, MenuSurface, Tabs } from '../components';
import { GraphEditor } from './GraphEditor';
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
  presets: ShaderGraphPreset[];
  historyState: { undo: number; redo: number };
  textures: readonly GxTextureSummary[];
  archivePath: string;
  archiveBytes: Uint8Array | null;
  onChangeGraph: (graph: EditorShaderGraph, options?: { record?: boolean; undoFrom?: EditorShaderGraph }) => void;
  onUndo: () => void;
  onRedo: () => void;
  onResetFromStages: () => void;
  onApplyPreset: (presetId: string) => void;
  onAutoLayout: () => void;
  onChangeDoc: MaterialDocChange;
}

/**
 * Bottom dock for Material mode. It takes the content browser's slot and its size, and offers two
 * views of the same thing: the node graph an author works in, and the TEV stages it compiles to.
 *
 * The status line is the honest one — how many stages and textures the current graph produces,
 * and the first error when it does not compile, in which case the material keeps the last stages
 * that did.
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
  presets,
  historyState,
  textures,
  archivePath,
  archiveBytes,
  onChangeGraph,
  onUndo,
  onRedo,
  onResetFromStages,
  onApplyPreset,
  onAutoLayout,
  onChangeDoc,
}: ShaderGraphDockProps) {
  const [presetAnchor, setPresetAnchor] = useState<{ top: number; bottom: number; left: number; right: number } | null>(null);
  const [fitRequest, setFitRequest] = useState(0);
  const presetButtonRef = useRef<HTMLButtonElement | null>(null);
  const textureInfos = useArchiveTextures(archiveBytes, textures);

  const error = compiled?.diagnostics.find((diagnostic) => diagnostic.severity === 'error') ?? null;
  const warningCount = compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length ?? 0;
  const status = compiled
    ? compiled.ok
      ? describeShader(compiled.tevStages.length, compiled.usage.samplers.length)
      : `Not compiling — ${error?.message ?? 'the graph is invalid'}`
    : doc
      ? describeShader(doc.tevStages.length, doc.samplers.length)
      : '';

  return (
    <section
      className={`${open ? 'contentBrowser' : 'contentBrowser collapsed'} materialDock${resizing ? ' resizing' : ''}`}
      style={{ height: `${open ? height : collapsedHeight}px` }}
      aria-label="Shader graph"
    >
      <div
        className="contentBrowserResizeHandle"
        onPointerDown={onBeginResize}
        onDoubleClick={onResetSize}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the shader graph"
        title="Drag to resize · double-click to reset"
      />
      <header className="browserHeader materialDockHeader">
        <div className="materialDockTitle">
          <h2>Shader</h2>
          <Tabs
            label="Shader views"
            value={tab}
            options={[
              { value: 'graph', label: 'Graph' },
              { value: 'stages', label: 'Stages', badge: compiled?.tevStages.length ?? doc?.tevStages.length ?? 0 },
            ]}
            onChange={(value) => onChangeTab(value as MaterialDockTab)}
          />
        </div>

        {open && materialRef && (
          <div className="materialDockTools">
            <Button
              ref={presetButtonRef}
              size="sm"
              variant="ghost"
              icon={<Wand2 size={13} />}
              onClick={() => {
                const rect = presetButtonRef.current?.getBoundingClientRect();
                setPresetAnchor(rect && !presetAnchor ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } : null);
              }}
            >
              Presets
            </Button>
            {presetAnchor && (
              <MenuSurface
                anchor={presetAnchor}
                label="Shader presets"
                onClose={() => setPresetAnchor(null)}
                sections={[
                  {
                    id: 'presets',
                    items: presets.map((preset) => ({
                      id: preset.id,
                      label: preset.title,
                      onSelect: () => {
                        onApplyPreset(preset.id);
                        setPresetAnchor(null);
                      },
                    })),
                  },
                ]}
              />
            )}
            <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={onResetFromStages}>
              Reset from stages
            </Button>
            <Button size="sm" variant="ghost" icon={<LayoutGrid size={13} />} onClick={onAutoLayout}>
              Auto layout
            </Button>
            <IconButton size="sm" variant="ghost" icon={<Maximize2 size={13} />} tooltip="Fit the graph in view" onClick={() => setFitRequest((value) => value + 1)} />
            <IconButton
              size="sm"
              variant="ghost"
              icon={<Undo2 size={13} />}
              tooltip="Undo the last graph change"
              shortcut="Ctrl+Z"
              disabled={historyState.undo === 0}
              disabledReason="Nothing to undo in this graph."
              onClick={onUndo}
            />
            <IconButton
              size="sm"
              variant="ghost"
              icon={<Redo2 size={13} />}
              tooltip="Redo the last graph change"
              shortcut="Ctrl+Y"
              disabled={historyState.redo === 0}
              disabledReason="Nothing to redo in this graph."
              onClick={onRedo}
            />
          </div>
        )}

        <div className="materialDockStatus">
          {error && <AlertTriangle size={13} className="materialDockStatusIcon" aria-hidden="true" />}
          <span className={error ? 'materialDockStatusText error' : 'materialDockStatusText'}>{status}</span>
          {warningCount > 0 && <span className="materialTag">{warningCount} note{warningCount === 1 ? '' : 's'}</span>}
          <IconButton
            size="sm"
            variant="ghost"
            icon={open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
            tooltip={open ? 'Hide the shader panel' : 'Show the shader panel'}
            onClick={onToggleOpen}
          />
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
            <StagesTable stages={compiled?.ok ? compiled.tevStages : doc.tevStages} />
          ) : graph ? (
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
              fitRequest={fitRequest}
            />
          ) : (
            <EmptyState icon={<Wand2 size={22} />} title="Building the graph" description="Reading this material's TEV stages…" />
          )}
        </div>
      )}
    </section>
  );
}
