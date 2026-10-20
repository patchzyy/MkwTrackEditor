// One scheduler for "write it when the user has stopped": every change restarts a timer, and only
// when the timer runs out (or something calls `flush`) does the expensive part happen. Material
// mode uses it so that dragging a slider or typing in the graph never rewrites a multi-megabyte
// BRRES and re-uploads GPU state on every tick, but the viewport still catches up on its own a
// moment after the author lets go.
import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the author has to stop changing things before the viewport is updated. */
export const IDLE_COMMIT_MS = 2000;

/**
 * The timer half, free of React so it can be tested with fake timers. `touch` (re)starts the
 * countdown; `flush` runs the callback right now if a countdown is running.
 */
export class IdleScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly delayMs: number,
    private readonly run: () => void,
    private readonly onChange: (pending: boolean) => void = () => {},
  ) {}

  get pending(): boolean {
    return this.timer !== null;
  }

  /** Something changed: wait a full `delayMs` from now. */
  touch(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    const wasPending = this.timer !== null;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onChange(false);
      this.run();
    }, this.delayMs);
    if (!wasPending) this.onChange(true);
  }

  /** Runs the callback now when changes are waiting. Returns true when it ran. */
  flush(): boolean {
    if (this.timer === null) return false;
    clearTimeout(this.timer);
    this.timer = null;
    this.onChange(false);
    this.run();
    return true;
  }

  /** Drops the countdown without running anything. */
  cancel(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.onChange(false);
  }
}

export interface IdleCommit {
  /** Marks something as changed and restarts the countdown. */
  touch: () => void;
  /** Commits right now when changes are waiting. Safe to call from event handlers; returns true when it committed. */
  flush: () => boolean;
  /** Forgets the waiting changes without committing. */
  cancel: () => void;
  /** True while changes are waiting for the countdown (drives the "Updating preview" hint). */
  pending: boolean;
}

/**
 * `commit` is read through a ref, so it always sees the latest props and state and the countdown
 * is not restarted just because the callback changed identity.
 */
export function useIdleCommit(commit: () => void, delayMs: number = IDLE_COMMIT_MS): IdleCommit {
  const [pending, setPending] = useState(false);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const schedulerRef = useRef<IdleScheduler | null>(null);
  if (schedulerRef.current === null) {
    schedulerRef.current = new IdleScheduler(delayMs, () => commitRef.current(), setPending);
  }
  const scheduler = schedulerRef.current;

  useEffect(() => () => scheduler.cancel(), [scheduler]);

  const touch = useCallback(() => scheduler.touch(), [scheduler]);
  const flush = useCallback(() => scheduler.flush(), [scheduler]);
  const cancel = useCallback(() => scheduler.cancel(), [scheduler]);
  return { touch, flush, cancel, pending };
}
