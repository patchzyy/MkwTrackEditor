// GX vertex arrays and primitive display lists.
//
// Enough of the GX pipeline to (a) read an MDL0 vertex array back into floats, (b) write it out
// again in the same fixed-point format (or promote it to float32 when the edited values no
// longer fit), and (c) walk a shape's primitive display list so we know which array entries a
// triangle uses.

export const GX_COMMAND = {
  NOOP: 0x00,
  DRAW_QUADS: 0x80,
  DRAW_QUAD_STRIP: 0x88,
  DRAW_TRIANGLES: 0x90,
  DRAW_TRIANGLE_STRIP: 0x98,
  DRAW_TRIANGLE_FAN: 0xa0,
  DRAW_LINES: 0xa8,
  DRAW_LINE_STRIP: 0xb0,
  DRAW_POINTS: 0xb8,
  LOAD_INDX_A: 0x20,
  LOAD_INDX_B: 0x28,
  LOAD_INDX_C: 0x30,
  LOAD_INDX_D: 0x38,
  LOAD_BP_REG: 0x61,
  LOAD_CP_REG: 0x08,
  LOAD_XF_REG: 0x10,
} as const;

export const GX_COMP_TYPE = { U8: 0, S8: 1, U16: 2, S16: 3, F32: 4 } as const;
export type GxCompType = 0 | 1 | 2 | 3 | 4;

export const GX_ATTR = {
  PNMTXIDX: 0,
  TEX0MTXIDX: 1,
  TEX7MTXIDX: 8,
  POS: 9,
  NRM: 10,
  CLR0: 11,
  CLR1: 12,
  TEX0: 13,
  TEX7: 20,
} as const;

export function componentByteSize(compType: number): number {
  switch (compType) {
    case GX_COMP_TYPE.U8:
    case GX_COMP_TYPE.S8:
      return 1;
    case GX_COMP_TYPE.U16:
    case GX_COMP_TYPE.S16:
      return 2;
    case GX_COMP_TYPE.F32:
      return 4;
    default:
      throw new Error(`GX: unsupported component type ${compType}`);
  }
}

export interface GxVertexArrayFormat {
  /** Values per element: 2 or 3 for positions, 3 for normals, 1 or 2 for texcoords. */
  componentCount: number;
  compType: GxCompType;
  /** Fixed-point fractional bits. Ignored for F32. */
  compShift: number;
}

export function decodeVertexArray(
  data: Uint8Array,
  offset: number,
  count: number,
  stride: number,
  format: GxVertexArrayFormat,
): Float32Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out = new Float32Array(count * format.componentCount);
  const divisor = format.compType === GX_COMP_TYPE.F32 ? 1 : 1 / (1 << format.compShift);
  for (let i = 0; i < count; i++) {
    const base = offset + i * stride;
    for (let c = 0; c < format.componentCount; c++) {
      const at = base + c * componentByteSize(format.compType);
      let raw: number;
      switch (format.compType) {
        case GX_COMP_TYPE.U8: raw = view.getUint8(at); break;
        case GX_COMP_TYPE.S8: raw = view.getInt8(at); break;
        case GX_COMP_TYPE.U16: raw = view.getUint16(at); break;
        case GX_COMP_TYPE.S16: raw = view.getInt16(at); break;
        default: raw = view.getFloat32(at); break;
      }
      out[i * format.componentCount + c] = format.compType === GX_COMP_TYPE.F32 ? raw : raw * divisor;
    }
  }
  return out;
}

function fixedPointRange(compType: GxCompType): { min: number; max: number } {
  switch (compType) {
    case GX_COMP_TYPE.U8: return { min: 0, max: 0xff };
    case GX_COMP_TYPE.S8: return { min: -0x80, max: 0x7f };
    case GX_COMP_TYPE.U16: return { min: 0, max: 0xffff };
    case GX_COMP_TYPE.S16: return { min: -0x8000, max: 0x7fff };
    default: return { min: -Infinity, max: Infinity };
  }
}

