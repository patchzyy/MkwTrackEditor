/**
 * Cache + scheduling primitives for the BRRES thumbnail service.
 *
 * Pure logic (no DOM, no WebGL) so it can be unit tested in Node.
 */

/** Simple insertion-ordered LRU map. */
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(public readonly capacity: number) {
    if (!Number.isFinite(capacity) || capacity < 1) throw new Error('LruCache capacity must be >= 1');
  }

  public get size(): number {
    return this.entries.size;
  }

  public has(key: K): boolean {
    return this.entries.has(key);
  }

  public get(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key)!;
    // Re-insert to mark as most recently used.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  public set(key: K, value: V): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  public delete(key: K): boolean {
    return this.entries.delete(key);
  }

  public clear(): void {
    this.entries.clear();
  }

  /** Keys ordered least-recently-used first. */
  public keys(): K[] {
    return [...this.entries.keys()];
  }
}

export type ScheduleFn = (run: () => void) => void;

interface QueuedTask<T> {
  readonly run: () => Promise<T> | T;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * Runs tasks one at a time, handing control back to the host between tasks so a long
 * batch of thumbnail renders never blocks the UI thread for more than one render.
 */
export class SerialTaskQueue {
  private readonly pending: QueuedTask<any>[] = [];
  private draining = false;

  constructor(private readonly schedule: ScheduleFn = defaultSchedule) {}

  public get size(): number {
    return this.pending.length;
  }

  public get busy(): boolean {
    return this.draining;
  }

  public enqueue<T>(run: () => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ run, resolve, reject } as QueuedTask<any>);
      this.kick();
    });
  }

  private kick(): void {
    if (this.draining || this.pending.length === 0) return;
    this.draining = true;
    this.schedule(() => void this.drainOne());
  }

  private async drainOne(): Promise<void> {
    const task = this.pending.shift();
    if (task === undefined) {
      this.draining = false;
      return;
    }
    try {
      task.resolve(await task.run());
    } catch (error) {
      task.reject(error);
    } finally {
      this.draining = false;
      this.kick();
    }
  }
}

/**
 * One render per animation frame while the page is visible, so the UI stays responsive.
 * Hidden documents do not fire `requestAnimationFrame`, so fall back to a timer there.
 */
export function defaultSchedule(run: () => void): void {
  const documentHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  if (!documentHidden && typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => run());
    return;
  }
  if (typeof setTimeout === 'function') {
    setTimeout(run, 0);
    return;
  }
  void Promise.resolve().then(run);
}

/** Runs immediately; used by tests and by the synchronous fallback path. */
export function immediateSchedule(run: () => void): void {
  run();
}

/**
 * Deduplicates concurrent requests for the same key so a tile that is mounted twice only
 * causes one render.
 */
export class InFlightMap<K, V> {
  private readonly inFlight = new Map<K, Promise<V>>();

  public get size(): number {
    return this.inFlight.size;
  }

  public run(key: K, start: () => Promise<V>): Promise<V> {
    const existing = this.inFlight.get(key);
    if (existing !== undefined) return existing;
    const promise = start().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }
}

/**
 * 64-bit FNV-1a over the byte range, returned as a 16 character hex string.
 * Used to key the thumbnail cache on BRRES content rather than on a file path, so the same
 * model shared by several objects is only rendered once.
 */
export function hashBytes(data: Uint8Array): string {
  // Two 32-bit FNV-1a lanes (offset basis / prime differ per lane) give a cheap 64-bit digest
  // without needing BigInt.
  let h1 = 0x811c9dc5;
  let h2 = 0xc9dc5811;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    h1 = Math.imul(h1 ^ byte, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ byte, 0x85ebca6b) >>> 0;
  }
  // Mix in the length so truncated buffers cannot collide with their prefix.
  h1 = Math.imul(h1 ^ data.length, 0x01000193) >>> 0;
  h2 = Math.imul(h2 ^ data.length, 0x85ebca6b) >>> 0;
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function makeThumbnailCacheKey(parts: Array<string | number | undefined | null>): string {
  return parts.filter((part) => part !== undefined && part !== null).join('|');
}
