/**
 * Locates the real Mario Kart Wii tracks on this machine so the format tests can run
 * against them. Test-only and Node-only: nothing in the app imports this module, and every
 * test that uses it skips itself when the folders are not present.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `MKW_TEST_FIXTURES=bundled` hides the local track folders and the retail Common.szs so a run
 * sees exactly what CI sees: only the data that ships in `public/`.
 */
const BUNDLED_ONLY = process.env.MKW_TEST_FIXTURES === 'bundled';

/** Retro Rewind custom tracks. */
export const CUSTOM_TRACK_DIR = 'D:/Games/Wii/Dolphin-2/RR/RetroRewind6/CT/Tracks';
/** Retail Nintendo tracks and arenas. */
export const NINTENDO_TRACK_DIR = 'C:/Users/patchzy/AppData/Roaming/Dolphin Emulator/Load/Riivolution/WheelWizard/RRBeta/Tracks';
/** Vehicle + driver archives, `Driver/*.brres`, `AllKart/*.szs`: the character models. */
export const CHARACTER_DIR = 'C:/Users/patchzy/AppData/Roaming/Dolphin Emulator/Load/RIIVOL2UTION/RRBeta/Character';
/** The shared object archive, used for the object-resource checks. */
export const COMMON_ARCHIVE_PATHS = [
  'G:/Games/Wii/mkwii-europe/Race/Common.szs',
  'public/data/MarioKartWii/Race/Common.szs',
];
/** A driver and a kart model that ship with the editor, so CI sees character materials too. */
export const PREVIEW_DUMMIES_PATH = 'public/data/MarioKartWii/Race/PreviewDummies.u8';

export function hasCustomTracks(): boolean {
  return !BUNDLED_ONLY && existsSync(CUSTOM_TRACK_DIR);
}

export function hasNintendoTracks(): boolean {
  return !BUNDLED_ONLY && existsSync(NINTENDO_TRACK_DIR);
}

/** Absolute paths of up to `limit` `.szs` files in a directory, in a stable order. */
export function listTracks(dir: string, limit = Infinity): string[] {
  if (BUNDLED_ONLY || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.szs'))
    .sort()
    .slice(0, limit)
    .map((name) => join(dir, name));
}

export function readTrackBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

/**
 * A spread of character models: bare driver models, vehicle archives, and the standalone kart
 * archives, taken evenly through each folder rather than off the top so a sample is not all
 * Baby Daisy. Empty when the folder is not on this machine or the run is pinned to the bundled
 * fixtures.
 */
export function listCharacterFiles(limit = 6): string[] {
  if (BUNDLED_ONLY || !existsSync(CHARACTER_DIR)) return [];
  const spread = (list: string[], count: number): string[] => {
    if (list.length <= count) return list;
    const step = list.length / count;
    return Array.from({ length: count }, (_, index) => list[Math.floor(index * step)]);
  };
  const inDir = (dir: string, extension: string): string[] => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((name) => name.toLowerCase().endsWith(extension)).sort().map((name) => join(dir, name));
  };
  const third = Math.max(1, Math.ceil(limit / 3));
  return [
    ...spread(inDir(join(CHARACTER_DIR, 'Driver'), '.brres'), third),
    ...spread(inDir(CHARACTER_DIR, '.szs'), third),
    ...spread(inDir(join(CHARACTER_DIR, 'AllKart'), '.szs'), limit - 2 * third),
  ];
}

export function findPreviewDummies(): string | null {
  return existsSync(PREVIEW_DUMMIES_PATH) ? PREVIEW_DUMMIES_PATH : null;
}

export function findCommonArchive(): string | null {
  const candidates = BUNDLED_ONLY ? COMMON_ARCHIVE_PATHS.filter((path) => path.startsWith('public/')) : COMMON_ARCHIVE_PATHS;
  return candidates.find((path) => existsSync(path)) ?? null;
}
