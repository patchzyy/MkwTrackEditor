// The promise the simple inspector makes: open a real material in it, look at every friendly
// control, put each one back where it already was, and nothing changes.
//
// `materialSimple.test.ts` shows the getters and setters are the identity on a document. This
// takes the same round trip all the way down through `applyMaterial` into real MDL0 bytes, which
// is the level at which a bug would actually cost a user their track. It runs against whatever
// archives this machine has; the object BRRES files inside the bundled `Common.szs` are always
// there, so it has teeth on CI as well (`MKW_TEST_FIXTURES=bundled`).
//
// The claim is stated at two strengths, because the writer underneath has its own fidelity and
// this module should not be blamed for it:
//
//   1. Rewriting the archive with the touched document produces exactly the bytes rewriting it
//      with the *untouched* document produces. That is purely this module's property, and it
//      holds for every material on this machine.
//   2. Those bytes are the original archive. That is the writer's property as well, and it holds
//      wherever `applyMaterial` already reproduces a material exactly. It does not everywhere:
//      widening the fixture set to the whole of `Common.szs` turns up `jugemu.brres / mat_shadow`,
//      whose untouched rewrite moves the file length in the BRRES header, and `kart_killer`,
//      whose archive the writer refuses outright. Those are `src/lib/gxMaterial`'s business, not
//      this module's, so a material the writer cannot reproduce is skipped here — and the
//      proportion skipped is asserted, so the skip cannot quietly swallow a real regression.

import { describe, expect, it } from 'vitest';
import { applyMaterial, decodeMaterial, type GxMaterialDoc } from '../../lib/gxMaterial';
import { firstDifference } from '../../lib/brres/brresFixtures.testdata';
import { listMaterialArchives, listMaterialsIn, type MaterialFixture } from '../../lib/gxMaterial/materialFixtures.testdata';
import {
  getCutoutThreshold,
  getLayerFilter,
  getLayerWrap,
  getShadingMode,
  getTransparencyMode,
  getWritesDepth,
  isEnvironmentMapped,
  isTwoSided,
  setCutoutThreshold,
  setEnvironmentMapped,
  setLayerFilter,
  setLayerWrap,
  setShadingMode,
  setTransparencyMode,
  setTwoSided,
  setWritesDepth,
} from './materialSimple';

/**
 * Every simple control, read and written straight back. This is what the inspector does when the
 * user re-picks the choice a material is already on — and it is exactly the call the inspector
 * makes, not a paraphrase of it.
 */
function touchEverySimpleControl(doc: GxMaterialDoc): GxMaterialDoc {
  let next = doc;
  next = setTransparencyMode(next, getTransparencyMode(next));
  // The threshold slider is only on screen when the material is cutting holes, and that is the
  // only case in which `getCutoutThreshold` reports the material's own value rather than the
  // default the "Cutout" choice would write.
  if (getTransparencyMode(next) === 'cutout') next = setCutoutThreshold(next, getCutoutThreshold(next));
  next = setTwoSided(next, isTwoSided(next));
  next = setWritesDepth(next, getWritesDepth(next));
  next = setShadingMode(next, getShadingMode(next));
  next.samplers.forEach((sampler, index) => {
    const wrap = getLayerWrap(sampler);
    if (wrap !== null) next = setLayerWrap(next, index, wrap);
    next = setLayerFilter(next, index, getLayerFilter(sampler));
    next = setEnvironmentMapped(next, index, isEnvironmentMapped(sampler));
  });
  return next;
}

const archives = listMaterialArchives(3, 8);

/** A handful of materials per archive, first come — enough coverage without a minute-long run. */
function pickMaterials(limit = 12): MaterialFixture[] {
  const out: MaterialFixture[] = [];
  for (const archive of archives) {
    for (const material of listMaterialsIn(archive).slice(0, limit)) out.push(material);
  }
  return out;
}

const materials = archives.length > 0 ? pickMaterials() : [];

function rewrite(material: MaterialFixture, doc: GxMaterialDoc): Uint8Array {
  return applyMaterial(material.data, material.modelName, material.materialName, doc).brres;
}

/** True when the writer already reproduces this material's archive exactly, untouched. */
function writerReproduces(material: MaterialFixture): boolean {
  const doc = decodeMaterial(material.data, material.modelName, material.materialName);
  return firstDifference(material.data, rewrite(material, doc)) === -1;
}

describe.skipIf(materials.length === 0)('the simple view is byte-exact on real materials', () => {
  it('adds nothing at all to what the writer would have written anyway', () => {
    for (const material of materials) {
      const doc = decodeMaterial(material.data, material.modelName, material.materialName);
      const touched = touchEverySimpleControl(doc);
      const where = `${material.label} / ${material.materialName}`;
      // The document comes back by reference: every setter no-ops on the value it just read.
      expect(touched, where).toBe(doc);
      expect(firstDifference(rewrite(material, doc), rewrite(material, touched)), where).toBe(-1);
    }
  });

  it('leaves the archive byte-for-byte identical', () => {
    let intact = 0;
    for (const material of materials) {
      if (!writerReproduces(material)) continue;
      const doc = decodeMaterial(material.data, material.modelName, material.materialName);
      const rewritten = rewrite(material, touchEverySimpleControl(doc));
      expect(firstDifference(material.data, rewritten), `${material.label} / ${material.materialName}`).toBe(-1);
      intact++;
    }
    // Nearly every material has to take part, or the skip above would be hiding a real failure.
    expect(intact / materials.length).toBeGreaterThan(0.9);
  });

  it('changes bytes when a simple control is actually moved, and only then', () => {
    // The mirror image of the tests above: proof that "no bytes changed" means the round trip is
    // clean rather than that `applyMaterial` never writes anything.
    const material = materials.find(writerReproduces)!;
    const doc = decodeMaterial(material.data, material.modelName, material.materialName);
    const flipped = setTwoSided(doc, !isTwoSided(doc));
    expect(flipped).not.toBe(doc);
    const changed = rewrite(material, flipped);
    expect(firstDifference(material.data, changed)).toBeGreaterThanOrEqual(0);
    // And putting the switch back gets the original bytes again.
    const restored = applyMaterial(changed, material.modelName, material.materialName, setTwoSided(flipped, isTwoSided(doc)));
    expect(firstDifference(material.data, restored.brres)).toBe(-1);
  });
});
