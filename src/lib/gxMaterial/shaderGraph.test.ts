// Shader graph compiler and decompiler.
//
// The headline test is the round trip: decompiling a real material and compiling the result has
// to give back the very same TEV stages. That is the promise the editor makes when it opens a
// material — look at it, change nothing, save, and the track is unchanged.

import { describe, expect, it } from 'vitest';
import * as GX from '../../../vendor/noclip.website/src/gx/gx_enum';
import { BRRES_MODELS_GROUP, makeSubFileNameReader, readBrresRaw } from '../brres/brresRaw';
import { Mdl0Editor } from '../brres/mdl0Raw';
import { listMaterialArchives } from './materialFixtures.testdata';
import { MATERIAL_FIELDS as MAT, TEV_BLOCK_SIZE, decodeMaterialBlock } from './materialCodec';
import { compileShaderGraph } from './shaderGraph';
import { decompileShader } from './decompile';
import { SHADER_GRAPH_PRESETS } from './presets';
import { createDefaultMaterialDoc, createDefaultStage, createPassThroughStage } from './defaults';
import type { GraphEdge, GraphNode, GxMaterialDoc, ShaderGraph } from './types';

const archives = listMaterialArchives();

function collectDocs(): Array<{ label: string; doc: GxMaterialDoc }> {
  const out: Array<{ label: string; doc: GxMaterialDoc }> = [];
  for (const archive of archives) {
    const raw = readBrresRaw(archive.data);
    for (const subFile of raw.groups.find((group) => group.name === BRRES_MODELS_GROUP)?.entries ?? []) {
      let editor: Mdl0Editor;
      try {
        editor = new Mdl0Editor(subFile.data, makeSubFileNameReader(raw, subFile));
      } catch {
        continue;
      }
      if (editor.version !== 0x0b) continue;
      const view = new DataView(editor.data.buffer, editor.data.byteOffset, editor.data.byteLength);
      for (const entry of editor.getDic('material')?.entries ?? []) {
        const size = view.getUint32(entry.offset + MAT.size);
        const tevOffset = entry.offset + view.getUint32(entry.offset + MAT.tevOffset);
        out.push({
          label: `${archive.label}/${subFile.name}/${entry.name}`,
          doc: decodeMaterialBlock({
            block: editor.data.slice(entry.offset, entry.offset + size),
            tev: editor.data.slice(tevOffset, tevOffset + TEV_BLOCK_SIZE),
            name: entry.name,
            readName: (offset) => editor.readNameAt(entry.offset + offset),
          }),
        });
      }
    }
  }
  return out;
}

const documents = archives.length > 0 ? collectDocs() : [];

function wire(nodes: GraphNode[], edges: Array<[string, string, string, string]>): ShaderGraph {
  return {
    version: 1,
    nodes,
    edges: edges.map(([from, socket, to, input], index): GraphEdge => ({
      id: `e${index}`,
      from: { node: from, socket },
      to: { node: to, socket: input },
    })),
  };
}

describe.skipIf(documents.length === 0)('decompile / compile round trip', () => {
  it('reproduces every retail material stage for stage', () => {
    const failures: string[] = [];
    let rawStages = 0;
    let totalStages = 0;
    for (const { label, doc } of documents) {
      const graph = decompileShader(doc);
      rawStages += graph.nodes.filter((node) => node.type === 'rawStage').length;
      totalStages += doc.tevStages.length;
      const compiled = compileShaderGraph(graph, doc);
      if (!compiled.ok) {
        failures.push(`${label}: ${compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message).join('; ')}`);
        continue;
      }
      if (JSON.stringify(compiled.tevStages) !== JSON.stringify(doc.tevStages)) {
        failures.push(`${label}: stages differ`);
      }
    }
    expect(failures.slice(0, 10).join('\n')).toBe('');
    // Not an assertion about quality, just a guard: if this ever jumps, the graph model lost
    // ground and the editor started showing read-only cards where it used to show nodes.
    expect(rawStages / totalStages).toBeLessThan(0.2);
  });

  it('produces graphs the editor can lay out', () => {
    for (const { doc } of documents.slice(0, 30)) {
      const graph = decompileShader(doc);
      expect(graph.version).toBe(1);
      expect(graph.nodes.some((node) => node.type === 'output')).toBe(true);
      // Every wire has to name nodes that exist and sockets they really have.
      const ids = new Set(graph.nodes.map((node) => node.id));
      for (const edge of graph.edges) {
        expect(ids.has(edge.from.node)).toBe(true);
        expect(ids.has(edge.to.node)).toBe(true);
      }
      expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length);
    }
  });
});

