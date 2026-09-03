// Baking Model-mode edits into an MDL0.
//
// The viewport applies a mesh edit as an extra world matrix in front of the draw call. Export
// has to make that permanent, so the same matrix is folded into the vertex positions (and the
// normals, for the rotating part) of the arrays the draw call reads.
//
// Everything here works in KMP/game units. The renderer draws at 0.1 scale, but that scale
// cancels out: `inverse(joint) * edit * joint` is the same whether both are expressed in scene
// units or in game units.

import { mat3, mat4, vec3 } from 'gl-matrix';
import type { MeshTransform } from '../brresEditor';
import { splitTrianglesIntoComponents, type TriangleComponentSplit } from '../meshPick';
import { GX_ATTR, maxAttributeIndex, type GxVertexDescriptor } from './gxVertex';
import type { Mdl0Editor, Mdl0DrawList, Mdl0DrawOp, Mdl0ShapeInfo } from './mdl0Raw';

/** How much geometry the renderer let one click select; mirrors `MeshSelectionGranularity`. */
export type BakeGranularity = 'component' | 'shape' | 'node';

export interface BakeMeshEdit {
  drawOpIndex: number;
  componentIndex: number | null;
  nodeId: number;
  granularity: BakeGranularity;
  transform: MeshTransform;
  visible: boolean;
  deleted: boolean;
}

export interface BakeWarning {
  code: string;
  message: string;
}

/** The renderer's component epsilon (1 game unit) expressed the way the picker uses it. */
const COMPONENT_EPSILON_SCENE = 1.0 * 0.1;
const SCENE_SCALE = 0.1;

export interface DrawOpRef {
  list: Mdl0DrawList;
  indexInList: number;
  /** Index into the concatenated [DrawOpa, DrawXlu] list, which is what a mesh target stores. */
  combinedIndex: number;
  op: Mdl0DrawOp;
}

export function collectDrawOps(model: Mdl0Editor): DrawOpRef[] {
  const opaque = model.readDrawOps('opaque') ?? [];
  const translucent = model.readDrawOps('translucent') ?? [];
  const refs: DrawOpRef[] = [];
  opaque.forEach((op, index) => refs.push({ list: 'opaque', indexInList: index, combinedIndex: refs.length, op }));
  translucent.forEach((op, index) => refs.push({ list: 'translucent', indexInList: index, combinedIndex: refs.length, op }));
  return refs;
}

/**
 * Joint-to-world matrices in game units, exactly as the renderer builds them (minus the scene
 * scale). Indexed by matrix id, which is what a shape's `mtxIdx` refers to.
 */
export function computeJointMatrices(model: Mdl0Editor): mat4[] {
  const nodes = model.listNodes();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const count = Math.max(model.numViewMtx, nodes.length, ...nodes.map((node) => node.mtxId + 1), 1) + 1;
  const matrices: mat4[] = [];
  for (let i = 0; i < count; i++) matrices.push(mat4.create());
  const deg = Math.PI / 180;
  for (const op of model.readNodeTreeOps()) {
    if (op.op === 'nodeDesc') {
      const node = nodeById.get(op.nodeId) ?? nodes[op.nodeId];
      if (!node || matrices[node.mtxId] === undefined) continue;
      const parent = matrices[op.parentMtxId] ?? matrices[0];
      const local = mat4.create();
      mat4.translate(local, local, node.translation);
      mat4.rotateZ(local, local, node.rotation[2] * deg);
      mat4.rotateY(local, local, node.rotation[1] * deg);
      mat4.rotateX(local, local, node.rotation[0] * deg);
      mat4.scale(local, local, node.scale);
      mat4.mul(matrices[node.mtxId], parent, local);
    } else {
      const from = matrices[op.fromMtxId];
      const to = matrices[op.toMtxId];
      if (from && to) mat4.copy(to, from);
    }
  }
  return matrices;
}

export function isIdentityTransform(transform: MeshTransform): boolean {
  const { translation: t, rotation: r, scale: s } = transform;
  return t.x === 0 && t.y === 0 && t.z === 0 && r.x === 0 && r.y === 0 && r.z === 0 && s.x === 1 && s.y === 1 && s.z === 1;
}

