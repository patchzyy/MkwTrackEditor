/** Palette items: how tiles arm tools and which tool an item belongs to. Pure. */
import { getRoadStyle } from '../../../lib/create/roadStyles';
import type { CreateKit, CreateProject, KitSurface, PieceKind, SurfaceCategory } from '../../../lib/create/types';
import type { ArmedItem, SculptMode, ToolId } from './types';

/** Surface categories the Paint tool can lay on the ground. */
export const PAINT_CATEGORIES: readonly SurfaceCategory[] = ['ground', 'offroad', 'water', 'lava', 'ice'];

export function isPaintable(category: SurfaceCategory): boolean {
  return PAINT_CATEGORIES.includes(category);
}

/** The tool an armed item belongs to. */
export function toolForItem(item: ArmedItem): ToolId {
  switch (item.kind) {
    case 'roadStyle':
      return 'road';
    case 'piece':
      return 'pieces';
    case 'surface':
      return 'paint';
    case 'sculpt':
      return 'sculpt';
    case 'scenery':
      return 'scenery';
  }
}

export function roadStyleItem(styleId: string): ArmedItem {
  return { kind: 'roadStyle', styleId, label: getRoadStyle(styleId).label };
}

export const PIECE_LABELS: Record<PieceKind, string> = {
  boostPanel: 'Boost panel',
  boostRamp: 'Boost ramp',
  trickRamp: 'Trick ramp',
  itemRow: 'Item box row',
  object: 'Object',
};

export function pieceItem(piece: PieceKind, objectId?: number, label?: string): ArmedItem {
  return { kind: 'piece', piece, ...(objectId !== undefined ? { objectId } : {}), label: label ?? PIECE_LABELS[piece] };
}

export function surfaceItem(surface: KitSurface): ArmedItem {
  return { kind: 'surface', surface: { surfaceId: surface.id }, category: surface.category, label: surface.label };
}

export const ERASER_ITEM: ArmedItem = { kind: 'surface', surface: null, category: 'erase', label: 'Eraser' };

export const SCULPT_ITEMS: Array<{ mode: SculptMode; label: string; description: string }> = [
  { mode: 'raise', label: 'Raise', description: 'Build hills. Hold Shift to dig instead.' },
  { mode: 'lower', label: 'Lower', description: 'Dig valleys and ditches. Hold Shift to build instead.' },
  { mode: 'smooth', label: 'Smooth', description: 'Soften bumps and sharp edges. Also on Ctrl.' },
  { mode: 'flatten', label: 'Flatten', description: 'Level the ground to the height where you start dragging.' },
];

export function sculptItem(mode: SculptMode): ArmedItem {
  const info = SCULPT_ITEMS.find((s) => s.mode === mode);
  return { kind: 'sculpt', mode, label: info?.label ?? mode };
}

/** Scenery the kit offers for a theme, in catalog order. */
export function sceneryForTheme(kit: CreateKit, themeId: string) {
  return kit.catalog.scenery.filter((entry) => entry.themeIds.includes(themeId));
}

/** What a tool arms by itself the first time it is chosen, so its very first click works. */
export function defaultArmedFor(tool: ToolId, current: ArmedItem | null, project: CreateProject | null, kit: CreateKit | null): ArmedItem | null {
  switch (tool) {
    case 'pieces':
      return current?.kind === 'piece' ? current : pieceItem('boostPanel');
    case 'sculpt':
      return current?.kind === 'sculpt' ? current : sculptItem('raise');
    case 'paint': {
      if (current?.kind === 'surface') return current;
      const theme = project && kit ? kit.theme(project.themeId) : null;
      const id = theme?.slots.sand ?? theme?.slots.groundAlt;
      const surface = id && kit ? kit.surface(id) : null;
      return surface ? surfaceItem(surface) : null;
    }
    case 'scenery': {
      if (current?.kind === 'scenery') return current;
      if (!project || !kit) return null;
      const list = sceneryForTheme(kit, project.themeId);
      const first = list.find((s) => /tree|palm|cypress/i.test(s.label)) ?? list[0];
      return first ? { kind: 'scenery', objectId: first.objectId, label: first.label, scale: first.scale, spacing: first.spacing } : null;
    }
    case 'road':
      return current?.kind === 'roadStyle' ? current : null;
    default:
      return current;
  }
}

/** Same palette tile? (Used to light up the armed tile.) */
export function sameArmed(a: ArmedItem | null | undefined, b: ArmedItem | null | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'roadStyle':
      return a.styleId === (b as typeof a).styleId;
    case 'piece':
      return a.piece === (b as typeof a).piece && a.objectId === (b as typeof a).objectId;
    case 'surface': {
      const o = b as typeof a;
      return a.category === o.category && JSON.stringify(a.surface) === JSON.stringify(o.surface);
    }
    case 'sculpt':
      return a.mode === (b as typeof a).mode;
    case 'scenery':
      return a.objectId === (b as typeof a).objectId;
  }
}
