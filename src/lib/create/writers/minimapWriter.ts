/**
 * `buildMinimapBrres`: the track outline the HUD draws as the minimap (`map_model.brres`).
 *
 * What the 32 retail files have in common, and what this writer reproduces:
 *  - one MDL0 called `map`, with three nodes: `map` (the root, owns the geometry) and its children
 *    `posLD` and `posRU`, whose translations are the world-space corners (left/down and right/up,
 *    seen from above with +X right and +Z down) of the area the minimap shows. The game places
 *    the kart icons with them;
 *  - positions are XYZ floats with a constant height; there are no normals and no texture
 *    coordinates, only one colour entry (white) and the material does the colouring;
 *  - the triangles are wound like every other game model (front face = cross product pointing
 *    away from the visible side), the visible side being up: `(b - a) x (c - a)` points *down*
 *    (-Y), with back-face culling in the material. Generators emit counter-clockwise top-down
 *    meshes, so the writer flips them;
 *  - only a `DrawOpa` list, no textures, no animations.
 *
 * The corner nodes enclose the outline with a margin and are made square (several retail tracks
 * do the same), so the icon mapping is not stretched whatever the HUD's aspect ratio is.
 */

import type { BuildMinimapBrres, GeneratedMesh, MinimapBuildInput } from '../types';
import { packBrres } from './brresPack';
import { buildMdl0, type Mdl0MaterialInput, type Mdl0Node, type Mdl0ShapeInput, type Mdl0VertexLayout } from './mdl0Builder';
import { ResourceRegistry, splitMesh, uniqueName } from './modelWriter';
import { loadSwatchMaterial } from './swatch';

/** Height of the outline (several retail flat maps use 1000). */
export const MINIMAP_HEIGHT = 1000;
/** Margin around the outline, as a fraction of its larger side, before squaring. */
export const MINIMAP_MARGIN = 0.12;
const MINIMAP_MIN_SIDE = 4000;

const MINIMAP_LAYOUT: Mdl0VertexLayout = { normals: false, texcoords: false, colorIndexBytes: 1 };

export const buildMinimapBrres: BuildMinimapBrres = (input: MinimapBuildInput): Uint8Array => {
  const registry = new ResourceRegistry();
  const swatch = loadSwatchMaterial(input.material);
  const samplers = swatch.samplers.map((sampler) => ({
    texture: sampler.texture ? registry.resolve('texture', swatch, sampler.texture) : '',
    palette: sampler.palette ? registry.resolve('palette', swatch, sampler.palette) : null,
  }));
  const block = swatch.block.slice();
  const blockView = new DataView(block.buffer);
  const flags = blockView.getUint32(0x10);
  blockView.setUint32(0x10, (input.material.translucent ? flags | 0x80000000 : flags & 0x7fffffff) >>> 0);
  const material: Mdl0MaterialInput = {
    name: swatch.materialName,
    block,
    tev: swatch.tev,
    samplerOffset: swatch.samplerOffset,
    dlOffset: swatch.dlOffset,
    samplers,
  };

  // Flatten, wind downwards, and measure.
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const flat: GeneratedMesh[] = input.meshes.map((mesh) => flattenMesh(mesh, bounds));

  const shapes: Mdl0ShapeInput[] = [];
  const names = new Set<string>();
  for (const mesh of flat) {
    let chunk = 0;
    for (const built of splitMesh(mesh, { normals: false, texcoords: false, winding: 'keep' })) {
      const base = chunk === 0 ? mesh.name : `${mesh.name}_${chunk}`;
      chunk++;
      const name = uniqueName(base || 'polygon', names);
      names.add(name);
      shapes.push({ ...built, name, materialIndex: 0, nodeIndex: 0, translucent: input.material.translucent });
    }
  }

  const empty = !Number.isFinite(bounds.minX);
  if (empty) Object.assign(bounds, { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 });
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const side = Math.max(MINIMAP_MIN_SIDE, Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * (1 + 2 * MINIMAP_MARGIN));
  const half = Math.round(side / 2);

  const nodes: Mdl0Node[] = [
    {
      name: 'map',
      parent: -1,
      translation: [0, 0, 0],
      boundsMin: empty ? [0, 0, 0] : [bounds.minX, MINIMAP_HEIGHT, bounds.minZ],
      boundsMax: empty ? [0, 0, 0] : [bounds.maxX, MINIMAP_HEIGHT, bounds.maxZ],
      hasGeometry: shapes.length > 0,
    },
    { name: 'posLD', parent: 0, translation: [Math.round(centerX) - half, 0, Math.round(centerZ) + half], boundsMin: [0, 0, 0], boundsMax: [0, 0, 0], hasGeometry: false },
    { name: 'posRU', parent: 0, translation: [Math.round(centerX) + half, 0, Math.round(centerZ) - half], boundsMin: [0, 0, 0], boundsMax: [0, 0, 0], hasGeometry: false },
  ];

  // One colour entry is the norm; fall back to 16-bit colour indices if the outline carries many.
  const layout: Mdl0VertexLayout = { ...MINIMAP_LAYOUT, colorIndexBytes: shapes.every((shape) => shape.colors.length <= 256) ? 1 : 2 };
  const mdl0 = buildMdl0({ name: 'map', nodes, materials: [material], shapes, layout, alwaysWriteTranslucentList: false });

  return packBrres({
    models: [{ name: 'map', magic: 'MDL0', data: mdl0.data, stringRefs: mdl0.stringRefs }],
    textures: registry.subFiles('texture'),
    palettes: registry.subFiles('palette'),
    patterns: [],
    scrolls: [],
  });
};

/** Copies `mesh` with a constant height and every triangle facing down, and grows `bounds`. */
function flattenMesh(mesh: GeneratedMesh, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): GeneratedMesh {
  const vertexCount = Math.floor(mesh.positions.length / 3);
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const x = mesh.positions[i * 3];
    const z = mesh.positions[i * 3 + 2];
    positions[i * 3] = x;
    positions[i * 3 + 1] = MINIMAP_HEIGHT;
    positions[i * 3 + 2] = z;
  }
  const indices = new Uint32Array(mesh.indices.length - (mesh.indices.length % 3));
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const a = mesh.indices[t];
    let b = mesh.indices[t + 1];
    let c = mesh.indices[t + 2];
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) {
      throw new Error(`Minimap mesh "${mesh.name}": triangle ${t / 3} references a vertex past the end of the arrays.`);
    }
    // (b - a) x (c - a), y component; negative = already facing down.
    const ny = (positions[b * 3 + 2] - positions[a * 3 + 2]) * (positions[c * 3] - positions[a * 3]) - (positions[b * 3] - positions[a * 3]) * (positions[c * 3 + 2] - positions[a * 3 + 2]);
    if (ny > 0) [b, c] = [c, b];
    indices[t] = a;
    indices[t + 1] = b;
    indices[t + 2] = c;
    for (const v of [a, b, c]) {
      bounds.minX = Math.min(bounds.minX, positions[v * 3]);
      bounds.maxX = Math.max(bounds.maxX, positions[v * 3]);
      bounds.minZ = Math.min(bounds.minZ, positions[v * 3 + 2]);
      bounds.maxZ = Math.max(bounds.maxZ, positions[v * 3 + 2]);
    }
  }
  return { ...mesh, positions, indices };
}
