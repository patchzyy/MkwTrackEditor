#!/usr/bin/env node
/**
 * Renders the kit's theme cards (and a swatch gallery for checking) in the real editor viewport.
 *
 * For every theme it builds a tiny course: the donor course's sky, lighting and fog (its
 * `vrcorn_model.brres` + `posteffect/*`) around a hand-made scene put together from that theme's
 * own surfaces (ground, shoulder, curbs, road, wall, fence, water, ...), using the same
 * `buildModelBrres` writer the Create compiler uses. A KMP camera is injected so the viewport's
 * dev hook `previewCamera` can pose the view exactly. The result is a real render of what a
 * Create track in that theme looks like.
 *
 *   # terminal 1: npx vite --host 127.0.0.1 --port 5252 --strictPort
 *   # terminal 2: node scripts/create-kit-previews.mjs            (all themes -> previews/*.png)
 *               node scripts/create-kit-previews.mjs sunny snow   (some themes)
 *               node scripts/create-kit-previews.mjs --gallery    (every surface on a grid -> .scratch/gallery-*.png)
 *
 * Env: PREVIEW_PORT (dev server, default 5252), PROBE_PORT (Edge debugging port, default 9452),
 *      EDGE_PATH. Needs a real GPU window: headless Edge cannot run noclip on this host.
 * Run `npm run build:create-kit` first (the scene uses the built kit), and again afterwards to pack
 * the new previews.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, startVite, readSzs, retailDir, encodePng, decodePng, resizeImage, cropImage } from './create-kit-lib.mjs';
import { THEMES } from './create-kit-spec.mjs';

const OUT_DIR = join(ROOT, 'public/data/MarioKartWii/Create');
const DEV_DIR = join(ROOT, 'public/dev-tracks');
const SCRATCH = join(ROOT, '.scratch');
const devPort = Number(process.env.PREVIEW_PORT ?? 5252);
const debugPort = Number(process.env.PROBE_PORT ?? 9452);
const edge = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const args = process.argv.slice(2);
const galleryMode = args.includes('--gallery');
const wanted = args.filter((a) => !a.startsWith('--'));
const idsArg = args.find((a) => a.startsWith('--ids='))?.slice(6).split(',') ?? null;
const heightArg = Number(args.find((a) => a.startsWith("--height="))?.slice(9) ?? 16500);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------------ geometry

function quad(name, surfaceId, [x0, y0, z0], [x1, y1, z1], up, world, flip = false) {
  // `up`: 'y' horizontal (faces +Y), 'x' wall in the YZ plane (faces +X), 'z' wall in the XY plane (faces +Z)
  let p, uv;
  const [wu, wv] = world;
  if (up === 'y') {
    p = [[x0, y0, z0], [x0, y0, z1], [x1, y0, z0], [x1, y0, z1]];
    uv = p.map(([x, , z]) => [z / wu, x / wv]);
  } else if (up === 'x') {
    p = [[x0, y0, z0], [x0, y1, z0], [x0, y0, z1], [x0, y1, z1]];
    uv = p.map(([, y, z]) => [z / wu, y / wv]);
  } else {
    p = [[x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0]];
    uv = p.map(([x, y]) => [x / wu, y / wv]);
  }
  // natural counter-clockwise order, normal = (b - a) x (c - a); `flip` shows the other side
  const sign = flip ? -1 : 1;
  const normal = (up === 'y' ? [0, 1, 0] : up === 'x' ? [1, 0, 0] : [0, 0, 1]).map((v) => v * sign);
  let indices = [0, 1, 2, 1, 3, 2];
  if (flip) indices = indices.slice().reverse();
  return {
    name, surfaceId,
    positions: new Float32Array(p.flat()),
    normals: new Float32Array(p.flatMap(() => normal)),
    uvs: new Float32Array(uv.flat()),
    colors: new Uint8Array(16).fill(255),
    indices: new Uint32Array(indices),
    chunk: 'preview',
  };
}

function themeObjects(kit, themeId) {
  const own = kit.catalog.scenery.filter((e) => e.themeIds.includes(themeId) && e.themeIds.length < kit.catalog.themes.length).slice(0, themeId === 'space' ? 4 : 9);
  const spots = [[5600, 2500], [6300, 6500], [5800, 10000], [-5400, 3500], [-5900, 7500], [-5300, 11500], [5200, 38000], [-5200, 41000], [9000, 4000]];
  return own.map((e, i) => ({ id: e.objectId, scale: e.scale, position: { x: spots[i][0], y: 0, z: spots[i][1] }, yaw: i * 40 }));
}

/** The theme scene: road along +Z, ground, shoulders, curbs, walls, fence, a pond and a boost pad. */
function themeScene(kit, theme) {
  const S = (slot) => kit.surface(theme.slots[slot]);
  const w = (slot) => S(slot).textureWorldSize;
  const meshes = [];
  const add = (slot, mesh) => meshes.push({ ...mesh, surfaceId: S(slot).id });
  const L = 60000;
  const roadW = 3600, curbW = 220, shoulderW = 1500;
  if (theme.terrain) {
    add('ground', quad('ground', '', [-90000, -40, -20000], [90000, -40, L + 40000], 'y', w('ground')));
    add('groundAlt', quad('groundAlt', '', [-16000, -30, 9000], [-5200, -30, 30000], 'y', w('groundAlt')));
    add('water', quad('water', '', [7000, -20, 12000], [26000, -20, 34000], 'y', w('water')));
    add('mud', quad('mud', '', [-5200, -25, -6000], [-3300, -25, 2000], 'y', w('mud')));
  }
  add('road', quad('road', '', [-roadW / 2, 0, -8000], [roadW / 2, 0, L], 'y', w('road')));
  add('curb', quad('curbL', '', [-roadW / 2 - curbW, 2, -8000], [-roadW / 2, 2, L], 'y', w('curb')));
  add('curb', quad('curbR', '', [roadW / 2, 2, -8000], [roadW / 2 + curbW, 2, L], 'y', w('curb')));
  if (theme.terrain) {
    add('shoulder', quad('shoulderL', '', [-roadW / 2 - curbW - shoulderW, 1, -8000], [-roadW / 2 - curbW, 1, L], 'y', w('shoulder')));
    add('shoulder', quad('shoulderR', '', [roadW / 2 + curbW, 1, -8000], [roadW / 2 + curbW + shoulderW, 1, L], 'y', w('shoulder')));
    // walls: left side a cliff face + barrier near the camera, right side a fence
    add('cliff', quad('cliff', '', [-6200, -40, 14000], [-6200, 2400, 50000], 'x', w('cliff')));
    add('wall', quad('wall', '', [-4300, 0, 14000], [-4300, 520, 36000], 'x', w('wall')));
    add('barrier', quad('barrier', '', [-4300, 0, -8000], [-4300, 200, 14000], 'x', w('barrier')));
    add('fence', quad('fence', '', [4300, 0, 6000], [4300, 420, 30000], 'x', w('fence'), true));
    add('sand', quad('sand', '', [3000, -10, -8000], [5200, -10, 4000], 'y', w('sand')));
    add('lava', quad('lava', '', [-26000, -25, 42000], [-9000, -25, 56000], 'y', w('lava')));
  } else {
    add('underside', quad('underside', '', [-roadW / 2, -90, -8000], [roadW / 2, -90, L], 'y', w('underside'), true));
    add('fence', quad('fenceL', '', [-roadW / 2 - curbW, 0, 4000], [-roadW / 2 - curbW, 330, L], 'x', w('fence')));
    add('fence', quad('fenceR', '', [roadW / 2 + curbW, 0, 4000], [roadW / 2 + curbW, 330, L], 'x', w('fence'), true));
  }
  add('roadAlt', quad('roadAlt', '', [-roadW / 2, 3, 20000], [roadW / 2, 3, 26000], 'y', w('roadAlt')));
  add('startLine', quad('start', '', [-roadW / 2, 4, 2400], [roadW / 2, 4, 3000], 'y', w('startLine')));
  {
    // decal: u across the panel, v 1 at its rear edge -> 0 at the front edge
    const b = quad('boost', '', [-600, 5, 9000], [600, 5, 9700], 'y', [1, 1]);
    const [along, across] = S('boost').textureWorldSize;
    const pos = b.positions;
    for (let i = 0; i < 4; i++) { b.uvs[i * 2] = pos[i * 3] / across; b.uvs[i * 2 + 1] = (9700 - pos[i * 3 + 2]) / along; }
    add('boost', b);
  }
  return meshes;
}

