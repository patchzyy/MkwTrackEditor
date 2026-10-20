// The archive → model → material tree Material mode's left panel shows, plus its search filter.
// Pure and unit tested; `MaterialOutliner.tsx` only renders what this returns.
import type { GxArchiveMaterials, GxMaterialRef, GxMaterialSummary } from '../../lib/gxMaterial';
import { normalizeArchivePath } from '../../lib/brres/bakeCourseModel';
import type { TrackDocument } from '../../lib/track';

export type MaterialArchiveRole = 'course' | 'skybox' | 'minimap' | 'object';

/** The left panel's top-level folders. */
export type MaterialGroupId = 'course' | 'sky' | 'objects' | 'other';

export const MATERIAL_GROUPS: ReadonlyArray<{ id: MaterialGroupId; label: string }> = [
  { id: 'course', label: 'Course' },
  { id: 'sky', label: 'Sky' },
  { id: 'objects', label: 'Objects' },
  { id: 'other', label: 'Other' },
];

export interface MaterialArchiveEntry {
  path: string;
  label: string;
  role: MaterialArchiveRole;
  group: MaterialGroupId;
  /** `'common'`: the model comes from the game's shared files and the track has no copy yet. */
  source: 'track' | 'common';
}

/** A model the viewport can show that the track archive does not carry (a Common.szs object). */
export interface ExtraMaterialArchive {
  path: string;
  label: string;
}

export function groupForRole(role: MaterialArchiveRole): MaterialGroupId {
  return role === 'course' ? 'course' : role === 'skybox' ? 'sky' : role === 'object' ? 'objects' : 'other';
}

/**
 * Every `.brres` in the track, course model first, then the skybox, the minimap, and the object
 * models alphabetically — the order an author thinks about them in.
 */
