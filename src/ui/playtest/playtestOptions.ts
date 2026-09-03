/**
 * The curated character/vehicle lists the start popover offers, and the "remember my last
 * choice" storage behind it.
 *
 * The full rosters are 24 characters and 36 vehicles; showing all of them in a small popover
 * would be clutter for a feature whose point is "drive the track I just edited". These are the
 * ones people actually pick, one per weight class plus the usual meta choices.
 */

import {
  DEFAULT_PLAYTEST_COURSE_OPTIONS,
  PLAYTEST_CHARACTERS,
  PLAYTEST_VEHICLES,
  isPlaytestBike,
  type PlaytestCharacter,
  type PlaytestCourseOptions,
  type PlaytestVehicle,
} from '../../lib/playtest/types';

export interface PlaytestChoice<T extends number> {
  value: T;
  label: string;
}

/** Light / medium / heavy, in the order the game lists them. */
export const PLAYTEST_CHARACTER_CHOICES: ReadonlyArray<PlaytestChoice<PlaytestCharacter>> = [
  { value: PLAYTEST_CHARACTERS.Toad, label: 'Toad (light)' },
  { value: PLAYTEST_CHARACTERS.Baby_Luigi, label: 'Baby Luigi (light)' },
  { value: PLAYTEST_CHARACTERS.Mario, label: 'Mario (medium)' },
  { value: PLAYTEST_CHARACTERS.Peach, label: 'Peach (medium)' },
  { value: PLAYTEST_CHARACTERS.Luigi, label: 'Luigi (medium)' },
  { value: PLAYTEST_CHARACTERS.Funky_Kong, label: 'Funky Kong (heavy)' },
  { value: PLAYTEST_CHARACTERS.Bowser, label: 'Bowser (heavy)' },
  { value: PLAYTEST_CHARACTERS.Rosalina, label: 'Rosalina (heavy)' },
];

export const PLAYTEST_KART_CHOICES: ReadonlyArray<PlaytestChoice<PlaytestVehicle>> = [
  { value: PLAYTEST_VEHICLES.Standard_Kart_M, label: 'Standard Kart' },
  { value: PLAYTEST_VEHICLES.Mini_Beast, label: 'Mini Beast' },
  { value: PLAYTEST_VEHICLES.Sprinter, label: 'Sprinter' },
  { value: PLAYTEST_VEHICLES.Wild_Wing, label: 'Wild Wing' },
  { value: PLAYTEST_VEHICLES.Flame_Flyer, label: 'Flame Flyer' },
];

export const PLAYTEST_BIKE_CHOICES: ReadonlyArray<PlaytestChoice<PlaytestVehicle>> = [
  { value: PLAYTEST_VEHICLES.Standard_Bike_M, label: 'Standard Bike' },
  { value: PLAYTEST_VEHICLES.Mach_Bike, label: 'Mach Bike' },
  { value: PLAYTEST_VEHICLES.Flame_Runner, label: 'Flame Runner' },
  { value: PLAYTEST_VEHICLES.Bullet_Bike, label: 'Bullet Bike' },
  { value: PLAYTEST_VEHICLES.Sneakster, label: 'Sneakster' },
];

const CHARACTER_VALUES = new Set<number>(PLAYTEST_CHARACTER_CHOICES.map((choice) => choice.value));
const VEHICLE_VALUES = new Set<number>([...PLAYTEST_KART_CHOICES, ...PLAYTEST_BIKE_CHOICES].map((choice) => choice.value));

export function playtestVehicleLabel(vehicle: number): string {
  const match = [...PLAYTEST_KART_CHOICES, ...PLAYTEST_BIKE_CHOICES].find((choice) => choice.value === vehicle);
  return match?.label ?? (isPlaytestBike(vehicle) ? 'Bike' : 'Kart');
}

export function playtestCharacterLabel(character: number): string {
  return PLAYTEST_CHARACTER_CHOICES.find((choice) => choice.value === character)?.label ?? 'Driver';
}

const STORAGE_KEY = 'mkw.editor.playtest.v1';

/** Reads the remembered choice, falling back to the contract's defaults for anything odd. */
export function readStoredPlaytestOptions(): PlaytestCourseOptions {
  const fallback: PlaytestCourseOptions = { ...DEFAULT_PLAYTEST_COURSE_OPTIONS };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PlaytestCourseOptions>;
    return {
      character: CHARACTER_VALUES.has(Number(parsed.character)) ? (Number(parsed.character) as PlaytestCharacter) : fallback.character,
      vehicle: VEHICLE_VALUES.has(Number(parsed.vehicle)) ? (Number(parsed.vehicle) as PlaytestVehicle) : fallback.vehicle,
      driftIsAuto: typeof parsed.driftIsAuto === 'boolean' ? parsed.driftIsAuto : fallback.driftIsAuto,
    };
  } catch {
    return fallback;
  }
}

export function writeStoredPlaytestOptions(options: PlaytestCourseOptions): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Private-mode / quota failures must never break starting a playtest.
  }
}
