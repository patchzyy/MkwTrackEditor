import { mapCourseAssetToPlaceable, type CourseAssetDatabase, type PlaceableCourseAssetRecord } from '../../lib/courseAssets';
import type { AppendableKmpSection } from '../../lib/kmp';
import type { CommonResourceArchive } from '../../lib/objflow';
import type { TrackDocument } from '../../lib/track';
import { friendlyTrackAssetName } from '../labels';
import {
  browserObjectTitle,
  catalogId,
  countAvailableResources,
  isBrowsableObjectEntry,
  isFeaturedObject,
  objectCatalog,
  objectSearchText,
  type BrowserObject,
} from '../objects/objectCatalog';
import { comparePlaceableCourseAssetPriority, dedupePlaceableCourseAssetsForBrowser } from './browserAssetDedupe';

export type BrowserAssetItem = BrowserObject | PlaceableCourseAssetRecord;
export type BrowserFolderId = 'featured' | 'kmp' | 'enemies' | 'nature' | 'gameplay' | 'props' | 'common' | 'track';

/** Top level of the folder tree. Folders hang off one of these. */
export type BrowserGroupId = 'objects' | 'trackData' | 'thisTrack';

export interface BrowserGroup {
  id: BrowserGroupId;
  label: string;
}

/** Root folders, in the order the tree shows them. */
export const browserGroups: readonly BrowserGroup[] = [
  { id: 'objects', label: 'Game Objects' },
  { id: 'trackData', label: 'Track Data' },
  { id: 'thisTrack', label: 'This Track' },
];

interface BrowserFolderBase {
  id: BrowserFolderId;
  group: BrowserGroupId;
  label: string;
  detail: string;
}

export type BrowserFolder =
  | (BrowserFolderBase & { kind: 'kmp'; items: typeof kmpPointCatalog })
  | (BrowserFolderBase & { kind: 'object'; items: BrowserAssetItem[] })
  | (BrowserFolderBase & { kind: 'brres'; items: string[] });

export const kmpPointCatalog: Array<{ section: AppendableKmpSection; label: string; category: string }> = [
  { section: 'KTPT', label: 'Start Point', category: 'Track Data' },
  { section: 'ENPT', label: 'Enemy Route Node', category: 'Routes' },
  { section: 'ITPT', label: 'Item Route Node', category: 'Routes' },
  { section: 'CKPT', label: 'Checkpoint Pair', category: 'Routes' },
  { section: 'POTI', label: 'Movement Route', category: 'Routes' },
  { section: 'CAME', label: 'Camera', category: 'Camera' },
  { section: 'AREA', label: 'Area Trigger', category: 'Gameplay' },
  { section: 'JGPT', label: 'Respawn Point', category: 'Gameplay' },
  { section: 'CNPT', label: 'Cannon Point', category: 'Gameplay' },
  { section: 'MSPT', label: 'Battle Finish Point', category: 'Battle' },
];

export function classifyObjectFolder(object: BrowserAssetItem): Exclude<BrowserFolderId, 'featured' | 'kmp' | 'common' | 'track'> {
  const text = browserItemSearchText(object);
  if (/(kuribo|goomba|choropu|pakkun|killer|wanwan|heyho|nokonoko|koopa|sanbo|crab|fish|enemy|boss)/.test(text)) return 'enemies';
  if (/(tree|wood|bush|grass|flower|plant|leaf|palm|forest|kinoko|mushroom|cactus)/.test(text)) return 'nature';
  if (/(item|lift|cannon|route|switch|gear|pendulum|flipper|jump|belt|panel|launcher|goal|sound|effect)/.test(text)) return 'gameplay';
  return 'props';
}

export function isCourseAssetBrowserItem(object: BrowserAssetItem): object is PlaceableCourseAssetRecord {
  return 'trackLabel' in object;
}

export function browserItemSearchText(object: BrowserAssetItem): string {
  if (isCourseAssetBrowserItem(object)) {
    return [object.objectLabel ?? object.baseName.replace(/\.brres$/i, ''), object.trackLabel, object.path, object.kind]
      .join(' ')
      .toLowerCase();
  }
  return objectSearchText(object);
}

/** Resolves the friendly display name for a GOBJ object id using the loaded ObjFlow table. */
export function objectTitleForId(objFlow: CommonResourceArchive['objFlow'] | null, objectId: number): string {
  const entry = objFlow?.byId.get(objectId);
  return browserObjectTitle({ objectId, name: entry?.name ?? '', resources: entry?.resources ?? '' });
}

