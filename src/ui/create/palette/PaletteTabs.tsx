import { ArrowDownToLine, Eraser, Layers2, Mountain, MountainSnow, Search, Waves } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { updateTerrain } from '../../../lib/create/ops';
import { ROAD_STYLES } from '../../../lib/create/roadStyles';
import type { CreateKit } from '../../../lib/create/types';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Toggle } from '../../components/Toggle';
import { Slider } from '../details/Slider';
import type { CreateSession } from '../session/types';
import { ERASER_ITEM, pieceItem, roadStyleItem, sameArmed, sculptItem, SCULPT_ITEMS, surfaceItem, toolForItem } from '../tools/armed';
import { selectedRoadId } from '../tools/pick';
import type { CreateTools } from '../tools/useCreateTools';
import { BRUSH_LIMITS, surfaceCategoryColor, type ArmedItem, type SculptMode } from '../tools/types';
import { PIECE_ICONS } from '../viewport/icons';
import type { CreateAssets } from './assets';
import { filterScenery, groupSurfaces, HAZARDS, ITEM_BOX_OBJECT_ID, paintSections, surfaceBlurb, type SurfaceSection } from './paletteModel';
import { PaletteTile, TileSection } from './PaletteTile';
import { RoadProfileArt } from './RoadProfileArt';
import { ObjectArt, SurfaceThumb } from './TileArt';

export interface PaletteTabProps {
  session: CreateSession;
  tools: CreateTools;
  assets: CreateAssets;
  /** The dock header's slot for a shelf's own controls (search box ...). Null until it mounts. */
  toolsSlot?: HTMLElement | null;
}

/** Renders a shelf's controls in the dock header, so the tile rows start right under the tab bar. */
function HeaderTools({ slot, children }: { slot: HTMLElement | null | undefined; children: ReactNode }) {
  return slot ? createPortal(children, slot) : null;
}

const css = (c: readonly [number, number, number]) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;

function useArmedCheck(tools: CreateTools) {
  return (item: ArmedItem): boolean => tools.activeTool === toolForItem(item) && sameArmed(tools.armedByTool[toolForItem(item)], item);
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="crSearch">
      <Search size={13} aria-hidden="true" />
      <input type="search" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}

// ── Roads ────────────────────────────────────────────────────────────────────────────────────
export function RoadsTab({ session, tools }: PaletteTabProps) {
  const project = session.project;
  const kit = session.kit;
  const isArmed = useArmedCheck(tools);
  if (!project) return null;
  const road = project.roads.find((r) => r.id === selectedRoadId(session.selection)) ?? project.roads[0];
  return (
    <TileSection title="Road styles" hint="Click one, then draw. Or drag a style onto an existing road." autoFill>
      {ROAD_STYLES.map((style) => (
        <PaletteTile
          key={style.id}
          wide
          item={roadStyleItem(style.id)}
          art={<RoadProfileArt kit={kit} themeId={project.themeId} style={style} />}
          label={style.label}
          description={style.description}
          armed={isArmed(roadStyleItem(style.id))}
          badge={road?.styleId === style.id ? 'In use' : undefined}
          accent="var(--create-road)"
          onActivate={tools.arm}
        />
      ))}
    </TileSection>
  );
}

// ── Surfaces ─────────────────────────────────────────────────────────────────────────────────
const SURFACE_HINTS: Record<string, string> = {
  road: 'Applies to the selected section',
  curb: 'Applies to the selected section',
  wall: 'Applies to the selected section',
  ground: 'Paints the ground',
  offroad: 'Paints the ground',
  ice: 'Paints the ground',
  water: 'Paints the ground',
  lava: 'Paints the ground',
};

function SurfaceSections({ sections, kit, tools, themeAccent, hints = false }: { sections: SurfaceSection[]; kit: CreateKit; tools: CreateTools; themeAccent: string; hints?: boolean }) {
  const isArmed = useArmedCheck(tools);
  return (
    <>
      {sections.map(({ group, entries }) => (
        <TileSection key={group.id} title={group.label} hint={hints ? SURFACE_HINTS[group.id] : undefined} autoFill={entries.length > 6}>
          {entries.map(({ surface, inWorld }) => {
            const item = surfaceItem(surface);
            return (
              <PaletteTile
                key={surface.id}
                item={item}
                art={<SurfaceThumb kit={kit} surfaceId={surface.id} size={52} />}
                label={surface.label}
                description={surfaceBlurb(surface)}
                armed={isArmed(item)}
                badge={inWorld ? 'Your world' : undefined}
                accent={item.kind === 'surface' && item.category !== 'erase' ? css(surfaceCategoryColor(item.category)) : themeAccent}
                onActivate={tools.arm}
              />
            );
          })}
        </TileSection>
      ))}
    </>
  );
}

