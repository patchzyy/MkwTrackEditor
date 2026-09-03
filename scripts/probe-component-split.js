// Probe body for scripts/camera-ui-probe.mjs: proves a component edit in Model mode moves only
// the component it targets, on screen and in the geometry.
//
//   node scripts/camera-ui-probe.mjs "http://127.0.0.1:5192/?track=/dev-tracks/Z0.szs" scripts/probe-component-split.js
//
// It picks a mesh under the cursor (so the thing it edits is definitely on screen), records every
// connected component's bounds, moves one of them a long way, and checks that (a) the render
// changed, (b) the moved component's bounds moved, and (c) every other component's bounds are
// exactly where they were. Then it undoes the move and checks everything is back.
const out = {};

const decode = async (dataUrl) => {
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
};

const diff = (a, b) => {
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (d > 12) changed++;
  }
  return changed / (a.data.length / 4);
};

const nonBlack = (pixels) => {
  let lit = 0;
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (pixels.data[i] > 8 || pixels.data[i + 1] > 8 || pixels.data[i + 2] > 8) lit++;
  }
  return lit / (pixels.data.length / 4);
};

const grab = async () => decode(await mkw.captureFrame());
const round = (v) => Math.round(v * 100) / 100;
const boundsKey = (b) => (b ? [b.min, b.max].map((p) => [round(p.x), round(p.y), round(p.z)].join(',')).join('|') + `#${b.triangleCount}` : 'none');

// Park the free camera on the track's opening shot so the geometry is actually in view.
clickText('Camera');
await sleep(1200);
qa('.cameraRow')[0]?.click();
await sleep(900);
out.framed = clickText('Look from camera', '.inspector button');
await sleep(1500);

clickText('Model');
await sleep(2500);
mkw.setMeshGranularity('component');
await sleep(300);

/**
 * An out-of-range component index falls back to the whole shape, so the component count is how
 * many consecutive indices report fewer triangles than the shape as a whole.
 */
const componentCountOf = (base) => {
  const whole = mkw.getMeshBounds({ ...base, componentIndex: 1000000 });
  if (!whole) return 0;
  let count = 0;
  while (count < 200) {
    const bounds = mkw.getMeshBounds({ ...base, componentIndex: count });
    if (!bounds || bounds.triangleCount >= whole.triangleCount) break;
    count++;
  }
  return count;
};

// Pick meshes under a grid of on-screen points, so whatever we edit is visible.
const canvas = document.querySelector('canvas');
const rect = canvas.getBoundingClientRect();
let chosen = null;
const tried = [];
for (const fx of [0.5, 0.35, 0.65, 0.5, 0.4, 0.6]) {
  for (const fy of [0.55, 0.65, 0.45, 0.75, 0.5, 0.6]) {
    const picked = mkw.pickMeshAt(rect.left + rect.width * fx, rect.top + rect.height * fy);
    if (!picked) continue;
    const base = {
      archivePath: picked.archivePath,
      modelName: picked.modelName,
      shapeIndex: picked.shapeIndex,
      drawOpIndex: picked.drawOpIndex,
      nodeId: picked.nodeId,
      granularity: 'component',
      componentIndex: picked.componentIndex ?? 0,
    };
    const count = componentCountOf(base);
    tried.push({ shape: picked.shapeName, count, componentIndex: picked.componentIndex });
    if (count >= 3 && count <= 120 && picked.componentIndex !== null && picked.componentIndex < count) {
      chosen = { base, count, name: picked.shapeName ?? picked.materialName ?? '?', moved: picked.componentIndex };
      break;
    }
  }
  if (chosen) break;
}
out.tried = tried.slice(0, 10);
if (!chosen) return { ...out, error: 'no visible multi-component mesh found' };

out.shape = chosen.name;
out.componentCount = chosen.count;
out.movedComponent = chosen.moved;

const targetFor = (index) => ({ ...chosen.base, componentIndex: index });
const before = [];
for (let i = 0; i < chosen.count; i++) before.push(boundsKey(mkw.getMeshBounds(targetFor(i))));
out.componentsMeasured = before.length;
out.distinctBefore = new Set(before).size;

const beforeFrame = await grab();
out.beforeNonBlack = round(nonBlack(beforeFrame));
await shot('component-split-00-before');
await sleep(200);

// Move and rotate one component a long way.
mkw.transformMesh(targetFor(chosen.moved), {
  translation: { x: 4000, y: 3500, z: -2000 },
  rotation: { x: 0, y: 35, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
});
await sleep(1600);

const afterFrame = await grab();
out.afterNonBlack = round(nonBlack(afterFrame));
out.pixelChangedFraction = round(diff(beforeFrame, afterFrame));
await shot('component-split-01-after');
await sleep(200);

const after = [];
for (let i = 0; i < chosen.count; i++) after.push(boundsKey(mkw.getMeshBounds(targetFor(i))));

out.movedComponentChanged = before[chosen.moved] !== after[chosen.moved];
const disturbed = [];
for (let i = 0; i < chosen.count; i++) {
  if (i === chosen.moved) continue;
  if (before[i] !== after[i]) disturbed.push({ component: i, before: before[i], after: after[i] });
}
out.neighboursDisturbed = disturbed.length;
out.disturbedExamples = disturbed.slice(0, 4);

// Undo: everything must be exactly back where it started.
mkw.transformMesh(targetFor(chosen.moved), null);
await sleep(1400);
const restored = [];
for (let i = 0; i < chosen.count; i++) restored.push(boundsKey(mkw.getMeshBounds(targetFor(i))));
out.restoredExactly = restored.every((key, i) => key === before[i]);
await shot('component-split-02-restored');
await sleep(200);

out.pass = out.movedComponentChanged
  && out.neighboursDisturbed === 0
  && out.pixelChangedFraction > 0.0005
  && out.restoredExactly
  && out.afterNonBlack > 0.2;
return out;
