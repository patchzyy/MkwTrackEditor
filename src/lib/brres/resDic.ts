// NW4R resource dictionary ("index group").
//
// Layout:
//   0x00 u32 size          = 0x18 + numEntries * 0x10
//   0x04 u32 numEntries    (does NOT count the root entry)
//   0x08 ... (numEntries + 1) entries of 0x10 bytes, index 0 being the root
//
// Entry:
//   0x00 u16 id            (charIndex << 3) | bitIndex, 0xFFFF for the root
//   0x02 u16 flag          always 0
//   0x04 u16 leftIndex     follow when the id's bit is clear
//   0x06 u16 rightIndex    follow when the id's bit is set
//   0x08 s32 nameOffset    relative to the start of the group; length prefix at nameOffset-4
//   0x0C s32 dataOffset    relative to the start of the group
//
// The id/left/right fields form a radix ("patricia") search tree the console uses to look a
// name up. `buildResDicIndexTree` reproduces the exact tree Nintendo's and BrawlCrate's tools
// emit, so a rebuilt dictionary is byte-identical to the original when the names are unchanged.

export interface ResDicIndexEntry {
  id: number;
  flag: number;
  left: number;
  right: number;
}

export interface ResDicEntryRaw extends ResDicIndexEntry {
  name: string;
  /** Absolute file offset of the entry's data. */
  dataOffset: number;
  /** Absolute file offset of the entry's name. */
  nameOffset: number;
}

export interface ResDicRaw {
  /** Absolute file offset of the group header. */
  tableOffset: number;
  size: number;
  root: ResDicIndexEntry;
  entries: ResDicEntryRaw[];
}

export function resDicSize(entryCount: number): number {
  return 0x18 + entryCount * 0x10;
}

function readCString(data: Uint8Array, offset: number): string {
  let end = offset;
  while (end < data.length && data[end] !== 0) end++;
  return new TextDecoder().decode(data.subarray(offset, end));
}

/**
 * `readName` resolves an absolute offset in `file` to a name. Inside an MDL0 the names live in
 * the surrounding archive's string pool, i.e. past the end of `file`, so callers there pass a
 * resolver that reaches into the whole archive.
 */
export function readResDic(
  file: Uint8Array,
  tableOffset: number,
  readName: (offset: number) => string = (offset) => readCString(file, offset),
): ResDicRaw | null {
  if (tableOffset === 0 || tableOffset + 8 > file.length) return null;
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const size = view.getUint32(tableOffset + 0x00);
  const count = view.getUint32(tableOffset + 0x04);
  if (count > 0xffff) throw new Error(`BRRES: implausible resource-dictionary entry count ${count}`);
  let cursor = tableOffset + 0x08;
  const root: ResDicIndexEntry = {
    id: view.getUint16(cursor + 0x00),
    flag: view.getUint16(cursor + 0x02),
    left: view.getUint16(cursor + 0x04),
    right: view.getUint16(cursor + 0x06),
  };
  cursor += 0x10;
  const entries: ResDicEntryRaw[] = [];
  for (let i = 0; i < count; i++) {
    const nameOffset = tableOffset + view.getInt32(cursor + 0x08);
    entries.push({
      id: view.getUint16(cursor + 0x00),
      flag: view.getUint16(cursor + 0x02),
      left: view.getUint16(cursor + 0x04),
      right: view.getUint16(cursor + 0x06),
      nameOffset,
      dataOffset: tableOffset + view.getInt32(cursor + 0x0c),
      name: readName(nameOffset),
    });
    cursor += 0x10;
  }
  return { tableOffset, size, root, entries };
}

export interface ResDicWriteEntry {
  name: string;
  /** Absolute file offset of the entry's data. */
  dataOffset: number;
  /** Absolute file offset of the entry's name. */
  nameOffset: number;
}

/**
 * Writes a resource dictionary at `tableOffset` into `out`, recomputing the search tree from
 * the entry names. Offsets are stored relative to `tableOffset`.
 */
export function writeResDic(out: Uint8Array, tableOffset: number, entries: readonly ResDicWriteEntry[]): void {
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const tree = buildResDicIndexTree(entries.map((entry) => entry.name));
  view.setUint32(tableOffset + 0x00, resDicSize(entries.length));
  view.setUint32(tableOffset + 0x04, entries.length);
  let cursor = tableOffset + 0x08;
  for (let i = 0; i <= entries.length; i++) {
    const node = tree[i];
    view.setUint16(cursor + 0x00, node.id);
    view.setUint16(cursor + 0x02, node.flag);
    view.setUint16(cursor + 0x04, node.left);
    view.setUint16(cursor + 0x06, node.right);
    if (i === 0) {
      view.setInt32(cursor + 0x08, 0);
      view.setInt32(cursor + 0x0c, 0);
    } else {
      const entry = entries[i - 1];
      view.setInt32(cursor + 0x08, entry.nameOffset - tableOffset);
      view.setInt32(cursor + 0x0c, entry.dataOffset - tableOffset);
    }
    cursor += 0x10;
  }
}