export function SurfacesTab({ session, tools, toolsSlot }: PaletteTabProps) {
  const [query, setQuery] = useState('');
  const project = session.project;
  const kit = session.kit;
  const sections = useMemo(() => (kit && project ? groupSurfaces(kit, project.themeId, query) : []), [kit, project, query]);
  if (!kit || !project) return null;
  return (
    <>
      <HeaderTools slot={toolsSlot}>
        <SearchBox value={query} onChange={setQuery} placeholder="Search surfaces" />
      </HeaderTools>
      {sections.length === 0 ? <EmptyState icon={<Layers2 size={20} />} title="No surface matches" description="Try a shorter word, like “grass” or “brick”." size="sm" /> : <SurfaceSections sections={sections} kit={kit} tools={tools} themeAccent="var(--create-road)" hints />}
    </>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────
export function PiecesTab({ session, tools, assets }: PaletteTabProps) {
  const kit = session.kit;
  const isArmed = useArmedCheck(tools);
  const boost = kit?.catalog.surfaces.find((s) => s.category === 'boost');
  const amber = 'var(--create-piece)';
  const iconArt = (kind: 'boostRamp' | 'trickRamp') => <span className="crPieceArt">{PIECE_ICONS[kind](26)}</span>;
  const itemBox = pieceItem('object', ITEM_BOX_OBJECT_ID, 'Item box');
  return (
    <>
      <TileSection title="Speed">
        <PaletteTile
          item={pieceItem('boostPanel')}
          art={boost && kit ? <SurfaceThumb kit={kit} surfaceId={boost.id} size={52} /> : <span className="crPieceArt">{PIECE_ICONS.boostPanel(26)}</span>}
          label="Boost panel"
          description="A dash panel on the road. Karts that drive over it get a speed boost."
          armed={isArmed(pieceItem('boostPanel'))}
          accent={amber}
          onActivate={tools.arm}
        />
        <PaletteTile item={pieceItem('boostRamp')} art={iconArt('boostRamp')} label="Boost ramp" description="A ramp that boosts karts and launches them into the air. Put a gap after it." armed={isArmed(pieceItem('boostRamp'))} accent={amber} onActivate={tools.arm} />
        <PaletteTile item={pieceItem('trickRamp')} art={iconArt('trickRamp')} label="Trick ramp" description="A ramp you can do a trick off for an extra boost. Put a gap after it." armed={isArmed(pieceItem('trickRamp'))} accent={amber} onActivate={tools.arm} />
      </TileSection>
      <TileSection title="Items">
        <PaletteTile
          item={pieceItem('itemRow')}
          art={<ObjectArt objectId={ITEM_BOX_OBJECT_ID} assets={assets} />}
          label="Item box row"
          description="A row of item boxes across the road. Racers drive through to get an item."
          armed={isArmed(pieceItem('itemRow'))}
          accent={amber}
          onActivate={tools.arm}
        />
        <PaletteTile item={itemBox} art={<ObjectArt objectId={ITEM_BOX_OBJECT_ID} assets={assets} />} label="Single item box" description="One item box where you click." armed={isArmed(itemBox)} accent={amber} onActivate={tools.arm} />
      </TileSection>
      <TileSection title="Hazards" hint="Click the road to put one down.">
        {HAZARDS.map((hazard) => {
          const item = pieceItem('object', hazard.objectId, hazard.label);
          return <PaletteTile key={hazard.objectId} item={item} art={<ObjectArt objectId={hazard.objectId} assets={assets} />} label={hazard.label} description={hazard.description} armed={isArmed(item)} accent={amber} onActivate={tools.arm} />;
        })}
      </TileSection>
    </>
  );
}

// ── Scenery ──────────────────────────────────────────────────────────────────────────────────
export function SceneryTab({ session, tools, assets, toolsSlot }: PaletteTabProps) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const kit = session.kit;
  const project = session.project;
  const isArmed = useArmedCheck(tools);
  const entries = useMemo(() => (kit && project ? filterScenery(kit, project.themeId, query, showAll) : []), [kit, project, query, showAll]);
  if (!kit || !project) return null;
  return (
    <>
      <HeaderTools slot={toolsSlot}>
        <SearchBox value={query} onChange={setQuery} placeholder="Search scenery" />
        <Toggle variant="checkbox" checked={showAll} onChange={setShowAll} label="Objects from every world" />
      </HeaderTools>
      {entries.length === 0 ? (
        <EmptyState icon={<Search size={20} />} title="Nothing found" description={showAll ? 'Try another word.' : 'Try another word, or show objects from every world.'} size="sm" />
      ) : (
        <TileSection title="Scenery" hint="Click to place one. Drag across the ground to scatter. Shift-drag erases." autoFill>
          {entries.map((entry) => {
            const item: ArmedItem = { kind: 'scenery', objectId: entry.objectId, label: entry.label, scale: entry.scale, spacing: entry.spacing };
            return (
              <PaletteTile
                key={entry.objectId}
                item={item}
                art={<ObjectArt objectId={entry.objectId} assets={assets} />}
                label={entry.label}
                description={`${entry.label}. Click to place one, or drag across the ground to scatter a patch.`}
                armed={isArmed(item)}
                accent="var(--create-scenery)"
                onActivate={tools.arm}
              />
            );
          })}
        </TileSection>
      )}
    </>
  );
}

// ── Terrain ──────────────────────────────────────────────────────────────────────────────────
const SCULPT_ICONS: Record<SculptMode, ReactNode> = {
  raise: <Mountain size={24} />,
  lower: <ArrowDownToLine size={24} />,
  smooth: <Waves size={24} />,
  flatten: <MountainSnow size={24} />,
};

export function TerrainTab({ session, tools }: PaletteTabProps) {
  const project = session.project;
  const kit = session.kit;
  const isArmed = useArmedCheck(tools);
  const sections = useMemo(() => (kit && project ? paintSections(kit, project.themeId) : []), [kit, project]);
  if (!project || !kit) return null;
  const brushTool = tools.activeTool === 'sculpt' ? 'sculptRadius' : tools.activeTool === 'scenery' ? 'sceneryRadius' : 'paintRadius';
  const radius = tools.brush[brushTool];
  const groundOn = project.terrain.enabled;
  const paintBlock = (
    <>
    <SurfaceSections sections={sections} kit={kit} tools={tools} themeAccent="var(--create-terrain)" />
    <TileSection title="Eraser">
      <PaletteTile item={ERASER_ITEM} art={<span className="crPieceArt crPieceArt--erase"><Eraser size={26} /></span>} label="Eraser" description="Rubs paint away and shows the base ground again. Holding Shift while painting does the same." armed={isArmed(ERASER_ITEM)} accent="var(--danger)" onActivate={tools.arm} />
    </TileSection>
    </>
  );
  const sculptBlock = (
    <>
    <TileSection title="Sculpt">
      {SCULPT_ITEMS.map((s) => {
        const item = sculptItem(s.mode);
        return <PaletteTile key={s.mode} item={item} art={<span className="crPieceArt crPieceArt--earth">{SCULPT_ICONS[s.mode]}</span>} label={s.label} description={s.description} armed={isArmed(item)} accent="var(--create-terrain)" onActivate={tools.arm} />;
      })}
    </TileSection>
    <section className="crBrushPanel crTileSection">
      <h3 className="crTileSectionTitle">Brush</h3>
      <div className="crBrushBody">
        <label className="crBrushRow">
          <span>Size</span>
          <Slider label="Brush size" min={BRUSH_LIMITS.min} max={BRUSH_LIMITS.max} step={100} value={radius} onChange={(v) => tools.setBrush({ [brushTool]: v })} format={(v) => `${(v / 1000).toFixed(1)}k`} />
        </label>
        <label className="crBrushRow">
          <span>Strength</span>
          <Slider label="Sculpt strength" min={20} max={600} step={10} value={tools.brush.sculptStrength} onChange={(v) => tools.setBrush({ sculptStrength: v })} format={(v) => `${v}`} />
        </label>
        <p className="crTabNote">Press [ and ] to change the size while you paint.</p>
      </div>
    </section>
    </>
  );
  // The shelf opens on what the active tool needs: sculpting shows its tools first, painting its surfaces.
  return (
    <>
      {!groundOn && (
        <div className="crInlineNote crInlineNote--warn">
          <span>The ground is switched off, so painting and sculpting do nothing.</span>
          <Button size="sm" onClick={() => session.edit((p) => updateTerrain(p, { enabled: true }), { label: 'Turn the ground on' })}>
            Turn it on
          </Button>
        </div>
      )}
      {tools.activeTool === 'sculpt' ? sculptBlock : paintBlock}
      {tools.activeTool === 'sculpt' ? paintBlock : sculptBlock}
    </>
  );
}
