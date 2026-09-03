// Body for scripts/ui-shell-probe.mjs. Walks the redesigned shell: top bar + File menu,
// the dock rails, every editor mode, and the content browser (folder tree, tile grid,
// thumbnails, details pane). Reports what it found so the numbers can be asserted from Node.
//
//   node scripts/ui-shell-probe.mjs "http://127.0.0.1:5185/?track=/dev-tracks/Z0.szs" scripts/probe-ui-shell.js

const prefix = window.__probePrefix ?? 'ui-shell';
const report = { prefix };

const clickIn = (sel, text) => {
  const node = qa(sel).find((n) => n.textContent.trim().toLowerCase().includes(text.toLowerCase()));
  if (node) node.click();
  return !!node;
};

// ---------------------------------------------------------------- shell chrome

report.topBar = {
  brand: q('.brand .brandName')?.textContent ?? null,
  trackName: q('.topBarTrackName')?.textContent ?? null,
  modes: qa('.topBarCenter .uiSegment').map((n) => n.textContent.trim()),
};
report.statusBar = {
  message: q('.uiStatusMessage')?.textContent ?? null,
  tone: q('.uiStatusMessage')?.dataset.tone ?? null,
  stats: qa('.uiStatusStat').map((n) => n.textContent.trim()),
};
// No debug jargon in the chrome the user always sees.
const chromeText = [q('.topBar')?.textContent ?? '', q('.uiStatusBar')?.textContent ?? ''].join(' ');
report.jargon = ['ENPH', 'CKPH', 'ITPH', 'GOBJ', 'POTI', 'STGI', 'undefined', 'NaN', '[object'].filter((word) => chromeText.includes(word));

await shot(`${prefix}-01-kmp`);
await sleep(700);

// File menu opens, lists Open / Import / Export and a recent-tracks section.
clickIn('.topBarLeft button', 'File');
await sleep(180);
report.fileMenu = qa('.uiMenu .uiMenuItem').map((n) => n.textContent.trim());
report.fileMenuSections = qa('.uiMenu .uiMenuSectionTitle').map((n) => n.textContent.trim());
await shot(`${prefix}-02-file-menu`);
await sleep(700);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await sleep(150);
if (q('.uiMenu')) q('.uiMenu').parentElement?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
await sleep(120);

// ---------------------------------------------------------------- content browser

const folderRows = () => qa('.browserFolders .uiTreeRow');
report.browser = {
  groups: folderRows()
    .filter((n) => n.getAttribute('aria-level') === '1')
    .map((n) => n.querySelector('.uiTreeLabel')?.textContent ?? ''),
  folders: folderRows()
    .filter((n) => n.getAttribute('aria-level') === '2')
    .map((n) => `${n.querySelector('.uiTreeLabel')?.textContent} (${n.querySelector('.uiTreeDetail')?.textContent})`),
};

// Thumbnails: how many tiles have a real rendered preview image vs the fallback.
const tileStats = () => {
  const tiles = qa('.assetStrip .assetTile');
  const previews = qa('.assetStrip .assetTile .objectPreview[data-preview="image"] img');
  return {
    tiles: tiles.length,
    withImage: previews.length,
    decoded: previews.filter((img) => img.naturalWidth > 4 && img.naturalHeight > 4).length,
    nonBlank: previews.filter((img) => img.naturalWidth >= 32).length,
    missing: qa('.assetStrip .objectPreview[data-state="missing"]').length,
    pending: qa('.assetStrip .uiSkeleton').length,
  };
};

// Favourites folder first.
const favourites = folderRows().find((n) => n.textContent.includes('Favourites'));
if (favourites) favourites.click();
await sleep(900);
report.favourites = tileStats();

