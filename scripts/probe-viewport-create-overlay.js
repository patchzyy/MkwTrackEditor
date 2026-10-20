// Probe body for scripts/ui-shell-probe.mjs: overlay (dashed/closed lines, handles, rings, fills, labels), preview chunk, hover pick, framing and top view, with magnified crops.
//   PROBE_PORT=9453 node scripts/ui-shell-probe.mjs 'http://127.0.0.1:5253/scripts/viewport-harness.html?track=/dev-tracks/Z0.szs' scripts/probe-viewport-create-overlay.js
window.__errs = window.__errs || [];
if (!window.__errHooked) { window.__errHooked = true;
  window.addEventListener('error', (e) => window.__errs.push('E:' + e.message + ' @' + (e.filename||'') + ':' + e.lineno));
  window.addEventListener('unhandledrejection', (e) => window.__errs.push('R:' + String(e.reason && e.reason.stack || e.reason)));
  const ow = console.warn, oe = console.error;
  console.error = (...a) => { window.__errs.push('console.error:' + a.map((x) => (x && x.stack) || String(x)).join(' ').slice(0, 600)); oe(...a); };
  console.warn = (...a) => { window.__errs.push('console.warn:' + a.map((x) => (x && x.stack) || String(x)).join(' ').slice(0, 400)); ow(...a); };
}
const zoomShot = async (name, x, y, w, h, scale = 4) => {
  const url = await mkw.captureFrame();
  const img = new Image(); img.src = url; await img.decode();
  const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(img, x, y, w, h, 0, 0, w * scale, h * scale);
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#000';
  document.body.appendChild(c);
  await sleep(150);
  await shot(name); await sleep(700);
  c.remove();
};
// Create mode viewport probe: overlay + preview models + pointer events.
const kitMod = await import('/src/lib/create/kit/loadKit.ts');
const writerMod = await import('/src/lib/create/writers/index.ts');
const kit = await kitMod.loadCreateKit();
const surfaces = kit.catalog.surfaces;
const find = (cat) => surfaces.find((s) => s.category === cat) ?? surfaces[0];
const road = find('road');
const grass = find('grass') ?? surfaces[1];

const log = [];
const canvas = document.querySelector('canvas.noclipCanvas');
const rect = canvas.getBoundingClientRect();
const apiRef = { current: null };
const baseView = (extra = {}) => ({
  hideCourseModel: false,
  models: [],
  overlay: { points: [], lines: [], triangles: [], labels: [] },
  groundPlaneY: 0,
  showRaceLines: false,
  cameraApiRef: apiRef,
  onPointer: (e) => { log.push({ phase: e.phase, button: e.button, handle: e.handleId, hit: e.hit && [Math.round(e.hit.position.x), Math.round(e.hit.position.z)] }); return 'pass'; },
  ...extra,
});
mkw.create.inject(baseView());
await sleep(800);
const api = apiRef.current;

// Ground point under the middle of the canvas.
const mid = mkw.create.simulatePointer('hover', rect.width / 2, rect.height / 2);
const c = mid.event.hit.position;

function strip(name, surface, pts, width, y, uvScale) {
  const positions = [], normals = [], uvs = [], colors = [], indices = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
    const dx = q.x - o.x, dz = q.z - o.z, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;
    for (const side of [-1, 1]) {
      positions.push(p.x + nx * width * side, y, p.z + nz * width * side);
      normals.push(0, 1, 0);
      uvs.push(i * uvScale, side < 0 ? 0 : 1);
      colors.push(255, 255, 255, 255);
    }
    if (i > 0) {
      const b = (i - 1) * 2;
      // counter-clockwise seen from above (+Y): a, c, b ... keep the face normal up
      indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  return {
    name, surfaceId: surface.id,
    positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs),
    colors: new Uint8Array(colors), indices: new Uint32Array(indices),
  };
}
function arc(cx, cz, r, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); out.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r }); }
  return out;
}
const mat = (s) => ({ surfaceId: s.id, brres: kit.file(s.swatch), modelName: s.modelName, materialName: s.materialName, translucent: s.translucent });
function chunk(key, rev, rOffset) {
  const pts = arc(c.x, c.z, 2500 + rOffset, -Math.PI * 0.9, Math.PI * 0.9, 60);
  const meshes = [strip('road', road, pts, 400, c.y + 4, 0.002), strip('verge', grass, arc(c.x, c.z, 2500 + rOffset, -Math.PI * 0.9, Math.PI * 0.9, 60), 900, c.y + 1, 0.001)];
  const modelName = `preview-${key.replace(/[^a-z0-9]/gi, '-')}-${rev}`;
  const brres = writerMod.buildModelBrres({ modelName, meshes, materials: meshes.map((m) => mat(m.surfaceId === road.id ? road : grass)), copyAnimations: true });
  return { key, revision: rev, brres, modelName };
}
const t0 = performance.now();
const m1 = chunk('road:a', 1, 0);
const buildMs = performance.now() - t0;

