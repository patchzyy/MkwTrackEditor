/**
 * Every design mutation as a pure function: `(project, ...) => project'` (or `{ project, id }`
 * when something is created). Nothing here mutates its input. Parameters stored on sections,
 * pieces, the start line and shortcut anchors are remapped when points are inserted or deleted, and
 * dependants are cleaned up when a road goes away.
 */
import type {
  CreateKit,
  CreateProject,
  CreateSelection,
  GenerationOptions,
  Piece,
  Prop,
  Road,
  RoadParam,
  RoadPoint,
  RoadSection,
  TerrainSettings,
  TerrainStroke,
  TrackSettings,
  Vec2,
  Vec3,
} from './types';
import { createId } from './ids';
import { createRandom } from './math';
import { getRoadStyle, DEFAULT_ROAD_STYLE_ID } from './roadStyles';
import { evaluateRoadAt, normalizeRoadParam, projectOntoRoad, roadParamEnd } from './spline';
import {
  deleteMap,
  identityMap,
  insertMap,
  openMap,
  prependMap,
  reverseMap,
  segmentCountFor,
  type ParamMap,
} from './ops/paramMap';
import { normalizeSections } from './ops/sections';

export { migrateProject, ProjectMigrationError, DEFAULT_GENERATION, DEFAULT_SETTINGS, DEFAULT_TERRAIN } from './ops/migrate';

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type NewTerrainStroke = DistributiveOmit<TerrainStroke, 'id'>;

export interface RoadPointInput {
  position: Vec3;
  width?: number;
  bank?: number;
  corner?: 'smooth' | 'sharp';
}

export interface AddRoadOptions {
  points?: RoadPointInput[];
  styleId?: string;
  closed?: boolean;
  name?: string;
}

let clock: () => number = () => Date.now();
/** Tests can pin the clock used for `updatedAt`. */
export function setOpsClock(fn: (() => number) | null): void {
  clock = fn ?? (() => Date.now());
}

const touch = (p: CreateProject): CreateProject => ({ ...p, updatedAt: clock() });

const MIN_WIDTH = 200;

function makePoint(input: RoadPointInput, fallbackWidth: number): RoadPoint {
  return {
    id: createId('pt'),
    position: { x: input.position.x, y: input.position.y, z: input.position.z },
    width: Math.max(MIN_WIDTH, input.width ?? fallbackWidth),
    bank: input.bank ?? 0,
    corner: input.corner ?? 'smooth',
  };
}

export function getRoad(p: CreateProject, roadId: string): Road | null {
  return p.roads.find((r) => r.id === roadId) ?? null;
}

function replaceRoad(p: CreateProject, road: Road): CreateProject {
  return { ...p, roads: p.roads.map((r) => (r.id === road.id ? road : r)) };
}

/** Applies a parameter map to everything anchored on `roadId` (sections are handled by the caller). */
function remapAnchors(p: CreateProject, roadId: string, map: ParamMap, lateralSign = 1): CreateProject {
  return {
    ...p,
    start: p.start.roadId === roadId ? { ...p.start, param: map(p.start.param) } : p.start,
    pieces: p.pieces.map((piece) =>
      piece.roadId === roadId ? { ...piece, param: map(piece.param), lateral: piece.lateral * lateralSign } : piece,
    ),
    roads: p.roads.map((r) => {
      if (!r.branch) return r;
      const b = r.branch;
      const next = { ...b };
      if (b.fromRoadId === roadId) next.fromParam = map(b.fromParam);
      if (b.toRoadId === roadId) next.toParam = map(b.toParam);
      return next.fromParam === b.fromParam && next.toParam === b.toParam ? r : { ...r, branch: next };
    }),
  };
}