function galleryScene(kit) {
  const meshes = [];
  const cols = idsArg ? Math.min(idsArg.length, 3) : 9, size = 2000, gap = 2400;
  const list = idsArg ? idsArg.map((id) => kit.surface(id)) : kit.catalog.surfaces;
  list.forEach((surface, i) => {
    const cx = (i % cols) * gap, cz = Math.floor(i / cols) * gap;
    meshes.push(quad(`g${i}`, surface.id, [cx, 0, cz], [cx + size, 0, cz + size], 'y', surface.textureWorldSize));
  });
  // A neutral floor so the sky dome's bright underside (and the bloom it causes) does not wash the swatches out.
  const floorId = kit.surface('asphalt.dark') ? 'asphalt.dark' : kit.catalog.surfaces[0].id;
  const floor = quad('floor', floorId, [-60000, -60, -60000], [90000, -60, 90000], 'y', [6000, 6000]);
  return { meshes, floor, cols, rows: Math.ceil(list.length / cols), gap };
}

// ------------------------------------------------------------------------------------ tracks

function materialsFor(kit, meshes) {
  const seen = new Map();
  for (const mesh of meshes) {
    if (seen.has(mesh.surfaceId)) continue;
    const s = kit.surface(mesh.surfaceId);
    seen.set(mesh.surfaceId, { surfaceId: s.id, brres: kit.file(s.swatch), modelName: s.modelName, materialName: s.materialName, translucent: s.translucent });
  }
  return [...seen.values()];
}

