/**
 * GX (GameCube/Wii) texture encoders, written as the exact inverse of the decoder in
 * `src/noclipRustStub.ts`. Encoding lives here rather than next to the decoder because the
 * decoder is a drop-in stand-in for upstream noclip's Rust module and must stay in sync with it.
 *
 * Everything in this file is pure: raw RGBA8 buffers in, raw GX bytes out. No DOM, no canvas.
 */

export type Tex0FormatName = 'I4' | 'I8' | 'IA4' | 'IA8' | 'RGB565' | 'RGB5A3' | 'RGBA8' | 'CMPR';

/** GX `TexFormat` values (see vendor/noclip.website/src/gx/gx_enum.ts). */
const GX_FORMAT_VALUES: Record<Tex0FormatName, number> = {
  I4: 0x0,
  I8: 0x1,
  IA4: 0x2,
  IA8: 0x3,
  RGB565: 0x4,
  RGB5A3: 0x5,
  RGBA8: 0x6,
  CMPR: 0xe,
};

const GX_FORMAT_NAMES = new Map<number, Tex0FormatName>(
  (Object.keys(GX_FORMAT_VALUES) as Tex0FormatName[]).map((name) => [GX_FORMAT_VALUES[name], name]),
);

/** Block geometry per format, mirroring `texBlockInfo` in gx_texture.ts. */
const BLOCK_INFO: Record<Tex0FormatName, { blockWidth: number; blockHeight: number; blockBytes: number }> = {
  I4: { blockWidth: 8, blockHeight: 8, blockBytes: 32 },
  I8: { blockWidth: 8, blockHeight: 4, blockBytes: 32 },
  IA4: { blockWidth: 8, blockHeight: 4, blockBytes: 32 },
  IA8: { blockWidth: 4, blockHeight: 4, blockBytes: 32 },
  RGB565: { blockWidth: 4, blockHeight: 4, blockBytes: 32 },
  RGB5A3: { blockWidth: 4, blockHeight: 4, blockBytes: 32 },
  RGBA8: { blockWidth: 4, blockHeight: 4, blockBytes: 64 },
  CMPR: { blockWidth: 8, blockHeight: 8, blockBytes: 32 },
};

/**
 * RGB5A3 texels are either opaque RGB555 or translucent RGB4A3. Alpha only has three bits in the
 * translucent encoding, so its brightest step is 219; anything at or above this cutoff is stored
 * opaque (matching wimgt and friends) so that near-opaque art does not gain a visible fringe.
 */
const RGB5A3_OPAQUE_ALPHA = 0xe0;

/** Texels below this alpha become CMPR's punch-through transparent index. */
const CMPR_ALPHA_CUTOFF = 128;

export interface RgbaImage {
  width: number;
  height: number;
  /** 4 bytes per pixel, row-major, top-left origin. */
  pixels: Uint8Array;
}

/** GX TexFormat numeric value -> name. `null` for formats we cannot encode (C4/C8/C14X2, ...). */
export function tex0FormatName(gxFormat: number): Tex0FormatName | null {
  return GX_FORMAT_NAMES.get(gxFormat) ?? null;
}

export function tex0FormatValue(name: Tex0FormatName): number {
  return GX_FORMAT_VALUES[name];
}

/** Whether this editor can re-encode into the format. */
export function canEncodeTex0Format(gxFormat: number): boolean {
  return tex0FormatName(gxFormat) !== null;
}

function requireFormatName(gxFormat: number): Tex0FormatName {
  const name = tex0FormatName(gxFormat);
  if (name === null) throw new Error(`Cannot encode GX texture format ${gxFormat}`);
  return name;
}

function align(n: number, to: number): number {
  return Math.ceil(n / to) * to;
}

/** Bytes for one mip level. Agrees with gx_texture.calcTextureSize. */
export function calcTex0LevelSize(gxFormat: number, width: number, height: number): number {
  const info = BLOCK_INFO[requireFormatName(gxFormat)];
  const blocksX = Math.ceil(Math.max(1, width) / info.blockWidth);
  const blocksY = Math.ceil(Math.max(1, height) / info.blockHeight);
  return blocksX * blocksY * info.blockBytes;
}

/** Level dimensions for mip `level`; each level halves and never drops below 1. */
export function tex0LevelSize(width: number, height: number, level: number): { width: number; height: number } {
  const shift = Math.max(0, Math.floor(level));
  return {
    width: Math.max(1, Math.max(1, Math.floor(width)) >> shift),
    height: Math.max(1, Math.max(1, Math.floor(height)) >> shift),
  };
}

