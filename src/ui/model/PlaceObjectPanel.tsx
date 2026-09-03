import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { CommonResourceArchive } from '../../lib/objflow';
import { browserObjectTitle } from '../objects/objectCatalog';

export interface PlaceableModelAsset {
  /** Key the exporter uses to find the bytes again; the archive-relative file name. */
  sourcePath: string;
  label: string;
  detail: string;
  data: Uint8Array;
}

/**
 * Every object model the editor already has in memory, offered as scenery to drop into the
 * course model. The list comes from the shared object archive, so it needs no extra loading and
 * the bytes are exactly what the exporter will merge.
 */
export function collectPlaceableModels(common: CommonResourceArchive | null): PlaceableModelAsset[] {
  if (!common) return [];
  const objectNameByResource = new Map<string, string>();
  for (const entry of common.objFlow.entries) {
    for (const resource of entry.resources.split(/[,\s]+/)) {
      const name = resource.trim().toLowerCase();
      if (!name) continue;
      const title = browserObjectTitle({ objectId: entry.objectId, name: entry.name, resources: entry.resources });
      if (!objectNameByResource.has(`${name}.brres`)) objectNameByResource.set(`${name}.brres`, title);
    }
  }

  const assets: PlaceableModelAsset[] = [];
  for (const [baseName, entry] of common.byBaseName) {
    if (!baseName.endsWith('.brres') || !entry.data) continue;
    const fileName = entry.path.split('/').pop() ?? baseName;
    assets.push({
      sourcePath: fileName,
      label: objectNameByResource.get(baseName) ?? fileName.replace(/\.brres$/i, ''),
      detail: fileName,
      data: entry.data,
    });
  }
  return assets.sort((a, b) => a.label.localeCompare(b.label) || a.detail.localeCompare(b.detail));
}

/**
 * The picker itself. Shown over the viewport so the user can see where the object will land.
 */
export function PlaceObjectPanel({
  assets,
  onPlace,
  onClose,
}: {
  assets: PlaceableModelAsset[];
  onPlace: (asset: PlaceableModelAsset) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? assets.filter((asset) => asset.label.toLowerCase().includes(needle) || asset.detail.toLowerCase().includes(needle))
      : assets;
    return matches.slice(0, 200);
  }, [assets, query]);

  return (
    <div className="viewportOverlayPanel modelPlacePanel">
      <div className="viewportOverlayHeader">
        <strong>Place as scenery</strong>
        <button className="iconButton" type="button" onClick={onClose} aria-label="Close the object picker" title="Close">
          <X size={16} />
        </button>
      </div>
      <span className="viewportOverlayDetail">
        {assets.length === 0
          ? 'Load the shared object archive to place objects.'
          : 'The model is merged into the track geometry, so it shows up in game without a KMP object.'}
      </span>
      <input
        className="modelOutlinerSearch"
        type="search"
        placeholder="Search objects"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
      />
      <ul className="modelPlaceList">
        {filtered.map((asset) => (
          <li key={asset.sourcePath}>
            <button type="button" className="modelPlaceItem" onClick={() => onPlace(asset)}>
              <span className="modelOutlinerName">{asset.label}</span>
              <span className="modelOutlinerMeta">{asset.detail}</span>
            </button>
          </li>
        ))}
      </ul>
      {filtered.length === 0 && assets.length > 0 && <span className="viewportOverlayHint">Nothing matches that search.</span>}
    </div>
  );
}
