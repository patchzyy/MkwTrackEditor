import type { Vec3 } from './kmp';
import type { BrresEditorNode, EditorMeshTarget, MeshSelectionGranularity, MeshTransform } from './brresEditor';

export interface ViewportTransformSelection {
  id: string;
  label: string;
  position: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  rendererTarget?: ViewportRendererTarget;
}

export type ViewportRendererTarget =
  | {
      kind: 'brresNode';
      archivePath: string;
      modelName: string;
      nodeId: number;
    }
  | {
      kind: 'editorMesh';
      target: EditorMeshTarget;
      /** Untransformed bounding-box centre of the mesh, in game units. */
      baseCenter: Vec3;
    };

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

export interface BrresViewportPreviewScene extends EditorMeshRendererScene {
  updateEditorBrresNodeTransform?: (
    archivePath: string,
    modelName: string,
    nodeId: number,
    translation: Vec3,
    rotation: Vec3,
    scale: Vec3,
  ) => boolean;
}

export interface BrresViewportBridgeState {
  selectedSceneNode: BrresEditorNode | null;
  transformSelection: ViewportTransformSelection | null;
  transformSelections: ViewportTransformSelection[];
}

export function toSceneNodeViewportTransformSelection(node: BrresEditorNode): ViewportTransformSelection {
  return {
    id: node.id,
    label: `${node.name} - ${node.modelName}`,
    position: node.transform.translation,
    rotation: node.transform.rotation,
    scale: node.transform.scale,
    rendererTarget: {
      kind: 'brresNode',
      archivePath: node.archivePath,
      modelName: node.modelName,
      nodeId: node.nodeId,
    },
  };
}

export function toSceneNodeViewportTransformSelections(nodes: BrresEditorNode[]): ViewportTransformSelection[] {
  return nodes.map(toSceneNodeViewportTransformSelection);
}

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

export function buildBrresViewportBridge({
  modelModeActive,
  projectSelectionId,
  archiveNodesById,
  archiveNodes,
}: {
  modelModeActive: boolean;
  projectSelectionId: string | null;
  archiveNodesById: Record<string, BrresEditorNode>;
  archiveNodes: BrresEditorNode[] | null | undefined;
}): BrresViewportBridgeState {
  const selectedSceneNode = projectSelectionId ? archiveNodesById[projectSelectionId] ?? null : null;
  return {
    selectedSceneNode,
    transformSelection: modelModeActive && selectedSceneNode ? toSceneNodeViewportTransformSelection(selectedSceneNode) : null,
    transformSelections: modelModeActive ? toSceneNodeViewportTransformSelections(archiveNodes ?? []) : [],
  };
}

export function syncBrresViewportTransformSelectionPreview(
  scene: BrresViewportPreviewScene | null,
  selection: ViewportTransformSelection,
  position: Vec3,
  rotation?: Vec3,
  scale?: Vec3,
): boolean {
  const rendererTarget = selection.rendererTarget;
  if (!rendererTarget) return false;
  if (rendererTarget.kind === 'editorMesh') {
    const transform = meshTransformFromGizmoPose(rendererTarget.baseCenter, position, rotation, scale);
    return scene?.setEditorMeshTransform?.(rendererTarget.target, { kind: 'trs', ...transform }) ?? false;
  }
  if (!rotation || !scale) return false;
  return scene?.updateEditorBrresNodeTransform?.(
    rendererTarget.archivePath,
    rendererTarget.modelName,
    rendererTarget.nodeId,
    position,
    rotation,
    scale,
  ) ?? false;
}
