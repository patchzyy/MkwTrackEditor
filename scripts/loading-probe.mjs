// Dev-only harness for measuring *track loading* in a real browser.
//
//   PROBE_PORT=9432 node scripts/loading-probe.mjs <url> <scriptFile>
//
// `scripts/ui-shell-probe.mjs` waits for the track to finish loading before it runs the page
// script, which is exactly the window this probe has to observe. So this variant:
//
//   - installs a main-thread responsiveness recorder with `Page.addScriptToEvaluateOnNewDocument`,
//     i.e. before any application code runs. It samples `performance.now()` from a 4 ms timer and
//     from `requestAnimationFrame`, and remembers the longest gap between consecutive samples --
//     which is the longest stretch the main thread was busy and could not paint;
//   - runs the page script immediately after `Page.navigate` instead of after the load, so the
//     script can screenshot the loading overlay and read progress while it happens.
//
// The page script gets the same helpers as the other probes (`mkw`, `shot`, `q`, `qa`,
// `clickText`, `sleep`) plus:
//
//   gaps()            -> { longest, longestAt, samples, timeline, sinceNavigation }
//   resetGaps()       -> zeroes the recorder (use it to measure one phase)
//   waitForTrack(ms)  -> resolves true once `__mkwViewport.listMeshes().length > 0`
//
// Headless Edge cannot run noclip on this host, so this launches a real window parked
// off-screen. Never pass --disable-gpu.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = resolve(root, 'docs/screenshots');
mkdirSync(shotDir, { recursive: true });

const url = process.argv[2] ?? 'http://127.0.0.1:5232/?track=/dev-tracks/nintendo_1.szs';
const scriptFile = process.argv[3];
const port = Number(process.env.PROBE_PORT ?? 9432);
const [width, height] = (process.env.PROBE_SIZE ?? '1600x1000').split('x').map(Number);
const edge = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const child = spawn(edge, [
  `--remote-debugging-port=${port}`,
  `--window-size=${width},${height}`,
  '--window-position=-2400,-2400',
  `--user-data-dir=${resolve(root, '.probe-profile/loading')}`,
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

// Installed before the page's own scripts, so the very first frames are measured too.
// NO_REACT_TRACKS=1 removes `console.timeStamp` before React DOM initialises. React 19.2's
// development build gates its "Components" performance track on that function existing, and the
// track serialises every changed prop -- which, for a component that takes the whole
// `TrackDocument`, is megabytes. This is a measurement switch, not a fix: it exists so a probe
// can say how much of a dev-mode stall is React's dev instrumentation rather than the app.
const REACT_TRACKS_OFF = process.env.NO_REACT_TRACKS === '1'
  ? 'delete console.timeStamp;'
  : '';

const RECORDER = `${REACT_TRACKS_OFF}(() => {
  const state = { start: performance.now(), last: performance.now(), longest: 0, longestAt: 0, samples: 0, timeline: [] };
  window.__loadingGaps = state;
  const tick = () => {
    const now = performance.now();
    const gap = now - state.last;
    state.last = now;
    state.samples++;
    if (gap > state.longest) { state.longest = gap; state.longestAt = now - state.start; }
    // Keep every stall worth talking about, with the phase label the overlay was showing.
    if (gap > 50) {
      const overlay = document.querySelector('.uiLoadingTitle');
      const detail = document.querySelector('.uiLoadingDetail');
      state.timeline.push({
        at: Math.round(now - state.start),
        gap: Math.round(gap),
        stage: overlay ? overlay.textContent : null,
        detail: detail ? detail.textContent : null,
      });
    }
  };
  setInterval(tick, 4);
  const frame = () => { tick(); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  // Console + error capture, so a probe can explain a stall instead of just measuring it.
  state.logs = [];
  const record = (kind, args) => {
    if (state.logs.length > 200) return;
    try {
      state.logs.push({ at: Math.round(performance.now() - state.start), kind, text: args.map((a) => (a instanceof Error ? a.message : typeof a === 'object' ? Object.prototype.toString.call(a) : String(a))).join(' ').slice(0, 300) });
    } catch {}
  };
  for (const kind of ['warn', 'error', 'log']) {
    const original = console[kind].bind(console);
    console[kind] = (...args) => { record(kind, args); original(...args); };
  }
  window.addEventListener('error', (event) => record('window-error', [event.message]));
  window.addEventListener('unhandledrejection', (event) => record('rejection', [event.reason]));
  window.__resetLoadingGaps = () => {
    state.start = performance.now();
    state.last = performance.now();
    state.longest = 0;
    state.longestAt = 0;
    state.samples = 0;
    state.timeline.length = 0;
  };
})();`;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });

