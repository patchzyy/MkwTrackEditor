// Material editor contract.
//
// The material editor lets a user author a Mario Kart Wii material: its textures (samplers),
// texture-coordinate generators, lighting channels, the TEV combiner stages that make up the
// "shader", and the fixed-function state around it (blend, alpha test, depth, cull). This file
// is the boundary between the two halves of the feature:
//
//   - `src/lib/gxMaterial/` implements everything below on top of the BRRES writer in
//     `src/lib/brres/`: decode a material out of an MDL0, encode it back, keep the archive
//     consistent (shared shaders, texture link table, sampler tables), and compile / decompile
//     the node graph.
//   - `src/ui/material/` renders the graph editor, the inspector, the stage table and the live
//     preview. It never touches MDL0 bytes directly and never implements TEV semantics itself.
//
// Numeric fields use the GX enums from the vendored noclip renderer (`gx_enum.ts`) so the UI,
// the encoder and the renderer's own material parser all agree on values. The BRRES material
// layout being targeted is MDL0 version 11 (what every Mario Kart Wii course and object ships).
//
// Everything here is plain data: JSON-serialisable, no classes, no methods, so documents can be
// put in the editor history, diffed, and stored in IndexedDB.

import type * as GX from '../../../vendor/noclip.website/src/gx/gx_enum';

// ---------------------------------------------------------------------------------------------
// Material document
// ---------------------------------------------------------------------------------------------

/** 0..1 floats. Colors are stored unpremultiplied. */
export interface GxColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** `s10` TEV color register value, -1024..1023 per channel (the hardware range). */
export interface GxColorS10 {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A texture slot on the material. Index in `GxMaterialDoc.samplers` is the `GX.TexMapID`. */
export interface GxSamplerDoc {
  /** TEX0 name in the same BRRES (`Textures(NW4R)`). */
  texture: string;
  /** PLT0 name for paletted textures, or `''`. */
  palette: string;
  wrapS: GX.WrapMode;
  wrapT: GX.WrapMode;
  minFilter: GX.TexFilter;
  magFilter: GX.TexFilter;
  /** LOD bias, -4..3.99 in game units. */
  lodBias: number;
  maxAnisotropy: GX.Anisotropy;
  biasClamp: boolean;
  edgeLod: boolean;
  /** Layer "type" byte the game stores next to the sampler; keep whatever was there. */
  mapMode: GxMapMode;
  /**
   * Palette (TLUT) slot the layer binds. Almost always 0; a few retail layers use 1. The decoder
   * always fills it in, and the encoder keeps whatever was stored when it is left undefined.
   */
  tlutId?: number;
}

/** How a layer's texture matrix is driven. Matches `MapMode` in the vendored `brres.ts`. */
export type GxMapMode = 'texcoord' | 'envCamera' | 'projection' | 'envLight' | 'envSpec';

/** Per-layer texture SRT and matrix mode, applied to `texGens[i]` for the same `i`. */
export interface GxTexSrtDoc {
  scaleS: number;
  scaleT: number;
  /** Degrees. */
  rotation: number;
  translateS: number;
  translateT: number;
  /** Which camera (`SCN0`) an env/projection matrix refers to, or -1. */
  refCamera: number;
  refLight: number;
}

export type GxTexMatrixMode = 'maya' | 'xsi' | 'max';

/** One texture-coordinate generator (XF). Index is the `GX.TexCoordID`. */
export interface GxTexGenDoc {
  type: GX.TexGenType;
  source: GX.TexGenSrc;
  matrix: GX.TexGenMatrix;
  normalize: boolean;
  postMatrix: GX.PostTexGenMatrix;
}

/** One lighting channel (color + alpha halves). Index 0/1 is the `GX.ColorChannelID` pair. */
export interface GxChannelDoc {
  /** Material color, used when `colorMaterialSource` is `REG`. */
  materialColor: GxColor;
  /** Ambient color, used when `colorAmbientSource` is `REG`. */
  ambientColor: GxColor;
  color: GxChannelControlDoc;
  alpha: GxChannelControlDoc;
}

export interface GxChannelControlDoc {
  lightingEnabled: boolean;
  materialSource: GX.ColorSrc;
  ambientSource: GX.ColorSrc;
  /** Bitmask of the 8 scene lights. */
  litMask: number;
  diffuseFunction: GX.DiffuseFunction;
  attenuationFunction: GX.AttenuationFunction;
}

/** One TEV stage. Mirrors noclip's `TevStage` field for field, minus renderer-only extras. */
export interface GxTevStageDoc {
  colorInA: GX.CC;
  colorInB: GX.CC;
  colorInC: GX.CC;
  colorInD: GX.CC;
  colorOp: GX.TevOp;
  colorBias: GX.TevBias;
  colorScale: GX.TevScale;
  colorClamp: boolean;
  colorRegId: GX.Register;

