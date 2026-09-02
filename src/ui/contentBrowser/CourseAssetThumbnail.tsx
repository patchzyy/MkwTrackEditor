import type { PlaceableCourseAssetRecord } from '../../lib/courseAssets';
import type { NoclipBrresSummary } from '../../lib/noclipBrres';
import { shortAssetName } from '../labels';

export function CourseAssetThumbnail({ asset, summaries }: { asset: PlaceableCourseAssetRecord; summaries: Record<string, NoclipBrresSummary> }) {
  const summary = summaries[asset.baseName.toLowerCase()];
  return (
    <div className="thumbnail objectPreview" data-state={asset.objectId !== null ? 'available' : 'missing'} data-preview={summary?.previewDataUrl ? 'image' : 'fallback'}>
      {summary?.previewDataUrl && <img src={summary.previewDataUrl} alt="" />}
      {!summary?.previewDataUrl && <span className="previewModel">{summary ? `${summary.models.length} models · ${summary.textures.length} textures` : shortAssetName(asset.baseName)}</span>}
      {!summary?.previewDataUrl && (
        <span className="previewStack" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}
