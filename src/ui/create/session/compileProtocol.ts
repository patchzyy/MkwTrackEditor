/** Messages between the session and `compile.worker.ts` (a full design compile off the main thread). */
import type { KmpFile } from '../../../lib/kmpFile';
import type { CompileStats, CreateIssue, CreateProject } from '../../../lib/create/types';

export interface CompileRequest {
  id: number;
  project: CreateProject;
  /** The KMP the locked sections are copied from (the track document's current one). */
  previousKmp: KmpFile | null;
}

/** A compile result without the geometry (which the main thread already has). */
export interface CompileOutput {
  /** Archive path -> bytes. */
  files: Array<[string, Uint8Array]>;
  /** The generated layout, structured. */
  kmp: KmpFile;
  issues: CreateIssue[];
  stats: CompileStats;
  /** Hash per generated file, for hand-edit detection. */
  hashes: Record<string, string>;
}

export type CompileResponse =
  | { id: number; type: 'done'; output: CompileOutput }
  | { id: number; type: 'error'; message: string };
