// The list of editable meshes in a course model, read straight out of the BRRES.
//
// Model mode's outliner needs this before the renderer has finished loading, and it has to agree
// with what the viewport picks: one entry per draw call, numbered across `DrawOpa` then `DrawXlu`,
// which is exactly what an `EditorMeshTarget.drawOpIndex` means.

import { mat4, vec3 } from 'gl-matrix';
import type { EditorMeshTarget } from '../brresEditor';
import { BRRES_MODELS_GROUP, makeSubFileNameReader, readBrresRaw } from './brresRaw';
import { Mdl0Editor, type Mdl0DrawList } from './mdl0Raw';
import { collectDrawOps, computeJointMatrices, readShapeGeometryCache } from './meshBake';

export interface CourseMeshInfo {
  /** Index into the concatenated `[DrawOpa, DrawXlu]` list. */
  drawOpIndex: number;
  shapeIndex: number;
  shapeName: string;
  materialName: string;
  nodeId: number;
  nodeName: string;
  modelName: string;
  /** Which pass the mesh is drawn in; translucent meshes are the see-through ones. */
  list: Mdl0DrawList;
  triangleCount: number;
  vertexCount: number;
}

export interface CourseMeshList {
  modelName: string;
  meshes: CourseMeshInfo[];
  /** Bone names by node id, for the "whole bone" selection level. */
  nodeNames: Map<number, string>;
}

/**
 * Reads the draw calls of the archive's first (in practice only) model. Cheap: it walks the
 * dictionaries and the draw bytecode, and never decodes geometry.
 */
export function listCourseMeshes(brres: Uint8Array): CourseMeshList | null {
  let raw;
  try {
    raw = readBrresRaw(brres);
  } catch {
    return null;
  }
  const subFile = raw.groups.find((group) => group.name === BRRES_MODELS_GROUP)?.entries[0];
  if (!subFile) return null;

  let model: Mdl0Editor;
  try {
    model = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile));
  } catch {
    return null;
  }

  const shapes = model.listShapes();
  const materials = model.listMaterials();
  const nodeNames = new Map(model.listNodes().map((node) => [node.id, node.name]));

  const meshes = collectDrawOps(model).map((ref) => {
    const shape = shapes[ref.op.shapeId];
    return {
      drawOpIndex: ref.combinedIndex,
      shapeIndex: ref.op.shapeId,
      shapeName: shape?.name ?? `Shape ${ref.op.shapeId}`,
      materialName: materials[ref.op.materialId]?.name ?? '',
      nodeId: ref.op.nodeId,
      nodeName: nodeNames.get(ref.op.nodeId) ?? `Bone ${ref.op.nodeId}`,
      modelName: subFile.name,
      list: ref.list,
      triangleCount: shape?.polygonCount ?? 0,
      vertexCount: shape?.vertexCount ?? 0,
    };
  });

  return { modelName: subFile.name, meshes, nodeNames };
}

/** The target a click on an outliner row selects. */
export function courseMeshTarget(
  archivePath: string,
  mesh: CourseMeshInfo,
  granularity: EditorMeshTarget['granularity'] = 'shape',
): EditorMeshTarget {
  return {
    archivePath,
    modelName: mesh.modelName,
    shapeIndex: mesh.shapeIndex,
    drawOpIndex: mesh.drawOpIndex,
    componentIndex: null,
    nodeId: mesh.nodeId,
    granularity: granularity === 'component' ? 'shape' : granularity,
  };
}

/**
 * A name worth showing a user. MDL0 shape names are usually descriptive ("road", "tree_02");
 * when they are not, the material name says more than a bare index.
 */
export function describeCourseMesh(mesh: CourseMeshInfo): string {
  const shape = mesh.shapeName.trim();
  if (shape && !/^polygon\d*$/i.test(shape) && !/^shape\s*\d+$/i.test(shape)) return shape;
  if (mesh.materialName.trim()) return mesh.materialName.trim();
  return `Mesh ${mesh.drawOpIndex + 1}`;
}

/**
 * World-space centre of a draw call, in game units, ignoring any edit. Used to drop a placed
 * object next to whatever the user has selected instead of at the world origin.
 *
 * This decodes the shape's geometry, so call it on demand rather than for a whole list.
 */
export function courseMeshCenter(brres: Uint8Array, drawOpIndex: number): { x: number; y: number; z: number } | null {
  let raw;
  try {
    raw = readBrresRaw(brres);
  } catch {
    return null;
  }
  const subFile = raw.groups.find((group) => group.name === BRRES_MODELS_GROUP)?.entries[0];
  if (!subFile) return null;

  let model: Mdl0Editor;
  try {
    model = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile));
  } catch {
    return null;
  }
  const ref = collectDrawOps(model)[drawOpIndex];
  if (!ref) return null;
  const shape = model.getShape(ref.op.shapeId);
  if (!shape) return null;
  const joints = computeJointMatrices(model);
  const cache = readShapeGeometryCache(model, shape, joints[shape.mtxIdx] ?? joints[0] ?? mat4.create());
  if (!cache) return null;

  const min = vec3.fromValues(Infinity, Infinity, Infinity);
  const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
  const point = vec3.create();
  for (let i = 0; i < cache.indices.length; i++) {
    const vertex = cache.indices[i];
    vec3.set(point, cache.localPositions[vertex * 3], cache.localPositions[vertex * 3 + 1], cache.localPositions[vertex * 3 + 2]);
    vec3.transformMat4(point, point, cache.joint);
    vec3.min(min, min, point);
    vec3.max(max, max, point);
  }
  if (!Number.isFinite(min[0])) return null;
  return { x: (min[0] + max[0]) / 2, y: (min[1] + max[1]) / 2, z: (min[2] + max[2]) / 2 };
}

/** Groups meshes by the bone they hang off, which is how most course models are organised. */
export function groupCourseMeshesByNode(list: CourseMeshList): Array<{ nodeId: number; nodeName: string; meshes: CourseMeshInfo[] }> {
  const groups = new Map<number, CourseMeshInfo[]>();
  for (const mesh of list.meshes) {
    const existing = groups.get(mesh.nodeId);
    if (existing) existing.push(mesh);
    else groups.set(mesh.nodeId, [mesh]);
  }
  return [...groups.entries()]
    .map(([nodeId, meshes]) => ({ nodeId, nodeName: list.nodeNames.get(nodeId) ?? `Bone ${nodeId}`, meshes }))
    .sort((a, b) => a.nodeId - b.nodeId);
}
