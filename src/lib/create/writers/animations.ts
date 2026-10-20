/**
 * Copying material animations (SRT0 texture scrolls and PAT0 texture patterns) out of swatches
 * into a new archive.
 *
 * An animation file is a header, a dictionary of per-material blocks, and, for each material, a
 * little tree of blocks that point at each other *forward and relative*. That makes one material's
 * animation rigidly movable: copy the byte range that holds its blocks and every internal pointer
 * stays valid. Only the material-name pointer (which aims out of the file into the string pool)
 * has to be re-declared. Several swatches' animations are merged into one file per (length, loop
 * mode) group, named the way retail names them: `<model>`, `<model>2`, `<model>3`, ...
 */

import {
  makeSubFileNameReader,
  type BrresRaw,
  type BrresStringRef,
  type BrresSubFileRaw,
} from '../../brres/brresRaw';
import { readResDic, resDicSize, writeResDic } from '../../brres/resDic';
import { alignUp, ByteBuffer } from './byteBuffer';
import { BRRES_ANIM_PAT_GROUP, BRRES_ANIM_SRT_GROUP, type NewSubFile } from './brresPack';

export interface AnimationTarget {
  archive: BrresRaw;
  /** The material's name in the swatch archive. */
  sourceMaterial: string;
  /** The material's name in the output (what the animation entry must be called). */
  material: string;
}

export type ResolveResource = (archive: BrresRaw, kind: 'texture' | 'palette', name: string) => string;

export interface CollectedAnimations {
  patterns: NewSubFile[];
  scrolls: NewSubFile[];
}

export function collectSwatchAnimations(
  targets: readonly AnimationTarget[],
  modelName: string,
  resolve: ResolveResource,
): CollectedAnimations {
  return {
    scrolls: mergeScrolls(targets, modelName),
    patterns: mergePatterns(targets, modelName, resolve),
  };
}

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

interface SourceEntry {
  /** Name the entry has in the source file. */
  name: string;
  /** Offset of the entry's block in the source sub-file. */
  root: number;
}

interface SourceAnimation {
  archive: BrresRaw;
  subFile: BrresSubFileRaw;
  view: DataView;
  version: number;
  entries: SourceEntry[];
  duration: number;
  loop: number;
  /** SRT0 only. */
  texMtxMode: number;
}

function openAnimations(archive: BrresRaw, groupName: string, kind: 'SRT0' | 'PAT0'): SourceAnimation[] {
  const group = archive.groups.find((candidate) => candidate.name === groupName);
  if (!group) return [];
  const result: SourceAnimation[] = [];
  for (const subFile of group.entries) {
    if (subFile.magic !== kind) continue;
    const data = subFile.data;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const version = view.getUint32(0x08);
    const readName = makeSubFileNameReader(archive, subFile);
    const dicAt = view.getUint32(0x10);
    const dic = dicAt === 0 ? null : readResDic(data, dicAt, readName);
    const entries = (dic?.entries ?? []).map((entry) => ({ name: entry.name, root: entry.dataOffset }));
    if (kind === 'SRT0') {
      const at = version >= 5 ? 0x20 : 0x1c;
      result.push({ archive, subFile, view, version, entries, duration: view.getUint16(at), texMtxMode: view.getUint32(at + 4), loop: view.getUint32(at + 8) });
    } else {
      const at = version >= 4 ? 0x30 : 0x2c;
      result.push({ archive, subFile, view, version, entries, duration: view.getUint16(at), texMtxMode: 0, loop: view.getUint32(at + 8) });
    }
  }
  return result;
}

function groupName(modelName: string, index: number): string {
  return index === 0 ? modelName : `${modelName}${index + 1}`;
}

