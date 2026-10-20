import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeSubFileNameReader, readBrresRaw } from '../../brres/brresRaw';
import { parseWithNoclip } from '../../brres/brresFixtures.testdata';
import { Mdl0Editor } from '../../brres/mdl0Raw';
import { GX_ATTR, readCpRegisters, readPrimitiveVertices, readVertexDescriptor } from '../../brres/gxVertex';
import { decodeYaz0 } from '../../yaz0';
import { parseU8 } from '../../u8';
import type { GeneratedMesh, MaterialSource } from '../types';
import { buildMinimapBrres, MINIMAP_HEIGHT } from './minimapWriter';
import { buildStadium } from './stadiumFixture.testdata';

const EXTRACTED = 'public/data/MarioKartWii/Race/Course/ExtractedAssets.u8';

/** The Luigi Circuit minimap from the bundled extracted assets: one material, no textures. */
function minimapSwatch(): MaterialSource {
  const entries = parseU8(new Uint8Array(readFileSync(EXTRACTED)));
  const file = entries.find((entry) => entry.path.endsWith('map_model.brres'));
  if (!file?.data) throw new Error('ExtractedAssets.u8 has no map_model.brres');
  return { surfaceId: 'minimap', brres: file.data, modelName: 'map', materialName: 'beginner_course_m', translucent: false };
}

function outlineFrom(stadiumMesh: GeneratedMesh, flipEvery = 0): GeneratedMesh {
  const indices = stadiumMesh.indices.slice();
  if (flipEvery > 0) {
    for (let t = 0; t + 2 < indices.length; t += 3 * flipEvery) {
      const b = indices[t + 1];
      indices[t + 1] = indices[t + 2];
      indices[t + 2] = b;
    }
  }
  // Heights are ignored by the writer; give them noise to prove it.
  const positions = stadiumMesh.positions.slice();
  for (let i = 1; i < positions.length; i += 3) positions[i] = 123 + (i % 7) * 40;
  return { ...stadiumMesh, name: 'outline', surfaceId: 'minimap', positions, indices };
}

