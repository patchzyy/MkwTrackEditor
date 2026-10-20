import { describe, expect, it } from 'vitest';
import {
  createDefaultBblm,
  createDefaultBfg,
  createDefaultBlight,
  parseBblm,
  parseBfgFogEntries,
  parseBlight,
  type PostEffectBlightFile,
  type PostEffectBloomFile,
  type PostEffectFogEntry,
} from '../../lib/posteffects';
import { applyColorOp, brightnessOf, withBrightness } from './colorMath';
import {
  bloomStrength,
  distanceToSlider,
  findMainLightIndex,
  formatDistance,
  isFogActive,
  readMainLight,
  setBloomEnabled,
  setBloomStrength,
  setFogDistance,
  setFogEnabled,
  setMainLightColor,
  setMainShadowColor,
  sliderToDistance,
} from './environment';
import { LOOK_PRESETS, applyLookPreset, findLookPreset, lookSwatch, presetSwatch, type LookFiles } from './lookPresets';

function track(): LookFiles {
  const blight = parseBlight(createDefaultBlight()) as PostEffectBlightFile;
  // Light 0 is a GX-only light, light 8 is the first course light (flag 0x20).
  blight.lightObjects[0] = { ...blight.lightObjects[0], flags: 0x641, color: [115, 113, 105, 255] };
  blight.lightObjects[8] = { ...blight.lightObjects[8], flags: 0x621, color: [124, 115, 108, 255], ambientLightIndex: 8 };
  blight.ambientLights[8] = [60, 70, 80, 255];
  const fog = parseBfgFogEntries(createDefaultBfg()).map((entry) => (entry.index === 0 ? { ...entry, fogType: 4, startZ: 45000, endZ: 500000, color: [41, 44, 107] as [number, number, number] } : entry));
  const bloom = parseBblm(createDefaultBblm()) as PostEffectBloomFile;
  return { blight, fog, bloom: [{ ...bloom, blur0Intensity: 0.5, blur1Intensity: 0.08, thresholdAmount: 0.4, compositeColor: [9, 170, 162, 255] }] };
}

describe('colour helpers', () => {
  it('keeps hue when changing brightness and survives black', () => {
    expect(brightnessOf([124, 115, 108])).toBeCloseTo(124 / 255);
    const dimmer = withBrightness([200, 100, 50], 0.5);
    expect(Math.abs(dimmer[0] - 128)).toBeLessThanOrEqual(1);
    expect(dimmer[1] / dimmer[0]).toBeCloseTo(0.5, 1);
    expect(withBrightness([0, 0, 0], 0.5)).toEqual([128, 128, 128]);
  });

  it('an empty colour op changes nothing, and results stay in range', () => {
    expect(applyColorOp([10, 20, 30], {})).toEqual([10, 20, 30]);
    const hot = applyColorOp([250, 250, 250], { gain: 3 });
    expect(hot).toEqual([255, 255, 255]);
    const grey = applyColorOp([200, 50, 50], { saturation: 0 });
    expect(grey[0]).toBe(grey[1]);
  });
});

describe('main light mapping', () => {
  it('picks the first enabled course light, not the first light', () => {
    const files = track();
    expect(findMainLightIndex(files.blight)).toBe(8);
    const main = readMainLight(files.blight);
    expect(main?.color).toEqual([124, 115, 108]);
    expect(main?.shadow).toEqual([60, 70, 80]);
  });

  it('falls back to the first enabled light when no light is a course light', () => {
    const files = track();
    const blight = { ...files.blight!, lightObjects: files.blight!.lightObjects.map((light) => ({ ...light, flags: light.flags & ~0x20 })) };
    expect(findMainLightIndex(blight)).toBe(0);
  });

  it('edits only the main light and its own shadow colour, keeping alpha', () => {
    const files = track();
    const lit = setMainLightColor(files.blight!, [10, 20, 30]);
    expect(lit.lightObjects[8].color).toEqual([10, 20, 30, 255]);
    expect(lit.lightObjects[0].color).toEqual(files.blight!.lightObjects[0].color);
    const shaded = setMainShadowColor(lit, [1, 2, 3]);
    expect(shaded.ambientLights[8]).toEqual([1, 2, 3, 255]);
    expect(shaded.ambientLights[0]).toEqual(files.blight!.ambientLights[0]);
  });

  it('reports nothing for a track without lighting', () => {
    expect(readMainLight(null)).toBeNull();
  });
});

describe('fog mapping', () => {
  it('turning fog off keeps the band and turning it on restores it', () => {
    const fog = track().fog as PostEffectFogEntry[];
    const off = setFogEnabled(fog, false);
    expect(off[0].fogType).toBe(0);
    expect(isFogActive(off[0])).toBe(false);
    const back = setFogEnabled(off, true, 4);
    expect(back[0]).toMatchObject({ fogType: 4, startZ: 45000, endZ: 500000 });
  });

  it('turning fog on for a blank entry gives a usable default band', () => {
    const blank = parseBfgFogEntries(createDefaultBfg());
    const on = setFogEnabled(blank, true);
    expect(isFogActive(on[0])).toBe(true);
  });

  it('keeps "fully foggy" beyond "starts at" whichever end moves', () => {
    const fog = track().fog as PostEffectFogEntry[];
    const pushed = setFogDistance(fog, 'start', 600000);
    expect(pushed[0].endZ).toBeGreaterThan(pushed[0].startZ);
    const pulled = setFogDistance(fog, 'end', 10000);
    expect(pulled[0].startZ).toBeLessThan(pulled[0].endZ);
    expect(isFogActive(pulled[0])).toBe(true);
  });

  it('slider positions round trip and read as short distances', () => {
    expect(sliderToDistance(0)).toBe(0);
    expect(sliderToDistance(1)).toBe(600000);
    expect(distanceToSlider(sliderToDistance(0.5))).toBeCloseTo(0.5, 2);
    expect(formatDistance(45000)).toBe('45k');
    expect(formatDistance(500)).toBe('500');
  });
});

