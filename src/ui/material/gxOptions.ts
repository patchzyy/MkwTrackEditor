// Plain-language names for the GX enums the material inspector edits.
//
// The values come straight from the vendored `gx_enum.ts` — the same module the contract in
// `src/lib/gxMaterial/types.ts` types its fields against — so a dropdown can never drift from the
// numbers the encoder and the renderer agree on. `gx_enum.ts` is a leaf module of pure numeric
// enums with no imports of its own, so this is data, not a renderer dependency.
//
// House rule from `docs/UI.md`: no raw enum identifiers reach the user. `GX.CC.RASC` is
// "Vertex colour (RGB)", not "RASC".
import * as GX from '../../../vendor/noclip.website/src/gx/gx_enum';
import type { SelectOption } from '../components';

export type NumberOption = SelectOption<string> & { numeric: number };

function options(entries: ReadonlyArray<readonly [number, string]>): NumberOption[] {
  return entries.map(([numeric, label]) => ({ value: String(numeric), label, numeric }));
}

// ---------------------------------------------------------------------------- material

export const CULL_MODE_OPTIONS = options([
  [GX.CullMode.NONE, 'Draw both sides'],
  [GX.CullMode.FRONT, 'Back faces only'],
  [GX.CullMode.BACK, 'Front faces only'],
  [GX.CullMode.ALL, 'Draw nothing'],
]);

export const TEX_MATRIX_MODE_OPTIONS: Array<SelectOption<string>> = [
  { value: 'maya', label: 'Maya' },
  { value: 'xsi', label: 'XSI' },
  { value: 'max', label: '3ds Max' },
];

// ---------------------------------------------------------------------------- samplers

export const WRAP_MODE_OPTIONS = options([
  [GX.WrapMode.CLAMP, 'Clamp to edge'],
  [GX.WrapMode.REPEAT, 'Repeat'],
  [GX.WrapMode.MIRROR, 'Mirror'],
]);

export const MIN_FILTER_OPTIONS = options([
  [GX.TexFilter.NEAR, 'Nearest, no mips'],
  [GX.TexFilter.LINEAR, 'Linear, no mips'],
  [GX.TexFilter.NEAR_MIP_NEAR, 'Nearest, nearest mip'],
  [GX.TexFilter.LIN_MIP_NEAR, 'Linear, nearest mip'],
  [GX.TexFilter.NEAR_MIP_LIN, 'Nearest, blended mips'],
  [GX.TexFilter.LIN_MIP_LIN, 'Trilinear'],
]);

export const MAG_FILTER_OPTIONS = options([
  [GX.TexFilter.NEAR, 'Nearest'],
  [GX.TexFilter.LINEAR, 'Linear'],
]);

export const ANISOTROPY_OPTIONS = options([
  [GX.Anisotropy._1, 'Off'],
  [GX.Anisotropy._2, '2x'],
  [GX.Anisotropy._4, '4x'],
]);

export const MAP_MODE_OPTIONS: Array<SelectOption<string>> = [
  { value: 'texcoord', label: 'Texture coordinates' },
  { value: 'envCamera', label: 'Camera reflection' },
  { value: 'projection', label: 'Projected from a camera' },
  { value: 'envLight', label: 'Light reflection' },
  { value: 'envSpec', label: 'Specular reflection' },
];

// ---------------------------------------------------------------------------- texgens

export const TEX_GEN_TYPE_OPTIONS = options([
  [GX.TexGenType.MTX2x4, '2x4 matrix (normal)'],
  [GX.TexGenType.MTX3x4, '3x4 matrix (projected)'],
  [GX.TexGenType.SRTG, 'From a colour channel'],
  [GX.TexGenType.BUMP0, 'Bump from indirect 0'],
  [GX.TexGenType.BUMP1, 'Bump from indirect 1'],
  [GX.TexGenType.BUMP2, 'Bump from indirect 2'],
  [GX.TexGenType.BUMP3, 'Bump from indirect 3'],
]);

