/**
 * The pure half of project storage: summaries for the home screen, the `.mkwcreate.json` file
 * format, duplicate/rename helpers and relative times. No IndexedDB and no DOM in here, so it is
 * all unit tested (`projectFile.test.ts`); `projectStore.ts` does the I/O.
 */
import { migrateProject } from '../../../lib/create/ops/migrate';
import { createId } from '../../../lib/create/ids';
import { roadLength, sampleRoad } from '../../../lib/create/spline';
import type { CreateProject } from '../../../lib/create/types';
import type { CreateProjectSummary } from './types';

export const PROJECT_FILE_FORMAT = 'mkw-create-design';
export const PROJECT_FILE_EXTENSION = '.mkwcreate.json';
export const MAX_OUTLINE_POINTS = 90;

/** Thin the road into at most `MAX_OUTLINE_POINTS` points and fit them in the unit square (aspect kept). */
export function projectOutline(project: CreateProject): CreateProjectSummary['outline'] {
  const road = project.roads[0];
  if (!road || road.points.length < 2) return [];
  let raw: Array<{ x: number; z: number }>;
  try {
    const length = Math.max(1, roadLength(road));
    const step = Math.max(400, length / MAX_OUTLINE_POINTS);
    raw = sampleRoad(road, { step, maxAngleDegrees: 25 }).map((s) => ({ x: s.position.x, z: s.position.z }));
  } catch {
    raw = road.points.map((p) => ({ x: p.position.x, z: p.position.z }));
  }
  if (raw.length === 0) return [];
  if (raw.length > MAX_OUTLINE_POINTS * 1.5) {
    const stride = Math.ceil(raw.length / MAX_OUTLINE_POINTS);
    raw = raw.filter((_, i) => i % stride === 0);
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of raw) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const span = Math.max(maxX - minX, maxZ - minZ, 1);
  const pad = 0.08;
  const scale = (1 - pad * 2) / span;
  const ox = 0.5 - ((maxX - minX) * scale) / 2 - minX * scale;
  const oz = 0.5 - ((maxZ - minZ) * scale) / 2 - minZ * scale;
  return raw.map((p) => ({ x: p.x * scale + ox, z: p.z * scale + oz }));
}

export function summarizeProject(project: CreateProject): CreateProjectSummary {
  return {
    id: project.id,
    name: project.name,
    themeId: project.themeId,
    updatedAt: project.updatedAt,
    outline: projectOutline(project),
    closed: project.roads[0]?.closed ?? false,
  };
}

/** What gets stored per design: the design itself plus its home-screen summary. */
export interface StoredProject {
  project: CreateProject;
  summary: CreateProjectSummary;
}

export function toStoredProject(project: CreateProject): StoredProject {
  return { project, summary: summarizeProject(project) };
}

// ── Files ────────────────────────────────────────────────────────────────────────────────────

export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFileError';
  }
}

export function serializeProjectFile(project: CreateProject): string {
  return JSON.stringify({ format: PROJECT_FILE_FORMAT, project }, null, 1);
}

/** Reads a `.mkwcreate.json` (or a bare design JSON), migrating older versions. Throws `ProjectFileError`. */
export function parseProjectFile(text: string): CreateProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProjectFileError('That file is not a track design: it could not be read.');
  }
  const candidate =
    typeof parsed === 'object' && parsed !== null && 'project' in parsed && (parsed as { project: unknown }).project
      ? (parsed as { project: unknown }).project
      : parsed;
  const looksLikeDesign =
    typeof candidate === 'object' &&
    candidate !== null &&
    Array.isArray((candidate as { roads?: unknown }).roads) &&
    typeof (candidate as { themeId?: unknown }).themeId === 'string';
  if (!looksLikeDesign) throw new ProjectFileError('That file is not a track design.');
  try {
    return migrateProject(candidate);
  } catch (error) {
    if (error instanceof ProjectFileError) throw error;
    throw new ProjectFileError(error instanceof Error ? error.message : 'That file is not a track design.');
  }
}

export function projectFileName(project: CreateProject): string {
  const base = project.name.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-') || 'my-track';
  return `${base}${PROJECT_FILE_EXTENSION}`;
}

/** A copy with a new identity, ready to be saved next to the original. */
export function duplicateProjectData(project: CreateProject, now = Date.now()): CreateProject {
  const copy: CreateProject = JSON.parse(JSON.stringify(project));
  copy.id = createId('project');
  copy.name = `${project.name} copy`;
  copy.createdAt = now;
  copy.updatedAt = now;
  delete copy.compiledHashes;
  return copy;
}

/** Imported designs always get a fresh id so importing never overwrites an existing design. */
export function reidentifyImportedProject(project: CreateProject, existingIds: ReadonlySet<string>, now = Date.now()): CreateProject {
  if (!existingIds.has(project.id)) return { ...project, updatedAt: project.updatedAt || now };
  return { ...project, id: createId('project'), updatedAt: now };
}

// ── Relative time ────────────────────────────────────────────────────────────────────────────

export function relativeTime(then: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return days === 1 ? 'yesterday' : `${days} days ago`;
  return new Date(then).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "My track", "My track 2", ... — the first name not already taken. */
export function uniqueProjectName(base: string, taken: readonly string[]): string {
  const names = new Set(taken.map((n) => n.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} ${i}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}
