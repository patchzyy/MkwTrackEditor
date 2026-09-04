// "Recent" in the Model Studio.
//
// A browser cannot reopen a file it was given once, so recency is only useful if the bytes come
// with it. They are kept in the editor's IndexedDB (`STUDIO_RECENT_STORE`), newest first, capped
// by both count and total size so a few big `.szs` archives cannot fill the user's quota.
//
// The pure helpers (`trimStudioRecents`, `studioRecentId`) are unit tested; the IndexedDB
// functions are thin and only run in the browser.

import { hasIndexedDb, STUDIO_RECENT_STORE, toStandaloneArrayBuffer, withEditorStore } from '../../lib/editorDb';

export interface StudioRecentEntry {
  id: string;
  fileName: string;
  size: number;
  openedAt: number;
}

export interface StudioRecentRecord extends StudioRecentEntry {
  bytes: Uint8Array;
}

interface StoredStudioRecent extends StudioRecentEntry {
  data: ArrayBuffer;
}

/** How many files are remembered, and how much they may add up to. */
export const STUDIO_RECENT_LIMIT = 8;
export const STUDIO_RECENT_BYTE_BUDGET = 48 * 1024 * 1024;

/** Stable per file name, so reopening the same archive updates its entry rather than adding one. */
export function studioRecentId(fileName: string): string {
  return fileName.toLowerCase();
}

/**
 * Newest first, one entry per file, capped by count and by total bytes. Returns a new array; the
 * entries dropped are the oldest ones.
 */
export function trimStudioRecents<T extends StudioRecentEntry>(entries: readonly T[]): T[] {
  const seen = new Set<string>();
  const sorted = [...entries].sort((a, b) => b.openedAt - a.openedAt);
  const kept: T[] = [];
  let total = 0;
  for (const entry of sorted) {
    if (seen.has(entry.id)) continue;
    if (kept.length >= STUDIO_RECENT_LIMIT) continue;
    if (total + entry.size > STUDIO_RECENT_BYTE_BUDGET && kept.length > 0) continue;
    seen.add(entry.id);
    total += entry.size;
    kept.push(entry);
  }
  return kept;
}

export async function loadStudioRecents(): Promise<StudioRecentRecord[]> {
  if (!hasIndexedDb()) return [];
  try {
    const stored = await withEditorStore<StoredStudioRecent[]>(STUDIO_RECENT_STORE, 'readonly', (store) => store.getAll());
    return trimStudioRecents(stored.map((entry) => ({ ...entry, bytes: new Uint8Array(entry.data) })));
  } catch {
    return [];
  }
}

export async function rememberStudioFile(fileName: string, bytes: Uint8Array): Promise<StudioRecentRecord | null> {
  if (!hasIndexedDb()) return null;
  const record: StudioRecentRecord = {
    id: studioRecentId(fileName),
    fileName,
    size: bytes.byteLength,
    openedAt: Date.now(),
    bytes,
  };
  if (record.size > STUDIO_RECENT_BYTE_BUDGET) return null;
  try {
    const stored: StoredStudioRecent = {
      id: record.id,
      fileName: record.fileName,
      size: record.size,
      openedAt: record.openedAt,
      data: toStandaloneArrayBuffer(bytes),
    };
    await withEditorStore<IDBValidKey>(STUDIO_RECENT_STORE, 'readwrite', (store) => store.put(stored, record.id));
    const all = await loadStudioRecents();
    const keep = new Set(all.map((entry) => entry.id));
    const every = await withEditorStore<string[]>(STUDIO_RECENT_STORE, 'readonly', (store) => store.getAllKeys() as IDBRequest<string[]>);
    for (const key of every) if (!keep.has(key)) await withEditorStore<undefined>(STUDIO_RECENT_STORE, 'readwrite', (store) => store.delete(key));
    return record;
  } catch {
    return null;
  }
}

export async function clearStudioRecents(): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    await withEditorStore<undefined>(STUDIO_RECENT_STORE, 'readwrite', (store) => store.clear());
  } catch {
    // Recency is a convenience; losing it is never worth an error.
  }
}
