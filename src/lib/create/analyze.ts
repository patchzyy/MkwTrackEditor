/**
 * Design analysis: friendly problems with fixes and "Show me" targets, plus the build checklist.
 * Messages are written for people who have never heard of checkpoints or collision meshes.
 */
import { validateKmpFile } from '../kmpValidation';
import type { CompileResult, CreateIssue, CreateKit, CreateProject, CreateSelection, Road } from './types';
import { distanceToRoadParam, evaluateRoadAt, projectOntoRoad, roadLength, roadParamEnd, roadParamToDistance, sampleRoad, sampleRoadRange, type RoadSample } from './spline';
import { GRID_DEPTH, START_OFFSET } from './kmpGen';
import { sectionAt, sectionRanges } from './sections';
import { segmentsIntersect2D } from './math';

function frameAtDistance(road: Road, distance: number): RoadSample {
  return evaluateRoadAt(road, distanceToRoadParam(road, distance));
}

/** Average kart speed on a typical lap at 150cc, in units per second (measured with the physics engine). */
export const AVERAGE_SPEED_PER_SECOND = 76 * 60;
/** Laps shorter than this feel like a corridor: about 20 seconds at an average kart speed. */
export const MIN_LAP_LENGTH = AVERAGE_SPEED_PER_SECOND * 20;
export const MAX_LAP_LENGTH = 420000;
export const MIN_SECTION_LENGTH = 1200;
/** Vertical clearance needed for one road to pass under another. */
export const MIN_BRIDGE_CLEARANCE = 800;
export const MAX_OBJECTS = 255;
/** The longest gap a kart can clear off a boost ramp (measured with the physics engine: 7000 clears, 9000 does not). */
export const MAX_JUMPABLE_GAP = 7000;
/** Half the width the start grid needs (karts are laid out about +-900 either side of the start point). */
export const GRID_HALF_WIDTH = 1100;

export type ChecklistState = 'done' | 'todo' | 'warn';

export interface ChecklistItem {
  state: ChecklistState;
  /** Short title ("Road loop"). */
  label: string;
  /** One line explaining the state. */
  detail: string;
  /** What "Show me" selects, when there is something to show. */
  target?: CreateSelection;
}

export interface ProjectChecklist {
  world: ChecklistItem;
  roadLoop: ChecklistItem;
  startLine: ChecklistItem;
  itemBoxes: ChecklistItem;
  drivable: ChecklistItem;
}

export interface ProjectAnalysis {
  issues: CreateIssue[];
  checklist: ProjectChecklist;
}

const roadTarget = (road: Road): CreateSelection => ({ kind: 'road', roadId: road.id });

