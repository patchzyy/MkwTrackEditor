import { describe, expect, it } from 'vitest';
import {
  OPTIONAL_TRACK_FILES,
  REQUIRED_TRACK_FILES,
  summarizeIssues,
  sortIssues,
  validateKmpFile,
  validateTrackFiles,
  type ObjectResourceLookup,
  type TrackIssue,
} from './kmpValidation';
import {
  createEmptyKmpFile,
  type KmpArea,
  type KmpCamera,
  type KmpCheckpoint,
  type KmpEnemyPoint,
  type KmpFile,
  type KmpObject,
  type KmpRespawnPoint,
} from './kmpFile';

const origin = { x: 0, y: 0, z: 0 };

function checkpoint(type: number, respawnIndex = 0): KmpCheckpoint {
  return { x1: -500, z1: 0, x2: 500, z2: 0, respawnIndex, type, prev: 0xff, next: 0xff };
}

function enemyPoint(): KmpEnemyPoint {
  return { position: { ...origin }, range: 10, setting1: 0, setting2: 0, setting3: 0 };
}

function respawn(): KmpRespawnPoint {
  return { position: { ...origin }, rotation: { ...origin }, id: 0, extraUserData: -1 };
}

function object(overrides: Partial<KmpObject> = {}): KmpObject {
  return {
    objectId: 0x65,
    extendedPresence: 0,
    position: { ...origin },
    rotation: { ...origin },
    scale: { x: 1, y: 1, z: 1 },
    routeIndex: 0xffff,
    settings: [0, 0, 0, 0, 0, 0, 0, 0],
    presenceFlags: 0x3f,
    ...overrides,
  };
}

function area(overrides: Partial<KmpArea> = {}): KmpArea {
  return {
    shape: 0,
    type: 0,
    cameraIndex: 0xff,
    priority: 0,
    position: { ...origin },
    rotation: { ...origin },
    scale: { x: 1, y: 1, z: 1 },
    setting1: 0,
    setting2: 0,
    routeIndex: 0xff,
    enemyPointIndex: 0xff,
    padding: 0,
    ...overrides,
  };
}

function camera(overrides: Partial<KmpCamera> = {}): KmpCamera {
  return {
    type: 0,
    nextIndex: 0xff,
    shake: 0,
    routeIndex: 0xff,
    pointVelocity: 0,
    zoomVelocity: 0,
    viewVelocity: 0,
    start: 0,
    movie: 0,
    position: { ...origin },
    rotation: { ...origin },
    zoomStart: 60,
    zoomEnd: 60,
    viewStart: { ...origin },
    viewEnd: { ...origin },
    time: 60,
    ...overrides,
  };
}

/** A minimally valid race track: one start, one closed checkpoint loop, an enemy route, a respawn. */
function validTrack(): KmpFile {
  const file = createEmptyKmpFile();
  file.startPoints.push({ position: { ...origin }, rotation: { ...origin }, playerIndex: -1, padding: 0 });
  file.checkpoints.push(checkpoint(0), checkpoint(1), checkpoint(0xff));
  file.checkpointGroups.push({ start: 0, length: 3, prev: [0], next: [0], linkFlags: 0 });
  file.enemyPoints.push(enemyPoint(), enemyPoint());
  file.enemyGroups.push({ start: 0, length: 2, prev: [0], next: [0], linkFlags: 0 });
  file.itemPoints.push({ position: { ...origin }, range: 10, setting1: 0, setting2: 0 });
  file.itemGroups.push({ start: 0, length: 1, prev: [0], next: [0], linkFlags: 0 });
  file.respawnPoints.push(respawn());
  return file;
}

const allFiles = [...REQUIRED_TRACK_FILES, ...OPTIONAL_TRACK_FILES];

