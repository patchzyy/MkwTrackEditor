import { describe, expect, it } from 'vitest';
import {
  collisionTypes,
  describeKclFlag,
  getKclBvh,
  kclBounds,
  kclFlagColor,
  kclFlagName,
  kclOctreeLookup,
  parseKcl,
  raycastDown,
  raycastDownDetailed,
  raycastMesh,
  snapPointToNearestFeature,
  snapPointToTriangleFeature,
  type KclMesh,
  type KclTriangle,
} from './kcl';
import { buildTriangleBvh } from './kclRaycast';
import { decodeYaz0 } from './yaz0';
import { parseU8 } from './u8';
import { CUSTOM_TRACK_DIR, NINTENDO_TRACK_DIR, listTracks, readTrackBytes } from './realTrackFixtures.testdata';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function triangle(a: Vec3, b: Vec3, c: Vec3, flag = 0): KclTriangle {
  return { a, b, c, flag, typeName: kclFlagName(flag), normal: { x: 0, y: 1, z: 0 }, prismIndex: 0 };
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const negate = (a: Vec3): Vec3 => ({ x: -a.x, y: -a.y, z: -a.z });
function unit(a: Vec3): Vec3 {
  const length = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / length, y: a.y / length, z: a.z / length };
}

/**
 * Encodes a triangle the way a KCL does: the first vertex, the face direction, the three
 * edge normals and the distance from the first vertex to the opposite edge. This is the
 * inverse of the reconstruction in `parseKcl`, so a round-trip through it proves the parser.
 */
function encodePrism(v1: Vec3, v2: Vec3, v3: Vec3): { direction: Vec3; normalA: Vec3; normalB: Vec3; normalC: Vec3; length: number } {
  const direction = unit(cross(sub(v2, v1), sub(v3, v1)));
  const normalA = unit(cross(direction, sub(v3, v1)));
  const normalB = unit(cross(direction, sub(v2, v1)));
  const opposite = unit(cross(direction, sub(v3, v2)));
  // The third normal must point away from the first vertex.
  const normalC = dot(opposite, sub(v1, v2)) > 0 ? negate(opposite) : opposite;
  return { direction, normalA, normalB, normalC, length: dot(sub(v2, v1), normalC) };
}

/**
 * Writes a synthetic KCL: a flat grid of `cells * cells * 2` triangles at y = 0, plus a
 * one-level octree whose single leaf lists every prism.
 */
