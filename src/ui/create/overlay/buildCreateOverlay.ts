/**
 * Builds the `CreateOverlay` (lines, dots, tints, labels drawn inside the noclip scene) from the
 * design, the selection, the tool's hover and the tool's ghost preview. Pure; the per-road geometry
 * is memoised on the road's sample array, so dragging one road only rebuilds that road.
 *
 * Look (docs/CREATE.md 6.4): dashed white centre line, direction chevrons, white dots that grow on
 * hover and turn accent blue when selected, violet section ticks and tints, amber piece footprints,
 * a checkered start band with grid slots, and brush circles on the ground.
 */
import { pieceLateralOffset } from '../../../lib/create/pieces';
import { sectionRanges } from '../../../lib/create/sections';
import {
  distanceToRoadParam,
  evaluateRoadAt,
  offsetFromCenter,
  roadLength,
  roadParamToDistance,
  type RoadSample,
  type RoadSamples,
} from '../../../lib/create/spline';
import type {
  CreateOverlay,
  CreateOverlayLine,
  CreateOverlayPoint,
  CreateOverlayTriangles,
  CreateProject,
  CreateSelection,
  OverlayColor,
  Piece,
  Road,
  SectionKind,
  Vec3,
} from '../../../lib/create/types';
import { encodeHandle } from './handles';
import { surfaceCategoryColor, type HoverTarget, type ToolId, type ToolPreview } from '../tools/types';


// ── Palette (docs/CREATE.md 6.3: one accent per concept) ─────────────────────────────────────────
const rgba = (r: number, g: number, b: number, a: number): OverlayColor => [r, g, b, a];
export const OVERLAY_COLORS = {
  road: rgba(0.28, 0.64, 1, 1),
  roadSoft: rgba(0.28, 0.64, 1, 0.55),
  section: rgba(0.66, 0.52, 1, 1),
  sectionTint: rgba(0.66, 0.52, 1, 0.18),
  sectionHoverTint: rgba(0.66, 0.52, 1, 0.08),
  piece: rgba(1, 0.74, 0.22, 1),
  pieceGhost: rgba(1, 0.74, 0.22, 0.35),
  pieceLane: rgba(1, 0.74, 0.22, 0.12),
  scenery: rgba(0.42, 0.86, 0.46, 1),
  white: rgba(1, 1, 1, 1),
  whiteSoft: rgba(1, 1, 1, 0.6),
  whiteFaint: rgba(1, 1, 1, 0.28),
  danger: rgba(1, 0.38, 0.38, 1),
  dangerSoft: rgba(1, 0.38, 0.38, 0.4),
  black: rgba(0.04, 0.04, 0.05, 0.82),
  checkWhite: rgba(1, 1, 1, 0.85),
  slot: rgba(1, 1, 1, 0.55),
} as const;

const tint = (c: OverlayColor, a: number): OverlayColor => [c[0], c[1], c[2], a];

// ── Input ─────────────────────────────────────────────────────────────────────────────────────────
export interface OverlayInput {
  project: CreateProject;
  samples: Map<string, RoadSamples>;
  selection: readonly CreateSelection[];
  tool: ToolId;
  hover: HoverTarget | null;
  preview: ToolPreview | null;
  /** Road tool: the open road being extended (its first point becomes the "close loop" target). */
  activeRoadId?: string | null;
  /** Road tool: the cursor is over the close ring. */
  closeHover?: boolean;
  /** World units per screen pixel near a point; lets control points shrink when they crowd. */
  unitsPerPixel?: (point: Vec3) => number;
  /** Draw the faint ground grid (top view while laying out a road): one square is `GRID_SQUARE` units. */
  grid?: boolean;
}

/** One grid square, in game units: about two seconds of driving at an average kart speed. */
export const GRID_SQUARE = 10000;
const GRID_HALF_EXTENT = 100000;
const gridCache = new Map<number, Vec3[][]>();

/** The grid lines on the plane `y` (cached: the grid never changes, only the height it sits at). */
function gridLines(y: number): Vec3[][] {
  const cached = gridCache.get(y);
  if (cached) return cached;
  const lines: Vec3[][] = [];
  for (let v = -GRID_HALF_EXTENT; v <= GRID_HALF_EXTENT; v += GRID_SQUARE) {
    lines.push([{ x: v, y, z: -GRID_HALF_EXTENT }, { x: v, y, z: GRID_HALF_EXTENT }]);
    lines.push([{ x: -GRID_HALF_EXTENT, y, z: v }, { x: GRID_HALF_EXTENT, y, z: v }]);
  }
  gridCache.clear();
  gridCache.set(y, lines);
  return lines;
}

