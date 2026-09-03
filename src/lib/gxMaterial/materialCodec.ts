// MDL0 v11 material block <-> `GxMaterialDoc`.
//
// A material block is a fixed 0x418-byte struct, then `numLayers` sampler entries of 0x34 bytes,
// then (32-byte aligned) the 0x180-byte material display list. The struct holds the counts, the
// texture SRTs, the texture-matrix effects and the two lighting channels; the display list holds
// everything the GX registers care about. The TEV ("shader") block is separate, 512 bytes, and is
// routinely shared by several materials.
//
//   0x000  header: size, mdl0 offset, name, index, flags, the four counts, cull, zCompLoc,
//          light set, fog, indirect method, normal-map refs, shader offset, layer count,
//          layer offset, fur offset, user-data offset, display-list offset
//   0x040  reserved (zero in every retail and custom course model checked)
//   0x1A8  texture SRT flags, then the texture-matrix mode
//   0x1B0  eight texture SRTs, 0x14 each
//   0x250  eight texture-matrix effects, 0x34 each (ref camera, ref light, map mode, matrix)
//   0x3F0  two lighting channels, 0x14 each
//   0x418  the sampler ("layer") table
//
// The encoder never builds a block from nothing: it copies the one that is there and patches the
// fields the document owns. That keeps every byte the format has and this editor does not model —
// the reserved block, the texture-matrix effect matrices, the data of channels and texgens past
// the live counts — exactly as the exporter left it, which is what makes an untouched material
// round trip byte for byte.

import * as GX from '../../../vendor/noclip.website/src/gx/gx_enum';
import {
  MAT_DL_SIZE,
  TEV_DL,
  TEV_DL_SIZE,
  bpValue,
  rawBpWriteAt,
  createRegisterFile,
  packBits,
  readDisplayList,
  signExtend,
  tevOpSubtractBit,
  writeMaterialDisplayList,
  writeTevDisplayList,
  type GxRegisterFile,
} from './gxRegisters';
import {
  GxMaterialError,
  type GxAlphaTestDoc,
  type GxBlendDoc,
  type GxChannelControlDoc,
  type GxChannelDoc,
  type GxColor,
  type GxColorS10,
  type GxDepthDoc,
  type GxIndMatrixDoc,
  type GxIndTexStageDoc,
  type GxMapMode,
  type GxMaterialDoc,
  type GxSamplerDoc,
  type GxSwapTableDoc,
  type GxTevStageDoc,
  type GxTexGenDoc,
  type GxTexMatrixMode,
  type GxTexSrtDoc,
} from './types';

export const MAT_STRUCT_SIZE = 0x418;
export const MAT_LAYER_SIZE = 0x34;
export const TEV_BLOCK_SIZE = 0x200;
export const TEV_DL_OFFSET = 0x20;

const MAT = {
  size: 0x00,
  mdl0Offset: 0x04,
  nameOffset: 0x08,
  index: 0x0c,
  flags: 0x10,
  numTexGens: 0x14,
  numChans: 0x15,
  numTevStages: 0x16,
  numIndStages: 0x17,
  cullMode: 0x18,
  zCompLoc: 0x1c,
  lightSet: 0x1d,
  fogSet: 0x1e,
  indirectMethod: 0x20,
  normalMapRef: 0x24,
  tevOffset: 0x28,
  numLayers: 0x2c,
  layerOffset: 0x30,
  furOffset: 0x34,
  userDataOffset: 0x38,
  dlOffset: 0x3c,
  srtFlags: 0x1a8,
  texMatrixMode: 0x1ac,
  texSrtTable: 0x1b0,
  texMtxTable: 0x250,
  chanTable: 0x3f0,
  layerTable: 0x418,
} as const;

const LAYER = {
  textureName: 0x00,
  paletteName: 0x04,
  texMapId: 0x10,
  tlutId: 0x14,
  wrapS: 0x18,
  wrapT: 0x1c,
  minFilter: 0x20,
  magFilter: 0x24,
  lodBias: 0x28,
  maxAnisotropy: 0x2c,
  biasClamp: 0x30,
  edgeLod: 0x31,
} as const;

const TEV = {
  size: 0x00,
  mdl0Offset: 0x04,
  index: 0x08,
  numStages: 0x0c,
  refs: 0x10,
} as const;

/** Hardware ceilings the GX TEV imposes; exceeding one is a `GxMaterialError`. */
export const GX_LIMITS = { samplers: 8, texGens: 8, tevStages: 16, indTexStages: 4, channels: 2 } as const;

const MAP_MODES: GxMapMode[] = ['texcoord', 'envCamera', 'projection', 'envLight', 'envSpec'];
const TEX_MATRIX_MODES: GxTexMatrixMode[] = ['maya', 'xsi', 'max'];

/** XF TexMtxInfo source-row values, in the order the hardware numbers them. */
const TEXGEN_SOURCE_ROWS: GX.TexGenSrc[] = [
  GX.TexGenSrc.POS, GX.TexGenSrc.NRM, GX.TexGenSrc.COLOR0, GX.TexGenSrc.BINRM, GX.TexGenSrc.TANGENT,
  GX.TexGenSrc.TEX0, GX.TexGenSrc.TEX1, GX.TexGenSrc.TEX2, GX.TexGenSrc.TEX3, GX.TexGenSrc.TEX4,
  GX.TexGenSrc.TEX5, GX.TexGenSrc.TEX6, GX.TexGenSrc.TEX7,
];

/** Bias the hardware applies to the 6-bit indirect-matrix exponent field. */
const IND_SCALE_BIAS = 0x11 + 10;

/** What a texgen XF register looks like before anything is set; retail leaves emboss source 5. */
const TEXGEN_XF_BASE = 5 << 12;

function alignUp(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}

