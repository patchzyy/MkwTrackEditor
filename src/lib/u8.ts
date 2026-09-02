import { align, BinReader } from './binary';

export interface U8Entry {
  path: string;
  type: 'file' | 'directory';
  data?: Uint8Array;
}

/**
 * Everything about a U8 archive that is not implied by its entry list. Capturing it lets
 * `buildU8` reproduce a source archive byte-for-byte when its contents did not change,
 * which is what makes "files the editor did not touch stay identical" verifiable.
 */
export interface U8Layout {
  /** Data-block alignment. Mario Kart Wii archives use 0x20. */
  alignment: number;
  /** The four reserved u32s at 0x10. Nintendo writes zeroes, Wiimm's tools write 0xCCCCCCCC. */
  reservedWords: number[];
  /** Raw value of the "table size" u32 at 0x08, if it should be preserved verbatim. */
  tableSize?: number;
  /** Raw value of the "data offset" u32 at 0x0C, if it should be preserved verbatim. */
  dataStart?: number;
  /** The string table exactly as it appeared, so name offsets stay stable. */
  stringTable?: Uint8Array;
  /** Name offset per node, in node order (index 0 is the root). */
  nameOffsets?: number[];
  /**
   * Parent index per directory node, in node order. Some archive tools write values that are
   * off by one when the archive has a "." wrapper directory; readers ignore the field, so
   * these are kept verbatim rather than "fixed", to keep untouched archives byte-identical.
   */
  nodeParents?: number[];
  /**
   * "One past the last child" index per directory node. A few real tracks ship archives
   * where these are inconsistent; they are kept verbatim for the same reason.
   */
  nodeEnds?: number[];
  /** Paths in node order (index 0 is the root, whose path is ''). Used to validate reuse. */
  nodePaths?: string[];
  /** Bytes of padding that followed the last file in the source archive. */
  trailingPadding?: number;
}

interface NodeInfo {
  type: number;
  nameOffset: number;
  dataOffset: number;
  size: number;
  index: number;
}

export function parseU8(data: Uint8Array): U8Entry[] {
  return parseU8WithLayout(data).entries;
}

export function parseU8WithLayout(data: Uint8Array): { entries: U8Entry[]; layout: U8Layout } {
  const buffer = data.slice().buffer;
  const reader = new BinReader(buffer);
  if (reader.u32(0) !== 0x55aa382d) throw new Error('Not a U8 archive');

  const rootOffset = reader.u32(4);
  const tableSize = reader.u32(8);
  const declaredDataStart = reader.u32(12);
  const reservedWords = [reader.u32(16), reader.u32(20), reader.u32(24), reader.u32(28)];
  const firstNode = readNode(reader, rootOffset, 0);
  const nodeCount = firstNode.size;
  const stringTableOffset = rootOffset + nodeCount * 12;
  const nodes = Array.from({ length: nodeCount }, (_, i) => readNode(reader, rootOffset + i * 12, i));
  const entries: U8Entry[] = [];
  const nodePaths: string[] = new Array(nodeCount).fill('');
  const nameOffsets = nodes.map((node) => node.nameOffset);
  const nodeParents = nodes.map((node) => (node.type === 1 ? node.dataOffset : 0));
  const nodeEnds = nodes.map((node) => (node.type === 1 ? node.size : 0));

  /**
   * `limit` clamps a directory to its parent's range. A handful of real tracks ship archives
   * whose directory end indices overlap; without the clamp those nodes get visited twice and
   * files appear in the entry list more than once.
   */
  function walk(index: number, parent: string, limit: number): number {
    const node = nodes[index];
    const name = reader.cstr(stringTableOffset + node.nameOffset);
    const path = parent && name ? `${parent}/${name}` : name;
    nodePaths[index] = path;
    if (node.type === 1) {
      if (path) entries.push({ path, type: 'directory' });
      const end = Math.min(Math.max(node.size, index + 1), limit);
      let child = index + 1;
      while (child < end) child = walk(child, path, end);
      return end;
    }

    entries.push({
      path,
      type: 'file',
      data: new Uint8Array(buffer.slice(node.dataOffset, node.dataOffset + node.size)),
    });
    return index + 1;
  }

  walk(0, '', nodeCount);

  const fileNodes = nodes.filter((node) => node.type !== 1);
  const alignment = inferAlignment(fileNodes);
  const stringTableEnd = fileNodes.length > 0 ? Math.min(...fileNodes.map((node) => node.dataOffset)) : data.length;
  const stringTable = new Uint8Array(buffer.slice(stringTableOffset, Math.max(stringTableOffset, Math.min(stringTableEnd, data.length))));
  const lastEnd = fileNodes.length > 0 ? Math.max(...fileNodes.map((node) => node.dataOffset + node.size)) : data.length;

  return {
    entries: entries.filter((entry) => entry.path),
    layout: {
      alignment,
      reservedWords,
      tableSize,
      dataStart: declaredDataStart,
      stringTable,
      nameOffsets,
      nodeParents,
      nodeEnds,
      nodePaths,
      trailingPadding: Math.max(0, data.length - lastEnd),
    },
  };
}

