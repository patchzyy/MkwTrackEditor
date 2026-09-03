// Merging an object model into the course model.
//
// Dropping a tree from the content browser into the viewport puts a whole other BRRES on the
// track. Export has to fold it into `course_model.brres`: its vertex arrays (with the placement
// baked in), its shapes, its materials and TEV shaders, and the texture links the console uses
// to bind textures at load time. The textures themselves are copied at the archive level by
// `bakeCourseModel`, which is why `mergeImportedModel` reports the names it needs.

import { mat3, mat4, vec3 } from 'gl-matrix';
import type { MeshTransform } from '../brresEditor';
import { BRRES_MODELS_GROUP, makeSubFileNameReader, readBrresRaw, type BrresRaw } from './brresRaw';
import { Mdl0Editor, type Mdl0DicKey, type Mdl0DrawList, type Mdl0ShapeInfo, type VertexArrayKind } from './mdl0Raw';
import { computeJointMatrices, type BakeWarning } from './meshBake';

export interface MergeSource {
  brres: Uint8Array;
  /** Model inside the source archive, or null for the first one. */
  modelName: string | null;
  /** Placement in game units and degrees. */
  transform: MeshTransform;
  /** Used in warning messages and to name the merged blocks. */
  label: string;
}

export interface MergeResult {
  added: boolean;
  warnings: BakeWarning[];
  /** Texture names the merged materials sample; the archive must carry TEX0s for these. */
  textures: string[];
  /** Palette names the merged materials sample; the archive must carry PLT0s for these. */
  palettes: string[];
  /** The source archive, so the caller can lift those textures out of it. */
  sourceArchive: BrresRaw | null;
}

/** Vertex-array id fields inside a shape block, in the order the header stores them. */
const SHAPE_ARRAY_FIELDS: Array<{ offset: number; kind: VertexArrayKind }> = [
  { offset: 0x48, kind: 'vtxPos' },
  { offset: 0x4a, kind: 'vtxNrm' },
  { offset: 0x4c, kind: 'vtxClr' },
  { offset: 0x4e, kind: 'vtxClr' },
  { offset: 0x50, kind: 'vtxTxc' },
  { offset: 0x52, kind: 'vtxTxc' },
  { offset: 0x54, kind: 'vtxTxc' },
  { offset: 0x56, kind: 'vtxTxc' },
  { offset: 0x58, kind: 'vtxTxc' },
  { offset: 0x5a, kind: 'vtxTxc' },
  { offset: 0x5c, kind: 'vtxTxc' },
  { offset: 0x5e, kind: 'vtxTxc' },
];

export function buildPlacementMatrix(transform: MeshTransform): mat4 {
  const deg = Math.PI / 180;
  const matrix = mat4.create();
  mat4.translate(matrix, matrix, [transform.translation.x, transform.translation.y, transform.translation.z]);
  mat4.rotateY(matrix, matrix, transform.rotation.y * deg);
  mat4.rotateX(matrix, matrix, transform.rotation.x * deg);
  mat4.rotateZ(matrix, matrix, transform.rotation.z * deg);
  mat4.scale(matrix, matrix, [transform.scale.x, transform.scale.y, transform.scale.z]);
  return matrix;
}

