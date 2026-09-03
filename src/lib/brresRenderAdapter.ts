import type { Vec3 } from './kmp';
import type { EditorMeshTarget, MeshSelectionGranularity, MeshTransform } from './brresEditor';

export interface ViewportTransformSelection {
  id: string;
  label: string;
  position: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  rendererTarget?: ViewportRendererTarget;
}

/**
 * What a gizmo drag drives in the renderer. Model mode used to move whole MDL0 bones as well;
 * that was superseded by per-mesh editing, so a mesh is now the only thing a gizmo can target.
 */
export interface ViewportRendererTarget {
  kind: 'editorMesh';
  target: EditorMeshTarget;
  /** Untransformed bounding-box centre of the mesh, in game units. */
  baseCenter: Vec3;
}

/** Shape of the mesh-editing API exposed by the noclip MKW scene. */
export interface EditorMeshRendererScene {
  setEditorMode?: (mode: 'kmp' | 'camera' | 'model' | 'visual') => void;
  pickEditorMesh?: (
    normalizedX: number,
    normalizedY: number,
    granularity?: MeshSelectionGranularity,
  ) => EditorMeshPickPayload | null;
  pickEditorMeshesInRect?: (
    normalizedX0: number,
    normalizedY0: number,
    normalizedX1: number,
    normalizedY1: number,
    granularity?: MeshSelectionGranularity,
  ) => EditorMeshPickPayload[];
  getEditorMeshComponentBounds?: (target: EditorMeshTarget) => EditorMeshBoundsPayload | null;
  getEditorMeshComponentCount?: (target: EditorMeshTarget) => number;
  setEditorMeshTransform?: (target: EditorMeshTarget, transform: EditorMeshTransformPayload | null) => boolean;
  setEditorMeshVisible?: (target: EditorMeshTarget, visible: boolean) => boolean;
  /** Replaces the duplicates of a mesh; each transform draws one more copy of it. */
  setEditorMeshCopies?: (target: EditorMeshTarget, transforms: EditorMeshTransformPayload[]) => boolean;
  setEditorMeshHighlight?: (targets: Array<{ target: EditorMeshTarget; selected: boolean }>) => void;
  clearEditorMeshEdits?: () => void;
  refreshEditorMeshSources?: () => void;
  listEditorMeshes?: () => Array<EditorMeshTarget & { shapeName: string; materialName: string; nodeName: string; triangleCount: number }>;
  addEditorModelInstance?: (device: unknown, brresBuffer: unknown, modelName: string | null, matrix: unknown) => string | null;
  updateEditorModelInstance?: (id: string, matrix: unknown) => boolean;
  setEditorModelInstanceVisible?: (id: string, visible: boolean) => boolean;
  removeEditorModelInstance?: (device: unknown, id: string) => boolean;
  listEditorModelInstances?: () => string[];
}

export interface EditorMeshPickPayload extends EditorMeshTarget {
  shapeName: string;
  materialName: string;
  nodeName: string;
  hitPoint: Vec3;
  distance: number;
}

export interface EditorMeshBoundsPayload {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  radius: number;
  triangleCount: number;
}

export type EditorMeshTransformPayload =
  | { kind: 'trs'; translation: Vec3; rotation: Vec3; scale: Vec3 }
  | { kind: 'matrix'; matrix: ArrayLike<number> };

/** Builds the gizmo target for a picked mesh. Its position is the mesh centre plus its edit offset. */
export function toMeshViewportTransformSelection(
  target: EditorMeshTarget,
  baseCenter: Vec3,
  transform: MeshTransform,
  label: string,
  id: string,
): ViewportTransformSelection {
  return {
    id,
    label,
    position: {
      x: baseCenter.x + transform.translation.x,
      y: baseCenter.y + transform.translation.y,
      z: baseCenter.z + transform.translation.z,
    },
    rotation: transform.rotation,
    scale: transform.scale,
    rendererTarget: { kind: 'editorMesh', target, baseCenter },
  };
}

/** Turns an absolute gizmo pose back into the mesh's relative edit transform. */
export function meshTransformFromGizmoPose(
  baseCenter: Vec3,
  position: Vec3,
  rotation: Vec3 | undefined,
  scale: Vec3 | undefined,
): MeshTransform {
  return {
    translation: { x: position.x - baseCenter.x, y: position.y - baseCenter.y, z: position.z - baseCenter.z },
    rotation: rotation ?? { x: 0, y: 0, z: 0 },
    scale: scale ?? { x: 1, y: 1, z: 1 },
  };
}

/** Pushes a live gizmo pose at the renderer so the mesh follows the drag before it is committed. */
export function syncBrresViewportTransformSelectionPreview(
  scene: EditorMeshRendererScene | null,
  selection: ViewportTransformSelection,
  position: Vec3,
  rotation?: Vec3,
  scale?: Vec3,
): boolean {
  const rendererTarget = selection.rendererTarget;
  if (!rendererTarget) return false;
  const transform = meshTransformFromGizmoPose(rendererTarget.baseCenter, position, rotation, scale);
  return scene?.setEditorMeshTransform?.(rendererTarget.target, { kind: 'trs', ...transform }) ?? false;
}