function inferAlignment(fileNodes: NodeInfo[]): number {
  for (const candidate of [0x20, 0x10, 0x08, 0x04]) {
    if (fileNodes.every((node) => node.dataOffset % candidate === 0)) return candidate;
  }
  return 0x04;
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

interface FlatNode {
  name: string;
  path: string;
  parent: number;
  data?: Uint8Array;
  end?: number;
}

/**
 * Flattens the entry list into U8 node order. Children keep the order in which they first
 * appear in `entries`, so `buildU8(parseU8(x))` reproduces the original node table order.
 */
function flattenEntries(entries: U8Entry[]): FlatNode[] {
  interface Dir {
    node: FlatNode;
    children: Array<{ kind: 'dir'; dir: Dir } | { kind: 'file'; node: FlatNode }>;
    dirs: Map<string, Dir>;
    files: Set<string>;
  }
  const makeDir = (name: string, path: string, parent: number): Dir => ({
    node: { name, path, parent },
    children: [],
    dirs: new Map(),
    files: new Set(),
  });
  const root = makeDir('', '', 0);

  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    let dir = root;
    let prefix = '';
    for (const part of parts.slice(0, entry.type === 'directory' ? parts.length : parts.length - 1)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      let child = dir.dirs.get(part);
      if (!child) {
        child = makeDir(part, prefix, 0);
        dir.dirs.set(part, child);
        dir.children.push({ kind: 'dir', dir: child });
      }
      dir = child;
    }
    if (entry.type === 'directory') continue;
    const name = parts.at(-1)!;
    if (dir.files.has(name)) {
      const existing = dir.children.find((child) => child.kind === 'file' && child.node.name === name);
      if (existing && existing.kind === 'file') existing.node.data = entry.data ?? new Uint8Array();
      continue;
    }
    dir.files.add(name);
    dir.children.push({ kind: 'file', node: { name, path: entry.path, parent: 0, data: entry.data ?? new Uint8Array() } });
  }

  const flat: FlatNode[] = [];
  const emit = (dir: Dir, parent: number) => {
    const selfIndex = flat.length;
    dir.node.parent = parent;
    flat.push(dir.node);
    for (const child of dir.children) {
      if (child.kind === 'dir') emit(child.dir, selfIndex);
      else {
        child.node.parent = selfIndex;
        flat.push(child.node);
      }
    }
    dir.node.end = flat.length;
  };
  emit(root, 0);
  return flat;
}

