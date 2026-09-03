// MDL0 reading and editing.
//
// The editor does not re-lay-out an MDL0. Every pointer inside one is relative to the thing that
// holds it, so new data (a rewritten vertex array, a longer draw-op list, a copied material) is
// *appended* past the model's old end and the pointer that reached the old block is repointed at
// the new one. Blocks nothing points at any more are left where they are; they cost a few
// kilobytes and keep every other offset in the file valid.
//
// Two rules constrain where things can go:
//
//  - A pointer that reaches another block — a resource dictionary to its data, a material to its
//    TEV shader — is read back *unsigned*, so the target must sit after the pointer. Appending is
//    fine for that; growing a dictionary is not, because the table would end up behind its own
//    data. `relayoutDictionaries` handles that case by opening a gap in front of the first block
//    and re-emitting every table into it.
//  - Readers over-read the tail of a block on purpose (a fixed-size material display list, four
//    bytes past a vertex array), so an edited model keeps `TRAILING_SLACK` bytes behind the last
//    block it appended.
//
// The one thing that points outside an MDL0 is a name. `collectStringRefs` enumerates every
// such field so `writeBrres` can re-target them at the rebuilt string pool.

import type { BrresStringRef } from './brresRaw';
import { readCString } from './stringPool';
import { readResDic, resDicSize, writeResDic, type ResDicEntryRaw } from './resDic';
import {
  GX_ATTR,
  GX_COMP_TYPE,
  componentByteSize,
  decodeVertexArray,
  encodeVertexArray,
  readCpRegisters,
  readPrimitiveVertices,
  readVertexDescriptor,
  valuesFitFormat,
  type GxCompType,
  type GxVertexArrayFormat,
} from './gxVertex';

export type Mdl0DicKey =
  | 'byteCode' | 'node' | 'vtxPos' | 'vtxNrm' | 'vtxClr' | 'vtxTxc'
  | 'furVec' | 'furPos' | 'material' | 'tev' | 'shape' | 'texture' | 'palette' | 'userData';

export interface Mdl0DicEntry {
  name: string;
  /** Offset of the entry's data, relative to the start of the MDL0. */
  offset: number;
}

export interface Mdl0Dic {
  key: Mdl0DicKey;
  /** Offset of the u32 in the MDL0 header that points at this dictionary. */
  headerFieldOffset: number;
  /** Offset of the dictionary table, relative to the start of the MDL0. */
  tableOffset: number;
  entries: Mdl0DicEntry[];
}

export type VertexArrayKind = 'vtxPos' | 'vtxNrm' | 'vtxClr' | 'vtxTxc';

export interface Mdl0VertexArrayInfo {
  kind: VertexArrayKind;
  index: number;
  name: string;
  /** Offset of the array block, relative to the start of the MDL0. */
  blockOffset: number;
  blockSize: number;
  /** Offset of the raw element data, relative to the start of the MDL0. */
  dataOffset: number;
  compCnt: number;
  compType: GxCompType;
  compShift: number;
  stride: number;
  count: number;
}

export interface Mdl0ShapeInfo {
  index: number;
  name: string;
  /** Offset of the shape block, relative to the start of the MDL0. */
  offset: number;
  size: number;
  mtxIdx: number;
  vertexCount: number;
  polygonCount: number;
  positionArrayId: number;
  normalArrayId: number;
  prePrimOffset: number;
  prePrimSize: number;
  primOffset: number;
  primSize: number;
}

export interface Mdl0NodeInfo {
  index: number;
  name: string;
  offset: number;
  id: number;
  mtxId: number;
  parentNodeId: number;
  /** Local SRT matrix, row-major 4x4 in the gl-matrix column-major layout. */
  scale: [number, number, number];
  rotation: [number, number, number];
  translation: [number, number, number];
}

export interface Mdl0DrawOp {
  materialId: number;
  shapeId: number;
  nodeId: number;
  /** Draw priority byte (op + 7). */
  priority: number;
}

/** A note the writer wants to surface to the user. Structurally the same as `BakeWarning`. */
export interface BakeIssue {
  code: string;
  message: string;
}

const DRAW_LIST_NAMES = { opaque: 'DrawOpa', translucent: 'DrawXlu' } as const;
export type Mdl0DrawList = keyof typeof DRAW_LIST_NAMES;

/** Dictionaries whose blocks start with `[u32 size][s32 offset back to the model]`. */
const BLOCKS_WITH_BACK_POINTER: Mdl0DicKey[] = [
  'node', 'vtxPos', 'vtxNrm', 'vtxClr', 'vtxTxc', 'furVec', 'furPos', 'material', 'tev', 'shape',
];

