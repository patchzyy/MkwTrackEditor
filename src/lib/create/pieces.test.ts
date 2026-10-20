import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledGeometry, CreateKit, CreateProject, Piece } from './types';
import { useDeterministicIds } from './ids';
import { createSyntheticKit } from './__tests__/syntheticKit';
import { createProjectFromTemplate } from './templates';
import { addPiece, addProp, deletePiece } from './ops';
import { buildPieceGeometry, defaultPiece, ITEM_BOX_HEIGHT, PANEL_LIFT, pieceLateralOffset, pieceObjects, PIECE_DEFAULTS, pieceSample } from './pieces';
import { compileGeometry } from './compile';
import { propObjects, objectProfile, defaultObjectSettings, normalizeSettings, OBJECT_PROFILES } from './props';
import { createSurfaceQuery } from './raycast';
import { FLAG_BOOST_PANEL, FLAG_BOOST_RAMP, FLAG_TRICK_RAMP } from './kclTypes';
import { evaluateRoadAt } from './spline';
import { ROAD_STYLES, getRoadStyle, resolveEdge } from './roadStyles';

let kit: CreateKit;
beforeAll(() => {
  useDeterministicIds();
  kit = createSyntheticKit();
});

const bare = (): CreateProject => {
  const p = createProjectFromTemplate('oval', { name: 'x', themeId: 'test', laps: 3 }, kit);
  return p.pieces.reduce((q, piece) => deletePiece(q, piece.id), p);
};

const withPiece = (piece: Partial<Omit<Piece, 'id'>> & Pick<Piece, 'kind'>): { project: CreateProject; id: string } => {
  const p = bare();
  const base = defaultPiece(piece.kind, 3600);
  return addPiece(p, { ...base, roadId: p.roads[0].id, param: 3.4, ...piece } as Omit<Piece, 'id'>);
};

function triangles(g: { collision: CompiledGeometry['collision'] }, flag: number) {
  const out: number[][] = [];
  const { positions: P, indices: I, flags: F } = g.collision;
  for (let t = 0; t < F.length; t++) {
    if (F[t] !== flag) continue;
    const row: number[] = [];
    for (let k = 0; k < 3; k++) row.push(P[I[t * 3 + k] * 3], P[I[t * 3 + k] * 3 + 1], P[I[t * 3 + k] * 3 + 2]);
    out.push(row);
  }
  return out;
}

describe('boost panel', () => {
  it('is a quad of boost collision lying just above the road, on the lane it was put in', () => {
    const { project } = withPiece({ kind: 'boostPanel', lateral: -0.4, width: 1000, length: 1500 });
    const geo = buildPieceGeometry(project, kit);
    const tris = triangles({ collision: geo.collision.build() }, FLAG_BOOST_PANEL);
    expect(tris.length).toBeGreaterThanOrEqual(10);
    const piece = project.pieces[0];
    const found = pieceSample(project, piece)!;
    const centre = found.sample.position;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const x = t[k * 3];
        const y = t[k * 3 + 1];
        const z = t[k * 3 + 2];
        const lat = (x - centre.x) * found.sample.right.x + (z - centre.z) * found.sample.right.z;
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        expect(y - centre.y).toBeGreaterThan(PANEL_LIFT - 4);
        expect(y - centre.y).toBeLessThan(PANEL_LIFT + 60); // bank and slope allowed, not floating
      }
    }
    expect((minLat + maxLat) / 2).toBeCloseTo(-0.4 * (found.sample.width / 2), -2);
    expect(maxLat - minLat).toBeCloseTo(1000, -2);
    expect(geo.meshes.some((m) => m.surfaceId === 'test.boost')).toBe(true);
  });

  it('stays on the road even when asked for the very edge', () => {
    const { project } = withPiece({ kind: 'boostPanel', lateral: 1, width: 1400, length: 1200 });
    const found = pieceSample(project, project.pieces[0])!;
    const offset = pieceLateralOffset(project.pieces[0], found.sample);
    expect(offset + 700).toBeLessThanOrEqual(found.sample.width / 2 + 1e-6);
  });
});

