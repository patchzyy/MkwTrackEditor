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
