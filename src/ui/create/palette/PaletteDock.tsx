import { ChevronDown, ChevronUp, Mountain, Route, Sparkles, TreePine, Zap, Layers } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IconButton } from '../../components/Button';
import { Tabs, type TabOption } from '../../components/Tabs';
import type { ModeBottomDock } from '../../modes/types';
import type { CreateSession } from '../session/types';
import type { CreateTools } from '../tools/useCreateTools';
import '../create-tools.css';
import './palette.css';
import { NO_ASSETS, type CreateAssets } from './assets';
import { PiecesTab, RoadsTab, SceneryTab, SurfacesTab, TerrainTab } from './PaletteTabs';

export type PaletteTab = 'roads' | 'surfaces' | 'pieces' | 'scenery' | 'terrain';

const TAB_KEY = 'mkw.create.paletteTab.v1';
const TAB_OPTIONS: Array<TabOption<PaletteTab>> = [
  { value: 'roads', label: 'Roads', icon: <Route size={14} /> },
  { value: 'surfaces', label: 'Surfaces', icon: <Layers size={14} /> },
  { value: 'pieces', label: 'Pieces', icon: <Zap size={14} /> },
  { value: 'scenery', label: 'Scenery', icon: <TreePine size={14} /> },
  { value: 'terrain', label: 'Terrain', icon: <Mountain size={14} /> },
];

/** Which palette tab goes with a tool, so pressing P / B / D / R opens the right shelf. */
export const TAB_FOR_TOOL: Partial<Record<string, PaletteTab>> = { road: 'roads', pieces: 'pieces', scenery: 'scenery', paint: 'terrain', sculpt: 'terrain' };

function readTab(): PaletteTab {
  try {
    const stored = window.localStorage.getItem(TAB_KEY);
    if (stored && TAB_OPTIONS.some((o) => o.value === stored)) return stored as PaletteTab;
  } catch {
    // ignore
  }
  return 'roads';
}

/**
 * The bottom dock: one shelf of tiles per kind of building block. It takes the dock's size and
 * collapse state from the shell (`ModeBottomDock`) so it resizes exactly like the content browser.
 */
export function PaletteDock({ dock, session, tools, assets = NO_ASSETS }: { dock: ModeBottomDock; session: CreateSession; tools: CreateTools; assets?: CreateAssets }) {
  const [tab, setTab] = useState<PaletteTab>(readTab);
  // Each shelf may put its own controls (a search box) in the header, so the tile rows stay whole.
  const [toolsSlot, setToolsSlot] = useState<HTMLElement | null>(null);
  const { open, height, collapsedHeight, resizing, onBeginResize, onResetSize, onToggleOpen } = dock;

  useEffect(() => {
    try {
      window.localStorage.setItem(TAB_KEY, tab);
    } catch {
      // ignore
    }
  }, [tab]);

  // Choosing a tool by key shows its shelf; choosing a shelf does not change the tool.
  const wanted = TAB_FOR_TOOL[tools.activeTool];
  useEffect(() => {
    if (wanted) setTab(wanted);
  }, [wanted]);

  const armed = tools.armed;
  const props = { session, tools, assets, toolsSlot };
  return (
    <section
      className={[open ? 'contentBrowser' : 'contentBrowser collapsed', 'createMode', 'crPalette', resizing && 'resizing'].filter(Boolean).join(' ')}
      style={{ height: `${open ? height : collapsedHeight}px` }}
      aria-label="Palette"
      data-create-slot="palette"
    >
      <div className="contentBrowserResizeHandle" onPointerDown={onBeginResize} onDoubleClick={onResetSize} role="separator" aria-orientation="horizontal" aria-label="Resize the palette" title="Drag to resize · double-click to reset" />
      <header className="browserHeader crPaletteHeader">
        <h2 className="crPaletteTitle">
          <Sparkles size={14} aria-hidden="true" /> Palette
        </h2>
        <Tabs label="Palette shelves" value={tab} options={TAB_OPTIONS} onChange={(value) => setTab(value)} />
        <div className="crPaletteTools" ref={setToolsSlot} />
        <div className="crPaletteStatus">
          {armed ? (
            <span className="crArmedChip" data-create-armed>
              <span>In hand</span>
              <strong>{armed.label}</strong>
              <button type="button" onClick={tools.disarm} aria-label="Put it down">
                Put down
              </button>
            </span>
          ) : (
            <span className="crPaletteHint">Click a tile to pick it up, or drag it into the viewport.</span>
          )}
          <IconButton size="sm" variant="ghost" icon={open ? <ChevronDown size={15} /> : <ChevronUp size={15} />} tooltip={open ? 'Hide the palette' : 'Show the palette'} onClick={onToggleOpen} />
        </div>
      </header>
      {open && (
        <div className="crPaletteBody" role="tabpanel" aria-label={TAB_OPTIONS.find((o) => o.value === tab)?.label as string}>
          {tab === 'roads' && <RoadsTab {...props} />}
          {tab === 'surfaces' && <SurfacesTab {...props} />}
          {tab === 'pieces' && <PiecesTab {...props} />}
          {tab === 'scenery' && <SceneryTab {...props} />}
          {tab === 'terrain' && <TerrainTab {...props} />}
        </div>
      )}
    </section>
  );
}
