import { describe, expect, it } from 'vitest';
import { PixelFormat, decode_texture } from '../noclipRustStub';
import {
  calcTex0DataSize,
  calcTex0LevelSize,
  canEncodeTex0Format,
  encodeTex0Data,
  encodeTex0Level,
  floorPowerOfTwo,
  generateMipChain,
  maxMipCount,
  nearestPowerOfTwo,
  resizeRgba,
  tex0FormatName,
  tex0FormatValue,
  tex0LevelSize,
  type RgbaImage,
  type Tex0FormatName,
} from './tex0Codec';

const ALL_FORMATS: Tex0FormatName[] = ['I4', 'I8', 'IA4', 'IA8', 'RGB565', 'RGB5A3', 'RGBA8', 'CMPR'];

/** The stub decoder has its own enum whose CMPR value differs from GX's; map by name. */
function pixelFormatOf(name: Tex0FormatName): PixelFormat {
  return PixelFormat[name];
}

function buildImage(width: number, height: number, shade: (x: number, y: number) => number[]): RgbaImage {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = shade(x, y);
      const i = (y * width + x) * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = a;
    }
  }
  return { width, height, pixels };
}

const FLAT_PATCH = [128, 64, 192];
const FLAT_PATCH_2 = [255, 255, 0];

/**
 * 16x16: a full-range RGB gradient across the top half and two flat colour patches across the
 * bottom half, both aligned to 4x4 (and 8x8) block boundaries so block-compressed formats can be
 * checked for exactness on the flat parts.
 */
function testImage(alpha: (x: number, y: number) => number): RgbaImage {
  return buildImage(16, 16, (x, y) => {
    if (y < 8) return [x * 17, y * 17, 255 - x * 17, alpha(x, y)];
    if (x < 8) return [...FLAT_PATCH, alpha(x, y)];
    return [...FLAT_PATCH_2, alpha(x, y)];
  });
}

const opaque = () => 255;
/** Alpha split down the middle at x = 8, so it lands on every block boundary. */
const halfAlpha = (x: number) => (x < 8 ? 255 : 0);

/** Mirrors the encoder's BT.601 luma so intensity formats can be checked exactly. */
function luminance(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

function roundTrip(image: RgbaImage, name: Tex0FormatName): Uint8Array {
  const encoded = encodeTex0Level(image, tex0FormatValue(name));
  expect(encoded.byteLength).toBe(calcTex0LevelSize(tex0FormatValue(name), image.width, image.height));
  return decode_texture(pixelFormatOf(name), undefined, encoded, undefined, image.width, image.height);
}

function channelStats(source: RgbaImage, decoded: Uint8Array): { mae: number[]; max: number[] } {
  const sums = [0, 0, 0, 0];
  const max = [0, 0, 0, 0];
  const count = source.width * source.height;
  for (let i = 0; i < source.pixels.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      const error = Math.abs(source.pixels[i + c] - decoded[i + c]);
      sums[c] += error;
      max[c] = Math.max(max[c], error);
    }
  }
  return { mae: sums.map((sum) => sum / count), max };
}

