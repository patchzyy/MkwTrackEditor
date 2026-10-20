/**
 * Baked lighting for generated meshes.
 *
 * Retail tracks bake their lighting into vertex colours and the kit's materials are
 * texture x vertex colour, so shading a generated surface means writing the right colour 0. Each
 * world has one directional "sun" plus a hemispheric ambient (sky above, bounce light below):
 *
 *   shade(n) = (ambient * hemi(n) + sun * max(0, n . L)) / (the same for a flat, up-facing surface)
 *
 * so flat ground comes out at exactly its world's `gain` (white for most worlds: the texture colour
 * stays true) and slopes that face away from the sun get darker, never below `floor`. The ratio is
 * taken per colour channel, so a world can tint its shadows (cool blue in the sun's warm world) or
 * dim and tint the whole scene (night, space). Rolling terrain is gentle (a 2000-unit hill over
 * 10000 units is a 12 degree slope), so terrain and horizon pass a `relief` factor that leans the
 * normal over before lighting; walls, roads and pieces use the true normal (`relief` 1).
 */
import type { CreateKit, KitSurface } from './types';

type Rgb = [number, number, number];

export interface WorldLight {
  /** Direction of the sun, degrees clockwise from north (-Z) seen from above, and above the horizon. */
  azimuth: number;
  elevation: number;
  /** Strength of the direct light relative to the ambient (1 = equal on a flat surface). */
  sun: number;
  /** Colour of the direct light and of the ambient (shadow) light; only their ratio matters. */
  sunTint: Rgb;
  ambientTint: Rgb;
  /** What a flat, sunlit surface multiplies the texture by (1,1,1 = unchanged). */
  gain: Rgb;
  /** Darkest a slope or wall may get, as a fraction of the flat value. */
  floor: number;
}

const WARM: Rgb = [1, 0.96, 0.88];
const COOL: Rgb = [0.9, 0.96, 1.08];
const WHITE: Rgb = [1, 1, 1];

/** Per-world sun. Directions face a little against the editor's default 3/4 view so slopes read. */
export const WORLD_LIGHTS: Record<string, WorldLight> = {
  sunny: { azimuth: 125, elevation: 46, sun: 1.15, sunTint: WARM, ambientTint: COOL, gain: WHITE, floor: 0.56 },
  garden: { azimuth: 120, elevation: 48, sun: 1.1, sunTint: WARM, ambientTint: COOL, gain: WHITE, floor: 0.58 },
  desert: { azimuth: 110, elevation: 58, sun: 1.3, sunTint: [1, 0.94, 0.82], ambientTint: [1, 0.93, 0.86], gain: [1, 0.99, 0.95], floor: 0.6 },
  beach: { azimuth: 130, elevation: 52, sun: 1.15, sunTint: WARM, ambientTint: [0.92, 0.97, 1.06], gain: WHITE, floor: 0.58 },
  snow: { azimuth: 140, elevation: 36, sun: 0.95, sunTint: [1, 0.98, 0.94], ambientTint: [0.82, 0.92, 1.12], gain: [0.98, 0.99, 1], floor: 0.6 },
  gorge: { azimuth: 115, elevation: 44, sun: 1.2, sunTint: [1, 0.97, 0.88], ambientTint: [0.9, 0.98, 1], gain: [0.97, 1, 0.97], floor: 0.54 },
  autumn: { azimuth: 135, elevation: 30, sun: 1.25, sunTint: [1, 0.9, 0.74], ambientTint: [0.96, 0.9, 0.98], gain: [1, 0.97, 0.92], floor: 0.56 },
  castle: { azimuth: 120, elevation: 40, sun: 1.0, sunTint: [1, 0.82, 0.7], ambientTint: [0.95, 0.85, 0.95], gain: [0.9, 0.85, 0.86], floor: 0.52 },
  night: { azimuth: 140, elevation: 38, sun: 0.8, sunTint: [0.8, 0.9, 1.15], ambientTint: [0.74, 0.86, 1.25], gain: [0.7, 0.78, 0.97], floor: 0.55 },
  space: { azimuth: 150, elevation: 32, sun: 0.95, sunTint: [1, 0.85, 1.15], ambientTint: [0.9, 0.78, 1.25], gain: [0.84, 0.74, 1], floor: 0.55 },
  factory: { azimuth: 120, elevation: 55, sun: 0.95, sunTint: [1, 0.98, 0.94], ambientTint: [0.95, 0.99, 1.05], gain: [0.97, 0.98, 1], floor: 0.58 },
};

