import { describe, expect, it } from 'vitest';
import {
  MAX_GROUP_LINKS,
  addRespawnForCheckpoint,
  appendPoint,
  branchGroup,
  checkpointCenter,
  checkpointHeadingDegrees,
  computeLapPathValidity,
  countPoints,
  createRespawnFromCheckpoint,
  deletePoint,
  deletePointAt,
  getCheckpointGraph,
  getEnemyPathGraph,
  groupStartIndex,
  insertPoint,
  linkGroups,
  locatePoint,
  mergeGroupWithNext,
  reachableGroups,
  readPathGraph,
  removeGroup,
  reverseGraph,
  reverseGroup,
  setCheckpointGraph,
  setEnemyPathGraph,
  splitGroupAtPoint,
  unlinkGroups,
  validatePathGraph,
  writePathGraph,
  type PathGraph,
} from './kmpGraph';
import { createEmptyKmpFile, type KmpCheckpoint, type KmpEnemyPoint, type KmpPathGroup } from './kmpFile';
import { decodeYaz0 } from './yaz0';
import { parseU8 } from './u8';
import { readKmpFile } from './kmpFile';
import { CUSTOM_TRACK_DIR, NINTENDO_TRACK_DIR, listTracks, readTrackBytes } from './realTrackFixtures';

/** A tiny stand-in point so the tests read as "which point is where", not "which struct". */
type P = { n: number };

function graph(groups: Array<{ points: number[]; prev?: number[]; next?: number[] }>): PathGraph<P> {
  return {
    kind: 'enemy',
    groups: groups.map((group) => ({
      points: group.points.map((n) => ({ n })),
      prev: group.prev ?? [],
      next: group.next ?? [],
      linkFlags: 0,
    })),
  };
}

function shape(g: PathGraph<P>): Array<{ points: number[]; prev: number[]; next: number[] }> {
  return g.groups.map((group) => ({ points: group.points.map((p) => p.n), prev: group.prev, next: group.next }));
}

/** Checks that every `next` link has a matching `prev` link and vice versa. */
function linksAreConsistent(g: PathGraph<P>): boolean {
  return g.groups.every((group, index) =>
    group.next.every((link) => g.groups[link]?.prev.includes(index)) && group.prev.every((link) => g.groups[link]?.next.includes(index)),
  );
}

describe('path graph conversion', () => {
  it('slices the flat point array into groups and back', () => {
    const points: P[] = [0, 1, 2, 3, 4].map((n) => ({ n }));
    const groups: KmpPathGroup[] = [
      { start: 0, length: 2, prev: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff], next: [1, 0xff, 0xff, 0xff, 0xff, 0xff], linkFlags: 0 },
      { start: 2, length: 3, prev: [0, 0xff, 0xff, 0xff, 0xff, 0xff], next: [0, 0xff, 0xff, 0xff, 0xff, 0xff], linkFlags: 0 },
    ];
    const g = readPathGraph<P>('enemy', points, groups);
    expect(shape(g)).toEqual([
      { points: [0, 1], prev: [], next: [1] },
      { points: [2, 3, 4], prev: [0], next: [0] },
    ]);

    const flat = writePathGraph(g);
    expect(flat.points.map((p) => p.n)).toEqual([0, 1, 2, 3, 4]);
    expect(flat.groups.map((group) => [group.start, group.length])).toEqual([
      [0, 2],
      [2, 3],
    ]);
  });

  it('drops links that point at groups which do not exist', () => {
    const g = readPathGraph<P>('enemy', [{ n: 0 }], [{ start: 0, length: 1, prev: [7, 0xff], next: [200], linkFlags: 0 }]);
    expect(g.groups[0].prev).toEqual([]);
    expect(g.groups[0].next).toEqual([]);
  });

  it('locates points by their flat index', () => {
    const g = graph([{ points: [0, 1] }, { points: [2, 3, 4] }]);
    expect(locatePoint(g, 0)).toEqual({ groupIndex: 0, localIndex: 0 });
    expect(locatePoint(g, 3)).toEqual({ groupIndex: 1, localIndex: 1 });
    expect(locatePoint(g, 5)).toBeNull();
    expect(groupStartIndex(g, 1)).toBe(2);
    expect(countPoints(g)).toBe(5);
  });
});

