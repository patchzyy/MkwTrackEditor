// Dev-only harness: drives the viewport's `window.__mkwViewport` hook in a dedicated
// Edge instance and writes screenshots to docs/screenshots.
//
//   node scripts/viewport-dev-probe.mjs <url> <scriptFile>
//
// The script file is evaluated in the page as an async function body. It gets `mkw`
// (the dev hook), `shot(name)` and `canvasRect()`.
//
// Headless Edge cannot run noclip (SwiftShader lacks the WebGL2 features the renderer
// needs), so this launches a real window parked off-screen.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = resolve(root, 'docs/screenshots');
mkdirSync(shotDir, { recursive: true });

const url = process.argv[2] ?? 'http://127.0.0.1:5185/?smokeTrack=/dev-tracks/Z0.szs';
const scriptFile = process.argv[3];
const port = Number(process.env.PROBE_PORT ?? 9333);
const edge = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const child = spawn(edge, [
  `--remote-debugging-port=${port}`,
  '--window-size=1280,760',
  '--window-position=-2400,-2400',
  // Its own subdirectory, like the *-ui-probe.mjs harnesses. This used to be `.probe-profile`
  // itself, which is the *parent* of theirs; once any UI probe had run, Edge would not start
  // cleanly here and the probe failed with a misleading "Track never finished loading".
  `--user-data-dir=${resolve(root, '.probe-profile/viewport-dev')}`,
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
await send('Page.navigate', { url });
await sleep(3000);

const ready = await evaluate(`(async () => {
  for (let i = 0; i < 180; i++) {
    if (window.__mkwViewport && window.__mkwViewport.listMeshes().length > 0) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
})()`);
if (!ready) {
  console.error('Track never finished loading');
  finish(1);
}

await evaluate(`window.__probeShots = [];
window.__probeShot = async (name) => {
  const url = await window.__mkwViewport.captureFrame();
  window.__probeShots.push({ name, url });
  return !!url;
};
window.__canvasRect = () => document.querySelector('canvas').getBoundingClientRect().toJSON();
true;`);

const body = scriptFile ? readFileSync(resolve(root, scriptFile), 'utf8') : 'return { ok: true };';
const output = await evaluate(`(async () => { const mkw = window.__mkwViewport; const shot = window.__probeShot; const canvasRect = window.__canvasRect; ${body} })()`);
console.log('script result:', JSON.stringify(output, null, 2));

const count = await evaluate('window.__probeShots.length');
for (let i = 0; i < count; i++) {
  const shot = await evaluate(`(() => { const s = window.__probeShots[${i}]; return { name: s.name, len: s.url ? s.url.length : 0 }; })()`);
  if (!shot.len) {
    console.warn('no frame captured for', shot.name);
    continue;
  }
  const chunkSize = 4_000_000;
  let data = '';
  for (let offset = 0; offset < shot.len; offset += chunkSize)
    data += await evaluate(`window.__probeShots[${i}].url.slice(${offset}, ${offset + chunkSize})`);
  const file = resolve(shotDir, `${shot.name}.png`);
  writeFileSync(file, Buffer.from(data.replace(/^data:image\/png;base64,/, ''), 'base64'));
  console.log('wrote', file);
}

finish(0);
