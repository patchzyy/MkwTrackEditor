// A BRRES container re-emitter.
//
// `readBrresRaw` splits an archive into its header, its folder groups, the raw bytes of every
// sub-file (MDL0 / TEX0 / SRT0 / ...) and the trailing string pool. `writeBrres` puts it back
// together, recomputing the resource dictionaries, the section sizes and every relative offset.
// Round-tripping an untouched archive is byte-identical; that is what the unit tests assert
// against real `course_model.brres` files.
//
// Why sub-files can stay opaque
// -----------------------------
// Every pointer inside a sub-file is relative — to the sub-file, to a dictionary inside it, or
// to the struct that holds it. The one thing that points *outside* is a name, and names all
// live in the pool at the end of the archive. So a sub-file survives being moved as long as the
// pool moves by the same amount. `writeBrres` checks that invariant and only requires a caller
// to declare string fields (`stringRefs`) for sub-files it rewrites or invents — in practice
// the MDL0 the editor bakes into, and any texture it imports.

import { readCString, readStringPool, type BrresStringPool } from './stringPool';
import { readResDic, resDicSize, writeResDic } from './resDic';

export interface BrresStringRef {
  /** Byte offset, inside the sub-file, of the u32 field that holds the pointer. */
  offset: number;
  /** Offset the pointer is measured from, inside the sub-file. Defaults to 0. */
  base?: number;
  value: string;
}

export interface BrresSubFileRaw {
  name: string;
  magic: string;
  data: Uint8Array;
  /** Offset in the source archive, or -1 for a sub-file the editor created. */
  sourceOffset: number;
  /**
   * Self-relative string pointers inside `data`. `null` means "this blob was not rewritten, so
   * its pointers are still correct as long as it keeps its distance to the string pool".
   */
  stringRefs: BrresStringRef[] | null;
}

export interface BrresGroupRaw {
  name: string;
  entries: BrresSubFileRaw[];
}

export interface BrresRaw {
  version: number;
  /** The archive the model was read from. Needed to resolve names that live in the pool. */
  sourceFile: Uint8Array;
  groups: BrresGroupRaw[];
  /** Sub-files in archive order (the order they are laid out in). */
  layout: BrresSubFileRaw[];
  /** Padding that precedes each sub-file, keyed by the sub-file object. */
  padBefore: Map<BrresSubFileRaw, Uint8Array>;
  pool: BrresStringPool;
  /** Offset of the string pool in the source archive. */
  poolSourceOffset: number;
}

const BRRES_HEADER_SIZE = 0x10;
const ROOT_SECTION_HEADER_SIZE = 0x08;

export function readBrresRaw(file: Uint8Array): BrresRaw {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (readCString(file.subarray(0, 4), 0) !== 'bres') throw new Error('Not a BRRES archive.');
  if (view.getUint16(0x04) !== 0xfeff) throw new Error('BRRES: only big-endian archives are supported.');
  const version = view.getUint16(0x06);
  const rootOffset = view.getUint16(0x0c);
  if (readCString(file.subarray(rootOffset, rootOffset + 4), 0) !== 'root') throw new Error('BRRES: missing root section.');

  const rootDic = readResDic(file, rootOffset + ROOT_SECTION_HEADER_SIZE);
  if (!rootDic) throw new Error('BRRES: unreadable root dictionary.');

  const groups: BrresGroupRaw[] = [];
  const all: Array<{ subFile: BrresSubFileRaw; offset: number }> = [];
  for (const groupEntry of rootDic.entries) {
    const groupDic = readResDic(file, groupEntry.dataOffset);
    if (!groupDic) throw new Error(`BRRES: unreadable "${groupEntry.name}" dictionary.`);
    const entries: BrresSubFileRaw[] = [];
    for (const entry of groupDic.entries) {
      const size = view.getUint32(entry.dataOffset + 0x04);
      if (size <= 0 || entry.dataOffset + size > file.length) {
        throw new Error(`BRRES: "${entry.name}" has an out-of-range size.`);
      }
      const subFile: BrresSubFileRaw = {
        name: entry.name,
        magic: readCString(file.subarray(entry.dataOffset, entry.dataOffset + 4), 0),
        data: file.slice(entry.dataOffset, entry.dataOffset + size),
        sourceOffset: entry.dataOffset,
        stringRefs: null,
      };
      entries.push(subFile);
      all.push({ subFile, offset: entry.dataOffset });
    }
    groups.push({ name: groupEntry.name, entries });
  }

  all.sort((a, b) => a.offset - b.offset);
  const layout = all.map((item) => item.subFile);

  const rootSectionSize = view.getUint32(rootOffset + 0x04);
  const padBefore = new Map<BrresSubFileRaw, Uint8Array>();
  let cursor = rootOffset + rootSectionSize;
  for (const subFile of layout) {
    if (subFile.sourceOffset < cursor) throw new Error(`BRRES: "${subFile.name}" overlaps the previous sub-file.`);
    padBefore.set(subFile, file.slice(cursor, subFile.sourceOffset));
    cursor = subFile.sourceOffset + subFile.data.length;
  }

  return {
    version,
    sourceFile: file,
    groups,
    layout,
    padBefore,
    pool: readStringPool(file, cursor, file.length),
    poolSourceOffset: cursor,
  };
}

