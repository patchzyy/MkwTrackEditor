import { describe, expect, it } from 'vitest';
import { BRRES_MODELS_GROUP, BRRES_TEXTURES_GROUP, findSubFile, makeSubFileNameReader, readBrresRaw } from '../../brres/brresRaw';
import { createIdentityMeshTransform, type MeshEdit } from '../../brresEditor';
import { bakeCourseModel } from '../../brres/bakeCourseModel';
import { drawOpsOf, parseWithNoclip } from '../../brres/brresFixtures.testdata';
import { Mdl0Editor, type Mdl0DicKey } from '../../brres/mdl0Raw';
import { GX_ATTR } from '../../brres/gxVertex';
import { lookupResDicIndex, readResDic } from '../../brres/resDic';
import type { GeneratedMesh } from '../types';
import { buildModelBrres, splitMesh } from './modelWriter';
import {
  commonMaterial,
  decodeModel,
  gridMesh,
  hasRetailExtract,
  quadMesh,
  retailCourseModel,
  retailMaterial,
  type DecodedShape,
} from './writerFixtures.testdata';

const kinoko = () => commonMaterial('kinoko.brres', 'kinoko', 'kinoko', 'kinoko');

/**
 * The game's front face is the one whose cross product points away from the vertex normals, so the
 * writer flips every input triangle whose cross product agrees with them.
 */
function expectedVertex(mesh: GeneratedMesh, corner: number): number {
  const t = Math.floor(corner / 3);
  const [ia, ib, ic] = [mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]];
  const p = mesh.positions;
  const ux = p[ib * 3] - p[ia * 3], uy = p[ib * 3 + 1] - p[ia * 3 + 1], uz = p[ib * 3 + 2] - p[ia * 3 + 2];
  const vx = p[ic * 3] - p[ia * 3], vy = p[ic * 3 + 1] - p[ia * 3 + 1], vz = p[ic * 3 + 2] - p[ia * 3 + 2];
  const cross = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const n = [0, 1, 2].map((k) => mesh.normals[ia * 3 + k] + mesh.normals[ib * 3 + k] + mesh.normals[ic * 3 + k]);
  const flip = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] > 0;
  const order = flip ? [0, 2, 1] : [0, 1, 2];
  return mesh.indices[t * 3 + order[corner % 3]];
}

function expectTrianglesMatch(shapes: DecodedShape[], mesh: GeneratedMesh): void {
  const corners = shapes.flatMap((shape) => shape.corners);
  expect(corners.length).toBe(mesh.indices.length);
  let mismatches = 0;
  let wrongSide = 0;
  for (let i = 0; i < mesh.indices.length; i++) {
    const v = expectedVertex(mesh, i);
    const c = corners[i];
    const same =
      c.position[0] === mesh.positions[v * 3] && c.position[1] === mesh.positions[v * 3 + 1] && c.position[2] === mesh.positions[v * 3 + 2] &&
      c.normal[0] === mesh.normals[v * 3] && c.normal[1] === mesh.normals[v * 3 + 1] && c.normal[2] === mesh.normals[v * 3 + 2] &&
      c.uv[0] === mesh.uvs[v * 2] && c.uv[1] === mesh.uvs[v * 2 + 1] &&
      c.color[0] === mesh.colors[v * 4] && c.color[1] === mesh.colors[v * 4 + 1] && c.color[2] === mesh.colors[v * 4 + 2] && c.color[3] === mesh.colors[v * 4 + 3];
    if (!same) mismatches++;
  }
  // Retail convention: cross product opposes the vertex normals on every written triangle.
  for (let t = 0; t < corners.length; t += 3) {
    const [p, q, r] = [corners[t], corners[t + 1], corners[t + 2]];
    const ux = q.position[0] - p.position[0], uy = q.position[1] - p.position[1], uz = q.position[2] - p.position[2];
    const vx = r.position[0] - p.position[0], vy = r.position[1] - p.position[1], vz = r.position[2] - p.position[2];
    const cross = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const n = [0, 1, 2].map((k) => p.normal[k] + q.normal[k] + r.normal[k]);
    if (cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] > 1e-6) wrongSide++;
  }
  expect(mismatches).toBe(0);
  expect(wrongSide).toBe(0);
}

