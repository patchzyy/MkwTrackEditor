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
  return results;
}

export function describeEntity(entity: KmpEntity): string {
  if (entity.section === 'GOBJ') return `Object ${entity.objectId ?? 'unknown'} #${entity.index}`;
  if (entity.section === 'POTI' && entity.routePoint) return `Route ${entity.routePoint.routeIndex} node ${entity.routePoint.pointIndex}`;
  return `${entity.section} #${entity.index}`;
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
