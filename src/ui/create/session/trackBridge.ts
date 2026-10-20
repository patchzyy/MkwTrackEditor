/**
 * Design -> track document. Pure: takes the compile result and the current `TrackDocument` and
 * returns the document with the generated files swapped in, ready for `history.applyEditorChange`
 * (without a history step) so the viewport, playtest and export all see the new track.
 *
 * Nothing here knows about React or the renderer.
 */
import { parseKcl } from '../../../lib/kcl';
import { parseKmp } from '../../../lib/kmp';
import { readKmpFile, type KmpFile } from '../../../lib/kmpFile';
import { getObjFlowResourceNames, type CommonResourceArchive } from '../../../lib/objflow';
import type { TrackDocument } from '../../../lib/track';
import type { U8Entry } from '../../../lib/u8';

/** Document `sourceId` for a design: the viewport keeps its scene while this stays the same. */
export function createSourceId(projectId: string): string {
  return `create:${projectId}`;
}

export function isCreateSourceId(sourceId: string | undefined | null, projectId?: string): boolean {
  if (!sourceId || !sourceId.startsWith('create:')) return false;
  return projectId === undefined || sourceId === createSourceId(projectId);
}

function cleanArchivePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
}

/** `./course.kmp`, `course.kmp` and `COURSE.KMP` are the same file. */
export function normalizeArchivePath(path: string): string {
  return cleanArchivePath(path).toLowerCase();
}

/**
 * The object model files the generated objects need, pulled from `Common.szs` the same way
 * `getExportArchiveEntries` does at export time, so the live scene can draw them.
 */
export function collectObjectResources(kmp: KmpFile, common: CommonResourceArchive | null | undefined): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  if (!common) return out;
  const seen = new Set<number>();
  for (const object of kmp.objects) {
    if (seen.has(object.objectId)) continue;
    seen.add(object.objectId);
    const flow = common.objFlow.byId.get(object.objectId);
    if (!flow) continue;
    for (const resourceName of getObjFlowResourceNames(flow)) {
      const source = common.byBaseName.get(resourceName.toLowerCase());
      if (source?.data) out.set(resourceName, source.data);
    }
  }
  return out;
}

export interface MergeOptions {
  /** Archive paths the user chose to keep as they are (never overwritten). */
  keepPaths?: ReadonlySet<string>;
  /**
   * Files a previous compile wrote that this one no longer produces (a design that lost its
   * minimap outline); they are removed from the document.
   */
  previousPaths?: Iterable<string>;
  /** Extra files that are not part of the design (object models), added when missing. */
  resources?: ReadonlyMap<string, Uint8Array>;
  /** Drop Model-mode mesh edits (they were made on a course model that no longer exists). */
  clearMeshEdits?: boolean;
  /** The document's file name (the design's name changed). */
  fileName?: string;
}

/**
 * The document with `files` swapped in. Entries keep their order and spelling; new ones are
 * appended in the same style as the existing paths. KMP and KCL are re-parsed so the editor's
 * structured views match the bytes.
 */
export function mergeCompileIntoTrack(
  track: TrackDocument,
  files: ReadonlyMap<string, Uint8Array>,
  options: MergeOptions = {},
): TrackDocument {
  const keep = options.keepPaths ?? new Set<string>();
  const wanted = new Map<string, { path: string; data: Uint8Array }>();
  for (const [path, data] of files) wanted.set(normalizeArchivePath(path), { path, data });
  const resourceFiles = new Map<string, { path: string; data: Uint8Array }>();
  for (const [path, data] of options.resources ?? []) {
    const key = normalizeArchivePath(path);
    if (!wanted.has(key)) resourceFiles.set(key, { path, data });
  }
  const stale = new Set<string>();
  for (const path of options.previousPaths ?? []) {
    const key = normalizeArchivePath(path);
    if (!wanted.has(key)) stale.add(key);
  }

  const style = track.archiveEntries.some((entry) => entry.path.startsWith('./')) || track.archiveEntries.length === 0 ? './' : '';
  const handled = new Set<string>();
  const entries: U8Entry[] = [];
  for (const entry of track.archiveEntries) {
    if (entry.type !== 'file') {
      entries.push(entry);
      continue;
    }
    const key = normalizeArchivePath(entry.path);
    if (stale.has(key) && !keep.has(key)) continue;
    const replacement = wanted.get(key);
    if (replacement && !keep.has(key)) {
      handled.add(key);
      entries.push({ ...entry, data: replacement.data });
      continue;
    }
    if (replacement || resourceFiles.has(key)) handled.add(key);
    entries.push(entry);
  }

  const existingDirs = new Set(entries.filter((entry) => entry.type === 'directory').map((entry) => normalizeArchivePath(entry.path)));
  const append = (path: string, data: Uint8Array) => {
    const clean = cleanArchivePath(path);
    const key = clean.toLowerCase();
    if (handled.has(key) || keep.has(key)) return;
    handled.add(key);
    const parts = clean.split('/');
    let prefix = style === './' ? '.' : '';
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
      const dirKey = normalizeArchivePath(prefix);
      if (!existingDirs.has(dirKey)) {
        existingDirs.add(dirKey);
        entries.push({ path: prefix, type: 'directory' });
      }
    }
    entries.push({ path: `${style}${clean}`, type: 'file', data });
  };
  for (const value of wanted.values()) append(value.path, value.data);
  for (const value of resourceFiles.values()) append(value.path, value.data);

  const next: TrackDocument = {
    ...track,
    fileName: options.fileName ?? track.fileName,
    archiveEntries: entries,
    archiveLayout: undefined,
    brresFiles: entries.filter((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('.brres')).map((entry) => entry.path),
  };
  if (options.clearMeshEdits) {
    next.meshEdits = undefined;
    next.importedMeshes = undefined;
    next.meshImportSources = undefined;
  }

  const kmpBytes = findBytes(entries, 'course.kmp');
  if (kmpBytes && kmpBytes !== findBytes(track.archiveEntries, 'course.kmp')) {
    next.kmp = parseKmp(kmpBytes);
    next.kmpFile = readKmpFile(kmpBytes);
  }
  const kclBytes = findBytes(entries, 'course.kcl');
  if (kclBytes && kclBytes !== findBytes(track.archiveEntries, 'course.kcl')) {
    next.kcl = parseKcl(kclBytes);
  }
  next.warnings = [...(next.kmp?.warnings ?? []), ...(next.kcl?.warnings ?? [])];
  return next;
}

export function findBytes(entries: readonly U8Entry[], path: string): Uint8Array | null {
  const key = normalizeArchivePath(path);
  for (const entry of entries) {
    if (entry.type === 'file' && entry.data && normalizeArchivePath(entry.path) === key) return entry.data;
  }
  return null;
}
