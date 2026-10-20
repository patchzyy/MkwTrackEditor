/**
 * KMP generation: everything the game needs to run a race on the designed road.
 *
 * Defaults come from measuring the 32 retail courses (see docs/CREATE.md and the report):
 *  - a single KTPT sits ~150 units behind the lap line (the game lays the 12-kart grid out behind
 *    it, about 4200 units deep and ±1000 wide);
 *  - checkpoints are ~5000 apart (median across tracks, range 2300–9900) and 2.0–2.5× the road
 *    width wide (road + shoulders + grass);
 *  - enemy route points ~3500 apart, item route points ~3300 apart, item range ≈ 2.3× enemy range;
 *  - item boxes sit exactly on the road surface, in rows of 5 spaced 550 apart;
 *  - one respawn point per 3–8 checkpoints.
 */
import {
  createEmptyKmpFile,
  createStageInfo,
  KMP_NULL_INDEX_8,
  type KmpCamera,
  type KmpCheckpoint,
  type KmpEnemyPoint,
  type KmpFile,
  type KmpItemPoint,
  type KmpRespawnPoint,
  type KmpRoute,
} from '../kmpFile';
import {
  assignNearestRespawns,
  setCheckpointGraph,
  setEnemyPathGraph,
  setItemPathGraph,
  MAX_PATH_POINTS,
  type PathGroup,
} from '../kmpGraph';
import type { CreateIssue, CreateKit, CreateProject, KmpSectionKey, Prop, Road, Vec3 } from './types';
import {
  distanceToRoadParam,
  evaluateRoadAt,
  roadLength,
  roadParamToDistance,
  sampleRoadRange,
  type RoadSample,
} from './spline';
import { edgeExtra, sectionAt } from './sections';
import { headingDegrees, rightOf, segmentsIntersect2D } from './math';
import { pieceObjects } from './pieces';
import { propObjects, type GroundQuery } from './props';

export const START_OFFSET = 150;
/** Depth of the 12-kart start grid behind the KTPT (from the game's grid tables). */
export const GRID_DEPTH = 4400;
export const RESPAWN_LEAD = 250;
export const RESPAWN_LIFT = 20;
export const MAX_ROUTES = 0xfe;

export interface KmpGenOptions {
  ground?: GroundQuery;
  /** Props already snapped to the compiled ground (`CompiledGeometry.snappedProps`); wins over `ground`. */
  snappedProps?: Prop[];
  previous?: KmpFile | null;
}

export interface KmpGenResult {
  kmp: KmpFile;
  issues: CreateIssue[];
  itemBoxes: number;
  objects: number;
  checkpoints: number;
}

function lapCoord(distance: number, d0: number, length: number): number {
  let u = (distance - d0) % length;
  if (u < 0) u += length;
  return u;
}

function frameAtDistance(road: Road, distance: number): RoadSample {
  return evaluateRoadAt(road, distanceToRoadParam(road, distance));
}

interface Line {
  x: number;
  z: number;
  rx: number;
  rz: number;
  extL: number;
  extR: number;
  half: number;
  curvature: number;
}

function makeLine(road: Road, sample: RoadSample): Line {
  const half = sample.width / 2;
  const range = sectionAt(road, sample.param);
  const extraL = range ? edgeExtra(range.left, range.style.curbWidth) : 0;
  const extraR = range ? edgeExtra(range.right, range.style.curbWidth) : 0;
  const margin = Math.max(600, sample.width * 0.35);
  let extL = half + extraL + margin;
  let extR = half + extraR + margin;
  const k = sample.curvature;
  if (k > 1e-7) extR = Math.min(extR, Math.max(half, 0.8 / k));
  else if (k < -1e-7) extL = Math.min(extL, Math.max(half, 0.8 / -k));
  const r = rightOf(sample.tangent);
  return { x: sample.position.x, z: sample.position.z, rx: r.x, rz: r.z, extL, extR, half, curvature: k };
}

function lineEnds(l: Line): [number, number, number, number] {
  return [l.x - l.rx * l.extL, l.z - l.rz * l.extL, l.x + l.rx * l.extR, l.z + l.rz * l.extR];
}

