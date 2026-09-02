/**
 * Async BRRES thumbnail service.
 *
 * `getBrresThumbnail()` renders a model with noclip's real GX renderer, one render per
 * animation frame, and memoises the PNG data URL in an LRU keyed on the BRRES bytes so the
 * same shared model is never drawn twice.
 */

import {
  hashBytes,
  InFlightMap,
  LruCache,
  makeThumbnailCacheKey,
  SerialTaskQueue,
  type ScheduleFn,
} from './cache';
import type { ThumbnailRenderOptions, ThumbnailRenderResult } from './webglThumbnailRenderer';

export { computeStudioFraming, isUsableBounds, makeEmptyBounds, expandBoundsByPoint, boundsCenter, boundsRadius } from './framing';
export type { Bounds3, StudioFraming, StudioFramingOptions } from './framing';
export { hashBytes, LruCache, SerialTaskQueue, InFlightMap, immediateSchedule } from './cache';
export type { ThumbnailRenderOptions, ThumbnailRenderResult } from './webglThumbnailRenderer';

export interface BrresThumbnailOptions extends ThumbnailRenderOptions {
  /**
   * Extra token folded into the cache key. Use it when the same BRRES bytes should produce
   * different images (for example a different set of extra texture archives).
   */
  variantKey?: string;
}

const THUMBNAIL_CACHE_CAPACITY = 512;

const cache = new LruCache<string, string | null>(THUMBNAIL_CACHE_CAPACITY);
const inFlight = new InFlightMap<string, string | null>();
const byteHashes = new WeakMap<Uint8Array, string>();

let queue = new SerialTaskQueue();
let rendererModule: Promise<typeof import('./webglThumbnailRenderer')> | null = null;
let rendererBroken = false;

/** Test seam: swap the scheduler used to pace renders. */
export function setThumbnailScheduler(schedule: ScheduleFn): void {
  queue = new SerialTaskQueue(schedule);
}

export function clearBrresThumbnailCache(): void {
  cache.clear();
}

export function getBrresThumbnailQueueSize(): number {
  return queue.size;
}

export function cachedBrresThumbnailCount(): number {
  return cache.size;
}

function hashOf(data: Uint8Array): string {
  const existing = byteHashes.get(data);
  if (existing !== undefined) return existing;
  const hash = hashBytes(data);
  byteHashes.set(data, hash);
  return hash;
}

export function buildBrresThumbnailKey(data: Uint8Array, options: BrresThumbnailOptions = {}): string {
  const extras = (options.extraTextureArchives ?? []).map(hashOf);
  return makeThumbnailCacheKey([
    hashOf(data),
    options.size ?? '',
    options.supersample ?? '',
    options.modelNames?.join(',') ?? '',
    options.variantKey ?? '',
    ...extras,
  ]);
}

/** Returns an already-rendered thumbnail without scheduling any work. */
export function peekBrresThumbnail(data: Uint8Array, options: BrresThumbnailOptions = {}): string | null | undefined {
  return cache.get(buildBrresThumbnailKey(data, options));
}

/**
 * Render (or return a cached) thumbnail for a BRRES archive.
 *
 * Resolves to `null` when WebGL2 is unavailable or the archive contains nothing drawable;
 * callers should fall back to their own preview in that case.
 */
export async function getBrresThumbnail(data: Uint8Array, options: BrresThumbnailOptions = {}): Promise<string | null> {
  if (rendererBroken) return null;
  const key = buildBrresThumbnailKey(data, options);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  return inFlight.run(key, async () => {
    const renderer = await loadRenderer();
    if (renderer === null) return null;
    const result = await queue.enqueue<ThumbnailRenderResult | null>(() => {
      try {
        return renderer.renderBrresThumbnail(data, options);
      } catch (error) {
        reportRenderFailure(error);
        return null;
      }
    });
    const dataUrl = result?.dataUrl ?? null;
    cache.set(key, dataUrl);
    return dataUrl;
  });
}

async function loadRenderer(): Promise<typeof import('./webglThumbnailRenderer') | null> {
  if (rendererBroken) return null;
  if (typeof document === 'undefined') {
    rendererBroken = true;
    return null;
  }
  if (rendererModule === null) rendererModule = import('./webglThumbnailRenderer');
  try {
    const module = await rendererModule;
    if (!module.isThumbnailRendererAvailable()) {
      rendererBroken = true;
      return null;
    }
    return module;
  } catch (error) {
    rendererBroken = true;
    reportRenderFailure(error);
    return null;
  }
}

let reportedFailure = false;
function reportRenderFailure(error: unknown): void {
  if (reportedFailure) return;
  reportedFailure = true;
  console.warn('[thumbnails] falling back to the software preview:', error);
}