export const TEX_GEN_SOURCE_OPTIONS = options([
  [GX.TexGenSrc.POS, 'Vertex position'],
  [GX.TexGenSrc.NRM, 'Vertex normal'],
  [GX.TexGenSrc.BINRM, 'Binormal'],
  [GX.TexGenSrc.TANGENT, 'Tangent'],
  [GX.TexGenSrc.TEX0, 'UV set 1'],
  [GX.TexGenSrc.TEX1, 'UV set 2'],
  [GX.TexGenSrc.TEX2, 'UV set 3'],
  [GX.TexGenSrc.TEX3, 'UV set 4'],
  [GX.TexGenSrc.TEX4, 'UV set 5'],
  [GX.TexGenSrc.TEX5, 'UV set 6'],
  [GX.TexGenSrc.TEX6, 'UV set 7'],
  [GX.TexGenSrc.TEX7, 'UV set 8'],
  [GX.TexGenSrc.COLOR0, 'Vertex colour 1'],
  [GX.TexGenSrc.COLOR1, 'Vertex colour 2'],
]);

export const TEX_GEN_MATRIX_OPTIONS = options([
  [GX.TexGenMatrix.IDENTITY, 'None (identity)'],
  [GX.TexGenMatrix.TEXMTX0, 'Layer matrix 1'],
  [GX.TexGenMatrix.TEXMTX1, 'Layer matrix 2'],
  [GX.TexGenMatrix.TEXMTX2, 'Layer matrix 3'],
  [GX.TexGenMatrix.TEXMTX3, 'Layer matrix 4'],
  [GX.TexGenMatrix.TEXMTX4, 'Layer matrix 5'],
  [GX.TexGenMatrix.TEXMTX5, 'Layer matrix 6'],
  [GX.TexGenMatrix.TEXMTX6, 'Layer matrix 7'],
  [GX.TexGenMatrix.TEXMTX7, 'Layer matrix 8'],
]);

// ---------------------------------------------------------------------------- lighting

export const COLOR_SRC_OPTIONS = options([
  [GX.ColorSrc.REG, 'This material'],
  [GX.ColorSrc.VTX, 'The vertices'],
]);

export const DIFFUSE_FUNCTION_OPTIONS = options([
  [GX.DiffuseFunction.NONE, 'Flat (no falloff)'],
  [GX.DiffuseFunction.SIGN, 'Signed'],
  [GX.DiffuseFunction.CLAMP, 'Clamped'],
]);

export const ATTENUATION_FUNCTION_OPTIONS = options([
  [GX.AttenuationFunction.NONE, 'None'],
  [GX.AttenuationFunction.SPEC, 'Specular'],
  [GX.AttenuationFunction.SPOT, 'Distance / spotlight'],
]);

// ---------------------------------------------------------------------------- blend, alpha, depth

export const BLEND_MODE_OPTIONS = options([
  [GX.BlendMode.NONE, 'Opaque (no blending)'],
  [GX.BlendMode.BLEND, 'Blend'],
  [GX.BlendMode.LOGIC, 'Logic operation'],
  [GX.BlendMode.SUBTRACT, 'Subtract'],
]);

export const BLEND_FACTOR_OPTIONS = options([
  [GX.BlendFactor.ZERO, 'Zero'],
  [GX.BlendFactor.ONE, 'One'],
  [GX.BlendFactor.SRCCLR, 'Source colour'],
  [GX.BlendFactor.INVSRCCLR, '1 - source colour'],
  [GX.BlendFactor.SRCALPHA, 'Source alpha'],
  [GX.BlendFactor.INVSRCALPHA, '1 - source alpha'],
  [GX.BlendFactor.DSTALPHA, 'Destination alpha'],
  [GX.BlendFactor.INVDSTALPHA, '1 - destination alpha'],
]);

