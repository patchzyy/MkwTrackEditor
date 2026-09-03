// Reading and writing materials inside a BRRES.
//
// Everything here works on raw archive bytes through `src/lib/brres/`: `readBrresRaw` splits the
// container, `Mdl0Editor` owns the model's dictionaries and its append-only relocation, and
// `writeBrres` puts the archive back together and re-derives every name pointer.
//
// Three invariants shape the code:
//
//  - An MDL0 pointer is relative to the thing that holds it and is read back *unsigned*, so a
//    block can only ever be repointed at something that sits after it. A material that outgrows
//    its slot is therefore appended at the end of the model and its dictionary entry repointed;
//    the old bytes stay put and become dead weight, exactly as BrawlBox leaves them.
//  - Names live in the archive's string pool, outside the model. Any block the editor writes has
//    to declare its name pointers (`addStringRef`) so `writeBrres` can re-target them.
//  - A sub-file that changes position relative to the string pool must declare its names too.
//    Course models put the MDL0 first and the animations last, so growing the model is free and
//    inserting a texture only needs the models to declare theirs.

import {
  BRRES_MODELS_GROUP,
  BRRES_TEXTURES_GROUP,
  findSubFile,
  makeSubFileNameReader,
  readBrresRaw,
  writeBrres,
  type BrresRaw,
  type BrresSubFileRaw,
} from '../brres/brresRaw';
import { Mdl0Editor, type Mdl0DicEntry } from '../brres/mdl0Raw';
import { internString } from '../brres/stringPool';
import { listBrresTextures } from '../tex0Brres';
import {
  MATERIAL_FIELDS as MAT,
  MAT_LAYER_SIZE,
  MAT_STRUCT_SIZE,
  TEV_BLOCK_SIZE,
  TEV_FIELDS as TEV,
  decodeMaterialBlock,
  encodeMaterialBlock,
  materialBlockSize,
  tevBlocksEqual,
  validateMaterialDoc,
} from './materialCodec';
import {
  GxMaterialError,
  type AddTextureOptions,
  type ApplyMaterialOptions,
  type ApplyMaterialResult,
  type GxArchiveMaterials,
  type GxMaterialDoc,
  type GxMaterialSummary,
  type GxModelMaterials,
  type GxTextureSummary,
} from './types';

/** Sub-file magics whose outbound name pointers this module can re-derive. */
const RELOCATABLE_MAGICS = new Set(['MDL0', 'TEX0', 'PLT0']);

function viewOf(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function modelSubFiles(raw: BrresRaw): BrresSubFileRaw[] {
  return raw.groups.find((group) => group.name === BRRES_MODELS_GROUP)?.entries ?? [];
}

function openModel(raw: BrresRaw, modelName: string): { subFile: BrresSubFileRaw; editor: Mdl0Editor } {
  const models = modelSubFiles(raw);
  const subFile = models.find((entry) => entry.name === modelName) ?? (modelName === '' ? models[0] : undefined);
  if (!subFile) throw new GxMaterialError(`This archive has no model called "${modelName}".`);
  return { subFile, editor: new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile)) };
}

interface MaterialLocation {
  index: number;
  offset: number;
  size: number;
  tevOffset: number;
  block: Uint8Array;
  tev: Uint8Array;
}

function locateMaterial(editor: Mdl0Editor, materialName: string): MaterialLocation {
  const dic = editor.getDic('material');
  const index = dic?.entries.findIndex((entry) => entry.name === materialName) ?? -1;
  if (!dic || index < 0) throw new GxMaterialError(`Model "${editor.name}" has no material called "${materialName}".`);
  return readMaterialAt(editor, index, dic.entries[index].offset);
}

