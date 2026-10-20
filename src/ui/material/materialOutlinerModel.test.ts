import { describe, expect, it } from 'vitest';
import type { GxArchiveMaterials, GxMaterialSummary } from '../../lib/gxMaterial';
import type { TrackDocument } from '../../lib/track';
import {
  archiveKey,
  buildMaterialTree,
  describeArchiveTotals,
  describeMaterialArchive,
  findArchiveBytes,
  listMaterialArchives,
  materialRefEquals,
  materialRefKey,
  stepMaterialSelection,
  treeMaterials,
} from './materialOutlinerModel';

function trackWith(paths: string[]): TrackDocument {
  return {
    archiveEntries: paths.map((path) => ({ type: 'file' as const, path, data: new Uint8Array([1, 2, 3]) })),
  } as unknown as TrackDocument;
}

function summary(modelName: string, materialName: string, overrides: Partial<GxMaterialSummary> = {}): GxMaterialSummary {
  return {
    archivePath: 'course_model.brres',
    modelName,
    materialName,
    index: 0,
    translucent: false,
    textures: ['grass'],
    stageCount: 2,
    sharedShaderWith: [],
    meshes: ['course_shape0'],
    ...overrides,
  };
}

const archive = (materials: GxMaterialSummary[]): GxArchiveMaterials => ({
  archivePath: 'course_model.brres',
  models: [{ modelName: 'course', materials }],
  textures: [
    { name: 'grass', width: 64, height: 64, format: 14 as never, mipCount: 1, usedBy: [] },
    { name: 'road', width: 128, height: 128, format: 14 as never, mipCount: 1, usedBy: [] },
  ],
});

describe('archive listing', () => {
  it('names the archives the way an author thinks about them', () => {
    expect(describeMaterialArchive('course_model.brres')).toMatchObject({ label: 'Track model', role: 'course' });
    expect(describeMaterialArchive('vrcorn_model.brres')).toMatchObject({ label: 'Skybox', role: 'skybox' });
    expect(describeMaterialArchive('map_model.brres')).toMatchObject({ label: 'Minimap', role: 'minimap' });
    expect(describeMaterialArchive('itembox.brres')).toMatchObject({ label: 'itembox', role: 'object' });
  });

  it('lists the course model first, then the skybox, the minimap and the objects', () => {
    const paths = listMaterialArchives(trackWith(['zebra.brres', 'map_model.brres', 'vrcorn_model.brres', 'course_model.brres', 'apple.brres']))
      .map((entry) => entry.path);
    expect(paths).toEqual(['course_model.brres', 'vrcorn_model.brres', 'map_model.brres', 'apple.brres', 'zebra.brres']);
  });

  it('ignores everything that is not a .brres', () => {
    expect(listMaterialArchives(trackWith(['course.kmp', 'course.kcl', 'course_model.brres']))).toHaveLength(1);
  });

  it('has nothing to list without a track', () => {
    expect(listMaterialArchives(null)).toEqual([]);
    expect(findArchiveBytes(null, 'course_model.brres')).toBeNull();
  });

  it('finds an archive by name, ignoring case', () => {
    expect(findArchiveBytes(trackWith(['Course_Model.brres']), 'course_model.brres')).toBeInstanceOf(Uint8Array);
    expect(findArchiveBytes(trackWith(['course_model.brres']), 'nope.brres')).toBeNull();
  });
});

describe('groups and shared game models', () => {
  it('sorts models into Course, Sky, Objects and Other', () => {
    const entries = listMaterialArchives(trackWith(['itembox.brres', 'map_model.brres', 'vrcorn_model.brres', 'course_model.brres']));
    expect(entries.map((entry) => [entry.label, entry.group])).toEqual([
      ['Track model', 'course'],
      ['Skybox', 'sky'],
      ['Minimap', 'other'],
      ['itembox', 'objects'],
    ]);
  });

  it('lists object models the viewport draws even when the track does not carry them', () => {
    const track = trackWith(['course_model.brres', 'itembox.brres']);
    const entries = listMaterialArchives(
      track,
      [
        { path: './itembox.brres', label: 'Item Box' },
        { path: './dokan_sfc.brres', label: 'Dokan SFC' },
      ],
      new Map([['itembox.brres', 'Item Box']]),
    );
    expect(entries.map((entry) => `${entry.label}:${entry.source}`)).toEqual(['Track model:track', 'Dokan SFC:common', 'Item Box:track']);
    expect(entries.every((entry) => entry.group === 'course' || entry.group === 'objects')).toBe(true);
  });

  it('finds an archive however its path is spelled', () => {
    const track = trackWith(['sub/Item.brres']);
    expect(findArchiveBytes(track, './sub/item.brres')).toBeInstanceOf(Uint8Array);
    expect(archiveKey('./Sub/Item.brres')).toBe('sub/item.brres');
  });

  it('looks a listed archive up by its normalized key too', () => {
    const entries = listMaterialArchives(trackWith(['./course_model.brres']));
    const tree = buildMaterialTree(entries, new Map([['course_model.brres', archive([summary('course', 'road')])]]));
    expect(tree[0].loaded).toBe(true);
  });
});