/** Radius (px) of an idle control point given how far apart the points sit on screen. */
export function pointRadius(spacingPx: number): number {
  if (!Number.isFinite(spacingPx)) return 9;
  return Math.max(4, Math.min(9, Math.round(spacingPx * 0.3)));
}

export const SECTION_KIND_LABEL: Record<SectionKind, string> = { road: 'Road', bridge: 'Bridge', gap: 'Gap', tunnel: 'Tunnel' };

const CHEVRON_SPACING = 1500;
const LIFT = 14;

// ── Per-road geometry (memoised) ─────────────────────────────────────────────────────────────────
interface RoadLayer {
  center: Vec3[];
  left: Vec3[];
  right: Vec3[];
  chevrons: Vec3[][];
  /** Section edges: a line across the road at each section start (not for a lone section). */
  boundaries: Array<{ sectionId: string; a: Vec3; b: Vec3; mid: Vec3 }>;
  labels: Array<{ sectionId: string; kind: SectionKind; position: Vec3 }>;
  tints: Map<string, Float32Array>;
}

const layerCache = new WeakMap<RoadSamples, RoadLayer>();
const stripCache = new WeakMap<Road, Map<string, Float32Array>>();

const lift = (p: Vec3, up: Vec3, amount = LIFT): Vec3 => ({ x: p.x + up.x * amount, y: p.y + up.y * amount, z: p.z + up.z * amount });

function edgePair(s: RoadSample, extra = 0): [Vec3, Vec3] {
  const half = s.width / 2 + extra;
  return [offsetFromCenter(s, -half), offsetFromCenter(s, half)];
}

function buildChevrons(samples: RoadSamples): Vec3[][] {
  const out: Vec3[][] = [];
  if (samples.length < 2) return out;
  let next = CHEVRON_SPACING * 0.5;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.distance < next) continue;
    next = s.distance + CHEVRON_SPACING;
    const length = Math.min(520, Math.max(220, s.width * 0.1));
    const wing = Math.min(420, Math.max(160, s.width * 0.075));
    const base = lift(s.position, s.up, LIFT * 1.5);
    const tip = { x: base.x + s.tangent.x * length * 0.5, y: base.y + s.tangent.y * length * 0.5, z: base.z + s.tangent.z * length * 0.5 };
    const back = { x: base.x - s.tangent.x * length * 0.5, y: base.y - s.tangent.y * length * 0.5, z: base.z - s.tangent.z * length * 0.5 };
    const l = { x: back.x - s.right.x * wing, y: back.y - s.right.y * wing, z: back.z - s.right.z * wing };
    const r = { x: back.x + s.right.x * wing, y: back.y + s.right.y * wing, z: back.z + s.right.z * wing };
    out.push([l, tip, r]);
  }
  return out;
}

function getLayer(road: Road, samples: RoadSamples): RoadLayer {
  const cached = layerCache.get(samples);
  if (cached) return cached;
  const center: Vec3[] = [];
  const left: Vec3[] = [];
  const right: Vec3[] = [];
  for (const s of samples) {
    center.push(lift(s.position, s.up));
    const [l, r] = edgePair(s);
    left.push(lift(l, s.up));
    right.push(lift(r, s.up));
  }
  const ranges = road.points.length >= 2 ? sectionRanges(road) : [];
  const boundaries: RoadLayer['boundaries'] = [];
  const labels: RoadLayer['labels'] = [];
  if (ranges.length > 0) {
    for (const range of ranges) {
      if (ranges.length > 1 && !(range.index === 0 && !road.closed) && !(range.index === 0 && ranges.length === 1)) {
        const frame = evaluateRoadAt(road, range.from);
        const [a, b] = edgePair(frame, 260);
        boundaries.push({ sectionId: range.section.id, a: lift(a, frame.up, LIFT * 1.5), b: lift(b, frame.up, LIFT * 1.5), mid: lift(frame.position, frame.up, LIFT * 1.5) });
      }
      const midFrame = evaluateRoadAt(road, (range.from + range.to) / 2);
      labels.push({ sectionId: range.section.id, kind: range.kind, position: lift(midFrame.position, midFrame.up, LIFT * 2) });
    }
  }
  const layer: RoadLayer = { center, left, right, chevrons: buildChevrons(samples), boundaries, labels, tints: new Map() };
  layerCache.set(samples, layer);
  return layer;
}