describe('glow mapping', () => {
  it('strength scales both blurs in the track own proportion', () => {
    const file = track().bloom[0];
    const doubled = setBloomStrength(file, 0.25);
    expect(bloomStrength(doubled)).toBe(0.25);
    expect(doubled.blur1Intensity / doubled.blur0Intensity).toBeCloseTo(file.blur1Intensity / file.blur0Intensity);
  });

  it('off writes zero and on brings the old strength back', () => {
    const file = track().bloom[0];
    const off = setBloomEnabled(file, false, file);
    expect(off.blur0Intensity).toBe(0);
    expect(setBloomEnabled(off, true, file).blur0Intensity).toBe(0.5);
  });
});

describe('look presets', () => {
  it('Original returns the very same files', () => {
    const files = track();
    expect(applyLookPreset(findLookPreset('original'), files)).toBe(files);
  });

  it('never modifies the files it is given', () => {
    const files = track();
    const copy = JSON.stringify(files);
    for (const preset of LOOK_PRESETS) applyLookPreset(preset, files);
    expect(JSON.stringify(files)).toBe(copy);
  });

  it('is applied to the original each time, so presets do not stack', () => {
    const files = track();
    const once = applyLookPreset(findLookPreset('night'), files);
    const again = applyLookPreset(findLookPreset('night'), files);
    expect(again).toEqual(once);
  });

  it('Night is darker and bluer; Golden hour is warmer', () => {
    const files = track();
    const base = lookSwatch(files).sun;
    const night = lookSwatch(applyLookPreset(findLookPreset('night'), files)).sun;
    expect(brightnessOf(night)).toBeLessThan(brightnessOf(base));
    expect(night[2]).toBeGreaterThan(night[0]);
    const gold = lookSwatch(applyLookPreset(findLookPreset('golden'), files)).sun;
    expect(gold[0] - gold[2]).toBeGreaterThan(base[0] - base[2]);
  });

  it('keeps every colour in range and every light alpha as it was', () => {
    const files = track();
    for (const preset of LOOK_PRESETS) {
      const out = applyLookPreset(preset, files);
      for (const light of out.blight!.lightObjects) for (const channel of light.color) expect(channel >= 0 && channel <= 255).toBe(true);
      expect(out.blight!.lightObjects[8].color[3]).toBe(255);
      for (const file of out.bloom) {
        expect(file.blur0Intensity).toBeGreaterThanOrEqual(0);
        expect(file.blur0Intensity).toBeLessThanOrEqual(1);
        expect(file.thresholdAmount).toBeGreaterThanOrEqual(0);
        expect(file.thresholdAmount).toBeLessThanOrEqual(1);
      }
      for (const entry of out.fog ?? []) if (isFogActive(entry)) expect(entry.endZ).toBeGreaterThan(entry.startZ);
    }
  });

  it('only touches lights that are switched on and shadow colours they point at', () => {
    const files = track();
    const out = applyLookPreset(findLookPreset('vivid'), files);
    expect(out.blight!.lightObjects[3]).toEqual(files.blight!.lightObjects[3]);
    expect(out.blight!.ambientLights[12]).toEqual(files.blight!.ambientLights[12]);
    expect(out.blight!.ambientLights[8]).not.toEqual(files.blight!.ambientLights[8]);
  });

  it('Misty brings fog closer, and adds fog to a track that has none', () => {
    const files = track();
    const misty = applyLookPreset(findLookPreset('misty'), files);
    expect(misty.fog![0].startZ).toBeLessThan(files.fog![0].startZ);

    const fogless: LookFiles = { ...files, fog: null };
    const added = applyLookPreset(findLookPreset('misty'), fogless);
    expect(added.fog).not.toBeNull();
    expect(isFogActive(added.fog![0])).toBe(true);
    // Looks that do not need fog leave a fogless track alone.
    expect(applyLookPreset(findLookPreset('golden'), fogless).fog).toBeNull();
  });

  it('leaves a track without glow or lighting without them', () => {
    const empty: LookFiles = { blight: null, fog: null, bloom: [] };
    const out = applyLookPreset(findLookPreset('vivid'), empty);
    expect(out).toEqual(empty);
  });

  it('every chip has a three-colour swatch', () => {
    const files = track();
    for (const preset of LOOK_PRESETS) {
      const swatch = presetSwatch(preset, files);
      expect(swatch.sun).toHaveLength(3);
      expect(swatch.fog).not.toBeNull();
    }
  });
});