/** Total bytes for `mipCount` levels starting at width x height. */
export function calcTex0DataSize(gxFormat: number, width: number, height: number, mipCount: number): number {
  let total = 0;
  for (let level = 0; level < Math.max(1, mipCount); level++) {
    const size = tex0LevelSize(width, height, level);
    total += calcTex0LevelSize(gxFormat, size.width, size.height);
  }
  return total;
}

/** Largest power of two <= n, min 1. */
export function floorPowerOfTwo(n: number): number {
  if (!Number.isFinite(n) || n < 2) return 1;
  return 2 ** Math.floor(Math.log2(Math.floor(n)));
}

/** Nearest power of two, min 1. Ties round up so detail is preserved. */
export function nearestPowerOfTwo(n: number): number {
  if (!Number.isFinite(n) || n < 2) return 1;
  const low = floorPowerOfTwo(n);
  const high = low * 2;
  return n - low < high - n ? low : high;
}

/** How many mip levels a width x height texture can have, counting down to 1x1. */
export function maxMipCount(width: number, height: number): number {
  const largest = Math.max(1, Math.floor(Math.max(width, height)));
  return Math.floor(Math.log2(largest)) + 1;
}

//#region resampling

interface Tap {
  index: number;
  weight: number;
}

/**
 * Per-output-pixel source taps. Downscaling uses exact area coverage (a box filter) so that mip
 * levels average every source texel; upscaling falls back to bilinear, where a box filter would
 * degenerate into nearest-neighbour.
 */
function buildTaps(srcLength: number, dstLength: number): Tap[][] {
  const taps: Tap[][] = [];
  const scale = srcLength / dstLength;
  for (let i = 0; i < dstLength; i++) {
    if (dstLength < srcLength) {
      const start = i * scale;
      const end = (i + 1) * scale;
      const row: Tap[] = [];
      for (let s = Math.floor(start); s < Math.ceil(end); s++) {
        const weight = Math.min(end, s + 1) - Math.max(start, s);
        if (weight > 0) row.push({ index: Math.min(srcLength - 1, s), weight: weight / scale });
      }
      taps.push(row.length > 0 ? row : [{ index: Math.min(srcLength - 1, Math.floor(start)), weight: 1 }]);
    } else {
      const center = (i + 0.5) * scale - 0.5;
      const base = Math.floor(center);
      const frac = center - base;
      taps.push([
        { index: Math.min(srcLength - 1, Math.max(0, base)), weight: 1 - frac },
        { index: Math.min(srcLength - 1, Math.max(0, base + 1)), weight: frac },
      ]);
    }
  }
  return taps;
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Box-filter resize (area average when downscaling, bilinear when upscaling). */
export function resizeRgba(image: RgbaImage, width: number, height: number): RgbaImage {
  const dstWidth = Math.max(1, Math.floor(width));
  const dstHeight = Math.max(1, Math.floor(height));
  if (dstWidth === image.width && dstHeight === image.height) {
    return { width: dstWidth, height: dstHeight, pixels: image.pixels.slice() };
  }

  // Horizontal pass into a float scratch buffer, then vertical, so each axis can pick its own
  // filter when one axis is upscaled and the other downscaled.
  const xTaps = buildTaps(image.width, dstWidth);
  const scratch = new Float32Array(dstWidth * image.height * 4);
  for (let y = 0; y < image.height; y++) {
    const srcRow = y * image.width * 4;
    const dstRow = y * dstWidth * 4;
    for (let x = 0; x < dstWidth; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const tap of xTaps[x]) {
        const s = srcRow + tap.index * 4;
        r += image.pixels[s] * tap.weight;
        g += image.pixels[s + 1] * tap.weight;
        b += image.pixels[s + 2] * tap.weight;
        a += image.pixels[s + 3] * tap.weight;
      }
      const d = dstRow + x * 4;
      scratch[d] = r;
      scratch[d + 1] = g;
      scratch[d + 2] = b;
      scratch[d + 3] = a;
    }
  }

  const yTaps = buildTaps(image.height, dstHeight);
  const pixels = new Uint8Array(dstWidth * dstHeight * 4);
  for (let y = 0; y < dstHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const tap of yTaps[y]) {
        const s = (tap.index * dstWidth + x) * 4;
        r += scratch[s] * tap.weight;
        g += scratch[s + 1] * tap.weight;
        b += scratch[s + 2] * tap.weight;
        a += scratch[s + 3] * tap.weight;
      }
      const d = (y * dstWidth + x) * 4;
      pixels[d] = clamp255(r);
      pixels[d + 1] = clamp255(g);
      pixels[d + 2] = clamp255(b);
      pixels[d + 3] = clamp255(a);
    }
  }

  return { width: dstWidth, height: dstHeight, pixels };
}