describe('shader graph compiler', () => {
  const material = createDefaultMaterialDoc('test', 2);
  material.indTexStages = [{ texMap: 0, texCoordId: 0, scaleS: GX.IndTexScale._1, scaleT: GX.IndTexScale._1 }];

  it('lowers a texture times vertex colour to one stage', () => {
    const graph = wire(
      [
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 'v', type: 'vertexColor', channel: 0, x: 0, y: 100 },
        { id: 'm', type: 'multiply', x: 200, y: 0 },
        { id: 'ma', type: 'multiply', x: 200, y: 200 },
        { id: 'o', type: 'output', x: 400, y: 0 },
      ],
      [['t', 'rgb', 'm', 'a'], ['v', 'rgb', 'm', 'b'], ['t', 'alpha', 'ma', 'a'], ['v', 'alpha', 'ma', 'b'], ['m', 'out', 'o', 'color'], ['ma', 'out', 'o', 'alpha']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.ok).toBe(true);
    expect(compiled.tevStages).toHaveLength(1);
    const [stage] = compiled.tevStages;
    expect([stage.colorInA, stage.colorInB, stage.colorInC, stage.colorInD]).toEqual([GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO]);
    expect([stage.alphaInA, stage.alphaInB, stage.alphaInC, stage.alphaInD]).toEqual([GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO]);
    expect(stage.texMap).toBe(0);
    expect(stage.channelId).toBe(GX.RasColorChannelID.COLOR0A0);
    expect(compiled.usage).toEqual({ samplers: [0], texCoords: [0], channels: [0], konstColors: [], registers: [], indTexStages: [] });
  });

  it('lowers add, subtract and lerp into the hardware form', () => {
    const shapes: Array<[GraphNode['type'], number[], GX.TevOp]> = [
      ['add', [GX.CC.RASC, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC], GX.TevOp.ADD],
      ['subtract', [GX.CC.RASC, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC], GX.TevOp.SUB],
    ];
    for (const [type, expected, op] of shapes) {
      const graph = wire(
        [
          { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
          { id: 'v', type: 'vertexColor', channel: 0, x: 0, y: 100 },
          { id: 'n', type, x: 200, y: 0 } as GraphNode,
          { id: 'o', type: 'output', x: 400, y: 0 },
        ],
        [['t', 'rgb', 'n', 'a'], ['v', 'rgb', 'n', 'b'], ['n', 'out', 'o', 'color']],
      );
      const compiled = compileShaderGraph(graph, material);
      expect(compiled.ok).toBe(true);
      const [stage] = compiled.tevStages;
      expect([stage.colorInA, stage.colorInB, stage.colorInC, stage.colorInD]).toEqual(expected);
      expect(stage.colorOp).toBe(op);
    }
  });

  it('fuses d + lerp(a, b, t) into a single stage', () => {
    const graph = wire(
      [
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 'v', type: 'vertexColor', channel: 0, x: 0, y: 100 },
        { id: 'h', type: 'value', value: 0.5, x: 0, y: 200 },
        { id: 'l', type: 'lerp', x: 200, y: 0 },
        { id: 'a', type: 'add', x: 400, y: 0 },
        { id: 'o', type: 'output', x: 600, y: 0 },
      ],
      [
        ['t', 'rgb', 'l', 'a'], ['v', 'rgb', 'l', 'b'], ['h', 'rgb', 'l', 't'],
        ['h', 'rgb', 'a', 'a'], ['l', 'out', 'a', 'b'], ['a', 'out', 'o', 'color'],
      ],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.ok).toBe(true);
    expect(compiled.tevStages).toHaveLength(1);
    const [stage] = compiled.tevStages;
    expect([stage.colorInA, stage.colorInB, stage.colorInC, stage.colorInD]).toEqual([GX.CC.TEXC, GX.CC.RASC, GX.CC.HALF, GX.CC.HALF]);
  });

  it('fuses a scale into the stage that produced its input', () => {
    const graph = wire(
      [
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 'v', type: 'vertexColor', channel: 0, x: 0, y: 100 },
        { id: 'm', type: 'multiply', x: 200, y: 0 },
        { id: 's', type: 'scale', scale: 2, bias: 0.5, clamp: false, x: 400, y: 0 },
        { id: 'o', type: 'output', x: 600, y: 0 },
      ],
      [['t', 'rgb', 'm', 'a'], ['v', 'rgb', 'm', 'b'], ['m', 'out', 's', 'x'], ['s', 'out', 'o', 'color']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.tevStages).toHaveLength(1);
    expect(compiled.tevStages[0].colorScale).toBe(GX.TevScale.SCALE_2);
    expect(compiled.tevStages[0].colorBias).toBe(GX.TevBias.ADDHALF);
    expect(compiled.tevStages[0].colorClamp).toBe(false);
  });

  it('gives a scale its own stage when there is nothing to fuse into', () => {
    const graph = wire(
      [
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 's', type: 'scale', scale: 4, bias: 0, clamp: true, x: 200, y: 0 },
        { id: 'o', type: 'output', x: 400, y: 0 },
      ],
      [['t', 'rgb', 's', 'x'], ['s', 'out', 'o', 'color']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.tevStages).toHaveLength(1);
    expect(compiled.tevStages[0].colorScale).toBe(GX.TevScale.SCALE_4);
    expect(compiled.tevStages[0].colorInD).toBe(GX.CC.TEXC);
  });

  it('lowers a compare node to the matching TEV comparison', () => {
    const graph = wire(
      [
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 'c', type: 'compare', op: GX.TevOp.COMP_RGB8_GT, x: 200, y: 0 },
        { id: 'o', type: 'output', x: 400, y: 0 },
      ],
      [['t', 'rgb', 'c', 'a'], ['c', 'out', 'o', 'color']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.ok).toBe(true);
    expect(compiled.tevStages[0].colorOp).toBe(GX.TevOp.COMP_RGB8_GT);
    expect(compiled.tevStages[0].colorBias).toBe(GX.TevBias.$HWB_COMPARE);
  });

  it('binds a konst colour for a constant node', () => {
    const graph = wire(
      [
        { id: 'k', type: 'constant', slot: 2, x: 0, y: 0 },
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 100 },
        { id: 'm', type: 'multiply', x: 200, y: 0 },
        { id: 'o', type: 'output', x: 400, y: 0 },
      ],
      [['k', 'rgb', 'm', 'a'], ['t', 'rgb', 'm', 'b'], ['m', 'out', 'o', 'color']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.ok).toBe(true);
    expect(compiled.tevStages[0].konstColorSel).toBe(GX.KonstColorSel.KCSEL_K2);
    expect(compiled.usage.konstColors).toEqual([2]);
  });

  it('reads a register node as the register\'s starting colour', () => {
    const graph = wire(
      [
        { id: 'r', type: 'register', slot: 1, x: 0, y: 0 },
        { id: 'o', type: 'output', x: 200, y: 0 },
      ],
      [['r', 'rgb', 'o', 'color']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.ok).toBe(true);
    expect(compiled.tevStages[0].colorInD).toBe(GX.CC.C1);
    expect(compiled.usage.registers).toEqual([1]);
  });

  it('spills into a register when a value has to survive another stage', () => {
    // out = lerp(tex0 * vc, tex1 * vc, 0.5): both branches emit a stage, so the first result has
    // to leave the previous-stage register before the second one overwrites it.
    const graph = wire(
      [
        { id: 't0', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 't1', type: 'texture', sampler: 1, texCoord: 1, x: 0, y: 100 },
        { id: 'v', type: 'vertexColor', channel: 0, x: 0, y: 200 },
        { id: 'm0', type: 'multiply', x: 200, y: 0 },
        { id: 'm1', type: 'multiply', x: 200, y: 120 },
        { id: 'h', type: 'value', value: 0.5, x: 200, y: 260 },
        { id: 'a', type: 'lerp', x: 400, y: 0 },
        { id: 'o', type: 'output', x: 600, y: 0 },
      ],
      [
        ['t0', 'rgb', 'm0', 'a'], ['v', 'rgb', 'm0', 'b'],
        ['t1', 'rgb', 'm1', 'a'], ['v', 'rgb', 'm1', 'b'],
        ['m0', 'out', 'a', 'a'], ['m1', 'out', 'a', 'b'], ['h', 'rgb', 'a', 't'],
        ['a', 'out', 'o', 'color'],
      ],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.ok).toBe(true);
    expect(compiled.tevStages.length).toBeGreaterThanOrEqual(2);
    // The multiply that ran first must have been parked somewhere other than PREV.
    expect(compiled.tevStages.some((stage) => stage.colorRegId !== GX.Register.PREV)).toBe(true);
    expect(compiled.usage.samplers).toEqual([0, 1]);
  });

  it('inserts pass-throughs when colour and alpha want different textures', () => {
    const graph = wire(
      [
        { id: 't0', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 't1', type: 'texture', sampler: 1, texCoord: 1, x: 0, y: 100 },
        { id: 'v', type: 'vertexColor', channel: 0, x: 0, y: 200 },
        { id: 'mc', type: 'multiply', x: 200, y: 0 },
        { id: 'ma', type: 'multiply', x: 200, y: 200 },
        { id: 'o', type: 'output', x: 400, y: 0 },
      ],
      [
        ['t0', 'rgb', 'mc', 'a'], ['v', 'rgb', 'mc', 'b'],
        ['t1', 'alpha', 'ma', 'a'], ['v', 'alpha', 'ma', 'b'],
        ['mc', 'out', 'o', 'color'], ['ma', 'out', 'o', 'alpha'],
      ],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.ok).toBe(true);
    expect(compiled.tevStages).toHaveLength(2);
    expect(compiled.tevStages[0].texMap).toBe(0);
    expect(compiled.tevStages[1].texMap).toBe(1);
    // The stage that only carries alpha leaves the colour it inherited alone.
    expect(compiled.tevStages[1].colorInD).toBe(GX.CC.CPREV);
    expect(compiled.tevStages[0].alphaInD).toBe(GX.CA.APREV);
  });

  it('routes an indirect warp onto the stage that samples the warped texture', () => {
    const graph = wire(
      [
        { id: 'w', type: 'indirectWarp', indStage: 0, matrix: GX.IndTexMtxID._0, format: GX.IndTexFormat._8, bias: GX.IndTexBiasSel.STU, wrapS: GX.IndTexWrap.OFF, wrapT: GX.IndTexWrap.OFF, addPrevious: false, x: 0, y: 0 },
        { id: 't', type: 'texture', sampler: 1, texCoord: 1, x: 200, y: 0 },
        { id: 'v', type: 'vertexColor', channel: 0, x: 200, y: 120 },
        { id: 'm', type: 'multiply', x: 400, y: 0 },
        { id: 'o', type: 'output', x: 600, y: 0 },
      ],
      [['w', 'uv', 't', 'uv'], ['t', 'rgb', 'm', 'a'], ['v', 'rgb', 'm', 'b'], ['m', 'out', 'o', 'color']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.ok).toBe(true);
    expect(compiled.tevStages[0].indTexMatrix).toBe(GX.IndTexMtxID._0);
    expect(compiled.tevStages[0].indTexBiasSel).toBe(GX.IndTexBiasSel.STU);
    expect(compiled.usage.indTexStages).toEqual([0]);
  });

  it('copies a raw stage out verbatim', () => {
    const stage = { ...createDefaultStage(), colorScale: GX.TevScale.SCALE_4, rasSwapTable: 2 };
    const graph = wire(
      [
        { id: 'r', type: 'rawStage', stage, x: 0, y: 0 },
        { id: 'o', type: 'output', x: 200, y: 0 },
      ],
      [['r', 'out', 'o', 'color'], ['r', 'alpha', 'o', 'alpha']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.ok).toBe(true);
    expect(compiled.tevStages).toEqual([stage]);
  });

  it('never throws, and reports problems as diagnostics', () => {
    const cycle = wire(
      [
        { id: 'a', type: 'add', x: 0, y: 0 },
        { id: 'b', type: 'add', x: 100, y: 0 },
        { id: 'o', type: 'output', x: 200, y: 0 },
      ],
      [['a', 'out', 'b', 'a'], ['b', 'out', 'a', 'a'], ['b', 'out', 'o', 'color']],
    );
    const compiled = compileShaderGraph(cycle, material);
    expect(compiled.ok).toBe(false);
    expect(compiled.tevStages).toEqual([]);
    expect(compiled.diagnostics.some((d) => /loop/i.test(d.message))).toBe(true);
  });

  it('flags a wire that crosses the colour and alpha pipelines', () => {
    const graph = wire(
      [
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 'm', type: 'multiply', x: 200, y: 0 },
        { id: 'o', type: 'output', x: 400, y: 0 },
      ],
      [['t', 'alpha', 'm', 'a'], ['m', 'out', 'o', 'color']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics[0].edgeId).toBe('e0');
  });

  it('warns about a node nothing reads', () => {
    const graph = wire(
      [
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 'lonely', type: 'vertexColor', channel: 0, x: 0, y: 100 },
        { id: 'o', type: 'output', x: 200, y: 0 },
      ],
      [['t', 'rgb', 'o', 'color']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.ok).toBe(true);
    expect(compiled.diagnostics).toEqual([
      { severity: 'warning', message: expect.stringContaining('does nothing'), nodeId: 'lonely', edgeId: undefined },
    ]);
  });

  it('refuses a texture slot the material does not have', () => {
    const graph = wire(
      [
        { id: 't', type: 'texture', sampler: 6, texCoord: 0, x: 0, y: 0 },
        { id: 'o', type: 'output', x: 200, y: 0 },
      ],
      [['t', 'rgb', 'o', 'color']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics[0].message).toMatch(/only has 2/);
  });

  it('refuses a shader that needs more than sixteen stages', () => {
    const nodes: GraphNode[] = [{ id: 't0', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 }, { id: 't1', type: 'texture', sampler: 1, texCoord: 1, x: 0, y: 60 }];
    const edges: Array<[string, string, string, string]> = [];
    let previous = 't0';
    for (let i = 0; i < 20; i++) {
      nodes.push({ id: `n${i}`, type: 'add', x: 100 + i * 60, y: 0 });
      edges.push([previous, previous.startsWith('t') ? 'rgb' : 'out', `n${i}`, 'a']);
      edges.push([i % 2 === 0 ? 't1' : 't0', 'rgb', `n${i}`, 'b']);
      previous = `n${i}`;
    }
    nodes.push({ id: 'o', type: 'output', x: 2000, y: 0 });
    edges.push([previous, 'out', 'o', 'color']);
    const compiled = compileShaderGraph(wire(nodes, edges), material);
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.some((d) => /sixteen|16/.test(d.message))).toBe(true);
  });

  it('uses the socket default when an input is unwired', () => {
    const graph = wire(
      [
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 'm', type: 'multiply', x: 200, y: 0 },
        { id: 'o', type: 'output', x: 400, y: 0 },
      ],
      [['t', 'rgb', 'm', 'a'], ['m', 'out', 'o', 'color']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.ok).toBe(true);
    // Multiply's `b` defaults to 1.
    expect(compiled.tevStages[0].colorInC).toBe(GX.CC.ONE);
  });
});

describe('shader graph presets', () => {
  for (const preset of SHADER_GRAPH_PRESETS) {
    it(`compiles "${preset.title}" without complaint`, () => {
      const material = createDefaultMaterialDoc(preset.id, Math.max(1, preset.samplerCount));
      if (preset.samplerCount === 0) material.tevStages = [createPassThroughStage()];
      const compiled = compileShaderGraph(preset.graph, material);
      expect(compiled.diagnostics).toEqual([]);
      expect(compiled.ok).toBe(true);
      expect(compiled.tevStages.length).toBeGreaterThan(0);
      expect(compiled.tevStages.length).toBeLessThanOrEqual(16);
    });
  }

  it('offers the presets the material menus need', () => {
    expect(SHADER_GRAPH_PRESETS.map((preset) => preset.id)).toEqual([
      'unlit-texture', 'lit-texture', 'texture-blend', 'additive-glow', 'env-map', 'vertex-color-only',
    ]);
  });
});
