import type { Vec3 } from './kmp';
import type { BrresEditorNode } from './brresEditor';

export interface ViewportTransformSelection {
  id: string;
  label: string;
  position: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  rendererTarget?: {
    kind: 'brresNode';
    archivePath: string;
    modelName: string;
    nodeId: number;
  };
}

export interface BrresViewportPreviewScene {
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
  if (!rotation || !scale || !selection.rendererTarget) return false;
  if (selection.rendererTarget.kind !== 'brresNode') return false;
  return scene?.updateEditorBrresNodeTransform?.(
    selection.rendererTarget.archivePath,
    selection.rendererTarget.modelName,
    selection.rendererTarget.nodeId,
    position,
    rotation,
    scale,
  ) ?? false;
}