// Click a tile: the details pane must describe it.
const firstTile = q('.assetStrip .assetTile');
if (firstTile) firstTile.click();
await sleep(220);
report.details = {
  title: q('.browserDetailsTitle')?.textContent ?? null,
  caption: q('.browserDetailsCaption')?.textContent ?? null,
  facts: qa('.browserDetailsFact').map((n) => `${n.querySelector('dt')?.textContent}: ${n.querySelector('dd')?.textContent}`),
  hint: q('.browserDetailsHint')?.textContent ?? null,
  largeThumbnail: !!q('.browserDetails .thumbnailLarge'),
};
report.draggableTiles = qa('.assetStrip .assetTile[draggable="true"]').length;
await shot(`${prefix}-03-content-browser`);
await sleep(700);

// All objects: the big folder, where broken thumbnails would show up.
const allObjects = folderRows().find((n) => n.textContent.includes('All objects'));
if (allObjects) allObjects.click();
await sleep(2500);
report.allObjects = tileStats();
await shot(`${prefix}-04-all-objects`);
await sleep(700);

// Search narrows the grid.
const search = q('.browserSearchInput');
if (search) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(search, 'tree');
  search.dispatchEvent(new Event('input', { bubbles: true }));
}
await sleep(500);
report.search = { query: q('.browserSearchInput')?.value ?? null, tiles: qa('.assetStrip .assetTile').length };
if (search) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(search, '');
  search.dispatchEvent(new Event('input', { bubbles: true }));
}
await sleep(300);

// This track: the loaded track's own asset files.
const trackFolder = folderRows().find((n) => n.textContent.includes('Track meshes'));
if (trackFolder) trackFolder.click();
await sleep(400);
report.trackMeshes = { tiles: qa('.assetStrip .assetTile').length, first: q('.assetStrip .assetTile strong')?.textContent ?? null };

// ---------------------------------------------------------------- docks

const railBefore = qa('.uiPanelRail').length;
const leftToggle = qa('.topBarRight button').find((n) => (n.getAttribute('aria-label') ?? '').includes('left panel'));
if (leftToggle) leftToggle.click();
await sleep(300);
const inspectorToggle = qa('.topBarRight button').find((n) => (n.getAttribute('aria-label') ?? '').includes('inspector'));
if (inspectorToggle) inspectorToggle.click();
await sleep(300);
report.rails = {
  before: railBefore,
  after: qa('.uiPanelRail').length,
  labels: qa('.uiPanelRailLabel').map((n) => n.textContent.trim()),
};
await shot(`${prefix}-05-docks-collapsed`);
await sleep(900);
if (leftToggle) leftToggle.click();
if (inspectorToggle) inspectorToggle.click();
await sleep(400);
report.railsRestored = qa('.uiPanelRail').length;

// ---------------------------------------------------------------- modes

const modeShot = async (label, name) => {
  clickText(label);
  await sleep(1400);
  const left = q('.placeAssetsPanel');
  await shot(`${prefix}-${name}`);
  // The driver drains queued screenshots from Node on a 120ms poll, so give it time to
  // capture this mode before the next click changes the page.
  await sleep(700);
  return {
    leftPanel: left ? left.className : null,
    leftHeading: left?.querySelector('h2')?.textContent ?? null,
    inspectorHeading: q('.inspector h2')?.textContent ?? null,
    inspectorHasContent: (q('.inspector .paneBody')?.textContent ?? '').trim().length > 0,
  };
};

report.modes = {};
report.modes.camera = await modeShot('Camera', '06-camera');
report.modes.model = await modeShot('Model', '07-model');
report.modes.visual = await modeShot('Visual', '08-visual');
report.modes.kmp = await modeShot('KMP', '09-kmp');

// ---------------------------------------------------------------- shortcuts sheet

window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
await sleep(300);
report.shortcuts = {
  open: !!q('.uiShortcutSheet'),
  groups: qa('.uiShortcutGroup h3').map((n) => n.textContent.trim()),
  rows: qa('.uiShortcutRow').length,
};
await shot(`${prefix}-10-shortcuts`);
await sleep(700);
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await sleep(200);
report.shortcutsClosed = !q('.uiShortcutSheet');

report.viewportAlive = window.__mkwViewport.listMeshes().length;
return report;
