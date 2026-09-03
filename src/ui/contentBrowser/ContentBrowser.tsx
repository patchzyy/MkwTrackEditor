import {
  BookmarkPlus,
  Box,
  Boxes,
  ChevronDown,
  ChevronUp,
  Download,
  Flag,
  FolderOpen,
  Info,
  Leaf,
  Library,
  Package,
  Search,
  Shapes,
  Sparkles,
  Star,
  ToyBrick,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { NoclipBrresSummary } from '../../lib/noclipBrres';
import type { CommonResourceArchive } from '../../lib/objflow';
import type { TrackDocument } from '../../lib/track';
import { Button, IconButton } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { TreeView, type TreeNode } from '../components/TreeView';
import { browserEntryDrag, browserEntryFacts, browserEntryHint, browserFolderEntries, type BrowserEntry } from './browserEntries';
import { browserGroups, type BrowserFolder, type BrowserFolderId } from './browserFolders';
import { EntryThumbnail } from './EntryThumbnail';

const TILE_SIZE_STORAGE_KEY = 'mkw.editor.browserTileSize.v1';
const MIN_TILE_SIZE = 96;
const MAX_TILE_SIZE = 200;
const DEFAULT_TILE_SIZE = 132;

const FOLDER_ICONS: Record<BrowserFolderId, ReactNode> = {
  featured: <Star size={13} />,
  kmp: <Flag size={13} />,
  enemies: <ToyBrick size={13} />,
  nature: <Leaf size={13} />,
  gameplay: <Sparkles size={13} />,
  props: <Box size={13} />,
  common: <Shapes size={13} />,
  track: <Package size={13} />,
  library: <Library size={13} />,
};

/** What the browser can do to assets beyond dragging them into the viewport. */
export interface ContentBrowserActions {
  /** Adds `.brres` files to My Assets (the drop zone and the Import button call this). */
  importLibraryFiles: (files: File[]) => void;
  removeLibraryAsset: (id: string) => void;
  renameLibraryAsset: (id: string, name: string) => void;
  /** Downloads a library archive as it was imported. */
  exportLibraryAsset: (id: string) => void;
  /** Downloads a track archive, or one of its models as a standalone `.brres` when `modelName` is set. */
  exportTrackAsset: (path: string, modelName: string | null) => void;
  /** Copies a track archive, or one of its models, into My Assets. */
  saveTrackAssetToLibrary: (path: string, modelName: string | null) => void;
}

function dragHasFiles(event: ReactDragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types ?? []).includes('Files');
}

function readStoredTileSize(): number {
  if (typeof window === 'undefined') return DEFAULT_TILE_SIZE;
  const parsed = Number(window.localStorage.getItem(TILE_SIZE_STORAGE_KEY));
  return Number.isFinite(parsed) && parsed >= MIN_TILE_SIZE && parsed <= MAX_TILE_SIZE ? parsed : DEFAULT_TILE_SIZE;
}