function at(pixels: Uint8Array, width: number, x: number, y: number): number[] {
  const i = (y * width + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

describe('format metadata', () => {
  it('maps GX format values to names and back', () => {
    expect(tex0FormatValue('I4')).toBe(0x0);
    expect(tex0FormatValue('RGBA8')).toBe(0x6);
    expect(tex0FormatValue('CMPR')).toBe(0xe);
    for (const name of ALL_FORMATS) expect(tex0FormatName(tex0FormatValue(name))).toBe(name);
  });

  it('rejects palette formats we cannot encode', () => {
    for (const value of [0x7, 0x8, 0x9, 0xa, 0xf, 99]) {
      expect(tex0FormatName(value)).toBeNull();
      expect(canEncodeTex0Format(value)).toBe(false);
    }
    for (const name of ALL_FORMATS) expect(canEncodeTex0Format(tex0FormatValue(name))).toBe(true);
    expect(() => encodeTex0Level(testImage(opaque), 0x8)).toThrow(/format 8/);
  });

  it('sizes levels the way gx_texture.calcTextureSize does', () => {
    // align(w, blockW) * align(h, blockH), scaled by the format's bits per pixel.
    expect(calcTex0LevelSize(0x0, 12, 6)).toBe(64); // I4: 16*8 >> 1
    expect(calcTex0LevelSize(0x1, 12, 6)).toBe(128); // I8: 16*8
    expect(calcTex0LevelSize(0x3, 12, 6)).toBe(192); // IA8: 12*8 * 2
    expect(calcTex0LevelSize(0x6, 12, 6)).toBe(384); // RGBA8: 12*8 * 4
    expect(calcTex0LevelSize(0xe, 12, 6)).toBe(64); // CMPR: 16*8 >> 1
    expect(calcTex0LevelSize(0xe, 1, 1)).toBe(32);
  });

  it('sums mip levels for the total data size', () => {
    // 16x16 RGBA8: the 2x2 and 1x1 levels still cost one whole 64-byte block each.
    expect(calcTex0DataSize(0x6, 16, 16, 1)).toBe(1024);
    expect(calcTex0DataSize(0x6, 16, 16, 5)).toBe(1024 + 256 + 64 + 64 + 64);
    expect(calcTex0DataSize(0xe, 32, 32, 3)).toBe(512 + 128 + 32);
  });
});

describe('power-of-two helpers', () => {
  it('floors to a power of two', () => {
    expect(floorPowerOfTwo(0)).toBe(1);
    expect(floorPowerOfTwo(1)).toBe(1);
    expect(floorPowerOfTwo(2)).toBe(2);
    expect(floorPowerOfTwo(3)).toBe(2);
    expect(floorPowerOfTwo(255)).toBe(128);
    expect(floorPowerOfTwo(256)).toBe(256);
  });

  it('rounds to the nearest power of two, ties going up', () => {
    expect(nearestPowerOfTwo(0)).toBe(1);
    expect(nearestPowerOfTwo(3)).toBe(4);
    expect(nearestPowerOfTwo(5)).toBe(4);
    expect(nearestPowerOfTwo(6)).toBe(8);
    expect(nearestPowerOfTwo(100)).toBe(128);
    expect(nearestPowerOfTwo(1000)).toBe(1024);
  });

  it('counts mip levels down to 1x1', () => {
    expect(maxMipCount(1, 1)).toBe(1);
    expect(maxMipCount(16, 8)).toBe(5);
    expect(maxMipCount(12, 6)).toBe(4);
    expect(maxMipCount(1024, 256)).toBe(11);
  });
});

describe('resizeRgba', () => {
  it('area-averages when downscaling', () => {
    const image = buildImage(2, 2, (x, y) => (x === 0 && y === 0 ? [255, 0, 0, 255] : [0, 0, 0, 255]));
    const small = resizeRgba(image, 1, 1);
    expect(small.width).toBe(1);
    expect(small.height).toBe(1);
    expect(at(small.pixels, 1, 0, 0)).toEqual([64, 0, 0, 255]);
  });

  it('bilinearly interpolates when upscaling and keeps the corners', () => {
    const image = buildImage(2, 2, (x) => (x === 0 ? [0, 0, 0, 255] : [200, 200, 200, 255]));
    const big = resizeRgba(image, 4, 4);
    expect(big.width).toBe(4);
    expect(big.height).toBe(4);
    expect(at(big.pixels, 4, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(at(big.pixels, 4, 3, 0)).toEqual([200, 200, 200, 255]);
    // Interior samples sit between the two columns.
    expect(at(big.pixels, 4, 1, 0)[0]).toBeGreaterThan(0);
    expect(at(big.pixels, 4, 1, 0)[0]).toBeLessThan(200);
  });

  it('copies rather than aliases when the size is unchanged', () => {
    const image = testImage(opaque);
    const same = resizeRgba(image, 16, 16);
    expect(same.pixels).toEqual(image.pixels);
    expect(same.pixels).not.toBe(image.pixels);
  });

  it('mixes an upscaled axis with a downscaled one', () => {
    const image = buildImage(8, 2, () => [10, 20, 30, 255]);
    const resized = resizeRgba(image, 4, 6);
    expect(resized.width).toBe(4);
    expect(resized.height).toBe(6);
    expect(at(resized.pixels, 4, 2, 3)).toEqual([10, 20, 30, 255]);
  });
});

describe('generateMipChain', () => {
  it('halves each level down to the requested count', () => {
    const chain = generateMipChain(testImage(opaque), 5);
    expect(chain.map((level) => [level.width, level.height])).toEqual([
      [16, 16],
      [8, 8],
      [4, 4],
      [2, 2],
      [1, 1],
    ]);
    for (let level = 0; level < chain.length; level++) {
      expect(tex0LevelSize(16, 16, level)).toEqual({ width: chain[level].width, height: chain[level].height });
      expect(chain[level].pixels.length).toBe(chain[level].width * chain[level].height * 4);
    }
  });

  it('clamps non-square chains at 1 instead of going to zero', () => {
    const chain = generateMipChain(buildImage(16, 4, () => [0, 0, 0, 255]), 5);
    expect(chain.map((level) => [level.width, level.height])).toEqual([
      [16, 4],
      [8, 2],
      [4, 1],
      [2, 1],
      [1, 1],
    ]);
  });

  it('keeps a solid colour solid at every level', () => {
    const chain = generateMipChain(buildImage(16, 16, () => [37, 211, 84, 190]), 5);
    for (const level of chain) {
      for (let i = 0; i < level.pixels.length; i += 4) {
        expect([level.pixels[i], level.pixels[i + 1], level.pixels[i + 2], level.pixels[i + 3]]).toEqual([37, 211, 84, 190]);
      }
    }
  });

  it('always returns at least the base level', () => {
    expect(generateMipChain(testImage(opaque), 0)).toHaveLength(1);
  });
});

describe('encodeTex0Level round-trips through the decoder', () => {
  it('is lossless for RGBA8, including alpha', () => {
    const image = testImage(halfAlpha);
    const decoded = roundTrip(image, 'RGBA8');
    expect(decoded).toEqual(image.pixels);
  });

  it('keeps RGB565 within one quantisation step', () => {
    const image = testImage(opaque);
    const { max } = channelStats(image, roundTrip(image, 'RGB565'));
    expect(max[0]).toBeLessThanOrEqual(4);
    expect(max[1]).toBeLessThanOrEqual(2);
    expect(max[2]).toBeLessThanOrEqual(4);
    expect(max[3]).toBe(0); // RGB565 has no alpha; the decoder forces 0xff.
  });

  it('keeps opaque RGB5A3 texels in the 5-bit path', () => {
    const image = testImage(opaque);
    const { max } = channelStats(image, roundTrip(image, 'RGB5A3'));
    expect(Math.max(max[0], max[1], max[2])).toBeLessThanOrEqual(4);
    expect(max[3]).toBe(0);
  });

  it('round-trips RGB5A3 alpha through the 3-bit translucent path', () => {
    const image = testImage((x, y) => (y < 8 ? halfAlpha(x) : 100));
    const decoded = roundTrip(image, 'RGB5A3');
    const { max } = channelStats(image, decoded);
    // Translucent texels drop to RGB4, so colour error doubles versus the opaque path.
    expect(Math.max(max[0], max[1], max[2])).toBeLessThanOrEqual(8);
    // Alpha 0 and 255 are both exactly representable; 100 rounds to the nearest 3-bit step.
    expect(at(decoded, 16, 0, 0)[3]).toBe(255);
    expect(at(decoded, 16, 12, 0)[3]).toBe(0);
    expect(Math.abs(at(decoded, 16, 0, 12)[3] - 100)).toBeLessThanOrEqual(18);
  });

  it('stores I8 intensity exactly', () => {
    const image = testImage(opaque);
    const decoded = roundTrip(image, 'I8');
    for (let i = 0; i < image.pixels.length; i += 4) {
      const value = luminance(image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]);
      expect([decoded[i], decoded[i + 1], decoded[i + 2], decoded[i + 3]]).toEqual([value, value, value, 255]);
    }
  });

  it('quantises I4 intensity to four bits', () => {
    const image = testImage(opaque);
    const decoded = roundTrip(image, 'I4');
    for (let i = 0; i < image.pixels.length; i += 4) {
      const value = luminance(image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]);
      expect(decoded[i]).toBe(decoded[i + 1]);
      expect(decoded[i]).toBe(decoded[i + 2]);
      expect(Math.abs(decoded[i] - value)).toBeLessThanOrEqual(8);
      expect(decoded[i + 3]).toBe(255);
    }
  });

  it('stores IA8 intensity and alpha exactly', () => {
    const image = testImage(halfAlpha);
    const decoded = roundTrip(image, 'IA8');
    for (let i = 0; i < image.pixels.length; i += 4) {
      const value = luminance(image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]);
      expect([decoded[i], decoded[i + 1], decoded[i + 2], decoded[i + 3]]).toEqual([value, value, value, image.pixels[i + 3]]);
    }
  });

  it('quantises IA4 intensity and alpha to four bits each', () => {
    const image = testImage((x, y) => (y < 8 ? halfAlpha(x) : 100));
    const decoded = roundTrip(image, 'IA4');
    for (let i = 0; i < image.pixels.length; i += 4) {
      const value = luminance(image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]);
      expect(Math.abs(decoded[i] - value)).toBeLessThanOrEqual(8);
      expect(Math.abs(decoded[i + 3] - image.pixels[i + 3])).toBeLessThanOrEqual(8);
    }
  });

  it('compresses CMPR with a small mean error and exact flat regions', () => {
    const image = testImage(opaque);
    const decoded = roundTrip(image, 'CMPR');
    const { mae } = channelStats(image, decoded);
    for (let c = 0; c < 3; c++) expect(mae[c]).toBeLessThan(24);
    expect(mae[3]).toBe(0);

    // The flat patches occupy whole 4x4 blocks, so only 565 quantisation should show up.
    for (let y = 8; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const expected = x < 8 ? FLAT_PATCH : FLAT_PATCH_2;
        const actual = at(decoded, 16, x, y);
        for (let c = 0; c < 3; c++) expect(Math.abs(actual[c] - expected[c])).toBeLessThanOrEqual(4);
      }
    }
  });

  it('gives CMPR punch-through alpha', () => {
    const image = testImage(halfAlpha);
    const decoded = roundTrip(image, 'CMPR');
    for (let i = 0; i < image.pixels.length; i += 4) {
      expect(decoded[i + 3]).toBe(image.pixels[i + 3] < 128 ? 0 : 255);
    }
    // Fully transparent blocks must not bleed colour back in.
    expect(at(decoded, 16, 12, 2)).toEqual([0, 0, 0, 0]);
    const { mae } = channelStats(image, decoded);
    expect(mae[3]).toBe(0);
  });

  it('encodes every format at a size that is not a block multiple', () => {
    const image = buildImage(12, 6, (x, y) => [x * 20, y * 40, 255 - x * 20, x < 6 ? 255 : 0]);
    for (const name of ALL_FORMATS) {
      const format = tex0FormatValue(name);
      const encoded = encodeTex0Level(image, format);
      expect(encoded.byteLength).toBe(calcTex0LevelSize(format, 12, 6));
      // Padding must not corrupt the visible texels: decoding still yields the full image.
      const decoded = decode_texture(pixelFormatOf(name), undefined, encoded, undefined, 12, 6);
      expect(decoded.length).toBe(12 * 6 * 4);
    }
  });

  it('handles 1x1 levels', () => {
    const image = buildImage(1, 1, () => [200, 100, 50, 255]);
    for (const name of ALL_FORMATS) {
      const encoded = encodeTex0Level(image, tex0FormatValue(name));
      expect(encoded.byteLength).toBe(calcTex0LevelSize(tex0FormatValue(name), 1, 1));
    }
    const decoded = decode_texture(PixelFormat.RGBA8, undefined, encodeTex0Level(image, 0x6), undefined, 1, 1);
    expect(Array.from(decoded)).toEqual([200, 100, 50, 255]);
  });
});

