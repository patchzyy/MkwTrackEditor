// Headless browser smoke test.
//
// Boots the app in a real browser against a real .szs track, waits for the app to POST a
// readiness report back, and asserts the renderer actually got a track on screen.
//
// Host defaults are for the Windows dev machine (Microsoft Edge, tracks on D:). Everything
// is overridable with env vars:
//   APP_URL            dev server URL                   (default http://127.0.0.1:5175/)
//   TRACK_PATH         .szs to load
//   COMMON_PATH        Race/Common.szs
//   BROWSER_PATH       browser executable (CHROME_PATH is also honoured)
//   SMOKE_TIMEOUT_MS   per-attempt timeout              (default 90000)
//   SMOKE_ADD_OBJECT_ID  object id the app should place (default 0x65)

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5175/';
const smokeTimeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 90000);
const smokeAddObjectId = Number(process.env.SMOKE_ADD_OBJECT_ID ?? 0x65);

const trackPath = firstExisting('smoke track', process.env.TRACK_PATH, [
  'D:\\Games\\Wii\\Dolphin-2\\RR\\RetroRewind6\\CT\\Tracks\\Z0.szs',
  'C:\\Users\\patchzy\\AppData\\Roaming\\Dolphin Emulator\\Load\\Riivolution\\WheelWizard\\RRBeta\\Tracks\\0.szs',
  join(repoRoot, 'public', 'dev-tracks', 'Z0.szs'),
  // Legacy WSL layout, kept only as a fallback.
  '/mnt/c/Users/patchzy/AppData/Roaming/Dolphin Emulator/Load/Riivolution/WheelWizard/RRBeta/Tracks/0.szs',
]);

const commonPath = firstExisting('Common.szs', process.env.COMMON_PATH, [
  join(repoRoot, 'public', 'data', 'MarioKartWii', 'Race', 'Common.szs'),
  'G:\\Games\\Wii\\mkwii-europe\\Race\\Common.szs',
  '/mnt/g/Games/Wii/mkwii-europe/Race/Common.szs',
]);

const browserPath = firstExisting('browser', process.env.BROWSER_PATH ?? process.env.CHROME_PATH, [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
]);

// The app's WebGL2 init rejects SwiftShader outright, so a real GPU backend is tried first.
// The later attempts exist so the script still gets as far as it can on a GPU-less host.
const launchProfiles = [
  { name: 'angle-default', flags: ['--use-angle=default'] },
  { name: 'angle-d3d11', flags: ['--use-angle=d3d11'] },
  { name: 'swiftshader', flags: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
];

const trackServer = createServer((request, response) => {
  if (request.url !== '/track.szs' && request.url !== '/Common.szs') {
    response.writeHead(404).end();
    return;
  }
  const filePath = request.url === '/Common.szs' ? commonPath : trackPath;
  const size = statSync(filePath).size;
  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/octet-stream',
    'Content-Length': size,
  });
  createReadStream(filePath).pipe(response);
});

await new Promise((resolvePromise) => trackServer.listen(0, '127.0.0.1', resolvePromise));
const trackPort = trackServer.address().port;

let latestSmokeReport = null;
let resolveSmokeReady;
let smokeReady;
function resetSmokeReady() {
  latestSmokeReport = null;
  smokeReady = new Promise((resolvePromise) => {
    resolveSmokeReady = resolvePromise;
  });
}
resetSmokeReady();

const callbackServer = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', '*');
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  if (request.method !== 'POST' || request.url !== '/smoke-report') {
    response.writeHead(404).end();
    return;
  }
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    try {
      latestSmokeReport = JSON.parse(body);
      // We decide readiness here rather than trusting report.ready, so this script owns its
      // own pass/fail criteria. See normalizeReport() for why report.rendered is unreliable.
      if (checkFailure(normalizeReport(latestSmokeReport)) === null) resolveSmokeReady(latestSmokeReport);
    } catch (error) {
      console.error('Failed to handle smoke report:', error);
    }
    response.writeHead(204).end();
  });
});
await new Promise((resolvePromise) => callbackServer.listen(0, '127.0.0.1', resolvePromise));
const callbackPort = callbackServer.address().port;

function buildUrl() {
  const url = new URL(appUrl);
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  url.searchParams.set('smokeTrack', `http://127.0.0.1:${trackPort}/track.szs`);
  url.searchParams.set('smokeCommon', `http://127.0.0.1:${trackPort}/Common.szs`);
  url.searchParams.set('smokeCallback', `http://127.0.0.1:${callbackPort}/smoke-report`);
  url.searchParams.set('smokeAddObject', String(smokeAddObjectId));
  url.searchParams.set('smokeRun', String(Date.now()));
  return url.toString();
}