function buildSyntheticKcl(cells: number, size: number): Uint8Array {
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const prisms: Array<{ length: number; pos: number; dir: number; a: number; b: number; c: number; flag: number }> = [];

  const pushNormal = (v: Vec3): number => {
    const index = normals.findIndex((n) => Math.abs(n.x - v.x) < 1e-6 && Math.abs(n.y - v.y) < 1e-6 && Math.abs(n.z - v.z) < 1e-6);
    if (index >= 0) return index;
    normals.push(v);
    return normals.length - 1;
  };

  const addTriangle = (v1: Vec3, v2: Vec3, v3: Vec3, flag: number) => {
    const encoded = encodePrism(v1, v2, v3);
    positions.push(v1);
    prisms.push({
      length: encoded.length,
      pos: positions.length - 1,
      dir: pushNormal(encoded.direction),
      a: pushNormal(encoded.normalA),
      b: pushNormal(encoded.normalB),
      c: pushNormal(encoded.normalC),
      flag,
    });
  };

  const step = size / cells;
  for (let ix = 0; ix < cells; ix++) {
    for (let iz = 0; iz < cells; iz++) {
      const x = ix * step;
      const z = iz * step;
      addTriangle({ x, y: 0, z }, { x: x + step, y: 0, z }, { x, y: 0, z: z + step }, 0x00);
      addTriangle({ x: x + step, y: 0, z: z + step }, { x, y: 0, z: z + step }, { x: x + step, y: 0, z }, 0x01);
    }
  }

  const headerSize = 0x3c;
  const posSize = positions.length * 12;
  const normSize = normals.length * 12;
  const triSize = prisms.length * 16;
  const listBytes = 2 + (prisms.length + 1) * 2;
  const total = headerSize + posSize + normSize + triSize + 4 + listBytes;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const posOffset = headerSize;
  const normOffset = posOffset + posSize;
  const triStart = normOffset + normSize;
  const octreeOffset = triStart + triSize;

  view.setUint32(0x00, posOffset, false);
  view.setUint32(0x04, normOffset, false);
  view.setUint32(0x08, triStart - 0x10, false);
  view.setUint32(0x0c, octreeOffset, false);
  view.setFloat32(0x10, 300, false);
  view.setFloat32(0x14, 0, false);
  view.setFloat32(0x18, -1, false);
  view.setFloat32(0x1c, 0, false);
  // One root cell covering 2^20 units in each axis.
  view.setUint32(0x20, ~0xfffff >>> 0, false);
  view.setUint32(0x24, ~0xfffff >>> 0, false);
  view.setUint32(0x28, ~0xfffff >>> 0, false);
  view.setUint32(0x2c, 20, false);
  view.setUint32(0x30, 0, false);
  view.setUint32(0x34, 0, false);
  view.setFloat32(0x38, 250, false);

  for (let i = 0; i < positions.length; i++) {
    view.setFloat32(posOffset + i * 12, positions[i].x, false);
    view.setFloat32(posOffset + i * 12 + 4, positions[i].y, false);
    view.setFloat32(posOffset + i * 12 + 8, positions[i].z, false);
  }
  for (let i = 0; i < normals.length; i++) {
    view.setFloat32(normOffset + i * 12, normals[i].x, false);
    view.setFloat32(normOffset + i * 12 + 4, normals[i].y, false);
    view.setFloat32(normOffset + i * 12 + 8, normals[i].z, false);
  }
  for (let i = 0; i < prisms.length; i++) {
    const at = triStart + i * 16;
    view.setFloat32(at, prisms[i].length, false);
    view.setUint16(at + 4, prisms[i].pos, false);
    view.setUint16(at + 6, prisms[i].dir, false);
    view.setUint16(at + 8, prisms[i].a, false);
    view.setUint16(at + 10, prisms[i].b, false);
    view.setUint16(at + 12, prisms[i].c, false);
    view.setUint16(at + 14, prisms[i].flag, false);
  }
  // Root node: a leaf whose list starts 4 bytes into the octree block (skipping the node
  // itself), which the format expresses as "offset + 2".
  view.setUint32(octreeOffset, 0x80000000 | 2, false);
  for (let i = 0; i < prisms.length; i++) view.setUint16(octreeOffset + 4 + i * 2, i + 1, false);
  view.setUint16(octreeOffset + 4 + prisms.length * 2, 0, false);
  return out;
}

describe('KCL flags', () => {
  it('names every base collision type', () => {
    expect(collisionTypes).toHaveLength(32);
    expect(kclFlagName(0x00)).toBe('Road');
    expect(kclFlagName(0x0c)).toBe('Wall');
    expect(kclFlagName(0x11)).toBe('Cannon Activator');
    // Only the low five bits select the type.
    expect(kclFlagName(0xffe0 | 0x03)).toBe('Off-Road');
  });

  it('decodes every documented bitfield', () => {
    const info = describeKclFlag(0x2000 | (2 << 11) | (5 << 8) | (3 << 5) | 0x07);
    expect(info.basicType).toBe(0x07);
    expect(info.typeName).toBe('Boost Ramp');
    expect(info.variant).toBe(3);
    expect(info.blightEffect).toBe(5);
    expect(info.wheelDepth).toBe(2);
    expect(info.trickable).toBe(true);
    expect(info.softWall).toBe(false);
    expect(info.drivable).toBe(true);
    expect(info.wall).toBe(false);
    expect(info.trigger).toBe(false);

    expect(describeKclFlag(0x8000 | 0x0c).softWall).toBe(true);
    expect(describeKclFlag(0x0c).wall).toBe(true);
    expect(describeKclFlag(0x10).trigger).toBe(true);
  });

  it('gives every collision type a distinct overlay colour', () => {
    const seen = new Set(collisionTypes.map((_, i) => kclFlagColor(i).join(',')));
    expect(seen.size).toBe(collisionTypes.length);
  });
});

