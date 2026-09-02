export interface BrowserPlaceableCourseAsset {
  objectId: number | null;
  baseName: string;
  path: string;
  trackLabel: string;
  trackFile: string | null;
  source: string;
  kind: string;
}

export function dedupePlaceableCourseAssetsForBrowser<T extends BrowserPlaceableCourseAsset>(
  assets: T[],
  visibleObjectIds: ReadonlySet<number> = new Set(),
): T[] {
  const deduped = new Map<string, T>();
  for (const asset of assets) {
    if (asset.objectId !== null && visibleObjectIds.has(asset.objectId)) continue;
    const key = asset.objectId !== null ? `object:${asset.objectId}` : `asset:${asset.baseName.toLowerCase()}`;
    const current = deduped.get(key);
    if (!current || comparePlaceableCourseAssetPriority(asset, current) < 0) deduped.set(key, asset);
  }
  return [...deduped.values()];
}

export function comparePlaceableCourseAssetPriority(a: BrowserPlaceableCourseAsset, b: BrowserPlaceableCourseAsset): number {
  const scoreA = scorePlaceableCourseAssetPriority(a);
  const scoreB = scorePlaceableCourseAssetPriority(b);
  if (scoreA !== scoreB) return scoreB - scoreA;
  return a.baseName.localeCompare(b.baseName) || a.trackLabel.localeCompare(b.trackLabel) || a.path.localeCompare(b.path);
}

function scorePlaceableCourseAssetPriority(asset: BrowserPlaceableCourseAsset): number {
  return (
    (asset.objectId !== null ? 16 : 0) +
    (asset.source === 'sharedObjectDir' ? 8 : 0) +
    (asset.kind === 'sharedObject' ? 4 : 0) +
    (asset.kind === 'object' ? 2 : 0) +
    (asset.trackFile === null ? 1 : 0)
  );
}