export function listMaterialArchives(
  track: TrackDocument | null,
  extras: readonly ExtraMaterialArchive[] = [],
  /** Friendly names for object models, keyed by normalized path (`itembox.brres` -> "Item Box"). */
  labels: ReadonlyMap<string, string> = new Map(),
): MaterialArchiveEntry[] {
  if (!track) return [];
  const rank: Record<MaterialArchiveRole, number> = { course: 0, skybox: 1, minimap: 2, object: 3 };
  const entries = track.archiveEntries
    .filter((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('.brres'))
    .map((entry) => {
      const described = describeMaterialArchive(entry.path);
      const friendly = labels.get(normalizeArchivePath(entry.path));
      return friendly && described.role === 'object' ? { ...described, label: friendly } : described;
    });
  const have = new Set(entries.map((entry) => baseNameOf(entry.path)));
  for (const extra of extras) {
    if (have.has(baseNameOf(extra.path))) continue;
    have.add(baseNameOf(extra.path));
    entries.push({ ...describeMaterialArchive(extra.path), label: extra.label, source: 'common' });
  }
  return entries.sort((a, b) => rank[a.role] - rank[b.role] || a.label.localeCompare(b.label) || a.path.localeCompare(b.path));
}

function baseNameOf(path: string): string {
  return normalizeArchivePath(path).split('/').pop() ?? '';
}

export function describeMaterialArchive(path: string): MaterialArchiveEntry {
  const base = path.split('/').pop() ?? path;
  const lower = base.toLowerCase();
  const make = (label: string, role: MaterialArchiveRole): MaterialArchiveEntry => ({
    path,
    label,
    role,
    group: groupForRole(role),
    source: 'track',
  });
  if (lower === 'course_model.brres') return make('Track model', 'course');
  if (lower === 'vrcorn_model.brres') return make('Skybox', 'skybox');
  if (lower === 'map_model.brres') return make('Minimap', 'minimap');
  return make(base.replace(/\.brres$/i, ''), 'object');
}

/** The key archives are remembered under, whichever way the path was written. */
export function archiveKey(path: string): string {
  return normalizeArchivePath(path);
}

export function findArchiveBytes(track: TrackDocument | null, path: string): Uint8Array | null {
  if (!track) return null;
  const wanted = archiveKey(path);
  const entry = track.archiveEntries.find(
    (candidate) => candidate.type === 'file' && archiveKey(candidate.path) === wanted,
  );
  return entry?.data ?? null;
}

// ---------------------------------------------------------------------------- the tree

export interface MaterialTreeMaterial {
  kind: 'material';
  id: string;
  ref: GxMaterialRef;
  summary: GxMaterialSummary;
  /** Texture names, joined for the caption row. */
  caption: string;
  /** Set when this material's TEV block is shared with others. */
  sharedBadge: string | null;
}

export interface MaterialTreeModel {
  kind: 'model';
  id: string;
  modelName: string;
  materials: MaterialTreeMaterial[];
}

export interface MaterialTreeArchive {
  kind: 'archive';
  id: string;
  path: string;
  label: string;
  role: MaterialArchiveRole;
  group: MaterialGroupId;
  source: 'track' | 'common';
  models: MaterialTreeModel[];
  /** Total materials under this archive, after filtering. */
  materialCount: number;
  /** True when the archive has been read; false while it is still loading or failed. */
  loaded: boolean;
}

export function materialRefKey(ref: GxMaterialRef): string {
  return `${ref.archivePath.replace(/^\.\//, '').toLowerCase()}|${ref.modelName}|${ref.materialName}`;
}

export function materialRefEquals(a: GxMaterialRef | null, b: GxMaterialRef | null): boolean {
  if (!a || !b) return a === b;
  return materialRefKey(a) === materialRefKey(b);
}

/**
 * Builds the outliner tree. `archives` is what has been read so far — one entry per archive the
 * user has expanded — so an unopened archive still shows as a row with no children.
 */
export function buildMaterialTree(
  entries: readonly MaterialArchiveEntry[],
  archives: ReadonlyMap<string, GxArchiveMaterials>,
  query = '',
): MaterialTreeArchive[] {
  const needle = query.trim().toLowerCase();
  return entries.map((entry) => {
    const archive = archives.get(entry.path) ?? archives.get(archiveKey(entry.path));
    const models: MaterialTreeModel[] = (archive?.models ?? []).map((model) => ({
      kind: 'model',
      id: `${entry.path}|${model.modelName}`,
      modelName: model.modelName,
      materials: model.materials
        .filter((material) => matchesQuery(material, model.modelName, entry.label, needle))
        .map((material) => toTreeMaterial(entry.path, material)),
    }));
    const visible = models.filter((model) => model.materials.length > 0);
    return {
      kind: 'archive',
      id: entry.path,
      path: entry.path,
      label: entry.label,
      role: entry.role,
      group: entry.group,
      source: entry.source,
      models: needle ? visible : models,
      materialCount: models.reduce((sum, model) => sum + model.materials.length, 0),
      loaded: archive !== undefined,
    };
  });
}

function toTreeMaterial(archivePath: string, summary: GxMaterialSummary): MaterialTreeMaterial {
  const textures = summary.textures.filter(Boolean);
  return {
    kind: 'material',
    id: `${archivePath}|${summary.modelName}|${summary.materialName}`,
    ref: { archivePath, modelName: summary.modelName, materialName: summary.materialName },
    summary,
    caption: textures.length > 0 ? textures.join(', ') : 'No texture',
    sharedBadge:
      summary.sharedShaderWith.length > 0
        ? `Shared with ${summary.sharedShaderWith.length} other${summary.sharedShaderWith.length === 1 ? '' : 's'}`
        : null,
  };
}

function matchesQuery(material: GxMaterialSummary, modelName: string, archiveLabel: string, needle: string): boolean {
  if (!needle) return true;
  const haystack = [
    material.materialName,
    modelName,
    archiveLabel,
    ...material.textures,
    ...material.meshes,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

/** Flattens the tree to the materials it contains, in display order. */
export function treeMaterials(tree: readonly MaterialTreeArchive[]): MaterialTreeMaterial[] {
  return tree.flatMap((archive) => archive.models.flatMap((model) => model.materials));
}

/** The material after (or before) the selected one, for keyboard navigation. */
export function stepMaterialSelection(
  tree: readonly MaterialTreeArchive[],
  current: GxMaterialRef | null,
  delta: number,
): GxMaterialRef | null {
  const list = treeMaterials(tree);
  if (list.length === 0) return null;
  const index = current ? list.findIndex((material) => materialRefEquals(material.ref, current)) : -1;
  const next = index < 0 ? (delta > 0 ? 0 : list.length - 1) : (index + delta + list.length) % list.length;
  return list[next].ref;
}

/** "6 materials · 12 textures" style summary for the panel header. */
export function describeArchiveTotals(archive: GxArchiveMaterials | undefined): string | null {
  if (!archive) return null;
  const materials = archive.models.reduce((sum, model) => sum + model.materials.length, 0);
  return `${materials} material${materials === 1 ? '' : 's'} · ${archive.textures.length} texture${archive.textures.length === 1 ? '' : 's'}`;
}
