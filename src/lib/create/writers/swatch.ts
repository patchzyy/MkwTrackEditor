/**
 * Reading a `MaterialSource` swatch: a small BRRES that holds the material the generated geometry
 * should be drawn with. The writer copies the material's raw bytes, its TEV block and the textures
 * it samples; this module finds and slices those out of the swatch.
 */

import {
  BRRES_MODELS_GROUP,
  BRRES_PALETTES_GROUP,
  BRRES_TEXTURES_GROUP,
  findSubFile,
  makeSubFileNameReader,
  readBrresRaw,
  type BrresRaw,
  type BrresSubFileRaw,
} from '../../brres/brresRaw';
import { Mdl0Editor } from '../../brres/mdl0Raw';
import type { MaterialSource } from '../types';

/** One texture slot of a material, by the names it has in the swatch archive. */
export interface SwatchSampler {
  texture: string;
  palette: string | null;
}

/** A material cut out of a swatch, ready to be re-emitted into a new MDL0. */
export interface SwatchMaterial {
  archive: BrresRaw;
  modelName: string;
  materialName: string;
  /** The whole material block (header, parameter tables, samplers, display lists). */
  block: Uint8Array;
  /** The TEV block the material points at (always 0x200 bytes in retail). */
  tev: Uint8Array;
  /** Where the sampler table starts inside the block. */
  samplerOffset: number;
  /** Where the material's display lists start inside the block (they must land 32-byte aligned). */
  dlOffset: number;
  samplers: SwatchSampler[];
  translucent: boolean;
}

interface ParsedSwatch {
  archive: BrresRaw;
  editors: Map<string, Mdl0Editor>;
}

const swatchCache = new WeakMap<Uint8Array, ParsedSwatch>();
const materialCache = new WeakMap<Uint8Array, Map<string, SwatchMaterial>>();

function openSwatch(brres: Uint8Array): ParsedSwatch {
  let parsed = swatchCache.get(brres);
  if (!parsed) {
    parsed = { archive: readBrresRaw(brres), editors: new Map() };
    swatchCache.set(brres, parsed);
  }
  return parsed;
}

function editorFor(parsed: ParsedSwatch, subFile: BrresSubFileRaw): Mdl0Editor {
  let editor = parsed.editors.get(subFile.name);
  if (!editor) {
    editor = new Mdl0Editor(subFile.data, makeSubFileNameReader(parsed.archive, subFile));
    parsed.editors.set(subFile.name, editor);
  }
  return editor;
}

/** Finds `source.materialName` in `source.modelName` (or, failing that, any model of the swatch). */
export function loadSwatchMaterial(source: MaterialSource): SwatchMaterial {
  const cacheKey = `${source.modelName}\u0000${source.materialName}`;
  let perSwatch = materialCache.get(source.brres);
  const cached = perSwatch?.get(cacheKey);
  if (cached) return cached;

  const parsed = openSwatch(source.brres);
  const models = parsed.archive.groups.find((group) => group.name === BRRES_MODELS_GROUP)?.entries ?? [];
  const ordered = [...models.filter((model) => model.name === source.modelName), ...models.filter((model) => model.name !== source.modelName)];
  for (const subFile of ordered) {
    const editor = editorFor(parsed, subFile);
    const material = editor.listMaterials().find((candidate) => candidate.name === source.materialName);
    if (!material) continue;
    if (editor.version < 0x0a) {
      throw new Error(
        `Swatch "${source.surfaceId}": model "${subFile.name}" is MDL0 version ${editor.version}; only version 10 and 11 materials can be copied.`,
      );
    }
    const loaded = sliceMaterial(parsed.archive, subFile.name, editor, material, source.translucent);
    if (!perSwatch) {
      perSwatch = new Map();
      materialCache.set(source.brres, perSwatch);
    }
    perSwatch.set(cacheKey, loaded);
    return loaded;
  }
  throw new Error(`Swatch "${source.surfaceId}": material "${source.materialName}" not found in model "${source.modelName}".`);
}

function sliceMaterial(
  archive: BrresRaw,
  modelName: string,
  editor: Mdl0Editor,
  material: { name: string; offset: number; size: number },
  translucent: boolean,
): SwatchMaterial {
  const data = editor.data;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (material.offset + material.size > data.length) throw new Error(`Material "${material.name}" runs past the end of its model.`);
  const block = data.slice(material.offset, material.offset + material.size);
  const blockView = new DataView(block.buffer);

  const tevRelative = blockView.getUint32(0x28);
  const tevAt = material.offset + tevRelative;
  if (tevRelative === 0 || tevAt + 0x20 > data.length) throw new Error(`Material "${material.name}" has no TEV block.`);
  const tevSize = view.getUint32(tevAt);
  if (tevSize < 0x20 || tevAt + tevSize > data.length) throw new Error(`Material "${material.name}" has a damaged TEV block.`);
  const tev = data.slice(tevAt, tevAt + tevSize);

  const samplerCount = blockView.getUint32(0x2c);
  const samplerOffset = blockView.getUint32(0x30);
  if (samplerOffset + samplerCount * 0x34 > block.length) throw new Error(`Material "${material.name}" has a damaged sampler table.`);
  const samplers: SwatchSampler[] = [];
  for (let i = 0; i < samplerCount; i++) {
    const at = samplerOffset + i * 0x34;
    const textureRelative = blockView.getInt32(at + 0x00);
    const paletteRelative = blockView.getInt32(at + 0x04);
    samplers.push({
      texture: textureRelative !== 0 ? editor.readNameAt(material.offset + at + textureRelative) : '',
      palette: paletteRelative !== 0 ? editor.readNameAt(material.offset + at + paletteRelative) : null,
    });
  }

  // Fur and user-data blocks are not part of the material block proper; the writer does not copy
  // them, so make sure the copy does not point at them.
  blockView.setUint32(0x34, 0);
  blockView.setUint32(0x38, 0);

  return {
    archive,
    modelName,
    materialName: material.name,
    block,
    tev,
    samplerOffset,
    dlOffset: blockView.getUint32(0x3c),
    samplers,
    translucent,
  };
}

/** The TEX0 / PLT0 sub-file for a name, if the swatch carries it. */
export function findSwatchTexture(archive: BrresRaw, name: string): BrresSubFileRaw | null {
  return findSubFile(archive, BRRES_TEXTURES_GROUP, name);
}

export function findSwatchPalette(archive: BrresRaw, name: string): BrresSubFileRaw | null {
  return findSubFile(archive, BRRES_PALETTES_GROUP, name);
}
