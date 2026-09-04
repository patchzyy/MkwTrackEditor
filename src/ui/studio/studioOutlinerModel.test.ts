import { describe, expect, it } from 'vitest';
import type { GxArchiveMaterials } from '../../lib/gxMaterial';
import { flattenTree } from '../components/treeModel';
import {
  activeStudioAnimations,
  animationKindLabel,
  buildStudioTree,
  defaultExpandedStudioIds,
  studioArchiveNodeId,
  studioMaterialNodeId,
  studioMaterialRefEquals,
  studioModelNodeId,
  studioTimelineDuration,
  type StudioArchiveSummary,
  type StudioNodeData,
  type StudioTreeNode,
} from './studioOutlinerModel';

function materials(archivePath: string): GxArchiveMaterials {
  return {
    archivePath,
    models: [
      {
        modelName: 'model',
        materials: [
          {
            archivePath,
            modelName: 'model',
            materialName: 'funky_all_tx',
            index: 0,
            translucent: false,
            textures: ['funky_all', 'lm_0'],
            stageCount: 3,
            sharedShaderWith: [],
            meshes: ['polygon0'],
          },
          {
            archivePath,
            modelName: 'model',
            materialName: 'eye_tx',
            index: 1,
            translucent: true,
            textures: ['eye'],
            stageCount: 1,
            sharedShaderWith: [],
            meshes: ['polygon1'],
          },
        ],
      },
    ],
    textures: [
      { name: 'funky_all', width: 256, height: 128, format: 14 as never, mipCount: 1, usedBy: ['funky_all_tx'] },
      { name: 'eye', width: 32, height: 32, format: 14 as never, mipCount: 1, usedBy: ['eye_tx'] },
    ],
  };
}

const driver: StudioArchiveSummary = {
  archivePath: 'Preview/fk_lb_driver_model.brres',
  label: 'fk_lb_driver_model',
  visible: true,
  models: [{ modelName: 'model', visible: true, materialCount: 2, shapeCount: 2, nodeCount: 40 }],
  materials: materials('Preview/fk_lb_driver_model.brres'),
  animations: [
    { kind: 'chr0', name: 'wait', duration: 90, enabled: true, supported: true },
    { kind: 'chr0', name: 'run', duration: 40, enabled: false, supported: true },
    { kind: 'scn0', name: 'lights', duration: 10, enabled: false, supported: false },
  ],
};

const kart: StudioArchiveSummary = {
  archivePath: 'Preview/fk_lb_kart_model.brres',
  label: 'fk_lb_kart_model',
  visible: true,
  models: [
    { modelName: 'body', visible: true, materialCount: 1, shapeCount: 1, nodeCount: 4 },
    { modelName: 'shadow', visible: false, materialCount: 1, shapeCount: 1, nodeCount: 1 },
  ],
  materials: null,
  animations: [{ kind: 'srt0', name: 'body', duration: 31, enabled: true, supported: true }],
};

function labelsOf(nodes: StudioTreeNode[]): string[] {
  return flattenTree(
    nodes,
    new Set(
      flattenTree(nodes, new Set()).flatMap((row) => collectIds(row.node)),
    ),
  ).map((row) => row.node.label);
}

function collectIds(node: StudioTreeNode): string[] {
  return [node.id, ...(node.children ?? []).flatMap(collectIds)];
}

function dataOf(nodes: StudioTreeNode[], id: string): StudioNodeData | undefined {
  const all = flattenTree(nodes, new Set(nodes.flatMap(collectIds)));
  return all.find((row) => row.id === id)?.node.data;
}

