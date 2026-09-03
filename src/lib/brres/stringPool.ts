// NW4R string pool.
//
// Every name in a BRRES file lives in one contiguous pool at the very end of the archive,
// after the last sub-file. A pool entry is
//
//     [u32 byteLength][chars...][NUL][padding to a 4-byte boundary]
//
// and is referenced by an offset that points at the first character (so the length sits at
// `offset - 4`). References are always *relative* — to the start of the sub-file, to the start
// of a resource dictionary, or to the start of the struct that holds them — never absolute.

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export interface BrresStringPool {
  /**
   * The raw pool region, copied verbatim from the source file (including any trailing
   * padding). Keeping it byte-for-byte is what makes an untouched round trip exact.
   */
  bytes: Uint8Array;
  /** Name to its offset inside `bytes` (the offset of the first character). */
  offsets: Map<string, number>;
  /** Offsets that were appended by `internString`; used only by tests and diagnostics. */
  appended: string[];
}

/** Reads a NUL-terminated string. Used for both pool entries and sub-file names. */
export function readCString(data: Uint8Array, offset: number): string {
  if (offset < 0 || offset >= data.length) return '';
  let end = offset;
  while (end < data.length && data[end] !== 0) end++;
  return decoder.decode(data.subarray(offset, end));
}

function alignUp(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}

/**
 * Indexes the pool region `[start, end)` of `file`. Entries that do not look like NW4R strings
 * (padding, junk) are skipped; they stay in `bytes` and keep their offsets either way.
 */
export function readStringPool(file: Uint8Array, start: number, end: number): BrresStringPool {
  const bytes = file.slice(start, end);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offsets = new Map<string, number>();
  let cursor = 0;
  while (cursor + 4 < bytes.length) {
    const length = view.getUint32(cursor);
    const textStart = cursor + 4;
    if (length === 0 || length > 0x400 || textStart + length >= bytes.length || bytes[textStart + length] !== 0) {
      // Not a string record: skip a word and keep looking. Padding runs land here.
      cursor += 4;
      continue;
    }
    const text = decoder.decode(bytes.subarray(textStart, textStart + length));
    if (!offsets.has(text)) offsets.set(text, textStart);
    cursor = alignUp(textStart + length + 1, 4);
  }
  return { bytes, offsets, appended: [] };
}

/** Creates an empty pool (used when building a BRRES from scratch). */
export function createStringPool(): BrresStringPool {
  return { bytes: new Uint8Array(0), offsets: new Map(), appended: [] };
}

/**
 * Returns the pool-relative offset of `name`, appending it if it is not there yet. Appending
 * never moves an existing entry, so offsets handed out earlier stay valid.
 */
export function internString(pool: BrresStringPool, name: string): number {
  const existing = pool.offsets.get(name);
  if (existing !== undefined) return existing;
  const text = encoder.encode(name);
  const recordStart = alignUp(pool.bytes.length, 4);
  const recordSize = alignUp(4 + text.length + 1, 4);
  const next = new Uint8Array(recordStart + recordSize);
  next.set(pool.bytes, 0);
  new DataView(next.buffer).setUint32(recordStart, text.length);
  next.set(text, recordStart + 4);
  pool.bytes = next;
  const offset = recordStart + 4;
  pool.offsets.set(name, offset);
  pool.appended.push(name);
  return offset;
}
