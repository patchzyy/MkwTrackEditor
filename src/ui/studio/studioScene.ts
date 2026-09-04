// The slice of the vendored `StudioScene` the studio UI drives, declared structurally — the same
// trick `materialScene.ts` and `visualScene.ts` use, so `src/ui` never imports a vendored type.
//
// Everything is optional so a partially built scene simply does nothing, and the studio degrades
// to "the picture is behind" rather than throwing.

import type { MaterialRendererScene, SceneMeshEntry } from '../material/materialScene';
import type { StudioAnimationKind } from './studioOutlinerModel';

export interface StudioSceneAnimation {
  kind: StudioAnimationKind;
  name: string;
  duration: number;
  loopMode: number;
  enabled: boolean;
  supported: boolean;
}

export interface StudioSceneModel {
  archivePath: string;
  modelName: string;
  visible: boolean;
  materialCount: number;
  shapeCount: number;
  nodeCount: number;
}

export interface StudioSceneArchive {
  archivePath: string;
  models: StudioSceneModel[];
  textureNames: string[];
  animations: StudioSceneAnimation[];
}

export interface StudioSceneBounds {
  center: { x: number; y: number; z: number };
  radius: number;
}

export interface StudioMeshPick extends SceneMeshEntry {
  hitPoint: { x: number; y: number; z: number };
  distance: number;
}

/**
 * `MaterialRendererScene` is the contract the material inspector and the shader graph already
 * drive; the studio scene implements it and adds loading, per-model visibility, the transport
 * and picking on top.
 */
export interface StudioRendererScene extends MaterialRendererScene {
  loadStudioArchive?: (archivePath: string, brres: Uint8Array) => StudioSceneArchive;
  unloadStudioArchive?: (archivePath: string) => boolean;
  listStudioArchives?: () => StudioSceneArchive[];
  setStudioModelVisible?: (archivePath: string, modelName: string, visible: boolean) => boolean;
  setStudioTransport?: (transport: { playing?: boolean; speed?: number; loop?: boolean }) => void;
  getStudioAnimationDuration?: () => number;
  getStudioBounds?: () => StudioSceneBounds | null;
  getStudioMeshBounds?: (target: SceneMeshEntry) => StudioSceneBounds | null;
  setStudioGridVisible?: (visible: boolean) => void;
  /** Changes when the animated pose changes; the browser probe uses it instead of pixels. */
  getStudioPoseSignature?: () => number;
  pickEditorMesh?: (normalizedX: number, normalizedY: number) => StudioMeshPick | null;
}

/** Every draw call in the studio drawn with one material. */
export function findStudioMaterialMeshes(
  scene: StudioRendererScene | null,
  archivePath: string,
  modelName: string,
  materialName: string,
): SceneMeshEntry[] {
  const meshes = (scene?.listEditorMeshes?.() ?? []) as SceneMeshEntry[];
  return meshes.filter(
    (mesh) => mesh.archivePath === archivePath && mesh.modelName === modelName && mesh.materialName === materialName,
  );
}

export function studioMeshKey(mesh: { archivePath: string; modelName: string; drawOpIndex: number }): string {
  return `${mesh.archivePath}|${mesh.modelName}|${mesh.drawOpIndex}`;
}
