import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { raycastDown } from '../../lib/kcl';
import {
  KMP_NULL_INDEX_8,
  KMP_NULL_INDEX_16,
  createStageInfo,
  writeKmpFile,
  type KmpFile,
  type KmpStageInfo,
  type Vec3,
} from '../../lib/kmpFile';
import {
  addRespawnForCheckpoint,
  MAX_PATH_POINTS,
  assignNearestRespawns,
  branchGroup,
  checkpointCenter,
  checkpointHeadingDegrees,
  createCheckpoint,
  createCheckpointAcross,
  createEnemyPoint,
  createItemPoint,
  deletePoint,
  editPathGraph,
  getCheckpointGraph,
  getEnemyPathGraph,
  getItemPathGraph,
  insertPoint,
  linkGroups,
  locatePointInFile,
  mergeGroupWithNext,
  nearestRespawnIndexForCheckpoint,
  pathGroups,
  removeGroup,
  renumberKeyCheckpoints,
  reverseGraph,
  reverseGroup,
  setCheckpointGraph,
  setEnemyPathGraph,
  setItemPathGraph,
  splitGroupAtPoint,
  unlinkGroups,
  type PathPointSection,
} from '../../lib/kmpGraph';
import { replaceCourseKmp, type TrackDocument } from '../../lib/track';
import type { EditorHistory } from '../state/useEditorHistory';
import type { EditorSelection } from '../state/useSelection';

export type KmpGraphActions = ReturnType<typeof useKmpGraphActions>;

/** Friendly names for the three grouped path sections; never shown as section codes. */
const PATH_LABEL: Record<PathPointSection, string> = {
  ENPT: 'enemy route',
  ITPT: 'item route',
  CKPT: 'checkpoint path',
};

const POINT_LABEL: Record<PathPointSection, string> = {
  ENPT: 'enemy route point',
  ITPT: 'item route point',
  CKPT: 'checkpoint',
};

function groupStartInFile(file: KmpFile, section: PathPointSection, groupIndex: number): number {
  return pathGroups(file, section)[groupIndex]?.start ?? 0;
}

/**
 * Every path-graph, checkpoint and track-settings edit, written through the structured
 * `KmpFile` model instead of byte patching.
 *
 * All of them follow the same shape: read `track.kmpFile`, apply a pure `kmpGraph` operation,
 * serialise with `writeKmpFile`, and hand the bytes to `replaceCourseKmp`, which re-parses both
 * the structured and the legacy views so the rest of the editor stays in sync.
 */
