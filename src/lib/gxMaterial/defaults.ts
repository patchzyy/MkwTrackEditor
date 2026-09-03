// Blank-slate material.
//
// `createDefaultMaterialDoc` is what "New material" starts from: one texture layer, one texgen
// reading TEX0, one lit-off vertex-color channel, and the single TEV stage nearly every Mario
// Kart Wii road material uses — `TEXC * RASC` with `TEXA * RASA` for alpha. The fixed-function
// state matches a stock opaque NW4R material (z test on, write on, blend off, alpha test always).

import * as GX from '../../../vendor/noclip.website/src/gx/gx_enum';
import type {
  GxChannelDoc,
  GxColor,
  GxColorS10,
  GxMaterialDoc,
  GxSamplerDoc,
  GxSwapTableDoc,
  GxTevStageDoc,
  GxTexGenDoc,
  GxTexSrtDoc,
} from './types';

export const WHITE: GxColor = { r: 1, g: 1, b: 1, a: 1 };
export const BLACK: GxColor = { r: 0, g: 0, b: 0, a: 1 };
export const ZERO_S10: GxColorS10 = { r: 0, g: 0, b: 0, a: 0 };

/** The four swap tables GX initialises: RGBA, RRRA, GGGA, BBBA. */
export const DEFAULT_SWAP_TABLES: [GxSwapTableDoc, GxSwapTableDoc, GxSwapTableDoc, GxSwapTableDoc] = [
  [GX.TevColorChan.R, GX.TevColorChan.G, GX.TevColorChan.B, GX.TevColorChan.A],
  [GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.A],
  [GX.TevColorChan.G, GX.TevColorChan.G, GX.TevColorChan.G, GX.TevColorChan.A],
  [GX.TevColorChan.B, GX.TevColorChan.B, GX.TevColorChan.B, GX.TevColorChan.A],
];

export function createDefaultSampler(texture = ''): GxSamplerDoc {
  return {
    texture,
    palette: '',
    wrapS: GX.WrapMode.REPEAT,
    wrapT: GX.WrapMode.REPEAT,
    minFilter: GX.TexFilter.LIN_MIP_LIN,
    magFilter: GX.TexFilter.LINEAR,
    lodBias: -1,
    maxAnisotropy: GX.Anisotropy._1,
    biasClamp: false,
    edgeLod: false,
    mapMode: 'texcoord',
    tlutId: 0,
  };
}

export function createDefaultTexSrt(): GxTexSrtDoc {
  return { scaleS: 1, scaleT: 1, rotation: 0, translateS: 0, translateT: 0, refCamera: -1, refLight: -1 };
}

export function createDefaultTexGen(index: number): GxTexGenDoc {
  return {
    type: GX.TexGenType.MTX2x4,
    source: GX.TexGenSrc.TEX0 + index,
    matrix: GX.TexGenMatrix.IDENTITY,
    normalize: false,
    postMatrix: GX.PostTexGenMatrix.PTTEXMTX0 + index * 3,
  };
}

export function createDefaultChannel(lightingEnabled = false): GxChannelDoc {
  const control = {
    lightingEnabled,
    materialSource: lightingEnabled ? GX.ColorSrc.REG : GX.ColorSrc.VTX,
    ambientSource: GX.ColorSrc.REG,
    litMask: lightingEnabled ? 0xff : 0,
    diffuseFunction: lightingEnabled ? GX.DiffuseFunction.CLAMP : GX.DiffuseFunction.NONE,
    attenuationFunction: lightingEnabled ? GX.AttenuationFunction.SPOT : GX.AttenuationFunction.NONE,
  };
  return { materialColor: { ...WHITE }, ambientColor: { ...BLACK }, color: { ...control }, alpha: { ...control } };
}

