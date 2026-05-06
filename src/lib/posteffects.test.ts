import { describe, expect, it } from 'vitest';
import {
  createDefaultBlight,
  createDefaultBblm,
  createDefaultBdof,
  createDefaultBfg,
  parseBlight,
  parseBblm,
  parseBdof,
  parseBfgFogEntries,
  writeBlight,
  writeBblm,
  writeBdof,
  writeBfgFogEntries,
} from './posteffects';

describe('post-effects formats', () => {
  it('round-trips BFG fog entries', () => {
    const source = createDefaultBfg();
    const updated = writeBfgFogEntries(source, [
      { index: 0, fogType: 3, startZ: 1200, endZ: 5600, color: [12, 34, 56], alpha: 0, fadeSpeed: 1.5 },
      { index: 1, fogType: 1, startZ: 0, endZ: 8000, color: [255, 128, 0], alpha: 0, fadeSpeed: 0.25 },
    ]);
    const parsed = parseBfgFogEntries(updated);
    expect(parsed[0]).toMatchObject({ fogType: 3, startZ: 1200, endZ: 5600, color: [12, 34, 56], fadeSpeed: 1.5 });
    expect(parsed[1]).toMatchObject({ fogType: 1, color: [255, 128, 0], fadeSpeed: 0.25 });
  });

  it('round-trips BBLM bloom data', () => {
    const parsed = parseBblm(
      writeBblm(createDefaultBblm(), {
        thresholdAmount: 0.75,
        thresholdColor: [10, 20, 30, 40],
        compositeColor: [90, 100, 110, 120],
        blurFlags: 0x11,
        blur0Radius: 2.5,
        blur0Intensity: 0.4,
        blur1Radius: 6,
        blur1Intensity: 0.9,
        compositeBlendMode: 3,
        blur1NumPasses: 2,
        bokehColorScale0: 1.25,
        bokehColorScale1: 0.75,
      }),
    );
    expect(parsed).toMatchObject({
      thresholdAmount: 0.75,
      thresholdColor: [10, 20, 30, 40],
      compositeColor: [90, 100, 110, 120],
      blurFlags: 0x11,
      blur0Radius: 2.5,
      blur1Radius: 6,
      compositeBlendMode: 3,
      blur1NumPasses: 2,
      bokehColorScale0: 1.25,
      bokehColorScale1: 0.75,
    });
  });

  it('round-trips BDOF focus and blur data', () => {
    const parsed = parseBdof(
      writeBdof(createDefaultBdof(), {
        flags: 0x8000,
        blurAlpha: [32, 196],
        drawMode: 2,
        blurDrawAmount: 1,
        depthCurveType: 4,
        focusCenter: 1800,
        focusRange: 640,
        blurRadius: 3.5,
        indTexTransSScroll: 0.1,
        indTexTransTScroll: -0.2,
        indTexIndScaleS: 1.5,
        indTexIndScaleT: 0.8,
        indTexScaleS: 0.5,
        indTexScaleT: 2,
      }),
    );
    expect(parsed?.flags).toBe(0x8000);
    expect(parsed?.blurAlpha).toEqual([32, 196]);
    expect(parsed?.drawMode).toBe(2);
    expect(parsed?.blurDrawAmount).toBe(1);
    expect(parsed?.depthCurveType).toBe(4);
    expect(parsed?.focusCenter).toBeCloseTo(1800);
    expect(parsed?.focusRange).toBeCloseTo(640);
    expect(parsed?.blurRadius).toBeCloseTo(3.5);
    expect(parsed?.indTexTransSScroll).toBeCloseTo(0.1);
    expect(parsed?.indTexTransTScroll).toBeCloseTo(-0.2);
    expect(parsed?.indTexIndScaleS).toBeCloseTo(1.5);
    expect(parsed?.indTexIndScaleT).toBeCloseTo(0.8);
    expect(parsed?.indTexScaleS).toBeCloseTo(0.5);
    expect(parsed?.indTexScaleT).toBeCloseTo(2);
  });

  it('round-trips BLIGHT ambient and light colors', () => {
    const parsed = parseBlight(
      writeBlight(createDefaultBlight(), {
        ambientBlackColor: [1, 2, 3, 255],
        ambientLights: Array.from({ length: 16 }, (_, index) => [index, index + 1, index + 2, 255] as [number, number, number, number]),
        lightObjects: Array.from({ length: 16 }, (_, index) => ({
          spotFunction: 1,
          distAttnFunction: 2,
          coordinateSystem: 1,
          lightType: 1,
          ambientLightIndex: index,
          flags: 0x0641,
          origin: [index, index + 1, index + 2],
          destination: [index + 3, index + 4, index + 5],
          intensity: 0.5 + index,
          color: [10 + index, 20 + index, 30 + index, 255],
          specColor: [40 + index, 50 + index, 60 + index, 255],
          spotCutoff: 30 + index,
          refDist: 100 + index,
          refBrightness: 0.25 + index,
          linkedLightIndex: index > 0 ? index - 1 : 0,
        })),
      }),
    );
    expect(parsed?.ambientBlackColor).toEqual([1, 2, 3, 255]);
    expect(parsed?.ambientLights[3]).toEqual([3, 4, 5, 255]);
    expect(parsed?.lightObjects[2]).toMatchObject({
      ambientLightIndex: 2,
      flags: 0x0641,
      origin: [2, 3, 4],
      destination: [5, 6, 7],
      color: [12, 22, 32, 255],
      specColor: [42, 52, 62, 255],
      spotCutoff: 32,
      refDist: 102,
      linkedLightIndex: 1,
    });
    expect(parsed?.lightObjects[2].intensity).toBeCloseTo(2.5);
    expect(parsed?.lightObjects[2].refBrightness).toBeCloseTo(2.25);
  });
});
