/** Small pure helpers shared by the tools: ray/plane, road picking, selection algebra. */
import { sectionAt } from '../../../lib/create/sections';
import { evaluateRoadAt, projectOntoRoad, roadLength, type RoadProjection } from '../../../lib/create/spline';
import type { CreatePointerEvent, CreateProject, CreateRay, CreateSelection, Prop, Road, Vec3 } from '../../../lib/create/types';
import type { ToolCtx } from './types';

export function rayPlane(ray: CreateRay, y: number): Vec3 | null {
  const dy = ray.direction.y;
  if (Math.abs(dy) < 1e-9) return null;
  const t = (y - ray.origin.y) / dy;
  if (!Number.isFinite(t) || t < 0) return null;
  return { x: ray.origin.x + ray.direction.x * t, y, z: ray.origin.z + ray.direction.z * t };
}

/**
 * The ray against the vertical plane through `point` that faces the camera (its normal is the
 * horizontal direction from the eye to the point). This is how a screen drag turns into a height
 * in perspective. Null when the ray is nearly parallel to the plane (a camera looking almost
 * straight down, or the orthographic top view) or points away.
 */
export function rayVerticalPlane(ray: CreateRay, point: Vec3): Vec3 | null {
  const nx = point.x - ray.origin.x;
  const nz = point.z - ray.origin.z;
  const nl = Math.hypot(nx, nz);
  if (nl < 1e-6) return null;
  const n = { x: nx / nl, z: nz / nl };
  const along = ray.direction.x * n.x + ray.direction.z * n.z;
  // A ray this flat against the plane normal swings wildly: leave it to the fixed-rate fallback.
  if (along < 0.2) return null;
  const t = ((point.x - ray.origin.x) * n.x + (point.z - ray.origin.z) * n.z) / along;
  if (!Number.isFinite(t) || t < 0) return null;
  return { x: ray.origin.x + ray.direction.x * t, y: ray.origin.y + ray.direction.y * t, z: ray.origin.z + ray.direction.z * t };
}

/** Where the cursor touches the world: the design's collision, else the ground plane. */
export function groundHit(event: CreatePointerEvent, ctx: Pick<ToolCtx, 'groundPlaneY'>): Vec3 | null {
  return event.hit?.position ?? rayPlane(event.ray, ctx.groundPlaneY);
}

export interface RoadUnderCursor {
  road: Road;
  projection: RoadProjection;
}

/**
 * The road whose surface (plus `margin` units either side) is under `point`, preferring the layer
 * at the same height so an overpass can be told from the road beneath it.
 */
export function roadUnder(project: CreateProject, point: Vec3, margin = 0): RoadUnderCursor | null {
  let best: RoadUnderCursor | null = null;
  let bestCost = Infinity;
  for (const road of project.roads) {
    if (road.points.length < 2) continue;
    const projection = projectOntoRoad(road, point);
    if (!projection) continue;
    const reach = projection.sample.width / 2 + margin;
    if (projection.distanceToCenter > reach) continue;
    const dy = point.y - projection.position.y;
    const cost = projection.distanceToCenter * projection.distanceToCenter + dy * dy * 0.0625;
    if (cost < bestCost) {
      bestCost = cost;
      best = { road, projection };
    }
  }
  return best;
}

/** Nearest road centre line within `maxDistance` (units) regardless of road width. */
export function nearestRoadWithin(project: CreateProject, point: Vec3, maxDistance: number): RoadUnderCursor | null {
  let best: RoadUnderCursor | null = null;
  let bestD = maxDistance;
  for (const road of project.roads) {
    if (road.points.length < 2) continue;
    const projection = projectOntoRoad(road, point);
    if (!projection || projection.distanceToCenter > bestD) continue;
    bestD = projection.distanceToCenter;
    best = { road, projection };
  }
  return best;
}

export function sectionIdAt(road: Road, param: number): string | null {
  return sectionAt(road, param)?.section.id ?? null;
}

export function selectionKey(sel: CreateSelection): string {
  switch (sel.kind) {
    case 'road':
      return `road:${sel.roadId}`;
    case 'point':
      return `point:${sel.roadId}:${sel.pointId}`;
    case 'section':
      return `section:${sel.roadId}:${sel.sectionId}`;
    case 'piece':
      return `piece:${sel.pieceId}`;
    case 'prop':
      return `prop:${sel.propId}`;
    case 'start':
      return 'start';
    case 'stroke':
      return `stroke:${sel.strokeId}`;
  }
}

export function isSelected(selection: readonly CreateSelection[], target: CreateSelection): boolean {
  const key = selectionKey(target);
  return selection.some((s) => selectionKey(s) === key);
}

/** Shift-click: add the target, or drop it when it is already part of the selection. */
export function toggleSelection(selection: readonly CreateSelection[], target: CreateSelection): CreateSelection[] {
  const key = selectionKey(target);
  if (selection.some((s) => selectionKey(s) === key)) return selection.filter((s) => selectionKey(s) !== key);
  return [...selection, target];
}

/** Closest prop to the cursor on screen (base or a bit above it, since props are tall), within `radiusPx`. */
export function pickProp(project: CreateProject, screen: { x: number; y: number }, ctx: Pick<ToolCtx, 'project2d' | 'unitsPerPixel'>, radiusPx = 16): Prop | null {
  let best: Prop | null = null;
  let bestD = radiusPx;
  for (const prop of project.props) {
    const base = prop.position;
    const mid = { x: base.x, y: base.y + 260 * Math.max(0.5, prop.scale.y), z: base.z };
    for (const p of [base, mid]) {
      const s = ctx.project2d(p);
      if (!s) continue;
      const d = Math.hypot(s.x - screen.x, s.y - screen.y);
      if (d < bestD) {
        bestD = d;
        best = prop;
      }
    }
  }
  return best;
}

/** Frame at a distance along the road from the road's start (clamped for open roads). */
export function pointOnRoad(road: Road, param: number): Vec3 {
  return evaluateRoadAt(road, param).position;
}

export function roadIsDrivable(road: Road | undefined): road is Road {
  return !!road && road.points.length >= 2 && roadLength(road) > 0;
}

export function screenDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export const isPrimaryButton = (event: CreatePointerEvent): boolean => event.button === 0 && !event.alt;

/** The road a selection belongs to (road, point or section), if any. */
export function selectedRoadId(selection: readonly CreateSelection[]): string | null {
  for (const sel of selection) if (sel.kind === 'road' || sel.kind === 'point' || sel.kind === 'section') return sel.roadId;
  return null;
}