  alphaInA: GX.CA;
  alphaInB: GX.CA;
  alphaInC: GX.CA;
  alphaInD: GX.CA;
  alphaOp: GX.TevOp;
  alphaBias: GX.TevBias;
  alphaScale: GX.TevScale;
  alphaClamp: boolean;
  alphaRegId: GX.Register;

  texCoordId: GX.TexCoordID;
  texMap: GX.TexMapID;
  channelId: GX.RasColorChannelID;
  konstColorSel: GX.KonstColorSel;
  konstAlphaSel: GX.KonstAlphaSel;
  /** 0..3, index into `GxMaterialDoc.swapTables`. */
  rasSwapTable: number;
  texSwapTable: number;

  indTexStage: GX.IndTexStageID;
  indTexFormat: GX.IndTexFormat;
  indTexBiasSel: GX.IndTexBiasSel;
  indTexAlphaSel: GX.IndTexAlphaSel;
  indTexMatrix: GX.IndTexMtxID;
  indTexWrapS: GX.IndTexWrap;
  indTexWrapT: GX.IndTexWrap;
  indTexAddPrev: boolean;
  indTexUseOrigLOD: boolean;
}

/** `[r, g, b, a]` as `GX.TevColorChan` values. */
export type GxSwapTableDoc = [GX.TevColorChan, GX.TevColorChan, GX.TevColorChan, GX.TevColorChan];

export interface GxIndTexStageDoc {
  texCoordId: GX.TexCoordID;
  texMap: GX.TexMapID;
  scaleS: GX.IndTexScale;
  scaleT: GX.IndTexScale;
}

/**
 * 2x3 indirect matrix (row-major, `[a b c; d e f]`) plus its power-of-two scale exponent.
 *
 * `m` holds the *effective* coefficients, i.e. the 11-bit signed hardware values already
 * multiplied by `2 ** scaleExp`. The hardware stores a 6-bit exponent field biased by 27, so
 * `scaleExp` runs -27..36 and the encoder recovers the integer coefficients exactly.
 */
export interface GxIndMatrixDoc {
  m: [number, number, number, number, number, number];
  scaleExp: number;
}

export interface GxAlphaTestDoc {
  compareA: GX.CompareType;
  referenceA: number;
  op: GX.AlphaOp;
  compareB: GX.CompareType;
  referenceB: number;
}

export interface GxBlendDoc {
  mode: GX.BlendMode;
  srcFactor: GX.BlendFactor;
  dstFactor: GX.BlendFactor;
  logicOp: GX.LogicOp;
  /** Whether the "constant alpha" (dst alpha) register is enabled, and its value 0..1. */
  constantAlphaEnabled: boolean;
  constantAlpha: number;
}

export interface GxDepthDoc {
  test: boolean;
  func: GX.CompareType;
  write: boolean;
  /** `zCompLoc`: compare before texturing (true) or after (false). */
  compareBeforeTexture: boolean;
}

/**
 * Everything the MDL0 stores for one material, in editable form. Array lengths are the live
 * counts, not the hardware maximums: `samplers.length` is the number of layers (<= 8),
 * `tevStages.length` the number of stages (<= 16), `indTexStages.length` <= 4,
 * `texGens.length` <= 8 and `channels.length` <= 2.
 */
export interface GxMaterialDoc {
  name: string;
  /** Draw in the translucent pass (`DrawXlu`) instead of the opaque pass. */
  translucent: boolean;
  cullMode: GX.CullMode;
  /** SCN0 light set index, or -1. */
  lightSetIndex: number;
  /** SCN0 fog index, or -1. */
  fogIndex: number;
  texMatrixMode: GxTexMatrixMode;

