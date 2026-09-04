// Page script for scripts/loading-probe.mjs: checks the loading overlay also covers the
// "Refresh track" rebuild, which reuses the scene-build half of the bar without a read phase.
//
//   PROBE_PORT=9432 PROBE_PREFIX=loading-refresh node scripts/loading-probe.mjs \
//     "http://127.0.0.1:5232/?track=/dev-tracks/Z101.szs" scripts/probe-loading-refresh.js

const loaded = await waitForTrack(180000);
await sleep(800);

const meshesBefore = window.__mkwViewport ? window.__mkwViewport.listMeshes().length : null;
const overlayGone = !q('.uiLoadingOverlay');

// Watch the overlay through the rebuild.
const samples = [];
let watching = true;
const watch = (async () => {
  for (let i = 0; i < 2000 && watching; i++) {
    const title = q('.uiLoadingTitle');
    const bar = q('.uiLoadingBar');
    if (title) {
      const value = bar ? bar.getAttribute('aria-valuenow') : null;
      const last = samples[samples.length - 1];
      const sample = { title: title.textContent, percent: value === null ? null : Number(value) };
      if (!last || last.title !== sample.title || last.percent !== sample.percent) samples.push(sample);
    }
    await sleep(20);
  }
})();

resetGaps();
const clicked = clickText('Refresh') || !!(qa('button').find((b) => /refresh/i.test(b.getAttribute('aria-label') || b.title || '')) || {}).click;
if (!clicked) {
  const button = qa('button').find((b) => /refresh/i.test(b.textContent || b.getAttribute('aria-label') || b.title || ''));
  if (button) button.click();
}

await sleep(400);
if (samples.length > 0) await shot(`${window.__probePrefix}-01-refresh-progress`);

// The rebuild ends when the status pill says so.
let refreshed = false;
for (let i = 0; i < 400; i++) {
  const pill = q('.rendererStatus');
  if (pill && /refreshed/i.test(pill.textContent || '')) {
    refreshed = true;
    break;
  }
  await sleep(50);
}
watching = false;
await watch;

const during = gaps();
await sleep(400);
await shot(`${window.__probePrefix}-02-refreshed`);

return {
  loaded,
  overlayGoneAfterLoad: overlayGone,
  meshesBefore,
  meshesAfter: window.__mkwViewport ? window.__mkwViewport.listMeshes().length : null,
  refreshed,
  rendererStatus: (q('.rendererStatus') || {}).textContent ?? null,
  overlayStillUp: !!q('.uiLoadingOverlay'),
  refreshLongestGapMs: during.longest,
  refreshSamples: samples.slice(0, 20),
};
