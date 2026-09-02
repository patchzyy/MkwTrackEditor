import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { parseKmp, type KmpEntity, type Vec3 } from '../../lib/kmp';
import {
  appendCopiedEntity,
  canCopyEntity,
  createClipboardEntity,
  getClipboardSourceEntities,
  sortClipboardEntriesForPaste,
  type ClipboardEntity,
} from '../../lib/kmpEdit';
import { replaceCourseKmp, type TrackDocument } from '../../lib/track';
import type { EditorHistory } from './useEditorHistory';
import type { EditorSelection } from './useSelection';

/** Copy / paste / duplicate for the current KMP selection. */
export function useClipboard({
  track,
  selected,
  selectedEntities,
  selection,
  history,
  setStatus,
  entityLabel,
}: {
  track: TrackDocument | null;
  selected: KmpEntity | null;
  selectedEntities: KmpEntity[];
  selection: EditorSelection;
  history: EditorHistory;
  setStatus: Dispatch<SetStateAction<string>>;
  entityLabel: (entity: KmpEntity) => string;
}) {
  const [hasClipboardEntity, setHasClipboardEntity] = useState(false);
  const clipboardEntityRef = useRef<ClipboardEntity | null>(null);

  function canCopySelection(): boolean {
    if (selectedEntities.length > 1) return selectedEntities.every((entity) => canCopyEntity(entity));
    return canCopyEntity(selected);
  }

  function pasteClipboardEntity(clipboard = clipboardEntityRef.current, offset: Vec3 = { x: 300, y: 0, z: 300 }, reportDuplicate = false) {
    if (!track?.kmp || !clipboard) return;
    try {
      let current = track.kmp;
      const nextSelectedIds: string[] = [];
      let nextSelectedId: string | null = null;
      for (const entry of sortClipboardEntriesForPaste(clipboard.entries)) {
        const pastedPosition = {
          x: clipboard.anchor.x + offset.x + entry.relativeOffset.x,
          y: clipboard.anchor.y + offset.y + entry.relativeOffset.y,
          z: clipboard.anchor.z + offset.z + entry.relativeOffset.z,
        };
        const result = appendCopiedEntity(current, entry.entity, pastedPosition);
        current = parseKmp(result.bytes);
        nextSelectedIds.push(result.selectedId);
        if (entry.entity.id === clipboard.primaryId) nextSelectedId = result.selectedId;
      }
      const nextTrack = replaceCourseKmp(track, current.original);
      history.applyEditorChange(nextTrack, nextSelectedId ?? nextSelectedIds.at(-1) ?? null, true, nextSelectedIds);
      const count = clipboard.entries.length;
      if (count === 1) {
        setStatus(reportDuplicate ? `Duplicated ${entityLabel(clipboard.entries[0].entity)}.` : `Pasted ${entityLabel(clipboard.entries[0].entity)}.`);
      } else {
        setStatus(reportDuplicate ? `Duplicated ${count} selected elements.` : `Pasted ${count} selected elements.`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function copySelectedEntity() {
    const entities = getClipboardSourceEntities(selectedEntities, selected);
    if (entities.length === 0 || !canCopySelection()) return;
    clipboardEntityRef.current = createClipboardEntity(entities, selection.selectedIdRef.current);
    setHasClipboardEntity(true);
    setStatus(entities.length === 1 ? `Copied ${entityLabel(entities[0])}.` : `Copied ${entities.length} selected elements.`);
  }

  function duplicateSelectedEntity() {
    const entities = getClipboardSourceEntities(selectedEntities, selected);
    if (entities.length === 0 || !canCopySelection()) return;
    const clipboard = createClipboardEntity(entities, selection.selectedIdRef.current);
    clipboardEntityRef.current = clipboard;
    setHasClipboardEntity(true);
    pasteClipboardEntity(clipboard, { x: 300, y: 0, z: 300 }, true);
  }

  return { hasClipboardEntity, canCopySelection, copySelectedEntity, duplicateSelectedEntity, pasteClipboardEntity };
}