/** Successive halving with a box filter. Returns `[level0, level1, ...]`. */
export function generateMipChain(image: RgbaImage, mipCount: number): RgbaImage[] {
  const levels: RgbaImage[] = [{ width: image.width, height: image.height, pixels: image.pixels.slice() }];
  const count = Math.max(1, Math.floor(mipCount));
  for (let level = 1; level < count; level++) {
    const size = tex0LevelSize(image.width, image.height, level);
    levels.push(resizeRgba(levels[level - 1], size.width, size.height));
  }
  return levels;
}

//#endregion

//#region encoders

/** Clamped texel fetch, so blocks that hang off the edge repeat the border instead of reading 0. */
function sample(image: RgbaImage, x: number, y: number): number[] {
  const cx = Math.min(image.width - 1, Math.max(0, x));
  const cy = Math.min(image.height - 1, Math.max(0, y));
  const i = (cy * image.width + cx) * 4;
  return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2], image.pixels[i + 3]];
}

/** ITU-R BT.601 luma; the same weighting the tests use to score I4/I8/IA4/IA8 round-trips. */
function luminance(r: number, g: number, b: number): number {
  return Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
}

/** Inverse of the decoder's `expandN` bit replication: round to the nearest N-bit step. */
function quantize(value: number, bits: number): number {
  const max = (1 << bits) - 1;
  return Math.max(0, Math.min(max, Math.round((value * max) / 255)));
}

function expand5(value: number): number {
  return (value << 3) | (value >>> 2);
}

function expand6(value: number): number {
  return (value << 2) | (value >>> 4);
}

function writeU16(dst: Uint8Array, offset: number, value: number): void {
  dst[offset] = (value >>> 8) & 0xff;
  dst[offset + 1] = value & 0xff;
}

function pack565(r: number, g: number, b: number): number {
  return (quantize(r, 5) << 11) | (quantize(g, 6) << 5) | quantize(b, 5);
}

function pack5A3(r: number, g: number, b: number, a: number): number {
  if (a >= RGB5A3_OPAQUE_ALPHA) return 0x8000 | (quantize(r, 5) << 10) | (quantize(g, 5) << 5) | quantize(b, 5);
  return (quantize(a, 3) << 12) | (quantize(r, 4) << 8) | (quantize(g, 4) << 4) | quantize(b, 4);
}

/**
 * Walks blocks in the same order as `decodeBlocks` in the stub, handing the callback the byte (or,
 * for I4, nibble) offset the decoder would have read from. Keeping the addressing expression
 * character-for-character identical is what guarantees encode and decode stay inverses.
 */
function forEachBlockTexel(
  width: number,
  height: number,
  blockWidth: number,
  blockHeight: number,
  blockBytes: number,
  write: (x: number, y: number, offset: number) => void,
): void {
  const texels = blockWidth * blockHeight;
  let offset = 0;
  for (let by = 0; by < height; by += blockHeight) {
    for (let bx = 0; bx < width; bx += blockWidth) {
      for (let y = 0; y < blockHeight; y++) {
        for (let x = 0; x < blockWidth; x++) {
          const pixel = y * blockWidth + x;
          write(bx + x, by + y, blockBytes === 32 && texels === 64 ? offset * 2 + pixel : offset + pixel * (blockBytes / texels));
        }
      }
      offset += blockBytes;
    }
  }
}