/** Bytes kept past the last appended block, to cover readers that over-read a block's tail. */
const TRAILING_SLACK = 0x400;

const BYTECODE_RET = 0x01;
const BYTECODE_NOP = 0x00;
const BYTECODE_DRAW = 0x04;

function alignUp(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}

export class Mdl0Editor {
  private buffer: Uint8Array;
  private view: DataView;
  public readonly version: number;
  public readonly name: string;
  private readonly dicOrder: Mdl0DicKey[];
  private dics = new Map<Mdl0DicKey, Mdl0Dic>();
  private nameFieldOffset: number;
  private dirty = false;
  /** Start of the region the editor appended; blocks past this were not in the source file. */
  private appendedRegionStart: number;
  /** Bytes each dictionary table was originally allocated, i.e. how far it can grow in place. */
  private tableCapacity = new Map<Mdl0DicKey, number>();
  private dirtyDics = new Set<Mdl0DicKey>();
  private extraStringRefs: BrresStringRef[] = [];
  private queuedDrawOps: Record<Mdl0DrawList, Mdl0DrawOp[]> = { opaque: [], translucent: [] };
  private pendingTextureLinks = new Map<string, Array<{ materialOffset: number; samplerOffset: number }>>();
  /** Issues raised while flushing deferred blocks; read them with `takeIssues`. */
  private issues: BakeIssue[] = [];

  /**
   * `readName` resolves a model-relative offset to a name. Names live in the archive's string
   * pool, i.e. *outside* the model, so the caller has to supply the surrounding archive; use
   * `openMdl0Editor` rather than calling this directly.
   */
  constructor(data: Uint8Array, private readName: (offsetFromModelStart: number) => string) {
    this.buffer = data.slice();
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
    if (readCString(this.buffer.subarray(0, 4), 0) !== 'MDL0') throw new Error('Not an MDL0 block.');
    this.version = this.view.getUint32(0x08);
    if (this.version < 0x08 || this.version > 0x0b) throw new Error(`MDL0: unsupported version ${this.version}.`);

    const order: Mdl0DicKey[] = ['byteCode', 'node', 'vtxPos', 'vtxNrm', 'vtxClr', 'vtxTxc'];
    if (this.version >= 0x0a) order.push('furVec', 'furPos');
    order.push('material', 'tev', 'shape', 'texture', 'palette');
    if (this.version >= 0x0b) order.push('userData');
    this.dicOrder = order;

    let field = 0x10;
    for (const key of order) {
      const tableOffset = this.view.getUint32(field);
      if (tableOffset !== 0) {
        const dic = readResDic(this.buffer, tableOffset, readName);
        if (dic) {
          this.dics.set(key, {
            key,
            headerFieldOffset: field,
            tableOffset,
            entries: dic.entries.map((entry: ResDicEntryRaw) => ({ name: entry.name, offset: entry.dataOffset })),
          });
          this.tableCapacity.set(key, resDicSize(dic.entries.length));
        }
      }
      field += 4;
    }
    this.nameFieldOffset = field;
    this.name = readName(this.view.getUint32(this.nameFieldOffset));
    this.appendedRegionStart = this.buffer.length;
  }

  /**
   * Records a name pointer inside a block the editor appended. Blocks that came from the source
   * file are scanned automatically; appended ones cannot be, because their names are not in the
   * source archive yet.
   */
  public addStringRef(ref: BrresStringRef): void {
    this.extraStringRefs.push(ref);
  }

  /** Draw ops to append when the draw lists are next written. */
  public queueDrawOp(list: Mdl0DrawList, op: Mdl0DrawOp): void {
    this.queuedDrawOps[list].push(op);
    this.dirty = true;
  }

  public pendingDrawOps(list: Mdl0DrawList): Mdl0DrawOp[] {
    return this.queuedDrawOps[list];
  }

  public get data(): Uint8Array {
    return this.buffer;
  }

  public get modified(): boolean {
    return this.dirty;
  }

  public getDic(key: Mdl0DicKey): Mdl0Dic | null {
    return this.dics.get(key) ?? null;
  }

  /** Resolves a model-relative offset to a name in the surrounding archive's string pool. */
  public readNameAt(offsetFromModelStart: number): string {
    return this.readName(offsetFromModelStart);
  }

  /**
   * Creates an empty dictionary for `key` if the model has none, so entries can be added to a
   * section the source file left out. Returns null when the model is too old to have the field.
   */
  public ensureDic(key: Mdl0DicKey): Mdl0Dic | null {
    const existing = this.dics.get(key);
    if (existing) return existing;
    const fieldIndex = this.dicOrder.indexOf(key);
    if (fieldIndex < 0) return null;
    // tableOffset 0 means "not placed yet"; `relayoutDictionaries` finds it a home.
    const dic: Mdl0Dic = { key, headerFieldOffset: 0x10 + fieldIndex * 4, tableOffset: 0, entries: [] };
    this.dics.set(key, dic);
    this.tableCapacity.set(key, 0);
    this.dirtyDics.add(key);
    this.dirty = true;
    return dic;
  }