function computeRootSectionSize(groups: readonly BrresGroupRaw[]): number {
  let size = ROOT_SECTION_HEADER_SIZE + resDicSize(groups.length);
  for (const group of groups) size += resDicSize(group.entries.length);
  return size;
}

export function writeBrres(raw: BrresRaw): Uint8Array {
  const rootOffset = BRRES_HEADER_SIZE;
  const rootSectionSize = computeRootSectionSize(raw.groups);

  // Lay out: header, root section, sub-files (with their original padding), string pool.
  const placement = new Map<BrresSubFileRaw, number>();
  let cursor = rootOffset + rootSectionSize;
  for (const subFile of raw.layout) {
    cursor += raw.padBefore.get(subFile)?.length ?? 0;
    placement.set(subFile, cursor);
    cursor += subFile.data.length;
  }
  const poolOffset = cursor;
  const fileLength = poolOffset + raw.pool.bytes.length;

  const out = new Uint8Array(fileLength);
  const view = new DataView(out.buffer);

  out.set(new TextEncoder().encode('bres'), 0);
  view.setUint16(0x04, 0xfeff);
  view.setUint16(0x06, raw.version);
  view.setUint32(0x08, fileLength);
  view.setUint16(0x0c, rootOffset);
  view.setUint16(0x0e, raw.layout.length + 1);

  out.set(new TextEncoder().encode('root'), rootOffset);
  view.setUint32(rootOffset + 0x04, rootSectionSize);

  // Sub-file bodies first, so their headers can be patched afterwards.
  const poolShift = poolOffset - raw.poolSourceOffset;
  for (const subFile of raw.layout) {
    const target = placement.get(subFile)!;
    const pad = raw.padBefore.get(subFile);
    if (pad && pad.length > 0) out.set(pad, target - pad.length);
    out.set(subFile.data, target);
    const bodyView = new DataView(out.buffer, target, subFile.data.length);
    bodyView.setUint32(0x04, subFile.data.length);
    bodyView.setInt32(0x0c, -target);
    if (subFile.stringRefs) {
      for (const ref of subFile.stringRefs) {
        const base = ref.base ?? 0;
        const absolute = poolOffset + resolveString(raw.pool, ref.value);
        bodyView.setInt32(ref.offset, absolute - (target + base));
      }
    } else if (subFile.sourceOffset < 0) {
      throw new Error(`BRRES: new sub-file "${subFile.name}" must declare its string references.`);
    } else if (target - subFile.sourceOffset !== poolShift) {
      throw new Error(
        `BRRES: "${subFile.name}" moved by ${target - subFile.sourceOffset} but the string pool moved by ${poolShift}; ` +
          'its names would dangle. Sub-files that change position relative to the pool must declare their string references.',
      );
    }
  }

  out.set(raw.pool.bytes, poolOffset);

  // Root dictionary of folder groups, then one dictionary per group.
  let groupDicOffset = rootOffset + ROOT_SECTION_HEADER_SIZE + resDicSize(raw.groups.length);
  const groupOffsets = raw.groups.map((group) => {
    const offset = groupDicOffset;
    groupDicOffset += resDicSize(group.entries.length);
    return offset;
  });
  writeResDic(
    out,
    rootOffset + ROOT_SECTION_HEADER_SIZE,
    raw.groups.map((group, index) => ({
      name: group.name,
      nameOffset: poolOffset + resolveString(raw.pool, group.name),
      dataOffset: groupOffsets[index],
    })),
  );
  raw.groups.forEach((group, index) => {
    writeResDic(
      out,
      groupOffsets[index],
      group.entries.map((entry) => ({
        name: entry.name,
        nameOffset: poolOffset + resolveString(raw.pool, entry.name),
        dataOffset: placement.get(entry)!,
      })),
    );
  });

  return out;
}

function resolveString(pool: BrresStringPool, name: string): number {
  const offset = pool.offsets.get(name);
  if (offset === undefined) throw new Error(`BRRES: "${name}" is not in the string pool.`);
  return offset;
}

/** Finds a sub-file by group and name. */
export function findSubFile(raw: BrresRaw, groupName: string, name: string): BrresSubFileRaw | null {
  return raw.groups.find((group) => group.name === groupName)?.entries.find((entry) => entry.name === name) ?? null;
}

/**
 * Resolves a name referenced from inside `subFile`. Names sit in the archive's string pool,
 * past the end of the sub-file, so this reaches back into the source archive.
 */
export function makeSubFileNameReader(raw: BrresRaw, subFile: BrresSubFileRaw): (offsetFromStart: number) => string {
  const base = subFile.sourceOffset;
  if (base < 0) return () => '';
  return (offsetFromStart: number) => readCString(raw.sourceFile, base + offsetFromStart);
}

export const BRRES_MODELS_GROUP = '3DModels(NW4R)';
export const BRRES_TEXTURES_GROUP = 'Textures(NW4R)';
