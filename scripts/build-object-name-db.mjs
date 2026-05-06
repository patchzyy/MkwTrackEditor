import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const sourcePath = '/mnt/g/ai/MkwTrackEditor/vendor/kmp-editor/src/viewer/viewerObjects.js';
const outputPath = '/mnt/g/ai/MkwTrackEditor/src/generated/mkwObjectNames.json';

const source = readFileSync(sourcePath, 'utf8');
const entries = {};
const pattern = /objectNames\[(0x[0-9a-f]+|\d+)\]\s*=\s*"([^"]+)"/gi;

for (const match of source.matchAll(pattern)) {
  const rawId = match[1];
  const id = rawId.toLowerCase().startsWith('0x') ? Number.parseInt(rawId, 16) : Number.parseInt(rawId, 10);
  if (!Number.isFinite(id)) continue;
  entries[id] = match[2].trim();
}

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(entries, null, 2)}\n`);
console.log(`Wrote ${Object.keys(entries).length} object names to ${outputPath}`);
