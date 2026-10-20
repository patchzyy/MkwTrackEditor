/** The Layers outliner as plain data: Roads > sections / points, Pieces, Scenery, Terrain strokes, Start line. */
import { CircleDot, Flag, Paintbrush, Route, TreePine, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { estimateLapSeconds } from '../../../lib/create/analyze';
import { sectionRanges } from '../../../lib/create/sections';
import { roadLength } from '../../../lib/create/spline';
import { objectProfile } from '../../../lib/create/props';
import type { CreateKit, CreateProject, CreateSelection, Piece, Road, TerrainStroke } from '../../../lib/create/types';
import type { TreeNode } from '../../components/treeModel';
import { getKnownObjectName } from '../../labels';
import { PIECE_LABELS } from '../tools/armed';
import { selectionKey } from '../tools/pick';
import { SECTION_ICONS } from '../viewport/icons';
import { SECTION_KIND_LABEL } from '../overlay/buildCreateOverlay';

export type LayerNode = TreeNode<CreateSelection | null>;

const tinted = (color: string, icon: ReactNode) => <span style={{ color, display: 'inline-flex' }}>{icon}</span>;

/** How long a road takes to drive, the way the checklist says it ("about 38 s"). */
export function formatDriveTime(units: number): string {
  const seconds = Math.max(1, Math.round(estimateLapSeconds(units)));
  return seconds >= 120 ? `${Math.round(seconds / 6) / 10} min` : `${seconds} s`;
}

export function pieceLabel(piece: Piece): string {
  if (piece.kind === 'object') {
    const name = piece.objectId === 0x65 ? 'Item box' : objectProfile(piece.objectId ?? 0).name.startsWith('Object ') ? getKnownObjectName(piece.objectId) ?? 'Object' : objectProfile(piece.objectId ?? 0).name;
    return name;
  }
  return PIECE_LABELS[piece.kind];
}

export function strokeLabel(stroke: TerrainStroke, kit: CreateKit | null, themeId: string): string {
  if (stroke.kind === 'paint') {
    if (!stroke.surface) return 'Erase paint';
    const surface = kit?.resolveSurface(stroke.surface, themeId);
    return `Paint ${surface?.label.toLowerCase() ?? 'ground'}`;
  }
  return { raise: 'Raise ground', lower: 'Lower ground', smooth: 'Smooth ground', flatten: 'Flatten ground' }[stroke.mode];
}

export function sceneryName(objectId: number, kit: CreateKit | null): string {
  return kit?.catalog.scenery.find((s) => s.objectId === objectId)?.label ?? getKnownObjectName(objectId) ?? 'Object';
}

function roadNodes(road: Road): LayerNode {
  const ranges = road.points.length >= 2 ? sectionRanges(road) : [];
  const sectionNodes: LayerNode[] = ranges.map((range, i) => ({
    id: `section:${road.id}:${range.section.id}`,
    label: range.section.label || `Section ${i + 1}`,
    detail: SECTION_KIND_LABEL[range.kind],
    icon: tinted('var(--create-section)', SECTION_ICONS[range.kind](13)),
    data: { kind: 'section', roadId: road.id, sectionId: range.section.id },
  }));
  const pointNodes: LayerNode[] = road.points.map((pt, i) => ({
    id: `point:${road.id}:${pt.id}`,
    label: `Point ${i + 1}`,
    detail: !road.closed && i === 0 ? 'Start' : !road.closed && i === road.points.length - 1 ? 'End' : undefined,
    icon: tinted('var(--create-road)', <CircleDot size={12} />),
    data: { kind: 'point', roadId: road.id, pointId: pt.id },
  }));
  const length = road.points.length >= 2 ? roadLength(road) : 0;
  return {
    id: `road:${road.id}`,
    label: road.name,
    detail: road.points.length < 2 ? 'Just started' : `${road.closed ? 'Loop' : 'Open'} · ${formatDriveTime(length)}`,
    icon: tinted('var(--create-road)', <Route size={13} />),
    data: { kind: 'road', roadId: road.id },
    children: [
      { id: `road:${road.id}:sections`, label: 'Sections', detail: String(sectionNodes.length), data: null, children: sectionNodes },
      { id: `road:${road.id}:points`, label: 'Points', detail: String(pointNodes.length), data: null, children: pointNodes },
    ],
  };
}

export const GROUP_ROADS = 'group:roads';
export const GROUP_PIECES = 'group:pieces';
export const GROUP_SCENERY = 'group:scenery';
export const GROUP_TERRAIN = 'group:terrain';

/** Builds the whole tree. Empty groups are left out so the tree only shows what exists. */
export function buildLayerNodes(project: CreateProject, kit: CreateKit | null): LayerNode[] {
  const nodes: LayerNode[] = [];
  if (project.roads.length > 0) {
    nodes.push({ id: GROUP_ROADS, label: 'Roads', detail: String(project.roads.length), data: null, children: project.roads.map(roadNodes) });
  }
  if (project.pieces.length > 0) {
    nodes.push({
      id: GROUP_PIECES,
      label: 'Pieces',
      detail: String(project.pieces.length),
      data: null,
      children: project.pieces.map((piece) => ({
        id: `piece:${piece.id}`,
        label: pieceLabel(piece),
        detail: piece.kind === 'itemRow' ? `${piece.count ?? 5} boxes` : undefined,
        icon: tinted('var(--create-piece)', <Zap size={12} />),
        data: { kind: 'piece', pieceId: piece.id },
      })),
    });
  }
  if (project.props.length > 0) {
    const byObject = new Map<number, typeof project.props>();
    for (const prop of project.props) byObject.set(prop.objectId, [...(byObject.get(prop.objectId) ?? []), prop]);
    nodes.push({
      id: GROUP_SCENERY,
      label: 'Scenery',
      detail: String(project.props.length),
      data: null,
      children: [...byObject.entries()].map(([objectId, props]) => ({
        id: `scenery:${objectId}`,
        label: sceneryName(objectId, kit),
        detail: `×${props.length}`,
        icon: tinted('var(--create-scenery)', <TreePine size={12} />),
        data: null,
        children: props.map((prop, i) => ({
          id: `prop:${prop.id}`,
          label: `${sceneryName(objectId, kit)} ${i + 1}`,
          icon: tinted('var(--create-scenery)', <TreePine size={12} />),
          data: { kind: 'prop', propId: prop.id } as CreateSelection,
        })),
      })),
    });
  }
  if (project.terrainStrokes.length > 0) {
    nodes.push({
      id: GROUP_TERRAIN,
      label: 'Terrain',
      detail: String(project.terrainStrokes.length),
      data: null,
      children: project.terrainStrokes.map((stroke, i) => ({
        id: `stroke:${stroke.id}`,
        label: strokeLabel(stroke, kit, project.themeId),
        detail: `#${i + 1}`,
        icon: tinted('var(--create-terrain)', <Paintbrush size={12} />),
        data: { kind: 'stroke', strokeId: stroke.id } as CreateSelection,
      })),
    });
  }
  if (project.roads.some((r) => r.id === project.start.roadId)) {
    nodes.push({ id: 'start', label: 'Start line', icon: tinted('var(--create-start)', <Flag size={13} />), data: { kind: 'start' } });
  }
  return nodes;
}

/** The tree row id for a selection. */
export function nodeIdFor(selection: CreateSelection): string {
  switch (selection.kind) {
    case 'road':
      return `road:${selection.roadId}`;
    case 'point':
      return `point:${selection.roadId}:${selection.pointId}`;
    case 'section':
      return `section:${selection.roadId}:${selection.sectionId}`;
    case 'piece':
      return `piece:${selection.pieceId}`;
    case 'prop':
      return `prop:${selection.propId}`;
    case 'stroke':
      return `stroke:${selection.strokeId}`;
    case 'start':
      return 'start';
  }
}

/** The rows that must be open for `selection` to be visible. */
export function ancestorsFor(selection: CreateSelection, project: CreateProject): string[] {
  switch (selection.kind) {
    case 'road':
      return [GROUP_ROADS];
    case 'point':
      return [GROUP_ROADS, `road:${selection.roadId}`, `road:${selection.roadId}:points`];
    case 'section':
      return [GROUP_ROADS, `road:${selection.roadId}`, `road:${selection.roadId}:sections`];
    case 'piece':
      return [GROUP_PIECES];
    case 'prop': {
      const prop = project.props.find((p) => p.id === selection.propId);
      return prop ? [GROUP_SCENERY, `scenery:${prop.objectId}`] : [GROUP_SCENERY];
    }
    case 'stroke':
      return [GROUP_TERRAIN];
    case 'start':
      return [];
  }
}

export function defaultExpanded(project: CreateProject): Set<string> {
  return new Set([GROUP_ROADS, GROUP_PIECES, GROUP_TERRAIN, ...project.roads.map((r) => `road:${r.id}`)]);
}

export { selectionKey };