function nearestPointTarget(road: Road, sample: RoadSample): CreateSelection {
  let best = 0;
  let bestD = Infinity;
  road.points.forEach((pt, i) => {
    const d = Math.hypot(pt.position.x - sample.position.x, pt.position.z - sample.position.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  const point = road.points[best];
  return point ? { kind: 'point', roadId: road.id, pointId: point.id } : roadTarget(road);
}

/** Number of item boxes the design will produce. */
export function countItemBoxes(project: CreateProject): number {
  let n = 0;
  for (const piece of project.pieces) {
    if (piece.kind === 'itemRow') n += Math.max(1, Math.round(piece.count ?? 5));
    else if (piece.kind === 'object' && piece.objectId === 0x65) n += 1;
  }
  for (const prop of project.props) if (prop.objectId === 0x65) n += 1;
  return n;
}

/** Estimated seconds for one lap at 150cc. */
export function estimateLapSeconds(lapLength: number): number {
  return lapLength / AVERAGE_SPEED_PER_SECOND;
}

function findCrossings(roads: Road[]): Array<{ a: Road; b: Road; sampleA: RoadSample; sampleB: RoadSample; dy: number }> {
  const out: Array<{ a: Road; b: Road; sampleA: RoadSample; sampleB: RoadSample; dy: number }> = [];
  const sampled = roads.map((r) => (r.points.length >= 2 ? sampleRoadRange(r, 0, roadParamEnd(r), { step: 600, maxAngleDegrees: 15 }) : []));
  for (let ra = 0; ra < roads.length; ra++) {
    for (let rb = ra; rb < roads.length; rb++) {
      const A = sampled[ra];
      const B = sampled[rb];
      for (let i = 0; i + 1 < A.length; i++) {
        const a0 = A[i];
        const a1 = A[i + 1];
        const jStart = ra === rb ? i + 2 : 0;
        for (let j = jStart; j + 1 < B.length; j++) {
          // Neighbouring segments of a closed loop share an end point.
          if (ra === rb && roads[ra].closed && i === 0 && j + 2 >= B.length) continue;
          const b0 = B[j];
          const b1 = B[j + 1];
          if (!segmentsIntersect2D(a0.position.x, a0.position.z, a1.position.x, a1.position.z, b0.position.x, b0.position.z, b1.position.x, b1.position.z)) continue;
          const dy = (a0.position.y + a1.position.y) / 2 - (b0.position.y + b1.position.y) / 2;
          out.push({ a: roads[ra], b: roads[rb], sampleA: a0, sampleB: b0, dy });
        }
      }
    }
  }
  return out;
}

/**
 * A place where one stretch of the road lies within its own width of a distant stretch at the same
 * height. "Distant" means further apart along the road than a couple of road widths, so the
 * neighbouring samples of a normal bend never count.
 */
function findOverlap(road: Road): RoadSample | null {
  const samples = sampleRoadRange(road, 0, roadParamEnd(road), { step: 600, maxAngleDegrees: 15 });
  const total = samples.length > 0 ? samples[samples.length - 1].distance : 0;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i];
    for (let j = i + 1; j < samples.length; j++) {
      const b = samples[j];
      let along = b.distance - a.distance;
      if (road.closed) along = Math.min(along, total - along);
      const reach = Math.max(a.width, b.width);
      if (along < reach * 2.5) continue;
      if (Math.abs(a.position.y - b.position.y) > 250) continue;
      if (Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) < reach * 0.9) return a;
    }
  }
  return null;
}

