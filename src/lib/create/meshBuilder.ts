/**
 * Accumulators for generated render meshes and collision triangles.
 *
 * Winding convention (for both): a triangle `(a, b, c)` faces the side its normal
 * `(b - a) × (c - a)` points to, counter-clockwise seen from that side. Drivable surfaces face up.
 */
import type { GeneratedCollision, GeneratedMesh } from './types';
import type { MeshLight } from './lighting';

/** Append-only typed array that doubles when full. */
class Grow<T extends Float32Array | Uint32Array | Uint8Array | Uint16Array> {
  data: T;
  length = 0;
  private readonly make: (n: number) => T;

  constructor(make: (n: number) => T, initial = 256) {
    this.make = make;
    this.data = make(initial);
  }

  private ensure(extra: number): void {
    const need = this.length + extra;
    if (need <= this.data.length) return;
    let cap = this.data.length * 2;
    while (cap < need) cap *= 2;
    const next = this.make(cap);
    (next as Float32Array).set(this.data.subarray(0, this.length) as Float32Array);
    this.data = next;
  }

  push1(a: number): void {
    this.ensure(1);
    this.data[this.length++] = a;
  }

  push2(a: number, b: number): void {
    this.ensure(2);
    const d = this.data;
    const l = this.length;
    d[l] = a;
    d[l + 1] = b;
    this.length += 2;
  }

  push3(a: number, b: number, c: number): void {
    this.ensure(3);
    const d = this.data;
    const l = this.length;
    d[l] = a;
    d[l + 1] = b;
    d[l + 2] = c;
    this.length += 3;
  }

  push4(a: number, b: number, c: number, e: number): void {
    this.ensure(4);
    const d = this.data;
    const l = this.length;
    d[l] = a;
    d[l + 1] = b;
    d[l + 2] = c;
    d[l + 3] = e;
    this.length += 4;
  }

  push6(a: number, b: number, c: number, e: number, f: number, g: number): void {
    this.ensure(6);
    const d = this.data;
    const l = this.length;
    d[l] = a;
    d[l + 1] = b;
    d[l + 2] = c;
    d[l + 3] = e;
    d[l + 4] = f;
    d[l + 5] = g;
    this.length += 6;
  }

  pushAll(src: T, count: number): void {
    this.ensure(count);
    (this.data as Float32Array).set(src.subarray(0, count) as Float32Array, this.length);
    this.length += count;
  }
}

interface SurfaceBuffer {
  positions: Grow<Float32Array>;
  normals: Grow<Float32Array>;
  uvs: Grow<Float32Array>;
  colors: Grow<Uint8Array>;
  indices: Grow<Uint32Array>;
}

export function sanitizeName(text: string): string {
  return text.replace(/[^A-Za-z0-9_]/g, '_');
}

export class MeshBuilder {
  private readonly buffers = new Map<string, SurfaceBuffer>();

  constructor(
    readonly chunk: string,
    private readonly namePrefix: string,
    /** Baked world light applied to the vertex colours of every mesh at `build()`. */
    private readonly light: MeshLight | null = null,
  ) {}

  private buffer(surfaceId: string): SurfaceBuffer {
    let buf = this.buffers.get(surfaceId);
    if (!buf) {
      buf = {
        positions: new Grow((n) => new Float32Array(n), 768),
        normals: new Grow((n) => new Float32Array(n), 768),
        uvs: new Grow((n) => new Float32Array(n), 512),
        colors: new Grow((n) => new Uint8Array(n), 1024),
        indices: new Grow((n) => new Uint32Array(n), 1536),
      };
      this.buffers.set(surfaceId, buf);
    }
    return buf;
  }

  /** Returns the vertex index inside the surface's buffer. `shade` is a grey level 0..255. */
  vertex(
    surfaceId: string,
    px: number, py: number, pz: number,
    nx: number, ny: number, nz: number,
    u: number, v: number,
    shade = 255,
  ): number {
    const b = this.buffer(surfaceId);
    const index = b.positions.length / 3;
    b.positions.push3(px, py, pz);
    b.normals.push3(nx, ny, nz);
    b.uvs.push2(u, v);
    b.colors.push4(shade, shade, shade, 255);
    return index;
  }

  triangle(surfaceId: string, a: number, b: number, c: number): void {
    this.buffer(surfaceId).indices.push3(a, b, c);
  }

  /** Quad from corners `a b` (one edge) and `c d` (the opposite edge, same order): triangles (a,b,c) and (b,d,c). */
  quad(surfaceId: string, a: number, b: number, c: number, d: number): void {
    this.buffer(surfaceId).indices.push6(a, b, c, b, d, c);
  }

  /** Position of a vertex already added to the surface buffer. */
  position(surfaceId: string, index: number): [number, number, number] {
    const p = this.buffer(surfaceId).positions.data;
    return [p[index * 3], p[index * 3 + 1], p[index * 3 + 2]];
  }

  /** Adds the triangle, flipping its winding when needed so it faces the direction (nx, ny, nz). */
  facingTriangle(surfaceId: string, a: number, b: number, c: number, nx: number, ny: number, nz: number): void {
    const buf = this.buffer(surfaceId);
    const p = buf.positions.data;
    const ux = p[b * 3] - p[a * 3];
    const uy = p[b * 3 + 1] - p[a * 3 + 1];
    const uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3];
    const vy = p[c * 3 + 1] - p[a * 3 + 1];
    const vz = p[c * 3 + 2] - p[a * 3 + 2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    if (cx * nx + cy * ny + cz * nz >= 0) buf.indices.push3(a, b, c);
    else buf.indices.push3(a, c, b);
  }

