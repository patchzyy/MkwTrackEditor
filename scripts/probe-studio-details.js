// Probe body: the Model Studio's Details panel follows the shader graph's selection.
//
//   PROBE_PORT=9443 PROBE_SIZE=1720x1000 PROBE_SHOT=studio-details \
//     node scripts/studio-probe.mjs "http://127.0.0.1:5243/" scripts/probe-studio-details.js
//
// It clicks the way a person does — a texture node on the canvas, an empty spot of the canvas, a
// texture row in the overview, a colour node — and after each reads what the Details panel shows.
// Then it edits a node through Details and checks the edit reached the material and the history.
const prefix = window.__probeShot ?? 'studio-details';
const out = {};
// Screenshots are taken by the harness a moment after they are asked for, so give it that moment
// before the page changes again.
const snap = async (name) => {
  await shot(`${prefix}-${name}`);
  await sleep(500);
};

const details = () => q('.studioDetails');
const detailsState = () => {
  const panel = details();
  return {
    crumbs: panel?.querySelector('.detailsCrumbs')?.textContent.trim() ?? null,
    heading: panel?.querySelector('.detailsNodeHeader strong')?.textContent.trim() ?? null,
    overview: panel?.querySelector('.materialInspectorHeader') !== null,
    texture: panel?.querySelector('.detailsTexture') !== null,
    textureRows: panel?.querySelectorAll('.detailsTextureRow').length ?? 0,
    sections: [...(panel?.querySelectorAll('.uiPanelSectionTitle') ?? [])].map((n) => n.textContent.trim()),
    colourPickers: panel?.querySelectorAll('input[type="color"]').length ?? 0,
  };
};
const press = (target, point, init = {}) => {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, pointerId: 1, button: 0, buttons: 1, ...init }));
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, pointerId: 1, button: 0, ...init }));
};
const centre = (node) => {
  const box = node.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + 10 };
};
const selectedOnCanvas = () => qa('.graphNode.selected').map((n) => n.getAttribute('data-node-type'));

clickText('Model Studio');
const studio = await waitForStudio();
await sleep(2500);

// The demo kart body: two textures, a colour, vertex colour — every Details shape.
const materials = studio.materials();
const target = materials.find((entry) => entry.materialName === 'mat_body') ?? materials[0];
studio.selectMaterial(target.archivePath, target.modelName, target.materialName);
await sleep(2000);
out.material = `${target.modelName}/${target.materialName}`;
q('.graphSurface')?.focus();

// ---------------------------------------------------------------- nothing selected
out.overview = detailsState();
out.layout = {
  viewport: Math.round(q('.studioViewport')?.getBoundingClientRect().height ?? 0),
  graph: Math.round(q('.studioCenter .materialDock')?.getBoundingClientRect().height ?? 0),
  details: Math.round(details()?.getBoundingClientRect().width ?? 0),
  outlinerTitle: q('.studioOutliner h2')?.textContent.trim() ?? null,
  outlinerTitleClipped: (() => {
    const title = q('.studioOutliner h2');
    return title ? title.scrollWidth > title.clientWidth : null;
  })(),
};
await snap('01-overview');

// ---------------------------------------------------------------- a texture node, clicked
const textureCard = q('.graphNode[data-node-type="texture"]');
out.textureNodeFound = textureCard !== null;
if (textureCard) {
  press(textureCard, centre(textureCard));
  await sleep(600);
}
out.afterTextureClick = { ...detailsState(), selectedOnCanvas: selectedOnCanvas(), selectedIds: studio.selectedNodes() };
await snap('02-texture-node');

// ---------------------------------------------------------------- empty canvas: back to the material
const surface = q('.graphSurface');
if (surface) {
  const box = surface.getBoundingClientRect();
  // A corner of the canvas well away from the fitted graph.
  press(surface, { x: box.left + 14, y: box.bottom - 14 });
  await sleep(600);
}
out.afterEmptyClick = { ...detailsState(), selectedIds: studio.selectedNodes() };

// ---------------------------------------------------------------- a texture row in the overview
const row = q('.studioDetails .detailsTextureOpen');
if (row) {
  row.click();
  await sleep(900);
}
out.afterTextureRow = { ...detailsState(), selectedOnCanvas: selectedOnCanvas(), selectedIds: studio.selectedNodes() };

// The breadcrumb's material name goes back to the overview.
q('.studioDetails .detailsCrumb:not(.is-current)')?.click();
await sleep(600);
out.afterCrumb = { ...detailsState(), selectedIds: studio.selectedNodes() };

// ---------------------------------------------------------------- a colour node
const colourCard = q('.graphNode[data-node-type="constant"]') ?? q('.graphNode[data-node-type="register"]');
if (colourCard) {
  press(colourCard, centre(colourCard));
  await sleep(600);
}
out.afterColourClick = { ...detailsState(), selectedOnCanvas: selectedOnCanvas() };
await snap('03-colour-node');

// ---------------------------------------------------------------- two nodes
const cards = qa('.graphNode').filter((n) => !['output', 'comment'].includes(n.getAttribute('data-node-type')));
if (cards.length >= 2) {
  press(cards[0], centre(cards[0]));
  await sleep(200);
  press(cards[1], centre(cards[1]), { shiftKey: true });
  await sleep(600);
}
out.afterShiftClick = {
  ...detailsState(),
  multi: q('.studioDetails .detailsMulti strong')?.textContent.trim() ?? null,
  items: qa('.studioDetails .detailsMultiItem').length,
};

// ---------------------------------------------------------------- edit a node through Details
// A texture node's "Coordinates" pick is a node field: changing it has to recompile the shader,
// change the material's stages and leave an undo entry, exactly like an edit on the canvas.
const graph = studio.graph();
const textureNode = graph?.nodes.find((node) => node.type === 'texture');
if (textureNode) {
  studio.selectNodes([textureNode.id]);
  await sleep(700);
  const stagesBefore = JSON.stringify(studio.materialDoc()?.tevStages ?? []);
  const historyBefore = studio.history().undo;
  const coordinates = qa('.studioDetails select').find((n) => /coordinate|uv/i.test(n.getAttribute('aria-label') ?? ''));
  out.coordinatesSelect = coordinates?.getAttribute('aria-label') ?? null;
  if (coordinates) {
    const options = [...coordinates.options].map((o) => o.value);
    const next = options.find((value) => value !== coordinates.value);
    out.coordinatesFrom = coordinates.value;
    out.coordinatesTo = next ?? null;
    if (next !== undefined) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(coordinates, next);
      coordinates.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(1200);
    }
  }
  out.nodeEdit = {
    stagesChanged: JSON.stringify(studio.materialDoc()?.tevStages ?? []) !== stagesBefore,
    historyBefore,
    historyAfter: studio.history().undo,
    status: studio.status(),
  };
  studio.undo();
  await sleep(900);
  out.nodeEdit.stagesAfterUndoMatch = JSON.stringify(studio.materialDoc()?.tevStages ?? []) === stagesBefore;
}

// ---------------------------------------------------------------- tips
clickText('Tips');
await sleep(400);
out.tips = {
  open: q('.studioTips') !== null,
  sections: qa('.studioTips h3').map((n) => n.textContent.trim()),
};
await snap('04-tips');
document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await sleep(300);
out.tips.closedByEscape = q('.studioTips') === null;
out.tips.studioStillOpen = window.__mkwStudio !== undefined;

return out;
