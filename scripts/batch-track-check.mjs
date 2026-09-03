#!/usr/bin/env node
/**
 * Whole-pipeline batch check over every real Mario Kart Wii track installed on this machine.
 *
 * For each `.szs`: load it, parse the U8/Yaz0/KMP/KCL/BRRES inside, export it untouched and
 * demand a byte-identical archive, then apply one representative edit from each of the four
 * editor modes (a KMP graph edit, a camera edit, a mesh transform, a texture replacement),
 * export again, and re-open the result. The per-track logic lives in
 * `src/lib/batch/trackPipelineCheck.ts` so `vitest` can run a fast subset of the same code.
 *
 * Headless: no browser, no GPU. Modules are loaded through Vite's SSR pipeline so the
 * TypeScript sources and the `noclip-rust-support` alias resolve exactly as they do in the app.
 *
 * Usage:
 *   node scripts/batch-track-check.mjs                  # every track, default settings
 *   node scripts/batch-track-check.mjs --limit 10       # first 10 of each folder
 *   node scripts/batch-track-check.mjs --noclip         # also re-parse every exported BRRES
 *   node scripts/batch-track-check.mjs --no-compression # skip the (slow) Yaz0 round trip
 *   node scripts/batch-track-check.mjs --json out.json  # write the full result table
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TRACK_DIRS = [
  { label: 'custom', dir: 'D:/Games/Wii/Dolphin-2/RR/RetroRewind6/CT/Tracks' },
  { label: 'nintendo', dir: 'C:/Users/patchzy/AppData/Roaming/Dolphin Emulator/Load/Riivolution/WheelWizard/RRBeta/Tracks' },
];

function parseArgs(argv) {
  const options = { limit: Infinity, noclip: false, compression: true, json: null, filter: null, searchDepth: 4 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--limit') options.limit = Number(argv[++i]);
    else if (arg === '--noclip') options.noclip = true;
    else if (arg === '--no-compression') options.compression = false;
    else if (arg === '--json') options.json = argv[++i];
    else if (arg === '--filter') options.filter = argv[++i].toLowerCase();
    else if (arg === '--search-depth') options.searchDepth = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function listTracks(dir, limit) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.szs'))
    .sort()
    .slice(0, limit)
    .map((name) => join(dir, name));
}

function pad(text, width) {
  return String(text).length >= width ? String(text) : String(text) + ' '.repeat(width - String(text).length);
}

function padStart(text, width) {
  return String(text).length >= width ? String(text) : ' '.repeat(width - String(text).length) + String(text);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const tracks = [];
  for (const { label, dir } of TRACK_DIRS) {
    const found = listTracks(dir, options.limit);
    if (found.length === 0) console.warn(`! no tracks found in ${dir}`);
    for (const path of found) tracks.push({ group: label, path });
  }
  const selected = options.filter ? tracks.filter((track) => track.path.toLowerCase().includes(options.filter)) : tracks;

  if (selected.length === 0) {
    console.error('No tracks to check. Are the track folders mounted?');
    process.exit(2);
  }

  console.log(`Checking ${selected.length} tracks (${TRACK_DIRS.map((entry) => entry.label).join(' + ')})`);
  console.log(
    `Options: yaz0=${options.compression ? `on (depth ${options.searchDepth})` : 'off'} noclip-reparse=${options.noclip ? 'on' : 'off'}`,
  );
  console.log('');

  const server = await createServer({
    root: ROOT,
    configFile: join(ROOT, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    logLevel: 'error',
  });

  let summary;
  const results = [];
  const startedAt = Date.now();
  try {
    const harness = await server.ssrLoadModule('/src/lib/batch/trackPipelineCheck.ts');

    const nameWidth = Math.min(34, Math.max(...selected.map((track) => track.path.split(/[\\/]/).pop().length)));
    console.log(`${pad('track', nameWidth)}  ${pad('result', 6)}  ${padStart('ms', 6)}  detail`);
    console.log('-'.repeat(nameWidth + 60));

    for (const { path } of selected) {
      const fileName = path.split(/[\\/]/).pop();
      const raw = new Uint8Array(readFileSync(path));
      const result = await harness.checkTrackPipeline(raw, fileName, {
        compressionSearchDepth: options.searchDepth,
        skipCompression: !options.compression,
        parseWithNoclip: options.noclip,
      });
      results.push(result);

      const skipped = result.stages.filter((stage) => stage.status === 'skip').map((stage) => stage.name);
      const detail = result.ok
        ? skipped.length > 0
          ? `skipped: ${skipped.join(', ')}`
          : ''
        : result.failures.join(' | ');
      console.log(
        `${pad(fileName.slice(0, nameWidth), nameWidth)}  ${pad(result.ok ? 'PASS' : 'FAIL', 6)}  ${padStart(result.durationMs, 6)}  ${detail}`,
      );
    }

    summary = harness.summarizeBatch(results, Date.now() - startedAt);
  } finally {
    await server.close();
  }

  console.log('');
  console.log('='.repeat(72));
  console.log(`${summary.passed} / ${summary.total} tracks passed  (${summary.failed} failed)  in ${(summary.durationMs / 1000).toFixed(1)}s`);

  console.log('');
  console.log('Per-stage outcome:');
  const stageNames = [...new Set(Object.keys(summary.stageCounts).map((key) => key.split(':')[0]))];
  for (const name of stageNames) {
    const passed = summary.stageCounts[`${name}:pass`] ?? 0;
    const failed = summary.stageCounts[`${name}:fail`] ?? 0;
    const skipped = summary.stageCounts[`${name}:skip`] ?? 0;
    console.log(`  ${pad(name, 26)} pass ${padStart(passed, 4)}   fail ${padStart(failed, 4)}   skip ${padStart(skipped, 4)}`);
  }

  if (summary.failed > 0) {
    console.log('');
    console.log('Failing tracks:');
    for (const entry of summary.failing) {
      console.log(`  ${entry.fileName}`);
      for (const failure of entry.failures) console.log(`      ${failure}`);
    }
  }

  if (options.json) {
    writeFileSync(options.json, JSON.stringify({ summary, results }, null, 2));
    console.log('');
    console.log(`Full table written to ${options.json}`);
  }

  process.exit(summary.failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