export function mergeImportedModel(target: Mdl0Editor, source: MergeSource): MergeResult {
  const warnings: BakeWarning[] = [];
  let sourceArchive: BrresRaw;
  try {
    sourceArchive = readBrresRaw(source.brres);
  } catch (error) {
    return {
      added: false,
      sourceArchive: null,
      textures: [],
      palettes: [],
      warnings: [{ code: 'model.import-unreadable', message: `The model file for "${source.label}" could not be read: ${message(error)}` }],
    };
  }

  const models = sourceArchive.groups.find((group) => group.name === BRRES_MODELS_GROUP);
  const subFile = source.modelName
    ? models?.entries.find((entry) => entry.name === source.modelName) ?? models?.entries[0]
    : models?.entries[0];
  if (!subFile) {
    return {
      added: false,
      sourceArchive,
      textures: [],
      palettes: [],
      warnings: [{ code: 'model.import-empty', message: `"${source.label}" has no 3D model to place.` }],
    };
  }

  const from = new Mdl0Editor(subFile.data, makeSubFileNameReader(sourceArchive, subFile));
  const placement = buildPlacementMatrix(source.transform);
  const sourceJoints = computeJointMatrices(from);
  const sourceShapes = from.listShapes();
  const sourceMaterials = from.listMaterials();
  const rootNodeId = target.listNodes()[0]?.id ?? 0;
  const prefix = sanitize(source.label);

  const arrayIdMap = new Map<string, number>();
  const materialIdMap = new Map<number, number>();
  const textures = new Set<string>();
  const palettes = new Set<string>();
  let added = false;

  const drawLists: Array<{ list: Mdl0DrawList; ops: ReturnType<Mdl0Editor['readDrawOps']> }> = [
    { list: 'opaque', ops: from.readDrawOps('opaque') },
    { list: 'translucent', ops: from.readDrawOps('translucent') },
  ];

  for (const { list, ops } of drawLists) {
    for (const op of ops ?? []) {
      const shape = sourceShapes[op.shapeId];
      if (!shape) continue;
      if (shape.mtxIdx < 0) {
        warnings.push({ code: 'model.import-skinned', message: `Part of "${source.label}" is animated by bones and cannot be placed as static scenery; it was skipped.` });
        continue;
      }
      const joint = sourceJoints[shape.mtxIdx] ?? mat4.create();
      const local = mat4.create();
      mat4.mul(local, placement, joint);

      const newShapeId = copyShape(target, from, shape, local, arrayIdMap, prefix);
      if (newShapeId === null) continue;
      const materialId = copyMaterial(target, from, sourceMaterials[op.materialId], materialIdMap, textures, palettes, prefix, newShapeId, warnings);
      if (materialId === null) continue;
      target.queueDrawOp(list, { materialId, shapeId: newShapeId, nodeId: rootNodeId, priority: op.priority });
      added = true;

      // Keep the model's bounds honest so nothing gets culled.
      const array = target.getVertexArray('vtxPos', target.getShape(newShapeId)!.positionArrayId);
      if (array) {
        const values = target.readVertexArrayValues(array);
        const components = target.vertexArrayFormat(array).componentCount;
        for (let i = 0; i < array.count; i++) {
          target.expandModelBounds(values[i * components], values[i * components + 1], components > 2 ? values[i * components + 2] : 0);
        }
      }
    }
  }

  if (!added && warnings.length === 0) {
    warnings.push({ code: 'model.import-empty', message: `"${source.label}" had no geometry to place.` });
  }
  return { added, warnings, textures: [...textures], palettes: [...palettes], sourceArchive };
}

function copyShape(
  target: Mdl0Editor,
  from: Mdl0Editor,
  shape: Mdl0ShapeInfo,
  local: mat4,
  arrayIdMap: Map<string, number>,
  prefix: string,
): number | null {
  const block = from.data.slice(shape.offset, shape.offset + shape.size);
  const blockView = new DataView(block.buffer);
  for (const field of SHAPE_ARRAY_FIELDS) {
    const sourceId = blockView.getInt16(field.offset);
    if (sourceId < 0) continue;
    const mapped = copyVertexArray(target, from, field.kind, sourceId, field.kind === 'vtxPos' ? local : field.kind === 'vtxNrm' ? local : null, arrayIdMap, prefix);
    blockView.setInt16(field.offset, mapped ?? -1);
  }
  blockView.setInt32(0x08, 0); // Bind to the course model's root matrix.
  const shapeName = uniqueName(target, 'shape', `${prefix}_${shape.name}`);
  const offset = target.append(block, 0x20);
  const dic = target.getDic('shape')!;
  const newIndex = dic.entries.length;
  const view = new DataView(target.data.buffer, target.data.byteOffset, target.data.byteLength);
  view.setInt32(offset + 0x04, -offset);
  view.setUint32(offset + 0x3c, newIndex);
  target.writeDic('shape', [...dic.entries, { name: shapeName, offset }]);
  return newIndex;
}

