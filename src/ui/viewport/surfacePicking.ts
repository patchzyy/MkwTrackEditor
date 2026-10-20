// Turns the noclip scene's raw surface pick into the `SurfacePick` modes see: works out whether
// the track has its own copy of the archive, the KMP entity id and a friendly object name.

import type { RendererSurfacePick, SurfacePick } from '../../lib/surfacePick';
import { findTrackArchiveEntry, type TrackDocument } from '../../lib/track';
import { getKnownObjectName, humanizeObjectName } from '../labels';

export function toSurfacePick(
  raw: RendererSurfacePick,
  track: TrackDocument | null,
  placedMeshIdForInstance: (instanceId: string) => string | undefined,
): SurfacePick {
  const pick: SurfacePick = {
    source: raw.kind === 'placed' || (track !== null && findTrackArchiveEntry(track, raw.archivePath) !== null) ? 'track' : 'common',
    archivePath: raw.archivePath,
    kind: raw.kind,
    modelName: raw.modelName,
    drawOpIndex: raw.drawOpIndex,
    shapeIndex: raw.shapeIndex,
    shapeName: raw.shapeName,
    materialIndex: raw.materialIndex,
    materialName: raw.materialName,
    hitPoint: { ...raw.hitPoint },
    approximate: raw.approximate,
  };
  if (raw.objectIndex !== null) {
    pick.objectEntityId = `GOBJ-${raw.objectIndex}`;
    if (raw.objectId !== null) pick.objectId = raw.objectId;
    const name = getKnownObjectName(raw.objectId ?? undefined) ?? (raw.objectName ? humanizeObjectName(raw.objectName) : null);
    if (name) pick.objectName = name;
  }
  if (raw.placedInstanceId !== null) {
    const id = placedMeshIdForInstance(raw.placedInstanceId);
    if (id !== undefined) pick.placedMeshId = id;
  }
  return pick;
}
