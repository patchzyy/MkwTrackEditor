/**
 * Whole-pipeline correctness check for one track, shared by two runners:
 *
 * - `scripts/batch-track-check.mjs` runs it over every real `.szs` installed on this machine.
 * - `src/lib/batch/trackPipelineCheck.test.ts` runs it over a small subset as part of `vitest`.
 *
 * The check walks the same path the app does — load, parse, edit, export, re-open — and asserts
 * at every stage. It is deliberately free of React and of `node:fs`: the runner supplies bytes.
 *
 * The rule for "pass" is *no worse than the source*. Real tracks (especially ported custom ones)
 * ship with their own validation errors, so an edit is judged by whether it introduces a problem
 * that was not already there, never by whether the result is clean.
 *
 * What "exports identically" means, precisely:
 *
 * - The **U8 archive inside** the `.szs` is byte-identical for an untouched track. That is the
 *   claim `export-unedited-identical` makes, and it is the one that matters: every file, every
 *   offset, every byte of padding is reproduced from the captured `U8Layout`.
 * - The **compressed `.szs` file** is *not* byte-identical, and cannot be. Yaz0 has no canonical
 *   encoding, and this compressor is not Nintendo's; re-compressing a real track lands within
 *   about 1% of the original size. `yaz0-roundtrip` therefore proves the weaker but sufficient
 *   property: the stream decompresses to exactly the archive that went in.
 */

import { readBrresRaw, makeSubFileNameReader, BRRES_MODELS_GROUP } from '../brres/brresRaw';
import { Mdl0Editor } from '../brres/mdl0Raw';
import { collectDrawOps } from '../brres/meshBake';
import { createIdentityMeshTransform, type EditorMeshTarget, type ImportedMesh, type MeshEdit } from '../brresEditor';
import { KMP_NULL_INDEX_8, readKmpFile, writeKmpFile, type KmpFile } from '../kmpFile';
import {
  assignNearestRespawns,
  createEnemyPoint,
  editPathGraph,
  getCheckpointGraph,
  getEnemyPathGraph,
  insertPoint,
  linkGroups,
  pathGroups,
  renumberKeyCheckpoints,
  setCheckpointGraph,
  splitGroupAtPoint,
  unlinkGroups,
  validatePathGraph,
} from '../kmpGraph';
import { validateKmpFile } from '../kmpValidation';
import { calcTex0DataSize, canEncodeTex0Format, encodeTex0Data, maxMipCount, type RgbaImage } from '../tex0Codec';
import { listBrresTextures, patchBrresTexture } from '../tex0Brres';
import {
  COURSE_MODEL_PATH,
  exportTrack,
  loadTrackBytes,
  replaceArchiveFile,
  replaceCourseKmp,
  validateExportBytes,
  type TrackDocument,
} from '../track';
import { parseU8 } from '../u8';
import { decodeYaz0, encodeYaz0, isYaz0 } from '../yaz0';

export type StageStatus = 'pass' | 'fail' | 'skip';

export interface StageResult {
  /** Stable machine name, used to aggregate failures across the batch. */
  name: string;
  status: StageStatus;
  /** Why it failed, or why it was skipped. */
  detail?: string;
  durationMs: number;
}

export interface TrackCheckResult {
  fileName: string;
  ok: boolean;
  durationMs: number;
  stages: StageResult[];
  /** `name: detail` for every failed stage, ready to print. */
  failures: string[];
  stats: {
    archiveBytes: number;
    fileCount: number;
    compressed: boolean;
    kmpRecords: number;
    brresCount: number;
    /** Errors the *source* track already has, before this harness touches anything. */
    preexistingErrorCodes: string[];
    loadWarnings: number;
  };
}

export interface TrackCheckOptions {
  /**
   * Yaz0 search depth for the compression round trip. The product default is 16; the batch run
   * uses a lower depth because it only needs to prove the codec is lossless, and 338 tracks at
   * depth 16 takes tens of minutes.
   */
  compressionSearchDepth?: number;
  /** Skip the Yaz0 re-compression stage entirely (it is the slowest one). */
  skipCompression?: boolean;
  /** Parse the exported BRRES with the vendored noclip parser. Slow but the strongest check. */
  parseWithNoclip?: boolean;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : shared;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? `${error.message}` : String(error);
}

