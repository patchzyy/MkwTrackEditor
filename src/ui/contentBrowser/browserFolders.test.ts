import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCommonResourceArchive, type CommonResourceArchive, type ObjFlowTable } from '../../lib/objflow';
import type { TrackDocument } from '../../lib/track';
import { isBrowsableObjectEntry } from '../objects/objectCatalog';
import { browserEntryDrag, browserFolderEntries, OBJECT_DRAG_TYPE } from './browserEntries';
import {
  browserGroups,
  browserItemSearchText,
  buildBrowserFolders,
  classifyObjectFolder,
  filterBrowserFolder,
  isCourseAssetBrowserItem,
  kmpPointCatalog,
  objectTitleForId,
  type BrowserFolder,
} from './browserFolders';

const objFlowEntries = [
  { objectId: 0x65, name: 'itembox', resources: 'itembox' },
  { objectId: 0x191, name: 'kuribo', resources: 'kuribo' },
  { objectId: 0x148, name: 'kinoko_lift1', resources: 'kinoko_lift1' },
  { objectId: 0x2c1, name: 'castle_tree1', resources: 'castle_tree1' },
];
const objFlow: ObjFlowTable = {
  entries: objFlowEntries,
  byId: new Map(objFlowEntries.map((entry) => [entry.objectId, entry])),
};
const commonArchive = { objFlow, resourceEntries: [], byBaseName: new Map() } as unknown as CommonResourceArchive;

const track = {
  fileName: 'Z0.szs',
  brresFiles: ['./course_model.brres', './vrcorn_model.brres'],
  brresSummaries: {},
  archiveEntries: [],
  warnings: [],
} as unknown as TrackDocument;

function folderById(folders: BrowserFolder[], id: string): BrowserFolder {
  const found = folders.find((folder) => folder.id === id);
  if (!found) throw new Error(`missing folder ${id}`);
  return found;
}

describe('buildBrowserFolders', () => {
  it('keeps every object searchable and draggable beyond the old catalog and category limits', () => {
    const entries = ['kuribo', 'tree', 'lift', 'statue'].flatMap((name, category) =>
      Array.from({ length: 80 }, (_, index) => ({ objectId: 0x8000 + category * 80 + index, name: `${name}_${index}`, resources: '' })),
    );
    const folders = buildBrowserFolders({
      track: null,
      objFlow: { entries, byId: new Map(entries.map((entry) => [entry.objectId, entry])) },
      commonArchive: null,
      courseAssetDb: null,
    });

    expect(folderById(folders, 'common').items).toHaveLength(320);
    for (const id of ['enemies', 'nature', 'gameplay', 'props']) {
      expect(folderById(folders, id).items).toHaveLength(80);
    }
    const results = browserFolderEntries(filterBrowserFolder(folderById(folders, 'common'), 'statue_79'), {
      track: null, commonArchive: null, commonBrresSummaries: {},
    });
    expect(results).toHaveLength(1);
    expect(browserEntryDrag(results[0])).toEqual({ type: OBJECT_DRAG_TYPE, value: String(entries.at(-1)!.objectId) });
  });

  it('offers every browsable type from the bundled game object table', () => {
    const common = parseCommonResourceArchive(new Uint8Array(readFileSync('public/data/MarioKartWii/Race/Common.szs')));
    const folders = buildBrowserFolders({ track: null, objFlow: common.objFlow, commonArchive: common, courseAssetDb: null });
    const entries = browserFolderEntries(folderById(folders, 'common'), {
      track: null, commonArchive: common, commonBrresSummaries: {},
    });
    expect(common.objFlow.entries.length).toBeGreaterThan(180);
    expect(entries.map((entry) => entry.kind === 'object' ? entry.objectId : -1).sort((a, b) => a - b)).toEqual(
      common.objFlow.entries.filter(isBrowsableObjectEntry).map((entry) => entry.objectId).sort((a, b) => a - b),
    );
    for (const entry of entries) expect(browserEntryDrag(entry)?.type).toBe(OBJECT_DRAG_TYPE);
  });

  it('always offers the track-mesh folder, even with nothing loaded', () => {
    const folders = buildBrowserFolders({ track: null, objFlow: null, commonArchive: null, courseAssetDb: null });
    const trackFolder = folderById(folders, 'track');
    expect(trackFolder.detail).toBe('Load a track to list track assets');
    expect(trackFolder.items).toEqual([]);
  });

  it('lists the KMP record catalog with friendly labels', () => {
    const folders = buildBrowserFolders({ track: null, objFlow: null, commonArchive: null, courseAssetDb: null });
    const kmp = folderById(folders, 'kmp');
    expect(kmp.kind).toBe('kmp');
    expect(kmp.items).toHaveLength(kmpPointCatalog.length);
    expect(kmpPointCatalog.map((item) => item.label)).toContain('Enemy Route Node');
  });

  it('splits real ObjFlow objects into the themed folders and lists track assets', () => {
    const folders = buildBrowserFolders({ track, objFlow, commonArchive, courseAssetDb: null });
    expect(folderById(folders, 'track').items).toEqual(track.brresFiles);
    expect(folderById(folders, 'common').items.length).toBeGreaterThan(0);
    expect(folderById(folders, 'featured').items.length).toBeGreaterThan(0);
  });

  it('files every folder under a group that the folder tree knows about', () => {
    const folders = buildBrowserFolders({ track, objFlow, commonArchive, courseAssetDb: null });
    const groupIds = new Set(browserGroups.map((group) => group.id));
    expect(folders.length).toBeGreaterThan(0);
    for (const folder of folders) expect(groupIds.has(folder.group)).toBe(true);
    expect(folderById(folders, 'kmp').group).toBe('trackData');
    expect(folderById(folders, 'track').group).toBe('thisTrack');
  });

  it('classifies objects into enemies, nature, gameplay and props', () => {
    expect(classifyObjectFolder({ objectId: 0x191, name: 'kuribo', resources: 'kuribo' })).toBe('enemies');
    expect(classifyObjectFolder({ objectId: 0x2c1, name: 'castle_tree1', resources: 'castle_tree1' })).toBe('nature');
    expect(classifyObjectFolder({ objectId: 0x65, name: 'itembox', resources: 'itembox' })).toBe('gameplay');
    expect(classifyObjectFolder({ objectId: 0x999, name: 'zzz_statue', resources: 'zzz_statue' })).toBe('props');
  });
});