/** Every resource dictionary in the archive and in the MDL0 must resolve each of its own names. */
function expectDictionariesResolve(brres: Uint8Array): void {
  const raw = readBrresRaw(brres);
  const check = (file: Uint8Array, tableOffset: number, readName: (offset: number) => string, label: string): void => {
    const dic = readResDic(file, tableOffset, readName);
    expect(dic, label).not.toBeNull();
    const names = dic!.entries.map((entry) => entry.name);
    const nodes = [dic!.root, ...dic!.entries];
    for (const name of names) expect(lookupResDicIndex(nodes, names, name), `${label}:${name}`).toBeGreaterThan(0);
    expect(new Set(names).size, `${label} names unique`).toBe(names.length);
  };
  // Archive: root dictionary + one per group.
  const view = new DataView(brres.buffer, brres.byteOffset, brres.byteLength);
  const rootOffset = view.getUint16(0x0c);
  check(brres, rootOffset + 8, (offset) => readCString(brres, offset), 'root');
  for (const group of raw.groups) {
    const rootDic = readResDic(brres, rootOffset + 8, (offset) => readCString(brres, offset))!;
    const entry = rootDic.entries.find((candidate) => candidate.name === group.name)!;
    check(brres, entry.dataOffset, (offset) => readCString(brres, offset), group.name);
  }
  // Model dictionaries.
  const models = raw.groups.find((group) => group.name === BRRES_MODELS_GROUP)!.entries;
  for (const subFile of models) {
    const editor = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile));
    const keys: Mdl0DicKey[] = ['byteCode', 'node', 'vtxPos', 'vtxNrm', 'vtxClr', 'vtxTxc', 'material', 'tev', 'shape', 'texture', 'palette'];
    for (const key of keys) {
      const dic = editor.getDic(key);
      if (dic) check(subFile.data, dic.tableOffset, makeSubFileNameReader(raw, subFile), `${subFile.name}.${key}`);
    }
  }
}

function readCString(data: Uint8Array, offset: number): string {
  let end = offset;
  while (end < data.length && data[end] !== 0) end++;
  return new TextDecoder().decode(data.subarray(offset, end));
}

/**
 * Alignment the console needs: display lists are read through GXCallDisplayList (32-byte aligned
 * addresses), vertex arrays through the CP (32-byte aligned bases). Everything is measured from
 * the start of the archive, which is itself loaded 32-byte aligned.
 */
function expectGxAlignment(brres: Uint8Array): void {
  const raw = readBrresRaw(brres);
  const subFile = raw.groups.find((group) => group.name === BRRES_MODELS_GROUP)!.entries[0];
  const editor = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile));
  const base = subFile.sourceOffset;
  expect(base % 32).toBe(0);
  const view = new DataView(editor.data.buffer, editor.data.byteOffset, editor.data.byteLength);
  for (const shape of editor.listShapes()) {
    expect((base + shape.offset) % 32, `shape ${shape.name}`).toBe(0);
    expect((base + shape.prePrimOffset) % 32).toBe(0);
    expect((base + shape.primOffset) % 32).toBe(0);
    expect(shape.prePrimSize % 32).toBe(0);
    expect(shape.primSize % 32).toBe(0);
    expect(shape.size).toBe(shape.primOffset - shape.offset + shape.primSize);
  }
  for (const kind of ['vtxPos', 'vtxNrm', 'vtxClr', 'vtxTxc'] as const) {
    for (const array of editor.listVertexArrays(kind)) {
      expect((base + array.blockOffset) % 32, `${kind} ${array.name}`).toBe(0);
      expect((base + array.dataOffset) % 32).toBe(0);
      expect(array.blockSize % 32).toBe(0);
    }
  }
  for (const material of editor.listMaterials()) {
    const dlOffset = view.getUint32(material.offset + 0x3c);
    expect((base + material.offset + dlOffset) % 32, `material ${material.name} display lists`).toBe(0);
  }
  for (const entry of editor.getDic('tev')?.entries ?? []) {
    expect((base + entry.offset) % 32).toBe(0);
    expect(view.getUint32(entry.offset)).toBe(0x200);
  }
  // Back pointers.
  for (const key of ['node', 'material', 'tev', 'shape', 'vtxPos', 'vtxNrm', 'vtxClr', 'vtxTxc'] as const) {
    for (const entry of editor.getDic(key)?.entries ?? []) expect(view.getInt32(entry.offset + 4), `${key} back pointer`).toBe(-entry.offset);
  }
  expect(view.getUint32(4)).toBe(editor.data.length);
}

