// Probe body for scripts/camera-ui-probe.mjs: walks the Visual-mode UI on a real track.
//   node scripts/camera-ui-probe.mjs "http://127.0.0.1:5183/?track=/dev-tracks/Z0.szs" scripts/probe-visual-ui.js
const out = {};

// The free camera starts wherever noclip drops it, which on most tracks is looking at nothing.
// Camera mode's "Look from camera" moves the *free* camera onto the track's opening shot, and
// that pose survives the mode switch, so every screenshot below shows the same view of the course.
clickText('Camera');
await sleep(1200);
qa('.cameraRow')[0]?.click();
await sleep(900);
out.framed = clickText('Look from camera', '.inspector button');
await sleep(1400);

// A KMP-mode frame first, so the Visual-mode frame can be compared against it: the routes,
// checkpoints and object markers visible here must be gone once Visual mode is on.
clickText('KMP');
await sleep(1500);
await shot('visual-mode-00-kmp-for-comparison');
await sleep(200);

clickText('Visual');
await sleep(2500);

out.panel = q('.visualPanel') !== null;
out.archiveOptions = qa('.visualArchivePicker option').map((n) => n.value);
out.header = q('.visualPanel .panelSubtle')?.textContent.trim() ?? null;
out.groups = qa('.visualGroupHeader').map((n) => n.textContent.trim());
out.overlayPresets = qa('.visualOverlayPanel .visualPresetRow button').map((n) => n.textContent.trim());
out.overlayToggles = qa('.visualOverlayPanel .visualOverlayToggles label').map((n) => ({
  label: n.textContent.trim(),
  on: n.querySelector('input').checked,
  available: !n.querySelector('input').disabled,
}));

// The texture grid: previews are decoded with noclip's own GX decoder.
const tiles = qa('.visualTextureTile');
out.textureCount = tiles.length;
out.decodedPreviews = qa('.visualTextureTile img').length;
out.firstTextures = tiles.slice(0, 6).map((n) => n.textContent.trim());
await shot('visual-mode-01-textures');
await sleep(200);

// Selecting a texture opens the texture inspector: large preview, GX format, users, replace.
tiles[0]?.click();
await sleep(900);
out.textureInspectorTags = qa('.visualTexturePreviewLarge')
  .length
  ? qa('.inspector .visualTag, .visualTag').map((n) => n.textContent.trim())
  : [];
out.hasReplaceInput = q('input[type="file"][accept="image/*"]') !== null;
out.largePreview = q('.visualTexturePreviewLarge img') !== null;
await shot('visual-mode-02-texture-inspector');
await sleep(200);

// Materials.
const materialsHeader = qa('.visualGroupHeader').find((n) => n.textContent.includes('Materials'));
materialsHeader?.click();
await sleep(500);
const materialRows = qa('.visualGroup .visualRow');
out.materialCount = qa('.visualGroupBody .visualRow').length;
const firstMaterial = qa('.visualRow').find((n) => n.tagName === 'BUTTON' && n.querySelector('.visualRowAside'));
firstMaterial?.click();
await sleep(700);
out.materialInspectorLabels = qa('.inspector .propertyGrid label')
  .map((n) => n.firstChild?.textContent?.trim())
  .filter(Boolean);
await shot('visual-mode-03-material-inspector');
await sleep(200);

// Animations: the transport pauses and scrubs every bound SRT0/PAT0/CLR0/CHR0/VIS0.
const animationRows = qa('.visualScrubber').length ? qa('.visualGroup').find((g) => g.textContent.includes('Animations')) : null;
out.animationCount = animationRows ? animationRows.querySelectorAll('.visualRow').length : 0;
out.animationNames = animationRows
  ? [...animationRows.querySelectorAll('.visualRow strong')].slice(0, 8).map((n) => n.textContent.trim())
  : [];
const scrub = q('input[aria-label="Animation frame"]');
if (scrub) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(scrub, String(Math.round(Number(scrub.max) / 2)));
  scrub.dispatchEvent(new Event('input', { bubbles: true }));
  scrub.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(900);
  out.scrubbedTo = q('.visualScrubberValue')?.textContent.trim() ?? null;
  await shot('visual-mode-04-animation-scrubbed');
  await sleep(200);
  // Back to live playback, and grab a frame of it running.
  clickText('Release the scrubber (run at 60 fps)', '.visualScrubber button');
  await sleep(1400);
  out.releasedTo = q('.visualScrubberValue')?.textContent.trim() ?? null;
  await shot('visual-mode-05-animation-playing');
  await sleep(200);
}

// Render toggles: "Flat" drops lighting/fog/bloom, "Wireframe" drops the skybox and textures.
clickText('Flat', '.visualPresetRow button');
await sleep(1200);
await shot('visual-mode-06-preset-flat');
await sleep(200);
clickText('Wireframe', '.visualPresetRow button');
await sleep(1200);
out.wireframeActive = qa('.visualPresetRow button.active').map((n) => n.textContent.trim());
await shot('visual-mode-07-preset-wireframe');
await sleep(200);
clickText('Game look', '.visualPresetRow button');
await sleep(1400);

