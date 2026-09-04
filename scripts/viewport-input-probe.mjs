// Dev-only harness that drives the viewport with *real* browser mouse input.
//
//   PROBE_PORT=9431 node scripts/viewport-input-probe.mjs <url> scripts/probe-viewport-*.js
//
// The other probe harnesses synthesise `PointerEvent`s from inside the page. That is fine for
// checking wiring, but it cannot reproduce the bugs this harness exists for: pointer capture,
// pointer lock, the compatibility `mousedown` that follows `pointerdown`, and what happens when
// the cursor leaves the canvas or the window. Those only behave correctly when the events come
// from the browser itself, so everything here goes through CDP `Input.dispatchMouseEvent`.
//
// Unlike the page-script harnesses, the probe body runs in **Node**. It gets:
//
//   evaluate(expression)        -> run an expression in the page, returns by value
//   mouse.move(x, y, opts)      -> real mousemove (opts.buttons: 'left' | 'right' | 'none')
//   mouse.down(x, y, opts)      -> real mousedown (opts.button: 'left' | 'right')
//   mouse.up(x, y, opts)        -> real mouseup
//   mouse.drag(from, to, opts)  -> down, N interpolated moves, up (opts.release: false keeps it down)
//   mouse.wheel(x, y, dy)
//   key(key, opts)              -> real keydown+keyup
//   blurWindow()                -> really moves OS focus to another tab and back
//   shot(name)                  -> docs/screenshots/<name>.png
//   sleep(ms), send(method, params), viewport {width, height}, log(...)
//
// Headless Edge cannot run noclip on this host, so a real window is parked off-screen.
// Never pass --disable-gpu.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = resolve(root, 'docs/screenshots');
mkdirSync(shotDir, { recursive: true });

const url = process.argv[2] ?? 'http://127.0.0.1:5231/?track=/dev-tracks/Z0.szs';
const scriptFile = process.argv[3];
const port = Number(process.env.PROBE_PORT ?? 9431);
const [width, height] = (process.env.PROBE_SIZE ?? '1600x1000').split('x').map(Number);
const edge = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const child = spawn(edge, [
  `--remote-debugging-port=${port}`,
  `--window-size=${width},${height}`,
  // Off-screen by default. Chromium refuses `requestPointerLock` for an off-screen window
  // ("WrongDocumentError"), so the pointer-lock probe asks for a visible one with PROBE_ONSCREEN=1.
  process.env.PROBE_ONSCREEN === '1' ? '--window-position=0,0' : '--window-position=-2400,-2400',
  // Per-port profile, so two probes can run at once without fighting over the profile lock.
  `--user-data-dir=${resolve(root, `.probe-profile/viewport-input-${port}`)}`,
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
  try { ws.close(); } catch {}
  try { child.kill(); } catch {}
  process.exit(code);
}

// --- real mouse input -------------------------------------------------------------------

const BUTTON_MASK = { none: 0, left: 1, right: 2, middle: 4 };
let heldButtons = 0;

async function dispatchMouse(type, x, y, { button = 'none', clickCount = 0, buttons } = {}) {
  await send('Input.dispatchMouseEvent', {
    type,
    x: Math.round(x),
    y: Math.round(y),
    button,
    buttons: buttons ?? heldButtons,
    clickCount,
    pointerType: 'mouse',
  });
}

const mouse = {
  async move(x, y, options = {}) {
    await dispatchMouse('mouseMoved', x, y, { button: options.button ?? 'none', ...options });
    if (options.settle !== false) await sleep(options.settle ?? 12);
  },
  async down(x, y, options = {}) {
    const button = options.button ?? 'left';
    // A real press is preceded by a move, exactly like a user's hand.
    await dispatchMouse('mouseMoved', x, y, { button: 'none' });
    heldButtons |= BUTTON_MASK[button];
    await dispatchMouse('mousePressed', x, y, { button, clickCount: 1 });
    await sleep(options.settle ?? 30);
  },
  async up(x, y, options = {}) {
    const button = options.button ?? 'left';
    heldButtons &= ~BUTTON_MASK[button];
    await dispatchMouse('mouseReleased', x, y, { button, clickCount: 1 });
    await sleep(options.settle ?? 30);
  },
  async click(x, y, options = {}) {
    await mouse.down(x, y, options);
    await mouse.up(x, y, options);
  },
  /** Press at `from`, walk to `to` in `steps` moves, then release (unless `release: false`). */
  async drag(from, to, options = {}) {
    const steps = options.steps ?? 10;
    const button = options.button ?? 'left';
    await mouse.down(from[0], from[1], { button });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await dispatchMouse('mouseMoved', from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, { button });
      await sleep(options.stepDelay ?? 24);
    }
    if (options.release === false) return;
    await mouse.up(to[0], to[1], { button });
  },
  async wheel(x, y, deltaY) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY, pointerType: 'mouse' });
    await sleep(40);
  },
  reset() {
    heldButtons = 0;
  },
};