  // ------------------------------------------------------------------ texture links

  /**
   * Records that `materialOffset`'s sampler at `samplerOffset` binds `textureName`. The console
   * uses the MDL0 "Textures" section to patch texture pointers into materials at load time;
   * geometry whose material is not listed there renders untextured on hardware even though
   * noclip (which resolves by name) shows it fine. Flushed by `finish`.
   */
  public addTextureLink(textureName: string, materialOffset: number, samplerOffset: number): void {
    const list = this.pendingTextureLinks.get(textureName) ?? [];
    if (!list.some((entry) => entry.materialOffset === materialOffset && entry.samplerOffset === samplerOffset)) {
      list.push({ materialOffset, samplerOffset });
    }
    this.pendingTextureLinks.set(textureName, list);
    this.dirty = true;
  }

  /** Reads an existing texture-link block as model-relative offsets. */
  private readTextureLink(blockOffset: number): Array<{ materialOffset: number; samplerOffset: number }> {
    const count = this.view.getInt32(blockOffset + 0x00);
    if (count < 0 || blockOffset + 0x04 + count * 0x08 > this.buffer.length) return [];
    const entries: Array<{ materialOffset: number; samplerOffset: number }> = [];
    for (let i = 0; i < count; i++) {
      const at = blockOffset + 0x04 + i * 0x08;
      entries.push({
        materialOffset: blockOffset + this.view.getInt32(at + 0x00),
        samplerOffset: blockOffset + this.view.getInt32(at + 0x04),
      });
    }
    return entries;
  }

  /**
   * Re-emits every texture-link block that gained an entry. Blocks are variable length, so a
   * changed one is appended and its dictionary entry repointed, like everything else here.
   */
  private flushTextureLinks(): BakeIssue[] {
    if (this.pendingTextureLinks.size === 0) return [];
    const dic = this.ensureDic('texture');
    if (!dic) return [{ code: 'model.no-texture-section', message: 'This model has no texture section, so imported geometry may render untextured in game.' }];

    let entries = [...dic.entries];
    for (const [textureName, added] of this.pendingTextureLinks) {
      const index = entries.findIndex((entry) => entry.name === textureName);
      const existing = index >= 0 ? this.readTextureLink(entries[index].offset) : [];
      const merged = [...existing];
      for (const link of added) {
        if (!merged.some((entry) => entry.materialOffset === link.materialOffset && entry.samplerOffset === link.samplerOffset)) {
          merged.push(link);
        }
      }
      if (merged.length === existing.length) continue;

      const block = new Uint8Array(0x04 + merged.length * 0x08);
      const blockView = new DataView(block.buffer);
      blockView.setInt32(0x00, merged.length);
      const offset = this.append(block, 0x04);
      // Re-relativize against the block's own position now that it is known.
      merged.forEach((link, i) => {
        this.view.setInt32(offset + 0x04 + i * 0x08 + 0x00, link.materialOffset - offset);
        this.view.setInt32(offset + 0x04 + i * 0x08 + 0x04, link.samplerOffset - offset);
      });
      this.view.setInt32(offset + 0x00, merged.length);
      if (index >= 0) entries[index] = { ...entries[index], offset };
      else entries = [...entries, { name: textureName, offset }];
    }
    this.pendingTextureLinks.clear();
    if (entries.length !== dic.entries.length || entries.some((entry, i) => entry.offset !== dic.entries[i]?.offset)) {
      this.writeDic('texture', entries);
    }
    return [];
  }

  // ------------------------------------------------------------------ appending

  /** Appends `bytes` past the model's current end and returns the model-relative offset. */
  public append(bytes: Uint8Array, alignment = 0x20): number {
    const offset = alignUp(this.buffer.length, alignment);
    const next = new Uint8Array(offset + bytes.length);
    next.set(this.buffer, 0);
    next.set(bytes, offset);
    this.buffer = next;
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
    this.dirty = true;
    return offset;
  }

  /**
   * Records the new contents of a dictionary. Nothing is written yet: where the table ends up
   * depends on whether it still fits where it is, and that is only known once every edit is in.
   * `finish` does the laying out.
   */
  public writeDic(key: Mdl0DicKey, entries: readonly Mdl0DicEntry[]): void {
    const dic = this.dics.get(key) ?? this.ensureDic(key);
    if (!dic) throw new Error(`MDL0: no "${key}" dictionary to rewrite.`);
    this.dics.set(key, { ...dic, entries: entries.map((entry) => ({ ...entry })) });
    this.dirtyDics.add(key);
    this.dirty = true;
  }

