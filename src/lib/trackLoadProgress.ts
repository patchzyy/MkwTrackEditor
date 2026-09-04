/**
 * Progress reporting for "open a track", shared by the worker that reads the archive and by the
 * renderer that builds the scene out of it.
 *
 * Opening a track is two jobs on two threads:
 *
 *   1. **Reading** — Yaz0 decode, U8 parse, KMP, KCL, one summary per model archive. This runs in
 *      `src/lib/trackLoad.worker.ts`, so the page keeps painting while it happens.
 *   2. **Building** — the noclip scene: BRRES parses, texture uploads, object placement. This has
 *      to be on the main thread because it talks to WebGL, so it yields between steps instead
 *      (`SceneContext.onProgress` in the vendored renderer).
 *
 * Both report into the same 0..1 scale so the overlay shows one bar that only ever moves
 * forwards. {@link READING_PHASE_END} is where one hands over to the other.
 */

export type TrackLoadStage =
  | 'fetching'
  | 'decompressing'
  | 'archive'
  | 'layout'
  | 'collision'
  | 'models'
  | 'project'
  | 'scene-start'
  | 'scene-packing'
  | 'scene-common'
  | 'scene-course'
  | 'scene-sky'
  | 'scene-objects'
  | 'scene-effects'
  | 'scene-finishing';

export interface TrackLoadProgress {
  /** Stable identifier, for tests and probes. */
  stage: TrackLoadStage;
  /** Title line for the overlay. A sentence, not a section code. */
  label: string;
  /** Second line, when there is something countable to say ("Model 3 of 12"). */
  detail?: string;
  /** 0..1 through the whole job, monotonic across both phases. */
  fraction: number;
}

export type TrackLoadProgressListener = (progress: TrackLoadProgress) => void;

/**
 * Where the reading phase stops and the scene build takes over. Reading a big archive and
 * building its scene cost roughly the same, but reading reports far more often, so giving it a
 * little under half the bar keeps the movement even.
 */
export const READING_PHASE_END = 0.45;

/** Scales a 0..1 fraction of the reading phase onto the shared bar. */
export function readingFraction(fraction: number): number {
  return clamp01(fraction) * READING_PHASE_END;
}

/** Scales a 0..1 fraction of the scene build onto the shared bar. */
export function sceneFraction(fraction: number): number {
  return READING_PHASE_END + clamp01(fraction) * (1 - READING_PHASE_END);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Hands control back to the browser so it can paint.
 *
 * Not `scheduler.yield()`, and not a bare `requestAnimationFrame`: awaiting a promise resolved
 * *inside* a rAF callback resumes as a microtask still inside that callback, so the work after
 * the await runs before the frame is painted and the page stays frozen. Waiting for a frame and
 * then for a task after it is what actually lets a paint through.
 */
export async function yieldToHost(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0);
      });
      return;
    }
    setTimeout(resolve, 0);
  });
}
