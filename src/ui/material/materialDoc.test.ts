import { describe, expect, it } from 'vitest';
import { createDefaultMaterialDoc, type GxMaterialDoc } from '../../lib/gxMaterial';
import {
  addLayer,
  colorToRgb255,
  describeShader,
  ensureLayerCount,
  materialDocEquals,
  MAX_SAMPLERS,
  moveLayer,
  patchAlphaTest,
  patchBlend,
  patchChannelControl,
  patchDepth,
  patchIndMatrix,
  patchSampler,
  patchTexGen,
  patchTexSrt,
  registerToRgb255,
  removeLayer,
  rgb255ToColor,
  rgb255ToRegister,
  setColorRegister,
  setIndMatrixCell,
  setKonstColor,
  toggleLitMaskBit,
  withChannelLighting,
} from './materialDoc';

/** Two layers and nothing else the tests below do not set up explicitly. */
function doc(): GxMaterialDoc {
  return addLayer(addLayer(createDefaultMaterialDoc('road', 0), 'asphalt'), 'kerb');
}

describe('colour conversion', () => {
  it('round-trips a 0..1 colour through the 0-255 swatch', () => {
    const original = { r: 0.5, g: 0.25, b: 1, a: 0.75 };
    const rgb = colorToRgb255(original);
    expect(rgb).toEqual([128, 64, 255]);
    const back = rgb255ToColor(rgb, original.a);
    expect(back.r).toBeCloseTo(0.502, 3);
    expect(back.a).toBe(0.75);
  });

  it('clamps an out-of-range colour for display without changing the document', () => {
    expect(colorToRgb255({ r: 2, g: -1, b: 0.5, a: 1 })).toEqual([255, 0, 128]);
    expect(registerToRgb255({ r: 1023, g: -1024, b: 100, a: 0 })).toEqual([255, 0, 100]);
  });

  it('keeps a colour register in its own s10 units', () => {
    expect(rgb255ToRegister([10, 20, 30], 40)).toEqual({ r: 10, g: 20, b: 30, a: 40 });
  });
});

describe('layers', () => {
  it('adds a sampler, an SRT and a texgen together', () => {
    const next = addLayer(createDefaultMaterialDoc('grassy', 0), 'grass');
    expect(next.samplers).toHaveLength(1);
    expect(next.texSrts).toHaveLength(1);
    expect(next.texGens).toHaveLength(1);
    expect(next.samplers[0].texture).toBe('grass');
    expect(next.texSrts[0]).toMatchObject({ scaleS: 1, scaleT: 1, rotation: 0 });
  });

  it('stops at the hardware limit of eight layers', () => {
    let next = createDefaultMaterialDoc('many', 0);
    for (let index = 0; index < 12; index++) next = addLayer(next, `tex${index}`);
    expect(next.samplers).toHaveLength(MAX_SAMPLERS);
  });

  it('tops a material up to a preset\'s layer count', () => {
    expect(ensureLayerCount(createDefaultMaterialDoc('preset', 0), 3, 'grass').samplers).toHaveLength(3);
    // Never removes layers the material already has.
    expect(ensureLayerCount(doc(), 1, 'grass').samplers).toHaveLength(2);
  });

  it('removes a layer\'s sampler, SRT and texgen together', () => {
    const next = removeLayer(doc(), 0);
    expect(next.samplers.map((sampler) => sampler.texture)).toEqual(['kerb']);
    expect(next.texSrts).toHaveLength(1);
    expect(next.texGens).toHaveLength(1);
  });

  it('does nothing when the layer is not there', () => {
    const base = doc();
    expect(removeLayer(base, 9)).toBe(base);
    expect(moveLayer(base, 0, -1)).toBe(base);
    expect(moveLayer(base, 1, 1)).toBe(base);
  });

  it('swaps two layers, keeping their SRTs with them', () => {
    const base = patchTexSrt(doc(), 0, { rotation: 45 });
    const next = moveLayer(base, 0, 1);
    expect(next.samplers.map((sampler) => sampler.texture)).toEqual(['kerb', 'asphalt']);
    expect(next.texSrts[1].rotation).toBe(45);
  });

  it('patches one layer and leaves the others alone', () => {
    const next = patchSampler(doc(), 1, { lodBias: -2.5 });
    expect(next.samplers[1].lodBias).toBe(-2.5);
    expect(next.samplers[0].lodBias).toBe(doc().samplers[0].lodBias);
    expect(patchSampler(doc(), 5, { lodBias: 1 })).toEqual(doc());
  });

  it('patches a texgen', () => {
    expect(patchTexGen(doc(), 0, { normalize: true }).texGens[0].normalize).toBe(true);
  });
});

