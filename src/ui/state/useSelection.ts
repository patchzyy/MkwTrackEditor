import { useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

export interface EditorSelection {
  selectedId: string | null;
  selectedIds: string[];
  /** Mirrors `selectedId` so callbacks and effects can read the newest value synchronously. */
  selectedIdRef: MutableRefObject<string | null>;
  selectedIdsRef: MutableRefObject<string[]>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  applySelection: (nextSelectedIds: string[], nextSelectedId?: string | null) => void;
  selectEntity: (id: string | null, additive?: boolean) => void;
  selectEntities: (ids: string[], additive?: boolean) => void;
  /** Replaces the selection with a single id (used by the model-node/transform selection path). */
  selectOnly: (id: string | null) => void;
}

/** Owns the primary selection id and the multi-selection list, plus their synchronous mirrors. */
export function useSelection(): EditorSelection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedIdRef = useRef<string | null>(selectedId);
  const selectedIdsRef = useRef<string[]>(selectedIds);

  selectedIdRef.current = selectedId;
  selectedIdsRef.current = selectedIds;

  function applySelection(nextSelectedIds: string[], nextSelectedId = nextSelectedIds.at(-1) ?? null) {
    selectedIdRef.current = nextSelectedId;
    selectedIdsRef.current = nextSelectedIds;
    setSelectedId(nextSelectedId);
    setSelectedIds(nextSelectedIds);
  }

  function selectEntity(id: string | null, additive = false) {
    if (!id) {
      if (!additive) applySelection([]);
      return;
    }
    if (!additive) {
      applySelection([id], id);
      return;
    }
    const current = selectedIdsRef.current;
    const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    applySelection(next, next.includes(id) ? id : next.at(-1) ?? null);
  }

  function selectEntities(ids: string[], additive = false) {
    const uniqueIds = ids.filter((id, index) => ids.indexOf(id) === index);
    if (!additive) {
      applySelection(uniqueIds, uniqueIds.at(-1) ?? null);
      return;
    }
    const current = selectedIdsRef.current;
    const next = [...current];
    for (const id of uniqueIds) {
      if (!next.includes(id)) next.push(id);
    }
    applySelection(next, uniqueIds.at(-1) ?? next.at(-1) ?? null);
  }

  function selectOnly(id: string | null) {
    applySelection(id ? [id] : [], id);
  }

  return {
    selectedId,
    selectedIds,
    selectedIdRef,
    selectedIdsRef,
    setSelectedId,
    setSelectedIds,
    applySelection,
    selectEntity,
    selectEntities,
    selectOnly,
  };
}
