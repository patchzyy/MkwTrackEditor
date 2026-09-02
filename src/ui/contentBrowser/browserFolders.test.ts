import { describe, expect, it } from 'vitest';
import type { BrresEditorNode, EditorProjectState } from '../../lib/brresEditor';
import type { CommonResourceArchive, ObjFlowTable } from '../../lib/objflow';
import type { TrackDocument } from '../../lib/track';
import {
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

const archiveNode: BrresEditorNode = {
  id: 'node-0',
  name: 'tree_a',
  modelName: 'course',
  archivePath: './course_model.brres',
} as unknown as BrresEditorNode;
const projectState = { sceneNodes: [archiveNode], archiveNodes: [archiveNode] } as unknown as EditorProjectState;

function folderById(folders: BrowserFolder[], id: string): BrowserFolder {
  const found = folders.find((folder) => folder.id === id);
  if (!found) throw new Error(`missing folder ${id}`);
  return found;
}

describe('buildBrowserFolders', () => {
  it('always offers the track-mesh folder, even with nothing loaded', () => {
    const folders = buildBrowserFolders({ track: null, projectState: null, objFlow: null, commonArchive: null, courseAssetDb: null });
    const trackFolder = folderById(folders, 'track');
    expect(trackFolder.detail).toBe('Load a track to list track assets');
    expect(trackFolder.items).toEqual([]);
  });

  it('lists the KMP record catalog with friendly labels', () => {
    const folders = buildBrowserFolders({ track: null, projectState: null, objFlow: null, commonArchive: null, courseAssetDb: null });
    const kmp = folderById(folders, 'kmp');
    expect(kmp.kind).toBe('kmp');
    expect(kmp.items).toHaveLength(kmpPointCatalog.length);
    expect(kmpPointCatalog.map((item) => item.label)).toContain('Enemy Route Node');
  });

  it('splits real ObjFlow objects into the themed folders and lists track assets', () => {
    const folders = buildBrowserFolders({ track, projectState, objFlow, commonArchive, courseAssetDb: null });
    expect(folderById(folders, 'track').items).toEqual(track.brresFiles);
    expect(folderById(folders, 'archiveNodes').items).toEqual([archiveNode]);
    expect(folderById(folders, 'common').items.length).toBeGreaterThan(0);
    expect(folderById(folders, 'featured').items.length).toBeGreaterThan(0);
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
    label: 'All Objects',
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
    const folder: BrowserFolder = { id: 'kmp', label: 'Track Data', detail: '', kind: 'kmp', items: kmpPointCatalog };
    expect(filterBrowserFolder(folder, 'checkpoint')?.items).toHaveLength(1);
    expect(filterBrowserFolder(folder, 'jgpt')?.items).toHaveLength(1);
  });

  it('filters track asset paths', () => {
    const folder: BrowserFolder = { id: 'track', label: 'Track Meshes', detail: '', kind: 'brres', items: ['./course_model.brres', './vrcorn_model.brres'] };
    expect(filterBrowserFolder(folder, 'vrcorn')?.items).toEqual(['./vrcorn_model.brres']);
  });

  it('filters model nodes by name, model and archive instead of crashing on them', () => {
    const folder: BrowserFolder = { id: 'archiveNodes', label: 'Model Nodes', detail: '', kind: 'archiveNode', items: [archiveNode] };
    expect(filterBrowserFolder(folder, 'tree')?.items).toEqual([archiveNode]);
    expect(filterBrowserFolder(folder, 'course model')?.items).toEqual([archiveNode]);
    expect(filterBrowserFolder(folder, 'nothing')?.items).toEqual([]);
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
