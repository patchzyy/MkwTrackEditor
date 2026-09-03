// The "simple view" model: the handful of choices an author actually thinks in, and how each one
// maps onto the GX fields underneath.
//
// Every reader here answers a question about a `GxMaterialDoc` ("is this cut out?", "does anything
// read constant colour 3?") and every writer returns a fresh document. Two rules hold for all of
// them, and the unit tests in `materialSimple.test.ts` assert both:
//
//   1. **Writing back what was read is the identity.** `setX(doc, getX(doc)) === doc`, by
//      reference. That is what lets a retail material be opened, looked at and closed without a
//      single byte changing — the inspector renders from these getters and only calls a setter
//      when the user picks something different.
//   2. **A setter touches only the fields its choice is about.** Picking "Cutout" rewrites the
//      alpha test, the blend mode and the draw pass, and nothing else; it does not reach into
//      depth, culling or the stages.
//
// Imports go straight at `types.ts` and the vendored `gx_enum.ts` — both leaf modules — rather
// than at the `gxMaterial` barrel, so the simple inspector does not drag the BRRES writer into
// the main bundle. Same reason `materialDoc.ts` does it.
import * as GX from '../../../vendor/noclip.website/src/gx/gx_enum';
import type {
  GxAlphaTestDoc,
  GxMapMode,
  GxMaterialDoc,
  GxSamplerDoc,
  GxTevStageDoc,
} from '../../lib/gxMaterial/types';

// ---------------------------------------------------------------------------- transparency

/**
 * The three ways a surface can deal with alpha, in the words an author uses.
 *
 * - `opaque` — solid. No blending, and the alpha test lets everything through.
 * - `cutout` — hard-edged holes: the alpha test throws away texels below a threshold. Leaves,
 *   fences, chain link. Still drawn in the opaque pass, so it sorts correctly and is cheap.
 * - `transparent` — real blending against what is already on screen, drawn after the opaque
 *   pass, back to front.
 */
export type TransparencyMode = 'opaque' | 'cutout' | 'transparent';

/** The alpha test a material has when it is not cutting anything out. */
const ALPHA_TEST_OFF: GxAlphaTestDoc = {
  compareA: GX.CompareType.ALWAYS,
  referenceA: 0,
  op: GX.AlphaOp.AND,
  compareB: GX.CompareType.ALWAYS,
  referenceB: 0,
};

/** What the "Cutout" choice writes, around whatever threshold is in play. */
function cutoutAlphaTest(threshold: number): GxAlphaTestDoc {
  return {
    compareA: GX.CompareType.GEQUAL,
    referenceA: clamp01(threshold),
    op: GX.AlphaOp.AND,
    compareB: GX.CompareType.ALWAYS,
    referenceB: 0,
  };
}

export const DEFAULT_CUTOUT_THRESHOLD = 0.5;

function compare(func: GX.CompareType, value: number, reference: number): boolean {
  switch (func) {
    case GX.CompareType.NEVER: return false;
    case GX.CompareType.LESS: return value < reference;
    case GX.CompareType.EQUAL: return value === reference;
    case GX.CompareType.LEQUAL: return value <= reference;
    case GX.CompareType.GREATER: return value > reference;
    case GX.CompareType.NEQUAL: return value !== reference;
    case GX.CompareType.GEQUAL: return value >= reference;
    case GX.CompareType.ALWAYS: return true;
    default: return true;
  }
}

/**
 * True when the alpha test discards nothing, whatever the incoming alpha is.
 *
 * Evaluated rather than pattern-matched: the hardware has two comparisons joined by and / or /
 * xor / xnor, and there are far too many spellings of "always passes" to list. 256 alphas is the
 * whole input domain of an 8-bit alpha, so this is exact, not a sample.
 */
export function alphaTestPassesEverything(test: GxAlphaTestDoc): boolean {
  for (let step = 0; step <= 255; step++) {
    const alpha = step / 255;
    const a = compare(test.compareA, alpha, test.referenceA);
    const b = compare(test.compareB, alpha, test.referenceB);
    const passed =
      test.op === GX.AlphaOp.AND ? a && b
      : test.op === GX.AlphaOp.OR ? a || b
      : test.op === GX.AlphaOp.XOR ? a !== b
      : a === b;
    if (!passed) return false;
  }
  return true;
}

/**
 * Which of the three the material is doing now. Blending wins over cutting out: a material that
 * both blends and alpha-tests is a transparent one whose test is a detail, and the test stays
 * visible (and editable) in Advanced either way.
 */
