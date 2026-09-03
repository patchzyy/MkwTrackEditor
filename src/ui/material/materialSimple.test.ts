// The simple view's mappings, and the property that matters most about them: reading a value and
// writing it straight back is the identity, so opening a retail material in the friendly
// inspector and closing it again changes nothing.
//
// `materialSimple.byteExact.test.ts` proves the same thing one level down, through `applyMaterial`
// against real archives. This file is the cheap, always-runs half.

import { describe, expect, it } from 'vitest';
import * as GX from '../../../vendor/noclip.website/src/gx/gx_enum';
import { createDefaultMaterialDoc, createDefaultStage, type GxMaterialDoc, type GxTevStageDoc } from '../../lib/gxMaterial';
import { addLayer } from './materialDoc';
import {
  alphaTestPassesEverything,
  countLitLights,
  DEFAULT_CUTOUT_THRESHOLD,
  describeMaterial,
  describeStages,
  getCutoutThreshold,
  getLayerFilter,
  getLayerWrap,
  getShadingMode,
  getTransparencyMode,
  getWritesDepth,
  isEnvironmentMapped,
  isTwoSided,
  konstAlphaSlot,
  konstColorSlot,
  setCutoutThreshold,
  setEnvironmentMapped,
  setLayerFilter,
  setLayerWrap,
  setShadingMode,
  setTransparencyMode,
  setTwoSided,
  setWritesDepth,
  usedColorRegisters,
  usedKonstColors,
  usesMaterialColor,
  wrapChoiceOf,
  wrapModeOf,
  type TransparencyMode,
} from './materialSimple';

function doc(): GxMaterialDoc {
  return addLayer(createDefaultMaterialDoc('road', 0), 'asphalt');
}

function stage(patch: Partial<GxTevStageDoc>): GxTevStageDoc {
  return { ...createDefaultStage(0), ...patch };
}

// ---------------------------------------------------------------------------- transparency

describe('the alpha test', () => {
  it('recognises the "let everything through" spellings', () => {
    expect(alphaTestPassesEverything({ compareA: GX.CompareType.ALWAYS, referenceA: 0, op: GX.AlphaOp.AND, compareB: GX.CompareType.ALWAYS, referenceB: 0 })).toBe(true);
    // GEQUAL 0 passes every alpha too, and retail content really does write it.
    expect(alphaTestPassesEverything({ compareA: GX.CompareType.GEQUAL, referenceA: 0, op: GX.AlphaOp.AND, compareB: GX.CompareType.ALWAYS, referenceB: 0 })).toBe(true);
    // So does "or" with one half always true, whatever the other half says.
    expect(alphaTestPassesEverything({ compareA: GX.CompareType.NEVER, referenceA: 0.5, op: GX.AlphaOp.OR, compareB: GX.CompareType.ALWAYS, referenceB: 0 })).toBe(true);
  });

  it('recognises a test that discards something', () => {
    expect(alphaTestPassesEverything({ compareA: GX.CompareType.GEQUAL, referenceA: 0.5, op: GX.AlphaOp.AND, compareB: GX.CompareType.ALWAYS, referenceB: 0 })).toBe(false);
    expect(alphaTestPassesEverything({ compareA: GX.CompareType.NEVER, referenceA: 0, op: GX.AlphaOp.AND, compareB: GX.CompareType.ALWAYS, referenceB: 0 })).toBe(false);
  });
});

