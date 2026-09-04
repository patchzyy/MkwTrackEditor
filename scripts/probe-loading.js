// Page script for scripts/loading-probe.mjs: measures how responsive the main thread stays
// while a track loads, screenshots the loading overlay mid-load, and checks the track really
// finished loading.
//
//   PROBE_PORT=9432 PROBE_PREFIX=loading node scripts/loading-probe.mjs \
//     "http://127.0.0.1:5232/?track=/dev-tracks/nintendo_1.szs" scripts/probe-loading.js

const overlaySamples = [];
let sawOverlay = false;
let shotTaken = false;

// Watch the overlay while the track loads. `gaps()` keeps running the whole time.
let watching = true;
const watch = (async () => {
  for (let i = 0; i < 4000 && watching; i++) {
    const title = q('.uiLoadingTitle');
    const detail = q('.uiLoadingDetail');
    const bar = q('.uiLoadingBar');
    if (title) {
      sawOverlay = true;
      const value = bar ? bar.getAttribute('aria-valuenow') : null;
      const last = overlaySamples[overlaySamples.length - 1];
      const sample = {
        at: Math.round(performance.now() - window.__loadingGaps.start),
        title: title.textContent,
        detail: detail ? detail.textContent : null,
        percent: value === null ? null : Number(value),
      };
      if (!last || last.title !== sample.title || last.detail !== sample.detail || last.percent !== sample.percent) {
        overlaySamples.push(sample);
      }
      // Screenshot once the bar is showing real progress, so the shot proves the bar moves.
      if (!shotTaken && sample.percent !== null && sample.percent > 5 && sample.percent < 100) {
        shotTaken = true;
        void shot(`${window.__probePrefix}-01-progress`);
      }
    } else if (sawOverlay) {
      break;
    }
    await sleep(25);
  }
})();

const t0 = performance.now();
const loaded = await waitForTrack(180000);
watching = false;
await watch;
const duringLoad = gaps();

await sleep(500);
await shot(`${window.__probePrefix}-02-loaded`);

// A second, quiet window: whatever is left after the scene is up should be smooth.
resetGaps();
await sleep(2000);
const afterLoad = gaps();

const viewport = mkw();
const doc = window.__mkwTrackDocument;
const statusPill = q('.rendererStatus');
return {
  loaded,
  sawOverlay,
  // A production build has no dev hooks, so fall back to what is on screen.
  rendererStatus: statusPill ? statusPill.textContent : null,
  outlinerRows: qa('.outlinerRow, [data-outliner-row]').length,
  meshes: viewport ? viewport.listMeshes().length : null,
  kmpEntities: doc && doc.kmp ? doc.kmp.entities.length : null,
  archiveEntries: doc ? doc.archiveEntries.length : null,
  brresSummaries: doc ? Object.keys(doc.brresSummaries).length : null,
  kclTriangles: doc && doc.kcl ? doc.kcl.triangles.length : null,
  fileName: doc ? doc.fileName : null,
  longestGapMs: duringLoad.longest,
  longestGapAtMs: duringLoad.longestAt,
  loadWindowMs: duringLoad.sinceNavigation,
  idleLongestGapMs: afterLoad.longest,
  stalls: duringLoad.timeline.slice(0, 12),
  logs: duringLoad.logs.filter((entry) => entry.text.startsWith('TIMING')),
  overlaySamples: overlaySamples.slice(0, 60),
};
