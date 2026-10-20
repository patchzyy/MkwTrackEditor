import { describe, expect, it } from 'vitest';
import { kclOctreeLookup, parseKcl } from '../../kcl';
import type { GeneratedCollision } from '../types';
import { buildKcl } from './kclWriter';
import { KCL_BOOST_PANEL, KCL_ROAD, KCL_WALL, kclFlag } from './kclFlags';

/** Deterministic PRNG so failures are reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function collisionFrom(triangles: Array<[number[], number[], number[], number]>): GeneratedCollision {
  const positions = new Float32Array(triangles.length * 9);
  const indices = new Uint32Array(triangles.length * 3);
  const flags = new Uint16Array(triangles.length);
  triangles.forEach(([a, b, c, flag], i) => {
    positions.set([...a, ...b, ...c], i * 9);
    indices.set([i * 3, i * 3 + 1, i * 3 + 2], i * 3);
    flags[i] = flag;
  });
  return { positions, indices, flags };
}

/** Flat grid at height `y`, wound so the face normal points up. */
function flatGrid(nx: number, nz: number, cell: number, y: number, flag: number, x0 = 0, z0 = 0): GeneratedCollision {
  const tris: Array<[number[], number[], number[], number]> = [];
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      const px = x0 + x * cell, pz = z0 + z * cell;
      // (b - a) x (c - a) = +Y for a=(0,0) b=(0,cell) c=(cell,0) in (x,z)
      tris.push([[px, y, pz], [px, y, pz + cell], [px + cell, y, pz], flag]);
      tris.push([[px + cell, y, pz], [px, y, pz + cell], [px + cell, y, pz + cell], flag]);
    }
  }
  return collisionFrom(tris);
}

function key(a: number[], b: number[], c: number[]): string {
  const r = (v: number[]) => v.map((x) => Math.round(x * 20) / 20).join(',');
  return `${r(a)}|${r(b)}|${r(c)}`;
}

