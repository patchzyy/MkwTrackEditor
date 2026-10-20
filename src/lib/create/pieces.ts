/**
 * Gameplay pieces: boost panels, boost/trick ramps, item rows and road-attached objects.
 *
 * Each piece contributes geometry (panels and ramps), collision with the right KCL flags, and/or
 * GOBJ records (+ an auto-generated POTI route for hazards that walk across the road).
 */
import type { CreateKit, CreateProject, GeneratedMesh, Piece, PieceKind, Road, Vec3 } from './types';
import type { KmpObject, KmpRoute } from '../kmpFile';
import { CollisionBuilder, MeshBuilder } from './meshBuilder';
import { createMeshLight } from './lighting';
import { distanceToRoadParam, evaluateRoadAt, roadLength, type RoadSample } from './spline';
import {
  FLAG_BOOST_PANEL,
  FLAG_BOOST_RAMP,
  FLAG_TRICK_RAMP,
  KCL_TYPE,
} from './kclTypes';
import { GOBJ_NO_ROUTE, OBJECT_ID_ITEM_BOX, makeObject, objectProfile } from './props';
import { headingDegrees } from './math';

/** Panels float this far above the road so they win over the road underneath. */
export const PANEL_LIFT = 3;
/** Retail item boxes sit exactly on the road surface (measured on the 32 retail tracks). */
export const ITEM_BOX_HEIGHT = 0;

export interface PieceDefaults {
  lateral: number;
  width: number;
  length: number;
  height?: number;
  count?: number;
}

export const PIECE_DEFAULTS: Record<PieceKind, PieceDefaults> = {
  boostPanel: { lateral: 0, width: 1100, length: 1500 },
  boostRamp: { lateral: 0, width: 2200, length: 2400, height: 420 },
  trickRamp: { lateral: 0, width: 2600, length: 3000, height: 520 },
  itemRow: { lateral: 0, width: 2750, length: 0, count: 5 },
  object: { lateral: 0, width: 0, length: 0 },
};

/** Fresh piece fields (without id/road/param) for a kind. Widths are capped to the road when given. */
export function defaultPiece(kind: PieceKind, roadWidth?: number, objectId?: number): Omit<Piece, 'id' | 'roadId' | 'param'> {
  const d = PIECE_DEFAULTS[kind];
  let width = d.width;
  if (roadWidth && width > roadWidth - 400) width = Math.max(600, roadWidth - 400);
  const piece: Omit<Piece, 'id' | 'roadId' | 'param'> = { kind, lateral: d.lateral, width, length: d.length };
  if (d.height !== undefined) piece.height = d.height;
  if (d.count !== undefined) piece.count = d.count;
  if (kind === 'object') {
    piece.objectId = objectId ?? 0x191;
    piece.settings = objectProfile(piece.objectId).settings.slice();
  }
  return piece;
}

export function findPieceRoad(project: CreateProject, piece: Piece): Road | null {
  return project.roads.find((road) => road.id === piece.roadId) ?? null;
}

/** The road frame at a piece's parameter, or null when its road is gone or empty. */
export function pieceSample(project: CreateProject, piece: Piece): { road: Road; sample: RoadSample } | null {
  const road = findPieceRoad(project, piece);
  if (!road || road.points.length < 2) return null;
  return { road, sample: evaluateRoadAt(road, piece.param) };
}

/** Lateral offset in units of a piece's centre, clamped so a panel/ramp stays on the road. */
export function pieceLateralOffset(piece: Piece, sample: RoadSample): number {
  const half = sample.width / 2;
  const raw = piece.lateral * half;
  if (piece.kind === 'object' || piece.kind === 'itemRow') return Math.max(-half, Math.min(half, raw));
  const limit = Math.max(0, half - piece.width / 2);
  return Math.max(-limit, Math.min(limit, raw));
}

function stationsAlong(road: Road, centerDistance: number, from: number, to: number, step: number): RoadSample[] {
  const len = Math.max(1, to - from);
  const n = Math.max(1, Math.ceil(len / step));
  const out: RoadSample[] = [];
  for (let i = 0; i <= n; i++) {
    const d = centerDistance + from + (len * i) / n;
    out.push(evaluateRoadAt(road, distanceToRoadParam(road, d)));
  }
  return out;
}

const at = (s: RoadSample, lateral: number, lift: number): Vec3 => ({
  x: s.position.x + s.right.x * lateral + s.up.x * lift,
  y: s.position.y + s.right.y * lateral + s.up.y * lift,
  z: s.position.z + s.right.z * lateral + s.up.z * lift,
});

export interface PieceGeometryResult {
  meshes: GeneratedMesh[];
  collision: CollisionBuilder;
}

