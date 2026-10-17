// Probe body: open a real character archive in the Model Studio and check the shader graph can
// draw every one of its materials as nodes — no "Special step" cards — then edit one through a
// node that did not exist before, and prove the pixels move and the edit survives an export.
//
//   PROBE_PREFIX=shader PROBE_PORT=9451 PROBE_SIZE=1720x1000 \
//     node scripts/studio-probe.mjs "http://127.0.0.1:5235/" scripts/probe-studio-shader.js
//
// `PROBE_MODEL` picks the archive (default `la_bike-bk-1.szs` in `public/dev-tracks/`), and
// `PROBE_SHOT` the screenshot prefix.
const file = window.__probeModel ?? '/dev-tracks/la_bike-bk-1.szs';
const prefix = window.__probeShot ?? 'shader-kart';
const out = { file };

// Stored graphs are keyed by the material's stages, and this probe edits materials, so a previous
// run's layouts have to go or the numbers are about the last run rather than this one.
await new Promise((resolve) => {
  const request = indexedDB.deleteDatabase('mkw-track-editor-shader-graphs');
  request.onsuccess = resolve;
  request.onerror = resolve;
  request.onblocked = resolve;
});

clickText('Model Studio');
const studio = await waitForStudio();
await sleep(1500);

// The dev server re-optimises dependencies on the first hit and can drop an in-flight fetch, so
// the open is retried rather than failing the whole run.
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    out.openedBytes = await studio.openUrl(file);
    break;
  } catch (error) {
    out.openAttempts = attempt;
    out.openError = String(error && error.message ? error.message : error);
    await sleep(1500);
  }
}
if (!out.openedBytes) return out;
await sleep(3000);
studio.frameAll();
await sleep(800);

out.cleanExport = studio.exportBytes();
out.archives = studio.archives().map((archive) => ({ path: archive.archivePath, models: archive.models.map((m) => m.modelName) }));

// ---------------------------------------------------------------- every material, as nodes
const names = studio.materials();
out.materialCount = names.length;
out.stageCount = names.reduce((sum, entry) => sum + entry.stageCount, 0);

const seen = [];
let withAlphaAsColor = 0;
let withStoredValue = 0;
let rawTotal = 0;
const rawReasons = [];
for (const entry of names) {
  studio.selectMaterial(entry.archivePath, entry.modelName, entry.materialName);
  await sleep(260);
  const graph = studio.graph();
  if (!graph) continue;
  rawTotal += graph.rawStages;
  rawReasons.push(...graph.rawReasons);
  if (graph.nodes.some((node) => node.type === 'alphaAsColor')) withAlphaAsColor++;
  if (graph.nodes.some((node) => node.type === 'storedValue')) withStoredValue++;
  seen.push({
    material: `${entry.modelName}/${entry.materialName}`,
    nodes: graph.nodes.length,
    edges: graph.edges,
    raw: graph.rawStages,
  });
}
out.materialsChecked = seen.length;
out.rawStages = rawTotal;
out.rawReasons = [...new Set(rawReasons)];
out.materialsUsingAlphaAsColour = withAlphaAsColor;
out.materialsUsingStoredValue = withStoredValue;
out.worst = seen.slice().sort((a, b) => b.raw - a.raw || b.nodes - a.nodes).slice(0, 5);

// ---------------------------------------------------------------- the graph on screen
// Pick the first material that uses the cross-domain read: that is the shape that used to be a
// wall of read-only cards, and is what the screenshot has to show as nodes.
let target = null;
for (const entry of names) {
  studio.selectMaterial(entry.archivePath, entry.modelName, entry.materialName);
  await sleep(160);
  const graph = studio.graph();
  if (graph && graph.nodes.some((node) => node.type === 'alphaAsColor')) {
    target = { ...entry, graph };
    break;
  }
}
out.target = target ? `${target.modelName}/${target.materialName}` : null;
if (!target) return out;

await sleep(600);
out.targetNodes = target.graph.nodes.map((node) => node.type);
out.specialStepCards = qa('.graphNode').filter((node) => node.textContent.includes('Special step')).length;
out.alphaAsColourCards = qa('.graphNode').filter((node) => node.textContent.includes('Alpha as colour')).length;