export function getTransparencyMode(doc: GxMaterialDoc): TransparencyMode {
  if (doc.blend.mode === GX.BlendMode.BLEND || doc.blend.mode === GX.BlendMode.SUBTRACT) return 'transparent';
  if (!alphaTestPassesEverything(doc.alphaTest)) return 'cutout';
  return 'opaque';
}

/**
 * Sets the blend mode, the alpha test and the draw pass together, because those three have to
 * agree and getting one of them wrong is the classic way a custom track ends up with black boxes
 * around its trees.
 *
 * Returns `doc` itself when the material is already in that mode, so re-selecting the current
 * choice writes nothing. Blend *factors* are only filled in when the material was not blending
 * before — a material that already blends keeps whatever factors it was authored with.
 */
export function setTransparencyMode(doc: GxMaterialDoc, mode: TransparencyMode): GxMaterialDoc {
  if (getTransparencyMode(doc) === mode) return doc;
  switch (mode) {
    case 'opaque':
      return {
        ...doc,
        translucent: false,
        blend: { ...doc.blend, mode: GX.BlendMode.NONE },
        alphaTest: ALPHA_TEST_OFF,
      };
    case 'cutout':
      return {
        ...doc,
        translucent: false,
        blend: { ...doc.blend, mode: GX.BlendMode.NONE },
        alphaTest: cutoutAlphaTest(getCutoutThreshold(doc)),
      };
    case 'transparent':
      return {
        ...doc,
        translucent: true,
        blend: {
          ...doc.blend,
          mode: GX.BlendMode.BLEND,
          srcFactor: GX.BlendFactor.SRCALPHA,
          dstFactor: GX.BlendFactor.INVSRCALPHA,
        },
        alphaTest: ALPHA_TEST_OFF,
      };
  }
}

/**
 * The cutout threshold, 0..1. A material that is not cutting anything out has no threshold of
 * its own, so the slider starts at the halfway point the "Cutout" choice would write.
 */
export function getCutoutThreshold(doc: GxMaterialDoc): number {
  if (getTransparencyMode(doc) !== 'cutout') return DEFAULT_CUTOUT_THRESHOLD;
  return clamp01(doc.alphaTest.referenceA);
}

/** Moves the cutout threshold without disturbing the rest of the alpha test. */
export function setCutoutThreshold(doc: GxMaterialDoc, threshold: number): GxMaterialDoc {
  const next = clamp01(threshold);
  if (doc.alphaTest.referenceA === next) return doc;
  return { ...doc, alphaTest: { ...doc.alphaTest, referenceA: next } };
}

// ---------------------------------------------------------------------------- sides and depth

/** No culling: both faces of every triangle are drawn. */
export function isTwoSided(doc: GxMaterialDoc): boolean {
  return doc.cullMode === GX.CullMode.NONE;
}

/**
 * Two-sided on means "cull nothing"; off means "cull the back faces", which is what an exporter
 * writes for a normal solid surface. A material set to "draw nothing" reads as one-sided, and
 * turning the switch on rescues it — the raw four-way choice is still in Advanced.
 */
export function setTwoSided(doc: GxMaterialDoc, twoSided: boolean): GxMaterialDoc {
  if (isTwoSided(doc) === twoSided) return doc;
  return { ...doc, cullMode: twoSided ? GX.CullMode.NONE : GX.CullMode.BACK };
}

/** Whether the material stamps its depth, i.e. whether it hides what is drawn after it. */
export function getWritesDepth(doc: GxMaterialDoc): boolean {
  return doc.depth.write;
}

export function setWritesDepth(doc: GxMaterialDoc, write: boolean): GxMaterialDoc {
  if (doc.depth.write === write) return doc;
  return { ...doc, depth: { ...doc.depth, write } };
}

// ---------------------------------------------------------------------------- layers

export type WrapChoice = 'repeat' | 'mirror' | 'clamp';

const WRAP_TO_CHOICE: Record<number, WrapChoice> = {
  [GX.WrapMode.REPEAT]: 'repeat',
  [GX.WrapMode.MIRROR]: 'mirror',
  [GX.WrapMode.CLAMP]: 'clamp',
};

const CHOICE_TO_WRAP: Record<WrapChoice, GX.WrapMode> = {
  repeat: GX.WrapMode.REPEAT,
  mirror: GX.WrapMode.MIRROR,
  clamp: GX.WrapMode.CLAMP,
};

