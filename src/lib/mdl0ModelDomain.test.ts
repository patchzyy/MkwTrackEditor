import { describe, expect, it } from 'vitest';
import { deriveMdl0Meshes, deriveMdl0MeshSlots } from './mdl0ModelDomain';

describe('MDL0 model domain', () => {
  it('derives mesh slots from draw bytecode with material and node bindings', () => {
    const meshSlots = deriveMdl0MeshSlots('course_model.brres', {
      name: 'course',
      materials: [{ name: 'road' }, { name: 'glass' }],
      nodes: [{ id: 0, name: 'root' }, { id: 2, name: 'windowNode' }],
      shapes: [
        { name: 'roadShape', mtxIdx: 1, loadedVertexData: { totalVertexCount: 128, totalIndexCount: 192 } },
        { name: 'glassShape', mtxIdx: 2, loadedVertexData: { totalVertexCount: 64, totalIndexCount: 96 } },
      ],
      sceneGraph: {
        drawOpaOps: [{ matId: 0, shpId: 0, nodeId: 0, sourceOffset: 0x120 }],
        drawXluOps: [{ matId: 1, shpId: 1, nodeId: 2, sourceOffset: 0x148 }],
      },
    });

    expect(meshSlots).toHaveLength(2);
    expect(meshSlots[0]).toMatchObject({
      shapeName: 'roadShape',
      materialName: 'road',
      nodeName: 'root',
      drawPass: 'opaque',
      drawSourceOffset: 0x120,
      matrixIndex: 1,
      vertexCount: 128,
      indexCount: 192,
    });
    expect(meshSlots[1]).toMatchObject({
      shapeName: 'glassShape',
      materialName: 'glass',
      nodeName: 'windowNode',
      drawPass: 'translucent',
      drawSourceOffset: 0x148,
      matrixIndex: 2,
      vertexCount: 64,
      indexCount: 96,
    });
  });

  it('keeps unbound shapes visible for app-side model inspection', () => {
    const meshSlots = deriveMdl0MeshSlots('course_model.brres', {
      name: 'course',
      shapes: [
        { name: 'boundShape', mtxIdx: 0, loadedVertexData: { totalVertexCount: 10, totalIndexCount: 12 } },
        { name: 'orphanShape', mtxIdx: 3, loadedVertexData: { totalVertexCount: 6, totalIndexCount: 9 } },
      ],
      materials: [{ name: 'road' }],
      nodes: [{ id: 0, name: 'root' }],
      sceneGraph: {
        drawOpaOps: [{ matId: 0, shpId: 0, nodeId: 0, sourceOffset: 0x120 }],
        drawXluOps: [],
      },
    });

    expect(meshSlots[1]).toMatchObject({
      shapeName: 'orphanShape',
      materialName: null,
      nodeName: null,
      drawPass: 'unbound',
      drawSourceOffset: null,
      matrixIndex: 3,
      vertexCount: 6,
      indexCount: 9,
    });
  });

  it('derives unique mesh assets from MDL0 shapes without duplicating draw bindings into separate assets', () => {
    const meshes = deriveMdl0Meshes('course_model.brres', {
      name: 'course',
      shapes: [
        { name: 'roadShape', mtxIdx: 0, loadedVertexData: { totalVertexCount: 10, totalIndexCount: 12 } },
        { name: 'glassShape', mtxIdx: 2, loadedVertexData: { totalVertexCount: 6, totalIndexCount: 9 } },
      ],
      sceneGraph: {
        drawOpaOps: [
          { matId: 0, shpId: 0, nodeId: 0, sourceOffset: 0x120 },
          { matId: 1, shpId: 0, nodeId: 1, sourceOffset: 0x128 },
        ],
        drawXluOps: [{ matId: 2, shpId: 1, nodeId: 2, sourceOffset: 0x148 }],
      },
    });

    expect(meshes).toEqual([
      expect.objectContaining({
        shapeName: 'roadShape',
        shapeIndex: 0,
        matrixIndex: 0,
        vertexCount: 10,
        indexCount: 12,
        bindingCount: 2,
        opaqueBindingCount: 2,
        translucentBindingCount: 0,
      }),
      expect.objectContaining({
        shapeName: 'glassShape',
        shapeIndex: 1,
        matrixIndex: 2,
        vertexCount: 6,
        indexCount: 9,
        bindingCount: 1,
        opaqueBindingCount: 0,
        translucentBindingCount: 1,
      }),
    ]);
  });
});