function viewOf(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

/** Byte length of a material block whose block start sits at `blockOffset` with `layers` layers. */
export function materialBlockSize(blockOffset: number, layers: number): number {
  return materialDlOffset(blockOffset, layers) + MAT_DL_SIZE;
}

/** Offset of the display list inside a material block; the list is always 32-byte aligned. */
export function materialDlOffset(blockOffset: number, layers: number): number {
  return alignUp(blockOffset + MAT_STRUCT_SIZE + layers * MAT_LAYER_SIZE, 0x20) - blockOffset;
}

// ------------------------------------------------------------------------------------- decoding

function decodeColorS10(ra: number, bg: number): GxColorS10 {
  return {
    r: signExtend(ra & 0x7ff, 11),
    g: signExtend((bg >>> 12) & 0x7ff, 11),
    b: signExtend(bg & 0x7ff, 11),
    a: signExtend((ra >>> 12) & 0x7ff, 11),
  };
}

function decodeKonst(ra: number, bg: number): GxColor {
  return {
    r: (ra & 0x7ff) / 0xff,
    g: ((bg >>> 12) & 0x7ff) / 0xff,
    b: (bg & 0x7ff) / 0xff,
    a: ((ra >>> 12) & 0x7ff) / 0xff,
  };
}

function decodeChannelControl(chanCtrl: number): GxChannelControlDoc {
  const attnEnabled = ((chanCtrl >>> 9) & 0x01) !== 0;
  const attnSelect = ((chanCtrl >>> 10) & 0x01) !== 0;
  return {
    materialSource: (chanCtrl >>> 0) & 0x01,
    lightingEnabled: ((chanCtrl >>> 1) & 0x01) !== 0,
    ambientSource: (chanCtrl >>> 6) & 0x01,
    litMask: (((chanCtrl >>> 11) & 0x0f) << 4) | ((chanCtrl >>> 2) & 0x0f),
    diffuseFunction: (chanCtrl >>> 7) & 0x03,
    attenuationFunction: attnEnabled
      ? (attnSelect ? GX.AttenuationFunction.SPOT : GX.AttenuationFunction.SPEC)
      : GX.AttenuationFunction.NONE,
  };
}

function sameChannelControl(a: GxChannelControlDoc, b: GxChannelControlDoc): boolean {
  return a.lightingEnabled === b.lightingEnabled
    && a.materialSource === b.materialSource
    && a.ambientSource === b.ambientSource
    && a.litMask === b.litMask
    && a.diffuseFunction === b.diffuseFunction
    && a.attenuationFunction === b.attenuationFunction;
}

function decodeRgba8(value: number): GxColor {
  return {
    r: ((value >>> 24) & 0xff) / 0xff,
    g: ((value >>> 16) & 0xff) / 0xff,
    b: ((value >>> 8) & 0xff) / 0xff,
    a: (value & 0xff) / 0xff,
  };
}

function decodeTexGen(xfTex: number, xfDual: number, index: number, mapMode: GxMapMode): GxTexGenDoc {
  const projection = (xfTex >>> 1) & 0x01;
  const rawType = (xfTex >>> 4) & 0x07;
  const sourceRow = (xfTex >>> 7) & 0x1f;
  const embossSource = (xfTex >>> 12) & 0x07;
  const embossLight = (xfTex >>> 15) & 0x07;

  let type: GX.TexGenType;
  let source: GX.TexGenSrc;
  if (rawType === 1) {
    type = GX.TexGenType.BUMP0 + embossLight;
    source = GX.TexGenSrc.TEXCOORD0 + embossSource;
  } else if (rawType === 2 || rawType === 3) {
    type = GX.TexGenType.SRTG;
    source = rawType === 2 ? GX.TexGenSrc.COLOR0 : GX.TexGenSrc.COLOR1;
  } else {
    type = projection ? GX.TexGenType.MTX3x4 : GX.TexGenType.MTX2x4;
    source = TEXGEN_SOURCE_ROWS[sourceRow] ?? GX.TexGenSrc.TEX0;
  }

  // The texgen matrix is not in the display list: NW4R derives it from the layer's map mode,
  // and so does the renderer. Mirror that so the document says what will actually be used.
  let matrix: GX.TexGenMatrix = GX.TexGenMatrix.IDENTITY;
  if (mapMode === 'projection') matrix = GX.TexGenMatrix.PNMTX0;
  else if (mapMode === 'envCamera' || mapMode === 'envLight') matrix = GX.TexGenMatrix.TEXMTX0 + index * 3;

  return {
    type,
    source,
    matrix,
    normalize: ((xfDual >>> 8) & 0x01) !== 0,
    postMatrix: (xfDual & 0xff) + GX.PostTexGenMatrix.PTTEXMTX0,
  };
}

function decodeTevStage(regs: GxRegisterFile, index: number): GxTevStageDoc {
  const order = bpValue(regs, GX.BPRegister.RAS1_TREF_0_ID + (index >>> 1));
  const odd = (index & 1) !== 0;
  const texMapRaw: GX.TexMapID = (order >>> (odd ? 12 : 0)) & 0x07;
  const texEnabled = ((order >>> (odd ? 18 : 6)) & 0x01) !== 0;

  const color = bpValue(regs, GX.BPRegister.TEV_COLOR_ENV_0_ID + index * 2);
  const alpha = bpValue(regs, GX.BPRegister.TEV_ALPHA_ENV_0_ID + index * 2);
  const ksel = bpValue(regs, GX.BPRegister.TEV_KSEL_0_ID + (index >>> 1));
  const indCmd = bpValue(regs, GX.BPRegister.IND_CMD0_ID + index);

  const colorBias: GX.TevBias = (color >>> 16) & 0x03;
  const colorScale: GX.TevScale = (color >>> 20) & 0x03;
  const alphaBias: GX.TevBias = (alpha >>> 16) & 0x03;
  const alphaScale: GX.TevScale = (alpha >>> 20) & 0x03;

  return {
    colorInA: (color >>> 12) & 0x0f,
    colorInB: (color >>> 8) & 0x0f,
    colorInC: (color >>> 4) & 0x0f,
    colorInD: (color >>> 0) & 0x0f,
    colorOp: decodeTevOp(colorBias, colorScale, ((color >>> 18) & 0x01) !== 0),
    colorBias,
    colorScale,
    colorClamp: ((color >>> 19) & 0x01) !== 0,
    colorRegId: (color >>> 22) & 0x03,

    alphaInA: (alpha >>> 13) & 0x07,
    alphaInB: (alpha >>> 10) & 0x07,
    alphaInC: (alpha >>> 7) & 0x07,
    alphaInD: (alpha >>> 4) & 0x07,
    alphaOp: decodeTevOp(alphaBias, alphaScale, ((alpha >>> 18) & 0x01) !== 0),
    alphaBias,
    alphaScale,
    alphaClamp: ((alpha >>> 19) & 0x01) !== 0,
    alphaRegId: (alpha >>> 22) & 0x03,

    texCoordId: (order >>> (odd ? 15 : 3)) & 0x07,
    texMap: texEnabled ? texMapRaw : GX.TexMapID.TEXMAP_NULL,
    channelId: (order >>> (odd ? 19 : 7)) & 0x07,
    konstColorSel: (ksel >>> (odd ? 14 : 4)) & 0x1f,
    konstAlphaSel: (ksel >>> (odd ? 19 : 9)) & 0x1f,
    rasSwapTable: (alpha >>> 0) & 0x03,
    texSwapTable: (alpha >>> 2) & 0x03,

    indTexStage: (indCmd >>> 0) & 0x03,
    indTexFormat: (indCmd >>> 2) & 0x03,
    indTexBiasSel: (indCmd >>> 4) & 0x07,
    indTexAlphaSel: (indCmd >>> 7) & 0x03,
    indTexMatrix: (indCmd >>> 9) & 0x0f,
    indTexWrapS: (indCmd >>> 13) & 0x07,
    indTexWrapT: (indCmd >>> 16) & 0x07,
    indTexUseOrigLOD: ((indCmd >>> 19) & 0x01) !== 0,
    indTexAddPrev: ((indCmd >>> 20) & 0x01) !== 0,
  };
}

function decodeTevOp(bias: GX.TevBias, scale: GX.TevScale, subtract: boolean): GX.TevOp {
  if (bias !== GX.TevBias.$HWB_COMPARE) return subtract ? GX.TevOp.SUB : GX.TevOp.ADD;
  return (GX.TevOp.COMP_R8_GT + scale * 2 + (subtract ? 1 : 0)) as GX.TevOp;
}

function decodeIndMatrix(a: number, b: number, c: number): GxIndMatrixDoc {
  const rawExp = (((c >>> 22) & 0x03) << 4) | (((b >>> 22) & 0x03) << 2) | ((a >>> 22) & 0x03);
  const scaleExp = rawExp - IND_SCALE_BIAS;
  const scale = Math.pow(2, scaleExp);
  const coefficient = (value: number, shift: number) => signExtend((value >>> shift) & 0x7ff, 11) * scale;
  return {
    m: [coefficient(a, 0), coefficient(b, 0), coefficient(c, 0), coefficient(a, 11), coefficient(b, 11), coefficient(c, 11)],
    scaleExp,
  };
}

export interface DecodedMaterial {
  doc: GxMaterialDoc;
  /** Where the shared TEV block sits, relative to the material block. */
  tevOffset: number;
  layers: number;
}

export interface MaterialBlockSource {
  /** The material block, starting at its own byte 0. */
  block: Uint8Array;
  /** The TEV block the material points at. */
  tev: Uint8Array;
  name: string;
  /** Resolves a layer's texture/palette name; `offset` is relative to the material block. */
  readName: (offset: number) => string;
}

export function decodeMaterialBlock(source: MaterialBlockSource): GxMaterialDoc {
  const { block, tev } = source;
  const view = viewOf(block);
  if (block.length < MAT_STRUCT_SIZE) throw new GxMaterialError(`Material "${source.name}" is truncated.`);

  const numTexGens = view.getUint8(MAT.numTexGens);
  const numChans = view.getUint8(MAT.numChans);
  const numTevStages = view.getUint8(MAT.numTevStages);
  const numIndStages = view.getUint8(MAT.numIndStages);
  const numLayers = view.getUint32(MAT.numLayers);
  const layerOffset = view.getUint32(MAT.layerOffset);
  const dlOffset = view.getUint32(MAT.dlOffset);

  const regs = createRegisterFile();
  readDisplayList(block, dlOffset, MAT_DL_SIZE, regs);
  if (tev.length >= TEV_DL_OFFSET + TEV_DL_SIZE) readDisplayList(tev, TEV_DL_OFFSET, TEV_DL_SIZE, regs);

  const mapModes: GxMapMode[] = [];
  for (let i = 0; i < 8; i++) {
    mapModes.push(MAP_MODES[view.getInt8(MAT.texMtxTable + i * 0x34 + 0x02)] ?? 'texcoord');
  }

  const samplers: GxSamplerDoc[] = [];
  const texSrts: GxTexSrtDoc[] = [];
  for (let i = 0; i < numLayers; i++) {
    const at = layerOffset + i * MAT_LAYER_SIZE;
    const textureRel = view.getInt32(at + LAYER.textureName);
    const paletteRel = view.getInt32(at + LAYER.paletteName);
    samplers.push({
      texture: textureRel !== 0 ? source.readName(at + textureRel) : '',
      palette: paletteRel !== 0 ? source.readName(at + paletteRel) : '',
      wrapS: view.getUint32(at + LAYER.wrapS),
      wrapT: view.getUint32(at + LAYER.wrapT),
      minFilter: view.getUint32(at + LAYER.minFilter),
      magFilter: view.getUint32(at + LAYER.magFilter),
      lodBias: view.getFloat32(at + LAYER.lodBias),
      maxAnisotropy: view.getUint32(at + LAYER.maxAnisotropy),
      biasClamp: view.getUint8(at + LAYER.biasClamp) !== 0,
      edgeLod: view.getUint8(at + LAYER.edgeLod) !== 0,
      mapMode: mapModes[i] ?? 'texcoord',
      tlutId: view.getUint32(at + LAYER.tlutId),
    });
    const srt = MAT.texSrtTable + i * 0x14;
    const mtx = MAT.texMtxTable + i * 0x34;
    texSrts.push({
      scaleS: view.getFloat32(srt + 0x00),
      scaleT: view.getFloat32(srt + 0x04),
      rotation: view.getFloat32(srt + 0x08),
      translateS: view.getFloat32(srt + 0x0c),
      translateT: view.getFloat32(srt + 0x10),
      refCamera: view.getInt8(mtx + 0x00),
      refLight: view.getInt8(mtx + 0x01),
    });
  }

  const texGens: GxTexGenDoc[] = [];
  for (let i = 0; i < numTexGens; i++) {
    texGens.push(decodeTexGen(
      regs.xf.get(GX.XFRegister.XF_TEX0_ID + i) ?? 0,
      regs.xf.get(GX.XFRegister.XF_DUALTEX0_ID + i) ?? 0,
      i,
      mapModes[i] ?? 'texcoord',
    ));
  }

  const channels: GxChannelDoc[] = [];
  for (let i = 0; i < numChans; i++) {
    const at = MAT.chanTable + i * 0x14;
    channels.push({
      materialColor: decodeRgba8(view.getUint32(at + 0x04)),
      ambientColor: decodeRgba8(view.getUint32(at + 0x08)),
      color: decodeChannelControl(view.getUint32(at + 0x0c)),
      alpha: decodeChannelControl(view.getUint32(at + 0x10)),
    });
  }

  const reg = (index: number) => (regs.tevColor[index] < 0 ? 0 : regs.tevColor[index]);
  const colorRegisters: [GxColorS10, GxColorS10, GxColorS10] = [
    decodeColorS10(reg(2), reg(3)),
    decodeColorS10(reg(4), reg(5)),
    decodeColorS10(reg(6), reg(7)),
  ];
  const konstColors: [GxColor, GxColor, GxColor, GxColor] = [
    decodeKonst(reg(8), reg(9)),
    decodeKonst(reg(10), reg(11)),
    decodeKonst(reg(12), reg(13)),
    decodeKonst(reg(14), reg(15)),
  ];

  const swapTables = [0, 1, 2, 3].map((table): GxSwapTableDoc => {
    const rg = bpValue(regs, GX.BPRegister.TEV_KSEL_0_ID + table * 2);
    const ba = bpValue(regs, GX.BPRegister.TEV_KSEL_0_ID + table * 2 + 1);
    return [rg & 0x03, (rg >>> 2) & 0x03, ba & 0x03, (ba >>> 2) & 0x03];
  }) as [GxSwapTableDoc, GxSwapTableDoc, GxSwapTableDoc, GxSwapTableDoc];

  const tevStages: GxTevStageDoc[] = [];
  for (let i = 0; i < numTevStages; i++) tevStages.push(decodeTevStage(regs, i));

  const indRefs = bpValue(regs, GX.BPRegister.RAS1_IREF_ID);
  const indTexStages: GxIndTexStageDoc[] = [];
  for (let i = 0; i < numIndStages; i++) {
    const scales = bpValue(regs, GX.BPRegister.RAS1_SS0_ID + (i >>> 1));
    const shift = (i & 1) * 8;
    indTexStages.push({
      texMap: (indRefs >>> (i * 6)) & 0x07,
      texCoordId: (indRefs >>> (i * 6 + 3)) & 0x07,
      scaleS: (scales >>> shift) & 0x0f,
      scaleT: (scales >>> (shift + 4)) & 0x0f,
    });
  }
  const indMatrices = [0, 1, 2].map((n) => decodeIndMatrix(
    bpValue(regs, GX.BPRegister.IND_MTXA0_ID + n * 3),
    bpValue(regs, GX.BPRegister.IND_MTXA0_ID + n * 3 + 1),
    bpValue(regs, GX.BPRegister.IND_MTXA0_ID + n * 3 + 2),
  )) as [GxIndMatrixDoc, GxIndMatrixDoc, GxIndMatrixDoc];

  const alphaFunc = bpValue(regs, GX.BPRegister.TEV_ALPHAFUNC_ID);
  const alphaTest: GxAlphaTestDoc = {
    referenceA: ((alphaFunc >>> 0) & 0xff) / 0xff,
    referenceB: ((alphaFunc >>> 8) & 0xff) / 0xff,
    compareA: (alphaFunc >>> 16) & 0x07,
    compareB: (alphaFunc >>> 19) & 0x07,
    op: (alphaFunc >>> 22) & 0x07,
  };

  const cMode0 = bpValue(regs, GX.BPRegister.PE_CMODE0_ID);
  const cMode1 = bpValue(regs, GX.BPRegister.PE_CMODE0_ID + 1);
  const blendEnabled = (cMode0 & 0x01) !== 0;
  const logicEnabled = ((cMode0 >>> 1) & 0x01) !== 0;
  const blend: GxBlendDoc = {
    mode: blendEnabled
      ? (((cMode0 >>> 11) & 0x01) !== 0 ? GX.BlendMode.SUBTRACT : GX.BlendMode.BLEND)
      : logicEnabled ? GX.BlendMode.LOGIC : GX.BlendMode.NONE,
    dstFactor: (cMode0 >>> 5) & 0x07,
    srcFactor: (cMode0 >>> 8) & 0x07,
    logicOp: (cMode0 >>> 12) & 0x0f,
    constantAlphaEnabled: ((cMode1 >>> 8) & 0x01) !== 0,
    constantAlpha: (cMode1 & 0xff) / 0xff,
  };

  const zMode = bpValue(regs, GX.BPRegister.PE_ZMODE_ID);
  const depth: GxDepthDoc = {
    test: (zMode & 0x01) !== 0,
    func: (zMode >>> 1) & 0x07,
    write: ((zMode >>> 4) & 0x01) !== 0,
    compareBeforeTexture: view.getUint8(MAT.zCompLoc) !== 0,
  };

  return {
    name: source.name,
    translucent: (view.getUint32(MAT.flags) & 0x80000000) !== 0,
    cullMode: view.getUint32(MAT.cullMode),
    lightSetIndex: view.getInt8(MAT.lightSet),
    fogIndex: view.getInt8(MAT.fogSet),
    texMatrixMode: TEX_MATRIX_MODES[view.getUint32(MAT.texMatrixMode)] ?? 'maya',
    samplers,
    texSrts,
    texGens,
    channels,
    colorRegisters,
    konstColors,
    swapTables,
    tevStages,
    indTexStages,
    indMatrices,
    alphaTest,
    blend,
    depth,
  };
}

// ------------------------------------------------------------------------------------- encoding

function clampByte(value: number): number {
  return Math.max(0, Math.min(0xff, Math.round(value * 0xff)));
}

function encodeColorS10(color: GxColorS10): [number, number] {
  const field = (value: number) => Math.max(-1024, Math.min(1023, Math.round(value))) & 0x7ff;
  return [field(color.r) | (field(color.a) << 12), field(color.b) | (field(color.g) << 12)];
}

function encodeKonst(color: GxColor): [number, number] {
  const konstBank = 1 << 23;
  return [
    (clampByte(color.r) | (clampByte(color.a) << 12)) | konstBank,
    (clampByte(color.b) | (clampByte(color.g) << 12)) | konstBank,
  ];
}

function encodeRgba8(color: GxColor): number {
  return ((clampByte(color.r) << 24) | (clampByte(color.g) << 16) | (clampByte(color.b) << 8) | clampByte(color.a)) >>> 0;
}

function encodeChannelControl(control: GxChannelControlDoc): number {
  // libogc's encoding of the three attenuation functions: "none" is spot-with-attenuation-off,
  // which is why the select bit is set for it too. Retail materials all store it that way.
  const attnEnabled = control.attenuationFunction !== GX.AttenuationFunction.NONE;
  const attnSelect = control.attenuationFunction !== GX.AttenuationFunction.SPEC;
  return packBits([
    [control.materialSource, 0, 1],
    [control.lightingEnabled ? 1 : 0, 1, 1],
    [control.litMask & 0x0f, 2, 4],
    [control.ambientSource, 6, 1],
    [control.diffuseFunction, 7, 2],
    [attnEnabled ? 1 : 0, 9, 1],
    [attnSelect ? 1 : 0, 10, 1],
    [(control.litMask >>> 4) & 0x0f, 11, 4],
  ]);
}

function encodeTexGen(texGen: GxTexGenDoc, base: number): number {
  let rawType = 0;
  let projection = texGen.type === GX.TexGenType.MTX3x4 ? 1 : 0;
  let sourceRow = Math.max(0, TEXGEN_SOURCE_ROWS.indexOf(texGen.source));
  let embossSource = (base >>> 12) & 0x07;
  let embossLight = (base >>> 15) & 0x07;

  if (texGen.type >= GX.TexGenType.BUMP0 && texGen.type <= GX.TexGenType.BUMP7) {
    rawType = 1;
    projection = 0;
    embossLight = texGen.type - GX.TexGenType.BUMP0;
    embossSource = Math.max(0, texGen.source - GX.TexGenSrc.TEXCOORD0) & 0x07;
    sourceRow = 0;
  } else if (texGen.type === GX.TexGenType.SRTG) {
    rawType = texGen.source === GX.TexGenSrc.COLOR1 ? 3 : 2;
    projection = 0;
    sourceRow = texGen.source === GX.TexGenSrc.COLOR1 ? 3 : 2;
  }
  // The input form is not part of the document. NW4R matches it to the projection (2x4 texgens
  // use AB11, 3x4 use ABC1) but not every exporter does, so keep whatever was there.
  const form = base === TEXGEN_XF_BASE ? projection : (base >>> 2) & 0x01;
  return packBits([
    [projection, 1, 1],
    [form, 2, 1],
    [rawType, 4, 3],
    [sourceRow, 7, 5],
    [embossSource, 12, 3],
    [embossLight, 15, 3],
    [0, 18, 1],
  ]);
}

/**
 * The konst-selection and texture-order registers a stage pair shares.
 *
 * Both start from what is already in the file, because both hold fields no reader looks at: the
 * half of a pair with only one stage, the texture slot named by a stage that samples no texture,
 * and (in the konst register) the low four bits, which the swap-table write owns and the konst
 * write masks out. Exporters put different things there and the point is to disturb none of it.
 */
function encodeTevStagePair(
  stages: readonly GxTevStageDoc[],
  pair: number,
  baseKonst: number,
  baseOrder: number,
): [konst: number, order: number] {
  let konst = baseKonst >>> 0;
  let order = baseOrder >>> 0;
  const set = (target: number, value: number, shift: number, width: number) =>
    ((target & ~(((1 << width) - 1) << shift)) | ((value & ((1 << width) - 1)) << shift)) >>> 0;

  const apply = (stage: GxTevStageDoc | undefined, shiftBase: number, konstShift: number) => {
    if (!stage) return;
    const enabled = stage.texMap !== GX.TexMapID.TEXMAP_NULL;
    if (enabled) order = set(order, stage.texMap, shiftBase + 0, 3);
    order = set(order, stage.texCoordId, shiftBase + 3, 3);
    order = set(order, enabled ? 1 : 0, shiftBase + 6, 1);
    order = set(order, stage.channelId, shiftBase + 7, 3);
    konst = set(konst, stage.konstColorSel, konstShift + 0, 5);
    konst = set(konst, stage.konstAlphaSel, konstShift + 5, 5);
  };
  apply(stages[pair * 2], 0, 4);
  apply(stages[pair * 2 + 1], 12, 14);
  return [konst >>> 0, order >>> 0];
}

function encodeTevStage(stage: GxTevStageDoc): [color: number, alpha: number, ind: number] {
  const color = packBits([
    [stage.colorInD, 0, 4],
    [stage.colorInC, 4, 4],
    [stage.colorInB, 8, 4],
    [stage.colorInA, 12, 4],
    [stage.colorBias, 16, 2],
    [tevOpSubtractBit(stage.colorOp) ? 1 : 0, 18, 1],
    [stage.colorClamp ? 1 : 0, 19, 1],
    [stage.colorScale, 20, 2],
    [stage.colorRegId, 22, 2],
  ]);
  const alpha = packBits([
    [stage.rasSwapTable, 0, 2],
    [stage.texSwapTable, 2, 2],
    [stage.alphaInD, 4, 3],
    [stage.alphaInC, 7, 3],
    [stage.alphaInB, 10, 3],
    [stage.alphaInA, 13, 3],
    [stage.alphaBias, 16, 2],
    [tevOpSubtractBit(stage.alphaOp) ? 1 : 0, 18, 1],
    [stage.alphaClamp ? 1 : 0, 19, 1],
    [stage.alphaScale, 20, 2],
    [stage.alphaRegId, 22, 2],
  ]);
  const ind = packBits([
    [stage.indTexStage, 0, 2],
    [stage.indTexFormat, 2, 2],
    [stage.indTexBiasSel, 4, 3],
    [stage.indTexAlphaSel, 7, 2],
    [stage.indTexMatrix, 9, 4],
    [stage.indTexWrapS, 13, 3],
    [stage.indTexWrapT, 16, 3],
    [stage.indTexUseOrigLOD ? 1 : 0, 19, 1],
    [stage.indTexAddPrev ? 1 : 0, 20, 1],
  ]);
  return [color, alpha, ind];
}

function encodeIndMatrix(matrix: GxIndMatrixDoc): [number, number, number] {
  const rawExp = Math.round(matrix.scaleExp) + IND_SCALE_BIAS;
  if (rawExp < 0 || rawExp > 63) {
    throw new GxMaterialError(`Indirect matrix scale exponent ${matrix.scaleExp} is out of the hardware range (-27..36).`);
  }
  const scale = Math.pow(2, Math.round(matrix.scaleExp));
  const coefficient = (value: number) => Math.max(-1024, Math.min(1023, Math.round(value / scale))) & 0x7ff;
  const scaleBits = [rawExp & 0x03, (rawExp >>> 2) & 0x03, (rawExp >>> 4) & 0x03];
  return [
    (coefficient(matrix.m[0]) | (coefficient(matrix.m[3]) << 11) | (scaleBits[0] << 22)) >>> 0,
    (coefficient(matrix.m[1]) | (coefficient(matrix.m[4]) << 11) | (scaleBits[1] << 22)) >>> 0,
    (coefficient(matrix.m[2]) | (coefficient(matrix.m[5]) << 11) | (scaleBits[2] << 22)) >>> 0,
  ];
}

function sameIndMatrix(a: GxIndMatrixDoc, b: GxIndMatrixDoc): boolean {
  return a.scaleExp === b.scaleExp && a.m.every((value, i) => value === b.m[i]);
}

function isDefaultIndMatrix(matrix: GxIndMatrixDoc): boolean {
  return matrix.m.every((value) => value === 0) && matrix.scaleExp === -IND_SCALE_BIAS;
}

/** Something wrong with a document, in words a track author can act on. */
export interface MaterialIssue {
  /** Stable identity, so a defect a material already had is not reported as one the editor made. */
  code: string;
  message: string;
}

/**
 * Everything wrong with a document, hard limits first.
 *
 * The split between "throw" and "warn" is not made here: `applyMaterial` compares the issues of
 * the document it is given against those of the material already in the file, and only refuses
 * the ones that are new. Retail content really does contain materials whose stage samples a
 * texture slot the material has no layer for, and writing such a material back unchanged has to
 * keep working.
 */
export function collectMaterialIssues(doc: GxMaterialDoc): MaterialIssue[] {
  const issues: MaterialIssue[] = [];
  const limit = (count: number, max: number, code: string, what: string) => {
    if (count > max) issues.push({ code, message: `"${doc.name}" has ${count} ${what}; the GX hardware allows at most ${max}.` });
  };
  limit(doc.samplers.length, GX_LIMITS.samplers, 'limit.samplers', 'textures');
  limit(doc.texGens.length, GX_LIMITS.texGens, 'limit.texgens', 'texture coordinate generators');
  limit(doc.tevStages.length, GX_LIMITS.tevStages, 'limit.stages', 'TEV stages');
  limit(doc.indTexStages.length, GX_LIMITS.indTexStages, 'limit.indstages', 'indirect texture stages');
  limit(doc.channels.length, GX_LIMITS.channels, 'limit.channels', 'lighting channels');
  if (doc.texSrts.length !== doc.samplers.length) {
    issues.push({
      code: 'limit.texsrts',
      message: `"${doc.name}" has ${doc.texSrts.length} texture transforms for ${doc.samplers.length} textures; there must be one each.`,
    });
  }
  if (doc.tevStages.length === 0) issues.push({ code: 'limit.nostages', message: `"${doc.name}" needs at least one TEV stage.` });

  const inRange = (value: number, max: number, code: string, what: string) => {
    if (!Number.isInteger(value) || value < 0 || value > max) {
      issues.push({ code, message: `"${doc.name}" has an out-of-range ${what} (${value}).` });
    }
  };
  inRange(doc.cullMode, 3, 'range.cull', 'cull mode');
  if (doc.lightSetIndex < -128 || doc.lightSetIndex > 127) issues.push({ code: 'range.lightset', message: `"${doc.name}" has an out-of-range light set index (${doc.lightSetIndex}).` });
  if (doc.fogIndex < -128 || doc.fogIndex > 127) issues.push({ code: 'range.fog', message: `"${doc.name}" has an out-of-range fog index (${doc.fogIndex}).` });

  doc.tevStages.forEach((stage, index) => {
    const stageName = `Stage ${index + 1} of "${doc.name}"`;
    inRange(stage.texCoordId, 7, `range.stage${index}.texcoord`, `stage ${index + 1} texture coordinate`);
    if (stage.texMap !== GX.TexMapID.TEXMAP_NULL) {
      inRange(stage.texMap, 7, `range.stage${index}.texmap`, `stage ${index + 1} texture slot`);
      if (stage.texMap >= doc.samplers.length) {
        issues.push({ code: `stage${index}.missing-texture`, message: `${stageName} samples texture slot ${stage.texMap + 1}, but the material only has ${doc.samplers.length}.` });
      }
      if (stage.texCoordId >= doc.texGens.length) {
        issues.push({ code: `stage${index}.missing-texcoord`, message: `${stageName} uses texture coordinate ${stage.texCoordId + 1}, but the material only generates ${doc.texGens.length}.` });
      }
    }
    if (stage.indTexMatrix !== GX.IndTexMtxID.OFF && stage.indTexStage >= doc.indTexStages.length) {
      issues.push({ code: `stage${index}.missing-indstage`, message: `${stageName} reads indirect stage ${stage.indTexStage + 1}, but the material only has ${doc.indTexStages.length}.` });
    }
    inRange(stage.rasSwapTable, 3, `range.stage${index}.rasswap`, `stage ${index + 1} raster swap table`);
    inRange(stage.texSwapTable, 3, `range.stage${index}.texswap`, `stage ${index + 1} texture swap table`);
    inRange(stage.konstColorSel, 0x1f, `range.stage${index}.konstcolor`, `stage ${index + 1} konst color selection`);
    inRange(stage.konstAlphaSel, 0x1f, `range.stage${index}.konstalpha`, `stage ${index + 1} konst alpha selection`);
  });
  doc.indTexStages.forEach((stage, index) => {
    inRange(stage.texMap, 7, `range.ind${index}.texmap`, `indirect stage ${index + 1} texture slot`);
    inRange(stage.texCoordId, 7, `range.ind${index}.texcoord`, `indirect stage ${index + 1} texture coordinate`);
    if (stage.texMap >= doc.samplers.length) {
      issues.push({ code: `ind${index}.missing-texture`, message: `Indirect stage ${index + 1} of "${doc.name}" samples texture slot ${stage.texMap + 1}, but the material only has ${doc.samplers.length}.` });
    }
  });
  return issues;
}

/** Issues that make a block impossible to lay out at all, so no encoder may ignore them. */
export function collectFatalMaterialIssues(doc: GxMaterialDoc): MaterialIssue[] {
  return collectMaterialIssues(doc).filter((issue) => issue.code.startsWith('limit.'));
}

/** Rejects a document the GX hardware could not run, in words a track author can act on. */
export function validateMaterialDoc(doc: GxMaterialDoc): void {
  const issue = collectMaterialIssues(doc)[0];
  if (issue) throw new GxMaterialError(issue.message);
}

export interface EncodedMaterial {
  /** The material block, ready to be dropped in at `blockOffset`. */
  block: Uint8Array;
  /** The 512-byte TEV block. */
  tev: Uint8Array;
  /** Offset of the display list inside `block`. */
  dlOffset: number;
}

export interface EncodeMaterialOptions {
  doc: GxMaterialDoc;
  /** The block this material is replacing; unmodelled bytes are carried over from it. */
  original: Uint8Array;
  /** The TEV block being replaced, for the same reason. */
  originalTev: Uint8Array;
  /** Where the new block will live inside the MDL0; decides the display list's alignment padding. */
  blockOffset: number;
}

export function encodeMaterialBlock(options: EncodeMaterialOptions): EncodedMaterial {
  const { doc, original, originalTev, blockOffset } = options;
  const fatal = collectFatalMaterialIssues(doc)[0];
  if (fatal) throw new GxMaterialError(fatal.message);

  const originalView = viewOf(original);
  const originalLayerOffset = originalView.getUint32(MAT.layerOffset);
  const originalLayers = originalView.getUint32(MAT.numLayers);
  const originalDlOffset = originalView.getUint32(MAT.dlOffset);

  const layers = doc.samplers.length;
  const dlOffset = materialDlOffset(blockOffset, layers);
  const block = new Uint8Array(dlOffset + MAT_DL_SIZE);
  block.set(original.subarray(0, Math.min(MAT_STRUCT_SIZE, original.length)), 0);
  const view = viewOf(block);

  // Header.
  view.setUint32(MAT.size, block.length);
  view.setUint32(MAT.flags, ((originalView.getUint32(MAT.flags) & 0x7fffffff) | (doc.translucent ? 0x80000000 : 0)) >>> 0);
  view.setUint8(MAT.numTexGens, doc.texGens.length);
  view.setUint8(MAT.numChans, doc.channels.length);
  view.setUint8(MAT.numTevStages, doc.tevStages.length);
  view.setUint8(MAT.numIndStages, doc.indTexStages.length);
  view.setUint32(MAT.cullMode, doc.cullMode);
  view.setUint8(MAT.zCompLoc, doc.depth.compareBeforeTexture ? 1 : 0);
  view.setInt8(MAT.lightSet, doc.lightSetIndex);
  view.setInt8(MAT.fogSet, doc.fogIndex);
  view.setUint32(MAT.numLayers, layers);
  // Exporters write 0 rather than a pointer when a material has no layers at all.
  view.setUint32(MAT.layerOffset, layers > 0 ? MAT.layerTable : (originalLayers === 0 ? originalLayerOffset : 0));
  view.setUint32(MAT.dlOffset, dlOffset);

  // Texture SRTs and the matrix effects that carry the map mode.
  let srtFlags = 0;
  for (let i = 0; i < 8; i++) {
    const srt = doc.texSrts[i];
    const at = MAT.texSrtTable + i * 0x14;
    if (srt) {
      view.setFloat32(at + 0x00, srt.scaleS);
      view.setFloat32(at + 0x04, srt.scaleT);
      view.setFloat32(at + 0x08, srt.rotation);
      view.setFloat32(at + 0x0c, srt.translateS);
      view.setFloat32(at + 0x10, srt.translateT);
      // Bit 0 is the "has a flag at all" marker NW4R sets for every live layer.
      srtFlags |= (0x01
        | (srt.scaleS === 1 && srt.scaleT === 1 ? 0x02 : 0)
        | (srt.rotation === 0 ? 0x04 : 0)
        | (srt.translateS === 0 && srt.translateT === 0 ? 0x08 : 0)) << (i * 4);
    } else if (i >= originalLayers) {
      // Slot past what the source had: leave the identity the copied struct already carries.
      view.setFloat32(at + 0x00, 1);
      view.setFloat32(at + 0x04, 1);
      view.setFloat32(at + 0x08, 0);
      view.setFloat32(at + 0x0c, 0);
      view.setFloat32(at + 0x10, 0);
    }
    const mtx = MAT.texMtxTable + i * 0x34;
    if (srt) {
      view.setInt8(mtx + 0x00, srt.refCamera);
      view.setInt8(mtx + 0x01, srt.refLight);
      view.setInt8(mtx + 0x02, Math.max(0, MAP_MODES.indexOf(doc.samplers[i].mapMode)));
    } else if (i >= originalLayers) {
      view.setInt8(mtx + 0x00, -1);
      view.setInt8(mtx + 0x01, -1);
      view.setInt8(mtx + 0x02, 0);
      view.setInt8(mtx + 0x03, 1);
      for (let k = 0; k < 12; k++) view.setFloat32(mtx + 0x04 + k * 4, k % 5 === 0 ? 1 : 0);
    }
  }
  view.setUint32(MAT.srtFlags, srtFlags >>> 0);
  view.setUint32(MAT.texMatrixMode, Math.max(0, TEX_MATRIX_MODES.indexOf(doc.texMatrixMode)));

  // Lighting channels. Slots past `channels.length` keep whatever the source had, and so does the
  // "which fields are set" word, which exporters fill in inconsistently and no reader looks at.
  // A control word is only rewritten when it no longer means what the document says: several
  // encodings map to the same channel control (attenuation "none" is stored both as 0 and as
  // spot-with-attenuation-off) and some files leave junk in the unused high bits.
  const originalChannels = originalView.getUint8(MAT.numChans);
  doc.channels.forEach((channel, i) => {
    const at = MAT.chanTable + i * 0x14;
    if (i >= originalChannels) view.setUint32(at + 0x00, 0x3f);
    view.setUint32(at + 0x04, encodeRgba8(channel.materialColor));
    view.setUint32(at + 0x08, encodeRgba8(channel.ambientColor));
    const keepIfEquivalent = (offset: number, control: GxChannelControlDoc) => {
      const stored = i < originalChannels ? originalView.getUint32(at + offset) : null;
      if (stored !== null && sameChannelControl(decodeChannelControl(stored), control)) return;
      view.setUint32(at + offset, encodeChannelControl(control));
    };
    keepIfEquivalent(0x0c, channel.color);
    keepIfEquivalent(0x10, channel.alpha);
  });
  for (let i = doc.channels.length; i < 2; i++) {
    if (i < originalChannels) view.setUint32(MAT.chanTable + i * 0x14, 0x0f);
  }

  // Layer table.
  const template = originalLayers > 0
    ? original.subarray(originalLayerOffset, originalLayerOffset + MAT_LAYER_SIZE)
    : new Uint8Array(MAT_LAYER_SIZE);
  doc.samplers.forEach((sampler, i) => {
    const at = MAT.layerTable + i * MAT_LAYER_SIZE;
    const from = i < originalLayers ? original.subarray(originalLayerOffset + i * MAT_LAYER_SIZE, originalLayerOffset + (i + 1) * MAT_LAYER_SIZE) : template;
    block.set(from, at);
    // The name pointers are re-derived by the caller; zero them so a stale one cannot survive.
    view.setInt32(at + LAYER.textureName, 0);
    view.setInt32(at + LAYER.paletteName, 0);
    view.setUint32(at + LAYER.texMapId, i);
    view.setUint32(at + LAYER.tlutId, sampler.tlutId ?? (i < originalLayers ? originalView.getUint32(originalLayerOffset + i * MAT_LAYER_SIZE + LAYER.tlutId) : 0));
    view.setUint32(at + LAYER.wrapS, sampler.wrapS);
    view.setUint32(at + LAYER.wrapT, sampler.wrapT);
    view.setUint32(at + LAYER.minFilter, sampler.minFilter);
    view.setUint32(at + LAYER.magFilter, sampler.magFilter);
    view.setFloat32(at + LAYER.lodBias, sampler.lodBias);
    view.setUint32(at + LAYER.maxAnisotropy, sampler.maxAnisotropy);
    view.setUint8(at + LAYER.biasClamp, sampler.biasClamp ? 1 : 0);
    view.setUint8(at + LAYER.edgeLod, sampler.edgeLod ? 1 : 0);
  });

  // Display list. Unmodelled register bits (the emboss fields of a regular texgen, say) are
  // carried over from whatever was there so a re-encode reproduces the source byte for byte.
  const originalRegs = createRegisterFile();
  if (originalDlOffset > 0 && originalDlOffset + MAT_DL_SIZE <= original.length) {
    readDisplayList(original, originalDlOffset, MAT_DL_SIZE, originalRegs);
  }

  const alphaFunc = packBits([
    [clampByte(doc.alphaTest.referenceA), 0, 8],
    [clampByte(doc.alphaTest.referenceB), 8, 8],
    [doc.alphaTest.compareA, 16, 3],
    [doc.alphaTest.compareB, 19, 3],
    [doc.alphaTest.op, 22, 2],
  ]);
  const zMode = packBits([
    [doc.depth.test ? 1 : 0, 0, 1],
    [doc.depth.func, 1, 3],
    [doc.depth.write ? 1 : 0, 4, 1],
  ]);
  const cMode0 = packBits([
    [doc.blend.mode === GX.BlendMode.BLEND || doc.blend.mode === GX.BlendMode.SUBTRACT ? 1 : 0, 0, 1],
    [doc.blend.mode === GX.BlendMode.LOGIC ? 1 : 0, 1, 1],
    [doc.blend.dstFactor, 5, 3],
    [doc.blend.srcFactor, 8, 3],
    [doc.blend.mode === GX.BlendMode.SUBTRACT ? 1 : 0, 11, 1],
    [doc.blend.logicOp, 12, 4],
  ]);
  const cMode1 = packBits([
    [clampByte(doc.blend.constantAlpha), 0, 8],
    [doc.blend.constantAlphaEnabled ? 1 : 0, 8, 1],
  ]);

  const indScales = [0, 0];
  doc.indTexStages.forEach((stage, i) => {
    indScales[i >>> 1] |= packBits([[stage.scaleS, (i & 1) * 8, 4], [stage.scaleT, (i & 1) * 8 + 4, 4]]);
  });

  // NW4R emits matrix 0 for a material with indirect stages and nothing at all for one without.
  // Files disagree at the margins, so the rule is: write what was written before, plus matrix 0
  // when indirect stages have just been added, plus any matrix the author actually filled in.
  const hasIndirect = doc.indTexStages.length > 0;
  const originalHadIndirect = originalView.getUint8(MAT.numIndStages) > 0;
  const indMatrices = doc.indMatrices.map((matrix, n) => {
    const stored = decodeIndMatrix(
      bpValue(originalRegs, GX.BPRegister.IND_MTXA0_ID + n * 3),
      bpValue(originalRegs, GX.BPRegister.IND_MTXA0_ID + n * 3 + 1),
      bpValue(originalRegs, GX.BPRegister.IND_MTXA0_ID + n * 3 + 2),
    );
    // Unchanged: leave the bytes exactly where the exporter put them, which is not always where
    // this writer would put them. The one exception is a material that has just been given its
    // first indirect stage and so has no matrix at all yet.
    if (sameIndMatrix(stored, matrix)) {
      return hasIndirect && !originalHadIndirect && n === 0 ? encodeIndMatrix(matrix) : null;
    }
    return hasIndirect ? encodeIndMatrix(matrix) : null;
  });

  const matDl = writeMaterialDisplayList({
    alphaFunc,
    zMode,
    cMode0,
    cMode1,
    colorRegs: doc.colorRegisters.map(encodeColorS10),
    konstRegs: doc.konstColors.map(encodeKonst),
    indScale0: indScales[0],
    indScale1: indScales[1],
    indMatrices,
    texGens: doc.texGens.map((texGen, i) => [
      encodeTexGen(texGen, originalRegs.xf.get(GX.XFRegister.XF_TEX0_ID + i) ?? TEXGEN_XF_BASE),
      packBits([[texGen.postMatrix - GX.PostTexGenMatrix.PTTEXMTX0, 0, 8], [texGen.normalize ? 1 : 0, 8, 1]]),
    ] as [number, number]),
  }, originalDlOffset > 0 && originalDlOffset + MAT_DL_SIZE <= original.length
    ? original.subarray(originalDlOffset, originalDlOffset + MAT_DL_SIZE)
    : undefined);
  block.set(matDl, dlOffset);

  return { block, tev: encodeTevBlock(doc, originalTev, originalLayers, originalView.getUint8(MAT.numTevStages)), dlOffset };
}

/** Rebuilds the 512-byte shared TEV block for `doc`, keeping the source block's header fields. */
export function encodeTevBlock(doc: GxMaterialDoc, original: Uint8Array, originalLayers = -1, originalStages = -1): Uint8Array {
  const tev = new Uint8Array(TEV_BLOCK_SIZE);
  tev.set(original.subarray(0, Math.min(TEV_DL_OFFSET, original.length)), 0);
  const view = viewOf(tev);
  view.setUint32(TEV.size, TEV_BLOCK_SIZE);
  // The block's own stage count and texture references only mean anything alongside the material
  // header's counts, and the two disagree in a fair few shipped files. Rewrite them when the
  // material's counts changed and leave them alone when they did not.
  if (doc.tevStages.length !== originalStages) view.setUint8(TEV.numStages, doc.tevStages.length);
  if (doc.samplers.length !== originalLayers) {
    // The eight texture references are the identity for every live layer; NW4R writes one even
    // for a material with no textures at all.
    const liveRefs = Math.max(1, doc.samplers.length);
    for (let i = 0; i < 8; i++) view.setUint8(TEV.refs + i, i < liveRefs ? i : 0xff);
  }

  const swap: number[] = [];
  for (const table of doc.swapTables) {
    swap.push((table[0] & 0x03) | ((table[1] & 0x03) << 2), (table[2] & 0x03) | ((table[3] & 0x03) << 2));
  }
  // The slots of the indirect reference register that no live stage uses are don't-cares, and
  // exporters disagree on what to leave in them (0x000000 in some tracks, 0xFFFFFF in others), so
  // carry the source's value through rather than inventing one.
  const originalRegs = createRegisterFile();
  if (original.length >= TEV_DL_OFFSET + TEV_DL_SIZE) readDisplayList(original, TEV_DL_OFFSET, TEV_DL_SIZE, originalRegs);
  let indRefs = originalRegs.bp[GX.BPRegister.RAS1_IREF_ID] < 0 ? 0x00ffffff : bpValue(originalRegs, GX.BPRegister.RAS1_IREF_ID);
  doc.indTexStages.forEach((stage, i) => {
    indRefs = (indRefs & ~(0x3f << (i * 6))) | (((stage.texMap & 0x07) | ((stage.texCoordId & 0x07) << 3)) << (i * 6));
  });

  const originalDl = original.length >= TEV_DL_OFFSET + TEV_DL_SIZE
    ? original.subarray(TEV_DL_OFFSET, TEV_DL_OFFSET + TEV_DL_SIZE)
    : null;
  const pairCount = Math.ceil(doc.tevStages.length / 2);
  const pairs: Array<[number, number]> = [];
  for (let k = 0; k < pairCount; k++) {
    const at = TEV_DL.pair + k * 0x30;
    // Read the stored writes, not the replayed registers: the konst register's low four bits are
    // masked out of this write and belong to the swap table, so the replayed value is not what
    // the file has here.
    const konst = originalDl ? rawBpWriteAt(originalDl, at + TEV_DL.pairKonst, GX.BPRegister.TEV_KSEL_0_ID + k) : null;
    const order = originalDl ? rawBpWriteAt(originalDl, at + TEV_DL.pairOrder, GX.BPRegister.RAS1_TREF_0_ID + k) : null;
    pairs.push(encodeTevStagePair(doc.tevStages, k, konst ?? 0, order ?? 0));
  }

  // An indirect command that says nothing, on a stage whose register already reads that way, is
  // not written at all: some exporters leave that slot to a different register entirely, and
  // overwriting it would change bytes without changing what the material does.
  const indCommands = doc.tevStages.map((stage, i) => {
    const value = encodeTevStage(stage)[2];
    if (value !== 0) return value;
    if (bpValue(originalRegs, GX.BPRegister.IND_CMD0_ID + i) !== 0) return value;
    const at = TEV_DL.pair + (i >>> 1) * 0x30 + TEV_DL.pairIndCmd + (i & 1) * 0x05;
    const stored = originalDl ? rawBpWriteAt(originalDl, at, GX.BPRegister.IND_CMD0_ID + i) : null;
    return stored === null ? null : value;
  });

  tev.set(writeTevDisplayList({
    swap,
    indRefs: indRefs >>> 0,
    pairs,
    stages: doc.tevStages.map((stage, i) => {
      const [color, alpha] = encodeTevStage(stage);
      return [color, alpha, indCommands[i]] as [number, number, number | null];
    }),
  }, originalDl ?? undefined), TEV_DL_OFFSET);
  return tev;
}

/** True when two TEV blocks would render identically, i.e. a shared shader need not be cloned. */
export function tevBlocksEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    // The index field is the block's own ordinal, not part of the shader.
    if (i >= TEV.index && i < TEV.index + 4) continue;
    if (i >= TEV.mdl0Offset && i < TEV.mdl0Offset + 4) continue;
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export { MAT as MATERIAL_FIELDS, LAYER as LAYER_FIELDS, TEV as TEV_FIELDS };
