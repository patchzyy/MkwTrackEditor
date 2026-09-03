// TEMPORARY STUB — delete at merge.
//
// The real `src/lib/gxMaterial/` (list / decode / apply / add / remove / compile / decompile) is
// being written in parallel by the library agent. This file exists only so the material editor UI
// in `src/ui/material/` compiles and can be demonstrated against a real track before the two
// halves are merged. It contains no UI logic and no state.
//
// What is real here: `listArchiveMaterials` and `decodeMaterial` read the vendored noclip BRRES
// parser, so the outliner and inspector show the track's actual materials.
// What is a placeholder: `applyMaterial` / `addTexture` / `removeTexture` hand the input bytes
// straight back with a warning, and `compileShaderGraph` / `decompileShader` are a naive round
// trip rather than the exact one the contract promises.
import ArrayBufferSlice from '../../../vendor/noclip.website/src/ArrayBufferSlice';
import * as BRRES from '../../../vendor/noclip.website/src/rres/brres';
import * as GX from '../../../vendor/noclip.website/src/gx/gx_enum';
import {
  GRAPH_NODE_SOCKETS,
  GxMaterialError,
  type AddTextureOptions,
  type ApplyMaterialOptions,
  type ApplyMaterialResult,
  type CompiledShader,
  type GraphDiagnostic,
  type GraphEdge,
  type GraphNode,
  type GxArchiveMaterials,
  type GxChannelDoc,
  type GxColor,
  type GxColorS10,
  type GxMapMode,
  type GxMaterialDoc,
  type GxMaterialSummary,
  type GxSamplerDoc,
  type GxSwapTableDoc,
  type GxTevStageDoc,
  type GxTextureSummary,
  type ShaderGraph,
  type ShaderGraphPreset,
} from './types';

export * from './types';

// ------------------------------------------------------------------ parsing helpers

function toSlice(bytes: Uint8Array): ArrayBufferSlice {
  const copy = bytes.slice();
  return new ArrayBufferSlice(copy.buffer, copy.byteOffset, copy.byteLength);
}

const rresCache = new WeakMap<Uint8Array, BRRES.RRES>();

function parseArchive(bytes: Uint8Array): BRRES.RRES {
  const cached = rresCache.get(bytes);
  if (cached) return cached;
  const rres = BRRES.parse(toSlice(bytes));
  rresCache.set(bytes, rres);
  return rres;
}

function mapModeName(mapMode: number): GxMapMode {
  switch (mapMode) {
    case BRRES.MapMode.ENV_CAMERA: return 'envCamera';
    case BRRES.MapMode.PROJECTION: return 'projection';
    case BRRES.MapMode.ENV_LIGHT: return 'envLight';
    case BRRES.MapMode.ENV_SPEC: return 'envSpec';
    default: return 'texcoord';
  }
}

function color(source: { r: number; g: number; b: number; a: number } | undefined): GxColor {
  return { r: source?.r ?? 0, g: source?.g ?? 0, b: source?.b ?? 0, a: source?.a ?? 0 };
}

function colorS10(source: { r: number; g: number; b: number; a: number } | undefined): GxColorS10 {
  // The parser stores registers as 0..1 floats; the document wants the s10 hardware range.
  return {
    r: Math.round((source?.r ?? 0) * 255),
    g: Math.round((source?.g ?? 0) * 255),
    b: Math.round((source?.b ?? 0) * 255),
    a: Math.round((source?.a ?? 0) * 255),
  };
}

/** Pulls scale / rotation / translation back out of the 2D affine the parser stores. */
function decomposeSrt(matrix: ArrayLike<number> | undefined) {
  if (!matrix) return { scaleS: 1, scaleT: 1, rotation: 0, translateS: 0, translateT: 0 };
  const m00 = matrix[0] ?? 1;
  const m01 = matrix[1] ?? 0;
  const m10 = matrix[4] ?? 0;
  const m11 = matrix[5] ?? 1;
  const scaleS = Math.hypot(m00, m01) || 1;
  const scaleT = Math.hypot(m10, m11) || 1;
  return {
    scaleS,
    scaleT,
    rotation: (Math.atan2(m01, m00) * 180) / Math.PI,
    translateS: matrix[12] ?? 0,
    translateT: matrix[13] ?? 0,
  };
}

const DEFAULT_SWAP_TABLES: [GxSwapTableDoc, GxSwapTableDoc, GxSwapTableDoc, GxSwapTableDoc] = [
  [GX.TevColorChan.R, GX.TevColorChan.G, GX.TevColorChan.B, GX.TevColorChan.A],
  [GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.A],
  [GX.TevColorChan.G, GX.TevColorChan.G, GX.TevColorChan.G, GX.TevColorChan.A],
  [GX.TevColorChan.B, GX.TevColorChan.B, GX.TevColorChan.B, GX.TevColorChan.A],
];

function findModel(rres: BRRES.RRES, modelName: string): any {
  const model = (rres.mdl0 as any[]).find((entry) => entry.name === modelName);
  if (!model) throw new GxMaterialError(`${modelName} is not a model in this archive.`);
  return model;
}

function findMaterial(model: any, materialName: string): any {
  const material = (model.materials as any[]).find((entry) => entry.name === materialName);
  if (!material) throw new GxMaterialError(`${model.name} has no material called ${materialName}.`);
  return material;
}

/** Stable fingerprint of a material's TEV block, used to spot materials sharing a shader. */
function shaderKey(material: any): string {
  const stages = material.gxMaterial?.tevStages ?? [];
  return stages
    .map((stage: any) =>
      [
        stage.colorInA, stage.colorInB, stage.colorInC, stage.colorInD, stage.colorOp, stage.colorBias,
        stage.colorScale, stage.colorClamp ? 1 : 0, stage.colorRegId,
        stage.alphaInA, stage.alphaInB, stage.alphaInC, stage.alphaInD, stage.alphaOp, stage.alphaBias,
        stage.alphaScale, stage.alphaClamp ? 1 : 0, stage.alphaRegId,
        stage.texCoordId, stage.texMap, stage.channelId, stage.konstColorSel, stage.konstAlphaSel,
      ].join(','),
    )
    .join('|');
}

