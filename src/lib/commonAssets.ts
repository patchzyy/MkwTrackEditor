// Common.szs (shared game object) archive assembly helpers. Extracted from src/ui/App.tsx.
import { buildPublicAssetUrl } from './assetPaths';
import { getObjFlowResourceNames, mergeCommonResourceEntries, parseCommonResourceArchive, type CommonResourceArchive } from './objflow';
import { parseU8 } from './u8';
import { featuredObjectIds } from '../ui/objects/objectCatalog';

export const bundledCourseObjectResourceNames = new Set(['castle_tree1.brres', 'castle_tree2.brres', 'choropu.brres', 'kinoko_lift1.brres', 'kuribo.brres', 'npc_mii_a.brres', 'pakkun_f.brres', 'pendulum.brres']);
export async function withBundledCourseObjectResources(common: CommonResourceArchive, allowedBaseNames?: Set<string>): Promise<CommonResourceArchive> {
  try {
    const basePath = buildPublicAssetUrl('data/MarioKartWii/Race/Course/Object/');
    const manifestResponse = await fetch(`${basePath}manifest.json`);
    if (!manifestResponse.ok) return common;
    const names = (await manifestResponse.json()) as string[];
    const filteredNames = allowedBaseNames?.size ? names.filter((name) => allowedBaseNames.has(toResourceBaseName(name))) : names;
    const entries = await Promise.all(
      filteredNames.map(async (name) => {
        const response = await fetch(`${basePath}${name}`);
        if (!response.ok) return null;
        return { path: `Object/${name}`, type: 'file' as const, data: new Uint8Array(await response.arrayBuffer()) };
      }),
    );
    return mergeCommonResourceEntries(common, entries.filter((entry): entry is NonNullable<(typeof entries)[number]> => entry !== null));
  } catch {
    return common;
  }
}

export async function withExtractedCourseAssetResources(common: CommonResourceArchive): Promise<CommonResourceArchive> {
  try {
    const response = await fetch(buildPublicAssetUrl('data/MarioKartWii/Race/Course/ExtractedAssets.u8'));
    if (!response.ok) return common;
    const entries = parseU8(new Uint8Array(await response.arrayBuffer())).filter((entry) => entry.type === 'file' && entry.data);
    return mergeCommonResourceEntries(common, entries);
  } catch {
    return common;
  }
}

export async function resolveCommonResourceArchive(bytes: Uint8Array, smokeMode: boolean): Promise<CommonResourceArchive> {
  const baseCommon = parseCommonResourceArchive(bytes);
  if (smokeMode) return withBundledCourseObjectResources(baseCommon, getSmokePreviewResourceNames(baseCommon.objFlow));
  return withExtractedCourseAssetResources(await withBundledCourseObjectResources(baseCommon));
}

export function getSmokePreviewResourceNames(objFlow: CommonResourceArchive['objFlow']): Set<string> {
  const out = new Set<string>();
  for (const objectId of featuredObjectIds) {
    const entry = objFlow.byId.get(objectId);
    if (!entry) continue;
    for (const resourceName of getObjFlowResourceNames(entry)) out.add(toResourceBaseName(resourceName));
  }
  return out;
}

export function toResourceBaseName(name: string): string {
  return name.trim().replace(/\.brres$/i, '').toLowerCase();
}

export function scoreCommonPreviewResource(entry: { path: string }, referencedResources: Set<string>): number {
  const baseName = entry.path.split('/').pop()?.toLowerCase() ?? '';
  return (bundledCourseObjectResourceNames.has(baseName) ? 4 : 0) + (entry.path.toLowerCase().includes('/course/object/') || entry.path.toLowerCase().startsWith('object/') ? 2 : 0) + (referencedResources.has(baseName) ? 1 : 0);
}
