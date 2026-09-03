// Material codec round trips.
//
// Decoding a material and encoding the document straight back has to reproduce the original
// bytes. That is the only assertion strong enough to prove the decoder read every field: a
// missed one shows up as a byte difference rather than as a silently dropped feature.

import { describe, expect, it } from 'vitest';
import { BRRES_MODELS_GROUP, makeSubFileNameReader, readBrresRaw } from '../brres/brresRaw';
import { Mdl0Editor } from '../brres/mdl0Raw';
import { firstDifference } from '../brres/brresFixtures.testdata';
import { listMaterialArchives } from './materialFixtures.testdata';
import {
  MATERIAL_FIELDS as MAT,
  TEV_BLOCK_SIZE,
  decodeMaterialBlock,
  encodeMaterialBlock,
} from './materialCodec';

const archives = listMaterialArchives();

interface RawMaterial {
  label: string;
  modelName: string;
  materialName: string;
  offset: number;
  block: Uint8Array;
  tev: Uint8Array;
  readName: (offset: number) => string;
}

function collectMaterials(): RawMaterial[] {
  const out: RawMaterial[] = [];
  for (const archive of archives) {
    const raw = readBrresRaw(archive.data);
    for (const subFile of raw.groups.find((group) => group.name === BRRES_MODELS_GROUP)?.entries ?? []) {
      let editor: Mdl0Editor;
      try {
        editor = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile));
      } catch {
        continue;
      }
      if (editor.version !== 0x0b) continue;
      const view = new DataView(editor.data.buffer, editor.data.byteOffset, editor.data.byteLength);
      for (const entry of editor.getDic('material')?.entries ?? []) {
        const size = view.getUint32(entry.offset + MAT.size);
        const tevOffset = entry.offset + view.getUint32(entry.offset + MAT.tevOffset);
        out.push({
          label: archive.label,
          modelName: subFile.name,
          materialName: entry.name,
          offset: entry.offset,
          block: editor.data.slice(entry.offset, entry.offset + size),
          tev: editor.data.slice(tevOffset, tevOffset + TEV_BLOCK_SIZE),
          readName: (offset) => editor.readNameAt(entry.offset + offset),
        });
      }
    }
  }
  return out;
}

const materials = archives.length > 0 ? collectMaterials() : [];

describe.skipIf(materials.length === 0)('material codec', () => {
  it('has fixtures to work with', () => {
    expect(materials.length).toBeGreaterThan(0);
  });

  it('re-encodes every material byte for byte', () => {
    const failures: string[] = [];
    for (const material of materials) {
      const doc = decodeMaterialBlock({
        block: material.block,
        tev: material.tev,
        name: material.materialName,
        readName: material.readName,
      });
      const encoded = encodeMaterialBlock({
        doc,
        original: material.block,
        originalTev: material.tev,
        blockOffset: material.offset,
      });
      // The sampler name pointers are re-derived by the writer, so blank them on both sides.
      const expected = blankNamePointers(material.block);
      const actual = blankNamePointers(encoded.block);
      const at = firstDifference(expected, actual);
      if (at !== -1) {
        failures.push(`${material.label}/${material.modelName}/${material.materialName}: material byte 0x${at.toString(16)} ${expected[at]} != ${actual[at]}`);
        continue;
      }
      const tevAt = firstDifference(material.tev, encoded.tev);
      if (tevAt !== -1) {
        failures.push(`${material.label}/${material.modelName}/${material.materialName}: TEV byte 0x${tevAt.toString(16)} ${material.tev[tevAt]} != ${encoded.tev[tevAt]}`);
      }
    }
    expect(failures.slice(0, 12).join('\n')).toBe('');
    expect(failures).toHaveLength(0);
  });

  it('reads back everything it wrote', () => {
    for (const material of materials.slice(0, 40)) {
      const doc = decodeMaterialBlock({ block: material.block, tev: material.tev, name: material.materialName, readName: material.readName });
      const encoded = encodeMaterialBlock({ doc, original: material.block, originalTev: material.tev, blockOffset: material.offset });
      const again = decodeMaterialBlock({ block: encoded.block, tev: encoded.tev, name: material.materialName, readName: material.readName });
      expect({ ...again, samplers: again.samplers.map((s) => ({ ...s, texture: '', palette: '' })) })
        .toEqual({ ...doc, samplers: doc.samplers.map((s) => ({ ...s, texture: '', palette: '' })) });
    }
  });
});

function blankNamePointers(block: Uint8Array): Uint8Array {
  const copy = block.slice();
  const view = new DataView(copy.buffer);
  const layers = view.getUint32(MAT.numLayers);
  const layerOffset = view.getUint32(MAT.layerOffset);
  for (let i = 0; i < layers; i++) {
    view.setInt32(layerOffset + i * 0x34 + 0x00, 0);
    view.setInt32(layerOffset + i * 0x34 + 0x04, 0);
  }
  return copy;
}