// PROFILE=1 records a CPU profile for the whole run and prints the hottest functions. This is
// how you find out *what* a stall was, rather than only how long it lasted.
const profiling = process.env.PROFILE === '1';
if (profiling) {
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 1000 });
  await send('Profiler.start');
}

await send('Page.navigate', { url });

// The document is replaced by the navigation, so wait for the recorder from the *new* document.
for (let i = 0; i < 100; i++) {
  const alive = await evaluate('!!window.__loadingGaps').catch(() => false);
  if (alive) break;
  await sleep(50);
}

await evaluate(`window.__probePrefix = ${JSON.stringify(process.env.PROBE_PREFIX ?? 'loading')};
window.__uiProbeQueue = [];
window.__probeShotRequest = (name) => { window.__uiProbeQueue.push(name); return new Promise((r) => setTimeout(r, 400)); };
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
  const names = await evaluate('(() => { const q = window.__uiProbeQueue || []; window.__uiProbeQueue = []; return q; })()').catch(() => []);
  for (const name of names ?? []) {
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = resolve(shotDir, `${name}.png`);
    writeFileSync(file, Buffer.from(result.data, 'base64'));
    console.log('wrote', file);
    shotIndex++;
  }
}

const body = scriptFile ? readFileSync(resolve(root, scriptFile), 'utf8') : 'return await waitForTrack(120000);';
const runner = evaluate(`(async () => {
  const shot = window.__probeShotRequest;
  const q = window.__q, qa = window.__qa, clickText = window.__clickText;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gaps = () => ({
    longest: Math.round(window.__loadingGaps.longest),
    longestAt: Math.round(window.__loadingGaps.longestAt),
    samples: window.__loadingGaps.samples,
    sinceNavigation: Math.round(performance.now() - window.__loadingGaps.start),
    timeline: window.__loadingGaps.timeline.slice(0, 40),
    logs: (window.__loadingGaps.logs || []).slice(0, 60),
  });
  const resetGaps = () => window.__resetLoadingGaps();
  // window.__mkwViewport only exists in a development build, so a production preview is judged
  // by what the user sees: the renderer status pill says the track is up.
  const trackIsUp = () => {
    if (window.__mkwViewport) return window.__mkwViewport.listMeshes().length > 0;
    const pill = document.querySelector('.rendererStatus');
    return !!pill && /Sigma|refreshed/.test(pill.textContent || '');
  };
  const waitForTrack = async (timeoutMs = 120000) => {
    const until = performance.now() + timeoutMs;
    while (performance.now() < until) {
      if (trackIsUp()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };
  const mkw = () => window.__mkwViewport;
  window.__uiProbeResult = undefined;
  window.__uiProbeResult = await (async () => { ${body} })();
  window.__uiProbeDone = true;
  return true;
})()`);

let done = false;
runner.then(() => { done = true; }).catch((error) => { console.error(error); done = true; });
while (!done) {
  await drainShots();
  await sleep(80);
}
await drainShots();

if (profiling) {
  const { profile } = await send('Profiler.stop');
  const byNode = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map();
  const total = profile.samples.length;
  for (const id of profile.samples) {
    const node = byNode.get(id);
    if (!node) continue;
    const frame = node.callFrame;
    const key = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').slice(-1)[0]}:${frame.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + 1);
  }
  const span = profile.endTime - profile.startTime;
  console.log('--- hottest frames (self time) ---');
  for (const [key, count] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`${((count / total) * (span / 1000)).toFixed(0).padStart(6)} ms  ${key}`);
  }
}

const output = await evaluate('window.__uiProbeResult');
console.log('script result:', JSON.stringify(output, null, 2));
console.log(`${shotIndex} screenshot(s) written`);

finish(0);
