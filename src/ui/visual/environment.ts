// What the Environment panel edits, expressed on the parsed posteffect files in plain terms
// ("sunlight", "shadow colour", "fog starts at"). Every function is pure: parsed file in, new
// parsed file out. The mapping onto the binary files is decided here, in one place.
import type {
  PostEffectBlightFile,
  PostEffectBlightObject,
  PostEffectBloomFile,
  PostEffectDofFile,
  PostEffectFogEntry,
  RgbColor,
} from '../../lib/posteffects';
import { brightnessOf, clampColor, withBrightness } from './colorMath';

// --- lights ---------------------------------------------------------------------------------

const LIGHT_ENABLED = 1 << 0;
/** The lights the course model is lit with (the renderer builds its light sets from these). */
const LIGHT_COURSE = 1 << 5;

export function isLightEnabled(light: PostEffectBlightObject): boolean {
  return (light.flags & LIGHT_ENABLED) !== 0;
}

/** True for the lights that light the course model itself (each becomes one light set). */
export function isCourseLight(light: PostEffectBlightObject): boolean {
  return isLightEnabled(light) && (light.flags & LIGHT_COURSE) !== 0;
}

/**
 * The light "Sunlight" edits: light set 0, which is what the course model is lit with. That is
 * the first enabled course light plus the ambient (shadow) colour it points at. A file with no
 * course light falls back to its first enabled light so the controls still do something.
 */
export interface MainLight {
  lightIndex: number;
  ambientIndex: number;
  color: RgbColor;
  shadow: RgbColor;
}

export function findMainLightIndex(blight: PostEffectBlightFile | null): number | null {
  if (!blight) return null;
  const course = blight.lightObjects.findIndex(isCourseLight);
  if (course >= 0) return course;
  const any = blight.lightObjects.findIndex(isLightEnabled);
  return any >= 0 ? any : null;
}

export function readMainLight(blight: PostEffectBlightFile | null): MainLight | null {
  const lightIndex = findMainLightIndex(blight);
  if (!blight || lightIndex === null) return null;
  const light = blight.lightObjects[lightIndex];
  const ambient = blight.ambientLights[light.ambientLightIndex] ?? blight.ambientLights[0] ?? [100, 100, 100, 255];
  return {
    lightIndex,
    ambientIndex: Math.min(light.ambientLightIndex, Math.max(0, blight.ambientLights.length - 1)),
    color: clampColor(light.color),
    shadow: clampColor(ambient),
  };
}

export function setMainLightColor(blight: PostEffectBlightFile, color: readonly number[]): PostEffectBlightFile {
  const main = findMainLightIndex(blight);
  if (main === null) return blight;
  return setLightColor(blight, main, color);
}

export function setLightColor(blight: PostEffectBlightFile, lightIndex: number, color: readonly number[]): PostEffectBlightFile {
  const next = clampColor(color);
  return {
    ...blight,
    lightObjects: blight.lightObjects.map((light, index) =>
      index === lightIndex ? { ...light, color: [next[0], next[1], next[2], light.color[3]] } : light,
    ),
  };
}

export function setMainShadowColor(blight: PostEffectBlightFile, color: readonly number[]): PostEffectBlightFile {
  const main = readMainLight(blight);
  if (!main) return blight;
  return setAmbientColor(blight, main.ambientIndex, color);
}

export function setAmbientColor(blight: PostEffectBlightFile, ambientIndex: number, color: readonly number[]): PostEffectBlightFile {
  const next = clampColor(color);
  return {
    ...blight,
    ambientLights: blight.ambientLights.map((ambient, index) =>
      index === ambientIndex ? [next[0], next[1], next[2], ambient[3]] : ambient,
    ),
  };
}

/** Sets how bright a light colour is, keeping its hue. */
export function recolorBrightness(color: readonly number[], brightness: number): RgbColor {
  return withBrightness(color, brightness);
}

/** How many of the file's lights are on, for the "All lights" summary. */
export function countEnabledLights(blight: PostEffectBlightFile | null): number {
  return blight ? blight.lightObjects.filter(isLightEnabled).length : 0;
}

// --- fog ------------------------------------------------------------------------------------

