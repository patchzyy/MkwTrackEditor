// Pure `GxMaterialDoc` edits. Every inspector control routes through one of these, so the mapping
// from a field to the document is testable without rendering anything, and every edit is a fresh
// document (the editor history stores whole snapshots).
// The defaults come from the library rather than being restated here: `defaults.ts` is a leaf
// module of the contract (it imports only `gx_enum` and `types`), so taking them does not pull the
// BRRES writer into the main bundle, and a new layer is exactly what "New material" would make.
import { createDefaultSampler, createDefaultTexGen, createDefaultTexSrt } from '../../lib/gxMaterial/defaults';
import type {
  GxChannelDoc,
  GxColor,
  GxColorS10,
  GxMaterialDoc,
  GxSamplerDoc,
  GxTexGenDoc,
  GxTexSrtDoc,
} from '../../lib/gxMaterial/types';

export const MAX_SAMPLERS = 8;
export const MAX_TEV_STAGES = 16;

// ---------------------------------------------------------------------------- colours

/** 0..1 float colour to the 0-255 triple `ColorField` takes. */
export function colorToRgb255(color: GxColor): [number, number, number] {
  return [clamp255(color.r * 255), clamp255(color.g * 255), clamp255(color.b * 255)];
}

export function rgb255ToColor(rgb: readonly [number, number, number], alpha: number): GxColor {
  return { r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255, a: alpha };
}

/**
 * A TEV colour register is s10 (-1024..1023 per channel); the swatch is 0-255. Values outside
 * 0..255 are clamped for display only — the document keeps whatever the material had until the
 * user actually edits that register.
 */
export function registerToRgb255(color: GxColorS10): [number, number, number] {
  return [clamp255(color.r), clamp255(color.g), clamp255(color.b)];
}