  samplers: GxSamplerDoc[];
  /** One per sampler, same index. */
  texSrts: GxTexSrtDoc[];
  texGens: GxTexGenDoc[];
  channels: GxChannelDoc[];

  /** TEV color registers C0..C2 (`GX.Register.REG0..REG2`) initial values. */
  colorRegisters: [GxColorS10, GxColorS10, GxColorS10];
  /** Konst colors K0..K3. */
  konstColors: [GxColor, GxColor, GxColor, GxColor];
  swapTables: [GxSwapTableDoc, GxSwapTableDoc, GxSwapTableDoc, GxSwapTableDoc];
  tevStages: GxTevStageDoc[];
  indTexStages: GxIndTexStageDoc[];
  indMatrices: [GxIndMatrixDoc, GxIndMatrixDoc, GxIndMatrixDoc];

  alphaTest: GxAlphaTestDoc;
  blend: GxBlendDoc;
  depth: GxDepthDoc;
}

// ---------------------------------------------------------------------------------------------
// Locating materials inside an archive
// ---------------------------------------------------------------------------------------------

/** Where a material lives. `archivePath` is the path inside the track (`./course_model.brres`). */
export interface GxMaterialRef {
  archivePath: string;
  modelName: string;
  materialName: string;
}

export interface GxMaterialSummary extends GxMaterialRef {
  index: number;
  translucent: boolean;
  /** Layer texture names, for the outliner. */
  textures: string[];
  stageCount: number;
  /** Names of the other materials that share this material's TEV shader block. */
  sharedShaderWith: string[];
  /** Mesh (shape) names drawn with this material. */
  meshes: string[];
}

export interface GxTextureSummary {
  name: string;
  width: number;
  height: number;
  format: GX.TexFormat;
  mipCount: number;
  /** Materials in the same archive that sample it. */
  usedBy: string[];
}

export interface GxModelMaterials {
  modelName: string;
  materials: GxMaterialSummary[];
}

export interface GxArchiveMaterials {
  archivePath: string;
  models: GxModelMaterials[];
  textures: GxTextureSummary[];
}

// ---------------------------------------------------------------------------------------------
// Library API (implemented by `src/lib/gxMaterial/`)
// ---------------------------------------------------------------------------------------------

/** Lists every model, material and texture in a BRRES. Cheap; no display-list decoding. */
export type ListArchiveMaterials = (archivePath: string, brres: Uint8Array) => GxArchiveMaterials;

/** Decodes one material (header, samplers, display lists, shared TEV block) into a document. */
export type DecodeMaterial = (brres: Uint8Array, modelName: string, materialName: string) => GxMaterialDoc;

export interface ApplyMaterialOptions {
  /**
   * When the material's TEV shader block is shared with other materials and the TEV part of
   * `doc` differs from what is stored, `'clone'` gives this material its own shader block and
   * `'shared'` rewrites the shared block (changing every material that uses it). Default `'clone'`.
   */
  sharedShader?: 'clone' | 'shared';
}

export interface ApplyMaterialResult {
  /** The whole archive, rewritten. Byte-identical to the input when `doc` matches what was stored. */
  brres: Uint8Array;
  /** Anything the encoder had to change or drop, in user-facing words. */
  warnings: string[];
  /** Materials whose rendering changed as a result (includes `materialName`). */
  affectedMaterials: string[];
}

/**
 * Writes `doc` back over the named material and returns the rewritten archive. Handles: growing
 * or shrinking the sampler / texgen / stage counts (relocating the material block when it no
 * longer fits), the MDL0 texture-link table, the MDL0 header counts, shared shader blocks, and
 * renaming when `doc.name` differs. Throws `GxMaterialError` when `doc` is out of hardware range.
 */
export type ApplyMaterial = (
  brres: Uint8Array,
  modelName: string,
  materialName: string,
  doc: GxMaterialDoc,
  options?: ApplyMaterialOptions,
) => ApplyMaterialResult;

export interface AddTextureOptions {
  name: string;
  format: GX.TexFormat;
  width: number;
  height: number;
  mipCount: number;
  /** Encoded GX texel data for every mip level, as produced by `encodeTex0Data`. */
  data: Uint8Array;
}

/** Adds (or replaces, when the name exists) a TEX0 in the archive. Returns the rewritten archive. */
export type AddTexture = (brres: Uint8Array, texture: AddTextureOptions) => Uint8Array;

/** Removes a TEX0 nobody samples. Throws `GxMaterialError` if a material still uses it. */
export type RemoveTexture = (brres: Uint8Array, name: string) => Uint8Array;

export class GxMaterialError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GxMaterialError';
  }
}

