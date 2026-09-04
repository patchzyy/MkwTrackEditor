// What the Model Studio opens and what it writes back.
//
// The claim that matters is the round trip: a file the studio did not edit exports byte for byte
// what was opened, and an edited archive still reproduces every file the studio did not touch.
// Both are checked against the archives that ship in `public/`, so they have teeth on CI
// (`MKW_TEST_FIXTURES=bundled`) as well as on a machine with the real game data.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseU8 } from '../../lib/u8';
import { decodeYaz0, encodeYaz0, isYaz0 } from '../../lib/yaz0';
import {
  describeStudioDocument,
  exportStudioBrres,
  exportStudioDocument,
  findStudioBrres,
  isBrresBytes,
  isU8Bytes,
  openStudioDocument,
  replaceStudioBrres,
  sortStudioBrresFiles,
  StudioOpenError,
  studioBrresLabel,
} from './studioDocument';

const PREVIEW_DUMMIES = 'public/data/MarioKartWii/Race/PreviewDummies.u8';
const COMMON_SZS = 'public/data/MarioKartWii/Race/Common.szs';

function readBundled(path: string): Uint8Array | null {
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
}

/** The first `.brres` inside the bundled `Common.szs`, as a bare model archive. */
function bundledObjectBrres(): { name: string; bytes: Uint8Array } | null {
  const common = readBundled(COMMON_SZS);
  if (common === null) return null;
  const entries = parseU8(decodeYaz0(common));
  const entry = entries.find((candidate) => candidate.type === 'file' && candidate.path.toLowerCase().endsWith('.brres') && candidate.data);
  return entry?.data ? { name: entry.path.split('/').pop() ?? entry.path, bytes: entry.data } : null;
}

describe('studio document: naming and detection', () => {
  it('recognises the containers it can open', () => {
    expect(isBrresBytes(new Uint8Array([0x62, 0x72, 0x65, 0x73, 0xfe, 0xff, ...new Array(20).fill(0)]))).toBe(true);
    expect(isBrresBytes(new Uint8Array([0x55, 0xaa, 0x38, 0x2d]))).toBe(false);
    expect(isU8Bytes(new Uint8Array([0x55, 0xaa, 0x38, 0x2d, ...new Array(40).fill(0)]))).toBe(true);
    expect(isU8Bytes(new Uint8Array(8))).toBe(false);
  });

  it('labels an archive path the way a person would say it', () => {
    expect(studioBrresLabel('Preview/fk_lb_driver_model.brres')).toBe('fk_lb_driver_model');
    expect(studioBrresLabel('course_model.brres')).toBe('course_model');
    expect(studioBrresLabel('kart_model')).toBe('kart_model');
  });

  it('orders a character archive driver first, kart second', () => {
    const files = sortStudioBrresFiles([
      { path: 'kart_model.brres', label: 'kart_model', bytes: new Uint8Array() },
      { path: 'driver_model.brres', label: 'driver_model', bytes: new Uint8Array() },
      { path: 'vrcorn_model.brres', label: 'vrcorn_model', bytes: new Uint8Array() },
    ]);
    expect(files.map((file) => file.label)).toEqual(['driver_model', 'kart_model', 'vrcorn_model']);
  });

  it('refuses a file that is not a model archive, in words a status line can show', () => {
    expect(() => openStudioDocument('notes.txt', new Uint8Array([1, 2, 3, 4]))).toThrow(StudioOpenError);
    expect(() => openStudioDocument('empty.szs', new Uint8Array())).toThrow(/empty/);
  });
});

