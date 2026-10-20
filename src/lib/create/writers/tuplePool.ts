/**
 * A pool of unique fixed-width tuples of u32 words, with O(1) amortised insert and lookup.
 *
 * The model writer uses it to deduplicate vertex-array entries exactly (bit patterns, so floats
 * compare by their IEEE bits): a flat road has a handful of distinct normals and colours across
 * tens of thousands of vertices, and retail course models share array entries the same way.
 */
export class TuplePool {
  readonly stride: number;
  words: Uint32Array;
  count = 0;
  private table: Int32Array;
  private mask: number;

  constructor(stride: number, expected = 64) {
    this.stride = stride;
    this.words = new Uint32Array(Math.max(1, expected) * stride);
    let size = 16;
    while (size < expected * 2) size *= 2;
    this.table = new Int32Array(size).fill(-1);
    this.mask = size - 1;
  }

  private hash(source: Uint32Array, offset: number): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < this.stride; i++) {
      h ^= source[offset + i];
      h = Math.imul(h, 0x01000193);
      h ^= h >>> 15;
    }
    return h >>> 0;
  }

  private matches(index: number, source: Uint32Array, offset: number): boolean {
    const base = index * this.stride;
    for (let i = 0; i < this.stride; i++) if (this.words[base + i] !== source[offset + i]) return false;
    return true;
  }

  private grow(): void {
    const size = this.table.length * 2;
    this.table = new Int32Array(size).fill(-1);
    this.mask = size - 1;
    for (let index = 0; index < this.count; index++) {
      let slot = this.hash(this.words, index * this.stride) & this.mask;
      while (this.table[slot] !== -1) slot = (slot + 1) & this.mask;
      this.table[slot] = index;
    }
  }

  /** Returns the index of the tuple `source[offset .. offset + stride)`, inserting it when new. */
  add(source: Uint32Array, offset: number): number {
    let slot = this.hash(source, offset) & this.mask;
    for (;;) {
      const found = this.table[slot];
      if (found === -1) break;
      if (this.matches(found, source, offset)) return found;
      slot = (slot + 1) & this.mask;
    }
    if ((this.count + 1) * this.stride > this.words.length) {
      const next = new Uint32Array(this.words.length * 2);
      next.set(this.words);
      this.words = next;
    }
    const index = this.count++;
    this.words.set(source.subarray(offset, offset + this.stride), index * this.stride);
    this.table[slot] = index;
    if (this.count * 2 > this.table.length) this.grow();
    return index;
  }
}