// ---------------------------------------------------------------------------------------------
// Shader graph
// ---------------------------------------------------------------------------------------------
//
// The graph is the authoring model; TEV stages are the target. Every node maps onto something
// the GX TEV can do in one stage, so the compiler is a lowering pass rather than a search.
// A TEV stage computes, for color and alpha independently:
//
//     out = clamp?( (d + lerp(a, b, c) [+/- via op] + bias) * scale )
//
// where a, b, c, d each come from: the previous stage's result (PREV), one of three registers
// (C0..C2), the stage's texture (TEXC / TEXA), the stage's rasterised channel (RASC / RASA), one
// konst color (KONST), or the constants ZERO / HALF / ONE. One stage binds at most one texture,
// one texcoord, one raster channel and one konst selection.
//
// Sockets carry either `rgb` or `alpha`. A texture node exposes both. There is no `rgba` wire:
// the color and alpha pipelines are compiled separately and zipped onto the same stages.

export type GraphSocketType = 'rgb' | 'alpha';

export type GraphNodeType =
  | 'output' // the material result: `color` (rgb) and `alpha` (alpha) inputs
  | 'texture' // sample a layer: outputs `rgb`, `alpha`
  | 'vertexColor' // rasterised channel 0/1 (vertex color, lit when the channel says so): `rgb`, `alpha`
  | 'constant' // a konst color: `rgb`, `alpha`
  | 'register' // initial value of C0..C2: `rgb`, `alpha`
  | 'value' // ZERO / HALF / ONE literal: `rgb`, `alpha`
  | 'multiply' // a * b
  | 'add' // a + b
  | 'subtract' // a - b
  | 'lerp' // lerp(a, b, t): (1 - t) * a + t * b
  | 'scale' // x * (0.5 | 1 | 2 | 4), optional +/- 0.5 bias, optional clamp
  | 'compare' // TEV compare op: (a op b) ? c : 0, plus d; advanced
  | 'indirectWarp' // advanced: routes an indirect stage into the texture sampled by its consumer
  | 'rawStage' // escape hatch: one verbatim TEV stage the graph cannot express; read-only
  | 'comment';

export interface GraphNodeBase {
  id: string;
  type: GraphNodeType;
  /** Graph-space position, top-left of the node. */
  x: number;
  y: number;
  /** Free text under the title. */
  label?: string;
  /**
   * Optional. A TEV stage stores fields the graph has no opinion about: the konst selections and
   * raster channel it names even when it reads neither, the swap tables, the indirect setup. When
   * this node is the root of the cluster that becomes a stage, those fields are taken from here.
   * The decompiler fills it in so recompiling an untouched graph reproduces the material exactly;
   * the editor never has to show it, and a node built by hand may leave it out.
   */
  stageTemplate?: GxTevStageDoc;
}

export interface GraphOutputNode extends GraphNodeBase {
  type: 'output';
}

export interface GraphTextureNode extends GraphNodeBase {
  type: 'texture';
  /** Index into `GxMaterialDoc.samplers`. */
  sampler: number;
  /** Which texgen feeds the sampler; usually the same index. */
  texCoord: number;
}

export interface GraphVertexColorNode extends GraphNodeBase {
  type: 'vertexColor';
  /** 0 or 1. */
  channel: number;
}

export interface GraphConstantNode extends GraphNodeBase {
  type: 'constant';
  /** 0..3, into `GxMaterialDoc.konstColors`. */
  slot: number;
  /**
   * Optional. The exact konst selection to use, for the cases `slot` cannot name: the eight
   * hardware fractions (1, 7/8 ... 1/8) and the single-channel reads (`K1[GGG]`). Defaults to
   * `KCSEL_K{slot}` / `KASEL_K{slot}_A`.
   */
  colorSel?: GX.KonstColorSel;
  alphaSel?: GX.KonstAlphaSel;
}

