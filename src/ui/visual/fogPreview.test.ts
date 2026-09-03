/**
 * Course-fog plumbing: the panel edits `posteffect.bfg`, and the vendored renderer has to read
 * back exactly what was written and turn it into GX fog the shader generator can actually build.
 *
 * These are the value-level halves of the feature. The pixels are proved separately, in the
 * browser, by `scripts/probe-fog.js`.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultBfg, parseBfgFogEntries, writeBfgFogEntries } from '../../lib/posteffects';
import { decodeYaz0 } from '../../lib/yaz0';
import { parseU8 } from '../../lib/u8';
import { CUSTOM_TRACK_DIR, NINTENDO_TRACK_DIR, listTracks, readTrackBytes } from '../../lib/realTrackFixtures.testdata';

/**
 * `PostEffect.ts` imports `Camera.ts`, which pulls in noclip's `GlobalSaveManager` and touches
 * `window.localStorage` at module scope. These tests run in the Node environment (this project
 * has no jsdom; its React tests render to static markup), so stand up the smallest possible
 * `window` before that import happens.
 */
function stubBrowserGlobals(): void {
  if ((globalThis as Record<string, unknown>).window !== undefined) return;
  const store = new Map<string, string>();
  const localStorage = {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
  (globalThis as Record<string, unknown>).window = { localStorage };
}

/** The vendored renderer's own BFG reader and fog-type translation. */
async function loadVendorFog() {
  stubBrowserGlobals();
  const [{ default: ArrayBufferSlice }, PostEffect, GX] = await Promise.all([
    // @ts-ignore vendored noclip source sits outside this app's tsconfig surface.
    import('../../../vendor/noclip.website/src/ArrayBufferSlice.js'),
    // @ts-ignore vendored noclip source sits outside this app's tsconfig surface.
    import('../../../vendor/noclip.website/src/MarioKartWii/PostEffect.js'),
    // @ts-ignore vendored noclip source sits outside this app's tsconfig surface.
    import('../../../vendor/noclip.website/src/gx/gx_enum.js'),
  ]);
  const wrap = (data: Uint8Array) => {
    const copy = data.slice();
    return new ArrayBufferSlice(copy.buffer, copy.byteOffset, copy.byteLength);
  };
  return { PostEffect, GX, wrap };
}

/** The scene scale the Mario Kart Wii renderer draws the course at. */
const SCENE_SCALE = 0.1;

describe('BFG fog, editor side to renderer side', () => {
  it('the renderer reads back exactly what the post-effects panel writes', async () => {
    const { PostEffect, wrap } = await loadVendorFog();
    const written = writeBfgFogEntries(createDefaultBfg(), [
      { index: 0, fogType: 4, startZ: 1234.5, endZ: 45678.25, color: [17, 200, 91], alpha: 0, fadeSpeed: 0.5 },
      { index: 1, fogType: 1, startZ: 10, endZ: 20, color: [255, 0, 0], alpha: 0, fadeSpeed: 0 },
      { index: 2, fogType: 0, startZ: 0, endZ: 0, color: [0, 0, 0], alpha: 0, fadeSpeed: 0 },
      { index: 3, fogType: 0, startZ: 0, endZ: 0, color: [0, 0, 0], alpha: 0, fadeSpeed: 0 },
    ]);

    const vendor = PostEffect.parseBFG(wrap(written));
    expect(vendor.entries).toHaveLength(4);
    expect(vendor.entries[0].fogType).toBe(4);
    expect(vendor.entries[0].startZ).toBeCloseTo(1234.5, 3);
    expect(vendor.entries[0].endZ).toBeCloseTo(45678.25, 3);
    // The renderer keeps colour as normalized floats; the panel keeps 0-255 bytes.
    expect(vendor.entries[0].color.r * 255).toBeCloseTo(17, 0);
    expect(vendor.entries[0].color.g * 255).toBeCloseTo(200, 0);
    expect(vendor.entries[0].color.b * 255).toBeCloseTo(91, 0);
    expect(vendor.entries[1].fogType).toBe(1);
  });

  it('turns a preset into scene-unit fog settings, and scales the distances', async () => {
    const { PostEffect, GX, wrap } = await loadVendorFog();
    const bfg = PostEffect.parseBFG(wrap(writeBfgFogEntries(createDefaultBfg(), [
      { index: 0, fogType: 4, startZ: 45000, endZ: 500000, color: [41, 44, 107], alpha: 0, fadeSpeed: 0 },
    ])));

    const settings = PostEffect.getBFGFogSettings(bfg, 0, SCENE_SCALE);
    expect(settings).not.toBeNull();
    expect(settings!.type).toBe(GX.FogType.PERSP_REVEXP);
    expect(settings!.startZ).toBeCloseTo(4500, 3);
    expect(settings!.endZ).toBeCloseTo(50000, 3);
    expect(settings!.color.r * 255).toBeCloseTo(41, 0);
  });

  it('reads a preset the author switched off as no fog rather than guessing a band', async () => {
    const { PostEffect, wrap } = await loadVendorFog();
    const make = (entry: Parameters<typeof writeBfgFogEntries>[1][number]) =>
      PostEffect.parseBFG(wrap(writeBfgFogEntries(createDefaultBfg(), [entry])));
    const base = { index: 0, color: [255, 255, 255] as [number, number, number], alpha: 0, fadeSpeed: 0 };

    // Type 0 is "no fog".
    expect(PostEffect.getBFGFogSettings(make({ ...base, fogType: 0, startZ: 10, endZ: 100 }), 0, SCENE_SCALE)).toBeNull();
    // An empty band.
    expect(PostEffect.getBFGFogSettings(make({ ...base, fogType: 1, startZ: 100, endZ: 100 }), 0, SCENE_SCALE)).toBeNull();
    // An inverted band.
    expect(PostEffect.getBFGFogSettings(make({ ...base, fogType: 1, startZ: 900, endZ: 100 }), 0, SCENE_SCALE)).toBeNull();
    // A preset index the file does not have, and no file at all.
    expect(PostEffect.getBFGFogSettings(make({ ...base, fogType: 1, startZ: 1, endZ: 2 }), 9, SCENE_SCALE)).toBeNull();
    expect(PostEffect.getBFGFogSettings(null, 0, SCENE_SCALE)).toBeNull();
  });

  it('maps every fog type the panel offers onto a GX type', async () => {
    const { PostEffect, GX } = await loadVendorFog();
    expect(PostEffect.translateBFGFogType(0)).toBeNull();
    const expected: Array<[number, number]> = [
      [1, GX.FogType.PERSP_LIN],
      [2, GX.FogType.PERSP_EXP],
      [3, GX.FogType.PERSP_EXP2],
      [4, GX.FogType.PERSP_REVEXP],
      [5, GX.FogType.PERSP_REVEXP2],
      [6, GX.FogType.ORTHO_LIN],
      [7, GX.FogType.ORTHO_EXP],
      [8, GX.FogType.ORTHO_EXP2],
      [9, GX.FogType.ORTHO_REVEXP],
      [10, GX.FogType.ORTHO_REVEXP2],
    ];
    for (const [dense, gx] of expected) expect(PostEffect.translateBFGFogType(dense)).toBe(gx);
    // Anything outside the table is "no fog", not a crash.
    expect(PostEffect.translateBFGFogType(11)).toBeNull();
    expect(PostEffect.translateBFGFogType(-1)).toBeNull();
  });
});

describe('GX fog shader generation', () => {
  /**
   * Every fog type the panel can select has to produce a shader. Before this feature the
   * generator compared the 0x07-masked type against the *unmasked* `ORTHO_REVEXP` constants, so
   * the two InvExp curves were unreachable and threw — and InvExp is the type Mario Kart Wii
   * uses more than any other.
   */
  it('builds a fragment shader for all ten fog types', async () => {
    // @ts-ignore vendored noclip source sits outside this app's tsconfig surface.
    const GX_Material = await import('../../../vendor/noclip.website/src/gx/gx_material.js');
    // @ts-ignore vendored noclip source sits outside this app's tsconfig surface.
    const { GXMaterialBuilder } = await import('../../../vendor/noclip.website/src/gx/GXMaterialBuilder.js');
    // @ts-ignore vendored noclip source sits outside this app's tsconfig surface.
    const GX = await import('../../../vendor/noclip.website/src/gx/gx_enum.js');

    const types = [
      GX.FogType.PERSP_LIN, GX.FogType.PERSP_EXP, GX.FogType.PERSP_EXP2,
      GX.FogType.PERSP_REVEXP, GX.FogType.PERSP_REVEXP2,
      GX.FogType.ORTHO_LIN, GX.FogType.ORTHO_EXP, GX.FogType.ORTHO_EXP2,
      GX.FogType.ORTHO_REVEXP, GX.FogType.ORTHO_REVEXP2,
    ];

    for (const type of types) {
      const mb = new GXMaterialBuilder(`fog-${type}`);
      mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR_ZERO);
      mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.KONST);
      mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST);
      mb.setFog(type, false);
      const material = mb.finish();

      const program = new GX_Material.GX_Program(material, {});
      const source = String(program.frag ?? program.both ?? '');
      expect(source, `fog type 0x${type.toString(16)} should emit a fog mix`).toContain('u_FogBlock.Color.rgb');
    }
  });

  it('leaves a material with no fog free of fog code', async () => {
    // @ts-ignore vendored noclip source sits outside this app's tsconfig surface.
    const GX_Material = await import('../../../vendor/noclip.website/src/gx/gx_material.js');
    // @ts-ignore vendored noclip source sits outside this app's tsconfig surface.
    const { GXMaterialBuilder } = await import('../../../vendor/noclip.website/src/gx/GXMaterialBuilder.js');
    // @ts-ignore vendored noclip source sits outside this app's tsconfig surface.
    const GX = await import('../../../vendor/noclip.website/src/gx/gx_enum.js');

    const mb = new GXMaterialBuilder('no-fog');
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR_ZERO);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.KONST);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST);
    mb.setFog(GX.FogType.NONE, false);
    const material = mb.finish();
    expect(GX_Material.materialHasFogBlock(material)).toBe(false);
    const source = String(new GX_Material.GX_Program(material, {}).frag ?? '');
    expect(source).not.toContain('u_FogBlock');
  });
});

