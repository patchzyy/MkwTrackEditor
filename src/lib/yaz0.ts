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
