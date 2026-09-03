#!/usr/bin/env node
/**
 * Proves the *production build* works when it is served from a sub-path, the way GitHub Pages
 * serves it — not just from `/` the way the dev server does.
 *
 * A site that works at `/` can still be broken at `/MkwTrackEditor/`: every asset URL has to go
 * through `import.meta.env.BASE_URL`, and one hard-coded leading slash breaks the bundled game
 * data without breaking anything a unit test can see. This loads the built site in a real Edge
 * window, opens a track with `?track=`, and fails on any console error or failed request.
 *
 *   GITHUB_PAGES=1 npx vite build
 *   node scripts/serve-subpath.mjs --port 5200 &
 *   node scripts/probe-subpath-build.mjs http://127.0.0.1:5200/MkwTrackEditor/
 *
 * The dev-only `window.__mkwViewport` hook does not exist in a production build, so this checks
 * the DOM and the network instead. Headless Edge cannot run noclip, so the window is real but
 * parked off-screen.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = resolve(root, 'docs/screenshots');
mkdirSync(shotDir, { recursive: true });

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5200/MkwTrackEditor/';
const trackPath = process.argv[3] ?? 'dev-tracks/Z0.szs';
const url = `${baseUrl}?track=${new URL(trackPath, baseUrl).pathname}`;
const port = Number(process.env.PROBE_PORT ?? 9351);
const edge = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const child = spawn(edge, [
  `--remote-debugging-port=${port}`,
  '--window-size=1600,1000',
  '--window-position=-2400,-2400',
  `--user-data-dir=${resolve(root, '.probe-profile/subpath')}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  'about:blank',
], { stdio: 'ignore', detached: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPage() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {
      // still starting
    }
    await sleep(300);
  }
  throw new Error('Could not reach the browser debugger');
}

const page = await findPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let nextId = 1;
const pending = new Map();
const consoleErrors = [];
const failedRequests = [];

ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails;
    consoleErrors.push(details.exception?.description ?? details.text ?? 'uncaught exception');
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((a) => a.description ?? a.value ?? '').join(' '));
    return;
  }
  if (message.method === 'Network.loadingFailed') {
    failedRequests.push(`${message.params.type}: ${message.params.errorText}`);
    return;
  }
  if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
    failedRequests.push(`HTTP ${message.params.response.status} ${message.params.response.url}`);
    return;
  }
  if (!message.id || !pending.has(message.id)) return;
  const { resolve: done, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(JSON.stringify(message.error)));
  else done(message.result);
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolvePromise, reject) => {
    pending.set(id, { resolve: resolvePromise, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails.exception ?? result.exceptionDetails));
  return result.result.value;
}

const failures = [];
function finish() {
  ws.close();
  child.kill();
  if (failures.length > 0) {
    console.error('');
    console.error('FAILED:');
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log('');
  console.log('Sub-path production build: OK');
  process.exit(0);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

console.log(`Opening ${url}`);
await send('Page.navigate', { url });

// Wait for the track to finish loading. In a production build there is no dev hook, so the
// signal is the app's own status line reporting the record count.
const loaded = await evaluate(`(async () => {
  for (let i = 0; i < 240; i++) {
    const text = document.body.innerText || '';
    if (/editable track records/i.test(text)) return text.match(/Loaded[^\\n]*/)?.[0] ?? 'loaded';
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
})()`);

if (!loaded) failures.push('the track never finished loading from the sub-path');
else console.log(`Status line: ${loaded}`);

const dom = await evaluate(`(() => {
  const canvas = document.querySelector('canvas');
  return {
    hasCanvas: !!canvas,
    canvasWidth: canvas?.width ?? 0,
    canvasHeight: canvas?.height ?? 0,
    // The bundled game data is fetched relative to BASE_URL; if that were wrong the object
    // catalog would be empty and the browser would have nothing to place.
    bodyLength: (document.body.innerText || '').length,
    baseHref: document.querySelector('script[type=module]')?.src ?? '',
  };
})()`);

if (!dom.hasCanvas) failures.push('no viewport canvas was rendered');
if (dom.canvasWidth < 100 || dom.canvasHeight < 100) failures.push(`the viewport canvas is ${dom.canvasWidth}x${dom.canvasHeight}`);
if (!dom.baseHref.includes('/MkwTrackEditor/')) failures.push(`the bundle was not loaded from the sub-path: ${dom.baseHref}`);
console.log(`Canvas ${dom.canvasWidth}x${dom.canvasHeight}, bundle ${dom.baseHref}`);

// Give the bundled Common.szs and the asset database time to land.
await sleep(4000);

const assets = await evaluate(`(async () => {
  const base = document.querySelector('script[type=module]').src.replace(/assets\\/.*$/, '');
  const check = async (path) => {
    try { const r = await fetch(base + path); return r.status; } catch (e) { return String(e); }
  };
  return {
    commonSzs: await check('data/MarioKartWii/Race/Common.szs'),
    assetDb: await check('data/MarioKartWii/Race/Course/course-asset-db.json'),
  };
})()`);
console.log(`Bundled assets: Common.szs ${assets.commonSzs}, course-asset-db.json ${assets.assetDb}`);
if (assets.commonSzs !== 200) failures.push(`Common.szs did not resolve under the sub-path (${assets.commonSzs})`);
if (assets.assetDb !== 200) failures.push(`course-asset-db.json did not resolve under the sub-path (${assets.assetDb})`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(resolve(shotDir, 'subpath-build.png'), Buffer.from(shot.data, 'base64'));
console.log('Screenshot: docs/screenshots/subpath-build.png');

// A WebGL context-lost warning is normal when the window is parked off-screen; a real error
// is not. Only 404s and uncaught exceptions count.
const realErrors = consoleErrors.filter((message) => !/context lost|WebGL warning|Download the React DevTools/i.test(message));
if (realErrors.length > 0) failures.push(`console errors: ${realErrors.slice(0, 5).join(' | ')}`);

const realFailures = failedRequests.filter((message) => !/favicon|Aborted/i.test(message));
if (realFailures.length > 0) failures.push(`failed requests: ${realFailures.slice(0, 5).join(' | ')}`);

finish();
