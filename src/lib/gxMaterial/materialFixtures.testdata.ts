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
import {
  CHARACTER_DIR,
  CUSTOM_TRACK_DIR,
  NINTENDO_TRACK_DIR,
  findCommonArchive,
  findPreviewDummies,
  listCharacterFiles,
  listTracks,
  readTrackBytes,
} from '../realTrackFixtures.testdata';
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

/**
 * The driver and kart models bundled for the object preview. Committed, so this is the one
 * character-model coverage CI gets — and character models are where the shader graph is most
 * exercised: nearly every one of them mixes two textures through an alpha read as a colour.
 */
export function listPreviewDummyArchives(): ArchiveFixture[] {
  const path = findPreviewDummies();
  if (!path) return [];
  let entries;
  try {
    entries = parseU8(new Uint8Array(readFileSync(path)));
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('.brres') && (entry.data?.length ?? 0) > 4096)
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => ({ label: `Preview/${entry.path.split('/').pop()}`, data: entry.data! }));
}

/**
 * Driver and kart models out of the local character folder: bare `Driver/*.brres` and the
 * `driver_model` / `kart_model` inside a vehicle archive. Absent on a machine without them.
 */
export function listCharacterArchives(limit = 6): ArchiveFixture[] {
  const out: ArchiveFixture[] = [];
  for (const path of listCharacterFiles(limit)) {
    try {
      const bytes = new Uint8Array(readFileSync(path));
      const label = path.split(/[\/]/).pop() ?? path;
      if (path.toLowerCase().endsWith('.brres')) {
        out.push({ label: `Character/${label}`, data: bytes });
        continue;
      }
      for (const entry of parseU8(decodeYaz0(bytes))) {
        if (entry.type !== 'file' || !entry.path.toLowerCase().endsWith('.brres') || !entry.data) continue;
        out.push({ label: `Character/${label}:${entry.path.split('/').pop()}`, data: entry.data });
      }
    } catch {
      // An archive this editor cannot unpack is not this suite's problem.
    }
  }
  return out;
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

export function listMaterialArchives(courseLimit = 12, objectLimit = 8): ArchiveFixture[] {
  return [...listCourseArchives(courseLimit), ...listObjectArchives(objectLimit)];
}

/**
 * The corpus the shader-graph round trip runs over: the course and object archives above plus the
 * character models, which are where the TEV vocabulary is stretched hardest. It is a separate list
 * from `listMaterialArchives` because that one also feeds the byte-exact *writer* tests, and the
 * BRRES writer cannot yet relocate a material block inside a multi-model character archive.
 */
export function listShaderGraphArchives(courseLimit = 12, objectLimit = 8, characterLimit = 6): ArchiveFixture[] {
  return [
    ...listMaterialArchives(courseLimit, objectLimit),
    ...listPreviewDummyArchives(),
    ...listCharacterArchives(characterLimit),
  ];
}

/** Which corpus a fixture label came from, for the per-family raw-stage bounds. */
export function fixtureFamily(label: string): 'object' | 'driver' | 'kart' | 'course' {
  if (label.startsWith('Common/')) return 'object';
  if (/(^|[/:])(Preview|Character)\//.test(label) || label.startsWith('Character/')) {
    return /kart_model|_kart|allkart|sd_kart|sd_bike/i.test(label) ? 'kart' : 'driver';
  }
  return 'course';
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
