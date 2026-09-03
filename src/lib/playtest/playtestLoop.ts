/**
 * The fixed-step clock behind a playtest session.
 *
 * The simulation runs at exactly 60 Hz, but the browser hands us animation frames at whatever
 * rate the display runs (and stops handing them over entirely while the tab is hidden). This
 * turns "real milliseconds since the last animation frame" into "how many 60 Hz steps to run
 * now", capping catch-up so a long stall cannot lock the page up simulating minutes of race.
 */

/** One Mario Kart Wii frame, in milliseconds. */
export const PLAYTEST_STEP_MS = 1000 / 60;

/** Never simulate more than this many game frames inside one animation frame. */
export const PLAYTEST_MAX_CATCHUP_STEPS = 4;

export interface FixedStepPlan {
  /** How many `runtime.step()` calls to make now. */
  steps: number;
  /** Time left over, to carry into the next animation frame. */
  carryMs: number;
  /** Time thrown away because the catch-up cap was hit. Reported so callers can log a stall. */
  droppedMs: number;
}

/**
 * Advances a fixed-step accumulator by `elapsedMs` of real time.
 *
 * Pure: `accumulatorMs` is not mutated; feed `carryMs` back in on the next call.
 * A negative, `NaN` or missing `elapsedMs` counts as zero, so a clock that jumps backwards
 * (or the very first frame, where there is no previous timestamp) cannot rewind the race.
 */
export function planFixedSteps(
  accumulatorMs: number,
  elapsedMs: number,
  stepMs: number = PLAYTEST_STEP_MS,
  maxSteps: number = PLAYTEST_MAX_CATCHUP_STEPS,
): FixedStepPlan {
  const carriedIn = Number.isFinite(accumulatorMs) && accumulatorMs > 0 ? accumulatorMs : 0;
  const advanced = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const total = carriedIn + advanced;
  if (!(stepMs > 0)) return { steps: 0, carryMs: total, droppedMs: 0 };

  const wanted = Math.floor(total / stepMs);
  const steps = Math.min(wanted, Math.max(0, maxSteps));
  const droppedMs = (wanted - steps) * stepMs;
  const carryMs = total - wanted * stepMs;
  return { steps, carryMs, droppedMs };
}