// ------------------------------------------------------------------ contract: listing

export function listArchiveMaterials(archivePath: string, brres: Uint8Array): GxArchiveMaterials {
  let rres: BRRES.RRES;
  try {
    rres = parseArchive(brres);
  } catch {
    return { archivePath, models: [], textures: [] };
  }

  const usage = new Map<string, string[]>();
  const models = (rres.mdl0 as any[]).map((model) => {
    // Which shapes draw with which material, so the outliner can highlight a material's meshes.
    const meshesByMaterial = new Map<string, string[]>();
    for (const shape of model.shapes ?? []) {
      const materialName = shape.materialName ?? shape.material?.name;
      if (typeof materialName !== 'string') continue;
      const list = meshesByMaterial.get(materialName) ?? [];
      list.push(shape.name);
      meshesByMaterial.set(materialName, list);
    }
    // MDL0 draw ops are the authoritative shape ↔ material pairing when the parser keeps them.
    for (const op of model.sceneGraph?.drawOpaOps ?? []) linkDrawOp(op);
    for (const op of model.sceneGraph?.drawXluOps ?? []) linkDrawOp(op);
    function linkDrawOp(op: any) {
      const material = model.materials?.[op.matId];
      const shape = model.shapes?.[op.shpId];
      if (!material || !shape) return;
      const list = meshesByMaterial.get(material.name) ?? [];
      if (!list.includes(shape.name)) list.push(shape.name);
      meshesByMaterial.set(material.name, list);
    }

    const byShader = new Map<string, string[]>();
    for (const material of model.materials ?? []) {
      const key = shaderKey(material);
      const list = byShader.get(key) ?? [];
      list.push(material.name);
      byShader.set(key, list);
    }

    const materials: GxMaterialSummary[] = (model.materials as any[]).map((material, index) => {
      const textures: string[] = (material.samplers ?? []).map((sampler: any) => sampler?.name ?? '');
      for (const name of textures) {
        if (!name) continue;
        const users = usage.get(name) ?? [];
        const label = `${model.name}/${material.name}`;
        if (!users.includes(label)) users.push(label);
        usage.set(name, users);
      }
      const shared = (byShader.get(shaderKey(material)) ?? []).filter((name) => name !== material.name);
      return {
        archivePath,
        modelName: model.name,
        materialName: material.name,
        index,
        translucent: !!material.translucent,
        textures,
        stageCount: material.gxMaterial?.tevStages?.length ?? 0,
        sharedShaderWith: shared,
        meshes: meshesByMaterial.get(material.name) ?? [],
      };
    });
    return { modelName: model.name, materials };
  });

  const textures: GxTextureSummary[] = (rres.tex0 as any[]).map((tex0) => ({
    name: tex0.name,
    width: tex0.width,
    height: tex0.height,
    format: tex0.format,
    mipCount: Math.max(1, tex0.mipCount ?? 1),
    usedBy: usage.get(tex0.name) ?? [],
  }));

  return { archivePath, models, textures };
}

// ------------------------------------------------------------------ contract: decoding