/** The pivoting TRS the viewport applies, in game units. */
export function buildEditMatrix(transform: MeshTransform, pivot: vec3): mat4 {
  const deg = Math.PI / 180;
  const matrix = mat4.create();
  mat4.translate(matrix, matrix, [pivot[0] + transform.translation.x, pivot[1] + transform.translation.y, pivot[2] + transform.translation.z]);
  mat4.rotateY(matrix, matrix, transform.rotation.y * deg);
  mat4.rotateX(matrix, matrix, transform.rotation.x * deg);
  mat4.rotateZ(matrix, matrix, transform.rotation.z * deg);
  mat4.scale(matrix, matrix, [transform.scale.x, transform.scale.y, transform.scale.z]);
  const unpivot = mat4.create();
  mat4.translate(unpivot, unpivot, [-pivot[0], -pivot[1], -pivot[2]]);
  return mat4.mul(mat4.create(), matrix, unpivot);
}

export interface ShapeGeometryCache {
  shape: Mdl0ShapeInfo;
  /** Model-space positions, one per display-list vertex. */
  localPositions: Float32Array;
  positionIndices: Int32Array;
  normalIndices: Int32Array | null;
  indices: Uint32Array;
  /** Byte offset of each display-list vertex inside the shape's primitive display list. */
  vertexOffsets: Int32Array;
  /** The shape's vertex descriptor, which says how wide each attribute reference is. */
  vcd: GxVertexDescriptor;
  joint: mat4;
  split: TriangleComponentSplit | null;
}

const scratchVec = vec3.create();

export function readShapeGeometryCache(model: Mdl0Editor, shape: Mdl0ShapeInfo, joint: mat4): ShapeGeometryCache | null {
  const geometry = model.readShapeGeometry(shape);
  const positionIndices = geometry.attributeIndices.get(GX_ATTR.POS);
  if (!positionIndices) return null;
  const array = model.getVertexArray('vtxPos', shape.positionArrayId);
  if (!array) return null;
  const values = model.readVertexArrayValues(array);
  const components = model.vertexArrayFormat(array).componentCount;
  const localPositions = new Float32Array(geometry.vertexCount * 3);
  for (let i = 0; i < geometry.vertexCount; i++) {
    const source = positionIndices[i];
    if (source < 0 || source >= array.count) continue;
    localPositions[i * 3 + 0] = values[source * components + 0];
    localPositions[i * 3 + 1] = values[source * components + 1];
    localPositions[i * 3 + 2] = components > 2 ? values[source * components + 2] : 0;
  }
  return {
    shape,
    localPositions,
    positionIndices,
    normalIndices: geometry.attributeIndices.get(GX_ATTR.NRM) ?? null,
    indices: geometry.indices,
    vertexOffsets: geometry.vertexOffsets,
    vcd: geometry.vcd,
    joint,
    split: null,
  };
}

/**
 * Connected components, computed the way `EditorMeshPicker` computes them: on scene-space
 * positions, one entry per display-list vertex, with the same welding epsilon. Matching the
 * renderer here is what makes a component index mean the same thing in the viewport and in the
 * exported file.
 */
export function ensureComponentSplit(cache: ShapeGeometryCache): TriangleComponentSplit {
  if (cache.split) return cache.split;
  const scene = new Float32Array(cache.localPositions.length);
  for (let i = 0; i < cache.localPositions.length; i += 3) {
    vec3.set(scratchVec, cache.localPositions[i], cache.localPositions[i + 1], cache.localPositions[i + 2]);
    vec3.transformMat4(scratchVec, scratchVec, cache.joint);
    scene[i] = scratchVec[0] * SCENE_SCALE;
    scene[i + 1] = scratchVec[1] * SCENE_SCALE;
    scene[i + 2] = scratchVec[2] * SCENE_SCALE;
  }
  cache.split = splitTrianglesIntoComponents(scene, cache.indices, COMPONENT_EPSILON_SCENE);
  return cache.split;
}

export interface AffectedVertices {
  positions: Set<number>;
  normals: Set<number>;
  /** Bounding box of the affected geometry, in game units. */
  min: vec3;
  max: vec3;
}

