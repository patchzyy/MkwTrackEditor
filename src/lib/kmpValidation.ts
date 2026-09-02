/**
 * Pre-export validation for a Mario Kart Wii track.
 *
 * Every problem is reported as a {@link TrackIssue}: a stable machine-readable `code`, a
 * message written for a track author (no section codes, no hex), and where possible the id
 * of the entity it is about so the UI can jump to it. Nothing here blocks an export; the
 * caller decides what to do with errors.
 */

import {
  KMP_NULL_INDEX_16,
  KMP_NULL_INDEX_8,
  cameraUsesRoute,
  type KmpFile,
} from './kmpFile';
import {
  computeLapPathValidity,
  getCheckpointGraph,
  getEnemyPathGraph,
  getItemPathGraph,
  validatePathGraph,
  type PathGraphIssue,
} from './kmpGraph';

export interface TrackIssue {
  level: 'error' | 'warning';
  /** Stable identifier for this kind of problem, e.g. `object.route-out-of-range`. */
  code: string;
  /** Message written for a track author. Never contains raw section names. */
  message: string;
  /** Matches `KmpEntity.id`, e.g. `GOBJ-12` or `POTI-3-0`, when the issue is about one entity. */
  entityId?: string;
}

/** Files the game needs, and the ones it merely likes to have. */
export const REQUIRED_TRACK_FILES = ['course.kmp', 'course.kcl', 'course_model.brres'] as const;
export const OPTIONAL_TRACK_FILES = ['map_model.brres', 'vrcorn_model.brres'] as const;

const FILE_LABELS: Record<string, string> = {
  'course.kmp': 'the track layout data',
  'course.kcl': 'the collision mesh',
  'course_model.brres': 'the track model',
  'map_model.brres': 'the minimap model',
  'vrcorn_model.brres': 'the skybox model',
};

export interface ObjectResourceLookup {
  /** Resolves an object id to its display name, or null when the id is unknown. */
  objectName(objectId: number): string | null;
  /** File names the object needs, e.g. `['kuribo.brres']`. */
  objectResources(objectId: number): string[];
  /** True when a resource is available from the shared Common archive. */
  hasCommonResource(resourceName: string): boolean;
}

export interface ValidateKmpOptions {
  /** Lower-cased base names of every file in the track archive. */
  archiveFileNames?: string[];
  /** ObjFlow-backed lookup; when absent, object resource checks are skipped with a note. */
  objects?: ObjectResourceLookup | null;
  /** Set to true for battle arenas, which use different required sections. */
  battle?: boolean;
}

const MAX_BYTE_INDEXED_RECORDS = 0xff;

/** AREA type 0 reads `cameraIndex`. */
const AREA_TYPE_CAMERA = 0x00;
/** AREA type 3 reads `routeIndex`. */
const AREA_TYPE_MOVING_ROAD = 0x03;
/** AREA type 4 reads `enemyPointIndex`. */
const AREA_TYPE_CPU_DESTINATION = 0x04;
/** AREA type 0x0F ("teleport", a community extension) reads a cannon index from setting 2. */
const AREA_TYPE_TELEPORT = 0x0f;

export function validateTrackFiles(archiveFileNames: string[]): TrackIssue[] {
  const present = new Set(archiveFileNames.map((name) => name.split('/').pop()?.toLowerCase() ?? ''));
  const issues: TrackIssue[] = [];
  for (const required of REQUIRED_TRACK_FILES) {
    if (present.has(required)) continue;
    issues.push({
      level: 'error',
      code: `archive.missing.${required}`,
      message: `This track is missing ${FILE_LABELS[required]} (${required}); the game will not load it.`,
    });
  }
  for (const optional of OPTIONAL_TRACK_FILES) {
    if (present.has(optional)) continue;
    issues.push({
      level: 'warning',
      code: `archive.missing.${optional}`,
      message: `This track has no ${FILE_LABELS[optional]} (${optional}).`,
    });
  }
  return issues;
}

