// Page script for scripts/loading-probe.mjs: opens a track by *dropping* it, which is the path
// `useTrackDocument.openFiles` takes (the file picker hands it the same `FileList`).
//
//   PROBE_PORT=9432 PROBE_PREFIX=loading-drop node scripts/loading-probe.mjs \
//     "http://127.0.0.1:5232/" scripts/probe-loading-drop.js

// This probe body starts as soon as the page navigates, so wait for the editor shell to mount.
for (let i = 0; i < 400 && !q('.appShell'); i++) await sleep(50);
const shell = q('.appShell');
if (!shell) return { error: 'no app shell' };

const response = await fetch('/dev-tracks/Z101.szs');
const bytes = await response.arrayBuffer();
const file = new File([bytes], 'Z101.szs', { type: 'application/octet-stream' });
const transfer = new DataTransfer();
transfer.items.add(file);

const samples = [];
let watching = true;
const watch = (async () => {
  for (let i = 0; i < 4000 && watching; i++) {
    const title = q('.uiLoadingTitle');
    const bar = q('.uiLoadingBar');
    if (title) {
      const value = bar ? bar.getAttribute('aria-valuenow') : null;
      const sample = { title: title.textContent, percent: value === null ? null : Number(value) };
      const last = samples[samples.length - 1];
      if (!last || last.title !== sample.title || last.percent !== sample.percent) samples.push(sample);
    }
    await sleep(25);
  }
})();

resetGaps();
shell.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
shell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));

const loaded = await waitForTrack(180000);
watching = false;
await watch;
const during = gaps();

await sleep(600);
await shot(`${window.__probePrefix}-01-dropped`);

const doc = window.__mkwTrackDocument;
return {
  loaded,
  sawOverlay: samples.length > 0,
  overlayStages: samples.slice(0, 20),
  overlayGone: !q('.uiLoadingOverlay'),
  rendererStatus: (q('.rendererStatus') || {}).textContent ?? null,
  meshes: window.__mkwViewport ? window.__mkwViewport.listMeshes().length : null,
  fileName: doc ? doc.fileName : null,
  kmpEntities: doc && doc.kmp ? doc.kmp.entities.length : null,
  longestGapMs: during.longest,
};
