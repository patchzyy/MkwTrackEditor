// Extracting one model into its own BRRES has to give an archive the renderer parses to the
// same model and the same textures, with nothing else in it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeYaz0 } from '../yaz0';
import { parseU8 } from '../u8';
import { BRRES_MODELS_GROUP, BRRES_TEXTURES_GROUP, makeSubFileNameReader, readBrresRaw, findSubFile } from './brresRaw';
import { Mdl0Editor } from './mdl0Raw';
import { extractModelBrres, isBrresArchive, listBrresModelNames } from './extractModel';
import { listCourseModels, parseWithNoclip } from './brresFixtures.testdata';

function objectArchivesFromCommon(limit: number): Array<{ name: string; data: Uint8Array }> {
  const szs = new Uint8Array(readFileSync('public/data/MarioKartWii/Race/Common.szs'));
  const entries = parseU8(decodeYaz0(szs));
  return entries
    .filter((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('.brres') && entry.data)
    .slice(0, limit)
    .map((entry) => ({ name: entry.path, data: entry.data! }));
}

describe('extractModelBrres', () => {
  it('recognises BRRES bytes', () => {
    const [first] = objectArchivesFromCommon(1);
    expect(isBrresArchive(first.data)).toBe(true);
    expect(isBrresArchive(new Uint8Array([0x55, 0xaa, 0x38, 0x2d, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
    expect(listBrresModelNames(new Uint8Array(4))).toEqual([]);
  });

  it('extracts every object model in the shared archive into a standalone BRRES', async () => {
    const archives = objectArchivesFromCommon(40);
    expect(archives.length).toBeGreaterThan(10);
    let extracted = 0;
    for (const archive of archives) {
      const names = listBrresModelNames(archive.data);
      for (const modelName of names) {
        let result;
        try {
          result = extractModelBrres(archive.data, modelName);
        } catch (error) {
          // Models with user data are the one documented limitation.
          expect(String(error)).toMatch(/user data/);
          continue;
        }
        extracted++;
        const raw = readBrresRaw(result.data);
        expect(raw.groups.map((group) => group.name)).toContain(BRRES_MODELS_GROUP);
        expect(raw.groups.find((group) => group.name === BRRES_MODELS_GROUP)!.entries.map((entry) => entry.name)).toEqual([modelName]);
        const textureGroup = raw.groups.find((group) => group.name === BRRES_TEXTURES_GROUP);
        expect((textureGroup?.entries ?? []).map((entry) => entry.name).sort()).toEqual([...result.textures].sort());
        // No animation groups sneak in.
        expect(raw.groups.every((group) => [BRRES_MODELS_GROUP, BRRES_TEXTURES_GROUP, 'Palettes(NW4R)'].includes(group.name))).toBe(true);

        // Names inside the re-homed MDL0 still resolve.
        const sub = findSubFile(raw, BRRES_MODELS_GROUP, modelName)!;
        const editor = new Mdl0Editor(sub.data, makeSubFileNameReader(raw, sub));
        expect(editor.name).toBe(modelName);
        const sourceRaw = readBrresRaw(archive.data);
        const sourceSub = findSubFile(sourceRaw, BRRES_MODELS_GROUP, modelName)!;
        const sourceEditor = new Mdl0Editor(sourceSub.data, makeSubFileNameReader(sourceRaw, sourceSub));
        expect(editor.listMaterials().map((material) => material.name)).toEqual(sourceEditor.listMaterials().map((material) => material.name));
        expect(editor.collectNames().sort()).toEqual(sourceEditor.collectNames().sort());

        // And noclip parses the result to the same model.
        const parsed = await parseWithNoclip(result.data);
        expect(parsed.mdl0.map((model) => model.name)).toEqual([modelName]);
        expect(parsed.tex0.map((texture) => texture.name).sort()).toEqual([...result.textures].sort());
        const parsedSource = await parseWithNoclip(archive.data);
        const sourceModel = parsedSource.mdl0.find((model) => model.name === modelName)!;
        expect(parsed.mdl0[0].materials.length).toBe(sourceModel.materials.length);
        expect(parsed.mdl0[0].shapes.length).toBe(sourceModel.shapes.length);
        expect(parsed.mdl0[0].nodes.length).toBe(sourceModel.nodes.length);
      }
    }
    expect(extracted).toBeGreaterThan(10);
  });

  it('throws for an unknown model name', () => {
    const [first] = objectArchivesFromCommon(1);
    expect(() => extractModelBrres(first.data, 'no_such_model')).toThrow(/no model named/);
  });

  const fixtures = listCourseModels(3);
  it.skipIf(fixtures.length === 0)('extracts course models from real tracks', async () => {
    for (const fixture of fixtures) {
      const names = listBrresModelNames(fixture.data);
      expect(names.length).toBeGreaterThan(0);
      let result;
      try {
        result = extractModelBrres(fixture.data, names[0]);
      } catch (error) {
        expect(String(error)).toMatch(/user data/);
        continue;
      }
      const parsed = await parseWithNoclip(result.data);
      expect(parsed.mdl0.map((model) => model.name)).toEqual([names[0]]);
      expect(result.data.length).toBeLessThanOrEqual(fixture.data.length);
    }
  });
});
