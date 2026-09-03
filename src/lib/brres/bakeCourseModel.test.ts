// Baking Model-mode edits into a real `course_model.brres`.
//
// Every test here works on an actual track archive and checks the result two ways: with this
// module's own reader, and by re-parsing the output with the vendored noclip BRRES parser — an
// independent implementation of the format, and the one the viewport will have to render.

import { vec3 } from 'gl-matrix';
import { describe, expect, it } from 'vitest';
import { createIdentityMeshTransform, type EditorMeshTarget, type ImportedMesh, type MeshEdit } from '../brresEditor';
import { BRRES_MODELS_GROUP, BRRES_TEXTURES_GROUP, readBrresRaw } from './brresRaw';
import { bakeCourseModel } from './bakeCourseModel';
import { collectDrawOps, computeJointMatrices, readShapeGeometryCache } from './meshBake';
import {
  drawOpsOf,
  findObjectBrres,
  firstDifference,
  listCourseModels,
  openCourseModel,
  parseWithNoclip,
} from './brresFixtures.testdata';

const fixtures = listCourseModels(3);
const primary = fixtures[0];

function makeTarget(
  brres: Uint8Array,
  drawOpIndex: number,
  granularity: EditorMeshTarget['granularity'] = 'shape',
  componentIndex: number | null = null,
): EditorMeshTarget {
  const { modelName } = openCourseModel(brres);
  const ops = drawOpsOf(brres);
  const ref = ops[drawOpIndex];
  return {
    archivePath: './course_model.brres',
    modelName,
    shapeIndex: ref.op.shapeId,
    drawOpIndex,
    componentIndex,
    nodeId: ref.op.nodeId,
    granularity,
  };
}

function moveEdit(target: EditorMeshTarget, translation: { x: number; y: number; z: number }): MeshEdit {
  return { target, transform: { ...createIdentityMeshTransform(), translation }, visible: true, deleted: false };
}

/**
 * World-space bounding box of one draw call, in game units. The joint matrix matters: several
 * tracks hang their course model off a rotated root bone, so a move the user made along world Y
 * is stored along some other axis in the vertex array.
 */
function drawOpBounds(brres: Uint8Array, drawOpIndex: number) {
  const { editor } = openCourseModel(brres);
  const ops = collectDrawOps(editor);
  const joints = computeJointMatrices(editor);
  const shape = editor.getShape(ops[drawOpIndex].op.shapeId)!;
  const cache = readShapeGeometryCache(editor, shape, joints[shape.mtxIdx] ?? joints[0])!;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const point = vec3.create();
  for (let i = 0; i < cache.indices.length; i++) {
    const vertex = cache.indices[i];
    vec3.set(point, cache.localPositions[vertex * 3], cache.localPositions[vertex * 3 + 1], cache.localPositions[vertex * 3 + 2]);
    vec3.transformMat4(point, point, cache.joint);
    for (let axis = 0; axis < 3; axis++) {
      if (point[axis] < min[axis]) min[axis] = point[axis];
      if (point[axis] > max[axis]) max[axis] = point[axis];
    }
  }
  return { min, max };
}

/** Combined index of the draw call the bake appended, which lands at the end of its own list. */
function appendedDrawOpIndex(brres: Uint8Array, sourceDrawOpIndex: number): number {
  const ops = drawOpsOf(brres);
  const list = ops[sourceDrawOpIndex].list;
  let last = -1;
  ops.forEach((ref, index) => {
    if (ref.list === list) last = index;
  });
  return last;
}

/** Picks a draw call whose shape is not shared with any other draw call, so edits stay isolated. */
function findExclusiveDrawOp(brres: Uint8Array): number {
  const ops = drawOpsOf(brres);
  const uses = new Map<number, number>();
  for (const ref of ops) uses.set(ref.op.shapeId, (uses.get(ref.op.shapeId) ?? 0) + 1);
  const index = ops.findIndex((ref) => uses.get(ref.op.shapeId) === 1);
  return index >= 0 ? index : 0;
}