async function writeTrack(mods, buildModelBrres, donorTrack, meshes, kit, camera, outName, themeId = null, objects = []) {
  const raw = new Uint8Array(readFileSync(`${retailDir()}/${donorTrack}.szs`));
  const { entries, layout } = mods.u8.parseU8WithLayout(mods.yaz0.decodeYaz0(raw));
  const norm = (p) => p.replace(/^\.?\/+/, '');
  const brres = meshes ? buildModelBrres({ modelName: 'course', meshes, materials: materialsFor(kit, meshes), copyAnimations: true }) : null;
  const kmp = mods.kmpFile.readKmpFile(entries.find((e) => norm(e.path) === 'course.kmp').data);
  if (meshes) {
    kmp.objects = objects.map((o) => ({ objectId: o.id, extendedPresence: 0, position: o.position, rotation: { x: 0, y: o.yaw ?? 0, z: 0 }, scale: { x: o.scale ?? 1, y: o.scale ?? 1, z: o.scale ?? 1 }, routeIndex: 0xffff, settings: [0, 0, 0, 0, 0, 0, 0, 0], presenceFlags: 0x3f }));
    kmp.areas = [];
    for (const p of kmp.startPoints) p.position = { ...p.position, y: -200000 }; // no grid-kart dummies in the shot
  } else {
    // retail reference shot: start grid, looking down the first enemy-route segment
    const s0 = kmp.startPoints[0].position, e = kmp.enemyPoints;
    let dx = e[2].position.x - e[0].position.x, dz = e[2].position.z - e[0].position.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    camera = { position: { x: s0.x - dx * 2600, y: s0.y + 900, z: s0.z - dz * 2600 }, target: { x: s0.x + dx * 4000, y: s0.y + 500, z: s0.z + dz * 4000 }, fov: 62 };
  }
  kmp.cameras.push({
    type: 4, nextIndex: 0xff, shake: 0, routeIndex: 0xff, pointVelocity: 0, zoomVelocity: 0, viewVelocity: 0, start: 0, movie: 0,
    position: camera.position, rotation: { x: 0, y: 0, z: 0 }, zoomStart: camera.fov, zoomEnd: camera.fov,
    viewStart: camera.target, viewEnd: camera.target, time: 600,
  });
  const cameraIndex = kmp.cameras.length - 1;
  const out = entries
    .filter((e) => !meshes || e.type !== 'file' || (norm(e.path) !== 'course_model.brres'))
    .map((e) => (norm(e.path) === 'course.kmp' ? { ...e, data: mods.kmpFile.writeKmpFile(kmp) } : e));
  if (brres) out.push({ path: 'course_model.brres', type: 'file', data: brres });
  // the theme's own files (sky, post effects with the normalised fog) replace the donor's
  const theme = themeId ? kit.theme(themeId) : null;
  if (theme) {
    for (const [archivePath, kitPath] of Object.entries(theme.files)) {
      const data = kit.file(kitPath);
      const at = out.findIndex((e) => norm(e.path) === archivePath);
      if (at >= 0) out[at] = { ...out[at], data };
      else out.push({ path: archivePath, type: 'file', data });
    }
  }
  const u8 = mods.u8.buildU8(out);
  mkdirSync(DEV_DIR, { recursive: true });
  writeFileSync(join(DEV_DIR, `${outName}.szs`), mods.yaz0.encodeYaz0(u8, { searchDepth: 8 }));
  void layout;
  return cameraIndex;
}