export function rgb255ToRegister(rgb: readonly [number, number, number], alpha: number): GxColorS10 {
  return { r: Math.round(rgb[0]), g: Math.round(rgb[1]), b: Math.round(rgb[2]), a: Math.round(alpha) };
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

// ---------------------------------------------------------------------------- top level

export function patchMaterial(doc: GxMaterialDoc, patch: Partial<GxMaterialDoc>): GxMaterialDoc {
  return { ...doc, ...patch };
}

export function setKonstColor(doc: GxMaterialDoc, slot: number, color: GxColor): GxMaterialDoc {
  if (slot < 0 || slot > 3) return doc;
  const konstColors = [...doc.konstColors] as GxMaterialDoc['konstColors'];
  konstColors[slot] = color;
  return { ...doc, konstColors };
}

export function setColorRegister(doc: GxMaterialDoc, slot: number, color: GxColorS10): GxMaterialDoc {
  if (slot < 0 || slot > 2) return doc;
  const colorRegisters = [...doc.colorRegisters] as GxMaterialDoc['colorRegisters'];
  colorRegisters[slot] = color;
  return { ...doc, colorRegisters };
}

// ---------------------------------------------------------------------------- layers

export function patchSampler(doc: GxMaterialDoc, index: number, patch: Partial<GxSamplerDoc>): GxMaterialDoc {
  if (!doc.samplers[index]) return doc;
  return { ...doc, samplers: doc.samplers.map((sampler, i) => (i === index ? { ...sampler, ...patch } : sampler)) };
}

export function patchTexSrt(doc: GxMaterialDoc, index: number, patch: Partial<GxTexSrtDoc>): GxMaterialDoc {
  if (!doc.texSrts[index]) return doc;
  return { ...doc, texSrts: doc.texSrts.map((srt, i) => (i === index ? { ...srt, ...patch } : srt)) };
}

export function patchTexGen(doc: GxMaterialDoc, index: number, patch: Partial<GxTexGenDoc>): GxMaterialDoc {
  if (!doc.texGens[index]) return doc;
  return { ...doc, texGens: doc.texGens.map((texGen, i) => (i === index ? { ...texGen, ...patch } : texGen)) };
}

/** Adds a layer (sampler + SRT + texgen) at the end. Capped at the hardware's 8. */
export function addLayer(doc: GxMaterialDoc, texture: string): GxMaterialDoc {
  if (doc.samplers.length >= MAX_SAMPLERS) return doc;
  const index = doc.samplers.length;
  return {
    ...doc,
    samplers: [...doc.samplers, createDefaultSampler(texture)],
    texSrts: [...doc.texSrts, createDefaultTexSrt()],
    texGens: doc.texGens.length > index ? doc.texGens : [...doc.texGens, createDefaultTexGen(index)],
  };
}

/** Adds empty layers until the material has at least `count` of them (for graph presets). */
export function ensureLayerCount(doc: GxMaterialDoc, count: number, texture: string): GxMaterialDoc {
  let next = doc;
  while (next.samplers.length < Math.min(count, MAX_SAMPLERS)) next = addLayer(next, texture);
  return next;
}

export function removeLayer(doc: GxMaterialDoc, index: number): GxMaterialDoc {
  if (!doc.samplers[index]) return doc;
  return {
    ...doc,
    samplers: doc.samplers.filter((_, i) => i !== index),
    texSrts: doc.texSrts.filter((_, i) => i !== index),
    texGens: doc.texGens.filter((_, i) => i !== index),
  };
}

/** Moves a layer up or down. Sampler, SRT and texgen move together — they are one layer. */
export function moveLayer(doc: GxMaterialDoc, index: number, delta: number): GxMaterialDoc {
  const target = index + delta;
  if (!doc.samplers[index] || target < 0 || target >= doc.samplers.length) return doc;
  const swap = <T,>(list: T[]): T[] => {
    const next = [...list];
    if (next[index] === undefined || next[target] === undefined) return next;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  };
  return { ...doc, samplers: swap(doc.samplers), texSrts: swap(doc.texSrts), texGens: swap(doc.texGens) };
}

// ---------------------------------------------------------------------------- channels

export function patchChannel(doc: GxMaterialDoc, index: number, patch: Partial<GxChannelDoc>): GxMaterialDoc {
  if (!doc.channels[index]) return doc;
  return { ...doc, channels: doc.channels.map((channel, i) => (i === index ? { ...channel, ...patch } : channel)) };
}

export function patchChannelControl(
  doc: GxMaterialDoc,
  index: number,
  half: 'color' | 'alpha',
  patch: Partial<GxChannelDoc['color']>,
): GxMaterialDoc {
  const channel = doc.channels[index];
  if (!channel) return doc;
  return patchChannel(doc, index, { [half]: { ...channel[half], ...patch } } as Partial<GxChannelDoc>);
}

/** Flips one of the 8 scene lights in a channel's light mask. */
export function toggleLitMaskBit(mask: number, bit: number, on: boolean): number {
  return on ? mask | (1 << bit) : mask & ~(1 << bit);
}

// ---------------------------------------------------------------------------- state blocks

export function patchAlphaTest(doc: GxMaterialDoc, patch: Partial<GxMaterialDoc['alphaTest']>): GxMaterialDoc {
  return { ...doc, alphaTest: { ...doc.alphaTest, ...patch } };
}

export function patchBlend(doc: GxMaterialDoc, patch: Partial<GxMaterialDoc['blend']>): GxMaterialDoc {
  return { ...doc, blend: { ...doc.blend, ...patch } };
}

export function patchDepth(doc: GxMaterialDoc, patch: Partial<GxMaterialDoc['depth']>): GxMaterialDoc {
  return { ...doc, depth: { ...doc.depth, ...patch } };
}

export function patchIndTexStage(doc: GxMaterialDoc, index: number, patch: Partial<GxMaterialDoc['indTexStages'][number]>): GxMaterialDoc {
  if (!doc.indTexStages[index]) return doc;
  return { ...doc, indTexStages: doc.indTexStages.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)) };
}

export function patchIndMatrix(doc: GxMaterialDoc, index: number, patch: Partial<GxMaterialDoc['indMatrices'][number]>): GxMaterialDoc {
  if (index < 0 || index > 2) return doc;
  const indMatrices = [...doc.indMatrices] as GxMaterialDoc['indMatrices'];
  indMatrices[index] = { ...indMatrices[index], ...patch };
  return { ...doc, indMatrices };
}

export function setIndMatrixCell(doc: GxMaterialDoc, index: number, cell: number, value: number): GxMaterialDoc {
  if (index < 0 || index > 2 || cell < 0 || cell > 5) return doc;
  const m = [...doc.indMatrices[index].m] as GxMaterialDoc['indMatrices'][number]['m'];
  m[cell] = value;
  return patchIndMatrix(doc, index, { m });
}

// ---------------------------------------------------------------------------- summaries

/** "6 stages · 2 textures" for the graph dock's status line. */
export function describeShader(stageCount: number, samplerCount: number): string {
  return `${stageCount} stage${stageCount === 1 ? '' : 's'} · ${samplerCount} texture${samplerCount === 1 ? '' : 's'}`;
}

/** True when two documents are the same as far as the encoder is concerned. */
export function materialDocEquals(a: GxMaterialDoc, b: GxMaterialDoc): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Turns lighting on for channel 0's colour half, which is what the lit shader presets need and
 * what the graph cannot say: lighting is material state, not a TEV stage.
 */
export function withChannelLighting(doc: GxMaterialDoc): GxMaterialDoc {
  if (!doc.channels[0] || doc.channels[0].color.lightingEnabled) return doc;
  return patchChannelControl(doc, 0, 'color', { lightingEnabled: true });
}
