import { useCallback, useState } from 'react';

/**
 * Remembers one boolean per key in `localStorage`, so an "Advanced" block that has been opened
 * stays open the next time the editor is started. Deliberately tiny: the material inspector has
 * a dozen of these disclosures and giving them a shared reducer would be more machinery than the
 * feature is worth.
 *
 * Everything is wrapped: this also runs under `renderToStaticMarkup` in the unit tests, where
 * there is no `window`, and in a browser where storage can be disabled.
 */
const PREFIX = 'mkw.material.disclosure.';

function read(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function write(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(PREFIX + key, value ? '1' : '0');
  } catch {
    // Storage being unavailable only costs the user the memory, not the control.
  }
}

export function useRemembered(key: string, fallback = false): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => read(key, fallback));
  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      write(key, next);
    },
    [key],
  );
  return [value, set];
}