export function wrapChoiceOf(mode: GX.WrapMode): WrapChoice {
  return WRAP_TO_CHOICE[mode] ?? 'repeat';
}

export function wrapModeOf(choice: WrapChoice): GX.WrapMode {
  return CHOICE_TO_WRAP[choice];
}

/** The layer's wrapping when both axes agree, or `null` when they do not. */
export function getLayerWrap(sampler: GxSamplerDoc): WrapChoice | null {
  return sampler.wrapS === sampler.wrapT ? wrapChoiceOf(sampler.wrapS) : null;
}

/** Sets both axes at once. The per-axis pair stays reachable in the layer's advanced block. */
export function setLayerWrap(doc: GxMaterialDoc, index: number, choice: WrapChoice): GxMaterialDoc {
  const sampler = doc.samplers[index];
  if (!sampler) return doc;
  const mode = wrapModeOf(choice);
  if (sampler.wrapS === mode && sampler.wrapT === mode) return doc;
  return patchSamplerAt(doc, index, { wrapS: mode, wrapT: mode });
}

export type FilterChoice = 'smooth' | 'pixelated';

/** True for the four `*_MIP_*` filters — the ones that read the texture's mip chain. */
function filterUsesMips(filter: GX.TexFilter): boolean {
  return filter === GX.TexFilter.NEAR_MIP_NEAR
    || filter === GX.TexFilter.LIN_MIP_NEAR
    || filter === GX.TexFilter.NEAR_MIP_LIN
    || filter === GX.TexFilter.LIN_MIP_LIN;
}

/**
 * Smoothed or blocky, read off the magnification filter — the one that decides what a texture
 * looks like close up, which is the thing the author is actually choosing between.
 */
export function getLayerFilter(sampler: GxSamplerDoc): FilterChoice {
  return sampler.magFilter === GX.TexFilter.NEAR ? 'pixelated' : 'smooth';
}

/**
 * Sets magnification and minification together, keeping whether the layer reads its mips. A
 * pixel-art texture that had trilinear filtering becomes "point, discrete mip", not "point, no
 * mip": dropping the mip chain would make it shimmer at distance.
 */
export function setLayerFilter(doc: GxMaterialDoc, index: number, choice: FilterChoice): GxMaterialDoc {
  const sampler = doc.samplers[index];
  if (!sampler || getLayerFilter(sampler) === choice) return doc;
  const mips = filterUsesMips(sampler.minFilter);
  return patchSamplerAt(doc, index, {
    magFilter: choice === 'pixelated' ? GX.TexFilter.NEAR : GX.TexFilter.LINEAR,
    minFilter: choice === 'pixelated'
      ? (mips ? GX.TexFilter.NEAR_MIP_NEAR : GX.TexFilter.NEAR)
      : (mips ? GX.TexFilter.LIN_MIP_LIN : GX.TexFilter.LINEAR),
  });
}

/** Every map mode except plain UVs generates the layer's coordinates from the view or a light. */
export function isEnvironmentMapped(sampler: GxSamplerDoc): boolean {
  return sampler.mapMode !== 'texcoord';
}

/**
 * Turning the switch on gives the layer camera-space reflection coordinates; turning it off puts
 * it back on the mesh's own UVs. A layer already using one of the other generated modes
 * (projection, light or specular reflection) reads as on and is left exactly as it is — the
 * switch only ever moves between "the mesh's UVs" and "reflection", and the full five-way choice
 * is in the layer's advanced block.
 */
export function setEnvironmentMapped(doc: GxMaterialDoc, index: number, on: boolean): GxMaterialDoc {
  const sampler = doc.samplers[index];
  if (!sampler || isEnvironmentMapped(sampler) === on) return doc;
  const mapMode: GxMapMode = on ? 'envCamera' : 'texcoord';
  return patchSamplerAt(doc, index, { mapMode });
}

function patchSamplerAt(doc: GxMaterialDoc, index: number, patch: Partial<GxSamplerDoc>): GxMaterialDoc {
  return { ...doc, samplers: doc.samplers.map((sampler, i) => (i === index ? { ...sampler, ...patch } : sampler)) };
}

// ---------------------------------------------------------------------------- shading

/**
 * How the material's rasterised colour is produced, as three named looks rather than as the
 * channel's `lightingEnabled` / `materialSource` pair.
 *
 * - `lit` — the scene's lights shade it.
 * - `vertex` — the mesh's own baked vertex colours, which is what most Mario Kart Wii course
 *   surfaces use (the lightmap is painted into the vertices).
 * - `unlit` — a flat colour from the material itself: emissive signs, skyboxes, UI.
 */
