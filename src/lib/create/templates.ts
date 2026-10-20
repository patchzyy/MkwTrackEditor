/**
 * Starting layouts for new designs. Every non-blank template is a complete, drivable, retail-sized
 * circuit (a lap of roughly 30–50 seconds at 150cc: retail laps are 140k–360k units long and a
 * kart averages about 76 units per frame), with a start straight, item boxes and a boost panel.
 */
import type { CreateKit, CreateProject, Piece, Road, RoadPoint, RoadSection, Vec2 } from './types';
import { CREATE_PROJECT_VERSION } from './types';
import { createId } from './ids';
import { DEFAULT_GENERATION, DEFAULT_SETTINGS, DEFAULT_TERRAIN } from './ops/migrate';
import { DEFAULT_ROAD_STYLE_ID, getRoadStyle } from './roadStyles';
import { defaultPiece } from './pieces';
import { distanceToRoadParam, evaluateRoadAt, projectOntoRoad, roadLength, roadParamEnd, roadParamToDistance, sampleRoad } from './spline';
import { scatterProps } from './ops';

export interface LayoutTemplate {
  id: string;
  label: string;
  description: string;
  /** Closed outline, normalised to 0..1 on both axes (aspect ratio preserved), for an SVG thumbnail. */
  preview: Vec2[];
}

interface PointSpec {
  x: number;
  z: number;
  y?: number;
  width?: number;
  bank?: number;
  corner?: 'smooth' | 'sharp';
}

interface PieceSpec {
  kind: Piece['kind'];
  param: number;
  lateral?: number;
  overrides?: Partial<Omit<Piece, 'id' | 'roadId' | 'param' | 'kind'>>;
}

interface SectionSpec {
  start: number;
  kind: RoadSection['kind'];
}