export const LOGIC_OP_OPTIONS = options([
  [GX.LogicOp.CLEAR, 'Clear'], [GX.LogicOp.AND, 'And'], [GX.LogicOp.REVAND, 'Reverse and'],
  [GX.LogicOp.COPY, 'Copy'], [GX.LogicOp.INVAND, 'Inverted and'], [GX.LogicOp.NOOP, 'No operation'],
  [GX.LogicOp.XOR, 'Exclusive or'], [GX.LogicOp.OR, 'Or'], [GX.LogicOp.NOR, 'Nor'],
  [GX.LogicOp.EQUIV, 'Equivalent'], [GX.LogicOp.INV, 'Invert'], [GX.LogicOp.REVOR, 'Reverse or'],
  [GX.LogicOp.INVCOPY, 'Inverted copy'], [GX.LogicOp.INVOR, 'Inverted or'],
  [GX.LogicOp.NAND, 'Nand'], [GX.LogicOp.SET, 'Set'],
]);

export const COMPARE_OPTIONS = options([
  [GX.CompareType.NEVER, 'Never'],
  [GX.CompareType.LESS, 'Less than'],
  [GX.CompareType.EQUAL, 'Equal to'],
  [GX.CompareType.LEQUAL, 'Less or equal'],
  [GX.CompareType.GREATER, 'Greater than'],
  [GX.CompareType.NEQUAL, 'Not equal'],
  [GX.CompareType.GEQUAL, 'Greater or equal'],
  [GX.CompareType.ALWAYS, 'Always'],
]);

export const ALPHA_OP_OPTIONS = options([
  [GX.AlphaOp.AND, 'Both tests (and)'],
  [GX.AlphaOp.OR, 'Either test (or)'],
  [GX.AlphaOp.XOR, 'Exactly one (xor)'],
  [GX.AlphaOp.XNOR, 'Both or neither (xnor)'],
]);

// ---------------------------------------------------------------------------- indirect

export const IND_TEX_SCALE_OPTIONS = options([
  [GX.IndTexScale._1, '1'], [GX.IndTexScale._2, '1 / 2'], [GX.IndTexScale._4, '1 / 4'],
  [GX.IndTexScale._8, '1 / 8'], [GX.IndTexScale._16, '1 / 16'], [GX.IndTexScale._32, '1 / 32'],
  [GX.IndTexScale._64, '1 / 64'], [GX.IndTexScale._128, '1 / 128'], [GX.IndTexScale._256, '1 / 256'],
]);

export const IND_TEX_FORMAT_OPTIONS = options([
  [GX.IndTexFormat._8, '8 bit'], [GX.IndTexFormat._5, '5 bit'],
  [GX.IndTexFormat._4, '4 bit'], [GX.IndTexFormat._3, '3 bit'],
]);

export const IND_TEX_BIAS_OPTIONS = options([
  [GX.IndTexBiasSel.NONE, 'None'], [GX.IndTexBiasSel.S, 'S'], [GX.IndTexBiasSel.T, 'T'],
  [GX.IndTexBiasSel.ST, 'S and T'], [GX.IndTexBiasSel.U, 'U'], [GX.IndTexBiasSel.SU, 'S and U'],
  [GX.IndTexBiasSel.TU, 'T and U'], [GX.IndTexBiasSel.STU, 'S, T and U'],
]);

export const IND_TEX_WRAP_OPTIONS = options([
  [GX.IndTexWrap.OFF, 'Off'], [GX.IndTexWrap._256, '256'], [GX.IndTexWrap._128, '128'],
  [GX.IndTexWrap._64, '64'], [GX.IndTexWrap._32, '32'], [GX.IndTexWrap._16, '16'], [GX.IndTexWrap._0, '0'],
]);

export const IND_TEX_MATRIX_OPTIONS = options([
  [GX.IndTexMtxID.OFF, 'None'],
  [GX.IndTexMtxID._0, 'Matrix 1'], [GX.IndTexMtxID._1, 'Matrix 2'], [GX.IndTexMtxID._2, 'Matrix 3'],
  [GX.IndTexMtxID.S0, 'Matrix 1 (S)'], [GX.IndTexMtxID.S1, 'Matrix 2 (S)'], [GX.IndTexMtxID.S2, 'Matrix 3 (S)'],
  [GX.IndTexMtxID.T0, 'Matrix 1 (T)'], [GX.IndTexMtxID.T1, 'Matrix 2 (T)'], [GX.IndTexMtxID.T2, 'Matrix 3 (T)'],
]);

