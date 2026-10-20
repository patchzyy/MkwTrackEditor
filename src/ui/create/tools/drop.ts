/**
 * Dropping a palette tile onto the viewport: what each kind of tile does at a ground point. Pure,
 * so it is tested without a canvas. The hook turns a browser drop event into a ground point and
 * calls this.
 */
import { addPiece, addTerrainStroke, updateRoad, updateSection } from '../../../lib/create/ops';
import type { CreateProject, Vec3 } from '../../../lib/create/types';
import { placementForLane, resolveLane } from './lanes';
import { roadUnder, sectionIdAt } from './pick';
import { placeOneProp } from './sceneryTool';
import { isPaintable } from './armed';
import { surfaceTint, type ArmedItem, type ToolCommand, type ToolCtx, type ToolPreview } from './types';

export interface DropResult {
  commands: ToolCommand[];
  /** Tool to switch to afterwards, if any. */
  tool?: 'select';
}

export function dropItem(item: ArmedItem, hit: Vec3, ctx: ToolCtx): DropResult {
  const project: CreateProject = ctx.project;
  switch (item.kind) {
    case 'roadStyle': {
      const under = roadUnder(project, hit, 300);
      if (!under) return { commands: [{ type: 'flash', message: 'Drop a road style onto a road to restyle it.' }] };
      const roadId = under.road.id;
      return {
        commands: [
          { type: 'edit', label: `Restyle road: ${item.label}`, mutate: (p) => updateRoad(p, roadId, { styleId: item.styleId }) },
          { type: 'select', selection: [{ kind: 'road', roadId }] },
        ],
      };
    }
    case 'piece': {
      const under = roadUnder(project, hit, 500);
      if (!under) return { commands: [{ type: 'flash', message: 'Drop pieces onto the road.' }] };
      const lane = resolveLane('auto', item.piece, under.projection.lateralNorm);
      const placement = placementForLane(item.piece, lane, under.projection.sample.width, item.objectId);
      const roadId = under.road.id;
      const param = under.projection.param;
      const result = addPiece(project, { ...placement, kind: item.piece, roadId, param });
      return {
        commands: [
          {
            type: 'edit',
            label: `Place ${item.label.toLowerCase()}`,
            mutate: (p) => (p === project ? result.project : addPiece(p, { ...placement, kind: item.piece, roadId, param }).project),
          },
          { type: 'select', selection: [{ kind: 'piece', pieceId: result.id }] },
        ],
      };
    }
    case 'surface': {
      if (item.category === 'road' || item.category === 'curb' || item.category === 'decal') {
        const under = roadUnder(project, hit, 300);
        if (!under || !item.surface) return { commands: [{ type: 'flash', message: 'Drop road surfaces onto the road.' }] };
        const sectionId = sectionIdAt(under.road, under.projection.param);
        if (!sectionId) return { commands: [] };
        const roadId = under.road.id;
        const surface = item.surface;
        return {
          commands: [
            { type: 'edit', label: `Road surface: ${item.label}`, mutate: (p) => updateSection(p, roadId, sectionId, { surface }) },
            { type: 'select', selection: [{ kind: 'section', roadId, sectionId }] },
          ],
        };
      }
      if (!isPaintable(item.category as never) && item.category !== 'erase') {
        return { commands: [{ type: 'flash', message: `${item.label} is used automatically by roads and walls.` }] };
      }
      if (!project.terrain.enabled) return { commands: [{ type: 'flash', message: 'The ground is switched off. Turn it on in the Track settings.' }] };
      const surface = item.surface;
      const radius = ctx.brush.paintRadius;
      return {
        commands: [{ type: 'edit', label: `Paint ${item.label.toLowerCase()}`, mutate: (p) => addTerrainStroke(p, { kind: 'paint', surface, radius, points: [{ x: Math.round(hit.x), z: Math.round(hit.z) }] }).project }],
      };
    }
    case 'sculpt': {
      if (!project.terrain.enabled) return { commands: [{ type: 'flash', message: 'The ground is switched off. Turn it on in the Track settings.' }] };
      const radius = ctx.brush.sculptRadius;
      const strength = ctx.brush.sculptStrength;
      const mode = item.mode;
      return {
        commands: [
          {
            type: 'edit',
            label: `${item.label} ground`,
            mutate: (p) =>
              addTerrainStroke(p, {
                kind: 'sculpt',
                mode,
                radius,
                strength,
                ...(mode === 'flatten' ? { targetHeight: Math.round(hit.y) } : {}),
                points: [{ x: Math.round(hit.x), z: Math.round(hit.z) }],
              }).project,
          },
        ],
      };
    }
    case 'scenery': {
      const result = placeOneProp(project, item, hit);
      return {
        commands: [
          { type: 'edit', label: `Place ${item.label.toLowerCase()}`, mutate: (p) => (p === project ? result.project : placeOneProp(p, item, hit).project) },
          { type: 'select', selection: [{ kind: 'prop', propId: result.id }] },
        ],
      };
    }
  }
}

/** The ghost to show while a tile is dragged over the viewport. */
export function previewForDrop(item: ArmedItem, hit: Vec3, ctx: ToolCtx): ToolPreview | null {
  const project = ctx.project;
  switch (item.kind) {
    case 'piece': {
      const under = roadUnder(project, hit, 500);
      if (!under) return null;
      const lane = resolveLane('auto', item.piece, under.projection.lateralNorm);
      const placement = placementForLane(item.piece, lane, under.projection.sample.width, item.objectId);
      return {
        kind: 'piece',
        roadId: under.road.id,
        param: under.projection.param,
        lateral: placement.lateral,
        width: placement.width,
        length: placement.length,
        pieceKind: item.piece,
        lane,
      };
    }
    case 'surface':
      return { kind: 'brush', center: hit, radius: ctx.brush.paintRadius, style: item.category === 'erase' ? 'erase' : 'paint', category: item.category === 'erase' ? undefined : item.category, tint: item.surface && 'surfaceId' in item.surface ? surfaceTint(item.surface.surfaceId, item.category === 'erase' ? undefined : item.category) : undefined };
    case 'sculpt':
      return { kind: 'brush', center: hit, radius: ctx.brush.sculptRadius, style: item.mode };
    case 'scenery':
      return { kind: 'brush', center: hit, radius: 600, style: 'scenery' };
    case 'roadStyle': {
      const under = roadUnder(project, hit, 300);
      return under ? { kind: 'insert', roadId: under.road.id, param: under.projection.param, position: under.projection.position } : null;
    }
  }
}