export function filterBrowserFolder(folder: BrowserFolder | null, query: string): BrowserFolder | null {
  if (!folder) return null;
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return folder;
  if (folder.kind === 'kmp') {
    const items = folder.items.filter((item) => `${item.label} ${item.section} ${item.category}`.toLowerCase().includes(trimmed));
    return { ...folder, detail: `${items.length} matching records`, items };
  }
  if (folder.kind === 'object') {
    const items = folder.items.filter((item) => browserItemSearchText(item).includes(trimmed));
    return { ...folder, detail: `${items.length} matching objects`, items };
  }
  const items = folder.items.filter((item) => item.toLowerCase().includes(trimmed));
  return { ...folder, detail: `${items.length} matching track asset files`, items };
}

/** Builds the content browser's folder model from the loaded track and shared game assets. */
export function buildBrowserFolders({
  track,
  objFlow,
  commonArchive,
  courseAssetDb,
}: {
  track: TrackDocument | null;
  objFlow: CommonResourceArchive['objFlow'] | null;
  commonArchive: CommonResourceArchive | null;
  courseAssetDb: CourseAssetDatabase | null;
}): BrowserFolder[] {
  const realObjectCatalog = objFlow
    ? objFlow.entries
        .filter((entry) => entry.name || entry.resources)
        .filter((entry) => isBrowsableObjectEntry(entry))
        .sort((a, b) => countAvailableResources(b, commonArchive) - countAvailableResources(a, commonArchive))
        .slice(0, 180)
    : [];
  const objects: BrowserObject[] = (realObjectCatalog.length ? realObjectCatalog : objectCatalog).filter(
    (object, index, list) => index === list.findIndex((candidate) => catalogId(candidate) === catalogId(object)),
  );
  const placeableCourseAssets = dedupePlaceableCourseAssetsForBrowser(
    courseAssetDb?.assets
      .filter((asset) => asset.kind === 'object' || asset.kind === 'sharedObject')
      .map((asset) => mapCourseAssetToPlaceable(asset, objFlow, (objectId) => objectTitleForId(objFlow, objectId))) ?? [],
    new Set(objects.map((object) => catalogId(object))),
  ).sort((a, b) => comparePlaceableCourseAssetPriority(a, b));
  const featured = objects.filter((object) => isFeaturedObject(object)).slice(0, 18);
  const enemies = [...objects.filter((object) => classifyObjectFolder(object) === 'enemies'), ...placeableCourseAssets.filter((asset) => classifyObjectFolder(asset) === 'enemies')].slice(0, 72);
  const nature = [...objects.filter((object) => classifyObjectFolder(object) === 'nature'), ...placeableCourseAssets.filter((asset) => classifyObjectFolder(asset) === 'nature')].slice(0, 72);
  const gameplay = [...objects.filter((object) => classifyObjectFolder(object) === 'gameplay'), ...placeableCourseAssets.filter((asset) => classifyObjectFolder(asset) === 'gameplay')].slice(0, 72);
  const props = [...objects.filter((object) => classifyObjectFolder(object) === 'props'), ...placeableCourseAssets.filter((asset) => classifyObjectFolder(asset) === 'props')].slice(0, 72);
  const common = [...objects, ...placeableCourseAssets].slice(0, 240);
  const trackAssets = track?.brresFiles.slice(0, 48) ?? [];
  const folders: BrowserFolder[] = [
    { id: 'featured', group: 'objects', label: 'Favourites', detail: `${featured.length} highlighted objects`, kind: 'object', items: featured },
    { id: 'enemies', group: 'objects', label: 'Enemies', detail: `${enemies.length} common enemies`, kind: 'object', items: enemies },
    { id: 'nature', group: 'objects', label: 'Nature', detail: `${nature.length} trees and foliage`, kind: 'object', items: nature },
    { id: 'gameplay', group: 'objects', label: 'Gameplay', detail: `${gameplay.length} interactive objects`, kind: 'object', items: gameplay },
    { id: 'props', group: 'objects', label: 'Scenery', detail: `${props.length} props and structures`, kind: 'object', items: props },
    { id: 'common', group: 'objects', label: 'All objects', detail: `${common.length} placeable game objects`, kind: 'object', items: common },
    { id: 'kmp', group: 'trackData', label: 'Points and routes', detail: `${kmpPointCatalog.length} editable track records`, kind: 'kmp', items: kmpPointCatalog },
    { id: 'track', group: 'thisTrack', label: 'Track meshes', detail: track ? `${trackAssets.length} track asset files` : 'Load a track to list track assets', kind: 'brres', items: trackAssets },
  ];
  return folders.filter((folder) => folder.items.length > 0 || folder.id === 'track');
}
