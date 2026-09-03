// Reading and writing materials inside real archives.
//
// Three levels of assurance, weakest to strongest: the archive comes back byte-identical when
// nothing changed; the vendored noclip parser — a completely independent reader, and the one the
// viewport actually uses — sees the same material afterwards; and the structural edits (more
// textures, more stages, a cloned shader, a rename, adding and removing a TEX0) leave an archive
// that still parses and reads back as written.

import { describe, expect, it } from 'vitest';
import * as GX from '../../../vendor/noclip.website/src/gx/gx_enum';
import { BRRES_MODELS_GROUP, BRRES_TEXTURES_GROUP, readBrresRaw } from '../brres/brresRaw';
import { firstDifference, parseWithNoclip } from '../brres/brresFixtures.testdata';
import { encodeTex0Data } from '../tex0Codec';
import { listMaterialArchives, listMaterialsIn, type ArchiveFixture } from './materialFixtures.testdata';
import { addTexture, applyMaterial, decodeMaterial, listArchiveMaterials, removeTexture, renameTexture } from './archive';
import { createDefaultSampler, createDefaultTexGen, createDefaultTexSrt, createPassThroughStage } from './defaults';
import { GxMaterialError } from './types';

const archives = listMaterialArchives(3, 3);

/** The first archive that has a material with at least two stages, for the structural edits. */
function pickEditable(): { archive: ArchiveFixture; modelName: string; materialName: string } | null {
  for (const archive of archives) {
    for (const material of listMaterialsIn(archive)) {
      const doc = decodeMaterial(archive.data, material.modelName, material.materialName);
      if (doc.samplers.length >= 1 && doc.texGens.length >= 1) {
        return { archive, modelName: material.modelName, materialName: material.materialName };
      }
    }
  }
  return null;
}

const editable = archives.length > 0 ? pickEditable() : null;

describe.skipIf(archives.length === 0)('listArchiveMaterials', () => {
  it('reports models, shared shaders, meshes and texture users', () => {
    const listing = listArchiveMaterials('./course_model.brres', archives[0].data);
    expect(listing.archivePath).toBe('./course_model.brres');
    expect(listing.models.length).toBeGreaterThan(0);
    const materials = listing.models.flatMap((model) => model.materials);
    expect(materials.length).toBeGreaterThan(0);
    for (const material of materials) {
      expect(material.stageCount).toBeGreaterThan(0);
      expect(material.sharedShaderWith).not.toContain(material.materialName);
      // Sharing is symmetric: everyone in a group names everyone else.
      for (const other of material.sharedShaderWith) {
        const peer = materials.find((candidate) => candidate.materialName === other && candidate.modelName === material.modelName)!;
        expect(peer.sharedShaderWith).toContain(material.materialName);
      }
    }
    // At least one material draws something, and at least one texture is used.
    expect(materials.some((material) => material.meshes.length > 0)).toBe(true);
    expect(listing.textures.length).toBeGreaterThan(0);
    for (const texture of listing.textures) {
      for (const user of texture.usedBy) {
        expect(materials.find((material) => material.materialName === user)!.textures).toContain(texture.name);
      }
    }
  });
});

describe.skipIf(archives.length === 0)('applyMaterial', () => {
  it('rewrites every material in every archive without changing a byte', () => {
    const failures: string[] = [];
    let count = 0;
    for (const archive of archives) {
      for (const material of listMaterialsIn(archive)) {
        count++;
        const doc = decodeMaterial(archive.data, material.modelName, material.materialName);
        const result = applyMaterial(archive.data, material.modelName, material.materialName, doc);
        const at = firstDifference(archive.data, result.brres);
        if (at !== -1) failures.push(`${archive.label}/${material.materialName}: byte 0x${at.toString(16)}`);
        if (result.warnings.length > 0) failures.push(`${archive.label}/${material.materialName}: ${result.warnings.join(' ')}`);
      }
    }
    expect(count).toBeGreaterThan(0);
    expect(failures.slice(0, 10).join('\n')).toBe('');
  });

  it('leaves the renderer seeing the same material', async () => {
    const archive = archives[0];
    const before = await parseWithNoclip(archive.data);
    let rewritten = archive.data;
    for (const material of listMaterialsIn(archive).slice(0, 12)) {
      const doc = decodeMaterial(rewritten, material.modelName, material.materialName);
      rewritten = applyMaterial(rewritten, material.modelName, material.materialName, doc).brres;
    }
    const after = await parseWithNoclip(rewritten);
    expect(after.mdl0.map((model) => model.name)).toEqual(before.mdl0.map((model) => model.name));
    for (let i = 0; i < before.mdl0.length; i++) {
      expect(after.mdl0[i].materials.map((material: { gxMaterial: unknown }) => material.gxMaterial))
        .toEqual(before.mdl0[i].materials.map((material: { gxMaterial: unknown }) => material.gxMaterial));
      expect(after.mdl0[i].materials.map((material: { samplers: unknown }) => material.samplers))
        .toEqual(before.mdl0[i].materials.map((material: { samplers: unknown }) => material.samplers));
    }
  });
});

