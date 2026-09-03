/**
 * Shared helpers for the BRRES writer tests. Test-only and Node-only.
 *
 * Everything here works off the real `.szs` archives on this machine; the tests that use it skip
 * themselves when those folders are not present.
 */

import { decodeYaz0 } from '../yaz0';
import { parseU8 } from '../u8';
import { CUSTOM_TRACK_DIR, NINTENDO_TRACK_DIR, findCommonArchive, listTracks, readTrackBytes } from '../realTrackFixtures.testdata';
import { readFileSync } from 'node:fs';
import { BRRES_MODELS_GROUP, makeSubFileNameReader, readBrresRaw } from './brresRaw';
import { Mdl0Editor } from './mdl0Raw';
import { collectDrawOps, type DrawOpRef } from './meshBake';

export interface CourseModelFixture {
  /** Track file name, for test titles. */
  track: string;
  /** Raw `course_model.brres` bytes. */
  data: Uint8Array;
}

/** Up to `limit` `course_model.brres` files from each track folder. */
export function listCourseModels(limit = 4): CourseModelFixture[] {
  const out: CourseModelFixture[] = [];
  for (const path of [...listTracks(CUSTOM_TRACK_DIR, limit), ...listTracks(NINTENDO_TRACK_DIR, limit)]) {
    try {
      const entries = parseU8(decodeYaz0(readTrackBytes(path)));
      const courseModel = entries.find(
        (entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('course_model.brres'),
      );
      if (courseModel?.data) out.push({ track: path.split(/[\\/]/).pop() ?? path, data: courseModel.data });
    } catch {
      // A track this editor cannot even unpack is not this suite's problem.
    }
  }
  return out;
}

/** An object BRRES out of `Common.szs`, used as the "imported model" in the merge tests. */
export function findObjectBrres(preferred: readonly string[]): { name: string; data: Uint8Array } | null {
  const commonPath = findCommonArchive();
  if (!commonPath) return null;
  let entries;
  try {
    entries = parseU8(decodeYaz0(new Uint8Array(readFileSync(commonPath))));
  } catch {
    return null;
  }
  const files = entries.filter((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('.brres') && entry.data);
  for (const wanted of preferred) {
    const match = files.find((entry) => entry.path.toLowerCase().endsWith(`/${wanted.toLowerCase()}`) || entry.path.toLowerCase() === wanted.toLowerCase());
    if (match?.data) return { name: wanted, data: match.data };
  }
  const fallback = files.find((entry) => (entry.data?.length ?? 0) > 4096);
  return fallback?.data ? { name: fallback.path.split('/').pop() ?? fallback.path, data: fallback.data } : null;
}

export function openCourseModel(brres: Uint8Array): { editor: Mdl0Editor; modelName: string } {
  const raw = readBrresRaw(brres);
  const group = raw.groups.find((candidate) => candidate.name === BRRES_MODELS_GROUP);
  const subFile = group?.entries[0];
  if (!subFile) throw new Error('fixture has no MDL0');
  return { editor: new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile)), modelName: subFile.name };
}

export function drawOpsOf(brres: Uint8Array): DrawOpRef[] {
  return collectDrawOps(openCourseModel(brres).editor);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Index of the first differing byte, or -1 when the two buffers are identical. */
export function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : shared;
}

/**
 * Re-parses an archive with the vendored noclip BRRES reader — the same code the viewport uses,
 * and a completely independent implementation of the format from the writer under test.
 */
export async function parseWithNoclip(data: Uint8Array): Promise<{ mdl0: any[]; tex0: any[] }> {
  const [{ default: ArrayBufferSlice }, BRRES] = await Promise.all([
    // @ts-ignore vendored noclip source sits outside this app's tsconfig surface.
    import('../../../vendor/noclip.website/src/ArrayBufferSlice.js'),
    // @ts-ignore vendored noclip source sits outside this app's tsconfig surface.
    import('../../../vendor/noclip.website/src/rres/brres.js'),
  ]);
  const copy = data.slice();
  return BRRES.parse(new ArrayBufferSlice(copy.buffer, copy.byteOffset, copy.byteLength));
}
