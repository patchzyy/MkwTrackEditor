/**
 * Road geometry: per-section cross-section meshes (surface, curbs, shoulders, walls, skirts,
 * bridge undersides, tunnel ceilings, fall ribbons) plus their collision.
 *
 * Every section is sampled with `sampleRoadRange`, whose first/last samples are exactly at the
 * section boundaries, so neighbouring sections meet seamlessly. UVs are world-space and continuous
 * along the whole road (a closed road is stretched by a hair so the texture tiles at the lap line).
 */
import type { CreateKit, CreateProject, EdgeWall, GeneratedMesh, KitSurface, Road, RoadEdge } from './types';
import { CollisionBuilder, MeshBuilder } from './meshBuilder';
import { createMeshLight } from './lighting';
import {
  FLAG_FALL_BOUNDARY,
  FLAG_INVISIBLE_WALL,
  FLAG_WALL,
  isWallFlag,
} from './kclTypes';
import { distanceToRoadParam, evaluateRoadAt, roadLength, sampleRoadRange, type RoadSample } from './spline';
import { edgeExtra, FALL_RIBBON_MARGIN, isGrounded, sectionRanges, type SectionRange } from './sections';
import { TERRAIN_SINK, type TerrainField } from './terrain';

/** `textureWorldSize[0]` is the U axis and runs along the road; `[1]` is V and runs across. */
export const ROAD_UV_ALONG_IS_U = true;

export const WALL_DEFAULT_HEIGHT: Record<EdgeWall, number> = {
  none: 0,
  barrier: 160,
  wall: 500,
  fence: 230,
  invisible: 900,
};
export const TUNNEL_HEIGHT = 1100;
export const BRIDGE_THICKNESS = 80;
export const FALL_DEPTH_BRIDGE = 450;
export const FALL_DEPTH_GAP = 900;
/** Darkness of baked ambient occlusion (0..255 grey). */
const AO_FOOT = 205;
const AO_UNDER = 140;
const AO_WALL_FOOT = 170;

export interface RoadGeometryOptions {
  /** Arc-length spacing of cross-sections. Default 250. */
  step?: number;
  maxAngleDegrees?: number;
}

export interface RoadGeometryResult {
  meshes: GeneratedMesh[];
  collision: CollisionBuilder;
}

interface BoundaryDef {
  /** -1 left edge of the surface, 0 centre, +1 right edge. */
  base: -1 | 0 | 1;
  /** Extra signed lateral offset in units (negative = further left). */
  fixed: number;
  /** Vertical offset added after placement. */
  dy: number;
  shade: number;
  /** Only exists to add a vertex row for shading; collision merges across it. */
  visualOnly: boolean;
  /** Surface of the band to the right of this boundary. */
  band?: { surface: KitSurface; collide: boolean };
}

/** Lateral offset of a boundary at a sample, with the miter and tight-corner clamps applied. */
export function lateralOffset(sample: RoadSample, base: number, fixed: number): number {
  let s = (base * sample.width * 0.5 + fixed) * sample.lateralScale;
  const k = sample.curvature;
  if (k > 1e-7 && s > 0) s = Math.min(s, 0.85 / k);
  else if (k < -1e-7 && s < 0) s = Math.max(s, 0.85 / k);
  return s;
}

function loopFactor(road: Road, size: number): number {
  if (!road.closed) return 1;
  const length = roadLength(road);
  if (length <= 0 || size <= 0) return 1;
  const repeats = Math.max(1, Math.round(length / size));
  return (repeats * size) / length;
}

export function wallHeightOf(edge: RoadEdge, type: EdgeWall): number {
  return edge.wallHeight > 0 ? edge.wallHeight : WALL_DEFAULT_HEIGHT[type];
}

function wallSurfaceSlot(type: EdgeWall): 'barrier' | 'wall' | 'fence' | null {
  switch (type) {
    case 'barrier':
      return 'barrier';
    case 'wall':
      return 'wall';
    case 'fence':
      return 'fence';
    default:
      return null;
  }
}

