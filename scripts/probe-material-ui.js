// Probe body for scripts/ui-shell-probe.mjs: walks Material mode on a real track.
//
//   PROBE_PREFIX=material PROBE_PORT=9352 node scripts/ui-shell-probe.mjs \
//     "http://127.0.0.1:5197/?smokeTrack=/dev-tracks/Z0.szs" scripts/probe-material-ui.js
//
// Everything it asserts is reported back as JSON, so a regression shows up as a number changing
// rather than as a screenshot somebody has to squint at.
const out = {};
const setInput = (node, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(node, String(value));
  node.dispatchEvent(new Event('input', { bubbles: true }));
  node.dispatchEvent(new Event('change', { bubbles: true }));
};
const setSelect = (node, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(node, String(value));
  node.dispatchEvent(new Event('change', { bubbles: true }));
};
const rectOf = (node) => node.getBoundingClientRect();
const clickStarting = (text, sel) => {
  const node = qa(sel).find((n) => n.textContent.trim().startsWith(text));
  if (node) node.click();
  return !!node;
};
const at = (node, dx = 0, dy = 0) => {
  const r = rectOf(node);
  return { x: r.left + r.width / 2 + dx, y: r.top + r.height / 2 + dy };
};
const pointer = (node, type, point, init = {}) =>
  node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, pointerId: 1, button: 0, ...init }));

// Put the free camera somewhere that looks at the course, the way probe-visual-ui.js does, so the
// screenshots below all show the same view.
clickText('Camera');
await sleep(1200);
qa('.cameraRow')[0]?.click();
await sleep(900);
out.framedFromCamera = clickText('Look from camera', '.inspector button');
await sleep(1400);

// ---------------------------------------------------------------- entering the mode
out.modeButtons = qa('.topBarCenter [role="radio"], .topBarCenter button').map((n) => n.textContent.trim()).filter(Boolean);
clickText('Material');
await sleep(3500);

out.panel = q('.materialPanel') !== null;
out.dock = q('.materialDock') !== null;
out.contentBrowserReplaced = q('.materialDock') !== null && qa('.contentBrowser').length === 1;
out.archives = qa('.materialArchiveName').map((n) => n.textContent.trim());
out.dockTabs = qa('.materialDock [role="tab"]').map((n) => n.textContent.trim());
out.overlay = q('.materialOverlayPanel') !== null;

// Resizing the shader dock is also the proof that it keeps the content browser's resize
// mechanics. Aiming at a height rather than dragging a fixed distance keeps a run from compounding
// the height the previous run persisted into localStorage.
const setDockHeight = async (target) => {
  const handle = q('.materialDock .contentBrowserResizeHandle');
  const dock = q('.materialDock');
  if (!handle || !dock) return null;
  const r = rectOf(handle);
  const from = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  const delta = Math.round(rectOf(dock).height) - target;
  pointer(handle, 'pointerdown', from);
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: from.x, clientY: from.y + delta, pointerId: 1 }));
  await sleep(160);
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: from.x, clientY: from.y + delta, pointerId: 1 }));
  await sleep(400);
  return Math.round(rectOf(q('.materialDock')).height);
};
out.dockHeightBefore = Math.round(rectOf(q('.materialDock')).height);
out.dockHeightAfter = await setDockHeight(430);
await shot('material-01-mode');
await sleep(900);

// ---------------------------------------------------------------- the outliner
out.materialRows = qa('.materialRow').length;
out.firstMaterials = qa('.materialRow').slice(0, 6).map((n) => ({
  name: n.querySelector('strong')?.textContent.trim(),
  textures: n.querySelector('.materialRowMeta')?.textContent.trim(),
  tags: [...n.querySelectorAll('.materialTag')].map((t) => t.textContent.trim()),
}));
out.sharedShaderBadges = qa('.materialTag.shared').length;
const rowsBeforeSearch = qa('.materialRow').length;

// Search narrows the tree.
const search = q('input[aria-label="Search materials"]');
if (search) {
  setInput(search, 'crate');
  await sleep(500);
  out.searchMatches = qa('.materialRow').length;
  out.searchTotal = rowsBeforeSearch;
  setInput(search, '');
  await sleep(400);
}

