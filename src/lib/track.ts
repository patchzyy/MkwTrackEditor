import { buildU8, parseU8, parseU8WithLayout, type U8Entry, type U8Layout } from './u8';
import { decodeYaz0, encodeYaz0, isYaz0 } from './yaz0';
import { parseKmp, type KmpDocument, type KmpEntity } from './kmp';
import { readKmpFile, type KmpFile } from './kmpFile';
import { validateKmpFile, validateTrackFiles, type ObjectResourceLookup, type TrackIssue } from './kmpValidation';
import { parseKcl, type KclMesh } from './kcl';
import { parseNoclipBrresSummary, type NoclipBrresSummary } from './noclipBrres';
import { getObjFlowResourceNames, type CommonResourceArchive } from './objflow';
import { bakeCourseModel, type BakeWarning } from './brres/bakeCourseModel';
import type { ImportedMesh, MeshEdit } from './brresEditor';

export type { TrackIssue } from './kmpValidation';

export interface TrackDocument {
  fileName: string;
  sourceId?: string;
  compressed: boolean;
  archiveEntries: U8Entry[];
  /** Layout of the source archive, so untouched files repack byte-for-byte. */
  archiveLayout?: U8Layout;
  kmp?: KmpDocument;
  /** Fully structured, losslessly round-trippable view of `course.kmp`. */
  kmpFile?: KmpFile;
  kcl?: KclMesh;
  brresFiles: string[];
  brresSummaries: Record<string, NoclipBrresSummary>;
  warnings: string[];
  /** Model-mode mesh edits, baked into `course_model.brres` on export. */
  meshEdits?: MeshEdit[];
  /** Objects placed as course geometry in Model mode, merged into the course model on export. */
  importedMeshes?: ImportedMesh[];
  /**
   * BRRES bytes for each `ImportedMesh.sourcePath`. Held on the document so exporting stays
   * synchronous and does not have to reach back into the content browser.
   */
  meshImportSources?: Record<string, Uint8Array>;
}