export interface GraphRegisterNode extends GraphNodeBase {
  type: 'register';
  /** 0..2, into `GxMaterialDoc.colorRegisters`. */
  slot: number;
}

export interface GraphValueNode extends GraphNodeBase {
  type: 'value';
  value: 0 | 0.5 | 1;
}

export interface GraphMathNode extends GraphNodeBase {
  type: 'multiply' | 'add' | 'subtract' | 'lerp';
}

export interface GraphScaleNode extends GraphNodeBase {
  type: 'scale';
  scale: 0.5 | 1 | 2 | 4;
  bias: -0.5 | 0 | 0.5;
  clamp: boolean;
}

export interface GraphCompareNode extends GraphNodeBase {
  type: 'compare';
  op: GX.TevOp;
}

export interface GraphIndirectWarpNode extends GraphNodeBase {
  type: 'indirectWarp';
  /** Index into `GxMaterialDoc.indTexStages`. */
  indStage: number;
  matrix: GX.IndTexMtxID;
  format: GX.IndTexFormat;
  bias: GX.IndTexBiasSel;
  wrapS: GX.IndTexWrap;
  wrapT: GX.IndTexWrap;
  addPrevious: boolean;
}

export interface GraphCommentNode extends GraphNodeBase {
  type: 'comment';
  width: number;
  height: number;
  text: string;
}

/**
 * A TEV stage the node vocabulary cannot express — a color input the graph has no node for
 * (`CC.RASA`), a non-default swap table, a compare op the `compare` node does not cover. The
 * decompiler emits one of these instead of guessing, and the compiler copies `stage` out
 * verbatim (its binding checks still apply). The editor renders it as a read-only card.
 *
 * The `prev` input carries no value; it only says which stage runs before this one, so a chain of
 * raw stages keeps its order. Both outputs are the stage's result, read back from whichever
 * register it writes.
 */
export interface GraphRawStageNode extends GraphNodeBase {
  type: 'rawStage';
  stage: GxTevStageDoc;
}

export type GraphNode =
  | GraphOutputNode
  | GraphTextureNode
  | GraphVertexColorNode
  | GraphConstantNode
  | GraphRegisterNode
  | GraphValueNode
  | GraphMathNode
  | GraphScaleNode
  | GraphCompareNode
  | GraphIndirectWarpNode
  | GraphRawStageNode
  | GraphCommentNode;

/** A wire. Socket names are fixed per node type; see `GRAPH_NODE_SOCKETS`. */
export interface GraphEdge {
  id: string;
  from: { node: string; socket: string };
  to: { node: string; socket: string };
}