  /**
   * Places every dictionary table and repoints the header at it.
   *
   * A resource-dictionary entry stores the offset of its data *relative to the table*, and that
   * number is read back unsigned — by noclip, and by anything else that follows NW4R's canonical
   * "all tables first, then all data" layout. So a table can never be moved to the end of the
   * model past the blocks it points at. Instead, when a table has grown out of its slot, all the
   * tables are re-emitted into a gap opened up in front of the first data block, and everything
   * from there on is shifted down to make room.
   */
  private relayoutDictionaries(): void {
    if (this.dirtyDics.size === 0) return;
    const dics = [...this.dics.values()];
    const outgrown = dics.some((dic) => dic.tableOffset === 0 || resDicSize(dic.entries.length) > this.tableCapacity.get(dic.key)!);

    if (!outgrown) {
      for (const key of this.dirtyDics) this.writeDicTable(this.dics.get(key)!);
      this.dirtyDics.clear();
      return;
    }

    // Align *down*: the gap has to start at or before the first block, or that block would stay
    // put and end up in front of the tables.
    const gapAt = Math.min(...dics.flatMap((dic) => dic.entries.map((entry) => entry.offset))) & ~0x03;
    const gapSize = alignUp(dics.reduce((sum, dic) => sum + alignUp(resDicSize(dic.entries.length), 0x04), 0), 0x20);
    this.insertGap(gapAt, gapSize);

    // `insertGap` rebuilt every dictionary with shifted block offsets, so re-read them.
    let cursor = gapAt;
    for (const key of dics.map((dic) => dic.key)) {
      const dic = this.dics.get(key)!;
      const placed: Mdl0Dic = { ...dic, tableOffset: cursor };
      this.dics.set(dic.key, placed);
      this.view.setUint32(placed.headerFieldOffset, cursor);
      this.writeDicTable(placed);
      cursor += alignUp(resDicSize(placed.entries.length), 0x04);
      this.tableCapacity.set(placed.key, resDicSize(placed.entries.length));
    }
    this.dirtyDics.clear();
  }

  private writeDicTable(dic: Mdl0Dic): void {
    for (const entry of dic.entries) {
      if (entry.offset < dic.tableOffset) {
        throw new Error(`MDL0: "${entry.name}" sits in front of the ${dic.key} dictionary that points at it.`);
      }
    }
    // Names are re-pointed by `collectStringRefs`; the placeholder keeps the table self-consistent.
    writeResDic(
      this.buffer,
      dic.tableOffset,
      dic.entries.map((entry) => ({ name: entry.name, nameOffset: dic.tableOffset, dataOffset: entry.offset })),
    );
  }

  /**
   * Opens `length` bytes of space at `at`, moving everything past it down.
   *
   * This is safe because of how an MDL0 is wired: blocks only ever point at other blocks, and
   * always relative to themselves, so two blocks that move by the same amount keep pointing at
   * each other. The absolute references are the header's dictionary pointers, each block's
   * "distance back to the model" field, and the dictionary entries — all rewritten here.
   */
  private insertGap(at: number, length: number): void {
    const next = new Uint8Array(this.buffer.length + length);
    next.set(this.buffer.subarray(0, at), 0);
    next.set(this.buffer.subarray(at), at + length);
    this.buffer = next;
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
    this.dirty = true;

    const shift = (offset: number) => (offset >= at ? offset + length : offset);
    for (const dic of this.dics.values()) {
      this.dics.set(dic.key, {
        ...dic,
        tableOffset: shift(dic.tableOffset),
        entries: dic.entries.map((entry) => ({ ...entry, offset: shift(entry.offset) })),
      });
    }
    if (this.appendedRegionStart >= at) this.appendedRegionStart += length;

    // Every block that carries the standard `[u32 size][s32 -offset]` header gets its back
    // pointer refreshed. Bytecode and texture-link blocks are raw and have no such field.
    for (const key of BLOCKS_WITH_BACK_POINTER) {
      for (const entry of this.dics.get(key)?.entries ?? []) this.view.setInt32(entry.offset + 0x04, -entry.offset);
    }

    // ModelInfo's pointer to the matrix-to-node table, if that table moved.
    const info = this.nameFieldOffset + 0x04;
    const nodeTable = this.view.getInt32(info + 0x24);
    if (nodeTable !== 0 && info + nodeTable >= at) this.view.setInt32(info + 0x24, nodeTable + length);
  }

  // ------------------------------------------------------------------ vertex arrays