function findEntry(track: TrackDocument, suffix: string): Uint8Array | null {
  const entry = track.archiveEntries.find(
    (candidate) => candidate.type === 'file' && candidate.path.toLowerCase().endsWith(suffix) && candidate.data,
  );
  return entry?.data ?? null;
}

function errorCodes(issues: readonly { level: string; code: string }[]): string[] {
  return [...new Set(issues.filter((issue) => issue.level === 'error').map((issue) => issue.code))].sort();
}

/** Codes in `after` that are not in `before`. */
function introduced(before: readonly string[], after: readonly string[]): string[] {
  const seen = new Set(before);
  return after.filter((code) => !seen.has(code));
}

/** A deterministic, high-contrast image; survives every GX format well enough to compare. */
export function makeCheckerImage(width: number, height: number): RgbaImage {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const checker = ((x >> 2) + (y >> 2)) % 2 === 0;
      pixels[offset + 0] = checker ? 0xff : 0x00;
      pixels[offset + 1] = checker ? 0x00 : 0xff;
      pixels[offset + 2] = 0x00;
      pixels[offset + 3] = 0xff;
    }
  }
  return { width, height, pixels };
}

/** Opens the first MDL0 in a BRRES with the raw editor the exporter uses. */
function openFirstModel(brres: Uint8Array): { editor: Mdl0Editor; modelName: string } | null {
  const raw = readBrresRaw(brres);
  const group = raw.groups.find((candidate) => candidate.name === BRRES_MODELS_GROUP);
  const subFile = group?.entries[0];
  if (!subFile) return null;
  return { editor: new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile)), modelName: subFile.name };
}

/**
 * Re-parses a BRRES with the vendored noclip reader — the renderer's own code, and an entirely
 * independent implementation of the format from the writer under test.
 */
async function parseBrresWithNoclip(data: Uint8Array): Promise<{ mdl0: unknown[]; tex0: unknown[] }> {
  const [sliceModule, brresModule] = await Promise.all([
    // @ts-ignore the vendored noclip source sits outside this app's tsconfig surface.
    import('../../../vendor/noclip.website/src/ArrayBufferSlice.js'),
    // @ts-ignore the vendored noclip source sits outside this app's tsconfig surface.
    import('../../../vendor/noclip.website/src/rres/brres.js'),
  ]);
  const ArrayBufferSlice = (sliceModule as { default: new (b: ArrayBufferLike, o?: number, l?: number) => unknown }).default;
  const parse = (brresModule as { parse: (slice: unknown) => { mdl0: unknown[]; tex0: unknown[] } }).parse;
  const copy = data.slice();
  return parse(new ArrayBufferSlice(copy.buffer, copy.byteOffset, copy.byteLength));
}

// ---------------------------------------------------------------------------
// The representative per-mode edits
// ---------------------------------------------------------------------------

/**
 * The KMP-mode edit: the same sequence of operations the outliner's buttons make — insert a
 * point, split a group, disconnect and reconnect it, renumber the key checkpoints, fill in the
 * respawn assignments, and make the first object visible for every player count.
 */
