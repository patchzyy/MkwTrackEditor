import { useEffect, useState } from 'react';
import { readVisualArchive, type VisualArchiveInfo } from './visualArchive';

/**
 * Parsed archives, keyed by the archive's own byte array. Editing one archive replaces only that
 * entry's bytes (see `replaceArchiveFile`), so every other archive keeps its identity and stays
 * parsed; a texture replacement invalidates exactly the archive it touched.
 */
const parseCache = new WeakMap<Uint8Array, Map<string, Promise<VisualArchiveInfo>>>();

function parseCached(path: string, bytes: Uint8Array): Promise<VisualArchiveInfo> {
  let byPath = parseCache.get(bytes);
  if (byPath === undefined) {
    byPath = new Map();
    parseCache.set(bytes, byPath);
  }
  const existing = byPath.get(path);
  if (existing !== undefined) return existing;
  const promise = readVisualArchive(path, bytes);
  byPath.set(path, promise);
  return promise;
}

export interface VisualArchiveState {
  archive: VisualArchiveInfo | null;
  loading: boolean;
}

/**
 * Parses one BRRES for the Visual panel, off the render path. Only the archive the author is
 * looking at is parsed — `course_model.brres` alone is several megabytes, so parsing every
 * archive of the track up front would stall the first paint of the mode.
 */
export function useVisualArchive(path: string | null, bytes: Uint8Array | null): VisualArchiveState {
  const [state, setState] = useState<VisualArchiveState>({ archive: null, loading: false });

  useEffect(() => {
    if (path === null || bytes === null) {
      setState({ archive: null, loading: false });
      return;
    }
    let cancelled = false;
    // Keep showing the previous parse of the same archive while a re-parse runs, so replacing a
    // texture does not blank the panel.
    setState((current) => ({ archive: current.archive?.path === path ? current.archive : null, loading: true }));
    void parseCached(path, bytes).then((archive) => {
      if (!cancelled) setState({ archive, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [path, bytes]);

  return state;
}
