/** Pure model behind the palette: surface groups, hazards, scenery search. Unit tested. */
import type { CreateKit, KitSceneryEntry, KitSurface, SurfaceCategory } from '../../../lib/create/types';
import { isPaintable } from '../tools/armed';

export interface SurfaceGroup {
  id: string;
  label: string;
  categories: SurfaceCategory[];
}

export const SURFACE_GROUPS: SurfaceGroup[] = [
  { id: 'road', label: 'Road surfaces', categories: ['road'] },
  { id: 'curb', label: 'Curbs', categories: ['curb'] },
  { id: 'wall', label: 'Walls and fences', categories: ['wall'] },
  { id: 'ground', label: 'Ground', categories: ['ground'] },
  { id: 'offroad', label: 'Mud and dirt', categories: ['offroad'] },
  { id: 'ice', label: 'Ice', categories: ['ice'] },
  { id: 'water', label: 'Water', categories: ['water'] },
  { id: 'lava', label: 'Lava', categories: ['lava'] },
  { id: 'special', label: 'Boost and finish line', categories: ['boost', 'decal', 'underside'] },
];

export interface SurfaceEntry {
  surface: KitSurface;
  /** The surface is one of the current world's own (shown first, marked "From your world"). */
  inWorld: boolean;
}

export interface SurfaceSection {
  group: SurfaceGroup;
  entries: SurfaceEntry[];
}

function worldSurfaceIds(kit: CreateKit, themeId: string): Set<string> {
  const theme = kit.theme(themeId);
  return new Set(theme ? Object.values(theme.slots) : []);
}

function matches(surface: KitSurface, query: string): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  return surface.label.toLowerCase().includes(q) || surface.id.toLowerCase().includes(q) || surface.category.includes(q);
}

/** Surfaces grouped for the Surfaces tab. The world's own surfaces lead each group. */
export function groupSurfaces(kit: CreateKit, themeId: string, query = '', only?: (surface: KitSurface) => boolean): SurfaceSection[] {
  const own = worldSurfaceIds(kit, themeId);
  const sections: SurfaceSection[] = [];
  for (const group of SURFACE_GROUPS) {
    const entries = kit.catalog.surfaces
      .filter((s) => group.categories.includes(s.category) && matches(s, query) && (!only || only(s)))
      .map((surface) => ({ surface, inWorld: own.has(surface.id) }));
    entries.sort((a, b) => Number(b.inWorld) - Number(a.inWorld));
    if (entries.length > 0) sections.push({ group, entries });
  }
  return sections;
}

/** Surfaces the Paint tool can lay on the ground. */
export function paintSections(kit: CreateKit, themeId: string, query = ''): SurfaceSection[] {
  return groupSurfaces(kit, themeId, query, (s) => isPaintable(s.category));
}

/** One sentence about a surface for its tooltip: what it is and what clicking it does. */
export function surfaceBlurb(surface: KitSurface): string {
  switch (surface.category) {
    case 'road':
      return 'A road surface. Select a road section and click this, or drag it onto the road.';
    case 'curb':
      return 'The striped strip along a road edge. Sections switch curbs on in their edge settings.';
    case 'wall':
      return 'Used automatically for walls, fences and rails.';
    case 'ground':
      return 'Ground cover. Click it, then drag over the ground to paint. Karts slow down on it.';
    case 'offroad':
      return 'Rough ground that slows karts a lot. Click it, then drag over the ground to paint.';
    case 'ice':
      return 'Slippery ice. Click it, then drag over the ground to paint.';
    case 'water':
      return 'Water. Karts that touch it fall in and respawn. Click it, then drag to paint.';
    case 'lava':
      return 'Lava. Karts that touch it burn up and respawn. Click it, then drag to paint.';
    case 'boost':
      return 'The boost arrows. Boost panels use this automatically.';
    case 'decal':
      return 'The finish line pattern. The start line uses this automatically.';
    case 'underside':
      return 'The underside of bridges. Used automatically.';
  }
}

export interface HazardEntry {
  objectId: number;
  label: string;
  description: string;
}

/** Road-attached hazards offered in the Pieces tab (ObjFlow ids). */
export const HAZARDS: HazardEntry[] = [
  { objectId: 0x191, label: 'Goomba', description: 'Walks back and forth across the road.' },
  { objectId: 0x192, label: 'Monty Mole', description: 'Pops out of the ground next to the road.' },
  { objectId: 0x194, label: 'Piranha plant', description: 'Snaps at karts that drive past.' },
  { objectId: 0x162, label: 'Thwomp', description: 'Slams down onto the road now and then.' },
  { objectId: 0x1a5, label: 'Fire bar', description: 'A spinning bar of fire. Drive around it or jump.' },
];

export const ITEM_BOX_OBJECT_ID = 0x65;

/** Scenery for the Scenery tab: the world's own picks, optionally every world's, filtered by a search. */
export function filterScenery(kit: CreateKit, themeId: string, query: string, showAll: boolean): KitSceneryEntry[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<number>();
  const out: KitSceneryEntry[] = [];
  for (const entry of kit.catalog.scenery) {
    if (!showAll && !entry.themeIds.includes(themeId)) continue;
    if (q && !entry.label.toLowerCase().includes(q)) continue;
    if (seen.has(entry.objectId)) continue;
    seen.add(entry.objectId);
    out.push(entry);
  }
  return out;
}