export function applyKmpModeEdit(file: KmpFile): KmpFile {
  let next = file;

  const enemyGroups = pathGroups(next, 'ENPT');
  if (enemyGroups.length > 0 && enemyGroups[0].length >= 2) {
    const template = next.enemyPoints[enemyGroups[0].start];
    const point = createEnemyPoint({ x: template.position.x + 5, y: template.position.y, z: template.position.z }, template);
    next = editPathGraph(next, 'ENPT', (graph) => insertPoint(graph, 0, 0, point as never, 'after'));
  }

  const afterInsert = pathGroups(next, 'ENPT');
  if (afterInsert.length > 0 && afterInsert[0].length >= 3) {
    next = editPathGraph(next, 'ENPT', (graph) => splitGroupAtPoint(graph, 0, 1));
    next = editPathGraph(next, 'ENPT', (graph) => unlinkGroups(linkGroups(graph, 0, 1), 0, 1));
    next = editPathGraph(next, 'ENPT', (graph) => linkGroups(graph, 0, 1));
  }

  if (next.checkpoints.length > 0 && next.checkpointGroups.length > 0) {
    next = setCheckpointGraph(next, renumberKeyCheckpoints(getCheckpointGraph(next)));
  }
  if (next.respawnPoints.length > 0) next = assignNearestRespawns(next, { all: false }).file;
  if (next.objects.length > 0) {
    next = {
      ...next,
      objects: next.objects.map((object, index) =>
        index === 0 ? { ...object, presenceFlags: (object.presenceFlags & ~0x3f) | 0x3f } : object,
      ),
    };
  }
  return next;
}

/** The values the camera edit writes, so the re-parse can look for exactly them. */
export const CAMERA_EDIT_EXPECTATION = {
  position: { x: 1234.5, y: -678.25, z: 90.125 },
  viewStart: { x: 11, y: 22, z: 33 },
  viewEnd: { x: -44, y: -55, z: -66 },
  zoomStart: 55,
  zoomEnd: 77,
  time: 240,
  /**
   * The second shot gets a duration of its own. Five real tracks store a camera with `time` 0 and
   * nothing to animate; chaining one of those into the opening pan makes the pan stop dead on it,
   * which `camera.zero-duration` correctly rejects. A chain built in the UI always carries a
   * per-shot duration, so the harness builds one too.
   */
  secondTime: 120,
} as const;

/**
 * The Camera-mode edit: move the first camera, re-aim both look-at points, change the field of
 * view and the shot length, then rebuild the opening pan as a two-shot chain.
 *
 * The chain has to be rewritten as a whole, exactly like `ChainEditor` does — pointing camera 0
 * at camera 1 without also terminating camera 1 leaves whatever `nextIndex` camera 1 already had,
 * which on real tracks usually points back into the chain and makes it loop forever.
 */
export function applyCameraModeEdit(file: KmpFile): KmpFile {
  if (file.cameras.length === 0) return file;
  const expect = CAMERA_EDIT_EXPECTATION;
  const chained = file.cameras.length > 1;
  const cameras = file.cameras.map((camera, index) => {
    if (index === 0) {
      return {
        ...camera,
        position: { ...expect.position },
        viewStart: { ...expect.viewStart },
        viewEnd: { ...expect.viewEnd },
        zoomStart: expect.zoomStart,
        zoomEnd: expect.zoomEnd,
        time: expect.time,
        nextIndex: chained ? 1 : KMP_NULL_INDEX_8,
      };
    }
    // The last shot of the chain ends it, so the opening pan terminates — and it needs a
    // duration of its own, or the pan stalls on a 0-frame shot.
    if (index === 1 && chained) {
      return { ...camera, nextIndex: KMP_NULL_INDEX_8, time: camera.time > 0 ? camera.time : expect.secondTime };
    }
    return camera;
  });
  return { ...file, cameras, firstOpeningCamera: 0 };
}

export interface MeshEditPlan {
  edits: MeshEdit[];
  importedMeshes: ImportedMesh[];
  shapesBefore: number;
  drawOpsBefore: number;
  /** Set when no suitable mesh was found; the stage then skips instead of failing. */
  skipReason?: string;
}

/**
 * The Model-mode edit: move one mesh, delete another and duplicate the moved one. Only draw ops
 * whose shape is used exactly once are touched, because a shape referenced twice would move its
 * other user too — the known gap agent G documented.
 */