function readMaterialAt(editor: Mdl0Editor, index: number, offset: number): MaterialLocation {
  const view = viewOf(editor.data);
  const size = view.getUint32(offset + MAT.size);
  const tevOffset = offset + view.getUint32(offset + MAT.tevOffset);
  const tevSize = view.getUint32(tevOffset + TEV.size);
  return {
    index,
    offset,
    size,
    tevOffset,
    block: editor.data.slice(offset, offset + size),
    tev: editor.data.slice(tevOffset, tevOffset + Math.max(TEV_BLOCK_SIZE, tevSize)),
  };
}

/** Layer texture names of a material, read straight out of its block. */
function samplerNamesOf(editor: Mdl0Editor, offset: number): string[] {
  const view = viewOf(editor.data);
  const count = view.getUint32(offset + MAT.numLayers);
  const layerOffset = view.getUint32(offset + MAT.layerOffset);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = offset + layerOffset + i * MAT_LAYER_SIZE;
    const relative = view.getInt32(at);
    names.push(relative !== 0 ? editor.readNameAt(at + relative) : '');
  }
  return names;
}

// ------------------------------------------------------------------------------------- listing

export function listArchiveMaterials(archivePath: string, brres: Uint8Array): GxArchiveMaterials {
  const raw = readBrresRaw(brres);
  const models: GxModelMaterials[] = [];
  const usedBy = new Map<string, string[]>();

  for (const subFile of modelSubFiles(raw)) {
    let editor: Mdl0Editor;
    try {
      editor = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile));
    } catch {
      continue; // A model this editor cannot open simply has no materials to offer.
    }
    const view = viewOf(editor.data);
    const entries = editor.getDic('material')?.entries ?? [];
    const shapeNames = editor.listShapes().map((shape) => shape.name);

    // Which shapes each material draws, from both draw lists.
    const meshes = new Map<number, string[]>();
    for (const list of ['opaque', 'translucent'] as const) {
      for (const op of editor.readDrawOps(list) ?? []) {
        const names = meshes.get(op.materialId) ?? [];
        const shape = shapeNames[op.shapeId];
        if (shape && !names.includes(shape)) names.push(shape);
        meshes.set(op.materialId, names);
      }
    }

    // Materials that point at the same TEV block share a shader.
    const byShader = new Map<number, string[]>();
    entries.forEach((entry) => {
      const shader = entry.offset + view.getUint32(entry.offset + MAT.tevOffset);
      byShader.set(shader, [...(byShader.get(shader) ?? []), entry.name]);
    });

    const materials: GxMaterialSummary[] = entries.map((entry, index) => {
      const shader = entry.offset + view.getUint32(entry.offset + MAT.tevOffset);
      const textures = samplerNamesOf(editor, entry.offset);
      for (const texture of textures) {
        if (!texture) continue;
        const list = usedBy.get(texture) ?? [];
        if (!list.includes(entry.name)) list.push(entry.name);
        usedBy.set(texture, list);
      }
      return {
        archivePath,
        modelName: subFile.name,
        materialName: entry.name,
        index,
        translucent: (view.getUint32(entry.offset + MAT.flags) & 0x80000000) !== 0,
        textures,
        stageCount: view.getUint8(entry.offset + MAT.numTevStages),
        sharedShaderWith: (byShader.get(shader) ?? []).filter((name) => name !== entry.name),
        meshes: meshes.get(index) ?? [],
      };
    });
    models.push({ modelName: subFile.name, materials });
  }

  const textures: GxTextureSummary[] = listBrresTextures(brres).map((tex0) => ({
    name: tex0.name,
    width: tex0.width,
    height: tex0.height,
    format: tex0.format,
    mipCount: tex0.mipCount,
    usedBy: usedBy.get(tex0.name) ?? [],
  }));

  return { archivePath, models, textures };
}

export function decodeMaterial(brres: Uint8Array, modelName: string, materialName: string): GxMaterialDoc {
  const raw = readBrresRaw(brres);
  const { editor } = openModel(raw, modelName);
  if (editor.version !== 0x0b) {
    throw new GxMaterialError(`Model "${editor.name}" is MDL0 version ${editor.version}; the material editor only handles version 11.`);
  }
  const located = locateMaterial(editor, materialName);
  return decodeMaterialBlock({
    block: located.block,
    tev: located.tev,
    name: materialName,
    readName: (offset) => editor.readNameAt(located.offset + offset),
  });
}

