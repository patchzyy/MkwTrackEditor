// Container-level round trip: reading a real `course_model.brres` apart and writing it back has
// to reproduce the input byte for byte, or every offset in the file is suspect.

import { describe, expect, it } from 'vitest';
import { readResDic, resDicSize, writeResDic } from './resDic';
import { createStringPool, internString, readStringPool } from './stringPool';
import { BRRES_MODELS_GROUP, makeSubFileNameReader, readBrresRaw, writeBrres } from './brresRaw';
import { Mdl0Editor } from './mdl0Raw';
import { bytesEqual, firstDifference, listCourseModels } from './brresFixtures.testdata';

const fixtures = listCourseModels(6);

describe('NW4R string pool', () => {
  it('appends without moving the entries already handed out', () => {
    const pool = createStringPool();
    const first = internString(pool, 'course');
    const second = internString(pool, 'vrcorn');
    expect(internString(pool, 'course')).toBe(first);
    expect(second).toBeGreaterThan(first);
    const reread = readStringPool(pool.bytes, 0, pool.bytes.length);
    expect(reread.offsets.get('course')).toBe(first);
    expect(reread.offsets.get('vrcorn')).toBe(second);
  });
});

describe('NW4R resource dictionary', () => {
  it('rebuilds the index tree the console searches', () => {
    const names = ['DrawOpa', 'DrawXlu', 'NodeTree', 'course', 'road', 'road_01'];
    // Offset 0 means "no dictionary" in NW4R, so the table goes somewhere real.
    const at = 0x20;
    const buffer = new Uint8Array(at + resDicSize(names.length));
    writeResDic(
      buffer,
      at,
      names.map((name, index) => ({ name, nameOffset: at, dataOffset: at + 0x100 + index })),
    );
    const read = readResDic(buffer, at, () => '');
    expect(read).not.toBeNull();
    expect(read!.entries.map((entry) => entry.dataOffset)).toEqual(names.map((_, index) => at + 0x100 + index));
    expect(read!.size).toBe(resDicSize(names.length));
  });
});

describe.skipIf(fixtures.length === 0)('BRRES container round trip', () => {
  for (const fixture of fixtures) {
    it(`rewrites ${fixture.track} byte-for-byte`, () => {
      const raw = readBrresRaw(fixture.data);
      const out = writeBrres(raw);
      expect(firstDifference(fixture.data, out)).toBe(-1);
    });

    it(`re-emits the MDL0 of ${fixture.track} byte-for-byte`, () => {
      const raw = readBrresRaw(fixture.data);
      const group = raw.groups.find((candidate) => candidate.name === BRRES_MODELS_GROUP);
      expect(group?.entries.length).toBeGreaterThan(0);
      for (const subFile of group!.entries) {
        const model = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile));
        const finished = model.finish();
        // Nothing was edited, so the model must come back out unchanged...
        expect(bytesEqual(finished.data, subFile.data)).toBe(true);
        // ...and every name it points at must be resolvable in the pool it came from.
        for (const ref of finished.stringRefs) expect(raw.pool.offsets.has(ref.value)).toBe(true);
        subFile.data = finished.data;
        subFile.stringRefs = finished.stringRefs;
      }
      // Rewriting with every string pointer re-derived must still land on the original bytes.
      expect(firstDifference(fixture.data, writeBrres(raw))).toBe(-1);
    });
  }

  it('reads the same structure back out of what it wrote', () => {
    const raw = readBrresRaw(fixtures[0].data);
    const rewritten = readBrresRaw(writeBrres(raw));
    expect(rewritten.groups.map((group) => group.name)).toEqual(raw.groups.map((group) => group.name));
    expect(rewritten.layout.map((entry) => entry.name)).toEqual(raw.layout.map((entry) => entry.name));
    expect(rewritten.poolSourceOffset).toBe(raw.poolSourceOffset);
  });

  it('refuses to move a sub-file it cannot re-point at the string pool', () => {
    const raw = readBrresRaw(fixtures[0].data);
    const pinned = raw.layout.find((subFile) => subFile.stringRefs === null);
    if (!pinned) return; // Nothing opaque in this archive; the invariant cannot be violated.
    // Grow the first sub-file without declaring its names: the pool now moves past the pinned one.
    const first = raw.layout[0];
    first.data = new Uint8Array([...first.data, ...new Uint8Array(0x20)]);
    if (first === pinned) return;
    expect(() => writeBrres(raw)).toThrow(/string pool/);
  });
});