interface LayoutBuild {
  points: PointSpec[];
  startParam: number;
  sections?: SectionSpec[];
  pieces: PieceSpec[];
  /** Extra height of the flat ground over the theme's base height (roads sit on it unless a point says otherwise). */
  baseHeight?: number;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Path generators
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Horizontal distance-based banking: tilt corners into the turn. */
function autoBank(points: PointSpec[], strength: number, maxDegrees: number): PointSpec[] {
  const n = points.length;
  return points.map((p, i) => {
    const a = points[(i - 1 + n) % n];
    const b = points[(i + 1) % n];
    const ax = p.x - a.x;
    const az = p.z - a.z;
    const bx = b.x - p.x;
    const bz = b.z - p.z;
    const cross = ax * bz - az * bx;
    const la = Math.hypot(ax, az) || 1;
    const lb = Math.hypot(bx, bz) || 1;
    // Signed turn: positive = turning right (matches the road's right-turn-positive bank).
    const sinTurn = -cross / (la * lb);
    const bank = Math.max(-maxDegrees, Math.min(maxDegrees, sinTurn * strength)) + 0;
    return { ...p, bank };
  });
}

function stadium(): LayoutBuild {
  const S = 44000;
  const R = 15000;
  const pts: PointSpec[] = [];
  // Bottom straight (+X), then the right half-circle, the top straight (-X), the left half-circle.
  const straightXs = [-S / 2, -S / 4, 0, S / 4];
  for (const x of straightXs) pts.push({ x, z: R });
  const arcSteps = 8;
  for (let i = 0; i <= arcSteps; i++) {
    const a = Math.PI / 2 - (Math.PI * i) / arcSteps; // +90° down to -90° around (S/2, 0)
    pts.push({ x: S / 2 + Math.cos(a) * R, z: Math.sin(a) * R });
  }
  for (const x of [S / 4, 0, -S / 4]) pts.push({ x, z: -R });
  for (let i = 0; i <= arcSteps; i++) {
    const a = -Math.PI / 2 - (Math.PI * i) / arcSteps;
    pts.push({ x: -S / 2 + Math.cos(a) * R, z: Math.sin(a) * R });
  }
  // Drop the duplicated junction points where straights meet arcs.
  const cleaned = pts.filter((p, i) => {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    return Math.hypot(p.x - prev.x, p.z - prev.z) > 1;
  });
  const startIndex = cleaned.findIndex((p) => p.x === 0 && p.z === R);
  const total = cleaned.length;
  return {
    points: autoBank(cleaned, 8, 6),
    startParam: startIndex,
    pieces: [
      { kind: 'boostPanel', param: startIndex + 1.5 },
      { kind: 'itemRow', param: startIndex + 3.2 },
      { kind: 'itemRow', param: (startIndex + total * 0.38) % total },
      { kind: 'itemRow', param: (startIndex + total / 2) % total },
      { kind: 'boostPanel', param: (startIndex + total / 2 + 1.2) % total, lateral: 0.4 },
    ],
  };
}

function kidney(): LayoutBuild {
  const n = 26;
  const A = 36000;
  const B = 20500;
  const pts: PointSpec[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    // An ellipse with one side pushed in, which makes the bean.
    const off = ((t - Math.PI / 2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const dent = 11500 * Math.exp(-(off * off) / 0.42);
    pts.push({ x: Math.cos(t) * A, z: Math.sin(t) * (B - dent) });
  }
  return {
    points: autoBank(pts, 7, 8),
    startParam: 20.4,
    pieces: [
      { kind: 'boostPanel', param: 22.0 },
      { kind: 'itemRow', param: 23.4 },
      { kind: 'itemRow', param: 5.2 },
      { kind: 'itemRow', param: 11.0 },
      { kind: 'itemRow', param: 17.0 },
      { kind: 'boostPanel', param: 8.0, lateral: -0.35 },
    ],
  };
}

function figureEight(): LayoutBuild {
  const a = 40000; // half length of the lemniscate
  const n = 24;
  const pts: PointSpec[] = [];
  const bridgeHeight = 1500;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const s = Math.sin(t);
    const c = Math.cos(t);
    const d = 1 + s * s;
    const x = (a * c) / d;
    const z = (a * s * c) / d;
    // The second pass through the middle (t near 3π/2) climbs over the first one.
    const phase = (((t - Math.PI * 1.5 + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / (Math.PI * 0.34); // -1..1 over the bridge
    const lift = Math.abs(phase) < 1 ? 0.5 * (1 + Math.cos(Math.PI * phase)) : 0;
    pts.push({ x, z, y: bridgeHeight * lift });
  }
  const bridgeIdx = pts.map((p, i) => ({ y: p.y ?? 0, i })).filter((e) => e.y > 100).map((e) => e.i);
  const first = bridgeIdx[0] ?? 0;
  const last = bridgeIdx[bridgeIdx.length - 1] ?? 0;
  const sections: SectionSpec[] = [
    { start: 0, kind: 'road' },
    { start: first - 0.5, kind: 'bridge' },
    { start: last + 0.5, kind: 'road' },
  ];
  return {
    points: pts,
    startParam: 4.5,
    sections,
    pieces: [
      { kind: 'boostPanel', param: 5.8 },
      { kind: 'itemRow', param: 7.5 },
      { kind: 'itemRow', param: 12.3 },
      { kind: 'itemRow', param: 18.5 },
      { kind: 'boostPanel', param: 20.5, lateral: 0.35 },
    ],
  };
}

function twisty(): LayoutBuild {
  const n = 30;
  // Harmonics found by searching for the most winding closed outline that keeps every corner wider
  // than 4400 units and never comes close to itself.
  const amps = [0.0259, 0.0691, 0.1072, 0.0254];
  const phases = [1.7826, 3.4483, 4.4536, 1.4268];
  const sx = 1.1102;
  const sz = 0.9931;
  const raw: PointSpec[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    let r = 1;
    for (let h = 0; h < 4; h++) r += amps[h] * Math.sin((h + 3) * t + phases[h]);
    raw.push({ x: Math.cos(t) * r * sx, z: Math.sin(t) * r * sz });
  }
  // Scale to a lap of about 190k units.
  const probe: Road = {
    id: 'probe',
    name: 'probe',
    closed: true,
    styleId: DEFAULT_ROAD_STYLE_ID,
    sections: [],
    points: raw.map((p, i) => ({ id: `p${i}`, position: { x: p.x, y: 0, z: p.z }, width: 3600, bank: 0, corner: 'smooth' as const })),
  };
  const k = 190000 / roadLength(probe);
  const pts = autoBank(raw.map((p) => ({ x: p.x * k, z: p.z * k })), 9, 10);
  // Start where the road behind the line is straightest (the grid lines up in a straight row).
  const scaled: Road = { ...probe, id: 'probe2', points: probe.points.map((pt, i) => ({ ...pt, position: { x: pts[i].x, y: 0, z: pts[i].z } })) };
  const samples = sampleRoad(scaled, { step: 400 });
  let startParam = 0;
  let bestBend = Infinity;
  for (let u = 0; u < n; u += 0.25) {
    const d = roadParamToDistance(scaled, u);
    let bend = 0;
    for (const s of samples) {
      let back = d - s.distance;
      if (back < 0) back += roadLength(scaled);
      if (back <= 5200) bend = Math.max(bend, Math.abs(s.curvature));
    }
    if (bend < bestBend) {
      bestBend = bend;
      startParam = u;
    }
  }
  const at = (offset: number) => (startParam + offset) % n;
  return {
    points: pts,
    startParam,
    pieces: [
      { kind: 'boostPanel', param: at(1.2) },
      { kind: 'itemRow', param: at(4.0) },
      { kind: 'itemRow', param: at(11.0) },
      { kind: 'itemRow', param: at(19.0) },
      { kind: 'boostPanel', param: at(23.0), lateral: -0.3 },
    ],
  };
}

function hills(): LayoutBuild {
  const n = 22;
  const pts: PointSpec[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = Math.cos(t) * 43000;
    const z = Math.sin(t) * 24000;
    const y = 900 * (1 + Math.sin(2 * t - 0.5)) + 450 * Math.sin(3 * t + 1);
    pts.push({ x, z, y: Math.max(0, y) });
  }
  return {
    points: autoBank(pts, 7, 8),
    startParam: 5.0,
    pieces: [
      { kind: 'boostPanel', param: 6.4 },
      { kind: 'itemRow', param: 8.0 },
      { kind: 'itemRow', param: 11.5 },
      { kind: 'itemRow', param: 17.0 },
      { kind: 'boostPanel', param: 19.4, lateral: 0.3 },
    ],
  };
}

const BUILDERS: Record<string, () => LayoutBuild> = {
  oval: stadium,
  kidney,
  'figure-eight': figureEight,
  twisty,
  hills,
};

/** Closed outline of a build, normalised into the unit square for thumbnails. */
function normalizedOutline(build: LayoutBuild): Vec2[] {
  const xs = build.points.map((p) => p.x);
  const zs = build.points.map((p) => p.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const span = Math.max(maxX - minX, maxZ - minZ) || 1;
  const pad = 0.08;
  const scale = (1 - pad * 2) / span;
  const ox = 0.5 - ((maxX - minX) * scale) / 2 - minX * scale;
  const oz = 0.5 - ((maxZ - minZ) * scale) / 2 - minZ * scale;
  return build.points.map((p) => ({ x: p.x * scale + ox, z: p.z * scale + oz }));
}

const META: Array<Omit<LayoutTemplate, 'preview'>> = [
  { id: 'blank', label: 'Blank', description: 'Start from nothing and draw the road yourself.' },
  { id: 'oval', label: 'Oval', description: 'Two long straights and two wide turns. The easiest track to drive.' },
  { id: 'kidney', label: 'Kidney', description: 'A rounded loop with a few bends of different sizes.' },
  { id: 'figure-eight', label: 'Figure-eight', description: 'The road crosses itself: one pass goes over the other on a bridge.' },
  { id: 'twisty', label: 'Twisty', description: 'A winding loop full of changing corners.' },
  { id: 'hills', label: 'Hills', description: 'A loop that climbs and dips, with banked corners.' },
];

export const LAYOUT_TEMPLATES: LayoutTemplate[] = META.map((meta) => ({
  ...meta,
  preview: BUILDERS[meta.id] ? normalizedOutline(BUILDERS[meta.id]()) : [],
}));

export function getLayoutTemplate(id: string): LayoutTemplate | null {
  return LAYOUT_TEMPLATES.find((t) => t.id === id) ?? null;
}

export interface NewProjectOptions {
  name: string;
  themeId: string;
  laps: number;
}

/** An empty design: no roads yet. */
export function createBlankProject(options: NewProjectOptions, kit?: CreateKit | null): CreateProject {
  const now = Date.now();
  const theme = kit?.theme(options.themeId) ?? null;
  return {
    version: CREATE_PROJECT_VERSION,
    id: createId('project'),
    name: options.name,
    createdAt: now,
    updatedAt: now,
    themeId: options.themeId,
    settings: { ...DEFAULT_SETTINGS, flareColor: [...DEFAULT_SETTINGS.flareColor], laps: Math.max(1, Math.min(9, Math.round(options.laps))) },
    roads: [],
    start: { roadId: '', param: 0 },
    terrain: {
      ...DEFAULT_TERRAIN,
      enabled: theme ? theme.terrain : DEFAULT_TERRAIN.enabled,
      // The ground starts where the world's sky was built for it, so there is no void under the dome.
      baseHeight: theme?.baseHeight ?? DEFAULT_TERRAIN.baseHeight,
      surface: { ...DEFAULT_TERRAIN.surface },
    },
    terrainStrokes: [],
    pieces: [],
    props: [],
    generation: { ...DEFAULT_GENERATION, lockedKmpSections: [] },
  };
}

export function createProjectFromTemplate(templateId: string, options: NewProjectOptions, kit?: CreateKit | null): CreateProject {
  const project = createBlankProject(options, kit);
  const builder = BUILDERS[templateId];
  if (!builder) return project;
  const build = builder();
  const theme = kit?.theme(options.themeId) ?? null;
  const styleId = theme?.defaultRoadStyle ?? DEFAULT_ROAD_STYLE_ID;
  const style = getRoadStyle(styleId);
  // Road points sit on the design's ground: the template's own offset (if any) is relative to it.
  const base = project.terrain.baseHeight + (build.baseHeight ?? 0);
  const points: RoadPoint[] = build.points.map((p) => ({
    id: createId('pt'),
    position: { x: p.x, y: base + (p.y ?? 0), z: p.z },
    width: p.width ?? style.defaultWidth,
    bank: p.bank ?? 0,
    corner: p.corner ?? 'smooth',
  }));
  const road: Road = {
    id: createId('road'),
    name: 'Main road',
    closed: true,
    points,
    styleId,
    sections: (build.sections ?? [{ start: 0, kind: 'road' as const }]).map((s) => ({ id: createId('sec'), start: s.start, kind: s.kind })),
  };
  // Bridge sections read better with the bridge deck style (low rails, no shoulders).
  road.sections = road.sections.map((s) =>
    s.kind === 'bridge' ? { ...s, left: { curb: false, shoulder: null, shoulderWidth: 0, wall: 'barrier' as const, wallHeight: 200 }, right: { curb: false, shoulder: null, shoulderWidth: 0, wall: 'barrier' as const, wallHeight: 200 } } : s,
  );
  const end = roadParamEnd(road);
  const pieces: Piece[] = build.pieces.map((spec) => {
    const defaults = defaultPiece(spec.kind, style.defaultWidth);
    return {
      ...defaults,
      ...(spec.overrides ?? {}),
      id: createId('pc'),
      roadId: road.id,
      param: ((spec.param % end) + end) % end,
      lateral: spec.lateral ?? defaults.lateral,
      kind: spec.kind,
    };
  });
  const designed: CreateProject = {
    ...project,
    roads: [road],
    start: { roadId: road.id, param: build.startParam },
    pieces,
  };
  return kit ? addDefaultScenery(designed, kit, templateId) : designed;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Default scenery
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Trees, rocks and the like, best first; the generic props (crates, cones, billboards) are never scattered by default. */
const NATURE_OBJECTS = [303, 307, 305, 311, 336, 355, 325, 374, 520, 532, 533, 23];
const SMALL_ACCENTS = [306];
const GENERIC_FALLBACK = [302, 380, 358, 202];

const MAX_SCENERY_PROPS = 110;
const SCENERY_CLUSTER_RADIUS = 3000;
/** Distance of a cluster centre from the nearest road centre line. */
const SCENERY_MIN_ROAD_DISTANCE = 8500;

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Scatters a few clusters of the theme's own scenery (trees, rocks...) well back from the road, on
 * both sides, so a new track starts out looking lived-in. Deterministic per template and theme; never
 * on or right next to the road, so the start grid stays clear.
 */
export function addDefaultScenery(project: CreateProject, kit: CreateKit, templateId: string): CreateProject {
  const main = project.roads[0];
  if (!main || main.points.length < 3) return project;
  const entries = kit.catalog.scenery.filter((e) => e.themeIds.includes(project.themeId));
  if (entries.length === 0) return project;
  const byId = new Map(entries.map((e) => [e.objectId, e]));
  let chosen = NATURE_OBJECTS.filter((id) => byId.has(id));
  if (chosen.length === 0) chosen = GENERIC_FALLBACK.filter((id) => byId.has(id));
  if (chosen.length === 0) return project;
  chosen = chosen.slice(0, 3);
  const accent = SMALL_ACCENTS.find((id) => byId.has(id));

  const length = roadLength(main);
  const seed0 = hashString(`${templateId}:${project.themeId}`);
  const centres: Array<{ x: number; z: number }> = [];
  const step = 11000;
  const count = Math.max(1, Math.floor(length / step));
  let result = project;
  let placed = 0;
  for (let i = 0; i < count && placed < MAX_SCENERY_PROPS; i++) {
    const frame = evaluateRoadAt(main, distanceToRoadParam(main, (i + 0.5) * (length / count)));
    const side = i % 2 === 0 ? 1 : -1;
    const wobble = ((seed0 >>> (i % 16)) & 7) / 7;
    const offset = frame.width / 2 + 9500 + wobble * 3000;
    const cx = frame.position.x + frame.right.x * side * offset;
    const cz = frame.position.z + frame.right.z * side * offset;
    // Keep clear of every road (the other side of a narrow infield, the other lobe of a figure-eight...).
    let ok = true;
    for (const road of project.roads) {
      const proj = projectOntoRoad(road, { x: cx, z: cz }, { heightWeight: 0 });
      if (proj && proj.distanceToCenter < SCENERY_MIN_ROAD_DISTANCE) ok = false;
    }
    if (!ok || centres.some((c) => Math.hypot(c.x - cx, c.z - cz) < 6500)) continue;
    centres.push({ x: cx, z: cz });
    const objectId = i % 5 === 4 && accent ? accent : chosen[i % chosen.length];
    const entry = byId.get(objectId)!;
    const before = result.props.length;
    result = scatterProps(result, {
      objectId,
      center: { x: cx, z: cz },
      radius: SCENERY_CLUSTER_RADIUS,
      spacing: Math.max(entry.spacing * 1.3, 2000),
      seed: seed0 + i * 7919,
      scale: entry.scale * (objectId === accent ? 1 : 1.25),
      roadClearance: 2500,
    }).project;
    placed += result.props.length - before;
  }
  return result;
}