/** Triangle strip (flat list) covering the road between two parameters, lifted a little. */
export function roadStrip(road: Road, samples: RoadSamples, from: number, to: number, extra = 0, liftBy = LIFT * 2): Float32Array {
  const frames: RoadSample[] = [evaluateRoadAt(road, from)];
  for (const s of samples) if (s.param > from + 1e-6 && s.param < to - 1e-6) frames.push(s);
  frames.push(evaluateRoadAt(road, to - 1e-6 > from ? to : from));
  const out: number[] = [];
  for (let i = 0; i + 1 < frames.length; i++) {
    const [la, ra] = edgePair(frames[i], extra);
    const [lb, rb] = edgePair(frames[i + 1], extra);
    const a0 = lift(la, frames[i].up, liftBy);
    const a1 = lift(ra, frames[i].up, liftBy);
    const b0 = lift(lb, frames[i + 1].up, liftBy);
    const b1 = lift(rb, frames[i + 1].up, liftBy);
    out.push(a0.x, a0.y, a0.z, a1.x, a1.y, a1.z, b0.x, b0.y, b0.z, a1.x, a1.y, a1.z, b1.x, b1.y, b1.z, b0.x, b0.y, b0.z);
  }
  return new Float32Array(out);
}

function sectionTint(road: Road, samples: RoadSamples, layer: RoadLayer, sectionId: string): Float32Array | null {
  const cached = layer.tints.get(sectionId);
  if (cached) return cached;
  const range = sectionRanges(road).find((r) => r.section.id === sectionId);
  if (!range) return null;
  const strip = roadStrip(road, samples, range.from, range.to, 0);
  layer.tints.set(sectionId, strip);
  return strip;
}

// ── Piece and start geometry (memoised on the road + piece objects) ──────────────────────────────
interface PieceShape {
  position: Vec3;
  /** Closed footprint outline, or empty for point-like pieces. */
  outline: Vec3[];
  /** Item boxes across a row. */
  dots: Vec3[];
}

const pieceCache = new WeakMap<Road, WeakMap<Piece, PieceShape>>();

function frameAtDistance(road: Road, distance: number): RoadSample {
  return evaluateRoadAt(road, distanceToRoadParam(road, distance));
}

/** Footprint of a piece-like quad centred on `centerParam`, `lateral` units across, `length` along. */
function footprint(road: Road, centerParam: number, lateralOffset: number, width: number, length: number, liftBy = LIFT * 2): Vec3[] {
  const centerD = roadParamToDistance(road, centerParam);
  const half = length / 2;
  const a = frameAtDistance(road, centerD - half);
  const b = frameAtDistance(road, centerD + half);
  const corner = (s: RoadSample, side: number) => lift(offsetFromCenter(s, lateralOffset + side * (width / 2)), s.up, liftBy);
  return [corner(a, -1), corner(a, 1), corner(b, 1), corner(b, -1)];
}

function quadTriangles(q: Vec3[]): Float32Array {
  const [a, b, c, d] = q;
  return new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z]);
}

function pieceShape(road: Road, piece: Piece): PieceShape {
  let perRoad = pieceCache.get(road);
  if (!perRoad) {
    perRoad = new WeakMap();
    pieceCache.set(road, perRoad);
  }
  const cached = perRoad.get(piece);
  if (cached) return cached;
  const sample = evaluateRoadAt(road, piece.param);
  const offset = pieceLateralOffset(piece, sample);
  const position = lift(offsetFromCenter(sample, offset), sample.up, LIFT * 2);
  const shape: PieceShape = { position, outline: [], dots: [] };
  if (piece.kind === 'boostPanel' || piece.kind === 'boostRamp' || piece.kind === 'trickRamp') {
    shape.outline = footprint(road, piece.param, offset, piece.width, piece.length);
  } else if (piece.kind === 'itemRow') {
    const count = Math.max(1, Math.round(piece.count ?? 5));
    const span = Math.max(0, piece.width);
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1) - 0.5;
      shape.dots.push(lift(offsetFromCenter(sample, offset + t * span), sample.up, LIFT * 2));
    }
    shape.outline = footprint(road, piece.param, offset, piece.width + 300, 360);
  }
  perRoad.set(piece, shape);
  return shape;
}

