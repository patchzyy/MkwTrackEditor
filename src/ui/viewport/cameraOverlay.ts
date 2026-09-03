// Builds the CAME (camera) viewport overlay from a parsed KMP document.
//
// Pure: no React, no renderer. The viewport hands the result straight to the
// noclip scene's `setEditorOverlayData`.

import { getKmpCameraHeader, type KmpDocument, type KmpEntity, type Vec3 } from '../../lib/kmp';
import {
  NO_CAMERA_LINK,
  buildOpeningCameraChain,
  getCameraTypeInfo,
  type CameraPreviewDef,
  type CameraRoutePoint,
  type OpeningCameraStep,
} from '../../lib/cameraPreview';

export interface SceneOverlayCameraGizmo {
  id: string;
  index: number;
  type: number;
  position: Vec3;
  rotation: Vec3;
  viewStart: Vec3;
  viewEnd: Vec3;
  zoomStart: number;
  zoomEnd: number;
  routePoints: Vec3[];
  routeIndex: number;
  selected: boolean;
  hovered: boolean;
  label: string;
  openingOrder: number;
}

export interface SceneOverlayCameraChainLink {
  from: Vec3;
  to: Vec3;
  order: number;
}

export interface CameraOverlayResult {
  cameraGizmos: SceneOverlayCameraGizmo[];
  cameraChainLinks: SceneOverlayCameraChainLink[];
  openingChain: OpeningCameraStep[];
  firstIntroCam: number;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

export function getCameraEntities(kmp: KmpDocument | null | undefined): KmpEntity[] {
  if (!kmp) return [];
  return kmp.entities.filter((entity) => entity.section === 'CAME');
}

function getRoutePoints(kmp: KmpDocument, routeIndex: number): CameraRoutePoint[] | null {
  if (routeIndex === NO_CAMERA_LINK) return null;
  const route = kmp.routes.find((candidate) => candidate.index === routeIndex);
  if (!route) return null;
  return route.points.map((point) => ({ position: point.position, speed: point.setting1 }));
}

/** Turns CAME entities into the pure preview definitions used by `src/lib/cameraPreview.ts`. */
export function toCameraPreviewDefs(kmp: KmpDocument | null | undefined): CameraPreviewDef[] {
  if (!kmp) return [];
  return getCameraEntities(kmp).map((entity) => {
    const camera = entity.camera;
    const routeIndex = camera?.routeIndex ?? NO_CAMERA_LINK;
    return {
      index: entity.index,
      id: entity.id,
      type: camera?.type ?? 0,
      nextCam: camera?.nextCam ?? NO_CAMERA_LINK,
      routeIndex,
      vCam: camera?.vCam ?? 0,
      vZoom: camera?.vZoom ?? 0,
      vView: camera?.vView ?? 0,
      zoomStart: camera?.zoomStart ?? 60,
      zoomEnd: camera?.zoomEnd ?? 60,
      time: camera?.time ?? 0,
      position: entity.position,
      rotation: entity.rotation ?? ZERO,
      viewStart: entity.cameraView?.start ?? entity.position,
      viewEnd: entity.cameraView?.end ?? entity.cameraView?.start ?? entity.position,
      route: getRoutePoints(kmp, routeIndex),
    };
  });
}

export function findCameraPreviewDef(defs: readonly CameraPreviewDef[], cameraId: string | number | null): CameraPreviewDef | null {
  if (cameraId === null) return null;
  if (typeof cameraId === 'number') return defs.find((def) => def.index === cameraId) ?? null;
  return defs.find((def) => def.id === cameraId) ?? defs.find((def) => `CAME-${def.index}` === cameraId) ?? null;
}

export function buildCameraOverlay(
  kmp: KmpDocument | null | undefined,
  options: { selectedIds?: ReadonlySet<string> | null; hoveredId?: string | null } = {},
): CameraOverlayResult {
  if (!kmp) return { cameraGizmos: [], cameraChainLinks: [], openingChain: [], firstIntroCam: 0 };

  const { firstIntroCam } = getKmpCameraHeader(kmp);
  const defs = toCameraPreviewDefs(kmp);
  const entities = getCameraEntities(kmp);
  const openingChain = buildOpeningCameraChain(defs, firstIntroCam);
  const openingOrderByIndex = new Map<number, number>();
  openingChain.forEach((step, order) => openingOrderByIndex.set(step.cameraIndex, order + 1));

  const cameraGizmos: SceneOverlayCameraGizmo[] = entities.map((entity, i) => {
    const def = defs[i];
    return {
      id: entity.id,
      index: entity.index,
      type: def.type,
      position: def.position,
      rotation: def.rotation,
      viewStart: def.viewStart,
      viewEnd: def.viewEnd,
      zoomStart: def.zoomStart,
      zoomEnd: def.zoomEnd,
      routePoints: (def.route ?? []).map((point) => point.position),
      routeIndex: def.routeIndex,
      selected: options.selectedIds?.has(entity.id) ?? false,
      hovered: options.hoveredId === entity.id,
      label: `Camera ${entity.index} · ${getCameraTypeInfo(def.type).label}`,
      openingOrder: openingOrderByIndex.get(entity.index) ?? 0,
    };
  });

  const byIndex = new Map<number, SceneOverlayCameraGizmo>();
  for (const gizmo of cameraGizmos) byIndex.set(gizmo.index, gizmo);

  const cameraChainLinks: SceneOverlayCameraChainLink[] = [];
  for (let i = 0; i + 1 < openingChain.length; i++) {
    const from = byIndex.get(openingChain[i].cameraIndex);
    const to = byIndex.get(openingChain[i + 1].cameraIndex);
    if (!from || !to) continue;
    cameraChainLinks.push({ from: from.position, to: to.position, order: i + 1 });
  }

  return { cameraGizmos, cameraChainLinks, openingChain, firstIntroCam };
}
