import { Box, ChevronDown, ChevronUp, Flag, Folder, FolderOpen, Layers, Leaf, Search, Sparkles, Star, ToyBrick, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { NoclipBrresSummary } from '../../lib/noclipBrres';
import type { CommonResourceArchive } from '../../lib/objflow';
import type { TrackDocument } from '../../lib/track';
import { IconButton } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { describeBrres, describeCourseAsset, friendlySectionLabel, friendlyTrackAssetName } from '../labels';
import { browserObjectTitle, catalogId, objectAssetLabel } from '../objects/objectCatalog';
import { isCourseAssetBrowserItem, type BrowserFolder, type BrowserFolderId } from './browserFolders';
import { CourseAssetThumbnail } from './CourseAssetThumbnail';
import { ObjectThumbnail } from './ObjectThumbnail';

const TILE_SIZE_STORAGE_KEY = 'mkw.editor.browserTileSize.v1';
const MIN_TILE_SIZE = 96;
const MAX_TILE_SIZE = 200;
const DEFAULT_TILE_SIZE = 132;

const FOLDER_ICONS: Record<BrowserFolderId, ReactNode> = {
  featured: <Star size={14} />,
  kmp: <Flag size={14} />,
  enemies: <ToyBrick size={14} />,
  nature: <Leaf size={14} />,
  gameplay: <Sparkles size={14} />,
  props: <Box size={14} />,
  common: <Layers size={14} />,
  track: <Folder size={14} />,
  archiveNodes: <Layers size={14} />,
};

function readStoredTileSize(): number {
  if (typeof window === 'undefined') return DEFAULT_TILE_SIZE;
  const parsed = Number(window.localStorage.getItem(TILE_SIZE_STORAGE_KEY));
  return Number.isFinite(parsed) && parsed >= MIN_TILE_SIZE && parsed <= MAX_TILE_SIZE ? parsed : DEFAULT_TILE_SIZE;
}

/**
 * Bottom dock: a folder column on the left and a tile grid on the right, with a search box,
 * a tile-size slider and arrow-key navigation across the grid.
 *
 * Collapsed, only the header strip stays visible, so the toggle never reflows the viewport.
 */
export function ContentBrowser({
  open,
  height,
  collapsedHeight,
  resizing,
  onBeginResize,
  onResetSize,
  onToggleOpen,
  folders,
  activeFolderId,
  filteredFolder,
  query,
  onChangeQuery,
  onChangeFolder,
  track,
  objFlow,
  commonArchive,
  commonBrresSummaries,
  selectedId,
  onSelectArchiveNode,
}: {
  open: boolean;
  height: number;
  collapsedHeight: number;
  resizing: boolean;
  onBeginResize: (event: ReactPointerEvent<HTMLElement>) => void;
  onResetSize?: () => void;
  onToggleOpen: () => void;
  folders: BrowserFolder[];
  activeFolderId: BrowserFolderId | undefined;
  filteredFolder: BrowserFolder | null;
  query: string;
  onChangeQuery: (value: string) => void;
  onChangeFolder: (id: BrowserFolderId) => void;
  track: TrackDocument | null;
  objFlow: CommonResourceArchive['objFlow'] | null;
  commonArchive: CommonResourceArchive | null;
  commonBrresSummaries: Record<string, NoclipBrresSummary>;
  selectedId: string | null;
  onSelectArchiveNode: (nodeId: string) => void;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [tileSize, setTileSize] = useState(readStoredTileSize);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(TILE_SIZE_STORAGE_KEY, String(tileSize));
    } catch {
      // Ignore storage failures.
    }
  }, [tileSize]);

  const itemCount = filteredFolder ? filteredFolder.items.length : 0;
  const summary = useMemo(() => {
    if (filteredFolder) return `${filteredFolder.label} · ${filteredFolder.detail}`;
    if (track) return `${track.brresFiles.length} track asset files${objFlow ? ` · ${objFlow.entries.length} game objects` : ''}`;
    return 'Load a track to list archive assets';
  }, [filteredFolder, objFlow, track]);

  /** Left/right/up/down across the tile grid, using the rendered column count. */
  function handleGridKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const grid = gridRef.current;
    if (!grid) return;
    const tiles = Array.from(grid.querySelectorAll<HTMLElement>('.assetTile'));
    if (tiles.length === 0) return;
    const current = tiles.indexOf(document.activeElement as HTMLElement);
    const gridWidth = grid.clientWidth;
    const columns = Math.max(1, Math.floor(gridWidth / (tileSize + 8)));
    let next = current;
    if (event.key === 'ArrowRight') next = current + 1;
    else if (event.key === 'ArrowLeft') next = current - 1;
    else if (event.key === 'ArrowDown') next = current + columns;
    else if (event.key === 'ArrowUp') next = current - columns;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tiles.length - 1;
    if (next < 0 || next >= tiles.length) return;
    event.preventDefault();
    tiles[next].focus();
  }

  return (
    <section
      className={`${open ? 'contentBrowser' : 'contentBrowser collapsed'}${resizing ? ' resizing' : ''}`}
      style={{ height: `${open ? height : collapsedHeight}px`, '--tile-size': `${tileSize}px` } as React.CSSProperties}
      aria-label="Content browser"
    >
      <div
        className="contentBrowserResizeHandle"
        onPointerDown={onBeginResize}
        onDoubleClick={onResetSize}
        role="separator"
        aria-label="Resize content browser"
        aria-orientation="horizontal"
        title="Drag to resize · double-click to reset"
      />
      <div className="browserHeader">
        <FolderOpen size={14} aria-hidden="true" className="browserHeaderIcon" />
        <strong>Content Browser</strong>
        <span title={summary}>{summary}</span>
        <div className="browserHeaderActions">
          {open && (
            <>
              <div className="browserSearch">
                <Search size={13} aria-hidden="true" />
                <input
                  ref={searchRef}
                  className="browserSearchInput"
                  type="search"
                  placeholder="Search this folder"
                  value={query}
                  onChange={(event) => onChangeQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && query) {
                      event.preventDefault();
                      onChangeQuery('');
                    }
                  }}
                  aria-label="Search content browser"
                />
                {query && (
                  <button type="button" className="browserSearchClear" aria-label="Clear search" onClick={() => { onChangeQuery(''); searchRef.current?.focus(); }}>
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
            icon={open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            tooltip={open ? 'Collapse content browser' : 'Expand content browser'}
            aria-label={open ? 'Collapse content browser' : 'Expand content browser'}
            tooltipSide="top"
            className="collapseButton"
            onClick={onToggleOpen}
          />
        </div>
      </div>

      <div className="browserBody">
        <div className="browserFolders" role="tablist" aria-label="Content browser folders" aria-orientation="vertical">
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              role="tab"
              aria-selected={folder.id === activeFolderId}
              tabIndex={folder.id === activeFolderId ? 0 : -1}
              className={folder.id === activeFolderId ? 'browserFolder active' : 'browserFolder'}
              onClick={() => onChangeFolder(folder.id)}
            >
              {FOLDER_ICONS[folder.id] ?? <Folder size={14} />}
              <strong title={folder.label}>{folder.label}</strong>
              <span title={folder.detail}>{folder.detail}</span>
            </button>
          ))}
        </div>

        <div ref={gridRef} className="assetStrip" role="grid" aria-label={filteredFolder?.label ?? 'Assets'} onKeyDown={handleGridKeyDown}>
          {filteredFolder?.kind === 'kmp' &&
            filteredFolder.items.map((item) => (
              <div
                className="assetTile"
                key={item.section}
                tabIndex={0}
                role="gridcell"
                draggable
                title={`${item.label} — drag into the viewport to place`}
                onDragStart={(event) => event.dataTransfer.setData('application/mkw-point-section', item.section)}
              >
                <div className="thumbnail kmp">{friendlySectionLabel(item.section)}</div>
                <strong title={item.label}>{item.label}</strong>
                <span title={item.category}>{item.category}</span>
              </div>
            ))}

          {filteredFolder?.kind === 'object' &&
            filteredFolder.items.map((object) =>
              isCourseAssetBrowserItem(object) ? (
                <div
                  className={object.objectId !== null ? 'assetTile' : 'assetTile disabled'}
                  key={object.id}
                  tabIndex={0}
                  role="gridcell"
                  draggable={object.objectId !== null}
                  title={
                    object.objectId !== null
                      ? `${object.objectLabel ?? object.baseName} — drag into the viewport to place`
                      : `${object.baseName} has no placeable object id`
                  }
                  onDragStart={(event) => {
                    if (object.objectId !== null) event.dataTransfer.setData('application/mkw-object-id', String(object.objectId));
                  }}
                >
                  <CourseAssetThumbnail asset={object} summaries={commonBrresSummaries} />
                  <strong title={object.objectLabel ?? object.baseName}>{object.objectLabel ?? object.baseName.replace(/\.brres$/i, '')}</strong>
                  <span title={describeCourseAsset(object)}>{describeCourseAsset(object)}</span>
                </div>
              ) : (
                <div
                  className="assetTile"
                  key={catalogId(object)}
                  tabIndex={0}
                  role="gridcell"
                  draggable
                  title={`${browserObjectTitle(object)} — drag into the viewport to place`}
                  onDragStart={(event) => event.dataTransfer.setData('application/mkw-object-id', String(catalogId(object)))}
                >
                  <ObjectThumbnail object={object} common={commonArchive} summaries={commonBrresSummaries} />
                  <strong title={browserObjectTitle(object)}>{browserObjectTitle(object)}</strong>
                  <span title={objectAssetLabel(object, commonArchive, commonBrresSummaries)}>
                    {objectAssetLabel(object, commonArchive, commonBrresSummaries)}
                  </span>
                </div>
              ),
            )}

          {filteredFolder?.kind === 'archiveNode' &&
            filteredFolder.items.map((node) => (
              <button
                className={node.id === selectedId ? 'assetTile selected' : 'assetTile'}
                key={node.id}
                type="button"
                role="gridcell"
                title={`${node.name} — open in Model mode`}
                onClick={() => onSelectArchiveNode(node.id)}
              >
                <div className="thumbnail brres">Node</div>
                <strong title={node.name}>{node.name}</strong>
                <span title={`${node.modelName} - ${friendlyTrackAssetName(node.archivePath)}`}>
                  {`${node.modelName} - ${friendlyTrackAssetName(node.archivePath)}`}
                </span>
              </button>
            ))}

          {filteredFolder?.kind === 'brres' &&
            filteredFolder.items.map((path) => (
              <div className="assetTile" key={path} tabIndex={0} role="gridcell" title={path}>
                <div className="thumbnail brres">Asset</div>
                <strong title={friendlyTrackAssetName(path)}>{friendlyTrackAssetName(path)}</strong>
                <span title={describeBrres(track?.brresSummaries[path]) || path}>{describeBrres(track?.brresSummaries[path]) || path}</span>
              </div>
            ))}

          {filteredFolder && itemCount === 0 && (
            <div className="browserEmpty">
              <EmptyState
                size="sm"
                icon={<Search size={18} />}
                title={query ? 'No matches' : 'This folder is empty'}
                description={query ? `Nothing in ${filteredFolder.label} matches “${query}”.` : 'Load a track or import Common.szs to fill this folder.'}
              />
            </div>
          )}

          {!filteredFolder && (
            <div className="browserEmpty">
              <EmptyState size="sm" icon={<Folder size={18} />} title="No folder selected" description="Pick a folder on the left to browse its assets." />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
