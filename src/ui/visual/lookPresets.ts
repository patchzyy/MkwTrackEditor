// One-click looks for the Environment panel. A preset never stamps fixed values over a track: it
// is a relative change of the track's OWN sunlight, shadow, fog and glow as they were loaded, so
// the art direction (a green jungle stays a green jungle) survives. Presets are always applied to
// the original files, never stacked on each other, so picking Golden hour after Vivid gives
// Golden hour, not both. "Original" is the identity and restores the files as they were.
import type { PostEffectBlightFile, PostEffectBloomFile, PostEffectFogEntry, RgbColor } from '../../lib/posteffects';
import { applyColorOp, clampColor, type ColorOp } from './colorMath';
import {
  FOG_DEFAULT_END,
  FOG_DEFAULT_START,
  FOG_MAX_DISTANCE,
  MAIN_FOG_INDEX,
  isFogActive,
  isLightEnabled,
  readMainLight,
} from './environment';

/** The parsed posteffect files a look works on. Absent files are `null` / empty. */
export interface LookFiles {
  blight: PostEffectBlightFile | null;
  /** All four fog presets of `posteffect.bfg`. */
  fog: PostEffectFogEntry[] | null;
  /** Every `posteffect.bblm*` file, whatever its index. */
  bloom: PostEffectBloomFile[];
}

export type LookPresetId = 'original' | 'vivid' | 'golden' | 'overcast' | 'misty' | 'night';

export interface FogLook {
  color?: ColorOp;
  /** Multiplies "starts at" (below 1 brings the fog closer). */
  startScale?: number;
  /** Multiplies "fully foggy at". */
  endScale?: number;
  /** A look that needs fog (Misty) adds this when the track has none. */
  add?: { color: RgbColor; startZ: number; endZ: number };
}

export interface BloomLook {
  /** Multiplies the glow strength (a track with no glow stays without). */
  strengthScale?: number;
  /** Added to "what glows" (negative lets more of the picture glow). */
  thresholdDelta?: number;
  color?: ColorOp;
}

export interface LookPreset {
  id: LookPresetId;
  label: string;
  /** Tooltip: what the look does to the track. */
  hint: string;
  sun: ColorOp;
  shadow: ColorOp;
  fog: FogLook;
  bloom: BloomLook;
}

export const LOOK_PRESETS: readonly LookPreset[] = [
  {
    id: 'original',
    label: 'Original',
    hint: 'The look the track had when you opened it.',
    sun: {},
    shadow: {},
    fog: {},
    bloom: {},
  },
  {
    id: 'vivid',
    label: 'Vivid',
    hint: 'Richer colours and a clearer view: more saturated light, fog pushed further away, a little more glow.',
    sun: { saturation: 1.35, gain: 1.08 },
    shadow: { saturation: 1.3 },
    fog: { color: { saturation: 1.3 }, startScale: 1.3, endScale: 1.1 },
    bloom: { strengthScale: 1.25, thresholdDelta: -0.05 },
  },
  {
    id: 'golden',
    label: 'Golden hour',
    hint: 'Warm low sun: amber light, warm shadows, a peach haze and a soft glow.',
    sun: { tint: [1.15, 0.96, 0.7], gain: 1.1 },
    shadow: { tint: [1.08, 0.92, 0.82] },
    fog: { color: { mix: { toward: [255, 190, 120], amount: 0.35 } } },
    bloom: { strengthScale: 1.3, thresholdDelta: -0.05, color: { mix: { toward: [255, 190, 110], amount: 0.4 } } },
  },
  {
    id: 'overcast',
    label: 'Overcast',
    hint: 'Flat grey daylight: washed-out colour, softer sun, shadows lifted, less glow.',
    sun: { saturation: 0.6, gain: 0.85 },
    shadow: { saturation: 0.7, gain: 1.12 },
    fog: { color: { mix: { toward: [190, 196, 205], amount: 0.4 } }, startScale: 0.7 },
    bloom: { strengthScale: 0.6 },
  },
  {
    id: 'misty',
    label: 'Misty',
    hint: 'Thick pale fog close to the camera, softer light and a gentle glow. Adds fog if the track has none.',
    sun: { saturation: 0.85, gain: 0.92 },
    shadow: { saturation: 0.9, gain: 1.05 },
    fog: {
      color: { mix: { toward: [200, 215, 230], amount: 0.5 } },
      startScale: 0.35,
      endScale: 0.6,
      add: { color: [200, 215, 230], startZ: 12000, endZ: 160000 },
    },
    bloom: { strengthScale: 1.2, thresholdDelta: -0.1 },
  },
  {
    id: 'night',
    label: 'Night',
    hint: 'Cool moonlight: dim blue light and shadows, dark blue fog, stronger glow around bright lights.',
    sun: { tint: [0.45, 0.58, 1], gain: 0.55, saturation: 0.85 },
    shadow: { tint: [0.55, 0.65, 1.1], gain: 0.75 },
    fog: { color: { mix: { toward: [14, 20, 48], amount: 0.6 } }, startScale: 0.8 },
    bloom: { strengthScale: 1.6, thresholdDelta: -0.1, color: { tint: [0.6, 0.75, 1.2] } },
  },
];