describe('transparency', () => {
  it('reads a stock material as opaque', () => {
    expect(getTransparencyMode(doc())).toBe('opaque');
  });

  it('reads a blending material as transparent, even when it also alpha-tests', () => {
    const blended = { ...doc(), blend: { ...doc().blend, mode: GX.BlendMode.BLEND } };
    expect(getTransparencyMode(blended)).toBe('transparent');
    const both = { ...blended, alphaTest: { ...blended.alphaTest, compareA: GX.CompareType.GEQUAL, referenceA: 0.5 } };
    expect(getTransparencyMode(both)).toBe('transparent');
  });

  it('reads a material whose alpha test discards as cutout', () => {
    const cut = { ...doc(), alphaTest: { ...doc().alphaTest, compareA: GX.CompareType.GEQUAL, referenceA: 0.5 } };
    expect(getTransparencyMode(cut)).toBe('cutout');
  });

  it.each<TransparencyMode>(['opaque', 'cutout', 'transparent'])('sets %s and reads it back', (mode) => {
    const next = setTransparencyMode(doc(), mode);
    expect(getTransparencyMode(next)).toBe(mode);
  });

  it('sets the blend mode, the alpha test and the draw pass together', () => {
    const transparent = setTransparencyMode(doc(), 'transparent');
    expect(transparent.blend.mode).toBe(GX.BlendMode.BLEND);
    expect(transparent.blend.srcFactor).toBe(GX.BlendFactor.SRCALPHA);
    expect(transparent.blend.dstFactor).toBe(GX.BlendFactor.INVSRCALPHA);
    expect(transparent.translucent).toBe(true);
    expect(alphaTestPassesEverything(transparent.alphaTest)).toBe(true);

    const cutout = setTransparencyMode(transparent, 'cutout');
    expect(cutout.blend.mode).toBe(GX.BlendMode.NONE);
    expect(cutout.translucent).toBe(false);
    expect(cutout.alphaTest.compareA).toBe(GX.CompareType.GEQUAL);
    expect(cutout.alphaTest.referenceA).toBe(DEFAULT_CUTOUT_THRESHOLD);
  });

  it('touches nothing but blending, the alpha test and the draw pass', () => {
    const before = setTransparencyMode(doc(), 'cutout');
    const after = setTransparencyMode(before, 'transparent');
    expect(after.depth).toBe(before.depth);
    expect(after.cullMode).toBe(before.cullMode);
    expect(after.samplers).toBe(before.samplers);
    expect(after.tevStages).toBe(before.tevStages);
    expect(after.channels).toBe(before.channels);
  });

  it('keeps the blend factors a material was authored with', () => {
    const odd = { ...doc(), blend: { ...doc().blend, mode: GX.BlendMode.BLEND, srcFactor: GX.BlendFactor.ONE, dstFactor: GX.BlendFactor.ONE } };
    // Round-tripping through cutout and back would clobber them, but re-selecting "transparent"
    // on a material that already blends must not.
    expect(setTransparencyMode(odd, 'transparent')).toBe(odd);
  });

  it('moves only the first reference when the threshold changes', () => {
    const cut = setTransparencyMode(doc(), 'cutout');
    const raised = setCutoutThreshold(cut, 0.8);
    expect(getCutoutThreshold(raised)).toBeCloseTo(0.8);
    expect(raised.alphaTest.compareA).toBe(cut.alphaTest.compareA);
    expect(raised.alphaTest.compareB).toBe(cut.alphaTest.compareB);
    expect(raised.alphaTest.op).toBe(cut.alphaTest.op);
  });

  it('clamps the threshold to 0..1', () => {
    const cut = setTransparencyMode(doc(), 'cutout');
    expect(setCutoutThreshold(cut, 4).alphaTest.referenceA).toBe(1);
    expect(setCutoutThreshold(cut, -4).alphaTest.referenceA).toBe(0);
  });
});

// ---------------------------------------------------------------------------- layers

