import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const sourcePath = '/mnt/g/Games/Wii/mkwii-europe/Race/Kart/lb_bike-fk.szs';
const outputPath = '/mnt/g/ai/MkwTrackEditor/public/data/MarioKartWii/Race/PreviewDummies.u8';
const previewFiles = new Map([
  ['driver_model.brres', 'Preview/fk_lb_driver_model.brres'],
  ['kart_model.brres', 'Preview/fk_lb_kart_model.brres'],
]);

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

function readNode(view, offset) {
  const typeAndName = view.getUint32(offset, false);
  return {
    type: typeAndName >>> 24,
    nameOffset: typeAndName & 0x00ffffff,
    dataOffset: view.getUint32(offset + 4, false),
    size: view.getUint32(offset + 8, false),
  };
}

function parseU8(data) {
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const view = new DataView(buffer);
  if (view.getUint32(0, false) !== 0x55aa382d) throw new Error('Not a U8 archive');
  const rootOffset = view.getUint32(4, false);
  const rootNode = readNode(view, rootOffset);
  const nodeCount = rootNode.size;
  const stringTableOffset = rootOffset + nodeCount * 12;
  const nodes = Array.from({ length: nodeCount }, (_, index) => readNode(view, rootOffset + index * 12));
  const entries = [];
  const bytes = new Uint8Array(buffer);

  function readCString(offset) {
    let end = offset;
    while (end < bytes.length && bytes[end] !== 0) end++;
    return Buffer.from(bytes.slice(offset, end)).toString('utf8');
  }

  function walk(index, parent) {
    const node = nodes[index];
    const name = readCString(stringTableOffset + node.nameOffset);
    const entryPath = parent && name ? `${parent}/${name}` : name;
    if (node.type === 1) {
      let child = index + 1;
      while (child < node.size) child = walk(child, entryPath);
      return node.size;
    }
    entries.push({
      path: entryPath,
      type: 'file',
      data: new Uint8Array(buffer.slice(node.dataOffset, node.dataOffset + node.size)),
    });
    return index + 1;
  }

  walk(0, '');
  return entries.filter((entry) => entry.path);
}

function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function buildU8(entries) {
  const tree = makeDir('');
  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean);
    let dir = tree;
    for (const part of parts.slice(0, -1)) dir = dir.dirs.get(part) ?? addDir(dir, part);
    const name = parts.at(-1);
    if (!name) continue;
    dir.files.set(name, entry.data ?? new Uint8Array());
  }

  const flat = [];
  flatten(tree, 0, flat);
  for (let i = flat.length - 1; i >= 0; i--) {
    const item = flat[i];
    if ('dirs' in item.node) {
      let end = i + 1;
      while (end < flat.length && isDescendant(flat, end, i)) end++;
      item.end = end;
    }
  }

  const strings = [0];
  const nameOffsets = flat.map((item, index) => {
    if (index === 0) return 0;
    const offset = strings.length;
    const encoded = new TextEncoder().encode(item.name);
    for (const byte of encoded) strings.push(byte);
    strings.push(0);
    return offset;
  });

  const nodeTableSize = flat.length * 12;
  const dataStart = align(0x20 + nodeTableSize + strings.length, 0x20);
  let dataCursor = dataStart;
  const fileOffsets = new Map();
  for (let i = 0; i < flat.length; i++) {
    if ('data' in flat[i].node) {
      fileOffsets.set(i, dataCursor);
      dataCursor = align(dataCursor + flat[i].node.data.length, 0x20);
    }
  }

  const out = [];
  const pushU8 = (value) => out.push(value & 0xff);
  const pushU32 = (value) => out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  const pushBytes = (value) => {
    for (const byte of value) out.push(byte);
  };
  const pad = (alignment, fill = 0) => {
    while (out.length % alignment !== 0) pushU8(fill);
  };

  pushU32(0x55aa382d);
  pushU32(0x20);
  pushU32(nodeTableSize + strings.length);
  pushU32(dataStart);
  pushU32(0);
  pushU32(0);
  pushU32(0);
  pushU32(0);

  for (let i = 0; i < flat.length; i++) {
    const item = flat[i];
    if ('dirs' in item.node) {
      pushU32(0x01000000 | nameOffsets[i]);
      pushU32(item.parent);
      pushU32(item.end ?? flat.length);
    } else {
      pushU32(nameOffsets[i]);
      pushU32(fileOffsets.get(i) ?? dataStart);
      pushU32(item.node.data.length);
    }
  }

  pushBytes(strings);
  pad(0x20);

  for (const item of flat) {
    if ('data' in item.node) {
      pushBytes(item.node.data);
      pad(0x20);
    }
  }

  return new Uint8Array(out);
}

function makeDir(name) {
  return { name, dirs: new Map(), files: new Map() };
}

function addDir(parent, name) {
  const existing = parent.dirs.get(name);
  if (existing) return existing;
  const dir = makeDir(name);
  parent.dirs.set(name, dir);
  return dir;
}

function flatten(node, parent, out) {
  const selfIndex = out.length;
  out.push({ name: node.name, node, parent });
  for (const [, dir] of [...node.dirs.entries()].sort()) flatten(dir, selfIndex, out);
  for (const [name, data] of [...node.files.entries()].sort()) out.push({ name, node: { data }, parent: selfIndex });
}

function isDescendant(flat, child, ancestor) {
  let cursor = flat[child].parent;
  while (cursor > 0) {
    if (cursor === ancestor) return true;
    cursor = flat[cursor].parent;
  }
  return ancestor === 0;
}

const sourceEntries = parseU8(decodeYaz0(new Uint8Array(readFileSync(sourcePath))));
const outEntries = [];
for (const [sourceName, outputName] of previewFiles) {
  const match = sourceEntries.find((entry) => path.basename(entry.path).toLowerCase() === sourceName.toLowerCase());
  if (!match?.data) throw new Error(`Missing ${sourceName} in ${sourcePath}`);
  outEntries.push({ path: outputName, data: match.data });
}

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, buildU8(outEntries));
console.log(`Wrote ${outEntries.length} preview dummy assets to ${outputPath}`);
