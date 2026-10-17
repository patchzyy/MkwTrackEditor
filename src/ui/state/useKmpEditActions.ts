import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { patchBrresNodeTransform, type BrresTransform, type EditorProjectState } from '../../lib/brresEditor';
import type { ViewportTransformSelection } from '../../lib/brresRenderAdapter';
import type { GravityAreaPatch } from '../../lib/gravityField';
import {
  appendKmpArea,
  appendKmpGravityGate,
  patchKmpAreaFields,
  appendKmpCamera,
  appendKmpCheckpoint,
  appendKmpGobj,
  appendKmpPoint,
  appendKmpPotiPoint,
  appendKmpPotiRoute,
  deleteKmpEntity,
  forkKmpPathPoint,
  insertKmpPathPoint,
  mergeKmpPathGroupWithNext,
  moveKmpEntity,
  parseKmp,
  patchKmpCameraHeaderField,
  patchKmpEntityPosition,
  patchKmpEntityRotation,
  patchKmpEntityRouteIndex,
  patchKmpEntityScale,
  patchKmpGobjObjectId,
  patchKmpGobjPresenceFlags,
  patchKmpGobjSetting,
  patchKmpPathGroupLinks,
  splitKmpPathGroup,
  type AppendableKmpPointSection,
  type AppendableKmpSection,
  type KmpCameraHeaderField,
  type KmpDocument,
  type KmpEntity,
  type KmpRouteInsertTarget,
  type Vec3,
} from '../../lib/kmp';
import {
  appendCopiedEntity,
  findMatchingEntity,
  getDeletionOrder,
  getSelectionIdAfterRoutePointDeletion,
  materializeViewportInteractionTrack,
  offsetCheckpointPoint,
  previewMovedCheckpointEndpoint,
  previewMovedEntity,
  previewRotatedEntity,
  previewScaledEntity,
  type PathInfo,
} from '../../lib/kmpEdit';
import {
  NO_CAMERA_LINK,
  addCamera,
  applyCameraValues,
  createDefaultCameraValues,
  deleteCamera,
  duplicateCamera,
  moveCamera,
  setChainOrder,
  setChainStart,
  type CameraChainKind,
  type CameraValues,
} from '../camera/cameraDocument';
import type { CommonResourceArchive } from '../../lib/objflow';
import { findArchiveData } from '../inspector/postEffectResources';
import { replaceArchiveFile, replaceCourseKmp, type TrackDocument } from '../../lib/track';
import { buildFillBetweenPositions, type FillBetweenSelection } from '../fillBetween';
import { friendlyGroupSectionLabel, friendlySectionSingularLabel, friendlyTrackAssetName } from '../labels';
import { browserObjectTitle } from '../objects/objectCatalog';
import type { EditorHistory } from './useEditorHistory';
import type { EditorSelection } from './useSelection';

export interface KmpEditActionsContext {
  track: TrackDocument | null;
  trackRef: MutableRefObject<TrackDocument | null>;
  projectState: EditorProjectState | null;
  objFlow: CommonResourceArchive['objFlow'] | null;
  selection: EditorSelection;
  history: EditorHistory;
  setStatus: Dispatch<SetStateAction<string>>;
  selected: KmpEntity | null;
  selectedEntities: KmpEntity[];
  selectedPathInfo: PathInfo | null;
  canBatchReplaceObjects: boolean;
  batchOffset: Vec3;
  fillBetweenSelection: FillBetweenSelection | null;
  fillBetweenCount: number;
  entityLabel: (entity: KmpEntity) => string;
}

export type KmpEditActions = ReturnType<typeof useKmpEditActions>;

/**
 * Every KMP mutation the editor can perform. Each one produces a new `TrackDocument` and pushes it
 * through the history stack, so undo/redo covers placement, transforms, path edits and property
 * changes uniformly.
 */