describe('ramps', () => {
  it.each([
    ['boostRamp', FLAG_BOOST_RAMP],
    ['trickRamp', FLAG_TRICK_RAMP],
  ] as const)('a %s is a wedge that rises to its height and uses the right surface type', (kind, flag) => {
    const { project } = withPiece({ kind, height: 500, length: 2400, width: 2000 });
    const geo = buildPieceGeometry(project, kit);
    const tris = triangles({ collision: geo.collision.build() }, flag);
    expect(tris.length).toBeGreaterThanOrEqual(10);
    const found = pieceSample(project, project.pieces[0])!;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        minY = Math.min(minY, t[k * 3 + 1]);
        maxY = Math.max(maxY, t[k * 3 + 1]);
      }
      // The ramp top faces up and a little back.
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = t;
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      expect(ny).toBeGreaterThan(0);
      void ay; void by; void cy;
    }
    expect(maxY - found.sample.position.y).toBeGreaterThan(450);
    expect(maxY - found.sample.position.y).toBeLessThan(560);
    expect(minY - found.sample.position.y).toBeLessThan(10);
    // Trick ramps carry the trickable bit; boost ramps are their own surface type.
    if (kind === 'trickRamp') expect(flag & 0x2000).toBe(0x2000);
    else expect(flag & 0x1f).toBe(7);
    // The sides and back are visual only.
    const sideMeshes = geo.meshes.filter((m) => m.surfaceId === 'test.wall');
    expect(sideMeshes.length).toBe(1);
  });
});

describe('item rows', () => {
  it('put boxes on the road surface, evenly spaced across the lane', () => {
    const { project } = withPiece({ kind: 'itemRow', count: 5, width: 2750, lateral: 0 });
    const boxes = pieceObjects(project).objects;
    expect(boxes).toHaveLength(5);
    const sample = pieceSample(project, project.pieces[0])!.sample;
    const lats = boxes.map((b) => (b.position.x - sample.position.x) * sample.right.x + (b.position.z - sample.position.z) * sample.right.z);
    for (let i = 1; i < lats.length; i++) expect(lats[i] - lats[i - 1]).toBeCloseTo(550, -1);
    expect((lats[0] + lats[4]) / 2).toBeCloseTo(0, -1);
    for (const b of boxes) {
      expect(b.objectId).toBe(0x65);
      expect(b.settings).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
      expect(b.presenceFlags).toBe(0x3f);
      expect(b.routeIndex).toBe(0xffff);
      expect(b.scale).toEqual({ x: 1, y: 1, z: 1 });
      expect(Math.abs(b.position.y - (sample.position.y + ITEM_BOX_HEIGHT))).toBeLessThan(200); // banked road: edge boxes sit a bit off the centre height
    }
    // On the actual collision, every box rests on the surface.
    const q = createSurfaceQuery(compileGeometry(project, kit).collision);
    for (const b of boxes) expect(Math.abs(b.position.y - q.groundAt(b.position.x, b.position.y + 100, b.position.z)!)).toBeLessThan(4);
  });

  it('shifts with the lane, never leaves the road, and supports one box', () => {
    const left = withPiece({ kind: 'itemRow', count: 3, width: 1500, lateral: -0.5 });
    const boxes = pieceObjects(left.project).objects;
    const s = pieceSample(left.project, left.project.pieces[0])!.sample;
    for (const b of boxes) {
      const lat = (b.position.x - s.position.x) * s.right.x + (b.position.z - s.position.z) * s.right.z;
      expect(lat).toBeLessThan(0);
      expect(Math.abs(lat)).toBeLessThan(s.width / 2);
    }
    expect(pieceObjects(withPiece({ kind: 'itemRow', count: 1 }).project).objects).toHaveLength(1);
    expect(pieceObjects(withPiece({ kind: 'itemRow', count: 99 }).project).objects.length).toBeLessThanOrEqual(12);
  });
});

describe('objects', () => {
  it('a Goomba gets default settings and its own route across the road', () => {
    const { project } = withPiece({ kind: 'object', objectId: 0x191 });
    const out = pieceObjects(project, 3);
    expect(out.objects).toHaveLength(1);
    expect(out.routes).toHaveLength(1);
    const goomba = out.objects[0];
    expect(goomba.routeIndex).toBe(3);
    expect(goomba.settings).toEqual([600, 40, 120, 0, 0, 0, 0, 0]);
    const route = out.routes[0];
    expect(route.forwardBackward).toBe(1);
    expect(route.points).toHaveLength(2);
    const sample = pieceSample(project, project.pieces[0])!.sample;
    for (const p of route.points) expect(Math.abs((p.position.x - sample.position.x) * sample.right.x + (p.position.z - sample.position.z) * sample.right.z)).toBeLessThan(sample.width / 2);
    expect(goomba.position).toEqual(route.points[0].position);
  });

  it('objects without a route profile stay put, with the settings they were given', () => {
    const { project } = withPiece({ kind: 'object', objectId: 0x194, settings: [111, 2, 3, 4, 5, 6, 7, 8] });
    const out = pieceObjects(project);
    expect(out.routes).toHaveLength(0);
    expect(out.objects[0].routeIndex).toBe(0xffff);
    expect(out.objects[0].settings).toEqual([111, 2, 3, 4, 5, 6, 7, 8]);
    expect(out.objects[0].scale.x).toBeCloseTo(1.3);
  });

  it('ignores pieces on roads that no longer exist', () => {
    const { project } = withPiece({ kind: 'itemRow' });
    const broken = { ...project, pieces: project.pieces.map((p) => ({ ...p, roadId: 'gone' })) };
    expect(pieceObjects(broken).objects).toEqual([]);
    expect(buildPieceGeometry(broken, kit).meshes).toEqual([]);
  });
});

