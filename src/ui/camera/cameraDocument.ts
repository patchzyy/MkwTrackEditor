// Camera (CAME) document operations: the outliner model, the opening/selection chains, and
// the structural edits (add / duplicate / delete / reorder) with their reference fix-ups.
//
// Pure: no React. Every edit takes a `KmpDocument` and returns the new `course.kmp` bytes, so
// the caller can push one `TrackDocument` through `history.applyEditorChange` and get undo for
// free. Every index that can point at a camera is renumbered: CAME `nextCam`, AREA
// `cameraIndex`, and the two CAME header fields (opening start, selection start).

import {
  appendKmpCamera,
  deleteKmpEntity,
  getKmpCameraHeader,
  moveKmpEntity,
  parseKmp,
  patchKmpAreaField,
  patchKmpCameraField,
  patchKmpCameraHeaderField,
  patchKmpCameraViewPosition,
  patchKmpEntityPosition,
  patchKmpEntityRotation,
  type KmpDocument,
  type KmpEntity,
  type Vec3,
} from '../../lib/kmp';
import {
  NO_CAMERA_LINK,
  buildOpeningCameraChain,
  getCameraAnimationFrames,
  getCameraTypeInfo,
  isOpeningCameraType,
  type CameraTypeInfo,
  type OpeningCameraStep,
} from '../../lib/cameraPreview';
import { toCameraPreviewDefs } from '../viewport/cameraOverlay';
import { readKmpFile, writeKmpFile } from '../../lib/kmpFile';

export { NO_CAMERA_LINK };

/** Which of the two CAME header chains an operation is about. */
export type CameraChainKind = 'opening' | 'selection';

export const ZERO_VEC3: Vec3 = { x: 0, y: 0, z: 0 };

/** Every CAME field that can be written, so one edit can set several of them at once. */
export interface CameraValues {
  type: number;
  nextCam: number;
  shake: number;
  routeIndex: number;
  /** Camera travel speed along its route, in units per 100 frames. */
  vCam: number;
  /** Zoom speed, in degrees per 100 frames. */
  vZoom: number;
  /** View-point travel speed, in units per 100 frames. */
  vView: number;
  start: number;
  movie: number;
  zoomStart: number;
  zoomEnd: number;
  time: number;
  position: Vec3;
  rotation: Vec3;
  viewStart: Vec3;
  viewEnd: Vec3;
}

/** One row of the camera outliner. */
export interface CameraRow {
  id: string;
  index: number;
  type: number;
  typeInfo: CameraTypeInfo;
  nextCam: number;
  routeIndex: number;
  timeFrames: number;
  /** How long the shot actually animates for, including route travel. */
  animatedFrames: number;
  /** 1-based place in the opening chain, or 0 when the camera is not part of it. */
  openingOrder: number;
  /** 1-based place in the character-selection chain, or 0. */
  selectionOrder: number;
  /** Indices of the areas that trigger this camera. */
  usedByAreas: number[];
  isOpeningStart: boolean;
  isSelectionStart: boolean;
  position: Vec3;
  rotation: Vec3;
  viewStart: Vec3;
  viewEnd: Vec3;
}

