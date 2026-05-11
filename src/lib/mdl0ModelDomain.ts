export interface Mdl0MeshSlot {
  id: string;
  shapeName: string;
  shapeIndex: number;
  materialName: string | null;
  materialIndex: number | null;
  nodeName: string | null;
  nodeId: number | null;
  drawPass: 'opaque' | 'translucent' | 'unbound';
  drawSourceOffset: number | null;
  matrixIndex: number;
  vertexCount: number;
  indexCount: number;
}

export interface Mdl0MeshAsset {
  id: string;
  shapeName: string;
  shapeIndex: number;
  sourceOffset: number | null;
  matrixIndex: number;
  vertexCount: number;
  indexCount: number;
  bindingCount: number;
  opaqueBindingCount: number;
  translucentBindingCount: number;
}

interface Mdl0LikeModel {
  name: string;
  shapes?: Array<{
    name: string;
    sourceOffset?: number | null;
    mtxIdx: number;
    loadedVertexData?: {
      totalVertexCount?: number;
      totalIndexCount?: number;
    };
  }>;
  materials?: Array<{ name: string }>;
  nodes?: Array<{ id: number; name: string }>;
  sceneGraph?: {
    drawOpaOps?: Array<{ matId: number; shpId: number; nodeId: number; sourceOffset?: number }>;
    drawXluOps?: Array<{ matId: number; shpId: number; nodeId: number; sourceOffset?: number }>;
  };
}

export function deriveMdl0MeshSlots(archivePath: string, model: Mdl0LikeModel): Mdl0MeshSlot[] {
  const shapes = model.shapes ?? [];
  const materials = model.materials ?? [];
  const nodes = model.nodes ?? [];
  const drawOps = collectDrawOps(model);

  const meshSlots: Mdl0MeshSlot[] = drawOps.map((drawOp) => {
    const shape = shapes[drawOp.shpId];
    const material = materials[drawOp.matId] ?? null;
    const node = nodes.find((candidate) => candidate.id === drawOp.nodeId) ?? null;
    return {
      id: createMeshSlotId(archivePath, model.name, shape?.name ?? `shape_${drawOp.shpId}`, drawOp.drawPass, drawOp.opIndex),
      shapeName: shape?.name ?? `Shape ${drawOp.shpId}`,
      shapeIndex: drawOp.shpId,
      materialName: material?.name ?? null,
      materialIndex: material ? drawOp.matId : null,
      nodeName: node?.name ?? null,
      nodeId: node?.id ?? null,
      drawPass: drawOp.drawPass,
      drawSourceOffset: drawOp.sourceOffset ?? null,
      matrixIndex: shape?.mtxIdx ?? -1,
      vertexCount: shape?.loadedVertexData?.totalVertexCount ?? 0,
      indexCount: shape?.loadedVertexData?.totalIndexCount ?? 0,
    };
  });

  const boundShapeIds = new Set(drawOps.map((drawOp) => drawOp.shpId));
  shapes.forEach((shape, shapeIndex) => {
    if (boundShapeIds.has(shapeIndex)) return;
    meshSlots.push({
      id: createMeshSlotId(archivePath, model.name, shape.name, 'unbound', shapeIndex),
      shapeName: shape.name,
      shapeIndex,
      materialName: null,
      materialIndex: null,
      nodeName: null,
      nodeId: null,
      drawPass: 'unbound',
      drawSourceOffset: null,
      matrixIndex: shape.mtxIdx,
      vertexCount: shape.loadedVertexData?.totalVertexCount ?? 0,
      indexCount: shape.loadedVertexData?.totalIndexCount ?? 0,
    });
  });

  return meshSlots;
}

export function deriveMdl0Meshes(archivePath: string, model: Mdl0LikeModel): Mdl0MeshAsset[] {
  const shapes = model.shapes ?? [];
  const drawOps = collectDrawOps(model);

  return shapes.map((shape, shapeIndex) => {
    const bindings = drawOps.filter((drawOp) => drawOp.shpId === shapeIndex);
    return {
      id: createMeshId(archivePath, model.name, shape.name, shapeIndex),
      shapeName: shape.name,
      shapeIndex,
      sourceOffset: shape.sourceOffset ?? null,
      matrixIndex: shape.mtxIdx,
      vertexCount: shape.loadedVertexData?.totalVertexCount ?? 0,
      indexCount: shape.loadedVertexData?.totalIndexCount ?? 0,
      bindingCount: bindings.length,
      opaqueBindingCount: bindings.filter((binding) => binding.drawPass === 'opaque').length,
      translucentBindingCount: bindings.filter((binding) => binding.drawPass === 'translucent').length,
    };
  });
}

function collectDrawOps(model: Mdl0LikeModel) {
  return [
    ...(model.sceneGraph?.drawOpaOps ?? []).map((op, opIndex) => ({ ...op, drawPass: 'opaque' as const, opIndex })),
    ...(model.sceneGraph?.drawXluOps ?? []).map((op, opIndex) => ({ ...op, drawPass: 'translucent' as const, opIndex })),
  ];
}

function createMeshSlotId(archivePath: string, modelName: string, shapeName: string, drawPass: string, index: number) {
  return `${archivePath.toLowerCase()}::mesh-slot::${encodeURIComponent(modelName)}::${encodeURIComponent(shapeName)}::${drawPass}::${index}`;
}

function createMeshId(archivePath: string, modelName: string, shapeName: string, shapeIndex: number) {
  return `${archivePath.toLowerCase()}::mesh::${encodeURIComponent(modelName)}::${encodeURIComponent(shapeName)}::${shapeIndex}`;
}