/** Builds all meshes and collision for one road. */
export function buildRoadGeometry(
  project: CreateProject,
  kit: CreateKit,
  road: Road,
  field: TerrainField,
  options: RoadGeometryOptions = {},
): RoadGeometryResult {
  const mb = new MeshBuilder(`road:${road.id}`, `road_${road.id}`, createMeshLight(kit, project.themeId));
  const cb = new CollisionBuilder();
  const themeId = project.themeId;
  const resolve = (ref: Parameters<CreateKit['resolveSurface']>[0]) => kit.resolveSurface(ref, themeId);
  const step = options.step ?? 250;

  for (const range of sectionRanges(road)) {
    const samples = sampleRoadRange(road, range.from, range.to, { step, maxAngleDegrees: options.maxAngleDegrees ?? 6 });
    if (samples.length < 2) continue;
    buildSection(project, kit, road, range, samples, field, mb, cb, resolve);
  }

  buildStartLine(project, kit, road, mb);
  return { meshes: mb.build(), collision: cb };
}

type Resolver = (ref: Parameters<CreateKit['resolveSurface']>[0]) => KitSurface;

function buildSection(
  project: CreateProject,
  kit: CreateKit,
  road: Road,
  range: SectionRange,
  samples: RoadSample[],
  field: TerrainField,
  mb: MeshBuilder,
  cb: CollisionBuilder,
  resolve: Resolver,
): void {
  const { kind, style } = range;
  const grounded = isGrounded(kind, field.enabled);
  const n = samples.length;
  const left = range.left;
  const right = range.right;
  const isTunnel = kind === 'tunnel';
  const hasDeck = kind !== 'gap';
  const curbWidth = style.curbWidth;

  // Effective walls (a tunnel always has them).
  let wallL: EdgeWall = left.wall;
  let wallR: EdgeWall = right.wall;
  let heightL = wallHeightOf(left, wallL);
  let heightR = wallHeightOf(right, wallR);
  if (isTunnel) {
    // A tunnel is closed: full-height walls on both sides whatever the edges say.
    wallL = 'wall';
    wallR = 'wall';
    heightL = TUNNEL_HEIGHT;
    heightR = TUNNEL_HEIGHT;
  }
  if (kind === 'gap') {
    wallL = 'none';
    wallR = 'none';
  }

  const roadSurface = resolve(range.surface);
  const curbSurface = resolve({ slot: 'curb' });
  const shoulderL = left.shoulder ? resolve(left.shoulder) : null;
  const shoulderR = right.shoulder ? resolve(right.shoulder) : null;
  const shoulderDropL = grounded && shoulderL ? Math.min(TERRAIN_SINK - 2, left.shoulderWidth * 0.14) : 0;
  const shoulderDropR = grounded && shoulderR ? Math.min(TERRAIN_SINK - 2, right.shoulderWidth * 0.14) : 0;
  const curbL = left.curb ? curbWidth : 0;
  const curbR = right.curb ? curbWidth : 0;
  const shL = shoulderL ? left.shoulderWidth : 0;
  const shR = shoulderR ? right.shoulderWidth : 0;

  // ── Cross-section boundaries, left to right ───────────────────────────────────────────────
  const B: BoundaryDef[] = [];
  const aoWidthL = 260;
  const aoWidthR = 260;
  if (hasDeck) {
    if (shL > 0 && shoulderL) B.push({ base: -1, fixed: -(curbL + shL), dy: -shoulderDropL, shade: 255, visualOnly: false, band: { surface: shoulderL, collide: true } });
    if (curbL > 0) B.push({ base: -1, fixed: -curbL, dy: 0, shade: 255, visualOnly: false, band: { surface: curbSurface, collide: true } });
    B.push({ base: -1, fixed: 0, dy: 0, shade: wallL !== 'none' ? AO_FOOT : 255, visualOnly: false, band: { surface: roadSurface, collide: true } });
    if (wallL !== 'none') B.push({ base: -1, fixed: aoWidthL, dy: 0, shade: 255, visualOnly: true, band: { surface: roadSurface, collide: true } });
    if (wallR !== 'none') B.push({ base: 1, fixed: -aoWidthR, dy: 0, shade: 255, visualOnly: true, band: { surface: roadSurface, collide: true } });
    const rightBand = curbR > 0 ? curbSurface : shR > 0 && shoulderR ? shoulderR : null;
    B.push({
      base: 1,
      fixed: 0,
      dy: 0,
      shade: wallR !== 'none' ? AO_FOOT : 255,
      visualOnly: false,
      band: rightBand ? { surface: rightBand, collide: true } : undefined,
    });
    if (curbR > 0) B.push({ base: 1, fixed: curbR, dy: 0, shade: 255, visualOnly: false, band: shR > 0 && shoulderR ? { surface: shoulderR, collide: true } : undefined });
    if (shR > 0 && shoulderR) B.push({ base: 1, fixed: curbR + shR, dy: -shoulderDropR, shade: 255, visualOnly: false });
  }

  // Outermost boundary offsets for walls, skirts, undersides and ribbons.
  const outerLeft = { base: -1 as const, fixed: -(curbL + shL), dy: -shoulderDropL };
  const outerRight = { base: 1 as const, fixed: curbR + shR, dy: -shoulderDropR };

  // ── Positions of every boundary at every station ──────────────────────────────────────────
  const nb = B.length;
  const px = new Float64Array(nb * n);
  const py = new Float64Array(nb * n);
  const pz = new Float64Array(nb * n);
  const lat = new Float64Array(nb * n);
  for (let k = 0; k < nb; k++) {
    const def = B[k];
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const o = lateralOffset(s, def.base, def.fixed);
      const idx = k * n + i;
      lat[idx] = o;
      px[idx] = s.position.x + s.right.x * o;
      py[idx] = s.position.y + s.right.y * o + def.dy;
      pz[idx] = s.position.z + s.right.z * o;
    }
  }

  const alongK = new Map<string, number>();
  const kAlong = (surface: KitSurface) => {
    let v = alongK.get(surface.id);
    if (v === undefined) {
      v = loopFactor(road, surface.textureWorldSize[0]);
      alongK.set(surface.id, v);
    }
    return v;
  };
  const uvOf = (surface: KitSurface, distance: number, across: number): [number, number] => {
    const [su, sv] = surface.textureWorldSize;
    const along = (distance * kAlong(surface)) / (ROAD_UV_ALONG_IS_U ? su : sv);
    const acr = across / (ROAD_UV_ALONG_IS_U ? sv : su);
    return ROAD_UV_ALONG_IS_U ? [along, acr] : [acr, along];
  };

  // ── Top surface bands (render) ────────────────────────────────────────────────────────────
  for (let k = 0; k + 1 < nb; k++) {
    const band = B[k].band;
    if (!band) continue;
    const surface = band.surface;
    const vl: number[] = [];
    const vr: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const a = k * n + i;
      const b = (k + 1) * n + i;
      const [ua, va] = uvOf(surface, s.distance, lat[a]);
      const [ub, vb] = uvOf(surface, s.distance, lat[b]);
      vl.push(mb.vertex(surface.id, px[a], py[a], pz[a], s.up.x, s.up.y, s.up.z, ua, va, B[k].shade));
      vr.push(mb.vertex(surface.id, px[b], py[b], pz[b], s.up.x, s.up.y, s.up.z, ub, vb, B[k + 1].shade));
    }
    for (let i = 0; i + 1 < n; i++) mb.facingQuad(surface.id, vl[i], vr[i], vl[i + 1], vr[i + 1], samples[i].up.x, samples[i].up.y, samples[i].up.z);
  }

  // ── Top surface collision: merge across visual-only rows ──────────────────────────────────
  {
    const rows: number[] = [];
    for (let k = 0; k < nb; k++) if (!B[k].visualOnly) rows.push(k);
    for (let r = 0; r + 1 < rows.length; r++) {
      const k0 = rows[r];
      const k1 = rows[r + 1];
      const band = B[k0].band;
      if (!band || !band.collide) continue;
      const flag = band.surface.kclFlag;
      for (let i = 0; i + 1 < n; i++) {
        const a = k0 * n + i;
        const b = k1 * n + i;
        const c = k0 * n + i + 1;
        const d = k1 * n + i + 1;
        const up = samples[i].up;
        cb.triangleFacing(px[a], py[a], pz[a], px[b], py[b], pz[b], px[c], py[c], pz[c], up.x, up.y, up.z, flag);
        cb.triangleFacing(px[b], py[b], pz[b], px[d], py[d], pz[d], px[c], py[c], pz[c], up.x, up.y, up.z, flag);
      }
    }
  }

  // ── Outer edge positions (walls / skirts / underside / ceiling) ───────────────────────────
  const outerPos = (def: { base: -1 | 1; fixed: number; dy: number }, i: number): [number, number, number] => {
    const s = samples[i];
    const o = lateralOffset(s, def.base, def.fixed);
    return [s.position.x + s.right.x * o, s.position.y + s.right.y * o + def.dy, s.position.z + s.right.z * o];
  };
  const horizRight = (s: RoadSample): [number, number] => {
    const h = Math.hypot(s.right.x, s.right.z) || 1;
    return [s.right.x / h, s.right.z / h];
  };

  // Walls
  const wallSide = (side: -1 | 1, type: EdgeWall, height: number, edgeDef: { base: -1 | 1; fixed: number; dy: number }) => {
    if (type === 'none' || height <= 0) return;
    const slot = wallSurfaceSlot(type);
    const surface = slot ? resolve({ slot }) : null;
    let flag = FLAG_WALL;
    if (type === 'invisible') flag = FLAG_INVISIBLE_WALL;
    else if (surface && isWallFlag(surface.kclFlag)) flag = surface.kclFlag;
    const bottoms: number[] = [];
    const tops: number[] = [];
    const bottomsOut: number[] = [];
    const topsOut: number[] = [];
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i < n; i++) pts.push(outerPos(edgeDef, i));
    if (surface) {
      for (let i = 0; i < n; i++) {
        const s = samples[i];
        const [hx, hz] = horizRight(s);
        const inX = -side * hx; // inward-facing normal (towards the road centre)
        const inZ = -side * hz;
        const [x, y, z] = pts[i];
        const along = (s.distance * kAlong(surface)) / surface.textureWorldSize[0];
        const vTop = height / surface.textureWorldSize[1];
        bottoms.push(mb.vertex(surface.id, x, y, z, inX, 0, inZ, along, 0, AO_WALL_FOOT));
        tops.push(mb.vertex(surface.id, x, y + height, z, inX, 0, inZ, along, vTop, 255));
        bottomsOut.push(mb.vertex(surface.id, x, y, z, -inX, 0, -inZ, along, 0, AO_WALL_FOOT));
        topsOut.push(mb.vertex(surface.id, x, y + height, z, -inX, 0, -inZ, along, vTop, 255));
      }
    }
    for (let i = 0; i + 1 < n; i++) {
      const s = samples[i];
      const [hx, hz] = horizRight(s);
      const inX = -side * hx;
      const inZ = -side * hz;
      if (surface) {
        mb.facingQuad(surface.id, bottoms[i], bottoms[i + 1], tops[i], tops[i + 1], inX, 0, inZ);
        mb.facingQuad(surface.id, bottomsOut[i], bottomsOut[i + 1], topsOut[i], topsOut[i + 1], -inX, 0, -inZ);
      }
      const [x0, y0, z0] = pts[i];
      const [x1, y1, z1] = pts[i + 1];
      const hi = type === 'invisible' ? Math.max(height, 900) : height;
      cb.triangleFacing(x0, y0, z0, x1, y1, z1, x0, y0 + hi, z0, inX, 0, inZ, flag);
      cb.triangleFacing(x1, y1, z1, x1, y1 + hi, z1, x0, y0 + hi, z0, inX, 0, inZ, flag);
    }
  };
  if (hasDeck) {
    wallSide(-1, wallL, heightL, outerLeft);
    wallSide(1, wallR, heightR, outerRight);
  }

  // Skirts: from the outer edge of a grounded road down to the terrain.
  if (hasDeck && grounded) {
    const skirtSurface = resolve(style.skirt);
    for (const side of [-1, 1] as const) {
      const def = side === -1 ? outerLeft : outerRight;
      const tops: number[] = [];
      const bots: number[] = [];
      const drops: number[] = [];
      let any = false;
      for (let i = 0; i < n; i++) {
        const [x, y, z] = outerPos(def, i);
        const ground = field.heightAt(x, z);
        const drop = Number.isFinite(ground) ? Math.min(6000, y - ground) : 0;
        drops.push(drop);
        if (drop > 3) any = true;
      }
      if (!any) continue;
      for (let i = 0; i < n; i++) {
        const s = samples[i];
        const [x, y, z] = outerPos(def, i);
        const [hx, hz] = horizRight(s);
        const nxo = side * hx;
        const nzo = side * hz;
        const drop = Math.max(0, drops[i]);
        const along = (s.distance * kAlong(skirtSurface)) / skirtSurface.textureWorldSize[0];
        tops.push(mb.vertex(skirtSurface.id, x, y, z, nxo, 0, nzo, along, 0, 235));
        bots.push(mb.vertex(skirtSurface.id, x, y - drop, z, nxo, 0, nzo, along, drop / skirtSurface.textureWorldSize[1], 150));
      }
      for (let i = 0; i + 1 < n; i++) {
        if (drops[i] <= 3 && drops[i + 1] <= 3) continue;
        const s = samples[i];
        const [hx, hz] = horizRight(s);
        mb.facingQuad(skirtSurface.id, tops[i], tops[i + 1], bots[i], bots[i + 1], side * hx, 0, side * hz);
        if (Math.max(drops[i], drops[i + 1]) > 12) {
          const [x0, y0, z0] = outerPos(def, i);
          const [x1, y1, z1] = outerPos(def, i + 1);
          const d0 = Math.max(0, drops[i]);
          const d1 = Math.max(0, drops[i + 1]);
          cb.triangleFacing(x0, y0, z0, x1, y1, z1, x0, y0 - d0, z0, side * hx, 0, side * hz, FLAG_WALL);
          cb.triangleFacing(x1, y1, z1, x1, y1 - d1, z1, x0, y0 - d0, z0, side * hx, 0, side * hz, FLAG_WALL);
        }
      }
    }
  }

  // Bridge-like decks: fascia + underside. (Ungrounded = a bridge, or any road when there is no ground.)
  if (hasDeck && !grounded) {
    buildUnderside(samples, outerLeft, outerRight, outerPos, horizRight, mb, resolve(style.underside), resolve(style.skirt), kAlong);
  }

  // Tunnel ceiling.
  if (hasDeck && isTunnel) {
    const ceiling = resolve(style.underside);
    const topsL: number[] = [];
    const topsR: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const [lx, ly, lz] = outerPos(outerLeft, i);
      const [rx, ry, rz] = outerPos(outerRight, i);
      const hL = TUNNEL_HEIGHT;
      const hR = TUNNEL_HEIGHT;
      const [ua, va] = uvOf(ceiling, s.distance, lateralOffset(s, -1, outerLeft.fixed));
      const [ub, vb] = uvOf(ceiling, s.distance, lateralOffset(s, 1, outerRight.fixed));
      topsL.push(mb.vertex(ceiling.id, lx, ly + hL, lz, 0, -1, 0, ua, va, AO_UNDER + 40));
      topsR.push(mb.vertex(ceiling.id, rx, ry + hR, rz, 0, -1, 0, ub, vb, AO_UNDER + 40));
    }
    for (let i = 0; i + 1 < n; i++) {
      mb.facingQuad(ceiling.id, topsL[i], topsR[i], topsL[i + 1], topsR[i + 1], 0, -1, 0);
      const [lx0, ly0, lz0] = outerPos(outerLeft, i);
      const [rx0, ry0, rz0] = outerPos(outerRight, i);
      const [lx1, ly1, lz1] = outerPos(outerLeft, i + 1);
      const [rx1, ry1, rz1] = outerPos(outerRight, i + 1);
      const hL = TUNNEL_HEIGHT;
      const hR = TUNNEL_HEIGHT;
      cb.triangleFacing(lx0, ly0 + hL, lz0, rx0, ry0 + hR, rz0, lx1, ly1 + hL, lz1, 0, -1, 0, FLAG_WALL);
      cb.triangleFacing(rx0, ry0 + hR, rz0, rx1, ry1 + hR, rz1, lx1, ly1 + hL, lz1, 0, -1, 0, FLAG_WALL);
    }
  }

  // Fall ribbon under anything that is not on solid ground.
  if (!grounded) {
    const depth = kind === 'gap' ? FALL_DEPTH_GAP : FALL_DEPTH_BRIDGE;
    const margin = FALL_RIBBON_MARGIN;
    for (let i = 0; i + 1 < n; i++) {
      const s0 = samples[i];
      const s1 = samples[i + 1];
      const e0 = s0.width / 2 + Math.max(edgeExtra(left, style.curbWidth), edgeExtra(right, style.curbWidth)) + margin;
      const e1 = s1.width / 2 + Math.max(edgeExtra(left, style.curbWidth), edgeExtra(right, style.curbWidth)) + margin;
      const hr0 = horizRight(s0);
      const hr1 = horizRight(s1);
      const a = [s0.position.x - hr0[0] * e0, s0.position.y - depth, s0.position.z - hr0[1] * e0];
      const b = [s0.position.x + hr0[0] * e0, s0.position.y - depth, s0.position.z + hr0[1] * e0];
      const c = [s1.position.x - hr1[0] * e1, s1.position.y - depth, s1.position.z - hr1[1] * e1];
      const d = [s1.position.x + hr1[0] * e1, s1.position.y - depth, s1.position.z + hr1[1] * e1];
      cb.triangleUp(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], FLAG_FALL_BOUNDARY);
      cb.triangleUp(b[0], b[1], b[2], d[0], d[1], d[2], c[0], c[1], c[2], FLAG_FALL_BOUNDARY);
    }
  }
}