describe('buildModelBrres', () => {
  it('builds a textured quad that the vendored noclip parser reads', async () => {
    const mesh = quadMesh('kinoko');
    const brres = buildModelBrres({ modelName: 'course', meshes: [mesh], materials: [kinoko()], copyAnimations: true });

    const decoded = decodeModel(brres);
    expect(decoded.name).toBe('course');
    expect(decoded.materialNames).toEqual(['kinoko']);
    expect(decoded.shapes).toHaveLength(1);
    expect(decoded.shapes[0].name).toBe('quad');
    expect(decoded.shapes[0].triangleCount).toBe(2);
    expect(decoded.shapes[0].vertexCount).toBe(6);
    expect(decoded.shapes[0].materialName).toBe('kinoko');
    expect(decoded.textureNames.length).toBeGreaterThan(0);
    expectTrianglesMatch(decoded.shapes, mesh);

    const parsed = await parseWithNoclip(brres);
    expect(parsed.mdl0).toHaveLength(1);
    const model = parsed.mdl0[0];
    expect(model.name).toBe('course');
    expect(model.materials.map((m: { name: string }) => m.name)).toEqual(['kinoko']);
    expect(model.shapes).toHaveLength(1);
    expect(model.shapes[0].loadedVertexData.totalVertexCount).toBe(6);
    expect(model.sceneGraph.drawOpaOps).toHaveLength(1);
    expect(model.sceneGraph.drawXluOps).toHaveLength(0);
    // Textures the material samples must be in the archive.
    const textureNames = parsed.tex0.map((t: { name: string }) => t.name);
    for (const sampler of model.materials[0].samplers) if (sampler) expect(textureNames).toContain(sampler.name);

    expectDictionariesResolve(brres);
    expectGxAlignment(brres);
  });

  it('writes correct counts, node bounds and model extents', () => {
    const mesh = quadMesh('kinoko', 'q', 250, 40);
    const brres = buildModelBrres({ modelName: 'course', meshes: [mesh], materials: [kinoko()], copyAnimations: false });
    const raw = readBrresRaw(brres);
    const subFile = raw.groups[0].entries[0];
    const view = new DataView(subFile.data.buffer, subFile.data.byteOffset);
    const info = 0x4c;
    expect(view.getUint32(info + 0x10)).toBe(6); // vertices
    expect(view.getUint32(info + 0x14)).toBe(2); // faces
    expect([0x28, 0x2c, 0x30, 0x34, 0x38, 0x3c].map((o) => view.getFloat32(info + o))).toEqual([0, 40, 0, 250, 40, 250]);
    const node = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile)).listNodes()[0];
    const nodeView = new DataView(subFile.data.buffer, subFile.data.byteOffset + node.offset);
    expect([0x44, 0x48, 0x4c, 0x50, 0x54, 0x58].map((o) => nodeView.getFloat32(o))).toEqual([0, 40, 0, 250, 40, 250]);
    // The shape's position array carries its own min / max.
    const editor = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile));
    const array = editor.getVertexArray('vtxPos', 0)!;
    const arrayView = new DataView(subFile.data.buffer, subFile.data.byteOffset + array.blockOffset);
    expect([0x20, 0x24, 0x28, 0x2c, 0x30, 0x34].map((o) => arrayView.getFloat32(o))).toEqual([0, 40, 0, 250, 40, 250]);
  });

  it('splits a 70k-vertex mesh into shapes of at most 65535 vertices and loses no triangle', async () => {
    const mesh = gridMesh('kinoko', 264, 264, 10, 'terrain');
    expect(mesh.positions.length / 3).toBeGreaterThan(65535);
    const started = performance.now();
    const brres = buildModelBrres({ modelName: 'terrain_model', meshes: [mesh], materials: [kinoko()], copyAnimations: false });
    expect(performance.now() - started).toBeLessThan(3000);

    const decoded = decodeModel(brres);
    expect(decoded.shapes.length).toBeGreaterThanOrEqual(2);
    expect(decoded.shapes.map((shape) => shape.name)).toEqual(decoded.shapes.map((_s, i) => (i === 0 ? 'terrain' : `terrain_${i}`)));
    for (const shape of decoded.shapes) expect(shape.positionArrayCount).toBeLessThanOrEqual(65535);
    expect(decoded.shapes.reduce((sum, shape) => sum + shape.triangleCount, 0)).toBe(264 * 264 * 2);
    expectTrianglesMatch(decoded.shapes, mesh);

    const parsed = await parseWithNoclip(brres);
    const total = parsed.mdl0[0].shapes.reduce((sum: number, shape: { loadedVertexData: { totalVertexCount: number } }) => sum + shape.loadedVertexData.totalVertexCount, 0);
    expect(total).toBe(mesh.indices.length);
    expectGxAlignment(brres);
    expectDictionariesResolve(brres);
  });

  it('keeps every triangle of an 80k-triangle mesh: no shape exceeds 16-bit vertex indexing', async () => {
    const mesh = gridMesh('kinoko', 200, 200, 10, 'terrain'); // 80,000 triangles, 40,401 vertices
    expect(mesh.indices.length / 3).toBe(80000);
    const brres = buildModelBrres({ modelName: 'big', meshes: [mesh], materials: [kinoko()], copyAnimations: false });

    const decoded = decodeModel(brres);
    expect(decoded.shapes.length).toBeGreaterThanOrEqual(4);
    for (const shape of decoded.shapes) expect(shape.vertexCount).toBeLessThanOrEqual(65535);
    expect(decoded.shapes.reduce((sum, shape) => sum + shape.triangleCount, 0)).toBe(80000);
    expectTrianglesMatch(decoded.shapes, mesh);

    // noclip expands each shape into one buffer with 16-bit indices; they must not wrap.
    const parsed = await parseWithNoclip(brres);
    let triangles = 0;
    for (const shape of parsed.mdl0[0].shapes) {
      const data = shape.loadedVertexData;
      expect(data.totalVertexCount).toBeLessThanOrEqual(65535);
      const indices = new Uint16Array(data.indexData);
      expect(data.totalIndexCount).toBe(data.totalVertexCount);
      let wrapped = 0;
      for (let i = 0; i < data.totalIndexCount; i++) if (indices[i] !== i) wrapped++;
      expect(wrapped).toBe(0);
      triangles += data.totalIndexCount / 3;
    }
    expect(triangles).toBe(80000);
  });

  it('puts translucent materials in DrawXlu and keeps draw order', async () => {
    const opaque = commonMaterial('kinoko.brres', 'kinoko', 'kinoko', 'solid', false);
    const glass = commonMaterial('thunder.brres', 'thunder', 'shine_mat', 'glass', true);
    const brres = buildModelBrres({
      modelName: 'course',
      meshes: [quadMesh('glass', 'a'), quadMesh('solid', 'b'), quadMesh('glass', 'c', 50, 5)],
      materials: [opaque, glass],
      copyAnimations: false,
    });
    const parsed = await parseWithNoclip(brres);
    const graph = parsed.mdl0[0].sceneGraph;
    expect(graph.drawOpaOps.map((op: { shpId: number }) => op.shpId)).toEqual([1]);
    expect(graph.drawXluOps.map((op: { shpId: number }) => op.shpId)).toEqual([0, 2]);
    const decoded = decodeModel(brres);
    expect(decoded.materialNames).toEqual(['shine_mat', 'kinoko']);
  });

  it('copies animations that target the copied materials and merges them per group', async () => {
    // Three animated materials with three different (length, loop) pairs, plus one that is not animated.
    const scroll = commonMaterial('itemBoxNiseRtpa.brres', 'itemBoxNise', 'mat_boxin', 'boxin');
    const plain = commonMaterial('itemBoxNiseRtpa.brres', 'itemBoxNise', 'mat_question', 'question');
    const dark = commonMaterial('pow_bloc_plane.brres', 'pow_bloc_plane', 'pow_bloc_dark', 'dark', true);
    const core = commonMaterial('bombCore.brres', 'bombCore', 'bombCore', 'core');
    const brres = buildModelBrres({
      modelName: 'course',
      meshes: [quadMesh('boxin', 'a'), quadMesh('question', 'b'), quadMesh('dark', 'c'), quadMesh('core', 'd')],
      materials: [scroll, plain, dark, core],
      copyAnimations: true,
    });
    const parsed = await parseWithNoclip(brres);
    const raw = readBrresRaw(brres);

    const scrolls = parsed.srt0.map((srt: any) => ({ name: srt.name, duration: srt.duration, loop: srt.loopMode, materials: srt.matAnimations.map((m: any) => m.materialName) }));
    expect(scrolls).toEqual([
      { name: 'course', duration: 300, loop: 1, materials: ['mat_boxin'] },
      { name: 'course2', duration: 60, loop: 1, materials: ['pow_bloc_dark'] },
      { name: 'course3', duration: 55, loop: 0, materials: ['bombCore'] },
    ]);
    const patterns = parsed.pat0.map((pat: any) => ({ name: pat.name, duration: pat.duration, materials: pat.matAnimations.map((m: any) => m.materialName), texNames: pat.texNames }));
    expect(patterns).toHaveLength(1);
    expect(patterns[0].name).toBe('course');
    expect(patterns[0].materials).toEqual(['mat_boxin']);
    expect(patterns[0].texNames.length).toBeGreaterThan(0);

    // The animated values survive the move (compare against the source parse).
    const source = await parseWithNoclip(scroll.brres);
    const sourceTrack = source.srt0.find((srt: any) => srt.matAnimations.some((m: any) => m.materialName === 'mat_boxin')).matAnimations.find((m: any) => m.materialName === 'mat_boxin');
    expect(parsed.srt0[0].matAnimations[0].texAnimations).toEqual(sourceTrack.texAnimations);
    const sourcePattern = source.pat0.find((pat: any) => pat.matAnimations.some((m: any) => m.materialName === 'mat_boxin'));
    const sourceFrames = sourcePattern.matAnimations.find((m: any) => m.materialName === 'mat_boxin').texAnimations.map((t: any) => t.animationTrack.map((f: any) => [f.frame, sourcePattern.texNames[f.texIndex]]));
    const frames = parsed.pat0[0].matAnimations[0].texAnimations.map((t: any) => t.animationTrack.map((f: any) => [f.frame, parsed.pat0[0].texNames[f.texIndex]]));
    expect(frames).toEqual(sourceFrames);

    // Every texture a pattern lists is in the archive, and the file names follow retail.
    const textureNames = parsed.tex0.map((t: { name: string }) => t.name);
    for (const pat of parsed.pat0) for (const name of pat.texNames) expect(textureNames).toContain(name);
    expect(raw.groups[0].name).toBe(BRRES_MODELS_GROUP);
    expectDictionariesResolve(brres);

    const without = buildModelBrres({ modelName: 'course', meshes: [quadMesh('boxin', 'a')], materials: [scroll], copyAnimations: false });
    expect(readBrresRaw(without).groups.some((group) => group.name.startsWith('AnmTex'))).toBe(false);
  });

  it('gives two swatch materials with the same name distinct names and keeps clashing textures apart', () => {
    const a = commonMaterial('koura_green.brres', 'koura_green', 'shell_red_tx', 'a');
    const b = commonMaterial('koura_red.brres', 'koura_red', 'shell_red_tx', 'b');
    const brres = buildModelBrres({ modelName: 'course', meshes: [quadMesh('a', 'ma'), quadMesh('b', 'mb')], materials: [a, b], copyAnimations: false });
    const decoded = decodeModel(brres);
    expect(decoded.materialNames).toHaveLength(2);
    expect(new Set(decoded.materialNames).size).toBe(2);
    const raw = readBrresRaw(brres);
    // Every texture a material links to must exist in the archive, whatever it ended up called.
    const textures = raw.groups.find((group) => group.name === BRRES_TEXTURES_GROUP)!.entries.map((entry) => entry.name);
    for (const name of decoded.textureNames) expect(textures).toContain(name);
    expectDictionariesResolve(brres);
  });

  it('shares one material between surfaces that resolve to the same swatch material', () => {
    const a = commonMaterial('kinoko.brres', 'kinoko', 'kinoko', 'one');
    const b = commonMaterial('kinoko.brres', 'kinoko', 'kinoko', 'two');
    const brres = buildModelBrres({ modelName: 'course', meshes: [quadMesh('one', 'q1'), quadMesh('two', 'q2')], materials: [a, b], copyAnimations: false });
    expect(decodeModel(brres).materialNames).toEqual(['kinoko']);
  });

  it('fills in white colour, +Y normals and zero uvs for short attribute arrays, and drops empty meshes', () => {
    const mesh = quadMesh('kinoko');
    const bare: GeneratedMesh = { ...mesh, normals: new Float32Array(0), uvs: new Float32Array(0), colors: new Uint8Array(0) };
    const empty: GeneratedMesh = { ...mesh, name: 'none', indices: new Uint32Array(0) };
    const brres = buildModelBrres({ modelName: 'm', meshes: [bare, empty], materials: [kinoko()], copyAnimations: false });
    const decoded = decodeModel(brres);
    expect(decoded.shapes).toHaveLength(1);
    for (const corner of decoded.shapes[0].corners) {
      expect(corner.normal).toEqual([0, 1, 0]);
      expect(corner.uv).toEqual([0, 0]);
      expect(corner.color).toEqual([255, 255, 255, 255]);
    }
  });

  it('rejects a mesh whose surface has no material and an index past the vertex arrays', () => {
    expect(() => buildModelBrres({ modelName: 'm', meshes: [quadMesh('missing')], materials: [kinoko()], copyAnimations: false })).toThrow(/missing/);
    const bad = quadMesh('kinoko');
    bad.indices = new Uint32Array([0, 1, 9]);
    expect(() => [...splitMesh(bad)]).toThrow(/past the end/);
  });

  it('handles an empty model', async () => {
    const brres = buildModelBrres({ modelName: 'nothing', meshes: [], materials: [], copyAnimations: true });
    const parsed = await parseWithNoclip(brres);
    expect(parsed.mdl0[0].shapes).toHaveLength(0);
    expect(parsed.mdl0[0].materials).toHaveLength(0);
  });

  it('can be edited by the Model-mode tooling (Mdl0Editor round trip)', () => {
    const brres = buildModelBrres({ modelName: 'course', meshes: [quadMesh('kinoko')], materials: [kinoko()], copyAnimations: true });
    const raw = readBrresRaw(brres);
    const subFile = raw.groups[0].entries[0];
    const editor = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile));
    expect(editor.listShapes()).toHaveLength(1);
    expect(editor.readDrawOps('opaque')).toHaveLength(1);
    expect(editor.listNodes()).toHaveLength(1);
    expect(findSubFile(raw, BRRES_TEXTURES_GROUP, editor.getDic('texture')!.entries[0].name)).not.toBeNull();
  });
});