// Hiding the skybox on its own, from the Models group.
const skyboxToggle = qa('.visualGroupBody .visualRow').find((n) => n.textContent.includes('vrcorn'));
const skyboxInput = skyboxToggle?.querySelector('input[type="checkbox"]');
if (skyboxInput) {
  skyboxInput.click();
  await sleep(1200);
  out.skyboxHidden = !skyboxInput.checked;
  await shot('visual-mode-08-skybox-hidden');
  await sleep(200);
  skyboxInput.click();
  await sleep(900);
}

// Post effects: change the fog and prove the viewport reacts.
const effectsHeader = qa('.visualGroupHeader').find((n) => n.textContent.includes('Post effects'));
effectsHeader?.click();
await sleep(400);
clickText('Edit post effects', '.visualGroupBody button');
await sleep(800);
out.postEffectHeadings = qa('.inspector h2').map((n) => n.textContent.trim());

const fogColor = q('.postEffectEditor input[type="color"]');
const fogNumbers = qa('.postEffectEditor input[type="number"], .postEffectEditor input[role="spinbutton"]');
if (fogColor) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(fogColor, '#ff2f6a');
  fogColor.dispatchEvent(new Event('input', { bubbles: true }));
  fogColor.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(600);
  // Pull the fog in close so it is unmistakable in the screenshot.
  if (fogNumbers[0]) {
    setter.call(fogNumbers[0], '10');
    fogNumbers[0].dispatchEvent(new Event('input', { bubbles: true }));
    fogNumbers[0].dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (fogNumbers[1]) {
    setter.call(fogNumbers[1], '4000');
    fogNumbers[1].dispatchEvent(new Event('input', { bubbles: true }));
    fogNumbers[1].dispatchEvent(new Event('change', { bubbles: true }));
  }
  await sleep(1600);
  out.fogColorAfter = q('.postEffectEditor input[type="color"]')?.value ?? null;
  out.status = q('.uiStatusMessage')?.textContent.trim() ?? null;
  await shot('visual-mode-09-fog-edited');
  await sleep(200);
}

// Bloom is one of the post-effects the renderer can re-apply without reloading the scene, so an
// edit to posteffect.bblm must show in the viewport straight away.
const bloomNumbers = qa('.postEffectEditor input[type="number"], .postEffectEditor input[role="spinbutton"]');
const bloomColor = qa('.postEffectEditor input[type="color"]')[1];
const setInput = (node, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(node, String(value));
  node.dispatchEvent(new Event('input', { bubbles: true }));
  node.dispatchEvent(new Event('change', { bubbles: true }));
};
out.postEffectControls = qa('.inspector .propertyGrid label').map((n) => n.firstChild?.textContent?.trim()).filter(Boolean);
const thresholdInput = qa('.inspector .propertyGrid label').find((n) => /bloom/i.test(n.textContent))?.querySelector('input[type="number"], input[role="spinbutton"]');
if (thresholdInput) {
  setInput(thresholdInput, 0);
  await sleep(1800);
  out.bloomStatus = q('.uiStatusMessage')?.textContent.trim() ?? null;
  await shot('visual-mode-10-bloom-edited');
  await sleep(200);
}

// Texture replacement, end to end: encode a synthetic image into the TEX0's own GX format,
// patch it into the archive and prove the viewport picks the new pixels up.
const areaOf = (tile) => {
  const m = tile.textContent.match(/(\d+)x(\d+)/);
  return m ? Number(m[1]) * Number(m[2]) : 0;
};
// A large course-surface texture (`sfc_*`), so the swap is unmistakable in the viewport rather
// than hidden in a shadow map or an effect sprite.
const candidates = qa('.visualTextureTile')
  .filter((tile) => /sfc/i.test(tile.textContent) && areaOf(tile) >= 256 * 128)
  .sort((a, b) => areaOf(b) - areaOf(a));
const target = candidates[0] ?? qa('.visualTextureTile').sort((a, b) => areaOf(b) - areaOf(a))[0];
if (target) {
  out.replacedTexture = target.textContent.trim();
  target.click();
  await sleep(900);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#ff00d0' : '#ffe000';
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const file = new File([blob], 'probe-replacement.png', { type: 'image/png' });
  const input = q('input[type="file"][accept="image/*"]');
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(3000);
  out.replaceStatus = q('.uiStatusMessage')?.textContent.trim() ?? null;
  out.replaceNotes = qa('.inspector .visualNote').map((n) => n.textContent.trim());
  await shot('visual-mode-11-texture-replaced');
  await sleep(200);
  out.canExportAfterReplace = !q('.topBarRight .uiButton--primary')?.disabled;
}

out.stillInVisualMode = q('.visualPanel') !== null;
return out;
