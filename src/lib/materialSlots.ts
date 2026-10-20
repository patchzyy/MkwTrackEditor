// Material slots: which material each draw call of a model uses, and re-pointing one draw call
// at a different material of the same model.
//
// An MDL0 draws through two byte-code lists, `DrawOpa` (opaque pass) and `DrawXlu` (translucent
// pass). Each entry is one draw call: a (material, shape, node) triple. Everything in the editor
// addresses a draw call by its index into the concatenation `[...DrawOpa, ...DrawXlu]` — the
// renderer's `shapeInstances`, the mesh picker, Model-mode edits and `SurfacePick.drawOpIndex`.
//
// A draw op names its material by index into its *own model's* material dictionary, so a draw
// call can only ever be given another material of the same model. Assigning a material from a
// different model (or a different archive) would mean copying that material, its shader and its
// textures in first; that is not what this module does.
//
// Pure: bytes in, bytes out. No renderer, no DOM.

import { BRRES_MODELS_GROUP, makeSubFileNameReader, readBrresRaw, writeBrres, type BrresRaw, type BrresSubFileRaw } from './brres/brresRaw';
import { Mdl0Editor, type Mdl0DrawList, type Mdl0DrawOp } from './brres/mdl0Raw';
import { internString } from './brres/stringPool';
import { MATERIAL_FIELDS as MAT, MAT_LAYER_SIZE } from './gxMaterial/materialCodec';

/** One draw call of a model. */
export interface ModelSlot {
  /** Index into `[...DrawOpa, ...DrawXlu]`. */
  drawOpIndex: number;
  shapeIndex: number;
  shapeName: string;
  materialIndex: number;
  materialName: string;
  /** The material's own translucent flag (it decides which pass the material belongs in). */
  translucent: boolean;
  /** Which draw list the op sits in right now. */
  pass: 'opaque' | 'translucent';
  nodeId: number;
}

/** One material, cheap enough to list for every model of every archive in a track. */
export interface MaterialBrief {
  modelName: string;
  materialIndex: number;
  materialName: string;
  translucent: boolean;
  /** Texture names of the material's layers, in layer order. Empty string for an unnamed layer. */
  textureNames: string[];
}

export interface SetDrawOpMaterialResult {
  bytes: Uint8Array;
  /** False when the draw op already used that material; `bytes` is then the input, untouched. */
  changed: boolean;
  /**
   * Where the draw call is now. Equal to the requested index unless the op had to move to the
   * other pass, in which case it is appended to the end of that list.
   */
  drawOpIndex: number;
  /** True when the op moved between the opaque and the translucent pass. */
  moved: boolean;
  /**
   * `indexMap[oldIndex]` is the new combined index of every draw op. Identity unless `moved`.
   * Use it to re-key anything stored by draw-op index (Model-mode mesh edits, a selection).
   */
  indexMap: number[];
}

export class MaterialSlotError extends Error {}

interface DrawOpLocation {
  list: Mdl0DrawList;
  indexInList: number;
  /** Offset of the 8-byte op inside the MDL0. */
  offset: number;
  op: Mdl0DrawOp;
}

const BYTECODE_RET = 0x01;
const BYTECODE_DRAW = 0x04;
const BYTECODE_NOP = 0x00;
const DRAW_LIST_NAMES: Record<Mdl0DrawList, string> = { opaque: 'DrawOpa', translucent: 'DrawXlu' };

function modelEntries(raw: BrresRaw): BrresSubFileRaw[] {
  return raw.groups.find((group) => group.name === BRRES_MODELS_GROUP)?.entries ?? [];
}

function openModel(raw: BrresRaw, modelName: string): { subFile: BrresSubFileRaw; editor: Mdl0Editor } {
  const models = modelEntries(raw);
  const subFile = models.find((entry) => entry.name === modelName) ?? (modelName === '' ? models[0] : undefined);
  if (!subFile) throw new MaterialSlotError(`This archive has no model called "${modelName}".`);
  return { subFile, editor: new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile)) };
}

