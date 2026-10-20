/**
 * Emits an MDL0 (version 11) from scratch.
 *
 * The layout follows what the retail `course_model.brres` files do, block for block:
 *
 *   header · model info · matrix table · resource dictionaries · texture/palette link blocks ·
 *   bytecode · nodes · materials · TEV blocks · shapes · position/normal/colour/texcoord arrays
 *
 * Every pointer in an MDL0 is relative to the struct that holds it, except names, which point out
 * of the model into the archive's string pool; those are returned as `BrresStringRef`s for the
 * archive packer to resolve.
 */

import type { BrresStringRef } from '../../brres/brresRaw';
import { resDicSize, writeResDic } from '../../brres/resDic';
import { alignUp, ByteBuffer } from './byteBuffer';

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

export interface Mdl0Node {
  name: string;
  /** Index of the parent node, or -1 for a root. */
  parent: number;
  translation: [number, number, number];
  /** Node bounding box, in the node's own space. */
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  /** Node has geometry attached (retail sets this on every node that owns a shape). */
  hasGeometry: boolean;
}

export interface Mdl0ShapeInput {
  name: string;
  /** Index into the model's material list. */
  materialIndex: number;
  /** Node the shape is attached to. */
  nodeIndex: number;
  translucent: boolean;
  /** Unique position entries, 3 float bit patterns each. */
  positions: Uint32Array;
  /** Unique normal entries, 3 float bit patterns each. */
  normals: Uint32Array;
  /** Unique colour entries, one packed RGBA word each. */
  colors: Uint32Array;
  /** Unique texcoord entries, 2 float bit patterns each. */
  texcoords: Uint32Array;
  /** Per triangle corner: indices into the four arrays above. */
  cornerPosition: Uint16Array;
  cornerNormal: Uint16Array;
  cornerColor: Uint16Array;
  cornerTexcoord: Uint16Array;
  /** Triangle count (the corner arrays are 3x as long). */
  triangleCount: number;
}

export interface Mdl0MaterialInput {
  name: string;
  /** Raw material block. The builder patches its header fields in a copy. */
  block: Uint8Array;
  tev: Uint8Array;
  samplerOffset: number;
  dlOffset: number;
  /** Final (possibly renamed) texture / palette names per sampler. Empty texture = unused slot. */
  samplers: Array<{ texture: string; palette: string | null }>;
}

/** Which vertex attributes the model's shapes carry. Position and colour 0 are always present. */
export interface Mdl0VertexLayout {
  normals: boolean;
  texcoords: boolean;
  /** Bytes of a colour index in the display list: 1 (retail uses it when the array is small) or 2. */
  colorIndexBytes: 1 | 2;
}

export const COURSE_VERTEX_LAYOUT: Mdl0VertexLayout = { normals: true, texcoords: true, colorIndexBytes: 2 };

export interface Mdl0Input {
  name: string;
  nodes: Mdl0Node[];
  materials: Mdl0MaterialInput[];
  shapes: Mdl0ShapeInput[];
  layout?: Mdl0VertexLayout;
  /** Write a DrawXlu list even when nothing is translucent (course models do, minimap models do not). */
  alwaysWriteTranslucentList?: boolean;
}

export interface Mdl0Output {
  data: Uint8Array;
  stringRefs: BrresStringRef[];
  /** Texture / palette names referenced by sampler tables. */
  textures: string[];
  palettes: string[];
  vertexCount: number;
  triangleCount: number;
}

// ---------------------------------------------------------------------------------------------
// Constants copied from retail
// ---------------------------------------------------------------------------------------------

const HEADER_SIZE = 0x48; // 14 dictionary pointers (version 11), then the name pointer at 0x48.
const MODEL_INFO_AT = 0x4c;
const MODEL_INFO_SIZE = 0x40;
const NODE_SIZE = 0xd0;
const SHAPE_PREPRIM_SIZE = 0xe0;
const SHAPE_PREPRIM_COMMANDS = 0x80;
const SHAPE_PREPRIM_AT = 0x80;
const SHAPE_PRIM_AT = SHAPE_PREPRIM_AT + SHAPE_PREPRIM_SIZE; // 0x160
/** Retail's "matrix set" offset, measured from 0x64; it lands in the zero fill of the pre-primitive list. */
const SHAPE_MTX_SET_OFFSET = 0x68;
const MODEL_TRAILING_SLACK = 0x40;

