/**
 * Spotting hand-edits of generated files. After each compile the session remembers a hash per
 * generated file (`compiledHashes`). When the user comes back from KMP/Model/Visual mode the
 * track document's files are hashed again; every file that no longer matches is a conflict the
 * user is asked about ("Keep my changes" / "Rebuild from the design").
 */
import { hashBytes } from '../../../lib/create/compile';
import type { KmpSectionKey } from '../../../lib/create/types';
import type { KmpFile } from '../../../lib/kmpFile';
import type { TrackDocument } from '../../../lib/track';
import { findBytes, normalizeArchivePath } from './trackBridge';
import type { CreateConflict } from './types';

const KMP_PATH = 'course.kmp';

/** Hashes of the given archive paths as they are in the track document right now. */
export function hashTrackFiles(track: TrackDocument, paths: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of paths) {
    const bytes = findBytes(track.archiveEntries, path);
    if (bytes) out[path] = hashBytes(bytes);
  }
  return out;
}

const KMP_SECTION_FIELDS: Record<KmpSectionKey, Array<keyof KmpFile>> = {
  startPoints: ['startPoints'],
  enemy: ['enemyPoints', 'enemyGroups'],
  item: ['itemPoints', 'itemGroups'],
  checkpoints: ['checkpoints', 'checkpointGroups'],
  objects: ['objects'],
  routes: ['routes'],
  areas: ['areas'],
  cameras: ['cameras', 'firstOpeningCamera', 'firstSelectionCamera'],
  respawnPoints: ['respawnPoints'],
  stage: ['stage'],
};

const KMP_SECTION_NAMES: Record<KmpSectionKey, string> = {
  startPoints: 'start positions',
  enemy: 'computer driver routes',
  item: 'item routes',
  checkpoints: 'checkpoints',
  objects: 'objects',
  routes: 'moving-object routes',
  areas: 'areas',
  cameras: 'cameras',
  respawnPoints: 'respawn points',
  stage: 'track settings',
};

/** Which parts of the layout differ between what the design generated and what the document has. */
export function changedKmpSections(generated: KmpFile, current: KmpFile): KmpSectionKey[] {
  const changed: KmpSectionKey[] = [];
  for (const key of Object.keys(KMP_SECTION_FIELDS) as KmpSectionKey[]) {
    const differs = KMP_SECTION_FIELDS[key].some((field) => JSON.stringify(generated[field]) !== JSON.stringify(current[field]));
    if (differs) changed.push(key);
  }
  return changed;
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** A sentence fragment naming what changed in a generated file ("checkpoints and cameras"). */
export function describeChangedFile(path: string, sections: KmpSectionKey[] = []): string {
  const key = normalizeArchivePath(path);
  if (key === KMP_PATH) {
    return sections.length > 0 ? joinWords(sections.map((s) => KMP_SECTION_NAMES[s])) : 'the race layout';
  }
  if (key === 'course.kcl') return 'the collision';
  if (key === 'course_model.brres') return 'the course model';
  if (key === 'map_model.brres') return 'the minimap';
  if (key === 'vrcorn_model.brres') return 'the sky';
  if (key.startsWith('posteffect/')) return 'the lighting and effects';
  return 'a track file';
}

export interface ConflictInput {
  compiledHashes: Record<string, string> | undefined;
  track: TrackDocument | null;
  /** The KMP the design generated, to say which parts of the layout were edited. */
  generatedKmp?: KmpFile | null;
  /** Paths the user already chose to keep: they are reported only if they changed again. */
  acknowledged?: Record<string, string>;
}

/** Files of the track document that differ from what the last compile wrote. */
export function detectConflicts({ compiledHashes, track, generatedKmp, acknowledged }: ConflictInput): CreateConflict[] {
  if (!compiledHashes || !track) return [];
  const conflicts: CreateConflict[] = [];
  const current = hashTrackFiles(track, Object.keys(compiledHashes));
  for (const [path, expected] of Object.entries(compiledHashes)) {
    const actual = current[path];
    if (actual === undefined || actual === expected) continue;
    if (acknowledged?.[path] === actual) continue;
    let sections: KmpSectionKey[] = [];
    if (normalizeArchivePath(path) === KMP_PATH && generatedKmp && track.kmpFile) {
      sections = changedKmpSections(generatedKmp, track.kmpFile);
    }
    conflicts.push({ path, what: describeChangedFile(path, sections) });
  }
  // Model-mode edits live on the document (baked on export), not in the archive bytes.
  const hasModelEdits = (track.meshEdits?.length ?? 0) > 0 || (track.importedMeshes?.length ?? 0) > 0;
  if (hasModelEdits && !conflicts.some((c) => normalizeArchivePath(c.path) === 'course_model.brres')) {
    conflicts.push({ path: 'course_model.brres', what: 'the course model' });
  }
  return conflicts;
}

/** The KMP sections to lock so "Keep my changes" survives the next compile. */
export function sectionsToLock(conflicts: CreateConflict[], generatedKmp: KmpFile | null | undefined, current: KmpFile | undefined): KmpSectionKey[] {
  if (!generatedKmp || !current) return [];
  if (!conflicts.some((c) => normalizeArchivePath(c.path) === KMP_PATH)) return [];
  return changedKmpSections(generatedKmp, current);
}

/** Merges new lock keys into the existing list without duplicates, in a stable order. */
export function addLockedSections(existing: readonly KmpSectionKey[], extra: readonly KmpSectionKey[]): KmpSectionKey[] {
  const merged = new Set<KmpSectionKey>(existing);
  for (const key of extra) merged.add(key);
  return [...merged];
}