/** Runs every KMP check. Pass `archiveFileNames` and `objects` to enable the file/object checks. */
export function validateKmpFile(file: KmpFile, options: ValidateKmpOptions = {}): TrackIssue[] {
  const issues: TrackIssue[] = [];
  if (options.archiveFileNames) issues.push(...validateTrackFiles(options.archiveFileNames));

  issues.push(...validateStartAndStage(file, options));
  issues.push(...validateCheckpoints(file));
  issues.push(...validatePaths(file, options));
  issues.push(...validateRespawnPoints(file));
  issues.push(...validateRoutes(file));
  issues.push(...validateObjects(file, options));
  issues.push(...validateAreas(file));
  issues.push(...validateCameras(file));
  issues.push(...validateCounts(file));
  return issues;
}

// ---------------------------------------------------------------------------

function validateStartAndStage(file: KmpFile, options: ValidateKmpOptions): TrackIssue[] {
  const issues: TrackIssue[] = [];
  if (file.startPoints.length === 0) {
    issues.push({ level: 'error', code: 'start.missing', message: 'No start position is set, so drivers have nowhere to begin the race.' });
  }
  if (options.battle && file.startPoints.length > 0 && file.startPoints.length < 12) {
    issues.push({
      level: 'warning',
      code: 'start.battle-count',
      message: `A battle arena needs 12 start positions, one per player, but only ${file.startPoints.length} are set.`,
    });
  }
  if (file.stage.length === 0) {
    issues.push({ level: 'error', code: 'stage.missing', message: 'The track settings are missing, so the game cannot tell how many laps to run.' });
    return issues;
  }
  const stage = file.stage[0];
  if (stage.lapCount < 1 || stage.lapCount > 9) {
    issues.push({
      level: 'warning',
      code: 'stage.lap-count',
      message: `The lap count is set to ${stage.lapCount}; only 1 to 9 laps work in the game.`,
      entityId: 'STGI-0',
    });
  }
  if (stage.speedModifier !== 0 && (stage.speedModifier < 0.5 || stage.speedModifier > 2)) {
    issues.push({
      level: 'warning',
      code: 'stage.speed-modifier',
      message: `The speed multiplier is ${stage.speedModifier.toFixed(2)}x; values outside 0.5x to 2x are usually unplayable.`,
      entityId: 'STGI-0',
    });
  }
  return issues;
}

function validateCheckpoints(file: KmpFile): TrackIssue[] {
  const issues: TrackIssue[] = [];
  if (file.checkpoints.length === 0) {
    issues.push({ level: 'error', code: 'checkpoint.missing', message: 'This track has no checkpoints, so laps and race positions cannot be tracked.' });
    return issues;
  }
  if (file.checkpointGroups.length === 0) {
    issues.push({
      level: 'error',
      code: 'checkpoint.no-groups',
      message: 'Checkpoints exist but are not grouped into a path, so the game cannot follow them.',
    });
    return issues;
  }

  const lapCounters = file.checkpoints.filter((checkpoint) => checkpoint.type === 0).length;
  if (lapCounters > 1) {
    issues.push({
      level: 'error',
      code: 'checkpoint.multiple-lap-counters',
      message: `${lapCounters} checkpoints are marked as the lap counter. Only one is allowed, or every driver is shown in first place after crossing any of them.`,
    });
  }

  const validity = computeLapPathValidity(getCheckpointGraph(file));
  issues.push(...validity.issues.map((issue) => fromPathIssue(issue, 'CKPH')));

  for (let index = 0; index < file.checkpoints.length; index++) {
    const checkpoint = file.checkpoints[index];
    if (checkpoint.respawnIndex === KMP_NULL_INDEX_8) {
      issues.push({
        level: 'warning',
        code: 'checkpoint.no-respawn',
        message: `Checkpoint #${index} has no respawn point, so drivers who fall here are sent to the first respawn point instead.`,
        entityId: `CKPT-${index}`,
      });
      continue;
    }
    if (checkpoint.respawnIndex >= file.respawnPoints.length) {
      issues.push({
        level: 'error',
        code: 'checkpoint.respawn-out-of-range',
        message: `Checkpoint #${index} points at respawn point #${checkpoint.respawnIndex}, which does not exist.`,
        entityId: `CKPT-${index}`,
      });
    }
  }
  return issues;
}

