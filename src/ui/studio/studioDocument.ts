// What the Model Studio has open.
//
// A studio document is one *source file* — a bare `.brres`, a `.u8`, or a Yaz0-compressed `.szs`
// — plus the BRRES archives found inside it. It is deliberately much smaller than
// `TrackDocument`: the studio does not care about KMP, collision, post effects or the course
// asset database, only about models, materials, textures and animations.
//
// Two rules shape everything here:
//
// 1. **An untouched file exports byte-identical.** The source bytes are kept and returned
//    verbatim until something is actually edited, and the U8 layout is captured so that even a
//    rebuilt archive reproduces every file the editor did not touch.
// 2. **No React, no renderer.** This module is pure data, so the round trip is unit-testable.

import { buildU8, parseU8WithLayout, type U8Entry, type U8Layout } from '../../lib/u8';
import { decodeYaz0, encodeYaz0, isYaz0 } from '../../lib/yaz0';

export type StudioSourceKind = 'brres' | 'u8' | 'szs';

/** One BRRES inside the open document. `path` is the U8 path, or the file name for a bare file. */
export interface StudioBrresFile {
  path: string;
  /** Friendly label: the file name without folders or extension. */
  label: string;
  bytes: Uint8Array;
}

/**
 * Where the open document came from, when it mirrors an archive that lives somewhere else. The
 * studio writes edits back through this so a material changed here reaches the track document.
 */
export interface StudioOrigin {
  kind: 'track';
  /** The archive's path inside the track (`course_model.brres`, `Object/xyz.brres`). */
  archivePath: string;
  /** What to call the track in the studio header. */
  trackName: string;
}

export interface StudioDocument {
  /** The file name the document was opened as, and the one Export offers. */
  fileName: string;
  kind: StudioSourceKind;
  /** True when the source `.szs` was Yaz0-compressed, so Export compresses again. */
  compressed: boolean;
  /** The U8 entry list, for an archive source. Null for a bare `.brres`. */
  entries: U8Entry[] | null;
  layout: U8Layout | null;
  brresFiles: StudioBrresFile[];
  /** The exact bytes the document was opened from. */
  sourceBytes: Uint8Array;
  /** False until an edit is committed; an unedited document exports its source bytes verbatim. */
  dirty: boolean;
  origin: StudioOrigin | null;
}

export class StudioOpenError extends Error {}

const BRRES_MAGIC = [0x62, 0x72, 0x65, 0x73];

export function isBrresBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 0x10 && BRRES_MAGIC.every((byte, index) => bytes[index] === byte);
}

export function isU8Bytes(bytes: Uint8Array): boolean {
  return bytes.length >= 0x20 && bytes[0] === 0x55 && bytes[1] === 0xaa && bytes[2] === 0x38 && bytes[3] === 0x2d;
}

/** `Object/kuribo.brres` -> `kuribo`. */
export function studioBrresLabel(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.brres$/i, '');
}

/**
 * Opens whatever the user dropped in. Yaz0 is decompressed first, then the result is either a U8
 * archive (every `.brres` in it becomes a listed model archive) or a bare BRRES.
 */
export function openStudioDocument(fileName: string, bytes: Uint8Array, origin: StudioOrigin | null = null): StudioDocument {
  if (bytes.byteLength === 0) throw new StudioOpenError(`${fileName} is empty.`);

  const compressed = isYaz0(bytes);
  const inner = compressed ? decodeYaz0(bytes) : bytes;

  if (isBrresBytes(inner)) {
    const path = fileName.split(/[\\/]/).pop() ?? fileName;
    return {
      fileName,
      kind: 'brres',
      compressed,
      entries: null,
      layout: null,
      brresFiles: [{ path, label: studioBrresLabel(path), bytes: inner }],
      sourceBytes: bytes,
      dirty: false,
      origin,
    };
  }

  if (!isU8Bytes(inner)) {
    throw new StudioOpenError(
      `${fileName} is not a model file the studio can open. It takes a .brres model archive, or a .szs / .u8 archive containing one.`,
    );
  }

  const { entries, layout } = parseU8WithLayout(inner);
  const brresFiles = entries
    .filter((entry): entry is U8Entry & { data: Uint8Array } => entry.type === 'file' && entry.data !== undefined && isBrresBytes(entry.data))
    .map((entry) => ({ path: entry.path, label: studioBrresLabel(entry.path), bytes: entry.data }));

  if (brresFiles.length === 0) {
    throw new StudioOpenError(`${fileName} does not contain any .brres models, so there is nothing to show in the studio.`);
  }

  return {
    fileName,
    kind: compressed ? 'szs' : 'u8',
    compressed,
    entries,
    layout,
    brresFiles: sortStudioBrresFiles(brresFiles),
    sourceBytes: bytes,
    dirty: false,
    origin,
  };
}