describe.skipIf(!primary)('bakeCourseModel', () => {
  it('leaves an unedited archive completely alone', () => {
    const result = bakeCourseModel(primary.data, { edits: [], importedMeshes: [] });
    expect(result.changed).toBe(false);
    expect(result.data).toBe(primary.data);
  });

  it('treats a neutral edit as no edit at all', () => {
    const target = makeTarget(primary.data, 0);
    const result = bakeCourseModel(primary.data, {
      edits: [{ target, transform: createIdentityMeshTransform(), visible: true, deleted: false }],
    });
    expect(result.changed).toBe(false);
    expect(firstDifference(primary.data, result.data)).toBe(-1);
  });

  for (const fixture of fixtures) {
    it(`moves a mesh in ${fixture.track} and keeps the archive readable`, async () => {
      const drawOpIndex = findExclusiveDrawOp(fixture.data);
      const before = drawOpBounds(fixture.data, drawOpIndex);
      const offset = { x: 500, y: 250, z: -125 };
      const result = bakeCourseModel(fixture.data, { edits: [moveEdit(makeTarget(fixture.data, drawOpIndex), offset)] });

      expect(result.changed).toBe(true);
      expect(result.transformedMeshes).toBe(1);
      expect(result.removedDrawOps).toBe(0);

      const after = drawOpBounds(result.data, drawOpIndex);
      // A pure translation moves the box by exactly the offset. The tolerance covers the
      // fixed-point vertex formats these models use.
      expect(after.min[0] - before.min[0]).toBeCloseTo(offset.x, 0);
      expect(after.min[1] - before.min[1]).toBeCloseTo(offset.y, 0);
      expect(after.min[2] - before.min[2]).toBeCloseTo(offset.z, 0);
      expect(after.max[0] - before.max[0]).toBeCloseTo(offset.x, 0);

      // Nothing else moved.
      const otherIndex = drawOpsOf(fixture.data).findIndex((_, index) => index !== drawOpIndex);
      if (otherIndex >= 0) {
        const otherBefore = drawOpBounds(fixture.data, otherIndex);
        const otherAfter = drawOpBounds(result.data, otherIndex);
        expect(otherAfter.min[0]).toBeCloseTo(otherBefore.min[0], 3);
      }

      const reparsed = await parseWithNoclip(result.data);
      expect(reparsed.mdl0.length).toBeGreaterThan(0);
      expect(reparsed.mdl0[0].shapes.length).toBe(openCourseModel(fixture.data).editor.listShapes().length);
    });
  }

  it('rotates and scales around the mesh centre', () => {
    const drawOpIndex = findExclusiveDrawOp(primary.data);
    const before = drawOpBounds(primary.data, drawOpIndex);
    const centreBefore = before.min.map((value, axis) => (value + before.max[axis]) / 2);
    const target = makeTarget(primary.data, drawOpIndex);
    const result = bakeCourseModel(primary.data, {
      edits: [{
        target,
        transform: { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        visible: true,
        deleted: false,
      }],
    });
    expect(result.changed).toBe(true);
    const after = drawOpBounds(result.data, drawOpIndex);
    const centreAfter = after.min.map((value, axis) => (value + after.max[axis]) / 2);
    // Rotating about the centre leaves the centre where it was.
    for (let axis = 0; axis < 3; axis++) {
      expect(Math.abs(centreAfter[axis] - centreBefore[axis])).toBeLessThan(Math.max(2, Math.abs(centreBefore[axis]) * 0.01) + 1);
    }
    // ...and swaps the X and Z extents.
    expect(after.max[0] - after.min[0]).toBeCloseTo(before.max[2] - before.min[2], 0);
  });

  it('deletes a mesh by dropping its draw call', async () => {
    const drawOpIndex = findExclusiveDrawOp(primary.data);
    const target = makeTarget(primary.data, drawOpIndex);
    const before = drawOpsOf(primary.data);
    const result = bakeCourseModel(primary.data, {
      edits: [{ target, transform: createIdentityMeshTransform(), visible: true, deleted: true }],
    });
    expect(result.changed).toBe(true);
    expect(result.removedDrawOps).toBe(1);

    const after = drawOpsOf(result.data);
    expect(after.length).toBe(before.length - 1);
    expect(after.some((ref) => ref.op.shapeId === before[drawOpIndex].op.shapeId)).toBe(false);

    const reparsed = await parseWithNoclip(result.data);
    expect(reparsed.mdl0.length).toBeGreaterThan(0);
  });

  it('hides a mesh the same way it deletes one', () => {
    const drawOpIndex = findExclusiveDrawOp(primary.data);
    const target = makeTarget(primary.data, drawOpIndex);
    const result = bakeCourseModel(primary.data, {
      edits: [{ target, transform: createIdentityMeshTransform(), visible: false, deleted: false }],
    });
    expect(result.removedDrawOps).toBe(1);
    expect(drawOpsOf(result.data).length).toBe(drawOpsOf(primary.data).length - 1);
  });

  it('duplicates a mesh into a new shape and draw call', async () => {
    const drawOpIndex = findExclusiveDrawOp(primary.data);
    const shapesBefore = openCourseModel(primary.data).editor.listShapes().length;
    const opsBefore = drawOpsOf(primary.data).length;
    const boundsBefore = drawOpBounds(primary.data, drawOpIndex);

    const copy: ImportedMesh = {
      id: 'copy-1',
      sourcePath: './course_model.brres',
      modelName: openCourseModel(primary.data).modelName,
      label: 'Copy of mesh',
      transform: { ...createIdentityMeshTransform(), translation: { x: 1000, y: 0, z: 0 } },
      visible: true,
      sourceShape: makeTarget(primary.data, drawOpIndex),
    };
    const result = bakeCourseModel(primary.data, { importedMeshes: [copy] });
    expect(result.changed).toBe(true);
    expect(result.addedMeshes).toBe(1);

    const shapes = openCourseModel(result.data).editor.listShapes();
    const ops = drawOpsOf(result.data);
    expect(shapes.length).toBe(shapesBefore + 1);
    expect(ops.length).toBe(opsBefore + 1);

    // The copy sits 1000 units along X from the original, and the original has not moved.
    const originalAfter = drawOpBounds(result.data, drawOpIndex);
    expect(originalAfter.min[0]).toBeCloseTo(boundsBefore.min[0], 3);
    const copyBounds = drawOpBounds(result.data, appendedDrawOpIndex(result.data, drawOpIndex));
    expect(copyBounds.min[0] - boundsBefore.min[0]).toBeCloseTo(1000, 0);

    const reparsed = await parseWithNoclip(result.data);
    expect(reparsed.mdl0[0].shapes.length).toBe(shapesBefore + 1);
  });

  it('combines a move, a delete and a duplicate in one pass', async () => {
    const ops = drawOpsOf(primary.data);
    const uses = new Map<number, number>();
    for (const ref of ops) uses.set(ref.op.shapeId, (uses.get(ref.op.shapeId) ?? 0) + 1);
    const exclusive = ops.map((ref, index) => ({ ref, index })).filter((entry) => uses.get(entry.ref.op.shapeId) === 1);
    if (exclusive.length < 2) return;
    const [moved, deleted] = exclusive;

    const result = bakeCourseModel(primary.data, {
      edits: [
        moveEdit(makeTarget(primary.data, moved.index), { x: 0, y: 400, z: 0 }),
        {
          target: makeTarget(primary.data, deleted.index),
          transform: createIdentityMeshTransform(),
          visible: true,
          deleted: true,
        },
      ],
      importedMeshes: [{
        id: 'copy-2',
        sourcePath: './course_model.brres',
        modelName: openCourseModel(primary.data).modelName,
        transform: { ...createIdentityMeshTransform(), translation: { x: 0, y: 0, z: 800 } },
        visible: true,
        sourceShape: makeTarget(primary.data, moved.index),
      }],
    });

    expect(result.transformedMeshes).toBe(1);
    expect(result.removedDrawOps).toBe(1);
    expect(result.addedMeshes).toBe(1);
    // One op removed, one appended.
    expect(drawOpsOf(result.data).length).toBe(ops.length);
    const reparsed = await parseWithNoclip(result.data);
    expect(reparsed.mdl0.length).toBe(1);
  });

  it('reports an edit that no longer points at anything', () => {
    const target = makeTarget(primary.data, 0);
    const result = bakeCourseModel(primary.data, {
      edits: [moveEdit({ ...target, drawOpIndex: 9999 }, { x: 10, y: 0, z: 0 })],
    });
    expect(result.warnings.some((warning) => warning.code === 'model.edit-unmatched')).toBe(true);
  });

  it('leaves an import out and says so when its file is missing', () => {
    const result = bakeCourseModel(primary.data, {
      importedMeshes: [{
        id: 'missing',
        sourcePath: 'itembox.brres',
        modelName: '',
        label: 'Item Box',
        transform: createIdentityMeshTransform(),
        visible: true,
      }],
      importSources: new Map(),
    });
    expect(result.addedMeshes).toBe(0);
    expect(result.warnings.some((warning) => warning.code === 'model.import-missing')).toBe(true);
  });
});

const objectBrres = findObjectBrres(['itembox.brres', 'DokanSFC.brres', 'kuribo.brres', 'WLwallGC.brres']);

describe.skipIf(!primary || !objectBrres)('bakeCourseModel imports', () => {
  it('merges an object model into the course model as real geometry', async () => {
    const shapesBefore = openCourseModel(primary.data).editor.listShapes().length;
    const opsBefore = drawOpsOf(primary.data).length;
    const texturesBefore = readBrresRaw(primary.data).groups.find((group) => group.name === BRRES_TEXTURES_GROUP)?.entries.length ?? 0;

    const mesh: ImportedMesh = {
      id: 'import-1',
      sourcePath: objectBrres!.name,
      modelName: '',
      label: objectBrres!.name,
      transform: { ...createIdentityMeshTransform(), translation: { x: 0, y: 3000, z: 0 } },
      visible: true,
    };
    const result = bakeCourseModel(primary.data, {
      importedMeshes: [mesh],
      importSources: new Map([[objectBrres!.name, objectBrres!.data]]),
    });

    expect(result.changed).toBe(true);
    expect(result.addedMeshes).toBe(1);

    const shapesAfter = openCourseModel(result.data).editor.listShapes().length;
    const opsAfter = drawOpsOf(result.data).length;
    expect(shapesAfter).toBeGreaterThan(shapesBefore);
    expect(opsAfter).toBeGreaterThan(opsBefore);

    // The imported geometry landed 3000 units up, where it was placed.
    const placed = drawOpBounds(result.data, appendedDrawOpIndex(result.data, opsBefore - 1));
    expect(placed.max[1]).toBeGreaterThan(1000);

    const raw = readBrresRaw(result.data);
    const textures = raw.groups.find((group) => group.name === BRRES_TEXTURES_GROUP)?.entries.length ?? 0;
    expect(textures).toBeGreaterThanOrEqual(texturesBefore);

    // The console binds textures through the MDL0 texture-link section, so the new materials
    // have to appear there or the surface renders untextured on hardware.
    const { editor } = openCourseModel(result.data);
    const linkNames = new Set(editor.getDic('texture')?.entries.map((entry) => entry.name) ?? []);
    for (const name of result.addedTextures) expect(linkNames.has(name)).toBe(true);

    const reparsed = await parseWithNoclip(result.data);
    expect(reparsed.mdl0[0].shapes.length).toBe(shapesAfter);
    // Every material the merged model added must resolve its samplers by name in the new archive.
    const textureNames = new Set(reparsed.tex0.map((tex: { name: string }) => tex.name));
    for (const name of result.addedTextures) expect(textureNames.has(name)).toBe(true);
  });

  it('shares one copy of a texture between two placements of the same object', () => {
    const source = new Map([[objectBrres!.name, objectBrres!.data]]);
    const place = (id: string, y: number): ImportedMesh => ({
      id,
      sourcePath: objectBrres!.name,
      modelName: '',
      transform: { ...createIdentityMeshTransform(), translation: { x: 0, y, z: 0 } },
      visible: true,
    });
    const one = bakeCourseModel(primary.data, { importedMeshes: [place('a', 3000)], importSources: source });
    const two = bakeCourseModel(primary.data, {
      importedMeshes: [place('a', 3000), place('b', 4000)],
      importSources: source,
    });
    expect(two.addedMeshes).toBe(2);
    expect(two.addedTextures.length).toBe(one.addedTextures.length);
  });
});