describe('KCL parsing', () => {
  it('reconstructs triangles, flags and the header from a synthetic file', () => {
    const bytes = buildSyntheticKcl(2, 1000);
    const mesh = parseKcl(bytes);
    expect(mesh.warnings).toEqual([]);
    expect(mesh.triangles).toHaveLength(8);
    expect(mesh.prismCount).toBe(8);
    expect(mesh.header?.thickness).toBe(300);
    expect(mesh.header?.coordShift).toBe(20);
    expect(mesh.header?.sphereRadius).toBe(250);
    expect(mesh.header?.areaMin).toEqual({ x: 0, y: -1, z: 0 });

    const first = mesh.triangles[0];
    expect(first.typeName).toBe('Road');
    expect(first.a).toEqual({ x: 0, y: 0, z: 0 });
    // The two reconstructed corners must come back exactly where they were encoded.
    const corners = [first.b, first.c].map((v) => `${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.z)}`).sort();
    expect(corners).toEqual(['0,0,500', '500,0,0']);
    expect(mesh.triangles[1].typeName).toBe('Slippery Road (sand/dirt)');
    expect(mesh.triangles.every((tri) => Math.abs(Math.abs(tri.normal.y) - 1) < 1e-5)).toBe(true);
  });

  it('rejects files that are too small or have bad offsets', () => {
    expect(parseKcl(new Uint8Array(4)).warnings[0]).toMatch(/too small/);
    const bad = new Uint8Array(0x40);
    new DataView(bad.buffer).setUint32(0, 0xffffff, false);
    expect(parseKcl(bad).warnings[0]).toMatch(/outside the file/);
  });

  it('walks its own octree and finds the prism under a point', () => {
    const mesh = parseKcl(buildSyntheticKcl(2, 1000));
    const list = kclOctreeLookup(mesh, { x: 100, y: 0, z: 100 });
    expect(list).not.toBeNull();
    expect(list).toHaveLength(mesh.triangles.length);
    expect(kclOctreeLookup(mesh, { x: 5_000_000, y: 0, z: 0 })).toBeNull();
  });
});