export function planMeshModeEdit(courseModel: Uint8Array): MeshEditPlan {
  const opened = openFirstModel(courseModel);
  if (!opened) return { edits: [], importedMeshes: [], shapesBefore: 0, drawOpsBefore: 0, skipReason: 'course model has no MDL0' };

  const { editor, modelName } = opened;
  const ops = collectDrawOps(editor);
  const uses = new Map<number, number>();
  for (const ref of ops) uses.set(ref.op.shapeId, (uses.get(ref.op.shapeId) ?? 0) + 1);
  const exclusive = ops.map((ref, index) => ({ ref, index })).filter((entry) => uses.get(entry.ref.op.shapeId) === 1);

  const shapesBefore = editor.listShapes().length;
  const drawOpsBefore = ops.length;
  if (exclusive.length < 2) {
    return { edits: [], importedMeshes: [], shapesBefore, drawOpsBefore, skipReason: 'fewer than two singly-used draw ops' };
  }

  const makeTarget = (entry: { ref: (typeof ops)[number]; index: number }): EditorMeshTarget => ({
    archivePath: COURSE_MODEL_PATH,
    modelName,
    shapeIndex: entry.ref.op.shapeId,
    drawOpIndex: entry.index,
    componentIndex: null,
    nodeId: entry.ref.op.nodeId,
    granularity: 'shape',
  });

  const moved = makeTarget(exclusive[0]);
  const deleted = makeTarget(exclusive[1]);

  return {
    shapesBefore,
    drawOpsBefore,
    edits: [
      { target: moved, transform: { ...createIdentityMeshTransform(), translation: { x: 0, y: 900, z: 0 } }, visible: true, deleted: false },
      { target: deleted, transform: createIdentityMeshTransform(), visible: true, deleted: true },
    ],
    importedMeshes: [
      {
        id: 'batch-duplicate',
        sourcePath: COURSE_MODEL_PATH,
        modelName,
        label: 'Batch duplicate',
        transform: { ...createIdentityMeshTransform(), translation: { x: 1200, y: 0, z: 0 } },
        visible: true,
        sourceShape: moved,
      },
    ],
  };
}

export interface TextureEditPlan {
  archivePath: string;
  textureName: string;
  patched: Uint8Array;
  pixelData: Uint8Array;
  width: number;
  height: number;
  format: number;
  mipCount: number;
}

/**
 * The Visual-mode edit: re-encode a checkerboard into an existing TEX0's own format and size and
 * patch it into the archive in place — exactly what the texture-replacement UI does, minus the
 * `File`/canvas decoding step that only exists in a browser.
 *
 * Picks the smallest writable texture: fastest to encode and the most tightly packed, so it also
 * exercises the capacity check.
 */
export function planTextureModeEdit(track: TrackDocument): TextureEditPlan | { skipReason: string } {
  for (const entry of track.archiveEntries) {
    if (entry.type !== 'file' || !entry.data || !entry.path.toLowerCase().endsWith('.brres')) continue;
    let textures;
    try {
      textures = listBrresTextures(entry.data);
    } catch {
      continue;
    }
    const candidates = textures
      .filter((texture) => canEncodeTex0Format(texture.format) && texture.dataOffset >= 0 && texture.dataSize > 0)
      .sort((a, b) => a.width * a.height - b.width * b.height);

    for (const texture of candidates) {
      const mipCount = Math.max(1, Math.min(texture.mipCount, maxMipCount(texture.width, texture.height)));
      if (calcTex0DataSize(texture.format, texture.width, texture.height, mipCount) > texture.dataSize) continue;
      const pixelData = encodeTex0Data(
        makeCheckerImage(texture.width, texture.height),
        texture.format,
        texture.width,
        texture.height,
        mipCount,
      );
      if (pixelData.byteLength > texture.dataSize) continue;
      // The replacement has to actually differ, or asserting it survived proves nothing.
      const before = entry.data.subarray(texture.dataOffset, texture.dataOffset + pixelData.byteLength);
      if (bytesEqual(before, pixelData)) continue;
      return {
        archivePath: entry.path,
        textureName: texture.name,
        patched: patchBrresTexture(entry.data, texture.name, {
          pixelData,
          width: texture.width,
          height: texture.height,
          format: texture.format,
          mipCount,
        }),
        pixelData,
        width: texture.width,
        height: texture.height,
        format: texture.format,
        mipCount,
      };
    }
  }
  return { skipReason: 'no writable TEX0 in any archive' };
}

