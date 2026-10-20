/**
 * GX fog maths in the vendored renderer: the fog curve GLSL and the A/B/C terms that turn
 * window depth into a 0..1 fog distance. Course fog (`posteffect.bfg`) is drawn through both,
 * and Mario Kart Wii uses the "backwards exponential" curve (REVEXP) more than any other.
 */
import { beforeAll, describe, expect, it } from 'vitest';

/** `render.ts` pulls in noclip's `GlobalSaveManager`, which touches `window.localStorage`. */
function stubBrowserGlobals(): void {
  if ((globalThis as Record<string, unknown>).window !== undefined) return;
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      get length() {
        return store.size;
      },
      key: (index: number) => [...store.keys()][index] ?? null,
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  };
}

async function importVendor() {
  stubBrowserGlobals();
  const [GX, GX_Material, Render] = await Promise.all([
    // @ts-ignore vendored noclip source sits outside this app's tsconfig surface.
    import('../../vendor/noclip.website/src/gx/gx_enum.js'),
    // @ts-ignore vendored noclip source sits outside this app's tsconfig surface.
    import('../../vendor/noclip.website/src/gx/gx_material.js'),
    // @ts-ignore vendored noclip source sits outside this app's tsconfig surface.
    import('../../vendor/noclip.website/src/rres/render.js'),
  ]);
  return { GX, GX_Material, Render };
}

type Vendor = Awaited<ReturnType<typeof importVendor>>;
let vendor: Vendor;
// The first import of the vendored renderer is slow under a parallel full-suite run.
beforeAll(async () => {
  vendor = await importVendor();
}, 60_000);

/** Evaluates the generated GLSL curve in JS (it only uses `exp2` and arithmetic). */
function curveAt(glsl: string, z: number): number {
  return new Function('exp2', 'z', `return ${glsl};`)((x: number) => 2 ** x, z) as number;
}

describe('GX fog curves', () => {
  it('every curve is clear at startZ, (near) fully fogged at endZ, and never thins out with distance', () => {
    const { GX, GX_Material } = vendor;
    const types = [
      GX.FogType.PERSP_LIN, GX.FogType.PERSP_EXP, GX.FogType.PERSP_EXP2,
      GX.FogType.PERSP_REVEXP, GX.FogType.PERSP_REVEXP2,
      GX.FogType.ORTHO_LIN, GX.FogType.ORTHO_EXP, GX.FogType.ORTHO_EXP2,
      GX.FogType.ORTHO_REVEXP, GX.FogType.ORTHO_REVEXP2,
    ];
    for (const type of types) {
      const glsl: string = GX_Material.generateFogCurve(type, 'z');
      const label = `fog type 0x${type.toString(16)}`;
      expect(curveAt(glsl, 0), label).toBeLessThan(0.01);
      expect(curveAt(glsl, 1), label).toBeGreaterThan(0.99);
      let previous = -Infinity;
      for (let i = 0; i <= 20; i++) {
        const value = curveAt(glsl, i / 20);
        expect(value, `${label} at ${i / 20}`).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it('REVEXP matches the hardware (Dolphin) curve, not its mirror image', () => {
    const { GX, GX_Material } = vendor;
    const revexp: string = GX_Material.generateFogCurve(GX.FogType.PERSP_REVEXP, 'z');
    const revexp2: string = GX_Material.generateFogCurve(GX.FogType.PERSP_REVEXP2, 'z');
    for (const z of [0, 0.25, 0.5, 0.9, 1]) {
      expect(curveAt(revexp, z)).toBeCloseTo(2 ** (-8 * (1 - z)), 9);
      expect(curveAt(revexp2, z)).toBeCloseTo(2 ** (-8 * (1 - z) * (1 - z)), 9);
    }
  });
});

describe('fog block terms', () => {
  /** Reproduces the shader: base = A / (B - z) with z = 1 - gl_FragCoord.z (reversed depth). */
  function fogDistance(block: { A: number; B: number; C: number }, windowZ: number): number {
    const z = 1 - windowZ;
    const base = block.B !== 0 ? block.A / (block.B - z) : block.A * z;
    return Math.min(1, Math.max(0, base - block.C));
  }

  it('maps startZ to 0 and endZ to 1 for the viewer\'s infinite reversed-depth perspective', () => {
    const { GX, GX_Material, Render } = vendor;
    const near = 5;
    const camera = { near, far: Infinity, isOrthographic: false };
    // Luigi Circuit's preset 0, at the MKWii scene's 0.1 scale.
    const fog = { type: GX.FogType.PERSP_REVEXP, startZ: 11000, endZ: 50000, color: { r: 0, g: 0, b: 0, a: 1 } };
    const block = new GX_Material.FogBlock();
    Render.fillFogBlockParams(block, fog, camera);
    // An infinite reversed projection writes near / d into the depth buffer.
    const windowZAt = (d: number) => near / d;
    expect(fogDistance(block, windowZAt(1000))).toBe(0);
    expect(fogDistance(block, windowZAt(11000))).toBeCloseTo(0, 4);
    expect(fogDistance(block, windowZAt(30500))).toBeCloseTo(0.5, 4);
    expect(fogDistance(block, windowZAt(50000))).toBeCloseTo(1, 4);
  });

  it('turns fog off in orthographic views, which have no meaningful eye distance', () => {
    const { GX, GX_Material, Render } = vendor;
    const camera = { near: -500000, far: 500000, isOrthographic: true };
    const fog = { type: GX.FogType.PERSP_REVEXP, startZ: 11000, endZ: 50000, color: { r: 0, g: 0, b: 0, a: 1 } };
    const block = new GX_Material.FogBlock();
    Render.fillFogBlockParams(block, fog, camera);
    for (const windowZ of [0, 0.25, 0.5, 0.75, 1])
      expect(fogDistance(block, windowZ)).toBe(0);
  });
});