const GX_DRAW_TRIANGLES = 0x90;
const MAX_DRAW_VERTICES = 65535; // u16 count; 65535 is divisible by 3

/**
 * CP / XF register values for the vertex layout: position, optional normal, colour 0 and optional
 * texcoord 0, all indexed, with float positions / normals / texcoords (VAT_A..C below).
 */
function vertexRegisters(layout: Mdl0VertexLayout): { vcdLo: number; vcdHi: number; xfSpec: number; flags: number } {
  const INDEX8 = 2;
  const INDEX16 = 3;
  let vcdLo = INDEX16 << 9; // POS
  if (layout.normals) vcdLo |= INDEX16 << 11;
  vcdLo |= (layout.colorIndexBytes === 1 ? INDEX8 : INDEX16) << 13; // CLR0
  const vcdHi = layout.texcoords ? INDEX16 : 0;
  const xfSpec = 1 | (layout.normals ? 1 << 2 : 0) | (layout.texcoords ? 1 << 4 : 0);
  const flags = 0x200 | (layout.normals ? 0x400 : 0) | 0x800 | (layout.texcoords ? 0x2000 : 0);
  return { vcdLo, vcdHi, xfSpec, flags };
}
const VAT_A = 0x41377009; // pos XYZ F32, nrm XYZ F32, clr0/clr1 RGBA8, tex0 ST F32 (shift 0), byte-dequant
const VAT_B = 0xc8241209; // tex1..tex4 ST F32
const VAT_C = 0x04824120; // tex4..tex7 ST F32

/** Node flag bits (BrawlLib NodeFlags). */
const NODE_FLAG_SRT_IDENTITY = 0x01;
const NODE_FLAG_TRANSLATION_ZERO = 0x02;
const NODE_FLAG_ROTATION_ZERO = 0x04;
const NODE_FLAG_SCALE_ONE = 0x08;
const NODE_FLAG_SCALE_UNIFORM = 0x10;
const NODE_FLAG_VISIBLE = 0x100;
const NODE_FLAG_HAS_GEOMETRY = 0x200;

function nodeFlags(node: Mdl0Node): number {
  let flags = NODE_FLAG_ROTATION_ZERO | NODE_FLAG_SCALE_ONE | NODE_FLAG_SCALE_UNIFORM | NODE_FLAG_VISIBLE;
  if (node.translation.every((value) => value === 0)) flags |= NODE_FLAG_SRT_IDENTITY | NODE_FLAG_TRANSLATION_ZERO;
  if (node.hasGeometry) flags |= NODE_FLAG_HAS_GEOMETRY;
  return flags;
}

const COMPONENT_F32 = 4;
const COMPONENT_RGBA8 = 5;

const BYTECODE_RET = 0x01;
const BYTECODE_NODE_DESC = 0x02;
const BYTECODE_DRAW = 0x04;

// ---------------------------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------------------------

interface DicEntry {
  name: string;
  offset: number;
}

type DicKey = 'byteCode' | 'node' | 'vtxPos' | 'vtxNrm' | 'vtxClr' | 'vtxTxc' | 'material' | 'tev' | 'shape' | 'texture' | 'palette';

/** Header field (offset in the MDL0 header) each dictionary pointer lives at, version 11. */
const DIC_FIELD: Record<DicKey, number> = {
  byteCode: 0x10,
  node: 0x14,
  vtxPos: 0x18,
  vtxNrm: 0x1c,
  vtxClr: 0x20,
  vtxTxc: 0x24,
  material: 0x30,
  tev: 0x34,
  shape: 0x38,
  texture: 0x3c,
  palette: 0x40,
};

const DIC_ORDER: DicKey[] = ['byteCode', 'node', 'vtxPos', 'vtxNrm', 'vtxClr', 'vtxTxc', 'material', 'tev', 'shape', 'texture', 'palette'];

