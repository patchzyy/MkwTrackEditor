/**
 * Test-only helpers shared by the writer tests: swatches out of `Common.szs` (CI-safe) and out of
 * the retail extract (skipped when the extract is not on this machine), simple meshes, and a
 * decoder that reads a generated `.brres` back through the editor's own MDL0 reader.
 */

import { existsSync, readFileSync } from 'node:fs';
import { BRRES_MODELS_GROUP, makeSubFileNameReader, readBrresRaw } from '../../brres/brresRaw';
import { Mdl0Editor } from '../../brres/mdl0Raw';
import { GX_ATTR, readCpRegisters, readPrimitiveVertices, readVertexDescriptor } from '../../brres/gxVertex';
import { decodeYaz0 } from '../../yaz0';
import { parseU8 } from '../../u8';
import type { GeneratedMesh, MaterialSource } from '../types';

export const RETAIL_COURSE_DIR = 'D:/Games/Wii/mkw-retail-extract/DATA/files/Race/Course';
const COMMON_PATH = 'public/data/MarioKartWii/Race/Common.szs';

export function hasRetailExtract(): boolean {
  return process.env.MKW_TEST_FIXTURES !== 'bundled' && existsSync(`${RETAIL_COURSE_DIR}/beginner_course.szs`);
}

let commonEntries: ReturnType<typeof parseU8> | null = null;

/** A swatch (`brres` + names) taken from an object model in the bundled `Common.szs`. */
export function commonMaterial(file: string, modelName: string, materialName: string, surfaceId = materialName, translucent = false): MaterialSource {
  commonEntries ??= parseU8(decodeYaz0(new Uint8Array(readFileSync(COMMON_PATH))));
  const entry = commonEntries.find((candidate) => candidate.path.endsWith(`/${file}`));
  if (!entry?.data) throw new Error(`Common.szs has no ${file}`);
  return { surfaceId, brres: entry.data, modelName, materialName, translucent };
}

const retailCache = new Map<string, Uint8Array>();

/** `course_model.brres` of a retail track (the whole archive serves as the swatch). */
export function retailCourseModel(track: string): Uint8Array {
  const cached = retailCache.get(track);
  if (cached) return cached;
  const entries = parseU8(decodeYaz0(new Uint8Array(readFileSync(`${RETAIL_COURSE_DIR}/${track}.szs`))));
  const file = entries.find((entry) => entry.path.endsWith('course_model.brres'));
  if (!file?.data) throw new Error(`${track} has no course_model.brres`);
  retailCache.set(track, file.data);
  return file.data;
}

export function retailMaterial(track: string, materialName: string, surfaceId = materialName, translucent = false): MaterialSource {
  return { surfaceId, brres: retailCourseModel(track), modelName: 'course', materialName, translucent };
}

export function quadMesh(surfaceId: string, name = 'quad', size = 100, y = 0): GeneratedMesh {
  return {
    name,
    surfaceId,
    chunk: 'test',
    positions: new Float32Array([0, y, 0, size, y, 0, size, y, size, 0, y, size]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    colors: new Uint8Array(16).fill(255),
    // (b - a) x (c - a) points up for both triangles.
    indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
  };
}

/** A flat grid of `nx` x `nz` cells, 6 indices per cell, one vertex per grid point. */
export function gridMesh(surfaceId: string, nx: number, nz: number, spacing = 10, name = 'grid'): GeneratedMesh {
  const columns = nx + 1;
  const rows = nz + 1;
  const count = columns * rows;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const colors = new Uint8Array(count * 4);
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < columns; x++) {
      const i = z * columns + x;
      positions.set([x * spacing, Math.sin(x * 0.05) * 5, z * spacing], i * 3);
      normals.set([0, 1, 0], i * 3);
      uvs.set([x / 4, z / 4], i * 2);
      colors.set([255 - (x % 5) * 10, 255, 255, 255], i * 4);
    }
  }
  const indices = new Uint32Array(nx * nz * 6);
  let at = 0;
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      const a = z * columns + x;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.set([a, c, b, b, c, d], at);
      at += 6;
    }
  }
  return { name, surfaceId, chunk: 'test', positions, normals, uvs, colors, indices };
}

