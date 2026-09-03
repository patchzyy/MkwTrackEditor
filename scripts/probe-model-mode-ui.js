// Probe body for scripts/viewport-dev-probe.mjs: drives Model mode through its real UI.
//
// Everything here goes through the buttons and fields a user would touch — the outliner rows,
// the inspector's number fields and action buttons, the object picker — and then checks the
// renderer agrees. The dev hook is used only to read state back and to grab frames.

// UI redesign note: the shared `NumberInput` primitive renders
// `<input type="text" inputMode="decimal" role="spinbutton">` rather than a native number
// input, so it can support drag-to-scrub and a comma decimal separator. The inspector-field
// selectors below therefore accept either shape.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rect = () => canvasRect();
const px = (fx, fy) => { const r = rect(); return [r.left + r.width * fx, r.top + r.height * fy]; };
const buttons = () => [...document.querySelectorAll('button')];
const byText = (text) => buttons().find((b) => b.textContent.trim().toLowerCase().includes(text.toLowerCase()));
const log = [];
const note = (message) => { log.push(message); };

function setReactInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Reads the rendered frame back as pixels, so a change can be measured rather than eyeballed. */
async function framePixels() {
  const url = await mkw.captureFrame();
  if (!url) return null;
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

/** Share of pixels that differ between two frames. */
function frameDifference(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 8 || Math.abs(a[i + 1] - b[i + 1]) > 8 || Math.abs(a[i + 2] - b[i + 2]) > 8) changed++;
  }
  return changed / (a.length / 4);
}

function clickAt(clientX, clientY) {
  const canvas = document.querySelector('canvas');
  const base = { bubbles: true, cancelable: true, clientX, clientY, button: 0, pointerId: 1, isPrimary: true, pointerType: 'mouse' };
  canvas.dispatchEvent(new PointerEvent('pointerdown', base));
  canvas.dispatchEvent(new PointerEvent('pointerup', base));
  canvas.dispatchEvent(new MouseEvent('click', base));
}

// --- 1. Enter Model mode through the top bar -------------------------------
byText('Model')?.click();
await sleep(900);
const outliner = document.querySelector('.modelOutliner');
if (!outliner) return { error: 'model outliner did not render', log };
const rows = [...outliner.querySelectorAll('.modelOutlinerRow')];
note(`outliner rendered with ${rows.length} rows`);
if (rows.length === 0) return { error: 'outliner has no meshes', log };

// --- 2. Click track geometry in the viewport -------------------------------
// Aim at the smallest thing on screen: a big ground plane makes an unreadable screenshot, and
// a small prop is the case the "smart selection" is actually for.
mkw.setMeshGranularity('component');
let best = null;
for (let i = 1; i < 24; i++)
  for (let j = 1; j < 16; j++) {
    const fx = i / 24;
    const fy = j / 16;
    const pick = mkw.pickMeshAt(...px(fx, fy));
    if (!pick) continue;
    const bounds = mkw.getMeshBounds(pick);
    if (!bounds || bounds.triangleCount < 8) continue;
    if (!best || bounds.radius < best.bounds.radius) best = { pick, bounds, fx, fy };
  }
if (!best) return { error: 'nothing pickable in the viewport', log };
note(`smallest pickable piece: radius ${Math.round(best.bounds.radius)}, ${best.bounds.triangleCount} triangles`);

clickAt(...px(best.fx, best.fy));
await sleep(600);
const pickedSelection = mkw.getSelectedMesh();
const inspectorTitle = document.querySelector('.modelInspector h2')?.textContent ?? '';
note(`viewport click selected "${inspectorTitle}" (${pickedSelection.length} in renderer)`);
if (pickedSelection.length === 0) return { error: 'viewport click did not select a mesh', log };

mkw.frameMeshSelection();
await sleep(1400);
await shot('model-ui-01-picked');

