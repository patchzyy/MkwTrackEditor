/**
 * KCL collision flags.
 *
 * Every collision triangle carries one 16-bit flag word (Kinoko: `KCollisionTypes.hh`):
 *
 *   15       14          13        12 11        10 9 8     7 6 5     4 3 2 1 0
 *   softWall rejectRoad  trickable wheelDepth   blight     variant   base type
 *
 * `kclFlag(type, variant, opts)` builds the word; `describeKclFlag` in `../../kcl.ts` takes it
 * apart again (it does not know bit 14, "reject road", which only a few retail walls use).
 */

// Base types, exactly the 32 entries of `collisionTypes` in `../../kcl.ts`.
export const KCL_ROAD = 0x00;
/** Sand / dirt style slippery road (Dry Dry Ruins). */
export const KCL_SLIPPERY_ROAD = 0x01;
export const KCL_WEAK_OFF_ROAD = 0x02;
export const KCL_OFF_ROAD = 0x03;
export const KCL_HEAVY_OFF_ROAD = 0x04;
/** Ice style slippery road (N64 Sherbet Land). */
export const KCL_SLIPPERY_ROAD_ICE = 0x05;
export const KCL_BOOST_PANEL = 0x06;
export const KCL_BOOST_RAMP = 0x07;
/** Kinoko calls it a jump pad (GBA Shy Guy Beach); `kcl.ts` calls it "Slow Ramp". */
export const KCL_JUMP_PAD = 0x08;
export const KCL_SLOW_RAMP = KCL_JUMP_PAD;
/** Road that is only solid for items. */
export const KCL_ITEM_ROAD = 0x09;
export const KCL_SOLID_FALL = 0x0a;
export const KCL_MOVING_WATER = 0x0b;
export const KCL_WALL = 0x0c;
export const KCL_INVISIBLE_WALL = 0x0d;
/** Wall that is only solid for items. */
export const KCL_ITEM_WALL = 0x0e;
export const KCL_WALL_2 = 0x0f;
export const KCL_FALL_BOUNDARY = 0x10;
export const KCL_CANNON_ACTIVATOR = 0x11;
export const KCL_FORCE_RECALCULATION = 0x12;
export const KCL_HALF_PIPE_RAMP = 0x13;
/** Items pass through, players do not. */
export const KCL_PLAYER_ONLY_WALL = 0x14;
export const KCL_MOVING_ROAD = 0x15;
export const KCL_STICKY_ROAD = 0x16;
/** Same as `KCL_ROAD` with more variants. */
export const KCL_ROAD_2 = 0x17;
export const KCL_SOUND_TRIGGER = 0x18;
export const KCL_WEAK_WALL = 0x19;
export const KCL_EFFECT_TRIGGER = 0x1a;
export const KCL_ITEM_STATE_MODIFIER = 0x1b;
export const KCL_HALF_PIPE_INVISIBLE_WALL = 0x1c;
export const KCL_ROTATING_ROAD = 0x1d;
export const KCL_SPECIAL_WALL = 0x1e;
/** Identical to `KCL_INVISIBLE_WALL`. */
export const KCL_INVISIBLE_WALL_2 = 0x1f;

export interface KclFlagOptions {
  /** 0..7: which `posteffect.blight` light set lights karts on this surface. */
  blight?: number;
  /** 0..3: how far the wheels sink. */
  wheelDepth?: number;
  /** Jumping off this surface performs a trick. */
  trickable?: boolean;
  /** Karts pass through the wall, bikes do not (bit 15). */
  softWall?: boolean;
  /** Bit 14: "reject road" (the surface does not count as road under a wall). */
  rejectRoad?: boolean;
}

const TRICKABLE_BIT = 0x2000;
const REJECT_ROAD_BIT = 0x4000;
const SOFT_WALL_BIT = 0x8000;

function checkRange(name: string, value: number, max: number): number {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`KCL flag ${name} must be an integer 0..${max}, got ${value}`);
  return value;
}

/** Builds a full 16-bit KCL flag word. */
export function kclFlag(type: number, variant = 0, opts: KclFlagOptions = {}): number {
  let flag = checkRange('type', type, 0x1f);
  flag |= checkRange('variant', variant, 7) << 5;
  flag |= checkRange('blight', opts.blight ?? 0, 7) << 8;
  flag |= checkRange('wheelDepth', opts.wheelDepth ?? 0, 3) << 11;
  if (opts.trickable) flag |= TRICKABLE_BIT;
  if (opts.rejectRoad) flag |= REJECT_ROAD_BIT;
  if (opts.softWall) flag |= SOFT_WALL_BIT;
  return flag;
}

/** The pieces of a flag word, the inverse of `kclFlag`. */
export function splitKclFlag(flag: number): { type: number; variant: number; blight: number; wheelDepth: number; trickable: boolean; rejectRoad: boolean; softWall: boolean } {
  return {
    type: flag & 0x1f,
    variant: (flag >>> 5) & 7,
    blight: (flag >>> 8) & 7,
    wheelDepth: (flag >>> 11) & 3,
    trickable: (flag & TRICKABLE_BIT) !== 0,
    rejectRoad: (flag & REJECT_ROAD_BIT) !== 0,
    softWall: (flag & SOFT_WALL_BIT) !== 0,
  };
}

/** Returns `flag` with a different light set (bits 8..10). */
export function withBlight(flag: number, blight: number): number {
  return (flag & ~(7 << 8)) | (checkRange('blight', blight, 7) << 8);
}

/** Returns `flag` with a different variant (bits 5..7). */
export function withVariant(flag: number, variant: number): number {
  return (flag & ~(7 << 5)) | (checkRange('variant', variant, 7) << 5);
}

/** Types a kart drives on (the road-like ones a start line or boost panel can sit on). */
export function isDrivableKclType(type: number): boolean {
  return DRIVABLE.has(type & 0x1f);
}

/** Types that stop a kart. */
export function isWallKclType(type: number): boolean {
  return WALLS.has(type & 0x1f);
}

const DRIVABLE = new Set([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0a, 0x0b, 0x13, 0x15, 0x16, 0x17, 0x1d]);
const WALLS = new Set([0x0c, 0x0d, 0x0e, 0x0f, 0x14, 0x19, 0x1c, 0x1e, 0x1f]);
