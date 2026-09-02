import { describe, expect, it } from 'vitest';
import {
  boundsCenter,
  buildComponentIndexLists,
  collectTriangleEdges,
  computeTriangleSoupBounds,
  rayAabbIntersection,
  rayTriangleIntersection,
  splitTrianglesIntoComponents,
} from './meshPick';

describe('rayTriangleIntersection', () => {
  const a = [0, 0, 0];
  const b = [10, 0, 0];
  const c = [0, 10, 0];

  it('hits a triangle straight on and returns the distance', () => {
    const t = rayTriangleIntersection(1, 1, 5, 0, 0, -1, a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    expect(t).toBeCloseTo(5, 6);
  });

  it('hits back faces too (two sided)', () => {
    const t = rayTriangleIntersection(1, 1, -5, 0, 0, 1, a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    expect(t).toBeCloseTo(5, 6);
  });

  it('misses outside the triangle', () => {
    expect(rayTriangleIntersection(9, 9, 5, 0, 0, -1, a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])).toBeNull();
  });

  it('misses when the triangle is behind the ray origin', () => {
    expect(rayTriangleIntersection(1, 1, 5, 0, 0, 1, a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])).toBeNull();
  });

  it('misses when the ray is parallel to the triangle plane', () => {
    expect(rayTriangleIntersection(1, 1, 5, 1, 0, 0, a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])).toBeNull();
  });
});

describe('rayAabbIntersection', () => {
  const bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };

  it('returns the near distance for an outside origin', () => {
    expect(rayAabbIntersection(0, 0, 10, 0, 0, -1, bounds)).toBeCloseTo(9, 6);
  });

  it('returns 0 when the origin is inside', () => {
    expect(rayAabbIntersection(0, 0, 0, 0, 0, -1, bounds)).toBe(0);
  });

  it('returns null for a miss', () => {
    expect(rayAabbIntersection(5, 5, 10, 0, 0, -1, bounds)).toBeNull();
  });

  it('handles axis-parallel rays that graze the slab', () => {
    expect(rayAabbIntersection(0, 5, 10, 0, 0, -1, bounds)).toBeNull();
  });
});

describe('splitTrianglesIntoComponents', () => {
  // Two separate quads ("trees") 100 units apart, in one shape.
  const positions = [
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
    100, 0, 0, 101, 0, 0, 101, 1, 0, 100, 1, 0,
  ];
  const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];

  it('finds one component per disconnected island', () => {
    const split = splitTrianglesIntoComponents(positions, indices, 0.5);
    expect(split.componentCount).toBe(2);
    expect(Array.from(split.triangleComponent)).toEqual([0, 0, 1, 1]);
    expect(Array.from(split.triangleCounts)).toEqual([2, 2]);
  });

  it('reports per-component bounds', () => {
    const split = splitTrianglesIntoComponents(positions, indices, 0.5);
    expect(boundsCenter(split.bounds[0])).toEqual({ x: 0.5, y: 0.5, z: 0 });
    expect(boundsCenter(split.bounds[1])).toEqual({ x: 100.5, y: 0.5, z: 0 });
  });

  it('welds duplicated vertices that sit within epsilon', () => {
    // Same geometry but with the shared edge duplicated (as the GX vertex loader emits).
    const dupPositions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0];
    const dupIndices = [0, 1, 2, 3, 4, 5];
    const split = splitTrianglesIntoComponents(dupPositions, dupIndices, 0.001);
    expect(split.componentCount).toBe(1);
  });

  it('merges islands when epsilon is large enough to bridge them', () => {
    const split = splitTrianglesIntoComponents(positions, indices, 200);
    expect(split.componentCount).toBe(1);
  });

  it('builds one index list per component', () => {
    const split = splitTrianglesIntoComponents(positions, indices, 0.5);
    const lists = buildComponentIndexLists(indices, split);
    expect(Array.from(lists[0])).toEqual([0, 1, 2, 0, 2, 3]);
    expect(Array.from(lists[1])).toEqual([4, 5, 6, 4, 6, 7]);
  });
});

describe('bounds and edges', () => {
  it('computes triangle soup bounds', () => {
    const bounds = computeTriangleSoupBounds([0, 0, 0, 2, 4, 6, 1, 1, 1], [0, 1, 2]);
    expect(bounds.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(bounds.max).toEqual({ x: 2, y: 4, z: 6 });
  });

  it('collects unique undirected edges', () => {
    const edges = collectTriangleEdges([0, 1, 2, 0, 2, 3]);
    expect(edges).toHaveLength(5);
  });

  it('caps the edge count', () => {
    const edges = collectTriangleEdges([0, 1, 2, 3, 4, 5], 2);
    expect(edges.length).toBeLessThanOrEqual(2);
  });
});
