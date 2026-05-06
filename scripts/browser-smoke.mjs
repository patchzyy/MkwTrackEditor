import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appUrl = process.env.APP_URL ?? 'http://localhost:5175/';
const trackPath =
  process.env.TRACK_PATH ??
  '/mnt/c/Users/patchzy/AppData/Roaming/Dolphin Emulator/Load/Riivolution/WheelWizard/RRBeta/Tracks/0.szs';
const commonPath =
  process.env.COMMON_PATH ??
  (existsSync('/mnt/g/Games/Wii/mkwii-europe/Race/Common.szs')
    ? '/mnt/g/Games/Wii/mkwii-europe/Race/Common.szs'
    : '/mnt/g/ai/MkwTrackEditor/public/data/MarioKartWii/Race/Common.szs');
const chromePath = process.env.CHROME_PATH ?? '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
const chromeTimeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 90000);
const smokeAddObjectId = Number(process.env.SMOKE_ADD_OBJECT_ID ?? 0x65);

if (!existsSync(trackPath)) throw new Error(`Smoke track not found: ${trackPath}`);
if (!existsSync(commonPath)) throw new Error(`Smoke Common.szs not found: ${commonPath}`);
if (!existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);

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

await new Promise((resolve) => trackServer.listen(0, '0.0.0.0', resolve));
const trackPort = trackServer.address().port;
let latestSmokeReport = null;
let resolveSmokeReady;
const smokeReady = new Promise((resolve) => {
  resolveSmokeReady = resolve;
});
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
      if (latestSmokeReport?.ready) resolveSmokeReady(latestSmokeReport);
    } catch {}
    response.writeHead(204).end();
  });
});
await new Promise((resolve) => callbackServer.listen(0, '0.0.0.0', resolve));
const callbackPort = callbackServer.address().port;
const url = new URL(appUrl);
if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
url.searchParams.set('smokeTrack', `http://127.0.0.1:${trackPort}/track.szs`);
url.searchParams.set('smokeCommon', `http://127.0.0.1:${trackPort}/Common.szs`);
url.searchParams.set('smokeCallback', `http://127.0.0.1:${callbackPort}/smoke-report`);
url.searchParams.set('smokeAddObject', String(smokeAddObjectId));
url.searchParams.set('smokeRun', String(Date.now()));
const tempRoot = chromePath.startsWith('/mnt/c/')
  ? `/mnt/c/Users/${process.env.USER ?? 'patchzy'}/AppData/Local/Temp`
  : tmpdir();
mkdirSync(tempRoot, { recursive: true });
const userDataDir = mkdtempSync(join(tempRoot, 'mkw-track-editor-smoke-'));
const chromeUserDataDir = chromePath.startsWith('/mnt/') ? execFileSync('wslpath', ['-w', userDataDir], { encoding: 'utf8' }).trim() : userDataDir;

try {
  const { report } = await runChrome(url.toString(), smokeReady);
  if (!report.loaded) throw new Error(`Browser smoke did not load the .szs archive.\n${summarizeReport(report)}`);
  if (!report.rendered) throw new Error(`Browser smoke did not reach noclip rendered-track status.\n${summarizeReport(report)}`);
  if (!report.hasViewportCanvas) throw new Error(`Browser smoke did not expose the main noclip viewport canvas.\n${summarizeReport(report)}`);
  if (report.hasLegacyPointHandles) throw new Error(`Browser smoke still found legacy DOM point handles after moving point interaction into the renderer/canvas path.\n${summarizeReport(report)}`);
  if (!report.hasNonblankViewportProbe) throw new Error(`Browser smoke did not confirm a nonblank viewport sample from the running app.\n${summarizeReport(report)}`);
  if (!report.hasSmokeSelectedGobjRendered) throw new Error(`Browser smoke did not confirm that a newly added object received a real renderer-backed GOBJ instance.\n${summarizeReport(report)}`);
  if (!report.hasSmokeSelectedGobjSnapped) throw new Error(`Browser smoke did not confirm that the smoke-placed object snapped onto collision.\n${summarizeReport(report)}`);
  if (!report.hasSmokeMouseLook) throw new Error(`Browser smoke did not confirm that right-drag mouse look rotates the noclip camera.\n${summarizeReport(report)}`);
  if (!report.hasAvailableObjectResource) throw new Error(`Browser smoke did not expose any available real object resource in the content browser.\n${summarizeReport(report)}`);
  if (!report.hasObjectThumbnailImage) throw new Error(`Browser smoke did not render an image-backed thumbnail for an available object resource.\n${summarizeReport(report)}`);
  if (!report.hasInspectorToggle) throw new Error(`Browser smoke did not expose the collapsible inspector control.\n${summarizeReport(report)}`);
  if (!report.hasContentBrowserToggle) throw new Error(`Browser smoke did not expose the collapsible content browser control.\n${summarizeReport(report)}`);

  console.log(`Browser smoke loaded ${trackPath}`);
  console.log('Verified loaded archive status, noclip rendered-track status, viewport canvas presence, removal of legacy DOM point handles, renderer-backed spawn for a newly added GOBJ, collision-snapped viewport placement for that object, available object resources, image-backed object thumbnails, collapsible editor controls, and nonblank 3D viewport sampling from the running app.');
} finally {
  await closeServer(trackServer);
  await closeServer(callbackServer);
  cleanupUserDataDir(userDataDir, chromePath);
}

