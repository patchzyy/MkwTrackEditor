import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { KmpEntity } from '../../lib/kmp';
import type { CommonResourceArchive } from '../../lib/objflow';
import type { TrackDocument } from '../../lib/track';
import type { FillBetweenSelection } from '../fillBetween';
import { browserObjectTitle } from '../objects/objectCatalog';
import type { TransformTool } from '../Noclip3DViewport';
import type { EditorSelection } from './useSelection';

/** Global editor keyboard shortcuts (undo/redo, clipboard, tools, fill between, delete, export). */
export function useEditorShortcuts({
  selection,
  selected,
  track,
  objFlow,
  fillBetweenSelection,
  setTool,
  setStatus,
  setFillBetweenPanelOpen,
  undoEdit,
  redoEdit,
  copySelectedEntity,
  pasteClipboardEntity,
  duplicateSelectedEntity,
  deleteSelectedEntity,
  downloadExport,
}: {
  selection: EditorSelection;
  selected: KmpEntity | null;
  track: TrackDocument | null;
  objFlow: CommonResourceArchive['objFlow'] | null;
  fillBetweenSelection: FillBetweenSelection | null;
  setTool: Dispatch<SetStateAction<TransformTool>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setFillBetweenPanelOpen: Dispatch<SetStateAction<boolean>>;
  undoEdit: () => void;
  redoEdit: () => void;
  copySelectedEntity: () => void;
  pasteClipboardEntity: () => void;
  duplicateSelectedEntity: () => void;
  deleteSelectedEntity: () => void;
  downloadExport: () => void;
}) {
  useEffect(() => {
    const isViewportCameraLookActive = () => document.documentElement.dataset.viewportCameraLook === 'active';
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const meta = event.ctrlKey || event.metaKey;
      if (meta) {
        if (event.key.toLowerCase() === 'z') {
          event.preventDefault();
          if (event.shiftKey) redoEdit();
          else undoEdit();
          return;
        }
        if (event.key.toLowerCase() === 'y') {
          event.preventDefault();
          redoEdit();
          return;
        }
        if (event.key.toLowerCase() === 'c') {
          event.preventDefault();
          copySelectedEntity();
          return;
        }
        if (event.key.toLowerCase() === 'v') {
          event.preventDefault();
          pasteClipboardEntity();
          return;
        }
        if (event.key.toLowerCase() === 'd') {
          event.preventDefault();
          duplicateSelectedEntity();
          return;
        }
        if (event.key.toLowerCase() === 'l') {
          event.preventDefault();
          if (!fillBetweenSelection) {
            setStatus('Fill Between needs exactly two matching objects selected.');
            return;
          }
          setFillBetweenPanelOpen(true);
          setStatus(`Fill Between ready for ${browserObjectTitle({ objectId: fillBetweenSelection.objectId, name: objFlow?.byId.get(fillBetweenSelection.objectId)?.name ?? '', resources: objFlow?.byId.get(fillBetweenSelection.objectId)?.resources ?? '' })}.`);
          return;
        }
        if (event.key.toLowerCase() === 's') {
          event.preventDefault();
          downloadExport();
        }
        return;
      }
      if (!isViewportCameraLookActive()) {
        if (event.key.toLowerCase() === 'w') {
          event.preventDefault();
          setTool('translate');
          return;
        }
        if (event.key.toLowerCase() === 'e') {
          event.preventDefault();
          setTool('rotate');
          return;
        }
        if (event.key.toLowerCase() === 'r') {
          event.preventDefault();
          setTool('scale');
          return;
        }
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selection.selectedIdsRef.current.length > 0) {
        event.preventDefault();
        deleteSelectedEntity();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillBetweenSelection, objFlow, selected, track]);
}
