// Pure KMP document edit helpers. Extracted verbatim from the old src/ui/App.tsx so the
// editing behaviour is unchanged; nothing in here depends on React.
import {
  appendKmpArea,
  appendKmpCamera,
  appendKmpCheckpoint,
  appendKmpGobj,
  appendKmpPoint,
  appendKmpPotiPoint,
  parseKmp,
  patchKmpAreaField,
  patchKmpBattleFinishField,
  patchKmpCameraField,
  patchKmpCameraViewPosition,
  patchKmpCannonField,
  patchKmpCheckpointEndpoint,
  patchKmpCheckpointField,
  patchKmpEntityPosition,
  patchKmpEntityRotation,
  patchKmpEntityRouteIndex,
  patchKmpEntityScale,
  patchKmpGobjObjectId,
  patchKmpGobjPresenceFlags,
  patchKmpGobjSetting,
  patchKmpPointDeviation,
  patchKmpPointSetting,
  patchKmpPotiPointSetting,
  patchKmpPotiRouteSetting,
  patchKmpRespawnField,
  patchKmpStageField,
  patchKmpStageFlareColor,
  type KmpDocument,
  type KmpEntity,
  type Vec3,
} from './kmp';
import { replaceCourseKmp, type TrackDocument } from './track';

export interface ReferenceCounts {
  routes: number;
  cameras: number;
  enemyPoints: number;
  checkpoints: number;
  respawns: number;
}

export interface ClipboardEntity {
  anchor: Vec3;
  primaryId: string | null;
  entries: Array<{
    entity: KmpEntity;
    relativeOffset: Vec3;
    order: number;
  }>;
}

export interface PathInfo {
  groupSection: 'ENPH' | 'ITPH' | 'CKPH';
  groupIndex: number;
  groupSize: number;
  localIndex: number;
  prevGroups: number[];
  nextGroups: number[];
}

export function vec3Equals(a: Vec3 | undefined, b: Vec3 | undefined): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function updateTrackEntityPreview(track: TrackDocument, entityId: string, update: (entity: KmpEntity) => KmpEntity): TrackDocument {
  if (!track.kmp) return track;
  const entityIndex = track.kmp.entities.findIndex((entity) => entity.id === entityId);
  if (entityIndex < 0) return track;
  const previousEntity = track.kmp.entities[entityIndex];
  const nextEntity = update(previousEntity);
  if (nextEntity === previousEntity) return track;

  const nextEntities = [...track.kmp.entities];
  nextEntities[entityIndex] = nextEntity;

  const nextSections = previousEntity.routePoint
    ? track.kmp.sections
    : track.kmp.sections.map((section) =>
        section.name === previousEntity.section
          ? {
              ...section,
              entries: section.entries.map((entry, index) => (index === previousEntity.index ? nextEntity : entry)),
            }
          : section,
      );

  const nextRoutes = previousEntity.routePoint
    ? track.kmp.routes.map((route, routeIndex) =>
        routeIndex === previousEntity.routePoint!.routeIndex
          ? {
              ...route,
              points: route.points.map((point, pointIndex) =>
                pointIndex === previousEntity.routePoint!.pointIndex ? { ...point, position: nextEntity.position } : point,
              ),
            }
          : route,
      )
    : track.kmp.routes;

  return {
    ...track,
    kmp: {
      ...track.kmp,
      entities: nextEntities,
      sections: nextSections,
      routes: nextRoutes,
    },
  };
}

export function previewMovedEntity(track: TrackDocument, entityId: string, position: Vec3): TrackDocument {
  return updateTrackEntityPreview(track, entityId, (entity) => {
    if (entity.section === 'CKPT' && entity.checkpoint) {
      const dx = position.x - entity.position.x;
      const dz = position.z - entity.position.z;
      return {
        ...entity,
        position,
        checkpoint: {
          ...entity.checkpoint,
          left: { ...entity.checkpoint.left, x: entity.checkpoint.left.x + dx, z: entity.checkpoint.left.z + dz },
          right: { ...entity.checkpoint.right, x: entity.checkpoint.right.x + dx, z: entity.checkpoint.right.z + dz },
        },
      };
    }
    return { ...entity, position };
  });
}