describe('wrapping', () => {
  it('maps every mode both ways', () => {
    for (const mode of [GX.WrapMode.CLAMP, GX.WrapMode.REPEAT, GX.WrapMode.MIRROR]) {
      expect(wrapModeOf(wrapChoiceOf(mode))).toBe(mode);
    }
  });

  it('reports no single choice when the two axes disagree', () => {
    const mixed = doc();
    mixed.samplers[0] = { ...mixed.samplers[0], wrapS: GX.WrapMode.REPEAT, wrapT: GX.WrapMode.CLAMP };
    expect(getLayerWrap(mixed.samplers[0])).toBeNull();
    const fixed = setLayerWrap(mixed, 0, 'mirror');
    expect(fixed.samplers[0].wrapS).toBe(GX.WrapMode.MIRROR);
    expect(fixed.samplers[0].wrapT).toBe(GX.WrapMode.MIRROR);
  });
});

describe('filtering', () => {
  it('reads the magnification filter', () => {
    const base = doc();
    expect(getLayerFilter(base.samplers[0])).toBe('smooth');
    base.samplers[0] = { ...base.samplers[0], magFilter: GX.TexFilter.NEAR };
    expect(getLayerFilter(base.samplers[0])).toBe('pixelated');
  });

  it('keeps the mip chain when it switches', () => {
    // The stock sampler is trilinear, i.e. it reads its mips.
    const pixelated = setLayerFilter(doc(), 0, 'pixelated');
    expect(pixelated.samplers[0].magFilter).toBe(GX.TexFilter.NEAR);
    expect(pixelated.samplers[0].minFilter).toBe(GX.TexFilter.NEAR_MIP_NEAR);
    expect(setLayerFilter(pixelated, 0, 'smooth').samplers[0].minFilter).toBe(GX.TexFilter.LIN_MIP_LIN);
  });

  it('leaves a mipless layer mipless', () => {
    const flat = doc();
    flat.samplers[0] = { ...flat.samplers[0], minFilter: GX.TexFilter.LINEAR, magFilter: GX.TexFilter.LINEAR };
    const pixelated = setLayerFilter(flat, 0, 'pixelated');
    expect(pixelated.samplers[0].minFilter).toBe(GX.TexFilter.NEAR);
  });
});

describe('environment mapping', () => {
  it('is off for a layer on the mesh\'s own UVs', () => {
    expect(isEnvironmentMapped(doc().samplers[0])).toBe(false);
  });

  it('turns the layer into a camera reflection and back', () => {
    const on = setEnvironmentMapped(doc(), 0, true);
    expect(on.samplers[0].mapMode).toBe('envCamera');
    expect(setEnvironmentMapped(on, 0, false).samplers[0].mapMode).toBe('texcoord');
  });

  it('leaves the other generated modes alone', () => {
    const projected = doc();
    projected.samplers[0] = { ...projected.samplers[0], mapMode: 'projection' };
    expect(isEnvironmentMapped(projected.samplers[0])).toBe(true);
    // Already "on": the switch must not rewrite it to envCamera.
    expect(setEnvironmentMapped(projected, 0, true)).toBe(projected);
  });
});

// ---------------------------------------------------------------------------- shading

describe('shading', () => {
  it('reads the stock vertex-coloured channel', () => {
    // `createDefaultMaterialDoc` builds the unlit vertex-colour channel every road material uses.
    const base = doc();
    expect(getShadingMode(base)).toBe(base.channels[0].color.materialSource === GX.ColorSrc.VTX ? 'vertex' : 'unlit');
  });

  it.each(['lit', 'vertex', 'unlit'] as const)('sets %s and reads it back', (mode) => {
    expect(getShadingMode(setShadingMode(doc(), mode))).toBe(mode);
  });

  it('writes the switch and the source, and nothing else', () => {
    const base = doc();
    const unlit = setShadingMode(base, 'unlit');
    expect(unlit.channels[0].color.lightingEnabled).toBe(false);
    expect(unlit.channels[0].color.materialSource).toBe(GX.ColorSrc.REG);
    expect(unlit.channels[0].alpha).toBe(base.channels[0].alpha);
    expect(unlit.channels[0].color.litMask).toBe(base.channels[0].color.litMask);
    expect(unlit.samplers).toBe(base.samplers);
  });

  it('leaves the sources alone when it only switches lighting on', () => {
    const vertex = setShadingMode(doc(), 'vertex');
    const lit = setShadingMode(vertex, 'lit');
    expect(lit.channels[0].color.materialSource).toBe(vertex.channels[0].color.materialSource);
  });

  it('says whether the material colour swatch means anything', () => {
    expect(usesMaterialColor(setShadingMode(doc(), 'unlit'))).toBe(true);
    expect(usesMaterialColor(setShadingMode(doc(), 'vertex'))).toBe(false);
  });

  it('counts the lights a channel can see', () => {
    const base = doc();
    base.channels[0] = { ...base.channels[0], color: { ...base.channels[0].color, litMask: 0b1010_0001 } };
    expect(countLitLights(base)).toBe(3);
  });

  it('falls back to unlit when the material has no channels', () => {
    const none = { ...doc(), channels: [] };
    expect(getShadingMode(none)).toBe('unlit');
    expect(setShadingMode(none, 'lit')).toBe(none);
  });
});

