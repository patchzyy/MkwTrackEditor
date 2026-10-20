// Baking Model-mode edits into `course_model.brres` on export.
//
// This is the top level: it opens the archive, folds every mesh transform into vertex data,
// drops the draw ops of deleted or hidden meshes, appends duplicated meshes, merges imported
// object models, and writes the archive back out. When there is nothing to do it returns the
// original bytes untouched, so an unedited track still exports byte-for-byte.

import { mat4, vec3 } from 'gl-matrix';
import type { ImportedMesh, MeshEdit } from '../brresEditor';
import {
  BRRES_MODELS_GROUP,
  BRRES_PALETTES_GROUP,
  BRRES_TEXTURES_GROUP,
  findSubFile,
  makeSubFileNameReader,
  readBrresRaw,
  writeBrres,
  type BrresGroupRaw,
  type BrresRaw,
  type BrresSubFileRaw,
} from './brresRaw';
import { internString } from './stringPool';
import { Mdl0Editor, type Mdl0DrawOp, type Mdl0ShapeInfo } from './mdl0Raw';
import {
  buildEditMatrix,
  collectAffectedVertices,
  collectDrawOps,
  computeJointMatrices,
  countArrayUsers,
  isIdentityTransform,
  readShapeGeometryCache,
  splitSharedVertexData,
  transformNormalArray,
  transformPositionArray,
  type BakeWarning,
  type DrawOpRef,
  type ShapeGeometryCache,
} from './meshBake';
import { mergeImportedModel, type MergeResult, type MergeSource } from './mergeModel';

export interface BakeCourseModelOptions {
  edits?: readonly MeshEdit[];
  importedMeshes?: readonly ImportedMesh[];
  /** BRRES bytes for each imported mesh's `sourcePath`, keyed by that path. */
  importSources?: ReadonlyMap<string, Uint8Array>;
  /**
   * Where `brres` lives in the track archive (`./course_model.brres`). When given, only edits
   * whose `target.archivePath` names this archive are baked. Model mode also records edits on
   * the models placed from the content browser (`./editor-imported/imported-N.brres`); their
   * draw-op indices count *that* model's draw calls, so applying them here would hide, delete
   * or move whichever course draw call happens to share the index.
   */
  archivePath?: string;
}

/** Lower-case, forward slashes, no leading `./`: how two archive paths are compared. */
export function normalizeArchivePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '').toLowerCase();
}

export interface BakeCourseModelResult {
  data: Uint8Array;
  changed: boolean;
  warnings: BakeWarning[];
  transformedMeshes: number;
  removedDrawOps: number;
  addedMeshes: number;
  /** Names of the TEX0/PLT0 sub-files copied in from imported models. */
  addedTextures: string[];
}

