/**
 * Texture name collisions when an object is placed into a track.
 *
 * Object BRRESes and course models both use short, generic texture names, so a collision is
 * ordinary. Reusing the track's image whenever the name matches silently repaints the placed
 * object; renaming whenever the name matches would duplicate megabytes for nothing. The rule is
 * to compare the actual bytes: identical images share, different images get renamed.
 */
import { describe, expect, it } from 'vitest';
import type { ImportedMesh } from '../brresEditor';
import { bakeCourseModel } from './bakeCourseModel';
import { BRRES_TEXTURES_GROUP, findSubFile, readBrresRaw, writeBrres } from './brresRaw';
import { internString } from './stringPool';
import { findObjectBrres, listCourseModels, parseWithNoclip } from './brresFixtures.testdata';

const models = listCourseModels(2);
const object = findObjectBrres(['itembox.brres', 'kuribo.brres', 'DokanSFC.brres']);

function placement(sourcePath: string): ImportedMesh {
  return {
    id: 'placed-1',
    sourcePath,
    modelName: '',
    transform: { translation: { x: 0, y: 400, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    visible: true,
  };
}

/** Names of every TEX0 in an archive. */
function textureNames(data: Uint8Array): string[] {
  const raw = readBrresRaw(data);
  return (raw.groups.find((group) => group.name === BRRES_TEXTURES_GROUP)?.entries ?? []).map((entry) => entry.name).sort();
}

/**
 * Builds the collision out of two real files: takes a texture the placed object actually samples
 * and plants it in the course archive under the same name but with the course's own (differently
 * sized) pixels behind it.
 *
 * Which textures the object contributes is discovered by baking it in once, so the collision
 * always lands on a name that really is on the import path.
 */
function plantCollidingTexture(courseModel: Uint8Array, objectName: string, objectBrres: Uint8Array): { data: Uint8Array; name: string } | null {
  const dryRun = bakeCourseModel(courseModel, {
    importedMeshes: [placement(objectName)],
    importSources: new Map([[objectName, objectBrres]]),
  });
  if (dryRun.addedTextures.length === 0) return null;

  const objectRaw = readBrresRaw(objectBrres);
  const courseRaw = readBrresRaw(courseModel);
  const courseTextures = courseRaw.groups.find((group) => group.name === BRRES_TEXTURES_GROUP)?.entries ?? [];
  if (courseTextures.length === 0) return null;

  for (const name of dryRun.addedTextures) {
    const victim = findSubFile(objectRaw, BRRES_TEXTURES_GROUP, name);
    if (!victim) continue;
    const donor = courseTextures.find((entry) => entry.data.length !== victim.data.length);
    if (!donor) continue;

    const clash = { ...donor, name, sourceOffset: -1, stringRefs: [{ offset: 0x14, value: name }] };
    const firstPinned = courseRaw.layout.findIndex((subFile) => subFile.stringRefs === null);
    courseRaw.layout.splice(firstPinned < 0 ? courseRaw.layout.length : firstPinned, 0, clash);
    courseTextures.push(clash);
    internString(courseRaw.pool, name);
    return { data: writeBrres(courseRaw), name };
  }
  return null;
}

const collision = models.length > 0 && object ? plantCollidingTexture(models[0].data, object.name, object.data) : null;

/** Every `material[sampler] = "texture"` binding an archive parses to, via noclip's own reader. */
async function samplerBindings(data: Uint8Array): Promise<string[]> {
  const parsed = await parseWithNoclip(data);
  const out: string[] = [];
  for (const mdl0 of parsed.mdl0) {
    for (const material of mdl0.materials) {
      const samplers: Array<{ name?: string } | undefined> = material.samplers;
      for (let i = 0; i < samplers.length; i++) {
        const sampler = samplers[i];
        if (sampler) out.push(`${material.name}[${i}]=${sampler.name ?? ''}`);
      }
    }
  }
  return out;
}

describe.skipIf(models.length === 0 || !object)('the track keeps its own texture bindings when an object is placed', () => {
  /**
   * Placing an object grows the material and shape dictionaries, which makes the writer open a
   * gap in front of the first block and shift every block along. A material's sampler names are
   * stored as offsets relative to the sampler entry and point out into the archive's string
   * pool, so a shifted block whose pointers are not re-relativized reads its names back as empty
   * — and every material in the track then exports with no texture bound at all.
   */
  it('every existing material still names the texture it sampled before', async () => {
    const before = await samplerBindings(models[0].data);
    expect(before.length).toBeGreaterThan(5);
    expect(before.every((binding) => !binding.endsWith('='))).toBe(true);

    const baked = bakeCourseModel(models[0].data, {
      importedMeshes: [placement(object!.name)],
      importSources: new Map([[object!.name, object!.data]]),
    });
    expect(baked.changed).toBe(true);

    const after = await samplerBindings(baked.data);
    // The originals are all still there and unchanged; the merged object only adds to the list.
    for (const binding of before) expect(after, `lost binding ${binding}`).toContain(binding);
    expect(after.filter((binding) => binding.endsWith('='))).toEqual([]);
  }, 300000);

  it('the placed object\'s own material names a texture too', async () => {
    const baked = bakeCourseModel(models[0].data, {
      importedMeshes: [placement(object!.name)],
      importSources: new Map([[object!.name, object!.data]]),
    });
    const after = await samplerBindings(baked.data);
    const before = await samplerBindings(models[0].data);
    const added = after.filter((binding) => !before.includes(binding));
    expect(added.length).toBeGreaterThan(0);
    for (const binding of added) expect(binding.endsWith('=')).toBe(false);
    // It resolves to one of the textures the bake actually put in the archive.
    expect(baked.addedTextures.some((name) => added.some((binding) => binding.endsWith(`=${name}`)))).toBe(true);
  }, 300000);
});

describe.skipIf(models.length === 0 || !object)('placing an object whose texture name the track already uses', () => {
  it('reuses the track texture when the image behind the name is identical', async () => {
    const sources = new Map([[object!.name, object!.data]]);
    // Place the same object twice: the second placement must not add a second copy.
    const once = bakeCourseModel(models[0].data, { importedMeshes: [placement(object!.name)], importSources: sources });
    const twice = bakeCourseModel(models[0].data, {
      importedMeshes: [placement(object!.name), { ...placement(object!.name), id: 'placed-2' }],
      importSources: sources,
    });
    expect(once.changed).toBe(true);
    expect(twice.addedTextures.sort()).toEqual(once.addedTextures.sort());
    // No name gained a `_1` suffix, because nothing actually clashed.
    expect(twice.addedTextures.filter((name) => /_\d+$/.test(name))).toEqual([]);
    expect((await parseWithNoclip(twice.data)).mdl0.length).toBeGreaterThan(0);
  }, 300000);
});

describe.skipIf(collision === null)('when the track has a different image under the same name', () => {
  it('renames the imported texture instead of silently reusing the track one', async () => {
    const target = collision!;
    const before = textureNames(target.data);
    expect(before).toContain(target.name);

    const baked = bakeCourseModel(target.data, {
      importedMeshes: [placement(object!.name)],
      importSources: new Map([[object!.name, object!.data]]),
    });
    expect(baked.changed).toBe(true);

    // The clashing name was not reused: a renamed copy was added instead.
    const renamed = baked.addedTextures.filter((name) => name.startsWith(`${target.name}_`));
    expect(renamed.length, `expected ${target.name} to be renamed, got ${JSON.stringify(baked.addedTextures)}`).toBe(1);
    expect(baked.addedTextures).not.toContain(target.name);

    const after = textureNames(baked.data);
    // The track's own texture is still there, untouched, and the import sits beside it.
    expect(after).toContain(target.name);
    expect(after).toContain(renamed[0]);

    const originalRaw = readBrresRaw(target.data);
    const bakedRaw = readBrresRaw(baked.data);
    const trackTexture = findSubFile(originalRaw, BRRES_TEXTURES_GROUP, target.name)!;
    const keptTexture = findSubFile(bakedRaw, BRRES_TEXTURES_GROUP, target.name)!;
    expect(keptTexture.data.length).toBe(trackTexture.data.length);

    // The renamed copy carries the object's pixels, not the track's.
    const objectRaw = readBrresRaw(object!.data);
    const objectTexture = findSubFile(objectRaw, BRRES_TEXTURES_GROUP, target.name)!;
    const importedTexture = findSubFile(bakedRaw, BRRES_TEXTURES_GROUP, renamed[0])!;
    expect(importedTexture.data.length).toBe(objectTexture.data.length);

    // And the whole thing still re-parses under noclip's own reader.
    const reparsed = await parseWithNoclip(baked.data);
    expect(reparsed.mdl0.length).toBeGreaterThan(0);
    expect(reparsed.tex0.map((tex: { name: string }) => tex.name)).toContain(renamed[0]);
  }, 300000);

  it('points the placed object\'s material at the renamed texture', async () => {
    const target = collision!;
    const baked = bakeCourseModel(target.data, {
      importedMeshes: [placement(object!.name)],
      importSources: new Map([[object!.name, object!.data]]),
    });
    const renamed = baked.addedTextures.find((name) => name.startsWith(`${target.name}_`))!;

    // noclip resolves a sampler by name, so if the merged material still said the old name it
    // would render with the track's image. Check the parsed material samplers.
    const reparsed = await parseWithNoclip(baked.data);
    const sampled = new Set<string>();
    for (const mdl0 of reparsed.mdl0) {
      for (const material of mdl0.materials) {
        for (const sampler of material.samplers) if (sampler?.name) sampled.add(sampler.name);
      }
    }
    expect(sampled).toContain(renamed);
  }, 300000);
});