describe.runIf(existsSync(PREVIEW_DUMMIES))('studio document: the bundled preview archive', () => {
  const bytes = readBundled(PREVIEW_DUMMIES)!;

  it('opens as a U8 archive with the driver and the kart in it', () => {
    const doc = openStudioDocument('PreviewDummies.u8', bytes);
    expect(doc.kind).toBe('u8');
    expect(doc.compressed).toBe(false);
    expect(doc.dirty).toBe(false);
    expect(doc.brresFiles.map((file) => file.path)).toEqual([
      'Preview/fk_lb_driver_model.brres',
      'Preview/fk_lb_kart_model.brres',
    ]);
    expect(describeStudioDocument(doc)).toBe('archive · 2 model files');
  });

  it('exports an untouched archive byte for byte', () => {
    const doc = openStudioDocument('PreviewDummies.u8', bytes);
    const exported = exportStudioDocument(doc);
    expect(exported.fileName).toBe('PreviewDummies.u8');
    expect(exported.bytes).toEqual(bytes);
  });

  it('rebuilds the archive after an edit, leaving every other file identical', () => {
    const doc = openStudioDocument('PreviewDummies.u8', bytes);
    const driver = findStudioBrres(doc, 'Preview/fk_lb_driver_model.brres')!;
    // A one-byte change deep inside the BRRES: enough to make the file different, small enough
    // that the archive layout is unchanged, which is exactly the case the layout capture is for.
    const edited = driver.bytes.slice();
    edited[edited.length - 1] ^= 0xff;

    const next = replaceStudioBrres(doc, driver.path, edited);
    expect(next).not.toBe(doc);
    expect(next.dirty).toBe(true);
    expect(describeStudioDocument(next)).toBe('archive · 2 model files · edited');

    const rebuilt = exportStudioDocument(next).bytes;
    expect(rebuilt.byteLength).toBe(bytes.byteLength);

    const before = parseU8(bytes);
    const after = parseU8(rebuilt);
    expect(after.map((entry) => entry.path)).toEqual(before.map((entry) => entry.path));
    for (const entry of after) {
      const original = before.find((candidate) => candidate.path === entry.path)!;
      if (entry.path === driver.path) expect(entry.data).toEqual(edited);
      else expect(entry.data).toEqual(original.data);
    }
  });

  it('ignores a replacement for a path it does not have', () => {
    const doc = openStudioDocument('PreviewDummies.u8', bytes);
    expect(replaceStudioBrres(doc, 'Preview/nope.brres', new Uint8Array([1]))).toBe(doc);
  });

  it('exports one model out of the archive as a standalone .brres', () => {
    const doc = openStudioDocument('PreviewDummies.u8', bytes);
    const single = exportStudioBrres(doc, 'Preview/fk_lb_kart_model.brres')!;
    expect(single.fileName).toBe('fk_lb_kart_model.brres');
    expect(isBrresBytes(single.bytes)).toBe(true);
    expect(exportStudioBrres(doc, 'Preview/nope.brres')).toBeNull();
  });

  it('opens a Yaz0-compressed archive and exports the same compressed stream back', () => {
    const compressed = encodeYaz0(bytes);
    expect(isYaz0(compressed)).toBe(true);
    const doc = openStudioDocument('PreviewDummies.szs', compressed);
    expect(doc.kind).toBe('szs');
    expect(doc.compressed).toBe(true);
    expect(doc.brresFiles).toHaveLength(2);
    expect(exportStudioDocument(doc).bytes).toEqual(compressed);
  });
});

describe.runIf(bundledObjectBrres() !== null)('studio document: a bare .brres', () => {
  const object = bundledObjectBrres()!;

  it('opens with the file itself as its one model archive', () => {
    const doc = openStudioDocument(object.name, object.bytes);
    expect(doc.kind).toBe('brres');
    expect(doc.entries).toBeNull();
    expect(doc.brresFiles).toHaveLength(1);
    expect(doc.brresFiles[0].bytes).toEqual(object.bytes);
  });

  it('exports what was opened, edited or not', () => {
    const doc = openStudioDocument(object.name, object.bytes);
    expect(exportStudioDocument(doc).bytes).toEqual(object.bytes);

    const edited = object.bytes.slice();
    edited[edited.length - 1] ^= 0xff;
    const next = replaceStudioBrres(doc, doc.brresFiles[0].path, edited);
    expect(exportStudioDocument(next).bytes).toEqual(edited);
  });

  it('remembers where a track archive came from', () => {
    const doc = openStudioDocument('course_model.brres', object.bytes, {
      kind: 'track',
      archivePath: 'course_model.brres',
      trackName: 'Z0.szs',
    });
    expect(doc.origin).toEqual({ kind: 'track', archivePath: 'course_model.brres', trackName: 'Z0.szs' });
  });
});