// -------------------------------------------------------------------------------------- writing

/** Texture-link pairs are `(material, sampler)` offsets relative to the model. */
interface TextureLink {
  materialOffset: number;
  samplerOffset: number;
}

function readTextureLinks(data: Uint8Array, blockOffset: number): TextureLink[] {
  const view = viewOf(data);
  const count = view.getInt32(blockOffset);
  if (count < 0 || blockOffset + 0x04 + count * 0x08 > data.length) return [];
  const links: TextureLink[] = [];
  for (let i = 0; i < count; i++) {
    const at = blockOffset + 0x04 + i * 0x08;
    links.push({
      materialOffset: blockOffset + view.getInt32(at + 0x00),
      samplerOffset: blockOffset + view.getInt32(at + 0x04),
    });
  }
  return links;
}

function writeTextureLinkBlock(editor: Mdl0Editor, links: readonly TextureLink[]): number {
  const block = new Uint8Array(0x04 + links.length * 0x08);
  const offset = editor.append(block, 0x04);
  const view = viewOf(editor.data);
  view.setInt32(offset, links.length);
  links.forEach((link, i) => {
    const at = offset + 0x04 + i * 0x08;
    view.setInt32(at + 0x00, link.materialOffset - offset);
    view.setInt32(at + 0x04, link.samplerOffset - offset);
  });
  return offset;
}

/**
 * Rewrites the MDL0 texture-link table so it lists exactly `wanted` for this material and nothing
 * else. The console walks this table to bind textures at load time; geometry whose material is
 * missing from it renders untextured on hardware even though a name-resolving viewer shows it.
 */
function syncTextureLinks(
  editor: Mdl0Editor,
  oldMaterialOffset: number,
  wanted: ReadonlyMap<string, TextureLink[]>,
): void {
  const dic = editor.ensureDic('texture');
  if (!dic) return;

  const existing = new Map<string, TextureLink[]>();
  for (const entry of dic.entries) existing.set(entry.name, readTextureLinks(editor.data, entry.offset));

  const names = new Set([...existing.keys(), ...wanted.keys()]);
  const next = new Map<string, TextureLink[]>();
  for (const name of names) {
    const before = existing.get(name) ?? [];
    const mine = wanted.get(name) ?? [];
    // Keep foreign links where they were, and keep ours in place when they are still wanted, so
    // an edit that changes nothing produces byte-identical blocks.
    const kept = before.filter((link) =>
      link.materialOffset !== oldMaterialOffset ||
      mine.some((want) => want.materialOffset === link.materialOffset && want.samplerOffset === link.samplerOffset));
    const added = mine.filter((want) => !kept.some((link) => link.materialOffset === want.materialOffset && link.samplerOffset === want.samplerOffset));
    const merged = [...kept, ...added];
    if (merged.length > 0) next.set(name, merged);
  }

  const entries: Mdl0DicEntry[] = [];
  let changed = next.size !== dic.entries.length;
  for (const entry of dic.entries) {
    const links = next.get(entry.name);
    if (!links) {
      changed = true;
      continue;
    }
    const before = existing.get(entry.name) ?? [];
    const same = before.length === links.length && before.every((link, i) => link.materialOffset === links[i].materialOffset && link.samplerOffset === links[i].samplerOffset);
    if (same) {
      entries.push(entry);
    } else {
      entries.push({ name: entry.name, offset: writeTextureLinkBlock(editor, links) });
      changed = true;
    }
    next.delete(entry.name);
  }
  for (const [name, links] of next) {
    entries.push({ name, offset: writeTextureLinkBlock(editor, links) });
    changed = true;
  }
  if (changed) editor.writeDic('texture', entries);
}

