/**
 * "Recent tracks" list for the File menu.
 *
 * Browsers do not let a page re-open a file by path, so a recent entry can only tell the
 * user what they last worked on and, for tracks that came from a URL (`?track=`), offer to
 * load it again. File-picked entries are recorded without a URL and are shown disabled with
 * an explanation.
 */

const STORAGE_KEY = 'mkw.editor.recentTracks.v1';
const MAX_ENTRIES = 8;

export interface RecentTrack {
  /** File name as the user knows it, e.g. `Z0.szs`. */
  name: string;
  /** Set when the track was loaded from a URL and can therefore be re-opened. */
  url?: string;
  /** Epoch milliseconds of the last time it was opened. */
  openedAt: number;
}

function isRecentTrack(value: unknown): value is RecentTrack {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<RecentTrack>;
  return typeof candidate.name === 'string' && typeof candidate.openedAt === 'number';
}

export function readRecentTracks(): RecentTrack[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentTrack).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/** Adds (or moves to the front) one entry and returns the new list. */
export function rememberRecentTrack(entry: { name: string; url?: string }): RecentTrack[] {
  const next: RecentTrack[] = [
    { name: entry.name, url: entry.url, openedAt: Date.now() },
    ...readRecentTracks().filter((existing) => existing.name !== entry.name || existing.url !== entry.url),
  ].slice(0, MAX_ENTRIES);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures; the recent list is a convenience, not state.
    }
  }
  return next;
}

export function clearRecentTracks(): RecentTrack[] {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore.
    }
  }
  return [];
}