// Overlay content.
const spline = arc(c.x, c.z, 2500, -Math.PI * 0.9, Math.PI * 0.9, 80).map((p) => ({ x: p.x, y: c.y + 12, z: p.z }));
const ctrl = [0, 20, 40, 60, 80].map((i, k) => ({ id: `p${k}`, position: spline[i], color: k === 2 ? [0.3, 0.6, 1, 1] : [1, 1, 1, 1], radius: k === 2 ? 11 : 9, pickable: true, ring: k === 2, label: k === 0 ? 'Start of road' : undefined }));
const loopPts = arc(c.x, c.z, 1200, 0, Math.PI * 2, 48).slice(0, 48).map((p) => ({ x: p.x, y: c.y + 12, z: p.z }));
const tri = [];
for (let i = 0; i < 48; i += 1) {
  const a = loopPts[i], b = loopPts[(i + 1) % 48];
  tri.push(c.x, c.y + 10, c.z, a.x, a.y, a.z, b.x, b.y, b.z);
}
const overlay = {
  points: ctrl,
  lines: [
    { points: spline, color: [1, 1, 1, 0.75], dashed: true },
    { points: loopPts, color: [0.7, 0.45, 1, 0.95], closed: true, dashed: true },
    { points: [spline[0], { x: c.x + 3000, y: c.y + 12, z: c.z - 1500 }], color: [1, 0.8, 0.2, 1] },
  ],
  triangles: [{ positions: new Float32Array(tri), color: [0.6, 0.35, 1, 0.18] }],
  labels: [{ position: { x: c.x, y: c.y + 12, z: c.z }, text: 'Brush: Sand' }],
};
document.querySelector('button[aria-label="Disable course fog"]').click();
mkw.create.inject(baseView({ hideCourseModel: true, models: [m1], overlay: { ...overlay, lines: [...overlay.lines, { points: [spline[10], spline[30]], color: [1, 0.2, 0.2, 1], onTop: false }] } }));
api.frameBounds({ x: c.x - 3400, y: c.y - 50, z: c.z - 3400 }, { x: c.x + 3400, y: c.y + 300, z: c.z + 3400 });
await sleep(1200);
await shot('create-d-1-persp'); await sleep(700);
await zoomShot('create-d-1-persp-zoom', 500, 300, 360, 200, 4);
const statsA = mkw.create.overlayStats();
const chunks = mkw.create.previewModels();

// Pick: project control point 2 and hover it.
const p2 = api.project(ctrl[2].position);
const pickRes = mkw.create.simulatePointer('hover', p2.x, p2.y);

// Top view.
api.frameBounds({ x: c.x - 3200, y: c.y, z: c.z - 3200 }, { x: c.x + 3200, y: c.y + 100, z: c.z + 3200 });
await sleep(700);
api.setTopView(true);
await sleep(700);
await shot('create-d-2-top'); await sleep(700);
await zoomShot('create-d-2-top-zoomA', 440, 250, 300, 170, 5);
await zoomShot('create-d-2-top-zoomB', 1000, 330, 280, 160, 5);
const topPose = api.getPose();
const isTop = api.isTopView();

const __r = { buildMs, bytes: m1.brres.byteLength, statsA, chunks, pickedHandle: pickRes.event.handleId, isTop, topPose, midHit: c, rect: { w: rect.width, h: rect.height }, log: log.slice(0, 5), surfaces: [road.id, grass.id] };

__r.errs = window.__errs.slice(-8); return __r;
