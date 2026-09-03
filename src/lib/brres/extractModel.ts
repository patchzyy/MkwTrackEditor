// Pulls one model out of a BRRES into a standalone archive.
//
// A `course_model.brres` (or any object archive) can hold several MDL0s plus the textures,
// palettes and animations they share. "Export this model" wants exactly one MDL0 and the TEX0 /
// PLT0 sub-files it references, in a fresh archive with its own string pool, so the result opens
// in BrawlBox / CTools and can be dropped into another track as an object.
//
// The MDL0 bytes are copied verbatim. Its name pointers are re-targeted through the same
// `stringRefs` mechanism the course-model baker uses (`Mdl0Editor.collectStringRefs`), so the
// new archive's pool only holds the names this one model needs.

import {
  BRRES_MODELS_GROUP,
  BRRES_PALETTES_GROUP,
  BRRES_TEXTURES_GROUP,
  findSubFile,
  makeSubFileNameReader,
  readBrresRaw,
  writeBrres,
  type BrresGroupRaw,
  type BrresRaw,
  type BrresSubFileRaw,
} from './brresRaw';
import { Mdl0Editor } from './mdl0Raw';
import { createStringPool, internString } from './stringPool';

export interface ExtractedModel {
  /** The new standalone BRRES. */
  data: Uint8Array;
  modelName: string;
  /** TEX0 names copied across. */
  textures: string[];
  /** PLT0 names copied across. */
  palettes: string[];
  /** Textures the model samples that were not in the source archive (shared or missing). */
  missingTextures: string[];
}

/** Names of the MDL0s in an archive, in dictionary order. Empty when the bytes are not a BRRES. */
export function listBrresModelNames(brres: Uint8Array): string[] {
  let raw: BrresRaw;
  try {
    raw = readBrresRaw(brres);
  } catch {
    return [];
  }
  return raw.groups.find((group) => group.name === BRRES_MODELS_GROUP)?.entries.map((entry) => entry.name) ?? [];
}

/** True when `bytes` start with the BRRES magic and a big-endian byte-order mark. */
export function isBrresArchive(bytes: Uint8Array): boolean {
  return bytes.length >= 0x10 && bytes[0] === 0x62 && bytes[1] === 0x72 && bytes[2] === 0x65 && bytes[3] === 0x73 && bytes[4] === 0xfe && bytes[5] === 0xff;
}

function cloneSubFile(subFile: BrresSubFileRaw, stringRefs: BrresSubFileRaw['stringRefs']): BrresSubFileRaw {
  return { name: subFile.name, magic: subFile.magic, data: subFile.data.slice(), sourceOffset: -1, stringRefs };
}

/**
 * Builds a new BRRES holding only `modelName` and the textures / palettes it references.
 * Throws when the archive has no such model, or when the model carries user data (its name
 * pointers cannot be re-targeted yet).
 */
export function extractModelBrres(brres: Uint8Array, modelName: string): ExtractedModel {
  const raw = readBrresRaw(brres);
  const source = findSubFile(raw, BRRES_MODELS_GROUP, modelName);
  if (!source) throw new Error(`The archive has no model named "${modelName}".`);
  if (source.magic !== 'MDL0') throw new Error(`"${modelName}" is not an MDL0 model.`);

  const editor = new Mdl0Editor(source.data, makeSubFileNameReader(raw, source));
  let stringRefs;
  try {
    stringRefs = editor.collectStringRefs();
  } catch (error) {
    throw new Error(`"${modelName}" cannot be exported on its own: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }

  const textureNames = editor.getDic('texture')?.entries.map((entry) => entry.name) ?? [];
  const paletteNames = editor.getDic('palette')?.entries.map((entry) => entry.name) ?? [];

  const pool = createStringPool();
  const model = cloneSubFile(source, stringRefs);
  const groups: BrresGroupRaw[] = [{ name: BRRES_MODELS_GROUP, entries: [model] }];
  const layout: BrresSubFileRaw[] = [model];
  const textures: string[] = [];
  const palettes: string[] = [];
  const missingTextures: string[] = [];

  const copyResources = (groupName: string, names: string[], copied: string[], missing: string[] | null) => {
    const entries: BrresSubFileRaw[] = [];
    for (const name of names) {
      const original = findSubFile(raw, groupName, name);
      if (!original) {
        missing?.push(name);
        continue;
      }
      const clone = cloneSubFile(original, [{ offset: 0x14, value: name }]);
      entries.push(clone);
      layout.push(clone);
      copied.push(name);
    }
    if (entries.length > 0) groups.push({ name: groupName, entries });
  };
  copyResources(BRRES_TEXTURES_GROUP, textureNames, textures, missingTextures);
  copyResources(BRRES_PALETTES_GROUP, paletteNames, palettes, null);

  for (const group of groups) {
    internString(pool, group.name);
    for (const entry of group.entries) internString(pool, entry.name);
  }
  for (const ref of stringRefs) internString(pool, ref.value);

  const out: BrresRaw = {
    version: raw.version,
    sourceFile: brres,
    groups,
    layout,
    padBefore: new Map(),
    pool,
    poolSourceOffset: 0,
  };

  return { data: writeBrres(out), modelName, textures, palettes, missingTextures };
}
