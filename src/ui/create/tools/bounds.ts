/** Bounds of design things, for "frame the selection" (F) and double-click in the layers tree. Pure. */
import { sectionRanges } from '../../../lib/create/sections';
import { evaluateRoadAt, offsetFromCenter, type RoadSamples } from '../../../lib/create/spline';
import { pieceSample } from '../../../lib/create/pieces';
import type { CreateProject, CreateSelection, Vec3 } from '../../../lib/create/types';

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

class Accumulator {
  min = { x: Infinity, y: Infinity, z: Infinity };
  max = { x: -Infinity, y: -Infinity, z: -Infinity };
  add(p: Vec3, pad = 0) {
    this.min.x = Math.min(this.min.x, p.x - pad);
    this.min.y = Math.min(this.min.y, p.y - pad);
    this.min.z = Math.min(this.min.z, p.z - pad);
    this.max.x = Math.max(this.max.x, p.x + pad);
    this.max.y = Math.max(this.max.y, p.y + pad);
    this.max.z = Math.max(this.max.z, p.z + pad);
  }
  get empty(): boolean {
    return this.min.x > this.max.x;
  }
  result(minSize: number): Bounds | null {
    if (this.empty) return null;
    const min = { ...this.min };
    const max = { ...this.max };
    for (const axis of ['x', 'z'] as const) {
      const size = max[axis] - min[axis];
      if (size < minSize) {
        const mid = (max[axis] + min[axis]) / 2;
        min[axis] = mid - minSize / 2;
        max[axis] = mid + minSize / 2;
      }
    }
    if (max.y - min.y < 200) {
      const mid = (max.y + min.y) / 2;
      min.y = mid - 100;
      max.y = mid + 100;
    }
    return { min, max };
  }
}

export const MIN_FRAME_SIZE = 6000;

function addRoad(acc: Accumulator, project: CreateProject, roadId: string, samples: Map<string, RoadSamples>, from?: number, to?: number) {
  const road = project.roads.find((r) => r.id === roadId);
  if (!road) return;
  const list = samples.get(roadId);
  if (list && list.length > 0) {
    for (const s of list) {
      if (from !== undefined && s.param < from - 1e-6) continue;
      if (to !== undefined && s.param > to + 1e-6) continue;
      acc.add(s.position, s.width / 2);
    }
    if (from !== undefined && to !== undefined && road.points.length >= 2) {
      acc.add(evaluateRoadAt(road, from).position, 800);
      acc.add(evaluateRoadAt(road, to).position, 800);
    }
    return;
  }
  for (const p of road.points) acc.add(p.position, p.width / 2);
}

/** Bounds of a selection (or of the whole design when it is empty); null when there is nothing. */
export function selectionBounds(project: CreateProject, samples: Map<string, RoadSamples>, selection: readonly CreateSelection[]): Bounds | null {
  const acc = new Accumulator();
  if (selection.length === 0) {
    for (const road of project.roads) addRoad(acc, project, road.id, samples);
    for (const prop of project.props) acc.add(prop.position, 400);
    return acc.result(MIN_FRAME_SIZE);
  }
  for (const sel of selection) {
    switch (sel.kind) {
      case 'road':
        addRoad(acc, project, sel.roadId, samples);
        break;
      case 'point': {
        const pt = project.roads.find((r) => r.id === sel.roadId)?.points.find((p) => p.id === sel.pointId);
        if (pt) acc.add(pt.position, Math.max(1500, pt.width));
        break;
      }
      case 'section': {
        const road = project.roads.find((r) => r.id === sel.roadId);
        const range = road ? sectionRanges(road).find((r) => r.section.id === sel.sectionId) : null;
        if (range) addRoad(acc, project, sel.roadId, samples, range.from, range.to);
        break;
      }
      case 'piece': {
        const piece = project.pieces.find((p) => p.id === sel.pieceId);
        const at = piece ? pieceSample(project, piece) : null;
        if (at && piece) acc.add(offsetFromCenter(at.sample, piece.lateral * at.sample.width * 0.5), 1800);
        break;
      }
      case 'prop': {
        const prop = project.props.find((p) => p.id === sel.propId);
        if (prop) acc.add(prop.position, 1200);
        break;
      }
      case 'start': {
        const road = project.roads.find((r) => r.id === project.start.roadId);
        if (road && road.points.length >= 2) acc.add(evaluateRoadAt(road, project.start.param).position, 2400);
        break;
      }
      case 'stroke': {
        const stroke = project.terrainStrokes.find((s) => s.id === sel.strokeId);
        if (stroke) for (const p of stroke.points) acc.add({ x: p.x, y: project.terrain.baseHeight, z: p.z }, stroke.radius);
        break;
      }
    }
  }
  return acc.result(MIN_FRAME_SIZE);
}

/** Bounds of the roads only (not scenery that wandered off): what "the track" means when framing it. */
export function roadsBounds(project: CreateProject, samples: Map<string, RoadSamples>): Bounds | null {
  return selectionBounds(project, samples, project.roads.map((r) => ({ kind: 'road' as const, roadId: r.id })));
}
