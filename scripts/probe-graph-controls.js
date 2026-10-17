// Probe body: the shader graph's Unreal-style controls, in the Model Studio.
//
//   PROBE_PORT=9442 PROBE_SIZE=1720x1000 PROBE_SHOT=graphctl \
//     node scripts/studio-probe.mjs "http://127.0.0.1:5242/" scripts/probe-graph-controls.js
//
// Checks: right-drag pans and does not open a menu; a right-click that does not move opens the
// add-node menu; the wheel zooms about the cursor; a wheel event inside the menu (or the help card)
// never moves the canvas; a trackpad-style wheel pans; F frames; the node menu; inline values; the
// help card; fullscreen. Screenshots: `<shot>-01-graph`, `-02-menu`, `-03-help`, `-04-node-menu`,
// `-05-fullscreen`.
const file = window.__probeModel ?? '/dev-tracks/la_bike-bk-1.szs';
const prefix = window.__probeShot ?? 'graphctl';
const out = { file };

// Stored graphs keep the layout they were saved with; start from fresh reads of every material.
await new Promise((resolve) => {
  const request = indexedDB.deleteDatabase('mkw-track-editor-shader-graphs');
  request.onsuccess = resolve;
  request.onerror = resolve;
  request.onblocked = resolve;
});

clickText('Model Studio');
const studio = await waitForStudio();
await sleep(1500);
for (let attempt = 1; attempt <= 4 && !out.openedBytes; attempt++) {
  try {
    out.openedBytes = await studio.openUrl(file);
  } catch (error) {
    out.openError = String(error && error.message ? error.message : error);
    await sleep(1500);
  }
}
if (!out.openedBytes) return out;
await sleep(2500);

// The material with the most nodes is the most interesting graph to look at.
let best = null;
for (const entry of studio.materials()) {
  studio.selectMaterial(entry.archivePath, entry.modelName, entry.materialName);
  await sleep(200);
  const graph = studio.graph();
  if (graph && (!best || graph.nodes.length > best.count)) best = { entry, count: graph.nodes.length };
}
if (!best) return out;
studio.selectMaterial(best.entry.archivePath, best.entry.modelName, best.entry.materialName);
out.material = `${best.entry.modelName}/${best.entry.materialName}`;
out.nodeCount = best.count;
await sleep(800);

// A tall dock, so the graph is worth looking at.
const handle = q('.studioDockHandle') ?? q('.contentBrowserResizeHandle');
if (handle) {
  const box = handle.getBoundingClientRect();
  handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: box.left + 40, clientY: box.top + 1, pointerId: 1, button: 0, buttons: 1 }));
  await sleep(60);
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: box.left + 40, clientY: box.top - 330, pointerId: 1, buttons: 1 }));
  await sleep(60);
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: box.left + 40, clientY: box.top - 330, pointerId: 1 }));
  await sleep(500);
}
qa('button').find((n) => n.getAttribute('aria-label') === 'Frame the whole graph')?.click();
await sleep(500);

const surface = q('.graphSurface');
const view = () => ({ zoom: Number(q('.graphSurface').dataset.zoom), pan: q('.graphSurface').dataset.pan });
const rect = surface.getBoundingClientRect();
// An empty spot: the lower-left corner of the canvas, above the hint strip.
const emptyPoint = () => {
  for (let y = rect.bottom - 60; y > rect.top + 40; y -= 20) {
    for (let x = rect.left + 30; x < rect.right - 40; x += 20) {
      const hit = document.elementFromPoint(x, y);
      if (hit === surface || hit?.classList.contains('graphViewport')) return { x, y };
    }
  }
  return { x: rect.left + 20, y: rect.top + 20 };
};
const pointer = (target, type, x, y, button, buttons) => target.dispatchEvent(new PointerEvent(type, {
  bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button, buttons, pointerType: 'mouse',
}));
const wheel = (target, x, y, init) => target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, ...init }));