type LinkTable = Map<string, Array<{ material: number; sampler: number }>>;

export function buildMdl0(input: Mdl0Input): Mdl0Output {
  const { nodes, materials, shapes } = input;
  const layout = input.layout ?? COURSE_VERTEX_LAYOUT;
  const registers = vertexRegisters(layout);
  if (nodes.length === 0) throw new Error('MDL0: a model needs at least one node.');

  const out = new ByteBuffer(1 << 20);
  const refs: BrresStringRef[] = [];

  // Texture / palette link tables: name -> list of (material index, sampler index).
  const textureLinks: LinkTable = new Map();
  const paletteLinks: LinkTable = new Map();
  materials.forEach((material, materialIndex) => {
    material.samplers.forEach((sampler, samplerIndex) => {
      if (sampler.texture) {
        const list = textureLinks.get(sampler.texture) ?? [];
        list.push({ material: materialIndex, sampler: samplerIndex });
        textureLinks.set(sampler.texture, list);
      }
      if (sampler.palette) {
        const list = paletteLinks.get(sampler.palette) ?? [];
        list.push({ material: materialIndex, sampler: samplerIndex });
        paletteLinks.set(sampler.palette, list);
      }
    });
  });
  const textureNames = [...textureLinks.keys()].sort();
  const paletteNames = [...paletteLinks.keys()].sort();

  const dicCounts: Record<DicKey, number> = {
    byteCode: 3,
    node: nodes.length,
    vtxPos: shapes.length,
    vtxNrm: layout.normals ? shapes.length : 0,
    vtxClr: shapes.length,
    vtxTxc: layout.texcoords ? shapes.length : 0,
    material: materials.length,
    tev: materials.length,
    shape: shapes.length,
    texture: textureNames.length,
    palette: paletteNames.length,
  };

  // --- fixed prefix: header, model info, matrix table, dictionary tables -----------------------
  out.alloc(MODEL_INFO_AT + MODEL_INFO_SIZE);
  const matrixTableAt = out.alloc(4 + 4 * nodes.length); // [u32 count][s32 node id]...
  const dicTable = new Map<DicKey, number>();
  for (const key of DIC_ORDER) {
    const count = dicCounts[key];
    if (!(key === 'byteCode' || key === 'node' || count > 0)) continue;
    dicTable.set(key, out.alloc(resDicSize(count), 4));
  }

  const dicEntries = new Map<DicKey, DicEntry[]>(DIC_ORDER.map((key) => [key, []]));
  const addEntry = (key: DicKey, name: string, offset: number): void => {
    dicEntries.get(key)!.push({ name, offset });
  };

  // --- texture / palette link blocks (contents filled in once materials are placed) ------------
  const linkBlocks: Array<{ at: number; links: Array<{ material: number; sampler: number }> }> = [];
  const reserveLinks = (key: 'texture' | 'palette', names: string[], table: LinkTable): void => {
    for (const name of names) {
      const links = table.get(name)!;
      const at = out.alloc(4 + links.length * 8, 4);
      linkBlocks.push({ at, links });
      addEntry(key, name, at);
    }
  };
  reserveLinks('texture', textureNames, textureLinks);
  reserveLinks('palette', paletteNames, paletteLinks);

  // --- bytecode --------------------------------------------------------------------------------
  const indexed = shapes.map((shape, index) => ({ shape, index }));
  const opaque = indexed.filter((entry) => !entry.shape.translucent);
  const translucent = indexed.filter((entry) => entry.shape.translucent);

  const nodeTreeAt = out.alloc(nodes.length * 5 + 1);
  nodes.forEach((node, index) => {
    const at = nodeTreeAt + index * 5;
    out.u8(at, BYTECODE_NODE_DESC);
    out.u16(at + 1, index);
    // Parent *matrix* id: one matrix per node, so the parent's node index (0 for a root).
    out.u16(at + 3, Math.max(0, node.parent));
  });
  out.u8(nodeTreeAt + nodes.length * 5, BYTECODE_RET);
  addEntry('byteCode', 'NodeTree', nodeTreeAt);

  const writeDrawList = (name: string, entries: typeof opaque): void => {
    const at = out.alloc(entries.length * 8 + 1);
    entries.forEach(({ shape, index }, i) => {
      const op = at + i * 8;
      out.u8(op, BYTECODE_DRAW);
      out.u16(op + 1, shape.materialIndex);
      out.u16(op + 3, index);
      out.u16(op + 5, shape.nodeIndex);
      out.u8(op + 7, 0);
    });
    out.u8(at + entries.length * 8, BYTECODE_RET);
    addEntry('byteCode', name, at);
  };
  writeDrawList('DrawOpa', opaque);
  if (translucent.length > 0 || input.alwaysWriteTranslucentList !== false) writeDrawList('DrawXlu', translucent);

  // --- nodes -----------------------------------------------------------------------------------
  const nodeOffsets: number[] = [];
  nodes.forEach((node, index) => {
    const at = out.alloc(NODE_SIZE, 4);
    nodeOffsets.push(at);
    addEntry('node', node.name, at);
    out.u32(at + 0x00, NODE_SIZE);
    out.s32(at + 0x04, -at);
    refs.push({ offset: at + 0x08, base: at, value: node.name });
    out.u32(at + 0x0c, index);
    out.u32(at + 0x10, index);
    out.u32(at + 0x14, nodeFlags(node));
    for (let i = 0; i < 3; i++) out.f32(at + 0x20 + i * 4, 1); // scale
    for (let i = 0; i < 3; i++) out.f32(at + 0x38 + i * 4, node.translation[i]);
    for (let i = 0; i < 3; i++) out.f32(at + 0x44 + i * 4, node.boundsMin[i]);
    for (let i = 0; i < 3; i++) out.f32(at + 0x50 + i * 4, node.boundsMax[i]);
    // Forward bind pose (3x4), then its inverse.
    const t = node.translation;
    const forward = [1, 0, 0, t[0], 0, 1, 0, t[1], 0, 0, 1, t[2]];
    const inverse = [1, 0, 0, -t[0], 0, 1, 0, -t[1], 0, 0, 1, -t[2]];
    forward.forEach((value, i) => out.f32(at + 0x70 + i * 4, value));
    inverse.forEach((value, i) => out.f32(at + 0xa0 + i * 4, value));
  });
  nodes.forEach((node, index) => {
    const at = nodeOffsets[index];
    const rel = (target: number) => (target < 0 ? 0 : nodeOffsets[target] - at);
    out.s32(at + 0x5c, rel(node.parent));
    const children = nodes.flatMap((candidate, i) => (candidate.parent === index ? [i] : []));
    out.s32(at + 0x60, children.length > 0 ? rel(children[0]) : 0);
    if (node.parent >= 0) {
      const siblings = nodes.flatMap((candidate, i) => (candidate.parent === node.parent ? [i] : []));
      const position = siblings.indexOf(index);
      out.s32(at + 0x64, position + 1 < siblings.length ? rel(siblings[position + 1]) : 0);
      out.s32(at + 0x68, position > 0 ? rel(siblings[position - 1]) : 0);
    }
  });

  // --- materials -------------------------------------------------------------------------------
  const materialOffsets: number[] = [];
  materials.forEach((material, index) => {
    // The material's display lists have to sit on a 32-byte boundary, not the block itself.
    const at = out.allocPhased(material.block.length, 0x20, material.dlOffset);
    materialOffsets.push(at);
    out.bytes(at, material.block);
    addEntry('material', material.name, at);
    out.s32(at + 0x04, -at);
    refs.push({ offset: at + 0x08, base: at, value: material.name });
    out.u32(at + 0x0c, index);
    material.samplers.forEach((sampler, samplerIndex) => {
      const samplerAt = at + material.samplerOffset + samplerIndex * 0x34;
      if (sampler.texture) refs.push({ offset: samplerAt + 0x00, base: samplerAt, value: sampler.texture });
      else out.s32(samplerAt + 0x00, 0);
      if (sampler.palette) refs.push({ offset: samplerAt + 0x04, base: samplerAt, value: sampler.palette });
      else out.s32(samplerAt + 0x04, 0);
    });
  });
  materials.forEach((material, index) => {
    const at = out.alloc(material.tev.length, 0x20);
    out.bytes(at, material.tev);
    addEntry('tev', material.name, at);
    out.s32(at + 0x04, -at);
    out.s32(at + 0x08, index);
    out.s32(materialOffsets[index] + 0x28, at - materialOffsets[index]);
  });

  // Texture / palette link blocks: (material, sampler) pairs relative to the block.
  for (const block of linkBlocks) {
    out.u32(block.at, block.links.length);
    block.links.forEach((link, i) => {
      const materialAt = materialOffsets[link.material];
      const samplerAt = materialAt + materials[link.material].samplerOffset + link.sampler * 0x34;
      out.s32(block.at + 4 + i * 8, materialAt - block.at);
      out.s32(block.at + 4 + i * 8 + 4, samplerAt - block.at);
    });
  }

  // --- shapes and vertex arrays ----------------------------------------------------------------
  const primitiveLists = shapes.map((shape) => buildPrimitiveList(shape, layout));
  shapes.forEach((shape, index) => {
    const primitive = primitiveLists[index];
    const size = SHAPE_PRIM_AT + primitive.length;
    const at = out.alloc(size, 0x20);
    addEntry('shape', shape.name, at);
    writeShapeHeader(out, at, size, shape, index, primitive.length, layout, registers);
    refs.push({ offset: at + 0x38, base: at, value: shape.name });
    writePreprimitiveList(out, at + SHAPE_PREPRIM_AT, registers);
    out.bytes(at + SHAPE_PRIM_AT, primitive);
  });

  for (const key of ['vtxPos', 'vtxNrm', 'vtxClr', 'vtxTxc'] as const) {
    if ((key === 'vtxNrm' && !layout.normals) || (key === 'vtxTxc' && !layout.texcoords)) continue;
    shapes.forEach((shape, index) => {
      addEntry(key, shape.name, writeVertexArray(out, key, shape, index, refs));
    });
  }

  out.alloc(MODEL_TRAILING_SLACK);
  const total = out.align(0x20);

  // --- dictionaries ----------------------------------------------------------------------------
  for (const key of DIC_ORDER) {
    const tableAt = dicTable.get(key);
    if (tableAt === undefined) continue;
    const entries = dicEntries.get(key)!;
    writeResDic(
      out.data,
      tableAt,
      entries.map((entry) => ({ name: entry.name, nameOffset: tableAt, dataOffset: entry.offset })),
    );
    entries.forEach((entry, i) => {
      refs.push({ offset: tableAt + 0x08 + (i + 1) * 0x10 + 0x08, base: tableAt, value: entry.name });
    });
    out.u32(DIC_FIELD[key], tableAt);
  }

  // --- header and model info -------------------------------------------------------------------
  out.bytes(0, new TextEncoder().encode('MDL0'));
  out.u32(0x04, total);
  out.u32(0x08, 11);
  // 0x0c: back pointer to the archive start, written by the archive packer.
  refs.push({ offset: HEADER_SIZE, value: input.name });

  const info = MODEL_INFO_AT;
  let vertexCount = 0;
  let triangleCount = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const shape of shapes) {
    vertexCount += shape.triangleCount * 3;
    triangleCount += shape.triangleCount;
    for (let i = 0; i < shape.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = float32FromBits(shape.positions[i + axis]);
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  }
  const empty = !Number.isFinite(min[0]);
  out.u32(info + 0x00, MODEL_INFO_SIZE);
  out.s32(info + 0x04, -info);
  out.u32(info + 0x08, 0); // scaling rule: standard
  out.u32(info + 0x0c, 0); // texture matrix mode: Maya
  out.u32(info + 0x10, vertexCount);
  out.u32(info + 0x14, triangleCount);
  out.s32(info + 0x18, 0); // original path: none
  out.u32(info + 0x1c, nodes.length);
  out.u8(info + 0x20, layout.normals ? 1 : 0); // normal matrix array needed
  out.u8(info + 0x21, 0);
  out.u8(info + 0x22, 0); // retail leaves the extents flag clear (and the extents stale)
  out.u8(info + 0x23, 0);
  out.s32(info + 0x24, matrixTableAt - info);
  for (let axis = 0; axis < 3; axis++) {
    out.f32(info + 0x28 + axis * 4, empty ? 0 : min[axis]);
    out.f32(info + 0x34 + axis * 4, empty ? 0 : max[axis]);
  }
  out.u32(matrixTableAt, nodes.length);
  nodes.forEach((_node, i) => out.s32(matrixTableAt + 4 + i * 4, i));

  return {
    data: out.finish(),
    stringRefs: refs,
    textures: textureNames,
    palettes: paletteNames,
    vertexCount,
    triangleCount,
  };
}