export function decodeMaterial(brres: Uint8Array, modelName: string, materialName: string): GxMaterialDoc {
  const rres = parseArchive(brres);
  const model = findModel(rres, modelName);
  const material = findMaterial(model, materialName);
  const gx = material.gxMaterial ?? {};

  const samplers: GxSamplerDoc[] = (material.samplers ?? []).map((sampler: any, index: number) => ({
    texture: sampler?.name ?? '',
    palette: sampler?.namePalette ?? '',
    wrapS: sampler?.wrapS ?? GX.WrapMode.REPEAT,
    wrapT: sampler?.wrapT ?? GX.WrapMode.REPEAT,
    minFilter: sampler?.minFilter ?? GX.TexFilter.LIN_MIP_LIN,
    magFilter: sampler?.magFilter ?? GX.TexFilter.LINEAR,
    lodBias: sampler?.lodBias ?? 0,
    maxAnisotropy: GX.Anisotropy._1,
    biasClamp: false,
    edgeLod: false,
    mapMode: mapModeName(material.texSrts?.[index]?.mapMode ?? 0),
  }));

  const texSrts = (material.samplers ?? []).map((_: unknown, index: number) => {
    const entry = material.texSrts?.[index];
    return {
      ...decomposeSrt(entry?.srtMtx),
      refCamera: entry?.refCamera ?? -1,
      refLight: entry?.refLight ?? -1,
    };
  });

  const channels: GxChannelDoc[] = (gx.lightChannels ?? []).map((channel: any, index: number) => ({
    materialColor: color(material.colorMatRegs?.[index]),
    ambientColor: color(material.colorAmbRegs?.[index]),
    color: {
      lightingEnabled: !!channel?.colorChannel?.lightingEnabled,
      materialSource: channel?.colorChannel?.matColorSource ?? GX.ColorSrc.REG,
      ambientSource: channel?.colorChannel?.ambColorSource ?? GX.ColorSrc.REG,
      litMask: channel?.colorChannel?.litMask ?? 0,
      diffuseFunction: channel?.colorChannel?.diffuseFunction ?? GX.DiffuseFunction.NONE,
      attenuationFunction: channel?.colorChannel?.attenuationFunction ?? GX.AttenuationFunction.NONE,
    },
    alpha: {
      lightingEnabled: !!channel?.alphaChannel?.lightingEnabled,
      materialSource: channel?.alphaChannel?.matColorSource ?? GX.ColorSrc.REG,
      ambientSource: channel?.alphaChannel?.ambColorSource ?? GX.ColorSrc.REG,
      litMask: channel?.alphaChannel?.litMask ?? 0,
      diffuseFunction: channel?.alphaChannel?.diffuseFunction ?? GX.DiffuseFunction.NONE,
      attenuationFunction: channel?.alphaChannel?.attenuationFunction ?? GX.AttenuationFunction.NONE,
    },
  }));

  const tevStages: GxTevStageDoc[] = (gx.tevStages ?? []).map((stage: any) => ({
    colorInA: stage.colorInA, colorInB: stage.colorInB, colorInC: stage.colorInC, colorInD: stage.colorInD,
    colorOp: stage.colorOp, colorBias: stage.colorBias, colorScale: stage.colorScale,
    colorClamp: !!stage.colorClamp, colorRegId: stage.colorRegId,
    alphaInA: stage.alphaInA, alphaInB: stage.alphaInB, alphaInC: stage.alphaInC, alphaInD: stage.alphaInD,
    alphaOp: stage.alphaOp, alphaBias: stage.alphaBias, alphaScale: stage.alphaScale,
    alphaClamp: !!stage.alphaClamp, alphaRegId: stage.alphaRegId,
    texCoordId: stage.texCoordId, texMap: stage.texMap, channelId: stage.channelId,
    konstColorSel: stage.konstColorSel, konstAlphaSel: stage.konstAlphaSel,
    rasSwapTable: 0, texSwapTable: 0,
    indTexStage: stage.indTexStage, indTexFormat: stage.indTexFormat, indTexBiasSel: stage.indTexBiasSel,
    indTexAlphaSel: stage.indTexAlphaSel, indTexMatrix: stage.indTexMatrix,
    indTexWrapS: stage.indTexWrapS, indTexWrapT: stage.indTexWrapT,
    indTexAddPrev: !!stage.indTexAddPrev, indTexUseOrigLOD: !!stage.indTexUseOrigLOD,
  }));

  const ropInfo = gx.ropInfo ?? {};
  const alphaTest = gx.alphaTest ?? {};

  return {
    name: material.name,
    translucent: !!material.translucent,
    cullMode: gx.cullMode ?? GX.CullMode.BACK,
    lightSetIndex: material.lightSetIdx ?? -1,
    fogIndex: material.fogIdx ?? -1,
    texMatrixMode: 'maya',
    samplers,
    texSrts,
    texGens: (gx.texGens ?? []).map((texGen: any) => ({
      type: texGen.type, source: texGen.source, matrix: texGen.matrix,
      normalize: !!texGen.normalize, postMatrix: texGen.postMatrix,
    })),
    channels,
    colorRegisters: [
      colorS10(material.colorRegisters?.[1]),
      colorS10(material.colorRegisters?.[2]),
      colorS10(material.colorRegisters?.[3]),
    ],
    konstColors: [
      color(material.colorConstants?.[0]),
      color(material.colorConstants?.[1]),
      color(material.colorConstants?.[2]),
      color(material.colorConstants?.[3]),
    ],
    swapTables: DEFAULT_SWAP_TABLES.map((table) => [...table] as GxSwapTableDoc) as GxMaterialDoc['swapTables'],
    tevStages,
    indTexStages: (gx.indTexStages ?? []).map((stage: any) => ({
      texCoordId: stage.texCoordId, texMap: stage.texture, scaleS: stage.scaleS, scaleT: stage.scaleT,
    })),
    indMatrices: [0, 1, 2].map((index) => ({
      m: Array.from(material.indTexMatrices?.[index] ?? [1, 0, 0, 0, 1, 0]).slice(0, 6) as
        [number, number, number, number, number, number],
      scaleExp: material.indTexMatrices?.[index]?.[6] ?? 0,
    })) as GxMaterialDoc['indMatrices'],
    alphaTest: {
      compareA: alphaTest.compareA ?? GX.CompareType.ALWAYS,
      referenceA: alphaTest.referenceA ?? 0,
      op: alphaTest.op ?? GX.AlphaOp.AND,
      compareB: alphaTest.compareB ?? GX.CompareType.ALWAYS,
      referenceB: alphaTest.referenceB ?? 0,
    },
    blend: {
      mode: ropInfo.blendMode ?? GX.BlendMode.NONE,
      srcFactor: ropInfo.blendSrcFactor ?? GX.BlendFactor.SRCALPHA,
      dstFactor: ropInfo.blendDstFactor ?? GX.BlendFactor.INVSRCALPHA,
      logicOp: ropInfo.blendLogicOp ?? GX.LogicOp.COPY,
      constantAlphaEnabled: ropInfo.dstAlpha !== undefined,
      constantAlpha: ropInfo.dstAlpha ?? 1,
    },
    depth: {
      test: ropInfo.depthTest !== false,
      func: ropInfo.depthFunc ?? GX.CompareType.LEQUAL,
      write: ropInfo.depthWrite !== false,
      compareBeforeTexture: false,
    },
  };
}

// ------------------------------------------------------------------ contract: writing (placeholder)

function readCString(bytes: Uint8Array, offset: number): string {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return new TextDecoder('utf-8').decode(bytes.subarray(offset, end));
}