export function previewMovedCheckpointEndpoint(track: TrackDocument, entityId: string, side: 'left' | 'right', position: Vec3): TrackDocument {
  return updateTrackEntityPreview(track, entityId, (entity) => {
    if (entity.section !== 'CKPT' || !entity.checkpoint) return entity;
    const checkpoint =
      side === 'left'
        ? { ...entity.checkpoint, left: position }
        : { ...entity.checkpoint, right: position };
    return {
      ...entity,
      checkpoint,
      position: {
        x: (checkpoint.left.x + checkpoint.right.x) * 0.5,
        y: (checkpoint.left.y + checkpoint.right.y) * 0.5,
        z: (checkpoint.left.z + checkpoint.right.z) * 0.5,
      },
    };
  });
}

export function previewRotatedEntity(track: TrackDocument, entityId: string, rotation: Vec3): TrackDocument {
  return updateTrackEntityPreview(track, entityId, (entity) => ({ ...entity, rotation }));
}

export function previewScaledEntity(track: TrackDocument, entityId: string, scale: Vec3): TrackDocument {
  return updateTrackEntityPreview(track, entityId, (entity) => ({ ...entity, scale }));
}

export function materializeViewportInteractionTrack(baseTrack: TrackDocument | null, previewTrack: TrackDocument | null): TrackDocument | null {
  if (!baseTrack?.kmp || !previewTrack?.kmp) return previewTrack;
  let workingBytes = baseTrack.kmp.original;
  const workingDocument = (): KmpDocument => ({ ...baseTrack.kmp!, original: workingBytes });
  const previewEntitiesById = new Map(previewTrack.kmp.entities.map((entity) => [entity.id, entity]));

  for (const baseEntity of baseTrack.kmp.entities) {
    const previewEntity = previewEntitiesById.get(baseEntity.id);
    if (!previewEntity) continue;
    if (baseEntity.section === 'CKPT' && baseEntity.checkpoint && previewEntity.checkpoint) {
      if (!vec3Equals(baseEntity.checkpoint.left, previewEntity.checkpoint.left)) {
        workingBytes = patchKmpCheckpointEndpoint(workingDocument(), baseEntity, 'left', previewEntity.checkpoint.left);
      }
      if (!vec3Equals(baseEntity.checkpoint.right, previewEntity.checkpoint.right)) {
        workingBytes = patchKmpCheckpointEndpoint(workingDocument(), baseEntity, 'right', previewEntity.checkpoint.right);
      }
    } else if (!vec3Equals(baseEntity.position, previewEntity.position)) {
      workingBytes = patchKmpEntityPosition(workingDocument(), baseEntity, previewEntity.position);
    }

    if (baseEntity.rotation && previewEntity.rotation && !vec3Equals(baseEntity.rotation, previewEntity.rotation)) {
      workingBytes = patchKmpEntityRotation(workingDocument(), baseEntity, previewEntity.rotation);
    }
    if (baseEntity.scale && previewEntity.scale && !vec3Equals(baseEntity.scale, previewEntity.scale)) {
      workingBytes = patchKmpEntityScale(workingDocument(), baseEntity, previewEntity.scale);
    }
  }

  return replaceCourseKmp(baseTrack, workingBytes);
}
export function appendCopiedEntity(document: KmpDocument, entity: KmpEntity, position: Vec3): { bytes: Uint8Array; selectedId: string } {
  if (entity.routePoint) return appendCopiedPotiPoint(document, entity, position);

  let bytes: Uint8Array;
  let selectedId: string;
  switch (entity.section) {
    case 'GOBJ':
      if (entity.objectId === undefined) throw new Error('Cannot duplicate object without an object ID.');
      bytes = appendKmpGobj(document, entity.objectId, position);
      selectedId = `GOBJ-${(parseKmp(bytes).sections.find((section) => section.name === 'GOBJ')?.count ?? 1) - 1}`;
      break;
    case 'AREA':
      bytes = appendKmpArea(document, position);
      selectedId = `AREA-${(parseKmp(bytes).sections.find((section) => section.name === 'AREA')?.count ?? 1) - 1}`;
      break;
    case 'CAME':
      bytes = appendKmpCamera(document, position);
      selectedId = `CAME-${(parseKmp(bytes).sections.find((section) => section.name === 'CAME')?.count ?? 1) - 1}`;
      break;
    case 'CKPT':
      bytes = appendKmpCheckpoint(document, position);
      selectedId = `CKPT-${(parseKmp(bytes).sections.find((section) => section.name === 'CKPT')?.count ?? 1) - 1}`;
      break;
    case 'KTPT':
    case 'ENPT':
    case 'ITPT':
    case 'JGPT':
    case 'CNPT':
    case 'MSPT':
      bytes = appendKmpPoint(document, entity.section, position);
      selectedId = `${entity.section}-${(parseKmp(bytes).sections.find((section) => section.name === entity.section)?.count ?? 1) - 1}`;
      break;
    default:
      throw new Error(`Duplicating ${entity.section} is not supported yet.`);
  }

  return { bytes: patchCopiedEntity(bytes, selectedId, entity, position), selectedId };
}

