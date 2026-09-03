// The surface `src/ui/material/` imports.
//
// The UI reaches this module and nothing below it, so a missing export here breaks the editor at
// build time rather than at test time. Exercising the barrel keeps that honest.

import { describe, expect, it } from 'vitest';
import * as gxMaterial from './index';
import {
  GRAPH_NODE_SOCKETS,
  GxMaterialError,
  SHADER_GRAPH_PRESETS,
  compileShaderGraph,
  createDefaultMaterialDoc,
  decompileShader,
  withCompiledShader,
} from './index';

describe('gxMaterial barrel', () => {
  it('exports everything the editor is built against', () => {
    for (const name of [
      'listArchiveMaterials', 'decodeMaterial', 'applyMaterial', 'addTexture', 'removeTexture',
      'renameTexture', 'compileShaderGraph', 'decompileShader', 'createDefaultMaterialDoc',
      'GxMaterialError', 'withCompiledShader',
    ]) {
      expect(typeof (gxMaterial as Record<string, unknown>)[name], name).toBe('function');
    }
    expect(Array.isArray(SHADER_GRAPH_PRESETS)).toBe(true);
    expect(typeof GRAPH_NODE_SOCKETS).toBe('object');
    expect(GxMaterialError.prototype).toBeInstanceOf(Error);
    expect(Object.keys(GRAPH_NODE_SOCKETS)).toContain('rawStage');
  });

  it('makes a material a new track can actually use', () => {
    const doc = createDefaultMaterialDoc('road');
    expect(doc.name).toBe('road');
    expect(doc.samplers).toHaveLength(1);
    expect(doc.texGens).toHaveLength(1);
    expect(doc.texSrts).toHaveLength(1);
    expect(doc.channels).toHaveLength(1);
    expect(doc.tevStages).toHaveLength(1);
    expect(doc.translucent).toBe(false);

    // The default material is the same one-stage shader the "texture x vertex colour" preset
    // describes, so opening a new material and looking at its graph shows exactly that.
    const compiled = compileShaderGraph(SHADER_GRAPH_PRESETS[0].graph, doc);
    expect(compiled.ok).toBe(true);
    expect(compiled.tevStages).toEqual(doc.tevStages);

    // And it survives the trip through the graph editor untouched.
    const again = compileShaderGraph(decompileShader(doc), doc);
    expect(withCompiledShader(doc, again)).toEqual(doc);
  });
});