describe.skipIf(!existsSync(EXTRACTED))('buildMinimapBrres', () => {
  const stadium = buildStadium({ straight: 6000, radius: 2000, roadWidth: 2500, wallHeight: 0 });

  it('builds the model the HUD expects: map + posLD + posRU, no normals or texcoords', async () => {
    const outline = outlineFrom(stadium.meshes[0], 3);
    const brres = buildMinimapBrres({ meshes: [outline], material: minimapSwatch() });
    const raw = readBrresRaw(brres);
    expect(raw.groups.map((group) => group.name)).toEqual(['3DModels(NW4R)']);
    const sub = raw.groups[0].entries[0];
    expect(sub.name).toBe('map');
    const editor = new Mdl0Editor(sub.data, makeSubFileNameReader(raw, sub));
    expect(editor.name).toBe('map');
    const nodes = editor.listNodes();
    expect(nodes.map((node) => node.name)).toEqual(['map', 'posLD', 'posRU']);
    expect(editor.getDic('vtxNrm')).toBeNull();
    expect(editor.getDic('vtxTxc')).toBeNull();
    expect(editor.getDic('texture')).toBeNull();
    expect(editor.readDrawOps('opaque')).toHaveLength(1);
    expect(editor.readDrawOps('translucent')).toBeNull();
    expect(editor.getDic('byteCode')!.entries.map((entry) => entry.name)).toEqual(['NodeTree', 'DrawOpa']);
    expect(editor.readNodeTreeOps()).toEqual([
      { op: 'nodeDesc', nodeId: 0, parentMtxId: 0 },
      { op: 'nodeDesc', nodeId: 1, parentMtxId: 0 },
      { op: 'nodeDesc', nodeId: 2, parentMtxId: 0 },
    ]);

    // Corner nodes: left/down and right/up of a square around the outline, at height 0.
    const [map, left, right] = nodes;
    expect(map.translation).toEqual([0, 0, 0]);
    expect(left.translation[1]).toBe(0);
    expect(right.translation[1]).toBe(0);
    expect(left.translation[0]).toBeLessThan(-3000 - 2000 - 1250);
    expect(right.translation[0]).toBeGreaterThan(3000 + 2000 + 1250);
    expect(right.translation[0] - left.translation[0]).toBe(left.translation[2] - right.translation[2]); // square
    expect(right.translation[2]).toBeLessThan(0);

    const parsed = await parseWithNoclip(brres);
    const model = parsed.mdl0[0];
    expect(model.nodes.map((node: { name: string }) => node.name)).toEqual(['map', 'posLD', 'posRU']);
    expect(model.nodes.map((node: { parentNodeId: number }) => node.parentNodeId)).toEqual([-1, 0, 0]);
    expect(model.shapes).toHaveLength(1);
    expect(model.shapes[0].loadedVertexData.totalVertexCount).toBe(outline.indices.length);
    expect(model.numViewMtx).toBe(3);
    expect(model.sceneGraph.drawXluOps).toHaveLength(0);
  });

  it('is shaped like the retail map model: same vertex registers, node layout and material bytes', () => {
    const brres = buildMinimapBrres({ meshes: [outlineFrom(stadium.meshes[0])], material: minimapSwatch() });
    const retail = readBrresRaw(minimapSwatch().brres);
    const retailSub = retail.groups[0].entries[0];
    const retailEditor = new Mdl0Editor(retailSub.data, makeSubFileNameReader(retail, retailSub));
    const mine = readBrresRaw(brres);
    const mineSub = mine.groups[0].entries[0];
    const mineEditor = new Mdl0Editor(mineSub.data, makeSubFileNameReader(mine, mineSub));

    // Shape header: vertex registers, descriptor flags, array ids, and the pre-primitive display list.
    const a = new DataView(retailEditor.data.buffer, retailEditor.data.byteOffset);
    const b = new DataView(mineEditor.data.buffer, mineEditor.data.byteOffset);
    const retailShape = retailEditor.listShapes()[0];
    const mineShape = mineEditor.listShapes()[0];
    for (const [from, to] of [[0x08, 0x40], [0x48, 0x68]] as const) {
      for (let i = from; i < to; i += 4) {
        if ([0x18, 0x24, 0x28, 0x2c].includes(i)) continue; // sizes differ with the geometry
        if (i === 0x20 || i === 0x38 || i === 0x3c || (i >= 0x40 && i < 0x48)) continue;
        expect(b.getUint32(mineShape.offset + i), `shape header +0x${i.toString(16)}`).toBe(a.getUint32(retailShape.offset + i));
      }
    }
    expect(mineShape.prePrimSize).toBe(retailShape.prePrimSize);
    expect(mineEditor.data.subarray(mineShape.prePrimOffset, mineShape.prePrimOffset + mineShape.prePrimSize)).toEqual(
      retailEditor.data.subarray(retailShape.prePrimOffset, retailShape.prePrimOffset + retailShape.prePrimSize),
    );
    // Node flags and bind poses of the two corner nodes.
    for (const index of [0, 1, 2]) {
      const retailNode = retailEditor.listNodes()[index];
      const mineNode = mineEditor.listNodes()[index];
      expect(b.getUint32(mineNode.offset + 0x14)).toBe(a.getUint32(retailNode.offset + 0x14));
      expect(b.getUint32(mineNode.offset)).toBe(0xd0);
      for (let i = 0x18; i < 0x44; i += 4) {
        if (i >= 0x38) continue; // translation differs
        expect(b.getUint32(mineNode.offset + i), `node ${index} +0x${i.toString(16)}`).toBe(a.getUint32(retailNode.offset + i));
      }
      for (const rel of [0x5c, 0x60, 0x64, 0x68]) {
        expect(b.getInt32(mineNode.offset + rel), `node ${index} link +0x${rel.toString(16)}`).toBe(a.getInt32(retailNode.offset + rel));
      }
    }
    // The material is the retail one, byte for byte apart from relocated fields.
    const retailMaterial = retailEditor.listMaterials()[0];
    const mineMaterial = mineEditor.listMaterials()[0];
    expect(mineMaterial.size).toBe(retailMaterial.size);
    for (let i = 0x10; i < retailMaterial.size; i++) {
      if (i >= 0x28 && i < 0x2c) continue;
      expect(b.getUint8(mineMaterial.offset + i), `material byte 0x${i.toString(16)}`).toBe(a.getUint8(retailMaterial.offset + i));
    }
    // And the bytes in the retail file sit in the same dictionary order.
    expect(mineEditor.getDic('byteCode')!.entries.map((entry) => entry.name)).toEqual(retailEditor.getDic('byteCode')!.entries.map((entry) => entry.name));
  });

  it('winds every triangle downward at a constant height, whatever the input', () => {
    const outline = outlineFrom(stadium.meshes[0], 2);
    const brres = buildMinimapBrres({ meshes: [outline], material: minimapSwatch() });
    const raw = readBrresRaw(brres);
    const sub = raw.groups[0].entries[0];
    const editor = new Mdl0Editor(sub.data, makeSubFileNameReader(raw, sub));
    const shape = editor.listShapes()[0];
    const registers = readCpRegisters(editor.data.subarray(shape.prePrimOffset, shape.prePrimOffset + shape.prePrimSize));
    const vcd = readVertexDescriptor(registers);
    expect(vcd.types[GX_ATTR.POS]).toBe(3);
    expect(vcd.types[GX_ATTR.NRM]).toBe(0);
    expect(vcd.types[GX_ATTR.CLR0]).toBe(2);
    expect(vcd.types[GX_ATTR.TEX0]).toBe(0);
    const decoded = readPrimitiveVertices(editor.data.subarray(shape.primOffset, shape.primOffset + shape.primSize), vcd, [GX_ATTR.POS, GX_ATTR.CLR0]);
    const positions = editor.readVertexArrayValues(editor.getVertexArray('vtxPos', shape.positionArrayId)!);
    const index = decoded.attributeIndices.get(GX_ATTR.POS)!;
    let facingUp = 0;
    let wrongHeight = 0;
    for (let t = 0; t < decoded.indices.length; t += 3) {
      const p = [0, 1, 2].map((k) => index[decoded.indices[t + k]]).map((i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
      const ny = (p[1][2] - p[0][2]) * (p[2][0] - p[0][0]) - (p[1][0] - p[0][0]) * (p[2][2] - p[0][2]);
      if (ny > 0) facingUp++;
      if (p.some((v) => v[1] !== MINIMAP_HEIGHT)) wrongHeight++;
    }
    expect(decoded.indices.length / 3).toBe(outline.indices.length / 3);
    expect(facingUp).toBe(0);
    expect(wrongHeight).toBe(0);
    // One colour entry, white, like retail.
    const colors = editor.getVertexArray('vtxClr', 0)!;
    expect(colors.count).toBe(1);
    expect([...editor.data.subarray(colors.dataOffset, colors.dataOffset + 4)]).toEqual([255, 255, 255, 255]);
  });

  it('copes with an empty outline and with several meshes', () => {
    const empty = buildMinimapBrres({ meshes: [], material: minimapSwatch() });
    expect(readBrresRaw(empty).groups[0].entries[0].name).toBe('map');
    const a = outlineFrom(stadium.meshes[0]);
    const b = { ...outlineFrom(stadium.meshes[1]), name: 'second' };
    const two = readBrresRaw(buildMinimapBrres({ meshes: [a, b], material: minimapSwatch() }));
    const sub = two.groups[0].entries[0];
    expect(new Mdl0Editor(sub.data, makeSubFileNameReader(two, sub)).listShapes().map((shape) => shape.name)).toEqual(['outline', 'second']);
  });

  it.skipIf(!existsSync('D:/Games/Wii/mkw-retail-extract/DATA/files/Race/Course/beginner_course.szs'))(
    'accepts the same material taken from another retail track',
    async () => {
      const path = 'D:/Games/Wii/mkw-retail-extract/DATA/files/Race/Course/castle_course.szs';
      const entries = parseU8(decodeYaz0(new Uint8Array(readFileSync(path))));
      const file = entries.find((entry) => entry.path.endsWith('map_model.brres'))!;
      const brres = buildMinimapBrres({
        meshes: [outlineFrom(stadium.meshes[0])],
        material: { surfaceId: 'minimap', brres: file.data!, modelName: 'map', materialName: 'map01', translucent: false },
      });
      const parsed = await parseWithNoclip(brres);
      expect(parsed.mdl0[0].materials.map((m: { name: string }) => m.name)).toEqual(['map01']);
    },
  );
});