/** Shrinks the inner sides of neighbouring checkpoint lines until they stop crossing. */
function uncross(lines: Line[], closed: boolean): void {
  const n = lines.length;
  const count = closed ? n : n - 1;
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (let j = 0; j < count; j++) {
      const a = lines[j];
      const b = lines[(j + 1) % n];
      const ea = lineEnds(a);
      const eb = lineEnds(b);
      if (!segmentsIntersect2D(ea[0], ea[1], ea[2], ea[3], eb[0], eb[1], eb[2], eb[3])) continue;
      for (const line of [a, b]) {
        const inner = a.curvature + b.curvature > 0 ? 'R' : 'L';
        if (inner === 'R') line.extR = Math.max(line.half, line.extR * 0.75);
        else line.extL = Math.max(line.half, line.extL * 0.75);
      }
      changed = true;
    }
    if (!changed) break;
  }
}

function toCheckpoint(line: Line, type: number): KmpCheckpoint {
  const [x1, z1, x2, z2] = lineEnds(line);
  return { x1, z1, x2, z2, respawnIndex: KMP_NULL_INDEX_8, type, prev: KMP_NULL_INDEX_8, next: KMP_NULL_INDEX_8 };
}

function buildGraphLinks(stageGroups: number[][], groupCount: number): { prev: number[][]; next: number[][] } {
  const prev: number[][] = Array.from({ length: groupCount }, () => []);
  const next: number[][] = Array.from({ length: groupCount }, () => []);
  const s = stageGroups.length;
  for (let i = 0; i < s; i++) {
    const to = stageGroups[(i + 1) % s];
    for (const g of stageGroups[i]) {
      for (const t of to) {
        if (!next[g].includes(t)) next[g].push(t);
        if (!prev[t].includes(g)) prev[t].push(g);
      }
    }
  }
  return { prev, next };
}

interface BranchPlan {
  road: Road;
  fromU: number;
  toU: number;
}

function planBranches(project: CreateProject, main: Road, d0: number, length: number, issues: CreateIssue[]): BranchPlan[] {
  const plans: BranchPlan[] = [];
  for (const road of project.roads) {
    if (road === main || !road.branch || road.points.length < 2) continue;
    const b = road.branch;
    if (b.fromRoadId !== main.id || b.toRoadId !== main.id) {
      issues.push({
        level: 'warning',
        code: 'branch.not-on-main',
        message: `The shortcut "${road.name}" does not start and end on the main road, so the race route ignores it.`,
        fix: 'Connect both ends of the shortcut to the main road.',
        target: { kind: 'road', roadId: road.id },
      });
      continue;
    }
    const fromU = lapCoord(roadParamToDistance(main, b.fromParam), d0, length);
    const toU = lapCoord(roadParamToDistance(main, b.toParam), d0, length);
    if (!(toU > fromU + 1000)) {
      issues.push({
        level: 'warning',
        code: 'branch.crosses-start',
        message: `The shortcut "${road.name}" runs across the start line, so the race route ignores it.`,
        fix: 'Move the shortcut so it begins and ends after the start line.',
        target: { kind: 'road', roadId: road.id },
      });
      continue;
    }
    plans.push({ road, fromU, toU });
  }
  plans.sort((a, b) => a.fromU - b.fromU);
  const kept: BranchPlan[] = [];
  for (const plan of plans) {
    const last = kept[kept.length - 1];
    if (last && plan.fromU < last.toU) {
      issues.push({
        level: 'warning',
        code: 'branch.overlap',
        message: `The shortcut "${plan.road.name}" overlaps another shortcut, so the race route ignores it.`,
        fix: 'Make shortcuts cover different parts of the track.',
        target: { kind: 'road', roadId: plan.road.id },
      });
      continue;
    }
    kept.push(plan);
  }
  return kept;
}

