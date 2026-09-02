import { describe, expect, it, vi } from 'vitest';
import {
  hashBytes,
  immediateSchedule,
  InFlightMap,
  LruCache,
  makeThumbnailCacheKey,
  SerialTaskQueue,
} from './cache';

describe('LruCache', () => {
  it('evicts the least recently used entry when full', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(false);
    expect(cache.keys()).toEqual(['b', 'c']);
    expect(cache.size).toBe(2);
  });

  it('refreshes recency on get', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('distinguishes a cached null from a miss', () => {
    const cache = new LruCache<string, string | null>(4);
    cache.set('a', null);
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeUndefined();
  });

  it('rejects a nonsense capacity', () => {
    expect(() => new LruCache<string, number>(0)).toThrow();
  });
});

describe('SerialTaskQueue', () => {
  it('runs tasks one at a time in order', async () => {
    const order: string[] = [];
    const queue = new SerialTaskQueue(immediateSchedule);
    const a = queue.enqueue(async () => {
      order.push('a:start');
      await Promise.resolve();
      order.push('a:end');
      return 1;
    });
    const b = queue.enqueue(() => {
      order.push('b');
      return 2;
    });
    expect(await a).toBe(1);
    expect(await b).toBe(2);
    expect(order).toEqual(['a:start', 'a:end', 'b']);
  });

  it('keeps draining after a task throws', async () => {
    const queue = new SerialTaskQueue(immediateSchedule);
    const failure = queue.enqueue(() => {
      throw new Error('boom');
    });
    const success = queue.enqueue(() => 'ok');
    await expect(failure).rejects.toThrow('boom');
    expect(await success).toBe('ok');
    expect(queue.size).toBe(0);
  });

  it('defers work to the scheduler instead of running inline', async () => {
    const pending: Array<() => void> = [];
    const queue = new SerialTaskQueue((run) => pending.push(run));
    const task = vi.fn(() => 7);
    const promise = queue.enqueue(task);
    expect(task).not.toHaveBeenCalled();
    expect(queue.size).toBe(1);
    pending.shift()!();
    expect(await promise).toBe(7);
  });
});

describe('InFlightMap', () => {
  it('shares one promise per key and clears it when settled', async () => {
    const map = new InFlightMap<string, number>();
    let resolve!: (value: number) => void;
    const start = vi.fn(() => new Promise<number>((r) => (resolve = r)));
    const first = map.run('k', start);
    const second = map.run('k', start);
    expect(start).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(map.size).toBe(1);
    resolve(5);
    expect(await first).toBe(5);
    await Promise.resolve();
    expect(map.size).toBe(0);
  });
});

describe('hashBytes', () => {
  it('is stable for identical content', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    expect(hashBytes(a)).toBe(hashBytes(b));
    expect(hashBytes(a)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes for different content and for prefixes', () => {
    const base = new Uint8Array([1, 2, 3, 4, 5]);
    expect(hashBytes(base)).not.toBe(hashBytes(new Uint8Array([1, 2, 3, 4, 6])));
    expect(hashBytes(base)).not.toBe(hashBytes(base.subarray(0, 4)));
  });

  it('hashes an empty buffer without throwing', () => {
    expect(hashBytes(new Uint8Array(0))).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('makeThumbnailCacheKey', () => {
  it('drops empty parts and joins the rest', () => {
    expect(makeThumbnailCacheKey(['abc', 128, undefined, null, 2])).toBe('abc|128|2');
  });
});
