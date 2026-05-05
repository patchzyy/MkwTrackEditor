export enum PixelFormat {
  I4,
  I8,
  IA4,
  IA8,
  RGB565,
  RGB5A3,
  RGBA8,
  CMPR,
  C4,
  C8,
  C14X2,
}

export enum PaletteFormat {
  IA8,
  RGB565,
  RGB5A3,
}

export function yaz0dec(src: Uint8Array): Uint8Array {
  if (ascii(src, 0, 4) !== 'Yaz0') throw new Error('Not a Yaz0 buffer');
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const dst = new Uint8Array(view.getUint32(4, false));
  let srcOffs = 0x10;
  let dstOffs = 0;
  while (dstOffs < dst.length) {
    const command = src[srcOffs++];
    for (let bit = 7; bit >= 0 && dstOffs < dst.length; bit--) {
      if (command & (1 << bit)) {
        dst[dstOffs++] = src[srcOffs++];
      } else {
        const b0 = src[srcOffs++];
        const b1 = src[srcOffs++];
        const back = (((b0 & 0x0f) << 8) | b1) + 1;
        let count = b0 >> 4;
        count = count === 0 ? src[srcOffs++] + 0x12 : count + 2;
        for (let i = 0; i < count && dstOffs < dst.length; i++) dst[dstOffs] = dst[dstOffs++ - back];
      }
    }
  }
  return dst;
}

export function decode_texture(format: PixelFormat, paletteFormat: PaletteFormat | undefined, src: Uint8Array, palette: Uint8Array | undefined, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const setPixel = (x: number, y: number, r: number, g: number, b: number, a = 0xff) => {
    if (x >= width || y >= height) return;
    const dst = (y * width + x) * 4;
    out[dst] = r;
    out[dst + 1] = g;
    out[dst + 2] = b;
    out[dst + 3] = a;
  };

  if (format === PixelFormat.I4) decodeBlocks(width, height, 8, 8, (x, y, i) => setPixel(x, y, expand4(nibble(src, i)), expand4(nibble(src, i)), expand4(nibble(src, i))), 32);
  else if (format === PixelFormat.I8) decodeBlocks(width, height, 8, 4, (x, y, i) => setPixel(x, y, src[i], src[i], src[i]), 32);
  else if (format === PixelFormat.IA4) decodeBlocks(width, height, 8, 4, (x, y, i) => setPixel(x, y, expand4(src[i] & 0x0f), expand4(src[i] & 0x0f), expand4(src[i] & 0x0f), expand4(src[i] >>> 4)), 32);
  else if (format === PixelFormat.IA8) decodeBlocks(width, height, 4, 4, (x, y, i) => setPixel(x, y, src[i + 1], src[i + 1], src[i + 1], src[i]), 32);
  else if (format === PixelFormat.RGB565) decodeBlocks(width, height, 4, 4, (x, y, i) => setPixel565(setPixel, x, y, u16(src, i)), 32);
  else if (format === PixelFormat.RGB5A3) decodeBlocks(width, height, 4, 4, (x, y, i) => setPixel5A3(setPixel, x, y, u16(src, i)), 32);
  else if (format === PixelFormat.RGBA8) decodeRGBA8(width, height, src, setPixel);
  else if (format === PixelFormat.CMPR) decodeCMPR(width, height, src, setPixel);
  else if (format === PixelFormat.C4) decodePaletteBlocks(width, height, 8, 8, 32, (i) => nibble(src, i), paletteFormat, palette, setPixel);
  else if (format === PixelFormat.C8) decodePaletteBlocks(width, height, 8, 4, 32, (i) => src[i], paletteFormat, palette, setPixel);
  else if (format === PixelFormat.C14X2) decodePaletteBlocks(width, height, 4, 4, 32, (i) => u16(src, i) & 0x3fff, paletteFormat, palette, setPixel);
  else throw new Error(`Unsupported GX texture format ${format}`);
  return out;
}

type Plane = [number, number, number, number];

export class ConvexHull {
  private planes: Plane[] = [];

  public clear(): void {
    this.planes.length = 0;
  }

  public push_plane(a: number, b: number, c: number, d: number): void {
    const len = Math.hypot(a, b, c);
    if (len > 0) this.planes.push([a / len, b / len, c / len, d / len]);
  }

  public copy(): ConvexHull {
    const hull = new ConvexHull();
    hull.planes = this.planes.map((plane) => [...plane] as Plane);
    return hull;
  }