export const TEV_OP_OPTIONS = options([
  [GX.TevOp.ADD, 'Add'],
  [GX.TevOp.SUB, 'Subtract'],
  [GX.TevOp.COMP_R8_GT, 'R greater than'],
  [GX.TevOp.COMP_R8_EQ, 'R equal to'],
  [GX.TevOp.COMP_GR16_GT, 'GR greater than'],
  [GX.TevOp.COMP_GR16_EQ, 'GR equal to'],
  [GX.TevOp.COMP_BGR24_GT, 'BGR greater than'],
  [GX.TevOp.COMP_BGR24_EQ, 'BGR equal to'],
  [GX.TevOp.COMP_RGB8_GT, 'RGB greater than'],
  [GX.TevOp.COMP_RGB8_EQ, 'RGB equal to'],
]);

// ---------------------------------------------------------------------------- stage table labels

const CC_LABELS: Record<number, string> = {
  [GX.CC.CPREV]: 'Previous (RGB)', [GX.CC.APREV]: 'Previous (A)',
  [GX.CC.C0]: 'C0 (RGB)', [GX.CC.A0]: 'C0 (A)',
  [GX.CC.C1]: 'C1 (RGB)', [GX.CC.A1]: 'C1 (A)',
  [GX.CC.C2]: 'C2 (RGB)', [GX.CC.A2]: 'C2 (A)',
  [GX.CC.TEXC]: 'Texture (RGB)', [GX.CC.TEXA]: 'Texture (A)',
  [GX.CC.RASC]: 'Vertex colour (RGB)', [GX.CC.RASA]: 'Vertex colour (A)',
  [GX.CC.ONE]: '1', [GX.CC.HALF]: '0.5', [GX.CC.KONST]: 'Constant', [GX.CC.ZERO]: '0',
};

const CA_LABELS: Record<number, string> = {
  [GX.CA.APREV]: 'Previous', [GX.CA.A0]: 'C0', [GX.CA.A1]: 'C1', [GX.CA.A2]: 'C2',
  [GX.CA.TEXA]: 'Texture', [GX.CA.RASA]: 'Vertex colour', [GX.CA.KONST]: 'Constant', [GX.CA.ZERO]: '0',
};

const REGISTER_LABELS: Record<number, string> = {
  [GX.Register.PREV]: 'Previous', [GX.Register.REG0]: 'C0', [GX.Register.REG1]: 'C1', [GX.Register.REG2]: 'C2',
};

const BIAS_LABELS: Record<number, string> = {
  [GX.TevBias.ZERO]: '0', [GX.TevBias.ADDHALF]: '+0.5', [GX.TevBias.SUBHALF]: '-0.5', [GX.TevBias.$HWB_COMPARE]: 'compare',
};

const SCALE_LABELS: Record<number, string> = {
  [GX.TevScale.SCALE_1]: 'x1', [GX.TevScale.SCALE_2]: 'x2', [GX.TevScale.SCALE_4]: 'x4', [GX.TevScale.DIVIDE_2]: 'x0.5',
};

const CHANNEL_LABELS: Record<number, string> = {
  [GX.RasColorChannelID.COLOR0A0]: 'Channel 1',
  [GX.RasColorChannelID.COLOR1A1]: 'Channel 2',
  [GX.RasColorChannelID.ALPHA_BUMP]: 'Bump alpha',
  [GX.RasColorChannelID.ALPHA_BUMP_N]: 'Bump alpha (n)',
  [GX.RasColorChannelID.COLOR_ZERO]: 'None',
};

