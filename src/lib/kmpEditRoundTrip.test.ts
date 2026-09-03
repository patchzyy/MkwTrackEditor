/**
 * End-to-end round trip for the KMP editing path, on the real tracks installed on this machine.
 *
 * Every edit the KMP mode makes goes `readKmpFile -> pure kmpGraph edit -> writeKmpFile`. This
 * checks that over a large batch of real tracks:
 *   1. an untouched write is byte-identical,
 *   2. an edited write re-parses to exactly the model that was written, and
 *   3. the edits leave the path graphs structurally valid.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  KMP_NULL_INDEX_8,
  readKmpFile,
  writeKmpFile,
  type KmpFile,
} from './kmpFile';
import {
  assignNearestRespawns,
  createEnemyPoint,
  editPathGraph,
  getCheckpointGraph,
  getEnemyPathGraph,
  insertPoint,
  linkGroups,
  pathGroups,
  renumberKeyCheckpoints,
  setCheckpointGraph,
  splitGroupAtPoint,
  unlinkGroups,
  validatePathGraph,
} from './kmpGraph';
import { validateKmpFile } from './kmpValidation';
import { parseU8 } from './u8';
import { decodeYaz0, isYaz0 } from './yaz0';
import { CUSTOM_TRACK_DIR, NINTENDO_TRACK_DIR, listTracks, readTrackBytes } from './realTrackFixtures.testdata';

const tracks = [...listTracks(CUSTOM_TRACK_DIR), ...listTracks(NINTENDO_TRACK_DIR)];

function readCourseKmp(path: string): Uint8Array | null {
  const raw = readTrackBytes(path);
  const data = isYaz0(raw) ? decodeYaz0(raw) : raw;
  const entry = parseU8(data).find((candidate) => candidate.type === 'file' && candidate.path.toLowerCase().endsWith('course.kmp'));
  return entry && entry.type === 'file' ? entry.data : null;
}

/** The same sequence of edits the outliner's buttons make, applied wherever they apply. */
function applyEditorEdits(file: KmpFile): KmpFile {
  let next = file;

  // Insert an enemy point in the middle of the first group.
  const enemyGroups = pathGroups(next, 'ENPT');
  if (enemyGroups.length > 0 && enemyGroups[0].length >= 2) {
    const template = next.enemyPoints[enemyGroups[0].start];
    const point = createEnemyPoint({ x: template.position.x + 5, y: template.position.y, z: template.position.z }, template);
    next = editPathGraph(next, 'ENPT', (graph) => insertPoint(graph, 0, 0, point as never, 'after'));
  }

  // Split the first enemy group in two, then wire the halves back together the long way.
  const afterInsert = pathGroups(next, 'ENPT');
  if (afterInsert.length > 0 && afterInsert[0].length >= 3) {
    next = editPathGraph(next, 'ENPT', (graph) => splitGroupAtPoint(graph, 0, 1));
    next = editPathGraph(next, 'ENPT', (graph) => {
      const linked = linkGroups(graph, 0, 1);
      return unlinkGroups(linked, 0, 1);
    });
    next = editPathGraph(next, 'ENPT', (graph) => linkGroups(graph, 0, 1));
  }

  // Renumber the key checkpoints and fill in any missing respawn assignment.
  if (next.checkpoints.length > 0 && next.checkpointGroups.length > 0) {
    next = setCheckpointGraph(next, renumberKeyCheckpoints(getCheckpointGraph(next)));
  }
  if (next.respawnPoints.length > 0) next = assignNearestRespawns(next, { all: false }).file;

  // Make the first object visible everywhere, exactly like the validation quick fix does.
  if (next.objects.length > 0) {
    next = { ...next, objects: next.objects.map((object, index) => (index === 0 ? { ...object, presenceFlags: (object.presenceFlags & ~0x3f) | 0x3f } : object)) };
  }
  return next;
}

describe.runIf(tracks.length >= 50)(`KMP editing round trip over ${tracks.length} real tracks`, () => {
  // Decompressing 300+ archives is the expensive part, so it happens once for the whole file.
  const courses: Array<{ path: string; bytes: Uint8Array }> = [];
  beforeAll(() => {
    for (const path of tracks) {
      const bytes = readCourseKmp(path);
      if (bytes) courses.push({ path, bytes });
    }
  }, 300_000);

  it('writes every untouched track back byte-for-byte', () => {
    for (const { path, bytes } of courses) {
      const written = writeKmpFile(readKmpFile(bytes));
      expect(written, `${path} changed when written back untouched`).toEqual(bytes);
    }
    expect(courses.length).toBeGreaterThanOrEqual(50);
  }, 120_000);

  it('re-parses an edited track to exactly the model that was written', () => {
    for (const { path, bytes } of courses) {
      const after = applyEditorEdits(readKmpFile(bytes));
      const written = writeKmpFile(after);
      const reparsed = readKmpFile(written);
      // The only thing an edit can lose is float64 precision on a coordinate the moment it is
      // stored as the float32 the format uses, so the fixed point starts at the first write.
      expect(writeKmpFile(reparsed), `${path} lost data on an edit round trip`).toEqual(written);
      expect(readKmpFile(writeKmpFile(reparsed)), `${path} is not stable across two round trips`).toEqual(reparsed);
    }
    expect(courses.length).toBeGreaterThanOrEqual(50);
  }, 120_000);

  it('introduces no new structural problems in the enemy path graph', () => {
    // Real tracks ship with their own one-sided links, so the bar is "no worse", not "clean".
    const structural = (file: KmpFile) =>
      validatePathGraph(getEnemyPathGraph(file))
        .filter((issue) => issue.code === 'path.link-out-of-range' || issue.code === 'path.one-sided-link' || issue.code === 'path.empty-group')
        .map((issue) => issue.code);
    for (const { path, bytes } of courses) {
      const before = readKmpFile(bytes);
      const seen = new Set(structural(before));
      const introduced = structural(applyEditorEdits(before)).filter((code) => !seen.has(code));
      expect(introduced, `${path} gained a broken enemy path link after editing`).toEqual([]);
    }
  }, 120_000);

  it('never makes validation worse than it already was', () => {
    for (const { path, bytes } of courses) {
      const before = readKmpFile(bytes);
      const after = applyEditorEdits(before);
      const errorsBefore = new Set(validateKmpFile(before).filter((issue) => issue.level === 'error').map((issue) => issue.code));
      const errorsAfter = validateKmpFile(after).filter((issue) => issue.level === 'error').map((issue) => issue.code);
      const introduced = errorsAfter.filter((code) => !errorsBefore.has(code));
      expect(introduced, `${path} gained new errors after editing`).toEqual([]);
    }
  }, 120_000);

  it('gives every checkpoint a respawn point when asked to fill them in', () => {
    for (const { path, bytes } of courses) {
      const file = readKmpFile(bytes);
      if (file.respawnPoints.length === 0 || file.checkpoints.length === 0) continue;
      const filled = assignNearestRespawns(file, { all: false }).file;
      for (const checkpoint of filled.checkpoints) {
        expect(checkpoint.respawnIndex, `${path} still has a checkpoint without a respawn point`).not.toBe(KMP_NULL_INDEX_8);
        expect(checkpoint.respawnIndex).toBeLessThan(filled.respawnPoints.length);
      }
    }
  }, 120_000);
});