/** Encode one RGBA8 image into GX bytes for `gxFormat`. Throws on an unsupported format. */
export function encodeTex0Level(image: RgbaImage, gxFormat: number): Uint8Array {
  const name = requireFormatName(gxFormat);
  const dst = new Uint8Array(calcTex0LevelSize(gxFormat, image.width, image.height));
  const info = BLOCK_INFO[name];

  // Round the traversal up to whole blocks so padded texels are written too; `sample` clamps them
  // to the nearest real texel, which keeps CMPR endpoint fitting from seeing bogus black.
  const paddedWidth = align(Math.max(1, image.width), info.blockWidth);
  const paddedHeight = align(Math.max(1, image.height), info.blockHeight);

  if (name === 'CMPR') {
    encodeCmpr(image, paddedWidth, paddedHeight, dst);
    return dst;
  }

  if (name === 'RGBA8') {
    // 64 bytes per 4x4 block: 32 bytes of AR pairs followed by 32 bytes of GB pairs.
    let offset = 0;
    for (let by = 0; by < paddedHeight; by += 4) {
      for (let bx = 0; bx < paddedWidth; bx += 4) {
        for (let i = 0; i < 16; i++) {
          const [r, g, b, a] = sample(image, bx + (i & 3), by + (i >> 2));
          dst[offset + i * 2] = a;
          dst[offset + i * 2 + 1] = r;
          dst[offset + 32 + i * 2] = g;
          dst[offset + 32 + i * 2 + 1] = b;
        }
        offset += 64;
      }
    }
    return dst;
  }

  forEachBlockTexel(paddedWidth, paddedHeight, info.blockWidth, info.blockHeight, info.blockBytes, (x, y, offset) => {
    const [r, g, b, a] = sample(image, x, y);
    switch (name) {
      case 'I4': {
        // `offset` is a nibble index for I4; the high nibble of each byte comes first.
        const value = quantize(luminance(r, g, b), 4);
        dst[offset >> 1] |= offset & 1 ? value : value << 4;
        break;
      }
      case 'I8':
        dst[offset] = luminance(r, g, b);
        break;
      case 'IA4':
        dst[offset] = (quantize(a, 4) << 4) | quantize(luminance(r, g, b), 4);
        break;
      case 'IA8':
        dst[offset] = a;
        dst[offset + 1] = luminance(r, g, b);
        break;
      case 'RGB565':
        writeU16(dst, offset, pack565(r, g, b));
        break;
      case 'RGB5A3':
        writeU16(dst, offset, pack5A3(r, g, b, a));
        break;
      default:
        break;
    }
  });

  return dst;
}

/** Resize `image` to width x height, build `mipCount` levels and encode them all, concatenated. */
export function encodeTex0Data(image: RgbaImage, gxFormat: number, width: number, height: number, mipCount: number): Uint8Array {
  const count = Math.max(1, Math.floor(mipCount));
  const base = resizeRgba(image, width, height);
  const levels = generateMipChain(base, count);
  const dst = new Uint8Array(calcTex0DataSize(gxFormat, base.width, base.height, count));
  let offset = 0;
  for (const level of levels) {
    const encoded = encodeTex0Level(level, gxFormat);
    dst.set(encoded, offset);
    offset += encoded.length;
  }
  return dst;
}

//#endregion

//#region CMPR / DXT1

/** The decoder's `mix`: it rounds each interpolated channel, so the encoder's palette must too. */
function mix(a: number[], b: number[], wa: number, wb: number, div: number): number[] {
  return [
    Math.round((a[0] * wa + b[0] * wb) / div),
    Math.round((a[1] * wa + b[1] * wb) / div),
    Math.round((a[2] * wa + b[2] * wb) / div),
  ];
}

function unpack565(value: number): number[] {
  return [expand5(value >>> 11), expand6((value >>> 5) & 0x3f), expand5(value & 0x1f)];
}

/**
 * Endpoints along the block's principal colour axis. Power iteration on the covariance matrix
 * finds the dominant direction and the extreme texels along it become the endpoints, which keeps
 * gradients straight instead of skewing them the way a per-channel min/max box does.
 */
function principalEndpoints(colors: number[][]): [number[], number[]] {
  const n = colors.length;
  let mr = 0;
  let mg = 0;
  let mb = 0;
  for (const c of colors) {
    mr += c[0];
    mg += c[1];
    mb += c[2];
  }
  mr /= n;
  mg /= n;
  mb /= n;

  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (const c of colors) {
    const dr = c[0] - mr;
    const dg = c[1] - mg;
    const db = c[2] - mb;
    xx += dr * dr;
    xy += dr * dg;
    xz += dr * db;
    yy += dg * dg;
    yz += dg * db;
    zz += db * db;
  }

  let ax = 1;
  let ay = 1;
  let az = 1;
  for (let i = 0; i < 8; i++) {
    const nx = xx * ax + xy * ay + xz * az;
    const ny = xy * ax + yy * ay + yz * az;
    const nz = xz * ax + yz * ay + zz * az;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-6) {
      // Degenerate (flat or achromatic) block: any axis orders the texels equally well, use luma.
      ax = 0.299;
      ay = 0.587;
      az = 0.114;
      break;
    }
    ax = nx / length;
    ay = ny / length;
    az = nz / length;
  }

  let low = Infinity;
  let high = -Infinity;
  let lowColor = colors[0];
  let highColor = colors[0];
  for (const c of colors) {
    const t = c[0] * ax + c[1] * ay + c[2] * az;
    if (t < low) {
      low = t;
      lowColor = c;
    }
    if (t > high) {
      high = t;
      highColor = c;
    }
  }
  return [highColor, lowColor];
}

