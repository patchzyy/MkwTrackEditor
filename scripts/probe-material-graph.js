// Probe body: Material mode over a real track, checking how much of every course material the
// node editor can draw, and that a "Special step" is never a dead end.
//
//   PROBE_PREFIX=matgraph PROBE_PORT=9455 PROBE_SIZE=1720x1000 node scripts/ui-shell-probe.mjs \
//     "http://127.0.0.1:5235/?track=/dev-tracks/Z0.szs" scripts/probe-material-graph.js
const out = {};

// A previous run's stored layouts would answer for that run, not this one.
await new Promise((resolve) => {
  const request = indexedDB.deleteDatabase('mkw-track-editor-shader-graphs');
  request.onsuccess = resolve;
  request.onerror = resolve;
  request.onblocked = resolve;
});

clickText('Material');
await sleep(2500);
out.mode = q('.materialDock') ? 'material' : 'not-entered';

// The outliner lists archives lazily, so expand everything first.
for (let pass = 0; pass < 4; pass++) {
  for (const node of qa('.materialArchiveHeader[aria-expanded="false"]')) node.click();
  await sleep(900);
}
out.archives = qa('.materialArchiveHeader').length;
out.materialRows = qa('.materialRow').length;

const results = [];
for (let index = 0; index < qa('.materialRow').length; index++) {
  const row = qa('.materialRow')[index];
  const name = row.querySelector('strong')?.textContent?.trim() ?? `#${index}`;
  row.click();
  await sleep(340);
  const cards = qa('.graphNode');
  const special = cards.filter((card) => card.textContent.includes('Special step'));
  results.push({
    ref: name,
    index,
    nodes: cards.length,
    special: special.length,
    reasons: special.map((card) => (card.querySelector('.graphRawStageNote')?.textContent ?? '').trim().slice(0, 160)),
    alphaAsColour: cards.filter((card) => card.textContent.includes('Alpha as colour')).length,
    storedValue: cards.filter((card) => card.textContent.includes('Working slot') || card.textContent.includes('Stored slot')).length,
  });
}
out.materialsChecked = results.length;
out.specialSteps = results.reduce((sum, entry) => sum + entry.special, 0);
out.materialsWithSpecialSteps = results.filter((entry) => entry.special > 0).length;
out.specialStepReasons = [...new Set(results.flatMap((entry) => entry.reasons))];
out.materialsUsingAlphaAsColour = results.filter((entry) => entry.alphaAsColour > 0).length;
out.materialsUsingStoredValue = results.filter((entry) => entry.storedValue > 0).length;

// A taller dock, a fit and a few zoom steps: the screenshots have to show cards a person could
// read rather than a thumbnail of the whole material.
let dockResized = false;
async function layoutGraph(zoomSteps = 4, focus = null) {
  if (!dockResized) {
    const handle = q('.contentBrowserResizeHandle');
    if (handle) {
      const box = handle.getBoundingClientRect();
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: box.left + box.width / 2, clientY: box.top + 1, pointerId: 1, button: 0, buttons: 1 }));
      await sleep(60);
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: box.left + 10, clientY: box.top - 300, pointerId: 1, buttons: 1 }));
      await sleep(60);
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: box.left + 10, clientY: box.top - 300, pointerId: 1 }));
      await sleep(400);
      dockResized = true;
    }
  }
  const fitButton = qa('button').find((node) => (node.getAttribute('aria-label') ?? '').includes('Fit the graph'));
  if (fitButton) fitButton.click();
  await sleep(400);
  const surface = q('.graphSurface');
  if (surface) {
    for (let i = 0; i < zoomSteps; i++) {
      // Zoom about the card of interest when there is one, so it stays on screen as it grows.
      const box = surface.getBoundingClientRect();
      const at = focus ? focus() : null;
      const x = at ? at.left + at.width / 2 : box.left + box.width * 0.4;
      const y = at ? at.top + at.height / 2 : box.top + box.height * 0.5;
      surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: x, clientY: y }));
      await sleep(80);
    }
  }
  await sleep(400);
  return q('.graphZoom')?.textContent ?? null;
}

// If this track has a step the editor still cannot draw, that card is the thing to photograph:
// it has to say what it is in one sentence and offer a way out rather than just sitting there.
const special = results.find((entry) => entry.special > 0);
if (special) {
  const row = qa('.materialRow')[special.index];
  if (row) row.click();
  await sleep(600);
  const card = qa('.graphNode').find((node) => node.textContent.includes('Special step'));
  if (card) {
    card.scrollIntoView({ block: 'center', inline: 'center' });
    out.specialCardText = (card.querySelector('.graphRawStageNote')?.textContent ?? '').trim();
    out.specialCardButton = card.querySelector('.graphRawStageConvert')?.textContent?.trim() ?? null;
    out.specialCardEditable = qa('.graphNode input, .graphNode select').length >= 0
      ? card.querySelectorAll('input, select, textarea').length
      : null;
  }
  out.specialZoom = await layoutGraph(4, () => {
    const node = qa('.graphNode').find((entry) => entry.textContent.includes('Special step'));
    return node ? node.getBoundingClientRect() : null;
  });
  await shot('material-graph-03-special-step');
  await sleep(300);

  // The card's way out. Here it can only rebuild (this step is genuinely undrawable), but it is
  // the same action a graph saved before the editor learned a node gets as "Convert to nodes".
  const convert = q('.graphRawStageConvert');
  if (convert) {
    convert.click();
    await sleep(900);
    out.afterConvertStatus = q('.statusBarMessage, .statusBar, footer')?.textContent?.trim().slice(0, 160) ?? null;
    out.afterConvertSpecialSteps = qa('.graphNode').filter((node) => node.textContent.includes('Special step')).length;
  }
}

// Show a material that leans on the new vocabulary.
const showcase = results.find((entry) => entry.alphaAsColour > 0) ?? results.find((entry) => entry.nodes > 8) ?? results[0];
out.showcase = showcase ?? null;
if (showcase) {
  const row = qa('.materialRow')[showcase.index];
  if (row) row.click();
  await sleep(500);
}

out.graphZoom = await layoutGraph(4);
out.visibleNodeTitles = [...new Set(qa('.graphNodeTitle').map((node) => node.textContent.trim()))];
await shot('material-graph-01-course');
await sleep(400);

// The palette: the everyday nodes, then the four under Advanced.
const canvas = q('.graphSurface');
if (canvas) {
  const box = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: box.left + 120, clientY: box.top + 90 }));
  await sleep(500);
}
out.paletteOpen = !!q('.graphPalette');
out.paletteItems = qa('.graphPaletteList button strong').map((node) => node.textContent.trim());
out.paletteHasAdvancedHeading = qa('.graphPaletteHeading').map((node) => node.textContent.trim());
// The list is taller than the palette, so scroll to the Advanced heading for the screenshot.
const list = q('.graphPaletteList');
if (list) list.scrollTop = list.scrollHeight;
await sleep(300);
await shot('material-graph-02-palette');
await sleep(300);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

return out;