function highestBit(value: number): number {
  for (let i = 7; i >= 0; i--) if ((value >> i) & 1) return i;
  return 0;
}

function toBytes(text: string): Uint8Array {
  const utf8 = new TextEncoder().encode(text);
  return utf8;
}

/**
 * Rebuilds the radix search tree for a dictionary. Entry `i` of the result corresponds to file
 * entry `i`; index 0 is the root. Insertion order is load bearing — pass the names in the exact
 * order they will be written.
 *
 * Transcribed from BrawlLib's `ResourceEntry.Build` and cross-checked against wiimms'
 * `CalcEntryBRRES`; verified byte-identical against every dictionary in 26 real BRRES files.
 */
export function buildResDicIndexTree(names: readonly string[]): ResDicIndexEntry[] {
  const count = names.length;
  const encoded: Array<Uint8Array | null> = [null, ...names.map(toBytes)];
  const nameLength = (index: number) => (index === 0 ? 0 : encoded[index]!.length);
  // Names are treated as zero padded: the root has no name, and reading past the end of a name
  // hits its NUL terminator on the console.
  const charAt = (index: number, position: number) =>
    index === 0 || position < 0 || position >= encoded[index]!.length ? 0 : encoded[index]![position];

  const nodes: ResDicIndexEntry[] = [{ id: 0xffff, flag: 0, left: 0, right: 0 }];
  for (let i = 1; i <= count; i++) nodes.push({ id: 0, flag: 0, left: 0, right: 0 });

  for (let index = 1; index <= count; index++) {
    const length = nameLength(index);
    if (length === 0 || length > 0xffff) throw new Error(`BRRES: cannot index the name "${names[index - 1]}"`);

    // The initial id compares the name against the root's empty name.
    let charIndex = length - 1;
    let bitIndex = highestBit(charAt(index, charIndex));

    const entry = nodes[index];
    entry.id = (charIndex << 3) | bitIndex;
    entry.flag = 0;
    entry.left = index;
    entry.right = index;

    let previous = nodes[0];
    let currentIndex = previous.left;
    let current = nodes[currentIndex];
    let isRight = false;

    while (entry.id <= current.id && previous.id > current.id) {
      if (entry.id === current.id) {
        // Re-derive the id relative to `current`, scanning from the end of the name.
        for (charIndex = length; charIndex-- > 0 && charAt(index, charIndex) === charAt(currentIndex, charIndex); );
        if (charIndex < 0) {
          // Duplicate name. Real files store 0xFFFF here.
          entry.id = 0xffff;
          charIndex = 0x1fff;
          bitIndex = 7;
        } else {
          bitIndex = highestBit(charAt(index, charIndex) ^ charAt(currentIndex, charIndex));
          entry.id = (charIndex << 3) | bitIndex;
        }
        if (charIndex < nameLength(currentIndex) && ((charAt(currentIndex, charIndex) >> bitIndex) & 1) !== 0) {
          entry.left = index;
          entry.right = currentIndex;
        } else {
          entry.left = currentIndex;
          entry.right = index;
        }
      }

      const position = current.id >> 3;
      isRight = position < length && ((charAt(index, position) >> (current.id & 7)) & 1) !== 0;
      previous = current;
      currentIndex = isRight ? current.right : current.left;
      current = nodes[currentIndex];
    }

    if (nameLength(currentIndex) === length && ((charAt(currentIndex, charIndex) >> bitIndex) & 1) !== 0) {
      entry.right = currentIndex;
    } else {
      entry.left = currentIndex;
    }
    if (isRight) previous.right = index;
    else previous.left = index;
  }

  return nodes;
}

/** The console-side lookup, used by tests to prove a rebuilt tree resolves every name. */
export function lookupResDicIndex(nodes: readonly ResDicIndexEntry[], names: readonly string[], name: string): number {
  const bytes = toBytes(name);
  const bit = (id: number) => {
    const position = id >> 3;
    return position < bytes.length && ((bytes[position] >> (id & 7)) & 1) !== 0;
  };
  let previous = nodes[0];
  let index = previous.left;
  let current = nodes[index];
  let guard = 0;
  while (previous.id > current.id) {
    if (guard++ > nodes.length + 2) return -1;
    previous = current;
    index = bit(current.id) ? current.right : current.left;
    current = nodes[index];
  }
  return index >= 1 && names[index - 1] === name ? index : -1;
}