const tracks = [...listTracks(CUSTOM_TRACK_DIR), ...listTracks(NINTENDO_TRACK_DIR)];

describe.skipIf(tracks.length === 0)('BFG fog on the real tracks installed here', () => {
  it('agrees with the renderer on every posteffect.bfg, and every type is renderable', async () => {
    const { PostEffect, GX, wrap } = await loadVendorFog();
    const renderableCurves = new Set<number>([
      GX.FogType.PERSP_LIN & 0x07,
      GX.FogType.PERSP_EXP & 0x07,
      GX.FogType.PERSP_EXP2 & 0x07,
      GX.FogType.PERSP_REVEXP & 0x07,
      GX.FogType.PERSP_REVEXP2 & 0x07,
    ]);

    let checked = 0;
    let withLiveFog = 0;
    for (const path of tracks) {
      let entries;
      try {
        entries = parseU8(decodeYaz0(readTrackBytes(path)));
      } catch {
        continue;
      }
      const bfg = entries.find((entry) => entry.type === 'file' && /posteffect\.bfg$/i.test(entry.path));
      if (!bfg?.data) continue;
      checked++;

      const editorSide = parseBfgFogEntries(bfg.data);
      const rendererSide = PostEffect.parseBFG(wrap(bfg.data));
      expect(rendererSide.entries.length).toBe(editorSide.length);

      for (let i = 0; i < editorSide.length; i++) {
        expect(rendererSide.entries[i].fogType).toBe(editorSide[i].fogType);
        if (Number.isFinite(editorSide[i].startZ)) expect(rendererSide.entries[i].startZ).toBeCloseTo(editorSide[i].startZ, 2);
        if (Number.isFinite(editorSide[i].endZ)) expect(rendererSide.entries[i].endZ).toBeCloseTo(editorSide[i].endZ, 2);

        // Whatever the file asks for, the renderer must be able to draw it: either it declines
        // the preset outright, or the GX type it picks has a shader branch.
        const settings = PostEffect.getBFGFogSettings(rendererSide, i, SCENE_SCALE);
        if (settings === null) continue;
        withLiveFog++;
        expect(renderableCurves.has(settings.type & 0x07), `${path} preset ${i} type ${editorSide[i].fogType}`).toBe(true);
        expect(settings.endZ).toBeGreaterThan(settings.startZ);
        expect(Number.isFinite(settings.startZ)).toBe(true);
      }
    }

    // Guard against the whole suite quietly passing because nothing was inspected.
    expect(checked).toBeGreaterThan(0);
    expect(withLiveFog).toBeGreaterThan(0);
  }, 600000);
});
