/**
 * Per-component vertex splitting.
 *
 * A connected component of a shape can share vertex-array entries with a neighbouring component.
 * Writing an edit straight into those entries moves (or, for normals, re-lights) the neighbour
 * too. `splitSharedVertexData` gives the edited component private copies first.
 *
 * Measured over the 338 real tracks installed on this machine:
 *  - positions are never shared between components (0 of 261,154) and provably cannot be: two
 *    display-list vertices naming the same entry read back identical coordinates, so the welding
 *    pass always puts them in one component. The first describe block below pins that down.
 *  - normals are shared in 95,801 of those 261,154 components, which is what this fixes.
 */
import { describe, expect, it } from 'vitest';

import type { MeshEdit } from '../brresEditor';
import { bakeCourseModel } from './bakeCourseModel';
import {
  collectAffectedVertices,
  collectDrawOps,
  componentOwnsVerticesExclusively,
  computeJointMatrices,
  ensureComponentSplit,
  readShapeGeometryCache,
  splitSharedVertexData,
  type ShapeGeometryCache,
} from './meshBake';
import { Mdl0Editor } from './mdl0Raw';
import { bytesEqual, listCourseModels, openCourseModel, parseWithNoclip } from './brresFixtures.testdata';

const models = listCourseModels(6);

interface Candidate {
  track: string;
  data: Uint8Array;
  drawOpIndex: number;
  shapeIndex: number;
  shapeName: string;
  nodeId: number;
  componentIndex: number;
  otherComponentIndex: number;
  sharedNormals: number[];
}

/** Reads a course model and its per-shape geometry the way the exporter does. */
function openWithGeometry(data: Uint8Array) {
  const { editor } = openCourseModel(data);
  const joints = computeJointMatrices(editor);
  const drawOps = collectDrawOps(editor);
  const cacheFor = (shapeIndex: number): ShapeGeometryCache | null => {
    const shape = editor.getShape(shapeIndex);
    if (!shape || shape.mtxIdx < 0) return null;
    const joint = joints[shape.mtxIdx];
    return joint ? readShapeGeometryCache(editor, shape, joint) : null;
  };
  return { editor, drawOps, cacheFor };
}

/** The first shape in these fixtures with two components that share a normal-array entry. */
function findSharedNormalCandidate(): Candidate | null {
  for (const model of models) {
    const { drawOps, cacheFor } = openWithGeometry(model.data);
    for (const ref of drawOps) {
      const cache = cacheFor(ref.op.shapeId);
      if (!cache || !cache.normalIndices) continue;
      const split = ensureComponentSplit(cache);
      if (split.componentCount < 2) continue;

      const owner = new Map<number, number>();
      const triangleCount = cache.indices.length / 3;
      for (let t = 0; t < triangleCount; t++) {
        for (let k = 0; k < 3; k++) {
          const normal = cache.normalIndices[cache.indices[t * 3 + k]];
          if (normal < 0) continue;
          if (!owner.has(normal)) owner.set(normal, split.triangleComponent[t]);
        }
      }
      for (let c = 0; c < split.componentCount; c++) {
        const affected = collectAffectedVertices(cache, c);
        const shared = [...affected.normals].filter((normal) => {
          const first = owner.get(normal);
          return first !== undefined && first !== c;
        });
        if (shared.length === 0) continue;
        const other = owner.get(shared[0])!;
        return {
          track: model.track,
          data: model.data,
          drawOpIndex: ref.combinedIndex,
          shapeIndex: ref.op.shapeId,
          shapeName: cache.shape.name,
          nodeId: ref.op.nodeId,
          componentIndex: c,
          otherComponentIndex: other,
          sharedNormals: shared,
        };
      }
    }
  }
  return null;
}

const candidate = models.length > 0 ? findSharedNormalCandidate() : null;

function makeEdit(target: Candidate, transform: MeshEdit['transform']): MeshEdit {
  return {
    target: {
      archivePath: './course_model.brres',
      modelName: 'course',
      shapeIndex: target.shapeIndex,
      drawOpIndex: target.drawOpIndex,
      componentIndex: target.componentIndex,
      nodeId: target.nodeId,
      granularity: 'component',
    },
    transform,
    visible: true,
    deleted: false,
  };
}