/** A fixed-length magic, which is not NUL terminated in a BRRES header. */
function readMagic(bytes: Uint8Array, offset: number, length = 4): string {
  if (offset < 0 || offset + length > bytes.length) return '';
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** The `parseResDic` walk, on plain bytes. Offsets come back absolute. */
function readResDic(bytes: Uint8Array, view: DataView, tableOffs: number): Array<{ name: string; offs: number }> {
  if (tableOffs === 0) return [];
  const count = view.getUint32(tableOffs + 0x04);
  const entries: Array<{ name: string; offs: number }> = [];
  let at = tableOffs + 0x08 + 0x10;
  for (let index = 0; index < count; index++) {
    entries.push({
      name: readCString(bytes, tableOffs + view.getUint32(at + 0x08)),
      offs: tableOffs + view.getUint32(at + 0x0c),
    });
    at += 0x10;
  }
  return entries;
}

/** Absolute offset of a named material's header inside the archive, or -1. */
function locateMaterial(bytes: Uint8Array, view: DataView, modelName: string, materialName: string): number {
  if (bytes.length < 0x10 || readMagic(bytes, 0) !== 'bres') return -1;
  const rootOffs = view.getUint16(0x0c);
  const root = readResDic(bytes, view, rootOffs + 0x08);
  const models = root.find((entry) => entry.name === '3DModels(NW4R)');
  if (!models) return -1;
  const model = readResDic(bytes, view, models.offs).find((entry) => entry.name === modelName);
  if (!model) return -1;

  const version = view.getUint32(model.offs + 0x08);
  let at = model.offs + 0x10;
  const skip = () => { at += 0x04; };
  skip(); skip(); skip(); skip(); skip(); skip(); // byte code, nodes, vtx pos/nrm/clr/txc
  if (version >= 0x0a) { skip(); skip(); }
  const materialDicOffs = view.getUint32(at);
  const materials = readResDic(bytes, view, model.offs + materialDicOffs);
  return materials.find((entry) => entry.name === materialName)?.offs ?? -1;
}

/**
 * Placeholder encoder: rewrites only the material fields that live at fixed offsets in the MDL0
 * material header, which is enough to prove the whole edit → archive → live-preview loop. The
 * TEV block, colour registers, texgens and channels all live in display lists and are the real
 * library's job, so an edit to those comes back with a warning and unchanged bytes.
 */
export function applyMaterial(
  brres: Uint8Array,
  modelName: string,
  materialName: string,
  doc: GxMaterialDoc,
  _options?: ApplyMaterialOptions,
): ApplyMaterialResult {
  const warnings = ['Only the material header is written back yet: cull mode, draw pass, light set, fog and the layer sampler settings. Shader stages, colours and texture matrices preview only.'];
  const out = brres.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const offset = locateMaterial(out, view, modelName, materialName);
  if (offset < 0) {
    throw new GxMaterialError(`${materialName} is not a material in ${modelName}.`);
  }

  const flags = view.getUint32(offset + 0x10);
  view.setUint32(offset + 0x10, doc.translucent ? flags | 0x80000000 : flags & 0x7fffffff);
  view.setUint32(offset + 0x18, doc.cullMode);
  view.setUint8(offset + 0x1c, doc.depth.compareBeforeTexture ? 1 : 0);
  view.setInt8(offset + 0x1d, Math.max(-128, Math.min(127, Math.round(doc.lightSetIndex))));
  view.setInt8(offset + 0x1e, Math.max(-128, Math.min(127, Math.round(doc.fogIndex))));

  const samplerCount = view.getUint32(offset + 0x2c);
  const texPlttOffs = offset + view.getUint32(offset + 0x30);
  for (let index = 0; index < samplerCount; index++) {
    const entryOffs = texPlttOffs + index * 0x34;
    const texMapId = view.getUint32(entryOffs + 0x10);
    const sampler = doc.samplers[texMapId];
    if (!sampler) continue;
    view.setUint32(entryOffs + 0x18, sampler.wrapS);
    view.setUint32(entryOffs + 0x1c, sampler.wrapT);
    view.setUint32(entryOffs + 0x20, sampler.minFilter);
    view.setUint32(entryOffs + 0x24, sampler.magFilter);
    view.setFloat32(entryOffs + 0x28, sampler.lodBias);
    view.setUint32(entryOffs + 0x2c, sampler.maxAnisotropy);
    view.setUint8(entryOffs + 0x30, sampler.biasClamp ? 1 : 0);
    view.setUint8(entryOffs + 0x31, sampler.edgeLod ? 1 : 0);
  }

  return { brres: out, warnings, affectedMaterials: [materialName] };
}

export function addTexture(brres: Uint8Array, _texture: AddTextureOptions): Uint8Array {
  return brres;
}

export function removeTexture(brres: Uint8Array, _name: string): Uint8Array {
  return brres;
}

// ------------------------------------------------------------------ contract: graph

let nextId = 0;
function id(prefix: string): string {
  return `${prefix}${++nextId}`;
}

const NODE_WIDTH = 200;
const COLUMN = 260;
const ROW = 130;

interface SourceRef { node: string; socket: string }

/**
 * One lerp cluster per stage: `lerp(a, b, t)` fed by the stage's A/B/C inputs, with the colour
 * chain on the top row and the alpha chain below it.
 */
export function decompileShader(material: GxMaterialDoc): ShaderGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const push = (node: GraphNode) => { nodes.push(node); return node.id; };
  const connect = (from: SourceRef, to: SourceRef) => {
    edges.push({ id: id('e'), from: { node: from.node, socket: from.socket }, to: { node: to.node, socket: to.socket } });
  };

  let previousColor: SourceRef | null = null;
  let previousAlpha: SourceRef | null = null;

  material.tevStages.forEach((stage, index) => {
    const x = index * COLUMN;
    const perStage = new Map<string, string>();
    const source = (key: string, make: (x: number, y: number) => GraphNode, slot: number): string => {
      const existing = perStage.get(key);
      if (existing) return existing;
      const created = push(make(x - COLUMN * 0.45, slot * 78 - 90));
      perStage.set(key, created);
      return created;
    };

    let slot = 0;
    const colorSource = (input: number): SourceRef | null => {
      switch (input) {
        case GX.CC.CPREV: return previousColor;
        case GX.CC.APREV: return previousAlpha;
        case GX.CC.TEXC: return { node: source('tex', (nx, ny) => textureNode(nx, ny, stage), slot++), socket: 'rgb' };
        case GX.CC.TEXA: return { node: source('tex', (nx, ny) => textureNode(nx, ny, stage), slot++), socket: 'alpha' };
        case GX.CC.RASC: return { node: source('ras', (nx, ny) => channelNode(nx, ny, stage), slot++), socket: 'rgb' };
        case GX.CC.RASA: return { node: source('ras', (nx, ny) => channelNode(nx, ny, stage), slot++), socket: 'alpha' };
        case GX.CC.KONST: return { node: source('konst', (nx, ny) => konstNode(nx, ny, stage), slot++), socket: 'rgb' };
        case GX.CC.C0: case GX.CC.C1: case GX.CC.C2: {
          const registerSlot = (input - GX.CC.C0) / 2;
          return { node: source(`reg${registerSlot}`, (nx, ny) => registerNode(nx, ny, registerSlot), slot++), socket: 'rgb' };
        }
        case GX.CC.A0: case GX.CC.A1: case GX.CC.A2: {
          const registerSlot = (input - GX.CC.A0) / 2;
          return { node: source(`reg${registerSlot}`, (nx, ny) => registerNode(nx, ny, registerSlot), slot++), socket: 'alpha' };
        }
        case GX.CC.ONE: return { node: source('one', (nx, ny) => valueNode(nx, ny, 1), slot++), socket: 'rgb' };
        case GX.CC.HALF: return { node: source('half', (nx, ny) => valueNode(nx, ny, 0.5), slot++), socket: 'rgb' };
        default: return null;
      }
    };
    const alphaSource = (input: number): SourceRef | null => {
      switch (input) {
        case GX.CA.APREV: return previousAlpha;
        case GX.CA.TEXA: return { node: source('tex', (nx, ny) => textureNode(nx, ny, stage), slot++), socket: 'alpha' };
        case GX.CA.RASA: return { node: source('ras', (nx, ny) => channelNode(nx, ny, stage), slot++), socket: 'alpha' };
        case GX.CA.KONST: return { node: source('konst', (nx, ny) => konstNode(nx, ny, stage), slot++), socket: 'alpha' };
        case GX.CA.A0: case GX.CA.A1: case GX.CA.A2:
          return { node: source(`reg${input - GX.CA.A0}`, (nx, ny) => registerNode(nx, ny, input - GX.CA.A0), slot++), socket: 'alpha' };
        default: return null;
      }
    };

    const colorNode: GraphNode = { id: id('n'), type: 'lerp', x, y: -ROW, label: `Stage ${index} colour` };
    push(colorNode);
    // Most retail stages are `D + lerp(0, B, C)` with A = ZERO, so the previous stage arrives on
    // D rather than on A. Folding D into A keeps the chain connected in the graph, which is what
    // this placeholder is for; the real decompiler emits the add explicitly.
    const a = stage.colorInA === GX.CC.ZERO && stage.colorInD !== GX.CC.ZERO
      ? colorSource(stage.colorInD)
      : colorSource(stage.colorInA);
    const b = colorSource(stage.colorInB);
    const t = colorSource(stage.colorInC);
    if (a) connect(a, { node: colorNode.id, socket: 'a' });
    if (b) connect(b, { node: colorNode.id, socket: 'b' });
    if (t) connect(t, { node: colorNode.id, socket: 't' });
    previousColor = { node: colorNode.id, socket: 'out' };

    const alphaNode: GraphNode = { id: id('n'), type: 'lerp', x, y: ROW, label: `Stage ${index} alpha` };
    push(alphaNode);
    const aa = stage.alphaInA === GX.CA.ZERO && stage.alphaInD !== GX.CA.ZERO
      ? alphaSource(stage.alphaInD)
      : alphaSource(stage.alphaInA);
    const ab = alphaSource(stage.alphaInB);
    const at = alphaSource(stage.alphaInC);
    if (aa) connect(aa, { node: alphaNode.id, socket: 'a' });
    if (ab) connect(ab, { node: alphaNode.id, socket: 'b' });
    if (at) connect(at, { node: alphaNode.id, socket: 't' });
    previousAlpha = { node: alphaNode.id, socket: 'out' };
  });

  const output: GraphNode = {
    id: id('n'),
    type: 'output',
    x: Math.max(1, material.tevStages.length) * COLUMN,
    y: 0,
  };
  push(output);
  if (previousColor) connect(previousColor, { node: output.id, socket: 'color' });
  if (previousAlpha) connect(previousAlpha, { node: output.id, socket: 'alpha' });

  return { version: 1, nodes, edges };

  function textureNode(x: number, y: number, stage: GxTevStageDoc): GraphNode {
    return { id: id('n'), type: 'texture', x, y, sampler: stage.texMap === 0xff ? 0 : stage.texMap, texCoord: stage.texCoordId === 0xff ? 0 : stage.texCoordId };
  }
  function channelNode(x: number, y: number, stage: GxTevStageDoc): GraphNode {
    return { id: id('n'), type: 'vertexColor', x, y, channel: stage.channelId === GX.RasColorChannelID.COLOR1A1 ? 1 : 0 };
  }
  function konstNode(x: number, y: number, stage: GxTevStageDoc): GraphNode {
    const sel = stage.konstColorSel;
    const slot = sel >= GX.KonstColorSel.KCSEL_K0 && sel <= GX.KonstColorSel.KCSEL_K3 ? sel - GX.KonstColorSel.KCSEL_K0 : 0;
    return { id: id('n'), type: 'constant', x, y, slot };
  }
  function registerNode(x: number, y: number, slot: number): GraphNode {
    return { id: id('n'), type: 'register', x, y, slot: Math.max(0, Math.min(2, slot)) };
  }
  function valueNode(x: number, y: number, value: 0 | 0.5 | 1): GraphNode {
    return { id: id('n'), type: 'value', x, y, value };
  }
}