function buildUnderside(
  samples: RoadSample[],
  outerLeft: { base: -1; fixed: number; dy: number },
  outerRight: { base: 1; fixed: number; dy: number },
  outerPos: (def: { base: -1 | 1; fixed: number; dy: number }, i: number) => [number, number, number],
  horizRight: (s: RoadSample) => [number, number],
  mb: MeshBuilder,
  under: KitSurface,
  fascia: KitSurface,
  kAlong: (s: KitSurface) => number,
): void {
  const n = samples.length;
  const lTop: number[] = [];
  const lBot: number[] = [];
  const rTop: number[] = [];
  const rBot: number[] = [];
  const bl: number[] = [];
  const br: number[] = [];
  const t = BRIDGE_THICKNESS;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const [hx, hz] = horizRight(s);
    const [lx, ly, lz] = outerPos(outerLeft, i);
    const [rx, ry, rz] = outerPos(outerRight, i);
    const alongF = (s.distance * kAlong(fascia)) / fascia.textureWorldSize[0];
    const vF = t / fascia.textureWorldSize[1];
    lTop.push(mb.vertex(fascia.id, lx, ly, lz, -hx, 0, -hz, alongF, 0, 235));
    lBot.push(mb.vertex(fascia.id, lx, ly - t, lz, -hx, 0, -hz, alongF, vF, 150));
    rTop.push(mb.vertex(fascia.id, rx, ry, rz, hx, 0, hz, alongF, 0, 235));
    rBot.push(mb.vertex(fascia.id, rx, ry - t, rz, hx, 0, hz, alongF, vF, 150));
    const alongU = (s.distance * kAlong(under)) / under.textureWorldSize[0];
    const width = Math.hypot(rx - lx, rz - lz);
    bl.push(mb.vertex(under.id, lx, ly - t, lz, 0, -1, 0, alongU, 0, AO_UNDER));
    br.push(mb.vertex(under.id, rx, ry - t, rz, 0, -1, 0, alongU, width / under.textureWorldSize[1], AO_UNDER));
  }
  for (let i = 0; i + 1 < n; i++) {
    const [hx, hz] = horizRight(samples[i]);
    mb.facingQuad(fascia.id, lTop[i], lTop[i + 1], lBot[i], lBot[i + 1], -hx, 0, -hz);
    mb.facingQuad(fascia.id, rTop[i], rTop[i + 1], rBot[i], rBot[i + 1], hx, 0, hz);
    mb.facingQuad(under.id, bl[i], br[i], bl[i + 1], br[i + 1], 0, -1, 0);
  }
}