export function bakeCourseModel(brres: Uint8Array, options: BakeCourseModelOptions = {}): BakeCourseModelResult {
  const ownArchive = options.archivePath === undefined ? null : normalizeArchivePath(options.archivePath);
  const elsewhere = (edit: MeshEdit): boolean =>
    ownArchive !== null && !!edit.target.archivePath && normalizeArchivePath(edit.target.archivePath) !== ownArchive;
  const activeEdits = (options.edits ?? []).filter((edit) => !isNeutral(edit));
  const foreign = activeEdits.filter(elsewhere);
  const edits = activeEdits.filter((edit) => !elsewhere(edit));
  const foreignWarnings: BakeWarning[] = foreign.length === 0 ? [] : [{
    code: 'model.edit-other-archive',
    message: foreign.length === 1
      ? 'A change to part of a placed model was left out of the export; move, hide or delete the whole placed model instead.'
      : `${foreign.length} changes to parts of placed models were left out of the export; move, hide or delete the whole placed models instead.`,
  }];
  const importedMeshes = (options.importedMeshes ?? []).filter((mesh) => mesh.visible);
  if (edits.length === 0 && importedMeshes.length === 0) {
    return { data: brres, changed: false, warnings: foreignWarnings, transformedMeshes: 0, removedDrawOps: 0, addedMeshes: 0, addedTextures: [] };
  }

  const raw = readBrresRaw(brres);
  const modelsGroup = raw.groups.find((group) => group.name === BRRES_MODELS_GROUP);
  if (!modelsGroup || modelsGroup.entries.length === 0) {
    return {
      data: brres,
      changed: false,
      warnings: [...foreignWarnings, { code: 'model.no-models', message: 'The course model archive has no 3D models to edit.' }],
      transformedMeshes: 0,
      removedDrawOps: 0,
      addedMeshes: 0,
      addedTextures: [],
    };
  }

  const warnings: BakeWarning[] = [...foreignWarnings];
  let transformedMeshes = 0;
  let removedDrawOps = 0;
  let addedMeshes = 0;
  let changed = false;
  const merges: MergeResult[] = [];
  const resolveResourceName = createResourceNamer(raw);

  for (const subFile of modelsGroup.entries) {
    const modelEdits = edits.filter((edit) => edit.target.modelName === subFile.name);
    // `ImportedMesh.modelName` names the model inside the *source* archive, so it says nothing
    // about where the geometry lands. Everything the user places goes into the course model,
    // which is the archive's first (and, in every real track, only) MDL0.
    const modelImports = subFile === modelsGroup.entries[0] ? importedMeshes : [];
    if (modelEdits.length === 0 && modelImports.length === 0) continue;

    const model = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile));
    const outcome = applyModelEdits(model, modelEdits, modelImports, options.importSources ?? new Map(), resolveResourceName);
    warnings.push(...outcome.warnings);
    merges.push(...outcome.merges);
    transformedMeshes += outcome.transformedMeshes;
    removedDrawOps += outcome.removedDrawOps;
    addedMeshes += outcome.addedMeshes;
    if (!model.modified) continue;

    changed = true;
    const finished = model.finish();
    warnings.push(...model.takeIssues());
    subFile.data = finished.data;
    subFile.stringRefs = finished.stringRefs;
    for (const ref of finished.stringRefs) internString(raw.pool, ref.value);
  }

  if (!changed) {
    return { data: brres, changed: false, warnings, transformedMeshes, removedDrawOps, addedMeshes, addedTextures: [] };
  }
  const addedTextures = copyImportedResources(raw, merges, warnings);
  ensurePoolHasEveryName(raw);
  return { data: writeBrres(raw), changed: true, warnings, transformedMeshes, removedDrawOps, addedMeshes, addedTextures };
}

/**
 * Decides what an imported model's texture or palette is called once it is in the course
 * archive.
 *
 * A name the course already uses is kept only when the image behind it is byte-identical — two
 * placements of the same object then share one TEX0, and an object that samples a texture the
 * track genuinely already has costs nothing. When the course has a *different* image under that
 * name, the import is renamed instead. Reusing it would silently repaint the placed object with
 * the track's own artwork, which is what this replaces.
 */
