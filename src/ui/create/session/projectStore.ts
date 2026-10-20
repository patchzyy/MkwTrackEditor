/**
 * Create-mode designs in IndexedDB (`create-projects` in the editor database) plus the
 * `.mkwcreate.json` download/upload. Pure helpers live in `projectFile.ts`.
 */
import { CREATE_PROJECTS_STORE, hasIndexedDb, withEditorStore } from '../../../lib/editorDb';
import type { CreateProject } from '../../../lib/create/types';
import { downloadBytes } from '../../downloadFile';
import { migrateProject } from '../../../lib/create/ops/migrate';
import {
  parseProjectFile,
  projectFileName,
  serializeProjectFile,
  toStoredProject,
  type StoredProject,
} from './projectFile';
import type { CreateProjectSummary } from './types';

export function projectStorageAvailable(): boolean {
  return hasIndexedDb();
}

/** Every saved design's summary, newest first. A record that cannot be read is skipped. */
export async function listProjectSummaries(): Promise<CreateProjectSummary[]> {
  if (!hasIndexedDb()) return [];
  const records = await withEditorStore<StoredProject[]>(CREATE_PROJECTS_STORE, 'readonly', (store) => store.getAll());
  return records
    .filter((record) => record && record.summary && typeof record.summary.id === 'string')
    .map((record) => record.summary)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Loads one design (migrating it to the current version), or null when it is gone. */
export async function loadStoredProject(id: string): Promise<CreateProject | null> {
  if (!hasIndexedDb()) return null;
  const record = await withEditorStore<StoredProject | undefined>(CREATE_PROJECTS_STORE, 'readonly', (store) => store.get(id));
  if (!record?.project) return null;
  return migrateProject(record.project);
}

export async function saveStoredProject(project: CreateProject): Promise<void> {
  if (!hasIndexedDb()) throw new Error('This browser cannot save designs (no storage available).');
  await withEditorStore(CREATE_PROJECTS_STORE, 'readwrite', (store) => store.put(toStoredProject(project), project.id));
}

export async function deleteStoredProject(id: string): Promise<void> {
  if (!hasIndexedDb()) return;
  await withEditorStore(CREATE_PROJECTS_STORE, 'readwrite', (store) => store.delete(id));
}

export function downloadProjectFile(project: CreateProject): void {
  downloadBytes(projectFileName(project), new TextEncoder().encode(serializeProjectFile(project)));
}

export async function readProjectFile(file: File): Promise<CreateProject> {
  return parseProjectFile(await file.text());
}
