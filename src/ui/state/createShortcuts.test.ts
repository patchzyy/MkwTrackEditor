import { describe, expect, it } from 'vitest';
import { resolveCreateShortcut, type ShortcutKeyEvent } from './createShortcuts';

const key = (k: string, mods: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('resolveCreateShortcut', () => {
  it('maps undo and redo to the design history', () => {
    expect(resolveCreateShortcut(key('z', { ctrlKey: true }))).toBe('undo');
    expect(resolveCreateShortcut(key('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(resolveCreateShortcut(key('y', { ctrlKey: true }))).toBe('redo');
    expect(resolveCreateShortcut(key('z', { metaKey: true }))).toBe('undo');
  });

  it('starts a test drive with F5 or Ctrl+Enter', () => {
    expect(resolveCreateShortcut(key('F5'))).toBe('testDrive');
    expect(resolveCreateShortcut(key('Enter', { ctrlKey: true }))).toBe('testDrive');
    expect(resolveCreateShortcut(key('Enter'))).toBeNull();
  });

  it('deletes the selection with Delete or Backspace', () => {
    expect(resolveCreateShortcut(key('Delete'))).toBe('delete');
    expect(resolveCreateShortcut(key('Backspace'))).toBe('delete');
    expect(resolveCreateShortcut(key('Delete', { ctrlKey: true }))).toBeNull();
  });

  it('hands Backspace to the tool while it owns the key, so drawing a road is not a delete', () => {
    expect(resolveCreateShortcut(key('Backspace'), true)).toBeNull();
    expect(resolveCreateShortcut(key('Delete'), true)).toBeNull();
    // Only plain delete keys are affected.
    expect(resolveCreateShortcut(key('z', { ctrlKey: true }), true)).toBe('undo');
    expect(resolveCreateShortcut(key('F5'), true)).toBe('testDrive');
  });

  it('keeps file commands and swallows the editor-only clipboard keys', () => {
    expect(resolveCreateShortcut(key('s', { ctrlKey: true }))).toBe('export');
    expect(resolveCreateShortcut(key('o', { ctrlKey: true }))).toBe('open');
    for (const k of ['c', 'v', 'd', 'l']) expect(resolveCreateShortcut(key(k, { ctrlKey: true }))).toBe('swallow');
  });

  it('leaves tool letters to the mode', () => {
    for (const k of ['v', 'r', 's', 'p', 'b', 'h', 'd', 'g', 't', 'f', '[', ']', 'Escape', 'Enter']) {
      expect(resolveCreateShortcut(key(k))).toBeNull();
    }
    expect(resolveCreateShortcut(key('r', { ctrlKey: true, altKey: true }))).toBeNull();
  });
});