describe.skipIf(editable === null)('structural edits', () => {
  const target = editable!;

  it('adds a texture layer and the texture link that goes with it', async () => {
    const doc = decodeMaterial(target.archive.data, target.modelName, target.materialName);
    const before = doc.samplers.length;
    const otherTexture = readBrresRaw(target.archive.data).groups
      .find((group) => group.name === BRRES_TEXTURES_GROUP)!.entries
      .map((entry) => entry.name)
      .find((name) => !doc.samplers.some((sampler) => sampler.texture === name)) ?? doc.samplers[0].texture;

    doc.samplers = [...doc.samplers, { ...createDefaultSampler(otherTexture) }];
    doc.texSrts = [...doc.texSrts, createDefaultTexSrt()];
    doc.texGens = [...doc.texGens, createDefaultTexGen(before)];

    const result = applyMaterial(target.archive.data, target.modelName, target.materialName, doc);
    expect(result.affectedMaterials).toContain(doc.name);

    const again = decodeMaterial(result.brres, target.modelName, target.materialName);
    expect(again.samplers).toHaveLength(before + 1);
    expect(again.samplers[before].texture).toBe(otherTexture);
    expect(again.texGens).toHaveLength(before + 1);

    // The console binds textures through the model's texture-link table, not by name.
    const links = linkedMaterials(result.brres, target.modelName, otherTexture);
    expect(links).toContain(target.materialName);

    const parsed = await parseWithNoclip(result.brres);
    const material = findNoclipMaterial(parsed, target.modelName, target.materialName);
    expect(material.samplers.filter(Boolean)).toHaveLength(before + 1);
  });

  it('adds stages past the count the material shipped with', async () => {
    const doc = decodeMaterial(target.archive.data, target.modelName, target.materialName);
    const before = doc.tevStages.length;
    doc.tevStages = [...doc.tevStages, createPassThroughStage(), createPassThroughStage(), createPassThroughStage()];

    const result = applyMaterial(target.archive.data, target.modelName, target.materialName, doc);
    const again = decodeMaterial(result.brres, target.modelName, target.materialName);
    expect(again.tevStages).toHaveLength(before + 3);
    expect(again.tevStages.slice(before)).toEqual(doc.tevStages.slice(before));

    const parsed = await parseWithNoclip(result.brres);
    const material = findNoclipMaterial(parsed, target.modelName, target.materialName);
    expect(material.gxMaterial.tevStages).toHaveLength(before + 3);
  });

  it('gives a material its own shader rather than changing the ones it shared with', async () => {
    const shared = findSharedMaterial();
    if (!shared) return; // No shared shader in these fixtures; nothing to clone.

    const doc = decodeMaterial(shared.archive.data, shared.modelName, shared.materialName);
    doc.tevStages = [...doc.tevStages, createPassThroughStage()];
    const result = applyMaterial(shared.archive.data, shared.modelName, shared.materialName, doc);
    expect(result.affectedMaterials).toEqual([doc.name]);
    expect(result.warnings.join(' ')).toMatch(/copy of its own/);

    const peer = decodeMaterial(result.brres, shared.modelName, shared.peerName);
    const peerBefore = decodeMaterial(shared.archive.data, shared.modelName, shared.peerName);
    expect(peer.tevStages).toEqual(peerBefore.tevStages);
    expect(decodeMaterial(result.brres, shared.modelName, shared.materialName).tevStages).toHaveLength(doc.tevStages.length);
    await expect(parseWithNoclip(result.brres)).resolves.toBeTruthy();
  });

  it('rewrites a shared shader in place when asked to', () => {
    const shared = findSharedMaterial();
    if (!shared) return;
    const doc = decodeMaterial(shared.archive.data, shared.modelName, shared.materialName);
    doc.tevStages = [...doc.tevStages, createPassThroughStage()];
    const result = applyMaterial(shared.archive.data, shared.modelName, shared.materialName, doc, { sharedShader: 'shared' });
    expect(result.affectedMaterials).toContain(shared.peerName);
    expect(decodeMaterial(result.brres, shared.modelName, shared.peerName).tevStages).toHaveLength(doc.tevStages.length);
  });

  it('renames a material without disturbing what draws it', async () => {
    const doc = decodeMaterial(target.archive.data, target.modelName, target.materialName);
    const meshesBefore = meshesOf(target.archive.data, target.modelName, target.materialName);
    doc.name = 'renamed_by_test';
    const result = applyMaterial(target.archive.data, target.modelName, target.materialName, doc);

    expect(() => decodeMaterial(result.brres, target.modelName, target.materialName)).toThrow(GxMaterialError);
    const again = decodeMaterial(result.brres, target.modelName, 'renamed_by_test');
    expect(again.tevStages).toEqual(doc.tevStages);
    expect(meshesOf(result.brres, target.modelName, 'renamed_by_test')).toEqual(meshesBefore);

    const parsed = await parseWithNoclip(result.brres);
    expect(findNoclipMaterial(parsed, target.modelName, 'renamed_by_test')).toBeTruthy();
  });

  it('moves a material between the opaque and translucent passes', () => {
    const doc = decodeMaterial(target.archive.data, target.modelName, target.materialName);
    doc.translucent = !doc.translucent;
    const result = applyMaterial(target.archive.data, target.modelName, target.materialName, doc);
    const listing = listArchiveMaterials('', result.brres);
    const summary = listing.models.find((model) => model.modelName === target.modelName)!
      .materials.find((material) => material.materialName === target.materialName)!;
    expect(summary.translucent).toBe(doc.translucent);
    expect(summary.meshes).toEqual(meshesOf(target.archive.data, target.modelName, target.materialName));
  });

  it('refuses to assign a texture the archive does not have', () => {
    const doc = decodeMaterial(target.archive.data, target.modelName, target.materialName);
    doc.samplers = doc.samplers.map((sampler) => ({ ...sampler, texture: 'not_in_this_archive' }));
    expect(() => applyMaterial(target.archive.data, target.modelName, target.materialName, doc)).toThrow(/no texture called/);
  });

  it('refuses documents the hardware could not run', () => {
    const doc = decodeMaterial(target.archive.data, target.modelName, target.materialName);
    const tooMany = { ...doc, tevStages: Array.from({ length: 17 }, createPassThroughStage) };
    expect(() => applyMaterial(target.archive.data, target.modelName, target.materialName, tooMany)).toThrow(/at most 16/);

    const badStage = { ...doc, tevStages: [{ ...createPassThroughStage(), texMap: 7 as GX.TexMapID }] };
    expect(() => applyMaterial(target.archive.data, target.modelName, target.materialName, badStage)).toThrow(GxMaterialError);
  });
});

