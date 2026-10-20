/**
 * KCL flag helpers local to the generators (the writers workstream has its own `kclFlag()`; these
 * constants are deliberately duplicated so generation never depends on writer code).
 * Layout of the u16: `type | variant << 5 | blight << 8 | wheelDepth << 11 | trickable (bit 13) |
 * offroad-ish (bit 14) | soft (bit 15)`.
 */

export const KCL_TYPE = {
  ROAD: 0x00,
  SLIPPERY_ROAD: 0x01,
  WEAK_OFF_ROAD: 0x02,
  OFF_ROAD: 0x03,
  HEAVY_OFF_ROAD: 0x04,
  BOOST_PANEL: 0x06,
  BOOST_RAMP: 0x07,
  JUMP_PAD: 0x08,
  SOLID_FALL: 0x0a,
  MOVING_WATER: 0x0b,
  WALL: 0x0c,
  INVISIBLE_WALL: 0x0d,
  ITEM_WALL: 0x0e,
  WALL_2: 0x0f,
  FALL_BOUNDARY: 0x10,
  HALFPIPE_RAMP: 0x13,
  ROAD_2: 0x17,
  WEAK_WALL: 0x19,
  INVISIBLE_WALL_2: 0x1f,
} as const;

export const KCL_TRICKABLE_BIT = 0x2000;

export function makeKclFlag(type: number, variant = 0, extra = 0): number {
  return (type & 0x1f) | ((variant & 0x7) << 5) | extra;
}

/** Retail trick ramp: ordinary road (variant 1) with the trickable bit. */
export const FLAG_TRICK_RAMP = makeKclFlag(KCL_TYPE.ROAD, 1, KCL_TRICKABLE_BIT);
export const FLAG_BOOST_PANEL = makeKclFlag(KCL_TYPE.BOOST_PANEL);
export const FLAG_BOOST_RAMP = makeKclFlag(KCL_TYPE.BOOST_RAMP);
export const FLAG_WALL = makeKclFlag(KCL_TYPE.WALL);
export const FLAG_INVISIBLE_WALL = makeKclFlag(KCL_TYPE.INVISIBLE_WALL);
export const FLAG_FALL_BOUNDARY = makeKclFlag(KCL_TYPE.FALL_BOUNDARY);

const WALL_TYPES = new Set<number>([0x0c, 0x0d, 0x0e, 0x0f, 0x14, 0x19, 0x1c, 0x1e, 0x1f]);
const FALL_TYPES = new Set<number>([0x0a, 0x10]);

export function isWallFlag(flag: number): boolean {
  return WALL_TYPES.has(flag & 0x1f);
}

export function isFallFlag(flag: number): boolean {
  return FALL_TYPES.has(flag & 0x1f);
}

/** Types a kart can drive on (matches `kcl.ts`). */
export function isDrivableFlag(flag: number): boolean {
  const t = flag & 0x1f;
  return t <= 0x09 || t === 0x0b || t === 0x13 || t === 0x15 || t === 0x16 || t === 0x17 || t === 0x1d;
}

/** Drivable and not an off-road/water surface (what counts as "the road" for gameplay checks). */
export function isRoadLikeFlag(flag: number): boolean {
  const t = flag & 0x1f;
  return t === 0x00 || t === 0x01 || t === 0x05 || t === 0x06 || t === 0x07 || t === 0x08 || t === 0x09 || t === 0x17;
}
