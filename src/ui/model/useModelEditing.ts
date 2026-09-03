// Model mode's state and edit actions.
//
// Geometry edits are part of the track document, so they go through the same history stack as
// everything else and get baked into `course_model.brres` on export. Only the selection is
// mode-local: it is a view thing, and losing it on undo would be worse than keeping it.

import { useCallback, useMemo, useState } from 'react';
import {
  addImportedMesh,
  createIdentityMeshTransform,
  findMeshEdit,
  meshTargetKey,
  narrowMeshGranularity,
  removeImportedMesh,
  retargetMeshGranularity,
  updateImportedMesh,
  upsertMeshEdit,
  widenMeshGranularity,
  type EditorMeshTarget,
  type ImportedMesh,
  type MeshSelectionGranularity,
  type MeshTransform,
} from '../../lib/brresEditor';
import {
  courseMeshCenter,
  describeCourseMesh,
  listCourseMeshes,
  type CourseMeshInfo,
  type CourseMeshList,
} from '../../lib/brres/courseMeshes';
import { COURSE_MODEL_PATH, type TrackDocument } from '../../lib/track';
import type { EditorModeContext } from '../modes/types';

export interface ModelEditing {
  /** Every draw call in the course model, or null when the track has no course model. */
  meshList: CourseMeshList | null;
  courseModel: Uint8Array | null;
  selection: EditorMeshTarget[];
  selectionKeys: string[];
  granularity: MeshSelectionGranularity;
  /** The mesh the inspector edits: the last one selected. */
  active: EditorMeshTarget | null;
  activeLabel: string;
  activeTransform: MeshTransform;
  activeHidden: boolean;
  activeDeleted: boolean;
  placedObjects: ImportedMesh[];
  /** The placed object the inspector edits, when one is selected instead of a mesh. */
  activePlaced: ImportedMesh | null;

  selectMeshes: (targets: EditorMeshTarget[], additive?: boolean) => void;
  selectPlaced: (id: string | null) => void;
  setGranularity: (granularity: MeshSelectionGranularity) => void;
  widen: () => void;
  narrow: () => void;

  setActiveTransform: (transform: MeshTransform) => void;
  setMeshTransform: (target: EditorMeshTarget, transform: MeshTransform) => void;
  setHidden: (hidden: boolean) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  resetSelection: () => void;

  /** Merges a model into the course geometry at `position`, or near the selection / start line. */
  placeObject: (asset: { sourcePath: string; label: string; data: Uint8Array }, position?: { x: number; y: number; z: number }) => void;
  updatePlaced: (id: string, patch: Partial<Omit<ImportedMesh, 'id'>>) => void;
  removePlaced: (id: string) => void;

  resolveImportSource: (sourcePath: string) => Uint8Array | null;
  describeTarget: (target: EditorMeshTarget) => string;
  meshByDrawOp: Map<number, CourseMeshInfo>;
  /** What the outliner needs to badge a row: whether that draw call has been touched. */
  editStateByDrawOp: Map<number, MeshEditState>;
}

export interface MeshEditState {
  hidden: boolean;
  deleted: boolean;
  moved: boolean;
}

function findCourseModel(track: TrackDocument | null): Uint8Array | null {
  const entry = track?.archiveEntries.find(
    (candidate) => candidate.type === 'file' && candidate.path.toLowerCase().endsWith('course_model.brres') && candidate.data,
  );
  return entry?.data ?? null;
}

