// Probe body for scripts/viewport-dev-probe.mjs: exercises Camera (CAME) mode.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Camera')?.click();
await sleep(500);
mkw.setMode('camera');
await sleep(900);
await shot('camera-mode-overlay');

const overlay = mkw.getCameraOverlay();
const cameras = mkw.getCameras();

// Static pose of the first opening camera.
const first = overlay.openingChain[0];
if (first !== undefined) {
  mkw.previewCamera(first.cameraIndex, { play: false, time: 0 });
  await sleep(1100);
  await shot('camera-preview-start');
  mkw.previewCamera(first.cameraIndex, { play: false, time: Math.round(first.durationFrames * 0.9) });
  await sleep(1100);
  await shot('camera-preview-end');
}

// Play the whole opening sequence and sample it part way through.
mkw.playOpeningSequence();
await sleep(2500);
await shot('camera-opening-sequence');
mkw.stopCameraPreview();
await sleep(900);
await shot('camera-mode-free');

return {
  firstIntroCam: overlay.firstIntroCam,
  openingChain: overlay.openingChain,
  gizmos: overlay.cameraGizmos.map((g) => ({
    index: g.index,
    type: g.type,
    label: g.label,
    route: g.routeIndex,
    routePoints: g.routePoints.length,
    zoom: [g.zoomStart, g.zoomEnd],
    openingOrder: g.openingOrder,
  })),
  chainLinks: overlay.cameraChainLinks.length,
  cameraCount: cameras.length,
};