describe.skipIf(!hasRetailExtract())('buildModelBrres with retail course materials', () => {
  it('retail course models are wound so the cross product opposes the vertex normals (the convention the writer targets)', () => {
    for (const track of ['beginner_course', 'castle_course', 'koopa_course']) {
      const raw = readBrresRaw(retailCourseModel(track));
      const sub = raw.groups[0].entries[0];
      const editor = new Mdl0Editor(sub.data, makeSubFileNameReader(raw, sub));
      let opposed = 0;
      let agreeing = 0;
      for (const shape of editor.listShapes()) {
        if (shape.normalArrayId < 0) continue;
        const geometry = editor.readShapeGeometry(shape);
        const positions = editor.readVertexArrayValues(editor.getVertexArray('vtxPos', shape.positionArrayId)!);
        const normals = editor.readVertexArrayValues(editor.getVertexArray('vtxNrm', shape.normalArrayId)!);
        const positionIndex = geometry.attributeIndices.get(GX_ATTR.POS)!;
        const normalIndex = geometry.attributeIndices.get(GX_ATTR.NRM)!;
        for (let t = 0; t < geometry.indices.length; t += 3) {
          const corner = [0, 1, 2].map((k) => geometry.indices[t + k]);
          const p = corner.map((c) => [0, 1, 2].map((axis) => positions[positionIndex[c] * 3 + axis]));
          const n = [0, 1, 2].map((axis) => corner.reduce((sum, c) => sum + normals[normalIndex[c] * 3 + axis], 0));
          const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
          const v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
          const dot = (u[1] * v[2] - u[2] * v[1]) * n[0] + (u[2] * v[0] - u[0] * v[2]) * n[1] + (u[0] * v[1] - u[1] * v[0]) * n[2];
          if (dot < 0) opposed++;
          else if (dot > 0) agreeing++;
        }
      }
      expect(opposed, track).toBeGreaterThan(300);
      expect(agreeing / (opposed + agreeing), track).toBeLessThan(0.02);
    }
  });

  it('copies a retail course-model material verbatim apart from relocated fields', async () => {
    const material = retailMaterial('beginner_course', 'a_MainRoad_m', 'road');
    const mesh = gridMesh('road', 30, 30, 50, 'road');
    const brres = buildModelBrres({ modelName: 'course', meshes: [mesh], materials: [material], copyAnimations: true });

    const source = readBrresRaw(material.brres);
    const sourceSub = source.groups[0].entries[0];
    const sourceEditor = new Mdl0Editor(sourceSub.data, makeSubFileNameReader(source, sourceSub));
    const sourceMaterial = sourceEditor.listMaterials().find((m) => m.name === 'a_MainRoad_m')!;
    const sourceView = new DataView(sourceEditor.data.buffer, sourceEditor.data.byteOffset);

    const raw = readBrresRaw(brres);
    const sub = raw.groups[0].entries[0];
    const editor = new Mdl0Editor(sub.data, makeSubFileNameReader(raw, sub));
    const out = editor.listMaterials()[0];
    expect(out.name).toBe('a_MainRoad_m');
    expect(out.size).toBe(sourceMaterial.size);
    const outView = new DataView(editor.data.buffer, editor.data.byteOffset);
    const samplerCount = sourceView.getUint32(sourceMaterial.offset + 0x2c);
    const samplerOffset = sourceView.getUint32(sourceMaterial.offset + 0x30);
    const skip = new Set<number>();
    for (let i = 4; i < 0x10; i++) skip.add(i); // back pointer, name pointer, index
    for (let i = 0x28; i < 0x2c; i++) skip.add(i); // TEV link
    for (let s = 0; s < samplerCount; s++) for (let i = 0; i < 8; i++) skip.add(samplerOffset + s * 0x34 + i);
    for (let i = 0; i < sourceMaterial.size; i++) {
      if (skip.has(i)) continue;
      expect(outView.getUint8(out.offset + i), `material byte 0x${i.toString(16)}`).toBe(sourceView.getUint8(sourceMaterial.offset + i));
    }
    // TEV block identical apart from its back pointer and index.
    const sourceTev = sourceMaterial.offset + sourceView.getUint32(sourceMaterial.offset + 0x28);
    const outTev = out.offset + outView.getUint32(out.offset + 0x28);
    for (let i = 0; i < 0x200; i++) {
      if (i >= 4 && i < 0x0c) continue;
      expect(outView.getUint8(outTev + i), `tev byte 0x${i.toString(16)}`).toBe(sourceView.getUint8(sourceTev + i));
    }
    // Sampler names resolve to the same textures, and the TEX0 pixel data was copied untouched.
    for (let s = 0; s < samplerCount; s++) {
      const at = out.offset + samplerOffset + s * 0x34;
      const name = editor.readNameAt(at + outView.getInt32(at));
      const sourceAt = sourceMaterial.offset + samplerOffset + s * 0x34;
      expect(name).toBe(sourceEditor.readNameAt(sourceAt + sourceView.getInt32(sourceAt)));
      const copied = findSubFile(raw, BRRES_TEXTURES_GROUP, name)!;
      const original = findSubFile(source, BRRES_TEXTURES_GROUP, name)!;
      expect(copied.data.subarray(0x18)).toEqual(original.data.subarray(0x18));
    }

    // Only the textures the material samples are copied, not the whole track's.
    const copiedTextures = raw.groups.find((group) => group.name === BRRES_TEXTURES_GROUP)!.entries;
    expect(copiedTextures.length).toBe(samplerCount);
    expect(brres.length).toBeLessThan(material.brres.length / 2);

    const decoded = decodeModel(brres);
    expectTrianglesMatch(decoded.shapes, mesh);
    const parsed = await parseWithNoclip(brres);
    expect(parsed.mdl0[0].materials.map((m: { name: string }) => m.name)).toEqual(['a_MainRoad_m']);
    expectDictionariesResolve(brres);
    expectGxAlignment(brres);
  }, 60000); // parses a retail course model: slow under a loaded full-suite run

  it('merges materials and animations from several retail tracks', async () => {
    const road = retailMaterial('beginner_course', 'a_MainRoad_m', 'road');
    const wall = retailMaterial('castle_course', 'k_road_01', 'castle-road');
    const brres = buildModelBrres({
      modelName: 'course',
      meshes: [gridMesh('road', 4, 4, 50, 'r'), gridMesh('castle-road', 4, 4, 50, 'c')],
      materials: [road, wall],
      copyAnimations: true,
    });
    const decoded = decodeModel(brres);
    expect(new Set(decoded.materialNames).size).toBe(decoded.materialNames.length);
    expect(decoded.shapes).toHaveLength(2);
    const parsed = await parseWithNoclip(brres);
    expect(parsed.mdl0[0].materials).toHaveLength(decoded.materialNames.length);
    expectDictionariesResolve(brres);
    expectGxAlignment(brres);
  });
});

