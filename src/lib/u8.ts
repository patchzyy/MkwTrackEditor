import { align, BinReader, BinWriter } from './binary';

export interface U8Entry {
  path: string;
  type: 'file' | 'directory';
  data?: Uint8Array;
}

interface NodeInfo {
  type: number;
  nameOffset: number;
  dataOffset: number;
  size: number;
  index: number;
}

export function parseU8(data: Uint8Array): U8Entry[] {
  const buffer = data.slice().buffer;
  const reader = new BinReader(buffer);
  if (reader.u32(0) !== 0x55aa382d) throw new Error('Not a U8 archive');

  const rootOffset = reader.u32(4);
  const firstNode = readNode(reader, rootOffset, 0);
  const nodeCount = firstNode.size;
  const stringTableOffset = rootOffset + nodeCount * 12;
  const nodes = Array.from({ length: nodeCount }, (_, i) => readNode(reader, rootOffset + i * 12, i));
  const entries: U8Entry[] = [];

  function walk(index: number, parent: string): number {
    const node = nodes[index];
    const name = reader.cstr(stringTableOffset + node.nameOffset);
    const path = parent && name ? `${parent}/${name}` : name;
    if (node.type === 1) {
      if (path) entries.push({ path, type: 'directory' });
      let child = index + 1;
      while (child < node.size) child = walk(child, path);
      return node.size;
    }

    entries.push({
      path,
      type: 'file',
      data: new Uint8Array(buffer.slice(node.dataOffset, node.dataOffset + node.size)),
    });
    return index + 1;
  }

  walk(0, '');
  return entries.filter((entry) => entry.path);
}

function readNode(reader: BinReader, offset: number, index: number): NodeInfo {
  const typeAndName = reader.u32(offset);
  return {
    type: typeAndName >>> 24,
    nameOffset: typeAndName & 0x00ffffff,
    dataOffset: reader.u32(offset + 4),
    size: reader.u32(offset + 8),
    index,
  };
}

export function buildU8(entries: U8Entry[]): Uint8Array {
  const tree = makeDir('');
  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean);
    let dir = tree;
    for (const part of parts.slice(0, -1)) {
      dir = dir.dirs.get(part) ?? addDir(dir, part);
    }
    const name = parts.at(-1);
    if (!name) continue;
    if (entry.type === 'directory') addDir(dir, name);
    else dir.files.set(name, entry.data ?? new Uint8Array());
  }

  const flat: Array<{ name: string; node: DirNode | FileNode; parent: number; end?: number }> = [];
  flatten(tree, 0, flat);
  for (let i = flat.length - 1; i >= 0; i--) {
    const item = flat[i];
    if ('dirs' in item.node) {
      let end = i + 1;
      while (end < flat.length && isDescendant(flat, end, i)) end++;
      item.end = end;
    }
  }

  const strings = new BinWriter();
  strings.u8(0);
  const nameOffsets = flat.map((item, i) => {
    if (i === 0) return 0;
    const offset = strings.length;
    strings.ascii(item.name);
    strings.u8(0);
    return offset;
  });

  const nodeTableSize = flat.length * 12;
  const dataStart = align(0x20 + nodeTableSize + strings.length, 0x20);
  let dataCursor = dataStart;
  const fileOffsets = new Map<number, number>();
  for (let i = 0; i < flat.length; i++) {
    const node = flat[i].node;
    if ('data' in node) {
      fileOffsets.set(i, dataCursor);
      dataCursor = align(dataCursor + node.data.length, 0x20);
    }
  }

  const writer = new BinWriter();
  writer.u32(0x55aa382d);
  writer.u32(0x20);
  writer.u32(nodeTableSize + strings.length);
  writer.u32(dataStart);
  writer.u32(0);
  writer.u32(0);
  writer.u32(0);
  writer.u32(0);

  for (let i = 0; i < flat.length; i++) {
    const item = flat[i];
    const node = item.node;
    if ('dirs' in node) {
      writer.u32(0x01000000 | nameOffsets[i]);
      writer.u32(item.parent);
      writer.u32(item.end ?? flat.length);
    } else {
      writer.u32(nameOffsets[i]);
      writer.u32(fileOffsets.get(i) ?? dataStart);
      writer.u32(node.data.length);
    }
  }
  writer.bytes(strings.toUint8Array());
  writer.pad(0x20);

  for (let i = 0; i < flat.length; i++) {
    const node = flat[i].node;
    if ('data' in node) {
      writer.bytes(node.data);
      writer.pad(0x20);
    }
  }

  return writer.toUint8Array();
}

interface DirNode {
  name: string;
  dirs: Map<string, DirNode>;
  files: Map<string, Uint8Array>;
}

interface FileNode {
  data: Uint8Array;
}

function makeDir(name: string): DirNode {
  return { name, dirs: new Map(), files: new Map() };
}

function addDir(parent: DirNode, name: string): DirNode {
  const existing = parent.dirs.get(name);
  if (existing) return existing;
  const dir = makeDir(name);
  parent.dirs.set(name, dir);
  return dir;
}

function flatten(node: DirNode, parent: number, out: Array<{ name: string; node: DirNode | FileNode; parent: number }>): void {
  const selfIndex = out.length;
  out.push({ name: node.name, node, parent });
  for (const [name, dir] of [...node.dirs.entries()].sort()) flatten(dir, selfIndex, out);
  for (const [name, data] of [...node.files.entries()].sort()) out.push({ name, node: { data }, parent: selfIndex });
}

function isDescendant(flat: Array<{ parent: number }>, child: number, ancestor: number): boolean {
  let cursor = flat[child].parent;
  while (cursor > 0) {
    if (cursor === ancestor) return true;
    cursor = flat[cursor].parent;
  }
  return ancestor === 0;
}