export const ccLabel = (value: number): string => CC_LABELS[value] ?? `#${value}`;
export const caLabel = (value: number): string => CA_LABELS[value] ?? `#${value}`;
export const registerLabel = (value: number): string => REGISTER_LABELS[value] ?? `#${value}`;
export const biasLabel = (value: number): string => BIAS_LABELS[value] ?? `#${value}`;
export const scaleLabel = (value: number): string => SCALE_LABELS[value] ?? `#${value}`;
export const channelLabel = (value: number): string => CHANNEL_LABELS[value] ?? `#${value}`;
const TEV_OP_LABELS: Record<number, string> = {
  [GX.TevOp.ADD]: 'Add', [GX.TevOp.SUB]: 'Subtract',
  [GX.TevOp.COMP_R8_GT]: 'R >', [GX.TevOp.COMP_R8_EQ]: 'R =',
  [GX.TevOp.COMP_GR16_GT]: 'GR >', [GX.TevOp.COMP_GR16_EQ]: 'GR =',
  [GX.TevOp.COMP_BGR24_GT]: 'BGR >', [GX.TevOp.COMP_BGR24_EQ]: 'BGR =',
  [GX.TevOp.COMP_RGB8_GT]: 'RGB >', [GX.TevOp.COMP_RGB8_EQ]: 'RGB =',
};

export const tevOpLabel = (value: number): string => TEV_OP_LABELS[value] ?? `#${value}`;

/** `TEXMAP_NULL` / `TEXCOORD_NULL` are 0xFF; anything else is a 1-based slot number. */
export function slotLabel(value: number): string {
  return value === 0xff || value < 0 ? '—' : String(value + 1);
}

export function konstColorLabel(value: number): string {
  if (value >= GX.KonstColorSel.KCSEL_K0 && value <= GX.KonstColorSel.KCSEL_K3) return `K${value - GX.KonstColorSel.KCSEL_K0}`;
  if (value >= GX.KonstColorSel.KCSEL_K0_R && value <= GX.KonstColorSel.KCSEL_K3_A) {
    const swizzle = 'RGBA'[Math.floor((value - GX.KonstColorSel.KCSEL_K0_R) / 4)];
    return `K${(value - GX.KonstColorSel.KCSEL_K0_R) % 4}.${swizzle}`;
  }
  const fractions = ['1', '7/8', '6/8', '5/8', '4/8', '3/8', '2/8', '1/8'];
  return fractions[value] ?? `#${value}`;
}

export function konstAlphaLabel(value: number): string {
  if (value >= GX.KonstAlphaSel.KASEL_K0_R && value <= GX.KonstAlphaSel.KASEL_K3_A) {
    const swizzle = 'RGBA'[Math.floor((value - GX.KonstAlphaSel.KASEL_K0_R) / 4)];
    return `K${(value - GX.KonstAlphaSel.KASEL_K0_R) % 4}.${swizzle}`;
  }
  const fractions = ['1', '7/8', '6/8', '5/8', '4/8', '3/8', '2/8', '1/8'];
  return fractions[value] ?? `#${value}`;
}

/**
 * What a stage can select as its konst colour. The four whole registers come first because they
 * are what a `Color` node normally means; the fractions and single-channel reads are the cases
 * `GraphConstantNode.slot` cannot name on its own.
 */
export const KONST_COLOR_SEL_OPTIONS: NumberOption[] = [
  ...[0, 1, 2, 3].map((slot) => ({
    value: String(GX.KonstColorSel.KCSEL_K0 + slot),
    label: `K${slot} (whole colour)`,
    numeric: GX.KonstColorSel.KCSEL_K0 + slot,
  })),
  ...['1', '7/8', '6/8', '5/8', '4/8', '3/8', '2/8', '1/8'].map((fraction, index) => ({
    value: String(index),
    label: `Constant ${fraction}`,
    numeric: index,
  })),
  ...['R', 'G', 'B', 'A'].flatMap((channel, channelIndex) =>
    [0, 1, 2, 3].map((slot) => ({
      value: String(GX.KonstColorSel.KCSEL_K0_R + channelIndex * 4 + slot),
      label: `K${slot} ${channel} in every channel`,
      numeric: GX.KonstColorSel.KCSEL_K0_R + channelIndex * 4 + slot,
    })),
  ),
];