// ------------------------------------------------------------------------------------ browser

async function launchBrowser() {
  const child = spawn(edge, [
    `--remote-debugging-port=${debugPort}`,
    '--window-size=1920,1080',
    '--window-position=-2400,-2400',
    `--user-data-dir=${resolve(ROOT, '.probe-profile/kit-previews')}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    'about:blank',
  ], { stdio: 'ignore' });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = list.find((t) => t.type === 'page') ?? null;
    } catch { /* starting */ }
    if (!page) await sleep(300);
  }
  if (!page) throw new Error('Could not reach the browser debugger');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const m = JSON.parse(event.data);
    if (!m.id || !pending.has(m.id)) return;
    const { resolve: done, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(JSON.stringify(m.error)));
    else done(m.result);
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception ?? r.exceptionDetails));
    return r.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  return { child, ws, send, evaluate, close: () => { ws.close(); child.kill(); } };
}

async function openTrack(browser, trackName) {
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${devPort}/?track=/dev-tracks/${trackName}.szs&t=${Date.now()}` });
  await sleep(2500);
  const ready = await browser.evaluate(`(async () => {
    for (let i = 0; i < 160; i++) {
      if (window.__mkwViewport && window.__mkwViewport.listMeshes().length > 0) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  })()`);
  if (!ready) {
    const shot = await browser.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SCRATCH, 'preview-failure.png'), Buffer.from(shot.data, 'base64'));
    throw new Error(`${trackName}: the viewport never finished loading (see .scratch/preview-failure.png)`);
  }
}

async function shoot(browser, cameraIndex, { aspect = 16 / 9 } = {}) {
  const before = await browser.evaluate('JSON.stringify(window.__mkwViewport.getCameraMatrix().slice(12, 15))');
  await browser.evaluate(`window.__mkwViewport.previewCamera(${cameraIndex}, { time: 0, play: false })`);
  if (process.env.KIT_NOCAM) await browser.evaluate('window.__mkwViewport.stopCameraPreview()');
  await sleep(1800);
  const after = await browser.evaluate('JSON.stringify(window.__mkwViewport.getCameraMatrix().slice(12, 15))');
  if (process.env.KIT_VERBOSE) console.log('camera', before, '->', after);
  const url = await browser.evaluate('window.__mkwViewport.captureFrame()');
  if (!url) throw new Error('captureFrame returned nothing');
  const img = decodePng(new Uint8Array(Buffer.from(url.split(',')[1], 'base64')));
  const w = Math.min(img.width, Math.round(img.height * aspect));
  const h = Math.round(w / aspect);
  return cropImage(img, [Math.floor((img.width - w) / 2), Math.floor((img.height - h) / 2), w, h]);
}

