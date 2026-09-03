// Body for scripts/ui-shell-probe.mjs. Proves the content browser's thumbnails are real
// renders and not grey blobs: waits for the shared-object previews to finish, then decodes
// each data URL and measures how much of it is actually drawn and how varied the pixels are.
//
//   node scripts/ui-shell-probe.mjs "http://127.0.0.1:5188/?track=/dev-tracks/Z0.szs" scripts/probe-thumbnails.js

const prefix = window.__probePrefix ?? 'thumbnails';
const report = { prefix };

const folderRows = () => qa('.browserFolders .uiTreeRow');
const openFolder = (name) => {
  const row = folderRows().find((n) => n.textContent.includes(name));
  if (row) row.click();
  return !!row;
};

/** Decodes a data URL and reports coverage + colour variety. */
async function measure(dataUrl) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let opaque = 0;
  const colours = new Set();
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 24) continue;
    opaque++;
    sumR += data[i];
    sumG += data[i + 1];
    sumB += data[i + 2];
    // Quantise to 5 bits per channel so anti-aliasing noise does not inflate the count.
    colours.add(((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3));
  }
  const pixels = canvas.width * canvas.height;
  return {
    size: `${canvas.width}x${canvas.height}`,
    coverage: Number((opaque / pixels).toFixed(3)),
    colours: colours.size,
    meanRgb: opaque === 0 ? null : [Math.round(sumR / opaque), Math.round(sumG / opaque), Math.round(sumB / opaque)],
  };
}

// ---------------------------------------------------------------- wait for the previews

openFolder('All objects');
await sleep(600);

let previous = -1;
let stable = 0;
for (let i = 0; i < 120; i++) {
  const count = qa('.assetStrip .objectPreview[data-preview="image"]').length;
  if (count === previous) stable++;
  else stable = 0;
  previous = count;
  if (stable >= 6 && count > 0) break;
  await sleep(1000);
}
report.waitedSeconds = null;
report.previewsReady = previous;
report.tiles = qa('.assetStrip .assetTile').length;
report.stillPending = qa('.assetStrip .uiSkeleton').length;
report.noModel = qa('.assetStrip .objectPreview[data-state="missing"]').length;

// Force the lazy images that are off-screen to load, so a screenshot of the grid is honest.
for (const img of qa('.assetStrip img')) img.loading = 'eager';
await sleep(1500);

// ---------------------------------------------------------------- measure the pixels

const urls = qa('.assetStrip .assetTile').map((tile) => ({
  label: tile.querySelector('strong')?.textContent ?? '',
  url: tile.querySelector('.objectPreview img')?.src ?? null,
}));
const withUrl = urls.filter((entry) => entry.url && entry.url.startsWith('data:image'));
report.withDataUrl = withUrl.length;

const sample = withUrl.slice(0, 24);
const measured = [];
for (const entry of sample) {
  try {
    measured.push({ label: entry.label, ...(await measure(entry.url)) });
  } catch (error) {
    measured.push({ label: entry.label, error: String(error) });
  }
}
report.measured = measured;

const good = measured.filter((m) => !m.error && m.coverage > 0.02 && m.colours >= 8);
report.verdict = {
  sampled: measured.length,
  drawnAndVaried: good.length,
  blankOrFlat: measured.filter((m) => !m.error && (m.coverage <= 0.02 || m.colours < 8)).map((m) => `${m.label} (coverage ${m.coverage}, ${m.colours} colours)`),
  errors: measured.filter((m) => m.error).length,
};

await shot(`${prefix}-all-objects-grid`);

// One tile close up, in the details pane.
const tile = q('.assetStrip .assetTile');
if (tile) tile.click();
await sleep(400);
report.detailsThumbnail = q('.browserDetails .thumbnailLarge img')?.src?.slice(0, 24) ?? null;
await shot(`${prefix}-details`);

// Favourites, which is what the user sees first.
openFolder('Favourites');
await sleep(1200);
for (const img of qa('.assetStrip img')) img.loading = 'eager';
await sleep(800);
report.favourites = {
  tiles: qa('.assetStrip .assetTile').length,
  withImage: qa('.assetStrip .objectPreview[data-preview="image"]').length,
};
await shot(`${prefix}-favourites`);

return report;