function createResourceNamer(raw: BrresRaw): (groupName: string, name: string, data: Uint8Array | null) => string {
  const decided = new Map<string, string>();
  const taken = new Set<string>();
  for (const group of raw.groups) for (const entry of group.entries) taken.add(`${group.name}|${entry.name}`);

  return (groupName, name, data) => {
    if (!name) return name;
    const key = `${groupName}|${name}|${fingerprint(data)}`;
    const already = decided.get(key);
    if (already !== undefined) return already;

    const existing = findSubFile(raw, groupName, name);
    let target = name;
    if (existing && data && !sameBytes(existing.data, data)) {
      for (let i = 1; ; i++) {
        const candidate = `${name}_${i}`;
        if (!taken.has(`${groupName}|${candidate}`)) {
          target = candidate;
          break;
        }
      }
    }
    taken.add(`${groupName}|${target}`);
    decided.set(key, target);
    return target;
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Enough of a content identity to tell two same-named imports apart. */
function fingerprint(data: Uint8Array | null): string {
  if (!data) return 'none';
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return `${data.length}:${(hash >>> 0).toString(16)}`;
}

/**
 * Copies the TEX0/PLT0 sub-files an imported model samples into the course archive. A name the
 * course already carries is skipped, because `createResourceNamer` has already guaranteed that
 * the name only survives when the image behind it is the same one.
 *
 * The new sub-files go in *ahead of* the first sub-file the writer cannot relocate — the texture
 * and colour animations, whose internal name pointers this editor does not model. Everything
 * from that point on then shifts by exactly as much as the string pool, which is the invariant
 * `writeBrres` checks.
 */
function copyImportedResources(raw: BrresRaw, merges: readonly MergeResult[], warnings: BakeWarning[]): string[] {
  const sources = merges.filter((merge) => merge.sourceArchive && (merge.textures.length > 0 || merge.palettes.length > 0));
  if (sources.length === 0) return [];

  const firstPinned = raw.layout.findIndex((subFile) => subFile.stringRefs === null);
  let insertAt = firstPinned < 0 ? raw.layout.length : firstPinned;
  const added: string[] = [];

  const groupFor = (name: string): BrresGroupRaw => {
    const existing = raw.groups.find((candidate) => candidate.name === name);
    if (existing) return existing;
    const created: BrresGroupRaw = { name, entries: [] };
    raw.groups.push(created);
    return created;
  };

  for (const merge of sources) {
    const source = merge.sourceArchive!;
    const jobs = [
      { groupName: BRRES_TEXTURES_GROUP, names: merge.textures },
      { groupName: BRRES_PALETTES_GROUP, names: merge.palettes },
    ];
    for (const job of jobs) {
      if (job.names.length === 0) continue;
      const group = groupFor(job.groupName);
      for (const name of job.names) {
        if (group.entries.some((entry) => entry.name === name)) continue;
        // A renamed resource still has to be looked up under the name it has in its own file.
        const original = findSubFile(source, job.groupName, merge.renamedResources.get(name) ?? name);
        if (!original) {
          warnings.push({
            code: 'model.import-texture-missing',
            message: `A placed model uses the texture "${name}", which is not in its own file; that surface will fall back to whatever the track already has.`,
          });
          continue;
        }
        const clone: BrresSubFileRaw = {
          name,
          magic: original.magic,
          data: original.data.slice(),
          sourceOffset: -1,
          stringRefs: [{ offset: 0x14, value: name }],
        };
        group.entries.push(clone);
        raw.layout.splice(insertAt, 0, clone);
        insertAt++;
        added.push(name);
      }
    }
  }
  return added;
}

function ensurePoolHasEveryName(raw: BrresRaw): void {
  for (const group of raw.groups) {
    internString(raw.pool, group.name);
    for (const entry of group.entries) internString(raw.pool, entry.name);
  }
}

function isNeutral(edit: MeshEdit): boolean {
  return !edit.deleted && edit.visible && isIdentityTransform(edit.transform);
}

interface ModelEditOutcome {
  warnings: BakeWarning[];
  transformedMeshes: number;
  removedDrawOps: number;
  addedMeshes: number;
  merges: MergeResult[];
}

function applyModelEdits(
  model: Mdl0Editor,
  edits: readonly MeshEdit[],
  imports: readonly ImportedMesh[],
  importSources: ReadonlyMap<string, Uint8Array>,
  resolveResourceName: (groupName: string, name: string, data: Uint8Array | null) => string,
): ModelEditOutcome {
  const warnings: BakeWarning[] = [];
  let transformedMeshes = 0;
  let removedDrawOps = 0;
  let addedMeshes = 0;
  const merges: MergeResult[] = [];

  const drawOps = collectDrawOps(model);
  const joints = computeJointMatrices(model);
  const caches = new Map<number, ShapeGeometryCache | null>();

  const shapeCache = (drawOp: DrawOpRef): ShapeGeometryCache | null => {
    if (caches.has(drawOp.combinedIndex)) return caches.get(drawOp.combinedIndex) ?? null;
    const shape = model.getShape(drawOp.op.shapeId);
    const joint = shape && shape.mtxIdx >= 0 ? joints[shape.mtxIdx] : undefined;
    const cache = shape && joint ? readShapeGeometryCache(model, shape, joint) : null;
    caches.set(drawOp.combinedIndex, cache);
    return cache;
  };

  /**
   * A shape that more than one draw call draws is drawn more than once — usually under a
   * different node, so the copies sit somewhere else on the track. Its vertex arrays are the
   * same arrays, so editing through one draw call would move every copy. Give the edited draw
   * call a shape of its own first; the vertex-array copy-on-write below then separates the data,
   * because the clone starts out sharing its arrays with the original.
   */
  const detachSharedShape = (target: DrawOpRef): void => {
    if (drawOps.filter((ref) => ref.op.shapeId === target.op.shapeId).length < 2) return;
    const shape = model.getShape(target.op.shapeId);
    if (!shape) return;
    const clonedId = model.duplicateShape(shape, uniqueName(model, 'shape', shape.name), shape.positionArrayId, shape.normalArrayId);
    target.op.shapeId = clonedId;
    caches.delete(target.combinedIndex);
  };

  // Transforms first: deletions only change the draw list, so they cannot disturb them.
  let detachedShapes = false;
  for (const edit of edits) {
    if (edit.deleted || !edit.visible || isIdentityTransform(edit.transform)) continue;
    const targets = resolveTargets(drawOps, edit);
    if (targets.length === 0) {
      warnings.push({ code: 'model.edit-unmatched', message: `An edited mesh (draw call ${edit.target.drawOpIndex}) is no longer in the course model.` });
      continue;
    }
    for (const target of targets) {
      const before = target.op.shapeId;
      detachSharedShape(target);
      if (target.op.shapeId !== before) detachedShapes = true;
    }
    const applied = applyTransformEdit(model, edit, targets, shapeCache, warnings);
    if (applied) transformedMeshes++;
  }

  // Duplicates and imports append geometry; they need the pre-deletion draw ops.
  for (const mesh of imports) {
    const result = appendImportedMesh(model, mesh, drawOps, shapeCache, importSources, resolveResourceName);
    warnings.push(...result.warnings);
    if (result.merge) merges.push(result.merge);
    if (result.added) addedMeshes++;
  }

  const removed = new Set<number>();
  for (const edit of edits) {
    if (!edit.deleted && edit.visible) continue;
    for (const target of resolveTargets(drawOps, edit)) removed.add(target.combinedIndex);
  }
  if (removed.size > 0) {
    removedDrawOps = removed.size;
    for (const list of ['opaque', 'translucent'] as const) {
      const existing = model.readDrawOps(list);
      if (!existing) continue;
      const kept = drawOps
        .filter((ref) => ref.list === list && !removed.has(ref.combinedIndex))
        .map((ref) => ref.op);
      const appended = model.pendingDrawOps(list);
      if (kept.length !== existing.length || appended.length > 0) model.writeDrawOps(list, [...kept, ...appended]);
    }
  } else {
    for (const list of ['opaque', 'translucent'] as const) {
      const appended = model.pendingDrawOps(list);
      // `detachedShapes` means a draw op was repointed at a cloned shape in place, so the list
      // has to be rewritten even though no op was added or removed.
      if (appended.length === 0 && !detachedShapes) continue;
      const existing = model.readDrawOps(list);
      if (!existing) continue;
      const kept = drawOps.filter((ref) => ref.list === list).map((ref) => ref.op);
      model.writeDrawOps(list, [...kept, ...appended]);
    }
  }

  return { warnings, transformedMeshes, removedDrawOps, addedMeshes, merges };
}

function resolveTargets(drawOps: readonly DrawOpRef[], edit: MeshEdit): DrawOpRef[] {
  if (edit.target.granularity === 'node') {
    return drawOps.filter((ref) => ref.op.nodeId === edit.target.nodeId);
  }
  const ref = drawOps[edit.target.drawOpIndex];
  return ref && ref.op.shapeId === edit.target.shapeIndex ? [ref] : ref ? [ref] : [];
}

function applyTransformEdit(
  model: Mdl0Editor,
  edit: MeshEdit,
  targets: readonly DrawOpRef[],
  shapeCache: (drawOp: DrawOpRef) => ShapeGeometryCache | null,
  warnings: BakeWarning[],
): boolean {
  const componentIndex = edit.target.granularity === 'component' && targets.length === 1 ? edit.target.componentIndex : null;

  // Pivot on the untransformed bounds of the whole target, exactly like the viewport gizmo.
  const min = vec3.fromValues(Infinity, Infinity, Infinity);
  const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
  const plan: Array<{ cache: ShapeGeometryCache; positions: Set<number>; normals: Set<number> }> = [];
  for (const target of targets) {
    const cache = shapeCache(target);
    if (!cache) continue;
    const affected = collectAffectedVertices(cache, componentIndex);
    if (affected.positions.size === 0) continue;
    vec3.min(min, min, affected.min);
    vec3.max(max, max, affected.max);
    plan.push({ cache, positions: affected.positions, normals: affected.normals });
  }
  if (plan.length === 0) {
    warnings.push({ code: 'model.edit-empty', message: `An edited mesh (draw call ${edit.target.drawOpIndex}) has no editable geometry.` });
    return false;
  }

  const pivot = vec3.fromValues((min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5);
  const world = buildEditMatrix(edit.transform, pivot);
  const shapes = model.listShapes();

  for (const step of plan) {
    // Fold the joint matrix out and back in: the arrays hold model-space positions.
    const inverseJoint = mat4.create();
    if (!mat4.invert(inverseJoint, step.cache.joint)) mat4.identity(inverseJoint);
    const local = mat4.create();
    mat4.mul(local, world, step.cache.joint);
    mat4.mul(local, inverseJoint, local);

    const shape = step.cache.shape;
    let positionArrayId = shape.positionArrayId;
    if (countArrayUsers(shapes, 'vtxPos', positionArrayId) > 1) {
      const array = model.getVertexArray('vtxPos', positionArrayId);
      if (array) {
        positionArrayId = model.duplicateVertexArray(array, uniqueName(model, 'vtxPos', array.name));
        model.setShapeArrayId(shape, 'vtxPos', positionArrayId);
      }
    }

    // Stop sharing vertex data with the neighbouring components before writing into it.
    let positions = step.positions;
    if (componentIndex !== null) {
      const split = splitSharedVertexData(model, step.cache, componentIndex, 'vtxPos', positionArrayId, positions);
      positions = split.entries;
      if (split.blocked !== null) {
        warnings.push({
          code: 'model.component-shared-vertices',
          message: describeBlockedSplit(shape.name, 'positions', split.blocked),
        });
      }
    }

    const positionResult = transformPositionArray(model, positionArrayId, positions, local);
    if (positionResult) {
      model.expandModelBounds(positionResult.bounds.min[0], positionResult.bounds.min[1], positionResult.bounds.min[2]);
      model.expandModelBounds(positionResult.bounds.max[0], positionResult.bounds.max[1], positionResult.bounds.max[2]);
      if (positionResult.promoted) {
        warnings.push({
          code: 'model.array-promoted',
          message: `"${shape.name}" was moved beyond the range of its compressed vertex format, so its positions were stored as full precision floats.`,
        });
      }
    }

    if (step.normals.size > 0 && shape.normalArrayId >= 0 && hasRotationOrScale(edit)) {
      let normalArrayId = shape.normalArrayId;
      if (countArrayUsers(shapes, 'vtxNrm', normalArrayId) > 1) {
        const array = model.getVertexArray('vtxNrm', normalArrayId);
        if (array) {
          normalArrayId = model.duplicateVertexArray(array, uniqueName(model, 'vtxNrm', array.name));
          model.setShapeArrayId(shape, 'vtxNrm', normalArrayId);
        }
      }

      // Two components of one shape sharing a normal is the common case, not the exception: any
      // two flat-topped pieces both name the "straight up" entry. Without this split, rotating
      // one piece would re-light every other piece that shares the normal.
      let normals = step.normals;
      if (componentIndex !== null) {
        const split = splitSharedVertexData(model, step.cache, componentIndex, 'vtxNrm', normalArrayId, normals);
        normals = split.entries;
        if (split.blocked !== null) {
          warnings.push({
            code: 'model.component-shared-vertices',
            message: describeBlockedSplit(shape.name, 'normals', split.blocked),
          });
        }
      }
      transformNormalArray(model, normalArrayId, normals, local);
    }
  }
  return true;
}

/**
 * The two cases a per-component split genuinely cannot handle. Both are hard limits of the
 * format rather than gaps in the implementation, and neither occurs in any of the 338 tracks
 * installed here.
 */
function describeBlockedSplit(shapeName: string, what: 'positions' | 'normals', reason: 'index-width' | 'entry-count'): string {
  const limit = reason === 'index-width'
    ? 'its display list addresses that array with 8-bit references, which cannot reach past entry 255'
    : 'that array already holds close to the 65,535 entries the format allows';
  return `"${shapeName}" shares ${what} between connected components and they could not be split, because ${limit}. `
    + `Moving this piece also moves the pieces it shares ${what} with; move the whole mesh instead.`;
}

function hasRotationOrScale(edit: MeshEdit): boolean {
  const { rotation: r, scale: s } = edit.transform;
  return r.x !== 0 || r.y !== 0 || r.z !== 0 || s.x !== 1 || s.y !== 1 || s.z !== 1;
}

function uniqueName(model: Mdl0Editor, kind: Parameters<Mdl0Editor['getDic']>[0], base: string): string {
  const taken = new Set(model.getDic(kind)?.entries.map((entry) => entry.name) ?? []);
  for (let i = 1; ; i++) {
    const candidate = `${base}_edit${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

interface AppendResult {
  added: boolean;
  warnings: BakeWarning[];
  merge?: MergeResult;
}

function appendImportedMesh(
  model: Mdl0Editor,
  mesh: ImportedMesh,
  drawOps: readonly DrawOpRef[],
  shapeCache: (drawOp: DrawOpRef) => ShapeGeometryCache | null,
  importSources: ReadonlyMap<string, Uint8Array>,
  resolveResourceName: (groupName: string, name: string, data: Uint8Array | null) => string,
): AppendResult {
  if (!mesh.visible) return { added: false, warnings: [] };
  if (mesh.sourceShape) return duplicateCourseMesh(model, mesh, drawOps, shapeCache);
  const source = importSources.get(mesh.sourcePath);
  if (!source) {
    return {
      added: false,
      warnings: [{
        code: 'model.import-missing',
        message: `The model file for the placed object "${describeImport(mesh)}" was not available, so it was left out of the export.`,
      }],
    };
  }
  const request: MergeSource = {
    brres: source,
    modelName: mesh.modelName || null,
    transform: mesh.transform,
    label: describeImport(mesh),
    resolveResourceName,
  };
  const merge = mergeImportedModel(model, request);
  return { added: merge.added, warnings: merge.warnings, merge };
}

function describeImport(mesh: ImportedMesh): string {
  return mesh.label ?? mesh.sourcePath.split(/[\\/]/).pop() ?? mesh.sourcePath;
}

function duplicateCourseMesh(
  model: Mdl0Editor,
  mesh: ImportedMesh,
  drawOps: readonly DrawOpRef[],
  shapeCache: (drawOp: DrawOpRef) => ShapeGeometryCache | null,
): { added: boolean; warnings: BakeWarning[] } {
  const source = mesh.sourceShape!;
  const drawOp = drawOps[source.drawOpIndex];
  const cache = drawOp ? shapeCache(drawOp) : null;
  if (!drawOp || !cache) {
    return {
      added: false,
      warnings: [{ code: 'model.duplicate-missing', message: 'A duplicated mesh no longer points at anything in the course model, so it was left out of the export.' }],
    };
  }

  const affected = collectAffectedVertices(cache, source.componentIndex);
  const pivot = vec3.fromValues(
    (affected.min[0] + affected.max[0]) * 0.5,
    (affected.min[1] + affected.max[1]) * 0.5,
    (affected.min[2] + affected.max[2]) * 0.5,
  );
  const world = buildEditMatrix(mesh.transform, pivot);
  const inverseJoint = mat4.create();
  if (!mat4.invert(inverseJoint, cache.joint)) mat4.identity(inverseJoint);
  const local = mat4.create();
  mat4.mul(local, world, cache.joint);
  mat4.mul(local, inverseJoint, local);

  const shape = cache.shape;
  const positionArray = model.getVertexArray('vtxPos', shape.positionArrayId);
  if (!positionArray) return { added: false, warnings: [{ code: 'model.duplicate-missing', message: 'A duplicated mesh has no vertex data.' }] };

  const shapeName = uniqueName(model, 'shape', shape.name);
  const newPositionId = model.duplicateVertexArray(positionArray, uniqueName(model, 'vtxPos', positionArray.name));
  transformPositionArray(model, newPositionId, allIndices(positionArray.count), local);

  let newNormalId = shape.normalArrayId;
  const normalArray = shape.normalArrayId >= 0 ? model.getVertexArray('vtxNrm', shape.normalArrayId) : null;
  if (normalArray) {
    newNormalId = model.duplicateVertexArray(normalArray, uniqueName(model, 'vtxNrm', normalArray.name));
    transformNormalArray(model, newNormalId, allIndices(normalArray.count), local);
  }

  const newShapeId = model.duplicateShape(shape, shapeName, newPositionId, newNormalId);
  model.queueDrawOp(drawOp.list, { materialId: drawOp.op.materialId, shapeId: newShapeId, nodeId: drawOp.op.nodeId, priority: drawOp.op.priority });
  for (let corner = 0; corner < 8; corner++) {
    const point = vec3.fromValues(
      corner & 1 ? affected.max[0] : affected.min[0],
      corner & 2 ? affected.max[1] : affected.min[1],
      corner & 4 ? affected.max[2] : affected.min[2],
    );
    vec3.transformMat4(point, point, world);
    model.expandModelBounds(point[0], point[1], point[2]);
  }
  return { added: true, warnings: [] };
}

function allIndices(count: number): Set<number> {
  const set = new Set<number>();
  for (let i = 0; i < count; i++) set.add(i);
  return set;
}

export type { BakeWarning } from './meshBake';
export type { Mdl0DrawOp, Mdl0ShapeInfo, BrresSubFileRaw };
