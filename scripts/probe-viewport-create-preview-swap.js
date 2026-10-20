// Probe body for scripts/ui-shell-probe.mjs: swaps a ~2 MB preview chunk every 100 ms for 5 s and reports load time, frame time and live GPU object counts before/after (no leak), then removal.
//   PROBE_PORT=9453 node scripts/ui-shell-probe.mjs 'http://127.0.0.1:5253/scripts/viewport-harness.html?track=/dev-tracks/Z0.szs' scripts/probe-viewport-create-preview-swap.js
const kitMod = await import('/src/lib/create/kit/loadKit.ts');
const writerMod = await import('/src/lib/create/writers/index.ts');
const kit = await kitMod.loadCreateKit();
const surf = kit.catalog.surfaces.find((s) => s.id === 'grass.sunny') ?? kit.catalog.surfaces[0];
const apiRef = { current: null };
const base = (extra = {}) => ({ hideCourseModel: true, models: [], overlay: { points: [], lines: [], triangles: [], labels: [] }, groundPlaneY: 0, showRaceLines: false, cameraApiRef: apiRef, ...extra });
mkw.create.inject(base());
await sleep(800);
const N = 100; // grid cells per side
function terrain(seed, zo = 0) {
  const P = [], Nn = [], U = [], C = [], I = [];
  for (let z = 0; z <= N; z++) for (let x = 0; x <= N; x++) {
    const h = Math.sin((x + seed) * 0.08) * 120 + Math.cos((z - seed) * 0.06) * 150;
    P.push(x * 40, h, z * 40 + zo); Nn.push(0, 1, 0); U.push(x * 0.1, z * 0.1); C.push(255, 255, 255, 255);
  }
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const a = z * (N + 1) + x, b = a + 1, c = a + N + 1, d = c + 1;
    I.push(a, c, b, b, c, d);
  }
  return { name: 'terrain' + zo, surfaceId: surf.id, positions: new Float32Array(P), normals: new Float32Array(Nn), uvs: new Float32Array(U), colors: new Uint8Array(C), indices: new Uint32Array(I) };
}
const mat = { surfaceId: surf.id, brres: kit.file(surf.swatch), modelName: surf.modelName, materialName: surf.materialName, translucent: surf.translucent };
const t0 = performance.now();
const variants = [];
for (let i = 0; i < 4; i++) {
  const modelName = `preview-terrain-${i}`;
  variants.push({ key: 'terrain', revision: i + 1, modelName, brres: writerMod.buildModelBrres({ modelName, meshes: [terrain(i * 7, 0), terrain(i * 7, 4100), terrain(i * 7, 8200)], materials: [mat], copyAnimations: true }) });
}
const buildMs = (performance.now() - t0) / 4;
const bytes = variants[0].brres.byteLength;
mkw.create.inject(base({ models: [variants[0]] }));
apiRef.current.frameBounds({ x: 0, y: -200, z: 0 }, { x: N * 40, y: 400, z: 12400 });
await sleep(1500);

// Frame-time sampler.
const frames = [];
let last = performance.now(); let run = true;
const tickf = () => { const n = performance.now(); frames.push(n - last); last = n; if (run) requestAnimationFrame(tickf); };
requestAnimationFrame(tickf);
await sleep(600);
const baselineFrames = frames.slice(); frames.length = 0;
const before = mkw.create.gpuStats();
const timingsBefore = mkw.create.previewTimings().length;

// Swap one 2 MB chunk every 100 ms for 5 s.
const t = performance.now();
let rev = 10, swaps = 0;
while (performance.now() - t < 5000) {
  const v = variants[swaps % 4];
  rev++;
  mkw.create.inject(base({ models: [{ ...v, revision: rev, modelName: `preview-terrain-r${rev}` }] }));
  swaps++;
  await sleep(100);
}
await sleep(500);
run = false;
const after = mkw.create.gpuStats();
const timings = mkw.create.previewTimings().slice(timingsBefore);
const chunks = mkw.create.previewModels();
const sorted = frames.slice().sort((a, b) => a - b);
const stat = (arr) => { const s = arr.slice().sort((a, b) => a - b); return { n: s.length, median: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] }; };
await shot('create-d-7-leak-terrain'); await sleep(600);
const rafWait = (ms) => new Promise((r) => { const t0 = performance.now(); const f = () => (performance.now() - t0 < ms ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); });
apiRef.current.setTopView(true); await rafWait(1200); await shot('create-d-7b-leak-terrain-top'); await sleep(600);
apiRef.current.setTopView(false); await rafWait(1200);
// remove all: counts should fall back near the no-chunk baseline.
mkw.create.inject(base({ models: [] }));
await sleep(800);
const removed = mkw.create.gpuStats();
return { bytes, buildMsPerChunk: buildMs, swaps, baselineFrames: stat(baselineFrames), swapFrames: stat(frames), loadMs: stat(timings.map((x) => x.ms)), loadFirst: timings.slice(0, 3), before, after, removed, chunks };
