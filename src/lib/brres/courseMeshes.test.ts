// The outliner's mesh list has to describe exactly the same draw calls the viewport picks, or a
// click in the list and a click in the 3D view would select different things.

import { describe, expect, it } from 'vitest';
import {
  courseMeshCenter,
  courseMeshTarget,
  describeCourseMesh,
  groupCourseMeshesByNode,
  listCourseMeshes,
  type CourseMeshInfo,
} from './courseMeshes';
import { collectDrawOps } from './meshBake';
import { listCourseModels, openCourseModel } from './brresFixtures.testdata';

const fixtures = listCourseModels(3);

function meshInfo(overrides: Partial<CourseMeshInfo> = {}): CourseMeshInfo {
  return {
    drawOpIndex: 0,
    shapeIndex: 0,
    shapeName: 'road',
    materialName: 'road_mat',
    nodeId: 0,
    nodeName: 'course',
    modelName: 'course',
    list: 'opaque',
    triangleCount: 100,
    vertexCount: 300,
    ...overrides,
  };
}

describe('describeCourseMesh', () => {
  it('prefers a descriptive shape name', () => {
    expect(describeCourseMesh(meshInfo({ shapeName: 'tree_02' }))).toBe('tree_02');
  });

  it('falls back to the material when the shape name says nothing', () => {
    expect(describeCourseMesh(meshInfo({ shapeName: 'polygon3', materialName: 'lava' }))).toBe('lava');
    expect(describeCourseMesh(meshInfo({ shapeName: 'Shape 7', materialName: 'water' }))).toBe('water');
  });

  it('falls back to a numbered mesh when neither name helps', () => {
    expect(describeCourseMesh(meshInfo({ shapeName: 'polygon', materialName: '  ', drawOpIndex: 4 }))).toBe('Mesh 5');
  });
});

describe('courseMeshTarget', () => {
  it('never asks for a component the outliner cannot know about', () => {
    const target = courseMeshTarget('./course_model.brres', meshInfo({ drawOpIndex: 3, shapeIndex: 9, nodeId: 2 }), 'component');
    expect(target.granularity).toBe('shape');
    expect(target.componentIndex).toBeNull();
    expect(target.drawOpIndex).toBe(3);
    expect(target.shapeIndex).toBe(9);
    expect(target.nodeId).toBe(2);
  });

  it('keeps a bone-level selection at bone level', () => {
    expect(courseMeshTarget('./course_model.brres', meshInfo(), 'node').granularity).toBe('node');
  });
});

describe.skipIf(fixtures.length === 0)('listCourseMeshes', () => {
  for (const fixture of fixtures) {
    it(`matches the draw calls of ${fixture.track}`, () => {
      const list = listCourseMeshes(fixture.data);
      expect(list).not.toBeNull();

      const { editor, modelName } = openCourseModel(fixture.data);
      const ops = collectDrawOps(editor);
      expect(list!.modelName).toBe(modelName);
      expect(list!.meshes.length).toBe(ops.length);

      // Same order, same identity, same numbering as `EditorMeshTarget.drawOpIndex`.
      list!.meshes.forEach((mesh, index) => {
        expect(mesh.drawOpIndex).toBe(index);
        expect(mesh.shapeIndex).toBe(ops[index].op.shapeId);
        expect(mesh.nodeId).toBe(ops[index].op.nodeId);
        expect(mesh.list).toBe(ops[index].list);
      });

      // Opaque draw calls always come before the translucent ones.
      const firstTranslucent = list!.meshes.findIndex((mesh) => mesh.list === 'translucent');
      if (firstTranslucent >= 0) {
        expect(list!.meshes.slice(firstTranslucent).every((mesh) => mesh.list === 'translucent')).toBe(true);
      }

      // Every mesh gets a name a person could act on.
      for (const mesh of list!.meshes) expect(describeCourseMesh(mesh).length).toBeGreaterThan(0);
    });
  }

  it('groups meshes under the bone they hang off', () => {
    const list = listCourseMeshes(fixtures[0].data)!;
    const groups = groupCourseMeshesByNode(list);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.reduce((sum, group) => sum + group.meshes.length, 0)).toBe(list.meshes.length);
  });

  it('locates a mesh in the world so a placed object can be dropped next to it', () => {
    const centre = courseMeshCenter(fixtures[0].data, 0);
    expect(centre).not.toBeNull();
    expect(Number.isFinite(centre!.x)).toBe(true);
    expect(Number.isFinite(centre!.y)).toBe(true);
    expect(Number.isFinite(centre!.z)).toBe(true);
  });

  it('returns null rather than throwing on something that is not a BRRES', () => {
    expect(listCourseMeshes(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(courseMeshCenter(new Uint8Array([1, 2, 3, 4]), 0)).toBeNull();
  });

  it('reports nothing for a draw call that does not exist', () => {
    expect(courseMeshCenter(fixtures[0].data, 99999)).toBeNull();
  });
});
