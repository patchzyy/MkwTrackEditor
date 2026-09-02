// Probe body for scripts/viewport-dev-probe.mjs: exercises Model mode.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rect = () => canvasRect();
const px = (fx, fy) => { const r = rect(); return [r.left + r.width * fx, r.top + r.height * fy]; };

[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Model')?.click();
await sleep(500);
mkw.setMode('model');
mkw.setMeshGranularity('component');

// Find the smallest pickable connected component with real geometry.
let best = null;
for (let i = 1; i < 10; i++)
  for (let j = 1; j < 8; j++) {
    const pick = mkw.pickMeshAt(...px(i / 10, j / 8));
    if (!pick) continue;
    const bounds = mkw.getMeshBounds(pick);
    if (!bounds || bounds.triangleCount < 8) continue;
    if (!best || bounds.radius < best.bounds.radius) best = { pick, bounds, fx: i / 10, fy: j / 8 };
  }
if (!best) return { error: 'nothing pickable' };

mkw.selectMeshAt(...px(best.fx, best.fy), false);
const selection = mkw.getSelectedMesh()[0];
mkw.frameMeshSelection();
await sleep(1400);
await shot('model-component-before');

mkw.transformMesh(selection.target, { translation: { x: 0, y: Math.max(400, best.bounds.radius * 1.5), z: 0 }, rotation: { x: 0, y: 30, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
await sleep(1000);
await shot('model-component-moved');
mkw.transformMesh(selection.target, null);
await sleep(500);

mkw.setMeshVisible(selection.target, false);
await sleep(1000);
await shot('model-component-hidden');
mkw.setMeshVisible(selection.target, true);
await sleep(500);

mkw.setMeshGranularity('shape');
await sleep(1000);
await shot('model-shape-widened');
const widened = mkw.getSelectedMesh()[0];

mkw.setMeshVisible(widened.target, false);
await sleep(1000);
await shot('model-shape-hidden');
mkw.setMeshVisible(widened.target, true);

return {
  component: {
    label: selection.label,
    componentIndex: selection.target.componentIndex,
    triangles: best.bounds.triangleCount,
    radius: Math.round(best.bounds.radius),
    components: mkw.getSelectedMesh().length,
  },
  shapeComponents: null,
  widened: { label: widened.label, granularity: widened.target.granularity },
  meshes: mkw.listMeshes().length,
};