// Pick the material that draws the most of the course: the one whose preview changes are
// unmistakable in a screenshot, and the most interesting graph to look at.
const rows = qa('.materialRow');
const stagesOf = (row) => Number(row.querySelector('.materialTag.stages')?.textContent ?? 0);
const meshesOf = (row) => Number(row.querySelector('.materialTag.meshes')?.textContent ?? 0);
const target = rows.slice().sort((a, b) => meshesOf(b) - meshesOf(a) || stagesOf(b) - stagesOf(a))[0] ?? rows[0];
out.selectedMaterial = target?.querySelector('strong')?.textContent.trim() ?? null;
out.selectedStageCount = target ? stagesOf(target) : 0;
out.selectedMeshCount = target ? meshesOf(target) : 0;
target?.click();
await sleep(2200);

out.inspectorSections = qa('.materialInspector .uiPanelSectionTitle').map((n) => n.textContent.trim());
out.inspectorHeader = q('.materialInspectorHeader')?.textContent.trim() ?? null;
out.overlayMeshes = q('.materialOverlayMeta')?.textContent.trim() ?? null;
out.status = q('.uiStatusMessage')?.textContent.trim() ?? null;
await shot('material-02-selected');
await sleep(900);

// ---------------------------------------------------------------- the inspector follows the graph
// The inspector is a Details panel: a texture node clicked on the canvas shows that texture, and a
// click on empty canvas brings the material back.
const detailsNow = () => ({
  crumbs: q('.materialInspector .detailsCrumbs')?.textContent.trim() ?? null,
  texture: q('.materialInspector .detailsTexture') !== null,
  overview: q('.materialInspector .materialInspectorHeader') !== null,
});
const pressAt = (node, point) => {
  node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, pointerId: 1, button: 0, buttons: 1 }));
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, pointerId: 1, button: 0 }));
};
const textureCard = q('.graphNode[data-node-type="texture"]');
if (textureCard) {
  const box = rectOf(textureCard);
  pressAt(textureCard, { x: box.left + box.width / 2, y: box.top + 10 });
  await sleep(700);
}
out.detailsAfterTextureNode = detailsNow();
await shot('material-02b-texture-details');
await sleep(900);
const graphSurface = q('.graphSurface');
if (graphSurface) {
  const box = rectOf(graphSurface);
  pressAt(graphSurface, { x: box.left + 14, y: box.bottom - 14 });
  await sleep(700);
}
out.detailsAfterEmptyClick = detailsNow();

// ---------------------------------------------------------------- the node graph
out.dockHeightForGraph = await setDockHeight(700);
// Fit puts the whole graph on screen, which for a three-stage material is too small to read, so
// the screenshots below zoom back in to roughly 1:1 around the first node.
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
out.graphSurface = q('.graphSurface') !== null;
out.graphNodes = qa('.graphNode').length;
out.graphNodeTitles = [...new Set(qa('.graphNodeTitle').map((n) => n.textContent.trim()))];
out.graphWires = qa('.graphWire').length;
out.graphStatus = q('.materialDockStatusText')?.textContent.trim() ?? null;
// A stage the graph cannot express comes back as a read-only "Special step" card, so nothing is
// silently lost when a material is opened.
out.rawStageCards = qa('.graphNode--raw').length;
out.rawStageEditable = qa('.graphNode--raw').some((n) => n.querySelector('input, select, textarea') !== null);
out.graphZoomFit = Number(q('.graphSurface').dataset.zoom);
out.graphZoomReadable = await zoomTo(0.95);
await shot('material-03-graph');
await sleep(900);

// ---------------------------------------------------------------- the stage table
clickStarting('Stages', '.materialDock [role="tab"]');
await sleep(600);
out.stagesTable = q('.materialStagesTable') !== null;
out.stageColumns = qa('.materialStagesTable thead th').map((n) => n.textContent.trim());
out.stageRows = qa('.materialStagesTable tbody tr').length;
out.firstStageCells = qa('.materialStagesTable tbody tr')[0]
  ? [...qa('.materialStagesTable tbody tr')[0].children].map((n) => n.textContent.trim())
  : [];