function copyVertexArray(
  target: Mdl0Editor,
  from: Mdl0Editor,
  kind: VertexArrayKind,
  sourceId: number,
  transform: mat4 | null,
  arrayIdMap: Map<string, number>,
  prefix: string,
): number | null {
  const key = `${kind}:${sourceId}`;
  const cached = arrayIdMap.get(key);
  if (cached !== undefined) return cached;
  const array = from.getVertexArray(kind, sourceId);
  if (!array) return null;

  const block = from.data.slice(array.blockOffset, array.blockOffset + array.blockSize);
  const name = uniqueName(target, kind, `${prefix}_${array.name}`);
  const dic = target.getDic(kind);
  if (!dic) return null;
  const newIndex = dic.entries.length;
  const offset = target.append(block, 0x20);
  const view = new DataView(target.data.buffer, target.data.byteOffset, target.data.byteLength);
  view.setInt32(offset + 0x04, -offset);
  view.setUint32(offset + 0x10, newIndex);
  target.writeDic(kind, [...dic.entries, { name, offset }]);
  arrayIdMap.set(key, newIndex);

  if (transform && (kind === 'vtxPos' || kind === 'vtxNrm')) {
    const copied = target.getVertexArray(kind, newIndex)!;
    const format = target.vertexArrayFormat(copied);
    const values = target.readVertexArrayValues(copied);
    const scratch = vec3.create();
    if (kind === 'vtxPos') {
      for (let i = 0; i < copied.count; i++) {
        const base = i * format.componentCount;
        vec3.set(scratch, values[base], values[base + 1], format.componentCount > 2 ? values[base + 2] : 0);
        vec3.transformMat4(scratch, scratch, transform);
        values[base] = scratch[0];
        values[base + 1] = scratch[1];
        if (format.componentCount > 2) values[base + 2] = scratch[2];
      }
    } else {
      const normalMatrix = mat3.create();
      mat3.normalFromMat4(normalMatrix, transform);
      for (let i = 0; i < copied.count; i++) {
        const base = i * format.componentCount;
        vec3.set(scratch, values[base], values[base + 1], values[base + 2]);
        vec3.transformMat3(scratch, scratch, normalMatrix);
        vec3.normalize(scratch, scratch);
        values[base] = scratch[0];
        values[base + 1] = scratch[1];
        values[base + 2] = scratch[2];
      }
    }
    target.writeVertexArrayValues(copied, values);
  }
  return newIndex;
}

