// Probe body: open the Model Studio from the top bar with no track loaded, and check that the
// demo character actually renders — the thing the flat-blue silhouette bug used to break.
//
//   PROBE_PREFIX=studio PROBE_PORT=9433 node scripts/studio-probe.mjs \
//     "http://127.0.0.1:5233/" scripts/probe-studio-open.js
const out = {};

clickText('Model Studio');
const studio = await waitForStudio();
await sleep(2500);

out.document = studio.document();
out.archives = studio.archives();
out.status = studio.status();
studio.frameAll();
await sleep(600);
out.camera = studio.camera();
await shot('studio-01-demo-character');

// --- 1. Is anything on screen, and is it a flat dark silhouette? -----------------------------
// A silhouette is dark *and* almost colourless. The rig should give a lit character: brighter,
// and with a real spread of colour across the frame.
const centre = await studio.samplePixels();
out.centrePixels = centre;
out.brightness = centre === null ? null : Math.round(((centre.r + centre.g + centre.b) / 3) * 100) / 100;

// Sample a grid of small boxes across the model so a single average cannot hide a black model on
// a grey backdrop.
const boxes = [];
const canvas = q('.studioCanvas');
const w = canvas.width, h = canvas.height;
for (let row = 1; row <= 3; row++) {
  for (let col = 1; col <= 3; col++) {
    const sample = await studio.samplePixels({
      x: Math.round((w * col) / 4) - 20,
      y: Math.round((h * row) / 4) - 20,
      width: 40,
      height: 40,
    });
    if (sample) boxes.push({ col, row, r: Math.round(sample.r), g: Math.round(sample.g), b: Math.round(sample.b) });
  }
}
out.grid = boxes;
out.brightestBox = boxes.reduce((best, box) => (box.r + box.g + box.b > best.r + best.g + best.b ? box : best), boxes[0] ?? null);
out.maxChannelSpread = boxes.reduce((max, box) => Math.max(max, Math.max(box.r, box.g, box.b) - Math.min(box.r, box.g, box.b)), 0);

// --- 2. Animations --------------------------------------------------------------------------
const driver = out.archives.find((archive) => archive.archivePath.includes('driver')) ?? out.archives[0];
out.driverArchive = driver?.archivePath ?? null;
out.chr0Count = driver ? driver.animations.filter((a) => a.kind === 'chr0').length : 0;
out.totalChr0 = out.archives.reduce((sum, a) => sum + a.animations.filter((x) => x.kind === 'chr0').length, 0);
out.enabledAnimations = out.archives.flatMap((archive) =>
  archive.animations.filter((a) => a.enabled).map((a) => `${archive.label}:${a.kind}:${a.name}`),
);
out.duration = studio.duration();

// --- 3. Playing one animation changes the pose ----------------------------------------------
// Scrubbing to two different frames must move the bones. The signature is the sum of the animated
// joint translations, so it answers "did the pose change" directly instead of inferring it from
// pixels — an idle animation is far too subtle for an average-colour test.
studio.setTransport({ playing: false, frame: 0 });
await sleep(400);
out.poseSignatureAtFrame0 = studio.poseSignature();
const poseA = await studio.samplePixels();
const midFrame = Math.max(1, Math.round(studio.duration() * 0.4));
studio.setTransport({ playing: false, frame: midFrame });
await sleep(400);
out.scrubbedToFrame = midFrame;
out.poseSignatureAtMidFrame = studio.poseSignature();
out.poseSignatureMoved = out.poseSignatureAtFrame0 !== out.poseSignatureAtMidFrame;
const poseB = await studio.samplePixels();
out.poseA = poseA && { r: Math.round(poseA.r), g: Math.round(poseA.g), b: Math.round(poseA.b) };
out.poseB = poseB && { r: Math.round(poseB.r), g: Math.round(poseB.g), b: Math.round(poseB.b) };
out.poseDelta =
  poseA && poseB ? Math.round((Math.abs(poseA.r - poseB.r) + Math.abs(poseA.g - poseB.g) + Math.abs(poseA.b - poseB.b)) * 100) / 100 : null;
out.transportReadoutWhileScrubbed = q('.studioTransportReadout strong')?.textContent ?? null;
await shot('studio-02-scrubbed');

// Switch to another CHR0 and check the pose moves again.
if (driver) {
  const chr0s = driver.animations.filter((a) => a.kind === 'chr0');
  const playing = chr0s.find((a) => a.enabled);
  const other = chr0s.find((a) => !a.enabled && a.duration > 4);
  if (playing) studio.toggleAnimation(driver.archivePath, 'chr0', playing.name, false);
  if (other) studio.toggleAnimation(driver.archivePath, 'chr0', other.name, true);
  out.switchedTo = other?.name ?? null;
  await sleep(200);
  studio.setTransport({ playing: false, frame: Math.max(1, Math.round(studio.duration() * 0.5)) });
  await sleep(500);
  out.poseSignatureAfterSwitch = studio.poseSignature();
  const poseC = await studio.samplePixels();
  out.poseC = poseC && { r: Math.round(poseC.r), g: Math.round(poseC.g), b: Math.round(poseC.b) };
  out.switchDelta =
    poseB && poseC ? Math.round((Math.abs(poseB.r - poseC.r) + Math.abs(poseB.g - poseC.g) + Math.abs(poseB.b - poseC.b)) * 100) / 100 : null;
  await shot('studio-03-other-animation');
  if (other) studio.toggleAnimation(driver.archivePath, 'chr0', other.name, false);
  if (playing) studio.toggleAnimation(driver.archivePath, 'chr0', playing.name, true);
}

// --- 4. Outliner and transport UI -------------------------------------------------------------
out.outlinerRows = qa('.studioTreeRow').length;
out.transportPresent = q('.studioTransport') !== null;
out.transportReadout = q('.studioTransportReadout strong')?.textContent ?? null;
out.dockTabs = qa('.studioCenter [role="tab"]').map((n) => n.textContent.trim());

// --- 5. Export of an untouched document is byte-identical --------------------------------------
out.exportBefore = studio.exportBytes();

studio.setTransport({ playing: true });
return out;
