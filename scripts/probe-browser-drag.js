// Body for scripts/ui-shell-probe.mjs. Proves drag-to-place still works from the rebuilt
// content browser: drags an object tile and a track-data tile onto the viewport and checks
// the track gained the matching record.
//
//   node scripts/ui-shell-probe.mjs "http://127.0.0.1:5188/?track=/dev-tracks/Z0.szs" scripts/probe-browser-drag.js

const out = {};

const folderRows = () => qa('.browserFolders .uiTreeRow');
const openFolder = (name) => {
  const row = folderRows().find((n) => n.textContent.includes(name));
  if (row) row.click();
  return !!row;
};

/** Runs a full HTML5 drag from a tile to the middle of the viewport canvas. */
function dragTileToViewport(tile) {
  const canvas = document.querySelector('.viewport canvas');
  const rect = canvas.getBoundingClientRect();
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);
  const dataTransfer = new DataTransfer();
  const fire = (target, type, extra = {}) =>
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y, ...extra }));
  fire(tile, 'dragstart');
  fire(canvas, 'dragover');
  fire(canvas, 'drop');
  fire(tile, 'dragend');
  return { types: [...dataTransfer.types], x, y };
}

const countObjects = () => window.__mkwViewport.listMeshes().length;
const trackRecords = () => {
  const text = q('.uiStatusStat')?.textContent ?? '';
  return Number(text.replace(/\D+/g, '')) || null;
};

out.before = { records: trackRecords(), meshes: countObjects() };

// ---------------------------------------------------------------- an object

openFolder('Favourites');
await sleep(1500);
const objectTile = qa('.assetStrip .assetTile[draggable="true"]')[0];
out.objectTile = objectTile?.querySelector('strong')?.textContent ?? null;
out.objectDrag = objectTile ? dragTileToViewport(objectTile) : null;
await sleep(900);
out.afterObject = { records: trackRecords(), meshes: countObjects() };
out.objectPlaced = out.afterObject.records !== null && out.before.records !== null && out.afterObject.records > out.before.records;
out.statusAfterObject = q('.uiStatusMessage')?.textContent ?? null;
await shot('drag-01-object-placed');

// ---------------------------------------------------------------- a track-data point

openFolder('Points and routes');
await sleep(600);
const pointTile = qa('.assetStrip .assetTile[draggable="true"]').find((tile) => tile.textContent.includes('Respawn'));
out.pointTile = pointTile?.querySelector('strong')?.textContent ?? null;
out.pointDrag = pointTile ? dragTileToViewport(pointTile) : null;
await sleep(900);
out.afterPoint = { records: trackRecords() };
out.pointPlaced = out.afterPoint.records !== null && out.afterObject.records !== null && out.afterPoint.records > out.afterObject.records;
out.statusAfterPoint = q('.uiStatusMessage')?.textContent ?? null;
await shot('drag-02-point-placed');

// ---------------------------------------------------------------- undo puts it back

const undo = qa('.topBarLeft button').find((n) => (n.getAttribute('aria-label') ?? '') === 'Undo');
out.undoEnabled = undo ? !undo.disabled : null;
if (undo) undo.click();
await sleep(500);
if (undo) undo.click();
await sleep(500);
out.afterUndo = { records: trackRecords() };
out.undoRestored = out.afterUndo.records === out.before.records;

return out;