function copyMaterial(
  target: Mdl0Editor,
  from: Mdl0Editor,
  material: { index: number; name: string; offset: number; size: number; translucent: boolean } | undefined,
  materialIdMap: Map<number, number>,
  textures: Set<string>,
  palettes: Set<string>,
  prefix: string,
  shapeId: number,
  warnings: BakeWarning[],
): number | null {
  if (!material) {
    warnings.push({ code: 'model.import-material', message: 'A placed model referenced a material that is missing from its file.' });
    return null;
  }
  const existing = materialIdMap.get(material.index);

  const sourceView = new DataView(from.data.buffer, from.data.byteOffset, from.data.byteLength);
  const samplerCount = sourceView.getUint32(material.offset + 0x2c);
  const samplerOffset = sourceView.getUint32(material.offset + 0x30);
  const samplerNames: Array<{ texture: string; palette: string | null }> = [];
  for (let i = 0; i < samplerCount; i++) {
    const at = material.offset + samplerOffset + i * 0x34;
    const textureRelative = sourceView.getInt32(at + 0x00);
    const paletteRelative = sourceView.getInt32(at + 0x04);
    samplerNames.push({
      texture: textureRelative !== 0 ? from.readNameAt(at + textureRelative) : '',
      palette: paletteRelative !== 0 ? from.readNameAt(at + paletteRelative) : null,
    });
  }
  for (const sampler of samplerNames) {
    if (sampler.texture) textures.add(sampler.texture);
    if (sampler.palette) palettes.add(sampler.palette);
  }

  if (existing !== undefined) {
    linkTextures(target, existing, samplerNames, samplerOffset);
    return existing;
  }

  // A material points at its TEV shader with an offset relative to itself, and that offset is
  // read back unsigned, so the shader block has to land *after* the material. Copy the material
  // first, then the shader, then fill the link in.
  const tevRelative = sourceView.getUint32(material.offset + 0x28);
  const tevBlockOffset = material.offset + tevRelative;
  const tevSize = sourceView.getUint32(tevBlockOffset + 0x00);
  const tevBlock = from.data.slice(tevBlockOffset, tevBlockOffset + tevSize);

  const materialDic = target.getDic('material')!;
  const materialIndex = materialDic.entries.length;
  const materialName = uniqueName(target, 'material', `${prefix}_${material.name}`);
  const materialBlock = from.data.slice(material.offset, material.offset + material.size);
  const newMaterialOffset = target.append(materialBlock, 0x20);

  const tevDic = target.getDic('tev')!;
  const tevIndex = tevDic.entries.length;
  const newTevOffset = target.append(tevBlock, 0x20);

  const view = new DataView(target.data.buffer, target.data.byteOffset, target.data.byteLength);
  view.setInt32(newTevOffset + 0x04, -newTevOffset);
  view.setInt32(newTevOffset + 0x08, tevIndex);
  view.setInt32(newMaterialOffset + 0x04, -newMaterialOffset);
  view.setUint32(newMaterialOffset + 0x0c, materialIndex);
  view.setUint32(newMaterialOffset + 0x28, newTevOffset - newMaterialOffset);

  target.writeDic('tev', [...tevDic.entries, { name: materialName, offset: newTevOffset }]);
  target.writeDic('material', [...materialDic.entries, { name: materialName, offset: newMaterialOffset }]);

  // Appended blocks are not scanned for names, so declare the sampler pointers explicitly.
  samplerNames.forEach((sampler, i) => {
    const at = newMaterialOffset + samplerOffset + i * 0x34;
    if (sampler.texture) target.addStringRef({ offset: at + 0x00, base: at, value: sampler.texture });
    if (sampler.palette) target.addStringRef({ offset: at + 0x04, base: at, value: sampler.palette });
  });

  materialIdMap.set(material.index, materialIndex);
  linkTextures(target, materialIndex, samplerNames, samplerOffset);
  void shapeId;
  return materialIndex;
}

/**
 * Adds the material/sampler pairs the console walks when it binds textures to a model. Without
 * these the imported geometry renders untextured in-game (noclip resolves by name and would not
 * notice).
 */
function linkTextures(
  target: Mdl0Editor,
  materialIndex: number,
  samplers: ReadonlyArray<{ texture: string; palette: string | null }>,
  samplerOffset: number,
): void {
  const materialOffset = target.getDic('material')!.entries[materialIndex].offset;
  samplers.forEach((sampler, i) => {
    if (!sampler.texture) return;
    target.addTextureLink(sampler.texture, materialOffset, materialOffset + samplerOffset + i * 0x34);
  });
}

function uniqueName(model: Mdl0Editor, kind: Mdl0DicKey, base: string): string {
  const taken = new Set(model.getDic(kind)?.entries.map((entry) => entry.name) ?? []);
  if (!taken.has(base)) return base;
  for (let i = 1; ; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function sanitize(label: string): string {
  const base = label.split(/[\\/]/).pop() ?? label;
  return base.replace(/\.brres$/i, '').replace(/[^A-Za-z0-9_.-]/g, '_') || 'placed';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
