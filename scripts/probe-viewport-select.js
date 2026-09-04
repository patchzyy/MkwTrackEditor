// Probe body for scripts/viewport-input-probe.mjs — the "clicking selects" half of the mouse
// model, driven with real browser mouse input (CDP `Input.dispatchMouseEvent`).
//
// Covers the first user report: "sometimes when clicking, the movement takes over instead of
// selecting a model. Other people were unable to select models since it kept capturing their
// cursor."
//
//   a) Model mode: ten clicks at ten places each change the selection, never lock the pointer
//      and never move the camera.
//   b) KMP mode: clicking an object selects it, clicking the sky deselects, left-drag on empty
//      space turns the camera without pointer lock, right-drag turns the camera and gives the
//      lock back.

const results = { track: await evaluate('document.title') };
const rectOf = () => evaluate('JSON.stringify(window.__canvasRect())');
const rect = JSON.parse(await rectOf());
const px = (fx, fy) => [rect.left + rect.width * fx, rect.top + rect.height * fy];
const lock = () => evaluate('document.pointerLockElement ? (document.pointerLockElement.tagName + "." + document.pointerLockElement.className) : null');
const cam = () => evaluate('window.__mkwViewport.getCameraMatrix().map((v) => v.toFixed(4)).join(",")');
const cursor = () => evaluate('JSON.stringify({ canvas: document.querySelector(".viewport canvas").dataset.cursor ?? null, body: document.body.style.cursor })');

// ---------------------------------------------------------------- a) Model mode clicks
await evaluate(`window.__clickText('Model')`);
await sleep(2000);

// Find ten screen points that each hit a *different* mesh, so "the selection changed" means
// something. `pickMeshAt` is read-only, so scanning cannot disturb the camera or the selection.
// One pass over the canvas, then ten well-separated hits are chosen from it in Node. Scanning is
// the expensive part (a ray/triangle pick per sample), so it is done once.
const scanHits = () => evaluate(`(() => {
  const r = window.__canvasRect();
  const hits = [];
  for (let sy = 0.08; sy <= 0.95; sy += 0.02) {
    for (let sx = 0.03; sx <= 0.97; sx += 0.02) {
      const x = Math.round(r.left + r.width * sx), y = Math.round(r.top + r.height * sy);
      const pick = window.__mkwViewport.pickMeshAt(x, y);
      if (pick) hits.push([x, y, pick.drawOpIndex + ':' + pick.componentIndex]);
    }
  }
  return hits;
})()`);

const chooseSpots = (hits) => {
  for (const gap of [140, 90, 55, 30, 0]) {
    const seen = new Set();
    const out = [];
    for (const [x, y, key] of hits) {
      if (seen.has(key)) continue;
      if (out.some(([ox, oy]) => Math.hypot(ox - x, oy - y) <= gap)) continue;
      seen.add(key);
      out.push([x, y, key]);
      if (out.length === 10) return out;
    }
    if (out.length === 10) return out;
    if (gap === 0) return out;
  }
  return [];
};

// The opening view is the start line, which on some courses is one road mesh; dolly in until ten
// different meshes are reachable.
let spots = chooseSpots(await scanHits());
let dollies = 0;
while (spots.length < 10 && dollies < 6) {
  const [tx, ty] = px(0.5, 0.5);
  for (let i = 0; i < 2; i++) await mouse.wheel(tx, ty, -240);
  dollies++;
  await sleep(500);
  const next = chooseSpots(await scanHits());
  if (next.length > spots.length) spots = next;
}
results.cameraDollies = dollies;
results.spotCount = spots.length;
const camBeforeClicks = await cam();
const clicks = [];
let lockedAnywhere = false;
for (const [x, y, wanted] of spots) {
  // The selected mesh's gizmo covers real pixels: a click that lands on a handle belongs to the
  // gizmo, not to a new pick. Note it so the assertion below can allow for it.
  const handleAt = await evaluate(`(() => { const p = window.__mkwViewport.pickHandleAt(${x}, ${y}); return p ? p.kind : null; })()`);
  await mouse.down(x, y);
  if (await lock()) lockedAnywhere = true;
  await mouse.up(x, y);
  await sleep(220);
  if (await lock()) lockedAnywhere = true;
  clicks.push({
    at: [x, y],
    selection: await evaluate('window.__mkwViewport.getSelectedMesh().map((e) => e.label)'),
    selectionKey: await evaluate('window.__mkwViewport.getSelectedMesh().map((e) => e.target.drawOpIndex + ":" + e.target.componentIndex).join()'),
    wanted,
    handleAt,
    cameraMoved: (await cam()) !== camBeforeClicks,
  });
}
results.modelClicks = clicks;
results.modelPointerLockedDuringClicks = lockedAnywhere;
results.modelCameraUnchangedByClicks = clicks.every((c) => c.cameraMoved === false);
results.modelDistinctSelections = new Set(clicks.map((c) => c.selectionKey)).size;
results.modelEverySelectionChanged = clicks.every((c, i) => i === 0 || c.selectionKey !== clicks[i - 1].selectionKey);
const isGizmoHandle = (kind) => kind === 'axis' || kind === 'plane' || kind === 'center';
results.modelClicksOnGizmoHandles = clicks.filter((c) => isGizmoHandle(c.handleAt)).length;
results.modelEveryClickSelectedWhatWasUnderIt = clicks.every((c) => c.selectionKey === c.wanted || isGizmoHandle(c.handleAt));
results.cursorAfterClicks = JSON.parse(await cursor());
await shot('viewport-select-01-model-clicks');

