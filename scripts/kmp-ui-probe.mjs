// KMP-mode browser check.
//
//   node scripts/kmp-ui-probe.mjs <url> <scriptFile>
//
// Same idea as viewport-dev-probe.mjs, but the screenshots are full-page (`Page.captureScreenshot`)
// so the outliner and inspector show up next to the viewport, not just the WebGL canvas. Headless
// Edge cannot run noclip, so this opens a real window parked off-screen.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = resolve(root, 'docs/screenshots');
mkdirSync(shotDir, { recursive: true });

const url = process.argv[2] ?? 'http://127.0.0.1:5184/?track=/dev-tracks/Z0.szs';
const scriptFile = process.argv[3];
const port = Number(process.env.PROBE_PORT ?? 9347);
const edge = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const child = spawn(edge, [
  `--remote-debugging-port=${port}`,
  '--window-size=1600,1000',
  '--window-position=-2400,-2400',
  `--user-data-dir=${resolve(root, '.probe-profile/kmp-ui')}`,
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
      // browser still starting
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
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
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

function finish(code) {
  ws.close();
  child.kill();
  process.exit(code);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(3000);

const ready = await evaluate(`(async () => {
  for (let i = 0; i < 180; i++) {
    if (window.__mkwViewport && window.__mkwTrackDocument && window.__mkwTrackDocument.kmpFile) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
})()`);
if (!ready) {
  console.error('Track never finished loading');
  finish(1);
}

// The page asks for a screenshot by name; the driver takes it and clears the request. Going
// through the driver is what makes the shot include the DOM panels as well as the canvas.
await evaluate(`window.__shotRequest = null;
window.__shot = (name) => new Promise((done) => {
  window.__shotRequest = { name, done };
});
window.__canvasRect = () => document.querySelector('canvas').getBoundingClientRect().toJSON();
true;`);

const body = scriptFile ? readFileSync(resolve(root, scriptFile), 'utf8') : 'return { ok: true };';
const script = evaluate(
  `(async () => { const mkw = window.__mkwViewport; const shot = window.__shot; const canvasRect = window.__canvasRect; ` +
  `window.__scriptResult = undefined; try { window.__scriptResult = await (async () => { ${body} })(); } ` +
  `catch (error) { window.__scriptResult = { error: String(error && error.stack || error) }; } return true; })()`,
);

const written = [];
let done = false;
script.then(() => { done = true; }).catch((error) => { console.error(error); done = true; });

while (!done) {
  const request = await evaluate('window.__shotRequest ? window.__shotRequest.name : null');
  if (request === null) {
    await sleep(120);
    continue;
  }
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = resolve(shotDir, `${request}.png`);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  written.push(file);
  await evaluate('(() => { const r = window.__shotRequest; window.__shotRequest = null; r.done(true); return true; })()');
}

const result = await evaluate('window.__scriptResult');
console.log('script result:', JSON.stringify(result, null, 2));
for (const file of written) console.log('wrote', file);
finish(result && result.error ? 1 : 0);