/** Points along a branch road at roughly `spacing`, centred in each slot. */
function branchFrames(road: Road, spacing: number): RoadSample[] {
  const len = roadLength(road);
  const n = Math.max(2, Math.round(len / spacing));
  const out: RoadSample[] = [];
  for (let i = 0; i < n; i++) out.push(frameAtDistance(road, ((i + 0.5) * len) / n));
  return out;
}

interface Placed<T> {
  item: T;
  /** Distance from the lap line, 0..L (branch points are spread over the stretch they replace). */
  u: number;
}

/**
 * Splits the lap into groups: plain stretches and parallel (main road / shortcut) stages, linked
 * stage to stage, with the last stage leading back to the first.
 */
function buildPointGroups<T>(
  mainPoints: Array<Placed<T>>,
  plans: BranchPlan[],
  branchPoints: (plan: BranchPlan) => Array<Placed<T>>,
  length: number,
): { groups: Array<PathGroup<T>>; flat: Array<Placed<T>> } {
  const raw: Array<Array<Placed<T>>> = [];
  const stageGroups: number[][] = [];
  type Spec = { kind: 'seg'; from: number; to: number } | { kind: 'par'; plan: BranchPlan };
  const specs: Spec[] = [];
  let cursor = 0;
  for (const plan of plans) {
    specs.push({ kind: 'seg', from: cursor, to: plan.fromU });
    specs.push({ kind: 'par', plan });
    cursor = plan.toU;
  }
  specs.push({ kind: 'seg', from: cursor, to: length + 1e-6 });
  for (const spec of specs) {
    if (spec.kind === 'seg') {
      const pts = mainPoints.filter((p) => p.u >= spec.from - 1e-9 && p.u < spec.to);
      if (pts.length === 0) continue;
      raw.push(pts);
      stageGroups.push([raw.length - 1]);
    } else {
      const ids: number[] = [];
      const mainPts = mainPoints.filter((p) => p.u >= spec.plan.fromU - 1e-9 && p.u < spec.plan.toU);
      const branchPts = branchPoints(spec.plan);
      if (mainPts.length > 0) {
        raw.push(mainPts);
        ids.push(raw.length - 1);
      }
      if (branchPts.length > 0) {
        raw.push(branchPts);
        ids.push(raw.length - 1);
      }
      if (ids.length > 0) stageGroups.push(ids);
    }
  }
  const { prev, next } = buildGraphLinks(stageGroups, raw.length);
  return {
    groups: raw.map((pts, i) => ({ points: pts.map((p) => p.item), prev: prev[i], next: next[i], linkFlags: 0 })),
    flat: raw.flat(),
  };
}

function enemyRangeFor(width: number): number {
  return Math.round(Math.min(25, Math.max(8, width / 230)) * 4) / 4;
}