// ---------------------------------------------------------------------------- sides and depth

describe('sides and depth', () => {
  it('reads and writes two-sidedness', () => {
    const base = { ...doc(), cullMode: GX.CullMode.BACK };
    expect(isTwoSided(base)).toBe(false);
    const both = setTwoSided(base, true);
    expect(both.cullMode).toBe(GX.CullMode.NONE);
    expect(setTwoSided(both, false).cullMode).toBe(GX.CullMode.BACK);
  });

  it('rescues a material set to draw nothing', () => {
    const invisible = { ...doc(), cullMode: GX.CullMode.ALL };
    expect(isTwoSided(invisible)).toBe(false);
    expect(setTwoSided(invisible, true).cullMode).toBe(GX.CullMode.NONE);
  });

  it('reads and writes the depth write flag on its own', () => {
    const base = doc();
    expect(getWritesDepth(base)).toBe(base.depth.write);
    const off = setWritesDepth(base, false);
    expect(off.depth.write).toBe(false);
    expect(off.depth.func).toBe(base.depth.func);
    expect(off.depth.test).toBe(base.depth.test);
    expect(off.blend).toBe(base.blend);
  });
});

// ---------------------------------------------------------------------------- colours in use

describe('which colours the shader reads', () => {
  it('maps a konst selection to its slot', () => {
    expect(konstColorSlot(GX.KonstColorSel.KCSEL_K2)).toBe(2);
    expect(konstColorSlot(GX.KonstColorSel.KCSEL_K1_G)).toBe(1);
    expect(konstColorSlot(GX.KonstColorSel.KCSEL_4_8)).toBe(-1);
    expect(konstAlphaSlot(GX.KonstAlphaSel.KASEL_K3_A)).toBe(3);
    expect(konstAlphaSlot(GX.KonstAlphaSel.KASEL_1_8)).toBe(-1);
  });

  it('ignores the konst selection a stage names but never reads', () => {
    // Every stage stores a selection. Only a stage with a KONST *input* actually uses one.
    const namesOnly = stage({ konstColorSel: GX.KonstColorSel.KCSEL_K1, konstAlphaSel: GX.KonstAlphaSel.KASEL_K1_A });
    expect(usedKonstColors([namesOnly])).toEqual([]);
  });

  it('finds the konst colours a stage really samples, and where', () => {
    const tint = stage({ colorInC: GX.CC.KONST, konstColorSel: GX.KonstColorSel.KCSEL_K1 });
    const fade = stage({ alphaInB: GX.CA.KONST, konstAlphaSel: GX.KonstAlphaSel.KASEL_K3_A });
    expect(usedKonstColors([tint, fade])).toEqual([
      { slot: 1, stages: [1] },
      { slot: 3, stages: [2] },
    ]);
  });

  it('ignores a register a stage overwrites before anything reads it', () => {
    const writes = stage({ colorRegId: GX.Register.REG0 });
    const reads = stage({ colorInA: GX.CC.C0 });
    expect(usedColorRegisters([writes, reads])).toEqual([]);
    // The other way round, the start value is what stage 1 sees.
    expect(usedColorRegisters([reads, writes])).toEqual([{ slot: 0, stages: [1] }]);
  });

  it('counts a register read by the same stage that writes it', () => {
    // A stage reads its inputs before it writes its output, so C1 here is the stored start value.
    const accumulate = stage({ colorInD: GX.CC.C1, colorRegId: GX.Register.REG1 });
    expect(usedColorRegisters([accumulate])).toEqual([{ slot: 1, stages: [1] }]);
  });

  it('finds an alpha-only register read', () => {
    expect(usedColorRegisters([stage({ alphaInA: GX.CA.A2 })])).toEqual([{ slot: 2, stages: [1] }]);
  });
});