/** The result of walking one camera chain from a header start index. */
export interface CameraChainInfo {
  kind: CameraChainKind;
  /** The camera the chain starts at, or 0xFF when the track has no such chain. */
  first: number;
  steps: OpeningCameraStep[];
  /** Camera indices in play order. */
  order: number[];
  totalFrames: number;
  /** The camera the chain jumps back to, when it loops instead of ending. */
  loopsAt: number | null;
  /** A `nextCam` that points at a camera that does not exist. */
  missingAt: number | null;
  /** Cameras in the chain whose duration is 0, so the game never advances past them. */
  zeroDurationAt: number[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function getCameraEntityList(kmp: KmpDocument | null | undefined): KmpEntity[] {
  if (!kmp) return [];
  return kmp.entities.filter((entity) => entity.section === 'CAME');
}

export function findCameraEntity(kmp: KmpDocument | null | undefined, index: number): KmpEntity | null {
  return getCameraEntityList(kmp).find((entity) => entity.index === index) ?? null;
}

export function getCameraCount(kmp: KmpDocument | null | undefined): number {
  return getCameraEntityList(kmp).length;
}

/** `firstIntroCam` / `firstSelectionCam` from the CAME section header. */
export function getCameraChainStarts(kmp: KmpDocument | null | undefined): { opening: number; selection: number } {
  if (!kmp) return { opening: NO_CAMERA_LINK, selection: NO_CAMERA_LINK };
  const header = getKmpCameraHeader(kmp);
  return { opening: header.firstIntroCam, selection: header.firstSelectionCam };
}

/**
 * Walks one chain, the way the game plays it. Unlike {@link buildOpeningCameraChain} this also
 * reports *why* the walk stopped, so the UI can warn about loops and dead ends.
 */
export function getCameraChain(kmp: KmpDocument | null | undefined, kind: CameraChainKind): CameraChainInfo {
  const first = kind === 'opening' ? getCameraChainStarts(kmp).opening : getCameraChainStarts(kmp).selection;
  const defs = toCameraPreviewDefs(kmp);
  const count = defs.length;
  const steps = buildOpeningCameraChain(defs, first);
  const order = steps.map((step) => step.cameraIndex);
  const totalFrames = steps.length === 0 ? 0 : steps[steps.length - 1].endFrame;
  const warnings: string[] = [];

  let loopsAt: number | null = null;
  let missingAt: number | null = null;
  if (count > 0 && first !== NO_CAMERA_LINK && first >= count) {
    missingAt = first;
    warnings.push(`This chain starts at camera ${first}, which does not exist.`);
  } else if (steps.length > 0) {
    const last = defs.find((def) => def.index === order[order.length - 1]);
    const tail = last?.nextCam ?? NO_CAMERA_LINK;
    if (tail !== NO_CAMERA_LINK) {
      if (order.includes(tail)) {
        loopsAt = tail;
        warnings.push(`The chain loops back to camera ${tail} instead of ending, so it never finishes.`);
      } else {
        missingAt = tail;
        warnings.push(`Camera ${order[order.length - 1]} hands over to camera ${tail}, which does not exist.`);
      }
    }
  }

  const zeroDurationAt = steps.filter((step) => step.durationFrames <= 0).map((step) => step.cameraIndex);
  for (const index of zeroDurationAt) warnings.push(`Camera ${index} has no duration, so the pan stops on it.`);

  return { kind, first, steps, order, totalFrames, loopsAt, missingAt, zeroDurationAt, warnings };
}

/** The outliner model: one row per CAME entry, with its chain places and area references. */
export function listCameraRows(kmp: KmpDocument | null | undefined): CameraRow[] {
  const entities = getCameraEntityList(kmp);
  if (entities.length === 0) return [];
  const defs = toCameraPreviewDefs(kmp);
  const starts = getCameraChainStarts(kmp);
  const openingOrder = new Map<number, number>();
  getCameraChain(kmp, 'opening').order.forEach((index, i) => openingOrder.set(index, i + 1));
  const selectionOrder = new Map<number, number>();
  getCameraChain(kmp, 'selection').order.forEach((index, i) => selectionOrder.set(index, i + 1));

  const areasByCamera = new Map<number, number[]>();
  for (const entity of kmp?.entities ?? []) {
    if (entity.section !== 'AREA' || !entity.area) continue;
    if (entity.area.cameraIndex === NO_CAMERA_LINK) continue;
    const list = areasByCamera.get(entity.area.cameraIndex) ?? [];
    list.push(entity.index);
    areasByCamera.set(entity.area.cameraIndex, list);
  }

  return entities.map((entity, i) => {
    const def = defs[i];
    return {
      id: entity.id,
      index: entity.index,
      type: def.type,
      typeInfo: getCameraTypeInfo(def.type),
      nextCam: def.nextCam,
      routeIndex: def.routeIndex,
      timeFrames: def.time,
      animatedFrames: getCameraAnimationFrames(def),
      openingOrder: openingOrder.get(entity.index) ?? 0,
      selectionOrder: selectionOrder.get(entity.index) ?? 0,
      usedByAreas: areasByCamera.get(entity.index) ?? [],
      isOpeningStart: starts.opening === entity.index,
      isSelectionStart: starts.selection === entity.index,
      position: def.position,
      rotation: def.rotation,
      viewStart: def.viewStart,
      viewEnd: def.viewEnd,
    };
  });
}

/** Free-text filter over the outliner: index, friendly type name, route, and the badges. */
export function filterCameraRows(rows: readonly CameraRow[], query: string): CameraRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...rows];
  return rows.filter((row) => {
    const haystack = [
      `camera ${row.index}`,
      `#${row.index}`,
      row.typeInfo.label,
      row.typeInfo.name,
      row.typeInfo.usage,
      row.openingOrder > 0 ? `opening ${row.openingOrder}` : '',
      row.selectionOrder > 0 ? `selection ${row.selectionOrder}` : '',
      row.routeIndex !== NO_CAMERA_LINK ? `route ${row.routeIndex}` : 'no route',
      ...row.usedByAreas.map((index) => `area ${index}`),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

// ---------------------------------------------------------------------------
// Index remapping
// ---------------------------------------------------------------------------

/** `remap[oldIndex]` is the new index, or `-1` when the camera was removed. */
export type CameraIndexRemap = readonly number[];

export function buildCameraDeleteRemap(count: number, removed: number): number[] {
  return Array.from({ length: count }, (_, index) => (index === removed ? -1 : index < removed ? index : index - 1));
}

/** Remap for taking the camera at `from` out and re-inserting it at `to` (array splice order). */
export function buildCameraMoveRemap(count: number, from: number, to: number): number[] {
  const order = Array.from({ length: count }, (_, index) => index);
  if (from < 0 || from >= count) return order;
  const clampedTo = to < 0 ? 0 : to >= count ? count - 1 : to;
  const [moved] = order.splice(from, 1);
  order.splice(clampedTo, 0, moved);
  const remap = new Array<number>(count).fill(-1);
  order.forEach((oldIndex, newIndex) => {
    remap[oldIndex] = newIndex;
  });
  return remap;
}

/**
 * Renumbers one stored camera reference. `0xFF` ("none") is left alone, a reference to a deleted
 * camera becomes "none", and a reference that was already out of range is left untouched so the
 * edit never silently rewrites unrelated broken data (validation still reports it).
 */
export function remapCameraIndex(value: number, remap: CameraIndexRemap): number {
  if (value === NO_CAMERA_LINK) return NO_CAMERA_LINK;
  if (value < 0 || value >= remap.length) return value;
  const next = remap[value];
  return next < 0 ? NO_CAMERA_LINK : next;
}

/**
 * Rewrites every camera reference in a document whose stored values are still in the *old*
 * numbering. Structural edits copy record bytes verbatim, so this runs after them.
 */
export function applyCameraReferenceRemap(document: KmpDocument, remap: CameraIndexRemap): Uint8Array {
  const nextCamById = new Map<string, number>();
  const areaCameraById = new Map<string, number>();
  for (const entity of document.entities) {
    if (entity.section === 'CAME' && entity.camera) {
      const next = remapCameraIndex(entity.camera.nextCam, remap);
      if (next !== entity.camera.nextCam) nextCamById.set(entity.id, next);
    } else if (entity.section === 'AREA' && entity.area) {
      const next = remapCameraIndex(entity.area.cameraIndex, remap);
      if (next !== entity.area.cameraIndex) areaCameraById.set(entity.id, next);
    }
  }
  const header = getKmpCameraHeader(document);
  const nextOpening = remapCameraIndex(header.firstIntroCam, remap);
  const nextSelection = remapCameraIndex(header.firstSelectionCam, remap);

  let current = document;
  for (const [id, value] of nextCamById) {
    const live = current.entities.find((entity) => entity.id === id);
    if (!live) continue;
    current = parseKmp(patchKmpCameraField(current, live, 'nextCam', value));
  }
  for (const [id, value] of areaCameraById) {
    const live = current.entities.find((entity) => entity.id === id);
    if (!live) continue;
    current = parseKmp(patchKmpAreaField(current, live, 'cameraIndex', value));
  }
  if (nextOpening !== header.firstIntroCam) current = parseKmp(patchKmpCameraHeaderField(current, 'firstIntroCam', nextOpening));
  if (nextSelection !== header.firstSelectionCam) current = parseKmp(patchKmpCameraHeaderField(current, 'firstSelectionCam', nextSelection));
  return current.original;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const NUMERIC_CAMERA_FIELDS = [
  'type',
  'nextCam',
  'shake',
  'routeIndex',
  'vCam',
  'vZoom',
  'vView',
  'start',
  'movie',
  'zoomStart',
  'zoomEnd',
  'time',
] as const;

/** Writes any subset of a camera's fields in one go, so the whole change is a single undo step. */
export function applyCameraValues(document: KmpDocument, cameraId: string, values: Partial<CameraValues>): Uint8Array {
  let current = document;
  const live = () => current.entities.find((entity) => entity.id === cameraId) ?? null;
  for (const field of NUMERIC_CAMERA_FIELDS) {
    const value = values[field];
    if (value === undefined) continue;
    const entity = live();
    if (!entity) return current.original;
    current = parseKmp(patchKmpCameraField(current, entity, field, value));
  }
  if (values.position) {
    const entity = live();
    if (entity) current = parseKmp(patchKmpEntityPosition(current, entity, values.position));
  }
  if (values.rotation) {
    const entity = live();
    if (entity) current = parseKmp(patchKmpEntityRotation(current, entity, values.rotation));
  }
  if (values.viewStart) {
    const entity = live();
    if (entity) current = parseKmp(patchKmpCameraViewPosition(current, entity, 'start', values.viewStart));
  }
  if (values.viewEnd) {
    const entity = live();
    if (entity) current = parseKmp(patchKmpCameraViewPosition(current, entity, 'end', values.viewEnd));
  }
  return current.original;
}

/** Reads every field of one camera back out, for duplication and for the inspector. */
export function readCameraValues(entity: KmpEntity): CameraValues {
  const camera = entity.camera;
  return {
    type: camera?.type ?? 0,
    nextCam: camera?.nextCam ?? NO_CAMERA_LINK,
    shake: camera?.shake ?? 0,
    routeIndex: camera?.routeIndex ?? NO_CAMERA_LINK,
    vCam: camera?.vCam ?? 0,
    vZoom: camera?.vZoom ?? 0,
    vView: camera?.vView ?? 0,
    start: camera?.start ?? 0,
    movie: camera?.movie ?? 0,
    zoomStart: camera?.zoomStart ?? 60,
    zoomEnd: camera?.zoomEnd ?? 60,
    time: camera?.time ?? 0,
    position: entity.position,
    rotation: entity.rotation ?? ZERO_VEC3,
    viewStart: entity.cameraView?.start ?? entity.position,
    viewEnd: entity.cameraView?.end ?? entity.cameraView?.start ?? entity.position,
  };
}

/** Sensible defaults for a brand new camera: a 2 second opening pan looking at `viewStart`. */
export function createDefaultCameraValues(pose: { position: Vec3; viewStart: Vec3; viewEnd?: Vec3; rotation?: Vec3 }): CameraValues {
  return {
    type: 5,
    nextCam: NO_CAMERA_LINK,
    shake: 0,
    routeIndex: NO_CAMERA_LINK,
    vCam: 0,
    vZoom: 0,
    vView: 100,
    start: 0,
    movie: 0,
    zoomStart: 60,
    zoomEnd: 60,
    time: 120,
    position: pose.position,
    rotation: pose.rotation ?? ZERO_VEC3,
    viewStart: pose.viewStart,
    viewEnd: pose.viewEnd ?? pose.viewStart,
  };
}

export interface CameraEditResult {
  bytes: Uint8Array;
  /** Which camera the editor should select afterwards, or `null` to clear the selection. */
  selectedId: string | null;
}

export interface IntroCameraShot {
  points: { position: Vec3; target: Vec3; rotation: Vec3; fovDegrees: number }[];
  time: number;
}

/** Reuses the first three opening cameras and gives each shot its captured movement path. */
export function generateIntroCameras(document: KmpDocument, shots: IntroCameraShot[]): CameraEditResult {
  const file = readKmpFile(document.original);
  const order = getCameraChain(document, 'opening').order.slice(0, 3);
  if (shots.length !== 3 || shots.some((shot) => shot.points.length === 0 || !Number.isFinite(shot.time) || shot.time <= 0)) {
    throw new Error('Capture at least one viewpoint and set a positive duration for each of the three shots.');
  }
  while (order.length < 3) {
    if (file.cameras.length >= NO_CAMERA_LINK) throw new Error('There is no room for another intro camera in this KMP.');
    order.push(file.cameras.length);
    file.cameras.push({
      type: 5, nextIndex: NO_CAMERA_LINK, shake: 0, routeIndex: NO_CAMERA_LINK,
      pointVelocity: 0, zoomVelocity: 0, viewVelocity: 0, start: 0, movie: 0,
      position: ZERO_VEC3, rotation: ZERO_VEC3, zoomStart: 60, zoomEnd: 60,
      viewStart: ZERO_VEC3, viewEnd: ZERO_VEC3, time: 120,
    });
  }
  for (const [index, shot] of shots.entries()) {
    const first = shot.points[0];
    const last = shot.points[shot.points.length - 1];
    const camera = file.cameras[order[index]];
    const positions = shot.points.map((point) => point.position);
    let length = 0;
    for (let point = 1; point < positions.length; point++) {
      const a = positions[point - 1];
      const b = positions[point];
      length += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    // Aim to reach the endpoint five frames after the cut, rounding down to keep moving.
    const speed = Math.max(1, Math.floor(length / (shot.time + 5)));
    // POTI speeds are whole units per frame. Match the pan to the actual route duration
    // so it cannot keep turning after the camera has reached the final route point.
    const travelFrames = length > 0 ? length / speed : shot.time;
    const pointVelocity = length > 0 ? speed * 100 : 0;
    const viewVelocity = Math.ceil(Math.hypot(last.target.x - first.target.x, last.target.y - first.target.y, last.target.z - first.target.z) * 100 / travelFrames);
    const zoomVelocity = Math.ceil(Math.abs(last.fovDegrees - first.fovDegrees) * 100 / travelFrames);
    if (pointVelocity > 0xffff || viewVelocity > 0xffff || zoomVelocity > 0xffff) {
      throw new Error(`Shot ${index + 1} moves too far for its duration. Increase its duration or move the viewpoints closer together.`);
    }
    let routeIndex = NO_CAMERA_LINK;
    if (shot.points.length > 1) {
      routeIndex = camera.routeIndex;
      // A camera path can also drive objects, areas, or other cameras; leave those paths intact.
      if (routeIndex === NO_CAMERA_LINK || !file.routes[routeIndex]
        || file.cameras.some((other, i) => i !== order[index] && other.routeIndex === routeIndex)
        || file.objects.some((object) => object.routeIndex === routeIndex)
        || file.areas.some((area) => area.routeIndex === routeIndex)) {
        routeIndex = file.routes.length;
      }
      if (routeIndex >= NO_CAMERA_LINK) throw new Error('There is no room for another camera route in this KMP.');
      file.routes[routeIndex] = {
        smooth: 0, forwardBackward: 1,
        // The game blends neighboring point speeds, so a zero at the end slows the eye
        // while the look-at pan keeps moving. Keep the speed constant through the cut.
        points: positions.map((position) => ({ position, setting1: speed, setting2: 0 })),
      };
    }
    Object.assign(camera, {
      type: 5,
      nextIndex: order[index + 1] ?? NO_CAMERA_LINK,
      shake: 0, start: 0, movie: 0,
      routeIndex, pointVelocity, viewVelocity, zoomVelocity,
      position: first.position, rotation: ZERO_VEC3,
      viewStart: first.target, viewEnd: last.target,
      zoomStart: first.fovDegrees, zoomEnd: last.fovDegrees, time: shot.time,
    });
  }
  file.firstOpeningCamera = order[0];
  return { bytes: writeKmpFile(file), selectedId: `CAME-${order[0]}` };
}

/** Appends a camera and fills it in. */
export function addCamera(document: KmpDocument, values: CameraValues): CameraEditResult {
  const appended = parseKmp(appendKmpCamera(document, values.position));
  const newIndex = getCameraCount(appended) - 1;
  if (newIndex < 0) return { bytes: document.original, selectedId: null };
  const id = `CAME-${newIndex}`;
  return { bytes: applyCameraValues(appended, id, values), selectedId: id };
}

/** Copies a camera, including its `nextCam`, so the copy plays the same continuation. */
export function duplicateCamera(document: KmpDocument, index: number): CameraEditResult {
  const source = findCameraEntity(document, index);
  if (!source) return { bytes: document.original, selectedId: null };
  return addCamera(document, readCameraValues(source));
}

/** Deletes a camera and renumbers every reference to the ones after it. */
export function deleteCamera(document: KmpDocument, index: number): CameraEditResult {
  const entity = findCameraEntity(document, index);
  if (!entity) return { bytes: document.original, selectedId: null };
  const count = getCameraCount(document);
  const remap = buildCameraDeleteRemap(count, index);
  const removed = parseKmp(deleteKmpEntity(document, entity));
  const bytes = applyCameraReferenceRemap(removed, remap);
  const remaining = count - 1;
  const nextSelected = remaining === 0 ? null : `CAME-${Math.min(index, remaining - 1)}`;
  return { bytes, selectedId: nextSelected };
}

/**
 * Moves a camera to a new place in the list and renumbers every reference, so the track plays
 * exactly the same afterwards. Used by the up/down buttons and by dragging the opening list.
 */
export function moveCamera(document: KmpDocument, from: number, to: number): CameraEditResult {
  const count = getCameraCount(document);
  if (count === 0) return { bytes: document.original, selectedId: null };
  const clampedTo = to < 0 ? 0 : to >= count ? count - 1 : to;
  if (from < 0 || from >= count || from === clampedTo) return { bytes: document.original, selectedId: `CAME-${from}` };

  let current = document;
  const step = clampedTo > from ? 1 : -1;
  for (let index = from; index !== clampedTo; index += step) {
    const live = findCameraEntity(current, index);
    if (!live) break;
    current = parseKmp(moveKmpEntity(current, live, step));
  }
  const bytes = applyCameraReferenceRemap(current, buildCameraMoveRemap(count, from, clampedTo));
  return { bytes, selectedId: `CAME-${clampedTo}` };
}

/** Points one of the two CAME header chains at a camera (or at "none"). */
export function setChainStart(document: KmpDocument, kind: CameraChainKind, index: number): Uint8Array {
  return patchKmpCameraHeaderField(document, kind === 'opening' ? 'firstIntroCam' : 'firstSelectionCam', index);
}

/**
 * Rewrites a chain so it plays `order` from front to back: each camera hands over to the next
 * and the last one ends the chain. The header start is pointed at the first entry.
 */
export function setChainOrder(document: KmpDocument, kind: CameraChainKind, order: readonly number[]): Uint8Array {
  let current = document;
  for (let i = 0; i < order.length; i++) {
    const entity = findCameraEntity(current, order[i]);
    if (!entity) continue;
    const next = i + 1 < order.length ? order[i + 1] : NO_CAMERA_LINK;
    if (entity.camera?.nextCam === next) continue;
    current = parseKmp(patchKmpCameraField(current, entity, 'nextCam', next));
  }
  const start = order.length > 0 ? order[0] : NO_CAMERA_LINK;
  const header = getKmpCameraHeader(current);
  const currentStart = kind === 'opening' ? header.firstIntroCam : header.firstSelectionCam;
  if (currentStart === start) return current.original;
  return setChainStart(current, kind, start);
}

/** Moves one entry of a chain, in play order, and returns the reordered index list. */
export function reorderChain(order: readonly number[], from: number, to: number): number[] {
  const next = [...order];
  if (from < 0 || from >= next.length) return next;
  const clampedTo = to < 0 ? 0 : to >= next.length ? next.length - 1 : to;
  const [moved] = next.splice(from, 1);
  next.splice(clampedTo, 0, moved);
  return next;
}

/** Cameras that can sensibly be added to a chain: the opening pan types. */
export function isChainableCameraType(type: number): boolean {
  return isOpeningCameraType(type);
}
