import { Flag, Package } from 'lucide-react';
import type { NoclipBrresSummary } from '../../lib/noclipBrres';
import type { CommonResourceArchive } from '../../lib/objflow';
import type { TrackDocument } from '../../lib/track';
import { Skeleton } from '../components/EmptyState';
import { shortAssetName } from '../labels';
import { firstResourceSummary, objectResources } from '../objects/objectCatalog';
import type { BrowserEntry } from './browserEntries';

/**
 * The preview square for one content-browser entry.
 *
 * Object and course-asset entries show the real-renderer thumbnail baked by
 * `src/lib/thumbnail`; while a model is known but its preview has not been rendered yet a
 * skeleton is shown rather than the "no model" placeholder, so tiles never flicker between
 * two different empty looks.
 */
export function EntryThumbnail({
  entry,
  common,
  summaries,
  track,
  size = 'tile',
}: {
  entry: BrowserEntry;
  common: CommonResourceArchive | null;
  summaries: Record<string, NoclipBrresSummary>;
  /** Supplies the previews for the loaded track's own asset archives. */
  track?: TrackDocument | null;
  size?: 'tile' | 'large';
}) {
  const className = size === 'large' ? 'thumbnail thumbnailLarge' : 'thumbnail';

  if (entry.kind === 'point') {
    return (
      <div className={`${className} kmp`} data-state="available">
        <Flag size={size === 'large' ? 28 : 20} aria-hidden="true" />
      </div>
    );
  }

  if (entry.kind === 'trackAsset' || entry.kind === 'libraryAsset') {
    // The track's own archives are summarised on load and library assets are rendered when
    // they are imported, so both already have a real render when one could be made.
    const previewDataUrl = entry.kind === 'trackAsset' ? track?.brresSummaries[entry.path]?.previewDataUrl : entry.asset.thumbnail;
    if (previewDataUrl) {
      return (
        <div className={`${className} objectPreview`} data-state="available" data-preview="image">
          <img src={previewDataUrl} alt="" loading="lazy" decoding="async" />
        </div>
      );
    }
    return (
      <div className={`${className} brres`} data-state="available">
        <Package size={size === 'large' ? 28 : 20} aria-hidden="true" />
      </div>
    );
  }

  const resources = entry.kind === 'object' ? objectResources(entry.object) : [entry.asset.baseName];
  const summary = entry.kind === 'object' ? firstResourceSummary(resources, summaries) : summaries[entry.asset.baseName.toLowerCase()];
  const hasModel =
    entry.kind === 'object' ? resources.some((resource) => common?.byBaseName.has(resource.toLowerCase())) : entry.objectId !== null;
  const pending = hasModel && !summary;
  const fallbackName = shortAssetName(resources[0] ?? entry.label);

  return (
    <div
      className={`${className} objectPreview`}
      data-state={hasModel ? 'available' : 'missing'}
      data-preview={summary?.previewDataUrl ? 'image' : 'fallback'}
    >
      {summary?.previewDataUrl && <img src={summary.previewDataUrl} alt="" loading="lazy" decoding="async" />}
      {pending && <Skeleton className="thumbnailSkeleton" />}
      {!summary?.previewDataUrl && !pending && (
        <>
          <span className="previewModel">{summary ? `${summary.models.length} models` : fallbackName}</span>
          <span className="previewStack" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </>
      )}
    </div>
  );
}
