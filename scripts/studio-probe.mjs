// Dev-only harness for the Model Studio (docs/STUDIO.md).
//
//   node scripts/studio-probe.mjs <url> <scriptFile>
//
// Same contract as scripts/ui-shell-probe.mjs — the probe body gets `shot`, `q`, `qa`,
// `clickText`, `sleep` — but it waits on `window.__mkwStudio` instead of on a loaded track, so it
// can drive a studio session with no track open at all. `mkw` is `window.__mkwViewport` when a
// track was loaded and `null` otherwise; `studio` is `window.__mkwStudio`.
//
// Headless Edge cannot run noclip on this host, so this launches a real window parked off-screen.
// Never pass --disable-gpu.
//
//   PROBE_PREFIX=studio PROBE_PORT=9433 PROBE_SIZE=1720x1000 \
//     node scripts/studio-probe.mjs "http://127.0.0.1:5233/" scripts/probe-studio.js
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = resolve(root, 'docs/screenshots');
mkdirSync(shotDir, { recursive: true });

const url = process.argv[2] ?? 'http://127.0.0.1:5233/';
const scriptFile = process.argv[3];
const port = Number(process.env.PROBE_PORT ?? 9433);
const [width, height] = (process.env.PROBE_SIZE ?? '1720x1000').split('x').map(Number);
const edge = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
/** Where the studio should be opened from: the top bar button, or a track archive. */
const openMode = process.env.PROBE_STUDIO_OPEN ?? 'topbar';

const child = spawn(edge, [
  `--remote-debugging-port=${port}`,
  `--window-size=${width},${height}`,
  '--window-position=-2400,-2400',
  `--user-data-dir=${resolve(root, '.probe-profile/studio')}`,
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
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(3000);

// A track-archive session needs the track loaded and Model mode entered first; the plain session
// only needs the app on screen.
if (openMode === 'track') {
  const trackReady = await evaluate(`(async () => {
    for (let i = 0; i < 240; i++) {
      if (window.__mkwViewport && window.__mkwViewport.listMeshes().length > 0) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  })()`);
  if (!trackReady) {
    console.error('Track never finished loading');
    finish(1);
  }
}

const appReady = await evaluate(`(async () => {
  for (let i = 0; i < 120; i++) {
    const button = [...document.querySelectorAll('button')].find((n) => n.textContent.trim() === 'Model Studio');
    if (button) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
})()`);
if (!appReady) {
  console.error('The editor shell never appeared');
  finish(1);
}

await evaluate(`window.__probePrefix = ${JSON.stringify(process.env.PROBE_PREFIX ?? 'studio')};
// Which model a body should open, and what to call its screenshots, so one probe can be run over
// several archives without a copy per archive.
window.__probeModel = ${JSON.stringify(process.env.PROBE_MODEL ?? '')} || null;
window.__probeShot = ${JSON.stringify(process.env.PROBE_SHOT ?? '')} || null;
window.__uiProbeQueue = [];
window.__probeShotRequest = (name) => { window.__uiProbeQueue.push(name); return new Promise((r) => setTimeout(r, 60)); };
window.__q = (sel) => document.querySelector(sel);
window.__qa = (sel) => [...document.querySelectorAll(sel)];
window.__clickText = (text, sel = 'button') => {
  const node = [...document.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);
  if (node) node.click();
  return !!node;
};
true;`);

let shotIndex = 0;
async function drainShots() {
  const names = await evaluate('(() => { const q = window.__uiProbeQueue; window.__uiProbeQueue = []; return q; })()');
  for (const name of names ?? []) {
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(resolve(shotDir, `${name}.png`), Buffer.from(result.data, 'base64'));
    console.log('wrote', resolve(shotDir, `${name}.png`));
    shotIndex++;
  }
}

const body = scriptFile ? readFileSync(resolve(root, scriptFile), 'utf8') : 'return { ok: true };';
const runner = evaluate(`(async () => {
  const shot = window.__probeShotRequest;
  const q = window.__q, qa = window.__qa, clickText = window.__clickText;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mkw = window.__mkwViewport ?? null;
  const waitForStudio = async () => {
    for (let i = 0; i < 240; i++) {
      if (window.__mkwStudio && window.__mkwStudio.ready()) return window.__mkwStudio;
      await sleep(250);
    }
    throw new Error('The Model Studio never became ready');
  };
  window.__uiProbeResult = undefined;
  window.__uiProbeResult = await (async () => { ${body} })();
  window.__uiProbeDone = true;
  return true;
})()`);

let done = false;
runner.then(() => { done = true; }).catch((error) => { console.error(error); done = true; });
while (!done) {
  await drainShots();
  await sleep(120);
}
await drainShots();

const output = await evaluate('window.__uiProbeResult');
console.log('script result:', JSON.stringify(output, null, 2));
console.log(`${shotIndex} screenshot(s) written`);

finish(0);