interface Hull {
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------------------------
// SRT0
// ---------------------------------------------------------------------------------------------

const SRT_FLAG_SCALE_ONE = 0x002;
const SRT_FLAG_ROT_ZERO = 0x004;
const SRT_FLAG_TRANS_ZERO = 0x008;
const SRT_FLAG_SCALE_UNIFORM = 0x010;
const SRT_FLAG_SCALE_S_CONSTANT = 0x020;
const SRT_FLAG_SCALE_T_CONSTANT = 0x040;
const SRT_FLAG_ROT_CONSTANT = 0x080;
const SRT_FLAG_TRANS_S_CONSTANT = 0x100;
const SRT_FLAG_TRANS_T_CONSTANT = 0x200;

/** Byte range of the blocks an SRT0 material entry reaches (it only ever points forward). */
function srtHull(view: DataView, root: number): Hull {
  const flags = (view.getUint32(root + 0x04) | (view.getUint32(root + 0x08) << 8)) & 0xfff;
  let end = root + 0x0c;
  let slot = root + 0x0c;
  for (let i = 0; i < 12; i++) {
    if (!(flags & (1 << i))) continue;
    const texData = root + view.getUint32(slot);
    slot += 4;
    end = Math.max(end, slot);
    const texFlags = view.getUint32(texData);
    let track = texData + 0x04;
    const visit = (constant: boolean): void => {
      if (!constant) {
        const target = track + view.getUint32(track);
        const count = view.getUint16(target);
        end = Math.max(end, target + 0x08 + count * 12);
      }
      track += 4;
      end = Math.max(end, track);
    };
    if (!(texFlags & SRT_FLAG_SCALE_ONE)) {
      visit(!!(texFlags & SRT_FLAG_SCALE_S_CONSTANT));
      if (!(texFlags & SRT_FLAG_SCALE_UNIFORM)) visit(!!(texFlags & SRT_FLAG_SCALE_T_CONSTANT));
    }
    if (!(texFlags & SRT_FLAG_ROT_ZERO)) visit(!!(texFlags & SRT_FLAG_ROT_CONSTANT));
    if (!(texFlags & SRT_FLAG_TRANS_ZERO)) {
      visit(!!(texFlags & SRT_FLAG_TRANS_S_CONSTANT));
      visit(!!(texFlags & SRT_FLAG_TRANS_T_CONSTANT));
    }
  }
  return { start: root, end: alignUp(end, 4) };
}

interface MergeGroup<E> {
  key: string;
  duration: number;
  loop: number;
  texMtxMode: number;
  entries: E[];
}

function mergeScrolls(targets: readonly AnimationTarget[], modelName: string): NewSubFile[] {
  const groups: Array<MergeGroup<{ material: string; bytes: Uint8Array }>> = [];
  const archiveAnimations = new Map<BrresRaw, SourceAnimation[]>();
  const taken = new Set<string>();
  for (const target of targets) {
    let animations = archiveAnimations.get(target.archive);
    if (!animations) {
      animations = openAnimations(target.archive, BRRES_ANIM_SRT_GROUP, 'SRT0');
      archiveAnimations.set(target.archive, animations);
    }
    for (const animation of animations) {
      const entry = animation.entries.find((candidate) => candidate.name === target.sourceMaterial);
      if (!entry) continue;
      const key = `${animation.duration}|${animation.loop}|${animation.texMtxMode}`;
      if (taken.has(`${key}|${target.material}`)) continue;
      taken.add(`${key}|${target.material}`);
      let group = groups.find((candidate) => candidate.key === key);
      if (!group) {
        group = { key, duration: animation.duration, loop: animation.loop, texMtxMode: animation.texMtxMode, entries: [] };
        groups.push(group);
      }
      const hull = srtHull(animation.view, entry.root);
      group.entries.push({ material: target.material, bytes: animation.subFile.data.slice(hull.start, hull.end) });
    }
  }

  return groups.map((group, index) => {
    const name = groupName(modelName, index);
    const headerSize = 0x2c;
    const out = new ByteBuffer(headerSize + resDicSize(group.entries.length) + group.entries.reduce((sum, entry) => sum + entry.bytes.length, 0) + 64);
    out.alloc(headerSize);
    const dicAt = out.alloc(resDicSize(group.entries.length), 4);
    const refs: BrresStringRef[] = [];
    const placed = group.entries.map((entry) => {
      const at = out.alloc(entry.bytes.length, 4);
      out.bytes(at, entry.bytes);
      refs.push({ offset: at, base: at, value: entry.material });
      return at;
    });
    writeResDic(
      out.data,
      dicAt,
      group.entries.map((entry, i) => ({ name: entry.material, nameOffset: dicAt, dataOffset: placed[i] })),
    );
    group.entries.forEach((entry, i) => refs.push({ offset: dicAt + 0x08 + (i + 1) * 0x10 + 0x08, base: dicAt, value: entry.material }));
    const total = out.align(0x20);
    out.bytes(0, new TextEncoder().encode('SRT0'));
    out.u32(0x04, total);
    out.u32(0x08, 5);
    out.u32(0x10, dicAt);
    out.u32(0x14, 0);
    refs.push({ offset: 0x18, value: name });
    out.u32(0x1c, 0);
    out.u16(0x20, group.duration);
    out.u16(0x22, group.entries.length);
    out.u32(0x24, group.texMtxMode);
    out.u32(0x28, group.loop);
    return { name, magic: 'SRT0', data: out.finish(), stringRefs: refs };
  });
}

// ---------------------------------------------------------------------------------------------
// PAT0
// ---------------------------------------------------------------------------------------------

const PAT_EXISTS = 1;
const PAT_CONSTANT = 2;

interface PatternSlot {
  /** Offset (relative to the hull) of the slot's 4 bytes. */
  slot: number;
  constant: boolean;
  /** Offsets (relative to the hull) of the u16 texture indices this slot refers to. */
  indexOffsets: number[];
}

function patternHull(view: DataView, root: number): { hull: Hull; slots: PatternSlot[] } {
  const flags = view.getUint32(root + 0x04);
  let slot = root + 0x08;
  let end = root + 0x08;
  const slots: PatternSlot[] = [];
  for (let i = 0; i < 8; i++) {
    const texFlags = (flags >>> (i * 4)) & 0x0f;
    if (!(texFlags & PAT_EXISTS)) continue;
    const constant = !!(texFlags & PAT_CONSTANT);
    const indexOffsets: number[] = [];
    if (constant) {
      indexOffsets.push(slot - root);
    } else {
      const target = root + view.getUint32(slot); // pattern track pointers are relative to the material entry
      const count = view.getUint16(target);
      for (let k = 0; k < count; k++) indexOffsets.push(target + 0x08 + k * 8 + 4 - root);
      end = Math.max(end, target + 0x08 + count * 8);
    }
    slots.push({ slot: slot - root, constant, indexOffsets });
    slot += 4;
    end = Math.max(end, slot);
  }
  return { hull: { start: root, end: alignUp(end, 4) }, slots };
}

function mergePatterns(targets: readonly AnimationTarget[], modelName: string, resolve: ResolveResource): NewSubFile[] {
  interface PatternEntry {
    material: string;
    bytes: Uint8Array;
    /** Offsets in `bytes` of u16 texture indices, with the source index they hold. */
    indices: Array<{ offset: number; texture: string }>;
  }
  const groups: Array<MergeGroup<PatternEntry>> = [];
  const archiveAnimations = new Map<BrresRaw, SourceAnimation[]>();
  const taken = new Set<string>();

  for (const target of targets) {
    let animations = archiveAnimations.get(target.archive);
    if (!animations) {
      animations = openAnimations(target.archive, BRRES_ANIM_PAT_GROUP, 'PAT0');
      archiveAnimations.set(target.archive, animations);
    }
    for (const animation of animations) {
      const entry = animation.entries.find((candidate) => candidate.name === target.sourceMaterial);
      if (!entry) continue;
      const key = `${animation.duration}|${animation.loop}`;
      if (taken.has(`${key}|${target.material}`)) continue;
      taken.add(`${key}|${target.material}`);
      let group = groups.find((candidate) => candidate.key === key);
      if (!group) {
        group = { key, duration: animation.duration, loop: animation.loop, texMtxMode: 0, entries: [] };
        groups.push(group);
      }
      const { hull, slots } = patternHull(animation.view, entry.root);
      const bytes = animation.subFile.data.slice(hull.start, hull.end);
      const sourceNames = readPatternTextureNames(animation);
      const indices: PatternEntry['indices'] = [];
      const bytesView = new DataView(bytes.buffer);
      for (const slot of slots) {
        for (const offset of slot.indexOffsets) {
          const texture = sourceNames[bytesView.getUint16(offset)];
          if (texture === undefined) continue;
          indices.push({ offset, texture: resolve(target.archive, 'texture', texture) });
        }
      }
      group.entries.push({ material: target.material, bytes, indices });
    }
  }

  return groups.map((group, index) => {
    const name = groupName(modelName, index);
    const textureNames: string[] = [];
    for (const entry of group.entries) {
      for (const reference of entry.indices) if (!textureNames.includes(reference.texture)) textureNames.push(reference.texture);
    }
    const headerSize = 0x3c;
    const out = new ByteBuffer(headerSize + resDicSize(group.entries.length) + group.entries.reduce((sum, entry) => sum + entry.bytes.length, 0) + 256);
    out.alloc(headerSize);
    const dicAt = out.alloc(resDicSize(group.entries.length), 4);
    const refs: BrresStringRef[] = [];
    const placed = group.entries.map((entry) => {
      const at = out.alloc(entry.bytes.length, 4);
      out.bytes(at, entry.bytes);
      for (const reference of entry.indices) out.u16(at + reference.offset, textureNames.indexOf(reference.texture));
      refs.push({ offset: at, base: at, value: entry.material });
      return at;
    });
    writeResDic(
      out.data,
      dicAt,
      group.entries.map((entry, i) => ({ name: entry.material, nameOffset: dicAt, dataOffset: placed[i] })),
    );
    group.entries.forEach((entry, i) => refs.push({ offset: dicAt + 0x08 + (i + 1) * 0x10 + 0x08, base: dicAt, value: entry.material }));

    const textureTable = out.alloc(textureNames.length * 4, 4);
    textureNames.forEach((texture, i) => refs.push({ offset: textureTable + i * 4, base: textureTable, value: texture }));
    const paletteTable = out.alloc(0, 4);
    const texturePointers = out.alloc(textureNames.length * 4, 4);
    const palettePointers = out.alloc(0, 4);
    const total = out.align(0x20);

    out.bytes(0, new TextEncoder().encode('PAT0'));
    out.u32(0x04, total);
    out.u32(0x08, 4);
    out.u32(0x10, dicAt);
    out.u32(0x14, textureTable);
    out.u32(0x18, paletteTable);
    out.u32(0x1c, texturePointers);
    out.u32(0x20, palettePointers);
    out.u32(0x24, 0);
    refs.push({ offset: 0x28, value: name });
    out.u32(0x2c, 0);
    out.u16(0x30, group.duration);
    out.u16(0x32, group.entries.length);
    out.u16(0x34, textureNames.length);
    out.u16(0x36, 0);
    out.u32(0x38, group.loop);
    return { name, magic: 'PAT0', data: out.finish(), stringRefs: refs };
  });
}

function readPatternTextureNames(animation: SourceAnimation): string[] {
  const { view, version } = animation;
  const tableAt = view.getUint32(0x14);
  const countAt = version >= 4 ? 0x34 : 0x30;
  const count = view.getUint16(countAt);
  const readName = makeSubFileNameReader(animation.archive, animation.subFile);
  const names: string[] = [];
  for (let i = 0; i < count; i++) names.push(readName(tableAt + view.getUint32(tableAt + i * 4)));
  return names;
}