export function collectAffectedVertices(cache: ShapeGeometryCache, componentIndex: number | null): AffectedVertices {
  const positions = new Set<number>();
  const normals = new Set<number>();
  const min = vec3.fromValues(Infinity, Infinity, Infinity);
  const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
  const split = componentIndex === null ? null : ensureComponentSplit(cache);
  const triangleCount = cache.indices.length / 3;

  const addVertex = (vertex: number) => {
    const source = cache.positionIndices[vertex];
    if (source >= 0) positions.add(source);
    if (cache.normalIndices && cache.normalIndices[vertex] >= 0) normals.add(cache.normalIndices[vertex]);
    vec3.set(scratchVec, cache.localPositions[vertex * 3], cache.localPositions[vertex * 3 + 1], cache.localPositions[vertex * 3 + 2]);
    vec3.transformMat4(scratchVec, scratchVec, cache.joint);
    vec3.min(min, min, scratchVec);
    vec3.max(max, max, scratchVec);
  };

  if (split !== null && componentIndex !== null && componentIndex < split.componentCount) {
    for (let t = 0; t < triangleCount; t++) {
      if (split.triangleComponent[t] !== componentIndex) continue;
      addVertex(cache.indices[t * 3]);
      addVertex(cache.indices[t * 3 + 1]);
      addVertex(cache.indices[t * 3 + 2]);
    }
  } else {
    for (let i = 0; i < cache.indices.length; i++) addVertex(cache.indices[i]);
  }
  return { positions, normals, min, max };
}

/**
 * True when no other component of the same shape uses any of `positions`.
 *
 * For *positions* this always holds, and provably so: two display-list vertices that name the
 * same position-array entry read back bit-identical coordinates, so they land in the same weld
 * cell, and `splitTrianglesIntoComponents` unions every vertex inside a cell unconditionally —
 * they cannot end up in different components. Measured over the 338 real tracks on this machine:
 * 0 violations in 261,154 components. Kept as a guard, because a change to the welding rule
 * would otherwise corrupt a shape silently.
 *
 * *Normals* are a different story and are not covered by this: nothing welds them, so two
 * components routinely share a normal-array entry. `splitSharedVertexData` handles that.
 */
export function componentOwnsVerticesExclusively(cache: ShapeGeometryCache, componentIndex: number, positions: ReadonlySet<number>): boolean {
  const split = ensureComponentSplit(cache);
  const triangleCount = cache.indices.length / 3;
  for (let t = 0; t < triangleCount; t++) {
    if (split.triangleComponent[t] === componentIndex) continue;
    for (let k = 0; k < 3; k++) {
      const source = cache.positionIndices[cache.indices[t * 3 + k]];
      if (source >= 0 && positions.has(source)) return false;
    }
  }
  return true;
}

export interface VertexSplitOutcome {
  /** The entries the caller should now transform: the component's own, after any splitting. */
  entries: Set<number>;
  /** How many entries were duplicated so this component stopped sharing them. */
  splitCount: number;
  /** True when the array had to be promoted to float32 to hold the copies. */
  promoted: boolean;
  /**
   * Set when the split could not be done. The only way this happens is an array that would grow
   * past what the display list's attribute reference can address (an 8-bit reference cannot name
   * entry 256) or past the 16-bit entry count in the array header.
   */
  blocked: 'index-width' | 'entry-count' | null;
}

/**
 * Gives one connected component private copies of any vertex-array entries it shares with
 * another component of the same shape, and repoints that component's display-list references at
 * the copies. After this, transforming `entries` moves only this component.
 *
 * This is what makes a per-component edit safe on the common case where two components share a
 * normal: rotating one tree used to re-light its neighbour, because both named normal-array
 * entry 12 for "straight up". 95,801 of the 261,154 components in the 338 real tracks here have
 * at least one such shared normal.
 *
 * Nothing is written when there is nothing shared, so an edit that never had the problem still
 * produces the same bytes it did before.
 */