export function getClipboardSourceEntities(selectedEntities: KmpEntity[], selected: KmpEntity | null): KmpEntity[] {
  if (selectedEntities.length > 1) return selectedEntities;
  return selected ? [selected] : [];
}

export function createClipboardEntity(entities: KmpEntity[], primaryId: string | null): ClipboardEntity {
  const primary = entities.find((entity) => entity.id === primaryId) ?? entities.at(-1) ?? entities[0];
  const anchor = cloneVec3(primary.position);
  return {
    anchor,
    primaryId: primary.id,
    entries: entities.map((entity, order) => ({
      entity: JSON.parse(JSON.stringify(entity)) as KmpEntity,
      relativeOffset: {
        x: entity.position.x - anchor.x,
        y: entity.position.y - anchor.y,
        z: entity.position.z - anchor.z,
      },
      order,
    })),
  };
}

export function sortClipboardEntriesForPaste(entries: ClipboardEntity['entries']): ClipboardEntity['entries'] {
  return [...entries].sort((a, b) => {
    if (a.entity.routePoint && b.entity.routePoint) {
      if (a.entity.routePoint.routeIndex !== b.entity.routePoint.routeIndex) return b.entity.routePoint.routeIndex - a.entity.routePoint.routeIndex;
      return b.entity.routePoint.pointIndex - a.entity.routePoint.pointIndex;
    }
    if (a.entity.routePoint) return -1;
    if (b.entity.routePoint) return 1;
    return a.order - b.order;
  });
}

export function appendCopiedPotiPoint(document: KmpDocument, entity: KmpEntity, position: Vec3): { bytes: Uint8Array; selectedId: string } {
  if (!entity.routePoint) throw new Error('Cannot duplicate route node without route metadata.');
  const route = document.routes[entity.routePoint.routeIndex];
  if (!route) throw new Error(`Cannot duplicate route node: route ${entity.routePoint.routeIndex} is missing.`);
  const bytes = appendKmpPotiPoint(document, entity.routePoint.routeIndex, entity.routePoint.pointIndex, position);
  const selectedId = `POTI-${entity.routePoint.routeIndex}-${entity.routePoint.pointIndex + 1}`;
  return { bytes: patchCopiedEntity(bytes, selectedId, entity, position), selectedId };
}

