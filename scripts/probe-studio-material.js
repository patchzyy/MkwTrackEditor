// Probe body: clicking the model selects its material, editing it changes the picture, and the
// archive round-trips.
//
//   PROBE_PREFIX=studiomat PROBE_PORT=9437 node scripts/studio-probe.mjs \
//     "http://127.0.0.1:5233/" scripts/probe-studio-material.js
const out = {};

clickText('Model Studio');
const studio = await waitForStudio();
await sleep(2500);
studio.frameAll();
// A still model: an edit's effect on the pixels has to be the only thing that moved.
studio.setTransport({ playing: false, frame: 0 });
await sleep(600);

const canvas = q('.studioCanvas');
const rect = canvas.getBoundingClientRect();

/** A real left click at a point inside the canvas, as pointer events. */
function clickCanvas(fx, fy) {
  const clientX = rect.left + rect.width * fx;
  const clientY = rect.top + rect.height * fy;
  const base = { bubbles: true, cancelable: true, clientX, clientY, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true };
  canvas.dispatchEvent(new PointerEvent('pointerdown', base));
  canvas.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }));
  return { clientX: Math.round(clientX), clientY: Math.round(clientY) };
}

// --- 1. Click the model ------------------------------------------------------------------------
// Walk down the middle of the frame until something is hit, so the probe does not depend on the
// exact framing.
let clicked = null;
for (const fy of [0.45, 0.5, 0.4, 0.55, 0.6, 0.35, 0.65]) {
  clicked = clickCanvas(0.5, fy);
  await sleep(150);
  if (studio.selection()) {
    out.clickedAt = { ...clicked, fy };
    break;
  }
}
out.selectionFromClick = studio.selection();
out.statusAfterClick = studio.status();
out.meshesForSelection = (studio.meshes() ?? []).map((mesh) => `${mesh.modelName}/${mesh.shapeName}`);
await sleep(400);
await shot('studio-04-clicked-material');

if (!out.selectionFromClick) return { ...out, error: 'Clicking the model selected nothing' };

// --- 2. The inspector and the graph dock filled in ---------------------------------------------
out.inspectorName = q('.materialNameInput')?.value ?? null;
out.inspectorSections = qa('.materialInspector .uiPanelSectionHeader, .materialInspector .uiPanelSection > button').map((n) => n.textContent.trim());
qa('.uiTab').find((n) => n.textContent.includes('Stages'))?.click();
await sleep(700);
out.stageRows = qa('.materialStagesTable tbody tr').length;
await shot('studio-05-stages');
await sleep(500);
qa('.uiTab').find((n) => n.textContent.includes('Graph'))?.click();
await sleep(900);
out.graphNodes = qa('.graphNode').length;
out.graphNodeTitles = qa('.graphNodeTitle').map((n) => n.textContent.trim());
await shot('studio-06-graph');
await sleep(500);

// --- 3. Edit the material and watch the pixels move ---------------------------------------------
const before = await studio.samplePixels();
const doc = studio.materialDoc();
const archives = studio.archives();
const archiveTextures = (archives.find((a) => a.archivePath === out.selectionFromClick.archivePath)?.textureCount) ?? 0;
out.materialSummary = {
  name: doc.name,
  samplers: doc.samplers.map((s) => s.texture),
  stageCount: doc.tevStages.length,
  cullMode: doc.cullMode,
  archiveTextureCount: archiveTextures,
};

// A real authoring action: point layer 1 at another texture that is already in the archive.
const otherTexture = doc.samplers.map((s) => s.texture).find((name) => name !== doc.samplers[0].texture);
out.swappedTextureTo = otherTexture ?? null;
if (otherTexture) {
  studio.updateMaterial(
    { ...doc, samplers: doc.samplers.map((s, i) => (i === 0 ? { ...s, texture: otherTexture } : s)) },
    `Pointed the first layer at ${otherTexture}.`,
  );
  await sleep(1000);
}
const afterTexture = await studio.samplePixels();
out.pixelsBefore = before && { r: Math.round(before.r), g: Math.round(before.g), b: Math.round(before.b) };
out.pixelsAfterTextureSwap = afterTexture && { r: Math.round(afterTexture.r), g: Math.round(afterTexture.g), b: Math.round(afterTexture.b) };
out.textureSwapDelta =
  before && afterTexture
    ? Math.round((Math.abs(before.r - afterTexture.r) + Math.abs(before.g - afterTexture.g) + Math.abs(before.b - afterTexture.b)) * 100) / 100
    : null;
out.statusAfterEdit = studio.status();
await shot('studio-07-material-edited');
await sleep(500);

// And a second edit that must make the mesh disappear: cull everything.
const doc2 = studio.materialDoc();
studio.updateMaterial({ ...doc2, cullMode: 3 }, 'Set culling to draw nothing.');
await sleep(900);
const culled = await studio.samplePixels();
out.pixelsAfterCull = culled && { r: Math.round(culled.r), g: Math.round(culled.g), b: Math.round(culled.b) };
out.cullDelta =
  afterTexture && culled
    ? Math.round((Math.abs(afterTexture.r - culled.r) + Math.abs(afterTexture.g - culled.g) + Math.abs(afterTexture.b - culled.b)) * 100) / 100
    : null;
out.documentAfterEdit = studio.document();
out.historyAfterEdit = studio.history();

// --- 4. Export: untouched is byte-identical, edited is not ---------------------------------------
out.exportAfterEdit = studio.exportBytes();

// --- 5. Undo puts it back -----------------------------------------------------------------------
studio.undo();
await sleep(900);
studio.undo();
await sleep(900);
const undone = await studio.samplePixels();
out.pixelsAfterUndo = undone && { r: Math.round(undone.r), g: Math.round(undone.g), b: Math.round(undone.b) };
out.undoDelta =
  before && undone
    ? Math.round((Math.abs(before.r - undone.r) + Math.abs(before.g - undone.g) + Math.abs(before.b - undone.b)) * 100) / 100
    : null;
out.exportAfterUndo = studio.exportBytes();
out.historyAfterUndo = studio.history();
await shot('studio-08-after-undo');
await sleep(500);

return out;
