// Runs scripts/browser-smoke.mjs over a batch of real .szs tracks.
//
// Env vars:
//   TRACK_DIRS         '|'-separated list of directories to scan (overrides the defaults)
//   TRACK_BATCH_LIMIT  how many tracks to take from each directory (default 1)
// Everything else (APP_URL, BROWSER_PATH, ...) is forwarded to browser-smoke.mjs.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const defaultTrackDirs = [
  // Retro Rewind custom tracks (Z*.szs) and the Nintendo track set.
  'D:\\Games\\Wii\\Dolphin-2\\RR\\RetroRewind6\\CT\\Tracks',
  'C:\\Users\\patchzy\\AppData\\Roaming\\Dolphin Emulator\\Load\\Riivolution\\WheelWizard\\RRBeta\\Tracks',
  join(repoRoot, 'public', 'dev-tracks'),
  // Legacy WSL layout, kept only as a fallback.
  '/mnt/c/Users/patchzy/AppData/Roaming/Dolphin Emulator/Load/Riivolution/WheelWizard/RRBeta/Tracks',
];

const trackDirs = (process.env.TRACK_DIRS?.split('|').map((value) => value.trim()).filter(Boolean) ?? defaultTrackDirs).filter(
  (dir) => existsSync(dir),
);
const limitPerDir = Math.max(1, Number(process.env.TRACK_BATCH_LIMIT ?? 1));

if (trackDirs.length === 0) {
  throw new Error(`No real-track directories were found for browser smoke. Tried:\n  ${defaultTrackDirs.join('\n  ')}`);
}

const trackPaths = trackDirs.flatMap((dir) => collectSzsFiles(dir).slice(0, limitPerDir));

if (trackPaths.length === 0) {
  throw new Error(`No .szs tracks were found in: ${trackDirs.join(', ')}`);
}

for (const trackPath of trackPaths) {
  console.log(`Running browser smoke for ${trackPath}`);
  const result = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'browser-smoke.mjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, TRACK_PATH: trackPath },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Browser smoke passed for ${trackPaths.length} real track(s) across ${trackDirs.length} track directory/directories.`);

function collectSzsFiles(rootDir) {
  const out = [];
  walk(rootDir, out);
  return out.sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
}

function walk(currentDir, out) {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.szs')) continue;
    if (statSync(fullPath).size === 0) continue;
    out.push(fullPath);
  }
}
