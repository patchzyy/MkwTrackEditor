/**
 * Built-in road styles. A style is the default cross-section of a road (surface, edges, skirts);
 * individual sections override parts of it. Slots re-skin automatically when the theme changes.
 */
import type { RoadEdge, RoadStyle, RoadSection } from './types';

const edge = (partial: Partial<RoadEdge>): RoadEdge => ({
  curb: false,
  shoulder: null,
  shoulderWidth: 0,
  wall: 'none',
  wallHeight: 0,
  ...partial,
});

export const DEFAULT_ROAD_STYLE_ID = 'circuit';

export const ROAD_STYLES: RoadStyle[] = [
  {
    id: 'circuit',
    label: 'Racing circuit',
    description: 'A classic race track: smooth road with striped curbs and a grassy strip along each side.',
    surface: { slot: 'road' },
    left: edge({ curb: true, shoulder: { slot: 'shoulder' }, shoulderWidth: 700 }),
    right: edge({ curb: true, shoulder: { slot: 'shoulder' }, shoulderWidth: 700 }),
    skirt: { slot: 'cliff' },
    underside: { slot: 'underside' },
    curbWidth: 180,
    defaultWidth: 3600,
  },
  {
    id: 'walled',
    label: 'Walled road',
    description: 'A road with tall walls on both sides, like a canyon or a castle corridor. You cannot fall off.',
    surface: { slot: 'road' },
    left: edge({ wall: 'wall', wallHeight: 500 }),
    right: edge({ wall: 'wall', wallHeight: 500 }),
    skirt: { slot: 'wall' },
    underside: { slot: 'underside' },
    curbWidth: 160,
    defaultWidth: 3600,
  },
  {
    id: 'barrier',
    label: 'Guard-rail road',
    description: 'A road with low guard rails that keep you on the track, with a grass strip behind them.',
    surface: { slot: 'road' },
    left: edge({ shoulder: { slot: 'shoulder' }, shoulderWidth: 400, wall: 'barrier', wallHeight: 160 }),
    right: edge({ shoulder: { slot: 'shoulder' }, shoulderWidth: 400, wall: 'barrier', wallHeight: 160 }),
    skirt: { slot: 'cliff' },
    underside: { slot: 'underside' },
    curbWidth: 160,
    defaultWidth: 3600,
  },
  {
    id: 'trail',
    label: 'Dirt trail',
    description: 'A rough dirt path with no curbs. Drivers can wander onto the ground beside it.',
    surface: { slot: 'roadAlt' },
    left: edge({ shoulder: { slot: 'ground' }, shoulderWidth: 500 }),
    right: edge({ shoulder: { slot: 'ground' }, shoulderWidth: 500 }),
    skirt: { slot: 'cliff' },
    underside: { slot: 'underside' },
    curbWidth: 150,
    defaultWidth: 3200,
  },
  {
    id: 'bridge',
    label: 'Bridge deck',
    description: 'A narrow deck with low rails. Best used for stretches that cross over something.',
    surface: { slot: 'road' },
    left: edge({ wall: 'barrier', wallHeight: 200 }),
    right: edge({ wall: 'barrier', wallHeight: 200 }),
    skirt: { slot: 'underside' },
    underside: { slot: 'underside' },
    curbWidth: 150,
    defaultWidth: 3200,
  },
  {
    id: 'castle',
    label: 'Castle stone',
    description: 'Stone paving with no rails. Step off the edge and you fall into whatever is below.',
    surface: { slot: 'roadAlt' },
    left: edge({}),
    right: edge({}),
    skirt: { slot: 'wall' },
    underside: { slot: 'wall' },
    curbWidth: 150,
    defaultWidth: 3400,
  },
  {
    id: 'sky',
    label: 'Sky road',
    description: 'A floating road with light fences on both sides. Nothing below it but sky.',
    surface: { slot: 'road' },
    left: edge({ wall: 'fence', wallHeight: 230 }),
    right: edge({ wall: 'fence', wallHeight: 230 }),
    skirt: { slot: 'underside' },
    underside: { slot: 'underside' },
    curbWidth: 150,
    defaultWidth: 3000,
  },
];

export function getRoadStyle(id: string): RoadStyle {
  return ROAD_STYLES.find((style) => style.id === id) ?? ROAD_STYLES[0];
}

/** The style's edge with a section's partial override applied. */
export function resolveEdge(base: RoadEdge, override: Partial<RoadEdge> | undefined): RoadEdge {
  if (!override) return base;
  const merged: RoadEdge = { ...base };
  for (const key of Object.keys(override) as Array<keyof RoadEdge>) {
    const value = override[key];
    if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
  }
  return merged;
}

export interface ResolvedSectionStyle {
  style: RoadStyle;
  left: RoadEdge;
  right: RoadEdge;
  surface: RoadStyle['surface'];
}

export function resolveSectionStyle(style: RoadStyle, section: RoadSection): ResolvedSectionStyle {
  return {
    style,
    left: resolveEdge(style.left, section.left),
    right: resolveEdge(style.right, section.right),
    surface: section.surface ?? style.surface,
  };
}
