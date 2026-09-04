// Prints the interesting numbers from a `scripts/loading-probe.mjs` run.
//
//   node scripts/loading-probe.mjs <url> scripts/probe-loading.js | node scripts/summarize-loading-probe.mjs
//
// The probe prints a JSON blob after "script result:"; this pulls out the headline numbers and
// the stalls so a before/after comparison is one line each instead of a wall of JSON.
let text = '';
for await (const chunk of process.stdin) text += chunk;

const marker = 'script result:';
const start = text.indexOf(marker);
if (start < 0) {
  console.error(text.slice(0, 2000));
  process.exit(1);
}
const end = text.indexOf('\n}', start) + 2;
const result = JSON.parse(text.slice(start + marker.length, end));

const headline = ['loaded', 'sawOverlay', 'rendererStatus', 'meshes', 'kmpEntities', 'kclTriangles', 'longestGapMs', 'longestGapAtMs', 'idleLongestGapMs'];
console.log(Object.fromEntries(headline.map((key) => [key, result[key]])));
for (const stall of (result.stalls ?? []).slice(0, 8)) {
  console.log(`  stall @${stall.at}ms  ${stall.gap}ms  ${stall.stage ?? '-'}${stall.detail ? ` / ${stall.detail}` : ''}`);
}
for (const sample of (result.overlaySamples ?? []).slice(0, 30)) {
  console.log(`  overlay @${sample.at}ms  ${sample.percent}%  ${sample.title}${sample.detail ? ` / ${sample.detail}` : ''}`);
}