const DEFAULT_LIGHT: WorldLight = WORLD_LIGHTS.sunny;

/** Ambient weight at a normal's height: a surface facing down still gets the bounce light. */
const hemi = (ny: number): number => 0.78 + 0.22 * ny;

export interface Shader {
  /** Writes the 0..1 light colour for a (not necessarily unit) normal into `out`. */
  shade(nx: number, ny: number, nz: number, out: Rgb): void;
}

export function createShader(light: WorldLight): Shader {
  const az = (light.azimuth * Math.PI) / 180;
  const el = (light.elevation * Math.PI) / 180;
  // Azimuth 0 = the sun is to the north (-Z); 90 = to the east (+X).
  const lx = Math.sin(az) * Math.cos(el);
  const lz = -Math.cos(az) * Math.cos(el);
  const ly = Math.sin(el);
  const amb: Rgb = [light.ambientTint[0], light.ambientTint[1], light.ambientTint[2]];
  const sun: Rgb = [light.sunTint[0] * light.sun, light.sunTint[1] * light.sun, light.sunTint[2] * light.sun];
  // Normalise so a flat, up-facing surface has exactly gain.
  const flat: Rgb = [amb[0] + sun[0] * ly, amb[1] + sun[1] * ly, amb[2] + sun[2] * ly];
  return {
    shade(nx, ny, nz, out) {
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const direct = Math.max(0, nx * lx + ny * ly + nz * lz);
      const h = hemi(ny);
      for (let c = 0; c < 3; c++) {
        const v = Math.min(1, Math.max(light.floor, (amb[c] * h + sun[c] * direct) / flat[c]));
        out[c] = v * light.gain[c];
      }
    },
  };
}

export function worldLight(themeId: string): WorldLight {
  return WORLD_LIGHTS[themeId] ?? DEFAULT_LIGHT;
}

/**
 * What a `MeshBuilder` needs to bake a world's light into the colours of a finished mesh. Surfaces that do
 * not read vertex colour (`usesVertexColor === false`: the sea, lava, boost arrows) are left as they are.
 */
export interface MeshLight {
  /** Multiplies the vertex colours (rgb, in place) by the light at each vertex normal. */
  bake(surfaceId: string, normals: Float32Array, colors: Uint8Array, count: number): void;
}

const shaders = new Map<string, Shader>();

function shaderFor(themeId: string): Shader {
  let shader = shaders.get(themeId);
  if (!shader) {
    shader = createShader(worldLight(themeId));
    shaders.set(themeId, shader);
  }
  return shader;
}

/**
 * `relief` leans the normal's horizontal part over before lighting (terrain and horizon use ~2.4) so
 * gentle hills read in the viewport; 1 is physically plain.
 */
export function createMeshLight(kit: CreateKit, themeId: string, relief = 1): MeshLight {
  const shader = shaderFor(themeId);
  const lit = new Map<string, boolean>();
  const reads = (surfaceId: string): boolean => {
    let v = lit.get(surfaceId);
    if (v === undefined) {
      const surface: KitSurface | null = kit.surface(surfaceId);
      v = !surface || surface.usesVertexColor !== false;
      lit.set(surfaceId, v);
    }
    return v;
  };
  const rgb: Rgb = [1, 1, 1];
  return {
    bake(surfaceId, normals, colors, count) {
      if (!reads(surfaceId)) return;
      for (let i = 0; i < count; i++) {
        shader.shade(normals[i * 3] * relief, normals[i * 3 + 1], normals[i * 3 + 2] * relief, rgb);
        const o = i * 4;
        colors[o] = Math.round(colors[o] * rgb[0]);
        colors[o + 1] = Math.round(colors[o + 1] * rgb[1]);
        colors[o + 2] = Math.round(colors[o + 2] * rgb[2]);
      }
    },
  };
}

export const TERRAIN_RELIEF = 2.6;