// ------------------------------------------------------------------------------------ main

async function main() {
  const mods = await startVite();
  let browser = null;
  try {
    const writer = await mods.server.ssrLoadModule('/src/lib/create/writers/modelWriter.ts');
    const loader = await mods.server.ssrLoadModule('/src/lib/create/kit/loadKit.ts');
    const kit = loader.createKitFromArchive(new Uint8Array(readFileSync(join(OUT_DIR, 'create-kit.szs'))));
    browser = await launchBrowser();

    const uvTest = args.find((a) => a.startsWith('--uvtest='))?.slice(9);
    if (uvTest) {
      // four uv conventions side by side; camera behind the quads looking along +Z (screen up = +Z, screen right = -X)
      const surf = kit.surface(uvTest);
      const [wu, wv] = process.env.KIT_DECAL ? [2000, 2000] : surf.textureWorldSize;
      const variants = [(x, z) => [z / wu, x / wv], (x, z) => [x / wv, z / wu], (x, z) => [x / wv, -z / wu], (x, z) => [-z / wu, x / wv]];
      const meshes = variants.map((f, i) => {
        const x0 = -9600 + i * 2600, z0 = 0, x1 = x0 + 2000, z1 = 2000;
        const p = [[x0, 0, z0], [x0, 0, z1], [x1, 0, z0], [x1, 0, z1]];
        return { name: `v${i}`, surfaceId: surf.id, positions: new Float32Array(p.flat()), normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), uvs: new Float32Array(p.flatMap(([x, , z]) => f(x, z))), colors: new Uint8Array(16).fill(255), indices: new Uint32Array([0, 1, 2, 1, 3, 2]), chunk: 'x' };
      });
      const floor = quad('floor', 'x', [-60000, -60, -60000], [90000, -60, 90000], 'y', [6000, 6000]);
      floor.surfaceId = kit.surface('asphalt.dark').id;
      const idx = await writeTrack(mods, writer.buildModelBrres, 'beginner_course', [floor, ...meshes], kit, { position: { x: -4800, y: 4200, z: -3000 }, target: { x: -4800, y: 0, z: 1000 }, fov: 55 }, 'kitgallery-0');
      await openTrack(browser, 'kitgallery-0');
      const img = await shoot(browser, idx);
      writeFileSync(join(SCRATCH, 'uvtest.png'), encodePng(img.width, img.height, img.rgba));
      return;
    }
    const objectsArg = args.find((a) => a.startsWith('--objects='))?.slice(10);
    if (objectsArg) {
      const ids = objectsArg.split(',').map((v) => parseInt(v, 16));
      const per = 12, cols = 4, gap = 4200;
      for (let first = 0, shotNo = 0; first < ids.length; first += per, shotNo++) {
        const group = ids.slice(first, first + per);
        const objs = group.map((id, i) => ({ id, position: { x: -((i % cols) - 1.5) * gap, y: 0, z: Math.floor(i / cols) * gap } }));
        const floor = quad('floor', 'x', [-60000, -60, -60000], [90000, -60, 90000], 'y', [6000, 6000]);
        floor.surfaceId = kit.surface('grass.bright').id;
        const idx = await writeTrack(mods, writer.buildModelBrres, 'beginner_course', [floor], kit, { position: { x: 0, y: 7800, z: -4800 }, target: { x: 0, y: 0, z: 3600 }, fov: 58 }, 'kitgallery-0', null, objs);
        await openTrack(browser, 'kitgallery-0');
        await sleep(4000);
        const img = await shoot(browser, idx);
        writeFileSync(join(SCRATCH, `objects-${shotNo}.png`), encodePng(img.width, img.height, img.rgba));
        console.log(`objects-${shotNo}.png: ` + group.map((id) => id.toString(16)).join(' '));
      }
      return;
    }
    if (galleryMode) {
      const g = galleryScene(kit);
      const donor = 'beginner_course';
      const cx = ((g.cols - 1) * g.gap + 2000) / 2;
      const rowsPerShot = idsArg ? 3 : 2;
      for (let first = 0, shotNo = 0; first < g.rows; first += rowsPerShot, shotNo++) {
        const rows = Math.min(rowsPerShot, g.rows - first);
        const cz = first * g.gap + ((rows - 1) * g.gap + 2000) / 2;
        const meshes = g.meshes.filter((m) => { const i = Number(m.name.slice(1)); const r = Math.floor(i / g.cols); return r >= first && r < first + rows; });
        const height = heightArg;
        const idx = await writeTrack(mods, writer.buildModelBrres, donor, [g.floor, ...meshes], kit, {
          position: { x: cx, y: height, z: cz - 5200 }, target: { x: cx, y: 0, z: cz }, fov: 55,
        }, `kitgallery-${shotNo}`);
        await openTrack(browser, `kitgallery-${shotNo}`);
        const img = await shoot(browser, idx);
        mkdirSync(SCRATCH, { recursive: true });
        writeFileSync(join(SCRATCH, `gallery-${shotNo}.png`), encodePng(img.width, img.height, img.rgba));
        console.log(`gallery-${shotNo}.png (${img.width}x${img.height}), surfaces ${meshes.map((m) => kit.surface(m.surfaceId).id).join(', ')}`);
      }
      return;
    }

    const retail = args.find((a) => a.startsWith('--retail='))?.slice(9);
    if (retail) {
      const idx = await writeTrack(mods, writer.buildModelBrres, retail, null, kit, null, `kitprev-sunny`);
      await openTrack(browser, 'kitprev-sunny');
      const img = await shoot(browser, idx);
      writeFileSync(join(SCRATCH, `retail-${retail}.png`), encodePng(img.width, img.height, img.rgba));
      return;
    }
    mkdirSync(join(OUT_DIR, 'previews'), { recursive: true });
    for (const theme of THEMES.filter((t) => wanted.length === 0 || wanted.includes(t.id))) {
      const kitTheme = kit.theme(theme.id);
      const meshes = themeScene(kit, kitTheme);
      const baseY = kitTheme.baseHeight ?? 0;
      for (const m of meshes) for (let i = 1; i < m.positions.length; i += 3) m.positions[i] += baseY;
      const cam = {};
      // per-theme framing tweaks: how far the aim point is raised above the road (more sky)
      const lift = { beach: 900, castle: 500, space: 0 }[theme.id] ?? 0;
      const idx = await writeTrack(mods, writer.buildModelBrres, theme.donorTrack, meshes, kit, {
        position: cam.position ?? { x: -900, y: baseY + 1050, z: -3600 },
        target: cam.target ?? { x: 700, y: baseY + 520 + lift, z: 12000 },
        fov: cam.fov ?? 62,
      }, `kitprev-${theme.id}`, theme.id, themeObjects(kit, theme.id).map((o) => ({ ...o, position: { ...o.position, y: o.position.y + baseY } })));
      await openTrack(browser, `kitprev-${theme.id}`);
      const img = await shoot(browser, idx);
      writeFileSync(join(SCRATCH, `prev-${theme.id}-full.png`), encodePng(img.width, img.height, img.rgba));
      const small = resizeImage(img, 320, 180);
      writeFileSync(join(OUT_DIR, 'previews', `${theme.id}.png`), encodePng(320, 180, small.rgba));
      console.log(`previews/${theme.id}.png`);
    }
  } finally {
    browser?.close();
    await mods.server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