describe('defaults', () => {
  it('cap widths to narrow roads and set sensible object defaults', () => {
    expect(defaultPiece('boostRamp', 2600).width).toBeLessThanOrEqual(2200);
    expect(defaultPiece('boostPanel').width).toBe(PIECE_DEFAULTS.boostPanel.width);
    const object = defaultPiece('object', undefined, 0x191);
    expect(object.objectId).toBe(0x191);
    expect(object.settings).toEqual([600, 40, 120, 0, 0, 0, 0, 0]);
    expect(defaultPiece('itemRow').count).toBe(5);
  });
});

describe('props', () => {
  it('snap to the ground when asked to and keep their height otherwise', () => {
    let p = bare();
    const base = { objectId: 0x133, rotation: { x: 0, y: 30, z: 0 }, scale: { x: 2, y: 2, z: 2 } };
    p = addProp(p, { ...base, position: { x: 0, y: 5000, z: 40000 }, snapToGround: true }).project;
    p = addProp(p, { ...base, position: { x: 3000, y: 5000, z: 40000 }, snapToGround: false }).project;
    const q = createSurfaceQuery(compileGeometry(p, kit).collision);
    const objects = propObjects(p, q.groundAt);
    expect(objects).toHaveLength(2);
    expect(objects[0].position.y).toBeLessThan(100);
    expect(objects[0].position.y).toBeGreaterThan(-100);
    expect(objects[1].position.y).toBe(5000);
    expect(objects[0].rotation.y).toBe(30);
    expect(objects[0].scale.x).toBe(2);
    expect(objects[0].settings).toHaveLength(8);
  });

  it('has profiles for the common hazards and tolerates unknown objects', () => {
    expect(objectProfile(0x65).name).toBe('Item box');
    expect(Object.keys(OBJECT_PROFILES).length).toBeGreaterThanOrEqual(4);
    expect(defaultObjectSettings(0xffff)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(normalizeSettings([1, 2, 99999, -4], 1)).toEqual([1, 2, 65535, 0, 0, 0, 0, 0]);
    expect(normalizeSettings(undefined, 0x191)[0]).toBe(600);
  });
});

describe('road styles', () => {
  it('are friendly, complete and resolve against the kit', () => {
    expect(ROAD_STYLES.length).toBeGreaterThanOrEqual(7);
    const ids = new Set<string>();
    for (const style of ROAD_STYLES) {
      expect(ids.has(style.id)).toBe(false);
      ids.add(style.id);
      expect(style.label).not.toMatch(/KMP|KCL|BRRES|slot/i);
      expect(style.description.length).toBeGreaterThan(25);
      expect(style.defaultWidth).toBeGreaterThanOrEqual(2800);
      expect(style.defaultWidth).toBeLessThanOrEqual(4200);
      for (const ref of [style.surface, style.skirt, style.underside]) expect(kit.resolveSurface(ref, 'test').id).toMatch(/^test\./);
      for (const edge of [style.left, style.right]) if (edge.shoulder) expect(kit.resolveSurface(edge.shoulder, 'test')).toBeTruthy();
    }
    expect(getRoadStyle('does-not-exist').id).toBe('circuit');
  });

  it('section edges override only what they set', () => {
    const base = getRoadStyle('circuit').left;
    const merged = resolveEdge(base, { wall: 'fence', curb: undefined });
    expect(merged.wall).toBe('fence');
    expect(merged.curb).toBe(base.curb);
    expect(resolveEdge(base, undefined)).toBe(base);
    expect(resolveEdge(base, { shoulder: null }).shoulder).toBeNull();
  });

  it('every style compiles and re-skins with the theme', () => {
    for (const style of ROAD_STYLES) {
      const p = createProjectFromTemplate('oval', { name: 'x', themeId: 'test', laps: 3 }, kit);
      const styled = { ...p, roads: [{ ...p.roads[0], styleId: style.id }] };
      const a = compileGeometry(styled, kit);
      const b = compileGeometry({ ...styled, themeId: 'test2' }, kit);
      expect(a.meshes.some((m) => m.surfaceId.startsWith('test.'))).toBe(true);
      expect(b.meshes.every((m) => m.surfaceId.startsWith('test2.'))).toBe(true);
    }
    void evaluateRoadAt;
  });
});