  public listVertexArrays(kind: VertexArrayKind): Mdl0VertexArrayInfo[] {
    const dic = this.dics.get(kind);
    if (!dic) return [];
    return dic.entries.map((entry, index) => this.readVertexArray(kind, index, entry));
  }

  public getVertexArray(kind: VertexArrayKind, index: number): Mdl0VertexArrayInfo | null {
    const dic = this.dics.get(kind);
    const entry = dic?.entries[index];
    return entry ? this.readVertexArray(kind, index, entry) : null;
  }

  private readVertexArray(kind: VertexArrayKind, index: number, entry: Mdl0DicEntry): Mdl0VertexArrayInfo {
    const at = entry.offset;
    const compShiftRaw = this.view.getUint8(at + 0x1c);
    const strideRaw = this.view.getUint8(at + 0x1d);
    return {
      kind,
      index,
      name: entry.name,
      blockOffset: at,
      blockSize: this.view.getUint32(at + 0x00),
      dataOffset: at + this.view.getUint32(at + 0x08),
      compCnt: this.view.getUint32(at + 0x14),
      compType: this.view.getUint32(at + 0x18) as GxCompType,
      // Colour arrays keep the stride in the shift field.
      compShift: kind === 'vtxClr' ? 0 : compShiftRaw,
      stride: kind === 'vtxClr' ? compShiftRaw : strideRaw,
      count: this.view.getUint16(at + 0x1e),
    };
  }

  public vertexArrayFormat(array: Mdl0VertexArrayInfo): GxVertexArrayFormat {
    const componentCount =
      array.kind === 'vtxPos' ? (array.compCnt === 0 ? 2 : 3)
      : array.kind === 'vtxNrm' ? 3
      : array.kind === 'vtxTxc' ? (array.compCnt === 0 ? 1 : 2)
      : 4;
    return { componentCount, compType: array.compType, compShift: array.compShift };
  }

  public readVertexArrayValues(array: Mdl0VertexArrayInfo): Float32Array {
    return decodeVertexArray(this.buffer, array.dataOffset, array.count, array.stride, this.vertexArrayFormat(array));
  }

  /**
   * Writes `values` back into a vertex array. Re-encodes in the original fixed-point format when
   * everything still fits, and otherwise promotes the array to float32 (rewriting its header:
   * component type, divisor, stride) and re-emits it at the end of the model.
   */
  public writeVertexArrayValues(array: Mdl0VertexArrayInfo, values: Float32Array): { promoted: boolean } {
    const format = this.vertexArrayFormat(array);
    if (values.length !== array.count * format.componentCount) {
      throw new Error(`MDL0: vertex array "${array.name}" expects ${array.count * format.componentCount} values.`);
    }
    const packedStride = format.componentCount * componentByteSize(format.compType);
    if (valuesFitFormat(values, format) && array.stride === packedStride) {
      this.buffer.set(encodeVertexArray(values, format), array.dataOffset);
      this.dirty = true;
      return { promoted: false };
    }

    const promoted: GxVertexArrayFormat = { ...format, compType: GX_COMP_TYPE.F32, compShift: 0 };
    const encoded = encodeVertexArray(values, promoted);
    const dataStart = 0x40;
    const blockSize = alignUp(dataStart + encoded.length, 0x20);
    const block = new Uint8Array(blockSize);
    // Copy the original header so id/name/count fields survive, then fix the format fields.
    block.set(this.buffer.subarray(array.blockOffset, array.blockOffset + Math.min(dataStart, array.blockSize)), 0);
    const blockView = new DataView(block.buffer);
    blockView.setUint32(0x00, blockSize);
    blockView.setUint32(0x08, dataStart);
    blockView.setUint32(0x18, GX_COMP_TYPE.F32);
    blockView.setUint8(0x1c, 0);
    blockView.setUint8(0x1d, promoted.componentCount * 4);
    block.set(encoded, dataStart);

    const offset = this.append(block, 0x20);
    const dic = this.dics.get(array.kind)!;
    const entries = dic.entries.map((entry, index) => (index === array.index ? { ...entry, offset } : entry));
    this.writeDic(array.kind, entries);
    // `mdl0Offset` (block start relative to the model) is stored at +0x04 in an array block.
    this.view.setInt32(offset + 0x04, -offset);
    return { promoted: true };
  }

  /** Copies a vertex array to a fresh block and appends it as a new array. Returns its id. */
  public duplicateVertexArray(array: Mdl0VertexArrayInfo, newName: string): number {
    const dic = this.dics.get(array.kind)!;
    const block = this.buffer.slice(array.blockOffset, array.blockOffset + array.blockSize);
    const offset = this.append(block, 0x20);
    const newIndex = dic.entries.length;
    this.view.setInt32(offset + 0x04, -offset);
    this.view.setUint32(offset + 0x10, newIndex);
    this.writeDic(array.kind, [...dic.entries, { name: newName, offset }]);
    return newIndex;
  }