function runChrome(targetUrl, smokeReady) {
  return new Promise((resolve, reject) => {
    const chrome = spawn(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--disable-cache',
      '--disable-application-cache',
      '--aggressive-cache-discard',
      '--disk-cache-size=1',
      '--media-cache-size=1',
      '--enable-logging=stderr',
      '--v=0',
      '--window-size=1440,900',
      `--user-data-dir=${chromeUserDataDir}`,
      targetUrl,
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      finalizeChromeProcess(chrome, chromePath);
      reject(new Error(`Chrome smoke timed out after ${chromeTimeoutMs}ms.\n${summarizeReport(latestSmokeReport, stderr)}`));
    }, chromeTimeoutMs);
    let stderr = '';
    chrome.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    chrome.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      finalizeChromeProcess(chrome, chromePath);
      reject(error);
    });
    chrome.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Chrome smoke exited before app readiness with ${code}.\n${summarizeReport(latestSmokeReport, stderr)}`));
    });
    smokeReady.then((report) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      finalizeChromeProcess(chrome, chromePath);
      resolve({ report, stderr });
    }).catch((error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      finalizeChromeProcess(chrome, chromePath);
      reject(error);
    });
  });
}

function summarizeReport(report, stderr = '') {
  if (!report) return stderr.trim() ? `Chrome stderr: ${stderr.trim().slice(-1200)}` : 'No smoke report received from the app.';
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
    stderr.trim() ? `Chrome stderr: ${stderr.trim().slice(-1200)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function closeServer(server) {
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timeout = setTimeout(finish, 2000);
    server.close(() => {
      clearTimeout(timeout);
      finish();
    });
  });
}

function cleanupUserDataDir(userDataDir, chromePath) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      rmSync(userDataDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== 'EACCES' && error?.code !== 'EBUSY' && error?.code !== 'ENOTEMPTY') throw error;
      sleepMs(250);
    }
  }

  if (chromePath.startsWith('/mnt/')) {
    const windowsUserDataDir = execFileSync('wslpath', ['-w', userDataDir], { encoding: 'utf8' }).trim();
    try {
      const result = spawnSync('cmd.exe', ['/c', 'rd', '/s', '/q', windowsUserDataDir], {
        stdio: 'ignore',
        timeout: 5000,
      });
      if (result.status === 0) return;
      if (result.error) throw result.error;
      return;
    } catch {}
  }

  rmSync(userDataDir, { recursive: true, force: true });
}

function killChromeProcess(chrome, chromePath) {
  if (chromePath.startsWith('/mnt/c/')) {
    killWindowsChromeTree(chromeUserDataDir, chrome.pid);
    return;
  }
  try {
    chrome.kill('SIGKILL');
  } catch {}
}

function finalizeChromeProcess(chrome, chromePath) {
  killChromeProcess(chrome, chromePath);
  chrome.stderr?.destroy();
  chrome.stdout?.destroy();
  chrome.stdin?.destroy();
  chrome.removeAllListeners();
  chrome.unref?.();
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function killWindowsChromeTree(userDataDir, pid) {
  try {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$dir = $args[0]; $deadline = (Get-Date).AddSeconds(10); do { $procs = @(Get-CimInstance Win32_Process -Filter "name = \'chrome.exe\'" | Where-Object { $_.CommandLine -like \"*$dir*\" }); foreach ($proc in $procs) { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue }; if ($procs.Count -eq 0) { exit 0 }; Start-Sleep -Milliseconds 250 } while ((Get-Date) -lt $deadline); $remaining = @(Get-CimInstance Win32_Process -Filter "name = \'chrome.exe\'" | Where-Object { $_.CommandLine -like \"*$dir*\" }); if ($remaining.Count -eq 0) { exit 0 } else { exit 1 }',
        userDataDir,
      ],
      { encoding: 'utf8', stdio: 'ignore', timeout: 15000 },
    );
    if (result.status === 0 && !result.error) return;
  } catch {
  }
  try {
    spawnSync('taskkill.exe', ['/F', '/PID', String(pid), '/T'], { stdio: 'ignore', timeout: 5000 });
  } catch {}
  sleepMs(500);
  try {
    spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$dir = $args[0]; Get-CimInstance Win32_Process -Filter "name = \'chrome.exe\'" | Where-Object { $_.CommandLine -like \"*$dir*\" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
        userDataDir,
      ],
      { stdio: 'ignore', timeout: 5000 },
    );
  } catch {}
  sleepMs(500);
}

function getMatchingChromeProcessCount(userDataDir) {
  try {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$dir = $args[0]; @((Get-CimInstance Win32_Process -Filter "name = \'chrome.exe\'" | Where-Object { $_.CommandLine -like \"*$dir*\" })).Count',
        userDataDir,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 },
    );
    if (result.error || result.status !== 0) return null;
    const count = Number.parseInt((result.stdout ?? '').trim() || '0', 10);
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}