/** The fog the course starts with. The other three presets are swapped in by AREA type 2. */
export const MAIN_FOG_INDEX = 0;
/** Plain linear fog, used when a track has none and the author turns it on. */
const FOG_LINEAR = 1;
export const FOG_DEFAULT_START = 30000;
export const FOG_DEFAULT_END = 300000;
export const FOG_DEFAULT_COLOR: RgbColor = [190, 210, 232];
/** The far end of the distance sliders, in KMP units. */
export const FOG_MAX_DISTANCE = 600000;

export function isFogActive(entry: PostEffectFogEntry | undefined): boolean {
  return !!entry && entry.fogType >= 1 && entry.fogType <= 10 && Number.isFinite(entry.startZ) && Number.isFinite(entry.endZ) && entry.endZ > entry.startZ;
}

function mapFog(entries: PostEffectFogEntry[], index: number, patch: (entry: PostEffectFogEntry) => PostEffectFogEntry): PostEffectFogEntry[] {
  return entries.map((entry) => (entry.index === index ? patch(entry) : entry));
}

/**
 * Turns the main fog on or off. Off keeps the distances and colour so turning it back on
 * restores them; `previous` is the fog type to bring back (the one the track shipped with).
 */
export function setFogEnabled(entries: PostEffectFogEntry[], enabled: boolean, previousType = FOG_LINEAR): PostEffectFogEntry[] {
  return mapFog(entries, MAIN_FOG_INDEX, (entry) => {
    if (!enabled) return { ...entry, fogType: 0 };
    const hasBand = Number.isFinite(entry.startZ) && Number.isFinite(entry.endZ) && entry.endZ > entry.startZ;
    return {
      ...entry,
      fogType: entry.fogType >= 1 && entry.fogType <= 10 ? entry.fogType : previousType >= 1 && previousType <= 10 ? previousType : FOG_LINEAR,
      startZ: hasBand ? entry.startZ : FOG_DEFAULT_START,
      endZ: hasBand ? entry.endZ : FOG_DEFAULT_END,
      color: hasBand ? entry.color : [...FOG_DEFAULT_COLOR],
    };
  });
}

export function setFogColor(entries: PostEffectFogEntry[], color: readonly number[]): PostEffectFogEntry[] {
  return mapFog(entries, MAIN_FOG_INDEX, (entry) => ({ ...entry, color: clampColor(color) }));
}

/** Moves one end of the fog band; the other end is pushed along so "fully foggy" stays beyond "starts". */
export function setFogDistance(entries: PostEffectFogEntry[], which: 'start' | 'end', distance: number): PostEffectFogEntry[] {
  const value = Math.max(0, Math.min(FOG_MAX_DISTANCE, Math.round(distance)));
  const gap = 1000;
  return mapFog(entries, MAIN_FOG_INDEX, (entry) => {
    if (which === 'start') return { ...entry, startZ: value, endZ: Math.max(entry.endZ, value + gap) };
    return { ...entry, endZ: value, startZ: Math.min(entry.startZ, Math.max(0, value - gap)) };
  });
}

/** A slider position (0-1) to a distance. The slider is square-root scaled so near fog is easy to dial in. */
export function sliderToDistance(position: number, max = FOG_MAX_DISTANCE): number {
  const t = Math.max(0, Math.min(1, position));
  return Math.round(t * t * max);
}

export function distanceToSlider(distance: number, max = FOG_MAX_DISTANCE): number {
  return Math.sqrt(Math.max(0, Math.min(max, distance)) / max);
}

/** "45k" style distance for readouts. */
export function formatDistance(distance: number): string {
  if (!Number.isFinite(distance)) return '0';
  if (Math.abs(distance) >= 1000) {
    const thousands = distance / 1000;
    return `${Number(thousands.toFixed(thousands >= 100 ? 0 : 1))}k`;
  }
  return String(Math.round(distance));
}

// --- glow (bloom) ---------------------------------------------------------------------------