function emptyStage(): GxTevStageDoc {
  return {
    colorInA: GX.CC.ZERO, colorInB: GX.CC.ZERO, colorInC: GX.CC.ZERO, colorInD: GX.CC.ZERO,
    colorOp: GX.TevOp.ADD, colorBias: GX.TevBias.ZERO, colorScale: GX.TevScale.SCALE_1,
    colorClamp: true, colorRegId: GX.Register.PREV,
    alphaInA: GX.CA.ZERO, alphaInB: GX.CA.ZERO, alphaInC: GX.CA.ZERO, alphaInD: GX.CA.ZERO,
    alphaOp: GX.TevOp.ADD, alphaBias: GX.TevBias.ZERO, alphaScale: GX.TevScale.SCALE_1,
    alphaClamp: true, alphaRegId: GX.Register.PREV,
    texCoordId: GX.TexCoordID.TEXCOORD_NULL, texMap: GX.TexMapID.TEXMAP_NULL,
    channelId: GX.RasColorChannelID.COLOR_ZERO,
    konstColorSel: GX.KonstColorSel.KCSEL_1, konstAlphaSel: GX.KonstAlphaSel.KASEL_1,
    rasSwapTable: 0, texSwapTable: 0,
    indTexStage: GX.IndTexStageID.STAGE0, indTexFormat: GX.IndTexFormat._8,
    indTexBiasSel: GX.IndTexBiasSel.NONE, indTexAlphaSel: GX.IndTexAlphaSel.OFF,
    indTexMatrix: GX.IndTexMtxID.OFF, indTexWrapS: GX.IndTexWrap.OFF, indTexWrapT: GX.IndTexWrap.OFF,
    indTexAddPrev: false, indTexUseOrigLOD: false,
  };
}

