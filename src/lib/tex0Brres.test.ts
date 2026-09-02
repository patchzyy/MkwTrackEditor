import { describe, expect, it } from 'vitest';
import { findBrresTexture, listBrresTextures, patchBrresTexture } from './tex0Brres';
import { calcTex0DataSize, encodeTex0Data, type RgbaImage } from './tex0Codec';

const TEX0_HEADER_SIZE = 0x40;
const RES_DIC_ENTRY_SIZE = 0x10;

interface SyntheticTexture {
  name: string;
  width: number;
  height: number;
  format: number;
  mipCount: number;
  data: Uint8Array;
  /** Extra slack after the pixel data, to exercise the "slot is bigger than the data" path. */
  slack?: number;
}

function align(n: number, to: number): number {
  return Math.ceil(n / to) * to;
}

/**
 * Builds the smallest BRRES that the real walker accepts: bres header, a `root` section holding a
 * one-entry ResDic pointing at a `Textures(NW4R)` group, a string pool and the TEX0 sub-files.
 * Everything is big-endian and every ResDic offset is relative to its own dictionary.
 */
function buildBrres(textures: SyntheticTexture[]): Uint8Array {
  const rootOffset = 0x10;
  const rootDicOffset = rootOffset + 0x08;
  const rootDicSize = 0x08 + 2 * RES_DIC_ENTRY_SIZE;
  const groupDicOffset = rootDicOffset + rootDicSize;
  const groupDicSize = 0x08 + (textures.length + 1) * RES_DIC_ENTRY_SIZE;

  const names = ['Textures(NW4R)', ...textures.map((texture) => texture.name)];
  const stringOffsets = new Map<string, number>();
  let cursor = groupDicOffset + groupDicSize;
  for (const name of names) {
    cursor = align(cursor, 4);
    stringOffsets.set(name, cursor + 4); // NW4R strings carry a u32 length before the characters.
    cursor += 4 + name.length + 1;
  }

  cursor = align(cursor, 0x20);
  const fileOffsets: number[] = [];
  const fileSizes: number[] = [];
  for (const texture of textures) {
    fileOffsets.push(cursor);
    const size = TEX0_HEADER_SIZE + align(texture.data.length + (texture.slack ?? 0), 0x20);
    fileSizes.push(size);
    cursor += size;
  }

  const buffer = new Uint8Array(cursor);
  const view = new DataView(buffer.buffer);
  const writeMagic = (offset: number, magic: string) => {
    for (let i = 0; i < magic.length; i++) buffer[offset + i] = magic.charCodeAt(i);
  };

  writeMagic(0x00, 'bres');
  view.setUint16(0x04, 0xfeff);
  view.setUint16(0x06, 0x0000);
  view.setUint32(0x08, buffer.length);
  view.setUint16(0x0c, rootOffset);
  view.setUint16(0x0e, 1);

  writeMagic(rootOffset, 'root');
  view.setUint32(rootOffset + 0x04, 0x08 + rootDicSize);

  view.setUint32(rootDicOffset + 0x00, rootDicSize);
  view.setUint32(rootDicOffset + 0x04, 1);
  const rootEntry = rootDicOffset + 0x08 + RES_DIC_ENTRY_SIZE;
  view.setUint32(rootEntry + 0x08, stringOffsets.get('Textures(NW4R)')! - rootDicOffset);
  view.setUint32(rootEntry + 0x0c, groupDicOffset - rootDicOffset);

  view.setUint32(groupDicOffset + 0x00, groupDicSize);
  view.setUint32(groupDicOffset + 0x04, textures.length);
  for (let i = 0; i < textures.length; i++) {
    const entry = groupDicOffset + 0x08 + (i + 1) * RES_DIC_ENTRY_SIZE;
    view.setUint32(entry + 0x08, stringOffsets.get(textures[i].name)! - groupDicOffset);
    view.setUint32(entry + 0x0c, fileOffsets[i] - groupDicOffset);
  }

  for (const name of names) {
    const start = stringOffsets.get(name)!;
    view.setUint32(start - 4, name.length);
    for (let i = 0; i < name.length; i++) buffer[start + i] = name.charCodeAt(i);
  }

  for (let i = 0; i < textures.length; i++) {
    const texture = textures[i];
    const offset = fileOffsets[i];
    writeMagic(offset, 'TEX0');
    view.setUint32(offset + 0x04, fileSizes[i]);
    view.setUint32(offset + 0x08, 3);
    view.setInt32(offset + 0x0c, -offset);
    view.setUint32(offset + 0x10, TEX0_HEADER_SIZE);
    view.setUint32(offset + 0x14, stringOffsets.get(texture.name)! - offset);
    view.setUint32(offset + 0x18, 0);
    view.setUint16(offset + 0x1c, texture.width);
    view.setUint16(offset + 0x1e, texture.height);
    view.setUint32(offset + 0x20, texture.format);
    view.setUint32(offset + 0x24, texture.mipCount);
    view.setFloat32(offset + 0x28, 0);
    view.setFloat32(offset + 0x2c, texture.mipCount - 1);
    buffer.set(texture.data, offset + TEX0_HEADER_SIZE);
  }

  return buffer;
}

