import { beforeEach, describe, expect, it } from 'vitest';
import type { CreateProject, Road, RoadPoint } from './types';
import { useDeterministicIds } from './ids';
import {
  distanceToRoadParam,
  evaluateRoadAt,
  nearestRoad,
  projectOntoRoad,
  roadLength,
  roadParamEnd,
  roadParamToDistance,
  sampleRoad,
  sampleRoadRange,
} from './spline';

let idCounter = 0;
function point(x: number, z: number, extra: Partial<RoadPoint> = {}): RoadPoint {
  return { id: `p${idCounter++}`, position: { x, y: 0, z }, width: 3600, bank: 0, corner: 'smooth', ...extra };
}
function road(points: RoadPoint[], closed: boolean): Road {
  return { id: 'r', name: 'r', closed, points, styleId: 'circuit', sections: [{ id: 's', start: 0, kind: 'road' }] };
}
const square = () => road([point(0, 0), point(10000, 0), point(10000, 10000), point(0, 10000)], true);

beforeEach(() => {
  idCounter = 0;
  useDeterministicIds();
});

describe('spline basics', () => {
  it('passes through every control point', () => {
    const r = square();
    for (let i = 0; i < r.points.length; i++) {
      const s = evaluateRoadAt(r, i);
      expect(s.position.x).toBeCloseTo(r.points[i].position.x, 3);
      expect(s.position.z).toBeCloseTo(r.points[i].position.z, 3);
    }
  });

  it('knows its segment count and end parameter', () => {
    expect(roadParamEnd(square())).toBe(4);
    expect(roadParamEnd(road([point(0, 0), point(100, 0), point(200, 50)], false))).toBe(2);
  });

  it('closed roads sample back to the start with the full lap length', () => {
    const r = square();
    const samples = sampleRoad(r, { step: 300 });
    const first = samples[0];
    const last = samples[samples.length - 1];
    expect(last.param).toBeCloseTo(4);
    expect(Math.hypot(first.position.x - last.position.x, first.position.z - last.position.z)).toBeLessThan(1e-6);
    expect(last.distance).toBeCloseTo(roadLength(r), 3);
    expect(roadLength(r)).toBeGreaterThan(36000);
  });

  it('keeps arc-length spacing near the requested step and adds samples in bends', () => {
    const r = square();
    const samples = sampleRoad(r, { step: 400, maxAngleDegrees: 5 });
    for (let i = 1; i < samples.length; i++) {
      const d = samples[i].distance - samples[i - 1].distance;
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(500);
    }
  });

  it('builds orthonormal frames with up pointing up on flat ground', () => {
    const r = square();
    for (const s of sampleRoad(r, { step: 500 })) {
      expect(Math.hypot(s.tangent.x, s.tangent.y, s.tangent.z)).toBeCloseTo(1, 5);
      expect(Math.hypot(s.right.x, s.right.y, s.right.z)).toBeCloseTo(1, 5);
      expect(s.up.y).toBeGreaterThan(0.99);
      expect(s.tangent.x * s.right.x + s.tangent.y * s.right.y + s.tangent.z * s.right.z).toBeCloseTo(0, 5);
    }
  });

  it('right is on the right of the driving direction (forward -Z => right +X)', () => {
    const r = road([point(0, 0), point(0, -5000), point(0, -10000)], false);
    const s = evaluateRoadAt(r, 0.5);
    expect(s.tangent.z).toBeLessThan(-0.99);
    expect(s.right.x).toBeGreaterThan(0.99);
  });

  it('positive bank tilts the right edge down', () => {
    const r = road([point(0, 0, { bank: 20 }), point(0, -5000, { bank: 20 }), point(0, -10000, { bank: 20 })], false);
    const s = evaluateRoadAt(r, 0.5);
    expect(s.right.y).toBeLessThan(-0.3);
    expect(s.up.x).toBeGreaterThan(0.3);
  });

  it('interpolates width and bank between points', () => {
    const r = road([point(0, 0, { width: 3000, bank: 0 }), point(0, -8000, { width: 5000, bank: 10 }), point(0, -16000, { width: 5000, bank: 10 })], false);
    const mid = evaluateRoadAt(r, 0.5);
    expect(mid.width).toBeCloseTo(4000, 3);
    expect(mid.bank).toBeCloseTo(5, 3);
  });
});

describe('sharp corners', () => {
  it('breaks the tangent and keeps full edge width with a miter', () => {
    const smooth = road([point(0, 0), point(5000, 0), point(5000, 5000), point(0, 5000)], false);
    const sharp = road([point(0, 0), point(5000, 0, { corner: 'sharp' }), point(5000, 5000), point(0, 5000)], false);
    const atSmooth = evaluateRoadAt(smooth, 1);
    const atSharp = evaluateRoadAt(sharp, 1);
    // Smooth: the road overshoots nothing; sharp: bisector tangent and widened lateral scale.
    expect(atSharp.lateralScale).toBeGreaterThan(1.2);
    expect(atSmooth.lateralScale).toBe(1);
    // Right before the corner the road runs straight along the chord.
    const before = evaluateRoadAt(sharp, 0.95);
    expect(Math.abs(before.tangent.z)).toBeLessThan(0.25);
    const samples = sampleRoadRange(sharp, 0, 2);
    expect(samples.some((s) => s.isPoint && Math.abs(s.param - 1) < 1e-9)).toBe(true);
  });
});

