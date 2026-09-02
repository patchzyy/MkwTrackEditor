// Probe body for scripts/viewport-dev-probe.mjs: checks that KMP mode still behaves as
// before (overlays on, no camera gizmos, no mesh highlight).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'KMP')?.click();
await sleep(600);
mkw.setMode(null); // clear any dev override so the app's own mode applies
await sleep(400);
mkw.setMode('kmp');

// Look at the track from the first opening camera so the overlays are at a useful scale.
const overlay = mkw.getCameraOverlay();
if (overlay.openingChain.length > 0) {
  mkw.previewCamera(overlay.openingChain[0].cameraIndex, { play: false, time: 40 });
  await sleep(1200);
}
await shot('kmp-mode-overlay');
mkw.stopCameraPreview();

return { mode: mkw.getMode(), cameras: mkw.getCameras().length, selectedMeshes: mkw.getSelectedMesh().length };