/**
 * Naive lowering: walk the colour and alpha chains back from the output, give every math node its
 * own stage, and zip the two chains onto the same stage list.
 */
export function compileShaderGraph(graph: ShaderGraph, material: GxMaterialDoc): CompiledShader {
  const diagnostics: GraphDiagnostic[] = [];
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, GraphEdge>();
  for (const edge of graph.edges) incoming.set(`${edge.to.node}|${edge.to.socket}`, edge);

  const usage = { samplers: [] as number[], texCoords: [] as number[], channels: [] as number[], konstColors: [] as number[], registers: [] as number[], indTexStages: [] as number[] };
  const note = (list: number[], value: number) => { if (value >= 0 && !list.includes(value)) list.push(value); };

  const output = graph.nodes.find((node) => node.type === 'output');
  if (!output) {
    diagnostics.push({ severity: 'error', message: 'The graph has no Material output node.' });
    return { tevStages: [], diagnostics, ok: false, usage };
  }

  /** Math nodes in evaluation order along one chain. */
  function chain(socket: string): GraphNode[] {
    const list: GraphNode[] = [];
    const seen = new Set<string>();
    let edge = incoming.get(`${output!.id}|${socket}`);
    let node = edge ? byId.get(edge.from.node) : undefined;
    while (node && isMath(node)) {
      if (seen.has(node.id)) {
        diagnostics.push({ severity: 'error', message: 'The graph has a cycle.', nodeId: node.id });
        break;
      }
      seen.add(node.id);
      list.unshift(node);
      const feeder = ['a', 'b', 't', 'x', 'c', 'd']
        .map((name) => incoming.get(`${node!.id}|${name}`))
        .map((candidate) => (candidate ? byId.get(candidate.from.node) : undefined))
        .find((candidate) => candidate && isMath(candidate));
      node = feeder;
    }
    return list;
  }

  const colorChain = chain('color');
  const alphaChain = chain('alpha');
  const stageCount = Math.max(colorChain.length, alphaChain.length);
  if (stageCount === 0) {
    diagnostics.push({ severity: 'warning', message: 'Nothing is wired into the Material node, so the shader draws black.' });
  }
  if (stageCount > 16) {
    diagnostics.push({ severity: 'error', message: `This graph needs ${stageCount} TEV stages; the hardware has 16.` });
    return { tevStages: [], diagnostics, ok: false, usage };
  }

  const tevStages: GxTevStageDoc[] = [];
  for (let index = 0; index < stageCount; index++) {
    const stage = emptyStage();
    const colorNode = colorChain[index];
    const alphaNode = alphaChain[index];
    if (colorNode) applyChainNode(stage, colorNode, index, 'color');
    if (alphaNode) applyChainNode(stage, alphaNode, index, 'alpha');
    tevStages.push(stage);
  }

  const ok = !diagnostics.some((entry) => entry.severity === 'error');
  return { tevStages: ok ? tevStages : [], diagnostics, ok, usage };

  function isMath(node: GraphNode): boolean {
    return node.type === 'multiply' || node.type === 'add' || node.type === 'subtract'
      || node.type === 'lerp' || node.type === 'scale' || node.type === 'compare';
  }

  function applyChainNode(stage: GxTevStageDoc, node: GraphNode, index: number, side: 'color' | 'alpha') {
    const spec = GRAPH_NODE_SOCKETS[node.type];
    const inputs = spec?.inputs ?? [];
    const resolved = inputs.map((input) => {
      const edge = incoming.get(`${node.id}|${input.name}`);
      const from = edge ? byId.get(edge.from.node) : undefined;
      return { input, from, socket: edge?.from.socket ?? '' };
    });

    for (const entry of resolved) {
      if (!entry.from) continue;
      if (entry.from.type === 'texture') {
        stage.texMap = entry.from.sampler as GxTevStageDoc['texMap'];
        stage.texCoordId = entry.from.texCoord as GxTevStageDoc['texCoordId'];
        note(usage.samplers, entry.from.sampler);
        note(usage.texCoords, entry.from.texCoord);
        if (entry.from.sampler >= material.samplers.length) {
          diagnostics.push({ severity: 'error', message: `Layer ${entry.from.sampler + 1} does not exist on this material.`, nodeId: entry.from.id });
        }
      } else if (entry.from.type === 'vertexColor') {
        stage.channelId = (entry.from.channel === 1 ? GX.RasColorChannelID.COLOR1A1 : GX.RasColorChannelID.COLOR0A0) as GxTevStageDoc['channelId'];
        note(usage.channels, entry.from.channel);
      } else if (entry.from.type === 'constant') {
        stage.konstColorSel = (GX.KonstColorSel.KCSEL_K0 + entry.from.slot) as GxTevStageDoc['konstColorSel'];
        stage.konstAlphaSel = (GX.KonstAlphaSel.KASEL_K0_A + entry.from.slot) as GxTevStageDoc['konstAlphaSel'];
        note(usage.konstColors, entry.from.slot);
      } else if (entry.from.type === 'register') {
        note(usage.registers, entry.from.slot);
      } else if (entry.from.type === 'indirectWarp') {
        stage.indTexStage = entry.from.indStage as GxTevStageDoc['indTexStage'];
        stage.indTexMatrix = entry.from.matrix;
        note(usage.indTexStages, entry.from.indStage);
      }
    }

    const pick = (position: number) => {
      const entry = resolved[position];
      if (!entry) return side === 'color' ? GX.CC.ZERO : GX.CA.ZERO;
      if (!entry.from) return literal(entry.input.default ?? 0);
      return sourceFor(entry.from, entry.socket, index);
    };

    if (side === 'color') {
      if (node.type === 'lerp') {
        stage.colorInA = pick(0) as GX.CC; stage.colorInB = pick(1) as GX.CC; stage.colorInC = pick(2) as GX.CC;
      } else if (node.type === 'multiply') {
        stage.colorInA = GX.CC.ZERO; stage.colorInB = pick(0) as GX.CC; stage.colorInC = pick(1) as GX.CC;
      } else if (node.type === 'add' || node.type === 'subtract') {
        stage.colorInD = pick(0) as GX.CC; stage.colorInB = pick(1) as GX.CC; stage.colorInC = GX.CC.ONE;
        stage.colorOp = node.type === 'subtract' ? GX.TevOp.SUB : GX.TevOp.ADD;
      } else if (node.type === 'scale') {
        stage.colorInD = pick(0) as GX.CC;
        stage.colorScale = node.scale === 0.5 ? GX.TevScale.DIVIDE_2 : node.scale === 2 ? GX.TevScale.SCALE_2 : node.scale === 4 ? GX.TevScale.SCALE_4 : GX.TevScale.SCALE_1;
        stage.colorBias = node.bias === 0.5 ? GX.TevBias.ADDHALF : node.bias === -0.5 ? GX.TevBias.SUBHALF : GX.TevBias.ZERO;
        stage.colorClamp = node.clamp;
      } else if (node.type === 'compare') {
        stage.colorInA = pick(0) as GX.CC; stage.colorInB = pick(1) as GX.CC;
        stage.colorInC = pick(2) as GX.CC; stage.colorInD = pick(3) as GX.CC;
        stage.colorOp = node.op;
      }
    } else {
      if (node.type === 'lerp') {
        stage.alphaInA = pick(0) as GX.CA; stage.alphaInB = pick(1) as GX.CA; stage.alphaInC = pick(2) as GX.CA;
      } else if (node.type === 'multiply') {
        stage.alphaInA = GX.CA.ZERO; stage.alphaInB = pick(0) as GX.CA; stage.alphaInC = pick(1) as GX.CA;
      } else if (node.type === 'add' || node.type === 'subtract') {
        stage.alphaInD = pick(0) as GX.CA; stage.alphaInB = pick(1) as GX.CA;
        stage.alphaOp = node.type === 'subtract' ? GX.TevOp.SUB : GX.TevOp.ADD;
      } else if (node.type === 'scale') {
        stage.alphaInD = pick(0) as GX.CA;
        stage.alphaScale = node.scale === 0.5 ? GX.TevScale.DIVIDE_2 : node.scale === 2 ? GX.TevScale.SCALE_2 : node.scale === 4 ? GX.TevScale.SCALE_4 : GX.TevScale.SCALE_1;
        stage.alphaBias = node.bias === 0.5 ? GX.TevBias.ADDHALF : node.bias === -0.5 ? GX.TevBias.SUBHALF : GX.TevBias.ZERO;
        stage.alphaClamp = node.clamp;
      } else if (node.type === 'compare') {
        stage.alphaInA = pick(0) as GX.CA; stage.alphaInB = pick(1) as GX.CA;
        stage.alphaInC = pick(2) as GX.CA; stage.alphaInD = pick(3) as GX.CA;
        stage.alphaOp = node.op;
      }
    }

    function literal(value: number): number {
      if (side === 'color') return value === 1 ? GX.CC.ONE : value === 0.5 ? GX.CC.HALF : GX.CC.ZERO;
      return value === 1 ? GX.CA.KONST : GX.CA.ZERO;
    }

    function sourceFor(from: GraphNode, socket: string, stageIndex: number): number {
      const wantsAlpha = socket === 'alpha' || side === 'alpha';
      switch (from.type) {
        case 'texture': return side === 'color' ? (wantsAlpha ? GX.CC.TEXA : GX.CC.TEXC) : GX.CA.TEXA;
        case 'vertexColor': return side === 'color' ? (wantsAlpha ? GX.CC.RASA : GX.CC.RASC) : GX.CA.RASA;
        case 'constant': return side === 'color' ? GX.CC.KONST : GX.CA.KONST;
        case 'register': {
          const slot = Math.max(0, Math.min(2, from.slot));
          if (side === 'color') return (wantsAlpha ? GX.CC.A0 : GX.CC.C0) + slot * 2;
          return GX.CA.A0 + slot;
        }
        case 'value': return literal(from.value);
        default: {
          // An upstream math node is only reachable as PREV when it is the stage before this one.
          if (stageIndex === 0) {
            diagnostics.push({ severity: 'warning', message: 'This value comes from a node the first stage cannot read; it compiles as zero.', nodeId: from.id });
            return side === 'color' ? GX.CC.ZERO : GX.CA.ZERO;
          }
          return side === 'color' ? (wantsAlpha ? GX.CC.APREV : GX.CC.CPREV) : GX.CA.APREV;
        }
      }
    }
  }
}

