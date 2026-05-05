export class BinReader {
  readonly view: DataView;

  constructor(readonly buffer: ArrayBufferLike, readonly littleEndian = false) {
    this.view = new DataView(buffer);
  }

  u8(offset: number): number {
    return this.view.getUint8(offset);
  }

  u16(offset: number): number {
    return this.view.getUint16(offset, this.littleEndian);
  }

  i16(offset: number): number {
    return this.view.getInt16(offset, this.littleEndian);
  }

  u32(offset: number): number {
    return this.view.getUint32(offset, this.littleEndian);
  }

  i32(offset: number): number {
    return this.view.getInt32(offset, this.littleEndian);
  }

  f32(offset: number): number {
    return this.view.getFloat32(offset, this.littleEndian);
  }

  ascii(offset: number, length: number): string {
    const bytes = new Uint8Array(this.buffer, offset, length);
    return String.fromCharCode(...bytes).replace(/\0+$/, '');
  }

  cstr(offset: number): string {
    const bytes = new Uint8Array(this.buffer);
    let end = offset;
    while (end < bytes.length && bytes[end] !== 0) end++;
    return new TextDecoder().decode(bytes.slice(offset, end));
  }

  slice(offset: number, length: number): Uint8Array {
    return new Uint8Array(this.buffer).slice(offset, offset + length);
  }
}

export class BinWriter {
  private chunks: number[] = [];

  get length(): number {
    return this.chunks.length;
  }

  u8(value: number): void {
    this.chunks.push(value & 0xff);
  }

  u16(value: number): void {
    this.chunks.push((value >>> 8) & 0xff, value & 0xff);
  }

  u32(value: number): void {
    this.chunks.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  }

  bytes(value: Uint8Array): void {
    for (const byte of value) this.chunks.push(byte);
  }

  ascii(value: string, fixedLength?: number): void {
    const encoded = new TextEncoder().encode(value);
    this.bytes(fixedLength === undefined ? encoded : encoded.slice(0, fixedLength));
    if (fixedLength !== undefined) {
      for (let i = encoded.length; i < fixedLength; i++) this.u8(0);
    }
  }

  pad(alignment: number, fill = 0): void {
    while (this.chunks.length % alignment !== 0) this.u8(fill);
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

export function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