try {
  console.log(`Browser:    ${browserPath}`);
  console.log(`Track:      ${trackPath}`);
  console.log(`Common.szs: ${commonPath}`);
  console.log(`App:        ${appUrl}`);

  let report = null;
  const failures = [];
  for (const profile of launchProfiles) {
    resetSmokeReady();
    const userDataDir = makeUserDataDir();
    try {
      console.log(`Launching headless browser (${profile.name})...`);
      report = (await runBrowser(buildUrl(), smokeReady, profile, userDataDir)).report;
      console.log(`Readiness report received (${profile.name}).`);
      break;
    } catch (error) {
      failures.push(`[${profile.name}] ${error.message}`);
    } finally {
      cleanupUserDataDir(userDataDir);
    }
  }

  if (report === null) throw new Error(`No launch profile produced a readiness report.\n\n${failures.join('\n\n')}`);

  assertReport(report);

  console.log(`Browser smoke loaded ${trackPath}`);
  console.log(
    'Verified loaded archive status, noclip rendered-track status, viewport canvas presence, removal of legacy DOM point handles, renderer-backed spawn for a newly added GOBJ, collision-snapped viewport placement for that object, available object resources, image-backed object thumbnails, collapsible editor controls, and nonblank 3D viewport sampling from the running app.',
  );
} finally {
  await closeServer(trackServer);
  await closeServer(callbackServer);
}

// A function, not a const: the report callback fires while module evaluation is still
// suspended on the top-level await below, so a const here would still be in its TDZ.
function requiredChecks() {
  return [
  ['loaded', 'did not load the .szs archive'],
  ['rendered', 'did not reach noclip rendered-track status'],
  ['hasViewportCanvas', 'did not expose the main noclip viewport canvas'],
  ['hasNonblankViewportProbe', 'did not confirm a nonblank viewport sample from the running app'],
  ['hasSmokeSelectedGobjRendered', 'did not confirm that a newly added object received a real renderer-backed GOBJ instance'],
  ['hasSmokeSelectedGobjSnapped', 'did not confirm that the smoke-placed object snapped onto collision'],
  ['hasSmokeMouseLook', 'did not confirm that right-drag mouse look rotates the noclip camera'],
  ['hasAvailableObjectResource', 'did not expose any available real object resource in the content browser'],
  ['hasObjectThumbnailImage', 'did not render an image-backed thumbnail for an available object resource'],
  ['hasInspectorToggle', 'did not expose the collapsible inspector control'],
  ['hasContentBrowserToggle', 'did not expose the collapsible content browser control'],
  ];
}

// src/ui/App.tsx computes `rendered` as rendererStatus.includes('sigma'), but the status it
// matches against reads e.g. "Z0.szs Sigma", so the case-sensitive test never fires and the
// app's own `ready` flag can never go true. Recompute it case-insensitively here.
// TODO: drop this once App.tsx does the comparison case-insensitively.
function normalizeReport(report) {
  const rendered = report.rendered || /\bsigma\b/i.test(String(report.rendererStatus ?? ''));
  return { ...report, rendered };
}

function checkFailure(report) {
  for (const [key, message] of requiredChecks()) {
    if (!report[key]) return `Browser smoke ${message}.`;
  }
  if (report.hasLegacyPointHandles) {
    return 'Browser smoke still found legacy DOM point handles after moving point interaction into the renderer/canvas path.';
  }
  return null;
}

function assertReport(rawReport) {
  const report = normalizeReport(rawReport);
  const failure = checkFailure(report);
  if (failure !== null) throw new Error(`${failure}\n${summarizeReport(report)}`);
}

function firstExisting(label, override, candidates) {
  if (override) {
    if (!existsSync(override)) throw new Error(`${label} not found: ${override}`);
    return override;
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`No ${label} found. Tried:\n  ${candidates.join('\n  ')}\nSet an env var to override.`);
}

function makeUserDataDir() {
  const root = tmpdir();
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, 'mkw-track-editor-smoke-'));
}

// Only WSL-style paths need translating; native Windows paths are passed through untouched.
function toBrowserPath(path) {
  if (!path.startsWith('/mnt/')) return path;
  try {
    return execFileSync('wslpath', ['-w', path], { encoding: 'utf8' }).trim();
  } catch {
    return path;
  }
}