out.inlineSwitches = qa('.graphInline').length;
out.inlineLabels = qa('.graphInline').map((n) => n.getAttribute('aria-label')).slice(0, 8);
out.resultNodeWidth = Math.round(q('.graphNode--result')?.getBoundingClientRect().width ?? 0);
out.cardWidths = [...new Set(qa('.graphNode:not(.graphComment)').map((n) => n.offsetWidth))];
// Every card is drawn at exactly the height the model gives it: nothing spills.
out.cardsOverflowing = qa('.graphNode:not(.graphComment)').filter((n) => n.scrollHeight > n.offsetHeight + 1).map((n) => n.dataset.node);
await shot(`${prefix}-01-graph`);
await sleep(300);

// ---- right-drag pans, and does not open the menu
let p = emptyPoint();
const before = view();
pointer(surface, 'pointerdown', p.x, p.y, 2, 2);
await sleep(30);
for (let i = 1; i <= 6; i++) {
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: p.x + i * 20, clientY: p.y + i * 8, pointerId: 1, buttons: 2 }));
  await sleep(16);
}
window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: p.x + 120, clientY: p.y + 48, pointerId: 1, button: 2 }));
surface.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x + 120, clientY: p.y + 48, button: 2 }));
await sleep(200);
const afterPan = view();
out.rightDragPanned = before.pan !== afterPan.pan;
out.rightDragPan = { before: before.pan, after: afterPan.pan };
out.rightDragOpenedMenu = !!q('.graphPalette') || !!q('.uiMenu');

// ---- the wheel zooms about the cursor
p = emptyPoint();
const zoomBefore = view().zoom;
wheel(surface, p.x, p.y, { deltaY: -100 });
await sleep(120);
out.wheelZoomIn = { before: zoomBefore, after: view().zoom };
wheel(surface, p.x, p.y, { deltaY: 100 });
await sleep(120);
out.wheelZoomBack = view().zoom;
// ---- a trackpad two-finger scroll pans
const padBefore = view();
wheel(surface, p.x, p.y, { deltaY: 6.5, deltaX: 3 });
await sleep(120);
out.trackpadPanned = view().pan !== padBefore.pan && view().zoom === padBefore.zoom;
await sleep(450);
// ---- a pinch (ctrl+wheel) zooms
const pinchBefore = view().zoom;
wheel(surface, p.x, p.y, { deltaY: -8, ctrlKey: true });
await sleep(120);
out.pinchZoomed = view().zoom > pinchBefore;
await sleep(450);

// ---- a right-click that does not move opens the add-node menu at the cursor
p = emptyPoint();
pointer(surface, 'pointerdown', p.x, p.y, 2, 2);
await sleep(30);
window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: p.x + 1, clientY: p.y + 1, pointerId: 1, buttons: 2 }));
window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: p.x + 1, clientY: p.y + 1, pointerId: 1, button: 2 }));
const contextEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x + 1, clientY: p.y + 1, button: 2 });
surface.dispatchEvent(contextEvent);
await sleep(300);
out.rightClickOpenedPalette = !!q('.graphPalette');
out.browserMenuSuppressed = contextEvent.defaultPrevented;
out.paletteHeadings = qa('.graphPaletteHeading').map((n) => n.textContent.trim());

// ---- the wheel inside the menu never moves the canvas
const list = q('.graphPaletteList');
if (list) {
  const beforeMenuWheel = view();
  const item = q('.graphPaletteList button');
  const box = item.getBoundingClientRect();
  wheel(item, box.left + 10, box.top + 5, { deltaY: 100 });
  wheel(item, box.left + 10, box.top + 5, { deltaY: 4.5, deltaX: 2 });
  wheel(item, box.left + 10, box.top + 5, { deltaY: -6, ctrlKey: true });
  await sleep(150);
  const afterMenuWheel = view();
  out.wheelInMenuMovedCanvas = afterMenuWheel.pan !== beforeMenuWheel.pan || afterMenuWheel.zoom !== beforeMenuWheel.zoom;
  list.scrollTop = 120;
  await sleep(150);
}
await shot(`${prefix}-02-menu`);
await sleep(300);
// Escape closes it.
q('.graphPaletteSearch')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await sleep(200);
out.paletteClosedOnEscape = !q('.graphPalette');

