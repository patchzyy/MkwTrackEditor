/**
 * The loader worker hands the finished `TrackDocument` back through `postMessage`, which means
 * every byte of the track crosses a structured clone with the archive buffer *transferred*. If
 * that lost a view's offset, dropped `archiveLayout`, or quietly copied a typed array onto a new
 * buffer, the editor would still look fine and then export a file that is not byte-for-byte the
 * one it opened.
 *
 * So: load a track, clone it the way the worker does, and check the export is identical.
 */

import { describe, expect, it } from 'vitest';
import { buildU8, type U8Entry } from './u8';
import { encodeYaz0 } from './yaz0';
import { exportTrack, loadTrackBytes, type TrackDocument } from './track';
import { loadTrackOnThisThread } from './trackLoader';
import { collectTransferables } from './trackLoaderProtocol';
import { CUSTOM_TRACK_DIR, NINTENDO_TRACK_DIR, listTracks, readTrackBytes } from './realTrackFixtures.testdata';
import type { TrackLoadProgress } from './trackLoadProgress';

/** A hand-built KMP with one start point and one stage record. Enough to fill `kmpFile`. */
function buildTestKmp(): Uint8Array {
  const headerSize = 0x18;
  const ktptRecord = 0x1c;
  const stgiRecord = 0x0c;
  const total = headerSize + 8 + ktptRecord + 8 + stgiRecord;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };

  ascii(0, 'RKMD');
  view.setUint32(0x04, total);
  view.setUint16(0x08, 2);
  view.setUint16(0x0a, headerSize);
  view.setUint32(0x0c, 0x9d8);
  view.setUint32(0x10, 0);
  view.setUint32(0x14, 8 + ktptRecord);

  const ktpt = headerSize;
  ascii(ktpt, 'KTPT');
  view.setUint16(ktpt + 4, 1);
  const record = ktpt + 8;
  view.setFloat32(record + 0x00, 1000);
  view.setFloat32(record + 0x04, 250);
  view.setFloat32(record + 0x08, -4000);
  view.setInt16(record + 0x18, -1);

  const stgi = record + ktptRecord;
  ascii(stgi, 'STGI');
  view.setUint16(stgi + 4, 1);
  bytes[stgi + 8] = 3;
  return bytes;
}

/** A KCL with a real header and one prism, so `kcl.source` is a genuine view into the archive. */
function buildTestKcl(): Uint8Array {
  const positionOffset = 0x3c;
  const normalOffset = positionOffset + 12;
  const prismOffset = normalOffset + 12;
  const blockOffset = prismOffset + 0x20;
  const bytes = new Uint8Array(blockOffset + 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0x00, positionOffset);
  view.setUint32(0x04, normalOffset);
  // The prism section is addressed from "one record before the first prism".
  view.setUint32(0x08, prismOffset - 0x10);
  view.setUint32(0x0c, blockOffset);
  view.setFloat32(0x10, 100);
  view.setFloat32(0x24, 0);
  view.setUint32(0x38, 0);
  view.setFloat32(positionOffset + 0, 0);
  view.setFloat32(positionOffset + 4, 0);
  view.setFloat32(positionOffset + 8, 0);
  view.setFloat32(normalOffset + 0, 0);
  view.setFloat32(normalOffset + 4, 1);
  view.setFloat32(normalOffset + 8, 0);
  return bytes;
}

function syntheticTrack(): Uint8Array {
  const entries: U8Entry[] = [
    { type: 'file', path: './course.kmp', data: buildTestKmp() },
    { type: 'file', path: './course.kcl', data: buildTestKcl() },
    { type: 'file', path: './course_model.brres', data: Uint8Array.from({ length: 512 }, (_, i) => (i * 31) & 0xff) },
  ];
  return encodeYaz0(buildU8(entries), { searchDepth: 1 });
}

/**
 * Exactly what `worker.postMessage(track, collectTransferables(track))` does: a structured clone
 * with every reachable `ArrayBuffer` moved rather than copied.
 */
