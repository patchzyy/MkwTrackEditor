// Body for scripts/ui-shell-probe.mjs. Exercises "My Assets": drops a .brres file onto the
// content browser, checks the tile and its details, renames it, drags it into the viewport as
// scenery, and saves a model out of the track's own archive into the library. Run it twice: the
// second run reports what the first one left in IndexedDB (`persistedFromPreviousRun`) before
// clearing the library, which is the persistence check.
//
//   node scripts/ui-shell-probe.mjs "http://127.0.0.1:5194/?smokeTrack=/dev-tracks/Z0.szs" scripts/probe-asset-library.js
//

const prefix = window.__probePrefix ?? 'asset-library';
const report = { prefix };
const waitFor = async (predicate, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(100);
  }
  return false;
};
const tileLabels = () => qa('.assetTile').map((n) => n.querySelector('strong')?.textContent ?? '');
const clickTreeNode = (label) => {
  const node = qa('.browserFolders [role="treeitem"]').find((n) => n.textContent.trim().startsWith(label));
  if (node) node.click();
  return !!node;
};
const activeMode = () =>
  qa('.topBarCenter [aria-checked="true"], .topBarCenter [aria-pressed="true"], .topBarCenter .active')
    .map((n) => n.textContent.trim())
    .join(',');

// ------------------------------------------------------------------ what the last run left behind

await waitFor(() => qa('.assetTile').length > 0, 20000);
report.libraryFolderPresent = clickTreeNode('Custom models');
await sleep(400);
report.persistedFromPreviousRun = tileLabels();
for (let i = 0; i < 20 && q('[data-testid="library-actions"]') === null && qa('.assetTile').length > 0; i++) {
  qa('.assetTile')[0].click();
  await sleep(100);
}
while (qa('.assetTile').length > 0) {
  qa('.assetTile')[0].click();
  await sleep(150);
  const remove = qa('[data-testid="library-actions"] button').find((n) => n.textContent.trim() === 'Remove');
  if (!remove) break;
  remove.click();
  await sleep(250);
}
report.emptyState = !!q('[data-testid="library-empty"]');
await shot(`${prefix}-01-empty`);

// ------------------------------------------------------------------ drop a .brres file

const response = await fetch('/data/MarioKartWii/Race/Course/Object/kuribo.brres');
const bytes = new Uint8Array(await response.arrayBuffer());
const file = new File([bytes], 'kuribo.brres', { type: 'application/octet-stream' });
const transfer = new DataTransfer();
transfer.items.add(file);
const browser = q('.contentBrowser');
browser.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
await sleep(150);
report.dropOverlay = !!q('.browserDropOverlay');
browser.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
report.tileAppeared = await waitFor(() => qa('.assetTile').some((n) => n.textContent.includes('kuribo')), 15000);
await sleep(800);
const tile = qa('.assetTile').find((n) => n.textContent.includes('kuribo'));
tile?.click();
await sleep(300);
report.tile = {
  label: tile?.querySelector('strong')?.textContent ?? null,
  caption: tile?.querySelector('span')?.textContent ?? null,
  hasThumbnail: !!tile?.querySelector('.objectPreview img'),
  draggable: tile?.getAttribute('draggable') === 'true',
  facts: qa('.browserDetailsFact').map((n) => `${n.querySelector('dt')?.textContent}: ${n.querySelector('dd')?.textContent}`),
  actions: qa('[data-testid="library-actions"] button').map((n) => n.textContent.trim()),
  status: q('.uiStatusMessage')?.textContent ?? null,
};
await shot(`${prefix}-02-imported`);

// ------------------------------------------------------------------ rename

const rename = q('.browserRenameInput');
if (rename) {
  rename.focus();
  rename.value = 'Goomba (custom)';
  rename.dispatchEvent(new Event('input', { bubbles: true }));
  rename.blur();
  // Automation windows do not always hold focus, so make sure React sees the blur.
  rename.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  await sleep(400);
}
report.renamed = tileLabels().includes('Goomba (custom)');

// ------------------------------------------------------------------ drag into the viewport

const dragTile = qa('.assetTile').find((n) => n.textContent.includes('Goomba (custom)')) ?? tile;
const dragTransfer = new DataTransfer();
dragTile.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dragTransfer }));
report.dragPayload = dragTransfer.getData('application/mkw-library-asset');
const canvas = q('.viewport canvas');
const rect = canvas.getBoundingClientRect();
const at = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height * 0.6 };
const statusBefore = q('.uiStatusMessage')?.textContent ?? null;
canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dragTransfer, ...at }));
canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dragTransfer, ...at }));
report.placedStatusChanged = await waitFor(() => (q('.uiStatusMessage')?.textContent ?? null) !== statusBefore, 5000);
await sleep(1500);
report.placed = {
  status: q('.uiStatusMessage')?.textContent ?? null,
  mode: activeMode(),
  placedRows: qa('.modelOutlinerName').map((n) => n.textContent).filter((t) => t.includes('Goomba')),
};
await shot(`${prefix}-03-placed`);

// ------------------------------------------------------------------ save a model out of the track archive

report.trackFolder = clickTreeNode('Track meshes');
await sleep(400);
const courseTile = qa('.assetTile').find((n) => n.textContent.includes('Course Model')) ?? qa('.assetTile')[0];
courseTile?.click();
await sleep(300);
report.trackAsset = {
  label: courseTile?.querySelector('strong')?.textContent ?? null,
  modelRows: qa('.browserDetailsModelRow span').map((n) => n.textContent),
  buttons: qa('[data-testid="track-asset-actions"] .browserDetailsButtons button').map((n) => n.textContent.trim()),
};
const saveModel = q('.browserDetailsModelRow button[aria-label^="Save "]');
saveModel?.click();
report.savedModelToLibrary = await waitFor(
  () => qa('.browserFolders [role="treeitem"][aria-selected="true"]').some((n) => n.textContent.includes('Custom models')),
  20000,
);
await sleep(800);
report.libraryTiles = tileLabels();
report.saveStatus = q('.uiStatusMessage')?.textContent ?? null;
await shot(`${prefix}-04-saved-model`);
await sleep(1200);
return report;
