import type { TrackDocument } from './track';
import { deriveMdl0Meshes, deriveMdl0MeshSlots, type Mdl0MeshSlot } from './mdl0ModelDomain';

export interface BrresTransform {
  scale: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  translation: { x: number; y: number; z: number };
}

export interface BrresEditorNode {
  id: string;
  archivePath: string;
  modelName: string;
  name: string;
  nodeId: number;
  parentNodeId: number;
  visible: boolean;
  billboardMode: number;
  billboardRefNodeId: number;
  sourceOffset: number;
  transform: BrresTransform;
}

export interface BrresEditorModel {
  id: string;
  archivePath: string;
  name: string;
  sourceOffset?: number | null;
  resourceSize?: number | null;
  nodeCount: number;
  materialCount: number;
  shapeCount: number;
  drawOpaSourceOffset?: number | null;
  drawOpaEndOffset?: number | null;
  drawXluSourceOffset?: number | null;
  drawXluEndOffset?: number | null;
  meshSlots: Mdl0MeshSlot[];
}

export interface BrresEditorMesh {
  id: string;
  archivePath: string;
  modelId: string;
  modelName: string;
  name: string;
  shapeIndex: number;
  sourceOffset?: number | null;
  matrixIndex: number;
  vertexCount: number;
  indexCount: number;
  bindingCount: number;
  opaqueBindingCount: number;
  translucentBindingCount: number;
}

export interface BrresEditorArchive {
  path: string;
  models: BrresEditorModel[];
  meshes: BrresEditorMesh[];
  nodes: BrresEditorNode[];
}

export interface EditorProjectState {
  archives: BrresEditorArchive[];
  archiveNodes: BrresEditorNode[];
  sceneNodes: BrresEditorNode[];
  models: BrresEditorModel[];
  archiveMeshes: BrresEditorMesh[];
}

// ---------------------------------------------------------------------------
// Per-mesh editing model (Model mode)
//
// The renderer applies these live; the BRRES writer will bake them into
// `course_model.brres` on export.
// ---------------------------------------------------------------------------

/** How much geometry a single click selects. */
export type MeshSelectionGranularity = 'component' | 'shape' | 'node';

export const MESH_SELECTION_GRANULARITIES: MeshSelectionGranularity[] = ['component', 'shape', 'node'];

/** Identifies a piece of renderable geometry inside a BRRES model. */
export interface EditorMeshTarget {
  archivePath: string;
  modelName: string;
  /** MDL0 shape index. */
  shapeIndex: number;
  /** Index into the concatenated [DrawOpa, DrawXlu] op list; identifies the draw call. */
  drawOpIndex: number;
  /** Connected-component index inside the shape, or null for whole-shape/node targets. */
  componentIndex: number | null;
  /** MDL0 node the draw op is bound to. */
  nodeId: number;
  granularity: MeshSelectionGranularity;
}

export interface MeshTransform {
  translation: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
}

export interface MeshEdit {
  target: EditorMeshTarget;
  transform: MeshTransform;
  visible: boolean;
  deleted: boolean;
}

export interface ImportedMesh {
  id: string;
  /** Content-browser asset path the BRRES came from. */
  sourcePath: string;
  modelName: string;
  transform: MeshTransform;
  visible: boolean;
  /** Friendly name shown in the outliner and inspector. */
  label?: string;
  /**
   * Set when this mesh is a duplicate of geometry that is already in the course model rather
   * than an import from another file. The exporter clones that draw call instead of merging a
   * second archive, and the viewport re-draws it in place rather than loading another model.
   */
  sourceShape?: EditorMeshTarget;
}