/** Meshes and collision for boost panels and ramps. */
export function buildPieceGeometry(project: CreateProject, kit: CreateKit): PieceGeometryResult {
  const mb = new MeshBuilder('pieces', 'pieces', createMeshLight(kit, project.themeId));
  const cb = new CollisionBuilder();
  const themeId = project.themeId;
  for (const piece of project.pieces) {
    if (piece.kind !== 'boostPanel' && piece.kind !== 'boostRamp' && piece.kind !== 'trickRamp') continue;
    const found = pieceSample(project, piece);
    if (!found) continue;
    const { road, sample } = found;
    const centerDistance = sample.distance;
    const offset = pieceLateralOffset(piece, sample);
    const hw = Math.max(100, piece.width / 2);
    const length = Math.max(200, piece.length);
    if (piece.kind === 'boostPanel') {
      const surface = kit.resolveSurface({ slot: 'boost' }, themeId);
      const stations = stationsAlong(road, centerDistance, -length / 2, length / 2, 300);
      const a: number[] = [];
      const b: number[] = [];
      stations.forEach((s, i) => {
        const v = i / (stations.length - 1);
        const l = at(s, offset - hw, PANEL_LIFT);
        const r = at(s, offset + hw, PANEL_LIFT);
        a.push(mb.vertex(surface.id, l.x, l.y, l.z, s.up.x, s.up.y, s.up.z, 0, v, 255));
        b.push(mb.vertex(surface.id, r.x, r.y, r.z, s.up.x, s.up.y, s.up.z, 1, v, 255));
      });
      const flag = (surface.kclFlag & 0x1f) === KCL_TYPE.BOOST_PANEL ? surface.kclFlag : FLAG_BOOST_PANEL;
      for (let i = 0; i + 1 < stations.length; i++) {
        const up = stations[i].up;
        mb.facingQuad(surface.id, a[i], b[i], a[i + 1], b[i + 1], up.x, up.y, up.z);
        const pa = at(stations[i], offset - hw, PANEL_LIFT);
        const pb = at(stations[i], offset + hw, PANEL_LIFT);
        const pc = at(stations[i + 1], offset - hw, PANEL_LIFT);
        const pd = at(stations[i + 1], offset + hw, PANEL_LIFT);
        cb.triangleFacing(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, pc.x, pc.y, pc.z, up.x, up.y, up.z, flag);
        cb.triangleFacing(pb.x, pb.y, pb.z, pd.x, pd.y, pd.z, pc.x, pc.y, pc.z, up.x, up.y, up.z, flag);
      }
      continue;
    }

    // Ramps: a wedge that starts flush with the road and rises to `height` at its tip.
    const height = Math.max(60, piece.height ?? PIECE_DEFAULTS[piece.kind].height ?? 400);
    const topSurface = kit.resolveSurface({ slot: piece.kind === 'boostRamp' ? 'boost' : 'roadAlt' }, themeId);
    const sideSurface = kit.resolveSurface({ slot: 'wall' }, themeId);
    const flag = piece.kind === 'boostRamp' ? FLAG_BOOST_RAMP : FLAG_TRICK_RAMP;
    const stations = stationsAlong(road, centerDistance, -length / 2, length / 2, 300);
    const m = stations.length;
    const lift = (i: number) => 1 + (height * i) / (m - 1);
    const tl: number[] = [];
    const tr: number[] = [];
    const base: Array<[Vec3, Vec3]> = [];
    const topPts: Array<[Vec3, Vec3]> = [];
    stations.forEach((s, i) => {
      const v = i / (m - 1);
      const l = at(s, offset - hw, lift(i));
      const r = at(s, offset + hw, lift(i));
      topPts.push([l, r]);
      base.push([at(s, offset - hw, 0.5), at(s, offset + hw, 0.5)]);
      tl.push(mb.vertex(topSurface.id, l.x, l.y, l.z, s.up.x, s.up.y, s.up.z, 0, v * (length / topSurface.textureWorldSize[1]), 255));
      tr.push(mb.vertex(topSurface.id, r.x, r.y, r.z, s.up.x, s.up.y, s.up.z, hw * 2 / topSurface.textureWorldSize[0], v * (length / topSurface.textureWorldSize[1]), 255));
    });
    for (let i = 0; i + 1 < m; i++) {
      const up = stations[i].up;
      // Slightly tilted normal: average of up and the slope normal is enough for lighting.
      mb.facingQuad(topSurface.id, tl[i], tr[i], tl[i + 1], tr[i + 1], up.x, up.y, up.z);
      const [l0, r0] = topPts[i];
      const [l1, r1] = topPts[i + 1];
      cb.triangleFacing(l0.x, l0.y, l0.z, r0.x, r0.y, r0.z, l1.x, l1.y, l1.z, up.x, up.y, up.z, flag);
      cb.triangleFacing(r0.x, r0.y, r0.z, r1.x, r1.y, r1.z, l1.x, l1.y, l1.z, up.x, up.y, up.z, flag);
    }
    // Visual-only sides and back.
    const side = (sign: -1 | 1) => {
      const idx: Array<[number, number]> = [];
      stations.forEach((s, i) => {
        const p = sign === -1 ? topPts[i][0] : topPts[i][1];
        const q = sign === -1 ? base[i][0] : base[i][1];
        const nx = sign * s.right.x;
        const ny = sign * s.right.y;
        const nz = sign * s.right.z;
        const along = (i * length) / (m - 1) / sideSurface.textureWorldSize[0];
        idx.push([
          mb.vertex(sideSurface.id, p.x, p.y, p.z, nx, ny, nz, along, 0, 255),
          mb.vertex(sideSurface.id, q.x, q.y, q.z, nx, ny, nz, along, (p.y - q.y) / sideSurface.textureWorldSize[1], 170),
        ]);
      });
      for (let i = 0; i + 1 < m; i++) {
        const s = stations[i];
        mb.facingQuad(sideSurface.id, idx[i][0], idx[i + 1][0], idx[i][1], idx[i + 1][1], sign * s.right.x, sign * s.right.y, sign * s.right.z);
      }
    };
    side(-1);
    side(1);
    const end = stations[m - 1];
    const [el, er] = topPts[m - 1];
    const [bl, br] = base[m - 1];
    const ev = [
      mb.vertex(sideSurface.id, el.x, el.y, el.z, end.tangent.x, end.tangent.y, end.tangent.z, 0, 0, 255),
      mb.vertex(sideSurface.id, er.x, er.y, er.z, end.tangent.x, end.tangent.y, end.tangent.z, 1, 0, 255),
      mb.vertex(sideSurface.id, bl.x, bl.y, bl.z, end.tangent.x, end.tangent.y, end.tangent.z, 0, 1, 170),
      mb.vertex(sideSurface.id, br.x, br.y, br.z, end.tangent.x, end.tangent.y, end.tangent.z, 1, 1, 170),
    ];
    mb.facingQuad(sideSurface.id, ev[0], ev[1], ev[2], ev[3], end.tangent.x, end.tangent.y, end.tangent.z);
  }
  return { meshes: mb.build(), collision: cb };
}

