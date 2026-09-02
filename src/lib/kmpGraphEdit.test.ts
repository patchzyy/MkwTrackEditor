import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHECKPOINT_WIDTH,
  assignNearestRespawns,
  checkpointCenter,
  checkpointHeadingDegrees,
  createCheckpoint,
  createCheckpointAcross,
  createEnemyPoint,
  createItemPoint,
  editPathGraph,
  getCheckpointGraph,
  getEnemyPathGraph,
  locatePointInFile,
  nearestRespawnIndexForCheckpoint,
  pathGroups,
  pathPointCount,
  renumberKeyCheckpoints,
  reverseGroup,
  setCheckpointGraph,
  setEnemyPathGraph,
  splitGroupAtPoint,
} from './kmpGraph';
import { KMP_NULL_INDEX_8, createEmptyKmpFile, readKmpFile, writeKmpFile, type KmpCheckpoint, type KmpFile } from './kmpFile';

function fileWithCheckpoints(types: number[], respawns: Array<{ x: number; z: number }> = []): KmpFile {
  const checkpoints: KmpCheckpoint[] = types.map((type, index) => ({
    x1: index * 1000 - 500,
    z1: index * 1000,
    x2: index * 1000 + 500,
    z2: index * 1000,
    respawnIndex: KMP_NULL_INDEX_8,
    type,
    prev: KMP_NULL_INDEX_8,
    next: KMP_NULL_INDEX_8,
  }));
  const base = createEmptyKmpFile();
  return setCheckpointGraph(
    {
      ...base,
      respawnPoints: respawns.map((respawn, index) => ({
        position: { x: respawn.x, y: 0, z: respawn.z },
        rotation: { x: 0, y: 0, z: 0 },
        id: index,
        extraUserData: -1,
      })),
    },
    { kind: 'checkpoint', groups: [{ points: checkpoints, prev: [], next: [], linkFlags: 0 }] },
  );
}

describe('path point factories', () => {
  it('gives new enemy and item points a usable default width', () => {
    expect(createEnemyPoint({ x: 1, y: 2, z: 3 }).range).toBeGreaterThan(0);
    expect(createItemPoint({ x: 1, y: 2, z: 3 }).range).toBeGreaterThan(0);
  });

  it('copies the behaviour settings of a template point', () => {
    const template = createEnemyPoint({ x: 0, y: 0, z: 0 });
    template.setting1 = 3;
    template.setting2 = 2;
    template.setting3 = 7;
    template.range = 250;
    const copy = createEnemyPoint({ x: 9, y: 9, z: 9 }, template);
    expect(copy).toMatchObject({ setting1: 3, setting2: 2, setting3: 7, range: 250 });
    expect(copy.position).toEqual({ x: 9, y: 9, z: 9 });
  });

  it('never shares the position object with its caller', () => {
    const position = { x: 1, y: 2, z: 3 };
    const point = createItemPoint(position);
    position.x = 99;
    expect(point.position.x).toBe(1);
  });

  it('creates a checkpoint straight from two endpoints', () => {
    const checkpoint = createCheckpoint({ x: -100, y: 0, z: 5 }, { x: 100, y: 0, z: 5 });
    expect(checkpoint).toMatchObject({ x1: -100, z1: 5, x2: 100, z2: 5, type: KMP_NULL_INDEX_8, respawnIndex: KMP_NULL_INDEX_8 });
  });

  it('round-trips a heading through createCheckpointAcross', () => {
    for (const heading of [0, 45, 90, -30, 179]) {
      const checkpoint = createCheckpointAcross({ x: 500, y: 0, z: -200 }, heading);
      expect(checkpointHeadingDegrees(checkpoint)).toBeCloseTo(heading, 4);
      const center = checkpointCenter(checkpoint, 0);
      expect(center.x).toBeCloseTo(500, 4);
      expect(center.z).toBeCloseTo(-200, 4);
      expect(Math.hypot(checkpoint.x2 - checkpoint.x1, checkpoint.z2 - checkpoint.z1)).toBeCloseTo(DEFAULT_CHECKPOINT_WIDTH, 4);
    }
  });
});

