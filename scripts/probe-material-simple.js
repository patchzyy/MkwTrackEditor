// Probe body for scripts/ui-shell-probe.mjs: the simple/advanced material inspector.
//
//   PROBE_PREFIX=matafter PROBE_PORT=9358 node scripts/ui-shell-probe.mjs \
//     "http://127.0.0.1:5182/?smokeTrack=/dev-tracks/Z0.szs" scripts/probe-material-simple.js
//
// Enters Material mode, picks a material, and shoots the inspector as it opens (simple view) and
// with every advanced disclosure expanded, then the graph dock and the live-preview check.
const out = {};
const rectOf = (node) => node.getBoundingClientRect();

// The Advanced disclosures remember whether they were open, and this probe opens all of them, so
// a second run would start where the first left off and the "simple view" shots would be wrong.
for (const key of Object.keys(window.localStorage)) {
  if (key.startsWith('mkw.material.disclosure.')) window.localStorage.removeItem(key);
}

clickText('Material');
await sleep(3500);

out.panel = q('.materialPanel') !== null;
out.archives = qa('.materialArchiveName').map((n) => n.textContent.trim());

// Listing an archive walks the whole BRRES off the main thread, so wait for the rows.
for (let i = 0; i < 60 && qa('.materialRow').length === 0; i++) await sleep(500);
const rows = qa('.materialRow');
const numTag = (row, cls) => Number(row.querySelector(`.materialTag.${cls}`)?.textContent ?? 0);
const target = rows.slice().sort((a, b) => numTag(b, 'meshes') - numTag(a, 'meshes') || numTag(b, 'stages') - numTag(a, 'stages'))[0] ?? rows[0];
out.selectedMaterial = target?.querySelector('strong')?.textContent.trim() ?? null;
out.selectedStageCount = target ? numTag(target, 'stages') : 0;
target?.click();
await sleep(2500);

// ---------------------------------------------------------------- simple view
out.inspectorSections = qa('.materialInspector .uiPanelSectionTitle').map((n) => n.textContent.trim());
out.inspectorHeader = q('.materialInspectorHeader')?.textContent.trim() ?? null;
out.fieldLabels = qa('.materialInspector .uiFieldLabel').map((n) => n.textContent.trim());
out.selectValues = qa('.materialInspector select').map((n) => n.selectedOptions[0]?.textContent.trim()).filter(Boolean);
out.inspectorHeight = Math.round(q('.materialInspector')?.scrollHeight ?? 0);
out.advancedDisclosures = qa('.materialInspector .materialAdvancedToggle').map((n) => n.textContent.trim());
out.advancedOpenAtStart = qa('.materialInspector .materialAdvancedToggle[aria-expanded="true"]').length;
await shot('matsimple-01-inspector');
await sleep(700);

// Scroll the inspector down so the lower sections are in a shot too. The scroller is an
// ancestor of `.materialInspector`, not the element itself, so walk up to whichever one it is.
const scrollerOf = (node) => {
  for (let el = node; el && el !== document.body; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 8) return el;
  }
  return null;
};
const panel = scrollerOf(q('.materialInspector'));
if (panel) {
  panel.scrollTop = panel.scrollHeight;
  await sleep(500);
  await shot('matsimple-02-inspector-bottom');
  await sleep(700);
  panel.scrollTop = 0;
  await sleep(300);
}

// ---------------------------------------------------------------- advanced expanded
// Open every collapsed PanelSection and every Advanced disclosure. Opening one can reveal
// another (a layer card's block sits inside the Textures section), so this runs to a fixed point.
for (let pass = 0; pass < 4; pass++) {
  const closed = qa('.materialInspector .uiPanelSectionToggle[aria-expanded="false"], .materialInspector .materialAdvancedToggle[aria-expanded="false"]');
  if (closed.length === 0) break;
  for (const toggle of closed) toggle.click();
  await sleep(400);
}
await sleep(700);
out.advancedSections = qa('.materialInspector .uiPanelSectionTitle').map((n) => n.textContent.trim());
out.advancedHeight = Math.round(q('.materialInspector')?.scrollHeight ?? 0);
await shot('matsimple-03-advanced');
await sleep(700);
if (panel) {
  panel.scrollTop = panel.scrollHeight;
  await sleep(500);
  await shot('matsimple-04-advanced-bottom');
  await sleep(700);
}

// ---------------------------------------------------------------- graph dock
const graphTab = qa('.materialDock [role="tab"]').find((n) => n.textContent.trim().startsWith('Graph'));
graphTab?.click();
await sleep(1200);
out.nodeTitles = qa('.graphNodeTitle').map((n) => n.textContent.trim());
out.nodeCaptions = qa('.graphNodeCaption, .graphNodeLabel').map((n) => n.textContent.trim());
out.socketLabels = [...new Set(qa('.graphSocket label').map((n) => n.textContent.trim()))];
out.dockButtons = qa('.materialDockTools button').map((n) => n.textContent.trim()).filter(Boolean);
out.presetChips = qa('.materialPresetChip').map((n) => n.textContent.trim());

