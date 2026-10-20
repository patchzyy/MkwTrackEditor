// The slice of the noclip Mario Kart Wii renderer that Material mode drives, declared
// structurally (like `VisualRendererScene` in `../visual/visualScene.ts`) so `src/ui` never
// imports vendored types. Every member is optional, so an older scene simply does nothing and
// the editor falls back to "the viewport keeps the old look until the track is reloaded".
import type { EditorMeshTarget } from '../../lib/brresEditor';
import type { VisualRendererScene } from '../visual/visualScene';

/** One model instance the viewport can pick, as `collectEditorSurfaceInstances` reports it. */
export interface SceneSurfaceInstance {
  archivePath: string;
  kind: 'course' | 'skybox' | 'object' | 'placed';
  objectId: number | null;
  objectName: string | null;
}

export interface MaterialRendererScene extends VisualRendererScene {
  /** Every model the viewport can pick: the course, the sky and each object preview. */
  collectEditorSurfaceInstances?: () => SceneSurfaceInstance[];
  /**
   * Re-parses one material out of edited BRRES bytes and swaps it into every live model instance
   * of that model, without rebuilding the scene. False when the scene has not loaded that
   * archive, model or material.
   */
  reloadEditorMaterial?: (archivePath: string, modelName: string, materialName: string, brres: Uint8Array) => boolean;
  /** Uploads a texture the archive did not have before. Falls back to a same-size pixel swap. */
  addEditorTexture?: (
    name: string,
    texture: { format: number; width: number; height: number; mipCount: number; data: Uint8Array },
  ) => boolean;
}

/** One draw call in the scene, as `listEditorMeshes` reports it. */
export interface SceneMeshEntry extends EditorMeshTarget {
  shapeName: string;
  materialName: string;
  nodeName: string;
  triangleCount: number;
}

/** Every draw call the scene draws with the named material. */
export function findMaterialMeshes(
  scene: MaterialRendererScene | null,
  archivePath: string,
  modelName: string,
  materialName: string,
): SceneMeshEntry[] {
  const meshes = (scene?.listEditorMeshes?.() ?? []) as SceneMeshEntry[];
  const wanted = normalizeArchivePath(archivePath);
  return meshes.filter(
    (mesh) =>
      normalizeArchivePath(mesh.archivePath) === wanted &&
      mesh.modelName === modelName &&
      mesh.materialName === materialName,
  );
}

/**
 * The renderer keys its archives by the U8 path with the `./` prefix the noclip reader uses; the
 * track document stores them without it. Compared case-insensitively, like everywhere else.
 */
export function normalizeArchivePath(path: string): string {
  return path.replace(/^\.\//, '').toLowerCase();
}

export function toSceneArchivePath(path: string): string {
  return path.startsWith('./') ? path : `./${path}`;
}

/** Highlights a material's meshes in the viewport; an empty list clears the highlight. */
export function highlightMaterialMeshes(scene: MaterialRendererScene | null, meshes: SceneMeshEntry[], selected: boolean): void {
  scene?.setEditorMeshHighlight?.(meshes.map((mesh) => ({ target: mesh, selected })));
}

/**
 * "Solo": hides every draw call that is not one of `meshes`. Passing an empty list puts every
 * mesh back. Uses the same per-draw visibility overrides Model mode edits with, so leaving the
 * mode has to call it with `[]` or the viewport stays soloed.
 */
export function soloMaterialMeshes(scene: MaterialRendererScene | null, meshes: SceneMeshEntry[]): void {
  if (!scene?.setEditorMeshVisible) return;
  const all = (scene.listEditorMeshes?.() ?? []) as SceneMeshEntry[];
  if (meshes.length === 0) {
    for (const mesh of all) scene.setEditorMeshVisible(mesh, true);
    return;
  }
  const keep = new Set(meshes.map(meshKey));
  for (const mesh of all) scene.setEditorMeshVisible(mesh, keep.has(meshKey(mesh)));
}

function meshKey(mesh: SceneMeshEntry): string {
  return `${normalizeArchivePath(mesh.archivePath)}|${mesh.modelName}|${mesh.drawOpIndex}|${mesh.shapeIndex}`;
}