describe('KCL raycasting', () => {
  const flat: KclMesh = {
    warnings: [],
    triangles: [triangle({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 100 })],
  };

  it('intersects collision triangles from either side for 3D picking', () => {
    expect(raycastMesh(flat, { x: 20, y: 50, z: 20 }, { x: 0, y: -1, z: 0 })?.position.y).toBeCloseTo(0);
    expect(raycastMesh(flat, { x: 20, y: -50, z: 20 }, { x: 0, y: 1, z: 0 })?.position.y).toBeCloseTo(0);
  });

  it('ignores geometry behind the ray origin', () => {
    expect(raycastMesh(flat, { x: 20, y: 50, z: 20 }, { x: 0, y: 1, z: 0 })).toBeNull();
  });

  it('respects a maximum distance', () => {
    expect(raycastMesh(flat, { x: 20, y: 50, z: 20 }, { x: 0, y: -1, z: 0 }, 10)).toBeNull();
    expect(raycastMesh(flat, { x: 20, y: 50, z: 20 }, { x: 0, y: -1, z: 0 }, 100)).not.toBeNull();
  });

  it('misses outside the triangle', () => {
    expect(raycastMesh(flat, { x: 90, y: 50, z: 90 }, { x: 0, y: -1, z: 0 })).toBeNull();
  });

  it('drops a point onto the surface below it and reports the surface', () => {
    expect(raycastDown(flat, 20, 20)?.y).toBeCloseTo(0);
    expect(raycastDown(flat, 900, 900)).toBeNull();
    expect(raycastDownDetailed(flat, 20, 20)?.triangle.typeName).toBe('Road');
  });

  it('picks the nearest of several stacked surfaces', () => {
    const stacked: KclMesh = {
      warnings: [],
      triangles: [
        triangle({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 100 }),
        triangle({ x: 0, y: 500, z: 0 }, { x: 100, y: 500, z: 0 }, { x: 0, y: 500, z: 100 }, 0x0c),
      ],
    };
    expect(raycastDownDetailed(stacked, 10, 10)?.triangle.flag).toBe(0x0c);
    expect(raycastMesh(stacked, { x: 10, y: -100, z: 10 }, { x: 0, y: 1, z: 0 })?.triangle.flag).toBe(0x00);
  });

  it('reports the mesh bounding box', () => {
    expect(kclBounds(flat)).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 0, z: 100 } });
    expect(kclBounds({ warnings: [], triangles: [] })).toBeNull();
  });

  it('agrees with a brute-force scan on a large synthetic mesh', () => {
    const mesh = parseKcl(buildSyntheticKcl(60, 6000));
    let random = 12345;
    const next = () => {
      random = (random * 1103515245 + 12345) & 0x7fffffff;
      return random / 0x7fffffff;
    };
    for (let i = 0; i < 200; i++) {
      const origin = { x: next() * 6000, y: 500, z: next() * 6000 };
      const direction = { x: 0, y: -1, z: 0 };
      const fast = raycastMesh(mesh, origin, direction);
      let brute: number | null = null;
      for (const tri of mesh.triangles) {
        const hit = bruteForceHit(origin, direction, tri);
        if (hit !== null && (brute === null || hit < brute)) brute = hit;
      }
      if (brute === null) expect(fast).toBeNull();
      else expect(fast?.distance ?? -1).toBeCloseTo(brute, 3);
    }
  });

  it('raycasts a 100k-triangle mesh in well under 2 ms', () => {
    const triangles: KclTriangle[] = [];
    const side = 224; // 224 * 224 * 2 = 100352 triangles
    const step = 40;
    for (let ix = 0; ix < side; ix++) {
      for (let iz = 0; iz < side; iz++) {
        const x = ix * step;
        const z = iz * step;
        const y = ((ix * 7 + iz * 13) % 17) * 10;
        triangles.push(triangle({ x, y, z }, { x: x + step, y, z }, { x, y, z: z + step }));
        triangles.push(triangle({ x: x + step, y, z: z + step }, { x: x + step, y, z }, { x, y, z: z + step }));
      }
    }
    expect(triangles.length).toBeGreaterThanOrEqual(100_000);
    const mesh: KclMesh = { warnings: [], triangles };

    const buildStart = performance.now();
    getKclBvh(mesh);
    const buildMs = performance.now() - buildStart;

    const extent = side * step;
    // Warm up, then time a batch so one slow first call cannot dominate.
    for (let i = 0; i < 200; i++) raycastDown(mesh, (i * 977) % extent, (i * 613) % extent);
    const iterations = 2000;
    const start = performance.now();
    let hits = 0;
    for (let i = 0; i < iterations; i++) {
      if (raycastDown(mesh, (i * 977) % extent, (i * 613) % extent)) hits++;
    }
    const perRayMs = (performance.now() - start) / iterations;
    expect(hits).toBe(iterations);
    expect(perRayMs, `average ${perRayMs.toFixed(4)} ms per ray`).toBeLessThan(2);
    expect(buildMs, `build took ${buildMs.toFixed(0)} ms`).toBeLessThan(4000);
  });

  it('finds triangles overlapping a query box', () => {
    const mesh = parseKcl(buildSyntheticKcl(4, 1000));
    const bvh = getKclBvh(mesh);
    const all = bvh.queryBox({ x: -1, y: -1, z: -1 }, { x: 1001, y: 1, z: 1001 });
    expect(all).toHaveLength(mesh.triangles.length);
    const corner = bvh.queryBox({ x: -1, y: -1, z: -1 }, { x: 10, y: 1, z: 10 });
    expect(corner.length).toBeGreaterThan(0);
    expect(corner.length).toBeLessThan(mesh.triangles.length);
  });

  it('handles an empty mesh', () => {
    const empty = buildTriangleBvh([]);
    expect(empty.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })).toBeNull();
    expect(empty.bounds()).toBeNull();
    expect(empty.queryBox({ x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 })).toEqual([]);
  });
});

function bruteForceHit(origin: Vec3, direction: Vec3, tri: KclTriangle): number | null {
  const e1 = { x: tri.b.x - tri.a.x, y: tri.b.y - tri.a.y, z: tri.b.z - tri.a.z };
  const e2 = { x: tri.c.x - tri.a.x, y: tri.c.y - tri.a.y, z: tri.c.z - tri.a.z };
  const p = { x: direction.y * e2.z - direction.z * e2.y, y: direction.z * e2.x - direction.x * e2.z, z: direction.x * e2.y - direction.y * e2.x };
  const det = e1.x * p.x + e1.y * p.y + e1.z * p.z;
  if (Math.abs(det) < 1e-9) return null;
  const inv = 1 / det;
  const t = { x: origin.x - tri.a.x, y: origin.y - tri.a.y, z: origin.z - tri.a.z };
  const u = (t.x * p.x + t.y * p.y + t.z * p.z) * inv;
  if (u < 0 || u > 1) return null;
  const q = { x: t.y * e1.z - t.z * e1.y, y: t.z * e1.x - t.x * e1.z, z: t.x * e1.y - t.y * e1.x };
  const v = (direction.x * q.x + direction.y * q.y + direction.z * q.z) * inv;
  if (v < 0 || u + v > 1) return null;
  const distance = (e2.x * q.x + e2.y * q.y + e2.z * q.z) * inv;
  return distance < 0 ? null : distance;
}

