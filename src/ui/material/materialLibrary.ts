// Lazily loads `src/lib/gxMaterial/`, so the BRRES parser it sits on is only fetched when
// somebody actually opens Material mode. Every function it exposes is synchronous once loaded —
// this is only about *when* the module arrives, not about making the contract async.
import type {
  AddTexture,
  ApplyMaterial,
  CompileShaderGraph,
  DecodeMaterial,
  DecompileShader,
  GxMaterialDoc,
  ListArchiveMaterials,
  RemoveTexture,
  ShaderGraphPreset,
} from '../../lib/gxMaterial';

export interface GxMaterialLibrary {
  listArchiveMaterials: ListArchiveMaterials;
  decodeMaterial: DecodeMaterial;
  applyMaterial: ApplyMaterial;
  addTexture: AddTexture;
  removeTexture: RemoveTexture;
  compileShaderGraph: CompileShaderGraph;
  decompileShader: DecompileShader;
  SHADER_GRAPH_PRESETS: ShaderGraphPreset[];
  createDefaultMaterialDoc: (name?: string) => GxMaterialDoc;
}

let pending: Promise<GxMaterialLibrary> | null = null;

export function loadMaterialLibrary(): Promise<GxMaterialLibrary> {
  if (pending === null) pending = import('../../lib/gxMaterial').then((module) => module as unknown as GxMaterialLibrary);
  return pending;
}
