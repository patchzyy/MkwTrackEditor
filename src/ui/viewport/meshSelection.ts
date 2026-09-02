// Model-mode mesh selection bookkeeping for the viewport. Pure and testable.

import {
  createIdentityMeshTransform,
  meshTargetKey,
  type EditorMeshTarget,
  type MeshSelectionGranularity,
  type MeshTransform,
} from '../../lib/brresEditor';
import type { EditorMeshPickPayload } from '../../lib/brresRenderAdapter';
import type { Vec3 } from '../../lib/kmp';

export interface MeshSelectionEntry {
  key: string;
  target: EditorMeshTarget;
  label: string;
  /** Untransformed bounding-box centre, in game units. */
  baseCenter: Vec3;
  transform: MeshTransform;
}

export function describeMeshPick(pick: EditorMeshPickPayload): string {
  const base = pick.shapeName || `Shape ${pick.shapeIndex}`;
  if (pick.granularity === 'node') return `${pick.nodeName || `Node ${pick.nodeId}`}`;
  if (pick.granularity === 'shape' || pick.componentIndex === null) return base;
  return `${base} #${pick.componentIndex + 1}`;
}

export function toMeshTarget(pick: EditorMeshPickPayload, granularity: MeshSelectionGranularity): EditorMeshTarget {
  return {
    archivePath: pick.archivePath,
    modelName: pick.modelName,
    shapeIndex: pick.shapeIndex,
    drawOpIndex: pick.drawOpIndex,
    componentIndex: granularity === 'component' ? pick.componentIndex : null,
    nodeId: pick.nodeId,
    granularity,
  };
}

export function makeMeshSelectionEntry(
  target: EditorMeshTarget,
  label: string,
  baseCenter: Vec3,
  transform: MeshTransform = createIdentityMeshTransform(),
): MeshSelectionEntry {
  return { key: meshTargetKey(target), target, label, baseCenter, transform };
}

/** Click semantics: plain click replaces the selection, shift-click toggles. */
export function applyMeshSelectionClick(
  current: readonly MeshSelectionEntry[],
  entry: MeshSelectionEntry | null,
  additive: boolean,
): MeshSelectionEntry[] {
  if (entry === null) return additive ? [...current] : [];
  if (!additive) return [entry];
  const index = current.findIndex((candidate) => candidate.key === entry.key);
  if (index >= 0) return [...current.slice(0, index), ...current.slice(index + 1)];
  return [...current, entry];
}

export function findMeshSelection(entries: readonly MeshSelectionEntry[], key: string): MeshSelectionEntry | null {
  return entries.find((entry) => entry.key === key) ?? null;
}

export function updateMeshSelectionTransform(
  entries: readonly MeshSelectionEntry[],
  key: string,
  transform: MeshTransform,
): MeshSelectionEntry[] {
  return entries.map((entry) => (entry.key === key ? { ...entry, transform } : entry));
}

export const MESH_SELECTION_ID_PREFIX = 'editor-mesh::';

export function meshSelectionGizmoId(entry: MeshSelectionEntry): string {
  return `${MESH_SELECTION_ID_PREFIX}${entry.key}`;
}

export function isMeshSelectionGizmoId(id: string): boolean {
  return id.startsWith(MESH_SELECTION_ID_PREFIX);
}

export function meshSelectionKeyFromGizmoId(id: string): string {
  return id.slice(MESH_SELECTION_ID_PREFIX.length);
}
