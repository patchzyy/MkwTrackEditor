/**
 * What the playtest HUD shows, derived from a `PlaytestRaceState` / `PlaytestKartState`.
 *
 * Pure and string-only, so the overlay component can compare two of these and re-render only
 * when something the user can actually see has changed.
 */

import type { PlaytestKartState, PlaytestRaceState, PlaytestStage } from '../../lib/playtest/types';

/**
 * The frame the flag drops: Mario Kart Wii's 172-frame intro plus its 240-frame countdown.
 * Only the centred countdown text needs it, and both runtimes use the retail timing.
 */
export const PLAYTEST_RACE_START_FRAME = 412;

export interface PlaytestHudView {
  stage: PlaytestStage;
  /** `"1/3"`. */
  lap: string;
  /** `"0:00.000"`. */
  time: string;
  /** `"128 km/h"`. */
  speed: string;
  /** Big centred text during the intro and countdown; empty once the race is under way. */
  centerText: string;
  /** Set once the race is over. */
  finalTime: string | null;
}

/** `mm:ss.mmm`, the format the game's own timer uses. */
export function formatPlaytestTime(timeMs: number): string {
  const total = Number.isFinite(timeMs) && timeMs > 0 ? Math.floor(timeMs) : 0;
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * Speed in km/h. Mario Kart Wii's internal speed is units per frame at 60 fps and one unit is
 * one centimetre, so `units/frame * 60 * 3600 / 100000` = `units/frame * 2.16`.
 */
export function formatPlaytestSpeed(speedUnitsPerFrame: number): string {
  const value = Number.isFinite(speedUnitsPerFrame) ? Math.abs(speedUnitsPerFrame) : 0;
  return `${Math.round(value * 2.16)} km/h`;
}

/**
 * The big centred word. The countdown is the last three seconds before the flag; everything
 * earlier in the intro just says the track is getting ready.
 */
export function playtestCenterText(
  race: Pick<PlaytestRaceState, 'stage' | 'frame' | 'timeMs'>,
  raceStartFrame: number = PLAYTEST_RACE_START_FRAME,
): string {
  if (race.stage === 'finished') return 'Finished';
  if (race.stage === 'race') return race.timeMs < 1000 ? 'Go!' : '';
  const remaining = raceStartFrame - race.frame;
  if (race.stage === 'countdown' && remaining <= 180) return String(Math.max(1, Math.ceil(remaining / 60)));
  return 'Get ready';
}

export function buildPlaytestHudView(
  race: PlaytestRaceState,
  kart: Pick<PlaytestKartState, 'speed'>,
  raceStartFrame: number = PLAYTEST_RACE_START_FRAME,
): PlaytestHudView {
  return {
    stage: race.stage,
    lap: `${Math.max(1, race.lap)}/${Math.max(1, race.maxLap)}`,
    time: formatPlaytestTime(race.timeMs),
    speed: formatPlaytestSpeed(kart.speed),
    centerText: playtestCenterText(race, raceStartFrame),
    finalTime: race.stage === 'finished' ? formatPlaytestTime(race.timeMs) : null,
  };
}

export function playtestHudViewsEqual(a: PlaytestHudView | null, b: PlaytestHudView | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.stage === b.stage &&
    a.lap === b.lap &&
    a.time === b.time &&
    a.speed === b.speed &&
    a.centerText === b.centerText &&
    a.finalTime === b.finalTime
  );
}