describe('buildKcl', () => {
  it('writes a file parseKcl reads back as the same triangles and flags', () => {
    const collision = flatGrid(10, 6, 200, 50, kclFlag(KCL_ROAD, 2, { blight: 3, wheelDepth: 1, trickable: true }));
    const kcl = buildKcl(collision);
    const mesh = parseKcl(kcl);
    expect(mesh.warnings).toEqual([]);
    expect(mesh.triangles).toHaveLength(120);
    expect(mesh.prismCount).toBe(120);
    mesh.triangles.forEach((triangle, i) => {
      const v = (n: number) => [collision.positions[collision.indices[i * 3 + n] * 3], collision.positions[collision.indices[i * 3 + n] * 3 + 1], collision.positions[collision.indices[i * 3 + n] * 3 + 2]];
      expect(key([triangle.a.x, triangle.a.y, triangle.a.z], [triangle.b.x, triangle.b.y, triangle.b.z], [triangle.c.x, triangle.c.y, triangle.c.z])).toBe(key(v(0), v(1), v(2)));
      expect(triangle.flag).toBe(collision.flags[i]);
      expect(triangle.normal.y).toBeGreaterThan(0.999);
    });
  });

  it('uses the retail header conventions', () => {
    const kcl = buildKcl(flatGrid(4, 4, 500, 0, KCL_ROAD));
    const view = new DataView(kcl.buffer, kcl.byteOffset, kcl.byteLength);
    const positionOffset = view.getUint32(0), normalOffset = view.getUint32(4), prismOffset = view.getUint32(8), blockOffset = view.getUint32(12);
    expect(positionOffset).toBe(0x3c);
    expect(normalOffset).toBeGreaterThan(positionOffset);
    expect((prismOffset + 16 - normalOffset) % 12).toBe(0); // normals run up to the first prism
    expect((blockOffset - prismOffset) % 16).toBe(0);
    expect(blockOffset).toBeLessThan(kcl.length);
    expect(view.getFloat32(0x10)).toBe(300);
    expect(view.getFloat32(0x38)).toBe(250);
    // Masks are ~(range - 1) with the range a power of two; the cube edge divides every range.
    const shift = view.getUint32(0x2c);
    for (const at of [0x20, 0x24, 0x28]) {
      const range = (~view.getUint32(at) >>> 0) + 1;
      expect(Math.log2(range) % 1).toBe(0);
      expect(range).toBeGreaterThanOrEqual(1 << shift);
    }
    expect(shift).toBeGreaterThanOrEqual(9);
    expect(kcl.length % 4).toBe(0);
  });

  it('drops degenerate triangles and keeps the rest in order', () => {
    const collision = collisionFrom([
      [[0, 0, 0], [0, 0, 100], [100, 0, 0], KCL_ROAD],
      [[10, 0, 10], [10, 0, 10], [50, 0, 10], KCL_ROAD], // zero area
      [[0, 0, 0], [100, 0, 0], [200, 0, 0], KCL_ROAD], // collinear
      [[0, 0, 0], [0, 0, 100], [100, 0, 100], kclFlag(KCL_WALL)],
    ]);
    const mesh = parseKcl(buildKcl(collision));
    expect(mesh.triangles.map((t) => t.flag)).toEqual([KCL_ROAD, KCL_WALL]);
  });

  it('writes an empty but valid file for no triangles', () => {
    const kcl = buildKcl({ positions: new Float32Array(0), indices: new Uint32Array(0), flags: new Uint16Array(0) });
    const mesh = parseKcl(kcl);
    expect(mesh.triangles).toHaveLength(0);
    expect(kclOctreeLookup(mesh, { x: 0, y: 0, z: 0 }) ?? []).toEqual([]);
  });

  it('indexes every prism a sphere query could reach: random soup, vertical and sloped faces', () => {
    const random = rng(7);
    const triangles: Array<[number[], number[], number[], number]> = [];
    for (let i = 0; i < 1500; i++) {
      const cx = (random() - 0.5) * 40000, cy = (random() - 0.5) * 6000, cz = (random() - 0.5) * 40000;
      const size = 80 + random() * 900;
      const p = () => [cx + (random() - 0.5) * size, cy + (random() - 0.5) * size, cz + (random() - 0.5) * size];
      triangles.push([p(), p(), p(), kclFlag(Math.floor(random() * 32), Math.floor(random() * 8))]);
    }
    const collision = collisionFrom(triangles);
    const kcl = buildKcl(collision);
    const mesh = parseKcl(kcl);
    expect(mesh.triangles.length).toBeGreaterThan(1450);

    // Every parsed prism reproduces the input triangle it came from (the first vertex is stored
    // exactly, the other two are rebuilt by the same arithmetic the game uses).
    const inputByOrigin = new Map<string, number>();
    triangles.forEach(([a], i) => inputByOrigin.set(a.map((x) => Math.fround(x)).join(','), i));
    for (const triangle of mesh.triangles) {
      const source = inputByOrigin.get([triangle.a.x, triangle.a.y, triangle.a.z].join(','));
      expect(source, `triangle starting at ${triangle.a.x},${triangle.a.y},${triangle.a.z}`).toBeDefined();
      const [, b, c, flag] = triangles[source!];
      expect(triangle.flag).toBe(flag);
      expect(Math.hypot(triangle.b.x - b[0], triangle.b.y - b[1], triangle.b.z - b[2])).toBeLessThan(0.5);
      expect(Math.hypot(triangle.c.x - c[0], triangle.c.y - c[1], triangle.c.z - c[2])).toBeLessThan(0.5);
    }

    // The octree lists every prism within sphere range of a point on or just behind its face.
    let checked = 0;
    for (let t = 0; t < mesh.triangles.length; t += 3) {
      const triangle = mesh.triangles[t];
      for (let s = 0; s < 6; s++) {
        let u = random(), v = random();
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const onFace = {
          x: triangle.a.x + (triangle.b.x - triangle.a.x) * u + (triangle.c.x - triangle.a.x) * v,
          y: triangle.a.y + (triangle.b.y - triangle.a.y) * u + (triangle.c.y - triangle.a.y) * v,
          z: triangle.a.z + (triangle.b.z - triangle.a.z) * u + (triangle.c.z - triangle.a.z) * v,
        };
        const depth = random() * 290; // behind the face
        const reach = random() * 235; // sphere reach
        const theta = random() * Math.PI * 2, phi = Math.acos(2 * random() - 1);
        const p = {
          x: onFace.x - triangle.normal.x * depth + reach * Math.sin(phi) * Math.cos(theta),
          y: onFace.y - triangle.normal.y * depth + reach * Math.cos(phi),
          z: onFace.z - triangle.normal.z * depth + reach * Math.sin(phi) * Math.sin(theta),
        };
        const found = kclOctreeLookup(mesh, p);
        expect(found, `inside the indexed volume at ${JSON.stringify(p)}`).not.toBeNull();
        expect(found!.includes(t), `triangle ${t} listed at ${JSON.stringify(p)}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it('includes every triangle whose bounding box holds the query point, for ordinary-sized triangles', () => {
    const random = rng(99);
    const triangles: Array<[number[], number[], number[], number]> = [];
    for (let i = 0; i < 800; i++) {
      const cx = (random() - 0.5) * 30000, cy = random() * 2000, cz = (random() - 0.5) * 30000;
      const size = 100 + random() * 300;
      const p = () => [cx + (random() - 0.5) * size, cy + (random() - 0.5) * size * 0.3, cz + (random() - 0.5) * size];
      triangles.push([p(), p(), p(), KCL_ROAD]);
    }
    const mesh = parseKcl(buildKcl(collisionFrom(triangles)));
    const boxes = mesh.triangles.map((t) => ({
      min: { x: Math.min(t.a.x, t.b.x, t.c.x), y: Math.min(t.a.y, t.b.y, t.c.y), z: Math.min(t.a.z, t.b.z, t.c.z) },
      max: { x: Math.max(t.a.x, t.b.x, t.c.x), y: Math.max(t.a.y, t.b.y, t.c.y), z: Math.max(t.a.z, t.b.z, t.c.z) },
    }));
    let hits = 0;
    for (let q = 0; q < 3000; q++) {
      const index = Math.floor(random() * boxes.length);
      const box = boxes[index];
      const p = {
        x: box.min.x + random() * (box.max.x - box.min.x),
        y: box.min.y + random() * (box.max.y - box.min.y),
        z: box.min.z + random() * (box.max.z - box.min.z),
      };
      const found = new Set(kclOctreeLookup(mesh, p) ?? []);
      boxes.forEach((other, j) => {
        if (p.x >= other.min.x && p.x <= other.max.x && p.y >= other.min.y && p.y <= other.max.y && p.z >= other.min.z && p.z <= other.max.z) {
          expect(found.has(j), `triangle ${j} (bounding box holds the point)`).toBe(true);
          hits++;
        }
      });
    }
    expect(hits).toBeGreaterThanOrEqual(3000);
  });

  it('shares leaf lists and keeps lists short on a large flat mesh', () => {
    const collision = flatGrid(24, 24, 400, 0, KCL_ROAD, -4800, -4800); // 1152 triangles over 9600 x 9600
    const kcl = buildKcl(collision, { maxTrianglesPerLeaf: 12 });
    const mesh = parseKcl(kcl);
    expect(mesh.triangles).toHaveLength(1152);
    let longest = 0;
    for (let x = -4700; x < 4700; x += 300) {
      for (let z = -4700; z < 4700; z += 300) {
        const found = kclOctreeLookup(mesh, { x, y: 0, z })!;
        longest = Math.max(longest, found.length);
        expect(found.length).toBeGreaterThan(0);
      }
    }
    // The grown cubes (sphere radius) set a floor on list length; it must stay in retail's range.
    expect(longest).toBeLessThan(60);
    expect(kcl.length).toBeLessThan(1152 * 120);
  });

  it('snaps normals when a curved mesh would need more than 65535 distinct ones', () => {
    // A ring of 9000 sloped triangles, each with its own tilt: ~36000 distinct normals is fine,
    // 24000 triangles is not.
    const random = rng(5);
    const triangles: Array<[number[], number[], number[], number]> = [];
    for (let i = 0; i < 24000; i++) {
      const x = (i % 200) * 60, z = Math.floor(i / 200) * 60;
      const tilt = () => (random() - 0.5) * 30;
      triangles.push([[x, tilt(), z], [x, tilt(), z + 50], [x + 50, tilt(), z], KCL_ROAD]);
    }
    const kcl = buildKcl(collisionFrom(triangles));
    const mesh = parseKcl(kcl);
    expect(mesh.triangles.length).toBeGreaterThan(23000);
    for (const triangle of mesh.triangles.slice(0, 200)) expect(triangle.normal.y).toBeGreaterThan(0.5);
  });

  it('refuses a mesh a KCL cannot index', () => {
    const triangles: Array<[number[], number[], number[], number]> = [];
    for (let i = 0; i < 66000; i++) triangles.push([[i * 3, 0, 0], [i * 3, 0, 2], [i * 3 + 2, 0, 0], KCL_ROAD]);
    expect(() => buildKcl(collisionFrom(triangles))).toThrow(/at most/);
  });

  it('builds a boost panel strip with the boost flag', () => {
    const flag = kclFlag(KCL_BOOST_PANEL, 0);
    const mesh = parseKcl(buildKcl(collisionFrom([[[0, 0, 0], [0, 0, 100], [100, 0, 0], flag]])));
    expect(mesh.triangles[0].typeName).toBe('Boost Panel');
  });
});