  /** Quad as in quad(), each triangle wound to face (nx, ny, nz). */
  facingQuad(surfaceId: string, a: number, b: number, c: number, d: number, nx: number, ny: number, nz: number): void {
    this.facingTriangle(surfaceId, a, b, c, nx, ny, nz);
    this.facingTriangle(surfaceId, b, d, c, nx, ny, nz);
  }

  get isEmpty(): boolean {
    for (const b of this.buffers.values()) if (b.indices.length > 0) return false;
    return true;
  }

  build(): GeneratedMesh[] {
    const out: GeneratedMesh[] = [];
    for (const [surfaceId, b] of this.buffers) {
      if (b.indices.length === 0) continue;
      // Compact: drop vertices no triangle references (strips emit generously).
      const vertexCount = b.positions.length / 3;
      const idx = b.indices.data;
      const used = new Int32Array(vertexCount).fill(-1);
      let count = 0;
      for (let i = 0; i < b.indices.length; i++) if (used[idx[i]] < 0) used[idx[i]] = count++;
      const positions = new Float32Array(count * 3);
      const normals = new Float32Array(count * 3);
      const uvs = new Float32Array(count * 2);
      const colors = new Uint8Array(count * 4);
      const sp = b.positions.data;
      const sn = b.normals.data;
      const su = b.uvs.data;
      const sc = b.colors.data;
      if (count === vertexCount) {
        positions.set(sp.subarray(0, count * 3));
        normals.set(sn.subarray(0, count * 3));
        uvs.set(su.subarray(0, count * 2));
        colors.set(sc.subarray(0, count * 4));
      } else {
        for (let i = 0; i < vertexCount; i++) {
          const j = used[i];
          if (j < 0) continue;
          positions[j * 3] = sp[i * 3];
          positions[j * 3 + 1] = sp[i * 3 + 1];
          positions[j * 3 + 2] = sp[i * 3 + 2];
          normals[j * 3] = sn[i * 3];
          normals[j * 3 + 1] = sn[i * 3 + 1];
          normals[j * 3 + 2] = sn[i * 3 + 2];
          uvs[j * 2] = su[i * 2];
          uvs[j * 2 + 1] = su[i * 2 + 1];
          colors[j * 4] = sc[i * 4];
          colors[j * 4 + 1] = sc[i * 4 + 1];
          colors[j * 4 + 2] = sc[i * 4 + 2];
          colors[j * 4 + 3] = sc[i * 4 + 3];
        }
      }
      this.light?.bake(surfaceId, normals, colors, count);
      const indices = new Uint32Array(b.indices.length);
      for (let i = 0; i < indices.length; i++) indices[i] = used[idx[i]];
      out.push({
        name: `${this.namePrefix}_${sanitizeName(surfaceId)}`,
        surfaceId,
        positions,
        normals,
        uvs,
        colors,
        indices,
        chunk: this.chunk,
      });
    }
    return out;
  }
}

const MIN_COLLISION_AREA2 = 1e-2; // squared cross-product length; filters slivers KCL builders choke on

export class CollisionBuilder {
  private readonly pos = new Grow((n) => new Float32Array(n), 3072);
  private readonly flg = new Grow((n) => new Uint16Array(n), 512);

  get triangleCount(): number {
    return this.flg.length;
  }

  /** Adds the triangle exactly as given. Degenerate triangles are dropped. */
  triangle(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    flag: number,
  ): void {
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < MIN_COLLISION_AREA2) return;
    this.pos.push6(ax, ay, az, bx, by, bz);
    this.pos.push3(cx, cy, cz);
    this.flg.push1(flag);
  }

  /** Adds the triangle, flipping the winding if needed so its normal points upward (+Y). */
  triangleUp(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    flag: number,
  ): void {
    const y = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (y >= 0) this.triangle(ax, ay, az, bx, by, bz, cx, cy, cz, flag);
    else this.triangle(ax, ay, az, cx, cy, cz, bx, by, bz, flag);
  }

  /** Adds the triangle, flipping the winding if needed so its normal points downward (-Y). */
  triangleDown(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    flag: number,
  ): void {
    const y = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (y <= 0) this.triangle(ax, ay, az, bx, by, bz, cx, cy, cz, flag);
    else this.triangle(ax, ay, az, cx, cy, cz, bx, by, bz, flag);
  }

  /** Adds the triangle wound so its normal faces (nx, ny, nz). */
  triangleFacing(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
    flag: number,
  ): void {
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const dotn = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    if (dotn >= 0) this.triangle(ax, ay, az, bx, by, bz, cx, cy, cz, flag);
    else this.triangle(ax, ay, az, cx, cy, cz, bx, by, bz, flag);
  }

  /** Appends another builder's triangles. */
  append(other: CollisionBuilder): void {
    this.pos.pushAll(other.pos.data, other.pos.length);
    this.flg.pushAll(other.flg.data, other.flg.length);
  }

  build(): GeneratedCollision {
    const n = this.flg.length;
    const indices = new Uint32Array(n * 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    return {
      positions: this.pos.data.slice(0, n * 9),
      indices,
      flags: this.flg.data.slice(0, n),
    };
  }

  /** Raw access for readers that want to scan without building (positions are 9 floats per triangle). */
  get rawPositions(): Float32Array {
    return this.pos.data.subarray(0, this.flg.length * 9);
  }
}

export interface BoundsAccumulator {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export function emptyBounds(): BoundsAccumulator {
  return {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
}

export function growBounds(b: BoundsAccumulator, x: number, y: number, z: number): void {
  if (x < b.min.x) b.min.x = x;
  if (y < b.min.y) b.min.y = y;
  if (z < b.min.z) b.min.z = z;
  if (x > b.max.x) b.max.x = x;
  if (y > b.max.y) b.max.y = y;
  if (z > b.max.z) b.max.z = z;
}
