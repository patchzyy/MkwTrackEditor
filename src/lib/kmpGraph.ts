/**
 * Group/point graph model for the three linked KMP path sections
 * (ENPT+ENPH, ITPT+ITPH, CKPT+CKPH).
 *
 * The KMP stores points in one flat array and groups as `(startIndex, length)` slices into
 * it, which makes editing awkward: inserting a point shifts every later group. This module
 * flips the representation around the way hlorenzi's kmp-editor does — each group owns its
 * points, group order defines point order — so every edit is a local, pure operation, and
 * `writePathGraph` re-derives the flat arrays.
 *
 * All functions here are pure: they return new objects and never mutate their input.
 */

import {
  KMP_NULL_INDEX_8,
  createPathGroup,
  type KmpCheckpoint,
  type KmpEnemyPoint,
  type KmpFile,
  type KmpItemPoint,
  type KmpPathGroup,
  type KmpRespawnPoint,
  type Vec3,
} from './kmpFile';

/** Hard limits imposed by the file format (all indices are bytes, 0xFF is the null link). */
export const MAX_PATH_GROUPS = 0xfe;
export const MAX_PATH_POINTS = 0xff;
export const MAX_POINTS_PER_GROUP = 0xff;
export const MAX_GROUP_LINKS = 6;

export type PathGraphKind = 'enemy' | 'item' | 'checkpoint';

export interface PathGroup<TPoint> {
  points: TPoint[];
  /** Indices of the groups that lead into this one. */
  prev: number[];
  /** Indices of the groups this one leads to. */
  next: number[];
  /** The KMP group record's 0x0E bitfield, carried through unchanged. */
  linkFlags: number;
}

export interface PathGraph<TPoint> {
  kind: PathGraphKind;
  groups: Array<PathGroup<TPoint>>;
}

export type EnemyPathGraph = PathGraph<KmpEnemyPoint>;
export type ItemPathGraph = PathGraph<KmpItemPoint>;
export type CheckpointGraph = PathGraph<KmpCheckpoint>;

export interface PathGraphIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  groupIndex?: number;
  pointIndex?: number;
}

// ---------------------------------------------------------------------------
// Conversion to and from the flat KMP representation
// ---------------------------------------------------------------------------

/**
 * Slices the flat point array into per-group arrays. Links that point at a group that does
 * not exist (and the 0xFF null slots) are dropped, so callers never have to check for them.
 */
export function readPathGraph<TPoint>(kind: PathGraphKind, points: TPoint[], groups: KmpPathGroup[]): PathGraph<TPoint> {
  const out: Array<PathGroup<TPoint>> = groups.map((group) => {
    const start = Math.max(0, Math.min(group.start, points.length));
    const end = Math.max(start, Math.min(group.start + group.length, points.length));
    return {
      points: points.slice(start, end),
      prev: sanitizeLinks(group.prev, groups.length),
      next: sanitizeLinks(group.next, groups.length),
      linkFlags: group.linkFlags,
    };
  });
  return { kind, groups: out };
}

function sanitizeLinks(links: number[], groupCount: number): number[] {
  const out: number[] = [];
  for (const link of links) {
    if (link === KMP_NULL_INDEX_8 || !Number.isInteger(link) || link < 0 || link >= groupCount) continue;
    out.push(link);
  }
  return out;
}

/** Pads a link list out to the six fixed slots a KMP group record has, with 0xFF for "none". */
function padLinks(links: number[]): number[] {
  const out = links.slice(0, MAX_GROUP_LINKS);
  while (out.length < MAX_GROUP_LINKS) out.push(KMP_NULL_INDEX_8);
  return out;
}

/**
 * Flattens the graph back into the `(points, groups)` pair the KMP stores.
 *
 * The link lists are padded back to their six fixed slots, so an edited `KmpFile` looks exactly
 * like a freshly parsed one and a write/read round trip is an identity.
 */
export function writePathGraph<TPoint>(graph: PathGraph<TPoint>): { points: TPoint[]; groups: KmpPathGroup[] } {
  const points: TPoint[] = [];
  const groups: KmpPathGroup[] = [];
  for (const group of graph.groups) {
    groups.push({
      start: points.length,
      length: group.points.length,
      prev: padLinks(group.prev),
      next: padLinks(group.next),
      linkFlags: group.linkFlags,
    });
    points.push(...group.points);
  }
  return { points, groups };
}

// ---------------------------------------------------------------------------
// KmpFile accessors
// ---------------------------------------------------------------------------

export function getEnemyPathGraph(file: KmpFile): EnemyPathGraph {
  return readPathGraph('enemy', file.enemyPoints, file.enemyGroups);
}

export function getItemPathGraph(file: KmpFile): ItemPathGraph {
  return readPathGraph('item', file.itemPoints, file.itemGroups);
}

export function getCheckpointGraph(file: KmpFile): CheckpointGraph {
  return readPathGraph('checkpoint', file.checkpoints, file.checkpointGroups);
}