describe.skipIf(archives.length === 0)('textures', () => {
  it('adds a TEX0 the renderer can read', async () => {
    const archive = archives[0];
    const pixels = new Uint8Array(64 * 64 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 0xff;
      pixels[i + 3] = 0xff;
    }
    const data = encodeTex0Data({ width: 64, height: 64, pixels }, GX.TexFormat.RGB5A3, 64, 64, 1);
    const out = addTexture(archive.data, { name: 'test_added', format: GX.TexFormat.RGB5A3, width: 64, height: 64, mipCount: 1, data });

    const listing = listArchiveMaterials('', out);
    const added = listing.textures.find((texture) => texture.name === 'test_added');
    expect(added).toBeTruthy();
    expect(added!.width).toBe(64);
    expect(added!.usedBy).toEqual([]);

    const parsed = await parseWithNoclip(out);
    expect(parsed.tex0.map((tex0: { name: string }) => tex0.name)).toContain('test_added');
    // Everything else survived.
    expect(parsed.mdl0.length).toBe((await parseWithNoclip(archive.data)).mdl0.length);
    expect(readBrresRaw(out).groups.find((group) => group.name === BRRES_TEXTURES_GROUP)!.entries.length)
      .toBe(readBrresRaw(archive.data).groups.find((group) => group.name === BRRES_TEXTURES_GROUP)!.entries.length + 1);
  });

  it('removes a TEX0 nobody samples and refuses one that is in use', async () => {
    const archive = archives[0];
    const pixels = new Uint8Array(32 * 32 * 4);
    const data = encodeTex0Data({ width: 32, height: 32, pixels }, GX.TexFormat.RGB5A3, 32, 32, 1);
    const withExtra = addTexture(archive.data, { name: 'test_added', format: GX.TexFormat.RGB5A3, width: 32, height: 32, mipCount: 1, data });

    const cleaned = removeTexture(withExtra, 'test_added');
    expect(listArchiveMaterials('', cleaned).textures.map((texture) => texture.name)).not.toContain('test_added');
    await expect(parseWithNoclip(cleaned)).resolves.toBeTruthy();

    const used = listArchiveMaterials('', archive.data).textures.find((texture) => texture.usedBy.length > 0);
    if (used) expect(() => removeTexture(archive.data, used.name)).toThrow(/still used by/);
  });

  it('renames a texture and everything that sampled it', async () => {
    const archive = archives[0];
    const used = listArchiveMaterials('', archive.data).textures.find((texture) => texture.usedBy.length > 0);
    if (!used) return;
    const out = renameTexture(archive.data, used.name, 'renamed_texture');

    const listing = listArchiveMaterials('', out);
    const renamed = listing.textures.find((texture) => texture.name === 'renamed_texture');
    expect(renamed).toBeTruthy();
    expect(renamed!.usedBy.sort()).toEqual([...used.usedBy].sort());
    expect(listing.textures.map((texture) => texture.name)).not.toContain(used.name);

    const parsed = await parseWithNoclip(out);
    expect(parsed.tex0.map((tex0: { name: string }) => tex0.name)).toContain('renamed_texture');
  });
});