  // ------------------------------------------------------------------ shapes

  public listShapes(): Mdl0ShapeInfo[] {
    const dic = this.dics.get('shape');
    if (!dic) return [];
    return dic.entries.map((entry, index) => this.readShape(index, entry));
  }

  public getShape(index: number): Mdl0ShapeInfo | null {
    const entry = this.dics.get('shape')?.entries[index];
    return entry ? this.readShape(index, entry) : null;
  }

  private readShape(index: number, entry: Mdl0DicEntry): Mdl0ShapeInfo {
    const at = entry.offset;
    return {
      index,
      name: entry.name,
      offset: at,
      size: this.view.getUint32(at + 0x00),
      mtxIdx: this.view.getInt32(at + 0x08),
      vertexCount: this.view.getUint32(at + 0x40),
      polygonCount: this.view.getUint32(at + 0x44),
      positionArrayId: this.view.getInt16(at + 0x48),
      normalArrayId: this.view.getInt16(at + 0x4a),
      prePrimOffset: at + 0x18 + this.view.getUint32(at + 0x20),
      prePrimSize: this.view.getUint32(at + 0x18),
      primOffset: at + 0x24 + this.view.getUint32(at + 0x2c),
      primSize: this.view.getUint32(at + 0x24),
    };
  }

  /** Repoints a shape at a different position / normal array. */
  public setShapeArrayId(shape: Mdl0ShapeInfo, kind: 'vtxPos' | 'vtxNrm', arrayId: number): void {
    this.view.setInt16(shape.offset + (kind === 'vtxPos' ? 0x48 : 0x4a), arrayId);
    this.dirty = true;
  }

  /**
   * Appends a copy of a shape. The copy keeps the original's display lists (so it draws the same
   * triangles) and is repointed at `positionArrayId` / `normalArrayId`. Returns the new index.
   */
  public duplicateShape(shape: Mdl0ShapeInfo, newName: string, positionArrayId: number, normalArrayId: number): number {
    const dic = this.dics.get('shape')!;
    const block = this.buffer.slice(shape.offset, shape.offset + shape.size);
    const offset = this.append(block, 0x20);
    const newIndex = dic.entries.length;
    this.view.setInt32(offset + 0x04, -offset);
    this.view.setUint32(offset + 0x3c, newIndex);
    this.view.setInt16(offset + 0x48, positionArrayId);
    this.view.setInt16(offset + 0x4a, normalArrayId);
    this.writeDic('shape', [...dic.entries, { name: newName, offset }]);
    return newIndex;
  }

  /** Node-tree bytecode: which node hangs off which parent matrix. */
  public readNodeTreeOps(): Array<{ op: 'nodeDesc'; nodeId: number; parentMtxId: number } | { op: 'mtxDup'; toMtxId: number; fromMtxId: number }> {
    const entry = this.dics.get('byteCode')?.entries.find((candidate) => candidate.name === 'NodeTree');
    if (!entry) return [];
    const ops: Array<{ op: 'nodeDesc'; nodeId: number; parentMtxId: number } | { op: 'mtxDup'; toMtxId: number; fromMtxId: number }> = [];
    let at = entry.offset;
    for (let guard = 0; guard < 1_000_000; guard++) {
      const code = this.view.getUint8(at);
      if (code === BYTECODE_RET) break;
      if (code === BYTECODE_NOP) { at += 1; continue; }
      if (code === 0x02) {
        ops.push({ op: 'nodeDesc', nodeId: this.view.getUint16(at + 0x01), parentMtxId: this.view.getUint16(at + 0x03) });
        at += 0x05;
        continue;
      }
      if (code === 0x06) {
        ops.push({ op: 'mtxDup', toMtxId: this.view.getUint16(at + 0x01), fromMtxId: this.view.getUint16(at + 0x03) });
        at += 0x05;
        continue;
      }
      break;
    }
    return ops;
  }

  public get numViewMtx(): number {
    return this.view.getUint32(this.nameFieldOffset + 0x04 + 0x1c);
  }

  /** Grows the model's bounding box to include a point, so nothing gets culled after an edit. */
  public expandModelBounds(x: number, y: number, z: number): void {
    const info = this.nameFieldOffset + 0x04;
    if (this.view.getUint8(info + 0x22) === 0) return;
    for (let axis = 0; axis < 3; axis++) {
      const value = axis === 0 ? x : axis === 1 ? y : z;
      const minAt = info + 0x28 + axis * 4;
      const maxAt = info + 0x34 + axis * 4;
      if (value < this.view.getFloat32(minAt)) this.view.setFloat32(minAt, value);
      if (value > this.view.getFloat32(maxAt)) this.view.setFloat32(maxAt, value);
    }
    this.dirty = true;
  }