describe('degenerate roads', () => {
  it('handles a two point road', () => {
    const r = road([point(0, 0), point(0, -4000)], false);
    const samples = sampleRoad(r);
    expect(samples.length).toBeGreaterThanOrEqual(2);
    expect(roadLength(r)).toBeCloseTo(4000, 0);
    expect(samples.every((s) => Number.isFinite(s.position.x) && Number.isFinite(s.right.x))).toBe(true);
  });

  it('handles duplicate points without NaN', () => {
    const r = road([point(0, 0), point(0, 0), point(3000, 0), point(3000, 3000), point(3000, 3000)], false);
    for (const s of sampleRoad(r)) {
      for (const v of [s.position.x, s.position.y, s.position.z, s.tangent.x, s.tangent.z, s.right.x, s.right.z, s.curvature]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('handles one point and none', () => {
    expect(sampleRoad(road([], false))).toEqual([]);
    expect(sampleRoad(road([point(5, 5)], false))).toHaveLength(1);
  });

  it('handles very tight corners and steep slopes', () => {
    const tight = road([point(0, 0), point(800, 0), point(800, 800), point(0, 800)], true);
    expect(sampleRoad(tight).every((s) => Number.isFinite(s.curvature))).toBe(true);
    const steep = road([point(0, 0), point(0, -1000, { }), point(0, -2000)], false);
    steep.points[1].position.y = 3000;
    const s = evaluateRoadAt(steep, 0.5);
    expect(Math.hypot(s.up.x, s.up.y, s.up.z)).toBeCloseTo(1, 5);
    expect(Number.isFinite(s.right.x)).toBe(true);
  });

  it('reports turning direction in the curvature sign', () => {
    // Driving +X then curving towards -Z (screen up): with right = (-fz, fx) that is a left turn.
    const left = road([point(0, 0), point(5000, 0), point(10000, -5000), point(10000, -10000)], false);
    const right = road([point(0, 0), point(5000, 0), point(10000, 5000), point(10000, 10000)], false);
    const sl = evaluateRoadAt(left, 1.5);
    const sr = evaluateRoadAt(right, 1.5);
    const kl = sampleRoad(left).find((s) => Math.abs(s.param - 1.5) < 0.2)!;
    const kr = sampleRoad(right).find((s) => Math.abs(s.param - 1.5) < 0.2)!;
    expect(sl.tangent.z).toBeLessThan(0.1);
    expect(kl.curvature).toBeLessThan(0);
    expect(kr.curvature).toBeGreaterThan(0);
    expect(sr.tangent.z).toBeGreaterThan(-0.1);
  });
});

describe('parameter and distance conversion', () => {
  it('round-trips', () => {
    const r = square();
    for (const u of [0, 0.3, 1.25, 2.9, 3.99]) {
      expect(distanceToRoadParam(r, roadParamToDistance(r, u))).toBeCloseTo(u, 3);
    }
  });

  it('wraps on closed roads and clamps on open roads', () => {
    const r = square();
    const len = roadLength(r);
    expect(distanceToRoadParam(r, len + 100)).toBeCloseTo(distanceToRoadParam(r, 100), 6);
    const open = road([point(0, 0), point(0, -4000)], false);
    expect(distanceToRoadParam(open, 99999)).toBeCloseTo(1, 6);
    expect(roadParamToDistance(open, -5)).toBe(0);
  });

  it('sampleRoadRange starts and ends exactly on the requested parameters', () => {
    const r = square();
    const s = sampleRoadRange(r, 0.37, 2.61, { step: 700 });
    expect(s[0].param).toBeCloseTo(0.37, 9);
    expect(s[s.length - 1].param).toBeCloseTo(2.61, 9);
    expect(s[0].distance).toBeCloseTo(roadParamToDistance(r, 0.37), 6);
  });

  it('can wrap past the end of a closed road', () => {
    const r = square();
    const s = sampleRoadRange(r, 3.5, 4.5, { step: 500 });
    expect(s[s.length - 1].distance).toBeGreaterThan(roadLength(r));
    const wrapped = evaluateRoadAt(r, 0.5);
    expect(s[s.length - 1].position.x).toBeCloseTo(wrapped.position.x, 3);
  });
});

describe('projectOntoRoad', () => {
  it('finds param, distance and signed lateral', () => {
    const r = road([point(0, 0), point(0, -10000), point(0, -20000)], false);
    const hit = projectOntoRoad(r, { x: 900, z: -5000 })!;
    expect(hit.param).toBeCloseTo(0.5, 1);
    expect(hit.lateral).toBeCloseTo(900, 0);
    expect(hit.lateralNorm).toBeCloseTo(900 / 1800, 2);
    expect(hit.distance).toBeCloseTo(5000, -1);
    expect(hit.distanceToCenter).toBeCloseTo(900, 0);
    const left = projectOntoRoad(r, { x: -1800, z: -12000 })!;
    expect(left.lateralNorm).toBeCloseTo(-1, 2);
  });

  it('uses height to pick the right layer of an overpass', () => {
    const lower = road([point(-10000, 0), point(0, 0), point(10000, 0)], false);
    lower.id = 'lower';
    const upper = road([point(0, -10000), point(0, 0), point(0, 10000)], false);
    upper.id = 'upper';
    upper.points.forEach((p) => (p.position.y = 1500));
    const project = { roads: [lower, upper] } as unknown as CreateProject;
    expect(nearestRoad(project, { x: 0, y: 40, z: 0 })!.road.id).toBe('lower');
    expect(nearestRoad(project, { x: 0, y: 1460, z: 0 })!.road.id).toBe('upper');
    expect(nearestRoad(project, { x: 0, z: 90000 }, 5000)).toBeNull();
  });

  it('returns null for an empty road', () => {
    expect(projectOntoRoad(road([], false), { x: 0, z: 0 })).toBeNull();
  });

  it('wraps the parameter of a closed road below the end', () => {
    const r = square();
    const hit = projectOntoRoad(r, { x: -50, z: 10 })!;
    expect(hit.param).toBeGreaterThanOrEqual(0);
    expect(hit.param).toBeLessThan(4);
  });
});
