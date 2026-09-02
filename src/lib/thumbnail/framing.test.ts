import { describe, expect, it } from 'vitest';
import {
  boundsCenter,
  boundsRadius,
  computeStudioFraming,
  DEFAULT_FRAMING_OPTIONS,
  expandBoundsByPoint,
  framingViewOffsetDirection,
  isUsableBounds,
  makeEmptyBounds,
  type Bounds3,
  type Vec3Tuple,
} from './framing';

function subtract(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normalize(v: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function boxCorners(bounds: Bounds3): Vec3Tuple[] {
  const corners: Vec3Tuple[] = [];
  for (let i = 0; i < 8; i++) {
    corners.push([
      (i & 1 ? bounds.max : bounds.min)[0],
      (i & 2 ? bounds.max : bounds.min)[1],
      (i & 4 ? bounds.max : bounds.min)[2],
    ]);
  }
  return corners;
}

/** Every corner must project inside the frustum and in front of the near plane. */
function assertBoxIsFramed(bounds: Bounds3, options?: Parameters<typeof computeStudioFraming>[1]) {
  const framing = computeStudioFraming(bounds, options);
  const forward = normalize(subtract(framing.target, framing.eye));
  const right = normalize(cross(forward, framing.up));
  const up = normalize(cross(right, forward));
  const tanY = Math.tan(framing.fovY * 0.5);
  const tanX = tanY * framing.aspect;

  for (const corner of boxCorners(bounds)) {
    const relative = subtract(corner, framing.eye);
    const depth = dot(relative, forward);
    expect(depth).toBeGreaterThan(0);
    expect(depth).toBeGreaterThanOrEqual(framing.near - 1e-6);
    expect(depth).toBeLessThanOrEqual(framing.far + 1e-6);
    expect(Math.abs(dot(relative, right))).toBeLessThanOrEqual(depth * tanX + 1e-6);
    expect(Math.abs(dot(relative, up))).toBeLessThanOrEqual(depth * tanY + 1e-6);
  }
  return framing;
}

describe('thumbnail framing bounds helpers', () => {
  it('starts empty and is unusable until points are added', () => {
    const bounds = makeEmptyBounds();
    expect(isUsableBounds(bounds)).toBe(false);
    expandBoundsByPoint(bounds, 1, 2, 3);
    expect(isUsableBounds(bounds)).toBe(false); // A single point has zero radius.
    expandBoundsByPoint(bounds, -1, 0, 5);
    expect(isUsableBounds(bounds)).toBe(true);
    expect(bounds.min).toEqual([-1, 0, 3]);
    expect(bounds.max).toEqual([1, 2, 5]);
  });

  it('ignores non-finite points', () => {
    const bounds = makeEmptyBounds();
    expandBoundsByPoint(bounds, Number.NaN, 0, 0);
    expandBoundsByPoint(bounds, 0, Infinity, 0);
    expect(isUsableBounds(bounds)).toBe(false);
  });

  it('computes centre and radius', () => {
    const bounds: Bounds3 = { min: [-2, 0, -2], max: [2, 4, 2] };
    expect(boundsCenter(bounds)).toEqual([0, 2, 0]);
    expect(boundsRadius(bounds)).toBeCloseTo(Math.hypot(4, 4, 4) / 2, 6);
  });
});

describe('computeStudioFraming', () => {
  it('places the camera on the requested yaw/pitch offset from the model centre', () => {
    const bounds: Bounds3 = { min: [-1, -1, -1], max: [1, 1, 1] };
    const framing = computeStudioFraming(bounds);
    expect(framing.target).toEqual([0, 0, 0]);
    const direction = normalize(framing.eye);
    const expected = framingViewOffsetDirection(DEFAULT_FRAMING_OPTIONS.yaw, DEFAULT_FRAMING_OPTIONS.pitch);
    expect(direction[0]).toBeCloseTo(expected[0], 6);
    expect(direction[1]).toBeCloseTo(expected[1], 6);
    expect(direction[2]).toBeCloseTo(expected[2], 6);
    expect(framing.eye[1]).toBeGreaterThan(0); // Looking slightly down at the model.
  });

  it('fits a unit cube inside the frustum', () => {
    assertBoxIsFramed({ min: [-1, -1, -1], max: [1, 1, 1] });
  });

  it('fits a tall thin model (a tree) inside the frustum', () => {
    assertBoxIsFramed({ min: [-40, 0, -40], max: [40, 900, 40] });
  });

  it('fits a wide flat model inside the frustum', () => {
    assertBoxIsFramed({ min: [-2000, -5, -30], max: [2000, 5, 30] });
  });

  it('fits an off-centre model inside the frustum', () => {
    assertBoxIsFramed({ min: [900, 1200, -400], max: [1100, 1600, -100] });
  });

  it('scales the camera distance linearly with model size', () => {
    const small = computeStudioFraming({ min: [-1, -1, -1], max: [1, 1, 1] });
    const large = computeStudioFraming({ min: [-10, -10, -10], max: [10, 10, 10] });
    expect(large.distance / small.distance).toBeCloseTo(10, 4);
  });

  it('pulls the camera back further for a smaller fill fraction', () => {
    const tight = computeStudioFraming({ min: [-1, -1, -1], max: [1, 1, 1] }, { fill: 0.95 });
    const loose = computeStudioFraming({ min: [-1, -1, -1], max: [1, 1, 1] }, { fill: 0.4 });
    expect(loose.distance).toBeGreaterThan(tight.distance);
  });

  it('keeps a positive near plane and a near/far range that contains the model', () => {
    const framing = computeStudioFraming({ min: [-1, -1, -1], max: [1, 1, 1] });
    expect(framing.near).toBeGreaterThan(0);
    expect(framing.far).toBeGreaterThan(framing.near);
  });

  it('honours a non-square aspect ratio', () => {
    const bounds: Bounds3 = { min: [-4, -1, -1], max: [4, 1, 1] };
    const square = computeStudioFraming(bounds, { aspect: 1 });
    const wide = computeStudioFraming(bounds, { aspect: 2 });
    expect(wide.distance).toBeLessThan(square.distance);
    assertBoxIsFramed(bounds, { aspect: 2 });
  });
});