// Make the dock tall and zoom the graph in, so the screenshot shows cards a person could read
// rather than a 25% thumbnail of the whole material.
// The graph dock's own grip is the splitter between preview and graph. The track editor under the
// studio has a content browser with the same grip, so look inside the studio's centre column.
const handle = q('.studioCenter .contentBrowserResizeHandle');
if (handle) {
  const box = handle.getBoundingClientRect();
  const at = (type, y) => handle.dispatchEvent(new PointerEvent(type, {
    bubbles: true, clientX: box.left + box.width / 2, clientY: y, pointerId: 1, button: 0, buttons: 1,
  }));
  at('pointerdown', box.top + 1);
  await sleep(60);
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: box.left + 10, clientY: box.top - 320, pointerId: 1, buttons: 1 }));
  await sleep(60);
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: box.left + 10, clientY: box.top - 320, pointerId: 1 }));
  await sleep(400);
  out.dockHeight = Math.round(q('.studioCenter .materialDock')?.getBoundingClientRect().height ?? 0);
}
// Refit after the resize, then zoom in: the fit is what puts the whole material back on screen,
// and the zoom is what makes the cards readable in the screenshot.
const fitButton = qa('button').find((node) => (node.getAttribute('aria-label') ?? '').includes('Frame the whole graph'));
if (fitButton) fitButton.click();
await sleep(400);

const surface = q('.graphSurface');
if (surface) {
  const box = surface.getBoundingClientRect();
  for (let i = 0; i < 5; i++) {
    surface.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: -120,
      clientX: box.left + box.width * 0.42, clientY: box.top + box.height * 0.5,
    }));
    await sleep(60);
  }
}
await sleep(500);
out.graphZoom = q('.graphZoom')?.textContent ?? null;
out.visibleNodeTitles = [...new Set(qa('.graphNodeTitle').map((node) => node.textContent.trim()))];
await shot(`${prefix}-01-graph`);
await sleep(400);

// ---------------------------------------------------------------- edit through a new node
const before = await studio.samplePixels();
out.pixelsBefore = before ? { r: Math.round(before.r), g: Math.round(before.g), b: Math.round(before.b) } : null;
const stagesBefore = JSON.stringify(studio.materialDoc()?.tevStages ?? []);

// "Vertex colour" grew from two lighting channels to every source the rasteriser has. Switching
// it to the constant-black one is a change only the widened node can express.
const vertexNode = target.graph.nodes.find((node) => node.type === 'vertexColor');
const storedNode = target.graph.nodes.find((node) => node.type === 'storedValue');
out.editedNode = vertexNode ? 'vertexColor' : storedNode ? 'storedValue' : null;
// The decompiler draws one Vertex colour node per step that reads it, and one step can only read
// one channel, so every one of them moves together or the graph stops compiling.
// Each edit reads the graph the last one left, so they wait for it to land.
if (vertexNode) {
  out.edited = true;
  for (const node of target.graph.nodes.filter((entry) => entry.type === 'vertexColor')) {
    out.edited = studio.setGraphNode(node.id, { channel: 7 }) && out.edited;
    await sleep(150);
  }
}
else if (storedNode) out.edited = studio.setGraphNode(storedNode.id, { slot: 1 });
await sleep(1200);

out.stagesChanged = JSON.stringify(studio.materialDoc()?.tevStages ?? []) !== stagesBefore;
const after = await studio.samplePixels();
out.pixelsAfter = after ? { r: Math.round(after.r), g: Math.round(after.g), b: Math.round(after.b) } : null;
out.pixelDelta = before && after
  ? Math.round((Math.abs(before.r - after.r) + Math.abs(before.g - after.g) + Math.abs(before.b - after.b)) * 100) / 100
  : null;
out.status = studio.status();
await shot(`${prefix}-02-edited`);
await sleep(400);

// ---------------------------------------------------------------- export and read it back
out.editedExport = studio.exportBytes();
out.exportChanged = out.editedExport.hash !== out.cleanExport.hash;
out.cleanExportMatchedInput = out.cleanExport.length === out.openedBytes;

// Export the edited archive and open it again: the edit has to be in the bytes, not just in the
// editor's head.
const editedStages = JSON.stringify(studio.materialDoc()?.tevStages ?? []);
out.reopened = await studio.reopenExport();
await sleep(2500);
studio.selectMaterial(target.archivePath, target.modelName, target.materialName);
await sleep(600);
out.reopenedStagesMatchEdit = JSON.stringify(studio.materialDoc()?.tevStages ?? []) === editedStages;
out.reopenedGraph = studio.graph();
await shot(`${prefix}-03-reopened`);
await sleep(400);

// And back to the clean archive to check undo would have restored it byte for byte.
await studio.openUrl(file);
await sleep(2500);
out.reopenedCleanHash = studio.exportBytes().hash;
out.cleanReopenIsByteIdentical = out.reopenedCleanHash === out.cleanExport.hash;
return out;