export const KONST_ALPHA_SEL_OPTIONS: NumberOption[] = [
  ...[0, 1, 2, 3].map((slot) => ({
    value: String(GX.KonstAlphaSel.KASEL_K0_A + slot),
    label: `K${slot} alpha`,
    numeric: GX.KonstAlphaSel.KASEL_K0_A + slot,
  })),
  ...['1', '7/8', '6/8', '5/8', '4/8', '3/8', '2/8', '1/8'].map((fraction, index) => ({
    value: String(index),
    label: `Constant ${fraction}`,
    numeric: index,
  })),
  ...['R', 'G', 'B'].flatMap((channel, channelIndex) =>
    [0, 1, 2, 3].map((slot) => ({
      value: String(GX.KonstAlphaSel.KASEL_K0_R + channelIndex * 4 + slot),
      label: `K${slot} ${channel}`,
      numeric: GX.KonstAlphaSel.KASEL_K0_R + channelIndex * 4 + slot,
    })),
  ),
];

/** The selection a `Color` node uses when it has no explicit one: the whole K register. */
export const defaultKonstColorSel = (slot: number): number => GX.KonstColorSel.KCSEL_K0 + slot;
export const defaultKonstAlphaSel = (slot: number): number => GX.KonstAlphaSel.KASEL_K0_A + slot;

/** GX texture formats, for the import dialog. */
export const TEXTURE_FORMAT_OPTIONS = options([
  [GX.TexFormat.CMPR, 'CMPR — compressed, smallest'],
  [GX.TexFormat.RGB5A3, 'RGB5A3 — colour with soft alpha'],
  [GX.TexFormat.RGBA8, 'RGBA8 — full quality, largest'],
  [GX.TexFormat.RGB565, 'RGB565 — colour, no alpha'],
  [GX.TexFormat.IA8, 'IA8 — greyscale with alpha'],
  [GX.TexFormat.I8, 'I8 — greyscale'],
  [GX.TexFormat.IA4, 'IA4 — greyscale with alpha, small'],
  [GX.TexFormat.I4, 'I4 — greyscale, smallest'],
]);

export const TEXTURE_FORMAT_LABELS: Record<number, string> = {
  [GX.TexFormat.I4]: 'I4', [GX.TexFormat.I8]: 'I8', [GX.TexFormat.IA4]: 'IA4', [GX.TexFormat.IA8]: 'IA8',
  [GX.TexFormat.RGB565]: 'RGB565', [GX.TexFormat.RGB5A3]: 'RGB5A3', [GX.TexFormat.RGBA8]: 'RGBA8',
  [GX.TexFormat.C4]: 'C4', [GX.TexFormat.C8]: 'C8', [GX.TexFormat.C14X2]: 'C14X2', [GX.TexFormat.CMPR]: 'CMPR',
};

export function textureFormatLabel(format: number): string {
  return TEXTURE_FORMAT_LABELS[format] ?? `Format ${format}`;
}

// ---------------------------------------------------------------------------- friendly names
//
// The simple inspector and the node graph say what a thing *is* rather than what the hardware
// calls it. These are the shared spellings, so a konst slot reads "Colour 1" in the graph, in the
// colour section and in a status message alike.

const WRAP_CHOICE_LABELS: Record<string, string> = {
  repeat: 'Repeat',
  mirror: 'Mirror',
  clamp: 'Clamp',
};

/** "Repeat" / "Mirror" / "Clamp" — never `GX.WrapMode.REPEAT`. */
export function wrapChoiceLabel(choice: string): string {
  return WRAP_CHOICE_LABELS[choice] ?? choice;
}

