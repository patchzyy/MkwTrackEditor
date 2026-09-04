// Shader graph compiler and decompiler.
//
// The headline test is the round trip: decompiling a real material and compiling the result has
// to give back the very same TEV stages. That is the promise the editor makes when it opens a
// material — look at it, change nothing, save, and the track is unchanged.

import { describe, expect, it } from 'vitest';
import * as GX from '../../../vendor/noclip.website/src/gx/gx_enum';
import { BRRES_MODELS_GROUP, makeSubFileNameReader, readBrresRaw } from '../brres/brresRaw';
import { Mdl0Editor } from '../brres/mdl0Raw';
import { fixtureFamily, listShaderGraphArchives } from './materialFixtures.testdata';
import { MATERIAL_FIELDS as MAT, TEV_BLOCK_SIZE, decodeMaterialBlock } from './materialCodec';
import { compileShaderGraph } from './shaderGraph';
import { decompileShader, decompileShaderReport } from './decompile';
import { SHADER_GRAPH_PRESETS } from './presets';
import { createDefaultMaterialDoc, createDefaultStage, createPassThroughStage } from './defaults';
import type { GraphEdge, GraphNode, GxMaterialDoc, GxTevStageDoc, ShaderGraph } from './types';

// A spread of character models, not just the first alphabetically: they are where the graph is
// stretched hardest, and 18 archives of them still runs in well under a second. The whole folder
// is `node scripts/shader-graph-coverage.mjs`, which is the same measurement without a time budget.
const archives = listShaderGraphArchives(12, 8, 18);

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
    // Raw-stage share per fixture family. `scripts/shader-graph-coverage.mjs` is the same
    // measurement over the whole corpus on this machine (16671 materials in 2343 archives):
    // drivers, karts and the shared object archives come out at exactly zero, course models at
    // 0.10%, and all of that 0.10% is one shape — a stage that reads a texture while binding
    // none. These are ceilings, not targets: if one jumps, the graph model lost ground and the
    // editor started showing read-only cards where it used to show nodes.
    const raw: Record<string, number> = { course: 0, object: 0, driver: 0, kart: 0 };
    const total: Record<string, number> = { course: 0, object: 0, driver: 0, kart: 0 };
    for (const { label, doc } of documents) {
      const family = fixtureFamily(label);
      const graph = decompileShader(doc);
      raw[family] += graph.nodes.filter((node) => node.type === 'rawStage').length;
      total[family] += doc.tevStages.length;
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
    if (total.course > 0) expect(raw.course / total.course).toBeLessThanOrEqual(0.01);
    // Character and object models are fully expressible; anything above zero is a regression.
    for (const family of ['object', 'driver', 'kart']) {
      if (total[family] > 0) {
        expect(`${family}: ${raw[family]} raw of ${total[family]}`).toBe(`${family}: 0 raw of ${total[family]}`);
      }
    }
  });

  it('says why each step it could not draw stayed a Special step', () => {
    for (const { doc } of documents) {
      const report = decompileShaderReport(doc);
      expect(report.causes.length).toBe(report.rawStages);
      for (const node of report.graph.nodes) {
        if (node.type !== 'rawStage') continue;
        // Never a dead end: every read-only card carries a sentence the user can act on.
        expect(node.reason === undefined ? '' : node.reason.slice(0, 3)).not.toBe('');
      }
    }
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

  // A warning rather than an error: retail tracks really do ship materials whose stage samples a
  // slot they have no layer for, and refusing to lower one would show the author a wall of
  // read-only cards for a defect they did not introduce. `applyMaterial` refuses the new ones.
  it('warns about a texture slot the material does not have, and still binds it', () => {
    const graph = wire(
      [
        { id: 't', type: 'texture', sampler: 6, texCoord: 0, x: 0, y: 0 },
        { id: 'o', type: 'output', x: 200, y: 0 },
      ],
      [['t', 'rgb', 'o', 'color']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.ok).toBe(true);
    expect(compiled.diagnostics[0].severity).toBe('warning');
    expect(compiled.diagnostics[0].message).toMatch(/only has 2/);
    expect(compiled.tevStages[0].texMap).toBe(6);
    // The slot does not exist, so nothing in the inspector should light up for it.
    expect(compiled.usage.samplers).toEqual([]);
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

  // ------------------------------------------------------------ the cross-domain read
  //
  // The one place the colour and alpha halves meet, and the thing nearly every character model is
  // built out of: `d + lerp(a, b, alphaOfSomething)`.

  it('reads a texture alpha into a colour input', () => {
    const graph = wire(
      [
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 'aac', type: 'alphaAsColor', x: 120, y: 0 },
        { id: 'm', type: 'multiply', x: 260, y: 0 },
        { id: 'o', type: 'output', x: 420, y: 0 },
      ],
      [['t', 'alpha', 'aac', 'alpha'], ['aac', 'rgb', 'm', 'a'], ['t', 'rgb', 'm', 'b'], ['m', 'out', 'o', 'color']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.tevStages).toHaveLength(1);
    const [stage] = compiled.tevStages;
    expect([stage.colorInB, stage.colorInC]).toEqual([GX.CC.TEXA, GX.CC.TEXC]);
    expect(stage.texMap).toBe(0);
  });

  it('reads a vertex colour, a constant and a slot alpha into a colour input', () => {
    const cases: Array<[GraphNode, GX.CC]> = [
      [{ id: 's', type: 'vertexColor', channel: 0, x: 0, y: 0 }, GX.CC.RASA],
      [{ id: 's', type: 'constant', slot: 1, x: 0, y: 0 }, GX.CC.KONST],
      [{ id: 's', type: 'register', slot: 2, x: 0, y: 0 }, GX.CC.A2],
      [{ id: 's', type: 'storedValue', slot: 'prev', x: 0, y: 0 }, GX.CC.APREV],
      [{ id: 's', type: 'storedValue', slot: 1, x: 0, y: 0 }, GX.CC.A1],
    ];
    for (const [source, expected] of cases) {
      const graph = wire(
        [
          source,
          { id: 'aac', type: 'alphaAsColor', x: 120, y: 0 },
          { id: 'o', type: 'output', x: 300, y: 0 },
        ],
        [['s', 'alpha', 'aac', 'alpha'], ['aac', 'rgb', 'o', 'color']],
      );
      const compiled = compileShaderGraph(graph, material);
      expect(compiled.ok).toBe(true);
      expect(compiled.tevStages[0].colorInD).toBe(expected);
    }
    // A constant read as a colour takes all three channels from the register's alpha.
    const konst = wire(
      [
        { id: 's', type: 'constant', slot: 1, x: 0, y: 0 },
        { id: 'aac', type: 'alphaAsColor', x: 120, y: 0 },
        { id: 'o', type: 'output', x: 300, y: 0 },
      ],
      [['s', 'alpha', 'aac', 'alpha'], ['aac', 'rgb', 'o', 'color']],
    );
    expect(compileShaderGraph(konst, material).tevStages[0].konstColorSel).toBe(GX.KonstColorSel.KCSEL_K1_A);
  });

  it('says how to fix a step wired into "Alpha as colour"', () => {
    const graph = wire(
      [
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 'm', type: 'multiply', x: 120, y: 0 },
        { id: 'aac', type: 'alphaAsColor', x: 260, y: 0 },
        { id: 'o', type: 'output', x: 420, y: 0 },
      ],
      [['t', 'alpha', 'm', 'a'], ['m', 'out', 'aac', 'alpha'], ['aac', 'rgb', 'o', 'color']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics[0].message).toMatch(/store into a slot/);
  });

  it('reads a slot back with "Stored value"', () => {
    const graph = wire(
      [
        { id: 'sv', type: 'storedValue', slot: 1, x: 0, y: 0 },
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 80 },
        { id: 'm', type: 'multiply', x: 200, y: 0 },
        { id: 'o', type: 'output', x: 400, y: 0 },
      ],
      [['sv', 'rgb', 'm', 'a'], ['t', 'rgb', 'm', 'b'], ['m', 'out', 'o', 'color']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.ok).toBe(true);
    expect(compiled.tevStages[0].colorInB).toBe(GX.CC.C1);
    expect(compiled.usage.registers).toEqual([1]);
  });

  it('honours the slot a step is told to store its result in', () => {
    const graph = wire(
      [
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 'v', type: 'vertexColor', channel: 0, x: 0, y: 80 },
        { id: 'm', type: 'multiply', outputRegister: 2, x: 200, y: 0 },
        { id: 'sv', type: 'storedValue', slot: 2, x: 200, y: 160 },
        { id: 'a', type: 'add', x: 360, y: 0 },
        { id: 'o', type: 'output', x: 520, y: 0 },
      ],
      [['t', 'rgb', 'm', 'a'], ['v', 'rgb', 'm', 'b'], ['m', 'out', 'a', 'a'], ['sv', 'rgb', 'a', 'b'], ['a', 'out', 'o', 'color']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.ok).toBe(true);
    expect(compiled.tevStages[0].colorRegId).toBe(GX.Register.REG2);
    // Reading it back names the slot, and the allocator never took it for a spill.
    expect(compiled.tevStages[1].colorInA).toBe(GX.CC.C2);
  });

  it('rasterises the bump-alpha and constant-black channels as well as the lighting ones', () => {
    for (const channel of [GX.RasColorChannelID.ALPHA_BUMP, GX.RasColorChannelID.ALPHA_BUMP_N, GX.RasColorChannelID.COLOR_ZERO]) {
      const graph = wire(
        [
          { id: 'v', type: 'vertexColor', channel, x: 0, y: 0 },
          { id: 'o', type: 'output', x: 200, y: 0 },
        ],
        [['v', 'rgb', 'o', 'color']],
      );
      const compiled = compileShaderGraph(graph, material);
      expect(compiled.diagnostics).toEqual([]);
      expect(compiled.tevStages[0].channelId).toBe(channel);
      // Only the material's own channels count as "used"; these come from the rasteriser.
      expect(compiled.usage.channels).toEqual([]);
    }
  });

  it('still runs a step whose result nothing reads', () => {
    const graph = wire(
      [
        { id: 's0c', type: 'multiply', unusedResult: true, stageTemplate: createDefaultStage(), x: 0, y: 0 },
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: -200, y: 0 },
        { id: 's1c', type: 'add', stageTemplate: createDefaultStage(), x: 200, y: 0 },
        { id: 'o', type: 'output', x: 400, y: 0 },
      ],
      [['t', 'rgb', 's0c', 'a'], ['t', 'rgb', 's1c', 'a'], ['s1c', 'out', 'o', 'color']],
    );
    const compiled = compileShaderGraph(graph, material);
    expect(compiled.ok).toBe(true);
    // Two stages, in group order: the unread multiply first, then the add the output reads.
    expect(compiled.tevStages).toHaveLength(2);
    expect(compiled.tevStages[0].colorInB).toBe(GX.CC.TEXC);
    expect(compiled.tevStages[1].colorInD).toBe(GX.CC.TEXC);
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

/**
 * The other direction: given stages, does the decompiler reach for the new nodes? These are the
 * exact shapes the coverage script found in the character folder, written out by hand so the
 * cases stay covered on a machine with no game files.
 */
describe('shader graph decompiler', () => {
  function materialWith(stages: Partial<GxTevStageDoc>[], samplers = 2): GxMaterialDoc {
    const doc = createDefaultMaterialDoc('test', samplers);
    doc.tevStages = stages.map((patch) => ({ ...createPassThroughStage(), ...patch }));
    return doc;
  }

  function roundTrips(doc: GxMaterialDoc): ShaderGraph {
    const graph = decompileShader(doc);
    const compiled = compileShaderGraph(graph, doc);
    expect(compiled.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(compiled.tevStages).toEqual(doc.tevStages);
    return graph;
  }

  it('draws the character-model blend as nodes, not a Special step', () => {
    // `d + lerp(0, texture, previous alpha)` — a kart body over its base coat.
    const doc = materialWith([
      {
        colorInA: GX.CC.ZERO, colorInB: GX.CC.TEXC, colorInC: GX.CC.RASC, colorInD: GX.CC.ZERO,
        alphaInA: GX.CA.ZERO, alphaInB: GX.CA.TEXA, alphaInC: GX.CA.KONST, alphaInD: GX.CA.ZERO,
        texMap: 0, texCoordId: 0,
      },
      {
        colorInA: GX.CC.ZERO, colorInB: GX.CC.TEXC, colorInC: GX.CC.APREV, colorInD: GX.CC.CPREV,
        alphaInA: GX.CA.KONST, alphaInB: GX.CA.ZERO, alphaInC: GX.CA.ZERO, alphaInD: GX.CA.ZERO,
        texMap: 1, texCoordId: 1,
      },
    ]);
    const graph = roundTrips(doc);
    expect(graph.nodes.filter((node) => node.type === 'rawStage')).toEqual([]);
    expect(graph.nodes.some((node) => node.type === 'alphaAsColor')).toBe(true);
    expect(graph.nodes.some((node) => node.type === 'storedValue' && node.slot === 'prev')).toBe(true);
  });

  it('draws a vertex-colour alpha read as a colour', () => {
    const doc = materialWith([{
      colorInA: GX.CC.ZERO, colorInB: GX.CC.TEXC, colorInC: GX.CC.RASA, colorInD: GX.CC.RASC,
      texMap: 0, texCoordId: 0,
    }]);
    const graph = roundTrips(doc);
    expect(graph.nodes.filter((node) => node.type === 'rawStage')).toEqual([]);
    const source = graph.edges.find((edge) => edge.to.socket === 'alpha'
      && graph.nodes.find((node) => node.id === edge.to.node)?.type === 'alphaAsColor');
    expect(graph.nodes.find((node) => node.id === source?.from.node)?.type).toBe('vertexColor');
  });

  it('reads the working slot before anything has written it', () => {
    const doc = materialWith([{
      colorInA: GX.CC.ZERO, colorInB: GX.CC.TEXC, colorInC: GX.CC.ONE, colorInD: GX.CC.CPREV,
      alphaInA: GX.CA.ZERO, alphaInB: GX.CA.ZERO, alphaInC: GX.CA.ZERO, alphaInD: GX.CA.APREV,
      texMap: 0, texCoordId: 0,
    }]);
    const graph = roundTrips(doc);
    expect(graph.nodes.filter((node) => node.type === 'rawStage')).toEqual([]);
    expect(graph.nodes.filter((node) => node.type === 'storedValue')).toHaveLength(1);
  });

  it('keeps a stage half whose result nothing reads', () => {
    const doc = materialWith([
      {
        alphaInA: GX.CA.ZERO, alphaInB: GX.CA.TEXA, alphaInC: GX.CA.KONST, alphaInD: GX.CA.ZERO,
        colorInA: GX.CC.ZERO, colorInB: GX.CC.TEXC, colorInC: GX.CC.RASC, colorInD: GX.CC.ZERO,
        texMap: 0, texCoordId: 0,
      },
      {
        // Reads the colour of the stage before it, but overwrites its alpha without looking.
        colorInA: GX.CC.ZERO, colorInB: GX.CC.TEXC, colorInC: GX.CC.ONE, colorInD: GX.CC.CPREV,
        alphaInA: GX.CA.KONST, alphaInB: GX.CA.ZERO, alphaInC: GX.CA.ZERO, alphaInD: GX.CA.ZERO,
        texMap: 1, texCoordId: 1,
      },
    ]);
    const graph = roundTrips(doc);
    expect(graph.nodes.filter((node) => node.type === 'rawStage')).toEqual([]);
    expect(graph.nodes.some((node) => node.unusedResult === true)).toBe(true);
  });

  it('keeps the rasteriser channel a stage names, even the constant-black one', () => {
    const doc = materialWith([{
      colorInA: GX.CC.ZERO, colorInB: GX.CC.KONST, colorInC: GX.CC.TEXC, colorInD: GX.CC.ZERO,
      alphaInA: GX.CA.ZERO, alphaInB: GX.CA.TEXA, alphaInC: GX.CA.RASA, alphaInD: GX.CA.ZERO,
      channelId: GX.RasColorChannelID.COLOR_ZERO, texMap: 0, texCoordId: 0,
    }]);
    const graph = roundTrips(doc);
    expect(graph.nodes.filter((node) => node.type === 'rawStage')).toEqual([]);
    const channel = graph.nodes.find((node) => node.type === 'vertexColor');
    expect(channel?.type === 'vertexColor' && channel.channel).toBe(GX.RasColorChannelID.COLOR_ZERO);
  });

  it('keeps a stage that reads a texture it does not bind as a Special step, and says why', () => {
    const doc = materialWith([{
      colorInA: GX.CC.ZERO, colorInB: GX.CC.ONE, colorInC: GX.CC.RASC, colorInD: GX.CC.ZERO,
      alphaInA: GX.CC.ZERO, alphaInB: GX.CA.TEXA, alphaInC: GX.CA.RASA, alphaInD: GX.CA.ZERO,
      texMap: GX.TexMapID.TEXMAP_NULL,
    }]);
    const report = decompileShaderReport(doc);
    expect(report.rawStages).toBe(1);
    expect(report.causes[0].kind).toBe('operand');
    const raw = report.graph.nodes.find((node) => node.type === 'rawStage');
    expect(raw?.type === 'rawStage' && raw.reason).toMatch(/no texture is bound/);
    expect(compileShaderGraph(report.graph, doc).tevStages).toEqual(doc.tevStages);
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