interface StartShape {
  center: Vec3;
  outline: Vec3[];
  white: Float32Array;
  black: Float32Array;
  slots: Vec3[][];
}

const startCache = new WeakMap<Road, Map<number, StartShape>>();
const GRID_ROWS = 6;

function startShape(road: Road, param: number, narrow: boolean): StartShape {
  let perRoad = startCache.get(road);
  if (!perRoad) {
    perRoad = new Map();
    startCache.set(road, perRoad);
  }
  const key = param * 1000 + (narrow ? 0.5 : 0);
  const cached = perRoad.get(key);
  if (cached) return cached;
  const frame = evaluateRoadAt(road, param);
  const d0 = roadParamToDistance(road, param);
  const bandLength = 300;
  const cols = Math.max(4, Math.round(frame.width / 320)) & ~1 || 4;
  const white: number[] = [];
  const black: number[] = [];
  const front = frameAtDistance(road, d0 + bandLength / 2);
  const back = frameAtDistance(road, d0 - bandLength / 2);
  const mid = frameAtDistance(road, d0);
  const pt = (s: RoadSample, t: number) => lift(offsetFromCenter(s, (t - 0.5) * s.width), s.up, LIFT * 2);
  for (let row = 0; row < 2; row++) {
    const s0 = row === 0 ? back : mid;
    const s1 = row === 0 ? mid : front;
    for (let c = 0; c < cols; c++) {
      const a = pt(s0, c / cols);
      const b = pt(s0, (c + 1) / cols);
      const d = pt(s1, c / cols);
      const e = pt(s1, (c + 1) / cols);
      const target = (c + row) % 2 === 0 ? white : black;
      target.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z, b.x, b.y, b.z, e.x, e.y, e.z, d.x, d.y, d.z);
    }
  }
  const slots: Vec3[][] = [];
  const laneOffset = frame.width * (narrow ? 0.12 : 0.19);
  for (let row = 0; row < GRID_ROWS; row++) {
    const behind = 520 + row * 700;
    const s = frameAtDistance(road, d0 - behind);
    for (const side of [-1, 1]) {
      // Stagger like the real grid: the two columns are half a row apart.
      const s2 = side === 1 ? frameAtDistance(road, d0 - behind - 350) : s;
      const centre = offsetFromCenter(s2, side * laneOffset);
      const hw = 150;
      const hl = 230;
      const corners = [
        { x: -hw, z: -hl },
        { x: hw, z: -hl },
        { x: hw, z: hl },
        { x: -hw, z: hl },
      ].map((c) => ({
        x: centre.x + s2.right.x * c.x + s2.tangent.x * c.z,
        y: centre.y + s2.right.y * c.x + s2.tangent.y * c.z + s2.up.y * LIFT * 2,
        z: centre.z + s2.right.z * c.x + s2.tangent.z * c.z,
      }));
      slots.push(corners);
    }
  }
  const shape: StartShape = {
    center: lift(mid.position, mid.up, LIFT * 3),
    outline: [pt(back, 0), pt(back, 1), pt(front, 1), pt(front, 0)],
    white: new Float32Array(white),
    black: new Float32Array(black),
    slots,
  };
  perRoad.set(key, shape);
  return shape;
}

// ── Builder ──────────────────────────────────────────────────────────────────────────────────────
class OverlayBuilder {
  readonly points: CreateOverlayPoint[] = [];
  readonly lines: CreateOverlayLine[] = [];
  readonly triangles: CreateOverlayTriangles[] = [];
  readonly labels: CreateOverlay['labels'] = [];

  line(points: Vec3[], color: OverlayColor, options: { dashed?: boolean; closed?: boolean; onTop?: boolean } = {}) {
    if (points.length < 2) return;
    this.lines.push({ points, color, ...options });
  }
  tris(positions: Float32Array, color: OverlayColor) {
    if (positions.length > 0) this.triangles.push({ positions, color });
  }
  point(id: string, position: Vec3, color: OverlayColor, radius: number, options: { pickable?: boolean; ring?: boolean; label?: string } = {}) {
    this.points.push({ id, position, color, radius, pickable: options.pickable === true, ...(options.ring ? { ring: true } : {}), ...(options.label ? { label: options.label } : {}) });
  }
  result(): CreateOverlay {
    return { points: this.points, lines: this.lines, triangles: this.triangles, labels: this.labels };
  }
}

