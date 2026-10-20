/**
 * Road spline: centripetal Catmull-Rom through `RoadPoint`s, arc-length resampling, frames with
 * bank, projection and parameter/distance conversion.
 *
 * Parameters (`RoadParam`) are `i + t`: `t` of the way from control point `i` to `i + 1` (wrapping
 * on a closed road). A road with `n` points has `n` segments when closed and `n - 1` when open.
 * `paramEnd(road)` is the parameter one past the last point (== `n` closed, `n - 1` open).
 *
 * Conventions (all shared with the rest of Create mode):
 *  - heading/forward: yaw `h` degrees ⇒ forward = (sin h, 0, cos h), as the KMP and Kinoko do;
 *  - `right` is the horizontal-ish vector to the right of `tangent` with +Y up: (-fz, 0, fx);
 *  - `up = right × tangent`; bank rolls the frame around the tangent, positive bank tilts the
 *    right edge down;
 *  - `curvature` is signed 1/units on the XZ plane, positive when the road turns right.
 */
import type { CreateProject, Road, RoadParam, Vec3 } from './types';
import { DEG2RAD, smoothstep } from './math';

export interface RoadSample {
  param: RoadParam;
  /** Distance along the road from parameter 0. */
  distance: number;
  /** Centre of the drivable surface. */
  position: Vec3;
  tangent: Vec3;
  /** Banked right vector (unit). */
  right: Vec3;
  /** Banked up vector (unit). */
  up: Vec3;
  /** Drivable width at this sample. */
  width: number;
  /** Bank in degrees. */
  bank: number;
  /** Signed horizontal curvature, 1/unit, positive = turning right. */
  curvature: number;
  /** Multiply lateral offsets by this (>= 1) so a `sharp` corner keeps its edge widths (miter). */
  lateralScale: number;
  /** True when this sample sits exactly on a control point. */
  isPoint: boolean;
}

/** The samples of one road, in order along it (what `sampleRoad` returns). */
export type RoadSamples = RoadSample[];

export interface SampleOptions {
  /** Target arc-length spacing between samples. Default 250. */
  step?: number;
  /** Extra samples are inserted so the heading never turns by more than this between two. Default 7. */
  maxAngleDegrees?: number;
}

export interface RoadProjection {
  /** Closest parameter on the centre line. */
  param: RoadParam;
  /** Distance along the road from parameter 0. */
  distance: number;
  /** Signed lateral offset in units, positive to the right of the driving direction. */
  lateral: number;
  /** `lateral` divided by half the road width there: -1 = left edge, +1 = right edge. */
  lateralNorm: number;
  /** The point on the centre line. */
  position: Vec3;
  /** Horizontal distance from the query point to the centre line. */
  distanceToCenter: number;
  /** The interpolated frame at `param`. */
  sample: RoadSample;
}

