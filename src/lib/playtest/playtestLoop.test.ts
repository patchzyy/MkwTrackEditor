import { describe, expect, it } from 'vitest';
import { PLAYTEST_MAX_CATCHUP_STEPS, PLAYTEST_STEP_MS, planFixedSteps } from './playtestLoop';

describe('planFixedSteps', () => {
  it('runs one step per 60 Hz frame at 60 fps', () => {
    const plan = planFixedSteps(0, PLAYTEST_STEP_MS);
    expect(plan.steps).toBe(1);
    expect(plan.carryMs).toBeCloseTo(0, 9);
    expect(plan.droppedMs).toBe(0);
  });

  it('carries the remainder so a 120 Hz display still averages 60 steps a second', () => {
    let carry = 0;
    let steps = 0;
    for (let i = 0; i < 120; i++) {
      const plan = planFixedSteps(carry, 1000 / 120);
      carry = plan.carryMs;
      steps += plan.steps;
    }
    expect(steps).toBe(60);
  });

  it('catches up on a slow frame', () => {
    const plan = planFixedSteps(0, PLAYTEST_STEP_MS * 3);
    expect(plan.steps).toBe(3);
    expect(plan.droppedMs).toBe(0);
  });

  it('caps catch-up and drops the rest rather than simulating a stall', () => {
    const plan = planFixedSteps(0, 5000);
    expect(plan.steps).toBe(PLAYTEST_MAX_CATCHUP_STEPS);
    expect(plan.droppedMs).toBeGreaterThan(4000);
    // What is carried forward is only the sub-frame remainder, never the dropped time.
    expect(plan.carryMs).toBeLessThan(PLAYTEST_STEP_MS);
  });

  it('treats a missing, negative or NaN elapsed time as no time at all', () => {
    expect(planFixedSteps(0, -100).steps).toBe(0);
    expect(planFixedSteps(0, Number.NaN).steps).toBe(0);
    expect(planFixedSteps(Number.NaN, PLAYTEST_STEP_MS).steps).toBe(1);
  });

  it('accumulates across frames that are each shorter than one step', () => {
    let carry = 0;
    const first = planFixedSteps(carry, 8);
    expect(first.steps).toBe(0);
    carry = first.carryMs;
    const second = planFixedSteps(carry, 9);
    expect(second.steps).toBe(1);
  });
});