export function useModelEditing(ctx: EditorModeContext, active: boolean): ModelEditing {
  const { track, history, setStatus } = ctx;
  const [selection, setSelection] = useState<EditorMeshTarget[]>([]);
  const [granularity, setGranularityState] = useState<MeshSelectionGranularity>('component');
  const [placedSelectionId, setPlacedSelectionId] = useState<string | null>(null);

  const courseModel = useMemo(() => (active ? findCourseModel(track) : null), [active, track]);
  // Keyed on the byte array, so a KMP edit does not force a re-read of the model.
  const meshList = useMemo(() => (courseModel ? listCourseMeshes(courseModel) : null), [courseModel]);
  const meshByDrawOp = useMemo(
    () => new Map((meshList?.meshes ?? []).map((mesh) => [mesh.drawOpIndex, mesh])),
    [meshList],
  );

  const edits = useMemo(() => track?.meshEdits ?? [], [track]);
  const editStateByDrawOp = useMemo(() => {
    const map = new Map<number, MeshEditState>();
    for (const edit of edits) {
      const previous = map.get(edit.target.drawOpIndex);
      const { translation, rotation, scale } = edit.transform;
      const moved =
        translation.x !== 0 || translation.y !== 0 || translation.z !== 0 ||
        rotation.x !== 0 || rotation.y !== 0 || rotation.z !== 0 ||
        scale.x !== 1 || scale.y !== 1 || scale.z !== 1;
      map.set(edit.target.drawOpIndex, {
        hidden: (previous?.hidden ?? false) || !edit.visible,
        deleted: (previous?.deleted ?? false) || edit.deleted,
        moved: (previous?.moved ?? false) || moved,
      });
    }
    return map;
  }, [edits]);
  const placedObjects = useMemo(() => track?.importedMeshes ?? [], [track]);
  const activeTarget = selection.length > 0 ? selection[selection.length - 1] : null;
  const activeEdit = activeTarget ? findMeshEdit(edits, activeTarget) : null;
  const activePlaced = placedObjects.find((mesh) => mesh.id === placedSelectionId) ?? null;

  const describeTarget = useCallback(
    (target: EditorMeshTarget) => {
      if (target.granularity === 'node') return meshList?.nodeNames.get(target.nodeId) ?? `Bone ${target.nodeId}`;
      const mesh = meshByDrawOp.get(target.drawOpIndex);
      const base = mesh ? describeCourseMesh(mesh) : `Mesh ${target.drawOpIndex + 1}`;
      return target.granularity === 'component' && target.componentIndex !== null
        ? `${base} · piece ${target.componentIndex + 1}`
        : base;
    },
    [meshByDrawOp, meshList],
  );

  /** Every geometry change lands here, so history and the status line stay consistent. */
  const commit = useCallback(
    (patch: Partial<Pick<TrackDocument, 'meshEdits' | 'importedMeshes' | 'meshImportSources'>>, message: string) => {
      const current = ctx.trackRef.current ?? track;
      if (!current) return;
      history.applyEditorChange({ ...current, ...patch }, ctx.selection.selectedId, true, ctx.selection.selectedIds);
      setStatus(message);
    },
    [ctx.selection.selectedId, ctx.selection.selectedIds, ctx.trackRef, history, setStatus, track],
  );

  const selectMeshes = useCallback((targets: EditorMeshTarget[], additive = false) => {
    setPlacedSelectionId(null);
    setSelection((current) => {
      if (!additive) return targets;
      const keys = new Set(current.map((entry) => meshTargetKey(entry)));
      return [...current, ...targets.filter((target) => !keys.has(meshTargetKey(target)))];
    });
  }, []);

  const selectPlaced = useCallback((id: string | null) => {
    setPlacedSelectionId(id);
    if (id !== null) setSelection([]);
  }, []);

  const setGranularity = useCallback((next: MeshSelectionGranularity) => {
    setGranularityState(next);
    setSelection((current) => {
      const retargeted = current.map((target) => retargetMeshGranularity(target, next));
      const seen = new Set<string>();
      return retargeted.filter((target) => {
        const key = meshTargetKey(target);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
  }, []);

  const setMeshTransform = useCallback(
    (target: EditorMeshTarget, transform: MeshTransform) => {
      const current = ctx.trackRef.current ?? track;
      if (!current) return;
      commit({ meshEdits: upsertMeshEdit(current.meshEdits ?? [], target, { transform }) }, `Moved ${describeTarget(target)}.`);
    },
    [commit, ctx.trackRef, describeTarget, track],
  );

  const setActiveTransform = useCallback(
    (transform: MeshTransform) => {
      if (activePlaced) {
        const current = ctx.trackRef.current ?? track;
        if (!current) return;
        commit(
          { importedMeshes: updateImportedMesh(current.importedMeshes ?? [], activePlaced.id, { transform }) },
          `Moved ${activePlaced.label ?? activePlaced.sourcePath}.`,
        );
        return;
      }
      if (activeTarget) setMeshTransform(activeTarget, transform);
    },
    [activePlaced, activeTarget, commit, ctx.trackRef, setMeshTransform, track],
  );

  const setHidden = useCallback(
    (hidden: boolean) => {
      const current = ctx.trackRef.current ?? track;
      if (!current) return;
      if (activePlaced) {
        commit(
          { importedMeshes: updateImportedMesh(current.importedMeshes ?? [], activePlaced.id, { visible: !hidden }) },
          `${hidden ? 'Hid' : 'Showed'} ${activePlaced.label ?? activePlaced.sourcePath}.`,
        );
        return;
      }
      if (selection.length === 0) return;
      let next = current.meshEdits ?? [];
      for (const target of selection) next = upsertMeshEdit(next, target, { visible: !hidden });
      commit({ meshEdits: next }, `${hidden ? 'Hid' : 'Showed'} ${selection.length} mesh${selection.length === 1 ? '' : 'es'}.`);
    },
    [activePlaced, commit, ctx.trackRef, selection, track],
  );

  const deleteSelection = useCallback(() => {
    const current = ctx.trackRef.current ?? track;
    if (!current) return;
    if (activePlaced) {
      commit(
        { importedMeshes: removeImportedMesh(current.importedMeshes ?? [], activePlaced.id) },
        `Removed ${activePlaced.label ?? activePlaced.sourcePath}.`,
      );
      setPlacedSelectionId(null);
      return;
    }
    if (selection.length === 0) return;
    let next = current.meshEdits ?? [];
    for (const target of selection) next = upsertMeshEdit(next, target, { deleted: true });
    commit({ meshEdits: next }, `Deleted ${selection.length} mesh${selection.length === 1 ? '' : 'es'}.`);
  }, [activePlaced, commit, ctx.trackRef, selection, track]);

  const resetSelection = useCallback(() => {
    const current = ctx.trackRef.current ?? track;
    if (!current || selection.length === 0) return;
    let next = current.meshEdits ?? [];
    for (const target of selection) {
      next = upsertMeshEdit(next, target, { transform: createIdentityMeshTransform(), visible: true, deleted: false });
    }
    commit({ meshEdits: next }, `Restored ${selection.length} mesh${selection.length === 1 ? '' : 'es'}.`);
  }, [commit, ctx.trackRef, selection, track]);

  const duplicateSelection = useCallback(() => {
    const current = ctx.trackRef.current ?? track;
    if (!current || !activeTarget) return;
    const label = `${describeTarget(activeTarget)} copy`;
    const copy: ImportedMesh = {
      id: `mesh-copy-${Date.now().toString(36)}-${Math.floor(Math.random() * 0x10000).toString(36)}`,
      sourcePath: COURSE_MODEL_PATH,
      modelName: activeTarget.modelName,
      label,
      // Offset so the copy is not hidden inside the original.
      transform: { ...createIdentityMeshTransform(), translation: { x: 0, y: 500, z: 0 } },
      visible: true,
      sourceShape: activeTarget,
    };
    commit({ importedMeshes: addImportedMesh(current.importedMeshes ?? [], copy) }, `Duplicated ${describeTarget(activeTarget)}.`);
    setPlacedSelectionId(copy.id);
    setSelection([]);
  }, [activeTarget, commit, ctx.trackRef, describeTarget, track]);

  const placeObject = useCallback(
    (asset: { sourcePath: string; label: string; data: Uint8Array }, position?: { x: number; y: number; z: number }) => {
      const current = ctx.trackRef.current ?? track;
      if (!current) return;
      // A viewport drop says exactly where; otherwise drop it on whatever is selected, so it
      // lands somewhere the user is looking.
      const anchor =
        position ??
        (activeTarget && courseModel ? courseMeshCenter(courseModel, activeTarget.drawOpIndex) : null) ??
        firstStartPosition(current) ?? { x: 0, y: 0, z: 0 };
      const mesh: ImportedMesh = {
        id: `placed-${Date.now().toString(36)}-${Math.floor(Math.random() * 0x10000).toString(36)}`,
        sourcePath: asset.sourcePath,
        modelName: '',
        label: asset.label,
        transform: { ...createIdentityMeshTransform(), translation: anchor },
        visible: true,
      };
      commit(
        {
          importedMeshes: addImportedMesh(current.importedMeshes ?? [], mesh),
          meshImportSources: { ...(current.meshImportSources ?? {}), [asset.sourcePath]: asset.data },
        },
        `Placed ${asset.label} as course geometry.`,
      );
      setPlacedSelectionId(mesh.id);
      setSelection([]);
    },
    [activeTarget, commit, courseModel, ctx.trackRef, track],
  );

  const updatePlaced = useCallback(
    (id: string, patch: Partial<Omit<ImportedMesh, 'id'>>) => {
      const current = ctx.trackRef.current ?? track;
      if (!current) return;
      commit({ importedMeshes: updateImportedMesh(current.importedMeshes ?? [], id, patch) }, 'Updated placed object.');
    },
    [commit, ctx.trackRef, track],
  );

  const removePlaced = useCallback(
    (id: string) => {
      const current = ctx.trackRef.current ?? track;
      if (!current) return;
      commit({ importedMeshes: removeImportedMesh(current.importedMeshes ?? [], id) }, 'Removed placed object.');
      setPlacedSelectionId((value) => (value === id ? null : value));
    },
    [commit, ctx.trackRef, track],
  );

  const resolveImportSource = useCallback(
    (sourcePath: string) => (ctx.trackRef.current ?? track)?.meshImportSources?.[sourcePath] ?? null,
    [ctx.trackRef, track],
  );

  return {
    meshList,
    courseModel,
    selection,
    selectionKeys: selection.map((target) => meshTargetKey(target)),
    granularity,
    active: activeTarget,
    activeLabel: activeTarget ? describeTarget(activeTarget) : '',
    activeTransform: activePlaced?.transform ?? activeEdit?.transform ?? createIdentityMeshTransform(),
    activeHidden: activePlaced ? !activePlaced.visible : activeEdit ? !activeEdit.visible : false,
    activeDeleted: activeEdit?.deleted ?? false,
    placedObjects,
    activePlaced,

    selectMeshes,
    selectPlaced,
    setGranularity,
    widen: () => setGranularity(widenMeshGranularity(granularity)),
    narrow: () => setGranularity(narrowMeshGranularity(granularity)),

    setActiveTransform,
    setMeshTransform,
    setHidden,
    deleteSelection,
    duplicateSelection,
    resetSelection,

    placeObject,
    updatePlaced,
    removePlaced,

    resolveImportSource,
    describeTarget,
    meshByDrawOp,
    editStateByDrawOp,
  };
}

/** The first start position, used as a fallback anchor for a placed object. */
function firstStartPosition(track: TrackDocument): { x: number; y: number; z: number } | null {
  const start = track.kmp?.entities.find((entity) => entity.section === 'KTPT');
  return start?.position ? { ...start.position } : null;
}
