/**
 * Locates the real Mario Kart Wii tracks on this machine so the format tests can run
 * against them. Test-only and Node-only: nothing in the app imports this module, and every
 * test that uses it skips itself when the folders are not present.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Retro Rewind custom tracks. */
export const CUSTOM_TRACK_DIR = 'D:/Games/Wii/Dolphin-2/RR/RetroRewind6/CT/Tracks';
/** Retail Nintendo tracks and arenas. */
export const NINTENDO_TRACK_DIR = 'C:/Users/patchzy/AppData/Roaming/Dolphin Emulator/Load/Riivolution/WheelWizard/RRBeta/Tracks';
/** The shared object archive, used for the object-resource checks. */
export const COMMON_ARCHIVE_PATHS = [
  'G:/Games/Wii/mkwii-europe/Race/Common.szs',
  'public/data/MarioKartWii/Race/Common.szs',
];

export function hasCustomTracks(): boolean {
  return existsSync(CUSTOM_TRACK_DIR);
}

export function hasNintendoTracks(): boolean {
  return existsSync(NINTENDO_TRACK_DIR);
}

/** Absolute paths of up to `limit` `.szs` files in a directory, in a stable order. */
export function listTracks(dir: string, limit = Infinity): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.szs'))
    .sort()
    .slice(0, limit)
    .map((name) => join(dir, name));
}

export function readTrackBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

export function findCommonArchive(): string | null {
  return COMMON_ARCHIVE_PATHS.find((path) => existsSync(path)) ?? null;
}
