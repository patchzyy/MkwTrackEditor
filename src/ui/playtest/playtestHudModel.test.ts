import { describe, expect, it } from 'vitest';
import type { PlaytestRaceState, PlaytestStage } from '../../lib/playtest/types';
import {
  PLAYTEST_RACE_START_FRAME,
  buildPlaytestHudView,
  formatPlaytestSpeed,
  formatPlaytestTime,
  playtestCenterText,
  playtestHudViewsEqual,
} from './playtestHudModel';

function race(overrides: Partial<PlaytestRaceState> & { stage: PlaytestStage }): PlaytestRaceState {
  return {
    frame: 0,
    timeMs: 0,
    lap: 1,
    maxLap: 3,
    lapCompletion: 0,
    checkpointId: 0,
    respawnId: 0,
    lapSplitsMs: [],
    ...overrides,
  };
}

describe('formatPlaytestTime', () => {
  it('formats as the game does', () => {
    expect(formatPlaytestTime(0)).toBe('0:00.000');
    expect(formatPlaytestTime(1234)).toBe('0:01.234');
    expect(formatPlaytestTime(61050)).toBe('1:01.050');
    expect(formatPlaytestTime(600000)).toBe('10:00.000');
  });

  it('never shows a negative or NaN time', () => {
    expect(formatPlaytestTime(-5)).toBe('0:00.000');
    expect(formatPlaytestTime(Number.NaN)).toBe('0:00.000');
  });
});

describe('formatPlaytestSpeed', () => {
  it('converts units per frame to km/h', () => {
    expect(formatPlaytestSpeed(0)).toBe('0 km/h');
    // Shown the way MKW-SP / CTGP speedometers do: the engine's speed value as-is.
    expect(formatPlaytestSpeed(84.4)).toBe('84 km/h');
  });

  it('shows a reversing kart as a positive speed', () => {
    expect(formatPlaytestSpeed(-5)).toBe('5 km/h');
  });
});

describe('playtestCenterText', () => {
  it('says the track is getting ready during the intro', () => {
    expect(playtestCenterText(race({ stage: 'intro', frame: 10 }))).toBe('Get ready');
  });

  it('counts 3, 2, 1 through the last three seconds', () => {
    expect(playtestCenterText(race({ stage: 'countdown', frame: PLAYTEST_RACE_START_FRAME - 180 }))).toBe('3');
    expect(playtestCenterText(race({ stage: 'countdown', frame: PLAYTEST_RACE_START_FRAME - 120 }))).toBe('2');
    expect(playtestCenterText(race({ stage: 'countdown', frame: PLAYTEST_RACE_START_FRAME - 60 }))).toBe('1');
    expect(playtestCenterText(race({ stage: 'countdown', frame: PLAYTEST_RACE_START_FRAME - 1 }))).toBe('1');
    // The long first part of the countdown stage is still just "get ready".
    expect(playtestCenterText(race({ stage: 'countdown', frame: PLAYTEST_RACE_START_FRAME - 220 }))).toBe('Get ready');
  });

  it('flashes Go! for the first second and then clears', () => {
    expect(playtestCenterText(race({ stage: 'race', timeMs: 0 }))).toBe('Go!');
    expect(playtestCenterText(race({ stage: 'race', timeMs: 2000 }))).toBe('');
  });

  it('says Finished at the end', () => {
    expect(playtestCenterText(race({ stage: 'finished', timeMs: 90000 }))).toBe('Finished');
  });
});

describe('buildPlaytestHudView', () => {
  it('builds the lap, time and speed the overlay renders', () => {
    const view = buildPlaytestHudView(race({ stage: 'race', lap: 2, maxLap: 3, timeMs: 65432 }), { speed: 10 });
    expect(view.lap).toBe('2/3');
    expect(view.time).toBe('1:05.432');
    expect(view.speed).toBe('10 km/h');
    expect(view.finalTime).toBeNull();
  });

  it('carries the final time once the race is over', () => {
    const view = buildPlaytestHudView(race({ stage: 'finished', lap: 3, maxLap: 3, timeMs: 123456 }), { speed: 0 });
    expect(view.finalTime).toBe('2:03.456');
    expect(view.centerText).toBe('Finished');
  });

  it('shows the mushrooms left, or infinity when the slot is kept full', () => {
    const racing = race({ stage: 'race' });
    expect(buildPlaytestHudView(racing, { speed: 0, mushrooms: 2 }).mushrooms).toBe(2);
    expect(buildPlaytestHudView(racing, { speed: 0 }).mushrooms).toBe(0);
    expect(buildPlaytestHudView(racing, { speed: 0, mushrooms: 3 }, undefined, true).mushrooms).toBe('∞');
  });

  it('never shows lap 0 of 0', () => {
    const view = buildPlaytestHudView(race({ stage: 'intro', lap: 0, maxLap: 0 }), { speed: 0 });
    expect(view.lap).toBe('1/1');
  });
});

describe('playtestHudViewsEqual', () => {
  const base = buildPlaytestHudView(race({ stage: 'race', timeMs: 1000 }), { speed: 4 });

  it('is true for the same numbers and false as soon as one changes', () => {
    expect(playtestHudViewsEqual(base, buildPlaytestHudView(race({ stage: 'race', timeMs: 1000 }), { speed: 4 }))).toBe(true);
    expect(playtestHudViewsEqual(base, buildPlaytestHudView(race({ stage: 'race', timeMs: 1001 }), { speed: 4 }))).toBe(false);
    expect(playtestHudViewsEqual(base, null)).toBe(false);
    expect(playtestHudViewsEqual(null, null)).toBe(true);
  });
});
