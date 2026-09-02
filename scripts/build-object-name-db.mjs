import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, so the script works from any working directory and on any host. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A checkout of https://github.com/hlorenzi/kmp-editor. Override with KMP_EDITOR_SRC=... */
const sourcePath = process.env.KMP_EDITOR_SRC ?? path.join(repoRoot, 'vendor/kmp-editor/src/viewer/viewerObjects.js');
const outputPath = path.join(repoRoot, 'src/generated/mkwObjectNames.json');

if (!existsSync(sourcePath)) {
  console.error(`Cannot find viewerObjects.js at ${sourcePath}.`);
  console.error("Clone hlorenzi's kmp-editor and point KMP_EDITOR_SRC at src/viewer/viewerObjects.js.");
  process.exit(1);
}

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