describe('generated models in the rest of the editor', () => {
  it('survive a Model-mode edit baked by bakeCourseModel and still parse', async () => {
    const mesh = quadMesh('kinoko', 'quad', 100, 0);
    const brres = buildModelBrres({ modelName: 'course', meshes: [mesh], materials: [kinoko()], copyAnimations: true });
    const ops = drawOpsOf(brres);
    expect(ops).toHaveLength(1);
    const edit: MeshEdit = {
      target: {
        archivePath: './course_model.brres',
        modelName: 'course',
        shapeIndex: ops[0].op.shapeId,
        drawOpIndex: 0,
        componentIndex: null,
        nodeId: ops[0].op.nodeId,
        granularity: 'shape',
      },
      transform: { ...createIdentityMeshTransform(), translation: { x: 0, y: 500, z: 0 } },
      visible: true,
      deleted: false,
    };
    const baked = bakeCourseModel(brres, { edits: [edit] });
    expect(baked.changed).toBe(true);
    const decoded = decodeModel(baked.data);
    expect(decoded.shapes[0].corners.every((corner) => corner.position[1] === 500)).toBe(true);
    const parsed = await parseWithNoclip(baked.data);
    expect(parsed.mdl0[0].shapes[0].loadedVertexData.totalVertexCount).toBe(6);
  });

  it('keeps the translucency flag of a material in step with its draw list', () => {
    const solid = commonMaterial('kinoko.brres', 'kinoko', 'kinoko', 'solid', false);
    const clear = commonMaterial('kinoko.brres', 'kinoko', 'kinoko', 'clear', true);
    const brres = buildModelBrres({ modelName: 'course', meshes: [quadMesh('solid', 'a'), quadMesh('clear', 'b')], materials: [solid, clear], copyAnimations: false });
    const decoded = decodeModel(brres);
    // Same swatch material used both ways becomes two materials, one per list.
    expect(decoded.materialNames).toEqual(['kinoko', 'kinoko_1']);
    const flags = decoded.editor.listMaterials().map((material) => material.translucent);
    expect(flags).toEqual([false, true]);
  });
});