describe('editPathGraph', () => {
  it('routes an edit to the enemy path and writes it back', () => {
    const base = setEnemyPathGraph(createEmptyKmpFile(), {
      kind: 'enemy',
      groups: [{ points: [createEnemyPoint({ x: 0, y: 0, z: 0 }), createEnemyPoint({ x: 100, y: 0, z: 0 }), createEnemyPoint({ x: 200, y: 0, z: 0 })], prev: [], next: [], linkFlags: 0 }],
    });
    const split = editPathGraph(base, 'ENPT', (graph) => splitGroupAtPoint(graph, 0, 1));
    expect(split.enemyGroups).toHaveLength(2);
    expect(split.enemyGroups[0]).toMatchObject({ start: 0, length: 1 });
    expect(split.enemyGroups[1]).toMatchObject({ start: 1, length: 2 });
    expect(split.enemyPoints).toHaveLength(3);
  });

  it('routes an edit to the checkpoint path and regenerates the per-point links', () => {
    const base = fileWithCheckpoints([0, 0xff, 0xff]);
    const reversed = editPathGraph(base, 'CKPT', (graph) => reverseGroup(graph, 0));
    expect(reversed.checkpoints.map((checkpoint) => checkpoint.type)).toEqual([0xff, 0xff, 0]);
    expect(reversed.checkpoints[0].prev).toBe(KMP_NULL_INDEX_8);
    expect(reversed.checkpoints[0].next).toBe(1);
    expect(reversed.checkpoints[2].next).toBe(KMP_NULL_INDEX_8);
  });

  it('reports point counts and groups per section', () => {
    const file = fileWithCheckpoints([0, 0xff]);
    expect(pathPointCount(file, 'CKPT')).toBe(2);
    expect(pathPointCount(file, 'ENPT')).toBe(0);
    expect(pathGroups(file, 'CKPT')).toHaveLength(1);
  });

  it('locates a flat point index inside its group', () => {
    const base = setEnemyPathGraph(createEmptyKmpFile(), {
      kind: 'enemy',
      groups: [
        { points: [createEnemyPoint({ x: 0, y: 0, z: 0 }), createEnemyPoint({ x: 1, y: 0, z: 0 })], prev: [], next: [1], linkFlags: 0 },
        { points: [createEnemyPoint({ x: 2, y: 0, z: 0 })], prev: [0], next: [], linkFlags: 0 },
      ],
    });
    expect(locatePointInFile(base, 'ENPT', 0)).toEqual({ groupIndex: 0, localIndex: 0 });
    expect(locatePointInFile(base, 'ENPT', 2)).toEqual({ groupIndex: 1, localIndex: 0 });
    expect(locatePointInFile(base, 'ENPT', 9)).toBeNull();
  });
});

describe('renumberKeyCheckpoints', () => {
  it('renumbers keys in driving order and leaves ordinary checkpoints alone', () => {
    const file = fileWithCheckpoints([7, 0xff, 3, 0xff, 9]);
    const renumbered = setCheckpointGraph(file, renumberKeyCheckpoints(getCheckpointGraph(file)));
    expect(renumbered.checkpoints.map((checkpoint) => checkpoint.type)).toEqual([0, 0xff, 1, 0xff, 2]);
  });

  it('keeps the lap counter first when it already is', () => {
    const file = fileWithCheckpoints([0, 1, 2]);
    const renumbered = setCheckpointGraph(file, renumberKeyCheckpoints(getCheckpointGraph(file)));
    expect(renumbered.checkpoints.map((checkpoint) => checkpoint.type)).toEqual([0, 1, 2]);
  });

  it('renumbers across groups in group order', () => {
    const base = fileWithCheckpoints([5, 4]);
    const split = editPathGraph(base, 'CKPT', (graph) => splitGroupAtPoint(graph, 0, 1));
    const renumbered = setCheckpointGraph(split, renumberKeyCheckpoints(getCheckpointGraph(split)));
    expect(renumbered.checkpoints.map((checkpoint) => checkpoint.type)).toEqual([0, 1]);
  });

  it('is a no-op when there are no key checkpoints', () => {
    const file = fileWithCheckpoints([0xff, 0xff]);
    const renumbered = setCheckpointGraph(file, renumberKeyCheckpoints(getCheckpointGraph(file)));
    expect(renumbered.checkpoints.map((checkpoint) => checkpoint.type)).toEqual([0xff, 0xff]);
  });
});