/**
 * Bottom dock: a folder tree on the left, a tile grid in the middle and a details pane on
 * the right, with a search box, a tile-size slider and arrow-key navigation across the grid.
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
  commonArchive,
  commonBrresSummaries,
  actions,
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
  commonArchive: CommonResourceArchive | null;
  commonBrresSummaries: Record<string, NoclipBrresSummary>;
  /** Import / export / remove. Without it the browser is read-only. */
  actions?: ContentBrowserActions;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [tileSize, setTileSize] = useState(readStoredTileSize);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  /** `.brres` files dragged from the desktop land in My Assets, wherever they are dropped. */
  function handleFileDragOver(event: ReactDragEvent<HTMLElement>) {
    if (!actions || !dragHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    if (!dropping) setDropping(true);
  }
  function handleFileDragLeave(event: ReactDragEvent<HTMLElement>) {
    if (!dropping) return;
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setDropping(false);
  }
  function handleFileDrop(event: ReactDragEvent<HTMLElement>) {
    if (!actions || !dragHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropping(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) actions.importLibraryFiles(files);
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(TILE_SIZE_STORAGE_KEY, String(tileSize));
    } catch {
      // Ignore storage failures; tile size is a preference, not state.
    }
  }, [tileSize]);

  const thumbnailContext = useMemo(
    () => ({ track, commonArchive, commonBrresSummaries }),
    [commonArchive, commonBrresSummaries, track],
  );
  const entries = useMemo(() => browserFolderEntries(filteredFolder, thumbnailContext), [filteredFolder, thumbnailContext]);
  const details = useMemo(() => entries.find((entry) => entry.id === detailsId) ?? entries[0] ?? null, [detailsId, entries]);
  const detailFacts = useMemo(() => (details ? browserEntryFacts(details, thumbnailContext) : []), [details, thumbnailContext]);

  // Folder tree: the three top-level groups, each with the folders that currently exist.
  const treeNodes = useMemo<TreeNode<BrowserFolderId>[]>(
    () =>
      browserGroups
        .map((group) => ({
          id: `group:${group.id}`,
          label: group.label,
          children: folders
            .filter((folder) => folder.group === group.id)
            .map((folder) => ({
              id: folder.id,
              label: folder.label,
              detail: String(folder.items.length),
              icon: FOLDER_ICONS[folder.id],
              data: folder.id,
            })),
        }))
        .filter((group) => group.children.length > 0),
    [folders],
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(browserGroups.map((group) => `group:${group.id}`)));

  const summary = useMemo(() => {
    if (filteredFolder) return `${filteredFolder.label} - ${filteredFolder.detail}`;
    if (track) return 'Pick a folder to browse this track and the shared game objects';
    return 'Open a track to browse its assets';
  }, [filteredFolder, track]);

  /** Left/right/up/down across the tile grid, using the rendered column count. */
  function handleGridKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const grid = gridRef.current;
    if (!grid) return;
    const tiles = Array.from(grid.querySelectorAll<HTMLElement>('.assetTile'));
    if (tiles.length === 0) return;
    const current = tiles.indexOf(document.activeElement as HTMLElement);
    const columns = Math.max(1, Math.floor(grid.clientWidth / (tileSize + 8)));
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

  function renderTile(entry: BrowserEntry) {
    const drag = browserEntryDrag(entry);
    const hint = browserEntryHint(entry);
    return (
      <div
        className={`assetTile${drag ? '' : ' disabled'}${entry.id === details?.id ? ' selected' : ''}`}
        key={entry.id}
        tabIndex={0}
        role="gridcell"
        aria-label={hint}
        title={hint}
        draggable={drag !== null}
        onFocus={() => setDetailsId(entry.id)}
        onClick={() => setDetailsId(entry.id)}
        onDragStart={(event) => {
          if (!drag) return;
          event.dataTransfer.setData(drag.type, drag.value);
          event.dataTransfer.effectAllowed = 'copy';
        }}
      >
        <EntryThumbnail entry={entry} common={commonArchive} summaries={commonBrresSummaries} track={track} />
        <strong title={entry.label}>{entry.label}</strong>
        <span title={entry.caption}>{entry.caption}</span>
      </div>
    );
  }

  return (
    <section
      className={`${open ? 'contentBrowser' : 'contentBrowser collapsed'}${resizing ? ' resizing' : ''}${dropping ? ' dropping' : ''}`}
      style={{ height: `${open ? height : collapsedHeight}px`, '--tile-size': `${tileSize}px` } as React.CSSProperties}
      aria-label="Content browser"
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {dropping && (
        <div className="browserDropOverlay" aria-hidden="true">
          <Upload size={22} />
          <strong>Drop .brres files to add them to My Assets</strong>
        </div>
      )}
      {actions && (
        <input
          ref={fileInputRef}
          type="file"
          accept=".brres"
          multiple
          hidden
          aria-label="Import .brres files"
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
            if (files.length > 0) actions.importLibraryFiles(files);
          }}
        />
      )}
      <div
        className="contentBrowserResizeHandle"
        onPointerDown={onBeginResize}
        onDoubleClick={onResetSize}
        role="separator"
        aria-label="Resize content browser"
        aria-orientation="horizontal"
        title="Drag to resize, double-click to reset"
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
                  <button
                    type="button"
                    className="browserSearchClear"
                    aria-label="Clear search"
                    onClick={() => {
                      onChangeQuery('');
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
              {actions && (
                <IconButton
                  size="sm"
                  variant="ghost"
                  icon={<Upload size={16} />}
                  tooltip="Import .brres files into My Assets"
                  aria-label="Import .brres files into My Assets"
                  tooltipSide="top"
                  className="browserImportButton"
                  onClick={() => fileInputRef.current?.click()}
                />
              )}
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
        <TreeView
          className="browserFolders"
          label="Content browser folders"
          nodes={treeNodes}
          selectedId={activeFolderId ?? null}
          expandedIds={expandedGroups}
          onChangeExpanded={setExpandedGroups}
          emptyMessage="Open a track to fill these folders."
          onSelect={(id, node) => {
            if (node.data) onChangeFolder(node.data);
          }}
        />

        <div ref={gridRef} className="assetStrip" role="grid" aria-label={filteredFolder?.label ?? 'Assets'} onKeyDown={handleGridKeyDown}>
          {entries.map((entry) => renderTile(entry))}

          {filteredFolder && entries.length === 0 && filteredFolder.kind === 'library' && !query && (
            <div className="browserEmpty browserEmpty--library" data-testid="library-empty">
              <EmptyState
                size="sm"
                icon={<Library size={18} />}
                title="No custom models yet"
                description="Drop .brres files anywhere on the content browser. They stay in this browser, ready to drag onto any track."
                action={
                  actions ? (
                    <Button size="sm" icon={<Upload size={14} />} onClick={() => fileInputRef.current?.click()}>
                      Import .brres files
                    </Button>
                  ) : undefined
                }
              />
            </div>
          )}

          {filteredFolder && entries.length === 0 && (filteredFolder.kind !== 'library' || query) && (
            <div className="browserEmpty">
              <EmptyState
                size="sm"
                icon={<Search size={18} />}
                title={query ? 'No matches' : 'This folder is empty'}
                description={
                  query
                    ? `Nothing in ${filteredFolder.label} matches "${query}".`
                    : 'Open a track, or import Common.szs from the File menu, to fill this folder.'
                }
              />
            </div>
          )}

          {!filteredFolder && (
            <div className="browserEmpty">
              <EmptyState size="sm" icon={<Boxes size={18} />} title="No folder selected" description="Pick a folder on the left to browse its assets." />
            </div>
          )}
        </div>

        <aside className="browserDetails" aria-label="Asset details">
          {details ? (
            <>
              <EntryThumbnail entry={details} common={commonArchive} summaries={commonBrresSummaries} track={track} size="large" />
              <h3 className="browserDetailsTitle" title={details.label}>
                {details.label}
              </h3>
              <p className="browserDetailsCaption">{details.caption}</p>
              <dl className="browserDetailsFacts">
                {detailFacts.map((fact) => (
                  <div className="browserDetailsFact" key={`${fact.label}-${fact.value}`}>
                    <dt>{fact.label}</dt>
                    <dd title={fact.value}>{fact.value}</dd>
                  </div>
                ))}
              </dl>
              {actions && details.kind === 'libraryAsset' && (
                <div className="browserDetailsActions" data-testid="library-actions">
                  <label className="browserRename">
                    <span>Name</span>
                    <input
                      key={details.asset.id}
                      className="browserRenameInput"
                      type="text"
                      defaultValue={details.asset.name}
                      aria-label="Model name"
                      onBlur={(event) => actions.renameLibraryAsset(details.asset.id, event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') {
                          event.currentTarget.value = details.asset.name;
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </label>
                  <div className="browserDetailsButtons">
                    <Button size="sm" icon={<Download size={14} />} onClick={() => actions.exportLibraryAsset(details.asset.id)}>
                      Export .brres
                    </Button>
                    <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => actions.removeLibraryAsset(details.asset.id)}>
                      Remove
                    </Button>
                  </div>
                </div>
              )}
              {actions && details.kind === 'trackAsset' && (
                <div className="browserDetailsActions" data-testid="track-asset-actions">
                  {(track?.brresSummaries[details.path]?.models ?? []).length > 0 && (
                    <ul className="browserDetailsModels" aria-label="Models in this archive">
                      {(track?.brresSummaries[details.path]?.models ?? []).map((model) => (
                        <li className="browserDetailsModelRow" key={model.name}>
                          <span title={model.name}>{model.name}</span>
                          <IconButton
                            size="sm"
                            variant="ghost"
                            icon={<Download size={14} />}
                            tooltip="Export this model as its own .brres"
                            aria-label={`Export ${model.name} as .brres`}
                            onClick={() => actions.exportTrackAsset(details.path, model.name)}
                          />
                          <IconButton
                            size="sm"
                            variant="ghost"
                            icon={<BookmarkPlus size={14} />}
                            tooltip="Save this model to My Assets"
                            aria-label={`Save ${model.name} to My Assets`}
                            onClick={() => actions.saveTrackAssetToLibrary(details.path, model.name)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="browserDetailsButtons">
                    <Button size="sm" icon={<Download size={14} />} onClick={() => actions.exportTrackAsset(details.path, null)}>
                      Export archive
                    </Button>
                    <Button size="sm" icon={<BookmarkPlus size={14} />} onClick={() => actions.saveTrackAssetToLibrary(details.path, null)}>
                      Save to My Assets
                    </Button>
                  </div>
                </div>
              )}
              {browserEntryDrag(details) ? (
                <p className="browserDetailsHint">Drag the tile into the viewport to place it.</p>
              ) : (
                <p className="browserDetailsHint browserDetailsHint--muted">This asset cannot be placed directly.</p>
              )}
            </>
          ) : (
            <EmptyState size="sm" icon={<Info size={18} />} title="No asset selected" description="Pick a tile to see what it contains." />
          )}
        </aside>
      </div>
    </section>
  );
}
