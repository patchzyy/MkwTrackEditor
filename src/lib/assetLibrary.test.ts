import { describe, expect, it } from 'vitest';
import {
  describeLibraryAsset,
  formatLibrarySize,
  isBrresFileName,
  libraryAssetIdFromSourcePath,
  libraryAssetSourcePath,
  libraryNameFromFileName,
  sortLibraryAssets,
  uniqueLibraryName,
  type LibraryAsset,
} from './assetLibrary';

function asset(overrides: Partial<LibraryAsset>): LibraryAsset {
  return {
    id: 'a1',
    name: 'tree',
    fileName: 'tree.brres',
    size: 2048,
    addedAt: 1000,
    models: ['tree'],
    textureCount: 2,
    thumbnail: null,
    ...overrides,
  };
}

describe('asset library helpers', () => {
  it('derives a display name from a file name', () => {
    expect(libraryNameFromFileName('Object/castle_tree1.brres')).toBe('castle_tree1');
    expect(libraryNameFromFileName('C:\\models\\Kart.BRRES')).toBe('Kart');
    expect(libraryNameFromFileName('.brres')).toBe('model');
  });

  it('only accepts .brres file names', () => {
    expect(isBrresFileName('a.brres')).toBe(true);
    expect(isBrresFileName('A.BRRES')).toBe(true);
    expect(isBrresFileName('a.szs')).toBe(false);
  });

  it('keeps names unique, case-insensitively', () => {
    expect(uniqueLibraryName('tree', [])).toBe('tree');
    expect(uniqueLibraryName('tree', ['Tree'])).toBe('tree 2');
    expect(uniqueLibraryName('tree', ['tree', 'tree 2'])).toBe('tree 3');
  });

  it('round-trips the asset id through the merge source path', () => {
    const path = libraryAssetSourcePath({ id: 'k1x-9', fileName: 'tree.brres' });
    expect(path).toBe('library/k1x-9/tree.brres');
    expect(libraryAssetIdFromSourcePath(path)).toBe('k1x-9');
    expect(libraryAssetIdFromSourcePath('kuribo.brres')).toBeNull();
  });

  it('formats sizes and captions', () => {
    expect(formatLibrarySize(512)).toBe('512 B');
    expect(formatLibrarySize(2048)).toBe('2.0 KB');
    expect(formatLibrarySize(200 * 1024)).toBe('200 KB');
    expect(formatLibrarySize(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(describeLibraryAsset(asset({}))).toBe('1 model · 2 textures · 2.0 KB');
    expect(describeLibraryAsset(asset({ models: ['a', 'b'], textureCount: 1 }))).toBe('2 models · 1 texture · 2.0 KB');
  });

  it('sorts newest first, then by name', () => {
    const sorted = sortLibraryAssets([asset({ id: 'a', name: 'b', addedAt: 1 }), asset({ id: 'b', name: 'a', addedAt: 1 }), asset({ id: 'c', name: 'z', addedAt: 5 })]);
    expect(sorted.map((entry) => entry.id)).toEqual(['c', 'b', 'a']);
  });
});