/** A TEV stage that does nothing but forward the previous stage's result. */
export function createPassThroughStage(): GxTevStageDoc {
  return {
    colorInA: GX.CC.ZERO,
    colorInB: GX.CC.ZERO,
    colorInC: GX.CC.ZERO,
    colorInD: GX.CC.CPREV,
    colorOp: GX.TevOp.ADD,
    colorBias: GX.TevBias.ZERO,
    colorScale: GX.TevScale.SCALE_1,
    colorClamp: true,
    colorRegId: GX.Register.PREV,

    alphaInA: GX.CA.ZERO,
    alphaInB: GX.CA.ZERO,
    alphaInC: GX.CA.ZERO,
    alphaInD: GX.CA.APREV,
    alphaOp: GX.TevOp.ADD,
    alphaBias: GX.TevBias.ZERO,
    alphaScale: GX.TevScale.SCALE_1,
    alphaClamp: true,
    alphaRegId: GX.Register.PREV,

    texCoordId: GX.TexCoordID.TEXCOORD0,
    texMap: GX.TexMapID.TEXMAP_NULL,
    channelId: GX.RasColorChannelID.COLOR_ZERO,
    konstColorSel: GX.KonstColorSel.KCSEL_1,
    konstAlphaSel: GX.KonstAlphaSel.KASEL_1,
    rasSwapTable: 0,
    texSwapTable: 0,

    indTexStage: GX.IndTexStageID.STAGE0,
    indTexFormat: GX.IndTexFormat._8,
    indTexBiasSel: GX.IndTexBiasSel.NONE,
    indTexAlphaSel: GX.IndTexAlphaSel.OFF,
    indTexMatrix: GX.IndTexMtxID.OFF,
    indTexWrapS: GX.IndTexWrap.OFF,
    indTexWrapT: GX.IndTexWrap.OFF,
    indTexAddPrev: false,
    indTexUseOrigLOD: false,
  };
}

/** `TEXC * RASC`, `TEXA * RASA` on layer 0 — what a stock course material does. */
export function createDefaultStage(): GxTevStageDoc {
  return {
    ...createPassThroughStage(),
    colorInA: GX.CC.ZERO,
    colorInB: GX.CC.TEXC,
    colorInC: GX.CC.RASC,
    colorInD: GX.CC.ZERO,
    alphaInA: GX.CA.ZERO,
    alphaInB: GX.CA.TEXA,
    alphaInC: GX.CA.RASA,
    alphaInD: GX.CA.ZERO,
    texMap: GX.TexMapID.TEXMAP0,
    texCoordId: GX.TexCoordID.TEXCOORD0,
    channelId: GX.RasColorChannelID.COLOR0A0,
  };
}

export function createDefaultMaterialDoc(name: string, samplerCount = 1): GxMaterialDoc {
  const samplers: GxSamplerDoc[] = [];
  const texSrts: GxTexSrtDoc[] = [];
  const texGens: GxTexGenDoc[] = [];
  for (let i = 0; i < samplerCount; i++) {
    samplers.push(createDefaultSampler());
    texSrts.push(createDefaultTexSrt());
    texGens.push(createDefaultTexGen(i));
  }
  return {
    name,
    translucent: false,
    cullMode: GX.CullMode.BACK,
    lightSetIndex: -1,
    fogIndex: -1,
    texMatrixMode: 'maya',
    samplers,
    texSrts,
    texGens,
    channels: [createDefaultChannel(false)],
    colorRegisters: [{ ...ZERO_S10 }, { ...ZERO_S10 }, { ...ZERO_S10 }],
    konstColors: [{ ...WHITE }, { ...WHITE }, { ...WHITE }, { ...WHITE }],
    swapTables: DEFAULT_SWAP_TABLES.map((table) => [...table]) as [GxSwapTableDoc, GxSwapTableDoc, GxSwapTableDoc, GxSwapTableDoc],
    tevStages: [createDefaultStage()],
    indTexStages: [],
    indMatrices: [
      { m: [0, 0, 0, 0, 0, 0], scaleExp: -27 },
      { m: [0, 0, 0, 0, 0, 0], scaleExp: -27 },
      { m: [0, 0, 0, 0, 0, 0], scaleExp: -27 },
    ],
    alphaTest: {
      compareA: GX.CompareType.ALWAYS,
      referenceA: 0,
      op: GX.AlphaOp.AND,
      compareB: GX.CompareType.ALWAYS,
      referenceB: 0,
    },
    blend: {
      mode: GX.BlendMode.NONE,
      srcFactor: GX.BlendFactor.SRCALPHA,
      dstFactor: GX.BlendFactor.INVSRCALPHA,
      logicOp: GX.LogicOp.COPY,
      constantAlphaEnabled: false,
      constantAlpha: 0,
    },
    depth: { test: true, func: GX.CompareType.LEQUAL, write: true, compareBeforeTexture: true },
  };
}
