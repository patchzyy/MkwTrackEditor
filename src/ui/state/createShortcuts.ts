/**
 * Which editor command a key press is while Create mode is active. Pure, so the table is
 * testable without a DOM; `useEditorShortcuts` performs the action.
 */

export type CreateShortcutAction =
  | 'undo'
  | 'redo'
  | 'delete'
  | 'testDrive'
  | 'export'
  | 'open'
  /** Clipboard keys Create mode does not use: swallowed so the browser does not act on them. */
  | 'swallow';

export interface ShortcutKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * `null` means "not a global Create command" (the mode's own `onKey` may still want it).
 * `toolOwnsKey`: the active tool claimed this key (Backspace while a road is being drawn), so Delete /
 * Backspace are not "delete the selection" for this press.
 */
export function resolveCreateShortcut(event: ShortcutKeyEvent, toolOwnsKey = false): CreateShortcutAction | null {
  const key = event.key.toLowerCase();
  const meta = event.ctrlKey || event.metaKey;
  if (meta && !event.altKey) {
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (key === 'y') return 'redo';
    if (key === 's') return 'export';
    if (key === 'o') return 'open';
    if (key === 'enter') return 'testDrive';
    if (key === 'c' || key === 'v' || key === 'd' || key === 'l') return 'swallow';
    return null;
  }
  if (meta || event.altKey) return null;
  if (event.key === 'F5') return 'testDrive';
  if (!toolOwnsKey && (event.key === 'Delete' || event.key === 'Backspace')) return 'delete';
  return null;
}