// ---------------------------------------------------------------------------
// The check itself
// ---------------------------------------------------------------------------

class StageRecorder {
  readonly stages: StageResult[] = [];

  async run(name: string, body: () => Promise<string | null> | string | null): Promise<StageStatus> {
    const started = Date.now();
    try {
      const detail = await body();
      const status: StageStatus = detail === null ? 'pass' : 'fail';
      this.stages.push({ name, status, detail: detail ?? undefined, durationMs: Date.now() - started });
      return status;
    } catch (error) {
      this.stages.push({ name, status: 'fail', detail: messageOf(error), durationMs: Date.now() - started });
      return 'fail';
    }
  }

  skip(name: string, detail: string): void {
    this.stages.push({ name, status: 'skip', detail, durationMs: 0 });
  }
}

/**
 * Runs the whole load → parse → export → edit → export → re-parse pipeline for one track.
 * Never throws: a failure anywhere is reported as a failed stage.
 */
export async function checkTrackPipeline(
  raw: Uint8Array,
  fileName: string,
  options: TrackCheckOptions = {},
): Promise<TrackCheckResult> {
  const started = Date.now();
  const recorder = new StageRecorder();
  const stats: TrackCheckResult['stats'] = {
    archiveBytes: raw.byteLength,
    fileCount: 0,
    compressed: false,
    kmpRecords: 0,
    brresCount: 0,
    preexistingErrorCodes: [],
    loadWarnings: 0,
  };

  let track: TrackDocument | null = null;
  let sourceArchive: Uint8Array | null = null;
  let baselineExportErrors: string[] = [];

  // --- 1. Load and parse -----------------------------------------------------
  await recorder.run('load', async () => {
    stats.compressed = isYaz0(raw);
    sourceArchive = decodeYaz0(raw);
    // `brresSummaryLimit: 0` skips the thumbnail-oriented summaries; the BRRES files are parsed
    // for real in the noclip stage instead.
    track = await loadTrackBytes(raw, fileName, { brresSummaryLimit: 0 });
    stats.fileCount = track.archiveEntries.filter((entry) => entry.type === 'file').length;
    stats.kmpRecords = track.kmp?.entities.length ?? 0;
    stats.brresCount = track.brresFiles.length;
    stats.loadWarnings = track.warnings.length;
    if (!track.kmpFile) return 'course.kmp did not parse';
    return null;
  });

  if (!track || !sourceArchive) {
    return finish(fileName, started, recorder, stats);
  }
  const loaded: TrackDocument = track;
  const archive: Uint8Array = sourceArchive;

  stats.preexistingErrorCodes = errorCodes(validateExportBytes(loaded, exportTrack(loaded, { compress: false })));

  // --- 2. Unedited export is byte-identical ---------------------------------
  await recorder.run('export-unedited-identical', () => {
    const rebuilt = exportTrack(loaded, { compress: false });
    if (bytesEqual(rebuilt, archive)) return null;
    return `repacked archive differs at byte ${firstDifference(rebuilt, archive)} (${rebuilt.length} vs ${archive.length} bytes)`;
  });

  // --- 3. Yaz0 is lossless --------------------------------------------------
  if (options.skipCompression) {
    recorder.skip('yaz0-roundtrip', 'disabled by the runner');
  } else {
    await recorder.run('yaz0-roundtrip', () => {
      const compressed = exportTrack(loaded, {
        compress: true,
        compressionSearchDepth: options.compressionSearchDepth ?? 16,
      });
      if (!isYaz0(compressed)) return 'the compressed export is not a Yaz0 stream';
      const back = decodeYaz0(compressed);
      if (!bytesEqual(back, archive)) return `Yaz0 round trip differs at byte ${firstDifference(back, archive)}`;
      // ...and the compressed bytes are a `.szs` the loader accepts.
      if (parseU8(back).length !== loaded.archiveEntries.length) return 'the decompressed archive has a different entry count';
      return null;
    });
  }

  // --- 4. KMP write-back is byte-identical ----------------------------------
  const courseKmp = findEntry(loaded, 'course.kmp');
  await recorder.run('kmp-write-identical', () => {
    if (!courseKmp) return 'the track has no course.kmp';
    const written = writeKmpFile(readKmpFile(courseKmp));
    if (bytesEqual(written, courseKmp)) return null;
    return `course.kmp changed when written back untouched, first at byte ${firstDifference(written, courseKmp)}`;
  });

  // --- 5. KMP-mode edit ------------------------------------------------------
  let editedKmp: KmpFile | null = null;
  await recorder.run('kmp-mode-edit', () => {
    if (!courseKmp) return 'the track has no course.kmp';
    const before = readKmpFile(courseKmp);
    const after = applyKmpModeEdit(before);
    const written = writeKmpFile(after);
    const reparsed = readKmpFile(written);
    // Coordinates are float32 in the file, so the fixed point starts at the first write.
    if (!bytesEqual(writeKmpFile(reparsed), written)) return 'the edited KMP lost data on a write/read round trip';

    const structural = (file: KmpFile) =>
      validatePathGraph(getEnemyPathGraph(file))
        .filter((issue) => issue.code === 'path.link-out-of-range' || issue.code === 'path.one-sided-link' || issue.code === 'path.empty-group')
        .map((issue) => issue.code);
    const newLinks = introduced(structural(before), structural(after));
    if (newLinks.length > 0) return `the edit broke the enemy path graph: ${newLinks.join(', ')}`;

    const newErrors = introduced(errorCodes(validateKmpFile(before)), errorCodes(validateKmpFile(after)));
    if (newErrors.length > 0) return `the edit introduced validation errors: ${newErrors.join(', ')}`;

    editedKmp = after;
    return null;
  });

  // --- 6. Camera-mode edit ---------------------------------------------------
  await recorder.run('camera-mode-edit', () => {
    const base = editedKmp ?? (courseKmp ? readKmpFile(courseKmp) : null);
    if (!base) return 'the track has no course.kmp';
    if (base.cameras.length === 0) return null; // Nothing to edit; not a failure.

    const after = applyCameraModeEdit(base);
    const reparsed = readKmpFile(writeKmpFile(after));
    const camera = reparsed.cameras[0];
    const expect = CAMERA_EDIT_EXPECTATION;
    const close = (a: number, b: number) => Math.abs(a - b) < 1e-3;
    if (!close(camera.position.x, expect.position.x) || !close(camera.position.y, expect.position.y) || !close(camera.position.z, expect.position.z)) {
      return 'the camera position did not survive the round trip';
    }
    if (!close(camera.viewStart.x, expect.viewStart.x) || !close(camera.viewEnd.z, expect.viewEnd.z)) {
      return 'the camera look-at points did not survive the round trip';
    }
    if (!close(camera.zoomStart, expect.zoomStart) || !close(camera.zoomEnd, expect.zoomEnd)) return 'the camera zoom did not survive the round trip';
    if (camera.time !== expect.time) return 'the camera duration did not survive the round trip';
    if (reparsed.firstOpeningCamera !== 0) return 'the opening-camera header did not survive the round trip';

    const newErrors = introduced(errorCodes(validateKmpFile(base)), errorCodes(validateKmpFile(after)));
    if (newErrors.length > 0) return `the camera edit introduced validation errors: ${newErrors.join(', ')}`;

    editedKmp = after;
    return null;
  });

  // --- 7. Model-mode edit ----------------------------------------------------
  const courseModel = findEntry(loaded, 'course_model.brres');
  const meshPlan: MeshEditPlan | null = planCourseModelEdit(courseModel, recorder);

  // --- 8. Visual-mode edit ---------------------------------------------------
  const texturePlan = planTextureModeEdit(loaded);
  if ('skipReason' in texturePlan) {
    recorder.skip('texture-mode-edit', texturePlan.skipReason);
  } else {
    await recorder.run('texture-mode-edit', () => {
      const location = listBrresTextures(texturePlan.patched).find((candidate) => candidate.name === texturePlan.textureName);
      if (!location) return 'the patched texture is no longer in the archive';
      const after = texturePlan.patched.subarray(location.dataOffset, location.dataOffset + texturePlan.pixelData.byteLength);
      if (!bytesEqual(after, texturePlan.pixelData)) return 'the patched pixel data did not land where it was supposed to';
      return null;
    });
  }

  // --- 9. Export everything together and re-open it --------------------------
  let editedDocument: TrackDocument = loaded;
  if (editedKmp) editedDocument = replaceCourseKmp(editedDocument, writeKmpFile(editedKmp));
  if (!('skipReason' in texturePlan)) editedDocument = replaceArchiveFile(editedDocument, texturePlan.archivePath, texturePlan.patched);
  if (meshPlan) editedDocument = { ...editedDocument, meshEdits: meshPlan.edits, importedMeshes: meshPlan.importedMeshes };

  let exported: Uint8Array | null = null;
  await recorder.run('export-edited', () => {
    exported = exportTrack(editedDocument, { compress: false });
    if (exported.byteLength === 0) return 'the export produced no bytes';
    const codes = errorCodes(validateExportBytes({ ...editedDocument, compressed: false }, exported));
    const newCodes = introduced(stats.preexistingErrorCodes, codes);
    if (newCodes.length > 0) return `the edited export introduced errors the source did not have: ${newCodes.join(', ')}`;
    return null;
  });

  await recorder.run('reopen-edited', async () => {
    if (!exported) return 'nothing was exported';
    const reopened = await loadTrackBytes(exported, `${fileName}#edited`, { brresSummaryLimit: 0 });
    if (!reopened.kmpFile) return 'the exported course.kmp does not parse';
    if (loaded.kcl && !reopened.kcl) return 'the exported course.kcl does not parse';
    if (reopened.brresFiles.length !== loaded.brresFiles.length) {
      return `the export has ${reopened.brresFiles.length} BRRES files, the source had ${loaded.brresFiles.length}`;
    }

    if (editedKmp) {
      const written = writeKmpFile(editedKmp);
      const inArchive = findEntry(reopened, 'course.kmp');
      if (!inArchive || !bytesEqual(inArchive, written)) return 'the edited course.kmp did not survive the archive round trip';
    }

    if (!('skipReason' in texturePlan)) {
      const archiveBytes = reopened.archiveEntries.find(
        (entry) => entry.type === 'file' && entry.path.toLowerCase() === texturePlan.archivePath.toLowerCase(),
      )?.data;
      if (!archiveBytes) return `${texturePlan.archivePath} is missing from the export`;
      const location = listBrresTextures(archiveBytes).find((candidate) => candidate.name === texturePlan.textureName);
      if (!location) return `the replaced texture ${texturePlan.textureName} is missing from the export`;
      const after = archiveBytes.subarray(location.dataOffset, location.dataOffset + texturePlan.pixelData.byteLength);
      if (!bytesEqual(after, texturePlan.pixelData)) return 'the replaced texture did not survive the archive round trip';
    }

    if (meshPlan) {
      const exportedModel = findEntry(reopened, 'course_model.brres');
      if (!exportedModel) return 'the exported archive has no course model';
      const opened = openFirstModel(exportedModel);
      if (!opened) return 'the exported course model has no MDL0';
      // One shape appended for the duplicate; one draw op removed and one appended.
      if (opened.editor.listShapes().length !== meshPlan.shapesBefore + 1) {
        return `the exported model has ${opened.editor.listShapes().length} shapes, expected ${meshPlan.shapesBefore + 1}`;
      }
      if (collectDrawOps(opened.editor).length !== meshPlan.drawOpsBefore) {
        return `the exported model has ${collectDrawOps(opened.editor).length} draw ops, expected ${meshPlan.drawOpsBefore}`;
      }
    }
    return null;
  });

  // --- 10. The renderer's own parser accepts the result ----------------------
  if (!options.parseWithNoclip) {
    recorder.skip('noclip-reparse', 'disabled by the runner');
  } else {
    await recorder.run('noclip-reparse', async () => {
      if (!exported) return 'nothing was exported';

      // Differential, like every other stage: whichever archives the renderer could read in the
      // source it must still be able to read in the export. A track that ships a BRRES the
      // renderer cannot parse is the track's problem, not the exporter's.
      const readable = async (entries: readonly { type: string; path: string; data?: Uint8Array }[]) => {
        const ok = new Set<string>();
        const failed = new Map<string, string>();
        for (const entry of entries) {
          if (entry.type !== 'file' || !entry.data || !entry.path.toLowerCase().endsWith('.brres')) continue;
          const key = entry.path.replace(/^\.\//, '').toLowerCase();
          try {
            await parseBrresWithNoclip(entry.data);
            ok.add(key);
          } catch (error) {
            failed.set(key, messageOf(error));
          }
        }
        return { ok, failed };
      };

      const before = await readable(loaded.archiveEntries);
      const after = await readable(parseU8(exported));

      const regressed = [...before.ok].filter((path) => !after.ok.has(path));
      if (regressed.length > 0) {
        return regressed.map((path) => `${path} no longer parses: ${after.failed.get(path) ?? 'missing from the export'}`).join('; ');
      }
      if (before.ok.size === 0 && loaded.brresFiles.length > 0) {
        return `the renderer cannot parse any BRRES in this track: ${[...before.failed].map(([path, why]) => `${path} (${why})`).join(', ')}`;
      }
      return null;
    });
  }

  return finish(fileName, started, recorder, stats);
}

/**
 * Plans the Model-mode edit and records the outcome as a stage. Reading the model is the part
 * that can fail; a model with nothing safe to move is a skip, not a failure.
 */
function planCourseModelEdit(courseModel: Uint8Array | null, recorder: StageRecorder): MeshEditPlan | null {
  if (!courseModel) {
    recorder.skip('mesh-mode-edit', 'the track has no course_model.brres');
    return null;
  }
  const started = Date.now();
  try {
    const plan = planMeshModeEdit(courseModel);
    if (plan.skipReason) {
      recorder.skip('mesh-mode-edit', plan.skipReason);
      return null;
    }
    recorder.stages.push({ name: 'mesh-mode-edit', status: 'pass', durationMs: Date.now() - started });
    return plan;
  } catch (error) {
    recorder.stages.push({ name: 'mesh-mode-edit', status: 'fail', detail: messageOf(error), durationMs: Date.now() - started });
    return null;
  }
}

function finish(fileName: string, started: number, recorder: StageRecorder, stats: TrackCheckResult['stats']): TrackCheckResult {
  const failures = recorder.stages
    .filter((stage) => stage.status === 'fail')
    .map((stage) => `${stage.name}: ${stage.detail ?? 'failed'}`);
  return {
    fileName,
    ok: failures.length === 0,
    durationMs: Date.now() - started,
    stages: recorder.stages,
    failures,
    stats,
  };
}

// ---------------------------------------------------------------------------
// Batch aggregation
// ---------------------------------------------------------------------------

export interface BatchSummary {
  total: number;
  passed: number;
  failed: number;
  /** Track file names that failed, with the stage that broke. */
  failing: Array<{ fileName: string; failures: string[] }>;
  /** How many tracks hit each stage outcome, keyed by `stage:status`. */
  stageCounts: Record<string, number>;
  durationMs: number;
}

export function summarizeBatch(results: readonly TrackCheckResult[], durationMs: number): BatchSummary {
  const stageCounts: Record<string, number> = {};
  for (const result of results) {
    for (const stage of result.stages) {
      const key = `${stage.name}:${stage.status}`;
      stageCounts[key] = (stageCounts[key] ?? 0) + 1;
    }
  }
  const failing = results.filter((result) => !result.ok).map((result) => ({ fileName: result.fileName, failures: result.failures }));
  return {
    total: results.length,
    passed: results.length - failing.length,
    failed: failing.length,
    failing,
    stageCounts,
    durationMs,
  };
}
