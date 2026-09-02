import { startTransition, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { materializeViewportInteractionTrack } from '../../lib/kmpEdit';
import type { TrackDocument } from '../../lib/track';
import type { EditorSnapshot } from './types';
import type { EditorSelection } from './useSelection';
import type { TrackDocumentState } from './useTrackDocument';

export const HISTORY_LIMIT = 128;

export interface EditorHistory {
  historyState: { undo: number; redo: number };
  /** Non-null while a viewport drag/gizmo interaction is in progress. */
  editSessionRef: MutableRefObject<EditorSnapshot | null>;
  transientViewportEditRef: MutableRefObject<boolean>;
  captureSnapshot: (
    trackValue?: TrackDocument | null,
    selectedValue?: string | null,
    selectedValues?: string[],
  ) => EditorSnapshot;
  resetHistory: () => void;
  applyEditorSnapshot: (snapshot: EditorSnapshot, transient?: boolean) => void;
  applyEditorChange: (
    nextTrack: TrackDocument | null,
    nextSelectedId?: string | null,
    recordHistory?: boolean,
    nextSelectedIds?: string[],
  ) => void;
  applyTransientEditorChange: (nextTrack: TrackDocument | null, nextSelectedId?: string | null, nextSelectedIds?: string[]) => void;
  beginEditSession: () => void;
  endEditSession: () => void;
  undoEdit: () => void;
  redoEdit: () => void;
}

/**
 * Undo/redo stack for the whole editor. A history entry is a full `EditorSnapshot`, so undoing an
 * edit also restores the selection that produced it and can never leave partially patched KMP
 * bytes behind.
 */
export function useEditorHistory({
  selection,
  trackDocument,
  setStatus,
}: {
  selection: EditorSelection;
  trackDocument: Pick<TrackDocumentState, 'trackRef' | 'setTrack'>;
  setStatus: Dispatch<SetStateAction<string>>;
}): EditorHistory {
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const undoStackRef = useRef<EditorSnapshot[]>([]);
  const redoStackRef = useRef<EditorSnapshot[]>([]);
  const editSessionRef = useRef<EditorSnapshot | null>(null);
  const transientViewportEditRef = useRef(false);

  const { trackRef, setTrack } = trackDocument;

  function syncHistoryState() {
    setHistoryState({
      undo: undoStackRef.current.length,
      redo: redoStackRef.current.length,
    });
  }

  function captureSnapshot(
    trackValue = trackRef.current,
    selectedValue = selection.selectedIdRef.current,
    selectedValues = selection.selectedIdsRef.current,
  ): EditorSnapshot {
    return {
      track: trackValue,
      selectedId: selectedValue,
      selectedIds: [...selectedValues],
    };
  }

  function resetHistory() {
    undoStackRef.current = [];
    redoStackRef.current = [];
    editSessionRef.current = null;
    syncHistoryState();
  }

  function pushUndoSnapshot(snapshot: EditorSnapshot) {
    undoStackRef.current = [...undoStackRef.current.slice(-(HISTORY_LIMIT - 1)), snapshot];
    redoStackRef.current = [];
    syncHistoryState();
  }

  function applyEditorSnapshot(snapshot: EditorSnapshot, transient = false) {
    trackRef.current = snapshot.track;
    selection.applySelection(snapshot.selectedIds, snapshot.selectedId ?? snapshot.selectedIds.at(-1) ?? null);
    const updateState = () => setTrack(snapshot.track);
    if (transient) startTransition(updateState);
    else updateState();
  }

  function applyEditorChange(
    nextTrack: TrackDocument | null,
    nextSelectedId: string | null = selection.selectedIdRef.current,
    recordHistory = true,
    nextSelectedIds: string[] = selection.selectedIdsRef.current,
  ) {
    const current = captureSnapshot();
    if (editSessionRef.current) {
      applyEditorSnapshot({ track: nextTrack, selectedId: nextSelectedId, selectedIds: nextSelectedIds });
      return;
    }
    const selectionChanged =
      nextSelectedId !== current.selectedId ||
      nextSelectedIds.length !== current.selectedIds.length ||
      nextSelectedIds.some((value, index) => value !== current.selectedIds[index]);
    if (recordHistory && (nextTrack !== current.track || selectionChanged)) pushUndoSnapshot(current);
    applyEditorSnapshot({ track: nextTrack, selectedId: nextSelectedId, selectedIds: nextSelectedIds });
  }

  function applyTransientEditorChange(
    nextTrack: TrackDocument | null,
    nextSelectedId: string | null = selection.selectedIdRef.current,
    nextSelectedIds: string[] = selection.selectedIdsRef.current,
  ) {
    transientViewportEditRef.current = true;
    applyEditorSnapshot({ track: nextTrack, selectedId: nextSelectedId, selectedIds: nextSelectedIds }, true);
  }

  function beginEditSession() {
    if (editSessionRef.current) return;
    editSessionRef.current = captureSnapshot();
  }

  function endEditSession() {
    const before = editSessionRef.current;
    if (!before) return;
    const hadTransientViewportEdit = transientViewportEditRef.current;
    let after = captureSnapshot();
    editSessionRef.current = null;
    if (hadTransientViewportEdit) {
      transientViewportEditRef.current = false;
      after = {
        ...after,
        track: materializeViewportInteractionTrack(before.track, after.track),
      };
      applyEditorSnapshot(after);
    }
    const selectionChanged =
      after.selectedId !== before.selectedId ||
      after.selectedIds.length !== before.selectedIds.length ||
      after.selectedIds.some((value, index) => value !== before.selectedIds[index]);
    if (after.track !== before.track || selectionChanged) pushUndoSnapshot(before);
  }

  function undoEdit() {
    endEditSession();
    const snapshot = undoStackRef.current.at(-1);
    if (!snapshot) return;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current.slice(-(HISTORY_LIMIT - 1)), captureSnapshot()];
    applyEditorSnapshot(snapshot);
    syncHistoryState();
    setStatus('Undid last edit.');
  }

  function redoEdit() {
    endEditSession();
    const snapshot = redoStackRef.current.at(-1);
    if (!snapshot) return;
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current.slice(-(HISTORY_LIMIT - 1)), captureSnapshot()];
    applyEditorSnapshot(snapshot);
    syncHistoryState();
    setStatus('Redid last edit.');
  }

  return {
    historyState,
    editSessionRef,
    transientViewportEditRef,
    captureSnapshot,
    resetHistory,
    applyEditorSnapshot,
    applyEditorChange,
    applyTransientEditorChange,
    beginEditSession,
    endEditSession,
    undoEdit,
    redoEdit,
  };
}