export function useKmpGraphActions({
  track,
  trackRef,
  history,
  selection,
  setStatus,
}: {
  track: TrackDocument | null;
  trackRef: MutableRefObject<TrackDocument | null>;
  history: EditorHistory;
  selection: EditorSelection;
  setStatus: Dispatch<SetStateAction<string>>;
}) {
  /** Serialises a new `KmpFile` and pushes it through history. Returns the new track document. */
  function commit(
    nextFile: KmpFile,
    options: { status?: string; selectedId?: string | null; selectedIds?: string[] } = {},
  ): TrackDocument | null {
    const currentTrack = trackRef.current ?? track;
    if (!currentTrack) return null;
    const nextTrack = replaceCourseKmp(currentTrack, writeKmpFile(nextFile));
    const selectedId = options.selectedId !== undefined ? options.selectedId : selection.selectedIdRef.current;
    const selectedIds = options.selectedIds ?? (options.selectedId !== undefined ? (options.selectedId ? [options.selectedId] : []) : selection.selectedIdsRef.current);
    history.applyEditorChange(nextTrack, selectedId, true, selectedIds);
    if (options.status) setStatus(options.status);
    return nextTrack;
  }

  /** Wraps an edit so a rejected operation (a format limit, a missing record) shows up as status. */
  function run(action: () => void) {
    try {
      action();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function currentFile(): KmpFile | null {
    return (trackRef.current ?? track)?.kmpFile ?? null;
  }

  /** Drops a position onto the collision mesh, so generated points are never left floating. */
  function groundedY(position: Vec3, fallback = position.y): number {
    const kcl = (trackRef.current ?? track)?.kcl;
    if (!kcl) return fallback;
    const hit = raycastDown(kcl, position.x, position.z, position.y + 10000);
    return hit ? hit.y : fallback;
  }

  // -------------------------------------------------------------------------
  // Path graph editing
  // -------------------------------------------------------------------------

  function makePathPoint(file: KmpFile, section: PathPointSection, position: Vec3, templateGlobalIndex: number | null) {
    if (section === 'ENPT') return createEnemyPoint(position, templateGlobalIndex === null ? undefined : file.enemyPoints[templateGlobalIndex]);
    if (section === 'ITPT') return createItemPoint(position, templateGlobalIndex === null ? undefined : file.itemPoints[templateGlobalIndex]);
    const template = templateGlobalIndex === null ? undefined : file.checkpoints[templateGlobalIndex];
    if (template) {
      const heading = checkpointHeadingDegrees(template);
      const width = Math.hypot(template.x2 - template.x1, template.z2 - template.z1) || undefined;
      return createCheckpointAcross(position, heading, width);
    }
    return createCheckpointAcross(position, 0);
  }

  function writePathPoint(file: KmpFile, section: PathPointSection, groupIndex: number, localIndex: number, position: Vec3, where: 'before' | 'after'): KmpFile {
    const templateGlobal = groupStartInFile(file, section, groupIndex) + localIndex;
    if (section === 'ENPT') {
      const point = makePathPoint(file, section, position, templateGlobal) as ReturnType<typeof createEnemyPoint>;
      return setEnemyPathGraph(file, insertPoint(getEnemyPathGraph(file), groupIndex, localIndex, point, where));
    }
    if (section === 'ITPT') {
      const point = makePathPoint(file, section, position, templateGlobal) as ReturnType<typeof createItemPoint>;
      return setItemPathGraph(file, insertPoint(getItemPathGraph(file), groupIndex, localIndex, point, where));
    }
    const point = makePathPoint(file, section, position, templateGlobal) as ReturnType<typeof createCheckpointAcross>;
    return setCheckpointGraph(file, insertPoint(getCheckpointGraph(file), groupIndex, localIndex, point, where));
  }

  /** Adds a point to a path group, before or after the point at `localIndex`. */
  function addPathPoint(section: PathPointSection, groupIndex: number, localIndex: number, position: Vec3, where: 'before' | 'after' = 'after') {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const nextFile = writePathPoint(file, section, groupIndex, localIndex, position, where);
      const newLocal = where === 'before' ? localIndex : localIndex + 1;
      const newGlobal = groupStartInFile(nextFile, section, groupIndex) + newLocal;
      commit(nextFile, {
        selectedId: `${section}-${newGlobal}`,
        status: `Added ${POINT_LABEL[section]} ${newLocal + 1} to group ${groupIndex + 1}.`,
      });
    });
  }

  /** Adds a point at the end of a group. */
  function appendPathPoint(section: PathPointSection, groupIndex: number, position: Vec3) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const group = pathGroups(file, section)[groupIndex];
      if (!group) throw new Error(`That ${PATH_LABEL[section]} group no longer exists.`);
      addPathPoint(section, groupIndex, Math.max(0, group.length - 1), position, 'after');
    });
  }

  /** Starts a brand new group that branches off the end of `groupIndex`. */
  function branchPath(section: PathPointSection, groupIndex: number, position: Vec3) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const group = pathGroups(file, section)[groupIndex];
      const templateGlobal = group ? group.start + Math.max(0, group.length - 1) : null;
      const point = makePathPoint(file, section, position, templateGlobal);
      const nextFile = editPathGraph(file, section, (graph) => branchGroup(graph, groupIndex, [point as never]));
      const newGroupIndex = pathGroups(nextFile, section).length - 1;
      const newGlobal = groupStartInFile(nextFile, section, newGroupIndex);
      commit(nextFile, {
        selectedId: `${section}-${newGlobal}`,
        status: `Branched a new ${PATH_LABEL[section]} group off group ${groupIndex + 1}.`,
      });
    });
  }

  /** Creates a group with a single point, unconnected to anything. */
  function startPathGroup(section: PathPointSection, position: Vec3) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const point = makePathPoint(file, section, position, null);
      const nextFile = editPathGraph(file, section, (graph) => ({
        kind: graph.kind,
        groups: [...graph.groups, { points: [point as never], prev: [], next: [], linkFlags: 0 }],
      }));
      const newGroupIndex = pathGroups(nextFile, section).length - 1;
      commit(nextFile, {
        selectedId: `${section}-${groupStartInFile(nextFile, section, newGroupIndex)}`,
        status: `Started ${PATH_LABEL[section]} group ${newGroupIndex + 1}.`,
      });
    });
  }

  /** Splits a group so the chosen point becomes the first point of a new group after it. */
  function splitGroupHere(section: PathPointSection, groupIndex: number, localIndex: number) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const nextFile = editPathGraph(file, section, (graph) => splitGroupAtPoint(graph, groupIndex, localIndex));
      const newGlobal = groupStartInFile(nextFile, section, groupIndex + 1);
      commit(nextFile, {
        selectedId: `${section}-${newGlobal}`,
        status: `Split the ${PATH_LABEL[section]} into groups ${groupIndex + 1} and ${groupIndex + 2}.`,
      });
    });
  }

  /** Joins a group with the group that follows it. */
  function mergeGroupNext(section: PathPointSection, groupIndex: number) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const nextFile = editPathGraph(file, section, (graph) => mergeGroupWithNext(graph, groupIndex));
      commit(nextFile, { status: `Merged ${PATH_LABEL[section]} group ${groupIndex + 1} with the next one.` });
    });
  }

  function linkPathGroups(section: PathPointSection, from: number, to: number) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      commit(editPathGraph(file, section, (graph) => linkGroups(graph, from, to)), {
        status: `Connected ${PATH_LABEL[section]} group ${from + 1} to group ${to + 1}.`,
      });
    });
  }

  function unlinkPathGroups(section: PathPointSection, from: number, to: number) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      commit(editPathGraph(file, section, (graph) => unlinkGroups(graph, from, to)), {
        status: `Disconnected ${PATH_LABEL[section]} group ${from + 1} from group ${to + 1}.`,
      });
    });
  }

  function reversePathGroup(section: PathPointSection, groupIndex: number) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      commit(editPathGraph(file, section, (graph) => reverseGroup(graph, groupIndex)), {
        status: `Reversed ${PATH_LABEL[section]} group ${groupIndex + 1}.`,
      });
    });
  }

  function reverseWholePath(section: PathPointSection) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      commit(editPathGraph(file, section, (graph) => reverseGraph(graph)), {
        status: `Reversed the whole ${PATH_LABEL[section]}.`,
      });
    });
  }

  /** Deletes one point; the group disappears too when it was the last one. */
  function deletePathPoint(section: PathPointSection, globalIndex: number) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const location = locatePointInFile(file, section, globalIndex);
      if (!location) throw new Error(`That ${POINT_LABEL[section]} no longer exists.`);
      const nextFile = editPathGraph(file, section, (graph) => deletePoint(graph, location.groupIndex, location.localIndex));
      const remaining = pathGroups(nextFile, section);
      const fallback = remaining.length > 0 ? Math.min(globalIndex, Math.max(0, remaining[remaining.length - 1].start + remaining[remaining.length - 1].length - 1)) : null;
      commit(nextFile, {
        selectedId: fallback === null ? null : `${section}-${fallback}`,
        status: `Deleted ${POINT_LABEL[section]} ${location.localIndex + 1} from group ${location.groupIndex + 1}.`,
      });
    });
  }

  /** Deletes a whole group, bridging its neighbours so the path stays connected. */
  function deletePathGroup(section: PathPointSection, groupIndex: number) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      commit(editPathGraph(file, section, (graph) => removeGroup(graph, groupIndex)), {
        selectedId: null,
        status: `Deleted ${PATH_LABEL[section]} group ${groupIndex + 1}.`,
      });
    });
  }

  // -------------------------------------------------------------------------
  // Checkpoints
  // -------------------------------------------------------------------------

  /**
   * Creates a checkpoint from a drag across the track. When `afterCheckpointIndex` names an
   * existing checkpoint, the new one is inserted after it in the same group; otherwise it is
   * appended to the last group (or starts the first group).
   */
  function createCheckpointAcrossTrack(start: Vec3, end: Vec3, afterCheckpointIndex: number | null = null) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const checkpoint = createCheckpoint(start, end);
      const graph = getCheckpointGraph(file);
      if (graph.groups.length === 0) {
        const nextFile = setCheckpointGraph(file, { kind: 'checkpoint', groups: [{ points: [checkpoint], prev: [], next: [], linkFlags: 0 }] });
        commit(nextFile, { selectedId: 'CKPT-0', status: 'Created the first checkpoint. Drag more across the track to build the lap.' });
        return;
      }
      const location = afterCheckpointIndex === null ? null : locatePointInFile(file, 'CKPT', afterCheckpointIndex);
      const groupIndex = location ? location.groupIndex : graph.groups.length - 1;
      const localIndex = location ? location.localIndex : graph.groups[groupIndex].points.length - 1;
      const nextFile = setCheckpointGraph(file, insertPoint(graph, groupIndex, localIndex, checkpoint, 'after'));
      const newGlobal = groupStartInFile(nextFile, 'CKPT', groupIndex) + localIndex + 1;
      commit(nextFile, { selectedId: `CKPT-${newGlobal}`, status: `Created checkpoint ${localIndex + 2} in group ${groupIndex + 1}.` });
    });
  }

  /** Adds a respawn point at a checkpoint and links the checkpoint to it. */
  function createRespawnFromCheckpoint(checkpointIndex: number) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const checkpoint = file.checkpoints[checkpointIndex];
      if (!checkpoint) throw new Error('That checkpoint no longer exists.');
      const center = checkpointCenter(checkpoint, 0);
      const result = addRespawnForCheckpoint(file, checkpointIndex, { groundY: groundedY({ ...center, y: 0 }, 0) });
      commit(result.file, {
        selectedId: `JGPT-${result.respawnIndex}`,
        status: `Created respawn point ${result.respawnIndex + 1} at checkpoint ${checkpointIndex + 1}.`,
      });
    });
  }

  /** Points a single checkpoint at the respawn point closest to it. */
  function assignNearestRespawn(checkpointIndex: number) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const nearest = nearestRespawnIndexForCheckpoint(file, checkpointIndex);
      if (nearest === null) throw new Error('There are no respawn points to assign yet.');
      commit(
        { ...file, checkpoints: file.checkpoints.map((checkpoint, index) => (index === checkpointIndex ? { ...checkpoint, respawnIndex: nearest } : checkpoint)) },
        { status: `Checkpoint ${checkpointIndex + 1} now respawns at point ${nearest + 1}.` },
      );
    });
  }

  /** Fills in every checkpoint that has no usable respawn point. */
  function assignAllNearestRespawns(all = false) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const result = assignNearestRespawns(file, { all });
      if (result.changed === 0) {
        setStatus('Every checkpoint already has a respawn point.');
        return;
      }
      commit(result.file, { status: `Assigned the nearest respawn point to ${result.changed} checkpoint${result.changed === 1 ? '' : 's'}.` });
    });
  }

  function createRespawnsFromEnemyRoute() {
    run(() => {
      const file = currentFile();
      if (!file) return;
      if (file.enemyPoints.length === 0) throw new Error('Add an enemy route before creating checkpoint respawns.');
      if (file.respawnPoints.length + file.checkpoints.length > MAX_PATH_POINTS) {
        throw new Error(`A track can only have ${MAX_PATH_POINTS} respawn points. Remove unused respawns before generating more.`);
      }
      const respawnPoints = [...file.respawnPoints];
      const checkpoints = file.checkpoints.map((checkpoint) => {
        const center = checkpointCenter(checkpoint);
        let nearestIndex = 0;
        let nearestDistance = Infinity;
        file.enemyPoints.forEach((point, index) => {
          const distance = (point.position.x - center.x) ** 2 + (point.position.z - center.z) ** 2;
          if (distance < nearestDistance) {
            nearestIndex = index;
            nearestDistance = distance;
          }
        });
        const position = file.enemyPoints[nearestIndex].position;
        const group = file.enemyGroups.find((group) => nearestIndex >= group.start && nearestIndex < group.start + group.length);
        const nextGroup = group?.next.map((index) => file.enemyGroups[index]).find((group) => group?.length);
        const nextPosition = group && nearestIndex + 1 < group.start + group.length
          ? file.enemyPoints[nearestIndex + 1]?.position
          : nextGroup ? file.enemyPoints[nextGroup.start]?.position : undefined;
        const previous = group && nearestIndex > group.start
          ? file.enemyPoints[nearestIndex - 1]?.position
          : undefined;
        const dx = nextPosition ? nextPosition.x - position.x : previous ? position.x - previous.x : 0;
        const dz = nextPosition ? nextPosition.z - position.z : previous ? position.z - previous.z : 0;
        const respawnIndex = respawnPoints.length;
        respawnPoints.push({
          position: { ...position },
          rotation: { x: 0, y: dx || dz ? Math.atan2(dx, dz) * 180 / Math.PI : checkpointHeadingDegrees(checkpoint), z: 0 },
          id: respawnIndex,
          extraUserData: -1,
        });
        return { ...checkpoint, respawnIndex };
      });
      commit({ ...file, checkpoints, respawnPoints }, {
        status: `Created and assigned ${checkpoints.length} checkpoint respawns from enemy routes.`,
      });
    });
  }

  /** Renumbers key checkpoints 1, 2, 3 … in the order drivers reach them. */
  function renumberKeyCheckpointsInOrder() {
    run(() => {
      const file = currentFile();
      if (!file) return;
      commit(setCheckpointGraph(file, renumberKeyCheckpoints(getCheckpointGraph(file))), {
        status: 'Renumbered the key checkpoints in driving order.',
      });
    });
  }

  /** Makes a checkpoint the lap counter, a numbered key checkpoint, or an ordinary one. */
  function setCheckpointKind(checkpointIndex: number, kind: 'lap' | 'key' | 'normal') {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const used = new Set(file.checkpoints.map((checkpoint) => checkpoint.type).filter((type) => type !== KMP_NULL_INDEX_8));
      let nextKey = 1;
      while (used.has(nextKey) && nextKey < 0xfe) nextKey++;
      const type = kind === 'lap' ? 0 : kind === 'normal' ? KMP_NULL_INDEX_8 : nextKey;
      commit(
        { ...file, checkpoints: file.checkpoints.map((checkpoint, index) => (index === checkpointIndex ? { ...checkpoint, type } : checkpoint)) },
        {
          status:
            kind === 'lap'
              ? `Checkpoint ${checkpointIndex + 1} is now the lap counter.`
              : kind === 'key'
                ? `Checkpoint ${checkpointIndex + 1} is now key checkpoint ${type}.`
                : `Checkpoint ${checkpointIndex + 1} is now an ordinary checkpoint.`,
        },
      );
    });
  }

  // -------------------------------------------------------------------------
  // Track settings (STGI)
  // -------------------------------------------------------------------------

  function updateStage(patch: Partial<KmpStageInfo>, status?: string) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const current = file.stage[0] ?? createStageInfo();
      const next: KmpStageInfo = { ...current, ...patch, flareColor: patch.flareColor ? [...patch.flareColor] : [...current.flareColor] };
      commit({ ...file, stage: [next, ...file.stage.slice(1)] }, { status });
    });
  }

  // -------------------------------------------------------------------------
  // Validation quick fixes
  // -------------------------------------------------------------------------

  /** Clears a route reference that points at a route which does not exist. */
  function clearDanglingRouteReference(entityId: string) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const [prefix, rawIndex] = entityId.split('-');
      const index = Number(rawIndex);
      if (!Number.isInteger(index)) return;
      if (prefix === 'GOBJ') {
        commit({ ...file, objects: file.objects.map((object, i) => (i === index ? { ...object, routeIndex: KMP_NULL_INDEX_16 } : object)) }, {
          status: `Removed the broken route link from object ${index + 1}.`,
        });
        return;
      }
      if (prefix === 'AREA') {
        commit({ ...file, areas: file.areas.map((area, i) => (i === index ? { ...area, routeIndex: KMP_NULL_INDEX_8 } : area)) }, {
          status: `Removed the broken route link from area ${index + 1}.`,
        });
        return;
      }
      if (prefix === 'CAME') {
        commit({ ...file, cameras: file.cameras.map((camera, i) => (i === index ? { ...camera, routeIndex: KMP_NULL_INDEX_8 } : camera)) }, {
          status: `Removed the broken route link from camera ${index + 1}.`,
        });
      }
    });
  }

  /** Clears a camera chain link that points at a camera which does not exist. */
  function clearDanglingCameraReference(entityId: string) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const [prefix, rawIndex] = entityId.split('-');
      const index = Number(rawIndex);
      if (!Number.isInteger(index)) return;
      if (prefix === 'CAME') {
        commit({ ...file, cameras: file.cameras.map((camera, i) => (i === index ? { ...camera, nextIndex: KMP_NULL_INDEX_8 } : camera)) }, {
          status: `Ended the opening camera chain at camera ${index + 1}.`,
        });
        return;
      }
      if (prefix === 'AREA') {
        commit({ ...file, areas: file.areas.map((area, i) => (i === index ? { ...area, cameraIndex: KMP_NULL_INDEX_8 } : area)) }, {
          status: `Removed the broken camera link from area ${index + 1}.`,
        });
      }
    });
  }

  /** Turns a hidden object back on for every player count. */
  function makeObjectAlwaysPresent(objectIndex: number) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      commit({ ...file, objects: file.objects.map((object, i) => (i === objectIndex ? { ...object, presenceFlags: (object.presenceFlags & ~0x3f) | 0x3f } : object)) }, {
        status: `Object ${objectIndex + 1} now appears in every game mode.`,
      });
    });
  }

  /** Adds an empty route and points the object at it, so a route-driven object works. */
  function createRouteForObject(objectIndex: number) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const object = file.objects[objectIndex];
      if (!object) throw new Error('That object no longer exists.');
      const y = groundedY(object.position, object.position.y);
      const routeIndex = file.routes.length;
      const points = [
        { position: { ...object.position, y }, setting1: 0, setting2: 0 },
        { position: { x: object.position.x + 1000, y, z: object.position.z }, setting1: 0, setting2: 0 },
      ];
      commit(
        {
          ...file,
          routes: [...file.routes, { smooth: 0, forwardBackward: 0, points }],
          objects: file.objects.map((candidate, i) => (i === objectIndex ? { ...candidate, routeIndex } : candidate)),
        },
        { selectedId: `POTI-${routeIndex}-0`, status: `Created route ${routeIndex + 1} for object ${objectIndex + 1}.` },
      );
    });
  }

  /** Adds a point to the end of a POTI route. */
  function appendRoutePoint(routeIndex: number, position: Vec3) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const route = file.routes[routeIndex];
      if (!route) throw new Error('That route no longer exists.');
      const template = route.points[route.points.length - 1];
      const nextPoints = [...route.points, { position: { ...position }, setting1: template?.setting1 ?? 0, setting2: template?.setting2 ?? 0 }];
      commit({ ...file, routes: file.routes.map((candidate, i) => (i === routeIndex ? { ...candidate, points: nextPoints } : candidate)) }, {
        selectedId: `POTI-${routeIndex}-${nextPoints.length - 1}`,
        status: `Added point ${nextPoints.length} to route ${routeIndex + 1}.`,
      });
    });
  }

  /** Reverses the travel direction of a POTI route. */
  function reverseRoute(routeIndex: number) {
    run(() => {
      const file = currentFile();
      if (!file) return;
      const route = file.routes[routeIndex];
      if (!route) throw new Error('That route no longer exists.');
      commit({ ...file, routes: file.routes.map((candidate, i) => (i === routeIndex ? { ...candidate, points: [...candidate.points].reverse() } : candidate)) }, {
        status: `Reversed route ${routeIndex + 1}.`,
      });
    });
  }

  /** Drops every selected point onto the collision surface below it. */
  function snapEntitiesToCollision(entityIds: readonly string[]) {
    run(() => {
      const file = currentFile();
      const kcl = (trackRef.current ?? track)?.kcl;
      if (!file || !kcl) {
        setStatus('This track has no collision data to snap to.');
        return;
      }
      let next = file;
      let moved = 0;
      const snap = (position: Vec3): Vec3 | null => {
        const hit = raycastDown(kcl, position.x, position.z, position.y + 10000);
        return hit ? { x: position.x, y: hit.y, z: position.z } : null;
      };
      for (const entityId of entityIds) {
        const [prefix, rawIndex, rawPoint] = entityId.split('-');
        const index = Number(rawIndex);
        if (!Number.isInteger(index)) continue;
        if (prefix === 'GOBJ' && next.objects[index]) {
          const position = snap(next.objects[index].position);
          if (!position) continue;
          next = { ...next, objects: next.objects.map((object, i) => (i === index ? { ...object, position } : object)) };
          moved++;
        } else if (prefix === 'JGPT' && next.respawnPoints[index]) {
          const position = snap(next.respawnPoints[index].position);
          if (!position) continue;
          next = { ...next, respawnPoints: next.respawnPoints.map((point, i) => (i === index ? { ...point, position } : point)) };
          moved++;
        } else if (prefix === 'KTPT' && next.startPoints[index]) {
          const position = snap(next.startPoints[index].position);
          if (!position) continue;
          next = { ...next, startPoints: next.startPoints.map((point, i) => (i === index ? { ...point, position } : point)) };
          moved++;
        } else if (prefix === 'ENPT' && next.enemyPoints[index]) {
          const position = snap(next.enemyPoints[index].position);
          if (!position) continue;
          next = { ...next, enemyPoints: next.enemyPoints.map((point, i) => (i === index ? { ...point, position } : point)) };
          moved++;
        } else if (prefix === 'ITPT' && next.itemPoints[index]) {
          const position = snap(next.itemPoints[index].position);
          if (!position) continue;
          next = { ...next, itemPoints: next.itemPoints.map((point, i) => (i === index ? { ...point, position } : point)) };
          moved++;
        } else if (prefix === 'CNPT' && next.cannonPoints[index]) {
          const position = snap(next.cannonPoints[index].position);
          if (!position) continue;
          next = { ...next, cannonPoints: next.cannonPoints.map((point, i) => (i === index ? { ...point, position } : point)) };
          moved++;
        } else if (prefix === 'MSPT' && next.battleFinishPoints[index]) {
          const position = snap(next.battleFinishPoints[index].position);
          if (!position) continue;
          next = { ...next, battleFinishPoints: next.battleFinishPoints.map((point, i) => (i === index ? { ...point, position } : point)) };
          moved++;
        } else if (prefix === 'POTI') {
          const pointIndex = Number(rawPoint);
          const route = next.routes[index];
          if (!route || !Number.isInteger(pointIndex) || !route.points[pointIndex]) continue;
          const position = snap(route.points[pointIndex].position);
          if (!position) continue;
          next = {
            ...next,
            routes: next.routes.map((candidate, i) =>
              i === index ? { ...candidate, points: candidate.points.map((point, p) => (p === pointIndex ? { ...point, position } : point)) } : candidate,
            ),
          };
          moved++;
        }
      }
      if (moved === 0) {
        setStatus('Nothing in the selection could be dropped onto the collision surface.');
        return;
      }
      commit(next, { status: `Snapped ${moved} item${moved === 1 ? '' : 's'} to the collision surface.` });
    });
  }

  return {
    addPathPoint,
    appendPathPoint,
    branchPath,
    startPathGroup,
    splitGroupHere,
    mergeGroupNext,
    linkPathGroups,
    unlinkPathGroups,
    reversePathGroup,
    reverseWholePath,
    deletePathPoint,
    deletePathGroup,
    createCheckpointAcrossTrack,
    createRespawnFromCheckpoint,
    assignNearestRespawn,
    assignAllNearestRespawns,
    createRespawnsFromEnemyRoute,
    renumberKeyCheckpointsInOrder,
    setCheckpointKind,
    updateStage,
    clearDanglingRouteReference,
    clearDanglingCameraReference,
    makeObjectAlwaysPresent,
    createRouteForObject,
    appendRoutePoint,
    reverseRoute,
    snapEntitiesToCollision,
  };
}