// --- 3. Move it with the inspector's number fields --------------------------
const boundsBefore = mkw.getMeshBounds(pickedSelection[0].target);
const vectorInputs = [...document.querySelectorAll('.modelInspector .propertyGrid input[type="number"], .modelInspector .propertyGrid input[role="spinbutton"]')];
note(`inspector exposes ${vectorInputs.length} number fields`);
if (vectorInputs.length < 3) return { error: 'inspector has no transform fields', log };
// Enough to see, not so much that the mesh leaves the frame.
const lift = Math.min(4000, Math.max(300, Math.round(boundsBefore.radius * 1.5)));
setReactInput(vectorInputs[1], lift); // position offset Y
await sleep(900);
const boundsAfter = mkw.getMeshBounds(pickedSelection[0].target);
const movedBy = boundsAfter.center.y - boundsBefore.center.y;
note(`moved by ${movedBy.toFixed(1)} (asked for ${lift})`);
await shot('model-ui-02-moved');

// --- 4. Hide, then restore --------------------------------------------------
byText('Hide')?.click();
await sleep(800);
await shot('model-ui-03-hidden');
const hiddenLabel = byText('Show') ? 'Show' : null;
byText('Show')?.click();
await sleep(600);

byText('Restore')?.click();
await sleep(800);
const boundsRestored = mkw.getMeshBounds(pickedSelection[0].target);
const restoredDelta = Math.abs(boundsRestored.center.y - boundsBefore.center.y);
note(`restore returned the mesh to within ${restoredDelta.toFixed(2)} units of where it started`);

// --- 5. Move it again and keep it moved for the screenshot ------------------
const fields = [...document.querySelectorAll('.modelInspector .propertyGrid input[type="number"], .modelInspector .propertyGrid input[role="spinbutton"]')];
setReactInput(fields[1], lift);
await sleep(900);
await shot('model-ui-04-moved-again');

// --- 6. Duplicate, and check the copy is really drawn -----------------------
// Reselect the mesh (Restore/Show may have changed which row the inspector shows).
clickAt(...px(best.fx, best.fy));
await sleep(500);
byText('Duplicate')?.click();
await sleep(1200);
const placedRows = [...document.querySelectorAll('.modelOutliner .modelOutlinerRow')].filter((r) => r.textContent.includes('copy'));
note(`duplicate produced ${placedRows.length} "copy" row(s) in the outliner`);
// Lift the copy well clear of the original so the screenshot shows two of them.
const copyFields = [...document.querySelectorAll('.modelInspector .propertyGrid input[type="number"], .modelInspector .propertyGrid input[role="spinbutton"]')];
if (copyFields.length >= 3) { setReactInput(copyFields[1], Math.round(lift * 1.5)); await sleep(900); }
// Point the camera at the original, so the copy sits just above it in frame.
mkw.selectMeshAt(...px(best.fx, best.fy), false);
mkw.frameMeshSelection();
await sleep(1400);
await shot('model-ui-07-duplicated');

// Prove the copy is really being drawn: toggle it off and on and measure the frame.
const copyRow = [...document.querySelectorAll('.modelOutliner li')].find((li) => li.textContent.includes('copy'));
const copyEye = copyRow ? copyRow.querySelector('.modelRowAction') : null;
let copyPixelShare = null;
if (copyEye) {
  const withCopy = await framePixels();
  copyEye.click();
  await sleep(1200);
  const withoutCopy = await framePixels();
  copyPixelShare = frameDifference(withCopy, withoutCopy);
  note(`hiding the copy changed ${(copyPixelShare * 100).toFixed(2)}% of the rendered pixels`);
  copyEye.click();
  await sleep(1000);
}