async function key(keyName, options = {}) {
  const base = {
    key: keyName,
    code: options.code ?? keyName,
    windowsVirtualKeyCode: options.keyCode ?? 0,
    nativeVirtualKeyCode: options.keyCode ?? 0,
    modifiers: options.modifiers ?? 0,
    location: options.location ?? 0,
    isKeypad: (options.location ?? 0) === 3,
  };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await sleep(20);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(20);
}

/** Really takes OS focus away from the page (a second tab) and gives it back. */
async function blurWindow(holdMs = 400) {
  const created = await send('Target.createTarget', { url: 'about:blank' });
  await sleep(holdMs);
  await send('Target.activateTarget', { targetId: page.id });
  await sleep(200);
  await send('Target.closeTarget', { targetId: created.targetId });
  await sleep(200);
}

let shotIndex = 0;
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = resolve(shotDir, `${name}.png`);
  writeFileSync(file, Buffer.from(result.data, 'base64'));
  console.log('wrote', file);
  shotIndex++;
}

// --- boot -------------------------------------------------------------------------------

await send('Page.enable');
await send('Runtime.enable');
// Deliberately no `Emulation.setDeviceMetricsOverride`: an emulated viewport makes Chromium
// reject `requestPointerLock` with WrongDocumentError, and pointer lock is one of the things
// these probes exist to check. The window is sized with --window-size instead.
await send('Page.navigate', { url });
await sleep(3000);

const ready = await evaluate(`(async () => {
  for (let i = 0; i < 240; i++) {
    if (window.__mkwViewport && window.__mkwViewport.listMeshes().length > 0) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
})()`);
if (!ready) {
  console.error('Track never finished loading');
  finish(1);
}

// Small page-side helpers the probes lean on, mirroring the other harnesses.
await evaluate(`window.__q = (sel) => document.querySelector(sel);
window.__canvasRect = () => { const r = document.querySelector('.viewport canvas').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
window.__clickText = (text, sel = 'button') => {
  const node = [...document.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);
  if (node) node.click();
  return !!node;
};
true;`);

const pageSize = await evaluate('({ width: window.innerWidth, height: window.innerHeight })');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const body = scriptFile ? readFileSync(resolve(root, scriptFile), 'utf8') : 'return { ok: true };';
const run = new AsyncFunction('ctx', `const { evaluate, mouse, key, blurWindow, shot, sleep, send, viewport, log } = ctx;\n${body}`);

let output;
try {
  output = await run({ evaluate, mouse, key, blurWindow, shot, sleep, send, viewport: pageSize, log: console.log });
} catch (error) {
  console.error('probe threw:', error);
  finish(1);
}

console.log('script result:', JSON.stringify(output, null, 2));
console.log(`${shotIndex} screenshot(s) written`);
finish(0);
