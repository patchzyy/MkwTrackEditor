// GX display lists as a register file.
//
// A BRRES material stores its state as two fixed-size GX display lists: 0x180 bytes in the
// material block (blend / depth / alpha test, TEV color and konst registers, indirect matrices,
// texgens) and 0x1E0 bytes in the shared TEV block (swap tables, the indirect texcoord refs, and
// one register set per TEV stage). Everything the renderer knows about a material comes out of
// replaying those two lists into the hardware registers.
//
// This module is the two-way version of that replay:
//
//   - `readDisplayList` walks a list and produces a `GxRegisterFile` with mask emulation, so the
//     values match what noclip's `DisplayListRegisters` would have.
//   - `writeMaterialDisplayList` / `writeTevDisplayList` emit the lists back in the byte-exact
//     layout Nintendo's exporter and BrawlBox use. Every offset here was read off retail and
//     custom-track course models (345 materials across 16 archives agreed on all of it), which is
//     what lets `applyMaterial` round trip an untouched material byte for byte.
//
// Layout of the material list (offsets from its start):
//
//   0x00 part 1  BP F3 alphaFunc, BP 40 zMode, BP FE mask 0xFFE3, BP 41 cMode0, BP 42 cMode1
//   0x20 part 2  TEV color registers C0..C2 as (RA, BG, BG, BG) triples at 0x20/0x34/0x48,
//                then the four konst colors as (RA, BG) pairs from 0x60
//   0xA0 part 3  BP 25/26 indirect texture scales, then BP 06/07/08 indirect matrix 0
//   0xE0 part 4  per texgen i: XF 0x1040+i TexMtxInfo then XF 0x1050+i PostMtxInfo, 0x12 apart
//
// Layout of the TEV list:
//
//   0x00 the four swap tables, as eight (mask 0x0F, BP F6+n) pairs 0x0A apart
//   0x50 BP 27 indirect texcoord/texmap refs
//   0x60 eight 0x30-byte stage pairs; pair k holds mask + BP F6+k konst selection, BP 28+k
//        texture/channel order, the two color envs, the two alpha envs and the two indirect
//        commands, at fixed slots so a one-stage pair leaves the odd slots zeroed.

import * as GX from '../../../vendor/noclip.website/src/gx/gx_enum';

export const MAT_DL_SIZE = 0x180;
export const TEV_DL_SIZE = 0x1e0;

const BP_MASK_REG = 0xfe;
const CMD_BP = 0x61;
const CMD_XF = 0x10;

/** Registers replayed out of a display list. `-1` means "never written". */
export interface GxRegisterFile {
  /** BP registers after mask emulation, exactly as noclip's `DisplayListRegisters.bp` sees them. */
  bp: Int32Array;
  /** Bank 0 (`tevColor`) and bank 1 (`konst`) copies of BP E0..E7, keyed `bank * 8 + (reg - 0xE0)`. */
  tevColor: Int32Array;
  /** XF registers, keyed by address. */
  xf: Map<number, number>;
}

export function createRegisterFile(): GxRegisterFile {
  return { bp: new Int32Array(0x100).fill(-1), tevColor: new Int32Array(16).fill(-1), xf: new Map() };
}

export function bpValue(regs: GxRegisterFile, reg: number): number {
  const value = regs.bp[reg];
  return value < 0 ? 0 : value & 0x00ffffff;
}

/**
 * Replays `length` bytes of display list at `offset` into `regs`. Mask writes (BP 0xFE) apply to
 * the next write only, which is how the swap tables and the konst selections share BP F6..FD.
 */
export function readDisplayList(data: Uint8Array, offset: number, length: number, regs: GxRegisterFile): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const end = Math.min(offset + length, data.length);
  let mask = 0x00ffffff;
  let at = offset;
  while (at < end) {
    const cmd = data[at];
    if (cmd === 0x00) {
      at += 1;
      continue;
    }
    if (cmd === CMD_BP) {
      if (at + 5 > end) break;
      const bag = view.getUint32(at + 1);
      const reg = bag >>> 24;
      const raw = bag & 0x00ffffff;
      if (reg === BP_MASK_REG) {
        mask = raw;
      } else {
        const previous = regs.bp[reg] < 0 ? 0 : regs.bp[reg] & 0x00ffffff;
        const merged = (previous & ~mask & 0x00ffffff) | (raw & mask);
        regs.bp[reg] = merged;
        if (reg >= 0xe0 && reg <= 0xe7) {
          const bank = (raw >>> 23) & 0x01;
          regs.tevColor[bank * 8 + (reg - 0xe0)] = raw;
        }
        mask = 0x00ffffff;
      }
      at += 5;
      continue;
    }
    if (cmd === CMD_XF) {
      if (at + 5 > end) break;
      const count = view.getUint16(at + 1) + 1;
      const addr = view.getUint16(at + 3);
      for (let i = 0; i < count && at + 5 + i * 4 + 4 <= end; i++) {
        regs.xf.set(addr + i, view.getUint32(at + 5 + i * 4));
      }
      at += 5 + count * 4;
      continue;
    }
    // Anything else is not something a material list may contain; stop rather than desync.
    break;
  }
}

