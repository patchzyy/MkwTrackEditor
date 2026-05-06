import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const courseRoot = '/mnt/g/Games/Wii/mkwii-europe/Race/Course';
const outputPath = '/mnt/g/ai/MkwTrackEditor/public/data/MarioKartWii/Race/Course/course-asset-db.json';

function isYaz0(data) {
  return data.length >= 16 && Buffer.from(data.subarray(0, 4)).toString('ascii') === 'Yaz0';
}

function decodeYaz0(data) {
  if (!isYaz0(data)) return data;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decodedSize = view.getUint32(4, false);
  const out = new Uint8Array(decodedSize);
  let src = 16;
  let dst = 0;
  let validBits = 0;
  let code = 0;

  while (dst < decodedSize) {
    if (validBits === 0) {
      code = data[src++];
      validBits = 8;
    }

    if ((code & 0x80) !== 0) {
      out[dst++] = data[src++];
    } else {
      const b1 = data[src++];
      const b2 = data[src++];
      const dist = ((b1 & 0x0f) << 8) | b2;
      let count = b1 >>> 4;
      if (count === 0) count = data[src++] + 0x12;
      else count += 2;

      const copySrc = dst - (dist + 1);
      for (let i = 0; i < count && dst < decodedSize; i++) out[dst++] = out[copySrc + i];
    }

    code = (code << 1) & 0xff;
    validBits--;
  }

  return out;
}

function parseU8Entries(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, false) !== 0x55aa382d) throw new Error('Not a U8 archive');

  const rootOffset = view.getUint32(4, false);
  const rootNode = readNode(view, rootOffset);
  const nodeCount = rootNode.size;
  const stringTableOffset = rootOffset + nodeCount * 12;
  const nodes = Array.from({ length: nodeCount }, (_, index) => readNode(view, rootOffset + index * 12));
  const entries = [];

  function readCString(offset) {
    let end = offset;
    while (end < data.length && data[end] !== 0) end++;
    return Buffer.from(data.subarray(offset, end)).toString('utf8');
  }

  function walk(index, parent) {
    const node = nodes[index];
    const name = readCString(stringTableOffset + node.nameOffset);
    const entryPath = parent && name ? `${parent}/${name}` : name;
    if (node.type === 1) {
      if (entryPath) entries.push({ path: entryPath, type: 'directory' });
      let child = index + 1;
      while (child < node.size) child = walk(child, entryPath);
      return node.size;
    }
    entries.push({ path: entryPath, type: 'file', size: node.size });
    return index + 1;
  }

  walk(0, '');
  return entries.filter((entry) => entry.path);
}

function readNode(view, offset) {
  const typeAndName = view.getUint32(offset, false);
  return {
    type: typeAndName >>> 24,
    nameOffset: typeAndName & 0x00ffffff,
    dataOffset: view.getUint32(offset + 4, false),
    size: view.getUint32(offset + 8, false),
  };
}

function inferKind(baseName) {
  const lower = baseName.toLowerCase();
  if (lower === 'course_model.brres') return 'course';
  if (lower === 'vrcorn_model.brres') return 'skybox';
  if (lower.endsWith('.brres')) return 'object';
  return 'other';
}

function trackLabel(fileName) {
  return fileName.replace(/\.szs$/i, '').replace(/_/g, ' ');
}

const courseFiles = readdirSync(courseRoot)
  .filter((name) => name.toLowerCase().endsWith('.szs') && !name.toLowerCase().endsWith('_d.szs'))
  .sort();

const assets = [];
for (const fileName of courseFiles) {
  const raw = new Uint8Array(readFileSync(path.join(courseRoot, fileName)));
  const archiveEntries = parseU8Entries(decodeYaz0(raw));
  for (const entry of archiveEntries) {
    if (entry.type !== 'file' || !entry.path.toLowerCase().endsWith('.brres')) continue;
    const baseName = path.posix.basename(entry.path);
    assets.push({
      id: `${fileName}:${entry.path}`,
      source: 'courseArchive',
      trackFile: fileName,
      trackLabel: trackLabel(fileName),
      path: entry.path,
      baseName,
      kind: inferKind(baseName),
    });
  }
}

const sharedObjectDir = path.join(courseRoot, 'Object');
for (const fileName of readdirSync(sharedObjectDir).filter((name) => name.toLowerCase().endsWith('.brres')).sort()) {
  assets.push({
    id: `shared:${fileName}`,
    source: 'sharedObjectDir',
    trackFile: null,
    trackLabel: 'Shared Object',
    path: `Object/${fileName}`,
    baseName: fileName,
    kind: 'sharedObject',
  });
}

const payload = {
  generatedFrom: courseRoot,
  generatedAt: new Date().toISOString(),
  trackCount: courseFiles.length,
  assetCount: assets.length,
  uniqueBaseNames: [...new Set(assets.map((asset) => asset.baseName.toLowerCase()))].length,
  assets,
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${payload.assetCount} asset rows from ${payload.trackCount} tracks to ${outputPath}`);
