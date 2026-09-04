/**
 * The message shapes `trackLoader.ts` and `trackLoad.worker.ts` agree on, plus the transferable
 * hunt.
 *
 * Kept apart from both so the worker module (which runs `self.addEventListener` at import time)
 * is never pulled into a unit test or into the SSR batch check just to reach a type.
 */

import type { EditorProjectState } from './brresEditor';
import type { TrackDocument } from './track';
import type { TrackLoadProgress } from './trackLoadProgress';

export interface TrackLoadRequest {
  id: number;
  bytes: ArrayBuffer;
  fileName: string;
  brresSummaryLimit?: number;
}

export type TrackLoadWorkerMessage =
  | { id: number; type: 'progress'; progress: TrackLoadProgress }
  | { id: number; type: 'done'; track: TrackDocument; projectState: EditorProjectState }
  | { id: number; type: 'error'; message: string };

/** What a finished load hands back: the document plus the Model-mode view of its archives. */
export interface LoadedTrack {
  track: TrackDocument;
  projectState: EditorProjectState;
}

/**
 * Every distinct `ArrayBuffer` reachable from the document.
 *
 * `postMessage` copies by default, which for a track means duplicating tens of megabytes. Listing
 * the buffers as transferables moves them instead. Structured clone keeps buffer identity within
 * one message, so the hundred-odd `Uint8Array` views that all point into the single decoded
 * archive arrive as a hundred views onto the single transferred buffer — same offsets, same
 * lengths, byte-for-byte the same archive.
 *
 * The walk is generic on purpose: a new typed-array field on `TrackDocument` should not silently
 * fall back to being copied.
 */
export function collectTransferables(value: unknown): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  const seen = new Set<object>();
  walk(value, buffers, seen, 0);
  return [...buffers];
}

const MAX_DEPTH = 12;

function walk(value: unknown, buffers: Set<ArrayBuffer>, seen: Set<object>, depth: number): void {
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return;
  if (seen.has(value)) return;
  seen.add(value);

  if (ArrayBuffer.isView(value)) {
    const buffer = value.buffer;
    // A SharedArrayBuffer cannot be transferred, and neither can a detached one.
    if (buffer instanceof ArrayBuffer && buffer.byteLength > 0) buffers.add(buffer);
    return;
  }
  if (value instanceof ArrayBuffer) {
    if (value.byteLength > 0) buffers.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, buffers, seen, depth + 1);
    return;
  }
  if (value instanceof Map) {
    for (const [key, item] of value) {
      walk(key, buffers, seen, depth + 1);
      walk(item, buffers, seen, depth + 1);
    }
    return;
  }
  if (value instanceof Set) {
    for (const item of value) walk(item, buffers, seen, depth + 1);
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    walk(item, buffers, seen, depth + 1);
  }
}