export type ShadingMode = 'lit' | 'vertex' | 'unlit';

/** The colour half of channel 0 is the one every course material actually uses. */
export function getShadingMode(doc: GxMaterialDoc): ShadingMode {
  const channel = doc.channels[0];
  if (!channel) return 'unlit';
  if (channel.color.lightingEnabled) return 'lit';
  return channel.color.materialSource === GX.ColorSrc.VTX ? 'vertex' : 'unlit';
}

/**
 * Writes the mode onto channel 0's colour half. Switching to `lit` leaves the sources alone —
 * lighting reads the material colour or the vertex colour depending on them, and both are
 * legitimate lit setups — so only the switch itself moves.
 */
export function setShadingMode(doc: GxMaterialDoc, mode: ShadingMode): GxMaterialDoc {
  const channel = doc.channels[0];
  if (!channel || getShadingMode(doc) === mode) return doc;
  const color = mode === 'lit'
    ? { ...channel.color, lightingEnabled: true }
    : { ...channel.color, lightingEnabled: false, materialSource: mode === 'vertex' ? GX.ColorSrc.VTX : GX.ColorSrc.REG };
  return { ...doc, channels: doc.channels.map((entry, i) => (i === 0 ? { ...entry, color } : entry)) };
}

/** True when channel 0's colour comes from the material's own colour, so the swatch means something. */
export function usesMaterialColor(doc: GxMaterialDoc): boolean {
  const channel = doc.channels[0];
  return channel !== undefined && channel.color.materialSource === GX.ColorSrc.REG;
}

/** How many of the eight scene lights channel 0's colour half is allowed to see. */
export function countLitLights(doc: GxMaterialDoc): number {
  const mask = doc.channels[0]?.color.litMask ?? 0;
  let count = 0;
  for (let bit = 0; bit < 8; bit++) if ((mask & (1 << bit)) !== 0) count++;
  return count;
}

// ---------------------------------------------------------------------------- colours in use

/** A colour slot the shader reads, and the 1-based stage numbers that read it. */
export interface ColorSlotUsage {
  slot: number;
  stages: number[];
}

const KONST_COLOR_SLOT_FIRST = GX.KonstColorSel.KCSEL_K0; // 0x0C, the four whole K registers
const KONST_SWIZZLE_FIRST = 0x10; // K0[RRR] .. K3[AAA] for colour, K0[R] .. K3[A] for alpha

/** The K slot a konst *colour* selection reads, or -1 for the hardware fractions. */
export function konstColorSlot(sel: number): number {
  if (sel >= KONST_COLOR_SLOT_FIRST && sel <= GX.KonstColorSel.KCSEL_K3) return sel - KONST_COLOR_SLOT_FIRST;
  if (sel >= KONST_SWIZZLE_FIRST && sel <= GX.KonstColorSel.KCSEL_K3_A) return (sel - KONST_SWIZZLE_FIRST) % 4;
  return -1;
}

/** The K slot a konst *alpha* selection reads, or -1 for the fractions. */
export function konstAlphaSlot(sel: number): number {
  if (sel >= KONST_SWIZZLE_FIRST && sel <= GX.KonstAlphaSel.KASEL_K3_A) return (sel - KONST_SWIZZLE_FIRST) % 4;
  return -1;
}

function stageReadsKonstColor(stage: GxTevStageDoc): boolean {
  return stage.colorInA === GX.CC.KONST || stage.colorInB === GX.CC.KONST
    || stage.colorInC === GX.CC.KONST || stage.colorInD === GX.CC.KONST;
}

function stageReadsKonstAlpha(stage: GxTevStageDoc): boolean {
  return stage.alphaInA === GX.CA.KONST || stage.alphaInB === GX.CA.KONST
    || stage.alphaInC === GX.CA.KONST || stage.alphaInD === GX.CA.KONST;
}

/**
 * Which of the four konst colours the stages actually sample, and where.
 *
 * A stage names a konst selection whether or not any of its inputs is `KONST`, so reading the
 * selection alone would report all four as "in use" on nearly every retail material. Only a
 * stage with a `KONST` input counts.
 */