export function splitSharedVertexData(
  model: Mdl0Editor,
  cache: ShapeGeometryCache,
  componentIndex: number,
  kind: 'vtxPos' | 'vtxNrm',
  arrayId: number,
  entries: ReadonlySet<number>,
): VertexSplitOutcome {
  const attr = kind === 'vtxPos' ? GX_ATTR.POS : GX_ATTR.NRM;
  const sourceIndices = kind === 'vtxPos' ? cache.positionIndices : cache.normalIndices;
  const unchanged: VertexSplitOutcome = { entries: new Set(entries), splitCount: 0, promoted: false, blocked: null };
  if (!sourceIndices || entries.size === 0) return unchanged;

  const array = model.getVertexArray(kind, arrayId);
  if (!array) return unchanged;

  // Which of this component's entries are also named by a triangle outside it.
  const split = ensureComponentSplit(cache);
  const triangleCount = cache.indices.length / 3;
  const shared = new Set<number>();
  for (let t = 0; t < triangleCount; t++) {
    if (split.triangleComponent[t] === componentIndex) continue;
    for (let k = 0; k < 3; k++) {
      const source = sourceIndices[cache.indices[t * 3 + k]];
      if (source >= 0 && entries.has(source)) shared.add(source);
    }
  }
  if (shared.size === 0) return unchanged;

  const newCount = array.count + shared.size;
  if (newCount > 0xffff) return { ...unchanged, blocked: 'entry-count' };
  const maxIndex = maxAttributeIndex(cache.vcd, attr);
  if (maxIndex < 0 || newCount - 1 > maxIndex) return { ...unchanged, blocked: 'index-width' };

  // Append a copy of each shared entry.
  const format = model.vertexArrayFormat(array);
  const values = model.readVertexArrayValues(array);
  const grown = new Float32Array(newCount * format.componentCount);
  grown.set(values.subarray(0, Math.min(values.length, array.count * format.componentCount)), 0);
  const replacement = new Map<number, number>();
  let next = array.count;
  for (const source of shared) {
    const target = next++;
    if (source >= 0 && source < array.count) {
      grown.set(values.subarray(source * format.componentCount, (source + 1) * format.componentCount), target * format.componentCount);
    }
    replacement.set(source, target);
  }

  const result = model.growVertexArray(array, grown, newCount);

  // Point this component's display-list vertices at the copies.
  for (let t = 0; t < triangleCount; t++) {
    if (split.triangleComponent[t] !== componentIndex) continue;
    for (let k = 0; k < 3; k++) {
      const vertex = cache.indices[t * 3 + k];
      const target = replacement.get(sourceIndices[vertex]);
      if (target === undefined) continue;
      model.setPrimitiveAttributeIndex(cache.shape, cache.vcd, cache.vertexOffsets[vertex], attr, target);
      sourceIndices[vertex] = target;
    }
  }

  const nextEntries = new Set<number>();
  for (const entry of entries) nextEntries.add(replacement.get(entry) ?? entry);
  return { entries: nextEntries, splitCount: shared.size, promoted: result.promoted, blocked: null };
}

/** Applies `local` to the listed entries of a position array, in place. */
export function transformPositionArray(
  model: Mdl0Editor,
  arrayId: number,
  entries: ReadonlySet<number>,
  local: mat4,
): { promoted: boolean; bounds: { min: vec3; max: vec3 } } | null {
  const array = model.getVertexArray('vtxPos', arrayId);
  if (!array) return null;
  const format = model.vertexArrayFormat(array);
  const values = model.readVertexArrayValues(array);
  const min = vec3.fromValues(Infinity, Infinity, Infinity);
  const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
  for (const index of entries) {
    if (index < 0 || index >= array.count) continue;
    const base = index * format.componentCount;
    vec3.set(scratchVec, values[base], values[base + 1], format.componentCount > 2 ? values[base + 2] : 0);
    vec3.transformMat4(scratchVec, scratchVec, local);
    values[base] = scratchVec[0];
    values[base + 1] = scratchVec[1];
    if (format.componentCount > 2) values[base + 2] = scratchVec[2];
    vec3.min(min, min, scratchVec);
    vec3.max(max, max, scratchVec);
  }
  const result = model.writeVertexArrayValues(array, values);
  return { promoted: result.promoted, bounds: { min, max } };
}

/** Applies the inverse-transpose of `local` to the listed entries of a normal array. */
export function transformNormalArray(model: Mdl0Editor, arrayId: number, entries: ReadonlySet<number>, local: mat4): boolean {
  if (entries.size === 0) return false;
  const array = model.getVertexArray('vtxNrm', arrayId);
  if (!array) return false;
  const normalMatrix = mat3.create();
  mat3.normalFromMat4(normalMatrix, local);
  const format = model.vertexArrayFormat(array);
  const values = model.readVertexArrayValues(array);
  for (const index of entries) {
    if (index < 0 || index >= array.count) continue;
    const base = index * format.componentCount;
    vec3.set(scratchVec, values[base], values[base + 1], values[base + 2]);
    vec3.transformMat3(scratchVec, scratchVec, normalMatrix);
    vec3.normalize(scratchVec, scratchVec);
    values[base] = scratchVec[0];
    values[base + 1] = scratchVec[1];
    values[base + 2] = scratchVec[2];
  }
  model.writeVertexArrayValues(array, values);
  return true;
}

/** How many shapes read a given vertex array; a shared array has to be copied before editing. */
export function countArrayUsers(shapes: readonly Mdl0ShapeInfo[], kind: 'vtxPos' | 'vtxNrm', arrayId: number): number {
  return shapes.filter((shape) => (kind === 'vtxPos' ? shape.positionArrayId : shape.normalArrayId) === arrayId).length;
}