/** What "Add glow" and "turn glow back on" use when the track has no strength of its own. */
export const BLOOM_DEFAULT: PostEffectBloomFile = {
  thresholdAmount: 0.5,
  thresholdColor: [255, 255, 255, 255],
  compositeColor: [255, 255, 255, 255],
  blurFlags: 11,
  blur0Radius: 1.2,
  blur0Intensity: 0.3,
  blur1Radius: 2,
  blur1Intensity: 0.08,
  compositeBlendMode: 1,
  blur1NumPasses: 2,
  bokehColorScale0: 0.3,
  bokehColorScale1: 0.1,
};

export const BLOOM_MAX_STRENGTH = 1;

export function isBloomOn(file: PostEffectBloomFile | undefined): boolean {
  return !!file && (file.blur0Intensity > 0 || file.blur1Intensity > 0);
}

/** The single "Strength" the panel shows: how strong the main blur is, 0-1. */
export function bloomStrength(file: PostEffectBloomFile): number {
  return Math.max(0, Math.min(BLOOM_MAX_STRENGTH, file.blur0Intensity));
}

/**
 * Sets the glow strength. The wide soft blur follows in proportion to how the track mixed the
 * two, so the character of the glow survives; a track with no blur to scale from gets a fixed
 * share.
 */
export function setBloomStrength(file: PostEffectBloomFile, strength: number, reference: PostEffectBloomFile = file): PostEffectBloomFile {
  const s = Math.max(0, Math.min(BLOOM_MAX_STRENGTH, strength));
  const ratio = reference.blur0Intensity > 0 ? reference.blur1Intensity / reference.blur0Intensity : BLOOM_DEFAULT.blur1Intensity / BLOOM_DEFAULT.blur0Intensity;
  return { ...file, blur0Intensity: s, blur1Intensity: Math.max(0, Math.min(BLOOM_MAX_STRENGTH, s * ratio)) };
}

export function setBloomEnabled(file: PostEffectBloomFile, enabled: boolean, restore: PostEffectBloomFile | null): PostEffectBloomFile {
  if (!enabled) return { ...file, blur0Intensity: 0, blur1Intensity: 0 };
  if (isBloomOn(file)) return file;
  const source = restore && isBloomOn(restore) ? restore : BLOOM_DEFAULT;
  return { ...file, blur0Intensity: source.blur0Intensity, blur1Intensity: source.blur1Intensity };
}

export function setBloomColor(file: PostEffectBloomFile, color: readonly number[]): PostEffectBloomFile {
  const next = clampColor(color);
  return { ...file, compositeColor: [next[0], next[1], next[2], file.compositeColor[3]] };
}

/** 0 lets everything glow, 1 only the very brightest. */
export function setBloomThreshold(file: PostEffectBloomFile, threshold: number): PostEffectBloomFile {
  return { ...file, thresholdAmount: Math.max(0, Math.min(1, threshold)) };
}

// --- depth of field -------------------------------------------------------------------------

/** The style the viewport can draw; "Add depth of field" creates this one. */
export const DOF_DEFAULT: PostEffectDofFile = {
  flags: 1,
  blurAlpha: [0, 130],
  drawMode: 2,
  blurDrawAmount: 0,
  depthCurveType: 0,
  focusCenter: 7000,
  focusRange: 30000,
  blurRadius: 1,
  indTexTransSScroll: -0.0075,
  indTexTransTScroll: -0.0075,
  indTexIndScaleS: 0.4,
  indTexIndScaleT: 0.2,
  indTexScaleS: 10,
  indTexScaleT: 15,
};

export const DOF_MAX_DISTANCE = 100000;
export const DOF_MAX_BLUR = 3;
/** Only draw mode 2 is drawn by the viewport preview. */
export const DOF_PREVIEW_DRAW_MODE = 2;

export function setDofField(file: PostEffectDofFile, field: 'focusCenter' | 'focusRange' | 'blurRadius', value: number): PostEffectDofFile {
  const max = field === 'blurRadius' ? DOF_MAX_BLUR : DOF_MAX_DISTANCE;
  return { ...file, [field]: Math.max(0, Math.min(max, value)) };
}

// --- summary --------------------------------------------------------------------------------

export function describeBrightness(color: readonly number[]): string {
  return `${Math.round(brightnessOf(color) * 100)}%`;
}