function validatePaths(file: KmpFile, options: ValidateKmpOptions): TrackIssue[] {
  const issues: TrackIssue[] = [];
  if (file.enemyPoints.length === 0) {
    issues.push({ level: 'error', code: 'enemy-route.missing', message: 'There is no enemy route, so computer-controlled drivers have nothing to follow.' });
  } else if (file.enemyGroups.length === 0) {
    issues.push({ level: 'error', code: 'enemy-route.no-groups', message: 'Enemy route points exist but are not grouped into a path.' });
  } else {
    issues.push(...validatePathGraph(getEnemyPathGraph(file)).map((issue) => fromPathIssue(issue, 'ENPH')));
  }

  if (!options.battle) {
    if (file.itemPoints.length === 0) {
      issues.push({ level: 'warning', code: 'item-route.missing', message: 'There is no item route, so red shells and Bullet Bills will not follow the track.' });
    } else if (file.itemGroups.length === 0) {
      issues.push({ level: 'error', code: 'item-route.no-groups', message: 'Item route points exist but are not grouped into a path.' });
    } else {
      issues.push(...validatePathGraph(getItemPathGraph(file)).map((issue) => fromPathIssue(issue, 'ITPH')));
    }
  }
  return issues;
}

function validateRespawnPoints(file: KmpFile): TrackIssue[] {
  if (file.respawnPoints.length > 0) return [];
  return [
    {
      level: 'error',
      code: 'respawn.missing',
      message: 'This track has no respawn points, so a driver who falls off can never be put back on the track.',
    },
  ];
}

function validateRoutes(file: KmpFile): TrackIssue[] {
  const issues: TrackIssue[] = [];
  for (let index = 0; index < file.routes.length; index++) {
    const route = file.routes[index];
    if (route.points.length === 0) {
      issues.push({ level: 'error', code: 'route.empty', message: `Route #${index} has no points.`, entityId: `POTI-${index}-0` });
      continue;
    }
    if (route.smooth === 1 && route.points.length <= 2) {
      issues.push({
        level: 'error',
        code: 'route.smooth-too-short',
        message: `Route #${index} uses smooth motion but only has ${route.points.length} point${route.points.length === 1 ? '' : 's'}; the game freezes on smooth routes with two points or fewer.`,
        entityId: `POTI-${index}-0`,
      });
    }
  }
  return issues;
}