describe('encodeTex0Data', () => {
  it('emits every mip level back to back at the expected size', () => {
    const image = testImage(opaque);
    for (const name of ALL_FORMATS) {
      const format = tex0FormatValue(name);
      const data = encodeTex0Data(image, format, 16, 16, 5);
      expect(data.byteLength).toBe(calcTex0DataSize(format, 16, 16, 5));
    }
  });

  it('resizes before encoding and keeps level 0 identical to encodeTex0Level', () => {
    const image = testImage(opaque);
    const data = encodeTex0Data(image, 0x6, 8, 8, 1);
    expect(data.byteLength).toBe(calcTex0LevelSize(0x6, 8, 8));
    const resized = resizeRgba(image, 8, 8);
    expect(data).toEqual(encodeTex0Level(resized, 0x6));

    const decoded = decode_texture(PixelFormat.RGBA8, undefined, data, undefined, 8, 8);
    expect(decoded).toEqual(resized.pixels);
  });

  it('decodes each mip level of a solid image back to the same colour', () => {
    const image = buildImage(8, 8, () => [10, 130, 250, 255]);
    const data = encodeTex0Data(image, 0x6, 8, 8, 4);
    let offset = 0;
    for (let level = 0; level < 4; level++) {
      const size = tex0LevelSize(8, 8, level);
      const bytes = calcTex0LevelSize(0x6, size.width, size.height);
      const decoded = decode_texture(PixelFormat.RGBA8, undefined, data.subarray(offset), undefined, size.width, size.height);
      for (let i = 0; i < decoded.length; i += 4) {
        expect([decoded[i], decoded[i + 1], decoded[i + 2], decoded[i + 3]]).toEqual([10, 130, 250, 255]);
      }
      offset += bytes;
    }
    expect(offset).toBe(data.byteLength);
  });
});