function sameSel(a: CreateSelection, b: CreateSelection | HoverTarget | null): boolean {
  if (!b || a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'road':
      return a.roadId === (b as typeof a).roadId;
    case 'point':
      return a.roadId === (b as typeof a).roadId && a.pointId === (b as typeof a).pointId;
    case 'section':
      return a.roadId === (b as typeof a).roadId && a.sectionId === (b as typeof a).sectionId;
    case 'piece':
      return a.pieceId === (b as typeof a).pieceId;
    case 'prop':
      return a.propId === (b as typeof a).propId;
    case 'stroke':
      return a.strokeId === (b as typeof a).strokeId;
    case 'start':
      return true;
  }
}

function circle(center: Vec3, radius: number, segments = 48, liftBy = 24): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out.push({ x: center.x + Math.cos(a) * radius, y: center.y + liftBy, z: center.z + Math.sin(a) * radius });
  }
  return out;
}

function discTriangles(center: Vec3, radius: number, segments = 32, liftBy = 20): Float32Array {
  const out: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    out.push(
      center.x, center.y + liftBy, center.z,
      center.x + Math.cos(a0) * radius, center.y + liftBy, center.z + Math.sin(a0) * radius,
      center.x + Math.cos(a1) * radius, center.y + liftBy, center.z + Math.sin(a1) * radius,
    );
  }
  return new Float32Array(out);
}

function brushColor(style: Extract<ToolPreview, { kind: 'brush' }>): OverlayColor {
  switch (style.style) {
    case 'erase':
    case 'sceneryErase':
      return OVERLAY_COLORS.danger;
    case 'paint': {
      const [r, g, b] = style.tint ?? surfaceCategoryColor(style.category);
      return [r, g, b, 1];
    }
    case 'scenery':
      return OVERLAY_COLORS.scenery;
    default:
      return OVERLAY_COLORS.white;
  }
}