function nearestIndexByU(values: number[], u: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < values.length; i++) {
    const d = Math.abs(values[i] - u);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function generateKmp(project: CreateProject, kit: CreateKit, options: KmpGenOptions = {}): KmpGenResult {
  void kit;
  const issues: CreateIssue[] = [];
  const kmp = createEmptyKmpFile();
  const main = project.roads[0];
  const settings = project.settings;
  const gen = project.generation;

  kmp.stage = [
    {
      ...createStageInfo(),
      lapCount: Math.max(1, Math.min(9, Math.round(settings.laps))),
      polePosition: settings.polePosition === 'right' ? 1 : 0,
      driverDistance: settings.narrowStart ? 1 : 0,
      lensFlareFlash: settings.lensFlare ? 0 : 1,
      flareColor: [...settings.flareColor],
      speedModifier: settings.speedFactor === 1 ? 0 : settings.speedFactor,
    },
  ];

  if (!main || main.points.length < 2) {
    return { kmp: applyLocks(kmp, options.previous, gen.lockedKmpSections), issues, itemBoxes: 0, objects: 0, checkpoints: 0 };
  }

  const lapLength = roadLength(main);
  const startsOnMain = project.start.roadId === main.id;
  const d0 = startsOnMain ? roadParamToDistance(main, project.start.param) : 0;
  const plans = main.closed ? planBranches(project, main, d0, lapLength, issues) : [];
  const branchLength = plans.reduce((sum, p) => sum + roadLength(p.road), 0);

  // ── Checkpoints ────────────────────────────────────────────────────────────────────────────
  const spacingCp = Math.max(1500, gen.checkpointSpacing);
  const cpCount = Math.min(MAX_PATH_POINTS - 15, Math.max(8, Math.round(lapLength / spacingCp)));
  const cpStep = lapLength / cpCount;
  const lines: Line[] = [];
  const cpSamples: RoadSample[] = [];
  for (let j = 0; j < cpCount; j++) {
    const s = frameAtDistance(main, d0 + j * cpStep);
    cpSamples.push(s);
    lines.push(makeLine(main, s));
  }
  uncross(lines, main.closed);

  // Key checkpoints: evenly spread, numbered 1..K in path order (the lap line is type 0).
  const keyCount = Math.max(0, Math.min(40, Math.round(gen.keyCheckpoints), cpCount - 2));
  const keyIndices: number[] = [];
  for (let k = 1; k <= keyCount; k++) {
    let j = Math.round((k * cpCount) / (keyCount + 1));
    j = Math.max(1, Math.min(cpCount - 1, j));
    while (keyIndices.includes(j) && j < cpCount - 1) j++;
    if (!keyIndices.includes(j)) keyIndices.push(j);
  }
  keyIndices.sort((a, b) => a - b);
  const keyTypeAt = new Map<number, number>();
  keyIndices.forEach((j, i) => keyTypeAt.set(j, i + 1));

  const mainCheckpoints: Array<Placed<KmpCheckpoint>> = lines.map((line, j) => ({
    u: j * cpStep,
    item: toCheckpoint(line, j === 0 ? 0 : (keyTypeAt.get(j) ?? KMP_NULL_INDEX_8)),
  }));
  const branchCheckpoints = (plan: BranchPlan): Array<Placed<KmpCheckpoint>> => {
    const len = roadLength(plan.road);
    const n = Math.max(2, Math.round(len / spacingCp));
    const bl: Line[] = [];
    for (let i = 0; i < n; i++) bl.push(makeLine(plan.road, frameAtDistance(plan.road, ((i + 0.5) * len) / n)));
    uncross(bl, false);
    const placed = bl.map((l, i) => ({
      u: plan.fromU + ((i + 0.5) / n) * (plan.toU - plan.fromU),
      item: toCheckpoint(l, KMP_NULL_INDEX_8),
    }));
    // Same key checkpoints as the stretch of main road this shortcut replaces.
    const used = new Set<number>();
    for (const [j, type] of keyTypeAt) {
      const u = j * cpStep;
      if (u < plan.fromU || u >= plan.toU) continue;
      const idx = nearestIndexByU(placed.map((p) => p.u), u);
      if (used.has(idx)) continue;
      used.add(idx);
      placed[idx].item = { ...placed[idx].item, type };
    }
    return placed;
  };
  const cpResult = buildPointGroups(mainCheckpoints, plans, branchCheckpoints, lapLength);
  let file = setCheckpointGraph(kmp, { kind: 'checkpoint', groups: cpResult.groups });

  // ── Respawn points ─────────────────────────────────────────────────────────────────────────
  const every = Math.max(1, Math.round(gen.respawnEvery));
  const respawns: KmpRespawnPoint[] = [];
  const respawnU: number[] = [];
  for (let j = 0; j < cpCount; j += every) {
    let d = d0 + j * cpStep + RESPAWN_LEAD;
    let s = frameAtDistance(main, d);
    // Never respawn into a gap: slide to the far side of it.
    for (let guard = 0; guard < 8; guard++) {
      const range = sectionAt(main, s.param);
      if (!range || range.kind !== 'gap') break;
      let endDistance = roadParamToDistance(main, range.to);
      if (endDistance <= d) endDistance += lapLength;
      d = endDistance + 300;
      s = frameAtDistance(main, d);
    }
    respawns.push({
      position: { x: s.position.x, y: s.position.y + RESPAWN_LIFT, z: s.position.z },
      rotation: { x: 0, y: headingDegrees(s.tangent), z: 0 },
      id: respawns.length,
      extraUserData: -1,
    });
    respawnU.push(j * cpStep);
  }
  const respawnFor = (u: number): number => {
    let idx = 0;
    for (let i = 0; i < respawnU.length; i++) if (respawnU[i] <= u + 1e-6) idx = i;
    return idx;
  };
  file = {
    ...file,
    respawnPoints: respawns,
    checkpoints: file.checkpoints.map((c, i) => ({ ...c, respawnIndex: respawnFor(cpResult.flat[i]?.u ?? 0) })),
  };

  // ── Start point (the game lays the grid out behind it) ─────────────────────────────────────
  {
    const s = frameAtDistance(main, d0 - START_OFFSET);
    file.startPoints = [
      {
        position: { x: s.position.x, y: s.position.y + 10, z: s.position.z },
        rotation: { x: 0, y: headingDegrees(s.tangent), z: 0 },
        playerIndex: -1,
        padding: 0,
      },
    ];
  }

  // ── Enemy and item routes ──────────────────────────────────────────────────────────────────
  const budget = MAX_PATH_POINTS - 6;
  const effEnemy = Math.max(gen.enemySpacing, 1200, (lapLength + branchLength) / budget);
  const effItem = Math.max(gen.itemSpacing, 1200, (lapLength + branchLength) / budget);
  const enemyAt = (s: RoadSample): KmpEnemyPoint => ({ position: { ...s.position }, range: enemyRangeFor(s.width), setting1: 0, setting2: 0, setting3: 0 });
  const itemAt = (s: RoadSample): KmpItemPoint => ({ position: { ...s.position }, range: Math.round(enemyRangeFor(s.width) * 2.3), setting1: 0, setting2: 0 });

  const routePoints = <T,>(spacing: number, make: (s: RoadSample) => T) => {
    const n = Math.max(6, Math.round(lapLength / spacing));
    const out: Array<Placed<T>> = [];
    for (let i = 0; i < n; i++) {
      const u = ((i + 0.5) * lapLength) / n;
      out.push({ u, item: make(frameAtDistance(main, d0 + u)) });
    }
    return out;
  };
  const branchRoutePoints = <T,>(plan: BranchPlan, spacing: number, make: (s: RoadSample) => T): Array<Placed<T>> => {
    const frames = branchFrames(plan.road, spacing);
    return frames.map((s, i) => ({ u: plan.fromU + ((i + 0.5) / frames.length) * (plan.toU - plan.fromU), item: make(s) }));
  };
  const enemyResult = buildPointGroups(routePoints(effEnemy, enemyAt), plans, (plan) => branchRoutePoints(plan, effEnemy, enemyAt), lapLength);
  file = setEnemyPathGraph(file, { kind: 'enemy', groups: enemyResult.groups });
  const itemResult = buildPointGroups(routePoints(effItem, itemAt), plans, (plan) => branchRoutePoints(plan, effItem, itemAt), lapLength);
  file = setItemPathGraph(file, { kind: 'item', groups: itemResult.groups });

  // ── Objects and routes ─────────────────────────────────────────────────────────────────────
  const locked = new Set<KmpSectionKey>(gen.lockedKmpSections);
  const previous = options.previous ?? null;
  const keepPreviousRoutes = !!previous && (locked.has('routes') || locked.has('cameras') || locked.has('objects'));
  const routes: KmpRoute[] =
    keepPreviousRoutes && previous
      ? previous.routes.map((r) => ({ ...r, points: r.points.map((p) => ({ ...p, position: { ...p.position } })) }))
      : [];

  const pieceResult = pieceObjects(project, routes.length);
  routes.push(...pieceResult.routes);
  file.objects = [...pieceResult.objects, ...propObjects(project, options.ground, options.snappedProps)];

  // ── Cameras ────────────────────────────────────────────────────────────────────────────────
  if (gen.cameras) {
    const built = buildCameras(project, main, d0, lapLength, routes.length);
    file.cameras = built.cameras;
    file.firstOpeningCamera = built.firstOpening;
    file.firstSelectionCamera = built.firstSelection;
    routes.push(...built.routes);
  }
  if (routes.length > MAX_ROUTES) {
    issues.push({
      level: 'warning',
      code: 'route.too-many',
      message: 'This design has more moving objects than the game can handle.',
      fix: 'Remove some hazards.',
    });
  }
  file.routes = routes;
  file.areas = [];

  const result = applyLocks(file, previous, gen.lockedKmpSections);
  return {
    kmp: result,
    issues,
    itemBoxes: result.objects.filter((o) => o.objectId === 0x65).length,
    objects: result.objects.length,
    checkpoints: result.checkpoints.length,
  };
}

function pointAtU(road: Road, d0: number, u: number, lift = 0): Vec3 {
  const s = frameAtDistance(road, d0 + u);
  return { x: s.position.x, y: s.position.y + lift, z: s.position.z };
}

function viewVelocityFor(a: Vec3, b: Vec3, frames: number): number {
  const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  return Math.min(0xffff, Math.ceil((dist * 100) / Math.max(1, frames)));
}

function emptyCamera(): KmpCamera {
  const zero = { x: 0, y: 0, z: 0 };
  return {
    type: 5,
    nextIndex: KMP_NULL_INDEX_8,
    shake: 0,
    routeIndex: KMP_NULL_INDEX_8,
    pointVelocity: 0,
    zoomVelocity: 0,
    viewVelocity: 0,
    start: 0,
    movie: 0,
    position: { ...zero },
    rotation: { ...zero },
    zoomStart: 60,
    zoomEnd: 60,
    viewStart: { ...zero },
    viewEnd: { ...zero },
    time: 120,
  };
}

/** A slow two-point route so a nearly static opening shot still has the route the game expects. */
function addDriftRoute(cam: KmpCamera, routes: KmpRoute[], routeBase: number, dirX: number, dirZ: number, speed: number): void {
  const length = speed * (cam.time + 5);
  const l = Math.hypot(dirX, dirZ) || 1;
  const start = { ...cam.position };
  const end = { x: start.x + (dirX / l) * length, y: start.y, z: start.z + (dirZ / l) * length };
  cam.routeIndex = routeBase + routes.length;
  routes.push({
    smooth: 0,
    forwardBackward: 1,
    points: [
      { position: start, setting1: speed, setting2: 0 },
      { position: end, setting1: speed, setting2: 0 },
    ],
  });
}

/**
 * Goal camera (index 0), three opening shots (1→2→3) and a looping pair for the course preview.
 * Route speeds are units per frame (POTI), camera/zoom/view velocities units per 100 frames.
 */
export function buildCameras(
  project: CreateProject,
  main: Road,
  d0: number,
  length: number,
  routeBase: number,
): { cameras: KmpCamera[]; routes: KmpRoute[]; firstOpening: number; firstSelection: number } {
  const cameras: KmpCamera[] = [];
  const routes: KmpRoute[] = [];
  const startFrame = frameAtDistance(main, d0);
  const right = rightOf(startFrame.tangent);
  const fwd = { x: startFrame.tangent.x, z: startFrame.tangent.z };
  const fl = Math.hypot(fwd.x, fwd.z) || 1;
  fwd.x /= fl;
  fwd.z /= fl;
  const startPos = startFrame.position;

  // Goal camera, copied from retail: sits off to the side and high, looks at the player.
  const goal = emptyCamera();
  Object.assign(goal, {
    type: 0,
    position: { x: startPos.x + right.x * 6000, y: startPos.y + 5500, z: startPos.z + right.z * 6000 },
    zoomStart: 85,
    zoomEnd: 40,
    zoomVelocity: 30,
    viewStart: { x: -30, y: -1, z: 550 },
    viewEnd: { x: -5, y: 1, z: 0 },
    time: 0,
  });
  cameras.push(goal);

  // Overview centre and size, from the lap itself.
  const samples = sampleRoadRange(main, 0, main.closed ? main.points.length : main.points.length - 1, { step: 4000, maxAngleDegrees: 30 });
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, sumY = 0;
  for (const s of samples) {
    minX = Math.min(minX, s.position.x);
    maxX = Math.max(maxX, s.position.x);
    minZ = Math.min(minZ, s.position.z);
    maxZ = Math.max(maxZ, s.position.z);
    sumY += s.position.y;
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const avgY = sumY / Math.max(1, samples.length);
  const span = Math.max(maxX - minX, maxZ - minZ, 8000);

  // Shot 1: a high, slow look across the far side of the track.
  const shot1 = emptyCamera();
  const t1 = 200;
  const v1a = pointAtU(main, d0, length * 0.45, 200);
  const v1b = pointAtU(main, d0, length * 0.8, 200);
  Object.assign(shot1, {
    type: 5,
    position: { x: cx, y: avgY + Math.max(7000, span * 0.35), z: cz },
    viewStart: v1a,
    viewEnd: v1b,
    viewVelocity: viewVelocityFor(v1a, v1b, t1),
    zoomStart: 55,
    zoomEnd: 45,
    zoomVelocity: Math.ceil((10 * 100) / t1),
    time: t1,
  });

  // Shot 2: fly along the last stretch before the line, looking ahead.
  const shot2 = emptyCamera();
  const t2 = 250;
  const flyStart = length - Math.min(length * 0.35, 30000);
  const flyEnd = length - Math.min(length * 0.08, 6000);
  const routePts: Vec3[] = [];
  const nPts = 6;
  for (let i = 0; i < nPts; i++) {
    const u = flyStart + ((flyEnd - flyStart) * i) / (nPts - 1);
    const p = pointAtU(main, d0, u, 1700);
    const s = frameAtDistance(main, d0 + u);
    routePts.push({ x: p.x + s.right.x * 900, y: p.y, z: p.z + s.right.z * 900 });
  }
  let routeLen = 0;
  for (let i = 1; i < routePts.length; i++) routeLen += Math.hypot(routePts[i].x - routePts[i - 1].x, routePts[i].y - routePts[i - 1].y, routePts[i].z - routePts[i - 1].z);
  const speed = Math.max(1, Math.floor(routeLen / (t2 + 5)));
  const route2 = routeBase + routes.length;
  routes.push({
    smooth: 0,
    forwardBackward: 1,
    points: routePts.map((position) => ({ position, setting1: speed, setting2: 0 })),
  });
  const v2a = pointAtU(main, d0, flyStart + 4500, 300);
  const v2b = pointAtU(main, d0, flyEnd + 4500, 300);
  Object.assign(shot2, {
    type: 5,
    routeIndex: route2,
    position: routePts[0],
    viewStart: v2a,
    viewEnd: v2b,
    viewVelocity: viewVelocityFor(v2a, v2b, routeLen / speed),
    zoomStart: 60,
    zoomEnd: 50,
    zoomVelocity: Math.ceil((10 * 100) / t2),
    time: t2,
  });

  // Shot 3: stand ahead of the line and look back at the start grid.
  const shot3 = emptyCamera();
  const t3 = 300;
  const camPos = { x: startPos.x + fwd.x * 6500 + right.x * 1800, y: startPos.y + 1300, z: startPos.z + fwd.z * 6500 + right.z * 1800 };
  const v3a = pointAtU(main, d0, -2800, 150);
  const v3b = pointAtU(main, d0, -400, 150);
  Object.assign(shot3, {
    type: 5,
    position: camPos,
    viewStart: v3a,
    viewEnd: v3b,
    viewVelocity: viewVelocityFor(v3a, v3b, t3),
    zoomStart: 50,
    zoomEnd: 38,
    zoomVelocity: Math.ceil((12 * 100) / t3),
    time: t3,
  });
  shot1.nextIndex = 2;
  shot2.nextIndex = 3;
  addDriftRoute(shot1, routes, routeBase, fwd.x, fwd.z, 2);
  addDriftRoute(shot3, routes, routeBase, right.x, right.z, 1);
  cameras.push(shot1, shot2, shot3);

  // Course-preview pair (loops, like the retail character-select pan).
  const selA = emptyCamera();
  const selB = emptyCamera();
  Object.assign(selA, {
    type: 5,
    nextIndex: 5,
    position: { x: cx, y: avgY + Math.max(6000, span * 0.3), z: cz + span * 0.2 },
    viewStart: { x: cx, y: avgY, z: cz },
    viewEnd: { x: cx, y: avgY, z: cz },
    viewVelocity: 1,
    zoomStart: 60,
    zoomEnd: 60,
    time: 300,
  });
  Object.assign(selB, {
    type: 5,
    nextIndex: 4,
    position: { x: cx + span * 0.2, y: avgY + Math.max(6000, span * 0.3), z: cz },
    viewStart: { x: cx, y: avgY, z: cz },
    viewEnd: { x: cx, y: avgY, z: cz },
    viewVelocity: 1,
    zoomStart: 50,
    zoomEnd: 60,
    zoomVelocity: 2,
    time: 300,
  });
  addDriftRoute(selA, routes, routeBase, 1, 0, 2);
  addDriftRoute(selB, routes, routeBase, 0, 1, 2);
  cameras.push(selA, selB);
  void project;
  return { cameras, routes, firstOpening: 1, firstSelection: 4 };
}

/** Replaces locked sections of `generated` with the ones from `previous`. */
export function applyLocks(generated: KmpFile, previous: KmpFile | null | undefined, lockedKeys: KmpSectionKey[]): KmpFile {
  if (!previous || lockedKeys.length === 0) return generated;
  const out: KmpFile = { ...generated };
  const clonePoints = <T extends { position: Vec3 }>(list: T[]): T[] => list.map((p) => ({ ...p, position: { ...p.position } }));
  for (const key of lockedKeys) {
    switch (key) {
      case 'startPoints':
        out.startPoints = previous.startPoints.map((p) => ({ ...p, position: { ...p.position }, rotation: { ...p.rotation } }));
        break;
      case 'enemy':
        out.enemyPoints = clonePoints(previous.enemyPoints);
        out.enemyGroups = previous.enemyGroups.map((g) => ({ ...g, prev: [...g.prev], next: [...g.next] }));
        break;
      case 'item':
        out.itemPoints = clonePoints(previous.itemPoints);
        out.itemGroups = previous.itemGroups.map((g) => ({ ...g, prev: [...g.prev], next: [...g.next] }));
        break;
      case 'checkpoints':
        out.checkpoints = previous.checkpoints.map((c) => ({ ...c }));
        out.checkpointGroups = previous.checkpointGroups.map((g) => ({ ...g, prev: [...g.prev], next: [...g.next] }));
        break;
      case 'respawnPoints':
        out.respawnPoints = previous.respawnPoints.map((r) => ({ ...r, position: { ...r.position }, rotation: { ...r.rotation } }));
        break;
      case 'objects':
        out.objects = previous.objects.map((o) => ({ ...o, position: { ...o.position }, rotation: { ...o.rotation }, scale: { ...o.scale }, settings: [...o.settings] }));
        break;
      case 'routes':
        // Routes are layered in generateKmp (previous routes are kept as the base list).
        break;
      case 'areas':
        out.areas = previous.areas.map((a) => ({ ...a, position: { ...a.position }, rotation: { ...a.rotation }, scale: { ...a.scale } }));
        break;
      case 'cameras':
        out.cameras = previous.cameras.map((c) => ({ ...c, position: { ...c.position }, rotation: { ...c.rotation }, viewStart: { ...c.viewStart }, viewEnd: { ...c.viewEnd } }));
        out.firstOpeningCamera = previous.firstOpeningCamera;
        out.firstSelectionCamera = previous.firstSelectionCamera;
        break;
      case 'stage':
        out.stage = previous.stage.map((s) => ({ ...s, flareColor: [...s.flareColor] }));
        break;
    }
  }
  if (out.respawnPoints.length > 0) {
    const fixed = assignNearestRespawns(out, { all: lockedKeys.includes('respawnPoints') && !lockedKeys.includes('checkpoints') });
    return fixed.file;
  }
  return out;
}