// ---------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------

/** GX_TRIANGLES draw commands over the corner indices, padded to a 32-byte multiple. */
function buildPrimitiveList(shape: Mdl0ShapeInput, layout: Mdl0VertexLayout): Uint8Array {
  const corners = shape.triangleCount * 3;
  const commands = Math.ceil(corners / MAX_DRAW_VERTICES);
  const vertexBytes = 2 + (layout.normals ? 2 : 0) + layout.colorIndexBytes + (layout.texcoords ? 2 : 0);
  const raw = commands * 3 + corners * vertexBytes;
  const out = new Uint8Array(Math.max(0x20, alignUp(raw, 0x20)));
  const view = new DataView(out.buffer);
  let at = 0;
  for (let first = 0; first < corners; first += MAX_DRAW_VERTICES) {
    const count = Math.min(MAX_DRAW_VERTICES, corners - first);
    view.setUint8(at, GX_DRAW_TRIANGLES);
    view.setUint16(at + 1, count);
    at += 3;
    for (let i = first; i < first + count; i++) {
      view.setUint16(at, shape.cornerPosition[i]);
      at += 2;
      if (layout.normals) {
        view.setUint16(at, shape.cornerNormal[i]);
        at += 2;
      }
      if (layout.colorIndexBytes === 1) {
        view.setUint8(at, shape.cornerColor[i]);
        at += 1;
      } else {
        view.setUint16(at, shape.cornerColor[i]);
        at += 2;
      }
      if (layout.texcoords) {
        view.setUint16(at, shape.cornerTexcoord[i]);
        at += 2;
      }
    }
  }
  return out;
}

