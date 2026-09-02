import { describe, expect, it } from 'vitest';
import { mat4, vec3 } from 'gl-matrix';
import { createIdentityMeshTransform, type EditorMeshTarget } from '../../lib/brresEditor';
import { meshTransformFromGizmoPose, toMeshViewportTransformSelection } from '../../lib/brresRenderAdapter';
import { advancePreviewFrames, computePreviewCameraMatrix, toCameraFovY, MKW_FRAMES_PER_SECOND } from './cameraPlayback';
import {
  applyMeshSelectionClick,
  describeMeshPick,
  isMeshSelectionGizmoId,
  makeMeshSelectionEntry,
  meshSelectionGizmoId,
  meshSelectionKeyFromGizmoId,
  toMeshTarget,
  updateMeshSelectionTransform,
} from './meshSelection';

const target: EditorMeshTarget = {
  archivePath: './course_model.brres',
  modelName: 'course',
  shapeIndex: 4,
  drawOpIndex: 9,
  componentIndex: 2,
  nodeId: 0,
  granularity: 'component',
};

const pick = {
  ...target,
  shapeName: 'treeMesh',
  materialName: 'tree',
  nodeName: 'root',
  hitPoint: { x: 0, y: 0, z: 0 },
  distance: 10,
};

describe('mesh selection', () => {
  it('labels picks by granularity', () => {
    expect(describeMeshPick(pick)).toBe('treeMesh #3');
    expect(describeMeshPick({ ...pick, granularity: 'shape' })).toBe('treeMesh');
    expect(describeMeshPick({ ...pick, granularity: 'node' })).toBe('root');
  });

  it('drops the component index for non-component granularity', () => {
    expect(toMeshTarget(pick, 'shape').componentIndex).toBeNull();
    expect(toMeshTarget(pick, 'component').componentIndex).toBe(2);
  });

  it('replaces the selection on a plain click', () => {
    const a = makeMeshSelectionEntry(target, 'a', { x: 0, y: 0, z: 0 });
    const b = makeMeshSelectionEntry({ ...target, componentIndex: 3 }, 'b', { x: 0, y: 0, z: 0 });
    expect(applyMeshSelectionClick([a], b, false)).toEqual([b]);
  });

  it('toggles on shift-click', () => {
    const a = makeMeshSelectionEntry(target, 'a', { x: 0, y: 0, z: 0 });
    const b = makeMeshSelectionEntry({ ...target, componentIndex: 3 }, 'b', { x: 0, y: 0, z: 0 });
    expect(applyMeshSelectionClick([a], b, true)).toHaveLength(2);
    expect(applyMeshSelectionClick([a, b], b, true)).toEqual([a]);
  });

  it('clears the selection when clicking empty space', () => {
    const a = makeMeshSelectionEntry(target, 'a', { x: 0, y: 0, z: 0 });
    expect(applyMeshSelectionClick([a], null, false)).toEqual([]);
    expect(applyMeshSelectionClick([a], null, true)).toEqual([a]);
  });

  it('round-trips gizmo ids', () => {
    const entry = makeMeshSelectionEntry(target, 'a', { x: 0, y: 0, z: 0 });
    const id = meshSelectionGizmoId(entry);
    expect(isMeshSelectionGizmoId(id)).toBe(true);
    expect(meshSelectionKeyFromGizmoId(id)).toBe(entry.key);
    expect(isMeshSelectionGizmoId('CAME-2')).toBe(false);
  });

  it('updates a single entry transform', () => {
    const a = makeMeshSelectionEntry(target, 'a', { x: 0, y: 0, z: 0 });
    const b = makeMeshSelectionEntry({ ...target, componentIndex: 3 }, 'b', { x: 0, y: 0, z: 0 });
    const moved = { ...createIdentityMeshTransform(), translation: { x: 5, y: 0, z: 0 } };
    const next = updateMeshSelectionTransform([a, b], a.key, moved);
    expect(next[0].transform.translation.x).toBe(5);
    expect(next[1].transform.translation.x).toBe(0);
  });
});

