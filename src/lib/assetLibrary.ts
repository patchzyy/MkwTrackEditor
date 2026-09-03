// The user's own model library ("My Assets" in the content browser).
//
// Custom `.brres` files dropped onto the content browser are kept in IndexedDB so they are
// there the next time the editor opens, in this browser, without any server. A record holds
// the bytes plus what the browser tile needs (name, counts, a rendered thumbnail) so listing the
// library never has to parse an archive.
//
// The pure helpers here are unit tested; the IndexedDB functions are thin and only run in the
// browser.

import { ASSET_LIBRARY_STORE, hasIndexedDb, toStandaloneArrayBuffer, withEditorStore } from './editorDb';

/** What the content browser shows for a library asset. No bytes. */
export interface LibraryAsset {
  id: string;
  /** Display name; defaults to the file name without `.brres`. */
  name: string;
  /** The file name the asset was imported as, kept for export and as the merge source path. */
  fileName: string;
  /** Archive size in bytes. */
  size: number;
  /** Unix milliseconds. */
  addedAt: number;
  /** MDL0 names in the archive. */
  models: string[];
  textureCount: number;
  /** Rendered preview as a data URL, when the GPU thumbnail could be made. */
  thumbnail: string | null;
}

export interface LibraryAssetRecord extends LibraryAsset {
  bytes: Uint8Array;
}

/** Shape stored in IndexedDB: a plain object with an `ArrayBuffer`, no typed arrays. */
interface StoredLibraryAsset extends LibraryAsset {
  data: ArrayBuffer;
}

/** Drag payload type for a library tile: the value is the asset id. */
export const LIBRARY_ASSET_DRAG_TYPE = 'application/mkw-library-asset';

/** `sourcePath` used when a library asset is merged into the course model. Unique per asset. */
export function libraryAssetSourcePath(asset: Pick<LibraryAsset, 'id' | 'fileName'>): string {
  return `library/${asset.id}/${asset.fileName}`;
}

/** The asset id encoded in a library `sourcePath`, or `null` for other sources. */
export function libraryAssetIdFromSourcePath(sourcePath: string): string | null {
  const match = /^library\/([^/]+)\//.exec(sourcePath);
  return match ? match[1] : null;
}

export function isBrresFileName(fileName: string): boolean {
  return /\.brres$/i.test(fileName);
}

/** Strips folders and the extension: `Object/tree.brres` -> `tree`. */
export function libraryNameFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.brres$/i, '') || 'model';
}

/** `name`, `name 2`, `name 3`, ... so two imports of `tree.brres` stay distinguishable. */
export function uniqueLibraryName(name: string, existing: Iterable<string>): string {
  const taken = new Set(Array.from(existing, (value) => value.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function createLibraryAssetId(now: number = Date.now()): string {
  return `${now.toString(36)}-${Math.floor(Math.random() * 0x100000).toString(36)}`;
}

/** Human size: `12.3 KB`, `1.2 MB`. */
export function formatLibrarySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Newest first; ties by name. */
export function sortLibraryAssets<T extends LibraryAsset>(assets: readonly T[]): T[] {
  return [...assets].sort((a, b) => b.addedAt - a.addedAt || a.name.localeCompare(b.name));
}

/** The tile text: `2 models · 5 textures · 1.2 MB`. */
export function describeLibraryAsset(asset: LibraryAsset): string {
  const models = `${asset.models.length} ${asset.models.length === 1 ? 'model' : 'models'}`;
  const textures = `${asset.textureCount} ${asset.textureCount === 1 ? 'texture' : 'textures'}`;
  return `${models} · ${textures} · ${formatLibrarySize(asset.size)}`;
}

function toStored(record: LibraryAssetRecord): StoredLibraryAsset {
  const { bytes, ...asset } = record;
  return { ...asset, data: toStandaloneArrayBuffer(bytes) };
}

function fromStored(stored: StoredLibraryAsset): LibraryAssetRecord {
  const { data, ...asset } = stored;
  return { ...asset, bytes: new Uint8Array(data) };
}

export async function loadLibraryAssets(): Promise<LibraryAssetRecord[]> {
  if (!hasIndexedDb()) return [];
  const stored = await withEditorStore<StoredLibraryAsset[]>(ASSET_LIBRARY_STORE, 'readonly', (store) => store.getAll());
  return sortLibraryAssets(stored.map(fromStored));
}

export async function saveLibraryAsset(record: LibraryAssetRecord): Promise<void> {
  if (!hasIndexedDb()) return;
  await withEditorStore<IDBValidKey>(ASSET_LIBRARY_STORE, 'readwrite', (store) => store.put(toStored(record), record.id));
}

export async function deleteLibraryAsset(id: string): Promise<void> {
  if (!hasIndexedDb()) return;
  await withEditorStore<undefined>(ASSET_LIBRARY_STORE, 'readwrite', (store) => store.delete(id));
}
