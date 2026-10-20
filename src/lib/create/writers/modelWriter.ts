/**
 * `buildModelBrres`: turns generated triangle meshes plus swatch materials into a complete
 * `.brres` (MDL0 v11 + TEX0/PLT0 [+ SRT0/PAT0]) that the real game and the noclip renderer load.
 *
 * Conventions (all taken from the retail `course_model.brres` files):
 *  - one root node, identity; `NodeTree` / `DrawOpa` / `DrawXlu` bytecode;
 *  - per mesh one shape with its own position / normal / colour0 / texcoord0 arrays, float
 *    positions, normals and texcoords, RGBA8 colour, and a GX_TRIANGLES list over 16-bit indices;
 *  - meshes with more than 65535 distinct vertices are split into several shapes;
 *  - materials and TEV blocks are copied raw out of the swatch, with names / offsets relocated.
 *
 * Winding: the game's front face is the one where `(b - a) x (c - a)` points *away* from the normal
 * side (retail course models are wound that way). The writer therefore flips each input triangle
 * whose cross product agrees with its vertex normals, so generators can use the usual
 * counter-clockwise-is-front convention (normal = (b - a) x (c - a)) -- the same one `buildKcl` uses.
 */

import type { BrresRaw, BrresSubFileRaw } from '../../brres/brresRaw';
import type { BuildModelBrres, GeneratedMesh, MaterialSource, ModelBuildInput } from '../types';
import { buildMdl0, type Mdl0MaterialInput, type Mdl0Node, type Mdl0ShapeInput } from './mdl0Builder';
import { packBrres, type NewSubFile } from './brresPack';
import { collectSwatchAnimations } from './animations';
import { findSwatchPalette, findSwatchTexture, loadSwatchMaterial, type SwatchMaterial } from './swatch';
import { TuplePool } from './tuplePool';

/** Distinct vertices a shape may reference (array counts are u16 and indices stop at 0xfffe). */
export const MAX_SHAPE_VERTICES = 65535;
/**
 * Display-list vertices per shape. noclip expands a shape's draws into one u16-indexed vertex
 * buffer, so a shape with more than 65535 display-list vertices (3 per triangle) wraps its indices
 * and draws garbage / only part of itself. 65535 is divisible by 3.
 */
export const MAX_SHAPE_CORNERS = 65535;

export const buildModelBrres: BuildModelBrres = (input: ModelBuildInput): Uint8Array => {
  const materialBySurface = new Map<string, MaterialSource>();
  for (const material of input.materials) if (!materialBySurface.has(material.surfaceId)) materialBySurface.set(material.surfaceId, material);

  // --- shapes ----------------------------------------------------------------------------------
  const registry = new ResourceRegistry();
  const swatchBySurface = new Map<string, MaterialInstance>();
  const instances: MaterialInstance[] = [];
  const materialNames = new Set<string>();

  const instanceFor = (surfaceId: string): MaterialInstance => {
    const cached = swatchBySurface.get(surfaceId);
    if (cached) return cached;
    const source = materialBySurface.get(surfaceId);
    if (!source) throw new Error(`Mesh uses surface "${surfaceId}" but no MaterialSource was given for it.`);
    const swatch = loadSwatchMaterial(source);
    const samplers = swatch.samplers.map((sampler) => ({
      texture: sampler.texture ? registry.resolve('texture', swatch, sampler.texture) : '',
      palette: sampler.palette ? registry.resolve('palette', swatch, sampler.palette) : null,
    }));
    // The same material (same name, same bytes, same textures) reached through two surfaces is one material.
    const fingerprint = `${materialFingerprint(swatch, samplers)}|${source.translucent ? 'xlu' : 'opa'}`;
    const existing = instances.find((candidate) => candidate.fingerprint === fingerprint);
    if (existing) {
      swatchBySurface.set(surfaceId, existing);
      return existing;
    }
    // Retail keeps the material's "translucent" flag (bit 31 of +0x10) in step with the draw list it is in.
    const block = swatch.block.slice();
    const blockView = new DataView(block.buffer);
    const flags = blockView.getUint32(0x10);
    blockView.setUint32(0x10, (source.translucent ? flags | 0x80000000 : flags & 0x7fffffff) >>> 0);
    const instance: MaterialInstance = {
      index: instances.length,
      fingerprint,
      swatch,
      block,
      name: uniqueName(swatch.materialName, materialNames),
      samplers,
    };
    materialNames.add(instance.name);
    instances.push(instance);
    swatchBySurface.set(surfaceId, instance);
    return instance;
  };

  const shapes: Mdl0ShapeInput[] = [];
  const shapeNames = new Set<string>();
  for (const mesh of input.meshes) {
    const material = instanceFor(mesh.surfaceId);
    const translucent = materialBySurface.get(mesh.surfaceId)!.translucent;
    let chunk = 0;
    for (const built of splitMesh(mesh)) {
      const base = chunk === 0 ? mesh.name : `${mesh.name}_${chunk}`;
      chunk++;
      const name = uniqueName(base || 'shape', shapeNames);
      shapeNames.add(name);
      shapes.push({ ...built, name, materialIndex: material.index, nodeIndex: 0, translucent });
    }
  }

  // --- MDL0 ------------------------------------------------------------------------------------
  const bounds = shapeBounds(shapes);
  const root: Mdl0Node = {
    name: input.modelName,
    parent: -1,
    translation: [0, 0, 0],
    boundsMin: bounds.min,
    boundsMax: bounds.max,
    hasGeometry: shapes.length > 0,
  };
  const materials: Mdl0MaterialInput[] = instances.map((instance) => ({
    name: instance.name,
    block: instance.block,
    tev: instance.swatch.tev,
    samplerOffset: instance.swatch.samplerOffset,
    dlOffset: instance.swatch.dlOffset,
    samplers: instance.samplers,
  }));
  const mdl0 = buildMdl0({ name: input.modelName, nodes: [root], materials, shapes });

  // --- animations ------------------------------------------------------------------------------
  const animations = input.copyAnimations
    ? collectSwatchAnimations(
        instances.map((instance) => ({ archive: instance.swatch.archive, sourceMaterial: instance.swatch.materialName, material: instance.name })),
        input.modelName,
        (archive, kind, name) => registry.resolveInArchive(kind, archive, name),
      )
    : { patterns: [], scrolls: [] };

  // --- textures / palettes ---------------------------------------------------------------------
  const textures = registry.subFiles('texture');
  const palettes = registry.subFiles('palette');

  return packBrres({
    models: [{ name: input.modelName, magic: 'MDL0', data: mdl0.data, stringRefs: mdl0.stringRefs }],
    textures,
    palettes,
    patterns: animations.patterns,
    scrolls: animations.scrolls,
  });
};