/** Rebuilds a road with new points, remapping its sections and every anchor through `map`. */
function withPoints(
  p: CreateProject,
  road: Road,
  points: RoadPoint[],
  map: ParamMap,
  closed = road.closed,
): CreateProject {
  const sections = road.sections.map((s) => ({ ...s, start: map(s.start) }));
  const nextRoad = normalizeSections({ ...road, points, closed: closed && points.length >= 3, sections });
  return touch(remapAnchors(replaceRoad(p, nextRoad), road.id, map));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Roads
// ─────────────────────────────────────────────────────────────────────────────────────────────

export function addRoad(p: CreateProject, options: AddRoadOptions = {}): { project: CreateProject; id: string } {
  const styleId = options.styleId ?? p.roads[0]?.styleId ?? DEFAULT_ROAD_STYLE_ID;
  const width = getRoadStyle(styleId).defaultWidth;
  const points = (options.points ?? []).map((pt) => makePoint(pt, width));
  const id = createId('road');
  const road: Road = normalizeSections({
    id,
    name: options.name ?? (p.roads.length === 0 ? 'Main road' : `Road ${p.roads.length + 1}`),
    closed: !!options.closed && points.length >= 3,
    points,
    styleId,
    sections: [{ id: createId('sec'), start: 0, kind: 'road' }],
  });
  let project: CreateProject = { ...p, roads: [...p.roads, road] };
  if (!p.start.roadId || !p.roads.some((r) => r.id === p.start.roadId)) project = { ...project, start: { roadId: id, param: 0 } };
  return { project: touch(project), id };
}

export function appendRoadPoint(
  p: CreateProject,
  roadId: string,
  position: Vec3,
  options: { atStart?: boolean } = {},
): { project: CreateProject; id: string } {
  const road = getRoad(p, roadId);
  if (!road) return { project: p, id: '' };
  const ref = options.atStart ? road.points[0] : road.points[road.points.length - 1];
  const width = ref?.width ?? getRoadStyle(road.styleId).defaultWidth;
  const point = makePoint({ position, width }, width);
  const n = road.points.length;
  if (options.atStart) {
    const points = [point, ...road.points];
    return { project: withPoints(p, road, points, n >= 1 ? prependMap : identityMap), id: point.id };
  }
  const points = [...road.points, point];
  const map = road.closed && n >= 2 ? insertMap(n - 1, 0.5) : identityMap;
  return { project: withPoints(p, road, points, map), id: point.id };
}

export function insertRoadPoint(p: CreateProject, roadId: string, param: RoadParam): { project: CreateProject; id: string } {
  const road = getRoad(p, roadId);
  if (!road || road.points.length < 2) return { project: p, id: '' };
  const end = roadParamEnd(road);
  let seg = Math.floor(Math.max(0, Math.min(end, param)));
  if (seg >= end) seg = end - 1;
  // Keep the new point clear of its neighbours so the road never gets a zero-length segment.
  const t = Math.max(0.02, Math.min(0.98, param - seg));
  const u = seg + t;
  const frame = evaluateRoadAt(road, u);
  const point = makePoint({ position: frame.position, width: frame.width, bank: frame.bank }, frame.width);
  const points = [...road.points.slice(0, seg + 1), point, ...road.points.slice(seg + 1)];
  return { project: withPoints(p, road, points, insertMap(seg, t)), id: point.id };
}

export function updateRoadPoint(
  p: CreateProject,
  roadId: string,
  pointId: string,
  patch: Partial<Omit<RoadPoint, 'id'>>,
): CreateProject {
  const road = getRoad(p, roadId);
  if (!road || !road.points.some((pt) => pt.id === pointId)) return p;
  const points = road.points.map((pt) => {
    if (pt.id !== pointId) return pt;
    const next = { ...pt, ...patch };
    if (patch.position) next.position = { ...patch.position };
    if (patch.width !== undefined) next.width = Math.max(MIN_WIDTH, patch.width);
    return next;
  });
  return touch(replaceRoad(p, { ...road, points }));
}

export function deleteRoadPoint(p: CreateProject, roadId: string, pointId: string): CreateProject {
  const road = getRoad(p, roadId);
  if (!road) return p;
  const k = road.points.findIndex((pt) => pt.id === pointId);
  if (k < 0) return p;
  const n = road.points.length;
  const points = road.points.filter((_, i) => i !== k);
  return withPoints(p, road, points, deleteMap(n, road.closed, k));
}

export function setRoadClosed(p: CreateProject, roadId: string, closed: boolean): CreateProject {
  const road = getRoad(p, roadId);
  if (!road || road.closed === closed) return p;
  if (closed && road.points.length < 3) return p;
  return withPoints(p, road, road.points, closed ? identityMap : openMap(road.points.length), closed);
}

export function updateRoad(
  p: CreateProject,
  roadId: string,
  patch: Partial<Pick<Road, 'name' | 'styleId' | 'closed' | 'branch'>>,
): CreateProject {
  const road = getRoad(p, roadId);
  if (!road) return p;
  let project = p;
  if (patch.closed !== undefined && patch.closed !== road.closed) project = setRoadClosed(project, roadId, patch.closed);
  const current = getRoad(project, roadId) as Road;
  const next: Road = { ...current };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.styleId !== undefined) next.styleId = patch.styleId;
  if ('branch' in patch) {
    if (patch.branch) next.branch = { ...patch.branch };
    else delete next.branch;
  }
  return touch(replaceRoad(project, next));
}