describe('studio outliner model', () => {
  it('puts an archive, its models, their materials, the textures and the animations in one tree', () => {
    const tree = buildStudioTree([driver, kart]);
    expect(tree.map((node) => node.label)).toEqual(['fk_lb_driver_model', 'fk_lb_kart_model']);

    const labels = labelsOf(tree);
    expect(labels).toContain('model');
    expect(labels).toContain('Materials (2)');
    expect(labels).toContain('funky_all_tx');
    expect(labels).toContain('Textures (2)');
    expect(labels).toContain('Animations (3)');
    expect(labels).toContain('Skeletal (2)');
    expect(labels).toContain('wait');
  });

  it('carries visibility on the archive and model rows, and the play state on animations', () => {
    const tree = buildStudioTree([driver, kart]);
    const shadow = dataOf(tree, studioModelNodeId(kart.archivePath, 'shadow'));
    expect(shadow).toEqual({ kind: 'model', archivePath: kart.archivePath, modelName: 'shadow' });
    const shadowRow = flattenTree(tree, new Set(tree.flatMap(collectIds))).find(
      (row) => row.id === studioModelNodeId(kart.archivePath, 'shadow'),
    );
    expect(shadowRow?.node.checked).toBe(false);

    const rows = flattenTree(tree, new Set(tree.flatMap(collectIds)));
    const wait = rows.find((row) => row.node.label === 'wait');
    expect(wait?.node.checked).toBe(true);
    const run = rows.find((row) => row.node.label === 'run');
    expect(run?.node.checked).toBe(false);
  });

  it('marks an animation kind the renderer cannot play as disabled', () => {
    const rows = flattenTree(buildStudioTree([driver]), new Set(buildStudioTree([driver]).flatMap(collectIds)));
    const scn0 = rows.find((row) => row.node.label === 'lights');
    expect(scn0?.node.disabled).toBe(true);
    expect(scn0?.node.detail).toBe('not playable');
  });

  it('names an animation kind in words, never as a four-letter section code', () => {
    expect(animationKindLabel('chr0')).toBe('Skeletal');
    expect(animationKindLabel('srt0')).toBe('Texture motion');
    expect(animationKindLabel('vis0')).toBe('Visibility');
    const labels = labelsOf(buildStudioTree([driver, kart]));
    expect(labels.some((label) => /chr0|srt0|pat0|clr0|vis0|scn0/i.test(label))).toBe(false);
  });

  it('searches across materials, textures, meshes and animations', () => {
    const byTexture = buildStudioTree([driver, kart], 'lm_0');
    expect(labelsOf(byTexture)).toContain('funky_all_tx');
    expect(labelsOf(byTexture)).not.toContain('eye_tx');

    const byMesh = buildStudioTree([driver, kart], 'polygon1');
    expect(labelsOf(byMesh)).toContain('eye_tx');

    const byAnimation = buildStudioTree([driver, kart], 'run');
    expect(labelsOf(byAnimation)).toContain('run');

    expect(buildStudioTree([driver, kart], 'nothing-matches-this')).toEqual([]);
  });

  it('lists an archive with no material listing yet, so the tree appears before the parse finishes', () => {
    const tree = buildStudioTree([kart]);
    expect(tree).toHaveLength(1);
    expect(labelsOf(tree)).toContain('body');
  });

  it('expands the archives and their models by default, and nothing deeper', () => {
    const ids = defaultExpandedStudioIds([driver, kart]);
    expect(ids).toContain(studioArchiveNodeId(driver.archivePath));
    expect(ids).toContain(studioModelNodeId(driver.archivePath, 'model'));
    expect(ids.some((id) => id.startsWith('animations:'))).toBe(false);
  });

  it('reports what is playing and how long the timeline is', () => {
    expect(activeStudioAnimations([driver, kart]).map((entry) => entry.name)).toEqual(['wait', 'body']);
    expect(studioTimelineDuration([driver, kart])).toBe(90);
    expect(studioTimelineDuration([{ ...driver, animations: [] }])).toBe(0);
  });

  it('compares material references by value', () => {
    const ref = { archivePath: 'a.brres', modelName: 'model', materialName: 'm' };
    expect(studioMaterialRefEquals(ref, { ...ref })).toBe(true);
    expect(studioMaterialRefEquals(ref, { ...ref, materialName: 'other' })).toBe(false);
    expect(studioMaterialRefEquals(null, null)).toBe(true);
    expect(studioMaterialRefEquals(ref, null)).toBe(false);
    expect(studioMaterialNodeId(ref)).toBe('material:a.brres:model:m');
  });
});