// ------------------------------------------------------------------------------------- writing

class DisplayListWriter {
  public readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  public bp(at: number, reg: number, value: number): void {
    this.bytes[at] = CMD_BP;
    this.view.setUint32(at + 1, ((reg & 0xff) << 24) | (value & 0x00ffffff));
  }

  public xf(at: number, addr: number, value: number): void {
    this.bytes[at] = CMD_XF;
    this.view.setUint16(at + 1, 0);
    this.view.setUint16(at + 3, addr);
    this.view.setUint32(at + 5, value >>> 0);
  }
}

/** Where each write lands in the 0x180-byte material display list. */
export const MAT_DL = {
  alphaFunc: 0x00,
  zMode: 0x05,
  cModeMask: 0x0a,
  cMode0: 0x0f,
  cMode1: 0x14,
  /** Color register n (0..2): RA at `colorReg + n * 0x14`, then BG three times, 5 bytes apart. */
  colorReg: 0x20,
  /** Konst n (0..3): RA at `konstReg + n * 0x0a`, BG 5 bytes later. */
  konstReg: 0x60,
  indScale0: 0xa0,
  indScale1: 0xa5,
  /** Indirect matrix n: three registers at `indMatrix + n * 0x0f`, 5 bytes apart. */
  indMatrix: 0xaa,
  /** Texgen i: TexMtxInfo at `texGen + i * 0x12`, PostMtxInfo 9 bytes later. */
  texGen: 0xe0,
} as const;

/** The mask BrawlBox writes before `cMode0`: dither and the color/alpha update bits stay put. */
export const CMODE_MASK = 0x00ffe3;

export interface MaterialDlInput {
  alphaFunc: number;
  zMode: number;
  cMode0: number;
  cMode1: number;
  /** Raw 24-bit register values for C0..C2 as `[RA, BG]`. */
  colorRegs: ReadonlyArray<readonly [number, number]>;
  /** Raw 24-bit register values for K0..K3 as `[RA, BG]` (bit 23 already set). */
  konstRegs: ReadonlyArray<readonly [number, number]>;
  indScale0: number;
  indScale1: number;
  /** `null` skips the matrix (which is what a material with no indirect stages does). */
  indMatrices: ReadonlyArray<readonly [number, number, number] | null>;
  /** Per texgen: `[texMtxInfo, postMtxInfo]`. Only the first `texGens.length` slots are written. */
  texGens: ReadonlyArray<readonly [number, number]>;
}

export function writeMaterialDisplayList(input: MaterialDlInput): Uint8Array {
  const w = new DisplayListWriter(MAT_DL_SIZE);
  w.bp(MAT_DL.alphaFunc, GX.BPRegister.TEV_ALPHAFUNC_ID, input.alphaFunc);
  w.bp(MAT_DL.zMode, GX.BPRegister.PE_ZMODE_ID, input.zMode);
  w.bp(MAT_DL.cModeMask, BP_MASK_REG, CMODE_MASK);
  w.bp(MAT_DL.cMode0, GX.BPRegister.PE_CMODE0_ID, input.cMode0);
  w.bp(MAT_DL.cMode1, GX.BPRegister.PE_CMODE0_ID + 1, input.cMode1);

  // The hardware wants the "BG" half of a TEV color register latched three times; the games all
  // emit it that way and noclip's replay is order-insensitive, so match the files.
  for (let n = 0; n < 3; n++) {
    const [ra, bg] = input.colorRegs[n] ?? [0, 0];
    const base = MAT_DL.colorReg + n * 0x14;
    w.bp(base, 0xe2 + n * 2, ra);
    for (let repeat = 0; repeat < 3; repeat++) w.bp(base + 0x05 + repeat * 0x05, 0xe3 + n * 2, bg);
  }
  for (let n = 0; n < 4; n++) {
    const [ra, bg] = input.konstRegs[n] ?? [0, 0];
    const base = MAT_DL.konstReg + n * 0x0a;
    w.bp(base, 0xe0 + n * 2, ra);
    w.bp(base + 0x05, 0xe1 + n * 2, bg);
  }

  w.bp(MAT_DL.indScale0, GX.BPRegister.RAS1_SS0_ID, input.indScale0);
  w.bp(MAT_DL.indScale1, GX.BPRegister.RAS1_SS0_ID + 1, input.indScale1);
  for (let n = 0; n < 3; n++) {
    const matrix = input.indMatrices[n];
    if (!matrix) continue;
    const base = MAT_DL.indMatrix + n * 0x0f;
    for (let part = 0; part < 3; part++) w.bp(base + part * 0x05, GX.BPRegister.IND_MTXA0_ID + n * 3 + part, matrix[part]);
  }

  for (let i = 0; i < input.texGens.length; i++) {
    const base = MAT_DL.texGen + i * 0x12;
    w.xf(base, GX.XFRegister.XF_TEX0_ID + i, input.texGens[i][0]);
    w.xf(base + 0x09, GX.XFRegister.XF_DUALTEX0_ID + i, input.texGens[i][1]);
  }
  return w.bytes;
}