await shot('material-04-stages');
await sleep(900);
clickStarting('Graph', '.materialDock [role="tab"]');
await sleep(400);


// Drag a node: it should move, and the wires should follow.
const surface = q('.graphSurface');
const firstNode = qa('.graphNode')[0];
if (firstNode && surface) {
  const before = rectOf(firstNode);
  const start = at(firstNode, 0, -8);
  pointer(firstNode, 'pointerdown', start);
  await sleep(60);
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: start.x + 90, clientY: start.y + 60, pointerId: 1 }));
  await sleep(120);
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: start.x + 90, clientY: start.y + 60, pointerId: 1 }));
  await sleep(300);
  const after = rectOf(qa('.graphNode')[0]);
  out.nodeDragged = Math.round(after.left - before.left);
  out.nodeSelectedAfterDrag = qa('.graphNode.selected').length;
}
await shot('material-05-graph-node-dragged');
await sleep(900);

// Wires: drag from a texture's colour output onto the Material node's colour input (allowed),
// then from the same output onto its alpha input (rejected, because a colour cannot drive alpha).
const socketAt = (selector) => q(selector);
const dragSocket = async (fromSel, toSel) => {
  const from = socketAt(fromSel);
  const to = socketAt(toSel);
  if (!from || !to) return false;
  const a = at(from);
  const b = at(to);
  pointer(from, 'pointerdown', a);
  await sleep(60);
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: b.x, clientY: b.y, pointerId: 1 }));
  await sleep(80);
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: b.x, clientY: b.y, pointerId: 1 }));
  await sleep(400);
  return true;
};
const textureNodeId = qa('.graphNode').find((n) => n.querySelector('.graphNodeTitle')?.textContent.trim().startsWith('Texture'))?.dataset.node;
const outputNodeId = qa('.graphNode').find((n) => n.querySelector('.graphNodeTitle')?.textContent.trim() === 'Material')?.dataset.node;
if (textureNodeId && outputNodeId) {
  const wiresBefore = qa('.graphWire').length;
  await dragSocket(`[data-socket="${textureNodeId}|rgb|output"]`, `[data-socket="${outputNodeId}|color|input"]`);
  // An input socket takes one wire, so connecting into an occupied input replaces rather than adds.
  out.wireCountDeltaOnReplace = qa('.graphWire').length - wiresBefore;
  out.wireRejectedMessage = null;
  await dragSocket(`[data-socket="${textureNodeId}|rgb|output"]`, `[data-socket="${outputNodeId}|alpha|input"]`);
  out.wireRejectedMessage = q('.graphReject')?.textContent.trim() ?? null;
  out.shakingNodes = qa('.graphNode.shake').length;
  await shot('material-04b-wire-rejected');
  await sleep(900);
}

// The add-node palette, opened by double-clicking empty space.
if (surface) {
  const r = rectOf(surface);
  const empty = { x: r.left + 40, y: r.bottom - 40 };
  surface.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: empty.x, clientY: empty.y }));
  await sleep(400);
  out.paletteOpen = q('.graphPalette') !== null;
  out.paletteEntries = qa('.graphPaletteList strong').map((n) => n.textContent.trim());
  const paletteSearch = q('.graphPaletteSearch');
  if (paletteSearch) {
    setInput(paletteSearch, 'lerp');
    await sleep(300);
    out.paletteFiltered = qa('.graphPaletteList strong').map((n) => n.textContent.trim());
  }
  await shot('material-06-add-node-palette');
  await sleep(900);
  const nodesBefore = qa('.graphNode').length;
  q('.graphPaletteList button')?.click();
  await sleep(500);
  out.nodeAdded = qa('.graphNode').length - nodesBefore;
  out.undoEnabled = !qa('.materialDockTools button').find((b) => b.getAttribute('aria-label') === 'Undo')?.disabled;
}

