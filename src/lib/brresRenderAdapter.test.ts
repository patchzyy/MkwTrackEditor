import { describe, expect, it, vi } from 'vitest';
import {
  meshTransformFromGizmoPose,
  syncBrresViewportTransformSelectionPreview,
  toMeshViewportTransformSelection,
} from './brresRenderAdapter';
import type { EditorMeshTarget } from './brresEditor';

const target: EditorMeshTarget = {
  archivePath: './course_model.brres',
  modelName: 'course',
  shapeIndex: 4,
  drawOpIndex: 11,
  componentIndex: 2,
  nodeId: 0,
  granularity: 'component',
};

const baseCenter = { x: 100, y: 200, z: 300 };

describe('BRRES render adapter', () => {
  it('puts the gizmo at the mesh centre plus the edit offset', () => {
    const selection = toMeshViewportTransformSelection(
      target,
      baseCenter,
      { translation: { x: 5, y: -10, z: 15 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 2, y: 2, z: 2 } },
      'Tree',
      'mesh-1',
    );

    expect(selection.id).toBe('mesh-1');
    expect(selection.label).toBe('Tree');
    expect(selection.position).toEqual({ x: 105, y: 190, z: 315 });
    expect(selection.rotation).toEqual({ x: 0, y: 90, z: 0 });
    expect(selection.scale).toEqual({ x: 2, y: 2, z: 2 });
    expect(selection.rendererTarget).toEqual({ kind: 'editorMesh', target, baseCenter });
  });

  it('turns an absolute gizmo pose back into the mesh-relative transform', () => {
    expect(meshTransformFromGizmoPose(baseCenter, { x: 105, y: 190, z: 315 }, { x: 0, y: 90, z: 0 }, { x: 2, y: 2, z: 2 })).toEqual({
      translation: { x: 5, y: -10, z: 15 },
      rotation: { x: 0, y: 90, z: 0 },
      scale: { x: 2, y: 2, z: 2 },
    });
  });

  it('defaults a missing rotation and scale rather than writing undefined at the renderer', () => {
    expect(meshTransformFromGizmoPose(baseCenter, { x: 100, y: 200, z: 300 }, undefined, undefined)).toEqual({
      translation: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
  });

  it('pushes a drag preview at the scene as a relative TRS transform', () => {
    const setEditorMeshTransform = vi.fn(() => true);
    const selection = toMeshViewportTransformSelection(
      target,
      baseCenter,
      { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      'Tree',
      'mesh-1',
    );

    expect(
      syncBrresViewportTransformSelectionPreview(
        { setEditorMeshTransform },
        selection,
        { x: 110, y: 200, z: 300 },
        { x: 0, y: 45, z: 0 },
        { x: 1, y: 1, z: 1 },
      ),
    ).toBe(true);
    expect(setEditorMeshTransform).toHaveBeenCalledWith(target, {
      kind: 'trs',
      translation: { x: 10, y: 0, z: 0 },
      rotation: { x: 0, y: 45, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
  });

  it('does nothing when there is no scene or no renderer target', () => {
    const selection = toMeshViewportTransformSelection(
      target,
      baseCenter,
      { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      'Tree',
      'mesh-1',
    );
    expect(syncBrresViewportTransformSelectionPreview(null, selection, baseCenter)).toBe(false);
    expect(
      syncBrresViewportTransformSelectionPreview({ setEditorMeshTransform: vi.fn(() => true) }, { ...selection, rendererTarget: undefined }, baseCenter),
    ).toBe(false);
  });
});