  /** Which array entry each display-list vertex of a shape uses, plus its triangle list. */
  public readShapeGeometry(shape: Mdl0ShapeInfo) {
    const registers = readCpRegisters(this.buffer.subarray(shape.prePrimOffset, shape.prePrimOffset + shape.prePrimSize));
    const vcd = readVertexDescriptor(registers);
    const primitives = readPrimitiveVertices(
      this.buffer.subarray(shape.primOffset, shape.primOffset + shape.primSize),
      vcd,
      [GX_ATTR.POS, GX_ATTR.NRM],
    );
    return { vcd, ...primitives };
  }

  // ------------------------------------------------------------------ nodes

  public listNodes(): Mdl0NodeInfo[] {
    const dic = this.dics.get('node');
    if (!dic) return [];
    return dic.entries.map((entry, index) => {
      const at = entry.offset;
      return {
        index,
        name: entry.name,
        offset: at,
        id: this.view.getUint32(at + 0x0c),
        mtxId: this.view.getUint32(at + 0x10),
        parentNodeId: -1,
        scale: [this.view.getFloat32(at + 0x20), this.view.getFloat32(at + 0x24), this.view.getFloat32(at + 0x28)] as [number, number, number],
        rotation: [this.view.getFloat32(at + 0x2c), this.view.getFloat32(at + 0x30), this.view.getFloat32(at + 0x34)] as [number, number, number],
        translation: [this.view.getFloat32(at + 0x38), this.view.getFloat32(at + 0x3c), this.view.getFloat32(at + 0x40)] as [number, number, number],
      };
    });
  }

  // ------------------------------------------------------------------ materials

  public listMaterials(): Array<{ index: number; name: string; offset: number; size: number; translucent: boolean }> {
    const dic = this.dics.get('material');
    if (!dic) return [];
    return dic.entries.map((entry, index) => ({
      index,
      name: entry.name,
      offset: entry.offset,
      size: this.view.getUint32(entry.offset + 0x00),
      translucent: (this.view.getUint32(entry.offset + 0x10) & 0x80000000) !== 0,
    }));
  }

  // ------------------------------------------------------------------ draw bytecode

  public readDrawOps(list: Mdl0DrawList): Mdl0DrawOp[] | null {
    const entry = this.dics.get('byteCode')?.entries.find((candidate) => candidate.name === DRAW_LIST_NAMES[list]);
    if (!entry) return null;
    const ops: Mdl0DrawOp[] = [];
    let at = entry.offset;
    for (let guard = 0; guard < 1_000_000; guard++) {
      const op = this.view.getUint8(at);
      if (op === BYTECODE_RET) break;
      if (op === BYTECODE_NOP) { at += 1; continue; }
      if (op !== BYTECODE_DRAW) throw new Error(`MDL0: unexpected draw bytecode 0x${op.toString(16)}.`);
      ops.push({
        materialId: this.view.getUint16(at + 0x01),
        shapeId: this.view.getUint16(at + 0x03),
        nodeId: this.view.getUint16(at + 0x05),
        priority: this.view.getUint8(at + 0x07),
      });
      at += 0x08;
    }
    return ops;
  }

  /**
   * Replaces a draw list. Shorter lists are patched in place (the removed op becomes NOPs, which
   * the console skips); longer ones are appended and the dictionary entry repointed.
   */
  public writeDrawOps(list: Mdl0DrawList, ops: readonly Mdl0DrawOp[]): void {
    const dic = this.dics.get('byteCode');
    const name = DRAW_LIST_NAMES[list];
    const index = dic?.entries.findIndex((candidate) => candidate.name === name) ?? -1;
    if (!dic || index < 0) throw new Error(`MDL0: no ${name} bytecode to rewrite.`);
    const existing = this.readDrawOps(list)!;
    const encoded = new Uint8Array(ops.length * 8 + 1);
    const encodedView = new DataView(encoded.buffer);
    ops.forEach((op, i) => {
      encodedView.setUint8(i * 8, BYTECODE_DRAW);
      encodedView.setUint16(i * 8 + 1, op.materialId);
      encodedView.setUint16(i * 8 + 3, op.shapeId);
      encodedView.setUint16(i * 8 + 5, op.nodeId);
      encodedView.setUint8(i * 8 + 7, op.priority);
    });
    encodedView.setUint8(ops.length * 8, BYTECODE_RET);

    if (ops.length <= existing.length) {
      // The original list is at least this long, so it fits; pad with NOPs before the RET.
      const padded = new Uint8Array(existing.length * 8 + 1);
      padded.set(encoded.subarray(0, ops.length * 8), 0);
      padded.fill(BYTECODE_NOP, ops.length * 8, padded.length - 1);
      padded[padded.length - 1] = BYTECODE_RET;
      this.buffer.set(padded, dic.entries[index].offset);
      this.dirty = true;
      return;
    }
    const offset = this.append(encoded, 0x04);
    this.writeDic('byteCode', dic.entries.map((entry, i) => (i === index ? { ...entry, offset } : entry)));
  }