function addPreview(b: OverlayBuilder, input: OverlayInput): void {
  const { preview, project, samples } = input;
  if (!preview) return;
  switch (preview.kind) {
    case 'height': {
      // A dashed stem down to the ground, and the height over it where the point is.
      b.line([{ x: preview.position.x, y: preview.groundY, z: preview.position.z }, preview.position], tint(OVERLAY_COLORS.white, 0.7), { dashed: true });
      b.point('viz|height', preview.position, tint(OVERLAY_COLORS.road, 0.95), 8, { ring: true, label: preview.text });
      return;
    }
    case 'rubber': {
      if (preview.from.x !== preview.to.x || preview.from.z !== preview.to.z || preview.from.y !== preview.to.y) {
        b.line([preview.from, preview.to], tint(OVERLAY_COLORS.road, 0.95), { dashed: true });
      }
      if (preview.ghost) b.point('viz|ghost', preview.to, tint(OVERLAY_COLORS.road, 0.7), 8);
      return;
    }
    case 'insert': {
      b.point('viz|insert', preview.position, tint(OVERLAY_COLORS.white, 0.85), 9, { ring: true, label: 'Add a point here' });
      return;
    }
    case 'split': {
      const road = project.roads.find((r) => r.id === preview.roadId);
      if (!road) return;
      const frame = evaluateRoadAt(road, preview.param);
      const [l, r] = edgePair(frame, 300);
      const color = preview.blocked ? OVERLAY_COLORS.dangerSoft : tint(OVERLAY_COLORS.section, 0.95);
      b.line([lift(l, frame.up, LIFT * 2), lift(r, frame.up, LIFT * 2)], color);
      const front = frameAtDistance(road, roadParamToDistance(road, preview.param) + 90);
      const back = frameAtDistance(road, roadParamToDistance(road, preview.param) - 90);
      const [fl, fr] = edgePair(front, 300);
      const [bl, br] = edgePair(back, 300);
      b.tris(quadTriangles([lift(bl, back.up, LIFT * 2), lift(br, back.up, LIFT * 2), lift(fr, front.up, LIFT * 2), lift(fl, front.up, LIFT * 2)]), tint(color, preview.blocked ? 0.28 : 0.45));
      b.point('viz|split', lift(frame.position, frame.up, LIFT * 2), color, 6, { label: preview.blocked ? 'Too close to another edge' : 'Split here' });
      return;
    }
    case 'piece': {
      const road = project.roads.find((r) => r.id === preview.roadId);
      if (!road) return;
      const frame = evaluateRoadAt(road, preview.param);
      const half = frame.width / 2;
      const offset = preview.lateral * half;
      // Lane highlight: the lane strip a few lengths either side of the cursor.
      const laneWidth = preview.lane === 'full' ? frame.width : frame.width / 3;
      const laneOffset = preview.lane === 'left' ? -frame.width / 3 : preview.lane === 'right' ? frame.width / 3 : 0;
      const laneStrip = footprint(road, preview.param, laneOffset, laneWidth, 3400, LIFT * 1.2);
      b.tris(quadTriangles(laneStrip), OVERLAY_COLORS.pieceLane);
      b.line(laneStrip, tint(OVERLAY_COLORS.piece, 0.35), { closed: true });
      const length = preview.pieceKind === 'itemRow' ? 360 : preview.pieceKind === 'object' ? 420 : Math.max(300, preview.length);
      const width = preview.pieceKind === 'object' ? 420 : preview.pieceKind === 'itemRow' ? preview.width + 300 : preview.width;
      const quad = footprint(road, preview.param, offset, width, length, LIFT * 2.4);
      b.tris(quadTriangles(quad), OVERLAY_COLORS.pieceGhost);
      b.line(quad, OVERLAY_COLORS.piece, { closed: true });
      b.point('viz|piece-ghost', lift(offsetFromCenter(frame, offset), frame.up, LIFT * 3), OVERLAY_COLORS.piece, 6);
      return;
    }
    case 'start': {
      const road = project.roads.find((r) => r.id === preview.roadId);
      if (!road) return;
      const shape = startShape(road, preview.param, project.settings.narrowStart);
      const color = preview.blocked ? OVERLAY_COLORS.danger : OVERLAY_COLORS.white;
      b.tris(quadTriangles(shape.outline), tint(color, 0.4));
      b.line(shape.outline, color, { closed: true });
      for (const slot of shape.slots) b.line(slot, tint(color, 0.4), { closed: true });
      b.point('viz|start-ghost', shape.center, color, 7, { label: preview.blocked ? 'Main road only' : 'Start line here' });
      return;
    }
    case 'brush': {
      const color = brushColor(preview);
      b.tris(discTriangles(preview.center, preview.radius), tint(color, 0.28));
      b.line(circle(preview.center, preview.radius), tint(OVERLAY_COLORS.white, 0.95));
      b.line(circle(preview.center, preview.radius * 0.97), tint(color, 1));
      b.line(circle(preview.center, preview.radius * 0.5, 32), tint(color, 0.35), { dashed: true });
      const up = preview.style === 'raise';
      const down = preview.style === 'lower';
      if (up || down) {
        const cx = preview.center.x;
        const cz = preview.center.z;
        const y0 = preview.center.y + 24;
        const h = Math.min(900, preview.radius * 0.6);
        const tipY = up ? y0 + h : y0;
        const baseY = up ? y0 : y0 + h;
        const head = h * 0.28;
        b.line([{ x: cx, y: baseY, z: cz }, { x: cx, y: tipY, z: cz }], color);
        b.line(
          [
            { x: cx - head, y: tipY + (up ? -head : head), z: cz },
            { x: cx, y: tipY, z: cz },
            { x: cx + head, y: tipY + (up ? -head : head), z: cz },
          ],
          color,
        );
      }
      return;
    }
  }
  void samples;
}

