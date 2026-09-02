import { BinReader, BinWriter } from './binary';

export function isYaz0(data: Uint8Array): boolean {
  return data.length >= 16 && String.fromCharCode(...data.slice(0, 4)) === 'Yaz0';
}

export function decodeYaz0(data: Uint8Array): Uint8Array {
  if (!isYaz0(data)) return data;
  const reader = new BinReader(data.slice().buffer);
  const decodedSize = reader.u32(4);
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

/**
 * Yaz0 "compression" that emits only literal bytes. Valid, but roughly 12.5% larger
 * than the input. Kept for callers that want the fastest possible encode.
 */
export function encodeYaz0Uncompressed(data: Uint8Array): Uint8Array {
  const writer = new BinWriter();
  writer.ascii('Yaz0', 4);
  writer.u32(data.length);
  writer.u32(0);
  writer.u32(0);

  for (let i = 0; i < data.length; i += 8) {
    const block = data.slice(i, i + 8);
    writer.u8(0xff);
    writer.bytes(block);
  }

  return writer.toUint8Array();
}

const YAZ0_MAX_DISTANCE = 0x1000;
const YAZ0_MAX_RUN = 0x111;
const YAZ0_MIN_RUN = 3;
const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;

export interface EncodeYaz0Options {
  /**
   * How many candidate positions to inspect per byte. Higher is smaller output but slower.
   * `0` disables matching entirely (equivalent to `encodeYaz0Uncompressed`).
   */
  searchDepth?: number;
}

function hash3(data: Uint8Array, at: number): number {
  return (((data[at] << 10) ^ (data[at + 1] << 5) ^ data[at + 2]) >>> 0) & (HASH_SIZE - 1);
}

/**
 * Real Yaz0 compression, using the same bitstream layout Nintendo's tools produce:
 * a code byte whose bits (MSB first) select "literal" (1) or "back reference" (0),
 * followed by the corresponding literal bytes / 2-or-3 byte references.
 *
 * The 16-byte header is `Yaz0`, big-endian decompressed size, then two reserved u32s
 * that the game ignores and that Nintendo leaves at zero.
 */
export function encodeYaz0(data: Uint8Array, options: EncodeYaz0Options = {}): Uint8Array {
  const searchDepth = options.searchDepth ?? 16;
  const length = data.length;
  // Worst case is 9 bytes of output per 8 input bytes, plus the 16-byte header.
  let buffer = new Uint8Array(16 + length + Math.ceil(length / 8) + 32);
  let outLength = 0;
  const ensure = (extra: number) => {
    if (outLength + extra <= buffer.length) return;
    const grown = new Uint8Array(Math.max(buffer.length * 2, outLength + extra));
    grown.set(buffer.subarray(0, outLength));
    buffer = grown;
  };
  const out = (...bytes: number[]) => {
    ensure(bytes.length);
    for (const byte of bytes) buffer[outLength++] = byte;
  };
  // Header.
  out(0x59, 0x61, 0x7a, 0x30);
  out((length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff);
  out(0, 0, 0, 0, 0, 0, 0, 0);

  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(Math.max(1, length)).fill(-1);

  let codeIndex = -1;
  let codeBit = 0;
  let pos = 0;

  // Look-ahead state so we can emit a literal when a longer match starts one byte later.
  let pendingDistance = 0;
  let pendingRun = 0;
  let hasPending = false;

  const insert = (at: number) => {
    if (at + 2 >= length) return;
    const h = hash3(data, at);
    prev[at] = head[h];
    head[h] = at;
  };

  const findMatch = (at: number): { distance: number; run: number } => {
    if (searchDepth <= 0 || at + YAZ0_MIN_RUN > length) return { distance: 0, run: 0 };
    const minPos = Math.max(0, at - YAZ0_MAX_DISTANCE);
    const maxRun = Math.min(YAZ0_MAX_RUN, length - at);
    if (maxRun < YAZ0_MIN_RUN) return { distance: 0, run: 0 };
    let bestRun = 0;
    let bestDistance = 0;
    let candidate = head[hash3(data, at)];
    let tries = searchDepth;
    while (candidate >= minPos && tries-- > 0) {
      if (data[candidate + bestRun] === data[at + bestRun]) {
        let run = 0;
        while (run < maxRun && data[candidate + run] === data[at + run]) run++;
        if (run > bestRun) {
          bestRun = run;
          bestDistance = at - candidate;
          if (run >= maxRun) break;
        }
      }
      candidate = prev[candidate];
    }
    return bestRun >= YAZ0_MIN_RUN ? { distance: bestDistance, run: bestRun } : { distance: 0, run: 0 };
  };

  const beginGroup = () => {
    if (codeBit === 0) {
      codeIndex = outLength;
      out(0);
      codeBit = 8;
    }
  };

  while (pos < length) {
    let distance: number;
    let run: number;
    if (hasPending) {
      distance = pendingDistance;
      run = pendingRun;
      hasPending = false;
    } else {
      const match = findMatch(pos);
      distance = match.distance;
      run = match.run;
    }

    let insertedCurrent = false;
    if (run >= YAZ0_MIN_RUN && pos + 1 < length) {
      // Lazy matching: prefer a literal now if the next position starts a strictly longer run.
      insert(pos);
      insertedCurrent = true;
      const next = findMatch(pos + 1);
      if (next.run > run) {
        beginGroup();
        buffer[codeIndex] |= 1 << (codeBit - 1);
        codeBit--;
        out(data[pos]);
        pos++;
        pendingDistance = next.distance;
        pendingRun = next.run;
        hasPending = true;
        continue;
      }
    }

    beginGroup();
    if (run >= YAZ0_MIN_RUN) {
      codeBit--;
      const encodedDistance = distance - 1;
      if (run >= 0x12) {
        out(encodedDistance >>> 8, encodedDistance & 0xff, run - 0x12);
      } else {
        out(((run - 2) << 4) | (encodedDistance >>> 8), encodedDistance & 0xff);
      }
      for (let i = insertedCurrent ? 1 : 0; i < run; i++) insert(pos + i);
      pos += run;
    } else {
      buffer[codeIndex] |= 1 << (codeBit - 1);
      codeBit--;
      out(data[pos]);
      if (!insertedCurrent) insert(pos);
      pos++;
    }
  }

  return buffer.slice(0, outLength);
}