export interface ShaderGraph {
  /** Bump when the shape of this type changes; documents with an older version are re-decompiled. */
  version: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphSocketSpec {
  name: string;
  type: GraphSocketType;
  /** For inputs: what the compiler assumes when nothing is wired. */
  default?: 0 | 0.5 | 1;
}

export interface GraphNodeSpec {
  title: string;
  inputs: GraphSocketSpec[];
  outputs: GraphSocketSpec[];
}

/**
 * Socket layout per node type. Math nodes are polymorphic: every input and output takes the
 * type of whatever is wired in first, and all sockets of one math node must agree.
 */
export const GRAPH_NODE_SOCKETS: Readonly<Record<GraphNodeType, GraphNodeSpec>> = Object.freeze({
  output: { title: 'Material', inputs: [{ name: 'color', type: 'rgb', default: 0 }, { name: 'alpha', type: 'alpha', default: 1 }], outputs: [] },
  texture: { title: 'Texture', inputs: [{ name: 'uv', type: 'rgb' }], outputs: [{ name: 'rgb', type: 'rgb' }, { name: 'alpha', type: 'alpha' }] },
  vertexColor: { title: 'Vertex color', inputs: [], outputs: [{ name: 'rgb', type: 'rgb' }, { name: 'alpha', type: 'alpha' }] },
  constant: { title: 'Color', inputs: [], outputs: [{ name: 'rgb', type: 'rgb' }, { name: 'alpha', type: 'alpha' }] },
  register: { title: 'Register', inputs: [], outputs: [{ name: 'rgb', type: 'rgb' }, { name: 'alpha', type: 'alpha' }] },
  value: { title: 'Value', inputs: [], outputs: [{ name: 'rgb', type: 'rgb' }, { name: 'alpha', type: 'alpha' }] },
  multiply: { title: 'Multiply', inputs: [{ name: 'a', type: 'rgb', default: 1 }, { name: 'b', type: 'rgb', default: 1 }], outputs: [{ name: 'out', type: 'rgb' }] },
  add: { title: 'Add', inputs: [{ name: 'a', type: 'rgb', default: 0 }, { name: 'b', type: 'rgb', default: 0 }], outputs: [{ name: 'out', type: 'rgb' }] },
  subtract: { title: 'Subtract', inputs: [{ name: 'a', type: 'rgb', default: 0 }, { name: 'b', type: 'rgb', default: 0 }], outputs: [{ name: 'out', type: 'rgb' }] },
  lerp: { title: 'Lerp', inputs: [{ name: 'a', type: 'rgb', default: 0 }, { name: 'b', type: 'rgb', default: 1 }, { name: 't', type: 'rgb', default: 0.5 }], outputs: [{ name: 'out', type: 'rgb' }] },
  scale: { title: 'Scale', inputs: [{ name: 'x', type: 'rgb', default: 0 }], outputs: [{ name: 'out', type: 'rgb' }] },
  compare: { title: 'Compare', inputs: [{ name: 'a', type: 'rgb', default: 0 }, { name: 'b', type: 'rgb', default: 0 }, { name: 'c', type: 'rgb', default: 1 }, { name: 'd', type: 'rgb', default: 0 }], outputs: [{ name: 'out', type: 'rgb' }] },
  indirectWarp: { title: 'Indirect warp', inputs: [{ name: 'bump', type: 'rgb' }], outputs: [{ name: 'uv', type: 'rgb' }] },
  rawStage: { title: 'Raw stage', inputs: [{ name: 'prev', type: 'rgb' }], outputs: [{ name: 'out', type: 'rgb' }, { name: 'alpha', type: 'alpha' }] },
  comment: { title: 'Comment', inputs: [], outputs: [] },
});

// ---------------------------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------------------------

export type GraphDiagnosticSeverity = 'error' | 'warning';

export interface GraphDiagnostic {
  severity: GraphDiagnosticSeverity;
  message: string;
  /** Node the message is about, for the badge in the editor. */
  nodeId?: string;
  edgeId?: string;
}

export interface CompiledShader {
  /** Zero stages when `ok` is false. */
  tevStages: GxTevStageDoc[];
  /** Stage-level view for the "Stages" panel and for the decompiler round trip. */
  diagnostics: GraphDiagnostic[];
  ok: boolean;
  /** Which samplers / texgens / channels / konst / registers / indirect stages the shader uses. */
  usage: {
    samplers: number[];
    texCoords: number[];
    channels: number[];
    konstColors: number[];
    registers: number[];
    indTexStages: number[];
  };
}

/**
 * Lowers a graph to TEV stages against the current material (the compiler needs to know how
 * many samplers, channels and indirect stages exist). Pure and deterministic: the same graph
 * always yields the same stages. Never throws; problems come back as diagnostics.
 */
export type CompileShaderGraph = (graph: ShaderGraph, material: GxMaterialDoc) => CompiledShader;

/**
 * Builds a graph that reproduces `material.tevStages` exactly: one lerp / add / scale cluster
 * per stage, textures and channels as source nodes, registers wired through. Compiling the
 * result gives back the same stages (`compile(decompile(m), m).tevStages` deep-equals
 * `m.tevStages` for every retail material). Node positions are laid out left to right by stage.
 */
export type DecompileShader = (material: GxMaterialDoc) => ShaderGraph;

/** Applies a compile result to a document without touching anything but the TEV part. */
export function withCompiledShader(material: GxMaterialDoc, compiled: CompiledShader): GxMaterialDoc {
  return { ...material, tevStages: compiled.tevStages.map((stage) => ({ ...stage })) };
}

// ---------------------------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------------------------

/** Ready-made graphs the "New material" and "Reset shader" menus offer. */
export interface ShaderGraphPreset {
  id: string;
  title: string;
  description: string;
  /** How many samplers the preset expects; the UI adds empty layers to match. */
  samplerCount: number;
  graph: ShaderGraph;
}