function swapEdges(section: RoadSection): RoadSection {
  const next: RoadSection = { ...section };
  delete next.left;
  delete next.right;
  if (section.right) next.left = { ...section.right };
  if (section.left) next.right = { ...section.left };
  return next;
}

export function reverseRoad(p: CreateProject, roadId: string): CreateProject {
  const road = getRoad(p, roadId);
  if (!road || road.points.length < 2) return p;
  const map = reverseMap(road);
  const end = segmentCountFor(road.points.length, road.closed);
  const pts = road.points.map((pt) => ({ ...pt, bank: -pt.bank }));
  const points = road.closed ? [pts[0], ...pts.slice(1).reverse()] : [...pts].reverse();
  // Section k covers [a_k, b_k); reversed it covers (end - b_k, end - a_k].
  const sorted = [...road.sections].sort((a, b) => a.start - b.start);
  const sections = sorted.map((s, i) => {
    const b = i + 1 < sorted.length ? sorted[i + 1].start : end;
    return { ...swapEdges(s), start: end - b };
  });
  let branch = road.branch;
  if (branch) {
    branch = { fromRoadId: branch.toRoadId, fromParam: branch.toParam, toRoadId: branch.fromRoadId, toParam: branch.fromParam };
  }
  const next = normalizeSections({ ...road, points, sections, ...(branch ? { branch } : {}) });
  const project = remapAnchors(replaceRoad(p, next), roadId, map, -1);
  return touch(project);
}

export function deleteRoad(p: CreateProject, roadId: string): CreateProject {
  if (!getRoad(p, roadId)) return p;
  const roads = p.roads.filter((r) => r.id !== roadId).map((r) => {
    if (r.branch && (r.branch.fromRoadId === roadId || r.branch.toRoadId === roadId)) {
      const { branch: _branch, ...rest } = r;
      void _branch;
      return rest as Road;
    }
    return r;
  });
  const start = p.start.roadId === roadId ? { roadId: roads[0]?.id ?? '', param: 0 } : p.start;
  return touch({ ...p, roads, pieces: p.pieces.filter((piece) => piece.roadId !== roadId), start });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Sections
// ─────────────────────────────────────────────────────────────────────────────────────────────

function sortedSections(road: Road): RoadSection[] {
  return [...road.sections].sort((a, b) => a.start - b.start);
}

export function splitSection(p: CreateProject, roadId: string, param: RoadParam): { project: CreateProject; id: string } {
  const road = getRoad(p, roadId);
  if (!road || road.points.length < 2) return { project: p, id: '' };
  const u = normalizeRoadParam(road, param);
  const sections = sortedSections(road);
  const near = sections.find((s) => Math.abs(s.start - u) < 0.02);
  if (near) return { project: p, id: near.id };
  let host = sections[0];
  for (const s of sections) if (s.start <= u) host = s;
  const created: RoadSection = { ...host, id: createId('sec'), start: u };
  delete created.label;
  const next = normalizeSections({ ...road, sections: [...sections, created] });
  return { project: touch(replaceRoad(p, next)), id: created.id };
}

export function updateSection(
  p: CreateProject,
  roadId: string,
  sectionId: string,
  patch: Partial<Omit<RoadSection, 'id' | 'start'>>,
): CreateProject {
  const road = getRoad(p, roadId);
  if (!road || !road.sections.some((s) => s.id === sectionId)) return p;
  const sections = road.sections.map((s) => {
    if (s.id !== sectionId) return s;
    const next: RoadSection = { ...s };
    for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
      const value = patch[key];
      if (key === 'left' || key === 'right') {
        if (value === undefined) delete next[key];
        else next[key] = { ...(s[key] ?? {}), ...(value as object) };
      } else if (value === undefined) delete next[key];
      else (next as unknown as Record<string, unknown>)[key] = value;
    }
    return next;
  });
  return touch(replaceRoad(p, { ...road, sections }));
}

export function moveSectionStart(p: CreateProject, roadId: string, sectionId: string, param: RoadParam): CreateProject {
  const road = getRoad(p, roadId);
  if (!road) return p;
  const sections = sortedSections(road);
  const i = sections.findIndex((s) => s.id === sectionId);
  if (i <= 0) return p; // the first section always starts at 0
  const end = roadParamEnd(road);
  const lo = sections[i - 1].start + 0.02;
  const hi = (i + 1 < sections.length ? sections[i + 1].start : end) - 0.02;
  if (hi < lo) return p;
  const start = Math.max(lo, Math.min(hi, param));
  const next = sections.map((s, k) => (k === i ? { ...s, start } : s));
  return touch(replaceRoad(p, { ...road, sections: next }));
}

