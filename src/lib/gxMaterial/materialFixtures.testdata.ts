/**
 * Material fixtures: every MDL0 material this machine has to hand.
 *
 * `Common.szs` ships with the editor, so the object archives are always available; the course
 * models come from the real track folders and are simply absent on a machine that has none.
 * Test-only and Node-only.
 */

import { readFileSync } from 'node:fs';
import { decodeYaz0 } from '../yaz0';
import { parseU8 } from '../u8';
import { CUSTOM_TRACK_DIR, NINTENDO_TRACK_DIR, findCommonArchive, listTracks, readTrackBytes } from '../realTrackFixtures.testdata';
import { BRRES_MODELS_GROUP, makeSubFileNameReader, readBrresRaw } from '../brres/brresRaw';
import { Mdl0Editor } from '../brres/mdl0Raw';

export interface ArchiveFixture {
  /** Something short and stable for the test title. */
  label: string;
  data: Uint8Array;
}

export interface MaterialFixture extends ArchiveFixture {
  modelName: string;
  materialName: string;
}

/** BRRES archives out of `Common.szs`; always present, since it ships with the editor. */
export function listObjectArchives(limit = 6): ArchiveFixture[] {
  const commonPath = findCommonArchive();
  if (!commonPath) return [];
  let entries;
  try {
    entries = parseU8(decodeYaz0(new Uint8Array(readFileSync(commonPath))));
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('.brres') && (entry.data?.length ?? 0) > 4096)
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((entry) => ({ label: `Common/${entry.path.split('/').pop()}`, data: entry.data! }));
}

/** `course_model.brres` out of up to `limit` tracks from each folder. */
export function listCourseArchives(limit = 4): ArchiveFixture[] {
  const out: ArchiveFixture[] = [];
  for (const path of [...listTracks(CUSTOM_TRACK_DIR, limit), ...listTracks(NINTENDO_TRACK_DIR, limit)]) {
    try {
      const entries = parseU8(decodeYaz0(readTrackBytes(path)));
      const model = entries.find((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('course_model.brres'));
      if (model?.data) out.push({ label: path.split(/[\\/]/).pop() ?? path, data: model.data });
    } catch {
      // A track this editor cannot unpack is not this suite's problem.
    }
  }
  return out;
}

export function listMaterialArchives(courseLimit = 4, objectLimit = 6): ArchiveFixture[] {
  return [...listCourseArchives(courseLimit), ...listObjectArchives(objectLimit)];
}

/** Every (model, material) pair in an archive, skipping models the MDL0 reader cannot open. */
export function listMaterialsIn(archive: ArchiveFixture): MaterialFixture[] {
  const raw = readBrresRaw(archive.data);
  const out: MaterialFixture[] = [];
  for (const subFile of raw.groups.find((group) => group.name === BRRES_MODELS_GROUP)?.entries ?? []) {
    let editor: Mdl0Editor;
    try {
      editor = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile));
    } catch {
      continue;
    }
    if (editor.version !== 0x0b) continue;
    for (const entry of editor.getDic('material')?.entries ?? []) {
      out.push({ ...archive, modelName: subFile.name, materialName: entry.name });
    }
  }
  return out;
}

/** The first model in an archive that the MDL0 reader can open. */
export function firstModelName(archive: ArchiveFixture): string {
  const raw = readBrresRaw(archive.data);
  return raw.groups.find((group) => group.name === BRRES_MODELS_GROUP)?.entries[0]?.name ?? '';
}
