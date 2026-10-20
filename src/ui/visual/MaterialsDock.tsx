import { Box, ChevronDown, ChevronUp, Image as ImageIcon, Layers, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { IconButton } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Tabs } from '../components/Tabs';
import type { ModeBottomDock } from '../modes/types';
import { TexturePreview } from './TexturePreview';
import {
  describeVisualArchive,
  formatByteSize,
  type VisualArchiveInfo,
  type VisualMaterialInfo,
  type VisualModelInfo,
  type VisualTextureInfo,
} from './visualArchive';

export type MaterialsDockTab = 'materials' | 'textures';

const TILE_SIZE_STORAGE_KEY = 'mkw.editor.visualTileSize.v1';
const MIN_TILE_SIZE = 84;
const MAX_TILE_SIZE = 200;
const DEFAULT_TILE_SIZE = 112;

function readStoredTileSize(): number {
  if (typeof window === 'undefined') return DEFAULT_TILE_SIZE;
  const parsed = Number(window.localStorage.getItem(TILE_SIZE_STORAGE_KEY));
  return Number.isFinite(parsed) && parsed >= MIN_TILE_SIZE && parsed <= MAX_TILE_SIZE ? parsed : DEFAULT_TILE_SIZE;
}

/** Decodes a texture only once its tile has scrolled into view; a track can have hundreds. */
export function LazyTexture({
  archivePath,
  archiveBytes,
  texture,
  revision,
  size = 'tile',
}: {
  archivePath: string;
  archiveBytes: Uint8Array | null;
  texture: VisualTextureInfo | null;
  revision: number;
  size?: 'tile' | 'large';
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (hits) => {
        if (hits.some((hit) => hit.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);
  return (
    <div ref={ref} className="visualLazyTexture">
      {seen && texture ? (
        <TexturePreview archivePath={archivePath} archiveBytes={archiveBytes} texture={texture} revision={revision} size={size} />
      ) : (
        <div className={size === 'large' ? 'visualCheckerboard visualTexturePreviewLarge' : 'visualCheckerboard visualCheckerboardTile'}>
          {seen && !texture && <Box size={size === 'large' ? 28 : 16} className="visualNoTexture" aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}

export interface MaterialsDockProps {
  dock: ModeBottomDock;
  tab: MaterialsDockTab;
  onChangeTab: (tab: MaterialsDockTab) => void;
  /** Every `.brres` of the track, for the archive picker. */
  archivePaths: string[];
  /** The archive being browsed. */
  scopePath: string | null;
  /** True when a clicked surface decides the archive, so the picker is locked to it. */
  followingSurface: boolean;
  onSelectArchive: (path: string) => void;
  archive: VisualArchiveInfo | null;
  archiveBytes: Uint8Array | null;
  loading: boolean;
  textureRevision: number;
  /** Only this model's materials can be given to the selected surface. */
  modelFilter: string | null;
  /** Material the active slot uses now (marked "In use"); null when there is no active slot. */
  currentMaterial: { modelName: string; materialIndex: number } | null;
  /** True when clicking a material assigns it. */
  assigning: boolean;
  /** Short name of the slot being filled ("Item Box, slot 2"). */
  assigningLabel: string | null;
  onPickMaterial: (model: VisualModelInfo, material: VisualMaterialInfo) => void;
  /** Material picked only to look at (no surface selected). */
  browsedMaterial: { modelName: string; materialIndex: number } | null;
  selectedTexture: string | null;
  onSelectTexture: (name: string | null) => void;
}

/**
 * Bottom dock of Visual mode: every material (and texture) of the archive being looked at, as a
 * grid of thumbnails. With a surface selected and a slot active, clicking a material gives it to
 * that slot. The dock only browses and assigns; editing a material is Material mode's job.
 */
export function MaterialsDock({
  dock,
  tab,
  onChangeTab,
  archivePaths,
  scopePath,
  followingSurface,
  onSelectArchive,
  archive,
  archiveBytes,
  loading,
  textureRevision,
  modelFilter,
  currentMaterial,
  assigning,
  assigningLabel,
  onPickMaterial,
  browsedMaterial,
  selectedTexture,
  onSelectTexture,
}: MaterialsDockProps) {
  const [query, setQuery] = useState('');
  const [tileSize, setTileSize] = useState(readStoredTileSize);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(TILE_SIZE_STORAGE_KEY, String(tileSize));
    } catch {
      // A tile size is a preference; losing it is fine.
    }
  }, [tileSize]);

  const needle = query.trim().toLowerCase();
  const textureByName = useMemo(() => new Map((archive?.textures ?? []).map((texture) => [texture.name, texture])), [archive]);
  const models = useMemo(
    () => (archive?.models ?? []).filter((model) => modelFilter === null || model.name === modelFilter),
    [archive, modelFilter],
  );
  const showModelName = (archive?.models.length ?? 0) > 1 && modelFilter === null;

  const materialTiles = useMemo(() => {
    const out: Array<{ model: VisualModelInfo; material: VisualMaterialInfo }> = [];
    for (const model of models) {
      for (const material of model.materials) {
        if (needle) {
          const haystack = `${material.name} ${model.name} ${material.textures.join(' ')}`.toLowerCase();
          if (!haystack.includes(needle)) continue;
        }
        out.push({ model, material });
      }
    }
    return out;
  }, [models, needle]);
  const textureTiles = useMemo(
    () => (archive?.textures ?? []).filter((texture) => !needle || texture.name.toLowerCase().includes(needle)),
    [archive, needle],
  );

  const archiveLabel = scopePath ? describeVisualArchive(scopePath).label : '';
  const totalMaterials = models.reduce((sum, model) => sum + model.materials.length, 0);
  const count = tab === 'materials' ? materialTiles.length : textureTiles.length;
  const total = tab === 'materials' ? totalMaterials : (archive?.textures.length ?? 0);

  return (
    <section
      className={`contentBrowser visualDock${dock.open ? '' : ' collapsed'}${dock.resizing ? ' resizing' : ''}`}
      style={{ height: `${dock.open ? dock.height : dock.collapsedHeight}px`, '--tile-size': `${tileSize}px` } as CSSProperties}
      aria-label="Materials"
    >
      <div
        className="contentBrowserResizeHandle"
        onPointerDown={dock.onBeginResize}
        onDoubleClick={dock.onResetSize}
        role="separator"
        aria-label="Resize the materials browser"
        aria-orientation="horizontal"
        title="Drag to resize, double-click to reset"
      />
      <div className="browserHeader visualDockHeader">
        <Layers size={14} aria-hidden="true" className="browserHeaderIcon" />
        <Tabs
          label="What to browse"
          value={tab}
          variant="pill"
          options={[
            { value: 'materials', label: 'Materials', badge: totalMaterials || undefined },
            { value: 'textures', label: 'Textures', badge: archive?.textures.length || undefined },
          ]}
          onChange={(value) => onChangeTab(value as MaterialsDockTab)}
        />
        {dock.open && assigning && assigningLabel && (
          <span className="visualAssignHint" title="Click a material to give it to this slot">
            Pick a material for <b>{assigningLabel}</b>
          </span>
        )}
        <div className="browserHeaderActions">
          {dock.open && (
            <>
              <label className="visualArchiveSelect" title={followingSurface ? 'Showing the materials of the surface you clicked' : 'Which file to browse'}>
                <span className="uiVisuallyHidden">Archive</span>
                <select
                  value={scopePath ?? ''}
                  disabled={followingSurface || archivePaths.length === 0}
                  aria-label="Archive"
                  onChange={(event) => onSelectArchive(event.currentTarget.value)}
                >
                  {archivePaths.length === 0 && <option value="">No models</option>}
                  {followingSurface && scopePath && !archivePaths.includes(scopePath) && <option value={scopePath}>{archiveLabel}</option>}
                  {archivePaths.map((path) => (
                    <option key={path} value={path}>
                      {describeVisualArchive(path).label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="browserSearch">
                <Search size={13} aria-hidden="true" />
                <input
                  ref={searchRef}
                  className="browserSearchInput"
                  type="search"
                  placeholder={tab === 'materials' ? 'Search materials' : 'Search textures'}
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && query) {
                      event.preventDefault();
                      setQuery('');
                    }
                  }}
                  aria-label="Search"
                />
                {query && (
                  <button
                    type="button"
                    className="browserSearchClear"
                    aria-label="Clear search"
                    onClick={() => {
                      setQuery('');
                      searchRef.current?.focus();
                    }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <label className="browserTileSize" title="Tile size">
                <span className="uiVisuallyHidden">Tile size</span>
                <Box size={12} aria-hidden="true" />
                <input
                  type="range"
                  min={MIN_TILE_SIZE}
                  max={MAX_TILE_SIZE}
                  step={4}
                  value={tileSize}
                  aria-label="Tile size"
                  onChange={(event) => setTileSize(Number(event.currentTarget.value))}
                  onDoubleClick={() => setTileSize(DEFAULT_TILE_SIZE)}
                />
              </label>
            </>
          )}
          <IconButton
            size="sm"
            variant="ghost"
            icon={dock.open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            tooltip={dock.open ? 'Collapse materials' : 'Expand materials'}
            aria-label={dock.open ? 'Collapse materials' : 'Expand materials'}
            tooltipSide="top"
            className="collapseButton"
            onClick={dock.onToggleOpen}
          />
        </div>
      </div>

      {dock.open && (
        <div className="visualDockBody" role="tabpanel" aria-label={tab === 'materials' ? 'Materials' : 'Textures'}>
          <div className="assetStrip visualTileGrid" role="grid" aria-label={tab === 'materials' ? 'Materials' : 'Textures'}>
            {tab === 'materials' &&
              materialTiles.map(({ model, material }) => {
                const inUse = currentMaterial?.modelName === model.name && currentMaterial.materialIndex === material.index;
                const browsed = browsedMaterial?.modelName === model.name && browsedMaterial.materialIndex === material.index;
                const firstTexture = material.textures[0] ? (textureByName.get(material.textures[0]) ?? null) : null;
                return (
                  <button
                    key={`${model.name}/${material.index}`}
                    type="button"
                    className={`assetTile visualMaterialTile${inUse ? ' isInUse' : ''}${browsed && !assigning ? ' selected' : ''}`}
                    title={`${material.name}${material.textures.length ? ` — ${material.textures.join(', ')}` : ' — flat colour'}${assigning ? '\nClick to use this material' : ''}`}
                    onClick={() => onPickMaterial(model, material)}
                  >
                    <LazyTexture archivePath={archive?.path ?? ''} archiveBytes={archiveBytes} texture={firstTexture} revision={textureRevision} />
                    <strong>{material.name}</strong>
                    <span>{inUse ? 'In use' : showModelName ? model.name : archiveLabel}</span>
                  </button>
                );
              })}
            {tab === 'textures' &&
              textureTiles.map((texture) => (
                <button
                  key={texture.name}
                  type="button"
                  className={`assetTile visualMaterialTile${selectedTexture === texture.name ? ' selected' : ''}`}
                  title={`${texture.name} — ${texture.width}x${texture.height} ${texture.formatLabel}, ${formatByteSize(texture.byteLength)}`}
                  onClick={() => onSelectTexture(selectedTexture === texture.name ? null : texture.name)}
                >
                  <LazyTexture archivePath={archive?.path ?? ''} archiveBytes={archiveBytes} texture={texture} revision={textureRevision} />
                  <strong>{texture.name}</strong>
                  <span>
                    {texture.width}x{texture.height}
                  </span>
                </button>
              ))}

            {count === 0 && (
              <div className="browserEmpty">
                <EmptyState
                  size="sm"
                  icon={tab === 'materials' ? <Layers size={18} /> : <ImageIcon size={18} />}
                  title={query ? 'No matches' : loading ? 'Reading the file...' : tab === 'materials' ? 'No materials here' : 'No textures here'}
                  description={
                    query
                      ? `Nothing matches "${query}".`
                      : loading
                        ? 'This takes a moment for a big track.'
                        : archive?.error
                          ? `${archive.label} could not be read: ${archive.error}`
                          : total === 0
                            ? 'Open a track, or pick another file above.'
                            : undefined
                  }
                />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