// ---------------------------------------------------------------------------------------------
// Materials and shared resources
// ---------------------------------------------------------------------------------------------

interface MaterialInstance {
  index: number;
  fingerprint: string;
  swatch: SwatchMaterial;
  /** The material block with the translucency flag set to match its draw list. */
  block: Uint8Array;
  name: string;
  samplers: Array<{ texture: string; palette: string | null }>;
}

function materialFingerprint(swatch: SwatchMaterial, samplers: Array<{ texture: string; palette: string | null }>): string {
  // Identical bytes apart from the fields that depend on where the block lives.
  let hash = 0x811c9dc5;
  const feed = (bytes: Uint8Array, skip: ReadonlyArray<[number, number]>): void => {
    for (let i = 0; i < bytes.length; i++) {
      if (skip.some(([from, to]) => i >= from && i < to)) continue;
      hash = Math.imul(hash ^ bytes[i], 0x01000193);
    }
  };
  const samplerSkips: Array<[number, number]> = [[0x04, 0x0c], [0x28, 0x2c]];
  swatch.samplers.forEach((_sampler, i) => {
    const at = swatch.samplerOffset + i * 0x34;
    samplerSkips.push([at, at + 8]);
  });
  feed(swatch.block, samplerSkips);
  feed(swatch.tev, [[0x04, 0x0c]]);
  return `${swatch.materialName}|${(hash >>> 0).toString(16)}|${swatch.block.length}|${samplers.map((s) => `${s.texture}/${s.palette ?? ''}`).join(',')}`;
}