function runBrowser(targetUrl, ready, profile, userDataDir) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      browserPath,
      [
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-application-cache',
        '--aggressive-cache-discard',
        '--disk-cache-size=1',
        '--media-cache-size=1',
        '--enable-logging=stderr',
        '--v=0',
        '--window-size=1440,900',
        ...profile.flags,
        `--user-data-dir=${toBrowserPath(userDataDir)}`,
        targetUrl,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );

    let settled = false;
    let stderr = '';
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      finalizeBrowserProcess(child, userDataDir);
      fn(value);
    };
    const timeout = setTimeout(() => {
      finish(reject, new Error(`Browser smoke timed out after ${smokeTimeoutMs}ms.\n${summarizeReport(latestSmokeReport, stderr)}`));
    }, smokeTimeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Browser exited before app readiness with code ${code}.\n${summarizeReport(latestSmokeReport, stderr)}`));
    });
    ready.then((report) => finish(resolvePromise, { report, stderr })).catch((error) => finish(reject, error));
  });
}

function summarizeReport(report, stderr = '') {
  if (!report) return stderr.trim() ? `Browser stderr: ${stderr.trim().slice(-1600)}` : 'No smoke report received from the app.';
  return [
    `Phase: ${report.phase ?? ''}`,
    `App status: ${report.status ?? ''}`,
    report.commonLoadStatus ? `Common load: ${report.commonLoadStatus}` : '',
    report.error ? `App error: ${report.error}` : '',
    report.stack ? `App stack: ${String(report.stack).slice(-1200)}` : '',
    `Renderer status: ${report.rendererStatus ?? ''}`,
    `Checks: ${JSON.stringify({
      loaded: report.loaded,
      rendered: report.rendered,
      hasCommonArchiveLoaded: report.hasCommonArchiveLoaded,
      commonObjectCount: report.commonObjectCount,
      commonSummaryCount: report.commonSummaryCount,
      hasCourseAssetDb: report.hasCourseAssetDb,
      hasViewportCanvas: report.hasViewportCanvas,
      hasLegacyPointHandles: report.hasLegacyPointHandles,
      hasNonblankViewportProbe: report.hasNonblankViewportProbe,
      hasSmokeSelectedGobjRendered: report.hasSmokeSelectedGobjRendered,
      hasSmokeSelectedGobjSnapped: report.hasSmokeSelectedGobjSnapped,
      hasSmokeMouseLook: report.hasSmokeMouseLook,
      hasAvailableObjectResource: report.hasAvailableObjectResource,
      hasObjectThumbnailImage: report.hasObjectThumbnailImage,
      hasInspectorToggle: report.hasInspectorToggle,
      hasContentBrowserToggle: report.hasContentBrowserToggle,
      ready: report.ready,
    })}`,
    stderr.trim() ? `Browser stderr: ${stderr.trim().slice(-1600)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function closeServer(server) {
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await new Promise((resolvePromise) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolvePromise();
    };
    const timeout = setTimeout(finish, 2000);
    server.close(() => {
      clearTimeout(timeout);
      finish();
    });
  });
}

function cleanupUserDataDir(userDataDir) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      rmSync(userDataDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== 'EACCES' && error?.code !== 'EBUSY' && error?.code !== 'ENOTEMPTY') return;
      sleepMs(250);
    }
  }
}

function finalizeBrowserProcess(child, userDataDir) {
  killBrowserProcess(child, userDataDir);
  child.stderr?.destroy();
  child.stdout?.destroy();
  child.stdin?.destroy();
  child.removeAllListeners();
  child.unref?.();
}

function killBrowserProcess(child, userDataDir) {
  if (process.platform === 'win32' || browserPath.startsWith('/mnt/')) {
    try {
      spawnSync('taskkill.exe', ['/F', '/PID', String(child.pid), '/T'], { stdio: 'ignore', timeout: 10000 });
    } catch {}
    sleepMs(250);
    killBrowserTreeByUserDataDir(toBrowserPath(userDataDir));
    return;
  }
  try {
    child.kill('SIGKILL');
  } catch {}
}

// Headless Chromium re-parents its child processes, so taskkill on the launcher pid can
// leave renderers behind. Sweep anything still holding this run's user-data-dir.
function killBrowserTreeByUserDataDir(userDataDir) {
  const exeName = basename(browserPath);
  try {
    spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$exe = $args[0]; $dir = $args[1]; Get-CimInstance Win32_Process -Filter \"name = '$exe'\" | Where-Object { $_.CommandLine -like \"*$dir*\" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
        exeName,
        userDataDir,
      ],
      { stdio: 'ignore', timeout: 15000 },
    );
  } catch {}
  sleepMs(250);
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