// Auto layout and fit.
clickText('Auto layout', '.materialDockTools button');
await sleep(700);
out.afterAutoLayout = qa('.graphNode').length;
qa('.materialDockTools button').find((b) => b.getAttribute('aria-label') === 'Frame the whole graph')?.click();
await sleep(600);
await shot('material-07-auto-layout');
await sleep(900);

// Zoom out with the wheel, about the cursor.
if (surface) {
  const centre = at(surface);
  out.zoomBefore = Number(surface.dataset.zoom);
  surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 240, clientX: centre.x, clientY: centre.y }));
  await sleep(400);
  out.zoomAfterOut = Number(q('.graphSurface').dataset.zoom);
  surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -240, clientX: centre.x, clientY: centre.y }));
  surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -240, clientX: centre.x, clientY: centre.y }));
  await sleep(400);
  out.zoomAfterIn = Number(q('.graphSurface').dataset.zoom);
}

// ---------------------------------------------------------------- the inspector
await setDockHeight(360);
await sleep(400);
// The graph steps above leave a node selected, and the inspector shows the selection; an empty
// spot on the canvas brings the whole material back.
{
  const surfaceNode = q('.graphSurface');
  if (surfaceNode) {
    const box = rectOf(surfaceNode);
    pressAt(surfaceNode, { x: box.left + 14, y: box.bottom - 14 });
    await sleep(600);
  }
}
// Open every collapsed section so the screenshot shows the whole sheet.
for (const toggle of qa('.materialInspector .uiPanelSectionToggle')) {
  if (toggle.getAttribute('aria-expanded') === 'false') toggle.click();
}
await sleep(500);
out.textureRows = qa('.materialInspector .detailsTextureRow').length;
out.inspectorFields = qa('.materialInspector .uiFieldLabel').map((n) => n.childNodes[0]?.textContent?.trim()).filter(Boolean);
out.colorSwatches = qa('.materialInspector input[type="color"]').length;
await shot('material-08-inspector');
await sleep(900);

// The inspector scrolls, so a full-page screenshot only shows its first section; scroll down to
// the colour registers and the blend state for the second one.
const inspectorBody = q('.inspector .paneBody') ?? q('.inspector');
if (inspectorBody) {
  const colours = qa('.materialInspector .uiPanelSectionTitle').find((n) => n.textContent.trim() === 'Colours');
  colours?.scrollIntoView({ block: 'start' });
  await sleep(600);
  out.inspectorScrolled = Math.round(inspectorBody.scrollTop) > 0;
  await shot('material-08b-inspector-colours');
  await sleep(900);
  inspectorBody.scrollTop = 0;
  await sleep(300);
}

// A committed edit: change how the material is culled, prove it reaches the archive and the
// viewport, and prove Ctrl+Z takes it back.
const cullSelect = qa('.materialInspector select').find((n) => n.getAttribute('aria-label') === 'Sides drawn');
if (cullSelect) {
  out.cullBefore = cullSelect.value;
  out.exportEnabledBefore = !q('.topBarRight .uiButton--primary')?.disabled;
  // "Draw nothing" is the most obvious change a screenshot can show: the material's meshes vanish
  // from the viewport, which only happens if the edited bytes really did reach the renderer.
  setSelect(cullSelect, '3');
  await sleep(2000);
  out.cullAfter = qa('.materialInspector select').find((n) => n.getAttribute('aria-label') === 'Sides drawn')?.value ?? null;
  out.cullStatus = q('.uiStatusMessage')?.textContent.trim() ?? null;
  out.undoCountAfterEdit = Number(q('.topBarLeft [aria-label^="Undo"]')?.disabled === false);
  await shot('material-09-cull-draw-nothing');
  await sleep(900);
}

// A colour edit, live. The graph's Color node is the nicest place to do it, but not every
// material has one — fall back to the inspector's constant swatches, which write the same field.
const colourSwatch = q('.graphNode input[type="color"]')
  ?? qa('.materialInspector input[type="color"]').find((n) => /Constant colour/.test(n.getAttribute('aria-label') ?? ''));
