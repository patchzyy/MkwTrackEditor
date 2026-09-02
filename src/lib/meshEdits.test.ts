import { describe, expect, it } from 'vitest';
import {
  addImportedMesh,
  createIdentityMeshTransform,
  findMeshEdit,
  isNeutralMeshEdit,
  meshTargetEquals,
  meshTargetKey,
  narrowMeshGranularity,
  removeImportedMesh,
  removeMeshEdit,
  retargetMeshGranularity,
  updateImportedMesh,
  upsertMeshEdit,
  widenMeshGranularity,
  type EditorMeshTarget,
  type ImportedMesh,
} from './brresEditor';

function makeTarget(overrides: Partial<EditorMeshTarget> = {}): EditorMeshTarget {
  return {
    archivePath: './course_model.brres',
    modelName: 'course',
    shapeIndex: 3,
    drawOpIndex: 12,
    componentIndex: 5,
    nodeId: 0,
    granularity: 'component',
    ...overrides,
  };
}

describe('mesh target identity', () => {
  it('keys component targets by component index', () => {
    expect(meshTargetKey(makeTarget())).not.toBe(meshTargetKey(makeTarget({ componentIndex: 6 })));
  });

  it('ignores the component index for shape targets', () => {
    const a = makeTarget({ granularity: 'shape', componentIndex: null });
    const b = makeTarget({ granularity: 'shape', componentIndex: 9 });
    expect(meshTargetEquals(a, b)).toBe(true);
  });

  it('keys node targets by node id only', () => {
    const a = makeTarget({ granularity: 'node', shapeIndex: 1, drawOpIndex: 2, nodeId: 4 });
    const b = makeTarget({ granularity: 'node', shapeIndex: 9, drawOpIndex: 8, nodeId: 4 });
    expect(meshTargetEquals(a, b)).toBe(true);
    expect(meshTargetEquals(a, makeTarget({ granularity: 'node', nodeId: 5 }))).toBe(false);
  });

  it('is case-insensitive on the archive path', () => {
    expect(meshTargetEquals(makeTarget(), makeTarget({ archivePath: './COURSE_MODEL.BRRES' }))).toBe(true);
  });

  it('treats null targets as unequal to real ones', () => {
    expect(meshTargetEquals(null, makeTarget())).toBe(false);
    expect(meshTargetEquals(null, null)).toBe(true);
  });
});

describe('granularity widening', () => {
  it('widens component -> shape -> node', () => {
    expect(widenMeshGranularity('component')).toBe('shape');
    expect(widenMeshGranularity('shape')).toBe('node');
    expect(widenMeshGranularity('node')).toBe('node');
  });

  it('narrows node -> shape -> component', () => {
    expect(narrowMeshGranularity('node')).toBe('shape');
    expect(narrowMeshGranularity('shape')).toBe('component');
    expect(narrowMeshGranularity('component')).toBe('component');
  });

  it('drops the component index when widening a target', () => {
    expect(retargetMeshGranularity(makeTarget(), 'shape').componentIndex).toBeNull();
    expect(retargetMeshGranularity(makeTarget(), 'component').componentIndex).toBe(5);
  });
});

describe('mesh edit list', () => {
  const target = makeTarget();

  it('records a transform', () => {
    const transform = { ...createIdentityMeshTransform(), translation: { x: 10, y: 0, z: 0 } };
    const edits = upsertMeshEdit([], target, { transform });
    expect(edits).toHaveLength(1);
    expect(findMeshEdit(edits, target)?.transform.translation.x).toBe(10);
  });

  it('replaces an existing edit in place', () => {
    const first = upsertMeshEdit([], target, { visible: false });
    const second = upsertMeshEdit(first, target, { deleted: true });
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ visible: false, deleted: true });
  });

  it('drops edits that go back to neutral', () => {
    const hidden = upsertMeshEdit([], target, { visible: false });
    const restored = upsertMeshEdit(hidden, target, { visible: true });
    expect(restored).toHaveLength(0);
  });

  it('keeps unrelated edits when removing one', () => {
    const other = makeTarget({ componentIndex: 6 });
    const edits = upsertMeshEdit(upsertMeshEdit([], target, { deleted: true }), other, { deleted: true });
    expect(removeMeshEdit(edits, target)).toHaveLength(1);
  });

  it('recognises neutral edits', () => {
    expect(isNeutralMeshEdit({ target, transform: createIdentityMeshTransform(), visible: true, deleted: false })).toBe(true);
    expect(isNeutralMeshEdit({ target, transform: createIdentityMeshTransform(), visible: true, deleted: true })).toBe(false);
  });
});

describe('imported meshes', () => {
  const mesh: ImportedMesh = {
    id: 'imported-1',
    sourcePath: './itembox.brres',
    modelName: 'itembox',
    transform: createIdentityMeshTransform(),
    visible: true,
  };

  it('adds and replaces by id', () => {
    const once = addImportedMesh([], mesh);
    const twice = addImportedMesh(once, { ...mesh, modelName: 'other' });
    expect(twice).toHaveLength(1);
    expect(twice[0].modelName).toBe('other');
  });

  it('removes by id', () => {
    expect(removeImportedMesh(addImportedMesh([], mesh), 'imported-1')).toHaveLength(0);
  });

  it('patches by id', () => {
    const updated = updateImportedMesh(addImportedMesh([], mesh), 'imported-1', { visible: false });
    expect(updated[0].visible).toBe(false);
  });
});