  public free(): void {
    this.clear();
  }

  public js_intersect_aabb(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number {
    let intersects = false;
    for (const [a, b, c, d] of this.planes) {
      const px = a >= 0 ? maxX : minX;
      const py = b >= 0 ? maxY : minY;
      const pz = c >= 0 ? maxZ : minZ;
      if (a * px + b * py + c * pz + d < 0) return 1;

      const nx = a >= 0 ? minX : maxX;
      const ny = b >= 0 ? minY : maxY;
      const nz = c >= 0 ? minZ : maxZ;
      if (a * nx + b * ny + c * nz + d < 0) intersects = true;
    }
    return intersects ? 2 : 0;
  }

  public js_contains_aabb(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    return this.js_intersect_aabb(minX, minY, minZ, maxX, maxY, maxZ) === 0;
  }

  public js_contains_sphere(x: number, y: number, z: number, radius: number): boolean {
    return this.planes.every(([a, b, c, d]) => a * x + b * y + c * z + d >= -radius);
  }

  public js_contains_point(v: Float32Array): boolean {
    const x = v[0];
    const y = v[1];
    const z = v[2];
    return this.planes.every(([a, b, c, d]) => a * x + b * y + c * z + d >= 0);
  }

  public js_transform(m: Float32Array): void {
    this.planes = this.planes.map((plane) => transformPlane(plane, m));
  }
}

function transformPlane([a, b, c, d]: Plane, m: Float32Array): Plane {
  const inv = invertMat4(m);
  if (!inv) return [a, b, c, d];
  const na = inv[0] * a + inv[1] * b + inv[2] * c + inv[3] * d;
  const nb = inv[4] * a + inv[5] * b + inv[6] * c + inv[7] * d;
  const nc = inv[8] * a + inv[9] * b + inv[10] * c + inv[11] * d;
  const nd = inv[12] * a + inv[13] * b + inv[14] * c + inv[15] * d;
  const len = Math.hypot(na, nb, nc);
  return len > 0 ? [na / len, nb / len, nc / len, nd / len] : [na, nb, nc, nd];
}

function invertMat4(a: Float32Array): number[] | null {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;

  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * det,
    (a02 * b10 - a01 * b11 - a03 * b09) * det,
    (a31 * b05 - a32 * b04 + a33 * b03) * det,
    (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det,
    (a00 * b11 - a02 * b08 + a03 * b07) * det,
    (a32 * b02 - a30 * b05 - a33 * b01) * det,
    (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det,
    (a01 * b08 - a00 * b10 - a03 * b06) * det,
    (a30 * b04 - a31 * b02 + a33 * b00) * det,
    (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det,
    (a00 * b09 - a01 * b07 + a02 * b06) * det,
    (a31 * b01 - a30 * b03 - a32 * b00) * det,
    (a20 * b03 - a21 * b01 + a22 * b00) * det,
  ];
}

export function glsl_compile(): never {
  throw new Error('WebGPU shader compilation is not available in the local noclip runtime.');
}

export default async function init() {
  return undefined;
}

function decodeBlocks(width: number, height: number, bw: number, bh: number, write: (x: number, y: number, srcOffset: number) => void, blockBytes: number) {
  let offset = 0;
  for (let by = 0; by < height; by += bh) {
    for (let bx = 0; bx < width; bx += bw) {
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const pixel = y * bw + x;
          write(bx + x, by + y, blockBytes === 32 && bw * bh === 64 ? offset * 2 + pixel : offset + pixel * (blockBytes / (bw * bh)));
        }
      }
      offset += blockBytes;
    }
  }
}

function decodeRGBA8(width: number, height: number, src: Uint8Array, setPixel: (x: number, y: number, r: number, g: number, b: number, a?: number) => void) {
  let offset = 0;
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4) {
      for (let i = 0; i < 16; i++) {
        const x = bx + (i & 3);
        const y = by + (i >> 2);
        const ar = offset + i * 2;
        const gb = offset + 32 + i * 2;
        setPixel(x, y, src[ar + 1], src[gb], src[gb + 1], src[ar]);
      }
      offset += 64;
    }
  }
}

function decodeCMPR(width: number, height: number, src: Uint8Array, setPixel: (x: number, y: number, r: number, g: number, b: number, a?: number) => void) {
  let offset = 0;
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          decodeDxt1Block(src, offset, bx + sx * 4, by + sy * 4, setPixel);
          offset += 8;
        }
      }
    }
  }
}