export function analyzeProject(project: CreateProject, kit: CreateKit, compiled?: Pick<CompileResult, 'kmp' | 'issues'> | null): ProjectAnalysis {
  const issues: CreateIssue[] = [];
  const add = (issue: CreateIssue) => issues.push(issue);

  const theme = kit.theme(project.themeId);
  if (!theme) {
    add({ level: 'error', code: 'world.missing', message: 'The chosen world is not available.', fix: 'Pick a world in the track settings.' });
  }

  const main = project.roads[0];
  const roadsOk = project.roads.filter((r) => r.points.length >= 2);
  let lapLength = 0;

  if (!main) {
    add({ level: 'error', code: 'road.none', message: 'There is no road yet.', fix: 'Pick the Road tool and click the ground to lay the first points.' });
  } else if (main.points.length < 3) {
    add({
      level: 'error',
      code: 'road.too-few-points',
      message: `The road has only ${main.points.length} point${main.points.length === 1 ? '' : 's'}.`,
      fix: 'Click the ground to add more points: a loop needs at least three.',
      target: roadTarget(main),
    });
  } else {
    lapLength = roadLength(main);
    if (!main.closed) {
      add({
        level: 'error',
        code: 'road.not-closed',
        message: 'The road does not form a loop yet.',
        fix: 'Click the first point again to close it.',
        target: roadTarget(main),
      });
    }
    if (main.closed && lapLength < MIN_LAP_LENGTH) {
      add({
        level: 'warning',
        code: 'road.too-short',
        message: `One lap takes only about ${Math.max(1, Math.round(estimateLapSeconds(lapLength)))} seconds, which is very short.`,
        fix: 'Make the loop bigger or add some bends.',
        target: roadTarget(main),
      });
    }
    if (lapLength > MAX_LAP_LENGTH) {
      add({
        level: 'warning',
        code: 'road.too-long',
        message: `One lap would take about ${Math.round(estimateLapSeconds(lapLength) / 60 * 10) / 10} minutes, which is very long.`,
        fix: 'Shrink the loop or use fewer laps.',
        target: roadTarget(main),
      });
    }
  }

  // Per-road shape checks.
  for (const road of roadsOk) {
    const samples = sampleRoad(road, { step: 500, maxAngleDegrees: 10 });
    let tightest: RoadSample | null = null;
    let tightestRatio = Infinity;
    let steepest: RoadSample | null = null;
    let minWidth = Infinity;
    for (const s of samples) {
      minWidth = Math.min(minWidth, s.width);
      const k = Math.abs(s.curvature);
      if (k > 1e-7) {
        const ratio = 1 / k / (s.width / 2);
        if (ratio < tightestRatio) {
          tightestRatio = ratio;
          tightest = s;
        }
      }
      const slope = Math.atan2(Math.abs(s.tangent.y), Math.hypot(s.tangent.x, s.tangent.z));
      if (!steepest || slope > Math.atan2(Math.abs(steepest.tangent.y), Math.hypot(steepest.tangent.x, steepest.tangent.z))) steepest = s;
    }
    if (tightest && tightestRatio < 1.3) {
      add({
        level: 'warning',
        code: 'road.tight-corner',
        message: `A corner on "${road.name}" is tighter than the road is wide, so the edges will bunch up.`,
        fix: 'Move the points further apart or make the road narrower there.',
        target: nearestPointTarget(road, tightest),
      });
    }
    if (steepest) {
      const deg = (Math.atan2(Math.abs(steepest.tangent.y), Math.hypot(steepest.tangent.x, steepest.tangent.z)) * 180) / Math.PI;
      if (deg > 28) {
        add({
          level: 'warning',
          code: 'road.steep',
          message: `"${road.name}" climbs very steeply in one place (${Math.round(deg)} degrees).`,
          fix: 'Spread the height change over more road.',
          target: nearestPointTarget(road, steepest),
        });
      }
    }
    if (minWidth < 2400) {
      add({
        level: 'warning',
        code: 'road.narrow',
        message: `"${road.name}" gets very narrow, which makes it hard to drive.`,
        fix: 'Widen the road to at least about 2400 units.',
        target: roadTarget(road),
      });
    }
  }

  // Sections.
  for (const road of roadsOk) {
    const ranges = sectionRanges(road);
    for (const range of ranges) {
      const len = roadParamToDistance(road, range.to) - roadParamToDistance(road, range.from);
      const span = len <= 0 && road.closed ? len + roadLength(road) : len;
      if (ranges.length > 1 && span < MIN_SECTION_LENGTH) {
        add({
          level: 'warning',
          code: 'section.too-short',
          message: 'One stretch of the road is very short.',
          fix: 'Merge it with the next stretch or drag its end further along.',
          target: { kind: 'section', roadId: road.id, sectionId: range.section.id },
        });
      }
      if (range.kind === 'gap') {
        const startDistance = roadParamToDistance(road, range.from);
        const hasRamp = project.pieces.some((piece) => {
          if (piece.roadId !== road.id || (piece.kind !== 'boostRamp' && piece.kind !== 'trickRamp')) return false;
          const d = roadParamToDistance(road, piece.param);
          const ahead = startDistance - d;
          return (road.closed ? ((ahead % roadLength(road)) + roadLength(road)) % roadLength(road) : ahead) < 7000 && ahead > -500;
        });
        if (!hasRamp) {
          add({
            level: 'warning',
            code: 'section.gap-without-ramp',
            message: 'There is a gap in the road with no ramp before it, so drivers will just fall in.',
            fix: 'Place a boost ramp or a trick ramp just before the gap.',
            target: { kind: 'section', roadId: road.id, sectionId: range.section.id },
          });
        }
        if (span > MAX_JUMPABLE_GAP) {
          add({
            level: 'warning',
            code: 'section.gap-too-long',
            message: 'The gap is longer than a kart can jump.',
            fix: 'Make the gap shorter.',
            target: { kind: 'section', roadId: road.id, sectionId: range.section.id },
          });
        }
      }
    }
  }

  // Crossings.
  for (const x of findCrossings(roadsOk)) {
    const clearance = Math.abs(x.dy);
    const upper = x.dy > 0 ? { road: x.a, sample: x.sampleA } : { road: x.b, sample: x.sampleB };
    if (clearance < 250) {
      add({
        level: 'error',
        code: 'road.crossing-same-height',
        message: `"${x.a.name}" crosses ${x.a === x.b ? 'itself' : `"${x.b.name}"`} at the same height, so cars would drive straight through.`,
        fix: 'Raise one of the crossing points so it passes over the other on a bridge.',
        target: nearestPointTarget(x.a, x.sampleA),
      });
    } else if (clearance < MIN_BRIDGE_CLEARANCE) {
      add({
        level: 'warning',
        code: 'road.bridge-too-low',
        message: 'A bridge is too low for the road underneath it.',
        fix: 'Raise the top road further above the one beneath.',
        target: nearestPointTarget(upper.road, upper.sample),
      });
    } else {
      const range = sectionAt(upper.road, upper.sample.param);
      if (range && range.kind !== 'bridge') {
        add({
          level: 'warning',
          code: 'road.crossing-not-bridge',
          message: 'One road passes over another but is not marked as a bridge.',
          fix: 'Select that stretch of road and set it to Bridge.',
          target: { kind: 'section', roadId: upper.road.id, sectionId: range.section.id },
        });
      }
    }
  }

  // A road lying on top of itself without crossing (a tiny loop, a hairpin folded flat).
  for (const road of roadsOk) {
    const hit = findOverlap(road);
    if (!hit || issues.some((i) => i.code === 'road.crossing-same-height' && i.target?.kind === 'point' && i.target.roadId === road.id)) continue;
    add({
      level: 'warning',
      code: 'road.overlaps-itself',
      message: `"${road.name}" runs on top of itself, so karts would drive through their own road.`,
      fix: 'Spread the points out so the road no longer folds back over itself.',
      target: nearestPointTarget(road, hit),
    });
  }

  // Start line.
  const startRoad = project.roads.find((r) => r.id === project.start.roadId);
  if (!main) {
    // Already reported: no road.
  } else if (!startRoad || startRoad.points.length < 2) {
    add({ level: 'error', code: 'start.missing', message: 'There is no start line.', fix: 'Pick the Start tool and click the road.', target: { kind: 'start' } });
  } else {
    if (startRoad !== main) {
      add({
        level: 'warning',
        code: 'start.not-main',
        message: 'The start line is on a side road, not on the main loop.',
        fix: 'Move the start line onto the main road.',
        target: { kind: 'start' },
      });
    }
    const range = sectionAt(startRoad, project.start.param);
    if (range?.kind === 'gap') {
      add({ level: 'error', code: 'start.on-gap', message: 'The start line is on a gap in the road.', fix: 'Move the start line to a normal stretch of road.', target: { kind: 'start' } });
    } else if (startRoad.points.length >= 3) {
      const frame = evaluateRoadAt(startRoad, project.start.param);
      if (frame.width < 2800) {
        add({
          level: 'warning',
          code: 'start.narrow',
          message: 'The road is narrow at the start line, so the cars will not all fit on the grid.',
          fix: 'Widen the road here or move the start line.',
          target: { kind: 'start' },
        });
      }
      // The 12-kart grid is laid out in a straight line behind the start point, so the road behind
      // the line has to stay (nearly) straight: every point of that line must still be on the road.
      const kt = frameAtDistance(startRoad, roadParamToDistance(startRoad, project.start.param) - START_OFFSET);
      const hx = kt.tangent.x;
      const hz = kt.tangent.z;
      const hl = Math.hypot(hx, hz) || 1;
      let offRoad = false;
      let noRoom = false;
      for (let back = 0; back <= GRID_DEPTH; back += 400) {
        const bx = kt.position.x - (hx / hl) * back;
        const bz = kt.position.z - (hz / hl) * back;
        const proj = projectOntoRoad(startRoad, { x: bx, y: kt.position.y, z: bz }, { heightWeight: 0 });
        if (!proj) continue;
        if (!startRoad.closed && roadParamToDistance(startRoad, project.start.param) - START_OFFSET - back < -1) noRoom = true;
        if (Math.abs(proj.lateral) + GRID_HALF_WIDTH > proj.sample.width / 2) offRoad = true;
      }
      if (noRoom) {
        add({
          level: 'warning',
          code: 'start.no-room',
          message: 'There is not enough road behind the start line for the cars to line up.',
          fix: 'Move the start line further along the road.',
          target: { kind: 'start' },
        });
      } else if (offRoad) {
        add({
          level: 'warning',
          code: 'start.on-bend',
          message: 'The start line is right after a bend, so the cars would line up off the road.',
          fix: 'Move the start line to a long straight part of the road.',
          target: { kind: 'start' },
        });
      }
    }
  }

  // Pieces.
  for (const piece of project.pieces) {
    const road = project.roads.find((r) => r.id === piece.roadId);
    if (!road || road.points.length < 2) {
      add({ level: 'warning', code: 'piece.off-road', message: 'A piece is not on any road.', fix: 'Delete it or place it again on the road.', target: { kind: 'piece', pieceId: piece.id } });
      continue;
    }
    const range = sectionAt(road, piece.param);
    if (range?.kind === 'gap') {
      add({ level: 'warning', code: 'piece.in-gap', message: 'A piece sits over a gap in the road.', fix: 'Move it onto the road.', target: { kind: 'piece', pieceId: piece.id } });
    }
    if (Math.abs(piece.lateral) > 1.001) {
      add({ level: 'warning', code: 'piece.beyond-edge', message: 'A piece hangs off the side of the road.', fix: 'Slide it back towards the middle.', target: { kind: 'piece', pieceId: piece.id } });
    }
  }

  const boxes = countItemBoxes(project);
  if (main && boxes === 0) {
    add({ level: 'warning', code: 'items.none', message: 'There are no item boxes, so nobody can use items.', fix: 'Place a row of item boxes with the Pieces tool.' });
  }
  const objectCount = project.props.length + project.pieces.reduce((n, piece) => n + (piece.kind === 'itemRow' ? Math.round(piece.count ?? 5) : piece.kind === 'object' ? 1 : 0), 0);
  if (objectCount > MAX_OBJECTS) {
    add({ level: 'warning', code: 'objects.too-many', message: `The track has ${objectCount} objects; the game copes best with ${MAX_OBJECTS} or fewer.`, fix: 'Remove some scenery.' });
  }

  if (compiled) {
    for (const issue of compiled.issues) {
      if (!issues.some((existing) => existing.code === issue.code && existing.message === issue.message)) issues.push(issue);
    }
    // Anything the race rules themselves object to (missing respawns, broken checkpoint loops...).
    for (const problem of validateKmpFile(compiled.kmp)) {
      if (problem.level !== 'error') continue;
      issues.push({ level: 'error', code: `track.${problem.code}`, message: problem.message });
    }
  }

  issues.sort((a, b) => levelRank(a.level) - levelRank(b.level));

  // Checklist.
  const hasError = issues.some((i) => i.level === 'error');
  const loopIssue = issues.find((i) => i.code === 'road.not-closed' || i.code === 'road.too-few-points');
  const startIssue = issues.find((i) => i.code.startsWith('start.') && i.level === 'error');
  const checklist: ProjectChecklist = {
    world: theme
      ? { state: 'done', label: 'World', detail: `${theme.label}: sky, lighting and the surfaces for your road and ground.` }
      : { state: 'warn', label: 'World', detail: 'Pick a world for your track.' },
    roadLoop: !main
      ? { state: 'todo', label: 'Road loop', detail: 'Draw a road that loops back to where it began.' }
      : loopIssue
        ? { state: 'warn', label: 'Road loop', detail: loopIssue.message, target: loopIssue.target }
        : { state: 'done', label: 'Road loop', detail: `A closed loop, about ${Math.max(1, Math.round(estimateLapSeconds(lapLength)))} seconds per lap.`, target: main ? roadTarget(main) : undefined },
    startLine: !main
      ? { state: 'todo', label: 'Start line', detail: 'Draw the road first, then drag the start line onto it.' }
      : startIssue
        ? { state: 'warn', label: 'Start line', detail: startIssue.message, target: { kind: 'start' } }
        : { state: 'done', label: 'Start line', detail: 'The race starts on the main road.', target: { kind: 'start' } },
    itemBoxes:
      boxes > 0
        ? { state: 'done', label: 'Item boxes', detail: `${boxes} item box${boxes === 1 ? '' : 'es'} on the track.` }
        : { state: 'todo', label: 'Item boxes', detail: 'Add a row of item boxes so racers can pick up items.' },
    drivable: !main
      ? { state: 'todo', label: 'Test drive', detail: 'Once there is a road, you can test drive it.' }
      : hasError
        ? { state: 'warn', label: 'Test drive', detail: `${issues.filter((i) => i.level === 'error').length} thing${issues.filter((i) => i.level === 'error').length === 1 ? '' : 's'} to fix before it can be driven.`, target: issues.find((i) => i.level === 'error')?.target }
        : { state: 'done', label: 'Test drive', detail: 'Ready to drive. Press Test drive any time.' },
  };

  return { issues, checklist };
}

function levelRank(level: CreateIssue['level']): number {
  return level === 'error' ? 0 : level === 'warning' ? 1 : 2;
}