export const IDENTITY_MESH_TRANSFORM: MeshTransform = {
  translation: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

export function createIdentityMeshTransform(): MeshTransform {
  return {
    translation: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

/** Stable key for a mesh target; also used as the React key in selection lists. */
export function meshTargetKey(target: EditorMeshTarget): string {
  return [
    target.archivePath.toLowerCase(),
    target.modelName,
    target.granularity,
    target.granularity === 'node' ? `node${target.nodeId}` : `shape${target.shapeIndex}`,
    target.granularity === 'node' ? '' : `op${target.drawOpIndex}`,
    target.granularity === 'component' && target.componentIndex !== null ? `c${target.componentIndex}` : '',
  ].join('::');
}

export function meshTargetEquals(a: EditorMeshTarget | null, b: EditorMeshTarget | null): boolean {
  if (!a || !b) return a === b;
  return meshTargetKey(a) === meshTargetKey(b);
}

/** Widens ( `]` ) or narrows ( `[` ) the selection granularity. */
export function widenMeshGranularity(granularity: MeshSelectionGranularity): MeshSelectionGranularity {
  return granularity === 'component' ? 'shape' : 'node';
}

export function narrowMeshGranularity(granularity: MeshSelectionGranularity): MeshSelectionGranularity {
  return granularity === 'node' ? 'shape' : 'component';
}

export function retargetMeshGranularity(target: EditorMeshTarget, granularity: MeshSelectionGranularity): EditorMeshTarget {
  return { ...target, granularity, componentIndex: granularity === 'component' ? target.componentIndex : null };
}

export function findMeshEdit(edits: readonly MeshEdit[], target: EditorMeshTarget): MeshEdit | null {
  const key = meshTargetKey(target);
  return edits.find((edit) => meshTargetKey(edit.target) === key) ?? null;
}

/** Immutably upserts an edit for `target`. */
export function upsertMeshEdit(edits: readonly MeshEdit[], target: EditorMeshTarget, patch: Partial<Omit<MeshEdit, 'target'>>): MeshEdit[] {
  const key = meshTargetKey(target);
  const index = edits.findIndex((edit) => meshTargetKey(edit.target) === key);
  const base: MeshEdit = index >= 0
    ? edits[index]
    : { target, transform: createIdentityMeshTransform(), visible: true, deleted: false };
  const next: MeshEdit = {
    target: base.target,
    transform: patch.transform ?? base.transform,
    visible: patch.visible ?? base.visible,
    deleted: patch.deleted ?? base.deleted,
  };
  if (isNeutralMeshEdit(next)) return index >= 0 ? [...edits.slice(0, index), ...edits.slice(index + 1)] : [...edits];
  if (index < 0) return [...edits, next];
  return [...edits.slice(0, index), next, ...edits.slice(index + 1)];
}

export function removeMeshEdit(edits: readonly MeshEdit[], target: EditorMeshTarget): MeshEdit[] {
  const key = meshTargetKey(target);
  return edits.filter((edit) => meshTargetKey(edit.target) !== key);
}

export function isNeutralMeshEdit(edit: MeshEdit): boolean {
  if (edit.deleted || !edit.visible) return false;
  const { translation, rotation, scale } = edit.transform;
  return (
    translation.x === 0 && translation.y === 0 && translation.z === 0 &&
    rotation.x === 0 && rotation.y === 0 && rotation.z === 0 &&
    scale.x === 1 && scale.y === 1 && scale.z === 1
  );
}

export function addImportedMesh(meshes: readonly ImportedMesh[], mesh: ImportedMesh): ImportedMesh[] {
  return [...meshes.filter((candidate) => candidate.id !== mesh.id), mesh];
}

export function removeImportedMesh(meshes: readonly ImportedMesh[], id: string): ImportedMesh[] {
  return meshes.filter((mesh) => mesh.id !== id);
}

export function updateImportedMesh(meshes: readonly ImportedMesh[], id: string, patch: Partial<Omit<ImportedMesh, 'id'>>): ImportedMesh[] {
  return meshes.map((mesh) => (mesh.id === id ? { ...mesh, ...patch } : mesh));
}

const MDL0_NODE_VISIBLE_FLAG = 0x00000100;

export async function buildEditorProjectState(track: TrackDocument): Promise<EditorProjectState> {
  const archives = (
    await Promise.all(
      track.archiveEntries
        .filter((entry): entry is typeof entry & { data: Uint8Array } => entry.type === 'file' && entry.path.toLowerCase().endsWith('.brres') && !!entry.data)
        .map((entry) => parseBrresEditorArchive(entry.path, entry.data)),
    )
  ).filter((archive): archive is BrresEditorArchive => archive !== null);

  const archiveNodes = archives
    .flatMap((archive) => archive.nodes)
    .sort((a, b) => a.archivePath.localeCompare(b.archivePath) || a.modelName.localeCompare(b.modelName) || a.name.localeCompare(b.name) || a.nodeId - b.nodeId);
  const sceneNodes = archiveNodes
    .filter((node) => node.archivePath.toLowerCase().endsWith('course_model.brres'))
    .sort((a, b) => a.modelName.localeCompare(b.modelName) || a.name.localeCompare(b.name) || a.nodeId - b.nodeId);
  const models = archives
    .flatMap((archive) => archive.models)
    .sort((a, b) => a.archivePath.localeCompare(b.archivePath) || a.name.localeCompare(b.name));
  const archiveMeshes = archives
    .flatMap((archive) => archive.meshes)
    .sort((a, b) => a.archivePath.localeCompare(b.archivePath) || a.modelName.localeCompare(b.modelName) || a.name.localeCompare(b.name) || a.shapeIndex - b.shapeIndex);

  return { archives, archiveNodes, sceneNodes, models, archiveMeshes };
}

export async function parseBrresEditorArchive(path: string, data: Uint8Array): Promise<BrresEditorArchive | null> {
  const [{ default: ArrayBufferSlice }, BRRES] = await Promise.all([
    // @ts-ignore noclip source is vendored outside this app's tsconfig surface.
    import('../../vendor/noclip.website/src/ArrayBufferSlice.js'),
    // @ts-ignore noclip source is vendored outside this app's tsconfig surface.
    import('../../vendor/noclip.website/src/rres/brres.js'),
  ]);

  let rres: any;
  try {
    rres = BRRES.parse(new ArrayBufferSlice(data.slice().buffer));
  } catch {
    return null;
  }

  const models: BrresEditorModel[] = [];
  const meshes: BrresEditorMesh[] = [];
  const nodes: BrresEditorNode[] = [];

  for (const model of rres.mdl0 as any[]) {
    const modelId = createAssetId(path, 'model', model.name);
    models.push({
      id: modelId,
      archivePath: path,
      name: model.name,
      sourceOffset: model.sourceOffset ?? null,
      resourceSize: model.resourceSize ?? null,
      nodeCount: model.nodes?.length ?? 0,
      materialCount: model.materials?.length ?? 0,
      shapeCount: model.shapes?.length ?? 0,
      drawOpaSourceOffset: model.sceneGraph?.drawOpaSourceOffset ?? null,
      drawOpaEndOffset: model.sceneGraph?.drawOpaEndOffset ?? null,
      drawXluSourceOffset: model.sceneGraph?.drawXluSourceOffset ?? null,
      drawXluEndOffset: model.sceneGraph?.drawXluEndOffset ?? null,
      meshSlots: deriveMdl0MeshSlots(path, model),
    });

    for (const mesh of deriveMdl0Meshes(path, model)) {
      meshes.push({
        id: mesh.id,
        archivePath: path,
        modelId,
        modelName: model.name,
        name: mesh.shapeName,
        shapeIndex: mesh.shapeIndex,
        sourceOffset: mesh.sourceOffset ?? null,
        matrixIndex: mesh.matrixIndex,
        vertexCount: mesh.vertexCount,
        indexCount: mesh.indexCount,
        bindingCount: mesh.bindingCount,
        opaqueBindingCount: mesh.opaqueBindingCount,
        translucentBindingCount: mesh.translucentBindingCount,
      });
    }

    for (const node of model.nodes ?? []) {
      nodes.push({
        id: createAssetId(path, 'node', model.name, String(node.id)),
        archivePath: path,
        modelName: model.name,
        name: node.name,
        nodeId: node.id,
        parentNodeId: node.parentNodeId,
        visible: !!node.visible,
        billboardMode: node.billboardMode ?? 0,
        billboardRefNodeId: node.billboardRefNodeId ?? 0,
        sourceOffset: node.sourceOffset,
        transform: {
          scale: toVec(node.scale),
          rotation: toVec(node.rotation),
          translation: toVec(node.translation),
        },
      });
    }
  }

  return { path, models, meshes, nodes };
}

export function patchBrresNodeTransform(data: Uint8Array, node: Pick<BrresEditorNode, 'sourceOffset'>, transform: BrresTransform): Uint8Array {
  const next = data.slice();
  const view = new DataView(next.buffer, next.byteOffset, next.byteLength);
  writeVec3(view, node.sourceOffset + 0x20, transform.scale);
  writeVec3(view, node.sourceOffset + 0x2c, transform.rotation);
  writeVec3(view, node.sourceOffset + 0x38, transform.translation);
  return next;
}

export function patchBrresNodeVisibility(data: Uint8Array, node: Pick<BrresEditorNode, 'sourceOffset'>, visible: boolean): Uint8Array {
  const next = data.slice();
  const view = new DataView(next.buffer, next.byteOffset, next.byteLength);
  const flags = view.getUint32(node.sourceOffset + 0x14);
  view.setUint32(node.sourceOffset + 0x14, visible ? flags | MDL0_NODE_VISIBLE_FLAG : flags & ~MDL0_NODE_VISIBLE_FLAG);
  return next;
}

export function patchBrresNodeBillboardSettings(
  data: Uint8Array,
  node: Pick<BrresEditorNode, 'sourceOffset'>,
  patch: Pick<BrresEditorNode, 'billboardMode' | 'billboardRefNodeId'>,
): Uint8Array {
  const next = data.slice();
  const view = new DataView(next.buffer, next.byteOffset, next.byteLength);
  view.setUint32(node.sourceOffset + 0x18, Math.max(0, Math.min(0xffffffff, Math.trunc(patch.billboardMode))));
  view.setUint32(node.sourceOffset + 0x1c, Math.max(0, Math.min(0xffffffff, Math.trunc(patch.billboardRefNodeId))));
  return next;
}

export function patchBrresMeshSlotBinding(
  data: Uint8Array,
  meshSlot: Pick<Mdl0MeshSlot, 'drawSourceOffset'>,
  patch: Pick<Mdl0MeshSlot, 'materialIndex' | 'nodeId'>,
): Uint8Array {
  if (meshSlot.drawSourceOffset == null || patch.materialIndex === null || patch.nodeId === null) return data;
  const next = data.slice();
  const view = new DataView(next.buffer, next.byteOffset, next.byteLength);
  view.setUint16(meshSlot.drawSourceOffset + 0x01, Math.max(0, Math.min(0xffff, Math.trunc(patch.materialIndex))));
  view.setUint16(meshSlot.drawSourceOffset + 0x05, Math.max(0, Math.min(0xffff, Math.trunc(patch.nodeId))));
  return next;
}

export function patchBrresMeshMatrixIndex(data: Uint8Array, mesh: Pick<BrresEditorMesh, 'sourceOffset'>, matrixIndex: number): Uint8Array {
  if (mesh.sourceOffset == null) return data;
  const next = data.slice();
  const view = new DataView(next.buffer, next.byteOffset, next.byteLength);
  view.setInt32(mesh.sourceOffset + 0x08, Math.trunc(matrixIndex));
  return next;
}

function createAssetId(archivePath: string, kind: string, ...parts: string[]) {
  return `${archivePath.toLowerCase()}::${kind}::${parts.map((part) => encodeURIComponent(part)).join('::')}`;
}

function toVec(value: { 0: number; 1: number; 2: number } | number[] | undefined | null) {
  return { x: value?.[0] ?? 0, y: value?.[1] ?? 0, z: value?.[2] ?? 0 };
}

function writeVec3(view: DataView, offset: number, value: { x: number; y: number; z: number }) {
  view.setFloat32(offset + 0x00, value.x);
  view.setFloat32(offset + 0x04, value.y);
  view.setFloat32(offset + 0x08, value.z);
}
