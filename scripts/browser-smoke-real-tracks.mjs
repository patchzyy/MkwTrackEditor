import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const defaultTrackDirs = [
  '/mnt/c/Users/patchzy/AppData/Roaming/Dolphin Emulator/Load/Riivolution/WheelWizard/RRBeta/Tracks',
  '/mnt/c/Users/patchzy/AppData/Roaming/Dolphin Emulator/Load/Riivolution/WheelWizard/RRBeta/CT/Tracks',
];

const trackDirs = (process.env.TRACK_DIRS?.split('|').map((value) => value.trim()).filter(Boolean) ?? defaultTrackDirs)
  .filter((dir) => existsSync(dir));
const limitPerDir = Number(process.env.TRACK_BATCH_LIMIT ?? 1);

if (trackDirs.length === 0) {
  throw new Error('No real-track directories were found for browser smoke.');
}

const trackPaths = trackDirs.flatMap((dir) => collectSzsFiles(dir).slice(0, Math.max(1, limitPerDir)));

if (trackPaths.length === 0) {
  throw new Error(`No .szs tracks were found in: ${trackDirs.join(', ')}`);
}

for (const trackPath of trackPaths) {
  console.log(`Running browser smoke for ${trackPath}`);
  const result = spawnSync('node', ['scripts/browser-smoke.mjs'], {
    cwd: '/mnt/g/ai/MkwTrackEditor',
    stdio: 'inherit',
    env: {
      ...process.env,
      TRACK_PATH: trackPath,
    },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`Browser smoke passed for ${trackPaths.length} real track(s) across ${trackDirs.length} track directory/directories.`);

function collectSzsFiles(rootDir) {
  const out = [];
  walk(rootDir, out);
  return out.sort((left, right) => left.localeCompare(right));
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