export function buildCreateOverlay(input: OverlayInput): CreateOverlay {
  const { project, samples, selection, tool, hover } = input;
  const b = new OverlayBuilder();
  const selectedRoads = new Set<string>();
  for (const s of selection) {
    if (s.kind === 'road' || s.kind === 'point' || s.kind === 'section') selectedRoads.add(s.roadId);
  }
  if (input.grid) {
    // Under everything else, so it never covers a road or a handle.
    for (const line of gridLines(project.terrain.baseHeight)) b.line(line, rgba(1, 1, 1, 0.1));
  }
  const hoverRoadId = hover && (hover.kind === 'road' || hover.kind === 'point' || hover.kind === 'section' || hover.kind === 'boundary') ? hover.roadId : null;

  for (const road of project.roads) {
    // Control points: always in the Road tool; in Select only for the road you selected or hover.
    const showPoints = tool === 'road' || (tool === 'select' && (selectedRoads.has(road.id) || hoverRoadId === road.id));
    const roadSamples = samples.get(road.id);
    if (!roadSamples || roadSamples.length < 2) {
      // A road with one point is still visible so the first click gives feedback.
      for (const pt of road.points) {
        const isSel = selection.some((s) => s.kind === 'point' && s.pointId === pt.id);
        b.point(encodeHandle({ type: 'point', roadId: road.id, pointId: pt.id }), pt.position, isSel ? OVERLAY_COLORS.road : OVERLAY_COLORS.white, isSel ? 12 : 9, { pickable: showPoints, ring: isSel });
      }
      continue;
    }
    const layer = getLayer(road, roadSamples);
    const emphasised = selectedRoads.has(road.id);

    // Centre line + chevrons.
    b.line(layer.center, emphasised ? tint(OVERLAY_COLORS.white, 0.8) : OVERLAY_COLORS.whiteSoft, { dashed: true });
    for (const chevron of layer.chevrons) b.line(chevron, tint(OVERLAY_COLORS.white, emphasised ? 0.85 : 0.6));
    if (emphasised) {
      b.line(layer.left, tint(OVERLAY_COLORS.white, 0.5));
      b.line(layer.right, tint(OVERLAY_COLORS.white, 0.5));
    }

    // Sections: ticks, tints and (in the Sections tool) handles.
    const selectedSections = selection.filter((s): s is Extract<CreateSelection, { kind: 'section' }> => s.kind === 'section' && s.roadId === road.id);
    for (const sel of selectedSections) {
      const tintStrip = sectionTint(road, roadSamples, layer, sel.sectionId);
      if (tintStrip) b.tris(tintStrip, OVERLAY_COLORS.sectionTint);
    }
    if (hover && (hover.kind === 'section' || hover.kind === 'boundary') && hover.roadId === road.id && !selectedSections.some((s) => s.sectionId === hover.sectionId)) {
      const tintStrip = sectionTint(road, roadSamples, layer, hover.sectionId);
      if (tintStrip) b.tris(tintStrip, OVERLAY_COLORS.sectionHoverTint);
    }
    const showSectionHandles = tool === 'sections';
    for (const edge of layer.boundaries) {
      const hovered = hover?.kind === 'boundary' && hover.sectionId === edge.sectionId;
      if (showSectionHandles || emphasised || hovered) b.line([edge.a, edge.b], tint(OVERLAY_COLORS.section, 1));
      if (showSectionHandles) {
        b.point(encodeHandle({ type: 'boundary', roadId: road.id, sectionId: edge.sectionId }), edge.mid, OVERLAY_COLORS.section, hovered ? 9 : 7, { pickable: true, ring: hovered });
      }
    }
    if (showSectionHandles) {
      for (const label of layer.labels) {
        const selectedHere = selectedSections.some((s) => s.sectionId === label.sectionId);
        const hovered = hover?.kind === 'section' && hover.sectionId === label.sectionId;
        b.point(encodeHandle({ type: 'section', roadId: road.id, sectionId: label.sectionId }), label.position, selectedHere ? OVERLAY_COLORS.section : tint(OVERLAY_COLORS.section, 0.75), selectedHere ? 11 : hovered ? 10 : 8, {
          pickable: true,
          ring: selectedHere,
          label: SECTION_KIND_LABEL[label.kind],
        });
      }
    }

    // Control points.
    const upp = input.unitsPerPixel ? input.unitsPerPixel(road.points[0]?.position ?? { x: 0, y: 0, z: 0 }) : 0;
    const baseRadius = upp > 0 && road.points.length > 0 ? pointRadius(roadLength(road) / road.points.length / upp) : 9;
    const closing = input.closeHover === true && input.activeRoadId === road.id;
    const showClose = tool === 'road' && input.activeRoadId === road.id && road.points.length >= 3;
    road.points.forEach((pt, index) => {
      const target: CreateSelection = { kind: 'point', roadId: road.id, pointId: pt.id };
      const isSel = selection.some((s) => sameSel(target, s));
      const isHover = sameSel(target, hover);
      const visible = showPoints || isSel;
      if (!visible) return;
      const isFirstOfOpen = index === 0 && !road.closed;
      const asClose = showClose && index === 0;
      const id = asClose ? encodeHandle({ type: 'close', roadId: road.id }) : encodeHandle({ type: 'point', roadId: road.id, pointId: pt.id });
      let color: OverlayColor = OVERLAY_COLORS.white;
      let radius = baseRadius;
      let ring = false;
      let label: string | undefined;
      if (isSel) {
        color = OVERLAY_COLORS.road;
        radius = Math.max(10, baseRadius + 3);
        ring = true;
      } else if (isHover) {
        radius = baseRadius + 2;
        color = tint(OVERLAY_COLORS.road, 1);
      }
      if (asClose) {
        radius = closing ? 12 : Math.max(9, baseRadius + 1);
        ring = true;
        label = closing ? 'Click to close the loop' : undefined;
        if (closing) color = OVERLAY_COLORS.road;
      } else if (isFirstOfOpen && road.points.length >= 2) label = 'Start of road';
      b.point(id, pt.position, color, radius, { pickable: showPoints, ring, label });
    });
  }

  // Pieces.
  const showPieceHandles = tool === 'select' || tool === 'pieces';
  for (const piece of project.pieces) {
    const road = project.roads.find((r) => r.id === piece.roadId);
    if (!road || road.points.length < 2) continue;
    const shape = pieceShape(road, piece);
    const target: CreateSelection = { kind: 'piece', pieceId: piece.id };
    const isSel = selection.some((s) => sameSel(target, s));
    const isHover = sameSel(target, hover);
    if (shape.outline.length > 0) b.line(shape.outline, tint(OVERLAY_COLORS.piece, isSel ? 1 : 0.7), { closed: true });
    if (isSel && shape.outline.length > 0) b.tris(quadTriangles(shape.outline), tint(OVERLAY_COLORS.piece, 0.25));
    for (const dot of shape.dots) b.point(`viz|dot|${piece.id}|${dot.x.toFixed(0)}|${dot.z.toFixed(0)}`, dot, tint(OVERLAY_COLORS.piece, 0.7), 4);
    if (showPieceHandles || isSel) {
      b.point(encodeHandle({ type: 'piece', pieceId: piece.id }), shape.position, isSel ? OVERLAY_COLORS.piece : tint(OVERLAY_COLORS.piece, 0.85), isSel ? 11 : isHover ? 8 : 5, { pickable: showPieceHandles, ring: isSel });
    }
  }

  // Props: selected and hovered ones get a ring; the scenery tool shows them all as small dots.
  for (const prop of project.props) {
    const target: CreateSelection = { kind: 'prop', propId: prop.id };
    const isSel = selection.some((s) => sameSel(target, s));
    const isHover = sameSel(target, hover);
    if (isSel || isHover) {
      b.point(encodeHandle({ type: 'prop', propId: prop.id }), prop.position, OVERLAY_COLORS.scenery, isSel ? 11 : 9, { ring: true, pickable: tool === 'select' });
    } else if (tool === 'scenery') {
      b.point(`viz|prop|${prop.id}`, prop.position, tint(OVERLAY_COLORS.scenery, 0.65), 4);
    }
  }

  // Start line.
  const startRoad = project.roads.find((r) => r.id === project.start.roadId);
  if (startRoad && startRoad.points.length >= 2) {
    const shape = startShape(startRoad, project.start.param, project.settings.narrowStart);
    b.tris(shape.white, OVERLAY_COLORS.checkWhite);
    b.tris(shape.black, OVERLAY_COLORS.black);
    b.line(shape.outline, tint(OVERLAY_COLORS.white, 0.9), { closed: true });
    const startSelected = selection.some((s) => s.kind === 'start');
    const showSlots = startSelected || tool === 'start' || tool === 'select';
    if (showSlots) for (const slot of shape.slots) b.line(slot, OVERLAY_COLORS.slot, { closed: true });
    b.point(encodeHandle({ type: 'start' }), shape.center, OVERLAY_COLORS.white, startSelected ? 11 : hover?.kind === 'start' ? 10 : 7, {
      pickable: tool === 'select' || tool === 'start',
      ring: startSelected,
      label: startSelected || tool === 'start' ? 'Start line' : undefined,
    });
  }

  addPreview(b, input);
  return b.result();
}

/** Total road length helper re-exported for the UI (km readout etc.). */
export { roadLength };
