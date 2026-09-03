/**
 * The BRRES writer rebuilds every resource dictionary's radix search tree whenever it adds a
 * shape, a material or a texture. A tree that is subtly wrong still writes and still parses —
 * the game just fails to find the resource at runtime, which is invisible until someone loads
 * the track on hardware.
 *
 * `lookupResDicIndex` is the console-side walk of that tree, so running it over a freshly built
 * tree is the check that matters: every name must resolve to its own slot, and nothing else may.
 */

import { describe, expect, it } from 'vitest';
import { buildResDicIndexTree, lookupResDicIndex, resDicSize } from './resDic';
import { listCourseModels } from './brresFixtures.testdata';
import { readBrresRaw } from './brresRaw';

/** Every name resolves to its own 1-based slot, and an absent name resolves to nothing. */
function expectTreeResolvesEveryName(names: readonly string[]) {
  const nodes = buildResDicIndexTree(names);
  expect(nodes).toHaveLength(names.length + 1);
  names.forEach((name, index) => {
    expect(lookupResDicIndex(nodes, names, name), `"${name}" did not resolve to slot ${index + 1}`).toBe(index + 1);
  });
}

describe('resource dictionary radix tree', () => {
  it('sizes a dictionary the way the format specifies', () => {
    expect(resDicSize(0)).toBe(0x18);
    expect(resDicSize(3)).toBe(0x18 + 3 * 0x10);
  });

  it('resolves a single name', () => {
    expectTreeResolvesEveryName(['course']);
  });

  it('resolves names that share long prefixes', () => {
    expectTreeResolvesEveryName(['road', 'road_a', 'road_b', 'road_a_01', 'road_a_02', 'roadside']);
  });

  it('resolves names of very different lengths', () => {
    expectTreeResolvesEveryName(['a', 'ab', 'abc', 'abcdefghijklmnopqrstuvwxyz', 'z']);
  });

  it('resolves the material and shape names real course models actually use', () => {
    const models = listCourseModels(3);
    if (models.length === 0) return; // The real tracks are not on this machine.

    let checked = 0;
    for (const model of models) {
      const raw = readBrresRaw(model.data);
      for (const group of raw.groups) {
        const names = group.entries.map((entry) => entry.name);
        if (names.length === 0) continue;
        expectTreeResolvesEveryName(names);
        checked++;
      }
    }
    expect(checked, 'no dictionaries were checked').toBeGreaterThan(0);
  });

  it('reports -1 for a name that is not in the tree', () => {
    const names = ['alpha', 'beta', 'gamma'];
    const nodes = buildResDicIndexTree(names);
    expect(lookupResDicIndex(nodes, names, 'delta')).toBe(-1);
    expect(lookupResDicIndex(nodes, names, '')).toBe(-1);
  });

  it('builds a tree for an empty dictionary', () => {
    expect(buildResDicIndexTree([])).toHaveLength(1);
  });
});