describe('respawn assignment', () => {
  it('finds the closest respawn point on the XZ plane', () => {
    const file = fileWithCheckpoints([0, 0xff], [
      { x: 5000, z: 5000 },
      { x: 0, z: 20 },
    ]);
    expect(nearestRespawnIndexForCheckpoint(file, 0)).toBe(1);
  });

  it('returns null when the track has no respawn points', () => {
    expect(nearestRespawnIndexForCheckpoint(fileWithCheckpoints([0]), 0)).toBeNull();
  });

  it('only fills in checkpoints without a usable respawn by default', () => {
    const file = fileWithCheckpoints([0, 0xff], [{ x: 0, z: 0 }]);
    const withOne = { ...file, checkpoints: file.checkpoints.map((checkpoint, index) => (index === 0 ? { ...checkpoint, respawnIndex: 0 } : checkpoint)) };
    const result = assignNearestRespawns(withOne);
    expect(result.changed).toBe(1);
    expect(result.file.checkpoints.map((checkpoint) => checkpoint.respawnIndex)).toEqual([0, 0]);
  });

  it('redoes every checkpoint when asked', () => {
    const file = fileWithCheckpoints([0, 0xff], [
      { x: 9000, z: 9000 },
      { x: 1000, z: 1000 },
    ]);
    const withWrong = { ...file, checkpoints: file.checkpoints.map((checkpoint) => ({ ...checkpoint, respawnIndex: 0 })) };
    const result = assignNearestRespawns(withWrong, { all: true });
    expect(result.changed).toBe(2);
    expect(result.file.checkpoints.map((checkpoint) => checkpoint.respawnIndex)).toEqual([1, 1]);
  });

  it('does nothing when there are no respawn points at all', () => {
    const result = assignNearestRespawns(fileWithCheckpoints([0, 0xff]));
    expect(result.changed).toBe(0);
  });
});

describe('structured writes survive a round trip', () => {
  it('re-reads an edited checkpoint path identically', () => {
    const file = fileWithCheckpoints([0, 0xff, 0xff], [{ x: 0, z: 0 }]);
    const edited = setCheckpointGraph(assignNearestRespawns(file, { all: true }).file, renumberKeyCheckpoints(getCheckpointGraph(file)));
    const reread = readKmpFile(writeKmpFile(edited));
    expect(reread.checkpoints).toHaveLength(3);
    expect(reread.checkpointGroups[0]).toMatchObject({ start: 0, length: 3 });
    expect(reread.checkpoints.map((checkpoint) => checkpoint.type)).toEqual(edited.checkpoints.map((checkpoint) => checkpoint.type));
  });

  it('re-reads an edited enemy path identically', () => {
    const base = setEnemyPathGraph(createEmptyKmpFile(), {
      kind: 'enemy',
      groups: [{ points: [createEnemyPoint({ x: 0, y: 10, z: 0 }), createEnemyPoint({ x: 100, y: 10, z: 0 })], prev: [], next: [], linkFlags: 0 }],
    });
    const split = editPathGraph(base, 'ENPT', (graph) => splitGroupAtPoint(graph, 0, 1));
    const reread = readKmpFile(writeKmpFile(split));
    expect(reread.enemyGroups).toHaveLength(2);
    const rereadGraph = getEnemyPathGraph(reread);
    expect(rereadGraph.groups.map((group) => group.points.length)).toEqual([1, 1]);
    expect(rereadGraph.groups[0].next).toEqual([1]);
    expect(rereadGraph.groups[1].prev).toEqual([0]);
  });
});
