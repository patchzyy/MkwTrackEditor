import { describe, expect, it } from 'vitest';
import { kit } from '../tools/testing';
import { filterScenery, groupSurfaces, HAZARDS, paintSections, surfaceBlurb, SURFACE_GROUPS } from './paletteModel';

describe('palette model', () => {
  it('groups surfaces by what they are used for, the world own surfaces first', () => {
    const sections = groupSurfaces(kit, 'test');
    expect(sections.map((s) => s.group.id)).toEqual(['road', 'curb', 'wall', 'ground', 'offroad', 'ice', 'water', 'lava', 'special']);
    const road = sections[0];
    expect(road.entries.length).toBe(2 * 2);
    expect(road.entries[0].inWorld).toBe(true);
    expect(road.entries.at(-1)!.inWorld).toBe(false);
  });

  it('searches by label and category', () => {
    expect(groupSurfaces(kit, 'test', 'sand').flatMap((s) => s.entries).every((e) => /sand/.test(e.surface.id))).toBe(true);
    expect(groupSurfaces(kit, 'test', 'nothing-like-this')).toEqual([]);
    expect(groupSurfaces(kit, 'test', 'water')[0].group.id).toBe('water');
  });

  it('paintable sections leave out roads, curbs and walls', () => {
    const ids = paintSections(kit, 'test').map((s) => s.group.id);
    expect(ids).toEqual(['ground', 'offroad', 'ice', 'water', 'lava']);
  });

  it('every category belongs to exactly one group and has a plain sentence', () => {
    const all = SURFACE_GROUPS.flatMap((g) => g.categories);
    expect(new Set(all).size).toBe(all.length);
    for (const surface of kit.catalog.surfaces) {
      expect(all).toContain(surface.category);
      expect(surfaceBlurb(surface).length).toBeGreaterThan(20);
      expect(surfaceBlurb(surface)).not.toMatch(/KCL|GOBJ|BRRES/);
    }
  });

  it('filters scenery by world, search and the all-worlds switch', () => {
    const custom = {
      ...kit,
      catalog: {
        ...kit.catalog,
        scenery: [
          { objectId: 1, label: 'Round tree', themeIds: ['test'], scale: 1, spacing: 1 },
          { objectId: 2, label: 'Palm tree', themeIds: ['other'], scale: 1, spacing: 1 },
          { objectId: 3, label: 'Cone', themeIds: ['test', 'other'], scale: 1, spacing: 1 },
        ],
      },
    };
    expect(filterScenery(custom, 'test', '', false).map((e) => e.objectId)).toEqual([1, 3]);
    expect(filterScenery(custom, 'test', 'tree', true).map((e) => e.objectId)).toEqual([1, 2]);
    expect(filterScenery(custom, 'test', 'TREE', false).map((e) => e.objectId)).toEqual([1]);
  });

  it('offers the road hazards with one-line descriptions', () => {
    expect(HAZARDS.length).toBeGreaterThanOrEqual(4);
    for (const h of HAZARDS) expect(h.description.endsWith('.')).toBe(true);
  });
});