export function patchCopiedEntity(bytes: Uint8Array, selectedId: string, source: KmpEntity, position: Vec3): Uint8Array {
  let out = bytes;
  const getTarget = () => {
    const targetDoc = parseKmp(out);
    const targetEntity = targetDoc.entities.find((candidate) => candidate.id === selectedId);
    if (!targetEntity) throw new Error(`Duplicated entity ${selectedId} could not be found.`);
    return { targetDoc, targetEntity };
  };

  if (source.rotation) {
    const { targetDoc, targetEntity } = getTarget();
    out = patchKmpEntityRotation(targetDoc, targetEntity, cloneVec3(source.rotation));
  }
  if (source.scale) {
    const { targetDoc, targetEntity } = getTarget();
    out = patchKmpEntityScale(targetDoc, targetEntity, cloneVec3(source.scale));
  }
  if (source.checkpoint) {
    let target = getTarget();
    out = patchKmpCheckpointEndpoint(target.targetDoc, target.targetEntity, 'left', offsetCheckpointPoint(source.checkpoint.left, source.position, position));
    target = getTarget();
    out = patchKmpCheckpointEndpoint(target.targetDoc, target.targetEntity, 'right', offsetCheckpointPoint(source.checkpoint.right, source.position, position));
    for (const field of ['respawnIndex', 'type', 'prev', 'next'] as const) {
      target = getTarget();
      out = patchKmpCheckpointField(target.targetDoc, target.targetEntity, field, source.checkpoint[field]);
    }
  }
  if (source.pointSettings) {
    if (source.pointDeviation !== undefined) {
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpPointDeviation(targetDoc, targetEntity, source.pointDeviation);
    }
    for (let i = 0; i < source.pointSettings.length; i++) {
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpPointSetting(targetDoc, targetEntity, i, source.pointSettings[i]);
    }
  }
  if (source.objectId !== undefined) {
    let target = getTarget();
    out = patchKmpGobjObjectId(target.targetDoc, target.targetEntity, source.objectId);
    if (source.routeIndex !== undefined) {
      target = getTarget();
      out = patchKmpEntityRouteIndex(target.targetDoc, target.targetEntity, source.routeIndex);
    }
    if (source.objectSettings) {
      for (let i = 0; i < source.objectSettings.length; i++) {
        target = getTarget();
        out = patchKmpGobjSetting(target.targetDoc, target.targetEntity, i, source.objectSettings[i]);
      }
    }
    if (source.presenceFlags !== undefined) {
      target = getTarget();
      out = patchKmpGobjPresenceFlags(target.targetDoc, target.targetEntity, source.presenceFlags);
    }
  }
  if (source.area) {
    for (const field of Object.keys(source.area) as Array<keyof NonNullable<KmpEntity['area']>>) {
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpAreaField(targetDoc, targetEntity, field, source.area[field]);
    }
  }
  if (source.camera) {
    for (const field of Object.keys(source.camera) as Array<keyof NonNullable<KmpEntity['camera']>>) {
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpCameraField(targetDoc, targetEntity, field, source.camera[field]);
    }
  }
  if (source.cameraView) {
    let target = getTarget();
    out = patchKmpCameraViewPosition(target.targetDoc, target.targetEntity, 'start', offsetCheckpointPoint(source.cameraView.start, source.position, position));
    target = getTarget();
    out = patchKmpCameraViewPosition(target.targetDoc, target.targetEntity, 'end', offsetCheckpointPoint(source.cameraView.end, source.position, position));
  }
  if (source.respawn) {
    for (const field of Object.keys(source.respawn) as Array<keyof NonNullable<KmpEntity['respawn']>>) {
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpRespawnField(targetDoc, targetEntity, field, source.respawn[field]);
    }
  }
  if (source.cannon) {
    for (const field of Object.keys(source.cannon) as Array<keyof NonNullable<KmpEntity['cannon']>>) {
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpCannonField(targetDoc, targetEntity, field, source.cannon[field]);
    }
  }
  if (source.battleFinish) {
    for (const field of Object.keys(source.battleFinish) as Array<keyof NonNullable<KmpEntity['battleFinish']>>) {
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpBattleFinishField(targetDoc, targetEntity, field, source.battleFinish[field]);
    }
  }
  if (source.stage) {
    for (const field of Object.keys(source.stage) as Array<keyof NonNullable<KmpEntity['stage']>>) {
      if (field === 'flareColor') continue;
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpStageField(targetDoc, targetEntity, field, source.stage[field] as number);
    }
    for (let i = 0; i < source.stage.flareColor.length; i++) {
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpStageFlareColor(targetDoc, targetEntity, i, source.stage.flareColor[i]);
    }
  }
  if (source.poti) {
    let target = getTarget();
    out = patchKmpPotiRouteSetting(target.targetDoc, target.targetEntity, 0, source.poti.routeSetting1);
    target = getTarget();
    out = patchKmpPotiRouteSetting(target.targetDoc, target.targetEntity, 1, source.poti.routeSetting2);
    target = getTarget();
    out = patchKmpPotiPointSetting(target.targetDoc, target.targetEntity, 0, source.poti.pointSetting1);
    target = getTarget();
    out = patchKmpPotiPointSetting(target.targetDoc, target.targetEntity, 1, source.poti.pointSetting2);
  }
  return out;
}

export function cloneVec3(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

export function offsetCheckpointPoint(point: Vec3, sourceCenter: Vec3, targetCenter: Vec3): Vec3 {
  return {
    x: targetCenter.x + (point.x - sourceCenter.x),
    y: targetCenter.y + (point.y - sourceCenter.y),
    z: targetCenter.z + (point.z - sourceCenter.z),
  };
}
export function countSectionEntities(entities: KmpEntity[], section: KmpEntity['section']): number {
  return entities.filter((entity) => entity.section === section).length;
}
export function parseGroupLinkText(value: string): number[] {
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part))
    .map((part) => Math.max(0, Math.min(255, Math.trunc(part))));
}
export function setMaskedBits(value: number, mask: number, enabled: boolean): number {
  return enabled ? value | mask : value & ~mask;
}

export function decodeWrappedSpin(value: number): { direction: number; speed: number } {
  if (value <= 0x7fff) return { direction: 1, speed: value };
  return { direction: 0, speed: 0x10000 - value };
}

