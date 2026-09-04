// The Model Studio's left outliner, as a pure tree.
//
// One node kind per thing an author can point at — an archive, a model, a material, a texture,
// an animation — with the visibility and play toggles carried on the node so `TreeView`'s eye
// column can drive them. No React here; `StudioOutliner.tsx` only renders what this returns.

import type { GxArchiveMaterials, GxMaterialRef } from '../../lib/gxMaterial';
import type { TreeNode } from '../components/treeModel';

export type StudioAnimationKind = 'chr0' | 'srt0' | 'pat0' | 'clr0' | 'vis0' | 'scn0';

export interface StudioAnimationSummary {
  kind: StudioAnimationKind;
  name: string;
  duration: number;
  enabled: boolean;
  supported: boolean;
}

export interface StudioModelSummary {
  modelName: string;
  visible: boolean;
  materialCount: number;
  shapeCount: number;
  nodeCount: number;
}

/** Everything the outliner knows about one open BRRES. */
export interface StudioArchiveSummary {
  archivePath: string;
  label: string;
  visible: boolean;
  models: StudioModelSummary[];
  /** Null until the material library has listed the archive. */
  materials: GxArchiveMaterials | null;
  animations: StudioAnimationSummary[];
}

export type StudioNodeData =
  | { kind: 'archive'; archivePath: string }
  | { kind: 'model'; archivePath: string; modelName: string }
  | { kind: 'materialFolder'; archivePath: string; modelName: string }
  | { kind: 'material'; ref: GxMaterialRef }
  | { kind: 'textureFolder'; archivePath: string }
  | { kind: 'texture'; archivePath: string; textureName: string }
  | { kind: 'animationFolder'; archivePath: string }
  | { kind: 'animation'; archivePath: string; animationKind: StudioAnimationKind; animationName: string; enabled: boolean; supported: boolean };

export type StudioTreeNode = TreeNode<StudioNodeData>;

export function studioArchiveNodeId(archivePath: string): string {
  return `archive:${archivePath}`;
}

export function studioModelNodeId(archivePath: string, modelName: string): string {
  return `model:${archivePath}:${modelName}`;
}

export function studioMaterialNodeId(ref: GxMaterialRef): string {
  return `material:${ref.archivePath}:${ref.modelName}:${ref.materialName}`;
}

export function studioAnimationNodeId(archivePath: string, kind: string, name: string): string {
  return `animation:${archivePath}:${kind}:${name}`;
}

export function studioMaterialRefEquals(a: GxMaterialRef | null, b: GxMaterialRef | null): boolean {
  if (a === null || b === null) return a === b;
  return a.archivePath === b.archivePath && a.modelName === b.modelName && a.materialName === b.materialName;
}

/** The friendly name of an animation kind, in the words the rest of the editor uses. */
export function animationKindLabel(kind: StudioAnimationKind): string {
  switch (kind) {
    case 'chr0':
      return 'Skeletal';
    case 'srt0':
      return 'Texture motion';
    case 'pat0':
      return 'Texture swap';
    case 'clr0':
      return 'Colour';
    case 'vis0':
      return 'Visibility';
    case 'scn0':
      return 'Scene';
  }
}

const ANIMATION_KIND_ORDER: StudioAnimationKind[] = ['chr0', 'srt0', 'pat0', 'clr0', 'vis0', 'scn0'];

function matches(query: string, ...values: Array<string | undefined>): boolean {
  if (query === '') return true;
  return values.some((value) => value !== undefined && value.toLowerCase().includes(query));
}

/**
 * Builds the whole tree. `query` filters leaves and keeps the branches that still have one, so
 * searching for a texture name shows the archive and model it lives in.
 */
