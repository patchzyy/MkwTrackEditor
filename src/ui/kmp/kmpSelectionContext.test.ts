import { describe, expect, it } from 'vitest';
import { KMP_NULL_INDEX_8, createEmptyKmpFile, type KmpCheckpoint, type KmpFile } from '../../lib/kmpFile';
import { createEnemyPoint, setCheckpointGraph, setEnemyPathGraph } from '../../lib/kmpGraph';
import { getKmpSelectionContext, summarizeSelection } from './kmpSelectionContext';

function checkpoint(z: number, type = KMP_NULL_INDEX_8, respawnIndex = KMP_NULL_INDEX_8): KmpCheckpoint {
  return { x1: -500, z1: z, x2: 500, z2: z, respawnIndex, type, prev: KMP_NULL_INDEX_8, next: KMP_NULL_INDEX_8 };
}

/** Three enemy groups: 0 forks into 1 and 2, which both come back to nothing. */
function forkedFile(): KmpFile {
  return setEnemyPathGraph(createEmptyKmpFile(), {
    kind: 'enemy',
    groups: [
      { points: [createEnemyPoint({ x: 0, y: 0, z: 0 }), createEnemyPoint({ x: 0, y: 0, z: 100 }), createEnemyPoint({ x: 0, y: 0, z: 200 })], prev: [], next: [1, 2], linkFlags: 0 },
      { points: [createEnemyPoint({ x: -100, y: 0, z: 300 })], prev: [0], next: [], linkFlags: 0 },
      { points: [createEnemyPoint({ x: 100, y: 0, z: 300 })], prev: [0], next: [], linkFlags: 0 },
    ],
  });
}

/** Two groups in a plain line, so the merge rule is satisfied. */
function chainFile(): KmpFile {
  return setEnemyPathGraph(createEmptyKmpFile(), {
    kind: 'enemy',
    groups: [
      { points: [createEnemyPoint({ x: 0, y: 0, z: 0 }), createEnemyPoint({ x: 0, y: 0, z: 100 })], prev: [], next: [1], linkFlags: 0 },
      { points: [createEnemyPoint({ x: 0, y: 0, z: 200 })], prev: [0], next: [], linkFlags: 0 },
    ],
  });
}

