import { describe, expect, it, vi } from 'vitest';
import {
  buildBrresViewportBridge,
  syncBrresViewportTransformSelectionPreview,
  toSceneNodeViewportTransformSelection,
  toSceneNodeViewportTransformSelections,
} from './brresRenderAdapter';

describe('BRRES render adapter', () => {
  it('maps scene nodes into noclip viewport transform selections', () => {
    const node = {
      id: 'course_model.brres::node::course::7',
      archivePath: 'course_model.brres',
      modelName: 'course',
      name: 'road_joint',
      nodeId: 7,
      parentNodeId: 0,
      visible: true,
      billboardMode: 0,
      billboardRefNodeId: 0,
      sourceOffset: 0x120,
      transform: {
        scale: { x: 1, y: 2, z: 3 },
        rotation: { x: 10, y: 20, z: 30 },
        translation: { x: 100, y: 200, z: 300 },
      },
    };

    expect(toSceneNodeViewportTransformSelection(node)).toEqual({
      id: node.id,
      label: 'road_joint - course',
      position: node.transform.translation,
      rotation: node.transform.rotation,
      scale: node.transform.scale,
      rendererTarget: {
        kind: 'brresNode',
        archivePath: 'course_model.brres',
        modelName: 'course',
        nodeId: 7,
      },
    });
    expect(toSceneNodeViewportTransformSelections([node])).toHaveLength(1);
  });

  it('keeps BRRES preview-target routing in the app-side render adapter', () => {
    const updateEditorBrresNodeTransform = vi.fn(() => true);
    const selection = {
      id: 'course_model.brres::node::course::7',
      label: 'road_joint - course',
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 4, y: 5, z: 6 },
      scale: { x: 7, y: 8, z: 9 },
      rendererTarget: {
        kind: 'brresNode' as const,
        archivePath: 'course_model.brres',
        modelName: 'course',
        nodeId: 7,
      },
    };

    expect(
      syncBrresViewportTransformSelectionPreview(
        { updateEditorBrresNodeTransform },
        selection,
        selection.position,
        selection.rotation,
        selection.scale,
      ),
    ).toBe(true);
    expect(updateEditorBrresNodeTransform).toHaveBeenCalledWith(
      'course_model.brres',
      'course',
      7,
      selection.position,
      selection.rotation,
      selection.scale,
    );
    expect(syncBrresViewportTransformSelectionPreview(null, selection, selection.position)).toBe(false);
  });

  it('builds the model-mode viewport bridge from app-side archive-node state', () => {
    const node = {
      id: 'course_model.brres::node::course::7',
      archivePath: 'course_model.brres',
      modelName: 'course',
      name: 'road_joint',
      nodeId: 7,
      parentNodeId: 0,
      visible: true,
      sourceOffset: 0x120,
      billboardMode: 0,
      billboardRefNodeId: 0,
      transform: {
        scale: { x: 1, y: 2, z: 3 },
        rotation: { x: 10, y: 20, z: 30 },
        translation: { x: 100, y: 200, z: 300 },
      },
    };

    const bridge = buildBrresViewportBridge({
      modelModeActive: true,
      projectSelectionId: node.id,
      archiveNodesById: { [node.id]: node },
      archiveNodes: [node],
    });
    expect(bridge.selectedSceneNode).toBe(node);
    expect(bridge.transformSelection?.id).toBe(node.id);
    expect(bridge.transformSelections).toHaveLength(1);
    expect(
      buildBrresViewportBridge({
        modelModeActive: false,
        projectSelectionId: node.id,
        archiveNodesById: { [node.id]: node },
        archiveNodes: [node],
      }).transformSelections,
    ).toHaveLength(0);
  });
});