// ---------------------------------------------------------------- b) KMP mode
// Back to the perspective free camera, so the right-drag below is a first-person look.
await evaluate('document.querySelector(".viewport canvas").focus()');
await key('1', { code: 'Numpad1', keyCode: 97, location: 3 });
await sleep(1500);
await evaluate(`window.__clickText('KMP')`);
await sleep(1800);

// Find an object marker to click by scanning the overlay picker.
const marker = await evaluate(`(() => {
  const r = window.__canvasRect();
  for (let sy = 0.1; sy <= 0.9; sy += 0.02) {
    for (let sx = 0.05; sx <= 0.95; sx += 0.02) {
      const x = r.left + r.width * sx, y = r.top + r.height * sy;
      const p = window.__mkwViewport.pickHandleAt(x, y);
      if (p && p.kind === 'point') return { x, y, id: p.id };
    }
  }
  return null;
})()`);
results.kmpMarker = marker;

const selectedId = () => evaluate('JSON.stringify(window.__mkwSelection ?? null)');
if (marker) {
  await mouse.click(marker.x, marker.y);
  await sleep(500);
  results.kmpSelectedAfterMarkerClick = await evaluate(`(() => {
    const hud = document.querySelector('.selectionHud');
    return hud ? hud.textContent.trim() : null;
  })()`);
  results.kmpLockAfterMarkerClick = await lock();
}

// Clicking the sky deselects.
const [skyX, skyY] = px(0.5, 0.06);
await mouse.click(skyX, skyY);
await sleep(500);
results.kmpSelectedAfterSkyClick = await evaluate(`(() => {
  const hud = document.querySelector('.selectionHud');
  return hud ? hud.textContent.trim() : null;
})()`);

// Left-drag on empty space: the camera turns, no pointer lock, cursor stays the user's.
const camBeforeLeftDrag = await cam();
await mouse.down(skyX, skyY);
await mouse.move(skyX + 40, skyY + 10, { button: 'left' });
await sleep(60);
results.lockDuringLeftDrag = await lock();
results.cursorDuringLeftDrag = JSON.parse(await cursor());
for (let i = 2; i <= 8; i++) await mouse.move(skyX + 40 * i, skyY + 10 * i, { button: 'left' });
await sleep(120);
const camAfterLeftDrag = await cam();
await mouse.up(skyX + 320, skyY + 80);
await sleep(300);
results.leftDragTurnedCamera = camBeforeLeftDrag !== camAfterLeftDrag;
results.lockAfterLeftDrag = await lock();
results.cursorAfterLeftDrag = JSON.parse(await cursor());
await shot('viewport-select-02-left-drag-look');

// Right-drag: mouse look, and the lock is handed back on release.
const [midX, midY] = px(0.5, 0.5);
const camBeforeRightDrag = await cam();
await mouse.down(midX, midY, { button: 'right' });
await sleep(180);
results.lockDuringRightDrag = await lock();
for (let i = 1; i <= 8; i++) await mouse.move(midX - 25 * i, midY + 8 * i, { button: 'right' });
await sleep(150);
const camAfterRightDrag = await cam();
await mouse.up(midX - 200, midY + 64, { button: 'right' });
await sleep(400);
results.rightDragTurnedCamera = camBeforeRightDrag !== camAfterRightDrag;
results.lockAfterRightDrag = await lock();
results.cursorAfterRightDrag = JSON.parse(await cursor());
await shot('viewport-select-03-right-drag-look');

// The viewport must still be usable: one more click has to select something again.
await evaluate(`window.__clickText('Model')`);
await sleep(1500);
const again = await evaluate(`(() => {
  const r = window.__canvasRect();
  for (let sy = 0.2; sy <= 0.9; sy += 0.03)
    for (let sx = 0.1; sx <= 0.9; sx += 0.03) {
      const x = r.left + r.width * sx, y = r.top + r.height * sy;
      if (window.__mkwViewport.pickMeshAt(x, y)) return [x, y];
    }
  return null;
})()`);
if (again) await mouse.click(again[0], again[1]);
await sleep(500);
results.selectionStillWorksAfterCameraGestures = (await evaluate('window.__mkwViewport.getSelectedMesh().length')) > 0;
results.finalLock = await lock();
results.finalPointerState = JSON.parse(await evaluate('JSON.stringify(window.__mkwViewport.getPointerState())'));

return results;