describe('filterBrowserFolder', () => {
  const objectFolder: BrowserFolder = {
    id: 'common',
    group: 'objects',
    label: 'All objects',
    detail: '2 placeable game objects',
    kind: 'object',
    items: [
      { objectId: 0x65, name: 'itembox', resources: 'itembox' },
      { objectId: 0x191, name: 'kuribo', resources: 'kuribo' },
    ],
  };

  it('returns the folder untouched for an empty query', () => {
    expect(filterBrowserFolder(objectFolder, '   ')).toBe(objectFolder);
    expect(filterBrowserFolder(null, 'x')).toBeNull();
  });

  it('filters objects and reports how many matched', () => {
    const filtered = filterBrowserFolder(objectFolder, 'kuribo');
    expect(filtered?.items).toHaveLength(1);
    expect(filtered?.detail).toBe('1 matching objects');
  });

  it('filters KMP records by label, section and category', () => {
    const folder: BrowserFolder = { id: 'kmp', group: 'trackData', label: 'Points and routes', detail: '', kind: 'kmp', items: kmpPointCatalog };
    expect(filterBrowserFolder(folder, 'checkpoint')?.items).toHaveLength(1);
    expect(filterBrowserFolder(folder, 'jgpt')?.items).toHaveLength(1);
  });

  it('filters track asset paths', () => {
    const folder: BrowserFolder = { id: 'track', group: 'thisTrack', label: 'Track meshes', detail: '', kind: 'brres', items: ['./course_model.brres', './vrcorn_model.brres'] };
    expect(filterBrowserFolder(folder, 'vrcorn')?.items).toEqual(['./vrcorn_model.brres']);
  });

});

describe('browser item helpers', () => {
  it('recognises course assets and includes their track label in the search text', () => {
    const asset = {
      id: 'a',
      source: 'sharedObjectDir',
      trackFile: null,
      trackLabel: 'Shared objects',
      path: 'Object/kuribo.brres',
      baseName: 'kuribo.brres',
      kind: 'sharedObject' as const,
      objectId: 0x191,
      objectLabel: 'Goomba',
    };
    expect(isCourseAssetBrowserItem(asset)).toBe(true);
    expect(browserItemSearchText(asset)).toContain('shared objects');
    expect(isCourseAssetBrowserItem({ objectId: 0x65, name: 'itembox', resources: 'itembox' })).toBe(false);
  });

  it('resolves friendly object titles through the ObjFlow table', () => {
    expect(objectTitleForId(objFlow, 0x65)).toBe('Item Box');
    expect(objectTitleForId(null, 0x191)).toBe('Kuribo');
    expect(objectTitleForId(null, 0xfffe)).toBe('Unknown object');
  });
});