describe('mesh gizmo bridging', () => {
  it('places the gizmo at centre + edit offset', () => {
    const selection = toMeshViewportTransformSelection(
      target,
      { x: 10, y: 20, z: 30 },
      { ...createIdentityMeshTransform(), translation: { x: 1, y: 2, z: 3 } },
      'tree',
      'editor-mesh::x',
    );
    expect(selection.position).toEqual({ x: 11, y: 22, z: 33 });
    expect(selection.rendererTarget).toMatchObject({ kind: 'editorMesh' });
  });

  it('turns an absolute gizmo pose back into a relative edit', () => {
    const transform = meshTransformFromGizmoPose(
      { x: 10, y: 20, z: 30 },
      { x: 14, y: 20, z: 30 },
      { x: 0, y: 45, z: 0 },
      { x: 2, y: 2, z: 2 },
    );
    expect(transform.translation).toEqual({ x: 4, y: 0, z: 0 });
    expect(transform.rotation.y).toBe(45);
    expect(transform.scale.x).toBe(2);
  });

  it('defaults rotation and scale when the gizmo has none', () => {
    const transform = meshTransformFromGizmoPose({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, undefined, undefined);
    expect(transform.rotation).toEqual({ x: 0, y: 0, z: 0 });
    expect(transform.scale).toEqual({ x: 1, y: 1, z: 1 });
  });
});

describe('camera playback', () => {
  it('puts the camera at the scaled pose position', () => {
    const matrix = computePreviewCameraMatrix(mat4.create(), {
      position: { x: 100, y: 200, z: 300 },
      target: { x: 100, y: 200, z: 400 },
      fovDegrees: 60,
      roll: 0,
    }, 0.1);
    expect(matrix[12]).toBeCloseTo(10, 6);
    expect(matrix[13]).toBeCloseTo(20, 6);
    expect(matrix[14]).toBeCloseTo(30, 6);
  });

  it('looks toward the view point', () => {
    const matrix = computePreviewCameraMatrix(mat4.create(), {
      position: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 0, z: 100 },
      fovDegrees: 60,
      roll: 0,
    }, 0.1);
    // gl-matrix targetTo puts -forward in the third column.
    const forward = vec3.fromValues(-matrix[8], -matrix[9], -matrix[10]);
    expect(forward[2]).toBeCloseTo(1, 5);
  });

  it('does not produce NaNs when position and target coincide', () => {
    const matrix = computePreviewCameraMatrix(mat4.create(), {
      position: { x: 5, y: 5, z: 5 },
      target: { x: 5, y: 5, z: 5 },
      fovDegrees: 60,
      roll: 0,
    }, 0.1);
    for (const value of matrix) expect(Number.isFinite(value)).toBe(true);
  });

  it('survives a straight-down view axis', () => {
    const matrix = computePreviewCameraMatrix(mat4.create(), {
      position: { x: 0, y: 100, z: 0 },
      target: { x: 0, y: 0, z: 0 },
      fovDegrees: 60,
      roll: 0,
    }, 0.1);
    for (const value of matrix) expect(Number.isFinite(value)).toBe(true);
  });

  it('clamps the field of view into a usable range', () => {
    expect(toCameraFovY(60)).toBeCloseTo(Math.PI / 3, 6);
    expect(toCameraFovY(0)).toBeGreaterThan(0);
    expect(toCameraFovY(1000)).toBeLessThan(Math.PI);
  });

  it('advances the clock at 60 fps and caps long stalls', () => {
    expect(MKW_FRAMES_PER_SECOND).toBe(60);
    expect(advancePreviewFrames(0, 100)).toBeCloseTo(6, 6);
    expect(advancePreviewFrames(10, 0)).toBe(10);
    // A stalled tab must not fast-forward the whole pan: the step is capped at 250ms.
    expect(advancePreviewFrames(0, 10_000)).toBeCloseTo(15, 6);
    expect(advancePreviewFrames(0, -5)).toBe(0);
  });
});