/** Moves this material's draw ops between `DrawOpa` and `DrawXlu` when its pass changed. */
function syncDrawPass(editor: Mdl0Editor, materialIndex: number, translucent: boolean): boolean {
  const from = translucent ? 'opaque' : 'translucent';
  const to = translucent ? 'translucent' : 'opaque';
  const fromOps = editor.readDrawOps(from);
  const toOps = editor.readDrawOps(to);
  if (!fromOps || !toOps) return false;
  const moving = fromOps.filter((op) => op.materialId === materialIndex);
  if (moving.length === 0) return false;
  editor.writeDrawOps(from, fromOps.filter((op) => op.materialId !== materialIndex));
  editor.writeDrawOps(to, [...toOps, ...moving]);
  return true;
}

export function applyMaterial(
  brres: Uint8Array,
  modelName: string,
  materialName: string,
  doc: GxMaterialDoc,
  options: ApplyMaterialOptions = {},
): ApplyMaterialResult {
  validateMaterialDoc(doc);
  const raw = readBrresRaw(brres);
  const { subFile, editor } = openModel(raw, modelName);
  if (editor.version !== 0x0b) {
    throw new GxMaterialError(`Model "${editor.name}" is MDL0 version ${editor.version}; the material editor only handles version 11.`);
  }

  const materialDic = editor.getDic('material')!;
  const located = locateMaterial(editor, materialName);
  const warnings: string[] = [];

  // Every sampled texture has to exist in the archive, or the export renders untextured.
  const archiveTextures = new Set(raw.groups.find((group) => group.name === BRRES_TEXTURES_GROUP)?.entries.map((entry) => entry.name) ?? []);
  for (const sampler of doc.samplers) {
    if (sampler.texture && !archiveTextures.has(sampler.texture)) {
      throw new GxMaterialError(`This archive has no texture called "${sampler.texture}"; add it before assigning it to a material.`);
    }
  }

  // Shared shaders: several materials commonly point at one TEV block.
  const view = viewOf(editor.data);
  const sharing = materialDic.entries
    .filter((entry, index) => index !== located.index && entry.offset + view.getUint32(entry.offset + MAT.tevOffset) === located.tevOffset)
    .map((entry) => entry.name);

  const fitsInPlace = materialBlockSize(located.offset, doc.samplers.length) === located.size;
  const blockOffset = fitsInPlace ? located.offset : alignUp(editor.data.length, 0x20);
  const encoded = encodeMaterialBlock({ doc, original: located.block, originalTev: located.tev, blockOffset });

  const tevChanged = !tevBlocksEqual(encoded.tev, located.tev);
  const cloneShader = tevChanged && sharing.length > 0 && (options.sharedShader ?? 'clone') === 'clone';

  let materialOffset = located.offset;
  if (fitsInPlace) {
    editor.data.set(encoded.block, located.offset);
  } else {
    materialOffset = editor.append(encoded.block, 0x20);
    warnings.push(
      `"${materialName}" no longer fits where it was, so it was moved to the end of the model; ` +
      `${located.size} bytes of the old block are now unused.`,
    );
  }

  // The shader has to sit after the material that points at it: the offset is read unsigned.
  let tevOffset = located.tevOffset;
  if (cloneShader) {
    const tevDic = editor.getDic('tev')!;
    tevOffset = editor.append(encoded.tev, 0x20);
    const tevView = viewOf(editor.data);
    tevView.setInt32(tevOffset + TEV.mdl0Offset, -tevOffset);
    tevView.setUint32(tevOffset + TEV.index, tevDic.entries.length);
    editor.writeDic('tev', [...tevDic.entries, { name: doc.name, offset: tevOffset }]);
    warnings.push(
      `The shader was shared with ${sharing.length} other material${sharing.length === 1 ? '' : 's'}; ` +
      `"${materialName}" was given a copy of its own so the others are unchanged.`,
    );
  } else if (tevChanged) {
    // Overwrite in place. The block is always 512 bytes, so this never needs to move.
    const keepIndex = viewOf(editor.data).getUint32(located.tevOffset + TEV.index);
    editor.data.set(encoded.tev, located.tevOffset);
    const tevView = viewOf(editor.data);
    tevView.setInt32(located.tevOffset + TEV.mdl0Offset, -located.tevOffset);
    tevView.setUint32(located.tevOffset + TEV.index, keepIndex);
    // The stage *count* lives in each material's header, not in the shader, so a material that
    // shares this block would keep running the old number of stages unless it is updated too.
    for (const entry of materialDic.entries) {
      if (entry.offset === located.offset) continue;
      if (entry.offset + tevView.getUint32(entry.offset + MAT.tevOffset) !== located.tevOffset) continue;
      tevView.setUint8(entry.offset + MAT.numTevStages, doc.tevStages.length);
      if (tevView.getUint32(entry.offset + MAT.numLayers) !== doc.samplers.length) {
        warnings.push(
          `"${entry.name}" shares this shader but has a different number of textures; check how it looks.`,
        );
      }
    }
    if (sharing.length > 0) {
      warnings.push(`The shader is shared, so ${sharing.join(', ')} changed too.`);
    }
  }

  {
    const patched = viewOf(editor.data);
    patched.setInt32(materialOffset + MAT.mdl0Offset, -materialOffset);
    patched.setUint32(materialOffset + MAT.index, located.index);
    patched.setUint32(materialOffset + MAT.tevOffset, tevOffset - materialOffset);
  }

  if (!fitsInPlace) {
    editor.writeDic('material', materialDic.entries.map((entry, index) => (index === located.index ? { ...entry, offset: materialOffset } : entry)));
  }

  // Renaming: the dictionary carries the name, and `collectStringRefs` derives the block's own
  // name pointer from it. Draw ops address materials by index, so they are unaffected.
  const renamed = doc.name !== materialName;
  if (renamed) {
    if (materialDic.entries.some((entry, index) => index !== located.index && entry.name === doc.name)) {
      throw new GxMaterialError(`Model "${editor.name}" already has a material called "${doc.name}".`);
    }
    internString(raw.pool, doc.name);
    const current = editor.getDic('material')!;
    editor.writeDic('material', current.entries.map((entry, index) => (index === located.index ? { ...entry, name: doc.name } : entry)));
    const tevDic = editor.getDic('tev');
    const tevEntry = tevDic?.entries.findIndex((entry) => entry.offset === tevOffset && entry.name === materialName) ?? -1;
    if (tevDic && tevEntry >= 0 && sharing.length === 0) {
      editor.writeDic('tev', tevDic.entries.map((entry, index) => (index === tevEntry ? { ...entry, name: doc.name } : entry)));
    }
  }

  // Sampler names: the block the encoder produced has zeroed pointers, so declare them all.
  const links = new Map<string, TextureLink[]>();
  doc.samplers.forEach((sampler, i) => {
    const at = materialOffset + MAT_STRUCT_SIZE + i * MAT_LAYER_SIZE;
    if (sampler.texture) {
      editor.addStringRef({ offset: at + 0x00, base: at, value: sampler.texture });
      links.set(sampler.texture, [...(links.get(sampler.texture) ?? []), { materialOffset, samplerOffset: at }]);
    }
    if (sampler.palette) editor.addStringRef({ offset: at + 0x04, base: at, value: sampler.palette });
  });
  syncTextureLinks(editor, located.offset, links);

  const wasTranslucent = (viewOf(located.block).getUint32(MAT.flags) & 0x80000000) !== 0;
  if (wasTranslucent !== doc.translucent && syncDrawPass(editor, located.index, doc.translucent)) {
    warnings.push(`"${doc.name}" now draws in the ${doc.translucent ? 'translucent' : 'opaque'} pass.`);
  }

  const finished = editor.finish();
  subFile.data = finished.data;
  subFile.stringRefs = finished.stringRefs;
  for (const ref of finished.stringRefs) internString(raw.pool, ref.value);

  const affectedMaterials = [doc.name];
  if (tevChanged && !cloneShader) affectedMaterials.push(...sharing);

  return { brres: writeBrres(raw), warnings, affectedMaterials };
}