// ------------------------------------------------------------------ presets

function preset(id: string, title: string, description: string, samplerCount: number, build: () => ShaderGraph): ShaderGraphPreset {
  return { id, title, description, samplerCount, graph: build() };
}

export const SHADER_GRAPH_PRESETS: ShaderGraphPreset[] = [
  preset('unlit', 'Unlit texture', 'One texture straight to the screen. The simplest usable material.', 1, () => {
    const texture: GraphNode = { id: 'p-tex', type: 'texture', x: 0, y: 0, sampler: 0, texCoord: 0 };
    const output: GraphNode = { id: 'p-out', type: 'output', x: COLUMN, y: 0 };
    return {
      version: 1,
      nodes: [texture, output],
      edges: [
        { id: 'p-e1', from: { node: texture.id, socket: 'rgb' }, to: { node: output.id, socket: 'color' } },
        { id: 'p-e2', from: { node: texture.id, socket: 'alpha' }, to: { node: output.id, socket: 'alpha' } },
      ],
    };
  }),
  preset('lit', 'Texture x vertex colour', 'A texture modulated by the lit vertex channel — what most course surfaces use.', 1, () => {
    const texture: GraphNode = { id: 'p-tex', type: 'texture', x: 0, y: -80, sampler: 0, texCoord: 0 };
    const vertex: GraphNode = { id: 'p-vtx', type: 'vertexColor', x: 0, y: 80, channel: 0 };
    const multiply: GraphNode = { id: 'p-mul', type: 'multiply', x: COLUMN, y: 0 };
    const output: GraphNode = { id: 'p-out', type: 'output', x: COLUMN * 2, y: 0 };
    return {
      version: 1,
      nodes: [texture, vertex, multiply, output],
      edges: [
        { id: 'p-e1', from: { node: texture.id, socket: 'rgb' }, to: { node: multiply.id, socket: 'a' } },
        { id: 'p-e2', from: { node: vertex.id, socket: 'rgb' }, to: { node: multiply.id, socket: 'b' } },
        { id: 'p-e3', from: { node: multiply.id, socket: 'out' }, to: { node: output.id, socket: 'color' } },
        { id: 'p-e4', from: { node: texture.id, socket: 'alpha' }, to: { node: output.id, socket: 'alpha' } },
      ],
    };
  }),
  preset('blend', 'Two-texture blend', 'Blends two layers with the second layer\'s alpha as the mask.', 2, () => {
    const base: GraphNode = { id: 'p-a', type: 'texture', x: 0, y: -110, sampler: 0, texCoord: 0 };
    const detail: GraphNode = { id: 'p-b', type: 'texture', x: 0, y: 110, sampler: 1, texCoord: 1 };
    const lerp: GraphNode = { id: 'p-lerp', type: 'lerp', x: COLUMN, y: 0 };
    const output: GraphNode = { id: 'p-out', type: 'output', x: COLUMN * 2, y: 0 };
    return {
      version: 1,
      nodes: [base, detail, lerp, output],
      edges: [
        { id: 'p-e1', from: { node: base.id, socket: 'rgb' }, to: { node: lerp.id, socket: 'a' } },
        { id: 'p-e2', from: { node: detail.id, socket: 'rgb' }, to: { node: lerp.id, socket: 'b' } },
        { id: 'p-e3', from: { node: detail.id, socket: 'alpha' }, to: { node: lerp.id, socket: 't' } },
        { id: 'p-e4', from: { node: lerp.id, socket: 'out' }, to: { node: output.id, socket: 'color' } },
        { id: 'p-e5', from: { node: base.id, socket: 'alpha' }, to: { node: output.id, socket: 'alpha' } },
      ],
    };
  }),
  preset('tint', 'Tinted texture', 'A texture multiplied by an editable constant colour.', 1, () => {
    const texture: GraphNode = { id: 'p-tex', type: 'texture', x: 0, y: -80, sampler: 0, texCoord: 0 };
    const tint: GraphNode = { id: 'p-k', type: 'constant', x: 0, y: 80, slot: 0 };
    const multiply: GraphNode = { id: 'p-mul', type: 'multiply', x: COLUMN, y: 0 };
    const output: GraphNode = { id: 'p-out', type: 'output', x: COLUMN * 2, y: 0 };
    return {
      version: 1,
      nodes: [texture, tint, multiply, output],
      edges: [
        { id: 'p-e1', from: { node: texture.id, socket: 'rgb' }, to: { node: multiply.id, socket: 'a' } },
        { id: 'p-e2', from: { node: tint.id, socket: 'rgb' }, to: { node: multiply.id, socket: 'b' } },
        { id: 'p-e3', from: { node: multiply.id, socket: 'out' }, to: { node: output.id, socket: 'color' } },
        { id: 'p-e4', from: { node: texture.id, socket: 'alpha' }, to: { node: output.id, socket: 'alpha' } },
      ],
    };
  }),
];

