/**
 * The fast subset of the whole-pipeline batch check.
 *
 * `scripts/batch-track-check.mjs` runs the same `checkTrackPipeline` over all ~338 real tracks
 * on this machine; this keeps a handful of them in the normal `vitest` run so a regression in
 * the load → edit → export → re-open path is caught without anyone remembering to run a script.
 *
 * Skips itself when the track folders are not mounted.
 */

import { describe, expect, it } from 'vitest';
import {
  applyCameraModeEdit,
  checkTrackPipeline,
  planMeshModeEdit,
  planTextureModeEdit,
  summarizeBatch,
  type TrackCheckResult,
} from './trackPipelineCheck';
import { KMP_NULL_INDEX_8, readKmpFile } from '../kmpFile';
import { loadTrackBytes } from '../track';
import { parseU8 } from '../u8';
import { decodeYaz0 } from '../yaz0';
import { CUSTOM_TRACK_DIR, NINTENDO_TRACK_DIR, listTracks, readTrackBytes } from '../realTrackFixtures.testdata';

// Three of each: enough to cover a custom port and a retail track without making `vitest` slow.
const trackPaths = [...listTracks(CUSTOM_TRACK_DIR, 3), ...listTracks(NINTENDO_TRACK_DIR, 3)];
const nameOf = (path: string) => path.split(/[\\/]/).pop() as string;

describe.skipIf(trackPaths.length === 0)('whole-pipeline check on real tracks', () => {
  const results: TrackCheckResult[] = [];

  for (const path of trackPaths) {
    const fileName = nameOf(path);

    it(`${fileName}: loads, exports unedited byte-for-byte, survives an edit from every mode, and re-opens`, async () => {
      const result = await checkTrackPipeline(readTrackBytes(path), fileName, {
        // Depth 1 still proves the codec is lossless and keeps the suite quick; the batch script
        // runs the product's real depth of 16.
        compressionSearchDepth: 1,
        parseWithNoclip: true,
      });
      results.push(result);

      // Print the whole stage list on failure rather than just the first assertion.
      expect(result.failures, `${fileName}\n  ${result.failures.join('\n  ')}`).toEqual([]);
      expect(result.ok).toBe(true);

      // The check is only meaningful if it actually did the work.
      const ran = new Set(result.stages.filter((stage) => stage.status === 'pass').map((stage) => stage.name));
      expect(ran).toContain('load');
      expect(ran).toContain('export-unedited-identical');
      expect(ran).toContain('yaz0-roundtrip');
      expect(ran).toContain('kmp-mode-edit');
      expect(ran).toContain('export-edited');
      expect(ran).toContain('reopen-edited');
      expect(ran).toContain('noclip-reparse');
    }, 120_000);
  }

  it('summarises the batch it just ran', () => {
    const summary = summarizeBatch(results, 0);
    expect(summary.total).toBe(results.length);
    expect(summary.failed).toBe(0);
    expect(summary.failing).toEqual([]);
  });
});

describe.skipIf(trackPaths.length === 0)('the representative per-mode edits', () => {
  const path = trackPaths[0];

  it('builds an opening camera chain that terminates instead of looping', () => {
    const archive = parseU8(decodeYaz0(readTrackBytes(path)));
    const kmp = archive.find((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('course.kmp'))?.data;
    expect(kmp).toBeTruthy();

    const file = readKmpFile(kmp as Uint8Array);
    if (file.cameras.length < 2) return;
    const after = applyCameraModeEdit(file);

    // Walking the chain from the header has to reach the end, visiting no camera twice.
    const seen = new Set<number>();
    let cursor = after.firstOpeningCamera;
    while (cursor !== KMP_NULL_INDEX_8 && cursor < after.cameras.length) {
      expect(seen.has(cursor), 'the opening chain loops').toBe(false);
      seen.add(cursor);
      cursor = after.cameras[cursor].nextIndex;
    }
    expect(seen.size).toBe(2);
  });

  it('only ever moves a shape that no other draw call shares', async () => {
    const track = await loadTrackBytes(readTrackBytes(path), nameOf(path), { brresSummaryLimit: 0 });
    const courseModel = track.archiveEntries.find(
      (entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('course_model.brres'),
    )?.data;
    if (!courseModel) return;

    const plan = planMeshModeEdit(courseModel);
    if (plan.skipReason) return;
    // A moved shape and a deleted shape, never the same one.
    expect(plan.edits).toHaveLength(2);
    expect(plan.edits[0].target.shapeIndex).not.toBe(plan.edits[1].target.shapeIndex);
    expect(plan.edits[1].deleted).toBe(true);
    expect(plan.importedMeshes).toHaveLength(1);
  }, 60_000);

  it('encodes a texture replacement that fits the space the original reserved', async () => {
    const track = await loadTrackBytes(readTrackBytes(path), nameOf(path), { brresSummaryLimit: 0 });
    const plan = planTextureModeEdit(track);
    if ('skipReason' in plan) return;

    expect(plan.patched.byteLength).toBe(
      track.archiveEntries.find((entry) => entry.type === 'file' && entry.path === plan.archivePath)?.data?.byteLength,
    );
    expect(plan.pixelData.byteLength).toBeGreaterThan(0);
  }, 60_000);
});