describe('wording', () => {
  it('lists the stages that read a colour', () => {
    expect(describeStages([])).toBe('no stage');
    expect(describeStages([2])).toBe('stage 2');
    expect(describeStages([1, 3])).toBe('stages 1 and 3');
    expect(describeStages([1, 2, 4])).toBe('stages 1, 2 and 4');
  });

  it('summarises a material in one line, with no jargon', () => {
    const line = describeMaterial(setTwoSided(setTransparencyMode(doc(), 'cutout'), true));
    expect(line).toContain('Cut out');
    expect(line).toContain('1 texture');
    expect(line).toContain('two-sided');
    for (const jargon of ['GX', 'TEV', 'KCSEL', 'cull', 'BlendMode']) expect(line).not.toContain(jargon);
  });
});

// ---------------------------------------------------------------------------- the identity law

describe('reading and writing back changes nothing', () => {
  /** A spread of documents that between them exercise every branch of every getter. */
  function samples(): GxMaterialDoc[] {
    const base = doc();
    const twoLayer = addLayer(base, 'kerb');
    const cutout = setTransparencyMode(base, 'cutout');
    const blended = setTransparencyMode(base, 'transparent');
    const odd = {
      ...twoLayer,
      cullMode: GX.CullMode.FRONT,
      depth: { ...base.depth, write: false, func: GX.CompareType.GREATER },
      blend: { ...base.blend, mode: GX.BlendMode.SUBTRACT },
      alphaTest: { compareA: GX.CompareType.LESS, referenceA: 0.25, op: GX.AlphaOp.OR, compareB: GX.CompareType.GREATER, referenceB: 0.75 },
    };
    odd.samplers[0] = { ...odd.samplers[0], wrapS: GX.WrapMode.CLAMP, wrapT: GX.WrapMode.MIRROR, magFilter: GX.TexFilter.NEAR, minFilter: GX.TexFilter.NEAR, mapMode: 'envSpec' };
    return [base, twoLayer, cutout, blended, setShadingMode(base, 'lit'), setShadingMode(base, 'unlit'), odd];
  }

  it('is the identity for every simple control', () => {
    for (const sample of samples()) {
      expect(setTransparencyMode(sample, getTransparencyMode(sample))).toBe(sample);
      expect(setCutoutThreshold(sample, sample.alphaTest.referenceA)).toBe(sample);
      expect(setTwoSided(sample, isTwoSided(sample))).toBe(sample);
      expect(setWritesDepth(sample, getWritesDepth(sample))).toBe(sample);
      expect(setShadingMode(sample, getShadingMode(sample))).toBe(sample);
      sample.samplers.forEach((sampler, index) => {
        const wrap = getLayerWrap(sampler);
        if (wrap !== null) expect(setLayerWrap(sample, index, wrap)).toBe(sample);
        expect(setLayerFilter(sample, index, getLayerFilter(sampler))).toBe(sample);
        expect(setEnvironmentMapped(sample, index, isEnvironmentMapped(sampler))).toBe(sample);
      });
    }
  });
});
