/**
 * Parameter remapping for road edits. Sections, pieces, the start line and shortcut anchors store
 * positions as spline parameters (`i + t`); when points are inserted or deleted these maps keep
 * them at (approximately) the same place on the road.
 */
import type { Road, RoadParam } from '../types';

export type ParamMap = (u: RoadParam) => RoadParam;

export const identityMap: ParamMap = (u) => u;

/** Number of curve segments for `n` points. */
export function segmentCountFor(n: number, closed: boolean): number {
  if (n < 2) return 0;
  return closed ? n : n - 1;
}

/** A new point is inserted into segment `seg` (between points `seg` and `seg + 1`), `t` of the way along. */
export function insertMap(seg: number, t: number): ParamMap {
  const tt = Math.min(0.999, Math.max(0.001, t));
  return (u) => {
    const i = Math.floor(u + 1e-9);
    if (i < seg) return u;
    if (i === seg) {
      const s = u - seg;
      return s <= tt ? seg + s / tt : seg + 1 + (s - tt) / (1 - tt);
    }
    return u + 1;
  };
}

/** A point is added at the very start of an open road: everything shifts by one. */
export const prependMap: ParamMap = (u) => u + 1;

/**
 * Point `k` of an `n`-point road is removed. Positions on the two segments around it are squeezed
 * onto the single merged segment; positions beyond shift down by one.
 */
export function deleteMap(n: number, closed: boolean, k: number): ParamMap {
  const newN = n - 1;
  const stillClosed = closed && newN >= 3;
  const newEnd = segmentCountFor(newN, stillClosed);
  const clampEnd = (u: number) => Math.max(0, Math.min(newEnd, u));
  if (!closed) {
    if (k === 0) return (u) => clampEnd(u - 1);
    if (k === n - 1) return (u) => clampEnd(Math.min(u, n - 2));
    return (u) => {
      if (u < k - 1) return u;
      if (u < k + 1) return clampEnd(k - 1 + (u - (k - 1)) / 2);
      return clampEnd(u - 1);
    };
  }
  if (!stillClosed) {
    // The loop collapses to an open road; keep everything inside it.
    return (u) => clampEnd(u);
  }
  if (k === 0) {
    return (u) => {
      if (u < 1) return newEnd - 1 + 0.5 + u / 2; // second half of the merged last segment
      if (u >= n - 1) return newEnd - 1 + (u - (n - 1)) / 2; // first half of the merged last segment
      return u - 1;
    };
  }
  return (u) => {
    if (u < k - 1) return u;
    if (u < k + 1) return k - 1 + (u - (k - 1)) / 2;
    return u - 1;
  };
}

/** The road is reversed (points reordered keeping point 0 first on a closed road). */
export function reverseMap(road: Road): ParamMap {
  const n = road.points.length;
  const end = segmentCountFor(n, road.closed);
  if (end === 0) return identityMap;
  if (road.closed) {
    return (u) => {
      const v = (end - u) % end;
      return v < 0 ? v + end : v;
    };
  }
  return (u) => end - u;
}

/** A closed road becomes open: its closing segment vanishes. */
export function openMap(n: number): ParamMap {
  const end = n - 1;
  return (u) => Math.min(u, end);
}
