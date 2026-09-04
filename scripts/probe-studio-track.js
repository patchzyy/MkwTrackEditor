// Probe body: the round trip between the track editor and the Model Studio.
//
// Load a track, pick a course mesh in Model mode, "Open in Model Studio", edit that material,
// come back, and check the track viewport shows the change, the status line says what happened,
// and Ctrl+Z undoes it in the track's own history.
//
//   PROBE_STUDIO_OPEN=track PROBE_PREFIX=studiotrack PROBE_PORT=9442 PROBE_SIZE=1720x1000 \
//     node scripts/studio-probe.mjs \
//     "http://127.0.0.1:5233/?track=/dev-tracks/Z0.szs" scripts/probe-studio-track.js
const out = {};
const frames = {};

const statusText = () => q('.uiStatusMessage')?.textContent ?? '';
const key = (init) => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));

async function captureTrackFrame(name) {
  const url = await mkw.captureFrame();
  if (!url) return false;
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = url;
  });
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
  return { meanAbsDiff: +(sum / n).toFixed(2), changedPct: +((100 * changed) / n).toFixed(2) };
}

async function waitForRefresh() {
  for (let i = 0; i < 250; i++) {
    await sleep(100);
    if (statusText().startsWith('Track refreshed')) return true;
  }
  return false;
}

// --- 1. Model mode, pick a mesh ---------------------------------------------------------------
clickText('Model', '.uiSegmentedOption, button');
await sleep(1200);
out.meshCount = mkw.listMeshes().length;

const canvas = q('.viewportCanvas') ?? q('canvas');
const rect = canvas.getBoundingClientRect();
let pick = null;
for (const fy of [0.6, 0.65, 0.7, 0.55, 0.75, 0.5]) {
  const x = rect.left + rect.width * 0.5;
  const y = rect.top + rect.height * fy;
  pick = mkw.pickMeshAt(x, y);
  if (pick) {
    mkw.selectMeshAt(x, y);
    out.pickedAt = fy;
    break;
  }
}
out.selectedMesh = pick;
if (!out.selectedMesh) return { ...out, error: 'Nothing could be selected in Model mode' };
await sleep(600);
await captureTrackFrame('before');
await shot('studio-11-model-mode-selection');
await sleep(400);

// --- 2. Open it in the Model Studio -------------------------------------------------------------
out.openedStudio = clickText('Open in Model Studio');
const studio = await waitForStudio();
await sleep(3500);
studio.frameAll();
await sleep(800);
out.studioDocument = studio.document();
out.studioStatus = studio.status();
await shot('studio-12-track-archive-in-studio');
await sleep(400);

// --- 3. Edit the material the picked mesh draws with ---------------------------------------------
const archivePath = studio.document().brresFiles[0].path;
const wantedMaterial = out.selectedMesh.materialName ?? null;
const archive = studio.archives().find((entry) => entry.archivePath === archivePath);
out.studioArchive = archive && { models: archive.models.map((m) => m.modelName), materialCount: archive.materialCount };

// Pick the material the track mesh used when it is there, otherwise the first one in the model.
const modelName = out.selectedMesh.modelName;
studio.selectMaterial(archivePath, modelName, wantedMaterial);
await sleep(1200);
out.studioSelection = studio.selection();
out.studioMaterialDoc = studio.materialDoc() && {
  name: studio.materialDoc().name,
  cullMode: studio.materialDoc().cullMode,
  stageCount: studio.materialDoc().tevStages.length,
};
if (!studio.materialDoc()) return { ...out, error: `The studio could not decode ${wantedMaterial}` };

const doc = studio.materialDoc();
studio.updateMaterial({ ...doc, cullMode: 3 }, 'Set culling to draw nothing.');
await sleep(1200);
out.studioStatusAfterEdit = studio.status();
out.studioDocumentAfterEdit = studio.document();
await shot('studio-13-track-material-edited');
await sleep(400);

// --- 4. Back to the track editor -----------------------------------------------------------------
clickText('Back to track editor');
await sleep(600);
out.trackStatusOnReturn = statusText();
out.refreshed = await waitForRefresh();
await sleep(2500);
await captureTrackFrame('afterEdit');
out.trackStatusAfterRefresh = statusText();
out.editDiff = diff('before', 'afterEdit');
await shot('studio-14-back-in-track-editor');
await sleep(400);

// --- 5. Undo in the track editor ------------------------------------------------------------------
out.historyBeforeUndo = qa('.topBarLeft button[aria-label="Undo"]').length;
key({ key: 'z', ctrlKey: true });
await sleep(1200);
out.trackStatusAfterUndo = statusText();
// Refresh again so the viewport is showing the undone document, then compare with the start.
q('.viewportRefreshPanel button')?.click() ?? clickText('Refresh');
await waitForRefresh();
await sleep(2500);
await captureTrackFrame('afterUndo');
out.undoDiff = diff('before', 'afterUndo');
await shot('studio-15-track-after-undo');
await sleep(400);

return out;