export interface ProjectOptions {
  /**
   * When the query point has a finite `y`, vertical separation counts (scaled by this factor)
   * towards "closest", so the right layer of an overpass is found. Default 0.25; 0 ignores height.
   */
  heightWeight?: number;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Curve construction
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface Segment {
  p: Float64Array; // 12 floats: p0 p1 p2 p3
  t: Float64Array; // 4 knots
  /** The end point at the start/end of this segment is a sharp corner. */
  sharpStart: boolean;
  sharpEnd: boolean;
}

interface RoadCurve {
  road: Road;
  n: number;
  closed: boolean;
  segCount: number;
  paramEnd: number;
  segs: Segment[];
  denseParam: Float64Array;
  denseDist: Float64Array;
  length: number;
  projection?: ProjectionTable;
}

interface ProjectionTable {
  count: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  param: Float64Array;
  distance: Float64Array;
  samples: RoadSample[];
}

const curveCache = new WeakMap<Road, RoadCurve>();
const EPS = 1e-4;

function knotStep(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const d = Math.hypot(bx - ax, by - ay, bz - az);
  return Math.sqrt(Math.max(d, EPS));
}

function buildSegment(
  road: Road,
  i: number,
  n: number,
  closed: boolean,
): Segment {
  const pts = road.points;
  const at = (k: number) => pts[((k % n) + n) % n].position;
  const p1 = at(i);
  const p2 = at(i + 1);
  const sharpStart = pts[i % n].corner === 'sharp';
  const sharpEnd = pts[(i + 1) % n].corner === 'sharp';
  let p0: Vec3;
  let p3: Vec3;
  if (sharpStart || (!closed && i === 0)) p0 = { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y, z: 2 * p1.z - p2.z };
  else p0 = at(i - 1);
  if (sharpEnd || (!closed && i + 1 === n - 1)) p3 = { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y, z: 2 * p2.z - p1.z };
  else p3 = at(i + 2);
  const p = new Float64Array([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z]);
  const t = new Float64Array(4);
  t[0] = 0;
  t[1] = t[0] + knotStep(p[0], p[1], p[2], p[3], p[4], p[5]);
  t[2] = t[1] + knotStep(p[3], p[4], p[5], p[6], p[7], p[8]);
  t[3] = t[2] + knotStep(p[6], p[7], p[8], p[9], p[10], p[11]);
  return { p, t, sharpStart, sharpEnd };
}

/** Evaluate segment position at u in [0,1] into `out[0..2]`. */
function evalSegment(seg: Segment, u: number, out: Float64Array | number[]): void {
  const { p, t } = seg;
  const tt = t[1] + (t[2] - t[1]) * u;
  const d01 = t[1] - t[0];
  const d12 = t[2] - t[1];
  const d23 = t[3] - t[2];
  const d02 = t[2] - t[0];
  const d13 = t[3] - t[1];
  for (let c = 0; c < 3; c++) {
    const P0 = p[c];
    const P1 = p[3 + c];
    const P2 = p[6 + c];
    const P3 = p[9 + c];
    const A1 = ((t[1] - tt) / d01) * P0 + ((tt - t[0]) / d01) * P1;
    const A2 = ((t[2] - tt) / d12) * P1 + ((tt - t[1]) / d12) * P2;
    const A3 = ((t[3] - tt) / d23) * P2 + ((tt - t[2]) / d23) * P3;
    const B1 = ((t[2] - tt) / d02) * A1 + ((tt - t[0]) / d02) * A2;
    const B2 = ((t[3] - tt) / d13) * A2 + ((tt - t[1]) / d13) * A3;
    out[c] = ((t[2] - tt) / d12) * B1 + ((tt - t[1]) / d12) * B2;
  }
}

const tmpA = new Float64Array(3);
const tmpB = new Float64Array(3);

function segmentTangent(seg: Segment, u: number, out: Float64Array | number[]): void {
  const h = 1e-3;
  const u0 = Math.max(0, u - h);
  const u1 = Math.min(1, u + h);
  evalSegment(seg, u0, tmpA);
  evalSegment(seg, u1, tmpB);
  let x = tmpB[0] - tmpA[0];
  let y = tmpB[1] - tmpA[1];
  let z = tmpB[2] - tmpA[2];
  let l = Math.hypot(x, y, z);
  if (l < 1e-9) {
    // Degenerate (duplicate points): fall back to the chord of the whole segment.
    x = seg.p[6] - seg.p[3];
    y = seg.p[7] - seg.p[4];
    z = seg.p[8] - seg.p[5];
    l = Math.hypot(x, y, z);
    if (l < 1e-9) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 1;
      return;
    }
  }
  out[0] = x / l;
  out[1] = y / l;
  out[2] = z / l;
}