function codes(issues: TrackIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

const lookup: ObjectResourceLookup = {
  objectName: (id) => (id === 0x65 ? 'itembox' : id === 0x191 ? 'kuribo' : null),
  objectResources: (id) => (id === 0x65 ? ['itembox.brres'] : id === 0x191 ? ['kuribo.brres'] : []),
  hasCommonResource: (name) => name === 'itembox.brres',
};

describe('archive file checks', () => {
  it('accepts a complete archive', () => {
    expect(validateTrackFiles([...allFiles])).toEqual([]);
  });

  it('reports missing required files as errors and optional ones as warnings', () => {
    const issues = validateTrackFiles([]);
    expect(codes(issues)).toEqual([
      'archive.missing.course.kmp',
      'archive.missing.course.kcl',
      'archive.missing.course_model.brres',
      'archive.missing.map_model.brres',
      'archive.missing.vrcorn_model.brres',
    ]);
    expect(issues.slice(0, 3).every((issue) => issue.level === 'error')).toBe(true);
    expect(issues.slice(3).every((issue) => issue.level === 'warning')).toBe(true);
  });

  it('matches files regardless of the folder they sit in', () => {
    expect(validateTrackFiles(allFiles.map((name) => `sub/dir/${name}`))).toEqual([]);
  });
});

describe('KMP validation', () => {
  it('finds nothing wrong with a minimal valid track', () => {
    const issues = validateKmpFile(validTrack(), { archiveFileNames: [...allFiles], objects: lookup });
    expect(issues).toEqual([]);
  });

  it('reports a missing start position, checkpoints, respawns and enemy route', () => {
    const issues = validateKmpFile(createEmptyKmpFile());
    expect(codes(issues)).toEqual(
      expect.arrayContaining(['start.missing', 'checkpoint.missing', 'respawn.missing', 'enemy-route.missing', 'item-route.missing']),
    );
  });

  it('reports more than one lap counter', () => {
    const file = validTrack();
    file.checkpoints[2] = checkpoint(0);
    expect(codes(validateKmpFile(file))).toContain('checkpoint.multiple-lap-counters');
  });

  it('reports a missing lap counter and a chain that does not close', () => {
    const file = validTrack();
    file.checkpoints = [checkpoint(1), checkpoint(2)];
    file.checkpointGroups = [{ start: 0, length: 2, prev: [], next: [], linkFlags: 0 }];
    const found = codes(validateKmpFile(file));
    expect(found).toContain('checkpoint.no-lap-counter');
    expect(found).toContain('checkpoint.chain-not-closed');
  });

  it('reports a checkpoint pointing at a respawn point that does not exist', () => {
    const file = validTrack();
    file.checkpoints[1] = checkpoint(1, 7);
    const issue = validateKmpFile(file).find((candidate) => candidate.code === 'checkpoint.respawn-out-of-range');
    expect(issue?.level).toBe('error');
    expect(issue?.entityId).toBe('CKPT-1');
    expect(issue?.message).toContain('#7');
  });

  it('reports a checkpoint with no respawn point assigned', () => {
    const file = validTrack();
    file.checkpoints[1] = checkpoint(1, 0xff);
    expect(codes(validateKmpFile(file))).toContain('checkpoint.no-respawn');
  });

  it('reports path group links that point nowhere', () => {
    const file = validTrack();
    // Two groups where the second is never reachable and links only forwards.
    file.enemyGroups = [
      { start: 0, length: 1, prev: [0], next: [0], linkFlags: 0 },
      { start: 1, length: 1, prev: [], next: [], linkFlags: 0 },
    ];
    const found = codes(validateKmpFile(file));
    expect(found).toContain('path.orphan-group');
    expect(found).toContain('path.dead-end');
  });

  it('reports an object route index that does not exist', () => {
    const file = validTrack();
    file.objects.push(object({ routeIndex: 3 }));
    const issue = validateKmpFile(file, { objects: lookup }).find((candidate) => candidate.code === 'object.route-out-of-range');
    expect(issue?.entityId).toBe('GOBJ-0');
    expect(issue?.message).toContain('itembox');
  });

  it('reports an object route that is too short to be a path', () => {
    const file = validTrack();
    file.routes.push({ smooth: 0, forwardBackward: 0, points: [{ position: { ...origin }, setting1: 0, setting2: 0 }] });
    file.objects.push(object({ routeIndex: 0 }));
    expect(codes(validateKmpFile(file, { objects: lookup }))).toContain('object.route-too-short');
  });

  it('reports a smooth route with too few points, which freezes the game', () => {
    const file = validTrack();
    file.routes.push({ smooth: 1, forwardBackward: 0, points: [{ position: { ...origin }, setting1: 0, setting2: 0 }] });
    expect(codes(validateKmpFile(file))).toContain('route.smooth-too-short');
  });

  it('reports an object that is hidden in every mode', () => {
    const file = validTrack();
    file.objects.push(object({ presenceFlags: 0 }));
    expect(codes(validateKmpFile(file, { objects: lookup }))).toContain('object.never-visible');
  });

  it('reports an object whose model is in neither the track nor the shared data', () => {
    const file = validTrack();
    file.objects.push(object({ objectId: 0x191 }));
    const withoutModel = validateKmpFile(file, { archiveFileNames: [...allFiles], objects: lookup });
    const issue = withoutModel.find((candidate) => candidate.code === 'object.resource-missing');
    expect(issue?.level).toBe('warning');
    expect(issue?.message).toContain('kuribo.brres');

    const withModel = validateKmpFile(file, { archiveFileNames: [...allFiles, 'kuribo.brres'], objects: lookup });
    expect(codes(withModel)).not.toContain('object.resource-missing');
  });

  it('says so when the shared game data is not available', () => {
    const file = validTrack();
    file.objects.push(object());
    expect(codes(validateKmpFile(file, { objects: null }))).toContain('object.resources-unchecked');
  });

  it('reports an unknown object type', () => {
    const file = validTrack();
    file.objects.push(object({ objectId: 0x777 }));
    expect(codes(validateKmpFile(file, { objects: lookup }))).toContain('object.unknown-id');
  });

  it('reports areas that reference missing cameras, routes and enemy points', () => {
    const file = validTrack();
    file.areas.push(area({ type: 0, cameraIndex: 5 }));
    file.areas.push(area({ type: 3, routeIndex: 9 }));
    file.areas.push(area({ type: 4, enemyPointIndex: 40, cameraIndex: 0xff }));
    file.areas.push(area({ type: 0x0f, setting2: 2, cameraIndex: 0xff }));
    file.areas.push(area({ type: 1, cameraIndex: 0xff, scale: { x: 0, y: 1, z: 1 } }));
    const found = codes(validateKmpFile(file));
    expect(found).toContain('area.camera-out-of-range');
    expect(found).toContain('area.route-out-of-range');
    expect(found).toContain('area.enemy-point-out-of-range');
    expect(found).toContain('area.cannon-out-of-range');
    expect(found).toContain('area.zero-size');
  });

  it('reports a camera trigger area with no camera assigned', () => {
    const file = validTrack();
    file.cameras.push(camera());
    file.areas.push(area({ type: 0, cameraIndex: 0xff }));
    expect(codes(validateKmpFile(file))).toContain('area.camera-missing');
  });

  it('reports cameras that hand over to a camera that does not exist', () => {
    const file = validTrack();
    file.cameras.push(camera({ nextIndex: 4 }));
    const issue = validateKmpFile(file).find((candidate) => candidate.code === 'camera.next-out-of-range');
    expect(issue?.entityId).toBe('CAME-0');
  });

  it('reports a camera opening sequence that loops forever', () => {
    const file = validTrack();
    file.cameras.push(camera({ nextIndex: 1 }), camera({ nextIndex: 0 }));
    file.firstOpeningCamera = 0;
    expect(codes(validateKmpFile(file))).toContain('camera.opening-loop');
  });

  it('reports a camera that points at itself', () => {
    const file = validTrack();
    file.cameras.push(camera({ nextIndex: 0 }));
    expect(codes(validateKmpFile(file))).toContain('camera.next-self');
  });

  it('reports route-following cameras with missing or broken routes', () => {
    const file = validTrack();
    file.cameras.push(camera({ type: 5, routeIndex: 0xff }));
    file.cameras.push(camera({ type: 5, routeIndex: 8 }));
    const found = codes(validateKmpFile(file));
    expect(found).toContain('camera.route-missing');
    expect(found).toContain('camera.route-out-of-range');
  });

  it('reports an opening camera index that does not exist', () => {
    const file = validTrack();
    file.cameras.push(camera());
    file.firstOpeningCamera = 9;
    expect(codes(validateKmpFile(file))).toContain('camera.opening-out-of-range');
  });

  it('reports lap counts and speed multipliers the game cannot use', () => {
    const file = validTrack();
    file.stage[0].lapCount = 12;
    file.stage[0].speedModifier = 8;
    const found = codes(validateKmpFile(file));
    expect(found).toContain('stage.lap-count');
    expect(found).toContain('stage.speed-modifier');
  });

  it('reports counts above the format limits', () => {
    const file = validTrack();
    file.respawnPoints = Array.from({ length: 300 }, respawn);
    file.checkpoints = file.checkpoints.map((point) => ({ ...point, respawnIndex: 0 }));
    expect(codes(validateKmpFile(file))).toContain('respawn.too-many');

    const many = validTrack();
    many.objects = Array.from({ length: 300 }, () => object());
    expect(codes(validateKmpFile(many, { objects: lookup }))).toContain('object.too-many');
  });

  it('skips item-route checks for battle arenas', () => {
    const file = createEmptyKmpFile();
    file.startPoints.push({ position: { ...origin }, rotation: { ...origin }, playerIndex: 0, padding: 0 });
    file.enemyPoints.push(enemyPoint());
    file.enemyGroups.push({ start: 0, length: 1, prev: [0], next: [0], linkFlags: 0 });
    file.respawnPoints.push(respawn());
    file.battleFinishPoints.push({ position: { ...origin }, rotation: { ...origin }, id: 0, unknown: 0 });
    const found = codes(validateKmpFile(file, { battle: true }));
    expect(found).not.toContain('item-route.missing');
    expect(found).toContain('start.battle-count');
  });

  it('never mentions a raw section code in a user-facing message', () => {
    const file = createEmptyKmpFile();
    file.objects.push(object({ routeIndex: 3, presenceFlags: 0 }));
    file.areas.push(area({ cameraIndex: 5 }));
    file.cameras.push(camera({ nextIndex: 9, routeIndex: 9 }));
    file.checkpoints.push(checkpoint(1, 9));
    file.checkpointGroups.push({ start: 0, length: 1, prev: [], next: [], linkFlags: 0 });
    for (const issue of validateKmpFile(file, { archiveFileNames: [], objects: lookup })) {
      expect(issue.message, issue.code).not.toMatch(/\b(KTPT|ENPT|ENPH|ITPT|ITPH|CKPT|CKPH|GOBJ|POTI|AREA|CAME|JGPT|CNPT|MSPT|STGI)\b/);
      expect(issue.code).toMatch(/^[a-z0-9.\-_]+$/);
      expect(issue.message.length).toBeGreaterThan(10);
    }
  });

  it('sorts and summarises issues', () => {
    const issues: TrackIssue[] = [
      { level: 'warning', code: 'a', message: 'a' },
      { level: 'error', code: 'b', message: 'b' },
      { level: 'warning', code: 'c', message: 'c' },
    ];
    expect(sortIssues(issues).map((issue) => issue.code)).toEqual(['b', 'a', 'c']);
    expect(summarizeIssues(issues)).toEqual({ errors: 1, warnings: 2 });
  });
});
