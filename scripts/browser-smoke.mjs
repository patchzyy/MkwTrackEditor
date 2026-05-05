import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appUrl = process.env.APP_URL ?? 'http://localhost:5175/';
const trackPath =
  process.env.TRACK_PATH ??
  '/mnt/c/Users/patchzy/AppData/Roaming/Dolphin Emulator/Load/Riivolution/WheelWizard/RRBeta/Tracks/0.szs';
const chromePath = process.env.CHROME_PATH ?? '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
const chromeTimeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 90000);

if (!existsSync(trackPath)) throw new Error(`Smoke track not found: ${trackPath}`);
if (!existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);

const trackServer = createServer((request, response) => {
  if (request.url !== '/track.szs') {
    response.writeHead(404).end();
    return;
  }
  const size = statSync(trackPath).size;
  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/octet-stream',
    'Content-Length': size,
  });
  createReadStream(trackPath).pipe(response);
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
url.searchParams.set('smokeTrack', `http://localhost:${trackPort}/track.szs`);
url.searchParams.set('smokeCallback', `http://localhost:${callbackPort}/smoke-report`);
url.searchParams.set('smokeAddObject', String(0x65));
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
    ]);
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      chrome.kill('SIGKILL');
      reject(new Error(`Chrome smoke timed out after ${chromeTimeoutMs}ms.\n${summarizeReport(latestSmokeReport)}`));
    }, chromeTimeoutMs);
    let stderr = '';
    chrome.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    chrome.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
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
      chrome.kill('SIGKILL');
      resolve({ report, stderr });
    }).catch((error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.kill('SIGKILL');
      reject(error);
    });
  });
}

function summarizeReport(report, stderr = '') {
  if (!report) return stderr.trim() ? `Chrome stderr: ${stderr.trim().slice(-1200)}` : 'No smoke report received from the app.';
  return [
    `App status: ${report.status ?? ''}`,
    `Renderer status: ${report.rendererStatus ?? ''}`,
    `Checks: ${JSON.stringify({
      loaded: report.loaded,
      rendered: report.rendered,
      hasViewportCanvas: report.hasViewportCanvas,
      hasLegacyPointHandles: report.hasLegacyPointHandles,
      hasNonblankViewportProbe: report.hasNonblankViewportProbe,
      hasSmokeSelectedGobjRendered: report.hasSmokeSelectedGobjRendered,
      hasSmokeSelectedGobjSnapped: report.hasSmokeSelectedGobjSnapped,
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
  await new Promise((resolve) => server.close(resolve));
}

function cleanupUserDataDir(userDataDir, chromePath) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      rmSync(userDataDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== 'EACCES' && error?.code !== 'EBUSY' && error?.code !== 'ENOTEMPTY') throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }

  if (chromePath.startsWith('/mnt/')) {
    const windowsUserDataDir = execFileSync('wslpath', ['-w', userDataDir], { encoding: 'utf8' }).trim();
    try {
      execFileSync('cmd.exe', ['/c', 'rd', '/s', '/q', windowsUserDataDir], { stdio: 'ignore' });
      return;
    } catch {}
  }

  rmSync(userDataDir, { recursive: true, force: true });
}