function nearestPaletteIndex(palette: number[][], color: number[]): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const dr = palette[i][0] - color[0];
    const dg = palette[i][1] - color[1];
    const db = palette[i][2] - color[2];
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

function encodeDxt1Block(image: RgbaImage, bx: number, by: number, dst: Uint8Array, offset: number): void {
  const texels: number[][] = [];
  const opaque: number[][] = [];
  let hasAlpha = false;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const texel = sample(image, bx + x, by + y);
      texels.push(texel);
      if (texel[3] < CMPR_ALPHA_CUTOFF) hasAlpha = true;
      else opaque.push(texel);
    }
  }

  const indices = new Array<number>(16).fill(0);
  let c0 = 0;
  let c1 = 0;

  if (opaque.length === 0) {
    // Fully transparent: colour0 <= colour1 selects the 3-colour mode, where index 3 is clear.
    indices.fill(3);
  } else {
    const [high, low] = principalEndpoints(opaque);
    let q0 = pack565(high[0], high[1], high[2]);
    let q1 = pack565(low[0], low[1], low[2]);

    if (q0 === q1) {
      // Flat block. Equal endpoints land in the 3-colour mode, where index 0 still decodes to
      // colour0 opaquely, so flat regions survive untouched bar the 565 quantisation.
      c0 = q0;
      c1 = q1;
      for (let i = 0; i < 16; i++) indices[i] = texels[i][3] < CMPR_ALPHA_CUTOFF ? 3 : 0;
    } else if (!hasAlpha) {
      // 4-colour mode requires colour0 > colour1 as raw big-endian u16s.
      if (q0 < q1) [q0, q1] = [q1, q0];
      c0 = q0;
      c1 = q1;
      const a = unpack565(q0);
      const b = unpack565(q1);
      const palette = [a, b, mix(a, b, 2, 1, 3), mix(a, b, 1, 2, 3)];
      for (let i = 0; i < 16; i++) indices[i] = nearestPaletteIndex(palette, texels[i]);
    } else {
      // 3-colour + punch-through mode requires colour0 <= colour1.
      if (q0 > q1) [q0, q1] = [q1, q0];
      c0 = q0;
      c1 = q1;
      const a = unpack565(q0);
      const b = unpack565(q1);
      const palette = [a, b, mix(a, b, 1, 1, 2)];
      for (let i = 0; i < 16; i++) {
        indices[i] = texels[i][3] < CMPR_ALPHA_CUTOFF ? 3 : nearestPaletteIndex(palette, texels[i]);
      }
    }
  }

  writeU16(dst, offset, c0);
  writeU16(dst, offset + 2, c1);

  // The decoder reads the most significant index pair first, so texel 0 goes in the top two bits.
  let bits = 0;
  for (let i = 0; i < 16; i++) bits = ((bits << 2) | indices[i]) >>> 0;
  dst[offset + 4] = (bits >>> 24) & 0xff;
  dst[offset + 5] = (bits >>> 16) & 0xff;
  dst[offset + 6] = (bits >>> 8) & 0xff;
  dst[offset + 7] = bits & 0xff;
}

/** CMPR is 8x8 macro-blocks of four 4x4 DXT1 sub-blocks, in the order `decodeCMPR` reads them. */
function encodeCmpr(image: RgbaImage, paddedWidth: number, paddedHeight: number, dst: Uint8Array): void {
  let offset = 0;
  for (let by = 0; by < paddedHeight; by += 8) {
    for (let bx = 0; bx < paddedWidth; bx += 8) {
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          encodeDxt1Block(image, bx + sx * 4, by + sy * 4, dst, offset);
          offset += 8;
        }
      }
    }
  }
}

//#endregion