/** Draw ops of both lists with their byte offsets, in combined order. */
function locateDrawOps(editor: Mdl0Editor): DrawOpLocation[] {
  const data = editor.data;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const byteCode = editor.getDic('byteCode');
  const out: DrawOpLocation[] = [];
  for (const list of ['opaque', 'translucent'] as const) {
    const entry = byteCode?.entries.find((candidate) => candidate.name === DRAW_LIST_NAMES[list]);
    if (!entry) continue;
    let at = entry.offset;
    let indexInList = 0;
    for (let guard = 0; guard < 1_000_000 && at < data.length; guard++) {
      const code = view.getUint8(at);
      if (code === BYTECODE_RET) break;
      if (code === BYTECODE_NOP) { at += 1; continue; }
      if (code !== BYTECODE_DRAW) throw new MaterialSlotError(`Model "${editor.name}" has draw byte code this editor does not understand.`);
      out.push({
        list,
        indexInList: indexInList++,
        offset: at,
        op: {
          materialId: view.getUint16(at + 0x01),
          shapeId: view.getUint16(at + 0x03),
          nodeId: view.getUint16(at + 0x05),
          priority: view.getUint8(at + 0x07),
        },
      });
      at += 0x08;
    }
  }
  return out;
}

function materialTranslucency(editor: Mdl0Editor): boolean[] {
  return editor.listMaterials().map((material) => material.translucent);
}

/** Every draw call of one model, in `[...DrawOpa, ...DrawXlu]` order. */
export function listModelSlots(brres: Uint8Array, modelName: string): ModelSlot[] {
  const { editor } = openModel(readBrresRaw(brres), modelName);
  const materials = editor.listMaterials();
  const shapes = editor.listShapes();
  return locateDrawOps(editor).map((location, drawOpIndex) => ({
    drawOpIndex,
    shapeIndex: location.op.shapeId,
    shapeName: shapes[location.op.shapeId]?.name ?? `shape ${location.op.shapeId}`,
    materialIndex: location.op.materialId,
    materialName: materials[location.op.materialId]?.name ?? `material ${location.op.materialId}`,
    translucent: materials[location.op.materialId]?.translucent ?? false,
    pass: location.list,
    nodeId: location.op.nodeId,
  }));
}

/** Names of the models in an archive, in dictionary order. */
export function listModelNames(brres: Uint8Array): string[] {
  return modelEntries(readBrresRaw(brres)).map((entry) => entry.name);
}

/**
 * Every material of every model in an archive, with its texture names. Reads only the material
 * headers and their layer tables: no TEV decoding, no display lists, no texture data.
 */
export function listArchiveMaterialsBrief(brres: Uint8Array): MaterialBrief[] {
  const raw = readBrresRaw(brres);
  const out: MaterialBrief[] = [];
  for (const subFile of modelEntries(raw)) {
    let editor: Mdl0Editor;
    try {
      editor = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile));
    } catch {
      continue; // A model this editor cannot open has no materials to offer.
    }
    const data = editor.data;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const entries = editor.getDic('material')?.entries ?? [];
    entries.forEach((entry, materialIndex) => {
      const textureNames: string[] = [];
      const count = view.getUint32(entry.offset + MAT.numLayers);
      const layerOffset = view.getUint32(entry.offset + MAT.layerOffset);
      for (let i = 0; i < count && i < 8; i++) {
        const at = entry.offset + layerOffset + i * MAT_LAYER_SIZE;
        if (at + 4 > data.length) break;
        const relative = view.getInt32(at);
        textureNames.push(relative !== 0 ? editor.readNameAt(at + relative) : '');
      }
      out.push({
        modelName: subFile.name,
        materialIndex,
        materialName: entry.name,
        translucent: (view.getUint32(entry.offset + MAT.flags) & 0x80000000) !== 0,
        textureNames,
      });
    });
  }
  return out;
}

/**
 * Re-points one draw call at another material of the same model.
 *
 * When the new material belongs in the same pass as the old one, the two bytes of the op's
 * material index are patched and nothing else in the file changes. When the pass differs (an
 * opaque material swapped for a translucent one or back), the op moves to the end of the other
 * draw list, exactly like `applyMaterial` does when a material's translucency changes, and the
 * archive is re-written; see `indexMap` for how the other draw calls' indices shift.
 *
 * A draw op that sits in a list that does not match its *old* material's flag (some custom
 * tracks do this on purpose) is left in its list.
 */
