/**
 * Section ranges of a road: the shared view of "which stretch of the road has which cross-section".
 * Used by the road mesher, the terrain flattening, KMP generation and the analysis.
 */
import type { CreateKit, Road, RoadEdge, RoadParam, RoadSection, RoadStyle, SectionKind, SurfaceRef } from './types';
import { getRoadStyle, resolveSectionStyle } from './roadStyles';
import { roadParamEnd, type RoadSample } from './spline';

/** How far beyond the road edge a fall zone reaches under a bridge or gap. */
export const FALL_RIBBON_MARGIN = 1800;

export interface SectionRange {
  road: Road;
  section: RoadSection;
  index: number;
  from: RoadParam;
  to: RoadParam;
  kind: SectionKind;
  style: RoadStyle;
  left: RoadEdge;
  right: RoadEdge;
  surface: SurfaceRef;
}

export function sectionRanges(road: Road): SectionRange[] {
  const end = roadParamEnd(road);
  const style = getRoadStyle(road.styleId);
  const out: SectionRange[] = [];
  const sections = road.sections.length > 0 ? road.sections : [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const from = section.start;
    const to = i + 1 < sections.length ? sections[i + 1].start : end;
    if (to - from < 1e-6) continue;
    const resolved = resolveSectionStyle(style, section);
    out.push({
      road,
      section,
      index: i,
      from,
      to,
      kind: section.kind,
      style,
      left: resolved.left,
      right: resolved.right,
      surface: resolved.surface,
    });
  }
  return out;
}

/** Find the section containing a parameter (closed roads wrap). */
export function sectionAt(road: Road, param: RoadParam): SectionRange | null {
  const ranges = sectionRanges(road);
  if (ranges.length === 0) return null;
  const end = roadParamEnd(road);
  let p = param;
  if (road.closed && end > 0) {
    p %= end;
    if (p < 0) p += end;
  }
  for (const r of ranges) if (p >= r.from - 1e-9 && p < r.to - 1e-9) return r;
  return ranges[ranges.length - 1];
}

/** Does this section have terrain under it (solid ground) rather than open air? */
export function isGrounded(kind: SectionKind, terrainEnabled: boolean): boolean {
  return terrainEnabled && (kind === 'road' || kind === 'tunnel');
}

/** Extra width on one side beyond the drivable surface: curb + shoulder. */
export function edgeExtra(edge: RoadEdge, curbWidth: number): number {
  return (edge.curb ? curbWidth : 0) + (edge.shoulder ? edge.shoulderWidth : 0);
}

export function footprintHalfWidth(sample: RoadSample, range: SectionRange): number {
  const extra = Math.max(edgeExtra(range.left, range.style.curbWidth), edgeExtra(range.right, range.style.curbWidth));
  return sample.width / 2 + extra;
}

export function resolveKitSurface(kit: CreateKit, ref: SurfaceRef, themeId: string) {
  return kit.resolveSurface(ref, themeId);
}