const MAP_MODE_LABELS: Record<string, string> = {
  texcoord: 'Texture coordinates',
  envCamera: 'Camera reflection',
  projection: 'Projected from a camera',
  envLight: 'Light reflection',
  envSpec: 'Specular reflection',
};

export function mapModeLabel(mapMode: string): string {
  return MAP_MODE_LABELS[mapMode] ?? mapMode;
}

/** The four konst colours, numbered from one. K0 is "Colour 1", never "K0" and never "KCSEL_K0". */
export function konstColorName(slot: number): string {
  return `Colour ${slot + 1}`;
}

/**
 * The three TEV colour registers. What the user edits is the value the register *starts* at
 * before any stage writes to it, so that is what it is called.
 */
export function colorRegisterName(slot: number): string {
  return `Start colour ${slot + 1}`;
}

/**
 * What a `Vertex colour` node reads, in words. The value is a `GX.RasColorChannelID`: 0 and 1 are
 * the material's two lighting channels, 5 and 6 are the bump alpha an indirect stage feeds, and 7
 * is the rasteriser's constant black.
 */
export function channelName(channel: number): string {
  switch (channel) {
    case GX.RasColorChannelID.ALPHA_BUMP: return 'Bump alpha';
    case GX.RasColorChannelID.ALPHA_BUMP_N: return 'Bump alpha, inverted';
    case GX.RasColorChannelID.COLOR_ZERO: return 'Nothing (black)';
    default: return `Vertex colour ${channel + 1}`;
  }
}

/** Every source a stage can rasterise, for the `Vertex colour` node's picker. */
export const RAS_CHANNEL_OPTIONS: NumberOption[] = options([
  [GX.RasColorChannelID.COLOR0A0, channelName(GX.RasColorChannelID.COLOR0A0)],
  [GX.RasColorChannelID.COLOR1A1, channelName(GX.RasColorChannelID.COLOR1A1)],
  [GX.RasColorChannelID.ALPHA_BUMP, channelName(GX.RasColorChannelID.ALPHA_BUMP)],
  [GX.RasColorChannelID.ALPHA_BUMP_N, channelName(GX.RasColorChannelID.ALPHA_BUMP_N)],
  [GX.RasColorChannelID.COLOR_ZERO, channelName(GX.RasColorChannelID.COLOR_ZERO)],
]);

/**
 * The four places a step's result can live, as an author reads them. "Working slot" is the one
 * every step writes to unless told otherwise and the one the next step reads without being asked;
 * the three stored slots keep a value alive across the steps in between.
 */
export function storedSlotName(slot: 'prev' | 0 | 1 | 2): string {
  return slot === 'prev' ? 'Working slot' : `Stored slot ${slot + 1}`;
}

export const STORED_SLOT_OPTIONS: Array<SelectOption<string>> = [
  { value: 'prev', label: storedSlotName('prev') },
  { value: '0', label: storedSlotName(0) },
  { value: '1', label: storedSlotName(1) },
  { value: '2', label: storedSlotName(2) },
];

/** Where a step leaves its result. Same list, phrased as a destination. */
export const OUTPUT_REGISTER_OPTIONS: Array<SelectOption<string>> = [
  { value: 'prev', label: 'Working slot (normal)' },
  { value: '0', label: 'Stored slot 1' },
  { value: '1', label: 'Stored slot 2' },
  { value: '2', label: 'Stored slot 3' },
];

/**
 * Socket names in the node graph. The compiler's names are terse (`a`, `t`, `prevAlpha`) because
 * they are identifiers; these are what the card draws next to the dot.
 */
const SOCKET_LABELS: Record<string, string> = {
  color: 'Colour',
  alpha: 'Alpha',
  rgb: 'Colour',
  uv: 'UV',
  bump: 'Bump',
  out: 'Out',
  x: 'In',
  a: 'A',
  b: 'B',
  c: 'If true',
  d: 'Plus',
  t: 'Mix',
  prev: 'After',
  prevAlpha: 'After (alpha)',
};

export function socketLabel(name: string): string {
  return SOCKET_LABELS[name] ?? name;
}
