// Course asset database (public/data/MarioKartWii/Race/Course/course-asset-db.json) types and
// helpers. Extracted from src/ui/App.tsx.
import { buildPublicAssetUrl } from './assetPaths';
import { getObjFlowResourceNames, type CommonResourceArchive } from './objflow';

export interface CourseAssetRecord {
  id: string;
  source: 'courseArchive' | 'sharedObjectDir';
  trackFile: string | null;
  trackLabel: string;
  path: string;
  baseName: string;
  kind: 'course' | 'skybox' | 'object' | 'sharedObject' | 'other';
}

export interface PlaceableCourseAssetRecord extends CourseAssetRecord {
  objectId: number | null;
  objectLabel: string | null;
}

export interface CourseAssetDatabase {
  generatedFrom: string;
  generatedAt: string;
  trackCount: number;
  assetCount: number;
  uniqueBaseNames: number;
  assets: CourseAssetRecord[];
}

export function mapCourseAssetToPlaceable(
  asset: CourseAssetRecord,
  objFlow: CommonResourceArchive['objFlow'] | null,
  resolveObjectLabel: (objectId: number) => string,
): PlaceableCourseAssetRecord {
  const objectId = findObjectIdForAsset(asset, objFlow);
  return {
    ...asset,
    objectId,
    objectLabel: objectId !== null ? resolveObjectLabel(objectId) : null,
  };
}

export function findObjectIdForAsset(asset: CourseAssetRecord, objFlow: CommonResourceArchive['objFlow'] | null): number | null {
  const baseName = asset.baseName.toLowerCase();
  for (const entry of objFlow?.entries ?? []) {
    const resources = getObjFlowResourceNames(entry).map((resource) => resource.toLowerCase());
    if (resources.includes(baseName)) return entry.objectId;
  }
  return null;
}

/** Loads the optional course asset database. Returns null when it is not bundled. */
export async function loadCourseAssetDatabase(): Promise<CourseAssetDatabase | null> {
  try {
    const response = await fetch(buildPublicAssetUrl('data/MarioKartWii/Race/Course/course-asset-db.json'));
    if (!response.ok) return null;
    return (await response.json()) as CourseAssetDatabase;
  } catch {
    // Keep the browser usable if the optional course asset database is absent.
    return null;
  }
}
