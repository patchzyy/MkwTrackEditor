// Probe body for scripts/camera-ui-probe.mjs: proves a CAME view-point handle can be grabbed and
// dragged in the 3D viewport, and that the drag lands in the document (and undoes cleanly).
clickText('Camera');
await sleep(1500);
qa('.cameraRow')[0].click();
await sleep(1600);

const canvas = q('.viewport canvas');
const rect = canvas.getBoundingClientRect();
let targetIndex = 0;
const viewOf = (which) => {
  const g = mkw.getCameraOverlay().cameraGizmos.find((c) => c.index === targetIndex);
  return which === 'end' ? g.viewEnd : g.viewStart;
};

// Scan the canvas for the "start" view-point handle. `pickHandleAt` is a read-only query, so the
// scan cannot disturb the camera or the selection.
let hit = null;
for (let sy = 0.08; sy <= 0.92 && !hit; sy += 0.02) {
  for (let sx = 0.04; sx <= 0.96; sx += 0.02) {
    const x = rect.left + rect.width * sx;
    const y = rect.top + rect.height * sy;
    const pick = mkw.pickHandleAt(x, y);
    if (pick && pick.kind === 'cameraViewPoint') { hit = { x, y, pick }; break; }
  }
}
if (!hit) return { found: false };

// Measure the camera whose handle we actually grabbed.
targetIndex = Number(hit.pick.id.replace('CAME-', ''));
const before = viewOf(hit.pick.which);

// One real pointer drag on the handle.
const opts = (x, y) => ({ pointerId: 1, isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true });
canvas.setPointerCapture = () => {};
canvas.releasePointerCapture = () => {};
canvas.dispatchEvent(new PointerEvent('pointerdown', opts(hit.x, hit.y)));
await sleep(120);
for (let step = 1; step <= 6; step++) {
  canvas.dispatchEvent(new PointerEvent('pointermove', opts(hit.x + step * 14, hit.y + step * 8)));
  await sleep(70);
}
canvas.dispatchEvent(new PointerEvent('pointerup', { ...opts(hit.x + 84, hit.y + 48), buttons: 0 }));
await sleep(500);
const after = viewOf(hit.pick.which);
await shot('camera-mode-viewpoint-drag');

document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
await sleep(600);
const undone = viewOf(hit.pick.which);

const same = (a, b) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.z - b.z) < 0.01;
return {
  found: true,
  which: hit.pick.which,
  handleId: hit.pick.id,
  before, after, undone,
  dragMovedIt: !same(before, after),
  undoRestoredIt: same(before, undone),
};