export function uniqueName(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  for (let i = 1; ; i++) {
    const candidate = `${base}_${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

type ResourceKind = 'texture' | 'palette';

/**
 * The textures and palettes that end up in the output. A name that two swatches share is the same
 * resource only if the pixels agree; otherwise the later one is renamed (and every reference to it
 * is rewritten through `resolve`).
 */
export class ResourceRegistry {
  private readonly entries: Record<ResourceKind, Map<string, { hash: string; subFile: BrresSubFileRaw }>> = {
    texture: new Map(),
    palette: new Map(),
  };
  private readonly resolved = new Map<BrresRaw, Record<ResourceKind, Map<string, string>>>();

  resolve(kind: ResourceKind, swatch: SwatchMaterial, name: string): string {
    return this.resolveInArchive(kind, swatch.archive, name);
  }

  resolveInArchive(kind: ResourceKind, archive: BrresRaw, name: string): string {
    let perArchive = this.resolved.get(archive);
    if (!perArchive) {
      perArchive = { texture: new Map(), palette: new Map() };
      this.resolved.set(archive, perArchive);
    }
    const known = perArchive[kind].get(name);
    if (known !== undefined) return known;

    const subFile = kind === 'texture' ? findSwatchTexture(archive, name) : findSwatchPalette(archive, name);
    if (!subFile) {
      // The swatch does not carry it; leave the reference as it is.
      perArchive[kind].set(name, name);
      return name;
    }
    const hash = resourceHash(subFile.data);
    const table = this.entries[kind];
    let candidate = name;
    for (let n = 1; ; n++) {
      const present = table.get(candidate);
      if (!present) {
        table.set(candidate, { hash, subFile });
        break;
      }
      if (present.hash === hash) break;
      candidate = `${name}_${n}`;
    }
    perArchive[kind].set(name, candidate);
    return candidate;
  }

  subFiles(kind: ResourceKind): NewSubFile[] {
    const magic = kind === 'texture' ? 'TEX0' : 'PLT0';
    return [...this.entries[kind]].map(([name, entry]) => ({
      name,
      magic,
      data: entry.subFile.data,
      // A TEX0 / PLT0 has exactly one outbound pointer: its name, at +0x14.
      stringRefs: [{ offset: 0x14, value: name }],
    }));
  }
}

/** Hash of a TEX0 / PLT0 ignoring the fields that depend on where it sits in its archive. */
function resourceHash(data: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    if ((i >= 0x0c && i < 0x10) || (i >= 0x14 && i < 0x18)) continue;
    hash = Math.imul(hash ^ data[i], 0x01000193);
  }
  return `${data.length}:${(hash >>> 0).toString(16)}`;
}

// ---------------------------------------------------------------------------------------------
// Mesh -> shape arrays
// ---------------------------------------------------------------------------------------------

type BuiltShape = Omit<Mdl0ShapeInput, 'name' | 'materialIndex' | 'nodeIndex' | 'translucent'>;

/**
 * Splits `mesh` into shapes of at most `MAX_SHAPE_VERTICES` distinct vertices and `MAX_SHAPE_CORNERS` triangle corners, deduplicating each
 * vertex attribute into its own array like retail does.
 */
export interface SplitOptions {
  /** Store normals / texcoords (the arrays are skipped when false). */
  normals: boolean;
  texcoords: boolean;
  /**
   * How to wind each triangle. `normals` (default): the visible side is the one the vertex normals
   * point to. `up`: the visible side is +Y (flat top-down meshes). `keep`: leave the order alone.
   */
  winding: 'normals' | 'up' | 'keep';
}

export const DEFAULT_SPLIT_OPTIONS: SplitOptions = { normals: true, texcoords: true, winding: 'normals' };

export function* splitMesh(mesh: GeneratedMesh, options: Partial<SplitOptions> = {}): Generator<BuiltShape> {
  const attributes = { ...DEFAULT_SPLIT_OPTIONS, ...options };
  const vertexCount = Math.floor(mesh.positions.length / 3);
  const triangleCount = Math.floor(mesh.indices.length / 3);
  if (triangleCount === 0) return;

  const positions = asWords(mesh.positions);
  const normals = mesh.normals.length >= vertexCount * 3 ? asWords(mesh.normals) : null;
  const uvs = mesh.uvs.length >= vertexCount * 2 ? asWords(mesh.uvs) : null;
  const colors = mesh.colors.length >= vertexCount * 4 ? mesh.colors : null;

  const stamp = new Int32Array(vertexCount).fill(-1);
  const local = new Int32Array(vertexCount);
  let chunkId = 0;
  let chunkVertices: number[] = [];
  let chunkTriangles: number[] = [];

  const scratch3 = new Uint32Array(3);
  const scratch2 = new Uint32Array(2);
  const scratch1 = new Uint32Array(1);
  const upNormal = new Float32Array([0, 1, 0]);
  const upNormalWords = asWords(upNormal);

  const flush = (): BuiltShape => {
    const positionPool = new TuplePool(3, chunkVertices.length);
    const normalPool = new TuplePool(3, 16);
    const colorPool = new TuplePool(1, 16);
    const texcoordPool = new TuplePool(2, chunkVertices.length);
    const vertexPosition = new Uint16Array(chunkVertices.length);
    const vertexNormal = new Uint16Array(chunkVertices.length);
    const vertexColor = new Uint16Array(chunkVertices.length);
    const vertexTexcoord = new Uint16Array(chunkVertices.length);
    chunkVertices.forEach((source, i) => {
      vertexPosition[i] = positionPool.add(positions, source * 3);
      if (!attributes.normals) {
        // not stored
      } else if (normals) {
        scratch3[0] = normals[source * 3];
        scratch3[1] = normals[source * 3 + 1];
        scratch3[2] = normals[source * 3 + 2];
        vertexNormal[i] = normalPool.add(scratch3, 0);
      } else {
        vertexNormal[i] = normalPool.add(upNormalWords, 0);
      }
      if (colors) {
        scratch1[0] = ((colors[source * 4] << 24) | (colors[source * 4 + 1] << 16) | (colors[source * 4 + 2] << 8) | colors[source * 4 + 3]) >>> 0;
      } else {
        scratch1[0] = 0xffffffff;
      }
      vertexColor[i] = colorPool.add(scratch1, 0);
      if (!attributes.texcoords) return;
      if (uvs) {
        scratch2[0] = uvs[source * 2];
        scratch2[1] = uvs[source * 2 + 1];
      } else {
        scratch2[0] = 0;
        scratch2[1] = 0;
      }
      vertexTexcoord[i] = texcoordPool.add(scratch2, 0);
    });
    const corners = chunkTriangles.length;
    const shape: BuiltShape = {
      positions: positionPool.words.slice(0, positionPool.count * 3),
      normals: normalPool.words.slice(0, normalPool.count * 3),
      colors: colorPool.words.slice(0, colorPool.count),
      texcoords: texcoordPool.words.slice(0, texcoordPool.count * 2),
      cornerPosition: new Uint16Array(corners),
      cornerNormal: new Uint16Array(corners),
      cornerColor: new Uint16Array(corners),
      cornerTexcoord: new Uint16Array(corners),
      triangleCount: corners / 3,
    };
    for (let c = 0; c < corners; c++) {
      const v = chunkTriangles[c];
      shape.cornerPosition[c] = vertexPosition[v];
      shape.cornerNormal[c] = vertexNormal[v];
      shape.cornerColor[c] = vertexColor[v];
      shape.cornerTexcoord[c] = vertexTexcoord[v];
    }
    chunkId++;
    chunkVertices = [];
    chunkTriangles = [];
    return shape;
  };

  for (let t = 0; t < triangleCount; t++) {
    const a = mesh.indices[t * 3];
    let b = mesh.indices[t * 3 + 1];
    let c = mesh.indices[t * 3 + 2];
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) {
      throw new Error(`Mesh "${mesh.name}": triangle ${t} references a vertex past the end of the arrays.`);
    }
    if (attributes.winding !== 'keep' && windingNeedsFlip(mesh, a, b, c, attributes.winding === 'normals' && normals !== null)) [b, c] = [c, b];
    let needed = 0;
    if (stamp[a] !== chunkId) needed++;
    if (stamp[b] !== chunkId && b !== a) needed++;
    if (stamp[c] !== chunkId && c !== a && c !== b) needed++;
    if (chunkVertices.length + needed > MAX_SHAPE_VERTICES || chunkTriangles.length >= MAX_SHAPE_CORNERS) yield flush();
    for (const vertex of [a, b, c]) {
      if (stamp[vertex] !== chunkId) {
        stamp[vertex] = chunkId;
        local[vertex] = chunkVertices.length;
        chunkVertices.push(vertex);
      }
      chunkTriangles.push(local[vertex]);
    }
  }
  if (chunkTriangles.length > 0) yield flush();
}

/**
 * The game draws the side of a triangle on which the vertices run *clockwise* in the right-handed
 * sense, i.e. the front face is the one where `(b - a) x (c - a)` points away from the normal side
 * (measured on retail course models: every lit road triangle has its cross product opposite to its
 * vertex normals). Generators wind triangles counter-clockwise, normal = cross product, so this
 * flips whichever triangles need it to put the visible side where the normals are.
 */
function windingNeedsFlip(mesh: GeneratedMesh, a: number, b: number, c: number, useNormals: boolean): boolean {
  const p = mesh.positions;
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  let dot: number;
  if (useNormals) {
    const n = mesh.normals;
    dot = cx * (n[a * 3] + n[b * 3] + n[c * 3]) + cy * (n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1]) + cz * (n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2]);
  } else {
    dot = cy;
  }
  return dot > 0;
}

function asWords(source: Float32Array): Uint32Array {
  return new Uint32Array(source.buffer, source.byteOffset, source.length);
}

function shapeBounds(shapes: readonly Mdl0ShapeInput[]): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const scratch = new Float32Array(1);
  const bits = new Uint32Array(scratch.buffer);
  for (const shape of shapes) {
    for (let i = 0; i < shape.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        bits[0] = shape.positions[i + axis];
        const value = scratch[0];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}