function getCurve(road: Road): RoadCurve {
  const cached = curveCache.get(road);
  if (cached) return cached;
  const n = road.points.length;
  const closed = road.closed && n >= 2;
  const segCount = n < 2 ? 0 : closed ? n : n - 1;
  const segs: Segment[] = [];
  for (let i = 0; i < segCount; i++) segs.push(buildSegment(road, i, n, closed));

  // Dense table for param <-> distance conversion.
  const params: number[] = [];
  const dists: number[] = [];
  let acc = 0;
  const prev = new Float64Array(3);
  const cur = new Float64Array(3);
  for (let i = 0; i < segCount; i++) {
    const seg = segs[i];
    const chord = Math.hypot(seg.p[6] - seg.p[3], seg.p[7] - seg.p[4], seg.p[8] - seg.p[5]);
    const sub = Math.max(8, Math.min(160, Math.ceil(chord / 100)));
    for (let k = 0; k <= sub; k++) {
      if (k === 0 && i > 0) continue; // shared with the previous segment's end
      const u = k / sub;
      evalSegment(seg, u, cur);
      if (params.length > 0) acc += Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
      params.push(i + u);
      dists.push(acc);
      prev[0] = cur[0];
      prev[1] = cur[1];
      prev[2] = cur[2];
    }
  }
  if (params.length === 0) {
    params.push(0);
    dists.push(0);
  }
  const curve: RoadCurve = {
    road,
    n,
    closed,
    segCount,
    paramEnd: segCount,
    segs,
    denseParam: Float64Array.from(params),
    denseDist: Float64Array.from(dists),
    length: acc,
  };
  curveCache.set(road, curve);
  return curve;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Public parameter helpers
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Number of curve segments (0 for fewer than two points). */
export function roadSegmentCount(road: Road): number {
  return getCurve(road).segCount;
}

/** The parameter one past the last point: `n` closed, `n - 1` open. */
export function roadParamEnd(road: Road): RoadParam {
  const c = getCurve(road);
  return c.segCount;
}

/** Total length of the centre line (for a closed road, the whole lap). */
export function roadLength(road: Road): number {
  return getCurve(road).length;
}

/** Wraps (closed) or clamps (open) a parameter into `[0, paramEnd]`. Closed roads map to `[0, end)`. */
export function normalizeRoadParam(road: Road, param: RoadParam): RoadParam {
  const c = getCurve(road);
  if (c.segCount === 0) return 0;
  if (c.closed) {
    const v = param % c.paramEnd;
    return v < 0 ? v + c.paramEnd : v;
  }
  return param < 0 ? 0 : param > c.paramEnd ? c.paramEnd : param;
}

function bisect(arr: Float64Array, value: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Distance along the road at `param` (clamped to the road for an open road; wrapped for a closed one). */
export function roadParamToDistance(road: Road, param: RoadParam): number {
  const c = getCurve(road);
  if (c.segCount === 0) return 0;
  let p = param;
  let lapOffset = 0;
  if (c.closed) {
    const wraps = Math.floor(p / c.paramEnd);
    p -= wraps * c.paramEnd;
    lapOffset = wraps * c.length;
  } else p = Math.max(0, Math.min(c.paramEnd, p));
  const hi = bisect(c.denseParam, p);
  if (hi === 0) return lapOffset + c.denseDist[0];
  const lo = hi - 1;
  const span = c.denseParam[hi] - c.denseParam[lo];
  const t = span > 1e-12 ? (p - c.denseParam[lo]) / span : 0;
  return lapOffset + c.denseDist[lo] + (c.denseDist[hi] - c.denseDist[lo]) * t;
}

/** Inverse of {@link roadParamToDistance}. A closed road wraps; an open road clamps. */
export function distanceToRoadParam(road: Road, distance: number): RoadParam {
  const c = getCurve(road);
  if (c.segCount === 0) return 0;
  let d = distance;
  if (c.closed) {
    if (c.length <= 0) return 0;
    d -= Math.floor(d / c.length) * c.length;
  } else d = Math.max(0, Math.min(c.length, d));
  const hi = bisect(c.denseDist, d);
  if (hi === 0) return c.denseParam[0];
  const lo = hi - 1;
  const span = c.denseDist[hi] - c.denseDist[lo];
  const t = span > 1e-12 ? (d - c.denseDist[lo]) / span : 0;
  return c.denseParam[lo] + (c.denseParam[hi] - c.denseParam[lo]) * t;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Frames
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface Located {
  seg: number;
  u: number;
}

function locate(c: RoadCurve, param: number): Located {
  if (c.segCount === 0) return { seg: 0, u: 0 };
  let p = param;
  if (c.closed) {
    p = p % c.paramEnd;
    if (p < 0) p += c.paramEnd;
    // A parameter exactly at the end of an open range is handled by the caller via `paramEnd`.
  } else p = Math.max(0, Math.min(c.paramEnd, p));
  let seg = Math.floor(p);
  if (seg >= c.segCount) seg = c.segCount - 1;
  return { seg, u: p - seg };
}

function pointAttr(road: Road, index: number, c: RoadCurve): { width: number; bank: number } {
  const pt = road.points[((index % c.n) + c.n) % c.n];
  return { width: pt.width, bank: pt.bank };
}

function buildFrame(
  tx: number,
  ty: number,
  tz: number,
  bankDeg: number,
  prevRight: { x: number; z: number } | null,
): { tangent: Vec3; right: Vec3; up: Vec3 } {
  const h = Math.hypot(tx, tz);
  let rx: number;
  let rz: number;
  if (h < 1e-4) {
    rx = prevRight ? prevRight.x : 1;
    rz = prevRight ? prevRight.z : 0;
  } else {
    rx = -tz / h;
    rz = tx / h;
  }
  // up0 = right0 × tangent, with right0 = (rx, 0, rz)
  let ux = -rz * ty;
  let uy = rz * tx - rx * tz;
  let uz = rx * ty;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const th = bankDeg * DEG2RAD;
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  return {
    tangent: { x: tx, y: ty, z: tz },
    right: { x: rx * cs - ux * sn, y: -uy * sn, z: rz * cs - uz * sn },
    up: { x: ux * cs + rx * sn, y: uy * cs, z: uz * cs + rz * sn },
  };
}

/** Exact frame at a parameter. A `sharp` point returns the miter frame. */
export function evaluateRoadAt(road: Road, param: RoadParam): RoadSample {
  return frameAt(getCurve(road), param, null);
}

function emptySample(road: Road): RoadSample {
  const pt = road.points[0];
  const fr = buildFrame(0, 0, 1, pt?.bank ?? 0, null);
  return {
    param: 0,
    distance: 0,
    position: pt ? { ...pt.position } : { x: 0, y: 0, z: 0 },
    ...fr,
    width: pt?.width ?? 0,
    bank: pt?.bank ?? 0,
    curvature: 0,
    lateralScale: 1,
    isPoint: true,
  };
}

function frameAt(c: RoadCurve, param: number, prevRight: { x: number; z: number } | null): RoadSample {
  const road = c.road;
  if (c.segCount === 0) return emptySample(road);
  const raw = c.closed ? param : Math.max(0, Math.min(c.paramEnd, param));
  const loc = locate(c, raw);
  const seg = c.segs[loc.seg];
  const pos = [0, 0, 0];
  evalSegment(seg, loc.u, pos);
  const tan = [0, 0, 0];
  segmentTangent(seg, loc.u, tan);

  const a = pointAttr(road, loc.seg, c);
  const b = pointAttr(road, loc.seg + 1, c);
  const e = smoothstep(loc.u);
  const width = a.width + (b.width - a.width) * e;
  const bank = a.bank + (b.bank - a.bank) * e;

  let isPoint = false;
  let lateralScale = 1;
  const eps = 1e-6;
  if (loc.u < eps || loc.u > 1 - eps) {
    isPoint = true;
    const pointIndex = loc.u < eps ? loc.seg : loc.seg + 1;
    const wrapIndex = ((pointIndex % c.n) + c.n) % c.n;
    if (road.points[wrapIndex].corner === 'sharp') {
      const inIndex = c.closed ? (((pointIndex - 1) % c.segCount) + c.segCount) % c.segCount : pointIndex - 1;
      const outIndex = c.closed ? pointIndex % c.segCount : pointIndex;
      const inSeg = inIndex >= 0 && inIndex < c.segCount ? c.segs[inIndex] : null;
      const outSeg = outIndex >= 0 && outIndex < c.segCount ? c.segs[outIndex] : null;
      if (inSeg && outSeg) {
        const ti = [0, 0, 0];
        const to = [0, 0, 0];
        segmentTangent(inSeg, 1, ti);
        segmentTangent(outSeg, 0, to);
        let bx = ti[0] + to[0];
        let by = ti[1] + to[1];
        let bz = ti[2] + to[2];
        const bl = Math.hypot(bx, by, bz);
        if (bl > 1e-6) {
          bx /= bl;
          by /= bl;
          bz /= bl;
          const cosHalf = Math.max(0, ti[0] * bx + ti[1] * by + ti[2] * bz);
          lateralScale = 1 / Math.max(cosHalf, 0.4);
          tan[0] = bx;
          tan[1] = by;
          tan[2] = bz;
        }
      }
    }
  }
  const fr = buildFrame(tan[0], tan[1], tan[2], bank, prevRight);
  return {
    param: raw,
    distance: roadParamToDistance(road, raw),
    position: { x: pos[0], y: pos[1], z: pos[2] },
    tangent: fr.tangent,
    right: fr.right,
    up: fr.up,
    width,
    bank,
    curvature: 0,
    lateralScale,
    isPoint,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Sampling
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Samples the whole road: from parameter 0 to `roadParamEnd(road)` inclusive (a closed road gets a
 * final sample that repeats the first position, with `param == end` and `distance == length`).
 */
export function sampleRoad(road: Road, options: SampleOptions = {}): RoadSamples {
  const c = getCurve(road);
  if (c.segCount === 0) return road.points.length === 0 ? [] : [emptySample(road)];
  return sampleRoadRange(road, 0, c.paramEnd, options);
}

/**
 * Samples `[from, to]` (parameters, `to >= from`; for a closed road `to` may exceed the end to wrap
 * around). The first and last samples are exactly at `from` and `to`, so adjacent ranges meet
 * seamlessly; sharp control points inside the range always get a sample.
 */
export function sampleRoadRange(road: Road, from: RoadParam, to: RoadParam, options: SampleOptions = {}): RoadSample[] {
  const c = getCurve(road);
  if (c.segCount === 0) return road.points.length === 0 ? [] : [emptySample(road)];
  const step = Math.max(20, options.step ?? 250);
  const maxAngle = Math.max(1, options.maxAngleDegrees ?? 7) * DEG2RAD;
  const probeSpacing = Math.min(200, Math.max(40, step / 4));
  const lo = from;
  const hi = Math.max(from, to);

  const samples: RoadSample[] = [];
  let prevRight: { x: number; z: number } | null = null;
  const push = (param: number) => {
    const s = frameAt(c, param, prevRight);
    prevRight = { x: s.right.x, z: s.right.z };
    samples.push(s);
    return s;
  };

  const first = push(lo);
  if (hi - lo < 1e-9) {
    finishCurvature(samples);
    return samples;
  }
  let lastDist = first.distance;
  let hx = first.tangent.x;
  let hy = first.tangent.y;
  let hz = first.tangent.z;
  const tan = [0, 0, 0];

  let cursor = lo;
  while (cursor < hi - 1e-9) {
    const nextAnchor = Math.floor(cursor + 1e-9) + 1;
    const segEnd = Math.min(hi, nextAnchor);
    const dStart = roadParamToDistance(road, cursor);
    const dEnd = roadParamToDistance(road, segEnd);
    const probes = Math.max(2, Math.ceil(Math.abs(dEnd - dStart) / probeSpacing));
    for (let k = 1; k < probes; k++) {
      const pParam = cursor + ((segEnd - cursor) * k) / probes;
      const loc = locate(c, pParam);
      segmentTangent(c.segs[loc.seg], loc.u, tan);
      const dist = roadParamToDistance(road, pParam);
      const dotp = Math.max(-1, Math.min(1, tan[0] * hx + tan[1] * hy + tan[2] * hz));
      if (dist - lastDist >= step || Math.acos(dotp) >= maxAngle) {
        const s = push(pParam);
        lastDist = s.distance;
        hx = tan[0];
        hy = tan[1];
        hz = tan[2];
      }
    }
    if (segEnd < hi - 1e-9) {
      // An interior control point: sharp ones always get a sample; smooth ones only if not redundant.
      const pointIndex = ((Math.round(segEnd) % c.n) + c.n) % c.n;
      const sharp = road.points[pointIndex]?.corner === 'sharp';
      if (sharp || dEnd - lastDist >= step * 0.35) {
        const s = push(segEnd);
        lastDist = s.distance;
        hx = s.tangent.x;
        hy = s.tangent.y;
        hz = s.tangent.z;
      }
    }
    cursor = segEnd;
  }
  push(hi);
  finishCurvature(samples);
  return samples;
}

/** Fills `curvature` from the heading change between neighbouring samples. */
function finishCurvature(samples: RoadSample[]): void {
  const n = samples.length;
  if (n < 2) return;
  const heading = (s: RoadSample) => Math.atan2(s.tangent.x, s.tangent.z);
  for (let i = 0; i < n; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(n - 1, i + 1)];
    const span = b.distance - a.distance;
    if (span < 1e-6) continue;
    let d = heading(b) - heading(a);
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    // heading decreases when turning right
    samples[i].curvature = -d / span;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Projection
// ─────────────────────────────────────────────────────────────────────────────────────────────

function getProjectionTable(c: RoadCurve): ProjectionTable {
  if (c.projection) return c.projection;
  const samples = c.segCount === 0 ? (c.road.points.length ? [emptySample(c.road)] : []) : sampleRoadRange(c.road, 0, c.paramEnd, { step: 160, maxAngleDegrees: 6 });
  const count = samples.length;
  const table: ProjectionTable = {
    count,
    x: new Float64Array(count),
    y: new Float64Array(count),
    z: new Float64Array(count),
    param: new Float64Array(count),
    distance: new Float64Array(count),
    samples,
  };
  for (let i = 0; i < count; i++) {
    table.x[i] = samples[i].position.x;
    table.y[i] = samples[i].position.y;
    table.z[i] = samples[i].position.z;
    table.param[i] = samples[i].param;
    table.distance[i] = samples[i].distance;
  }
  c.projection = table;
  return table;
}

function lerpSample(a: RoadSample, b: RoadSample, t: number): RoadSample {
  const l = (p: number, q: number) => p + (q - p) * t;
  const tx = l(a.tangent.x, b.tangent.x);
  const ty = l(a.tangent.y, b.tangent.y);
  const tz = l(a.tangent.z, b.tangent.z);
  const tl = Math.hypot(tx, ty, tz) || 1;
  const rx = l(a.right.x, b.right.x);
  const ry = l(a.right.y, b.right.y);
  const rz = l(a.right.z, b.right.z);
  const rl = Math.hypot(rx, ry, rz) || 1;
  const ux = l(a.up.x, b.up.x);
  const uy = l(a.up.y, b.up.y);
  const uz = l(a.up.z, b.up.z);
  const ul = Math.hypot(ux, uy, uz) || 1;
  return {
    param: l(a.param, b.param),
    distance: l(a.distance, b.distance),
    position: { x: l(a.position.x, b.position.x), y: l(a.position.y, b.position.y), z: l(a.position.z, b.position.z) },
    tangent: { x: tx / tl, y: ty / tl, z: tz / tl },
    right: { x: rx / rl, y: ry / rl, z: rz / rl },
    up: { x: ux / ul, y: uy / ul, z: uz / ul },
    width: l(a.width, b.width),
    bank: l(a.bank, b.bank),
    curvature: l(a.curvature, b.curvature),
    lateralScale: l(a.lateralScale, b.lateralScale),
    isPoint: false,
  };
}

/**
 * Closest point of a road's centre line to `point`. Returns `null` for an empty road. Uses a cached
 * sample table, so it is cheap enough to call on every pointer move.
 */
export function projectOntoRoad(
  road: Road,
  point: { x: number; y?: number; z: number },
  options: ProjectOptions = {},
): RoadProjection | null {
  const c = getCurve(road);
  const table = getProjectionTable(c);
  if (table.count === 0) return null;
  if (table.count === 1) {
    const s = table.samples[0];
    const dx = point.x - s.position.x;
    const dz = point.z - s.position.z;
    return {
      param: 0,
      distance: 0,
      lateral: dx * s.right.x + dz * s.right.z,
      lateralNorm: s.width > 0 ? (2 * (dx * s.right.x + dz * s.right.z)) / s.width : 0,
      position: { ...s.position },
      distanceToCenter: Math.hypot(dx, dz),
      sample: s,
    };
  }
  const hw = options.heightWeight ?? 0.25;
  const useY = hw > 0 && point.y !== undefined && Number.isFinite(point.y);
  let best = Infinity;
  let bestIndex = 0;
  let bestT = 0;
  for (let i = 0; i < table.count - 1; i++) {
    const ax = table.x[i];
    const az = table.z[i];
    const bx = table.x[i + 1];
    const bz = table.z[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 1e-12 ? ((point.x - ax) * dx + (point.z - az) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + dx * t;
    const cz = az + dz * t;
    let cost = (point.x - cx) * (point.x - cx) + (point.z - cz) * (point.z - cz);
    if (useY) {
      const cy = table.y[i] + (table.y[i + 1] - table.y[i]) * t;
      const dy = (point.y as number) - cy;
      cost += dy * dy * hw * hw;
    }
    if (cost < best) {
      best = cost;
      bestIndex = i;
      bestT = t;
    }
  }
  const a = table.samples[bestIndex];
  const b = table.samples[bestIndex + 1];
  const s = lerpSample(a, b, bestT);
  // Refine the parameter on the true curve for accuracy on long segments.
  const dxp = point.x - s.position.x;
  const dzp = point.z - s.position.z;
  const lateral = dxp * s.right.x + dzp * s.right.z;
  const half = s.width / 2;
  let param = s.param;
  if (c.closed && param >= c.paramEnd) param -= c.paramEnd;
  return {
    param,
    distance: s.distance,
    lateral,
    lateralNorm: half > 1e-6 ? lateral / half : 0,
    position: s.position,
    distanceToCenter: Math.hypot(dxp, dzp),
    sample: s,
  };
}

/**
 * The road of the project closest to `point` (within `maxDistance` of its centre line, if given).
 * When the point has a `y`, height separation counts too, so the right layer of an overpass wins.
 */
export function nearestRoad(
  project: CreateProject,
  point: { x: number; y?: number; z: number },
  maxDistance = Infinity,
  options: ProjectOptions = {},
): { road: Road; projection: RoadProjection } | null {
  const hw = options.heightWeight ?? 0.25;
  const useY = hw > 0 && point.y !== undefined && Number.isFinite(point.y);
  let best: { road: Road; projection: RoadProjection } | null = null;
  let bestCost = Infinity;
  for (const road of project.roads) {
    const projection = projectOntoRoad(road, point, options);
    if (!projection || projection.distanceToCenter > maxDistance) continue;
    let cost = projection.distanceToCenter * projection.distanceToCenter;
    if (useY) {
      const dy = (point.y as number) - projection.position.y;
      cost += dy * dy * hw * hw;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = { road, projection };
    }
  }
  return best;
}

/** `position + right * lateral` (lateral in units; honours `lateralScale`). */
export function offsetFromCenter(sample: RoadSample, lateral: number): Vec3 {
  const s = lateral * sample.lateralScale;
  return {
    x: sample.position.x + sample.right.x * s,
    y: sample.position.y + sample.right.y * s,
    z: sample.position.z + sample.right.z * s,
  };
}

/** Surface point at a normalised lateral position (-1 left edge .. +1 right edge). */
export function surfacePoint(sample: RoadSample, lateralNorm: number): Vec3 {
  return offsetFromCenter(sample, (lateralNorm * sample.width) / 2);
}

/** Heading (KMP degrees) of the road's driving direction at a sample. */
export function sampleHeadingDegrees(sample: RoadSample): number {
  return (Math.atan2(sample.tangent.x, sample.tangent.z) * 180) / Math.PI;
}