// ------------------------------------------------------------------ defaults

export function createDefaultMaterialDoc(name = 'new_material'): GxMaterialDoc {
  return {
    name,
    translucent: false,
    cullMode: GX.CullMode.BACK,
    lightSetIndex: -1,
    fogIndex: -1,
    texMatrixMode: 'maya',
    samplers: [],
    texSrts: [],
    texGens: [],
    channels: [],
    colorRegisters: [
      { r: 0, g: 0, b: 0, a: 0 },
      { r: 0, g: 0, b: 0, a: 0 },
      { r: 0, g: 0, b: 0, a: 0 },
    ],
    konstColors: [
      { r: 1, g: 1, b: 1, a: 1 },
      { r: 1, g: 1, b: 1, a: 1 },
      { r: 1, g: 1, b: 1, a: 1 },
      { r: 1, g: 1, b: 1, a: 1 },
    ],
    swapTables: DEFAULT_SWAP_TABLES.map((table) => [...table] as GxSwapTableDoc) as GxMaterialDoc['swapTables'],
    tevStages: [],
    indTexStages: [],
    indMatrices: [
      { m: [1, 0, 0, 0, 1, 0], scaleExp: 0 },
      { m: [1, 0, 0, 0, 1, 0], scaleExp: 0 },
      { m: [1, 0, 0, 0, 1, 0], scaleExp: 0 },
    ],
    alphaTest: {
      compareA: GX.CompareType.ALWAYS,
      referenceA: 0,
      op: GX.AlphaOp.AND,
      compareB: GX.CompareType.ALWAYS,
      referenceB: 0,
    },
    blend: {
      mode: GX.BlendMode.NONE,
      srcFactor: GX.BlendFactor.SRCALPHA,
      dstFactor: GX.BlendFactor.INVSRCALPHA,
      logicOp: GX.LogicOp.COPY,
      constantAlphaEnabled: false,
      constantAlpha: 1,
    },
    depth: { test: true, func: GX.CompareType.LEQUAL, write: true, compareBeforeTexture: false },
  };
}