export function usedKonstColors(stages: readonly GxTevStageDoc[]): ColorSlotUsage[] {
  const byslot = new Map<number, number[]>();
  stages.forEach((stage, index) => {
    const slots: number[] = [];
    if (stageReadsKonstColor(stage)) slots.push(konstColorSlot(stage.konstColorSel));
    if (stageReadsKonstAlpha(stage)) slots.push(konstAlphaSlot(stage.konstAlphaSel));
    for (const slot of slots) {
      if (slot < 0) continue;
      const list = byslot.get(slot) ?? [];
      if (!list.includes(index + 1)) list.push(index + 1);
      byslot.set(slot, list);
    }
  });
  return [...byslot.entries()].sort((a, b) => a[0] - b[0]).map(([slot, stagesUsing]) => ({ slot, stages: stagesUsing }));
}

const COLOR_REGISTER_READS: Record<number, number> = {
  [GX.CC.C0]: 0, [GX.CC.A0]: 0,
  [GX.CC.C1]: 1, [GX.CC.A1]: 1,
  [GX.CC.C2]: 2, [GX.CC.A2]: 2,
};

const ALPHA_REGISTER_READS: Record<number, number> = {
  [GX.CA.A0]: 0, [GX.CA.A1]: 1, [GX.CA.A2]: 2,
};

/** `GX.Register.REG0..REG2` are 1..3; `PREV` is 0 and is not one of the three start colours. */
function registerWritten(regId: number): number {
  return regId >= GX.Register.REG0 && regId <= GX.Register.REG2 ? regId - GX.Register.REG0 : -1;
}

/**
 * Which of C0..C2 the shader reads *before* anything has written to it — the only case in which
 * the register's stored start value affects what is drawn. A register a stage writes on its way
 * past is a scratch variable, and editing its start colour would do nothing.
 */
export function usedColorRegisters(stages: readonly GxTevStageDoc[]): ColorSlotUsage[] {
  const written = new Set<number>();
  const byslot = new Map<number, number[]>();
  stages.forEach((stage, index) => {
    const reads = new Set<number>();
    for (const input of [stage.colorInA, stage.colorInB, stage.colorInC, stage.colorInD]) {
      const slot = COLOR_REGISTER_READS[input];
      if (slot !== undefined) reads.add(slot);
    }
    for (const input of [stage.alphaInA, stage.alphaInB, stage.alphaInC, stage.alphaInD]) {
      const slot = ALPHA_REGISTER_READS[input];
      if (slot !== undefined) reads.add(slot);
    }
    for (const slot of reads) {
      if (written.has(slot)) continue;
      const list = byslot.get(slot) ?? [];
      list.push(index + 1);
      byslot.set(slot, list);
    }
    // The write happens after this stage's own reads, so it only shadows later stages.
    const colorOut = registerWritten(stage.colorRegId);
    const alphaOut = registerWritten(stage.alphaRegId);
    if (colorOut >= 0) written.add(colorOut);
    if (alphaOut >= 0) written.add(alphaOut);
  });
  return [...byslot.entries()].sort((a, b) => a[0] - b[0]).map(([slot, stagesUsing]) => ({ slot, stages: stagesUsing }));
}

/** "stage 2" / "stages 1 and 3" / "stages 1, 2 and 4", for the caption under a colour swatch. */
export function describeStages(stages: readonly number[]): string {
  if (stages.length === 0) return 'no stage';
  const word = stages.length === 1 ? 'stage' : 'stages';
  if (stages.length === 1) return `${word} ${stages[0]}`;
  return `${word} ${stages.slice(0, -1).join(', ')} and ${stages[stages.length - 1]}`;
}

// ---------------------------------------------------------------------------- summary line

/**
 * One sentence describing what the material is, for the strip under the inspector header. Built
 * from the same getters the controls use, so it can never disagree with them.
 */
export function describeMaterial(doc: GxMaterialDoc): string {
  const parts: string[] = [];
  const transparency = getTransparencyMode(doc);
  parts.push(transparency === 'opaque' ? 'Solid' : transparency === 'cutout' ? 'Cut out' : 'See-through');
  const shading = getShadingMode(doc);
  parts.push(shading === 'lit' ? 'lit by the scene' : shading === 'vertex' ? 'vertex-coloured' : 'unlit');
  parts.push(doc.samplers.length === 0
    ? 'no texture'
    : `${doc.samplers.length} texture${doc.samplers.length === 1 ? '' : 's'}`);
  if (isTwoSided(doc)) parts.push('two-sided');
  return `${parts.join(' · ')}.`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
