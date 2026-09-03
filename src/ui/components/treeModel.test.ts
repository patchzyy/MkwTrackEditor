import { describe, expect, it } from 'vitest';
import {
  ancestorIds,
  collectDescendantIds,
  collectExpandableIds,
  computeTreeWindow,
  flattenTree,
  handleTreeKey,
  type TreeNode,
} from './treeModel';

const tree: TreeNode[] = [
  {
    id: 'objects',
    label: 'Game Objects',
    children: [
      { id: 'favourites', label: 'Favourites' },
      { id: 'enemies', label: 'Enemies', children: [{ id: 'koopa', label: 'Koopa' }] },
    ],
  },
  { id: 'trackData', label: 'Track Data', children: [{ id: 'kmp', label: 'Points and routes' }] },
];

describe('flattenTree', () => {
  it('only descends into expanded nodes', () => {
    expect(flattenTree(tree, new Set()).map((row) => row.id)).toEqual(['objects', 'trackData']);
    expect(flattenTree(tree, new Set(['objects'])).map((row) => row.id)).toEqual(['objects', 'favourites', 'enemies', 'trackData']);
  });

  it('records depth, parent and child-ness', () => {
    const rows = flattenTree(tree, new Set(['objects', 'enemies']));
    const koopa = rows.find((row) => row.id === 'koopa');
    expect(koopa).toMatchObject({ depth: 2, parentId: 'enemies', hasChildren: false });
    expect(rows.find((row) => row.id === 'enemies')).toMatchObject({ depth: 1, hasChildren: true, expanded: true });
    expect(rows.map((row) => row.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('does not mark a childless node as expanded even if its id is in the set', () => {
    const rows = flattenTree(tree, new Set(['objects', 'favourites']));
    expect(rows.find((row) => row.id === 'favourites')?.expanded).toBe(false);
  });
});

describe('tree id helpers', () => {
  it('collects descendants without the node itself', () => {
    expect(collectDescendantIds(tree[0])).toEqual(['favourites', 'enemies', 'koopa']);
    expect(collectDescendantIds({ id: 'leaf', label: 'Leaf' })).toEqual([]);
  });

  it('collects every node that can be expanded', () => {
    expect(collectExpandableIds(tree)).toEqual(['objects', 'enemies', 'trackData']);
  });

  it('walks the ancestors of a node, root first', () => {
    expect(ancestorIds(tree, 'koopa')).toEqual(['objects', 'enemies']);
    expect(ancestorIds(tree, 'objects')).toEqual([]);
    expect(ancestorIds(tree, 'nope')).toEqual([]);
  });
});

describe('computeTreeWindow', () => {
  it('renders nothing for an empty tree', () => {
    expect(computeTreeWindow(0, 0, 300, 24)).toEqual({ start: 0, end: 0, offsetY: 0, totalHeight: 0 });
  });

  it('keeps a thousand rows at a few dozen elements', () => {
    const window_ = computeTreeWindow(1000, 0, 240, 24);
    expect(window_.totalHeight).toBe(24000);
    expect(window_.start).toBe(0);
    expect(window_.end - window_.start).toBeLessThan(40);
  });

  it('offsets the rendered slice by whole rows', () => {
    const window_ = computeTreeWindow(1000, 480, 240, 24, 2);
    expect(window_.start).toBe(18);
    expect(window_.offsetY).toBe(18 * 24);
  });

  it('clamps a scroll position past the end', () => {
    const window_ = computeTreeWindow(10, 99999, 240, 24);
    expect(window_.end).toBe(10);
    expect(window_.start).toBeGreaterThanOrEqual(0);
  });
});

describe('handleTreeKey', () => {
  const rows = flattenTree(tree, new Set(['objects']));

  it('ignores keys it does not handle', () => {
    expect(handleTreeKey(rows, 'objects', 'a')).toBeNull();
    expect(handleTreeKey([], null, 'ArrowDown')).toBeNull();
  });

  it('moves down and up, stopping at the ends', () => {
    expect(handleTreeKey(rows, 'objects', 'ArrowDown')).toEqual({ focusId: 'favourites' });
    expect(handleTreeKey(rows, 'trackData', 'ArrowDown')).toEqual({ focusId: 'trackData' });
    expect(handleTreeKey(rows, 'favourites', 'ArrowUp')).toEqual({ focusId: 'objects' });
    expect(handleTreeKey(rows, 'objects', 'ArrowUp')).toEqual({ focusId: 'objects' });
  });

  it('jumps with Home and End', () => {
    expect(handleTreeKey(rows, 'favourites', 'Home')).toEqual({ focusId: 'objects' });
    expect(handleTreeKey(rows, 'objects', 'End')).toEqual({ focusId: 'trackData' });
  });

  it('expands, then descends, on ArrowRight', () => {
    expect(handleTreeKey(rows, 'enemies', 'ArrowRight')).toEqual({ expandId: 'enemies' });
    expect(handleTreeKey(rows, 'objects', 'ArrowRight')).toEqual({ focusId: 'favourites' });
    expect(handleTreeKey(rows, 'favourites', 'ArrowRight')).toBeNull();
  });

  it('collapses, then goes to the parent, on ArrowLeft', () => {
    expect(handleTreeKey(rows, 'objects', 'ArrowLeft')).toEqual({ collapseId: 'objects' });
    expect(handleTreeKey(rows, 'favourites', 'ArrowLeft')).toEqual({ focusId: 'objects' });
    expect(handleTreeKey(rows, 'trackData', 'ArrowLeft')).toBeNull();
  });

  it('activates with Enter and toggles with Space', () => {
    expect(handleTreeKey(rows, 'favourites', 'Enter')).toEqual({ activateId: 'favourites' });
    expect(handleTreeKey(rows, 'favourites', ' ')).toEqual({ toggleId: 'favourites' });
  });

  it('skips disabled rows when moving', () => {
    const withDisabled = flattenTree(
      [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', disabled: true }, { id: 'c', label: 'C' }],
      new Set(),
    );
    expect(handleTreeKey(withDisabled, 'a', 'ArrowDown')).toEqual({ focusId: 'c' });
    expect(handleTreeKey(withDisabled, 'c', 'ArrowUp')).toEqual({ focusId: 'a' });
  });
});