if (colourSwatch) {
  out.colourEditedIn = colourSwatch.closest('.graphNode') ? 'graph' : 'inspector';
  setInput(colourSwatch, '#ff2f6a');
  await sleep(1600);
  out.colourAfter = colourSwatch.value;
  out.colourStatus = q('.uiStatusMessage')?.textContent.trim() ?? null;
  await shot('material-10-constant-colour');
  await sleep(900);
}

// A preset does more than swap the graph: `PRESET_WANTS_LIGHTING` says which ones also need
// channel-0 lighting, which the graph cannot express.
clickText('Start from…', '.materialDockTools button');
await sleep(500);
out.presetNames = qa('.uiMenuItem, [role="menuitem"]').map((n) => n.textContent.trim());
const litPreset = qa('.uiMenuItem, [role="menuitem"]').find((n) => /lit/i.test(n.textContent));
if (litPreset) {
  litPreset.click();
  await sleep(1800);
  out.presetStatus = q('.uiStatusMessage')?.textContent.trim() ?? null;
  out.presetGraphNodes = qa('.graphNode').length;
  // The Lighting section's first "Lit by scene lights" switch is channel 0's colour half.
  const lightingSection = qa('.materialInspector .uiPanelSectionToggle').find((n) => n.textContent.includes('Lighting'));
  if (lightingSection?.getAttribute('aria-expanded') === 'false') lightingSection.click();
  await sleep(500);
  // `Field` wraps the row in `.uiField`; the switch itself sits in a nested `.uiToggle` label
  // whose own text is just "On" / "Off".
  const litField = qa('.materialInspector .uiField').find((n) => /Lit by scene lights/.test(n.querySelector('.uiFieldLabel')?.textContent ?? ''));
  const litSwitch = litField?.querySelector('input[role="switch"]');
  out.presetTurnedLightingOn = litSwitch ? litSwitch.checked : null;
  await shot('material-10b-preset-applied');
  await sleep(900);
} else {
  document.body.click();
}

// Solo: hide every mesh that is not this material's.
const soloButton = qa('.materialOverlayActions button').find((b) => b.textContent.includes('Solo'));
if (soloButton && !soloButton.disabled) {
  soloButton.click();
  await sleep(1600);
  out.soloActive = q('.materialOverlayActions button')?.className.includes('active') ?? false;
  await shot('material-11-solo');
  await sleep(900);
  soloButton.click();
  await sleep(1200);
}

// Undo, all the way back, and prove the viewport comes back with it.
for (let i = 0; i < 8; i++) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await sleep(220);
}
await sleep(1200);
out.cullAfterUndo = qa('.materialInspector select').find((n) => n.getAttribute('aria-label') === 'Sides drawn')?.value ?? null;
out.statusAfterUndo = q('.uiStatusMessage')?.textContent.trim() ?? null;
await shot('material-12-after-undo');
await sleep(900);

// ---------------------------------------------------------------- leaving the mode
clickText('Visual');
await sleep(1600);
out.contentBrowserBack = q('.materialDock') === null;
out.visualPanelBack = q('.visualPanel') !== null;
clickText('KMP');
await sleep(1400);
out.kmpBack = q('.kmpPanel') !== null;
out.browserRestored = qa('.contentBrowser').length === 1 && q('.materialDock') === null;
await shot('material-13-back-in-kmp');
await sleep(900);

// The authored graph is persisted to IndexedDB, keyed by the material and the hash of its stages,
// so reopening the track brings the layout back.
out.storedGraphs = await new Promise((resolve) => {
  const request = indexedDB.open('mkw-track-editor-shader-graphs');
  request.onerror = () => resolve(null);
  request.onsuccess = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('shader-graphs')) { db.close(); resolve(null); return; }
    const keys = db.transaction('shader-graphs', 'readonly').objectStore('shader-graphs').getAllKeys();
    keys.onerror = () => { db.close(); resolve(null); };
    keys.onsuccess = () => {
      const all = keys.result.map(String);
      db.close();
      resolve({ count: all.length, first: all[0] ?? null });
    };
  };
});

return out;