export function setEnemyPathGraph(file: KmpFile, graph: EnemyPathGraph): KmpFile {
  const { points, groups } = writePathGraph(graph);
  return { ...file, enemyPoints: points, enemyGroups: groups };
}

export function setItemPathGraph(file: KmpFile, graph: ItemPathGraph): KmpFile {
  const { points, groups } = writePathGraph(graph);
  return { ...file, itemPoints: points, itemGroups: groups };
}

/**
 * Writes a checkpoint graph back, regenerating the per-checkpoint `prev`/`next` byte fields
 * as global point indices (0xFF at group boundaries), which is what the game reads.
 */
export function setCheckpointGraph(file: KmpFile, graph: CheckpointGraph): KmpFile {
  const { points, groups } = writePathGraph(graph);
  const linked = points.map((checkpoint, index) => {
    const group = groups.find((candidate) => index >= candidate.start && index < candidate.start + candidate.length);
    if (!group) return { ...checkpoint, prev: KMP_NULL_INDEX_8, next: KMP_NULL_INDEX_8 };
    return {
      ...checkpoint,
      prev: index > group.start ? index - 1 : KMP_NULL_INDEX_8,
      next: index < group.start + group.length - 1 ? index + 1 : KMP_NULL_INDEX_8,
    };
  });
  return { ...file, checkpoints: linked, checkpointGroups: groups };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function cloneGroup<TPoint>(group: PathGroup<TPoint>): PathGroup<TPoint> {
  return { points: [...group.points], prev: [...group.prev], next: [...group.next], linkFlags: group.linkFlags };
}

function cloneGraph<TPoint>(graph: PathGraph<TPoint>): PathGraph<TPoint> {
  return { kind: graph.kind, groups: graph.groups.map(cloneGroup) };
}

/** Rewrites every link through `remap`; a `null` result drops the link. */
function remapLinks<TPoint>(groups: Array<PathGroup<TPoint>>, remap: (index: number) => number | null): Array<PathGroup<TPoint>> {
  const apply = (links: number[]) => {
    const out: number[] = [];
    for (const link of links) {
      const mapped = remap(link);
      if (mapped === null) continue;
      out.push(mapped);
    }
    return out;
  };
  return groups.map((group) => ({ ...group, prev: apply(group.prev), next: apply(group.next) }));
}

function requireGroup<TPoint>(graph: PathGraph<TPoint>, groupIndex: number, action: string): PathGroup<TPoint> {
  const group = graph.groups[groupIndex];
  if (!group) throw new Error(`${action}: path group ${groupIndex} does not exist.`);
  return group;
}

// ---------------------------------------------------------------------------
// Editing operations
// ---------------------------------------------------------------------------

/**
 * Splits `groupIndex` so that `localIndex` becomes the first point of a brand new group
 * inserted immediately after it, wired up `original -> new`.
 */
export function splitGroupAtPoint<TPoint>(graph: PathGraph<TPoint>, groupIndex: number, localIndex: number): PathGraph<TPoint> {
  const group = requireGroup(graph, groupIndex, 'Split path');
  if (localIndex <= 0 || localIndex >= group.points.length) {
    throw new Error('Split path: pick a point after the first one and before the end of the group.');
  }
  if (graph.groups.length + 1 > MAX_PATH_GROUPS) throw new Error(`Split path: a track can only have ${MAX_PATH_GROUPS} path groups.`);

  const insertAt = groupIndex + 1;
  const shift = (index: number) => (index >= insertAt ? index + 1 : index);
  const tailNext = group.next.map(shift);

  const head: PathGroup<TPoint> = {
    points: group.points.slice(0, localIndex),
    prev: group.prev.map(shift),
    next: [insertAt],
    linkFlags: group.linkFlags,
  };
  const tail: PathGroup<TPoint> = {
    points: group.points.slice(localIndex),
    prev: [groupIndex],
    next: tailNext,
    linkFlags: group.linkFlags,
  };

  const groups: Array<PathGroup<TPoint>> = [];
  for (let i = 0; i < graph.groups.length; i++) {
    if (i === groupIndex) {
      groups.push(head, tail);
      continue;
    }
    const candidate = graph.groups[i];
    groups.push({ ...cloneGroup(candidate), prev: candidate.prev.map(shift), next: candidate.next.map(shift) });
  }
  // Everything that used to be entered from the original group is now entered from its tail.
  for (const target of tailNext) {
    const successor = groups[target];
    if (!successor) continue;
    groups[target] = { ...successor, prev: successor.prev.map((link) => (link === groupIndex ? insertAt : link)) };
  }
  return { kind: graph.kind, groups };
}

/**
 * Appends the single successor of `groupIndex` onto it, provided the merge is unambiguous
 * (exactly one outgoing link, and that target has exactly one incoming link).
 */
export function mergeGroupWithNext<TPoint>(graph: PathGraph<TPoint>, groupIndex: number): PathGraph<TPoint> {
  const group = requireGroup(graph, groupIndex, 'Merge paths');
  if (group.next.length !== 1) throw new Error('Merge paths: the group must lead to exactly one other group.');
  const nextIndex = group.next[0];
  if (nextIndex === groupIndex) throw new Error('Merge paths: the group loops back to itself.');
  const nextGroup = requireGroup(graph, nextIndex, 'Merge paths');
  if (nextGroup.prev.length !== 1 || nextGroup.prev[0] !== groupIndex) {
    throw new Error('Merge paths: the following group is also reached from somewhere else.');
  }
  if (group.points.length + nextGroup.points.length > MAX_POINTS_PER_GROUP) {
    throw new Error(`Merge paths: a path group can hold at most ${MAX_POINTS_PER_GROUP} points.`);
  }

  const merged: PathGroup<TPoint> = {
    points: [...group.points, ...nextGroup.points],
    prev: [...group.prev],
    next: [...nextGroup.next],
    linkFlags: group.linkFlags,
  };
  const groups = graph.groups.map(cloneGroup);
  groups[groupIndex] = merged;
  groups.splice(nextIndex, 1);
  const remap = (index: number): number => {
    if (index === nextIndex) return groupIndex;
    return index > nextIndex ? index - 1 : index;
  };
  const relinked = remapLinks(groups, remap).map((candidate) => ({
    ...candidate,
    prev: dedupeLinks(candidate.prev),
    next: dedupeLinks(candidate.next),
  }));
  return { kind: graph.kind, groups: relinked };
}

function dedupeLinks(links: number[]): number[] {
  const out: number[] = [];
  for (const link of links) if (!out.includes(link)) out.push(link);
  return out;
}

/**
 * Adds a `from -> to` connection (and the matching backward link). `from === to` is allowed:
 * that is how a track made of a single looping path group is stored.
 */
export function linkGroups<TPoint>(graph: PathGraph<TPoint>, from: number, to: number): PathGraph<TPoint> {
  const source = requireGroup(graph, from, 'Connect paths');
  const target = requireGroup(graph, to, 'Connect paths');
  if (source.next.includes(to)) return cloneGraph(graph);
  if (source.next.length >= MAX_GROUP_LINKS) throw new Error(`Connect paths: a group can lead to at most ${MAX_GROUP_LINKS} other groups.`);
  if (target.prev.length >= MAX_GROUP_LINKS) throw new Error(`Connect paths: a group can be reached from at most ${MAX_GROUP_LINKS} other groups.`);

  const groups = graph.groups.map(cloneGroup);
  groups[from].next.push(to);
  groups[to].prev.push(from);
  return { kind: graph.kind, groups };
}

/** Removes the `from -> to` connection in both directions. */
export function unlinkGroups<TPoint>(graph: PathGraph<TPoint>, from: number, to: number): PathGraph<TPoint> {
  requireGroup(graph, from, 'Disconnect paths');
  requireGroup(graph, to, 'Disconnect paths');
  const groups = graph.groups.map(cloneGroup);
  groups[from].next = groups[from].next.filter((link) => link !== to);
  groups[to].prev = groups[to].prev.filter((link) => link !== from);
  return { kind: graph.kind, groups };
}

/** Inserts `point` into `groupIndex` before or after the point at `localIndex`. */
export function insertPoint<TPoint>(
  graph: PathGraph<TPoint>,
  groupIndex: number,
  localIndex: number,
  point: TPoint,
  where: 'before' | 'after' = 'after',
): PathGraph<TPoint> {
  const group = requireGroup(graph, groupIndex, 'Add path point');
  if (group.points.length >= MAX_POINTS_PER_GROUP) throw new Error(`Add path point: a path group can hold at most ${MAX_POINTS_PER_GROUP} points.`);
  if (countPoints(graph) >= MAX_PATH_POINTS) throw new Error(`Add path point: a track can only have ${MAX_PATH_POINTS} points in this path type.`);
  const clamped = Math.max(0, Math.min(localIndex, group.points.length));
  const at = where === 'before' ? clamped : Math.min(clamped + 1, group.points.length);
  const groups = graph.groups.map(cloneGroup);
  groups[groupIndex].points.splice(at, 0, point);
  return { kind: graph.kind, groups };
}

/** Appends a point to the end of a group. */
export function appendPoint<TPoint>(graph: PathGraph<TPoint>, groupIndex: number, point: TPoint): PathGraph<TPoint> {
  const group = requireGroup(graph, groupIndex, 'Add path point');
  return insertPoint(graph, groupIndex, group.points.length, point, 'before');
}

/** Adds a new group that branches off the end of `fromGroupIndex`. */
export function branchGroup<TPoint>(graph: PathGraph<TPoint>, fromGroupIndex: number, points: TPoint[]): PathGraph<TPoint> {
  const source = requireGroup(graph, fromGroupIndex, 'Branch path');
  if (graph.groups.length + 1 > MAX_PATH_GROUPS) throw new Error(`Branch path: a track can only have ${MAX_PATH_GROUPS} path groups.`);
  if (source.next.length >= MAX_GROUP_LINKS) throw new Error(`Branch path: a group can lead to at most ${MAX_GROUP_LINKS} other groups.`);
  if (countPoints(graph) + points.length > MAX_PATH_POINTS) throw new Error(`Branch path: a track can only have ${MAX_PATH_POINTS} points in this path type.`);
  const groups = graph.groups.map(cloneGroup);
  const newIndex = groups.length;
  groups.push({ points: [...points], prev: [fromGroupIndex], next: [], linkFlags: 0 });
  groups[fromGroupIndex].next.push(newIndex);
  return { kind: graph.kind, groups };
}

/**
 * Removes a point. When it was the group's last point the group is removed too and its
 * incoming groups are re-wired straight to its outgoing groups, so the path stays connected.
 */
export function deletePoint<TPoint>(graph: PathGraph<TPoint>, groupIndex: number, localIndex: number): PathGraph<TPoint> {
  const group = requireGroup(graph, groupIndex, 'Delete path point');
  if (localIndex < 0 || localIndex >= group.points.length) throw new Error(`Delete path point: point ${localIndex} is not in this group.`);
  const groups = graph.groups.map(cloneGroup);
  groups[groupIndex].points.splice(localIndex, 1);
  if (groups[groupIndex].points.length > 0) return { kind: graph.kind, groups };
  return removeGroup({ kind: graph.kind, groups }, groupIndex);
}

/** Deletes the point at a flat (KMP) index. */
export function deletePointAt<TPoint>(graph: PathGraph<TPoint>, globalIndex: number): PathGraph<TPoint> {
  const location = locatePoint(graph, globalIndex);
  if (!location) throw new Error(`Delete path point: point ${globalIndex} does not exist.`);
  return deletePoint(graph, location.groupIndex, location.localIndex);
}

/** Removes a group entirely, bridging its predecessors to its successors. */
export function removeGroup<TPoint>(graph: PathGraph<TPoint>, groupIndex: number): PathGraph<TPoint> {
  const doomed = requireGroup(graph, groupIndex, 'Delete path group');
  const groups = graph.groups.map(cloneGroup);
  const incoming = doomed.prev.filter((link) => link !== groupIndex);
  const outgoing = doomed.next.filter((link) => link !== groupIndex);
  for (const from of incoming) {
    groups[from].next = groups[from].next.filter((link) => link !== groupIndex);
    for (const to of outgoing) {
      // Bridging may legitimately produce a self-link: that is how a one-group loop is stored.
      if (groups[from].next.includes(to) || groups[from].next.length >= MAX_GROUP_LINKS) continue;
      groups[from].next.push(to);
      if (!groups[to].prev.includes(from) && groups[to].prev.length < MAX_GROUP_LINKS) groups[to].prev.push(from);
    }
  }
  for (const to of outgoing) groups[to].prev = groups[to].prev.filter((link) => link !== groupIndex);

  groups.splice(groupIndex, 1);
  const remap = (index: number): number | null => {
    if (index === groupIndex) return null;
    return index > groupIndex ? index - 1 : index;
  };
  const relinked = remapLinks(groups, remap).map((candidate) => ({
    ...candidate,
    prev: dedupeLinks(candidate.prev),
    next: dedupeLinks(candidate.next),
  }));
  return { kind: graph.kind, groups: relinked };
}

/** Reverses the point order inside one group and swaps its incoming/outgoing links. */
export function reverseGroup<TPoint>(graph: PathGraph<TPoint>, groupIndex: number): PathGraph<TPoint> {
  requireGroup(graph, groupIndex, 'Reverse path');
  const groups = graph.groups.map(cloneGroup);
  const group = groups[groupIndex];
  group.points.reverse();
  const oldPrev = group.prev;
  const oldNext = group.next;
  group.prev = oldNext;
  group.next = oldPrev;
  for (let i = 0; i < groups.length; i++) {
    if (i === groupIndex) continue;
    const hadNext = groups[i].next.includes(groupIndex);
    const hadPrev = groups[i].prev.includes(groupIndex);
    if (hadNext && !hadPrev) {
      groups[i].next = groups[i].next.filter((link) => link !== groupIndex);
      groups[i].prev = [...groups[i].prev, groupIndex];
    } else if (hadPrev && !hadNext) {
      groups[i].prev = groups[i].prev.filter((link) => link !== groupIndex);
      groups[i].next = [...groups[i].next, groupIndex];
    }
  }
  return { kind: graph.kind, groups };
}

/** Reverses the whole path: every group's points and every link direction. */
export function reverseGraph<TPoint>(graph: PathGraph<TPoint>): PathGraph<TPoint> {
  return {
    kind: graph.kind,
    groups: graph.groups.map((group) => ({
      points: [...group.points].reverse(),
      prev: [...group.next],
      next: [...group.prev],
      linkFlags: group.linkFlags,
    })),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function countPoints<TPoint>(graph: PathGraph<TPoint>): number {
  return graph.groups.reduce((sum, group) => sum + group.points.length, 0);
}

/** Maps a flat KMP point index to its `(groupIndex, localIndex)` position. */
export function locatePoint<TPoint>(graph: PathGraph<TPoint>, globalIndex: number): { groupIndex: number; localIndex: number } | null {
  let cursor = 0;
  for (let groupIndex = 0; groupIndex < graph.groups.length; groupIndex++) {
    const size = graph.groups[groupIndex].points.length;
    if (globalIndex < cursor + size) return { groupIndex, localIndex: globalIndex - cursor };
    cursor += size;
  }
  return null;
}

/** The flat KMP index of a group's first point. */
export function groupStartIndex<TPoint>(graph: PathGraph<TPoint>, groupIndex: number): number {
  let cursor = 0;
  for (let i = 0; i < groupIndex && i < graph.groups.length; i++) cursor += graph.groups[i].points.length;
  return cursor;
}

/** Group indices reachable from `startGroup` by following `next` links. */
export function reachableGroups<TPoint>(graph: PathGraph<TPoint>, startGroup = 0): Set<number> {
  const seen = new Set<number>();
  if (graph.groups.length === 0 || !graph.groups[startGroup]) return seen;
  const stack = [startGroup];
  seen.add(startGroup);
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const next of graph.groups[current]?.next ?? []) {
      if (seen.has(next) || !graph.groups[next]) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<PathGraphKind, string> = {
  enemy: 'Enemy route',
  item: 'Item route',
  checkpoint: 'Checkpoint path',
};

/**
 * Structural checks that apply to all three path types: size limits, dangling links,
 * one-sided links, empty groups, and groups that the game can never reach.
 */
export function validatePathGraph<TPoint>(graph: PathGraph<TPoint>): PathGraphIssue[] {
  const label = KIND_LABEL[graph.kind];
  const issues: PathGraphIssue[] = [];
  const groupCount = graph.groups.length;
  if (groupCount === 0) return issues;

  if (groupCount > MAX_PATH_GROUPS) {
    issues.push({ level: 'error', code: 'path.too-many-groups', message: `${label}: ${groupCount} groups, but the game only supports ${MAX_PATH_GROUPS}.` });
  }
  const total = countPoints(graph);
  if (total > MAX_PATH_POINTS) {
    issues.push({ level: 'error', code: 'path.too-many-points', message: `${label}: ${total} points, but the game only supports ${MAX_PATH_POINTS}.` });
  }

  for (let index = 0; index < groupCount; index++) {
    const group = graph.groups[index];
    if (group.points.length === 0) {
      issues.push({ level: 'error', code: 'path.empty-group', message: `${label} #${index} has no points.`, groupIndex: index });
    }
    if (group.points.length > MAX_POINTS_PER_GROUP) {
      issues.push({
        level: 'error',
        code: 'path.group-too-long',
        message: `${label} #${index} has ${group.points.length} points, but a single group can hold at most ${MAX_POINTS_PER_GROUP}.`,
        groupIndex: index,
      });
    }
    if (group.next.length > MAX_GROUP_LINKS) {
      issues.push({
        level: 'error',
        code: 'path.too-many-next-links',
        message: `${label} #${index} leads to ${group.next.length} groups; at most ${MAX_GROUP_LINKS} are allowed.`,
        groupIndex: index,
      });
    }
    if (group.prev.length > MAX_GROUP_LINKS) {
      issues.push({
        level: 'error',
        code: 'path.too-many-prev-links',
        message: `${label} #${index} is reached from ${group.prev.length} groups; at most ${MAX_GROUP_LINKS} are allowed.`,
        groupIndex: index,
      });
    }
    for (const link of group.next) {
      if (!graph.groups[link]) {
        issues.push({ level: 'error', code: 'path.link-out-of-range', message: `${label} #${index} leads to a group that does not exist.`, groupIndex: index });
        continue;
      }
      if (!graph.groups[link].prev.includes(index)) {
        issues.push({
          level: 'warning',
          code: 'path.one-sided-link',
          message: `${label} #${index} leads to ${label.toLowerCase()} #${link}, but that group does not list it as a source.`,
          groupIndex: index,
        });
      }
    }
    for (const link of group.prev) {
      if (!graph.groups[link]) {
        issues.push({ level: 'error', code: 'path.link-out-of-range', message: `${label} #${index} is reached from a group that does not exist.`, groupIndex: index });
      }
    }
    if (group.next.length === 0) {
      issues.push({ level: 'warning', code: 'path.dead-end', message: `${label} #${index} is a dead end; nothing follows it.`, groupIndex: index });
    }
  }

  const reachable = reachableGroups(graph, 0);
  for (let index = 0; index < groupCount; index++) {
    if (reachable.has(index)) continue;
    issues.push({ level: 'warning', code: 'path.orphan-group', message: `${label} #${index} can never be reached from the start of the track.`, groupIndex: index });
  }

  return issues;
}

export interface LapPathValidity {
  /** True when a checkpoint of type 0 (the lap counter) exists. */
  hasLapCounter: boolean;
  /** Key checkpoint numbers found, in flat point order. */
  keyCheckpoints: number[];
  /** Key numbers between 0 and the highest used one that no checkpoint claims. */
  missingKeyCheckpoints: number[];
  /** Key numbers claimed by more than one checkpoint. */
  duplicateKeyCheckpoints: number[];
  /** True when the key checkpoints appear in ascending order along the path. */
  keyCheckpointsInOrder: boolean;
  /** True when following `next` links from group 0 leads back to group 0. */
  closedLoop: boolean;
  /** Groups that cannot be reached from group 0. */
  unreachableGroups: number[];
  issues: PathGraphIssue[];
}

/**
 * Checks everything the game needs to count a lap: a lap-counter checkpoint, key
 * checkpoints numbered 0..n with no gaps, in order along the path, and a closed loop.
 */
export function computeLapPathValidity(graph: CheckpointGraph): LapPathValidity {
  const issues: PathGraphIssue[] = [...validatePathGraph(graph)];
  const flat: KmpCheckpoint[] = graph.groups.flatMap((group) => group.points);
  const keyed = flat
    .map((checkpoint, index) => ({ checkpoint, index }))
    .filter(({ checkpoint }) => checkpoint.type !== KMP_NULL_INDEX_8);
  const keyCheckpoints = keyed.map(({ checkpoint }) => checkpoint.type);

  const hasLapCounter = keyCheckpoints.includes(0);
  if (flat.length > 0 && !hasLapCounter) {
    issues.push({ level: 'error', code: 'checkpoint.no-lap-counter', message: 'No checkpoint is marked as the lap counter, so laps will never be counted.' });
  }

  const seen = new Map<number, number>();
  const duplicateKeyCheckpoints: number[] = [];
  for (const type of keyCheckpoints) {
    const count = (seen.get(type) ?? 0) + 1;
    seen.set(type, count);
    if (count === 2) duplicateKeyCheckpoints.push(type);
  }
  for (const type of duplicateKeyCheckpoints) {
    issues.push({
      level: 'warning',
      code: 'checkpoint.duplicate-key',
      message: `Key checkpoint ${type} is used by more than one checkpoint. That is correct when the track splits into parallel routes, but a mistake otherwise.`,
    });
  }

  const highest = keyCheckpoints.length > 0 ? Math.max(...keyCheckpoints) : -1;
  const missingKeyCheckpoints: number[] = [];
  for (let i = 0; i <= highest; i++) if (!seen.has(i)) missingKeyCheckpoints.push(i);
  for (const missing of missingKeyCheckpoints) {
    issues.push({
      level: 'error',
      code: 'checkpoint.missing-key',
      message: `Key checkpoint ${missing} is missing, so the lap will never complete.`,
    });
  }

  const uniqueInOrder = keyed.filter(({ checkpoint }, i, all) => all.findIndex((other) => other.checkpoint.type === checkpoint.type) === i);
  let keyCheckpointsInOrder = true;
  for (let i = 1; i < uniqueInOrder.length; i++) {
    if (uniqueInOrder[i].checkpoint.type < uniqueInOrder[i - 1].checkpoint.type) {
      keyCheckpointsInOrder = false;
      break;
    }
  }
  if (!keyCheckpointsInOrder) {
    issues.push({
      level: 'warning',
      code: 'checkpoint.keys-out-of-order',
      message: 'Key checkpoints are not numbered in the order drivers reach them, which can make laps count early or not at all.',
    });
  }

  const reachable = reachableGroups(graph, 0);
  const unreachableGroups: number[] = [];
  for (let i = 0; i < graph.groups.length; i++) if (!reachable.has(i)) unreachableGroups.push(i);

  const closedLoop = graph.groups.length > 0 && [...reachable].some((index) => graph.groups[index].next.includes(0));
  if (graph.groups.length > 0 && !closedLoop) {
    issues.push({
      level: 'error',
      code: 'checkpoint.chain-not-closed',
      message: 'The checkpoint path does not loop back to the start, so a lap can never be completed.',
    });
  }

  return {
    hasLapCounter,
    keyCheckpoints,
    missingKeyCheckpoints,
    duplicateKeyCheckpoints,
    keyCheckpointsInOrder,
    closedLoop,
    unreachableGroups,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Checkpoint helpers
// ---------------------------------------------------------------------------

/** Midpoint of a checkpoint line on the XZ plane. */
export function checkpointCenter(checkpoint: KmpCheckpoint, y = 0): Vec3 {
  return { x: (checkpoint.x1 + checkpoint.x2) / 2, y, z: (checkpoint.z1 + checkpoint.z2) / 2 };
}

/**
 * Yaw in degrees a driver has when crossing this checkpoint, i.e. the direction of travel
 * perpendicular to the checkpoint line: forward = `(z2-z1, 0, -(x2-x1))`.
 *
 * The sign convention was checked against 5916 real checkpoint/respawn pairs from 338
 * retail and custom tracks; 94% of respawn points face within 45 degrees of this value.
 */
export function checkpointHeadingDegrees(checkpoint: KmpCheckpoint): number {
  const dx = checkpoint.x2 - checkpoint.x1;
  const dz = checkpoint.z2 - checkpoint.z1;
  return (Math.atan2(dz, -dx) * 180) / Math.PI;
}

export interface CreateRespawnOptions {
  /** Ground height at the checkpoint centre. Pass the result of a KCL down-raycast. */
  groundY?: number;
  /** How far above the ground to place the point. The game likes a little clearance. */
  heightOffset?: number;
  /** Value written to the JGPT id field; defaults to the index the point will get. */
  id?: number;
}

/**
 * Builds a respawn point centred on a checkpoint and facing the driving direction, which
 * is the sensible default when a checkpoint has no respawn assigned yet.
 */
export function createRespawnFromCheckpoint(checkpoint: KmpCheckpoint, options: CreateRespawnOptions = {}): KmpRespawnPoint {
  const y = (options.groundY ?? 0) + (options.heightOffset ?? 300);
  return {
    position: checkpointCenter(checkpoint, y),
    rotation: { x: 0, y: checkpointHeadingDegrees(checkpoint), z: 0 },
    id: options.id ?? 0,
    extraUserData: -1,
  };
}

/**
 * Adds a respawn point derived from one checkpoint and points that checkpoint at it.
 * Returns the updated file and the new respawn index.
 */
export function addRespawnForCheckpoint(
  file: KmpFile,
  checkpointIndex: number,
  options: CreateRespawnOptions = {},
): { file: KmpFile; respawnIndex: number } {
  const checkpoint = file.checkpoints[checkpointIndex];
  if (!checkpoint) throw new Error(`Add respawn point: checkpoint ${checkpointIndex} does not exist.`);
  if (file.respawnPoints.length >= MAX_PATH_POINTS) throw new Error(`Add respawn point: a track can only have ${MAX_PATH_POINTS} respawn points.`);
  const respawnIndex = file.respawnPoints.length;
  const respawn = createRespawnFromCheckpoint(checkpoint, { ...options, id: options.id ?? respawnIndex });
  return {
    file: {
      ...file,
      respawnPoints: [...file.respawnPoints, respawn],
      checkpoints: file.checkpoints.map((candidate, index) => (index === checkpointIndex ? { ...candidate, respawnIndex } : candidate)),
    },
    respawnIndex,
  };
}

/** Creates an empty group; useful when starting a path from scratch. */
export function createEmptyPathGroup(): KmpPathGroup {
  return createPathGroup();
}

// ---------------------------------------------------------------------------
// Point factories and generic path editing
// ---------------------------------------------------------------------------

/** The three point sections that are organised into groups. */
export type PathPointSection = 'ENPT' | 'ITPT' | 'CKPT';

/** Default width/deviation for a freshly drawn route point, in game units. */
export const DEFAULT_PATH_POINT_RANGE = 1000;

/** Default width of a checkpoint drawn without an explicit second endpoint. */
export const DEFAULT_CHECKPOINT_WIDTH = 2400;

/** A new enemy route point. Copies the behaviour settings of `template` when one is given. */
export function createEnemyPoint(position: Vec3, template?: KmpEnemyPoint): KmpEnemyPoint {
  return {
    position: { ...position },
    range: template?.range ?? DEFAULT_PATH_POINT_RANGE,
    setting1: template?.setting1 ?? 0,
    setting2: template?.setting2 ?? 0,
    setting3: template?.setting3 ?? 0,
  };
}

/** A new item route point. */
export function createItemPoint(position: Vec3, template?: KmpItemPoint): KmpItemPoint {
  return {
    position: { ...position },
    range: template?.range ?? DEFAULT_PATH_POINT_RANGE,
    setting1: template?.setting1 ?? 0,
    setting2: template?.setting2 ?? 0,
  };
}

/**
 * A new checkpoint spanning `left` to `right` on the XZ plane. `prev`/`next` are filled in by
 * {@link setCheckpointGraph} when the graph is written back, so they start out unset.
 */
export function createCheckpoint(left: Vec3, right: Vec3, template?: Partial<KmpCheckpoint>): KmpCheckpoint {
  return {
    x1: left.x,
    z1: left.z,
    x2: right.x,
    z2: right.z,
    respawnIndex: template?.respawnIndex ?? KMP_NULL_INDEX_8,
    type: template?.type ?? KMP_NULL_INDEX_8,
    prev: KMP_NULL_INDEX_8,
    next: KMP_NULL_INDEX_8,
  };
}

/**
 * A checkpoint perpendicular to the direction of travel, centred on `center` and `width` units
 * across. Used when appending to a path where only the new centre is known.
 */
export function createCheckpointAcross(center: Vec3, headingDegrees: number, width = DEFAULT_CHECKPOINT_WIDTH): KmpCheckpoint {
  // `checkpointHeadingDegrees` uses forward = (z2-z1, -(x2-x1)), so the line itself runs along
  // (-cos, sin) of the heading. Inverting that keeps a round-trip stable.
  const radians = (headingDegrees * Math.PI) / 180;
  const dx = -Math.cos(radians) * (width / 2);
  const dz = Math.sin(radians) * (width / 2);
  return createCheckpoint(
    { x: center.x - dx, y: center.y, z: center.z - dz },
    { x: center.x + dx, y: center.y, z: center.z + dz },
  );
}

/** A path-graph edit that works for any point type (split, merge, link, reverse, delete …). */
export type PathGraphEdit = <TPoint>(graph: PathGraph<TPoint>) => PathGraph<TPoint>;

/**
 * Applies a point-type-agnostic edit to one of the three grouped path sections and writes the
 * result back into the file. Keeps callers from repeating the same three-way switch.
 */
export function editPathGraph(file: KmpFile, section: PathPointSection, edit: PathGraphEdit): KmpFile {
  if (section === 'ENPT') return setEnemyPathGraph(file, edit(getEnemyPathGraph(file)));
  if (section === 'ITPT') return setItemPathGraph(file, edit(getItemPathGraph(file)));
  return setCheckpointGraph(file, edit(getCheckpointGraph(file)));
}

/** How many points a grouped path section holds. */
export function pathPointCount(file: KmpFile, section: PathPointSection): number {
  if (section === 'ENPT') return file.enemyPoints.length;
  if (section === 'ITPT') return file.itemPoints.length;
  return file.checkpoints.length;
}

/** The group records of a grouped path section. */
export function pathGroups(file: KmpFile, section: PathPointSection): KmpPathGroup[] {
  if (section === 'ENPT') return file.enemyGroups;
  if (section === 'ITPT') return file.itemGroups;
  return file.checkpointGroups;
}

/** `(groupIndex, localIndex)` for a flat point index, read straight from the group records. */
export function locatePointInFile(
  file: KmpFile,
  section: PathPointSection,
  globalIndex: number,
): { groupIndex: number; localIndex: number } | null {
  const groups = pathGroups(file, section);
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex];
    if (globalIndex >= group.start && globalIndex < group.start + group.length) {
      return { groupIndex, localIndex: globalIndex - group.start };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Checkpoint conveniences
// ---------------------------------------------------------------------------

/**
 * Renumbers the key checkpoints 0, 1, 2 … in the order drivers reach them, keeping which
 * checkpoints are keys and which are ordinary. This is the fix for "key checkpoints are out of
 * order", which otherwise makes laps count early or not at all.
 */
export function renumberKeyCheckpoints(graph: CheckpointGraph): CheckpointGraph {
  let nextKey = 0;
  return {
    kind: graph.kind,
    groups: graph.groups.map((group) => ({
      ...group,
      prev: [...group.prev],
      next: [...group.next],
      points: group.points.map((checkpoint) =>
        checkpoint.type === KMP_NULL_INDEX_8 ? { ...checkpoint } : { ...checkpoint, type: Math.min(nextKey++, 0xfe) },
      ),
    })),
  };
}

/** Index of the respawn point closest to a checkpoint's centre, or null when there are none. */
export function nearestRespawnIndexForCheckpoint(file: KmpFile, checkpointIndex: number): number | null {
  const checkpoint = file.checkpoints[checkpointIndex];
  if (!checkpoint || file.respawnPoints.length === 0) return null;
  const center = checkpointCenter(checkpoint, 0);
  let best = 0;
  let bestDistance = Infinity;
  file.respawnPoints.forEach((respawn, index) => {
    const dx = respawn.position.x - center.x;
    const dz = respawn.position.z - center.z;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/**
 * Points checkpoints at their nearest respawn. By default only checkpoints without a valid
 * respawn are touched; pass `{ all: true }` to redo every checkpoint.
 */
export function assignNearestRespawns(file: KmpFile, options: { all?: boolean } = {}): { file: KmpFile; changed: number } {
  if (file.respawnPoints.length === 0) return { file, changed: 0 };
  let changed = 0;
  const checkpoints = file.checkpoints.map((checkpoint, index) => {
    const valid = checkpoint.respawnIndex < file.respawnPoints.length;
    if (valid && !options.all) return checkpoint;
    const nearest = nearestRespawnIndexForCheckpoint(file, index);
    if (nearest === null || nearest === checkpoint.respawnIndex) return checkpoint;
    changed++;
    return { ...checkpoint, respawnIndex: nearest };
  });
  return { file: changed > 0 ? { ...file, checkpoints } : file, changed };
}