export function buildStudioTree(archives: readonly StudioArchiveSummary[], query = ''): StudioTreeNode[] {
  const needle = query.trim().toLowerCase();
  const nodes: StudioTreeNode[] = [];

  for (const archive of archives) {
    const children: StudioTreeNode[] = [];

    for (const model of archive.models) {
      const modelMaterials = archive.materials?.models.find((entry) => entry.modelName === model.modelName)?.materials ?? [];
      const materialNodes: StudioTreeNode[] = modelMaterials
        .filter((material) => matches(needle, material.materialName, ...material.textures, ...material.meshes))
        .map((material) => ({
          id: studioMaterialNodeId(material),
          label: material.materialName,
          detail: `${material.stageCount} stage${material.stageCount === 1 ? '' : 's'}`,
          data: { kind: 'material', ref: { archivePath: material.archivePath, modelName: material.modelName, materialName: material.materialName } },
        }));

      const modelMatches = matches(needle, model.modelName);
      if (!modelMatches && materialNodes.length === 0) continue;

      children.push({
        id: studioModelNodeId(archive.archivePath, model.modelName),
        label: model.modelName,
        detail: `${model.materialCount} material${model.materialCount === 1 ? '' : 's'} · ${model.shapeCount} mesh${model.shapeCount === 1 ? '' : 'es'}`,
        checked: model.visible,
        children:
          materialNodes.length > 0
            ? [
                {
                  id: `materials:${archive.archivePath}:${model.modelName}`,
                  label: `Materials (${materialNodes.length})`,
                  children: materialNodes,
                  data: { kind: 'materialFolder', archivePath: archive.archivePath, modelName: model.modelName },
                },
              ]
            : undefined,
        data: { kind: 'model', archivePath: archive.archivePath, modelName: model.modelName },
      });
    }

    const textures = (archive.materials?.textures ?? []).filter((texture) => matches(needle, texture.name, ...texture.usedBy));
    if (textures.length > 0) {
      children.push({
        id: `textures:${archive.archivePath}`,
        label: `Textures (${textures.length})`,
        children: textures.map((texture) => ({
          id: `texture:${archive.archivePath}:${texture.name}`,
          label: texture.name,
          detail: `${texture.width}x${texture.height}`,
          data: { kind: 'texture', archivePath: archive.archivePath, textureName: texture.name },
        })),
        data: { kind: 'textureFolder', archivePath: archive.archivePath },
      });
    }

    const animations = archive.animations.filter((animation) => matches(needle, animation.name, animationKindLabel(animation.kind)));
    if (animations.length > 0) {
      const byKind: StudioTreeNode[] = [];
      for (const kind of ANIMATION_KIND_ORDER) {
        const ofKind = animations.filter((animation) => animation.kind === kind);
        if (ofKind.length === 0) continue;
        byKind.push({
          id: `animations:${archive.archivePath}:${kind}`,
          label: `${animationKindLabel(kind)} (${ofKind.length})`,
          children: ofKind.map((animation) => ({
            id: studioAnimationNodeId(archive.archivePath, animation.kind, animation.name),
            label: animation.name,
            detail: animation.supported ? `${Math.round(animation.duration)}f` : 'not playable',
            disabled: !animation.supported,
            checked: animation.enabled,
            data: {
              kind: 'animation',
              archivePath: archive.archivePath,
              animationKind: animation.kind,
              animationName: animation.name,
              enabled: animation.enabled,
              supported: animation.supported,
            },
          })),
          data: { kind: 'animationFolder', archivePath: archive.archivePath },
        });
      }
      children.push({
        id: `animationRoot:${archive.archivePath}`,
        label: `Animations (${animations.length})`,
        children: byKind,
        data: { kind: 'animationFolder', archivePath: archive.archivePath },
      });
    }

    if (needle !== '' && children.length === 0 && !matches(needle, archive.label, archive.archivePath)) continue;

    nodes.push({
      id: studioArchiveNodeId(archive.archivePath),
      label: archive.label,
      detail: archive.archivePath,
      checked: archive.visible,
      children: children.length > 0 ? children : undefined,
      data: { kind: 'archive', archivePath: archive.archivePath },
    });
  }

  return nodes;
}

/** Ids expanded when the studio opens: every archive and its models, not the leaf folders. */
export function defaultExpandedStudioIds(archives: readonly StudioArchiveSummary[]): string[] {
  const ids: string[] = [];
  for (const archive of archives) {
    ids.push(studioArchiveNodeId(archive.archivePath));
    for (const model of archive.models) ids.push(studioModelNodeId(archive.archivePath, model.modelName));
  }
  return ids;
}

/** Every enabled, playable animation across all archives — what the transport is running. */
export function activeStudioAnimations(archives: readonly StudioArchiveSummary[]): Array<{ archivePath: string; kind: StudioAnimationKind; name: string; duration: number }> {
  const out: Array<{ archivePath: string; kind: StudioAnimationKind; name: string; duration: number }> = [];
  for (const archive of archives)
    for (const animation of archive.animations)
      if (animation.enabled && animation.supported)
        out.push({ archivePath: archive.archivePath, kind: animation.kind, name: animation.name, duration: animation.duration });
  return out;
}

/** The timeline's length: the longest enabled animation. */
export function studioTimelineDuration(archives: readonly StudioArchiveSummary[]): number {
  return activeStudioAnimations(archives).reduce((longest, animation) => Math.max(longest, animation.duration), 0);
}
