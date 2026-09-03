// Probe body for scripts/camera-ui-probe.mjs: proves course fog is really rendered.
//
//   node scripts/camera-ui-probe.mjs "http://127.0.0.1:5192/?track=/dev-tracks/Z0.szs" scripts/probe-fog.js
//
// It measures the actual canvas pixels (via the viewport's captureFrame() dev hook) with fog off
// and with fog on, and checks that (a) the image changes, (b) it changes *towards* the fog
// colour, and (c) nothing goes black in any of the four editor modes -- the failure mode of the
// screen-space fog pass that was reverted before this was written.
const out = {};

const decode = async (dataUrl) => {
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
};

const stats = (pixels) => {
  let r = 0;
  let g = 0;
  let b = 0;
  let nonBlack = 0;
  const total = pixels.data.length / 4;
  for (let i = 0; i < pixels.data.length; i += 4) {
    r += pixels.data[i];
    g += pixels.data[i + 1];
    b += pixels.data[i + 2];
    if (pixels.data[i] > 8 || pixels.data[i + 1] > 8 || pixels.data[i + 2] > 8) nonBlack++;
  }
  return { r: r / total, g: g / total, b: b / total, nonBlackFraction: nonBlack / total, total };
};

const diff = (a, b) => {
  let changed = 0;
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (d > 12) changed++;
    sum += d;
  }
  return { changedFraction: changed / (a.data.length / 4), meanAbsDiff: sum / (a.data.length / 4) };
};

const grab = async () => decode(await mkw.captureFrame());

// Park the free camera on the track's opening shot so every frame below shows the same view.
clickText('Camera');
await sleep(1200);
qa('.cameraRow')[0]?.click();
await sleep(900);
out.framed = clickText('Look from camera', '.inspector button');
await sleep(1500);

clickText('Visual');
await sleep(2500);

// Reach the post-effects panel.
const effectsHeader = qa('.visualGroupHeader').find((n) => n.textContent.includes('Post effects'));
effectsHeader?.click();
await sleep(400);
out.openedEditor = clickText('Edit post effects', '.visualGroupBody button');
await sleep(900);

const setInput = (node, value) => {
  if (!node) return false;
  const proto = node.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, String(value));
  node.dispatchEvent(new Event('input', { bubbles: true }));
  node.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
};

// React re-renders the panel after every edit, so always re-query rather than caching nodes.
// Scope to fog preset 0's own row: `.postEffectEditor` is also used by the bloom and DOF blocks,
// and DOF has a <select> of its own, so plain DOM order picks the wrong control.
const fogRow = () => qa('.inspector label').find((n) => /^Fog Preset 0/.test(n.textContent.trim()))?.querySelector('.postEffectEditor') ?? null;
const fogSelect = () => fogRow()?.querySelector('select') ?? null;
const fogStart = () => q('input[aria-label="Fog preset 0 start Z"]');
const fogEnd = () => q('input[aria-label="Fog preset 0 end Z"]');
const fogColor = () => fogRow()?.querySelector('input[type="color"]') ?? null;
out.hasFogControls = !!(fogSelect() && fogColor() && fogStart() && fogEnd());
out.fogTypeOptionCount = fogSelect()?.options.length ?? 0;

// --- Fog OFF (type 0 = None) -------------------------------------------------------------
setInput(fogSelect(), '0');
await sleep(1600);
const fogOff = await grab();
out.fogOff = stats(fogOff);
await shot('fog-00-off');
await sleep(200);

// --- Fog ON: bright magenta, pulled right in so it is unmistakable ------------------------
setInput(fogSelect(), '1'); // Perspective Linear
await sleep(400);
setInput(fogStart(), '10');
await sleep(400);
setInput(fogEnd(), '6000');
await sleep(400);
setInput(fogColor(), '#ff2f6a');
await sleep(2200);
const fogOn = await grab();
out.fogOn = stats(fogOn);
out.fogOnVsOff = diff(fogOff, fogOn);
out.fogColorAfter = q('.postEffectEditor input[type="color"]')?.value ?? null;
await shot('fog-01-on-magenta');
await sleep(200);

// The whole point: the image must move towards the fog colour (red up, green down).
out.movedTowardsFogColour = out.fogOn.r > out.fogOff.r && out.fogOn.g < out.fogOff.g;

// --- A second, different fog: deep blue, further out --------------------------------------
setInput(fogColor(), '#1030ff');
await sleep(500);
setInput(fogEnd(), '20000');
await sleep(2000);
const fogBlue = await grab();
out.fogBlue = stats(fogBlue);
out.blueVsMagenta = diff(fogOn, fogBlue);
out.blueIsBluer = out.fogBlue.b > out.fogOn.b;
await shot('fog-02-on-blue');
await sleep(200);

// --- Every fog type renders (the InvExp ones used to throw in the shader generator) --------
out.perType = {};
for (const type of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
  setInput(fogSelect(), String(type));
  await sleep(900);
  try {
    const frame = await grab();
    const s = stats(frame);
    out.perType[type] = { nonBlack: Number(s.nonBlackFraction.toFixed(3)), r: Math.round(s.r), g: Math.round(s.g), b: Math.round(s.b) };
  } catch (error) {
    out.perType[type] = { error: String(error) };
  }
}

// Back to a visible fog for the mode sweep.
setInput(fogSelect(), '1');
await sleep(500);
setInput(fogEnd(), '12000');
await sleep(1500);

// --- Nothing goes black in any of the four modes ------------------------------------------
out.modes = {};
for (const mode of ['KMP', 'Camera', 'Model', 'Visual']) {
  clickText(mode);
  await sleep(1800);
  const frame = await grab();
  const s = stats(frame);
  out.modes[mode] = { nonBlackFraction: Number(s.nonBlackFraction.toFixed(4)), r: Math.round(s.r), g: Math.round(s.g), b: Math.round(s.b) };
  await shot(`fog-03-mode-${mode.toLowerCase()}`);
  await sleep(200);
}
out.allModesRender = Object.values(out.modes).every((m) => m.nonBlackFraction > 0.2);

return out;