export interface DecodedShape {
  name: string;
  triangleCount: number;
  vertexCount: number;
  /** Per triangle corner: position / normal / uv / colour. */
  corners: Array<{ position: [number, number, number]; normal: [number, number, number]; uv: [number, number]; color: [number, number, number, number] }>;
  positionArrayCount: number;
  materialName: string;
}

export interface DecodedModel {
  editor: Mdl0Editor;
  name: string;
  shapes: DecodedShape[];
  materialNames: string[];
  textureNames: string[];
}

/** Reads a generated `.brres` back: every shape's display list resolved to attribute values. */
export function decodeModel(brres: Uint8Array): DecodedModel {
  const raw = readBrresRaw(brres);
  const subFile = raw.groups.find((group) => group.name === BRRES_MODELS_GROUP)!.entries[0];
  const editor = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile));
  const materialNames = editor.listMaterials().map((material) => material.name);
  const drawOps = [...(editor.readDrawOps('opaque') ?? []), ...(editor.readDrawOps('translucent') ?? [])];
  const shapes: DecodedShape[] = editor.listShapes().map((shape) => {
    const registers = readCpRegisters(editor.data.subarray(shape.prePrimOffset, shape.prePrimOffset + shape.prePrimSize));
    const vcd = readVertexDescriptor(registers);
    const decoded = readPrimitiveVertices(editor.data.subarray(shape.primOffset, shape.primOffset + shape.primSize), vcd, [GX_ATTR.POS, GX_ATTR.NRM, GX_ATTR.CLR0, GX_ATTR.TEX0]);
    const positions = editor.getVertexArray('vtxPos', shape.positionArrayId)!;
    const normals = editor.getVertexArray('vtxNrm', shape.normalArrayId)!;
    const positionValues = editor.readVertexArrayValues(positions);
    const normalValues = editor.readVertexArrayValues(normals);
    // Colour and texcoord arrays share the shape's index in this writer.
    const colorArray = editor.getVertexArray('vtxClr', shape.index)!;
    const texcoordArray = editor.getVertexArray('vtxTxc', shape.index)!;
    const colorBytes = editor.data.subarray(colorArray.dataOffset, colorArray.dataOffset + colorArray.count * 4);
    const texcoordValues = editor.readVertexArrayValues(texcoordArray);
    const corners: DecodedShape['corners'] = [];
    const posIndex = decoded.attributeIndices.get(GX_ATTR.POS)!;
    const nrmIndex = decoded.attributeIndices.get(GX_ATTR.NRM)!;
    const clrIndex = decoded.attributeIndices.get(GX_ATTR.CLR0)!;
    const texIndex = decoded.attributeIndices.get(GX_ATTR.TEX0)!;
    for (let i = 0; i < decoded.vertexCount; i++) {
      corners.push({
        position: [positionValues[posIndex[i] * 3], positionValues[posIndex[i] * 3 + 1], positionValues[posIndex[i] * 3 + 2]],
        normal: [normalValues[nrmIndex[i] * 3], normalValues[nrmIndex[i] * 3 + 1], normalValues[nrmIndex[i] * 3 + 2]],
        uv: [texcoordValues[texIndex[i] * 2], texcoordValues[texIndex[i] * 2 + 1]],
        color: [colorBytes[clrIndex[i] * 4], colorBytes[clrIndex[i] * 4 + 1], colorBytes[clrIndex[i] * 4 + 2], colorBytes[clrIndex[i] * 4 + 3]],
      });
    }
    const op = drawOps.find((candidate) => candidate.shapeId === shape.index);
    return {
      name: shape.name,
      triangleCount: shape.polygonCount,
      vertexCount: shape.vertexCount,
      corners,
      positionArrayCount: positions.count,
      materialName: materialNames[op?.materialId ?? -1] ?? '',
    };
  });
  return {
    editor,
    name: editor.name,
    shapes,
    materialNames,
    textureNames: editor.getDic('texture')?.entries.map((entry) => entry.name) ?? [],
  };
}