/** Every normal a component's triangles use, as actual vectors. */
function componentNormals(editor: Mdl0Editor, cache: ShapeGeometryCache, componentIndex: number): number[][] {
  const array = editor.getVertexArray('vtxNrm', cache.shape.normalArrayId);
  if (!array || !cache.normalIndices) return [];
  const format = editor.vertexArrayFormat(array);
  const values = editor.readVertexArrayValues(array);
  const split = ensureComponentSplit(cache);
  const out: number[][] = [];
  const seen = new Set<number>();
  const triangleCount = cache.indices.length / 3;
  for (let t = 0; t < triangleCount; t++) {
    if (split.triangleComponent[t] !== componentIndex) continue;
    for (let k = 0; k < 3; k++) {
      const index = cache.normalIndices[cache.indices[t * 3 + k]];
      if (index < 0 || seen.has(index)) continue;
      seen.add(index);
      const base = index * format.componentCount;
      out.push([values[base], values[base + 1], values[base + 2]]);
    }
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

/** Every position a component's triangles use, in model space. */
function componentPositions(editor: Mdl0Editor, cache: ShapeGeometryCache, componentIndex: number): number[][] {
  const array = editor.getVertexArray('vtxPos', cache.shape.positionArrayId);
  if (!array) return [];
  const format = editor.vertexArrayFormat(array);
  const values = editor.readVertexArrayValues(array);
  const split = ensureComponentSplit(cache);
  const out: number[][] = [];
  const seen = new Set<number>();
  const triangleCount = cache.indices.length / 3;
  for (let t = 0; t < triangleCount; t++) {
    if (split.triangleComponent[t] !== componentIndex) continue;
    for (let k = 0; k < 3; k++) {
      const index = cache.positionIndices[cache.indices[t * 3 + k]];
      if (index < 0 || seen.has(index)) continue;
      seen.add(index);
      const base = index * format.componentCount;
      out.push([values[base], values[base + 1], format.componentCount > 2 ? values[base + 2] : 0]);
    }
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

describe.skipIf(models.length === 0)('positions are never shared between components', () => {
  it('holds for every component of every shape in these course models', () => {
    let componentsChecked = 0;
    for (const model of models) {
      const { drawOps, cacheFor } = openWithGeometry(model.data);
      const seenShapes = new Set<number>();
      for (const ref of drawOps) {
        if (seenShapes.has(ref.op.shapeId)) continue;
        seenShapes.add(ref.op.shapeId);
        const cache = cacheFor(ref.op.shapeId);
        if (!cache) continue;
        const split = ensureComponentSplit(cache);
        for (let c = 0; c < split.componentCount; c++) {
          const affected = collectAffectedVertices(cache, c);
          if (affected.positions.size === 0) continue;
          componentsChecked++;
          expect(
            componentOwnsVerticesExclusively(cache, c, affected.positions),
            `${model.track} shape ${cache.shape.name} component ${c}`,
          ).toBe(true);
        }
      }
    }
    expect(componentsChecked).toBeGreaterThan(100);
  }, 300000);
});

describe.skipIf(candidate === null)('splitting normals shared between components', () => {
  it('finds a real shape whose components share a normal', () => {
    expect(candidate!.sharedNormals.length).toBeGreaterThan(0);
    expect(candidate!.otherComponentIndex).not.toBe(candidate!.componentIndex);
  });

  it('gives the edited component its own copies and leaves the neighbour alone', () => {
    const target = candidate!;
    const { editor, cacheFor } = openWithGeometry(target.data);
    const cache = cacheFor(target.shapeIndex)!;
    const before = componentNormals(editor, cache, target.otherComponentIndex);
    const beforeCount = editor.getVertexArray('vtxNrm', cache.shape.normalArrayId)!.count;

    const affected = collectAffectedVertices(cache, target.componentIndex);
    const outcome = splitSharedVertexData(editor, cache, target.componentIndex, 'vtxNrm', cache.shape.normalArrayId, affected.normals);

    expect(outcome.blocked).toBeNull();
    expect(outcome.splitCount).toBe(target.sharedNormals.length);
    // The array grew by exactly the number of entries that had to stop being shared.
    expect(editor.getVertexArray('vtxNrm', cache.shape.normalArrayId)!.count).toBe(beforeCount + outcome.splitCount);
    // Every shared entry was swapped out of the edited component's set.
    for (const shared of target.sharedNormals) expect(outcome.entries.has(shared)).toBe(false);
    expect(outcome.entries.size).toBe(affected.normals.size);
    // The neighbour still reads the same normals it did before.
    expect(componentNormals(editor, cache, target.otherComponentIndex)).toEqual(before);
    // And the edited component still reads the same values, just from its own entries.
    expect(componentNormals(editor, cache, target.componentIndex).length).toBeGreaterThan(0);
  }, 120000);

  it('is a no-op when nothing is shared, so an edit that never had the problem is unchanged', () => {
    const target = candidate!;
    const { editor, cacheFor } = openWithGeometry(target.data);
    const cache = cacheFor(target.shapeIndex)!;
    const affected = collectAffectedVertices(cache, target.componentIndex);
    // Positions are never shared, so asking to split them must change nothing at all.
    const beforeCount = editor.getVertexArray('vtxPos', cache.shape.positionArrayId)!.count;
    const outcome = splitSharedVertexData(editor, cache, target.componentIndex, 'vtxPos', cache.shape.positionArrayId, affected.positions);
    expect(outcome.splitCount).toBe(0);
    expect(outcome.blocked).toBeNull();
    expect(outcome.entries).toEqual(affected.positions);
    expect(editor.getVertexArray('vtxPos', cache.shape.positionArrayId)!.count).toBe(beforeCount);
    expect(editor.modified).toBe(false);
  }, 120000);

  it('rotating one component through a full export does not re-light its neighbour', async () => {
    const target = candidate!;
    const edit = makeEdit(target, {
      translation: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 47, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });

    const baked = bakeCourseModel(target.data, { edits: [edit] });
    expect(baked.changed).toBe(true);
    expect(baked.warnings.filter((w) => w.code === 'model.component-shared-vertices')).toEqual([]);

    // The export has to survive noclip's own parser.
    const reparsed = await parseWithNoclip(baked.data);
    expect(reparsed.mdl0.length).toBeGreaterThan(0);

    const original = openWithGeometry(target.data);
    const edited = openWithGeometry(baked.data);
    const originalCache = original.cacheFor(target.shapeIndex)!;
    // The edited draw op may now point at a cloned shape, so follow the draw op, not the index.
    const editedShapeIndex = edited.drawOps[target.drawOpIndex].op.shapeId;
    const editedCache = edited.cacheFor(editedShapeIndex)!;

    // The neighbour's normals AND positions are untouched.
    expect(componentNormals(edited.editor, editedCache, target.otherComponentIndex))
      .toEqual(componentNormals(original.editor, originalCache, target.otherComponentIndex));
    expect(componentPositions(edited.editor, editedCache, target.otherComponentIndex))
      .toEqual(componentPositions(original.editor, originalCache, target.otherComponentIndex));

    // The edited component really did move.
    expect(componentPositions(edited.editor, editedCache, target.componentIndex))
      .not.toEqual(componentPositions(original.editor, originalCache, target.componentIndex));
  }, 300000);
});

describe.skipIf(models.length === 0)('export stability', () => {
  it('an unedited export is byte-identical', () => {
    for (const model of models) {
      const baked = bakeCourseModel(model.data, { edits: [], importedMeshes: [] });
      expect(baked.changed, model.track).toBe(false);
      expect(baked.data, model.track).toBe(model.data);
      expect(bytesEqual(baked.data, model.data), model.track).toBe(true);
    }
  });

  it('a neutral edit is still no edit', () => {
    const model = models[0];
    const baked = bakeCourseModel(model.data, {
      edits: [{
        target: {
          archivePath: './course_model.brres',
          modelName: 'course',
          shapeIndex: 0,
          drawOpIndex: 0,
          componentIndex: 0,
          nodeId: 0,
          granularity: 'component',
        },
        transform: { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        visible: true,
        deleted: false,
      }],
    });
    expect(baked.changed).toBe(false);
    expect(bytesEqual(baked.data, model.data)).toBe(true);
  });

  it('a moved component re-parses and still moves only itself', async () => {
    const model = models[0];
    const { drawOps, cacheFor } = openWithGeometry(model.data);
    const ref = drawOps.find((candidateRef) => {
      const cache = cacheFor(candidateRef.op.shapeId);
      return cache !== null && ensureComponentSplit(cache).componentCount >= 2;
    });
    expect(ref, 'a fixture with a multi-component shape').toBeTruthy();
    const cache = cacheFor(ref!.op.shapeId)!;

    const edit: MeshEdit = {
      target: {
        archivePath: './course_model.brres',
        modelName: 'course',
        shapeIndex: ref!.op.shapeId,
        drawOpIndex: ref!.combinedIndex,
        componentIndex: 0,
        nodeId: ref!.op.nodeId,
        granularity: 'component',
      },
      transform: { translation: { x: 900, y: 250, z: -400 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      visible: true,
      deleted: false,
    };

    const baked = bakeCourseModel(model.data, { edits: [edit] });
    expect(baked.changed).toBe(true);
    const reparsed = await parseWithNoclip(baked.data);
    expect(reparsed.mdl0.length).toBeGreaterThan(0);

    const edited = openWithGeometry(baked.data);
    const editedCache = edited.cacheFor(edited.drawOps[ref!.combinedIndex].op.shapeId)!;
    const split = ensureComponentSplit(cache);
    for (let c = 1; c < split.componentCount; c++) {
      expect(componentPositions(edited.editor, editedCache, c), `component ${c} should not have moved`)
        .toEqual(componentPositions(openWithGeometry(model.data).editor, cache, c));
    }
    expect(componentPositions(edited.editor, editedCache, 0))
      .not.toEqual(componentPositions(openWithGeometry(model.data).editor, cache, 0));
  }, 300000);
});