/** True when every value still fits `format`'s fixed-point range. */
export function valuesFitFormat(values: Float32Array, format: GxVertexArrayFormat): boolean {
  if (format.compType === GX_COMP_TYPE.F32) return true;
  const { min, max } = fixedPointRange(format.compType);
  const scale = 1 << format.compShift;
  for (let i = 0; i < values.length; i++) {
    const raw = Math.round(values[i] * scale);
    if (raw < min || raw > max || !Number.isFinite(raw)) return false;
  }
  return true;
}

/** Encodes `values` into a tightly packed array (stride = componentCount * componentByteSize). */
export function encodeVertexArray(values: Float32Array, format: GxVertexArrayFormat): Uint8Array {
  const size = componentByteSize(format.compType);
  const out = new Uint8Array(values.length * size);
  const view = new DataView(out.buffer);
  const scale = 1 << format.compShift;
  const { min, max } = fixedPointRange(format.compType);
  for (let i = 0; i < values.length; i++) {
    const at = i * size;
    if (format.compType === GX_COMP_TYPE.F32) {
      view.setFloat32(at, values[i]);
      continue;
    }
    const raw = Math.min(max, Math.max(min, Math.round(values[i] * scale)));
    switch (format.compType) {
      case GX_COMP_TYPE.U8: view.setUint8(at, raw); break;
      case GX_COMP_TYPE.S8: view.setInt8(at, raw); break;
      case GX_COMP_TYPE.U16: view.setUint16(at, raw); break;
      default: view.setInt16(at, raw); break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Display lists
// ---------------------------------------------------------------------------

/** CP registers loaded by a shape's "pre-primitive" display list. */
export function readCpRegisters(dl: Uint8Array): Map<number, number> {
  const view = new DataView(dl.buffer, dl.byteOffset, dl.byteLength);
  const registers = new Map<number, number>();
  let i = 0;
  while (i < dl.length) {
    const command = view.getUint8(i);
    if (command === GX_COMMAND.NOOP) { i += 1; continue; }
    if (command === GX_COMMAND.LOAD_CP_REG) {
      if (i + 6 > dl.length) break;
      registers.set(view.getUint8(i + 1), view.getUint32(i + 2));
      i += 6;
      continue;
    }
    if (command === GX_COMMAND.LOAD_BP_REG) { i += 5; continue; }
    if (command === GX_COMMAND.LOAD_XF_REG) {
      if (i + 5 > dl.length) break;
      i += 5 + (view.getUint16(i + 1) + 1) * 4;
      continue;
    }
    break;
  }
  return registers;
}

export interface GxVertexDescriptor {
  /** Attribute type per GX attribute index (0 = none, 1 = direct, 2 = index8, 3 = index16). */
  types: number[];
  /** Byte size of one vertex in the primitive display list. */
  vertexSize: number;
  /** Byte offset of an attribute's index within a display-list vertex, or -1. */
  offsets: number[];
}

const VCD_LO_ID = 0x50;
const VCD_HI_ID = 0x60;
const VAT_A_ID = 0x70;
const VAT_B_ID = 0x80;
const VAT_C_ID = 0x90;

/** Size of a DIRECT attribute in the display list, derived from the VAT. */
function directAttributeSize(attr: number, vatA: number, vatB: number, vatC: number): number {
  const fmt = (compCnt: number, compType: number, counts: [number, number]) =>
    counts[compCnt] * componentByteSize(compType);
  if (attr === GX_ATTR.POS) return fmt((vatA >>> 0) & 0x01, (vatA >>> 1) & 0x07, [2, 3]);
  if (attr === GX_ATTR.NRM) return fmt(0, (vatA >>> 10) & 0x07, [3, 3]);
  if (attr === GX_ATTR.CLR0 || attr === GX_ATTR.CLR1) return 4;
  if (attr >= GX_ATTR.TEX0 && attr <= GX_ATTR.TEX7) {
    const index = attr - GX_ATTR.TEX0;
    if (index === 0) return fmt((vatA >>> 21) & 0x01, (vatA >>> 22) & 0x07, [1, 2]);
    if (index === 1) return fmt((vatB >>> 0) & 0x01, (vatB >>> 1) & 0x07, [1, 2]);
    if (index === 2) return fmt((vatB >>> 9) & 0x01, (vatB >>> 10) & 0x07, [1, 2]);
    if (index === 3) return fmt((vatB >>> 18) & 0x01, (vatB >>> 19) & 0x07, [1, 2]);
    if (index === 4) return fmt((vatB >>> 27) & 0x01, (vatC >>> 0) & 0x07, [1, 2]);
    if (index === 5) return fmt((vatC >>> 5) & 0x01, (vatC >>> 6) & 0x07, [1, 2]);
    if (index === 6) return fmt((vatC >>> 14) & 0x01, (vatC >>> 15) & 0x07, [1, 2]);
    return fmt((vatC >>> 23) & 0x01, (vatC >>> 24) & 0x07, [1, 2]);
  }
  return 1;
}

export function readVertexDescriptor(registers: Map<number, number>): GxVertexDescriptor {
  const vcdLo = registers.get(VCD_LO_ID) ?? 0;
  const vcdHi = registers.get(VCD_HI_ID) ?? 0;
  const vatA = registers.get(VAT_A_ID) ?? 0;
  const vatB = registers.get(VAT_B_ID) ?? 0;
  const vatC = registers.get(VAT_C_ID) ?? 0;

  const types: number[] = [];
  for (let i = 0; i <= GX_ATTR.TEX7MTXIDX; i++) types[i] = (vcdLo >>> i) & 0x01;
  types[GX_ATTR.POS] = (vcdLo >>> 9) & 0x03;
  types[GX_ATTR.NRM] = (vcdLo >>> 11) & 0x03;
  types[GX_ATTR.CLR0] = (vcdLo >>> 13) & 0x03;
  types[GX_ATTR.CLR1] = (vcdLo >>> 15) & 0x03;
  for (let i = 0; i < 8; i++) types[GX_ATTR.TEX0 + i] = (vcdHi >>> (i * 2)) & 0x03;

  const offsets: number[] = new Array(types.length).fill(-1);
  let vertexSize = 0;
  for (let attr = 0; attr < types.length; attr++) {
    const type = types[attr];
    if (type === 0) continue;
    offsets[attr] = vertexSize;
    if (type === 2) vertexSize += 1;
    else if (type === 3) vertexSize += 2;
    else vertexSize += attr <= GX_ATTR.TEX7MTXIDX ? 1 : directAttributeSize(attr, vatA, vatB, vatC);
  }
  return { types, vertexSize, offsets };
}

export interface GxPrimitiveVertices {
  /** Source array index per emitted vertex, per attribute. -1 when the attribute is absent. */
  attributeIndices: Map<number, Int32Array>;
  /** Vertex count (one per display-list vertex, in display-list order). */
  vertexCount: number;
  /** Triangle list over the emitted vertices, matching noclip's topology conversion. */
  indices: Uint32Array;
}

/**
 * Walks a shape's primitive display list and produces one emitted vertex per display-list
 * vertex, plus a triangle index list. The emission order matches noclip's `runVertices`, which
 * is what makes connected-component numbering agree between the viewport and the exporter.
 */
export function readPrimitiveVertices(dl: Uint8Array, vcd: GxVertexDescriptor, attributes: readonly number[]): GxPrimitiveVertices {
  const view = new DataView(dl.buffer, dl.byteOffset, dl.byteLength);
  interface Draw { primType: number; vertexCount: number; srcOffset: number }
  const draws: Draw[] = [];
  let totalVertices = 0;
  let totalIndices = 0;
  let i = 0;
  while (i < dl.length) {
    const command = view.getUint8(i);
    if (command === GX_COMMAND.NOOP) { i += 1; continue; }
    if (command === GX_COMMAND.LOAD_BP_REG) { i += 5; continue; }
    if (command === GX_COMMAND.LOAD_CP_REG) { i += 6; continue; }
    if (command === GX_COMMAND.LOAD_INDX_A || command === GX_COMMAND.LOAD_INDX_B || command === GX_COMMAND.LOAD_INDX_C || command === GX_COMMAND.LOAD_INDX_D) { i += 5; continue; }
    if (command === GX_COMMAND.LOAD_XF_REG) { i += 5 + (view.getUint16(i + 1) + 1) * 4; continue; }
    if ((command & 0xf8) < 0x80) break;
    if (i + 3 > dl.length) break;
    const vertexCount = view.getUint16(i + 1);
    i += 3;
    const srcOffset = i;
    switch (command) {
      case GX_COMMAND.DRAW_TRIANGLES: totalIndices += vertexCount; break;
      case GX_COMMAND.DRAW_QUADS:
      case GX_COMMAND.DRAW_QUAD_STRIP: totalIndices += (vertexCount >>> 2) * 6; break;
      case GX_COMMAND.DRAW_TRIANGLE_STRIP:
      case GX_COMMAND.DRAW_TRIANGLE_FAN: totalIndices += Math.max(0, vertexCount - 2) * 3; break;
      default: break;
    }
    draws.push({ primType: command, vertexCount, srcOffset });
    totalVertices += vertexCount;
    i += vcd.vertexSize * vertexCount;
  }

  const attributeIndices = new Map<number, Int32Array>();
  for (const attr of attributes) attributeIndices.set(attr, new Int32Array(totalVertices).fill(-1));

  let vertex = 0;
  for (const draw of draws) {
    for (let v = 0; v < draw.vertexCount; v++) {
      const base = draw.srcOffset + v * vcd.vertexSize;
      for (const attr of attributes) {
        const type = vcd.types[attr] ?? 0;
        if (type !== 2 && type !== 3) continue;
        const at = base + vcd.offsets[attr];
        attributeIndices.get(attr)![vertex] = type === 2 ? view.getUint8(at) : view.getUint16(at);
      }
      vertex++;
    }
  }

  const indices = new Uint32Array(totalIndices);
  let cursor = 0;
  let baseVertex = 0;
  for (const draw of draws) {
    switch (draw.primType) {
      case GX_COMMAND.DRAW_TRIANGLES:
        for (let v = 0; v < draw.vertexCount; v++) indices[cursor++] = baseVertex + v;
        break;
      case GX_COMMAND.DRAW_QUADS:
      case GX_COMMAND.DRAW_QUAD_STRIP:
        for (let v = 0; v + 3 < draw.vertexCount; v += 4) {
          indices[cursor++] = baseVertex + v + 0;
          indices[cursor++] = baseVertex + v + 1;
          indices[cursor++] = baseVertex + v + 2;
          indices[cursor++] = baseVertex + v + 0;
          indices[cursor++] = baseVertex + v + 2;
          indices[cursor++] = baseVertex + v + 3;
        }
        break;
      case GX_COMMAND.DRAW_TRIANGLE_STRIP:
        for (let v = 2; v < draw.vertexCount; v++) {
          indices[cursor++] = baseVertex + v - 2;
          indices[cursor++] = baseVertex + v - (~v & 1);
          indices[cursor++] = baseVertex + v - (v & 1);
        }
        break;
      case GX_COMMAND.DRAW_TRIANGLE_FAN:
        for (let v = 2; v < draw.vertexCount; v++) {
          indices[cursor++] = baseVertex;
          indices[cursor++] = baseVertex + v - 1;
          indices[cursor++] = baseVertex + v;
        }
        break;
      default:
        break;
    }
    baseVertex += draw.vertexCount;
  }

  return { attributeIndices, vertexCount: totalVertices, indices: indices.subarray(0, cursor) };
}
