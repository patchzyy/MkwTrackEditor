// The material / shader editor's library half.
//
// `src/ui/material/` talks to this module and nothing below it: it never touches MDL0 bytes and
// never implements TEV semantics. See `docs/MATERIALS.md` for the format notes and the compiler's
// lowering rules, and `./types.ts` for the contract the two halves share.

export {
  listArchiveMaterials,
  decodeMaterial,
  applyMaterial,
  addTexture,
  removeTexture,
  renameTexture,
} from './archive';

export {
  createDefaultMaterialDoc,
  createDefaultSampler,
  createDefaultTexSrt,
  createDefaultTexGen,
  createDefaultChannel,
  createDefaultStage,
  createPassThroughStage,
  DEFAULT_SWAP_TABLES,
} from './defaults';

export { compileShaderGraph } from './shaderGraph';
export { decompileShader } from './decompile';
export { SHADER_GRAPH_PRESETS, PRESET_WANTS_LIGHTING } from './presets';

export { GX_LIMITS, collectMaterialIssues, validateMaterialDoc } from './materialCodec';
export type { MaterialIssue } from './materialCodec';

export { GxMaterialError, GRAPH_NODE_SOCKETS, withCompiledShader } from './types';
export type * from './types';