/** Where in the archive the geometry the Model mode edits lives. */
export const COURSE_MODEL_PATH = './course_model.brres';

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
  const { entries: archiveEntries, layout: archiveLayout } = parseU8WithLayout(archiveBytes);
  const warnings: string[] = [];
  const courseKmp = findFile(archiveEntries, 'course.kmp');
  const courseKcl = findFile(archiveEntries, 'course.kcl');
  const brresFiles = archiveEntries.filter((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('.brres')).map((entry) => entry.path);
  const brresSummaries: Record<string, NoclipBrresSummary> = {};
  const brresSummaryLimit = options.brresSummaryLimit ?? 24;

  let kmp: KmpDocument | undefined;
  let kmpFile: KmpFile | undefined;
  let kcl: KclMesh | undefined;
  if (courseKmp?.data) {
    try {
      kmp = parseKmp(courseKmp.data);
      kmpFile = readKmpFile(courseKmp.data);
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

  return {
    fileName,
    sourceId: fingerprintBytes(fileName, archiveBytes),
    compressed,
    archiveEntries,
    archiveLayout,
    kmp,
    kmpFile,
    kcl,
    brresFiles,
    brresSummaries,
    warnings,
  };
}

export function replaceCourseKmp(track: TrackDocument, data: Uint8Array): TrackDocument {
  return {
    ...track,
    archiveEntries: track.archiveEntries.map((entry) =>
      entry.type === 'file' && entry.path.toLowerCase().endsWith('course.kmp') ? { ...entry, data } : entry,
    ),
    kmp: parseKmp(data),
    kmpFile: readKmpFile(data),
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
  /**
   * How hard the Yaz0 compressor searches for back-references. The default of 16 matches
   * Nintendo's own compression ratio and takes a few hundred milliseconds for a full track.
   */
  compressionSearchDepth?: number;
  /** Force compression on or off; defaults to matching the source archive. */
  compress?: boolean;
}

export function exportTrack(track: TrackDocument, options: ExportTrackOptions = {}): Uint8Array {
  const entries = getExportArchiveEntries(track, options.common);
  // The captured layout only applies when the entry list is unchanged; `buildU8` checks that
  // and falls back to a freshly computed layout otherwise.
  const archive = buildU8(entries, track.archiveLayout);
  const compress = options.compress ?? track.compressed;
  return compress ? encodeYaz0(archive, { searchDepth: options.compressionSearchDepth ?? 16 }) : archive;
}

/**
 * Re-opens an exported `.szs` and validates it as if the user had just dropped it in. This
 * is the last line of defence: it proves the file the user is about to download is one the
 * editor itself can read back.
 */
export function validateExportBytes(track: TrackDocument, bytes: Uint8Array, options: ValidateTrackOptions = {}): TrackIssue[] {
  const results: TrackIssue[] = [];
  try {
    if (track.compressed && !isYaz0(bytes)) {
      results.push({ level: 'error', code: 'export.not-compressed', message: 'The exported track is not compressed, although the original track was.' });
    }
    const entries = parseU8(decodeYaz0(bytes));
    const courseKmp = findFile(entries, 'course.kmp');
    const courseKcl = findFile(entries, 'course.kcl');
    let kmp: KmpDocument | undefined;
    let kmpFile: KmpFile | undefined;
    let kcl: KclMesh | undefined;
    if (courseKmp?.data) {
      try {
        kmp = parseKmp(courseKmp.data);
        kmpFile = readKmpFile(courseKmp.data);
      } catch (error) {
        results.push({
          level: 'error',
          code: 'export.kmp-unreadable',
          message: `The exported track layout cannot be read back: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    if (courseKcl?.data) {
      try {
        kcl = parseKcl(courseKcl.data);
      } catch (error) {
        results.push({
          level: 'error',
          code: 'export.kcl-unreadable',
          message: `The exported collision mesh cannot be read back: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    const exportedTrack: TrackDocument = {
      ...track,
      archiveEntries: entries,
      archiveLayout: undefined,
      kmp,
      kmpFile,
      kcl,
      brresFiles: entries.filter((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('.brres')).map((entry) => entry.path),
      warnings: [],
    };
    results.push(...validateTrack(exportedTrack, options));
  } catch (error) {
    results.push({
      level: 'error',
      code: 'export.unreadable',
      message: `The exported track could not be re-opened: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  return results;
}

/**
 * Folds the Model-mode edits into `course_model.brres`. Returns the entry list unchanged, and
 * the very same `Uint8Array`s, when there is nothing to bake — that is what keeps an untouched
 * track exporting byte-for-byte.
 */
export function bakeMeshEdits(entries: readonly U8Entry[], track: TrackDocument): { entries: U8Entry[]; warnings: BakeWarning[] } {
  const edits = track.meshEdits ?? [];
  const imports = track.importedMeshes ?? [];
  if (edits.length === 0 && imports.length === 0) return { entries: [...entries], warnings: [] };

  const index = entries.findIndex(
    (entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('course_model.brres') && entry.data,
  );
  if (index < 0) {
    return {
      entries: [...entries],
      warnings: [{ code: 'model.no-course-model', message: 'This track has no course model, so the geometry edits were left out of the export.' }],
    };
  }

  const importSources = new Map<string, Uint8Array>(Object.entries(track.meshImportSources ?? {}));
  const result = bakeCourseModel(entries[index].data!, { edits, importedMeshes: imports, importSources });
  if (!result.changed) return { entries: [...entries], warnings: result.warnings };

  const next = [...entries];
  next[index] = { ...next[index], data: result.data };
  return { entries: next, warnings: result.warnings };
}

export function getExportArchiveEntries(track: TrackDocument, common?: CommonResourceArchive | null): U8Entry[] {
  const baked = bakeMeshEdits(track.archiveEntries, track).entries;
  if (!common || !track.kmp) return baked;

  const out = [...baked];
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

export function validateTrack(track: TrackDocument, options: ValidateTrackOptions = {}): TrackIssue[] {
  const archiveFileNames = track.archiveEntries.filter((entry) => entry.type === 'file').map((entry) => entry.path);
  // Callers that build a TrackDocument by hand may not have populated `kmpFile`, so fall
  // back to reading it straight out of the archive.
  const kmpFile = track.kmpFile ?? tryReadCourseKmp(track);
  if (!kmpFile) {
    return [
      ...validateTrackFiles(archiveFileNames),
      ...(findFile(track.archiveEntries, 'course.kmp')
        ? [{ level: 'error' as const, code: 'kmp.unreadable', message: 'The track layout data could not be read.' }]
        : []),
    ];
  }

  return [
    ...validateKmpFile(kmpFile, {
      archiveFileNames,
      objects: options.common ? createObjectLookup(options.common) : null,
      battle: isBattleTrack(kmpFile),
    }),
    ...validateObjectPresenceFlags(track, options.common),
    ...validateItemBoxSettings(track, options.common),
    ...validateKnownObjectPitfalls(track),
  ];
}

function tryReadCourseKmp(track: TrackDocument): KmpFile | undefined {
  const data = findFile(track.archiveEntries, 'course.kmp')?.data;
  if (!data) return undefined;
  try {
    return readKmpFile(data);
  } catch {
    return undefined;
  }
}

/** Battle arenas have no item route and no checkpoints, but do have battle finish points. */
function isBattleTrack(file: KmpFile): boolean {
  return file.itemPoints.length === 0 && file.checkpoints.length === 0 && file.battleFinishPoints.length > 0;
}

function createObjectLookup(common: CommonResourceArchive): ObjectResourceLookup {
  return {
    objectName: (objectId) => common.objFlow.byId.get(objectId)?.name ?? null,
    objectResources: (objectId) => {
      const entry = common.objFlow.byId.get(objectId);
      return entry ? getObjFlowResourceNames(entry) : [];
    },
    hasCommonResource: (resourceName) => common.byBaseName.has(resourceName.toLowerCase()),
  };
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

function validateObjectPresenceFlags(track: TrackDocument, common?: CommonResourceArchive | null): TrackIssue[] {
  if (!track.kmp || !common) return [];
  const results: TrackIssue[] = [];
  for (const entity of track.kmp.entities) {
    if (entity.section !== 'GOBJ' || entity.objectId === undefined || entity.presenceFlags === undefined) continue;
    const objFlowEntry = common.objFlow.byId.get(entity.objectId);
    if (!objFlowEntry || !objectHasGameplayImpact(objFlowEntry)) continue;
    const modeFlags = entity.presenceFlags & 0x0007;
    if ((modeFlags & 0x0006) !== 0x0006) {
      results.push({
        level: 'warning',
        code: 'object.presence-uneven',
        message: `Object #${entity.index} (${objFlowEntry.name}) affects gameplay but is hidden for some player counts, which gives split-screen players an unfair advantage.`,
        entityId: entity.id,
      });
    }
  }
  return results;
}

function validateItemBoxSettings(track: TrackDocument, common?: CommonResourceArchive | null): TrackIssue[] {
  if (!track.kmp || !common) return [];
  const results: TrackIssue[] = [];
  for (const entity of track.kmp.entities) {
    if (!isItemBoxObject(entity, common) || !entity.objectSettings) continue;
    const playerSetting = entity.objectSettings[1];
    const cpuSetting = entity.objectSettings[2];
    const timingSetting = entity.objectSettings[5];
    if (!isValidItemBoxItemSetting(playerSetting)) {
      results.push({ level: 'warning', code: 'itembox.player-item', message: `Item box #${entity.index} gives players an item the game does not recognise.`, entityId: entity.id });
    }
    if (!isValidItemBoxItemSetting(cpuSetting)) {
      results.push({ level: 'warning', code: 'itembox.cpu-item', message: `Item box #${entity.index} gives computer drivers an item the game does not recognise.`, entityId: entity.id });
    }
    if (!isValidItemBoxTimingSetting(timingSetting)) {
      results.push({ level: 'warning', code: 'itembox.timing', message: `Item box #${entity.index} uses a respawn timing the game does not recognise.`, entityId: entity.id });
    }
  }
  return results;
}

function validateKnownObjectPitfalls(track: TrackDocument): TrackIssue[] {
  if (!track.kmp) return [];
  const results: TrackIssue[] = [];
  const objects = track.kmp.entities.filter((entity) => entity.section === 'GOBJ' && entity.objectId !== undefined);
  for (const entity of objects) {
    const routeRequiredName = ROUTE_REQUIRED_OBJECT_NAMES.get(entity.objectId!);
    if (!routeRequiredName || entity.routeIndex === undefined || entity.routeIndex !== 0xffff) continue;
    results.push({
      level: 'warning',
      code: 'object.route-required',
      message: `Object #${entity.index} (${routeRequiredName}) needs a route to move along but none is assigned.`,
      entityId: entity.id,
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
      code: 'object.choropu-conflict',
      message: 'Both Monty Mole variants are placed. They share one model file in the retail game, and using both is known to break.',
    });
  }

  for (const entity of objects) {
    if ((entity.objectId === 0x214 || entity.objectId === 0x215) && entity.objectSettings && entity.objectSettings[2] === 0) {
      results.push({
        level: 'error',
        code: 'object.inseki-setting',
        message: `Object #${entity.index} (${entity.objectId === 0x214 ? 'InsekiA' : 'InsekiB'}) has its third setting left at 0, which crashes the retail game.`,
        entityId: entity.id,
      });
    }
    if (entity.objectId === 0x206) {
      const centered = Math.abs(entity.position.x) < 0.001 && Math.abs(entity.position.y) < 0.001 && Math.abs(entity.position.z) < 0.001;
      const rotation = entity.rotation ?? { x: 0, y: 0, z: 0 };
      const unrotated = Math.abs(rotation.x) < 0.001 && Math.abs(rotation.y) < 0.001 && Math.abs(rotation.z) < 0.001;
      const unitScale =
        entity.scale !== undefined &&
        Math.abs(entity.scale.x - 1) < 0.001 &&
        Math.abs(entity.scale.y - 1) < 0.001 &&
        Math.abs(entity.scale.z - 1) < 0.001;
      if (!centered || !unrotated || !unitScale) {
        results.push({
          level: 'warning',
          code: 'object.roulette-transform',
          message: `Object #${entity.index} (the casino roulette) must stay at position 0,0,0 with no rotation and scale 1 or its rotating road stops working.`,
          entityId: entity.id,
        });
      }
    }
  }

  const slotRestrictedNames = Array.from(new Set(objects.map((entity) => slotRestrictedObjects.get(entity.objectId!)).filter((name): name is string => name !== undefined)));
  if (slotRestrictedNames.length > 0) {
    results.push({
      level: 'warning',
      code: 'object.slot-restricted',
      message: `This track uses objects (${slotRestrictedNames.join(', ')}) that only work on the Daisy Circuit, Moonview Highway, GBA Shy Guy Beach, DS Desert Hills or Galaxy Colosseum track slots.`,
    });
  }

  const firstBegomanSpike = objects.find((entity) => entity.objectId === 0x1a3);
  if (firstBegomanSpike && objects[0] !== firstBegomanSpike) {
    results.push({
      level: 'warning',
      code: 'object.begoman-order',
      message: 'The spiked Bomb Boo must be the first object in the list or it will not spawn correctly.',
      entityId: firstBegomanSpike.id,
    });
  }

  for (const objectId of [0x2e8, 0x2e9, 0x2ea]) {
    const count = objects.filter((entity) => entity.objectId === objectId).length;
    if (count > 1) {
      const name = objectId === 0x2e8 ? 'MiiObjD01' : objectId === 0x2e9 ? 'MiiObjD02' : 'MiiObjD03';
      results.push({
        level: 'warning',
        code: 'object.mii-audience-duplicate',
        message: `The Daisy Circuit Mii audience object ${name} is placed ${count} times; more than one crashes the retail game.`,
      });
    }
  }
  return results;
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