function decodeDxt1Block(src: Uint8Array, offset: number, bx: number, by: number, setPixel: (x: number, y: number, r: number, g: number, b: number, a?: number) => void) {
  const c0 = rgb565(u16(src, offset));
  const c1 = rgb565(u16(src, offset + 2));
  const colors = [c0, c1, [0, 0, 0, 0xff], [0, 0, 0, 0xff]];
  if (u16(src, offset) > u16(src, offset + 2)) {
    colors[2] = mix(c0, c1, 2, 1, 3);
    colors[3] = mix(c0, c1, 1, 2, 3);
  } else {
    colors[2] = mix(c0, c1, 1, 1, 2);
    colors[3] = [0, 0, 0, 0];
  }
  let bits = (src[offset + 4] << 24) | (src[offset + 5] << 16) | (src[offset + 6] << 8) | src[offset + 7];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const c = colors[(bits >>> 30) & 3];
      setPixel(bx + x, by + y, c[0], c[1], c[2], c[3]);
      bits <<= 2;
    }
  }
}

function decodePaletteBlocks(
  width: number,
  height: number,
  bw: number,
  bh: number,
  blockBytes: number,
  readIndex: (srcOffset: number) => number,
  paletteFormat: PaletteFormat | undefined,
  palette: Uint8Array | undefined,
  setPixel: (x: number, y: number, r: number, g: number, b: number, a?: number) => void,
) {
  let offset = 0;
  for (let by = 0; by < height; by += bh) {
    for (let bx = 0; bx < width; bx += bw) {
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const pixel = y * bw + x;
          const indexOffset = blockBytes === 32 && bw * bh === 64 ? offset * 2 + pixel : offset + pixel * (blockBytes / (bw * bh));
          const color = paletteColor(paletteFormat, palette, readIndex(indexOffset));
          setPixel(bx + x, by + y, color[0], color[1], color[2], color[3]);
        }
      }
      offset += blockBytes;
    }
  }
}

function paletteColor(format: PaletteFormat | undefined, palette: Uint8Array | undefined, index: number): number[] {
  if (!palette) return [0xff, 0xff, 0xff, 0xff];
  const value = u16(palette, index * 2);
  if (format === PaletteFormat.IA8) return [value & 0xff, value & 0xff, value & 0xff, value >>> 8];
  if (format === PaletteFormat.RGB565) return rgb565(value);
  return rgba5a3(value);
}

function setPixel565(setPixel: (x: number, y: number, r: number, g: number, b: number, a?: number) => void, x: number, y: number, value: number) {
  const c = rgb565(value);
  setPixel(x, y, c[0], c[1], c[2], c[3]);
}

function setPixel5A3(setPixel: (x: number, y: number, r: number, g: number, b: number, a?: number) => void, x: number, y: number, value: number) {
  const c = rgba5a3(value);
  setPixel(x, y, c[0], c[1], c[2], c[3]);
}

function rgb565(value: number): number[] {
  return [expand5(value >>> 11), expand6((value >>> 5) & 0x3f), expand5(value & 0x1f), 0xff];
}

function rgba5a3(value: number): number[] {
  if (value & 0x8000) return [expand5((value >>> 10) & 0x1f), expand5((value >>> 5) & 0x1f), expand5(value & 0x1f), 0xff];
  return [expand4((value >>> 8) & 0x0f), expand4((value >>> 4) & 0x0f), expand4(value & 0x0f), expand3((value >>> 12) & 0x07)];
}

function mix(a: number[], b: number[], wa: number, wb: number, div: number): number[] {
  return [Math.round((a[0] * wa + b[0] * wb) / div), Math.round((a[1] * wa + b[1] * wb) / div), Math.round((a[2] * wa + b[2] * wb) / div), 0xff];
}

function nibble(src: Uint8Array, index: number): number {
  const value = src[index >> 1];
  return index & 1 ? value & 0x0f : value >>> 4;
}

function u16(src: Uint8Array, offset: number): number {
  return (src[offset] << 8) | src[offset + 1];
}

function expand3(value: number): number {
  return (value << 5) | (value << 2) | (value >>> 1);
}

function expand4(value: number): number {
  return (value << 4) | value;
}

function expand5(value: number): number {
  return (value << 3) | (value >>> 2);
}

function expand6(value: number): number {
  return (value << 2) | (value >>> 4);
}

function ascii(src: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...src.slice(offset, offset + length));
}
