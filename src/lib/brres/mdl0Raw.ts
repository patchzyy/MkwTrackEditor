// MDL0 reading and editing.
//
// The editor never re-lays-out an MDL0. Every pointer inside one is relative to the model, so
// new data (a rewritten vertex array, a longer draw-op list, a resource dictionary that grew by
// an entry) is *appended* past the model's old end and the pointer that reached the old block
// is repointed at the new one. Blocks that nothing points at any more are left where they are;
// they cost a few kilobytes and keep every other offset in the file valid.
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

const DRAW_LIST_NAMES = { opaque: 'DrawOpa', translucent: 'DrawXlu' } as const;
export type Mdl0DrawList = keyof typeof DRAW_LIST_NAMES;

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
        }
      }
      field += 4;
    }
    this.nameFieldOffset = field;
    this.name = readName(this.view.getUint32(this.nameFieldOffset));
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
   * Rewrites a dictionary. When entries were added the table is re-emitted at the end of the
   * model and the header pointer moved; otherwise it is patched in place.
   */
  public writeDic(key: Mdl0DicKey, entries: readonly Mdl0DicEntry[]): void {
    const dic = this.dics.get(key);
    if (!dic) throw new Error(`MDL0: no "${key}" dictionary to rewrite.`);
    const size = resDicSize(entries.length);
    let tableOffset = dic.tableOffset;
    if (entries.length !== dic.entries.length) {
      tableOffset = this.append(new Uint8Array(size), 0x04);
      this.view.setUint32(dic.headerFieldOffset, tableOffset);
    }
    // Names are re-pointed by `collectStringRefs`; a placeholder keeps the table self-consistent.
    writeResDic(
      this.buffer,
      tableOffset,
      entries.map((entry) => ({ name: entry.name, nameOffset: tableOffset, dataOffset: entry.offset })),
    );
    this.dics.set(key, { ...dic, tableOffset, entries: entries.map((entry) => ({ ...entry })) });
    this.dirty = true;
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

  /** Rewrites the size field and returns the final bytes plus their outbound string pointers. */
  public finish(): { data: Uint8Array; stringRefs: BrresStringRef[] } {
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
    return refs;
  }

  /** All names this model references, so the caller can make sure the pool has them. */
  public collectNames(): string[] {
    return [...new Set(this.collectStringRefs().map((ref) => ref.value))];
  }
}
