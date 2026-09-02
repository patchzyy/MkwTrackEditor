import { describe, expect, it } from 'vitest';
import { decodeYaz0, encodeYaz0, encodeYaz0Uncompressed, isYaz0 } from './yaz0';
import { buildU8, parseU8, parseU8WithLayout, type U8Entry } from './u8';
import { exportTrack, loadTrackBytes, replaceCourseKmp, validateExportBytes, validateTrack } from './track';
import { readKmpFile, writeKmpFile } from './kmpFile';
import { CUSTOM_TRACK_DIR, NINTENDO_TRACK_DIR, listTracks, readTrackBytes } from './realTrackFixtures.testdata';

function sameBytes(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function fileTable(entries: U8Entry[]): Array<[string, number]> {
  return entries.filter((entry) => entry.type === 'file').map((entry) => [entry.path, entry.data?.length ?? 0]);
}

describe('Yaz0', () => {
  const cases: Array<[string, Uint8Array]> = [
    ['empty', new Uint8Array(0)],
    ['one byte', Uint8Array.from([42])],
    ['short text', new TextEncoder().encode('Mario Kart Wii editor data')],
    ['all zeroes', new Uint8Array(5000)],
    ['long run', Uint8Array.from({ length: 4096 }, () => 0xab)],
    ['incompressible', Uint8Array.from({ length: 8192 }, (_, i) => (i * 2654435761) & 0xff)],
    [
      'repeating with noise',
      Uint8Array.from({ length: 20000 }, (_, i) => (i % 512 < 400 ? i % 7 : (i * 31) & 0xff)),
    ],
  ];

  for (const [name, data] of cases) {
    it(`round-trips ${name}`, () => {
      const encoded = encodeYaz0(data);
      expect(isYaz0(encoded)).toBe(true);
      expect([...decodeYaz0(encoded)]).toEqual([...data]);
    });
  }

  it('writes the header the game expects', () => {
    const data = new TextEncoder().encode('hello world hello world hello world');
    const encoded = encodeYaz0(data);
    expect(String.fromCharCode(...encoded.slice(0, 4))).toBe('Yaz0');
    const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    expect(view.getUint32(4, false)).toBe(data.length);
    expect(view.getUint32(8, false)).toBe(0);
    expect(view.getUint32(12, false)).toBe(0);
  });

  it('actually compresses repetitive data', () => {
    const data = Uint8Array.from({ length: 60000 }, (_, i) => i % 64);
    expect(encodeYaz0(data).length).toBeLessThan(data.length / 4);
  });

  it('produces a valid stream at every search depth', () => {
    const data = Uint8Array.from({ length: 30000 }, (_, i) => (i % 300 < 250 ? i % 11 : (i * 17) & 0xff));
    for (const searchDepth of [0, 1, 8, 64]) {
      const encoded = encodeYaz0(data, { searchDepth });
      expect([...decodeYaz0(encoded)], `depth ${searchDepth}`).toEqual([...data]);
    }
  });

  it('still supports the literal-only encoder', () => {
    const data = new TextEncoder().encode('literal only');
    const encoded = encodeYaz0Uncompressed(data);
    expect(isYaz0(encoded)).toBe(true);
    expect([...decodeYaz0(encoded)]).toEqual([...data]);
  });
});

describe('U8', () => {
  it('round-trips a small archive and keeps the entry order', () => {
    const entries: U8Entry[] = [
      { path: 'course.kmp', type: 'file', data: Uint8Array.from([1, 2, 3]) },
      { path: 'aaa.brres', type: 'file', data: Uint8Array.from([9]) },
      { path: 'objects', type: 'directory' },
      { path: 'objects/itembox.brres', type: 'file', data: Uint8Array.from([4, 5]) },
    ];
    const parsed = parseU8(buildU8(entries));
    expect(parsed.map((entry) => entry.path)).toEqual(['course.kmp', 'aaa.brres', 'objects', 'objects/itembox.brres']);
    expect(fileTable(parsed)).toEqual([
      ['course.kmp', 3],
      ['aaa.brres', 1],
      ['objects/itembox.brres', 2],
    ]);
  });

  it('aligns file data to 32 bytes', () => {
    const archive = buildU8([
      { path: 'a.bin', type: 'file', data: new Uint8Array(33) },
      { path: 'b.bin', type: 'file', data: new Uint8Array(5) },
    ]);
    const view = new DataView(archive.buffer);
    const rootOffset = view.getUint32(4, false);
    const nodeCount = view.getUint32(rootOffset + 8, false);
    for (let i = 1; i < nodeCount; i++) {
      const node = rootOffset + i * 12;
      if (view.getUint32(node, false) >>> 24 === 1) continue;
      expect(view.getUint32(node + 4, false) % 0x20).toBe(0);
    }
  });

  it('rejects data that is not a U8 archive', () => {
    expect(() => parseU8(new Uint8Array(64))).toThrow(/Not a U8 archive/);
  });
});

const realTracks = [...listTracks(CUSTOM_TRACK_DIR, 8), ...listTracks(NINTENDO_TRACK_DIR, 4)];

describe.runIf(realTracks.length > 0)('repacking real tracks', () => {
  it('rebuilds an untouched archive byte-for-byte', () => {
    let checked = 0;
    for (const path of realTracks) {
      const raw = readTrackBytes(path);
      const decoded = decodeYaz0(raw);
      const { entries, layout } = parseU8WithLayout(decoded);
      const rebuilt = buildU8(entries, layout);
      expect(rebuilt.length, path).toBe(decoded.length);
      expect(sameBytes(rebuilt, decoded), path).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('keeps the file table and every untouched file identical after an export', async () => {
    for (const path of realTracks) {
      const raw = readTrackBytes(path);
      const original = parseU8(decodeYaz0(raw));
      const track = await loadTrackBytes(raw, path.split(/[\\/]/).pop() ?? 'track.szs', { brresSummaryLimit: 0 });

      const exported = exportTrack(track);
      expect(isYaz0(exported), path).toBe(true);
      const repacked = parseU8(decodeYaz0(exported));

      expect(fileTable(repacked), path).toEqual(fileTable(original));
      for (const entry of original) {
        if (entry.type !== 'file') continue;
        const match = repacked.find((candidate) => candidate.path === entry.path);
        expect(sameBytes(match?.data, entry.data), `${path}: ${entry.path}`).toBe(true);
      }
    }
  }, 240000);

  it('replaces only course.kmp when the track data changes', async () => {
    const path = realTracks[0];
    const raw = readTrackBytes(path);
    const original = parseU8(decodeYaz0(raw));
    const track = await loadTrackBytes(raw, 'track.szs', { brresSummaryLimit: 0 });
    expect(track.kmpFile).toBeTruthy();

    // Nudge the first start position, which must change course.kmp and nothing else.
    const edited = { ...track.kmpFile! };
    edited.startPoints = edited.startPoints.map((point, index) =>
      index === 0 ? { ...point, position: { ...point.position, y: point.position.y + 250 } } : point,
    );
    const updated = replaceCourseKmp(track, writeKmpFile(edited));
    const repacked = parseU8(decodeYaz0(exportTrack(updated)));

    expect(fileTable(repacked).map(([name]) => name)).toEqual(fileTable(original).map(([name]) => name));
    for (const entry of original) {
      if (entry.type !== 'file') continue;
      const match = repacked.find((candidate) => candidate.path === entry.path);
      const isKmp = entry.path.toLowerCase().endsWith('course.kmp');
      expect(sameBytes(match?.data, entry.data), `${entry.path} (kmp=${isKmp})`).toBe(!isKmp);
    }

    const reread = readKmpFile(repacked.find((entry) => entry.path.toLowerCase().endsWith('course.kmp'))!.data!);
    expect(reread.startPoints[0].position.y).toBeCloseTo(track.kmpFile!.startPoints[0].position.y + 250, 3);
  }, 120000);

  it('exports an archive the editor can re-open without new problems', async () => {
    for (const path of realTracks.slice(0, 4)) {
      const track = await loadTrackBytes(readTrackBytes(path), 'track.szs', { brresSummaryLimit: 0 });
      const before = validateTrack(track).map((issue) => `${issue.level}:${issue.code}:${issue.entityId ?? ''}`);
      const after = validateExportBytes(track, exportTrack(track)).map((issue) => `${issue.level}:${issue.code}:${issue.entityId ?? ''}`);
      expect(after.filter((issue) => !before.includes(issue)), path).toEqual([]);
    }
  }, 240000);

  it('compresses about as well as the original archives', async () => {
    for (const path of realTracks) {
      const raw = readTrackBytes(path);
      const decoded = decodeYaz0(raw);
      const recompressed = encodeYaz0(decoded);
      expect(recompressed.length, path).toBeLessThan(decoded.length);
      // Within 5% of the compressor Nintendo and the CT tools used.
      expect(recompressed.length, path).toBeLessThan(raw.length * 1.05);
      const roundTripped = decodeYaz0(recompressed);
      expect(roundTripped.length, path).toBe(decoded.length);
      expect(sameBytes(roundTripped, decoded), path).toBe(true);
    }
  }, 240000);
});