// ---- the help card, and the wheel inside it
qa('button').find((n) => n.getAttribute('aria-label') === 'Controls and tips')?.click();
await sleep(300);
out.helpOpen = !!q('.graphHelp');
const help = q('.graphHelp');
if (help) {
  const box = help.getBoundingClientRect();
  const beforeHelpWheel = view();
  wheel(help, box.left + 20, box.top + 40, { deltaY: 100 });
  await sleep(150);
  out.wheelInHelpMovedCanvas = view().zoom !== beforeHelpWheel.zoom || view().pan !== beforeHelpWheel.pan;
}
await shot(`${prefix}-03-help`);
await sleep(300);
qa('button').find((n) => n.getAttribute('aria-label') === 'Controls and tips')?.click();
await sleep(200);

// ---- right-click on a node: its own menu; it selects the node and reports the selection
const card = qa('.graphNode').find((n) => n.dataset.nodeType === 'texture') ?? qa('.graphNode')[0];
const cardBox = card.getBoundingClientRect();
const cx = cardBox.left + cardBox.width / 2;
const cy = cardBox.top + 10;
pointer(card.querySelector('.graphNodeHeader'), 'pointerdown', cx, cy, 2, 2);
await sleep(40);
window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1, button: 2 }));
await sleep(300);
out.nodeMenuItems = qa('.uiMenu [role="menuitem"]').map((n) => n.querySelector('.uiMenuItemLabel')?.textContent.trim());
out.nodeSelectedByRightClick = card.classList.contains('selected') || q(`.graphNode[data-node="${card.dataset.node}"]`)?.classList.contains('selected');
await shot(`${prefix}-04-node-menu`);
await sleep(300);
document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
await sleep(200);
out.nodeMenuClosed = !q('.uiMenu');

// ---- F frames the selection
surface.focus();
const beforeFrame = view();
surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
await sleep(300);
out.framedSelection = { before: beforeFrame, after: view() };

// ---- inline value: click ½ on the first switch and check the node took it
const inline = q('.graphInline');
if (inline) {
  const nodeId = inline.closest('.graphNode').dataset.node;
  const half = [...inline.querySelectorAll('button')].find((b) => b.textContent.trim() === '½');
  half?.click();
  await sleep(400);
  const node = studio.graph()?.nodes.find((n) => n.id === nodeId);
  out.inlineEdit = { nodeId, inputValues: node?.inputValues ?? null, checked: q(`.graphNode[data-node="${nodeId}"] .graphInline [aria-checked="true"]`)?.textContent ?? null };
}

// ---- fullscreen
qa('button').find((n) => n.getAttribute('aria-label') === 'Fullscreen graph')?.click();
await sleep(600);
const dock = q('.materialDock');
out.fullscreen = dock?.classList.contains('materialDock--fullscreen') ?? false;
out.fullscreenSize = dock ? [Math.round(dock.getBoundingClientRect().width), Math.round(dock.getBoundingClientRect().height)] : null;
await shot(`${prefix}-05-fullscreen`);
await sleep(300);
// And at 100%, around the first maths node, to read the cards.
const maths = q('.graphNode--math');
if (maths) {
  const box = maths.getBoundingClientRect();
  for (let i = 0; i < 12 && Number(q('.graphSurface').dataset.zoom) < 0.98; i++) {
    wheel(q('.graphSurface'), box.left + box.width / 2, box.top + box.height / 2, { deltaY: -100 });
    await sleep(40);
  }
  await sleep(300);
  out.closeUpZoom = view().zoom;
  await shot(`${prefix}-06-closeup`);
  await sleep(300);
}
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await sleep(300);
out.fullscreenLeftOnEscape = !q('.materialDock')?.classList.contains('materialDock--fullscreen');
return out;