  // ------------------------------------------------------------------ finishing

  /** Issues raised while writing, cleared as they are read. */
  public takeIssues(): BakeIssue[] {
    const issues = this.issues;
    this.issues = [];
    return issues;
  }

  /** Rewrites the size field and returns the final bytes plus their outbound string pointers. */
  public finish(): { data: Uint8Array; stringRefs: BrresStringRef[] } {
    this.issues.push(...this.flushTextureLinks());
    this.relayoutDictionaries();
    // Readers over-read the tail of a block on purpose: noclip runs a fixed 384-byte display
    // list out of every material and reads four bytes past every vertex array (to cope with
    // malformed custom tracks). In the source file the next block always covers that; a block
    // the editor appended can be the last one, so an edited model keeps slack behind it.
    if (this.dirty) this.append(new Uint8Array(TRAILING_SLACK), 0x20);
    const size = alignUp(this.buffer.length, 0x20);
    if (size !== this.buffer.length) {
      const next = new Uint8Array(size);
      next.set(this.buffer, 0);
      this.buffer = next;
      this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
    }
    this.view.setUint32(0x04, size);
    return { data: this.buffer, stringRefs: this.collectStringRefs() };
  }

  /**
   * Every field inside the model that points at a name in the archive's string pool:
   * the model's own name, every resource-dictionary entry, and the name field of every node,
   * material, shape and vertex array, plus each material sampler's texture/palette name.
   */
  public collectStringRefs(): BrresStringRef[] {
    const refs: BrresStringRef[] = [{ offset: this.nameFieldOffset, value: this.name }];
    // ModelInfo keeps the path of the file the model was converted from; some custom tracks
    // still carry theirs, and it is a pool pointer like any other.
    const modelInfo = this.nameFieldOffset + 0x04;
    const originalPath = this.view.getInt32(modelInfo + 0x18);
    if (originalPath !== 0) {
      refs.push({ offset: modelInfo + 0x18, base: modelInfo, value: this.readName(modelInfo + originalPath) });
    }
    for (const key of this.dicOrder) {
      const dic = this.dics.get(key);
      if (!dic) continue;
      dic.entries.forEach((entry, index) => {
        refs.push({ offset: dic.tableOffset + 0x08 + (index + 1) * 0x10 + 0x08, base: dic.tableOffset, value: entry.name });
      });
      if (key === 'node' || key === 'material' || key === 'shape' || key === 'vtxPos' || key === 'vtxNrm' || key === 'vtxClr' || key === 'vtxTxc') {
        const nameField = key === 'shape' ? 0x38 : key === 'node' || key === 'material' ? 0x08 : 0x0c;
        for (const entry of dic.entries) {
          refs.push({ offset: entry.offset + nameField, base: entry.offset, value: entry.name });
        }
      }
      if (key === 'material') {
        for (const entry of dic.entries) {
          // Appended materials declare their sampler names through `addStringRef`.
          if (entry.offset >= this.appendedRegionStart) continue;
          const samplerCount = this.view.getUint32(entry.offset + 0x2c);
          const samplerOffset = this.view.getUint32(entry.offset + 0x30);
          for (let i = 0; i < samplerCount; i++) {
            const at = entry.offset + samplerOffset + i * 0x34;
            const texName = this.view.getInt32(at + 0x00);
            if (texName !== 0) refs.push({ offset: at + 0x00, base: at, value: this.readName(at + texName) });
            const pltName = this.view.getInt32(at + 0x04);
            if (pltName !== 0) refs.push({ offset: at + 0x04, base: at, value: this.readName(at + pltName) });
          }
        }
      }
    }
    if (this.dics.has('userData')) {
      throw new Error('MDL0: models with user data cannot be re-emitted yet.');
    }
    return [...refs, ...this.extraStringRefs];
  }

  /** All names this model references, so the caller can make sure the pool has them. */
  public collectNames(): string[] {
    return [...new Set(this.collectStringRefs().map((ref) => ref.value))];
  }
}
