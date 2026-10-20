/**
 * Packs finished sub-files (an MDL0, textures, palettes, animations) into a `.brres` archive:
 * root section, resource dictionaries, string pool, relative name pointers.
 *
 * This reuses the editor's existing archive writer (`writeBrres`), which already knows how to lay
 * out a BRRES and to re-point every declared name field at a freshly built string pool.
 */

import {
  BRRES_MODELS_GROUP,
  BRRES_PALETTES_GROUP,
  BRRES_TEXTURES_GROUP,
  writeBrres,
  type BrresGroupRaw,
  type BrresRaw,
  type BrresStringRef,
  type BrresSubFileRaw,
} from '../../brres/brresRaw';
import { createStringPool, internString } from '../../brres/stringPool';

export const BRRES_ANIM_PAT_GROUP = 'AnmTexPat(NW4R)';
export const BRRES_ANIM_SRT_GROUP = 'AnmTexSrt(NW4R)';

/** A sub-file the writer built (as opposed to one read from a source archive). */
export interface NewSubFile {
  name: string;
  magic: string;
  data: Uint8Array;
  stringRefs: BrresStringRef[];
}

export interface PackInput {
  models: NewSubFile[];
  textures: NewSubFile[];
  palettes: NewSubFile[];
  patterns: NewSubFile[];
  scrolls: NewSubFile[];
}

/** Group order matches retail course models: models, textures, palettes, texture patterns, texture scrolls. */
export function packBrres(input: PackInput): Uint8Array {
  const pool = createStringPool();
  const layout: BrresSubFileRaw[] = [];
  const groups: BrresGroupRaw[] = [];

  const addGroup = (name: string, files: NewSubFile[]): void => {
    if (files.length === 0) return;
    internString(pool, name);
    const entries: BrresSubFileRaw[] = files.map((file) => {
      internString(pool, file.name);
      for (const ref of file.stringRefs) internString(pool, ref.value);
      const subFile: BrresSubFileRaw = {
        name: file.name,
        magic: file.magic,
        data: file.data,
        sourceOffset: -1,
        stringRefs: file.stringRefs,
      };
      layout.push(subFile);
      return subFile;
    });
    groups.push({ name, entries });
  };

  addGroup(BRRES_MODELS_GROUP, input.models);
  addGroup(BRRES_TEXTURES_GROUP, input.textures);
  addGroup(BRRES_PALETTES_GROUP, input.palettes);
  addGroup(BRRES_ANIM_PAT_GROUP, input.patterns);
  addGroup(BRRES_ANIM_SRT_GROUP, input.scrolls);

  // Retail archives end on a 32-byte boundary.
  const padded = new Uint8Array(Math.ceil(pool.bytes.length / 0x20) * 0x20);
  padded.set(pool.bytes);
  pool.bytes = padded;

  const raw: BrresRaw = {
    version: 0,
    sourceFile: new Uint8Array(0),
    groups,
    layout,
    padBefore: new Map(),
    pool,
    poolSourceOffset: 0,
  };
  return writeBrres(raw);
}