export function deleteSection(p: CreateProject, roadId: string, sectionId: string): CreateProject {
  const road = getRoad(p, roadId);
  if (!road || road.sections.length <= 1) return p;
  const sections = sortedSections(road);
  const i = sections.findIndex((s) => s.id === sectionId);
  if (i < 0) return p;
  const next = sections.filter((_, k) => k !== i);
  // The neighbour that remains first takes over the start of the road.
  if (i === 0) next[0] = { ...next[0], start: 0 };
  return touch(replaceRoad(p, normalizeSections({ ...road, sections: next })));
}

export function setStart(p: CreateProject, roadId: string, param: RoadParam): CreateProject {
  const road = getRoad(p, roadId);
  if (!road) return p;
  return touch({ ...p, start: { roadId, param: normalizeRoadParam(road, param) } });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Pieces and props
// ─────────────────────────────────────────────────────────────────────────────────────────────

export function addPiece(p: CreateProject, piece: Omit<Piece, 'id'>): { project: CreateProject; id: string } {
  const road = getRoad(p, piece.roadId);
  const id = createId('pc');
  const param = road ? normalizeRoadParam(road, piece.param) : piece.param;
  return { project: touch({ ...p, pieces: [...p.pieces, { ...piece, param, id }] }), id };
}

export function updatePiece(p: CreateProject, pieceId: string, patch: Partial<Omit<Piece, 'id'>>): CreateProject {
  if (!p.pieces.some((x) => x.id === pieceId)) return p;
  return touch({ ...p, pieces: p.pieces.map((x) => (x.id === pieceId ? { ...x, ...patch } : x)) });
}

export function deletePiece(p: CreateProject, pieceId: string): CreateProject {
  if (!p.pieces.some((x) => x.id === pieceId)) return p;
  return touch({ ...p, pieces: p.pieces.filter((x) => x.id !== pieceId) });
}

export function addProp(p: CreateProject, prop: Omit<Prop, 'id'>): { project: CreateProject; id: string } {
  const id = createId('prop');
  return { project: touch({ ...p, props: [...p.props, { ...prop, id }] }), id };
}

export function updateProp(p: CreateProject, propId: string, patch: Partial<Omit<Prop, 'id'>>): CreateProject {
  if (!p.props.some((x) => x.id === propId)) return p;
  return touch({ ...p, props: p.props.map((x) => (x.id === propId ? { ...x, ...patch } : x)) });
}

export function deleteProp(p: CreateProject, propId: string): CreateProject {
  if (!p.props.some((x) => x.id === propId)) return p;
  return touch({ ...p, props: p.props.filter((x) => x.id !== propId) });
}

export interface ScatterOptions {
  objectId: number;
  center: Vec2;
  radius: number;
  spacing: number;
  seed: number;
  scale: number;
  /** Keep this far away from any road edge. Default 1200. */
  roadClearance?: number;
}

/** Scatters props inside a circle on a jittered grid, never on or right beside a road. */
export function scatterProps(p: CreateProject, options: ScatterOptions): { project: CreateProject; ids: string[] } {
  const rand = createRandom(options.seed);
  const spacing = Math.max(150, options.spacing);
  const clearance = options.roadClearance ?? 1200;
  const added: Prop[] = [];
  const r = options.radius;
  const steps = Math.ceil(r / spacing);
  for (let gz = -steps; gz <= steps; gz++) {
    for (let gx = -steps; gx <= steps; gx++) {
      const x = options.center.x + (gx + (rand() - 0.5) * 0.8) * spacing;
      const z = options.center.z + (gz + (rand() - 0.5) * 0.8) * spacing;
      const rot = rand() * 360;
      const sc = options.scale * (0.85 + rand() * 0.35);
      if (Math.hypot(x - options.center.x, z - options.center.z) > r) continue;
      let blocked = false;
      for (const road of p.roads) {
        const proj = projectOntoRoad(road, { x, z }, { heightWeight: 0 });
        if (proj && Math.abs(proj.lateral) < proj.sample.width / 2 + clearance + 1500 && proj.distanceToCenter < proj.sample.width / 2 + clearance + 1500) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      added.push({
        id: createId('prop'),
        objectId: options.objectId,
        position: { x, y: p.terrain.baseHeight, z },
        rotation: { x: 0, y: rot, z: 0 },
        scale: { x: sc, y: sc, z: sc },
        snapToGround: true,
      });
    }
  }
  if (added.length === 0) return { project: p, ids: [] };
  return { project: touch({ ...p, props: [...p.props, ...added] }), ids: added.map((a) => a.id) };
}

export function eraseProps(p: CreateProject, center: Vec2, radius: number): CreateProject {
  const keep = p.props.filter((prop) => Math.hypot(prop.position.x - center.x, prop.position.z - center.z) > radius);
  if (keep.length === p.props.length) return p;
  return touch({ ...p, props: keep });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Terrain, settings, theme
// ─────────────────────────────────────────────────────────────────────────────────────────────

export function addTerrainStroke(p: CreateProject, stroke: NewTerrainStroke): { project: CreateProject; id: string } {
  const id = createId('stroke');
  return { project: touch({ ...p, terrainStrokes: [...p.terrainStrokes, { ...stroke, id } as TerrainStroke] }), id };
}

export function deleteTerrainStroke(p: CreateProject, strokeId: string): CreateProject {
  if (!p.terrainStrokes.some((s) => s.id === strokeId)) return p;
  return touch({ ...p, terrainStrokes: p.terrainStrokes.filter((s) => s.id !== strokeId) });
}

export function updateSettings(p: CreateProject, patch: Partial<TrackSettings>): CreateProject {
  const next = { ...p.settings, ...patch };
  next.laps = Math.max(1, Math.min(9, Math.round(next.laps)));
  return touch({ ...p, settings: next });
}

export function updateTerrain(p: CreateProject, patch: Partial<TerrainSettings>): CreateProject {
  return touch({ ...p, terrain: { ...p.terrain, ...patch } });
}

export function updateGeneration(p: CreateProject, patch: Partial<GenerationOptions>): CreateProject {
  return touch({ ...p, generation: { ...p.generation, ...patch } });
}

/**
 * Switches the world. With a `kit`, a design whose ground still sits at the old world's base height
 * moves (roads, props, ground) to the new world's, so it keeps sitting inside the new sky; a design
 * the user lifted or sank on purpose stays where it is.
 */
export function setTheme(p: CreateProject, themeId: string, kit?: CreateKit | null): CreateProject {
  if (p.themeId === themeId) return p;
  const from = kit?.theme(p.themeId)?.baseHeight;
  const to = kit?.theme(themeId)?.baseHeight;
  if (from === undefined || to === undefined || p.terrain.baseHeight !== from || from === to) return touch({ ...p, themeId });
  const dy = to - from;
  return touch({
    ...p,
    themeId,
    terrain: { ...p.terrain, baseHeight: to },
    roads: p.roads.map((road) => ({ ...road, points: road.points.map((pt) => ({ ...pt, position: { ...pt.position, y: pt.position.y + dy } })) })),
    props: p.props.map((prop) => ({ ...prop, position: { ...prop.position, y: prop.position.y + dy } })),
  });
}

export function renameProject(p: CreateProject, name: string): CreateProject {
  return touch({ ...p, name: name.trim() === '' ? p.name : name });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Selections
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Deletes everything in `selections` (the start line cannot be deleted). */
export function deleteSelection(p: CreateProject, selections: CreateSelection[]): CreateProject {
  let project = p;
  // Whole roads first, so their points and sections need no separate handling.
  for (const sel of selections) if (sel.kind === 'road') project = deleteRoad(project, sel.roadId);
  for (const sel of selections) {
    switch (sel.kind) {
      case 'point':
        project = deleteRoadPoint(project, sel.roadId, sel.pointId);
        break;
      case 'section':
        project = deleteSection(project, sel.roadId, sel.sectionId);
        break;
      case 'piece':
        project = deletePiece(project, sel.pieceId);
        break;
      case 'prop':
        project = deleteProp(project, sel.propId);
        break;
      case 'stroke':
        project = deleteTerrainStroke(project, sel.strokeId);
        break;
      default:
        break;
    }
  }
  return project;
}

/** True when the selection still points at something that exists. */
export function selectionExists(p: CreateProject, sel: CreateSelection): boolean {
  switch (sel.kind) {
    case 'road':
      return !!getRoad(p, sel.roadId);
    case 'point':
      return !!getRoad(p, sel.roadId)?.points.some((pt) => pt.id === sel.pointId);
    case 'section':
      return !!getRoad(p, sel.roadId)?.sections.some((s) => s.id === sel.sectionId);
    case 'piece':
      return p.pieces.some((x) => x.id === sel.pieceId);
    case 'prop':
      return p.props.some((x) => x.id === sel.propId);
    case 'stroke':
      return p.terrainStrokes.some((x) => x.id === sel.strokeId);
    case 'start':
      return !!getRoad(p, p.start.roadId);
  }
}