function alignUp(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}

// ------------------------------------------------------------------------------------- textures

const TEX0_HEADER_SIZE = 0x40;
const TEX0_VERSION = 3;

function buildTex0(options: AddTextureOptions): Uint8Array {
  const data = new Uint8Array(TEX0_HEADER_SIZE + options.data.length);
  const view = viewOf(data);
  data.set(new TextEncoder().encode('TEX0'), 0);
  view.setUint32(0x04, data.length);
  view.setUint32(0x08, TEX0_VERSION);
  view.setInt32(0x0c, 0); // Distance back to the archive; `writeBrres` fills it in.
  view.setUint32(0x10, TEX0_HEADER_SIZE);
  view.setInt32(0x14, 0); // Name pointer; declared through `stringRefs`.
  view.setUint32(0x18, 0); // No palette.
  view.setUint16(0x1c, options.width);
  view.setUint16(0x1e, options.height);
  view.setUint32(0x20, options.format);
  view.setUint32(0x24, Math.max(1, options.mipCount));
  view.setFloat32(0x28, 0);
  view.setFloat32(0x2c, Math.max(1, options.mipCount) - 1);
  data.set(options.data, TEX0_HEADER_SIZE);
  return data;
}

/**
 * Gives every sub-file in `[0, limit)` explicit name pointers, so the writer may move them
 * relative to the string pool. Only the types this editor can re-derive are supported.
 */