/** The start-line decal across the road at `project.start` (visual only; the road underneath collides). */
function buildStartLine(project: CreateProject, kit: CreateKit, road: Road, mb: MeshBuilder): void {
  if (project.start.roadId !== road.id || road.points.length < 2) return;
  const surface = kit.resolveSurface({ slot: 'startLine' }, project.themeId);
  const centerDistance = evaluateRoadAt(road, project.start.param).distance;
  const half = 110;
  const pa = evaluateRoadAt(road, distanceToRoadParam(road, centerDistance - half));
  const pb = evaluateRoadAt(road, distanceToRoadParam(road, centerDistance + half));
  const lift = 2.5;
  const mk = (s: RoadSample, side: -1 | 1, u: number, v: number) => {
    const o = (side * s.width) / 2;
    return mb.vertex(
      surface.id,
      s.position.x + s.right.x * o + s.up.x * lift,
      s.position.y + s.right.y * o + s.up.y * lift,
      s.position.z + s.right.z * o + s.up.z * lift,
      s.up.x, s.up.y, s.up.z, u, v, 255,
    );
  };
  const a0 = mk(pa, -1, 0, 0);
  const a1 = mk(pa, 1, 1, 0);
  const b0 = mk(pb, -1, 0, 1);
  const b1 = mk(pb, 1, 1, 1);
  mb.facingQuad(surface.id, a0, a1, b0, b1, pa.up.x, pa.up.y, pa.up.z);
}
