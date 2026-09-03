import type { NoclipBrresSummary } from '../../lib/noclipBrres';
import type { CommonResourceArchive, ObjFlowEntry } from '../../lib/objflow';
import { Skeleton } from '../components/EmptyState';
import { shortAssetName } from '../labels';
import { firstResourceSummary, objectCatalog, objectResources } from '../objects/objectCatalog';

export function ObjectThumbnail({
  object,
  common,
  summaries,
}: {
  object: (typeof objectCatalog)[number] | ObjFlowEntry;
  common: CommonResourceArchive | null;
  summaries: Record<string, NoclipBrresSummary>;
}) {
  const resources = objectResources(object);
  const primaryResource = resources[0] ?? ('resources' in object ? object.resources : object.label);
  const hasModel = resources.some((resource) => common?.byBaseName.has(resource.toLowerCase()));
  const summary = firstResourceSummary(resources, summaries);
  // The model exists but its preview has not been rendered yet: show a skeleton rather than
  // the "no model" placeholder, so tiles do not flicker between two different empty looks.
  const pending = hasModel && !summary;
  return (
    <div className="thumbnail objectPreview" data-state={hasModel ? 'available' : 'missing'} data-preview={summary?.previewDataUrl ? 'image' : 'fallback'}>
      {summary?.previewDataUrl && <img src={summary.previewDataUrl} alt="" loading="lazy" decoding="async" />}
      {pending && <Skeleton className="thumbnailSkeleton" />}
      {!summary?.previewDataUrl && !pending && (
        <span className="previewModel">{summary ? `${summary.models.length} models · ${summary.textures.length} textures` : shortAssetName(primaryResource)}</span>
      )}
      {!summary?.previewDataUrl && !pending && (
        <span className="previewStack" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}
