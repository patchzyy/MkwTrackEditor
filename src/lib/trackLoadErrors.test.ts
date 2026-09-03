/**
 * What the editor does with a file it cannot use.
 *
 * The bar is: a clear, non-technical message the status line can show, and never a crash, a hang,
 * a huge allocation, or a silently wrong parse. Anything the editor *can* still open (a track
 * with no layout data, an unreadable model) has to load with a warning rather than fail outright,
 * because opening it is how the author finds out what is wrong with it.
 */

import { describe, expect, it } from 'vitest';
import { buildU8, parseU8WithLayout } from './u8';
import { decodeYaz0, encodeYaz0, isYaz0 } from './yaz0';
import { loadTrackBytes } from './track';
import { CUSTOM_TRACK_DIR, NINTENDO_TRACK_DIR, listTracks, readTrackBytes } from './realTrackFixtures.testdata';

/** A user-facing message: a sentence, no format jargon, no stack-trace fragments. */
function expectFriendly(message: string) {
  expect(message.length, `"${message}" is too short to explain anything`).toBeGreaterThan(20);
  expect(message).toMatch(/[.!]$/);
  expect(message).not.toMatch(/undefined|NaN|\[object|Cannot read|is not a function|at [A-Za-z]+\s*\(/);
  // Section codes and struct names are for the log, not the status line.
  expect(message).not.toMatch(/\bU8\b|\bYaz0\b|0x[0-9a-f]{4,}/i);
}

async function expectRejects(bytes: Uint8Array, name = 'broken.szs'): Promise<string> {
  let message: string | null = null;
  try {
    await loadTrackBytes(bytes, name, { brresSummaryLimit: 0 });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message, 'loading was expected to fail').not.toBeNull();
  expectFriendly(message as string);
  return message as string;
}

describe('opening a file that is not a usable track', () => {
  it('rejects an empty file', async () => {
    await expectRejects(new Uint8Array(0), 'empty.szs');
  });

  it('rejects a file that is far too small to be an archive', async () => {
    await expectRejects(new Uint8Array([1, 2, 3, 4]), 'tiny.szs');
  });

  it('rejects an ordinary non-Mario-Kart file', async () => {
    // A PNG header followed by noise: valid file, wrong kind.
    const bytes = new Uint8Array(4096);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (let i = 8; i < bytes.length; i++) bytes[i] = (i * 37) & 0xff;
    const message = await expectRejects(bytes, 'photo.png');
    expect(message).toMatch(/Mario Kart Wii/);
  });

  it('rejects a compressed archive whose header claims an impossible size', async () => {
    // Well-formed Yaz0 magic, then a decompressed size of ~4 GB.
    const bytes = new Uint8Array(1024);
    bytes.set([0x59, 0x61, 0x7a, 0x30]); // "Yaz0"
    new DataView(bytes.buffer).setUint32(4, 0xf0000000);
    const message = await expectRejects(bytes, 'huge.szs');
    expect(message).toMatch(/damaged/i);
  });

  it('does not allocate for an impossible size before checking it', () => {
    const bytes = new Uint8Array(64);
    bytes.set([0x59, 0x61, 0x7a, 0x30]);
    new DataView(bytes.buffer).setUint32(4, 0xffffffff);
    const started = Date.now();
    expect(() => decodeYaz0(bytes)).toThrow(/damaged/i);
    // A real allocation attempt at this size either throws a RangeError or takes a long time.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('rejects a truncated compressed archive instead of decoding it to zeroes', () => {
    const original = new Uint8Array(4096);
    for (let i = 0; i < original.length; i++) original[i] = (i * 7) & 0xff;
    const compressed = encodeYaz0(original, { searchDepth: 1 });
    expect(isYaz0(compressed)).toBe(true);

    const truncated = compressed.slice(0, 16 + Math.floor((compressed.length - 16) / 2));
    let message: string | null = null;
    try {
      decodeYaz0(truncated);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message, 'a truncated archive decoded without complaint').not.toBeNull();
    expectFriendly(message as string);
    expect(message).toMatch(/incomplete|truncated/i);
  });

  it('rejects an archive whose file table does not fit in the file', () => {
    const bytes = new Uint8Array(256);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x55aa382d); // U8 magic
    view.setUint32(4, 0x20); // root node offset
    view.setUint32(0x20, 0x01000000); // root node: type 1 (directory), name offset 0
    view.setUint32(0x28, 0x00ffffff); // ...claiming 16 million entries
    expect(() => parseU8WithLayout(bytes)).toThrow(/damaged/i);
    try {
      parseU8WithLayout(bytes);
    } catch (error) {
      expectFriendly((error as Error).message);
    }
  });
});

describe('opening a track the editor can only partly read', () => {
  it('opens an archive with no track layout data, and says so', async () => {
    const archive = buildU8([
      { path: './course_model.brres', type: 'file', data: new Uint8Array(64) },
      { path: './course.kcl', type: 'file', data: new Uint8Array(64) },
    ]);

    const track = await loadTrackBytes(archive, 'no-kmp.szs', { brresSummaryLimit: 0 });
    expect(track.kmp).toBeUndefined();
    expect(track.kmpFile).toBeUndefined();
    expect(track.warnings.some((warning) => /no track layout/i.test(warning))).toBe(true);
    // Still a usable document: the archive is there to look at and to export again.
    expect(track.archiveEntries.length).toBeGreaterThan(0);
  });

  it('opens an archive whose layout data is corrupt, and says so', async () => {
    const garbage = new Uint8Array(512);
    for (let i = 0; i < garbage.length; i++) garbage[i] = (i * 13) & 0xff;
    const archive = buildU8([{ path: './course.kmp', type: 'file', data: garbage }]);

    const track = await loadTrackBytes(archive, 'bad-kmp.szs', { brresSummaryLimit: 0 });
    expect(track.kmpFile).toBeUndefined();
    expect(track.warnings.some((warning) => /track layout .* could not be read/i.test(warning))).toBe(true);
  });

  it('opens an archive whose collision mesh is corrupt, and says so', async () => {
    const garbage = new Uint8Array(512);
    for (let i = 0; i < garbage.length; i++) garbage[i] = 0xab;
    const archive = buildU8([{ path: './course.kcl', type: 'file', data: garbage }]);

    const track = await loadTrackBytes(archive, 'bad-kcl.szs', { brresSummaryLimit: 0 });
    expect(track.warnings.some((warning) => /collision mesh/i.test(warning))).toBe(true);
  });

  it('opens an archive with no files at all', async () => {
    const track = await loadTrackBytes(buildU8([]), 'empty-archive.szs', { brresSummaryLimit: 0 });
    expect(track.warnings.length).toBeGreaterThan(0);
    expect(track.brresFiles).toEqual([]);
  });
});

const realTracks = [...listTracks(CUSTOM_TRACK_DIR, 1), ...listTracks(NINTENDO_TRACK_DIR, 1)];

describe.skipIf(realTracks.length === 0)('damaging a real track', () => {
  for (const path of realTracks) {
    const name = path.split(/[\\/]/).pop() as string;

    it(`${name}: a truncated copy is reported, not silently half-loaded`, async () => {
      const raw = readTrackBytes(path);
      await expectRejects(raw.slice(0, Math.floor(raw.length / 2)), name);
    });

    it(`${name}: a copy with a corrupted model still opens, with a warning`, async () => {
      const archive = decodeYaz0(readTrackBytes(path));
      const { entries } = parseU8WithLayout(archive);
      const model = entries.find((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('course_model.brres'));
      if (!model?.data) return;

      // Keep the size, destroy the contents, so only the BRRES reader is affected.
      const broken = entries.map((entry) =>
        entry === model ? { ...entry, data: new Uint8Array(model.data!.length).fill(0x5a) } : entry,
      );
      const track = await loadTrackBytes(buildU8(broken), name, { brresSummaryLimit: 8 });
      // The layout data is untouched, so the track is still editable.
      expect(track.kmpFile).toBeDefined();
      expect(track.warnings.some((warning) => /course_model\.brres could not be read/i.test(warning))).toBe(true);
    });
  }
});