function ramp(length: number, seed: number): Uint8Array {
  const data = new Uint8Array(length);
  for (let i = 0; i < length; i++) data[i] = (i * 7 + seed) & 0xff;
  return data;
}

const SAMPLE: SyntheticTexture[] = [
  { name: 'course_road', width: 16, height: 16, format: 0xe, mipCount: 1, data: ramp(128, 1) },
  { name: 'course_wall', width: 8, height: 8, format: 0x6, mipCount: 1, data: ramp(256, 40), slack: 64 },
];

function readSlot(brres: Uint8Array, offset: number, length: number): Uint8Array {
  return brres.slice(offset, offset + length);
}

describe('listBrresTextures', () => {
  it('finds every TEX0 in Textures(NW4R) order', () => {
    const brres = buildBrres(SAMPLE);
    const textures = listBrresTextures(brres);
    expect(textures.map((texture) => texture.name)).toEqual(['course_road', 'course_wall']);

    const [road, wall] = textures;
    expect(road.width).toBe(16);
    expect(road.height).toBe(16);
    expect(road.format).toBe(0xe);
    expect(road.mipCount).toBe(1);
    expect(road.minLOD).toBe(0);
    expect(road.maxLOD).toBe(0);

    expect(wall.width).toBe(8);
    expect(wall.format).toBe(0x6);
    expect(wall.fileOffset).toBeGreaterThan(road.fileOffset);
  });

  it('points dataOffset at the real pixel bytes and sizes the slot to the sub-file', () => {
    const brres = buildBrres(SAMPLE);
    const textures = listBrresTextures(brres);
    for (let i = 0; i < SAMPLE.length; i++) {
      const texture = textures[i];
      expect(texture.dataOffset).toBe(texture.fileOffset + TEX0_HEADER_SIZE);
      expect(readSlot(brres, texture.dataOffset, SAMPLE[i].data.length)).toEqual(SAMPLE[i].data);
      // The slot runs from the pixel data to the end of the sub-file, so it can exceed the data.
      expect(texture.dataSize).toBeGreaterThanOrEqual(SAMPLE[i].data.length);
      expect(texture.dataOffset + texture.dataSize).toBeLessThanOrEqual(brres.length);
    }
    expect(textures[1].dataSize).toBeGreaterThan(SAMPLE[1].data.length);
  });

  it('falls back to the next sub-file when the declared length is unusable', () => {
    const brres = buildBrres(SAMPLE);
    const first = listBrresTextures(brres)[0];
    const broken = brres.slice();
    new DataView(broken.buffer).setUint32(first.fileOffset + 0x04, 0);
    const patched = listBrresTextures(broken);
    expect(patched[0].dataSize).toBe(patched[1].fileOffset - patched[0].dataOffset);
    expect(patched[1].dataSize).toBe(broken.length - patched[1].dataOffset);
  });

  it('reports mipCount clamped by maxLOD, the way noclip does', () => {
    const brres = buildBrres(SAMPLE);
    const offset = listBrresTextures(brres)[0].fileOffset;
    const view = new DataView(brres.buffer);
    view.setUint32(offset + 0x24, 5);
    view.setFloat32(offset + 0x2c, 2);
    expect(listBrresTextures(brres)[0].mipCount).toBe(3);
  });

  it('returns nothing for buffers that are not a big-endian BRRES', () => {
    expect(listBrresTextures(new Uint8Array(0))).toEqual([]);
    expect(listBrresTextures(new Uint8Array(64))).toEqual([]);
    expect(listBrresTextures(new TextEncoder().encode('not a brres file at all, really'))).toEqual([]);

    const littleEndian = buildBrres(SAMPLE);
    new DataView(littleEndian.buffer).setUint16(0x04, 0xfffe);
    expect(listBrresTextures(littleEndian)).toEqual([]);
  });

  it('returns nothing when there is no texture group', () => {
    const brres = buildBrres(SAMPLE);
    // Rename the group in the string pool so the root ResDic lookup misses.
    const groupName = 'Textures(NW4R)';
    const nameOffset = new TextDecoder('latin1').decode(brres).indexOf(groupName);
    expect(nameOffset).toBeGreaterThan(0);
    brres[nameOffset] = 'X'.charCodeAt(0);
    expect(listBrresTextures(brres)).toEqual([]);
  });
});

