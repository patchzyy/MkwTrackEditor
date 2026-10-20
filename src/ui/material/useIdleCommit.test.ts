import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_COMMIT_MS, IdleScheduler } from './useIdleCommit';

describe('IdleScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits the full delay after the last change', () => {
    const run = vi.fn();
    const scheduler = new IdleScheduler(IDLE_COMMIT_MS, run);
    scheduler.touch();
    vi.advanceTimersByTime(1500);
    scheduler.touch();
    vi.advanceTimersByTime(1500);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduler.pending).toBe(false);
  });

  it('runs once for a burst of changes', () => {
    const run = vi.fn();
    const scheduler = new IdleScheduler(2000, run);
    for (let i = 0; i < 50; i++) {
      scheduler.touch();
      vi.advanceTimersByTime(40);
    }
    vi.advanceTimersByTime(2000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('flushes immediately and only when something is waiting', () => {
    const run = vi.fn();
    const scheduler = new IdleScheduler(2000, run);
    expect(scheduler.flush()).toBe(false);
    scheduler.touch();
    expect(scheduler.flush()).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduler.flush()).toBe(false);
  });

  it('reports when changes start and stop waiting', () => {
    const states: boolean[] = [];
    const scheduler = new IdleScheduler(2000, () => {}, (pending) => states.push(pending));
    scheduler.touch();
    scheduler.touch();
    vi.advanceTimersByTime(2000);
    scheduler.touch();
    scheduler.cancel();
    expect(states).toEqual([true, false, true, false]);
  });

  it('cancel drops the waiting commit', () => {
    const run = vi.fn();
    const scheduler = new IdleScheduler(2000, run);
    scheduler.touch();
    scheduler.cancel();
    vi.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();
  });
});