describe('splitting and merging groups', () => {
  it('splits a group in two and rewires the links', () => {
    const g = graph([
      { points: [0, 1, 2, 3], prev: [1], next: [1] },
      { points: [4], prev: [0], next: [0] },
    ]);
    const split = splitGroupAtPoint(g, 0, 2);
    expect(shape(split)).toEqual([
      { points: [0, 1], prev: [2], next: [1] },
      { points: [2, 3], prev: [0], next: [2] },
      { points: [4], prev: [1], next: [0] },
    ]);
    expect(linksAreConsistent(split)).toBe(true);
    expect(writePathGraph(split).points.map((p) => p.n)).toEqual([0, 1, 2, 3, 4]);
  });

  it('splits a self-looping group into a two-group loop', () => {
    const g = graph([{ points: [0, 1, 2, 3], prev: [0], next: [0] }]);
    const split = splitGroupAtPoint(g, 0, 2);
    expect(shape(split)).toEqual([
      { points: [0, 1], prev: [1], next: [1] },
      { points: [2, 3], prev: [0], next: [0] },
    ]);
    expect(linksAreConsistent(split)).toBe(true);
  });

  it('refuses to split at the first point or past the end', () => {
    const g = graph([{ points: [0, 1] }]);
    expect(() => splitGroupAtPoint(g, 0, 0)).toThrow(/after the first one/);
    expect(() => splitGroupAtPoint(g, 0, 2)).toThrow(/before the end/);
    expect(() => splitGroupAtPoint(g, 5, 1)).toThrow(/does not exist/);
  });

  it('merges a group with its single successor', () => {
    const g = graph([
      { points: [0, 1], prev: [2], next: [1] },
      { points: [2, 3], prev: [0], next: [2] },
      { points: [4], prev: [1], next: [0] },
    ]);
    const merged = mergeGroupWithNext(g, 0);
    expect(shape(merged)).toEqual([
      { points: [0, 1, 2, 3], prev: [1], next: [1] },
      { points: [4], prev: [0], next: [0] },
    ]);
    expect(linksAreConsistent(merged)).toBe(true);
  });

  it('merging is the inverse of splitting', () => {
    const original = graph([
      { points: [0, 1, 2, 3, 4], prev: [1], next: [1] },
      { points: [5], prev: [0], next: [0] },
    ]);
    for (const at of [1, 2, 3, 4]) {
      expect(shape(mergeGroupWithNext(splitGroupAtPoint(original, 0, at), 0))).toEqual(shape(original));
    }
  });

  it('refuses ambiguous merges', () => {
    const forked = graph([
      { points: [0], next: [1, 2] },
      { points: [1], prev: [0] },
      { points: [2], prev: [0] },
    ]);
    expect(() => mergeGroupWithNext(forked, 0)).toThrow(/exactly one/);

    const joined = graph([
      { points: [0], next: [2] },
      { points: [1], next: [2] },
      { points: [2], prev: [0, 1] },
    ]);
    expect(() => mergeGroupWithNext(joined, 0)).toThrow(/reached from somewhere else/);
  });
});

describe('linking groups', () => {
  it('links and unlinks in both directions', () => {
    const g = graph([{ points: [0] }, { points: [1] }]);
    const linked = linkGroups(g, 0, 1);
    expect(shape(linked)).toEqual([
      { points: [0], prev: [], next: [1] },
      { points: [1], prev: [0], next: [] },
    ]);
    expect(shape(unlinkGroups(linked, 0, 1))).toEqual(shape(g));
  });

  it('allows a group to loop back to itself', () => {
    const looped = linkGroups(graph([{ points: [0, 1] }]), 0, 0);
    expect(shape(looped)).toEqual([{ points: [0, 1], prev: [0], next: [0] }]);
  });

  it('is idempotent and enforces the six-link limit', () => {
    let g = graph([{ points: [0] }, { points: [1] }, { points: [2] }, { points: [3] }, { points: [4] }, { points: [5] }, { points: [6] }, { points: [7] }]);
    for (let i = 1; i <= MAX_GROUP_LINKS; i++) g = linkGroups(g, 0, i);
    expect(g.groups[0].next).toHaveLength(MAX_GROUP_LINKS);
    expect(shape(linkGroups(g, 0, 1))).toEqual(shape(g));
    expect(() => linkGroups(g, 0, 7)).toThrow(/at most 6/);
  });
});