describe('findBrresTexture', () => {
  it('looks textures up by name', () => {
    const brres = buildBrres(SAMPLE);
    expect(findBrresTexture(brres, 'course_wall')?.format).toBe(0x6);
    expect(findBrresTexture(brres, 'nope')).toBeNull();
  });
});

describe('patchBrresTexture', () => {
  it('overwrites the pixel data without changing the archive size', () => {
    const brres = buildBrres(SAMPLE);
    const pixelData = ramp(64, 200);
    const patched = patchBrresTexture(brres, 'course_road', { pixelData, width: 8, height: 4, format: 0x5, mipCount: 2 });

    expect(patched.byteLength).toBe(brres.byteLength);
    const road = findBrresTexture(patched, 'course_road')!;
    expect(readSlot(patched, road.dataOffset, pixelData.length)).toEqual(pixelData);
    expect(road.width).toBe(8);
    expect(road.height).toBe(4);
    expect(road.format).toBe(0x5);
    expect(road.mipCount).toBe(2);
    expect(road.maxLOD).toBe(1);
  });

  it('leaves the source buffer and the other textures alone', () => {
    const brres = buildBrres(SAMPLE);
    const before = brres.slice();
    const patched = patchBrresTexture(brres, 'course_road', {
      pixelData: ramp(128, 99),
      width: 16,
      height: 16,
      format: 0xe,
      mipCount: 1,
    });

    expect(brres).toEqual(before);
    const wall = findBrresTexture(patched, 'course_wall')!;
    expect(readSlot(patched, wall.dataOffset, SAMPLE[1].data.length)).toEqual(SAMPLE[1].data);
    expect(wall.width).toBe(8);
    expect(wall.format).toBe(0x6);
  });

  it('accepts data shorter than the slot and keeps the archive intact', () => {
    const brres = buildBrres(SAMPLE);
    const patched = patchBrresTexture(brres, 'course_wall', { pixelData: ramp(32, 3), width: 4, height: 4, format: 0x6, mipCount: 1 });
    expect(patched.byteLength).toBe(brres.byteLength);
    expect(listBrresTextures(patched).map((texture) => texture.name)).toEqual(['course_road', 'course_wall']);
  });

  it('throws when the new data does not fit the slot', () => {
    const brres = buildBrres(SAMPLE);
    const slot = findBrresTexture(brres, 'course_road')!.dataSize;
    expect(() =>
      patchBrresTexture(brres, 'course_road', { pixelData: new Uint8Array(slot + 1), width: 16, height: 16, format: 0xe, mipCount: 1 }),
    ).toThrow(/only \d+ are available/);
  });

  it('throws for an unknown texture name', () => {
    const brres = buildBrres(SAMPLE);
    expect(() => patchBrresTexture(brres, 'missing', { pixelData: new Uint8Array(4), width: 4, height: 4, format: 0x6, mipCount: 1 })).toThrow(
      /no texture named "missing"/,
    );
  });

  it('round-trips a freshly encoded texture into the archive', () => {
    const image: RgbaImage = { width: 8, height: 8, pixels: new Uint8Array(8 * 8 * 4).fill(0x80) };
    const brres = buildBrres(SAMPLE);
    const pixelData = encodeTex0Data(image, 0xe, 8, 8, 2);
    expect(pixelData.byteLength).toBe(calcTex0DataSize(0xe, 8, 8, 2));

    const patched = patchBrresTexture(brres, 'course_road', { pixelData, width: 8, height: 8, format: 0xe, mipCount: 2 });
    const road = findBrresTexture(patched, 'course_road')!;
    expect(road.mipCount).toBe(2);
    expect(readSlot(patched, road.dataOffset, pixelData.length)).toEqual(pixelData);
  });
});