export function buildU8(entries: U8Entry[], layout?: U8Layout): Uint8Array {
  const flat = flattenEntries(entries);
  const alignment = layout?.alignment && layout.alignment > 0 ? layout.alignment : 0x20;
  const reservedWords = layout?.reservedWords ?? [0, 0, 0, 0];

  // Reuse the source string table (and its name offsets) when the node layout is unchanged,
  // so an untouched archive rebuilds byte-for-byte.
  const layoutMatches =
    !!layout?.nodePaths && layout.nodePaths.length === flat.length && layout.nodePaths.every((path, i) => path === flat[i].path);
  const canReuseStrings = layoutMatches && !!layout?.stringTable && !!layout.nameOffsets;
  const parents = layoutMatches && layout?.nodeParents?.length === flat.length ? layout.nodeParents : null;
  const ends = layoutMatches && layout?.nodeEnds?.length === flat.length ? layout.nodeEnds : null;

  let stringBytes: Uint8Array;
  let nameOffsets: number[];
  if (canReuseStrings) {
    stringBytes = layout!.stringTable!;
    nameOffsets = layout!.nameOffsets!;
  } else {
    const chunks: number[] = [0];
    nameOffsets = flat.map((node, i) => {
      if (i === 0) return 0;
      const offset = chunks.length;
      for (const byte of new TextEncoder().encode(node.name)) chunks.push(byte);
      chunks.push(0);
      return offset;
    });
    stringBytes = new Uint8Array(chunks);
  }

  const nodeTableSize = flat.length * 12;
  const naturalDataStart = align(0x20 + nodeTableSize + stringBytes.length, alignment);
  const dataStart =
    canReuseStrings && layout?.dataStart !== undefined && layout.dataStart >= 0x20 + nodeTableSize + stringBytes.length
      ? layout.dataStart
      : naturalDataStart;
  const tableSize = canReuseStrings && layout?.tableSize !== undefined ? layout.tableSize : nodeTableSize + stringBytes.length;

  let dataCursor = dataStart;
  const fileOffsets = new Map<number, number>();
  for (let i = 0; i < flat.length; i++) {
    const node = flat[i];
    if (node.data) {
      fileOffsets.set(i, dataCursor);
      dataCursor = align(dataCursor + node.data.length, alignment);
    }
  }
  const lastFileIndex = [...fileOffsets.keys()].at(-1);
  const lastEnd = lastFileIndex === undefined ? dataStart : fileOffsets.get(lastFileIndex)! + (flat[lastFileIndex].data?.length ?? 0);
  // An unchanged archive keeps exactly the trailing padding it had; most tools do not pad
  // the last file up to the alignment boundary. A rebuilt one is padded like every other file.
  const totalLength =
    layoutMatches && layout?.trailingPadding !== undefined ? Math.max(dataStart, lastEnd + layout.trailingPadding) : dataCursor;

  const out = new Uint8Array(totalLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x55aa382d, false);
  view.setUint32(4, 0x20, false);
  view.setUint32(8, tableSize, false);
  view.setUint32(12, dataStart, false);
  for (let i = 0; i < 4; i++) view.setUint32(16 + i * 4, reservedWords[i] >>> 0, false);

  for (let i = 0; i < flat.length; i++) {
    const node = flat[i];
    const base = 0x20 + i * 12;
    if (node.data) {
      view.setUint32(base, nameOffsets[i] & 0x00ffffff, false);
      view.setUint32(base + 4, fileOffsets.get(i) ?? dataStart, false);
      view.setUint32(base + 8, node.data.length, false);
    } else {
      view.setUint32(base, 0x01000000 | (nameOffsets[i] & 0x00ffffff), false);
      view.setUint32(base + 4, parents ? parents[i] : node.parent, false);
      view.setUint32(base + 8, ends ? ends[i] : node.end ?? flat.length, false);
    }
  }
  out.set(stringBytes, 0x20 + nodeTableSize);

  for (const [index, offset] of fileOffsets) {
    const data = flat[index].data;
    if (data) out.set(data, offset);
  }

  return out;
}
