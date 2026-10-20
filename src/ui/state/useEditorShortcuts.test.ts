import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditorShortcuts } from './useEditorShortcuts';

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('camera editing shortcuts', () => {
  it.each(['camera', 'kmp'] as const)('keeps unrelated clipboard edits out of %s mode', (editorMode) => {
    const addEventListener = vi.fn();
    vi.stubGlobal('window', { addEventListener, removeEventListener: vi.fn() });
    vi.stubGlobal('document', { documentElement: { dataset: {} } });
    const copy = vi.fn();
    const paste = vi.fn();
    const duplicate = vi.fn();
    const undo = vi.fn();
    useEditorShortcuts({
      editorMode, selection: { selectedIdsRef: { current: [] } },
      selected: null, track: null, objFlow: null, fillBetweenSelection: null,
      setTool: vi.fn(), setStatus: vi.fn(), setFillBetweenPanelOpen: vi.fn(),
      undoEdit: undo, redoEdit: vi.fn(), copySelectedEntity: copy,
      pasteClipboardEntity: paste, duplicateSelectedEntity: duplicate,
      deleteSelectedEntity: vi.fn(), downloadExport: vi.fn(), refreshTrack: vi.fn(), openTrackPicker: vi.fn(),
    } as Parameters<typeof useEditorShortcuts>[0]);
    vi.mocked(useEffect).mock.calls[0][0]();
    const handleKeyDown = addEventListener.mock.calls[0][1];
    for (const key of ['c', 'v', 'd', 'z']) {
      handleKeyDown({ key, ctrlKey: true, preventDefault: vi.fn(), target: null });
    }
    expect(copy).toHaveBeenCalledTimes(editorMode === 'camera' ? 0 : 1);
    expect(paste).toHaveBeenCalledTimes(editorMode === 'camera' ? 0 : 1);
    expect(duplicate).toHaveBeenCalledTimes(editorMode === 'camera' ? 0 : 1);
    expect(undo).toHaveBeenCalledOnce();
  });
});

describe('create mode shortcuts', () => {
  function setup(target: unknown = null, ownsKey?: (event: unknown) => boolean) {
    const addEventListener = vi.fn();
    vi.stubGlobal('window', { addEventListener, removeEventListener: vi.fn() });
    vi.stubGlobal('document', { documentElement: { dataset: {} } });
    const kmp = { undo: vi.fn(), redo: vi.fn(), copy: vi.fn(), paste: vi.fn(), duplicate: vi.fn(), remove: vi.fn(), setTool: vi.fn(), exportTrack: vi.fn() };
    const mode = { undo: vi.fn(), redo: vi.fn(), deleteSelection: vi.fn(), testDrive: vi.fn(), onKey: vi.fn(() => true), ownsKey };
    useEditorShortcuts({
      editorMode: 'create', modeShortcuts: mode, selection: { selectedIdsRef: { current: ['x'] } },
      selected: null, track: null, objFlow: null, fillBetweenSelection: null,
      setTool: kmp.setTool, setStatus: vi.fn(), setFillBetweenPanelOpen: vi.fn(),
      undoEdit: kmp.undo, redoEdit: kmp.redo, copySelectedEntity: kmp.copy,
      pasteClipboardEntity: kmp.paste, duplicateSelectedEntity: kmp.duplicate,
      deleteSelectedEntity: kmp.remove, downloadExport: kmp.exportTrack, refreshTrack: vi.fn(), openTrackPicker: vi.fn(),
    } as Parameters<typeof useEditorShortcuts>[0]);
    vi.mocked(useEffect).mock.calls[0][0]();
    const handleKeyDown = addEventListener.mock.calls[0][1] as (event: unknown) => void;
    const press = (key: string, extra: Record<string, unknown> = {}) =>
      handleKeyDown({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault: vi.fn(), target, ...extra });
    return { kmp, mode, press };
  }

  it('sends undo, redo, delete and test drive to the design, never to the KMP history', () => {
    const { kmp, mode, press } = setup();
    press('z', { ctrlKey: true });
    press('z', { ctrlKey: true, shiftKey: true });
    press('y', { ctrlKey: true });
    press('Delete');
    press('F5');
    expect(mode.undo).toHaveBeenCalledOnce();
    expect(mode.redo).toHaveBeenCalledTimes(2);
    expect(mode.deleteSelection).toHaveBeenCalledOnce();
    expect(mode.testDrive).toHaveBeenCalledOnce();
    expect(kmp.undo).not.toHaveBeenCalled();
    expect(kmp.redo).not.toHaveBeenCalled();
    expect(kmp.remove).not.toHaveBeenCalled();
  });

  it('gives Backspace to the tool while it owns the key (drawing a road), and deletes otherwise', () => {
    let drawing = true;
    const { mode, press } = setup(null, () => drawing);
    press('Backspace');
    expect(mode.onKey).toHaveBeenCalledOnce();
    expect(mode.deleteSelection).not.toHaveBeenCalled();
    drawing = false;
    press('Backspace');
    expect(mode.deleteSelection).toHaveBeenCalledOnce();
    expect(mode.onKey).toHaveBeenCalledOnce();
  });

  it('swallows the KMP clipboard keys and the gizmo letters', () => {
    const { kmp, mode, press } = setup();
    for (const key of ['c', 'v', 'd']) press(key, { ctrlKey: true });
    for (const key of ['w', 'e', 'r']) press(key);
    expect(kmp.copy).not.toHaveBeenCalled();
    expect(kmp.paste).not.toHaveBeenCalled();
    expect(kmp.duplicate).not.toHaveBeenCalled();
    expect(kmp.setTool).not.toHaveBeenCalled();
    // The tool letters reach the mode instead.
    expect(mode.onKey).toHaveBeenCalledTimes(3);
  });

  it('still exports with Ctrl+S', () => {
    const { kmp, press } = setup();
    press('s', { ctrlKey: true });
    expect(kmp.exportTrack).toHaveBeenCalledOnce();
  });

  it('never fires while typing in an input', () => {
    const { mode, press } = setup({ tagName: 'INPUT' });
    press('z', { ctrlKey: true });
    press('Delete');
    press('r');
    expect(mode.undo).not.toHaveBeenCalled();
    expect(mode.deleteSelection).not.toHaveBeenCalled();
    expect(mode.onKey).not.toHaveBeenCalled();
  });
});