export interface PieceObjects {
  objects: KmpObject[];
  routes: KmpRoute[];
  itemBoxes: number;
}

/**
 * GOBJ records (and POTI routes) for item rows and road-attached objects. `routeBase` is the index
 * the first generated route will get in the final KMP.
 */
export function pieceObjects(project: CreateProject, routeBase = 0): PieceObjects {
  const objects: KmpObject[] = [];
  const routes: KmpRoute[] = [];
  let itemBoxes = 0;
  for (const piece of project.pieces) {
    if (piece.kind !== 'itemRow' && piece.kind !== 'object') continue;
    const found = pieceSample(project, piece);
    if (!found) continue;
    const { sample } = found;
    const heading = headingDegrees(sample.tangent);
    const rotation = { x: 0, y: heading, z: 0 };
    const one = { x: 1, y: 1, z: 1 };
    if (piece.kind === 'itemRow') {
      const count = Math.max(1, Math.min(12, Math.round(piece.count ?? 5)));
      const spacing = piece.width > 0 ? piece.width / count : 550;
      const centre = pieceLateralOffset(piece, sample);
      const half = sample.width / 2;
      for (let i = 0; i < count; i++) {
        const o = Math.max(-half + 200, Math.min(half - 200, centre + (i - (count - 1) / 2) * spacing));
        const p = at(sample, o, ITEM_BOX_HEIGHT);
        objects.push(makeObject(OBJECT_ID_ITEM_BOX, p, rotation, one, undefined));
        itemBoxes++;
      }
      continue;
    }
    const objectId = piece.objectId ?? 0x191;
    const profile = objectProfile(objectId);
    const o = pieceLateralOffset(piece, sample);
    const p = at(sample, o, 0);
    const scale = profile.scale ? { x: profile.scale, y: profile.scale, z: profile.scale } : one;
    if (profile.route === 'cross') {
      const half = sample.width / 2;
      const reach = Math.max(300, half - 500);
      const a = at(sample, -reach, 0);
      const b = at(sample, reach, 0);
      const routeIndex = routeBase + routes.length;
      routes.push({
        smooth: 0,
        forwardBackward: 1,
        points: [
          { position: a, setting1: 0, setting2: 0 },
          { position: b, setting1: 0, setting2: 0 },
        ],
      });
      objects.push(makeObject(objectId, a, rotation, scale, piece.settings, routeIndex));
    } else {
      objects.push(makeObject(objectId, p, rotation, scale, piece.settings, GOBJ_NO_ROUTE));
    }
  }
  return { objects, routes, itemBoxes };
}

/** Total length of a road, handy for UI sliders. */
export function pieceRoadLength(project: CreateProject, piece: Piece): number {
  const road = findPieceRoad(project, piece);
  return road ? roadLength(road) : 0;
}
