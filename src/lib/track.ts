import { buildU8, parseU8, type U8Entry } from './u8';
import { decodeYaz0, encodeYaz0Uncompressed, isYaz0 } from './yaz0';
import { getKmpCameraHeader, parseKmp, type KmpDocument, type KmpEntity } from './kmp';
import { parseKcl, type KclMesh } from './kcl';
import { parseNoclipBrresSummary, type NoclipBrresSummary } from './noclipBrres';
import { getObjFlowResourceNames, type CommonResourceArchive } from './objflow';

export interface TrackDocument {
  fileName: string;
  sourceId?: string;
  compressed: boolean;
  archiveEntries: U8Entry[];
  kmp?: KmpDocument;
  kcl?: KclMesh;
  brresFiles: string[];
  brresSummaries: Record<string, NoclipBrresSummary>;
  warnings: string[];
}

export async function loadTrackFile(file: File): Promise<TrackDocument> {
  const raw = new Uint8Array(await file.arrayBuffer());
  return loadTrackBytes(raw, file.name);
}

export interface LoadTrackOptions {
  brresSummaryLimit?: number;
}

export async function loadTrackBytes(raw: Uint8Array, fileName: string, options: LoadTrackOptions = {}): Promise<TrackDocument> {
  const compressed = isYaz0(raw);
  const archiveBytes = decodeYaz0(raw);
  const archiveEntries = parseU8(archiveBytes);
  const warnings: string[] = [];
  const courseKmp = findFile(archiveEntries, 'course.kmp');
  const courseKcl = findFile(archiveEntries, 'course.kcl');
  const brresFiles = archiveEntries.filter((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('.brres')).map((entry) => entry.path);
  const brresSummaries: Record<string, NoclipBrresSummary> = {};
  const brresSummaryLimit = options.brresSummaryLimit ?? 24;

  let kmp: KmpDocument | undefined;
  let kcl: KclMesh | undefined;
  if (courseKmp?.data) {
    try {
      kmp = parseKmp(courseKmp.data);
      warnings.push(...kmp.warnings);
    } catch (error) {
      warnings.push(`course.kmp could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    warnings.push('course.kmp is missing.');
  }

  if (courseKcl?.data) {
    try {
      kcl = parseKcl(courseKcl.data);
      warnings.push(...kcl.warnings);
    } catch (error) {
      warnings.push(`course.kcl could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    warnings.push('course.kcl is missing.');
  }

  for (const entry of archiveEntries.filter((candidate) => candidate.type === 'file' && candidate.path.toLowerCase().endsWith('.brres')).slice(0, brresSummaryLimit)) {
    if (!entry.data) continue;
    try {
      brresSummaries[entry.path] = await parseNoclipBrresSummary(entry.data);
    } catch (error) {
      warnings.push(`${entry.path} could not be parsed by noclip BRRES parser: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { fileName, sourceId: fingerprintBytes(fileName, archiveBytes), compressed, archiveEntries, kmp, kcl, brresFiles, brresSummaries, warnings };
}

export function replaceCourseKmp(track: TrackDocument, data: Uint8Array): TrackDocument {
  return {
    ...track,
    archiveEntries: track.archiveEntries.map((entry) =>
      entry.type === 'file' && entry.path.toLowerCase().endsWith('course.kmp') ? { ...entry, data } : entry,
    ),
    kmp: parseKmp(data),
  };
}

export function replaceArchiveFile(track: TrackDocument, path: string, data: Uint8Array): TrackDocument {
  const normalizedPath = path.replace(/\\/g, '/');
  const existing = track.archiveEntries.some((entry) => entry.type === 'file' && entry.path.toLowerCase() === normalizedPath.toLowerCase());
  return {
    ...track,
    archiveEntries: existing
      ? track.archiveEntries.map((entry) =>
          entry.type === 'file' && entry.path.toLowerCase() === normalizedPath.toLowerCase() ? { ...entry, path: normalizedPath, data } : entry,
        )
      : [...track.archiveEntries, { type: 'file', path: normalizedPath, data }],
  };
}

export interface ExportTrackOptions {
  common?: CommonResourceArchive | null;
}

export function exportTrack(track: TrackDocument, options: ExportTrackOptions = {}): Uint8Array {
  const archive = buildU8(getExportArchiveEntries(track, options.common));
  return track.compressed ? encodeYaz0Uncompressed(archive) : archive;
}

export function validateExportBytes(track: TrackDocument, bytes: Uint8Array, options: ValidateTrackOptions = {}): Array<{ level: 'error' | 'warning'; message: string }> {
  const results: Array<{ level: 'error' | 'warning'; message: string }> = [];
  try {
    if (track.compressed && !isYaz0(bytes)) results.push({ level: 'error', message: 'Export is not Yaz0-compressed although the source track was compressed.' });
    const entries = parseU8(decodeYaz0(bytes));
    const courseKmp = findFile(entries, 'course.kmp');
    const courseKcl = findFile(entries, 'course.kcl');
    const courseModel = findFile(entries, 'course_model.brres');
    let kmp: KmpDocument | undefined;
    let kcl: KclMesh | undefined;
    if (!courseModel?.data) results.push({ level: 'error', message: 'Exported archive is missing course_model.brres.' });
    if (!courseKmp?.data) {
      results.push({ level: 'error', message: 'Exported archive is missing course.kmp.' });
    } else {
      try {
        kmp = parseKmp(courseKmp.data);
      } catch (error) {
        results.push({ level: 'error', message: `Exported course.kmp does not parse: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
    if (!courseKcl?.data) {
      results.push({ level: 'warning', message: 'Exported archive is missing course.kcl.' });
    } else {
      try {
        kcl = parseKcl(courseKcl.data);
      } catch (error) {
        results.push({ level: 'error', message: `Exported course.kcl does not parse: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
    const exportedTrack: TrackDocument = {
      ...track,
      archiveEntries: entries,
      kmp,
      kcl,
      brresFiles: entries.filter((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('.brres')).map((entry) => entry.path),
      warnings: [],
    };
    results.push(...validateTrack(exportedTrack, options));
  } catch (error) {
    results.push({ level: 'error', message: `Exported SZS could not be reopened: ${error instanceof Error ? error.message : String(error)}` });
  }
  return results;
}

export function getExportArchiveEntries(track: TrackDocument, common?: CommonResourceArchive | null): U8Entry[] {
  if (!common || !track.kmp) return track.archiveEntries;

  const out = [...track.archiveEntries];
  const existingBaseNames = new Set(
    out
      .filter((entry) => entry.type === 'file')
      .map((entry) => entry.path.split('/').pop()?.toLowerCase())
      .filter((name): name is string => !!name),
  );

  for (const objectId of getUsedObjectIds(track.kmp.entities)) {
    const objFlowEntry = common.objFlow.byId.get(objectId);
    if (!objFlowEntry) continue;
    for (const resourceName of getObjFlowResourceNames(objFlowEntry)) {
      const baseName = resourceName.toLowerCase();
      if (existingBaseNames.has(baseName)) continue;
      const source = common.byBaseName.get(baseName);
      if (!source?.data) continue;
      out.push({ path: resourceName, type: 'file', data: new Uint8Array(source.data) });
      existingBaseNames.add(baseName);
    }
  }

  return out;
}

export interface ValidateTrackOptions {
  common?: CommonResourceArchive | null;
}

const ROUTE_REQUIRED_OBJECT_NAMES = new Map<number, string>([
  [0x005, 'sound_river'],
  [0x006, 'sound_water_fall'],
  [0x008, 'sound_lake'],
  [0x009, 'sound_big_fall'],
  [0x00a, 'sound_sea'],
  [0x00b, 'sound_fountain'],
  [0x00c, 'sound_volcano'],
  [0x00d, 'sound_audience'],
  [0x00e, 'sound_big_river'],
  [0x00f, 'sound_sand_fall'],
  [0x010, 'sound_lift'],
  [0x015, 'sound_Mii'],
  [0x072, 'sunDS'],
  [0x099, 'f_itembox'],
  [0x0b6, 'MashBalloonGC'],
  [0x0c3, 'CarA1'],
  [0x0cc, 'basabasa'],
  [0x0ce, 'HeyhoShipGBA'],
  [0x0cf, 'koopaBall'],
  [0x0d0, 'kart_truck'],
  [0x0d1, 'car_body'],
  [0x0d2, 'skyship'],
  [0x0d3, 'w_woodbox'],
  [0x0d4, 'w_itembox'],
  [0x0d5, 'w_itemboxline'],
  [0x0d6, 'VolcanoBall1'],
  [0x0d7, 'penguin_s'],
  [0x0d8, 'penguin_m'],
  [0x0d9, 'penguin_l'],
  [0x0da, 'castleballoon1'],
  [0x0dd, 'boble'],
  [0x0de, 'K_bomb_car'],
  [0x0e2, 'hanachan'],
  [0x0e3, 'seagull'],
  [0x0e4, 'moray'],
  [0x0e5, 'crab'],
  [0x0e7, 'CarA2'],
  [0x0e8, 'CarA3'],
  [0x0e9, 'Hwanwan'],
  [0x0eb, 'Twanwan'],
  [0x0ec, 'cruiserR'],
  [0x0ed, 'bird'],
  [0x0ee, 'sin_itembox'],
  [0x190, 'heyho2'],
  [0x191, 'kuribo'],
  [0x192, 'choropu'],
  [0x193, 'cow'],
  [0x198, 'DKrockGC'],
  [0x199, 'sanbo'],
  [0x19b, 'TruckWagon'],
  [0x19c, 'heyho'],
  [0x1f5, 'DKship64'],
  [0x253, 'venice_gondola'],
  [0x257, 'RM_ring1'],
]);

export function validateTrack(track: TrackDocument, options: ValidateTrackOptions = {}): Array<{ level: 'error' | 'warning'; message: string }> {
  const results: Array<{ level: 'error' | 'warning'; message: string }> = [];
  if (!findFile(track.archiveEntries, 'course_model.brres')) results.push({ level: 'error', message: 'course_model.brres is missing.' });
  if (!findFile(track.archiveEntries, 'course.kmp')) results.push({ level: 'error', message: 'course.kmp is missing.' });
  if (!findFile(track.archiveEntries, 'course.kcl')) results.push({ level: 'warning', message: 'course.kcl is missing; snapping and collision overlay are unavailable.' });
  if (!track.kmp) return results;

  const count = (section: string) => track.kmp?.sections.find((candidate) => candidate.name === section)?.count ?? 0;
  if (count('KTPT') === 0) results.push({ level: 'error', message: 'No start position is defined.' });
  if (count('CKPT') === 0) results.push({ level: 'error', message: 'Checkpoints are missing.' });
  if (count('JGPT') === 0) results.push({ level: 'warning', message: 'Respawn points are missing.' });
  if (count('ENPT') > 0 && count('ENPH') === 0) results.push({ level: 'warning', message: 'Enemy route points exist without enemy path groups.' });
  if (count('ITPT') > 0 && count('ITPH') === 0) results.push({ level: 'warning', message: 'Item route points exist without item path groups.' });
  if (count('CKPT') > 0 && count('CKPH') === 0) results.push({ level: 'warning', message: 'Checkpoints exist without checkpoint path groups.' });
  for (const graph of track.kmp.pathGraphs) {
    const pointCount = track.kmp.entities.filter((entity) => entity.section === graph.pointSection).length;
    const groupedPointCount = graph.groups.reduce((sum, group) => sum + group.pointCount, 0);
    if (groupedPointCount !== pointCount) {
      results.push({ level: 'warning', message: `${graph.pointSection}/${graph.groupSection} groups cover ${groupedPointCount}/${pointCount} points.` });
    }
    if (pointCount > 1 && graph.edges.length === 0) {
      results.push({ level: 'warning', message: `${graph.pointSection}/${graph.groupSection} has points but no path connections.` });
      continue;
    }
    const connected = connectedPointCount(pointCount, graph.edges);
    if (connected > 0 && connected < pointCount) {
      results.push({ level: 'warning', message: `${graph.pointSection}/${graph.groupSection} appears disconnected (${connected}/${pointCount} reachable).` });
    }
  }

  const potiCount = track.kmp.routes.length || count('POTI');
  const cameraCount = count('CAME');
  if (cameraCount > 0) {
    const cameraHeader = getKmpCameraHeader(track.kmp);
    if (cameraHeader.firstIntroCam !== 0xff && cameraHeader.firstIntroCam >= cameraCount) {
      results.push({ level: 'warning', message: `CAME intro start references missing camera ${cameraHeader.firstIntroCam}.` });
    }
    if (cameraHeader.firstSelectionCam !== 0xff && cameraHeader.firstSelectionCam >= cameraCount) {
      results.push({ level: 'warning', message: `CAME selection start references missing camera ${cameraHeader.firstSelectionCam}.` });
    }
  }
  const checkpointCount = count('CKPT');
  const respawnCount = count('JGPT');
  for (const entity of track.kmp.entities) {
    if (entity.checkpoint) {
      if (entity.checkpoint.respawnIndex !== 0xff && entity.checkpoint.respawnIndex >= respawnCount) {
        results.push({ level: 'warning', message: `Checkpoint ${entity.index} references missing respawn point ${entity.checkpoint.respawnIndex}.` });
      }
      if (entity.checkpoint.prev !== 0xff && entity.checkpoint.prev >= checkpointCount) {
        results.push({ level: 'warning', message: `Checkpoint ${entity.index} references missing previous checkpoint ${entity.checkpoint.prev}.` });
      }
      if (entity.checkpoint.next !== 0xff && entity.checkpoint.next >= checkpointCount) {
        results.push({ level: 'warning', message: `Checkpoint ${entity.index} references missing next checkpoint ${entity.checkpoint.next}.` });
      }
    }
    if (entity.section === 'GOBJ' && entity.routeIndex !== undefined && entity.routeIndex !== 0xffff && entity.routeIndex >= potiCount) {
      results.push({ level: 'warning', message: `Object ${entity.index} references missing route ${entity.routeIndex}.` });
    }
    if (entity.area) {
      if (entity.area.routeIndex !== 0xff && entity.area.routeIndex >= potiCount) results.push({ level: 'warning', message: `Area ${entity.index} references missing route ${entity.area.routeIndex}.` });
      if (entity.area.cameraIndex !== 0xff && entity.area.cameraIndex >= cameraCount) results.push({ level: 'warning', message: `Area ${entity.index} references missing camera ${entity.area.cameraIndex}.` });
    }
    if (entity.camera) {
      if (entity.camera.routeIndex !== 0xff && entity.camera.routeIndex >= potiCount) results.push({ level: 'warning', message: `Camera ${entity.index} references missing route ${entity.camera.routeIndex}.` });
      if (entity.camera.nextCam !== 0xff && entity.camera.nextCam >= cameraCount) results.push({ level: 'warning', message: `Camera ${entity.index} references missing next camera ${entity.camera.nextCam}.` });
    }
  }
  results.push(...validateObjectResources(track, options.common));
  results.push(...validateObjectPresenceFlags(track, options.common));
  results.push(...validateItemBoxSettings(track, options.common));
  results.push(...validateKnownObjectPitfalls(track));
  return results;
}

export function describeEntity(entity: KmpEntity): string {
  if (entity.section === 'GOBJ') return `game object #${entity.index}`;
  if (entity.section === 'POTI' && entity.routePoint) return `object route point ${entity.routePoint.pointIndex}`;
  switch (entity.section) {
    case 'KTPT':
      return `start point #${entity.index}`;
    case 'ENPT':
      return `enemy route point #${entity.index}`;
    case 'ITPT':
      return `item route point #${entity.index}`;
    case 'CKPT':
      return `checkpoint #${entity.index}`;
    case 'AREA':
      return `area trigger #${entity.index}`;
    case 'CAME':
      return `camera #${entity.index}`;
    case 'JGPT':
      return `respawn point #${entity.index}`;
    case 'CNPT':
      return `cannon point #${entity.index}`;
    case 'MSPT':
      return `battle finish point #${entity.index}`;
    case 'STGI':
      return 'track settings';
    default:
      return `${entity.section.toLowerCase()} #${entity.index}`;
  }
}

function findFile(entries: U8Entry[], fileName: string): U8Entry | undefined {
  const target = fileName.toLowerCase();
  return entries.find((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith(target));
}

function getUsedObjectIds(entities: KmpEntity[]): number[] {
  return [...new Set(entities.filter((entity) => entity.section === 'GOBJ' && entity.objectId !== undefined).map((entity) => entity.objectId!))];
}

function fingerprintBytes(name: string, data: Uint8Array): string {
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(data.length / 8192));
  for (let i = 0; i < data.length; i += step) {
    hash ^= data[i];
    hash = Math.imul(hash, 16777619);
  }
  return `${name}:${data.length}:${hash >>> 0}`;
}

function validateObjectResources(track: TrackDocument, common?: CommonResourceArchive | null): Array<{ level: 'error' | 'warning'; message: string }> {
  if (!track.kmp) return [];
  const objectIds = getUsedObjectIds(track.kmp.entities);
  if (objectIds.length === 0) return [];
  if (!common) return [{ level: 'warning', message: 'Common.szs is not loaded; object resource validation is unavailable.' }];

  const results: Array<{ level: 'error' | 'warning'; message: string }> = [];
  const existingBaseNames = new Set(
    track.archiveEntries
      .filter((entry) => entry.type === 'file')
      .map((entry) => entry.path.split('/').pop()?.toLowerCase())
      .filter((name): name is string => !!name),
  );

  for (const objectId of objectIds) {
    const objFlowEntry = common.objFlow.byId.get(objectId);
    if (!objFlowEntry) {
      results.push({ level: 'warning', message: `Object ${objectId.toString(16).toUpperCase()} has no ObjFlow definition in Common.szs.` });
      continue;
    }
    for (const resourceName of getObjFlowResourceNames(objFlowEntry)) {
      const baseName = resourceName.toLowerCase();
      if (existingBaseNames.has(baseName) || common.byBaseName.has(baseName)) continue;
      results.push({ level: 'warning', message: `Object ${objectId.toString(16).toUpperCase()} references missing resource ${resourceName}.` });
    }
  }

  return results;
}

function validateObjectPresenceFlags(track: TrackDocument, common?: CommonResourceArchive | null): Array<{ level: 'error' | 'warning'; message: string }> {
  if (!track.kmp || !common) return [];
  const results: Array<{ level: 'error' | 'warning'; message: string }> = [];
  for (const entity of track.kmp.entities) {
    if (entity.section !== 'GOBJ' || entity.objectId === undefined || entity.presenceFlags === undefined) continue;
    const objFlowEntry = common.objFlow.byId.get(entity.objectId);
    if (!objFlowEntry || !objectHasGameplayImpact(objFlowEntry)) continue;
    const modeFlags = entity.presenceFlags & 0x0007;
    if ((modeFlags & 0x0006) !== 0x0006) {
      results.push({
        level: 'warning',
        message: `Object ${entity.index} is a gameplay object but is hidden for some multiplayer player counts (${formatPresenceFlagsHex(entity.presenceFlags)}).`,
      });
    }
  }
  return results;
}

function validateItemBoxSettings(track: TrackDocument, common?: CommonResourceArchive | null): Array<{ level: 'error' | 'warning'; message: string }> {
  if (!track.kmp || !common) return [];
  const results: Array<{ level: 'error' | 'warning'; message: string }> = [];
  for (const entity of track.kmp.entities) {
    if (!isItemBoxObject(entity, common) || !entity.objectSettings) continue;
    const playerSetting = entity.objectSettings[1];
    const cpuSetting = entity.objectSettings[2];
    const timingSetting = entity.objectSettings[5];
    if (!isValidItemBoxItemSetting(playerSetting)) {
      results.push({ level: 'warning', message: `Object ${entity.index} has unsupported player item-box setting ${formatPresenceFlagsHex(playerSetting)}.` });
    }
    if (!isValidItemBoxItemSetting(cpuSetting)) {
      results.push({ level: 'warning', message: `Object ${entity.index} has unsupported CPU item-box setting ${formatPresenceFlagsHex(cpuSetting)}.` });
    }
    if (!isValidItemBoxTimingSetting(timingSetting)) {
      results.push({ level: 'warning', message: `Object ${entity.index} has unsupported item-box timing setting ${formatPresenceFlagsHex(timingSetting)}.` });
    }
  }
  return results;
}

function validateKnownObjectPitfalls(track: TrackDocument): Array<{ level: 'error' | 'warning'; message: string }> {
  if (!track.kmp) return [];
  const results: Array<{ level: 'error' | 'warning'; message: string }> = [];
  const objects = track.kmp.entities.filter((entity) => entity.section === 'GOBJ' && entity.objectId !== undefined);
  for (const entity of objects) {
    const routeRequiredName = ROUTE_REQUIRED_OBJECT_NAMES.get(entity.objectId!);
    if (!routeRequiredName || entity.routeIndex === undefined || entity.routeIndex !== 0xffff) continue;
    results.push({
      level: 'warning',
      message: `Object ${entity.index} (${routeRequiredName}) requires a route but does not have one.`,
    });
  }
  const slotRestrictedObjects = new Map<number, string>([
    [0x72, 'sunDS'],
    [0x144, 'pylon01'],
    [0x1a3, 'begoman_spike'],
    [0x1a4, 'FireSnake'],
    [0x1a8, 'FireSnake_v'],
  ]);
  const hasChoropu = objects.some((entity) => entity.objectId === 0x192);
  const hasChoropu2 = objects.some((entity) => entity.objectId === 0x19a);
  if (hasChoropu && hasChoropu2) {
    results.push({
      level: 'warning',
      message: 'Monty Mole variants choropu and choropu2 are both present; vanilla Mario Kart Wii uses the same BRRES file for them and this combination is known to break.',
    });
  }

  for (const entity of objects) {
    if ((entity.objectId === 0x214 || entity.objectId === 0x215) && entity.objectSettings && entity.objectSettings[2] === 0) {
      results.push({
        level: 'warning',
        message: `Object ${entity.index} (${entity.objectId === 0x214 ? 'InsekiA' : 'InsekiB'}) has Setting 3 left at 0, which is known to crash vanilla Mario Kart Wii.`,
      });
    }
    if (entity.objectId === 0x206) {
      const centered = Math.abs(entity.position.x) < 0.001 && Math.abs(entity.position.y) < 0.001 && Math.abs(entity.position.z) < 0.001;
      const unrotated = Math.abs(entity.rotation.x) < 0.001 && Math.abs(entity.rotation.y) < 0.001 && Math.abs(entity.rotation.z) < 0.001;
      const unitScale =
        entity.scale !== undefined &&
        Math.abs(entity.scale.x - 1) < 0.001 &&
        Math.abs(entity.scale.y - 1) < 0.001 &&
        Math.abs(entity.scale.z - 1) < 0.001;
      if (!centered || !unrotated || !unitScale) {
        results.push({
          level: 'warning',
          message: `Object ${entity.index} (casino_roulette) should stay at world position 0,0,0 with zero rotation and scale 1,1,1 or the rotating-road gimmick can break.`,
        });
      }
    }
  }

  const slotRestrictedNames = Array.from(new Set(objects.map((entity) => slotRestrictedObjects.get(entity.objectId!)).filter((name): name is string => name !== undefined)));
  if (slotRestrictedNames.length > 0) {
    results.push({
      level: 'warning',
      message: `This track uses slot-restricted objects (${slotRestrictedNames.join(', ')}). In vanilla Mario Kart Wii these only work on Daisy Circuit, Moonview Highway, GBA Shy Guy Beach, DS Desert Hills, or Galaxy Colosseum.`,
    });
  }

  const firstBegomanSpike = objects.find((entity) => entity.objectId === 0x1a3);
  if (firstBegomanSpike && objects[0] !== firstBegomanSpike) {
    results.push({
      level: 'warning',
      message: 'begoman_spike must be the first placed game object in the object list or it will not spawn correctly in vanilla Mario Kart Wii.',
    });
  }

  for (const objectId of [0x2e8, 0x2e9, 0x2ea]) {
    const count = objects.filter((entity) => entity.objectId === objectId).length;
    if (count > 1) {
      const name = objectId === 0x2e8 ? 'MiiObjD01' : objectId === 0x2e9 ? 'MiiObjD02' : 'MiiObjD03';
      results.push({
        level: 'warning',
        message: `${name} is placed ${count} times. Vanilla Mario Kart Wii allows at most one instance of this Daisy Circuit Mii audience object before it crashes.`,
      });
    }
  }
  return results;
}

function connectedPointCount(pointCount: number, edges: Array<{ from: number; to: number }>): number {
  if (pointCount === 0) return 0;
  const adjacency = Array.from({ length: pointCount }, () => new Set<number>());
  for (const edge of edges) {
    if (edge.from < 0 || edge.from >= pointCount || edge.to < 0 || edge.to >= pointCount) continue;
    adjacency[edge.from].add(edge.to);
    adjacency[edge.to].add(edge.from);
  }
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const point = queue.shift()!;
    for (const next of adjacency[point]) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size;
}

function objectHasGameplayImpact(entry: CommonResourceArchive['objFlow']['entries'][number]): boolean {
  const text = `${entry.name} ${entry.resources}`.toLowerCase();
  return /(itembox|item box|f_itembox|s_itembox|w_itembox|sin_itembox|w_itemboxline|kuribo|goomba|choropu|choropu2|choropu_ground|pakkun_f|puchi_pakkun|pakkun_dokan|crab|tree_cannon|donkycannon|cannon|k_sticklift00|kinoko_lift1|escalator|belt|pendulum)/.test(text);
}

function isItemBoxObject(entity: KmpEntity, common: CommonResourceArchive): boolean {
  if (entity.section !== 'GOBJ' || entity.objectId === undefined) return false;
  const entry = common.objFlow.byId.get(entity.objectId);
  const text = `${entry?.name ?? ''} ${entry?.resources ?? ''}`.toLowerCase();
  return /(^|\s)(itembox|f_itembox|s_itembox|w_itembox|sin_itembox|w_itemboxline)(\s|$)/.test(text);
}

function isValidItemBoxItemSetting(value: number): boolean {
  return (value >= 0x0000 && value <= 0x0010) || value === 0x0255;
}

function isValidItemBoxTimingSetting(value: number): boolean {
  return value === 0x0000 || value === 0x0002 || value === 0x0003 || value === 0x0004 || value === 0x0005 || value === 0x0006;
}

function formatPresenceFlagsHex(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
}