export function setDrawOpMaterialDetailed(brres: Uint8Array, modelName: string, drawOpIndex: number, materialIndex: number): SetDrawOpMaterialResult {
  const raw = readBrresRaw(brres);
  const { subFile, editor } = openModel(raw, modelName);
  const locations = locateDrawOps(editor);
  const identity = locations.map((_, index) => index);
  const target = locations[drawOpIndex];
  if (!target) throw new MaterialSlotError(`Model "${modelName}" has no draw call ${drawOpIndex}.`);
  const translucency = materialTranslucency(editor);
  if (!Number.isInteger(materialIndex) || materialIndex < 0 || materialIndex >= translucency.length) {
    throw new MaterialSlotError(`Model "${modelName}" has no material ${materialIndex}.`);
  }
  if (target.op.materialId === materialIndex) {
    return { bytes: brres, changed: false, drawOpIndex, moved: false, indexMap: identity };
  }

  const oldTranslucent = translucency[target.op.materialId] ?? target.list === 'translucent';
  const newTranslucent = translucency[materialIndex];
  const inOldPass = target.list === (oldTranslucent ? 'translucent' : 'opaque');
  const move = oldTranslucent !== newTranslucent && inOldPass;

  if (!move) {
    if (subFile.sourceOffset < 0) throw new MaterialSlotError('The model is not where the archive says it is.');
    const out = brres.slice();
    const at = subFile.sourceOffset + target.offset + 0x01;
    out[at] = (materialIndex >> 8) & 0xff;
    out[at + 1] = materialIndex & 0xff;
    return { bytes: out, changed: true, drawOpIndex, moved: false, indexMap: identity };
  }

  const from: Mdl0DrawList = target.list;
  const to: Mdl0DrawList = from === 'opaque' ? 'translucent' : 'opaque';
  const fromOps = locations.filter((location) => location.list === from);
  const toOps = locations.filter((location) => location.list === to);
  const keptFrom = fromOps.filter((location) => location !== target);
  const movedOp: Mdl0DrawOp = { ...target.op, materialId: materialIndex };
  editor.writeDrawOps(from, keptFrom.map((location) => location.op));
  editor.writeDrawOps(to, [...toOps.map((location) => location.op), movedOp]);

  // New combined order: opaque list first, then translucent.
  const order = from === 'opaque'
    ? [...keptFrom, ...toOps, target]
    : [...toOps, target, ...keptFrom];
  const indexMap = locations.map((location) => order.indexOf(location));

  const finished = editor.finish();
  if (finished.data.length !== subFile.data.length) declareNamesBefore(raw, subFile);
  subFile.data = finished.data;
  subFile.stringRefs = finished.stringRefs;
  for (const ref of finished.stringRefs) internString(raw.pool, ref.value);
  return { bytes: writeBrres(raw), changed: true, drawOpIndex: indexMap[drawOpIndex], moved: true, indexMap };
}

/**
 * A model that grew pushes the string pool back, so every sub-file laid out *before* it changes
 * its distance to the pool and has to spell its names out. Object archives often carry several
 * models (`itembox`, `itembox-low`, `itembox-shadow`), which is when this matters.
 */
function declareNamesBefore(raw: BrresRaw, grown: BrresSubFileRaw): void {
  const index = raw.layout.indexOf(grown);
  for (let i = 0; i < index; i++) {
    const subFile = raw.layout[i];
    if (subFile.stringRefs !== null) continue;
    if (subFile.magic !== 'MDL0') {
      throw new MaterialSlotError(`This archive stores "${subFile.name}" ahead of the model, so the draw call cannot change pass here.`);
    }
    subFile.stringRefs = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile)).collectStringRefs();
  }
}

/** `setDrawOpMaterialDetailed`, returning just the new archive bytes. */
export function setDrawOpMaterial(brres: Uint8Array, modelName: string, drawOpIndex: number, materialIndex: number): Uint8Array {
  return setDrawOpMaterialDetailed(brres, modelName, drawOpIndex, materialIndex).bytes;
}

/** Finds a material of a model by name. Returns -1 when there is none. */
export function findMaterialIndex(brres: Uint8Array, modelName: string, materialName: string): number {
  const { editor } = openModel(readBrresRaw(brres), modelName);
  return editor.getDic('material')?.entries.findIndex((entry) => entry.name === materialName) ?? -1;
}