describe('lighting channels', () => {
  it('patches one half of one channel', () => {
    const base: GxMaterialDoc = {
      ...createDefaultMaterialDoc('lit', 0),
      channels: [
        {
          materialColor: { r: 1, g: 1, b: 1, a: 1 },
          ambientColor: { r: 0, g: 0, b: 0, a: 1 },
          color: { lightingEnabled: false, materialSource: 0 as never, ambientSource: 0 as never, litMask: 0, diffuseFunction: 0 as never, attenuationFunction: 0 as never },
          alpha: { lightingEnabled: false, materialSource: 0 as never, ambientSource: 0 as never, litMask: 0, diffuseFunction: 0 as never, attenuationFunction: 0 as never },
        },
      ],
    };
    const next = patchChannelControl(base, 0, 'color', { lightingEnabled: true });
    expect(next.channels[0].color.lightingEnabled).toBe(true);
    expect(next.channels[0].alpha.lightingEnabled).toBe(false);
    expect(patchChannelControl(base, 3, 'color', { lightingEnabled: true })).toBe(base);
  });

  it('flips one light in the mask', () => {
    expect(toggleLitMaskBit(0, 0, true)).toBe(1);
    expect(toggleLitMaskBit(0b1010, 3, false)).toBe(0b0010);
    expect(toggleLitMaskBit(0b1010, 3, true)).toBe(0b1010);
  });
});

describe('colours on the material', () => {
  it('sets one konst colour and one register', () => {
    const next = setKonstColor(setColorRegister(doc(), 1, { r: 10, g: 20, b: 30, a: 40 }), 2, { r: 1, g: 0, b: 0, a: 1 });
    expect(next.colorRegisters[1]).toEqual({ r: 10, g: 20, b: 30, a: 40 });
    expect(next.konstColors[2]).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(next.colorRegisters[0]).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('ignores a slot the hardware does not have', () => {
    const base = doc();
    expect(setKonstColor(base, 7, { r: 1, g: 1, b: 1, a: 1 })).toBe(base);
    expect(setColorRegister(base, 5, { r: 1, g: 1, b: 1, a: 1 })).toBe(base);
  });
});

describe('state blocks', () => {
  it('patches blend, alpha test and depth independently', () => {
    const base = doc();
    expect(patchBlend(base, { mode: 1 as never }).blend.mode).toBe(1);
    expect(patchAlphaTest(base, { referenceA: 0.5 }).alphaTest.referenceA).toBe(0.5);
    expect(patchDepth(base, { write: false }).depth.write).toBe(false);
    // The others are untouched.
    expect(patchDepth(base, { write: false }).blend).toEqual(base.blend);
  });

  it('edits one cell of an indirect matrix', () => {
    const next = setIndMatrixCell(doc(), 1, 4, 0.5);
    expect(next.indMatrices[1].m[4]).toBe(0.5);
    expect(next.indMatrices[0].m[4]).toBe(doc().indMatrices[0].m[4]);
    // A cell the 2x3 matrix does not have leaves it alone.
    expect(setIndMatrixCell(doc(), 1, 9, 1).indMatrices[1].m).toEqual(doc().indMatrices[1].m);
  });

  it('edits an indirect matrix\'s scale exponent', () => {
    expect(patchIndMatrix(doc(), 2, { scaleExp: 3 }).indMatrices[2].scaleExp).toBe(3);
  });
});

describe('preset lighting', () => {
  it('turns lighting on for channel 0 without touching the alpha half', () => {
    const base = createDefaultMaterialDoc('lit');
    expect(base.channels[0].color.lightingEnabled).toBe(false);
    const next = withChannelLighting(base);
    expect(next.channels[0].color.lightingEnabled).toBe(true);
    expect(next.channels[0].alpha.lightingEnabled).toBe(base.channels[0].alpha.lightingEnabled);
    // Already on, or no channel at all: nothing to do.
    expect(withChannelLighting(next)).toBe(next);
    expect(withChannelLighting(createDefaultMaterialDoc('none', 0))).toBeTruthy();
  });
});

describe('summaries', () => {
  it('describes a shader in words with the right plurals', () => {
    expect(describeShader(1, 1)).toBe('1 stage · 1 texture');
    expect(describeShader(6, 2)).toBe('6 stages · 2 textures');
    expect(describeShader(0, 0)).toBe('0 stages · 0 textures');
  });

  it('compares two documents by value', () => {
    expect(materialDocEquals(doc(), doc())).toBe(true);
    expect(materialDocEquals(doc(), patchSampler(doc(), 0, { lodBias: 1 }))).toBe(false);
  });
});
