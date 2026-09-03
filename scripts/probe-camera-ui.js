// Probe body for scripts/camera-ui-probe.mjs: walks the Camera-mode UI.
clickText('Camera');
await sleep(1200);

const rows = qa('.cameraRow');
const outlinerTitles = rows.map((row) => row.textContent.trim());

// Select the first camera: this frames the viewport on it and fills the inspector.
rows[0]?.click();
await sleep(1400);
await shot('camera-mode-outliner');
await sleep(200);

const inspectorLabels = qa('.cameraField .cameraFieldLabel').map((node) => node.firstChild?.textContent?.trim());
const inspectorActions = qa('.cameraInspectorActions .button').map((node) => node.textContent.trim());
const chainTitles = qa('.cameraChain .cameraChainHeader strong').map((node) => node.textContent.trim());
const openingOrder = qa('.cameraChain-opening .cameraChainItem .cameraChainName').map((node) => node.textContent.trim());
const chainTotal = q('.cameraChain-opening .cameraChainTotal')?.textContent.trim() ?? null;

// Inspector close-up: scroll the right dock to the property grid.
const inspectorPane = q('.inspector .paneBody') ?? q('.inspector');
if (inspectorPane) inspectorPane.scrollTop = 320;
await sleep(400);
await shot('camera-mode-inspector');
await sleep(200);
if (inspectorPane) inspectorPane.scrollTop = 0;

// Play the opening sequence and grab a frame mid-pan.
clickText('Play opening sequence');
await sleep(2600);
await shot('camera-mode-playback');
await sleep(200);
const playbackClock = q('.cameraPlaybackClock')?.textContent.trim() ?? null;
const playbackNow = q('.cameraPlayback .viewportOverlayDetail')?.textContent.trim() ?? null;

// Escape must stop the preview and give the free camera back.
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await sleep(900);
const stopped = q('.cameraPlayback') === null;
await shot('camera-mode-after-stop');

return {
  cameraCount: rows.length,
  outlinerTitles: outlinerTitles.slice(0, 6),
  inspectorLabels,
  inspectorActions,
  chainTitles,
  openingOrder,
  chainTotal,
  playbackClock,
  playbackNow,
  stopped,
};
