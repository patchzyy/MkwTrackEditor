/**
 * "Open this track", with the reading done off the main thread when the environment has workers.
 *
 * The UI calls {@link loadTrack}; it never calls `loadTrackBytes` directly any more. Two paths,
 * one result:
 *
 *   - **Worker.** One `trackLoad.worker.ts` per load, terminated when it answers. A worker per
 *     load rather than a pool because cancelling then costs nothing (`terminate()`), and because
 *     a load holds tens of megabytes of decoded archive that should go away with it.
 *   - **Same thread.** vitest, the Vite-SSR batch check, and any browser without module workers.
 *     Same progress callback, same result; it just cannot help the page stay responsive.
 *
 * `loadTrackBytes` keeps its signature and stays exported from `track.ts` — the format tests call
 * it directly and have no business knowing about threads.
 */

import { buildEditorProjectState } from './brresEditor';
import { loadTrackBytes } from './track';
import { readingFraction, type TrackLoadProgressListener } from './trackLoadProgress';
import type { LoadedTrack, TrackLoadRequest, TrackLoadWorkerMessage } from './trackLoaderProtocol';

export type { LoadedTrack } from './trackLoaderProtocol';

export interface LoadTrackRequestOptions {
  /** Cap on how many model archives get a summary. The smoke harness lowers it. */
  brresSummaryLimit?: number;
  onProgress?: TrackLoadProgressListener;
  /** Abandons the load. The worker is terminated; the returned promise rejects with `reason`. */
  signal?: AbortSignal;
}

/** Is this environment able to run the loader off the main thread? */
export function canLoadTracksInWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof window !== 'undefined';
}

export async function loadTrack(
  bytes: Uint8Array,
  fileName: string,
  options: LoadTrackRequestOptions = {},
): Promise<LoadedTrack> {
  if (canLoadTracksInWorker()) {
    try {
      return await loadTrackInWorker(bytes, fileName, options);
    } catch (error) {
      if (isAbort(error)) throw error;
      if (!(error instanceof WorkerUnavailableError)) throw error;
      // A worker that cannot even start (a blocked blob/module URL, an extension, a very old
      // browser) must not make the editor useless; fall through and read it here instead.
      console.warn('[track] the loader worker could not start; reading on the main thread', error.cause);
    }
  }
  return loadTrackOnThisThread(bytes, fileName, options);
}

/** The fallback path, exported so tests can exercise it without pretending workers are missing. */
export async function loadTrackOnThisThread(
  bytes: Uint8Array,
  fileName: string,
  options: LoadTrackRequestOptions = {},
): Promise<LoadedTrack> {
  throwIfAborted(options.signal);
  const track = await loadTrackBytes(bytes, fileName, {
    brresSummaryLimit: options.brresSummaryLimit,
    onProgress: options.onProgress,
  });
  throwIfAborted(options.signal);
  options.onProgress?.({ stage: 'project', label: 'Preparing the model list', fraction: readingFraction(1) });
  const projectState = await buildEditorProjectState(track);
  throwIfAborted(options.signal);
  return { track, projectState };
}

class WorkerUnavailableError extends Error {
  constructor(public readonly cause: unknown) {
    super('The track loader worker is unavailable.');
    this.name = 'WorkerUnavailableError';
  }
}

let nextRequestId = 1;

function loadTrackInWorker(
  bytes: Uint8Array,
  fileName: string,
  options: LoadTrackRequestOptions,
): Promise<LoadedTrack> {
  throwIfAborted(options.signal);

  let worker: Worker;
  try {
    // `new URL(..., import.meta.url)` is what makes Vite bundle the worker and rewrite the URL
    // for the deployed base path, so this keeps working under the `/MkwTrackEditor/` subpath.
    worker = new Worker(new URL('./trackLoad.worker.ts', import.meta.url), {
      type: 'module',
      name: 'mkw-track-loader',
    });
  } catch (error) {
    return Promise.reject(new WorkerUnavailableError(error));
  }

  const id = nextRequestId++;

  return new Promise<LoadedTrack>((resolve, reject) => {
    let settled = false;
    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      run();
    };

    function onAbort() {
      finish(() => reject(abortReason(options.signal)));
    }

    worker.addEventListener('message', (event: MessageEvent<TrackLoadWorkerMessage>) => {
      const message = event.data;
      if (!message || message.id !== id) return;
      if (message.type === 'progress') {
        options.onProgress?.(message.progress);
        return;
      }
      if (message.type === 'error') {
        finish(() => reject(new Error(message.message)));
        return;
      }
      finish(() => resolve({ track: message.track, projectState: message.projectState }));
    });

    worker.addEventListener('error', (event: ErrorEvent) => {
      // A module worker that fails to load reports here before it ever runs a line of our code.
      event.preventDefault?.();
      finish(() => reject(new WorkerUnavailableError(event.message || event.error)));
    });
    worker.addEventListener('messageerror', () => {
      finish(() => reject(new Error('The loaded track could not be handed back from the loader (it is not cloneable).')));
    });

    options.signal?.addEventListener('abort', onAbort, { once: true });

    // Copy first: the caller (a fetch response, a File read) may still own these bytes, and the
    // slice is one memcpy against seconds of parsing.
    const owned = bytes.slice();
    const request: TrackLoadRequest = {
      id,
      bytes: owned.buffer as ArrayBuffer,
      fileName,
      brresSummaryLimit: options.brresSummaryLimit,
    };
    worker.postMessage(request, [request.bytes]);
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal | undefined): unknown {
  const reason = signal?.reason;
  if (reason !== undefined) return reason;
  const error = new Error('The track load was cancelled.');
  error.name = 'AbortError';
  return error;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