// ------------------------------------------------------------------------------------- helpers

function findNoclipMaterial(parsed: { mdl0: any[] }, modelName: string, materialName: string) {
  const model = parsed.mdl0.find((candidate) => candidate.name === modelName) ?? parsed.mdl0[0];
  const material = model.materials.find((candidate: { name: string }) => candidate.name === materialName);
  expect(material).toBeTruthy();
  return material;
}

function meshesOf(brres: Uint8Array, modelName: string, materialName: string): string[] {
  return listArchiveMaterials('', brres).models
    .find((model) => model.modelName === modelName)!
    .materials.find((material) => material.materialName === materialName)!
    .meshes;
}

function linkedMaterials(brres: Uint8Array, modelName: string, textureName: string): string[] {
  const listing = listArchiveMaterials('', brres);
  const model = listing.models.find((candidate) => candidate.modelName === modelName)!;
  return model.materials.filter((material) => material.textures.includes(textureName)).map((material) => material.materialName);
}

function findSharedMaterial(): { archive: ArchiveFixture; modelName: string; materialName: string; peerName: string } | null {
  for (const archive of archives) {
    for (const model of listArchiveMaterials('', archive.data).models) {
      const shared = model.materials.find((material) => material.sharedShaderWith.length > 0);
      if (shared) {
        return { archive, modelName: model.modelName, materialName: shared.materialName, peerName: shared.sharedShaderWith[0] };
      }
    }
  }
  return null;
}

// `readBrresRaw` is only imported for the group assertions above; keep the model group name used
// so the import list stays honest.
void BRRES_MODELS_GROUP;