describe('material references', () => {
  it('ignores the ./ prefix and case in the archive path', () => {
    const a = { archivePath: './course_model.brres', modelName: 'course', materialName: 'road' };
    const b = { archivePath: 'Course_Model.brres', modelName: 'course', materialName: 'road' };
    expect(materialRefKey(a)).toBe(materialRefKey(b));
    expect(materialRefEquals(a, b)).toBe(true);
  });

  it('treats a different material as different', () => {
    const a = { archivePath: 'course_model.brres', modelName: 'course', materialName: 'road' };
    expect(materialRefEquals(a, { ...a, materialName: 'grass' })).toBe(false);
    expect(materialRefEquals(a, null)).toBe(false);
    expect(materialRefEquals(null, null)).toBe(true);
  });
});

describe('the tree', () => {
  const entries = listMaterialArchives(trackWith(['course_model.brres', 'vrcorn_model.brres']));

  it('shows an unopened archive as a row with no children', () => {
    const tree = buildMaterialTree(entries, new Map());
    expect(tree).toHaveLength(2);
    expect(tree[0].loaded).toBe(false);
    expect(tree[0].models).toEqual([]);
  });

  it('lists a loaded archive\'s models and materials with their textures as the caption', () => {
    const tree = buildMaterialTree(entries, new Map([['course_model.brres', archive([summary('course', 'road')])]]));
    expect(tree[0].loaded).toBe(true);
    expect(tree[0].materialCount).toBe(1);
    expect(tree[0].models[0].materials[0].caption).toBe('grass');
  });

  it('says "No texture" for a material that samples nothing', () => {
    const tree = buildMaterialTree(entries, new Map([['course_model.brres', archive([summary('course', 'flat', { textures: [] })])]]));
    expect(tree[0].models[0].materials[0].caption).toBe('No texture');
  });

  it('badges a material whose shader is shared', () => {
    const tree = buildMaterialTree(
      entries,
      new Map([['course_model.brres', archive([summary('course', 'road', { sharedShaderWith: ['grass', 'sand'] })])]]),
    );
    expect(tree[0].models[0].materials[0].sharedBadge).toBe('Shared with 2 others');
  });

  it('matches the search against names, textures and mesh names', () => {
    const archives = new Map([['course_model.brres', archive([
      summary('course', 'road', { textures: ['asphalt'] }),
      summary('course', 'grass', { textures: ['lawn'], meshes: ['grass_shape'] }),
    ])]]);
    expect(treeMaterials(buildMaterialTree(entries, archives, 'asphalt')).map((m) => m.summary.materialName)).toEqual(['road']);
    expect(treeMaterials(buildMaterialTree(entries, archives, 'grass_shape')).map((m) => m.summary.materialName)).toEqual(['grass']);
    expect(treeMaterials(buildMaterialTree(entries, archives, 'ROAD')).map((m) => m.summary.materialName)).toEqual(['road']);
    expect(treeMaterials(buildMaterialTree(entries, archives, 'nothing'))).toEqual([]);
  });

  it('hides models with no matches while a search is running', () => {
    const archives = new Map([['course_model.brres', archive([summary('course', 'road')])]]);
    expect(buildMaterialTree(entries, archives, 'zzz')[0].models).toEqual([]);
    expect(buildMaterialTree(entries, archives, '')[0].models).toHaveLength(1);
  });

  it('steps the selection through the flattened list and wraps around', () => {
    const archives = new Map([['course_model.brres', archive([summary('course', 'road'), summary('course', 'grass')])]]);
    const tree = buildMaterialTree(entries, archives);
    const first = treeMaterials(tree)[0].ref;
    expect(stepMaterialSelection(tree, null, 1)?.materialName).toBe('road');
    expect(stepMaterialSelection(tree, first, 1)?.materialName).toBe('grass');
    expect(stepMaterialSelection(tree, first, -1)?.materialName).toBe('grass');
    expect(stepMaterialSelection(buildMaterialTree(entries, new Map()), null, 1)).toBeNull();
  });

  it('summarises an archive for the panel header', () => {
    expect(describeArchiveTotals(archive([summary('course', 'road')]))).toBe('1 material · 2 textures');
    expect(describeArchiveTotals(undefined)).toBeNull();
  });
});
