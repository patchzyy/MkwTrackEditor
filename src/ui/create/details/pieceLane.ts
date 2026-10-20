import type { Lane } from '../tools/types';

export type LaneModeValue = Lane;

/** Which lane a stored piece reads as: a width close to the road's is "full", else the nearest lane. */
export function laneOf(lateral: number, width = 0, roadWidth = 0): Lane {
  if (roadWidth > 0 && width >= roadWidth - 450) return 'full';
  if (Math.abs(lateral + 0.5) < 0.12) return 'left';
  if (Math.abs(lateral - 0.5) < 0.12) return 'right';
  if (Math.abs(lateral) < 0.12) return 'centre';
  return lateral < 0 ? 'left' : 'right';
}