function writeShapeHeader(
  out: ByteBuffer,
  at: number,
  size: number,
  shape: Mdl0ShapeInput,
  index: number,
  primitiveSize: number,
  layout: Mdl0VertexLayout,
  registers: ReturnType<typeof vertexRegisters>,
): void {
  out.u32(at + 0x00, size);
  out.s32(at + 0x04, -at);
  out.s32(at + 0x08, shape.nodeIndex);
  out.u32(at + 0x0c, registers.vcdLo);
  out.u32(at + 0x10, registers.vcdHi);
  out.u32(at + 0x14, registers.xfSpec);
  out.u32(at + 0x18, SHAPE_PREPRIM_SIZE);
  out.u32(at + 0x1c, SHAPE_PREPRIM_COMMANDS);
  out.u32(at + 0x20, SHAPE_PREPRIM_AT - 0x18);
  out.u32(at + 0x24, primitiveSize);
  out.u32(at + 0x28, primitiveSize);
  out.u32(at + 0x2c, SHAPE_PRIM_AT - 0x24);
  out.u32(at + 0x30, registers.flags);
  out.u32(at + 0x34, 0);
  // 0x38: name pointer (declared by the caller).
  out.u32(at + 0x3c, index);
  out.u32(at + 0x40, shape.triangleCount * 3);
  out.u32(at + 0x44, shape.triangleCount);
  // Array ids: position, normal, colour 0, colour 1, texcoord 0..7, fur vec, fur pos.
  const ids = [index, layout.normals ? index : -1, index, -1, layout.texcoords ? index : -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];
  ids.forEach((id, i) => out.s16(at + 0x48 + i * 2, id));
  out.u32(at + 0x64, SHAPE_MTX_SET_OFFSET);
}

