/**
 * A tiny growable big-endian byte buffer for the binary writers. Every GameCube/Wii format this
 * folder emits (BRRES, KCL) is big-endian, so all the setters are.
 */

export class ByteBuffer {
  data: Uint8Array;
  view: DataView;
  /** Bytes allocated so far (the logical length). */
  length = 0;

  constructor(initialCapacity = 1 << 16) {
    this.data = new Uint8Array(Math.max(16, initialCapacity));
    this.view = new DataView(this.data.buffer);
  }

  private ensure(total: number): void {
    if (total <= this.data.length) return;
    let capacity = this.data.length;
    while (capacity < total) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.data.subarray(0, this.length), 0);
    this.data = next;
    this.view = new DataView(next.buffer);
  }

  /** Pads with zeros until `length` is a multiple of `alignment`. Returns the new length. */
  align(alignment: number): number {
    const target = Math.ceil(this.length / alignment) * alignment;
    this.ensure(target);
    this.length = target;
    return target;
  }

  /** Reserves `size` zeroed bytes at the end (after aligning to `alignment`) and returns the offset. */
  alloc(size: number, alignment = 1): number {
    if (alignment > 1) this.align(alignment);
    const offset = this.length;
    this.ensure(offset + size);
    this.length = offset + size;
    return offset;
  }

  /**
   * Like `alloc`, but places the block so that `offset + phase` is a multiple of `alignment`.
   * Used for blocks that embed a display list at a fixed internal offset: the display list, not
   * the block, has to land on the 32-byte boundary.
   */
  allocPhased(size: number, alignment: number, phase: number): number {
    let offset = Math.ceil((this.length + phase) / alignment) * alignment - phase;
    if (offset < this.length) offset += alignment;
    this.ensure(offset + size);
    this.length = offset + size;
    return offset;
  }

  u8(offset: number, value: number): void {
    this.data[offset] = value;
  }

  u16(offset: number, value: number): void {
    this.view.setUint16(offset, value);
  }

  s16(offset: number, value: number): void {
    this.view.setInt16(offset, value);
  }

  u32(offset: number, value: number): void {
    this.view.setUint32(offset, value >>> 0);
  }

  s32(offset: number, value: number): void {
    this.view.setInt32(offset, value);
  }

  f32(offset: number, value: number): void {
    this.view.setFloat32(offset, value);
  }

  bytes(offset: number, source: Uint8Array): void {
    this.ensure(offset + source.length);
    this.data.set(source, offset);
  }

  /** The finished bytes (a copy trimmed to `length`). */
  finish(): Uint8Array {
    return this.data.slice(0, this.length);
  }
}

export function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
