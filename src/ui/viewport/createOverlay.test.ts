import { describe, expect, it, vi } from 'vitest';
import { mat4 } from 'gl-matrix';
import {
  VertexBatch,
  dashPolyline,
  fillDisc,
  projectPolylineToScreen,
  strokePolyline,
} from '../../../vendor/noclip.website/src/MarioKartWii/CreateOverlay';

vi.mock('../../../vendor/noclip.website/src/SaveManager', () => ({ GlobalSaveManager: {} }));

function ortho(width: number, height: number): mat4 {
  // 1 scene unit per pixel, looking down -Z, origin at the canvas centre.
  return mat4.ortho(mat4.create(), -width / 2, width / 2, -height / 2, height / 2, -1000, 1000);
}

describe('projectPolylineToScreen', () => {
  it('maps world to pixels and keeps a fully visible closed loop as one closed run', () => {
    const m = ortho(200, 100);
    const loop = [{ x: -500, y: 0, z: 0 }, { x: 500, y: 0, z: 0 }, { x: 0, y: 300, z: 0 }];
    const runs = projectPolylineToScreen(loop, true, m, 200, 100, 0.1);
    expect(runs).toHaveLength(1);
    expect(runs[0].closed).toBe(true);
    expect(runs[0].points[0]).toBeCloseTo(50, 3);
    expect(runs[0].points[1]).toBeCloseTo(50, 3);
  });

  it('clips against the near plane in a perspective view', () => {
    const proj = mat4.perspective(mat4.create(), Math.PI / 3, 2, 1, 1000);
    // Camera at the origin looking down -Z; one point in front, one behind.
    const runs = projectPolylineToScreen([{ x: 0, y: 0, z: -500 }, { x: 0, y: 0, z: 500 }], false, proj, 200, 100, 1);
    expect(runs).toHaveLength(1);
    expect(runs[0].points).toHaveLength(4);
    expect(runs[0].points.every(Number.isFinite)).toBe(true);
    expect(projectPolylineToScreen([{ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 20 }], false, proj, 200, 100, 1)).toHaveLength(0);
  });
});

describe('dashPolyline', () => {
  it('lays dashes of the requested length with the requested gaps', () => {
    const run = { points: [0, 50, 300, 50], closed: false };
    const dashes = dashPolyline(run, 9, 6, 400, 100, 0);
    expect(dashes).toHaveLength(20);
    expect(dashes[0].points).toEqual([0, 50, 9, 50]);
    expect(dashes[1].points[0]).toBeCloseTo(15);
    expect(dashes[1].points[2]).toBeCloseTo(24);
  });

  it('keeps the phase when the start is off-screen and a dash can bend round a corner', () => {
    const long = dashPolyline({ points: [-1000, 50, 100, 50], closed: false }, 9, 6, 100, 100, 0);
    // 1000 px into the pattern: 1000 mod 15 = 10, so a gap until x = 5.
    expect(long[0].points[0]).toBeCloseTo(5, 5);
    const bent = dashPolyline({ points: [0, 0, 5, 0, 5, 20], closed: false }, 9, 6, 100, 100, 100);
    expect(bent[0].points).toEqual([0, 0, 5, 0, 5, 4]);
  });
});

describe('strokes and discs', () => {
  it('emits triangles only, with feathered (zero alpha) outer rails', () => {
    const batch = new VertexBatch();
    strokePolyline(batch, [0, 0, 10, 0, 10, 10], false, 2, [1, 1, 1, 1], 0.5);
    expect(batch.count % 3).toBe(0);
    expect(batch.count).toBe(2 * 3 * 6);
    const alphas = new Set<number>();
    for (let i = 0; i < batch.count; i++) alphas.add(batch.data[i * 7 + 6]);
    expect([...alphas].sort()).toEqual([0, 0.5]);
  });

  it('draws discs of the right radius', () => {
    const batch = new VertexBatch();
    fillDisc(batch, 100, 100, 10, [1, 0, 0, 1], 1);
    let maxR = 0;
    for (let i = 0; i < batch.count; i++) maxR = Math.max(maxR, Math.hypot(batch.data[i * 7] - 100, batch.data[i * 7 + 1] - 100));
    expect(maxR).toBeCloseTo(10.5, 3);
  });
});