describe('KMP selection context', () => {
  it('reports nothing for an empty selection or an unknown id', () => {
    expect(getKmpSelectionContext(null, 'ENPT-0')).toEqual({ path: null, checkpoint: null, route: null });
    expect(getKmpSelectionContext(forkedFile(), null)).toEqual({ path: null, checkpoint: null, route: null });
    expect(getKmpSelectionContext(forkedFile(), 'GOBJ-3')).toEqual({ path: null, checkpoint: null, route: null });
    expect(getKmpSelectionContext(forkedFile(), 'ENPT-99')).toEqual({ path: null, checkpoint: null, route: null });
  });

  it('locates a point inside its group', () => {
    const context = getKmpSelectionContext(forkedFile(), 'ENPT-4');
    expect(context.path).toMatchObject({ section: 'ENPT', groupIndex: 2, localIndex: 0, groupCount: 3, groupSize: 1 });
  });

  it('uses friendly names for each path type, never a section code', () => {
    expect(getKmpSelectionContext(forkedFile(), 'ENPT-0')?.path?.pathLabel).toBe('enemy route');
    const withCheckpoint = setCheckpointGraph(createEmptyKmpFile(), {
      kind: 'checkpoint',
      groups: [{ points: [checkpoint(0, 0), checkpoint(100)], prev: [], next: [], linkFlags: 0 }],
    });
    const context = getKmpSelectionContext(withCheckpoint, 'CKPT-1');
    expect(context.path?.pathLabel).toBe('checkpoint path');
    expect(context.path?.pointLabel).toBe('checkpoint');
  });

  it('only allows a split at a point that is not the first one in its group', () => {
    const file = forkedFile();
    expect(getKmpSelectionContext(file, 'ENPT-0').path?.canSplit).toBe(false);
    expect(getKmpSelectionContext(file, 'ENPT-1').path?.canSplit).toBe(true);
    expect(getKmpSelectionContext(file, 'ENPT-2').path?.canSplit).toBe(true);
    expect(getKmpSelectionContext(file, 'ENPT-3').path?.canSplit).toBe(false);
  });

  it('only allows a merge when the next group is a plain continuation', () => {
    expect(getKmpSelectionContext(chainFile(), 'ENPT-0').path?.canMerge).toBe(true);
    // A fork has two successors, so there is no single group to merge into.
    expect(getKmpSelectionContext(forkedFile(), 'ENPT-0').path?.canMerge).toBe(false);
    // A group with no successor has nothing to merge with.
    expect(getKmpSelectionContext(chainFile(), 'ENPT-2').path?.canMerge).toBe(false);
  });

  it('refuses a merge when the successor is reached from more than one group', () => {
    const file = setEnemyPathGraph(createEmptyKmpFile(), {
      kind: 'enemy',
      groups: [
        { points: [createEnemyPoint({ x: 0, y: 0, z: 0 })], prev: [], next: [2], linkFlags: 0 },
        { points: [createEnemyPoint({ x: 50, y: 0, z: 0 })], prev: [], next: [2], linkFlags: 0 },
        { points: [createEnemyPoint({ x: 100, y: 0, z: 0 })], prev: [0, 1], next: [], linkFlags: 0 },
      ],
    });
    expect(getKmpSelectionContext(file, 'ENPT-0').path?.canMerge).toBe(false);
  });

  it('stops offering new connections once a group has six of them', () => {
    const groups = Array.from({ length: 8 }, (_, index) => ({
      points: [createEnemyPoint({ x: index * 100, y: 0, z: 0 })],
      prev: index === 0 ? [] : [0],
      next: index === 0 ? [1, 2, 3, 4, 5, 6] : [],
      linkFlags: 0,
    }));
    const file = setEnemyPathGraph(createEmptyKmpFile(), { kind: 'enemy', groups });
    expect(getKmpSelectionContext(file, 'ENPT-0').path?.canLink).toBe(false);
    expect(getKmpSelectionContext(file, 'ENPT-7').path?.canLink).toBe(true);
  });

  it('ignores the 0xFF padding in a group record read straight from a file', () => {
    const file = chainFile();
    // A parsed KMP always has six link slots; the empty ones are 0xFF.
    expect(file.enemyGroups[0].next).toEqual([1, 255, 255, 255, 255, 255]);
    const context = getKmpSelectionContext(file, 'ENPT-0');
    expect(context.path?.nextGroups).toEqual([1]);
    expect(context.path?.prevGroups).toEqual([]);
  });

  it('describes a checkpoint as the lap counter, a key or an ordinary one', () => {
    const file = setCheckpointGraph(createEmptyKmpFile(), {
      kind: 'checkpoint',
      groups: [{ points: [checkpoint(0, 0), checkpoint(100, 3, 0), checkpoint(200)], prev: [], next: [], linkFlags: 0 }],
    });
    expect(getKmpSelectionContext(file, 'CKPT-0').checkpoint).toMatchObject({ kind: 'lap', keyNumber: null, respawnIndex: null });
    expect(getKmpSelectionContext(file, 'CKPT-1').checkpoint).toMatchObject({ kind: 'key', keyNumber: 3, respawnIndex: 0 });
    expect(getKmpSelectionContext(file, 'CKPT-2').checkpoint).toMatchObject({ kind: 'normal', keyNumber: null, respawnIndex: null });
  });

  it('reports the route a point belongs to', () => {
    const file: KmpFile = {
      ...createEmptyKmpFile(),
      routes: [{ smooth: 0, forwardBackward: 0, points: [
        { position: { x: 0, y: 0, z: 0 }, setting1: 0, setting2: 0 },
        { position: { x: 100, y: 0, z: 0 }, setting1: 0, setting2: 0 },
      ] }],
    };
    expect(getKmpSelectionContext(file, 'POTI-0-1').route).toEqual({ routeIndex: 0, pointIndex: 1, pointCount: 2 });
    expect(getKmpSelectionContext(file, 'POTI-4-0').route).toBeNull();
  });
});

describe('selection summary', () => {
  it('reports how many sections a multi-selection spans', () => {
    expect(summarizeSelection([])).toEqual({ total: 0, sections: [], allSameSection: false });
    expect(summarizeSelection(['GOBJ-1', 'GOBJ-2'])).toEqual({ total: 2, sections: ['GOBJ'], allSameSection: true });
    expect(summarizeSelection(['GOBJ-1', 'JGPT-0'])).toEqual({ total: 2, sections: ['GOBJ', 'JGPT'], allSameSection: false });
  });
});