describe('inserting and deleting points', () => {
  it('inserts before and after a point', () => {
    const g = graph([{ points: [0, 1, 2] }]);
    expect(shape(insertPoint(g, 0, 1, { n: 9 }, 'before'))[0].points).toEqual([0, 9, 1, 2]);
    expect(shape(insertPoint(g, 0, 1, { n: 9 }, 'after'))[0].points).toEqual([0, 1, 9, 2]);
    expect(shape(appendPoint(g, 0, { n: 9 }))[0].points).toEqual([0, 1, 2, 9]);
  });

  it('deletes a point and keeps the group', () => {
    const g = graph([{ points: [0, 1, 2] }]);
    expect(shape(deletePoint(g, 0, 1))[0].points).toEqual([0, 2]);
  });

  it('deletes by flat index across groups', () => {
    const g = graph([{ points: [0, 1] }, { points: [2, 3] }]);
    expect(shape(deletePointAt(g, 2))[1].points).toEqual([3]);
    expect(() => deletePointAt(g, 4)).toThrow(/does not exist/);
  });

  it('removes an emptied group and bridges its neighbours', () => {
    const g = graph([
      { points: [0], prev: [2], next: [1] },
      { points: [1], prev: [0], next: [2] },
      { points: [2], prev: [1], next: [0] },
    ]);
    expect(linksAreConsistent(g)).toBe(true);
    const after = deletePoint(g, 1, 0);
    expect(shape(after)).toEqual([
      { points: [0], prev: [1], next: [1] },
      { points: [2], prev: [0], next: [0] },
    ]);
    expect(linksAreConsistent(after)).toBe(true);
  });

  it('collapses a two-group loop into one self-looping group', () => {
    const g = graph([
      { points: [0], prev: [1], next: [1] },
      { points: [1], prev: [0], next: [0] },
    ]);
    const after = removeGroup(g, 1);
    expect(shape(after)).toEqual([{ points: [0], prev: [0], next: [0] }]);
  });

  it('branches a new group off an existing one', () => {
    const g = graph([{ points: [0, 1] }]);
    const branched = branchGroup(g, 0, [{ n: 2 }, { n: 3 }]);
    expect(shape(branched)).toEqual([
      { points: [0, 1], prev: [], next: [1] },
      { points: [2, 3], prev: [0], next: [] },
    ]);
    expect(writePathGraph(branched).points.map((p) => p.n)).toEqual([0, 1, 2, 3]);
  });
});

describe('reversing', () => {
  it('reverses one group and swaps its connections', () => {
    const g = graph([
      { points: [0, 1], next: [1] },
      { points: [2, 3], prev: [0], next: [2] },
      { points: [4], prev: [1] },
    ]);
    const reversed = reverseGroup(g, 1);
    expect(shape(reversed)).toEqual([
      { points: [0, 1], prev: [1], next: [] },
      { points: [3, 2], prev: [2], next: [0] },
      { points: [4], prev: [], next: [1] },
    ]);
    expect(linksAreConsistent(reversed)).toBe(true);
  });

  it('reverses the whole path', () => {
    const g = graph([
      { points: [0, 1], prev: [1], next: [1] },
      { points: [2, 3], prev: [0], next: [0] },
    ]);
    const reversed = reverseGraph(g);
    expect(shape(reversed)).toEqual([
      { points: [1, 0], prev: [1], next: [1] },
      { points: [3, 2], prev: [0], next: [0] },
    ]);
    expect(shape(reverseGraph(reversed))).toEqual(shape(g));
  });
});

describe('path graph validation', () => {
  it('accepts a simple closed loop', () => {
    expect(validatePathGraph(graph([{ points: [0, 1, 2], prev: [0], next: [0] }]))).toEqual([]);
  });

  it('flags orphan groups, dead ends and empty groups', () => {
    const g = graph([
      { points: [0], prev: [0], next: [0] },
      { points: [1] },
      { points: [] },
    ]);
    const codes = validatePathGraph(g).map((issue) => issue.code);
    expect(codes).toContain('path.orphan-group');
    expect(codes).toContain('path.dead-end');
    expect(codes).toContain('path.empty-group');
  });

  it('flags one-sided links', () => {
    const g: PathGraph<P> = graph([{ points: [0], next: [1] }, { points: [1], next: [0] }]);
    const issues = validatePathGraph(g);
    expect(issues.filter((issue) => issue.code === 'path.one-sided-link')).toHaveLength(2);
  });

  it('reports which groups are reachable', () => {
    const g = graph([{ points: [0], next: [1] }, { points: [1], prev: [0] }, { points: [2] }]);
    expect([...reachableGroups(g)].sort()).toEqual([0, 1]);
  });

  it('never puts a raw section code in a message', () => {
    const g = graph([{ points: [0] }, { points: [] }]);
    for (const issue of validatePathGraph(g)) {
      expect(issue.message).not.toMatch(/ENPH|ITPH|CKPH|ENPT|ITPT|CKPT/);
    }
  });
});