function validateObjects(file: KmpFile, options: ValidateKmpOptions): TrackIssue[] {
  const issues: TrackIssue[] = [];
  const lookup = options.objects;
  const archivePaths = options.archiveFileNames ?? [];
  const archiveNames = new Set(archivePaths.map((name) => name.split('/').pop()?.toLowerCase() ?? ''));
  // Some objects are pure particle effects with no model, e.g. `taimatsu` (a torch flame),
  // which ship as `effect/<name>/rk_<name>.breff` instead of `<name>.brres`.
  const archiveEffectNames = new Set(
    archivePaths
      .map((name) => /(?:^|\/)effect\/([^/]+)\//i.exec(name.split('\\').join('/'))?.[1]?.toLowerCase())
      .filter((name): name is string => !!name),
  );
  let reportedMissingLookup = false;

  for (let index = 0; index < file.objects.length; index++) {
    const object = file.objects[index];
    const entityId = `GOBJ-${index}`;
    const name = lookup?.objectName(object.objectId) ?? null;
    const label = name ? `Object #${index} (${name})` : `Object #${index}`;

    if (object.objectId === 0) {
      issues.push({ level: 'warning', code: 'object.disabled', message: `Object #${index} has no type set and will not appear in game.`, entityId });
    } else if (lookup && !name) {
      issues.push({
        level: 'warning',
        code: 'object.unknown-id',
        message: `Object #${index} uses a type the game does not know about and will not appear.`,
        entityId,
      });
    }

    if (object.routeIndex !== KMP_NULL_INDEX_16) {
      if (object.routeIndex >= file.routes.length) {
        issues.push({
          level: 'error',
          code: 'object.route-out-of-range',
          message: `${label} follows route #${object.routeIndex}, which does not exist.`,
          entityId,
        });
      } else if (file.routes[object.routeIndex].points.length < 2) {
        issues.push({
          level: 'error',
          code: 'object.route-too-short',
          message: `${label} follows route #${object.routeIndex}, which has fewer than two points and cannot define a path.`,
          entityId,
        });
      }
    }

    if ((object.presenceFlags & 0x07) === 0) {
      issues.push({
        level: 'warning',
        code: 'object.never-visible',
        message: `${label} is hidden in every game mode, so it will never appear.`,
        entityId,
      });
    }

    if (!lookup) {
      if (!reportedMissingLookup) {
        reportedMissingLookup = true;
        issues.push({
          level: 'warning',
          code: 'object.resources-unchecked',
          message: 'The shared game data has not been loaded, so object models could not be checked.',
        });
      }
      continue;
    }

    for (const resource of lookup.objectResources(object.objectId)) {
      const key = resource.toLowerCase();
      if (archiveNames.has(key) || lookup.hasCommonResource(key) || archiveEffectNames.has(key.replace(/\.brres$/, ''))) continue;
      // A warning rather than an error: some objects are effect- or sound-only, and a
      // trimmed Common archive can make a perfectly good track look broken.
      issues.push({
        level: 'warning',
        code: 'object.resource-missing',
        message: `${label} needs the model file ${resource}, which is neither in this track nor in the shared game data, so it may not appear in game.`,
        entityId,
      });
    }
  }
  return issues;
}

function validateAreas(file: KmpFile): TrackIssue[] {
  const issues: TrackIssue[] = [];
  for (let index = 0; index < file.areas.length; index++) {
    const area = file.areas[index];
    const entityId = `AREA-${index}`;
    if (area.type === AREA_TYPE_CAMERA) {
      if (area.cameraIndex === KMP_NULL_INDEX_8) {
        issues.push({ level: 'error', code: 'area.camera-missing', message: `Area #${index} is a camera trigger but no camera is assigned to it.`, entityId });
      } else if (area.cameraIndex >= file.cameras.length) {
        issues.push({
          level: 'error',
          code: 'area.camera-out-of-range',
          message: `Area #${index} triggers camera #${area.cameraIndex}, which does not exist.`,
          entityId,
        });
      }
    }
    // Only the area types documented as reading these fields are checked; other types leave
    // stale values in them, and flagging those would be noise.
    if (area.type === AREA_TYPE_MOVING_ROAD && area.routeIndex !== KMP_NULL_INDEX_8 && area.routeIndex >= file.routes.length) {
      issues.push({ level: 'error', code: 'area.route-out-of-range', message: `Area #${index} uses route #${area.routeIndex}, which does not exist.`, entityId });
    }
    if (area.type === AREA_TYPE_CPU_DESTINATION && area.enemyPointIndex !== KMP_NULL_INDEX_8 && area.enemyPointIndex >= file.enemyPoints.length) {
      issues.push({
        level: 'error',
        code: 'area.enemy-point-out-of-range',
        message: `Area #${index} sends computer drivers to enemy route point #${area.enemyPointIndex}, which does not exist.`,
        entityId,
      });
    }
    if (area.type === AREA_TYPE_TELEPORT && area.setting2 >= file.cannonPoints.length) {
      issues.push({
        level: 'error',
        code: 'area.cannon-out-of-range',
        message: `Area #${index} teleports to cannon point #${area.setting2}, which does not exist.`,
        entityId,
      });
    }
    if (area.scale.x === 0 || area.scale.y === 0 || area.scale.z === 0) {
      issues.push({ level: 'warning', code: 'area.zero-size', message: `Area #${index} has zero size in at least one direction and can never be entered.`, entityId });
    }
  }
  return issues;
}

function validateCameras(file: KmpFile): TrackIssue[] {
  const issues: TrackIssue[] = [];
  for (let index = 0; index < file.cameras.length; index++) {
    const camera = file.cameras[index];
    const entityId = `CAME-${index}`;
    if (camera.nextIndex !== KMP_NULL_INDEX_8 && camera.nextIndex >= file.cameras.length) {
      issues.push({
        level: 'error',
        code: 'camera.next-out-of-range',
        message: `Camera #${index} hands over to camera #${camera.nextIndex}, which does not exist.`,
        entityId,
      });
    }
    if (camera.nextIndex === index) {
      issues.push({ level: 'error', code: 'camera.next-self', message: `Camera #${index} hands over to itself, which locks the opening pan.`, entityId });
    }
    if (camera.routeIndex !== KMP_NULL_INDEX_8) {
      if (camera.routeIndex >= file.routes.length) {
        issues.push({
          level: 'error',
          code: 'camera.route-out-of-range',
          message: `Camera #${index} follows route #${camera.routeIndex}, which does not exist.`,
          entityId,
        });
      } else if (file.routes[camera.routeIndex].points.length < 2) {
        issues.push({
          level: 'error',
          code: 'camera.route-too-short',
          message: `Camera #${index} follows route #${camera.routeIndex}, which has fewer than two points.`,
          entityId,
        });
      }
    } else if (cameraUsesRoute(camera.type)) {
      issues.push({
        level: 'warning',
        code: 'camera.route-missing',
        message: `Camera #${index} is set up to travel along a route but no route is assigned.`,
        entityId,
      });
    }
  }

  if (file.cameras.length > 0) {
    if (file.firstOpeningCamera >= file.cameras.length && file.firstOpeningCamera !== KMP_NULL_INDEX_8) {
      issues.push({
        level: 'error',
        code: 'camera.opening-out-of-range',
        message: `The opening pan starts at camera #${file.firstOpeningCamera}, which does not exist.`,
      });
    }
    // Walk the opening chain and stop if it loops.
    const seen = new Set<number>();
    let cursor = file.firstOpeningCamera;
    while (cursor !== KMP_NULL_INDEX_8 && cursor < file.cameras.length) {
      if (seen.has(cursor)) {
        issues.push({
          level: 'error',
          code: 'camera.opening-loop',
          message: 'The opening camera sequence loops back on itself and never ends.',
          entityId: `CAME-${cursor}`,
        });
        break;
      }
      seen.add(cursor);
      cursor = file.cameras[cursor].nextIndex;
    }
  }
  return issues;
}

function validateCounts(file: KmpFile): TrackIssue[] {
  const issues: TrackIssue[] = [];
  const limits: Array<[string, number, string]> = [
    ['start.too-many', file.startPoints.length, 'start positions'],
    ['area.too-many', file.areas.length, 'areas'],
    ['camera.too-many', file.cameras.length, 'cameras'],
    ['respawn.too-many', file.respawnPoints.length, 'respawn points'],
    ['cannon.too-many', file.cannonPoints.length, 'cannon points'],
    ['battle-finish.too-many', file.battleFinishPoints.length, 'battle finish points'],
    ['route.too-many', file.routes.length, 'routes'],
  ];
  for (const [code, count, label] of limits) {
    if (count <= MAX_BYTE_INDEXED_RECORDS) continue;
    issues.push({ level: 'error', code, message: `This track has ${count} ${label}; the game supports at most ${MAX_BYTE_INDEXED_RECORDS}.` });
  }
  if (file.objects.length > 255) {
    issues.push({
      level: 'warning',
      code: 'object.too-many',
      message: `This track has ${file.objects.length} objects. More than 255 only works in track slot 5.3.`,
    });
  }
  return issues;
}

const PATH_SECTION_LABEL: Record<string, string> = {
  ENPH: 'ENPH',
  ITPH: 'ITPH',
  CKPH: 'CKPH',
};

function fromPathIssue(issue: PathGraphIssue, section: keyof typeof PATH_SECTION_LABEL): TrackIssue {
  return {
    level: issue.level,
    code: issue.code,
    message: issue.message,
    entityId: issue.groupIndex === undefined ? undefined : `${section}-${issue.groupIndex}`,
  };
}

/** Sorts errors before warnings, keeping the original order inside each level. */
export function sortIssues(issues: TrackIssue[]): TrackIssue[] {
  return [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
}

/** Counts of each level, for a summary line in the export dialog. */
export function summarizeIssues(issues: TrackIssue[]): { errors: number; warnings: number } {
  return {
    errors: issues.filter((issue) => issue.level === 'error').length,
    warnings: issues.filter((issue) => issue.level === 'warning').length,
  };
}