export function encodeWrappedSpin(speed: number, direction: number): number {
  const clampedSpeed = Math.max(0, Math.min(0xffff, Math.trunc(speed)));
  if (clampedSpeed === 0) return 0;
  return direction === 0 ? (0x10000 - clampedSpeed) & 0xffff : clampedSpeed;
}

export function decodeSigned16(value: number): number {
  return value >= 0x8000 ? value - 0x10000 : value;
}

export function encodeSigned16(value: number): number {
  const clamped = Math.max(-0x8000, Math.min(0x7fff, Math.trunc(value)));
  return clamped < 0 ? clamped + 0x10000 : clamped;
}
export function toSigned16(value: number): number {
  return value & 0x8000 ? value - 0x10000 : value;
}

export function toUnsigned16(value: number): number {
  const clamped = Math.max(-0x8000, Math.min(0x7fff, Math.trunc(value)));
  return clamped < 0 ? clamped + 0x10000 : clamped;
}
export function getPathInfo(kmp: KmpDocument, entity: KmpEntity): PathInfo | null {
  const graph = kmp.pathGraphs.find((candidate) => candidate.pointSection === entity.section);
  if (!graph) return null;
  const group = graph.groups.find((candidate) => entity.index >= candidate.startIndex && entity.index < candidate.startIndex + candidate.pointCount);
  if (!group) return null;
  return {
    groupSection: graph.groupSection,
    groupIndex: group.index,
    groupSize: group.pointCount,
    localIndex: entity.index - group.startIndex,
    prevGroups: group.prevGroups,
    nextGroups: group.nextGroups,
  };
}
export function getReferenceCounts(kmp: KmpDocument | null): ReferenceCounts {
  if (!kmp) return { routes: 0, cameras: 0, enemyPoints: 0, checkpoints: 0, respawns: 0 };
  const sectionCount = (section: string) => kmp.sections.find((candidate) => candidate.name === section)?.count ?? 0;
  return {
    routes: kmp.routes.length || sectionCount('POTI'),
    cameras: sectionCount('CAME'),
    enemyPoints: sectionCount('ENPT'),
    checkpoints: sectionCount('CKPT'),
    respawns: sectionCount('JGPT'),
  };
}
export function findMatchingEntity(document: KmpDocument, template: KmpEntity): KmpEntity | null {
  if (template.routePoint) {
    return (
      document.entities.find(
        (entity) =>
          entity.routePoint?.routeIndex === template.routePoint?.routeIndex && entity.routePoint?.pointIndex === template.routePoint?.pointIndex,
      ) ?? null
    );
  }
  return document.entities.find((entity) => entity.section === template.section && entity.index === template.index) ?? null;
}

export function getSelectionIdAfterRoutePointDeletion(before: KmpDocument, after: KmpDocument, deleted: KmpEntity): string | null {
  if (deleted.routePoint) {
    const route = after.routes[deleted.routePoint.routeIndex];
    if (!route || route.points.length === 0) return null;
    const nextPointIndex = Math.max(0, Math.min(deleted.routePoint.pointIndex - 1, route.points.length - 1));
    const nextId = `POTI-${deleted.routePoint.routeIndex}-${nextPointIndex}`;
    return after.entities.some((entity) => entity.id === nextId) ? nextId : null;
  }
  if (deleted.section !== 'ENPT' && deleted.section !== 'ITPT' && deleted.section !== 'CKPT') return null;
  const graph = before.pathGraphs.find((candidate) => candidate.pointSection === deleted.section);
  const group = graph?.groups.find((candidate) => deleted.index >= candidate.startIndex && deleted.index < candidate.startIndex + candidate.pointCount);
  if (!group || group.pointCount <= 1) return null;
  const nextIndex = group.startIndex + Math.max(0, deleted.index - group.startIndex - 1);
  const nextId = `${deleted.section}-${nextIndex}`;
  return after.entities.some((entity) => entity.id === nextId) ? nextId : null;
}

export function getDeletionOrder(a: KmpEntity, b: KmpEntity): number {
  if (a.routePoint && b.routePoint) {
    if (a.routePoint.routeIndex !== b.routePoint.routeIndex) return b.routePoint.routeIndex - a.routePoint.routeIndex;
    return b.routePoint.pointIndex - a.routePoint.pointIndex;
  }
  if (a.section !== b.section) return String(b.section).localeCompare(String(a.section));
  return b.index - a.index;
}

export function canCopyEntity(entity: KmpEntity | null): boolean {
  if (!entity) return false;
  return entity.section !== 'STGI';
}