export function findLookPreset(id: LookPresetId): LookPreset {
  return LOOK_PRESETS.find((preset) => preset.id === id) ?? LOOK_PRESETS[0];
}

function opColor(color: readonly number[], op: ColorOp | undefined): [number, number, number, number] {
  const next = applyColorOp(color, op);
  return [next[0], next[1], next[2], color[3] ?? 255];
}

function transformBlight(blight: PostEffectBlightFile, preset: LookPreset): PostEffectBlightFile {
  // Only the ambient colours an enabled light actually points at are touched, so the file does
  // not fill up with edited colours nothing uses.
  const usedAmbient = new Set<number>();
  for (const light of blight.lightObjects) if (isLightEnabled(light)) usedAmbient.add(light.ambientLightIndex);
  return {
    ...blight,
    lightObjects: blight.lightObjects.map((light) =>
      isLightEnabled(light) ? { ...light, color: opColor(light.color, preset.sun) } : light,
    ),
    ambientLights: blight.ambientLights.map((ambient, index) => (usedAmbient.has(index) ? opColor(ambient, preset.shadow) : ambient)),
  };
}

function transformFog(entries: PostEffectFogEntry[] | null, preset: LookPreset): PostEffectFogEntry[] | null {
  const look = preset.fog;
  if (!entries && !look.add) return null;
  // A track with no fog file gets a blank one when the look needs fog.
  const source = entries ?? Array.from({ length: 4 }, (_, index) => ({ index, fogType: 0, startZ: 0, endZ: 0, color: [255, 255, 255] as RgbColor, alpha: 0, fadeSpeed: 0 }));
  let touched = source.map((entry) => {
    if (!isFogActive(entry)) return entry;
    const startZ = Math.min(FOG_MAX_DISTANCE, Math.round(entry.startZ * (look.startScale ?? 1)));
    const endZ = Math.min(FOG_MAX_DISTANCE, Math.round(entry.endZ * (look.endScale ?? 1)));
    return {
      ...entry,
      color: clampColor(applyColorOp(entry.color, look.color)),
      startZ,
      // A fog band that collapses would read as "no fog", which is not what a scale means.
      endZ: Math.max(endZ, startZ + 1000),
    };
  });
  const main = touched.find((entry) => entry.index === MAIN_FOG_INDEX);
  if (look.add && !isFogActive(main)) {
    touched = touched.map((entry) =>
      entry.index === MAIN_FOG_INDEX
        ? { ...entry, fogType: 1, startZ: look.add?.startZ ?? FOG_DEFAULT_START, endZ: look.add?.endZ ?? FOG_DEFAULT_END, color: [...look.add!.color] as RgbColor }
        : entry,
    );
  }
  return touched;
}

function transformBloom(file: PostEffectBloomFile, preset: LookPreset): PostEffectBloomFile {
  const look = preset.bloom;
  const scale = look.strengthScale ?? 1;
  const color = opColor(file.compositeColor, look.color);
  return {
    ...file,
    blur0Intensity: Math.max(0, Math.min(1, file.blur0Intensity * scale)),
    blur1Intensity: Math.max(0, Math.min(1, file.blur1Intensity * scale)),
    thresholdAmount: Math.max(0, Math.min(1, file.thresholdAmount + (look.thresholdDelta ?? 0))),
    compositeColor: color,
  };
}

/** The files after the look. The input is never modified. */
export function applyLookPreset(preset: LookPreset, original: LookFiles): LookFiles {
  if (preset.id === 'original') return original;
  return {
    blight: original.blight ? transformBlight(original.blight, preset) : null,
    fog: transformFog(original.fog, preset),
    bloom: original.bloom.map((file) => transformBloom(file, preset)),
  };
}

/** The three colours a look's chip swatch shows: sun, shadow and fog (null when the track has none). */
export interface LookSwatch {
  sun: RgbColor;
  shadow: RgbColor;
  fog: RgbColor | null;
}

const FALLBACK_SUN: RgbColor = [235, 225, 205];
const FALLBACK_SHADOW: RgbColor = [110, 115, 130];

export function lookSwatch(files: LookFiles): LookSwatch {
  const main = readMainLight(files.blight);
  const fog = files.fog?.find((entry) => entry.index === MAIN_FOG_INDEX);
  return {
    sun: main?.color ?? FALLBACK_SUN,
    shadow: main?.shadow ?? FALLBACK_SHADOW,
    fog: fog && isFogActive(fog) ? clampColor(fog.color) : null,
  };
}

/** The swatch of one preset applied to the loaded track. */
export function presetSwatch(preset: LookPreset, original: LookFiles): LookSwatch {
  const swatch = lookSwatch(applyLookPreset(preset, original));
  if (swatch.fog || preset.id === 'original') return swatch;
  // A look that would add fog shows the fog it would add.
  return { ...swatch, fog: preset.fog.add ? ([...preset.fog.add.color] as RgbColor) : null };
}