function throughTheWorkerBoundary(track: TrackDocument): TrackDocument {
  const transfer = collectTransferables(track) as ArrayBuffer[];
  return structuredClone(track, { transfer });
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const realTrack =
  listTracks(NINTENDO_TRACK_DIR, 1)[0] ?? listTracks(CUSTOM_TRACK_DIR, 1)[0] ?? null;

describe('the worker boundary', () => {
  it('finds the buffers to move instead of copying them', async () => {
    const track = await loadTrackBytes(syntheticTrack(), 'synthetic.szs', { brresSummaryLimit: 0 });
    const transfer = collectTransferables(track);
    expect(transfer.length).toBeGreaterThan(0);
    expect(transfer.every((buffer) => buffer instanceof ArrayBuffer)).toBe(true);
    // Distinct buffers only: listing one twice makes `postMessage` throw.
    expect(new Set(transfer).size).toBe(transfer.length);
  });

  it('exports byte-for-byte the same archive after a transferring structured clone', async () => {
    const raw = syntheticTrack();
    const track = await loadTrackBytes(raw, 'synthetic.szs', { brresSummaryLimit: 0 });
    const before = exportTrack(track);

    const cloned = throughTheWorkerBoundary(track);
    const after = exportTrack(cloned);

    expect(after.length).toBe(before.length);
    expect(bytesEqual(after, before)).toBe(true);
    expect(raw.length).toBeGreaterThan(0);
  });

  it('keeps everything the editor reads off the document', async () => {
    const track = await loadTrackBytes(syntheticTrack(), 'synthetic.szs', { brresSummaryLimit: 0 });
    // The transfer detaches the source, so snapshot what has to survive before crossing over.
    const expected = {
      fileName: track.fileName,
      sourceId: track.sourceId,
      entryCount: track.archiveEntries.length,
      brresFiles: [...track.brresFiles],
      warnings: [...track.warnings],
      alignment: track.archiveLayout?.alignment,
      stringTable: track.archiveLayout?.stringTable ? [...track.archiveLayout.stringTable] : undefined,
      entities: track.kmp?.entities.length,
      startPoints: track.kmpFile?.startPoints.length,
      lapCount: track.kmpFile?.stageInfo?.lapCount,
      triangles: track.kcl?.triangles.length,
      kclSourceLength: track.kcl?.source?.byteLength,
      fileTable: track.archiveEntries.map((entry) => [entry.path, entry.data?.length ?? -1] as const),
    };

    const cloned = throughTheWorkerBoundary(track);

    expect(cloned.fileName).toBe(expected.fileName);
    expect(cloned.sourceId).toBe(expected.sourceId);
    expect(cloned.compressed).toBe(true);
    expect(cloned.archiveEntries.length).toBe(expected.entryCount);
    expect(cloned.brresFiles).toEqual(expected.brresFiles);
    expect(cloned.warnings).toEqual(expected.warnings);
    // Same paths and, crucially, the same view lengths: a lost byteOffset would show up here.
    expect(cloned.archiveEntries.map((entry) => [entry.path, entry.data?.length ?? -1])).toEqual(
      expected.fileTable.map((row) => [...row]),
    );
    // The layout is what makes an untouched archive repack byte-for-byte.
    expect(cloned.archiveLayout?.alignment).toBe(expected.alignment);
    expect(cloned.archiveLayout?.stringTable ? [...cloned.archiveLayout.stringTable] : undefined).toEqual(
      expected.stringTable,
    );
    // KMP: both the display document and the round-trippable file view.
    expect(cloned.kmp?.entities.length).toBe(expected.entities);
    expect(cloned.kmpFile?.startPoints.length).toBe(expected.startPoints);
    expect(cloned.kmpFile?.stageInfo?.lapCount).toBe(expected.lapCount);
    // KCL, including the raw bytes the octree queries need.
    expect(cloned.kcl?.triangles.length).toBe(expected.triangles);
    expect(cloned.kcl?.source?.byteLength).toBe(expected.kclSourceLength);
  });

  it('leaves the clone independent of the original buffer', async () => {
    const track = await loadTrackBytes(syntheticTrack(), 'synthetic.szs', { brresSummaryLimit: 0 });
    const cloned = throughTheWorkerBoundary(track);
    // The transfer detaches the source, which is the point: the worker's copy is gone.
    const sourceEntry = track.archiveEntries.find((entry) => entry.data);
    expect(sourceEntry?.data?.byteLength).toBe(0);
    expect(cloned.archiveEntries.find((entry) => entry.data)?.data?.byteLength).toBeGreaterThan(0);
  });

  it.skipIf(!realTrack)('is byte-exact on a real track too', async () => {
    const raw = readTrackBytes(realTrack!);
    const name = realTrack!.split(/[\\/]/).pop()!;
    const track = await loadTrackBytes(raw, name, { brresSummaryLimit: 0 });
    const before = exportTrack(track);
    const after = exportTrack(throughTheWorkerBoundary(track));
    expect(after.length).toBe(before.length);
    expect(bytesEqual(after, before)).toBe(true);
  }, 60_000);
});

describe('loadTrackOnThisThread', () => {
  it('reports monotonic progress through every stage and builds the project state', async () => {
    const seen: TrackLoadProgress[] = [];
    const { track, projectState } = await loadTrackOnThisThread(syntheticTrack(), 'synthetic.szs', {
      brresSummaryLimit: 0,
      onProgress: (progress) => seen.push(progress),
    });

    expect(track.fileName).toBe('synthetic.szs');
    expect(projectState.archives).toBeDefined();
    expect(seen.map((entry) => entry.stage)).toEqual(
      expect.arrayContaining(['decompressing', 'archive', 'layout', 'collision', 'project']),
    );
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].fraction).toBeGreaterThanOrEqual(seen[i - 1].fraction);
    }
    expect(seen[seen.length - 1].fraction).toBeLessThanOrEqual(1);
    for (const entry of seen) {
      // Overlay text, so: a sentence, no section codes.
      expect(entry.label.length).toBeGreaterThan(8);
      expect(entry.label).not.toMatch(/KMP|KCL|U8|BRRES|Yaz0/);
    }
  });

  it('stops when the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadTrackOnThisThread(syntheticTrack(), 'synthetic.szs', { brresSummaryLimit: 0, signal: controller.signal }),
    ).rejects.toThrow();
  });
});