/**
 * The shape's pre-primitive display list: the CP vertex descriptor and attribute formats plus the
 * XF vertex spec, exactly as the retail shapes carry them (10 NOP bytes of lead-in, the commands,
 * then zero fill up to 0xe0).
 */
function writePreprimitiveList(out: ByteBuffer, at: number, registers: ReturnType<typeof vertexRegisters>): void {
  let cursor = at + 10;
  const cp = (register: number, value: number): void => {
    out.u8(cursor, 0x08);
    out.u8(cursor + 1, register);
    out.u32(cursor + 2, value);
    cursor += 6;
  };
  cp(0x50, registers.vcdLo);
  cp(0x60, registers.vcdHi);
  out.u8(cursor, 0x10); // load XF register 0x1008 (vertex spec), one word
  out.u16(cursor + 1, 0);
  out.u16(cursor + 3, 0x1008);
  out.u32(cursor + 5, registers.xfSpec);
  cursor += 9 + 1; // retail pads the first 32 bytes with a NOP before the attribute-format registers
  cp(0x70, VAT_A);
  cp(0x80, VAT_B);
  cp(0x90, VAT_C);
}

function writeVertexArray(
  out: ByteBuffer,
  key: 'vtxPos' | 'vtxNrm' | 'vtxClr' | 'vtxTxc',
  shape: Mdl0ShapeInput,
  index: number,
  refs: BrresStringRef[],
): number {
  const spec = {
    vtxPos: { words: shape.positions, perEntry: 3, header: 0x40, compCnt: 1, compType: COMPONENT_F32, stride: 12 },
    vtxNrm: { words: shape.normals, perEntry: 3, header: 0x20, compCnt: 0, compType: COMPONENT_F32, stride: 12 },
    vtxClr: { words: shape.colors, perEntry: 1, header: 0x20, compCnt: 1, compType: COMPONENT_RGBA8, stride: 4 },
    vtxTxc: { words: shape.texcoords, perEntry: 2, header: 0x40, compCnt: 1, compType: COMPONENT_F32, stride: 8 },
  }[key];
  const count = spec.words.length / spec.perEntry;
  if (count > 0xffff) throw new Error(`MDL0: shape "${shape.name}" has ${count} ${key} entries; the limit is 65535.`);
  const size = alignUp(spec.header + count * spec.stride, 0x20);
  const at = out.alloc(size, 0x20);
  out.u32(at + 0x00, size);
  out.s32(at + 0x04, -at);
  out.u32(at + 0x08, spec.header);
  refs.push({ offset: at + 0x0c, base: at, value: shape.name });
  out.u32(at + 0x10, index);
  out.u32(at + 0x14, spec.compCnt);
  out.u32(at + 0x18, spec.compType);
  if (key === 'vtxClr') {
    out.u8(at + 0x1c, spec.stride); // colour arrays keep their stride in the shift byte
  } else {
    out.u8(at + 0x1c, 0); // fixed-point shift: none, the data is float
    out.u8(at + 0x1d, spec.stride);
  }
  out.u16(at + 0x1e, count);

  for (let i = 0; i < spec.words.length; i++) out.u32(at + spec.header + i * 4, spec.words[i]);

  if (key === 'vtxPos' || key === 'vtxTxc') {
    const dims = spec.perEntry;
    const min = new Array<number>(dims).fill(Infinity);
    const max = new Array<number>(dims).fill(-Infinity);
    for (let i = 0; i < count; i++) {
      for (let d = 0; d < dims; d++) {
        const value = float32FromBits(spec.words[i * dims + d]);
        if (value < min[d]) min[d] = value;
        if (value > max[d]) max[d] = value;
      }
    }
    for (let d = 0; d < dims; d++) {
      out.f32(at + 0x20 + d * 4, Number.isFinite(min[d]) ? min[d] : 0);
      out.f32(at + 0x20 + (dims + d) * 4, Number.isFinite(max[d]) ? max[d] : 0);
    }
  }
  return at;
}

const bitScratch = new DataView(new ArrayBuffer(4));
function float32FromBits(bits: number): number {
  bitScratch.setUint32(0, bits);
  return bitScratch.getFloat32(0);
}