function declareStringRefs(raw: BrresRaw, limit: number): void {
  for (let i = 0; i < limit; i++) {
    const subFile = raw.layout[i];
    if (subFile.stringRefs !== null) continue;
    if (!RELOCATABLE_MAGICS.has(subFile.magic)) {
      throw new GxMaterialError(
        `This archive stores a ${subFile.magic} sub-file ("${subFile.name}") ahead of its textures, and its names ` +
        'cannot be re-derived, so a texture cannot be added or removed here.',
      );
    }
    const editor = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile));
    subFile.stringRefs = editor.collectStringRefs();
  }
}

function texturesGroup(raw: BrresRaw): { entries: BrresSubFileRaw[] } {
  let group = raw.groups.find((candidate) => candidate.name === BRRES_TEXTURES_GROUP);
  if (!group) {
    group = { name: BRRES_TEXTURES_GROUP, entries: [] };
    // NW4R orders the root by group name; models first, then textures, then animations.
    const modelsAt = raw.groups.findIndex((candidate) => candidate.name === BRRES_MODELS_GROUP);
    raw.groups.splice(modelsAt + 1, 0, group);
    internString(raw.pool, BRRES_TEXTURES_GROUP);
  }
  return group;
}

export function addTexture(brres: Uint8Array, texture: AddTextureOptions): Uint8Array {
  if (!texture.name) throw new GxMaterialError('A texture needs a name.');
  const raw = readBrresRaw(brres);
  const group = texturesGroup(raw);
  const data = buildTex0(texture);
  const stringRefs = [{ offset: 0x14, value: texture.name }];
  internString(raw.pool, texture.name);

  const existing = group.entries.find((entry) => entry.name === texture.name);
  if (existing) {
    if (data.length <= existing.data.length) {
      // Same slot, padded out to the old length: nothing else in the archive moves.
      const padded = new Uint8Array(existing.data.length);
      padded.set(data, 0);
      viewOf(padded).setUint32(0x04, padded.length);
      existing.data = padded;
      existing.stringRefs = stringRefs;
      return writeBrres(raw);
    }
    dropSubFile(raw, existing);
    group.entries = group.entries.filter((entry) => entry !== existing);
  }

  const subFile: BrresSubFileRaw = { name: texture.name, magic: 'TEX0', data, sourceOffset: -1, stringRefs };
  // New bytes go in ahead of everything that cannot describe its own names — in a course model
  // that means right after the models, before the animation sub-files.
  const insertAt = raw.layout.findIndex((entry) => entry.magic !== 'MDL0');
  const index = insertAt < 0 ? raw.layout.length : insertAt;
  declareStringRefs(raw, index);
  raw.layout.splice(index, 0, subFile);
  group.entries.push(subFile);
  return writeBrres(raw);
}