// Fit puts a whole graph on screen too small to read, so zoom back to roughly 1:1 around the
// first node before the screenshot.
const at = (node, dx = 0, dy = 0) => {
  const r = rectOf(node);
  return { x: r.left + r.width / 2 + dx, y: r.top + r.height / 2 + dy };
};
const zoomTo = async (target) => {
  const surfaceNode = q('.graphSurface');
  const anchor = qa('.graphNode')[0] ?? surfaceNode;
  if (!surfaceNode) return null;
  for (let i = 0; i < 24; i++) {
    const zoom = Number(surfaceNode.dataset.zoom);
    if (Math.abs(zoom - target) < 0.06) break;
    const point = at(anchor, 120, 120);
    surfaceNode.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: zoom < target ? -120 : 120, clientX: point.x, clientY: point.y,
    }));
    await sleep(60);
  }
  return Number(q('.graphSurface').dataset.zoom);
};

// Give the dock some room first, or a 1:1 graph shows two nodes.
const handle = q('.materialDock .contentBrowserResizeHandle');
if (handle) {
  const r = rectOf(handle);
  const from = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  const delta = Math.round(rectOf(q('.materialDock')).height) - 560;
  const pointer = (node, type, point) =>
    node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, pointerId: 1, button: 0 }));
  pointer(handle, 'pointerdown', from);
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: from.x, clientY: from.y + delta, pointerId: 1 }));
  await sleep(160);
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: from.x, clientY: from.y + delta, pointerId: 1 }));
  await sleep(500);
}
out.graphZoom = await zoomTo(0.95);
await shot('matsimple-05-graph');
await sleep(700);

// ---------------------------------------------------------------- live preview
// A simple control has to reach the renderer through the same hot-swap path the raw fields used
// (onChange -> MaterialMode -> reloadEditorMaterial), so switch the shading to Unlit and measure
// how much the picture moves. The skybox is the one material guaranteed to cover most of the
// viewport whatever the camera is doing, which is what makes that measurable at all.
//
// `previewUndoDiff` is expected to stay high: Ctrl+Z restores the *document* (the control snaps
// back and the status bar says so) but MaterialMode does not push the restored material at the
// renderer, so the viewport keeps the undone look until the scene is rebuilt. That is not new
// here — driving the raw "Sides drawn" select in Surface > Advanced behaves exactly the same
// way — and MaterialMode.tsx is where it would have to be fixed.
const skyboxHeader = qa('.materialArchiveHeader').find((n) => n.textContent.includes('Skybox'));
skyboxHeader?.click();
await sleep(2500);
const skySection = skyboxHeader?.closest('.materialArchive');
const skyRow = skySection ? skySection.querySelector('.materialRow') : null;
skyRow?.click();
await sleep(2500);
out.previewMaterial = skyRow?.querySelector('strong')?.textContent.trim() ?? null;
const shadingGroup = qa('.materialInspector [role="group"][aria-label="Shading"]')[0];
out.previewShadingBefore = shadingGroup
  ? [...shadingGroup.querySelectorAll('button')].find((n) => n.getAttribute('aria-pressed') === 'true')?.textContent.trim()
  : null;
await shot('matsimple-06-preview-before');
await sleep(800);

// Two frames of the *unchanged* scene first. Texture animations keep running, so consecutive
// frames are never bit-identical; the baseline is how much they move on their own, and the edit
// has to move the picture by a lot more than that to count.
const decode = (url) => new Promise((resolve) => {
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(320, image.width);
    canvas.height = Math.min(200, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    resolve(context.getImageData(0, 0, canvas.width, canvas.height).data);
  };
  image.src = url;
});
/** Mean absolute per-channel difference, 0..255. */
const meanDiff = (a, b) => {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return Math.round((total / a.length) * 100) / 100;
};

const frameA = await decode(await mkw.captureFrame());
await sleep(600);
const frameB = await decode(await mkw.captureFrame());
out.previewIdleDiff = meanDiff(frameA, frameB);

const unlit = shadingGroup ? [...shadingGroup.querySelectorAll('button')].find((n) => n.textContent.trim() === 'Unlit') : null;
unlit?.click();
await sleep(2000);
out.previewEditDiff = meanDiff(frameB, await decode(await mkw.captureFrame()));
out.previewStatus = q('.uiStatusMessage')?.textContent.trim() ?? null;
out.previewShadingAfter = shadingGroup
  ? [...shadingGroup.querySelectorAll('button')].find((n) => n.getAttribute('aria-pressed') === 'true')?.textContent.trim()
  : null;
await shot('matsimple-07-preview-unlit');
await sleep(800);
// Ctrl+Z puts it back, which proves the edit went through the editor history rather than round
// the side of it.
document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
await sleep(1800);
out.previewShadingAfterUndo = qa('.materialInspector [role="group"][aria-label="Shading"] button')
  .find((n) => n.getAttribute('aria-pressed') === 'true')?.textContent.trim() ?? null;
out.previewUndoDiff = meanDiff(frameB, await decode(await mkw.captureFrame()));
await shot('matsimple-08-preview-undone');
await sleep(800);

// ---------------------------------------------------------------- jargon sweep
const inspectorText = q('.materialInspector')?.innerText ?? '';
out.jargonInSimple = ['KCSEL', 'TEXMAP', 'TEXCOORD', 'RASC', 'INVSRCALPHA', 'LIN_MIP_LIN', 'GEQUAL'].filter((word) =>
  inspectorText.includes(word),
);
out.dockRect = q('.materialDock') ? Math.round(rectOf(q('.materialDock')).height) : null;
return out;