// --- 7. Place an object as scenery -------------------------------------------
byText('Place an object as scenery')?.click();
await sleep(600);
const picker = document.querySelector('.modelPlacePanel');
const options = picker ? [...picker.querySelectorAll('.modelPlaceItem')] : [];
note(`object picker offered ${options.length} models`);
let placedLabel = null;
if (options.length > 0) {
  const search = picker.querySelector('input[type="search"]');
  if (search) { setReactInput(search, 'itembox'); await sleep(400); }
  const shortlist = [...picker.querySelectorAll('.modelPlaceItem')];
  const choice = shortlist[0] ?? options[0];
  placedLabel = choice.textContent.trim();
  choice.click();
  await sleep(2500);
}
const importedInstances = mkw.listImportedMeshes();
note(`renderer now holds ${importedInstances.length} imported model instance(s)`);
await sleep(600);
await shot('model-ui-05-placed-object');

// Same check for the placed object: toggling it has to change what is on screen.
const placedRow = [...document.querySelectorAll('.modelOutliner li')].find((li) => li.textContent.includes('Item Box'));
const placedEye = placedRow ? placedRow.querySelector('.modelRowAction') : null;
let placedPixelShare = null;
if (placedEye) {
  const withObject = await framePixels();
  placedEye.click();
  await sleep(1200);
  const withoutObject = await framePixels();
  placedPixelShare = frameDifference(withObject, withoutObject);
  note(`hiding the placed object changed ${(placedPixelShare * 100).toFixed(2)}% of the rendered pixels`);
  placedEye.click();
  await sleep(1000);
}

// --- 8. Selecting from the outliner drives the viewport ----------------------
const meshRows = [...document.querySelectorAll('.modelOutliner .modelOutlinerRow')];
const target = meshRows[meshRows.length - 1];
const targetName = target.textContent.trim();
target.click();
await sleep(700);
const outlinerSelection = mkw.getSelectedMesh();
note(`clicking outliner row "${targetName}" gave the renderer ${outlinerSelection.length} selection(s)`);
mkw.frameMeshSelection();
await sleep(1200);
await shot('model-ui-06-outliner-selection');

// --- 9. Undo takes the geometry edits back off ------------------------------
// Mesh edits live on the track document, so the shell's own undo has to cover them.
mkw.selectMeshAt(...px(best.fx, best.fy), false);
await sleep(400);
const beforeUndo = mkw.getMeshBounds(pickedSelection[0].target);
const undoButton = document.querySelector('button[aria-label="Undo"]');
let undoSteps = 0;
for (let i = 0; i < 12 && undoButton && !undoButton.disabled; i++) {
  undoButton.click();
  undoSteps++;
  await sleep(350);
}
await sleep(900);
const afterUndo = mkw.getMeshBounds(pickedSelection[0].target);
const undoReturnedTo = Math.abs(afterUndo.center.y - boundsBefore.center.y);
const undoMovedBy = Math.abs(afterUndo.center.y - beforeUndo.center.y);
const placedAfterUndo = [...document.querySelectorAll('.modelOutliner .modelOutlinerRow')].filter((r) => r.textContent.includes('copy')).length;
note(`${undoSteps} undo steps moved the mesh ${undoMovedBy.toFixed(1)} units, back to within ${undoReturnedTo.toFixed(2)} of its original place`);
note(`after undo the outliner lists ${placedAfterUndo} copies and the renderer ${mkw.listImportedMeshes().length} imported instance(s)`);
await shot('model-ui-08-after-undo');

return {
  ok: true,
  outlinerRows: rows.length,
  pickedLabel: inspectorTitle,
  askedToMove: lift,
  actuallyMoved: Number(movedBy.toFixed(1)),
  restoredWithin: Number(restoredDelta.toFixed(2)),
  hideButtonBecame: hiddenLabel,
  duplicateRows: placedRows.length,
  placeOptions: options.length,
  placedLabel,
  importedInstances: importedInstances.length,
  copyPixelShare,
  placedPixelShare,
  outlinerSelectionCount: outlinerSelection.length,
  undoSteps,
  undoMovedBy: Number(undoMovedBy.toFixed(1)),
  undoReturnedTo: Number(undoReturnedTo.toFixed(2)),
  copiesAfterUndo: placedAfterUndo,
  importedAfterUndo: mkw.listImportedMeshes().length,
  log,
};