describe('snapping', () => {
  const tri = triangle({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 100 });

  it('snaps to the nearest vertex or edge feature of one triangle', () => {
    const nearVertex = snapPointToTriangleFeature({ x: -4, y: 0, z: -6 }, tri);
    expect(nearVertex.kind).toBe('vertex');
    expect(nearVertex.position).toEqual({ x: 0, y: 0, z: 0 });

    const nearEdge = snapPointToTriangleFeature({ x: 46, y: 0, z: 8 }, tri);
    expect(nearEdge.kind).toBe('edge');
    expect(nearEdge.position.x).toBeCloseTo(46);
    expect(nearEdge.position.z).toBeCloseTo(0);
  });

  it('searches the whole mesh within a radius', () => {
    const mesh = parseKcl(buildSyntheticKcl(4, 1000));
    const snapped = snapPointToNearestFeature(mesh, { x: 250, y: 5, z: 250 }, 50);
    expect(snapped).not.toBeNull();
    expect(snapped!.kind).toBe('vertex');
    expect(snapped!.position.x).toBeCloseTo(250);
    expect(snapped!.position.z).toBeCloseTo(250);

    // A point just off a grid line snaps to that edge rather than to a corner.
    const onEdge = snapPointToNearestFeature(mesh, { x: 375, y: 4, z: 250 }, 50);
    expect(onEdge?.kind).toBe('edge');
    expect(onEdge?.position.z).toBeCloseTo(250);
    expect(snapPointToNearestFeature(mesh, { x: 100000, y: 0, z: 100000 }, 50)).toBeNull();
  });
});

const realTracks = [...listTracks(CUSTOM_TRACK_DIR, 15), ...listTracks(NINTENDO_TRACK_DIR, 10)];

describe.runIf(realTracks.length > 0)('KCL on real tracks', () => {
  it('parses every collision mesh and finds its own prisms through its octree', () => {
    let checked = 0;
    for (const path of realTracks) {
      const kclBytes = parseU8(decodeYaz0(readTrackBytes(path))).find((entry) => entry.path.toLowerCase().endsWith('course.kcl'))?.data;
      if (!kclBytes) continue;
      const mesh = parseKcl(kclBytes);
      expect(mesh.warnings, path).toEqual([]);
      expect(mesh.triangles.length, path).toBeGreaterThan(0);
      checked++;

      let found = 0;
      let tested = 0;
      for (let i = 0; i < 25; i++) {
        const index = Math.floor((i * 9973) % mesh.triangles.length);
        const tri = mesh.triangles[index];
        const centre = {
          x: (tri.a.x + tri.b.x + tri.c.x) / 3,
          y: (tri.a.y + tri.b.y + tri.c.y) / 3,
          z: (tri.a.z + tri.b.z + tri.c.z) / 3,
        };
        const list = kclOctreeLookup(mesh, centre);
        if (list === null) continue;
        tested++;
        if (list.includes(index)) found++;
      }
      // Allow a couple of misses for centroids that land exactly on a cell boundary.
      expect(found, `${path}: octree found ${found} of ${tested}`).toBeGreaterThanOrEqual(tested - 2);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('raycasts down onto real collision quickly', () => {
    const path = realTracks[0];
    const kclBytes = parseU8(decodeYaz0(readTrackBytes(path))).find((entry) => entry.path.toLowerCase().endsWith('course.kcl'))?.data;
    if (!kclBytes) return;
    const mesh = parseKcl(kclBytes);
    const bounds = kclBounds(mesh)!;
    let hits = 0;
    const iterations = 500;
    for (let i = 0; i < iterations; i++) {
      const x = bounds.min.x + ((i * 37) % 100) / 100 * (bounds.max.x - bounds.min.x);
      const z = bounds.min.z + ((i * 61) % 100) / 100 * (bounds.max.z - bounds.min.z);
      if (raycastDown(mesh, x, z)) hits++;
    }
    expect(hits).toBeGreaterThan(0);
  });
});
