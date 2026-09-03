// Probe body for scripts/ui-shell-probe.mjs: proves the "Refresh track" button rebuilds the
// viewport from the *edited* track and keeps the camera, the mode and the selection.
//
//   PROBE_PREFIX=refresh PROBE_PORT=9355 PROBE_SIZE=1600x1000 node scripts/ui-shell-probe.mjs \
//     "http://127.0.0.1:5183/?track=/dev-tracks/Z0.szs" scripts/probe-refresh-track.js
//
// The measurement is a pixel diff of the WebGL frame, taken at a fixed delay after each rebuild so
// the scene's animation clock (which restarts with the scene) is at the same phase every time:
//
//   clean rebuild vs clean rebuild  -> the noise floor, must be ~0
//   clean rebuild vs edited rebuild -> the edit, must be well above it
//
// If Refresh rebuilt from the file on disk instead of the edited document, the second number
// would be the noise floor too.
const out = {};
const frames = {};

const setSelect = (node, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(node, String(value));
  node.dispatchEvent(new Event('change', { bubbles: true }));
};
const key = (init) => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
const statusText = () => q('.uiStatusMessage')?.textContent ?? '';
const rendererText = () => q('.rendererStatus')?.textContent ?? '';

async function capture(name) {
  const url = await mkw.captureFrame();
  if (!url) return null;
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  frames[name] = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return true;
}

function diff(a, b) {
  const A = frames[a];
  const B = frames[b];
  if (!A || !B) return null;
  let sum = 0;
  let changed = 0;
  let n = 0;
  for (let i = 0; i < A.length; i += 4) {
    const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
    sum += d / 3;
    n++;
    if (d > 24) changed++;
  }
  return { meanAbsDiff: +(sum / n).toFixed(2), changedPct: +(100 * changed / n).toFixed(2) };
}

async function waitForRefresh() {
  for (let i = 0; i < 200; i++) {
    await sleep(100);
    if (statusText().startsWith('Track refreshed')) return true;
  }
  return false;
}

async function refreshAndCapture(name) {
  q('.viewportRefreshPanel button').click();
  const finished = await waitForRefresh();
  await sleep(2000);
  await capture(name);
  return finished;
}

// ---------------------------------------------------------------- material mode and a material

clickText('Material');
await sleep(1200);
out.hasRefreshInTopBar = !!q('header button[data-refresh-track]');
out.hasRefreshInViewport = !!q('.viewportRefreshPanel button');

// Pick whatever material is drawn under the middle of the viewport, so the edit is visible.
const canvas = q('canvas');
const rect = canvas.getBoundingClientRect();
const centre = { x: rect.left + rect.width * 0.4, y: rect.top + rect.height * 0.6 };
const pick = mkw.pickMeshAt(centre.x, centre.y);
out.pickedMaterial = pick?.materialName ?? null;
const row = qa('button.materialRow').find((n) => n.textContent.trim().startsWith(`${pick.materialName}`));
row?.click();
await sleep(700);
out.selectedMaterial = q('.materialOverlayName')?.textContent ?? null;
await shot(`${window.__probePrefix}-01-material-mode`);

// ---------------------------------------------------------------- the edit, live and rebuilt

// The raw culling select lives under Surface > Advanced in the simplified inspector.
for (const toggle of qa('.materialInspector .materialAdvancedToggle[aria-expanded="false"]')) toggle.click();
await sleep(300);
const cull = qa('select').find((s) => s.getAttribute('aria-label') === 'Sides drawn');
const cullBefore = cull.value;

// Baseline: two rebuilds of the unedited track, to measure how much two rebuilds differ at all.
out.cleanRebuild1 = await refreshAndCapture('clean1');
out.cleanRebuild2 = await refreshAndCapture('clean2');
out.noiseFloor = diff('clean1', 'clean2');

// Camera and view state as the rebuild found them.
const rayBefore = mkw.pickRay(centre.x, centre.y);

setSelect(cull, [...cull.options].find((o) => o.text === 'Draw nothing').value);
await sleep(800);
out.editStatus = statusText();
out.editIsDirty = !!q('.topBarUnsavedDot');
await capture('live-edit');
out.liveHotSwap = diff('clean2', 'live-edit');

out.editedRebuild = await refreshAndCapture('edited');
out.rebuiltEdit = diff('clean2', 'edited');
out.rebuiltMatchesLiveEdit = diff('live-edit', 'edited');
await shot(`${window.__probePrefix}-02-after-refresh`);

// ---------------------------------------------------------------- what the rebuild preserved

const rayAfter = mkw.pickRay(centre.x, centre.y);
const maxDelta = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
out.cameraOriginDelta = +maxDelta(rayBefore.origin, rayAfter.origin).toFixed(6);
out.cameraDirectionDelta = +maxDelta(rayBefore.direction, rayAfter.direction).toFixed(6);
out.modeAfterRefresh = qa('header button[aria-pressed="true"]').map((n) => n.textContent.trim()).filter(Boolean).join(',');
out.selectionAfterRefresh = q('.materialOverlayName')?.textContent ?? null;
out.meshHighlightAfterRefresh = q('.materialOverlayMeta')?.textContent ?? null;
out.rendererStatusAfterRefresh = rendererText();
out.statusAfterRefresh = statusText();

// ---------------------------------------------------------------- undo still works afterwards

key({ key: 'z', ctrlKey: true });
await sleep(700);
out.undoStatus = statusText();
out.cullAfterUndo = cull.value === cullBefore;
out.dirtyAfterUndo = !!q('.topBarUnsavedDot');

// ---------------------------------------------------------------- the keyboard shortcut

key({ key: 'r', ctrlKey: true, altKey: true });
await sleep(60);
out.shortcutStartsRebuild = statusText().startsWith('Rebuilding');
out.buttonBusyDuringRebuild = q('header button[data-refresh-track]')?.getAttribute('data-refresh-track') ?? null;
out.buttonDisabledDuringRebuild = q('header button[data-refresh-track]')?.disabled ?? null;
await waitForRefresh();
out.shortcutFinished = statusText();

// ------------------------------------------- a material the viewport does not draw at all

// `map_model.brres` is in the archive but the renderer never draws it, so a hot swap there
// cannot apply and the status line has to say so. The outliner headers carry a material count,
// so they are matched by prefix.
const clickPrefix = (text, sel) => {
  const node = qa(sel).find((n) => n.textContent.trim().startsWith(text));
  if (node) node.click();
  return !!node;
};
out.minimapExpanded = clickPrefix('Minimap', 'button.materialArchiveHeader');
await sleep(2500);
out.trackModelCollapsed = clickPrefix('Track model', 'button.materialArchiveHeader');
await sleep(900);
const minimapRow = qa('button.materialRow').find((n) => n.textContent.trim().startsWith('Object_m'));
out.minimapRowFound = !!minimapRow;
minimapRow?.click();
await sleep(900);
out.minimapMaterial = q('.materialOverlayName')?.textContent ?? null;
out.minimapMeshes = q('.materialOverlayMeta')?.textContent ?? null;
clickText('Blend & alpha');
await sleep(300);
const minimapCull = qa('select').find((s) => s.getAttribute('aria-label') === 'Sides drawn');
if (minimapCull) {
  setSelect(minimapCull, [...minimapCull.options].find((o) => o.text === 'Draw nothing').value);
  await sleep(800);
  out.hotSwapFailedStatus = statusText();
  key({ key: 'z', ctrlKey: true });
  await sleep(500);
}
await shot(`${window.__probePrefix}-03-hot-swap-unavailable`);

return out;