/** Where each write lands in the 0x1E0-byte TEV display list. */
export const TEV_DL = {
  /** Swap register n (0..7): mask at `swap + n * 0x0a`, the write 5 bytes later. */
  swap: 0x00,
  indRefs: 0x50,
  /** Stage pair k: 0x30 bytes from `pair + k * 0x30`. */
  pair: 0x60,
  pairKonstMask: 0x00,
  pairKonst: 0x05,
  pairOrder: 0x0a,
  /** Color env for the even stage; the odd stage's is 5 bytes later. */
  pairColorEnv: 0x0f,
  pairAlphaEnv: 0x19,
  pairIndCmd: 0x23,
} as const;

export const SWAP_MASK = 0x00000f;
export const KONST_SEL_MASK = 0xfffff0;

export interface TevDlInput {
  /** Eight raw swap-table register values (four tables, RG then BA). */
  swap: ReadonlyArray<number>;
  indRefs: number;
  /** Per stage pair: `[konstSel, order]`. */
  pairs: ReadonlyArray<readonly [number, number]>;
  /** Per stage: `[colorEnv, alphaEnv, indCmd]`. */
  stages: ReadonlyArray<readonly [number, number, number]>;
}

export function writeTevDisplayList(input: TevDlInput): Uint8Array {
  const w = new DisplayListWriter(TEV_DL_SIZE);
  for (let n = 0; n < 8; n++) {
    const base = TEV_DL.swap + n * 0x0a;
    w.bp(base, BP_MASK_REG, SWAP_MASK);
    w.bp(base + 0x05, GX.BPRegister.TEV_KSEL_0_ID + n, input.swap[n] ?? 0);
  }
  w.bp(TEV_DL.indRefs, GX.BPRegister.RAS1_IREF_ID, input.indRefs);

  const pairCount = Math.ceil(input.stages.length / 2);
  for (let k = 0; k < pairCount; k++) {
    const base = TEV_DL.pair + k * 0x30;
    w.bp(base + TEV_DL.pairKonstMask, BP_MASK_REG, KONST_SEL_MASK);
    w.bp(base + TEV_DL.pairKonst, GX.BPRegister.TEV_KSEL_0_ID + k, input.pairs[k][0]);
    w.bp(base + TEV_DL.pairOrder, GX.BPRegister.RAS1_TREF_0_ID + k, input.pairs[k][1]);
    for (let half = 0; half < 2; half++) {
      const stage = input.stages[k * 2 + half];
      if (!stage) break;
      w.bp(base + TEV_DL.pairColorEnv + half * 0x05, GX.BPRegister.TEV_COLOR_ENV_0_ID + (k * 2 + half) * 2, stage[0]);
      w.bp(base + TEV_DL.pairAlphaEnv + half * 0x05, GX.BPRegister.TEV_ALPHA_ENV_0_ID + (k * 2 + half) * 2, stage[1]);
      w.bp(base + TEV_DL.pairIndCmd + half * 0x05, GX.BPRegister.IND_CMD0_ID + k * 2 + half, stage[2]);
    }
  }
  return w.bytes;
}

// ------------------------------------------------------------------------------- bit packing

/** Sign-extends the low `bits` of `value`. */
export function signExtend(value: number, bits: number): number {
  const shift = 32 - bits;
  return (value << shift) >> shift;
}

export function packBits(fields: ReadonlyArray<readonly [value: number, shift: number, width: number]>): number {
  let out = 0;
  for (const [value, shift, width] of fields) {
    const mask = width >= 32 ? 0xffffffff : (1 << width) - 1;
    out |= (value & mask) << shift;
  }
  return out >>> 0;
}

/** True when a TEV op is one of the eight compare ops (which reuse the bias/scale fields). */
export function isCompareOp(op: GX.TevOp): boolean {
  return op >= GX.TevOp.COMP_R8_GT;
}

/** The "subtract" bit of a color/alpha env register, which also picks EQ over GT for compares. */
export function tevOpSubtractBit(op: GX.TevOp): boolean {
  if (isCompareOp(op)) return (op & 1) === 1;
  return op === GX.TevOp.SUB;
}