describe('lap path validity', () => {
  const checkpoint = (type: number, x = 0): KmpCheckpoint => ({ x1: x - 500, z1: 0, x2: x + 500, z2: 0, respawnIndex: 0, type, prev: 0xff, next: 0xff });

  it('accepts a closed loop with ordered key checkpoints', () => {
    const g: PathGraph<KmpCheckpoint> = {
      kind: 'checkpoint',
      groups: [{ points: [checkpoint(0), checkpoint(0xff), checkpoint(1), checkpoint(0xff), checkpoint(2)], prev: [0], next: [0], linkFlags: 0 }],
    };
    const validity = computeLapPathValidity(g);
    expect(validity.hasLapCounter).toBe(true);
    expect(validity.closedLoop).toBe(true);
    expect(validity.keyCheckpointsInOrder).toBe(true);
    expect(validity.missingKeyCheckpoints).toEqual([]);
    expect(validity.issues).toEqual([]);
  });

  it('reports a missing lap counter', () => {
    const g: PathGraph<KmpCheckpoint> = {
      kind: 'checkpoint',
      groups: [{ points: [checkpoint(1), checkpoint(2)], prev: [0], next: [0], linkFlags: 0 }],
    };
    const validity = computeLapPathValidity(g);
    expect(validity.hasLapCounter).toBe(false);
    expect(validity.issues.map((issue) => issue.code)).toContain('checkpoint.no-lap-counter');
    expect(validity.missingKeyCheckpoints).toEqual([0]);
  });

  it('reports a chain that does not close', () => {
    const g: PathGraph<KmpCheckpoint> = {
      kind: 'checkpoint',
      groups: [
        { points: [checkpoint(0)], prev: [], next: [1], linkFlags: 0 },
        { points: [checkpoint(1)], prev: [0], next: [], linkFlags: 0 },
      ],
    };
    const validity = computeLapPathValidity(g);
    expect(validity.closedLoop).toBe(false);
    expect(validity.issues.map((issue) => issue.code)).toContain('checkpoint.chain-not-closed');
  });

  it('reports gaps and duplicates in the key checkpoint numbering', () => {
    const g: PathGraph<KmpCheckpoint> = {
      kind: 'checkpoint',
      groups: [{ points: [checkpoint(0), checkpoint(1), checkpoint(1), checkpoint(3)], prev: [0], next: [0], linkFlags: 0 }],
    };
    const validity = computeLapPathValidity(g);
    expect(validity.missingKeyCheckpoints).toEqual([2]);
    expect(validity.duplicateKeyCheckpoints).toEqual([1]);
  });

  it('reports key checkpoints numbered out of driving order', () => {
    const g: PathGraph<KmpCheckpoint> = {
      kind: 'checkpoint',
      groups: [{ points: [checkpoint(0), checkpoint(2), checkpoint(1)], prev: [0], next: [0], linkFlags: 0 }],
    };
    expect(computeLapPathValidity(g).keyCheckpointsInOrder).toBe(false);
  });
});