/**
 * Model archives in the order an author thinks about them: a driver before its kart, a course
 * model before its skybox, everything else by name.
 */
export function sortStudioBrresFiles(files: readonly StudioBrresFile[]): StudioBrresFile[] {
  const rank = (file: StudioBrresFile): number => {
    const lower = file.path.toLowerCase();
    if (lower.includes('driver')) return 0;
    if (lower.includes('course_model')) return 0;
    if (lower.includes('kart')) return 1;
    if (lower.includes('vrcorn')) return 2;
    if (lower.includes('map_model')) return 3;
    return 1;
  };
  return [...files].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
}

export function findStudioBrres(doc: StudioDocument, path: string): StudioBrresFile | null {
  const wanted = path.toLowerCase();
  return doc.brresFiles.find((file) => file.path.toLowerCase() === wanted) ?? null;
}

/**
 * Writes new bytes for one BRRES inside the document. Returns the same document object when the
 * path is unknown, so a caller can compare by reference.
 */
export function replaceStudioBrres(doc: StudioDocument, path: string, bytes: Uint8Array): StudioDocument {
  const wanted = path.toLowerCase();
  if (!doc.brresFiles.some((file) => file.path.toLowerCase() === wanted)) return doc;

  const brresFiles = doc.brresFiles.map((file) => (file.path.toLowerCase() === wanted ? { ...file, bytes } : file));
  const entries =
    doc.entries === null
      ? null
      : doc.entries.map((entry) => (entry.type === 'file' && entry.path.toLowerCase() === wanted ? { ...entry, data: bytes } : entry));

  return { ...doc, brresFiles, entries, dirty: true };
}

export interface StudioExport {
  fileName: string;
  bytes: Uint8Array;
}

/**
 * The bytes Export writes.
 *
 * An unedited document hands back exactly what was opened — which is the only way a `.szs` can
 * round-trip byte-for-byte, because Yaz0 is not a canonical encoding and re-compressing produces
 * a different (equally valid) stream. Once something has been edited the archive is rebuilt from
 * the captured layout, so every file the studio did not touch is still identical.
 */
export function exportStudioDocument(doc: StudioDocument): StudioExport {
  if (!doc.dirty) return { fileName: doc.fileName, bytes: doc.sourceBytes };

  if (doc.kind === 'brres') {
    const bytes = doc.brresFiles[0]?.bytes ?? doc.sourceBytes;
    return { fileName: doc.fileName, bytes: doc.compressed ? encodeYaz0(bytes) : bytes };
  }

  if (doc.entries === null) return { fileName: doc.fileName, bytes: doc.sourceBytes };
  const rebuilt = buildU8(doc.entries, doc.layout ?? undefined);
  return { fileName: doc.fileName, bytes: doc.compressed ? encodeYaz0(rebuilt) : rebuilt };
}

/** Just one BRRES out of the document, for "Export this model" and "Save to My Assets". */
export function exportStudioBrres(doc: StudioDocument, path: string): StudioExport | null {
  const file = findStudioBrres(doc, path);
  if (file === null) return null;
  const base = file.path.split(/[\\/]/).pop() ?? file.path;
  return { fileName: /\.brres$/i.test(base) ? base : `${base}.brres`, bytes: file.bytes };
}

/** What the studio header says above the viewport. */
export function describeStudioDocument(doc: StudioDocument): string {
  const models = doc.brresFiles.length;
  const kind = doc.kind === 'brres' ? 'model archive' : doc.compressed ? 'compressed archive' : 'archive';
  return `${kind} · ${models} model file${models === 1 ? '' : 's'}${doc.dirty ? ' · edited' : ''}`;
}
