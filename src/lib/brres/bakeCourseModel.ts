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
  componentOwnsVerticesExclusively,
  computeJointMatrices,
  countArrayUsers,
  isIdentityTransform,
  readShapeGeometryCache,
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
  const edits = (options.edits ?? []).filter((edit) => !isNeutral(edit));
  const importedMeshes = (options.importedMeshes ?? []).filter((mesh) => mesh.visible);
  if (edits.length === 0 && importedMeshes.length === 0) {
    return { data: brres, changed: false, warnings: [], transformedMeshes: 0, removedDrawOps: 0, addedMeshes: 0, addedTextures: [] };
  }

  const raw = readBrresRaw(brres);
  const modelsGroup = raw.groups.find((group) => group.name === BRRES_MODELS_GROUP);
  if (!modelsGroup || modelsGroup.entries.length === 0) {
    return {
      data: brres,
      changed: false,
      warnings: [{ code: 'model.no-models', message: 'The course model archive has no 3D models to edit.' }],
      transformedMeshes: 0,
      removedDrawOps: 0,
      addedMeshes: 0,
      addedTextures: [],
    };
  }

  const warnings: BakeWarning[] = [];
  let transformedMeshes = 0;
  let removedDrawOps = 0;
  let addedMeshes = 0;
  let changed = false;
  const merges: MergeResult[] = [];

  for (const subFile of modelsGroup.entries) {
    const modelEdits = edits.filter((edit) => edit.target.modelName === subFile.name);
    // `ImportedMesh.modelName` names the model inside the *source* archive, so it says nothing
    // about where the geometry lands. Everything the user places goes into the course model,
    // which is the archive's first (and, in every real track, only) MDL0.
    const modelImports = subFile === modelsGroup.entries[0] ? importedMeshes : [];
    if (modelEdits.length === 0 && modelImports.length === 0) continue;

    const model = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile));
    const outcome = applyModelEdits(model, modelEdits, modelImports, options.importSources ?? new Map());
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
 * Copies the TEX0/PLT0 sub-files an imported model samples into the course archive. Names the
 * course already has are skipped, so the track's own texture wins and two copies of the same
 * object share one image.
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
        const original = findSubFile(source, job.groupName, name);
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

  // Transforms first: deletions only change the draw list, so they cannot disturb them.
  for (const edit of edits) {
    if (edit.deleted || !edit.visible || isIdentityTransform(edit.transform)) continue;
    const targets = resolveTargets(drawOps, edit);
    if (targets.length === 0) {
      warnings.push({ code: 'model.edit-unmatched', message: `An edited mesh (draw call ${edit.target.drawOpIndex}) is no longer in the course model.` });
      continue;
    }
    const applied = applyTransformEdit(model, edit, targets, shapeCache, warnings);
    if (applied) transformedMeshes++;
  }

  // Duplicates and imports append geometry; they need the pre-deletion draw ops.
  for (const mesh of imports) {
    const result = appendImportedMesh(model, mesh, drawOps, shapeCache, importSources);
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
      if (appended.length === 0) continue;
      const existing = model.readDrawOps(list) ?? [];
      model.writeDrawOps(list, [...existing, ...appended]);
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
    if (componentIndex !== null && !componentOwnsVerticesExclusively(step.cache, componentIndex, step.positions)) {
      warnings.push({
        code: 'model.component-shared-vertices',
        message: `"${step.cache.shape.name}" shares vertices between components, so moving one piece also moves its neighbours.`,
      });
    }
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
    const positionResult = transformPositionArray(model, positionArrayId, step.positions, local);
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
      transformNormalArray(model, normalArrayId, step.normals, local);
    }
  }
  return true;
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