export function useKmpEditActions(context: KmpEditActionsContext) {
  const {
    track,
    trackRef,
    projectState,
    objFlow,
    selection,
    history,
    setStatus,
    selected,
    selectedEntities,
    selectedPathInfo,
    canBatchReplaceObjects,
    batchOffset,
    fillBetweenSelection,
    fillBetweenCount,
    entityLabel,
  } = context;
  const { applyEditorChange, applyTransientEditorChange, editSessionRef } = history;

  function objectTitle(objectId: number): string {
    return browserObjectTitle({
      objectId,
      name: objFlow?.byId.get(objectId)?.name ?? '',
      resources: objFlow?.byId.get(objectId)?.resources ?? '',
    });
  }

  function moveEntity(entity: KmpEntity, position: Vec3) {
    patchSelectedEntity({ field: 'position', value: position }, entity.id);
  }

  function moveCheckpointEndpoint(entity: KmpEntity, side: 'left' | 'right', position: Vec3) {
    const currentTrack = trackRef.current;
    if (!currentTrack?.kmp) return;
    const primary = currentTrack.kmp.entities.find((candidate) => candidate.id === entity.id)!;
    let nextTrack = currentTrack;
    for (const candidate of currentTrack.kmp.entities) {
      if (!candidate.checkpoint || (candidate.id !== primary.id && !selection.selectedIdsRef.current.includes(candidate.id))) continue;
      nextTrack = previewMovedCheckpointEndpoint(nextTrack, candidate.id, side, offsetCheckpointPoint(candidate.checkpoint[side], primary.checkpoint![side], position));
    }
    if (editSessionRef.current) applyTransientEditorChange(nextTrack);
    else applyEditorChange(materializeViewportInteractionTrack(currentTrack, nextTrack));
  }

  function rotateEntity(entity: KmpEntity, rotation: Vec3) {
    patchSelectedEntity({ field: 'rotation', value: rotation }, entity.id);
  }

  function scaleEntity(entity: KmpEntity, scale: Vec3) {
    patchSelectedEntity({ field: 'scale', value: scale }, entity.id);
  }

  function patchSelectedEntity(
    patch: ((kmp: KmpDocument, entity: KmpEntity) => Uint8Array) | { field: 'position' | 'rotation' | 'scale'; value: Vec3 },
    primaryId = selection.selectedIdRef.current,
  ) {
    const currentTrack = trackRef.current;
    if (!currentTrack?.kmp || !primaryId) return;
    const primary = currentTrack.kmp.entities.find((entity) => entity.id === primaryId)!;
    let current = currentTrack.kmp;
    let nextTrack = currentTrack;
    for (const entity of currentTrack.kmp.entities) {
      if (entity.id !== primary.id && !selection.selectedIdsRef.current.includes(entity.id)) continue;
      if (typeof patch !== 'function') {
        const before = primary[patch.field]!;
        const original = entity[patch.field];
        if (entity.section === 'STGI' || !original) continue;
        const value = {
          x: original.x + (patch.value.x - before.x),
          y: original.y + (patch.value.y - before.y),
          z: original.z + (patch.value.z - before.z),
        };
        nextTrack = patch.field === 'position'
          ? previewMovedEntity(nextTrack, entity.id, value)
          : patch.field === 'rotation'
            ? previewRotatedEntity(nextTrack, entity.id, value)
            : previewScaledEntity(nextTrack, entity.id, value);
      } else if (entity.section === primary.section) {
        current = { ...current, original: patch(current, entity) };
      }
    }
    if (typeof patch !== 'function' && editSessionRef.current) applyTransientEditorChange(nextTrack);
    else applyEditorChange(typeof patch !== 'function' ? materializeViewportInteractionTrack(currentTrack, nextTrack) : replaceCourseKmp(currentTrack, current.original));
  }

  function selectMatchingObjects() {
    if (!track?.kmp) return;
    const objectIds = new Set(selectedEntities.filter((entity) => entity.section === 'GOBJ').map((entity) => entity.objectId));
    const ids = track.kmp.entities.filter((entity) => entity.section === 'GOBJ' && objectIds.has(entity.objectId)).map((entity) => entity.id);
    selection.applySelection(ids, ids.includes(selection.selectedIdRef.current!) ? selection.selectedIdRef.current : ids.at(-1) ?? null);
    setStatus(`Selected ${ids.length} objects with matching IDs.`);
  }

  /** Gravity field edits: several AREA fields, possibly across a whole gate chain, in one step. */
  function applyAreaPatches(patches: GravityAreaPatch[]) {
    if (!track?.kmp || patches.length === 0) return;
    applyEditorChange(replaceCourseKmp(track, patchKmpAreaFields(track.kmp, patches)));
  }

  /** Adds a gravity gate after the given gate and selects it. */
  function extendGravityChain(entity: KmpEntity) {
    if (!track?.kmp || entity.section !== 'AREA') return;
    try {
      const result = appendKmpGravityGate(track.kmp, entity.index);
      const id = `AREA-${result.index}`;
      applyEditorChange(replaceCourseKmp(track, result.bytes), id, true, [id]);
      setStatus(`Added gravity gate ${result.index + 1} after gate ${entity.index + 1}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function selectArea(index: number) {
    const id = `AREA-${index}`;
    if (!track?.kmp?.entities.some((candidate) => candidate.id === id)) return;
    selection.setSelectedId(id);
    selection.setSelectedIds([id]);
  }

  function updateViewportTransformSelection(selectionTarget: ViewportTransformSelection, patch: Partial<BrresTransform>) {
    if (!track) return;
    const node = projectState?.archiveNodes.find((candidate) => candidate.id === selectionTarget.id);
    if (!node) return;
    const data = findArchiveData(track, node.archivePath);
    if (!data) return;
    const transform: BrresTransform = {
      scale: patch.scale ?? selectionTarget.scale ?? node.transform.scale,
      rotation: patch.rotation ?? selectionTarget.rotation ?? node.transform.rotation,
      translation: patch.translation ?? selectionTarget.position,
    };
    applyEditorChange(replaceArchiveFile(track, node.archivePath, patchBrresNodeTransform(data, node, transform)), node.id, true, [node.id]);
    setStatus(`Updated ${node.name} in ${friendlyTrackAssetName(node.archivePath)}.`);
  }

  function addObject(objectId: number, position: Vec3) {
    if (!track?.kmp) return;
    try {
      const nextKmp = appendKmpGobj(track.kmp, objectId, position);
      const nextTrack = replaceCourseKmp(track, nextKmp);
      const newSelectedId = `GOBJ-${(nextTrack.kmp?.sections.find((section) => section.name === 'GOBJ')?.count ?? 1) - 1}`;
      applyEditorChange(nextTrack, newSelectedId, true, [newSelectedId]);
      setStatus(`Added ${objectTitle(objectId)} at ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function addKmpPoint(section: AppendableKmpSection, position: Vec3) {
    if (!track?.kmp) return;
    try {
      const nextKmp =
        section === 'CKPT'
          ? appendKmpCheckpoint(track.kmp, position)
          : section === 'POTI'
            ? appendKmpPotiRoute(track.kmp, position)
            : section === 'AREA'
              ? appendKmpArea(track.kmp, position)
              : section === 'CAME'
                ? appendKmpCamera(track.kmp, position)
            : appendKmpPoint(track.kmp, section as AppendableKmpPointSection, position);
      const nextTrack = replaceCourseKmp(track, nextKmp);
      const nextCount = section === 'POTI' ? (nextTrack.kmp?.routes.length ?? 1) : (nextTrack.kmp?.sections.find((candidate) => candidate.name === section)?.count ?? 1);
      const newIndex = nextCount - 1;
      const newSelectedId = section === 'POTI' ? `POTI-${newIndex}-0` : `${section}-${newIndex}`;
      applyEditorChange(nextTrack, newSelectedId, true, [newSelectedId]);
      setStatus(`Added ${friendlySectionSingularLabel(section)} at ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function addPotiNode(entity: KmpEntity) {
    if (!track?.kmp || !entity.routePoint) return;
    try {
      const position = { x: entity.position.x + 300, y: entity.position.y, z: entity.position.z };
      const nextKmp = appendKmpPotiPoint(track.kmp, entity.routePoint.routeIndex, entity.routePoint.pointIndex, position);
      const nextTrack = replaceCourseKmp(track, nextKmp);
      const newSelectedId = `POTI-${entity.routePoint.routeIndex}-${entity.routePoint.pointIndex + 1}`;
      applyEditorChange(nextTrack, newSelectedId, true, [newSelectedId]);
      setStatus(`Added node to object route ${entity.routePoint.routeIndex}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function insertRoutePoint(target: KmpRouteInsertTarget, position: Vec3) {
    if (!track?.kmp) return;
    try {
      let nextKmp: Uint8Array;
      let newSelectedId: string;
      let label: string;
      if (target.section === 'POTI') {
        const route = track.kmp.routes[target.routeIndex];
        if (!route) throw new Error(`Cannot add POTI node: route ${target.routeIndex} is missing.`);
        const nextPointIndex = Math.max(0, Math.min(target.afterPointIndex + 1, route.points.length));
        nextKmp = appendKmpPotiPoint(track.kmp, target.routeIndex, target.afterPointIndex, position);
        newSelectedId = `POTI-${target.routeIndex}-${nextPointIndex}`;
        label = `object route ${target.routeIndex} node`;
      } else {
        const graph = track.kmp.pathGraphs.find((candidate) => candidate.pointSection === target.section);
        const group = graph?.groups[target.groupIndex];
        if (!graph || !group) throw new Error(`Cannot add ${target.section}: group ${target.groupIndex} is missing.`);
        if (target.mode === 'fork') {
          const nextPointSectionCount = track.kmp.sections.find((candidate) => candidate.name === target.section)?.count ?? 0;
          nextKmp = forkKmpPathPoint(track.kmp, target.section, target.groupIndex, target.localPointIndex, position);
          newSelectedId = `${target.section}-${nextPointSectionCount}`;
          label = `${friendlySectionSingularLabel(target.section)} fork`;
        } else {
          const nextPointIndex = group.startIndex + Math.max(0, Math.min(target.afterPointIndex + 1, group.pointCount));
          nextKmp = insertKmpPathPoint(track.kmp, target.section, target.groupIndex, target.afterPointIndex, position);
          newSelectedId = `${target.section}-${nextPointIndex}`;
          label = friendlySectionSingularLabel(target.section);
        }
      }
      const nextTrack = replaceCourseKmp(track, nextKmp);
      applyEditorChange(nextTrack, newSelectedId, true, [newSelectedId]);
      setStatus(`Added ${label} at ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function createObjectRoute(entity: KmpEntity) {
    if (!track?.kmp || entity.section !== 'GOBJ' || entity.routeIndex === undefined || entity.routeIndex !== 0xffff) return;
    try {
      const routedBytes = appendKmpPotiRoute(track.kmp, entity.position);
      const routedDoc = parseKmp(routedBytes);
      const liveEntity = routedDoc.entities.find((candidate) => candidate.id === entity.id);
      if (!liveEntity) throw new Error('Could not find the selected object after creating a route.');
      const routeIndex = Math.max(0, routedDoc.routes.length - 1);
      const nextTrack = replaceCourseKmp(track, patchKmpEntityRouteIndex(routedDoc, liveEntity, routeIndex));
      applyEditorChange(nextTrack, entity.id, true, [entity.id]);
      setStatus(`Created movement path ${routeIndex} for ${entityLabel(entity)}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function resetObjectBehavior(entity: KmpEntity) {
    if (!track?.kmp || entity.section !== 'GOBJ') return;
    try {
      let nextDoc = track.kmp;
      let liveEntity = nextDoc.entities.find((candidate) => candidate.id === entity.id);
      if (!liveEntity) return;
      nextDoc = parseKmp(patchKmpEntityRouteIndex(nextDoc, liveEntity, 0xffff));
      liveEntity = nextDoc.entities.find((candidate) => candidate.id === entity.id);
      if (!liveEntity) return;
      for (let i = 0; i < 8; i++) {
        nextDoc = parseKmp(patchKmpGobjSetting(nextDoc, liveEntity, i, 0));
        liveEntity = nextDoc.entities.find((candidate) => candidate.id === entity.id);
        if (!liveEntity) return;
      }
      nextDoc = parseKmp(patchKmpGobjPresenceFlags(nextDoc, liveEntity, 0x003f));
      applyEditorChange(replaceCourseKmp(track, nextDoc.original), entity.id, true, [entity.id]);
      setStatus(`Reset ${entityLabel(entity)} to default object behavior.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function clearObjectRoute(entity: KmpEntity) {
    if (!track?.kmp || entity.section !== 'GOBJ' || entity.routeIndex === undefined || entity.routeIndex === 0xffff) return;
    try {
      const nextTrack = replaceCourseKmp(track, patchKmpEntityRouteIndex(track.kmp, entity, 0xffff));
      applyEditorChange(nextTrack, entity.id, true, [entity.id]);
      setStatus(`Cleared movement path from ${entityLabel(entity)}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function selectObjectRoute(entity: KmpEntity) {
    if (!track?.kmp || entity.section !== 'GOBJ' || entity.routeIndex === undefined || entity.routeIndex === 0xffff) return;
    const routeId = `POTI-${entity.routeIndex}-0`;
    const routeEntity = track.kmp.entities.find((candidate) => candidate.id === routeId);
    if (!routeEntity) {
      setStatus(`Could not find movement path ${entity.routeIndex} for ${entityLabel(entity)}.`);
      return;
    }
    selection.setSelectedId(routeId);
    selection.setSelectedIds([routeId]);
    setStatus(`Selected movement path ${entity.routeIndex} for ${entityLabel(entity)}.`);
  }

  function applySafeFallingRockDefaults(entity: KmpEntity) {
    if (!track?.kmp || entity.section !== 'GOBJ' || !entity.objectSettings) return;
    try {
      const safeTriggerSetting = entity.objectSettings[2] === 0 ? 1 : entity.objectSettings[2];
      const nextTrack = replaceCourseKmp(track, patchKmpGobjSetting(track.kmp, entity, 2, safeTriggerSetting));
      applyEditorChange(nextTrack, entity.id, true, [entity.id]);
      setStatus(`Applied safe vanilla falling-rock defaults to ${entityLabel(entity)}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function createCannonPointFromObject(entity: KmpEntity) {
    if (!track?.kmp || entity.section !== 'GOBJ') return;
    try {
      const appended = parseKmp(appendKmpPoint(track.kmp, 'CNPT', entity.position));
      const cannonIndex = (appended.sections.find((section) => section.name === 'CNPT')?.count ?? 1) - 1;
      const newCannonId = `CNPT-${cannonIndex}`;
      const newCannon = appended.entities.find((candidate) => candidate.id === newCannonId);
      if (!newCannon) throw new Error('Could not find the new cannon point after creating it.');
      const rotated = parseKmp(patchKmpEntityRotation(appended, newCannon, entity.rotation ?? { x: 0, y: 0, z: 0 }));
      const nextTrack = replaceCourseKmp(track, rotated.original);
      applyEditorChange(nextTrack, newCannonId, true, [newCannonId]);
      setStatus(`Created cannon point ${cannonIndex} from ${entityLabel(entity)}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function applyRoulettePlatformDefaults(entity: KmpEntity) {
    if (!track?.kmp || entity.section !== 'GOBJ') return;
    try {
      let nextDoc = parseKmp(patchKmpEntityPosition(track.kmp, entity, { x: 0, y: 0, z: 0 }));
      let liveEntity = nextDoc.entities.find((candidate) => candidate.id === entity.id);
      if (!liveEntity) throw new Error('Could not find the selected roulette platform after moving it.');
      nextDoc = parseKmp(patchKmpEntityRotation(nextDoc, liveEntity, { x: 0, y: 0, z: 0 }));
      liveEntity = nextDoc.entities.find((candidate) => candidate.id === entity.id);
      if (!liveEntity) throw new Error('Could not find the selected roulette platform after rotating it.');
      nextDoc = parseKmp(patchKmpEntityScale(nextDoc, liveEntity, { x: 1, y: 1, z: 1 }));
      applyEditorChange(replaceCourseKmp(track, nextDoc.original), entity.id, true, [entity.id]);
      setStatus(`Applied required world-center defaults to ${entityLabel(entity)}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function deleteSelectedEntity() {
    if (!track?.kmp || selectedEntities.length === 0) return;
    const deletable = selectedEntities.filter((entity) => entity.section !== 'STGI').sort(getDeletionOrder);
    if (deletable.length === 0) return;
    const label = deletable.length === 1 ? entityLabel(deletable[0]) : `${deletable.length} selected elements`;
    if (!window.confirm(`Delete ${label}?`)) return;
    try {
      let current = track.kmp;
      let deletedCount = 0;
      for (const entity of deletable) {
        const live = findMatchingEntity(current, entity);
        if (!live) continue;
        current = parseKmp(deleteKmpEntity(current, live));
        deletedCount++;
      }
      if (deletedCount === 0) return;
      const nextSelectedId =
        deletedCount === 1 && deletable.length === 1
          ? getSelectionIdAfterRoutePointDeletion(track.kmp, current, deletable[0])
          : null;
      applyEditorChange(
        replaceCourseKmp(track, current.original),
        nextSelectedId,
        true,
        nextSelectedId ? [nextSelectedId] : [],
      );
      setStatus(deletedCount === 1 ? `Deleted ${label}.` : `Deleted ${deletedCount} selected elements.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function moveSelectedEntity(direction: -1 | 1) {
    if (!track?.kmp || !selected) return;
    try {
      const nextTrack = replaceCourseKmp(track, moveKmpEntity(track.kmp, selected, direction));
      const nextIndex = selected.routePoint ? selected.routePoint.pointIndex + direction : selected.index + direction;
      const nextId = selected.routePoint ? `POTI-${selected.routePoint.routeIndex}-${nextIndex}` : `${selected.section}-${nextIndex}`;
      const newSelectedId = nextTrack.kmp?.entities.some((entity) => entity.id === nextId) ? nextId : selected.id;
      applyEditorChange(nextTrack, newSelectedId, true, [newSelectedId]);
      setStatus(`Moved ${entityLabel(selected)} ${direction < 0 ? 'earlier' : 'later'}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function splitSelectedPathGroup() {
    if (!track?.kmp || !selected || !selectedPathInfo) return;
    try {
      applyEditorChange(
        replaceCourseKmp(track, splitKmpPathGroup(track.kmp, selected.section as 'ENPT' | 'ITPT' | 'CKPT', selectedPathInfo.groupIndex, selectedPathInfo.localIndex)),
        selected.id,
        true,
        [selected.id],
      );
      setStatus(`Split ${friendlyGroupSectionLabel(selectedPathInfo.groupSection)} group ${selectedPathInfo.groupIndex}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function mergeSelectedPathGroup() {
    if (!track?.kmp || !selected || !selectedPathInfo) return;
    try {
      applyEditorChange(
        replaceCourseKmp(track, mergeKmpPathGroupWithNext(track.kmp, selected.section as 'ENPT' | 'ITPT' | 'CKPT', selectedPathInfo.groupIndex)),
        selected.id,
        true,
        [selected.id],
      );
      setStatus(`Merged ${friendlyGroupSectionLabel(selectedPathInfo.groupSection)} group ${selectedPathInfo.groupIndex}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function changePathGroupLinks(side: 'prev' | 'next', links: number[]) {
    if (!track?.kmp || !selectedPathInfo) return;
    applyEditorChange(replaceCourseKmp(track, patchKmpPathGroupLinks(track.kmp, selectedPathInfo.groupSection, selectedPathInfo.groupIndex, side, links)));
  }

  function changeCameraHeaderField(field: KmpCameraHeaderField, value: number) {
    if (!track?.kmp) return;
    applyEditorChange(replaceCourseKmp(track, patchKmpCameraHeaderField(track.kmp, field, value)));
  }

  function offsetSelectedEntities() {
    offsetSelectedEntitiesBy(batchOffset);
  }

  /** Moves every selected record by `offset`. Callers that own their own offset field use this. */
  function offsetSelectedEntitiesBy(batchOffset: Vec3) {
    if (!track?.kmp || selectedEntities.length < 2) return;
    if (batchOffset.x === 0 && batchOffset.y === 0 && batchOffset.z === 0) return;
    try {
      let current = track.kmp;
      let movedCount = 0;
      for (const entity of selectedEntities) {
        if (entity.section === 'STGI') continue;
        const live = findMatchingEntity(current, entity);
        if (!live) continue;
        current = parseKmp(
          patchKmpEntityPosition(current, live, {
            x: live.position.x + batchOffset.x,
            y: live.position.y + batchOffset.y,
            z: live.position.z + batchOffset.z,
          }),
        );
        movedCount++;
      }
      if (movedCount === 0) return;
      applyEditorChange(replaceCourseKmp(track, current.original), selection.selectedIdRef.current, true, selection.selectedIdsRef.current);
      setStatus(`Offset ${movedCount} selected elements.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function replaceSelectedObjectTypes(objectId: number) {
    if (!track?.kmp || !canBatchReplaceObjects) return;
    try {
      let current = track.kmp;
      let updatedCount = 0;
      for (const entity of selectedEntities) {
        const live = findMatchingEntity(current, entity);
        if (!live || live.section !== 'GOBJ') continue;
        current = parseKmp(patchKmpGobjObjectId(current, live, objectId));
        updatedCount++;
      }
      if (updatedCount === 0) return;
      applyEditorChange(replaceCourseKmp(track, current.original), selection.selectedIdRef.current, true, selection.selectedIdsRef.current);
      setStatus(`Changed ${updatedCount} selected objects to ${browserObjectTitle({ objectId, name: '', resources: '' })}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function applyFillBetween() {
    if (!track?.kmp || !fillBetweenSelection) return;
    const positions = buildFillBetweenPositions(
      fillBetweenSelection.endpoints[0].position,
      fillBetweenSelection.endpoints[1].position,
      fillBetweenCount,
    );
    if (positions.length === 0) {
      setStatus('Fill Between needs at least one object in between.');
      return;
    }
    try {
      let current = track.kmp;
      const source = selected?.section === 'GOBJ' && selected.objectId === fillBetweenSelection.objectId ? selected : fillBetweenSelection.endpoints[0];
      const newSelectedIds: string[] = [];
      for (const position of positions) {
        const result = appendCopiedEntity(current, source, position);
        current = parseKmp(result.bytes);
        newSelectedIds.push(result.selectedId);
      }
      const nextSelectedIds = [...selection.selectedIdsRef.current, ...newSelectedIds].filter((id, index, ids) => ids.indexOf(id) === index);
      const nextPrimaryId = newSelectedIds.at(-1) ?? selection.selectedIdRef.current ?? nextSelectedIds.at(-1) ?? null;
      applyEditorChange(replaceCourseKmp(track, current.original), nextPrimaryId, true, nextSelectedIds);
      setStatus(`Filled the gap with ${positions.length} ${positions.length === 1 ? 'object' : 'objects'}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  // --- Camera (CAME) mode -------------------------------------------------
  // Appended as a block so `src/ui/camera/**` owns the logic and this file only forwards it to
  // the history stack. Every one of these is a single undo step.

  /** Adds a camera with the given pose and selects it. */
  function addCameraFromPose(pose: { position: Vec3; rotation?: Vec3; viewStart: Vec3; viewEnd?: Vec3 }) {
    if (!track?.kmp) return;
    try {
      const result = addCamera(track.kmp, createDefaultCameraValues(pose));
      if (!result.selectedId) return;
      applyEditorChange(replaceCourseKmp(track, result.bytes), result.selectedId, true, [result.selectedId]);
      setStatus(`Added ${result.selectedId.replace('CAME-', 'camera ')}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Copies a camera, including where it hands over to. */
  function duplicateCameraEntry(index: number) {
    if (!track?.kmp) return;
    try {
      const result = duplicateCamera(track.kmp, index);
      if (!result.selectedId) return;
      applyEditorChange(replaceCourseKmp(track, result.bytes), result.selectedId, true, [result.selectedId]);
      setStatus(`Duplicated camera ${index}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Deletes a camera and renumbers every reference to it. */
  function deleteCameraEntry(index: number) {
    if (!track?.kmp) return;
    if (!window.confirm(`Delete camera ${index}? Everything that points at a later camera is renumbered.`)) return;
    try {
      const result = deleteCamera(track.kmp, index);
      applyEditorChange(replaceCourseKmp(track, result.bytes), result.selectedId, true, result.selectedId ? [result.selectedId] : []);
      setStatus(`Deleted camera ${index}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Moves a camera up or down the list, renumbering references so playback is unchanged. */
  function moveCameraEntry(from: number, to: number) {
    if (!track?.kmp) return;
    try {
      const result = moveCamera(track.kmp, from, to);
      applyEditorChange(replaceCourseKmp(track, result.bytes), result.selectedId, true, result.selectedId ? [result.selectedId] : []);
      setStatus(`Moved camera ${from} to position ${to}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Writes any group of camera fields in one undo step. */
  function updateCamera(cameraId: string, values: Partial<CameraValues>, statusMessage?: string) {
    if (!track?.kmp) return;
    try {
      applyEditorChange(replaceCourseKmp(track, applyCameraValues(track.kmp, cameraId, values)), cameraId, true, [cameraId]);
      if (statusMessage) setStatus(statusMessage);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Points the opening or character-selection pan at a camera (or at "none"). */
  function setCameraChainStart(kind: CameraChainKind, index: number) {
    if (!track?.kmp) return;
    try {
      applyEditorChange(replaceCourseKmp(track, setChainStart(track.kmp, kind, index)));
      setStatus(
        index === NO_CAMERA_LINK
          ? `Cleared the ${kind === 'opening' ? 'opening' : 'selection screen'} pan.`
          : `Camera ${index} now starts the ${kind === 'opening' ? 'opening' : 'selection screen'} pan.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Rewrites a chain so it plays in the given order. */
  function setCameraChainOrder(kind: CameraChainKind, order: number[]) {
    if (!track?.kmp) return;
    try {
      applyEditorChange(replaceCourseKmp(track, setChainOrder(track.kmp, kind, order)));
      setStatus(`Reordered the ${kind === 'opening' ? 'opening' : 'selection screen'} pan.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    moveEntity,
    moveCheckpointEndpoint,
    rotateEntity,
    scaleEntity,
    patchSelectedEntity,
    selectMatchingObjects,
    applyAreaPatches,
    extendGravityChain,
    selectArea,
    updateViewportTransformSelection,
    addObject,
    addKmpPoint,
    addPotiNode,
    insertRoutePoint,
    createObjectRoute,
    resetObjectBehavior,
    clearObjectRoute,
    selectObjectRoute,
    applySafeFallingRockDefaults,
    createCannonPointFromObject,
    applyRoulettePlatformDefaults,
    deleteSelectedEntity,
    moveSelectedEntity,
    splitSelectedPathGroup,
    mergeSelectedPathGroup,
    changePathGroupLinks,
    changeCameraHeaderField,
    offsetSelectedEntities,
    offsetSelectedEntitiesBy,
    replaceSelectedObjectTypes,
    applyFillBetween,
    addCameraFromPose,
    duplicateCameraEntry,
    deleteCameraEntry,
    moveCameraEntry,
    updateCamera,
    setCameraChainStart,
    setCameraChainOrder,
  };
}