describe('respawn points from checkpoints', () => {
  it('centres the respawn on the checkpoint line and faces the driving direction', () => {
    // Line runs along +X, so the driving direction is -Z, which is yaw 180.
    const checkpoint: KmpCheckpoint = { x1: -100, z1: 50, x2: 100, z2: 50, respawnIndex: 0xff, type: 0xff, prev: 0xff, next: 0xff };
    expect(checkpointCenter(checkpoint, 7)).toEqual({ x: 0, y: 7, z: 50 });
    expect(checkpointHeadingDegrees(checkpoint)).toBeCloseTo(180);

    const respawn = createRespawnFromCheckpoint(checkpoint, { groundY: 100, heightOffset: 300, id: 4 });
    expect(respawn.position).toEqual({ x: 0, y: 400, z: 50 });
    expect(respawn.rotation.y).toBeCloseTo(180);
    expect(respawn.id).toBe(4);
    expect(respawn.extraUserData).toBe(-1);
  });

  it('is perpendicular to the checkpoint line for any orientation', () => {
    for (const angle of [0, 30, 90, 145, 200, 315]) {
      const radians = (angle * Math.PI) / 180;
      const checkpoint: KmpCheckpoint = {
        x1: -Math.cos(radians) * 100,
        z1: -Math.sin(radians) * 100,
        x2: Math.cos(radians) * 100,
        z2: Math.sin(radians) * 100,
        respawnIndex: 0xff,
        type: 0xff,
        prev: 0xff,
        next: 0xff,
      };
      const yaw = (checkpointHeadingDegrees(checkpoint) * Math.PI) / 180;
      const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
      const line = { x: checkpoint.x2 - checkpoint.x1, z: checkpoint.z2 - checkpoint.z1 };
      const dot = (forward.x * line.x + forward.z * line.z) / Math.hypot(line.x, line.z);
      expect(Math.abs(dot)).toBeLessThan(1e-6);
    }
  });

  it('adds a respawn point to the file and links the checkpoint to it', () => {
    const file = createEmptyKmpFile();
    file.checkpoints.push({ x1: -100, z1: 0, x2: 100, z2: 0, respawnIndex: 0xff, type: 0, prev: 0xff, next: 0xff });
    const { file: updated, respawnIndex } = addRespawnForCheckpoint(file, 0, { groundY: 0 });
    expect(respawnIndex).toBe(0);
    expect(updated.respawnPoints).toHaveLength(1);
    expect(updated.checkpoints[0].respawnIndex).toBe(0);
    expect(file.checkpoints[0].respawnIndex).toBe(0xff);
  });
});

describe('KmpFile graph accessors', () => {
  it('regenerates checkpoint prev/next indices when writing back', () => {
    const file = createEmptyKmpFile();
    const g: PathGraph<KmpCheckpoint> = {
      kind: 'checkpoint',
      groups: [
        { points: [0, 1, 2].map(() => ({ x1: 0, z1: 0, x2: 1, z2: 1, respawnIndex: 0, type: 0xff, prev: 9, next: 9 })), prev: [1], next: [1], linkFlags: 0 },
        { points: [{ x1: 0, z1: 0, x2: 1, z2: 1, respawnIndex: 0, type: 0, prev: 9, next: 9 }], prev: [0], next: [0], linkFlags: 0 },
      ],
    };
    const updated = setCheckpointGraph(file, g);
    expect(updated.checkpoints.map((checkpoint) => [checkpoint.prev, checkpoint.next])).toEqual([
      [0xff, 1],
      [0, 2],
      [1, 0xff],
      [0xff, 0xff],
    ]);
    expect(updated.checkpointGroups.map((group) => [group.start, group.length])).toEqual([
      [0, 3],
      [3, 1],
    ]);
  });

  it('round-trips enemy points through the graph', () => {
    const file = createEmptyKmpFile();
    const point = (n: number): KmpEnemyPoint => ({ position: { x: n, y: 0, z: 0 }, range: 10, setting1: 0, setting2: 0, setting3: 0 });
    file.enemyPoints.push(point(0), point(1), point(2));
    file.enemyGroups.push({ start: 0, length: 3, prev: [0], next: [0], linkFlags: 0 });
    const g = getEnemyPathGraph(file);
    expect(g.groups[0].points).toHaveLength(3);
    const back = setEnemyPathGraph(file, g);
    expect(back.enemyPoints).toEqual(file.enemyPoints);
    expect(back.enemyGroups[0].start).toBe(0);
    expect(back.enemyGroups[0].length).toBe(3);
  });
});

const realTracks = [...listTracks(CUSTOM_TRACK_DIR, 20), ...listTracks(NINTENDO_TRACK_DIR, 10)];

describe.runIf(realTracks.length > 0)('path graphs on real tracks', () => {
  it('converts every path section to a graph and back without changing it', () => {
    for (const path of realTracks) {
      const kmpBytes = parseU8(decodeYaz0(readTrackBytes(path))).find((entry) => entry.path.toLowerCase().endsWith('course.kmp'))?.data;
      if (!kmpBytes) continue;
      const file = readKmpFile(kmpBytes);
      for (const [get, points, groups] of [
        [getEnemyPathGraph, 'enemyPoints', 'enemyGroups'],
        [getCheckpointGraph, 'checkpoints', 'checkpointGroups'],
      ] as const) {
        const flat = writePathGraph(get(file) as PathGraph<unknown>);
        expect(flat.points, `${path} ${points}`).toEqual(file[points]);
        expect(
          flat.groups.map((group) => [group.start, group.length]),
          `${path} ${groups}`,
        ).toEqual(file[groups].map((group) => [group.start, group.length]));
      }
    }
  });
});
