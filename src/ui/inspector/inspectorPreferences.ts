import { useCallback, useEffect, useState } from 'react';

/**
 * The one place the inspector's remembered disclosure state is keyed.
 *
 * "Simple by default": every disclosure starts closed on a fresh profile, and whatever the
 * author last chose is restored next session.
 */
export const INSPECTOR_DISCLOSURE_STORAGE_KEY = 'mkwTrackEditor.inspector.disclosures.v1';

/** The disclosures the inspector remembers: the two fixed ones plus one per details category name. */
export type InspectorDisclosureId = 'advanced' | 'tips' | `category:${string}`;

function readAll(): Record<string, boolean> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(INSPECTOR_DISCLOSURE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** Whether the named disclosure was left open. Defaults to closed unless `fallback` says otherwise. */
export function readInspectorDisclosure(id: InspectorDisclosureId, fallback = false): boolean {
  const stored = readAll()[id];
  return typeof stored === 'boolean' ? stored : fallback;
}

/** Remembers the disclosure state. Storage failures (private mode, quota) are ignored. */
export function writeInspectorDisclosure(id: InspectorDisclosureId, open: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(INSPECTOR_DISCLOSURE_STORAGE_KEY, JSON.stringify({ ...readAll(), [id]: open }));
  } catch {
    // Nothing to do: the disclosure still works, it just will not be remembered.
  }
}

/**
 * Remembered open/closed state for one inspector disclosure. The first render is always the
 * default state (closed unless `defaultOpen`) so server-rendered markup and the client agree; the stored value is applied in
 * an effect straight after mount.
 */
export function useInspectorDisclosure(id: InspectorDisclosureId, defaultOpen = false): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    setOpen(readInspectorDisclosure(id, defaultOpen));
  }, [id, defaultOpen]);
  const change = useCallback(
    (next: boolean) => {
      setOpen(next);
      writeInspectorDisclosure(id, next);
    },
    [id],
  );
  return [open, change];
}
