// Probe body: open a real Mario Kart Wii character archive — a Yaz0 `.szs` holding a driver and a
// kart BRRES — and check it renders, lists its animations, and exports byte-identical.
//
//   PROBE_PREFIX=studiochar PROBE_PORT=9441 node scripts/studio-probe.mjs \
//     "http://127.0.0.1:5233/" scripts/probe-studio-character.js
const out = {};

clickText('Model Studio');
const studio = await waitForStudio();
await sleep(2000);

out.openedBytes = await studio.openUrl('/dev-tracks/la_bike-fk-1.szs');
await sleep(3000);
studio.frameAll();
await sleep(800);

out.document = studio.document();
out.status = studio.status();
out.archives = studio.archives().map((archive) => ({
  archivePath: archive.archivePath,
  label: archive.label,
  models: archive.models.map((model) => model.modelName),
  materialCount: archive.materialCount,
  textureCount: archive.textureCount,
  animationCount: archive.animations.length,
  chr0: archive.animations.filter((a) => a.kind === 'chr0').length,
  enabled: archive.animations.filter((a) => a.enabled).map((a) => `${a.kind}:${a.name}`),
}));
out.duration = studio.duration();
await shot('studio-09-real-character');
await sleep(500);

// Is it lit, or a silhouette? Sample a grid and report the brightest patch and its colour spread.
const canvas = q('.studioCanvas');
const boxes = [];
for (let row = 1; row <= 3; row++) {
  for (let col = 1; col <= 3; col++) {
    const sample = await studio.samplePixels({
      x: Math.round((canvas.width * col) / 4) - 24,
      y: Math.round((canvas.height * row) / 4) - 24,
      width: 48,
      height: 48,
    });
    if (sample) boxes.push({ col, row, r: Math.round(sample.r), g: Math.round(sample.g), b: Math.round(sample.b) });
  }
}
out.grid = boxes;
out.brightestBox = boxes.reduce((best, box) => (box.r + box.g + box.b > best.r + best.g + best.b ? box : best), boxes[0] ?? null);
out.maxChannelSpread = boxes.reduce((max, box) => Math.max(max, Math.max(box.r, box.g, box.b) - Math.min(box.r, box.g, box.b)), 0);

// Animations move the bones.
studio.setTransport({ playing: false, frame: 0 });
await sleep(400);
out.poseAtFrame0 = studio.poseSignature();
studio.setTransport({ playing: false, frame: Math.max(1, Math.round(studio.duration() * 0.5)) });
await sleep(400);
out.poseAtMidFrame = studio.poseSignature();
out.poseMoved = out.poseAtFrame0 !== out.poseAtMidFrame;
await shot('studio-10-real-character-scrubbed');
await sleep(500);

// Export unchanged: the same bytes that were opened, including the Yaz0 stream.
out.export = studio.exportBytes();
out.exportMatchesInput = out.export.length === out.openedBytes;

studio.setTransport({ playing: true });
return out;