/**
 * Takes a sub-file out of the layout without moving anything else: its bytes (and the padding in
 * front of them) become padding for whatever came next. When it was last, the sub-files before it
 * have to declare their names instead, because the string pool moves up to fill the gap.
 */
function dropSubFile(raw: BrresRaw, subFile: BrresSubFileRaw): void {
  const index = raw.layout.indexOf(subFile);
  if (index < 0) return;
  const next = raw.layout[index + 1];
  if (next) {
    const pad = raw.padBefore.get(subFile) ?? new Uint8Array(0);
    const nextPad = raw.padBefore.get(next) ?? new Uint8Array(0);
    const merged = new Uint8Array(pad.length + subFile.data.length + nextPad.length);
    merged.set(pad, 0);
    merged.set(subFile.data, pad.length);
    merged.set(nextPad, pad.length + subFile.data.length);
    raw.padBefore.set(next, merged);
  } else {
    declareStringRefs(raw, index);
  }
  raw.padBefore.delete(subFile);
  raw.layout.splice(index, 1);
}

export function removeTexture(brres: Uint8Array, name: string): Uint8Array {
  const raw = readBrresRaw(brres);
  const group = raw.groups.find((candidate) => candidate.name === BRRES_TEXTURES_GROUP);
  const subFile = group?.entries.find((entry) => entry.name === name);
  if (!group || !subFile) throw new GxMaterialError(`This archive has no texture called "${name}".`);

  const users = listArchiveMaterials('', brres).textures.find((texture) => texture.name === name)?.usedBy ?? [];
  if (users.length > 0) {
    throw new GxMaterialError(`"${name}" is still used by ${users.join(', ')}; change those materials before removing it.`);
  }

  group.entries = group.entries.filter((entry) => entry !== subFile);
  dropSubFile(raw, subFile);
  return writeBrres(raw);
}

/** Renames a TEX0 and re-points every material sampler and texture link that named it. */
export function renameTexture(brres: Uint8Array, oldName: string, newName: string): Uint8Array {
  if (!newName) throw new GxMaterialError('A texture needs a name.');
  const raw = readBrresRaw(brres);
  const group = raw.groups.find((candidate) => candidate.name === BRRES_TEXTURES_GROUP);
  const subFile = group?.entries.find((entry) => entry.name === oldName);
  if (!group || !subFile) throw new GxMaterialError(`This archive has no texture called "${oldName}".`);
  if (group.entries.some((entry) => entry.name === newName)) {
    throw new GxMaterialError(`This archive already has a texture called "${newName}".`);
  }
  internString(raw.pool, newName);

  subFile.name = newName;
  subFile.stringRefs = [{ offset: 0x14, value: newName }];

  // A model's sampler name pointers and its texture-link dictionary both spell the texture out,
  // and both come back through `collectStringRefs`, so re-labelling the refs is the whole job.
  for (const model of modelSubFiles(raw)) {
    const editor = new Mdl0Editor(model.data, makeSubFileNameReader(raw, model));
    model.stringRefs = editor.collectStringRefs().map((ref) => (ref.value === oldName ? { ...ref, value: newName } : ref));
  }
  return writeBrres(raw);
}

export { findSubFile };
