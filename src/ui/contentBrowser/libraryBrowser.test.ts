// The "My Assets" folder: custom .brres files the user dropped in, kept in IndexedDB.

import { describe, expect, it } from 'vitest';
import { LIBRARY_ASSET_DRAG_TYPE, type LibraryAsset } from '../../lib/assetLibrary';
import { browserEntryDrag, browserEntryFacts, browserEntryHint, browserFolderEntries } from './browserEntries';
import { browserGroups, buildBrowserFolders, filterBrowserFolder, libraryAssetSearchText } from './browserFolders';

function asset(overrides: Partial<LibraryAsset> = {}): LibraryAsset {
  return {
    id: 'a1',
    name: 'Big tree',
    fileName: 'big_tree.brres',
    size: 40960,
    addedAt: Date.UTC(2026, 8, 3, 12, 0, 0),
    models: ['big_tree'],
    textureCount: 3,
    thumbnail: 'data:image/png;base64,AAAA',
    ...overrides,
  };
}

const context = { track: null, commonArchive: null, commonBrresSummaries: {} };

describe('My Assets folder', () => {
  it('is always present, even with nothing in it', () => {
    const folders = buildBrowserFolders({ track: null, objFlow: null, commonArchive: null, courseAssetDb: null });
    const library = folders.find((folder) => folder.id === 'library');
    expect(library).toBeDefined();
    expect(library!.kind).toBe('library');
    expect(library!.items).toEqual([]);
    expect(library!.group).toBe('library');
    expect(browserGroups.some((group) => group.id === 'library')).toBe(true);
  });

  it('lists the assets it is given and filters on name, file and model names', () => {
    const assets = [asset(), asset({ id: 'a2', name: 'Lamp', fileName: 'street_lamp.brres', models: ['lamp_post'] })];
    const folders = buildBrowserFolders({ track: null, objFlow: null, commonArchive: null, courseAssetDb: null, libraryAssets: assets });
    const library = folders.find((folder) => folder.id === 'library')!;
    expect(library.items).toHaveLength(2);
    expect(library.detail).toContain('2 custom models');

    expect(filterBrowserFolder(library, 'big')!.items).toHaveLength(1);
    expect(filterBrowserFolder(library, 'street')!.items.map((item) => (item as LibraryAsset).id)).toEqual(['a2']);
    expect(filterBrowserFolder(library, 'lamp_post')!.items).toHaveLength(1);
    expect(filterBrowserFolder(library, 'nothing')!.items).toHaveLength(0);
    expect(libraryAssetSearchText(assets[0])).toBe('big tree big_tree.brres big_tree');
  });

  it('turns assets into draggable tiles with facts', () => {
    const folders = buildBrowserFolders({ track: null, objFlow: null, commonArchive: null, courseAssetDb: null, libraryAssets: [asset()] });
    const library = folders.find((folder) => folder.id === 'library')!;
    const [entry] = browserFolderEntries(library, context);
    expect(entry.kind).toBe('libraryAsset');
    expect(entry.id).toBe('library:a1');
    expect(entry.label).toBe('Big tree');
    expect(entry.caption).toBe('1 model · 3 textures · 40 KB');
    expect(browserEntryDrag(entry)).toEqual({ type: LIBRARY_ASSET_DRAG_TYPE, value: 'a1' });
    expect(browserEntryHint(entry)).toContain('drag into the viewport');
    const facts = browserEntryFacts(entry, context);
    expect(facts.map((fact) => fact.label)).toEqual(['File', 'Size', 'Models', 'Textures', 'Added', 'How to place']);
    expect(facts.find((fact) => fact.label === 'Models')!.value).toBe('big_tree');
  });

  it('does not offer a drag for an archive with no model', () => {
    const folders = buildBrowserFolders({ track: null, objFlow: null, commonArchive: null, courseAssetDb: null, libraryAssets: [asset({ models: [] })] });
    const [entry] = browserFolderEntries(folders.find((folder) => folder.id === 'library')!, context);
    expect(browserEntryDrag(entry)).toBeNull();
    expect(browserEntryHint(entry)).toContain('no model to place');
  });
});
