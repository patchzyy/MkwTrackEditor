import type { Road, RoadSection } from '../types';
import { createId } from '../ids';
import { segmentCountFor } from './paramMap';

/**
 * Restores the section invariants: at least one section, sorted by start, no duplicate starts,
 * `sections[0].start === 0`, every start inside `[0, end)`.
 */
export function normalizeSections(road: Road): Road {
  const end = segmentCountFor(road.points.length, road.closed);
  let list = road.sections.map((s) => ({ ...s }));
  if (list.length === 0) list = [{ id: createId('sec'), start: 0, kind: 'road' }];
  list = list.map((s) => {
    let start = Number.isFinite(s.start) ? s.start : 0;
    if (end > 0) {
      if (road.closed) {
        start %= end;
        if (start < 0) start += end;
      } else start = Math.max(0, Math.min(end - 1e-6, start));
    } else start = 0;
    return { ...s, start };
  });
  list.sort((a, b) => a.start - b.start);
  // Sections that start (almost) where the previous one does collapse; the later one wins.
  const dedup: RoadSection[] = [];
  for (const s of list) {
    const last = dedup[dedup.length - 1];
    if (last && s.start - last.start < 1e-6) dedup[dedup.length - 1] = { ...s, start: last.start };
    else dedup.push(s);
  }
  if (dedup[0].start > 1e-6) {
    if (road.closed) {
      const last = dedup[dedup.length - 1];
      dedup.unshift({ ...last, id: createId('sec'), start: 0 });
    } else dedup[0] = { ...dedup[0], start: 0 };
  } else dedup[0] = { ...dedup[0], start: 0 };
  return { ...road, sections: dedup };
}
