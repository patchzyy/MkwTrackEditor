import { ChevronDown, ChevronUp } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { NoclipBrresSummary } from '../../lib/noclipBrres';
import type { CommonResourceArchive } from '../../lib/objflow';
import type { TrackDocument } from '../../lib/track';
import { describeBrres, describeCourseAsset, friendlySectionLabel, friendlyTrackAssetName } from '../labels';
import { browserObjectTitle, catalogId, objectAssetLabel } from '../objects/objectCatalog';
import { isCourseAssetBrowserItem, type BrowserFolder, type BrowserFolderId } from './browserFolders';
import { CourseAssetThumbnail } from './CourseAssetThumbnail';
import { ObjectThumbnail } from './ObjectThumbnail';

/** Bottom dock listing the placeable game objects, track records and archive assets. */
export function ContentBrowser({
  open,
  height,
  collapsedHeight,
  resizing,
  onBeginResize,
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
  return (
  <section
    className={`${open ? 'contentBrowser' : 'contentBrowser collapsed'}${resizing ? ' resizing' : ''}`}
    style={{ height: `${open ? height : collapsedHeight}px` }}
  >
    <div
      className="contentBrowserResizeHandle"
      onPointerDown={onBeginResize}
      role="separator"
      aria-label="Resize content browser"
      aria-orientation="horizontal"
    />
    <button className="collapseButton" onClick={onToggleOpen} aria-label={open ? 'Collapse content browser' : 'Expand content browser'}>
      {open ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
    </button>
    <div className="browserHeader">
      <strong>Content Browser</strong>
      <span>
        {filteredFolder
          ? `${filteredFolder.label} · ${filteredFolder.detail}`
          : track
            ? `${track.brresFiles.length} track asset files${objFlow ? ` · ${objFlow.entries.length} game objects` : ''}`
            : 'Load a track to list archive assets'}
      </span>
    </div>
    <div className="browserSearchRow">
      <input
        className="browserSearchInput"
        type="search"
        placeholder="Search this folder"
        value={query}
        onChange={(event) => onChangeQuery(event.currentTarget.value)}
        aria-label="Search content browser"
      />
    </div>
    <div className="browserFolders" role="tablist" aria-label="Content browser folders">
      {folders.map((folder) => (
        <button
          key={folder.id}
          type="button"
          className={folder.id === activeFolderId ? 'browserFolder active' : 'browserFolder'}
          onClick={() => onChangeFolder(folder.id)}
        >
          <strong>{folder.label}</strong>
          <span>{folder.detail}</span>
        </button>
      ))}
    </div>
    <div className="assetStrip">
      {filteredFolder?.kind === 'kmp' &&
        filteredFolder.items.map((item) => (
          <div className="assetTile" key={item.section} draggable onDragStart={(event) => event.dataTransfer.setData('application/mkw-point-section', item.section)}>
            <div className="thumbnail kmp">{friendlySectionLabel(item.section)}</div>
            <strong>{item.label}</strong>
            <span>{item.category}</span>
          </div>
        ))}
      {filteredFolder?.kind === 'object' &&
        filteredFolder.items.map((object) =>
          isCourseAssetBrowserItem(object) ? (
            <div
              className={object.objectId !== null ? 'assetTile' : 'assetTile disabled'}
              key={object.id}
              draggable={object.objectId !== null}
              onDragStart={(event) => {
                if (object.objectId !== null) event.dataTransfer.setData('application/mkw-object-id', String(object.objectId));
              }}
            >
              <CourseAssetThumbnail asset={object} summaries={commonBrresSummaries} />
              <strong>{object.objectLabel ?? object.baseName.replace(/\.brres$/i, '')}</strong>
              <span>{describeCourseAsset(object)}</span>
            </div>
          ) : (
            <div className="assetTile" key={catalogId(object)} draggable onDragStart={(event) => event.dataTransfer.setData('application/mkw-object-id', String(catalogId(object)))}>
              <ObjectThumbnail object={object} common={commonArchive} summaries={commonBrresSummaries} />
              <strong>{browserObjectTitle(object)}</strong>
              <span>{objectAssetLabel(object, commonArchive, commonBrresSummaries)}</span>
            </div>
          ),
        )}
      {filteredFolder?.kind === 'archiveNode' &&
        filteredFolder.items.map((node) => (
          <button
            className={node.id === selectedId ? 'assetTile selected' : 'assetTile'}
            key={node.id}
            type="button"
            onClick={() => onSelectArchiveNode(node.id)}
          >
            <div className="thumbnail brres">Node</div>
            <strong>{node.name}</strong>
            <span>{`${node.modelName} - ${friendlyTrackAssetName(node.archivePath)}`}</span>
          </button>
        ))}
      {filteredFolder?.kind === 'brres' &&
        filteredFolder.items.map((path) => (
          <div className="assetTile" key={path}>
            <div className="thumbnail brres">Asset</div>
            <strong>{friendlyTrackAssetName(path)}</strong>
            <span>{describeBrres(track?.brresSummaries[path]) || path}</span>
          </div>
        ))}
      {filteredFolder && filteredFolder.items.length === 0 && <p className="browserEmpty">No assets match this search.</p>}
    </div>
  </section>
  );
}
