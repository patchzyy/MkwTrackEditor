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
import { acceptsInlineValue, foldLiteralNodes, inlineInputValue, withInlineValue } from './graphLiterals';
import { defaultGraphNodeSize, layoutShaderGraph, type MeasureGraphNode } from './graphLayout';
import type { GraphEdge, GraphInlineValue, GraphNode, GxMaterialDoc, GxTevStageDoc, ShaderGraph } from './types';

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

/**
 * The graph an older decompiler made: every typed-in literal spelled as a wire from one shared
 * "Value" node per value instead. What `foldLiteralNodes` exists to undo.
 */
function unfoldLiterals(graph: ShaderGraph): ShaderGraph {
  const nodes: GraphNode[] = [];
  const edges = [...graph.edges];
  const shared = new Map<GraphInlineValue, string>();
  for (const node of graph.nodes) {
    const { inputValues, ...rest } = node;
    nodes.push(rest as GraphNode);
    for (const [socket, value] of Object.entries(inputValues ?? {})) {
      if (value === undefined || edges.some((edge) => edge.to.node === node.id && edge.to.socket === socket)) continue;
      let id = shared.get(value);
      if (!id) {
        id = `lit${value}`;
        shared.set(value, id);
        nodes.push({ id, type: 'value', value, x: 0, y: 0 });
      }
      // `s3a…` is stage 3's alpha half (the decompiler's id convention); everything else is colour.
      const socketType = /^s\d+a/.test(node.id) ? 'alpha' : 'rgb';
      edges.push({ id: `${id}-${node.id}-${socket}`, from: { node: id, socket: socketType }, to: { node: node.id, socket } });
    }
  }
  return { ...graph, nodes, edges };
}

/** Pairs of cards whose boxes overlap, at the given sizes. Comments are annotations and excluded. */
function overlappingCards(graph: ShaderGraph, measure: MeasureGraphNode = defaultGraphNodeSize): string[] {
  const cards = graph.nodes.filter((node) => node.type !== 'comment').map((node) => ({ node, ...measure(node) }));
  const hits: string[] = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i];
      const b = cards[j];
      if (a.node.x < b.node.x + b.width && b.node.x < a.node.x + a.width && a.node.y < b.node.y + b.height && b.node.y < a.node.y + a.height) {
        hits.push(`${a.node.id}/${b.node.id}`);
      }
    }
  }
  return hits;
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

  it('types the hardware constants into the nodes instead of wiring a shared Value card', () => {
    for (const { doc } of documents) {
      const graph = decompileShader(doc);
      expect(graph.nodes.filter((node) => node.type === 'value')).toEqual([]);
      for (const node of graph.nodes) {
        for (const socket of Object.keys(node.inputValues ?? {})) {
          // Only where the compiler reads it, never on a wired socket, never repeating the default.
          expect(acceptsInlineValue(node, socket)).toBe(true);
          expect(graph.edges.some((edge) => edge.to.node === node.id && edge.to.socket === socket)).toBe(false);
          expect(node.inputValues![socket]).not.toBe(socketDefault(node, socket));
        }
      }
    }
  });

  it('folds the Value cards of a graph saved by an older build back into the same stages', () => {
    for (const { label, doc } of documents) {
      const graph = decompileShader(doc);
      const old = unfoldLiterals(graph);
      const folded = foldLiteralNodes(old);
      expect(folded.nodes.filter((node) => node.type === 'value'), label).toEqual([]);
      expect(JSON.stringify(compileShaderGraph(old, doc).tevStages), label).toBe(JSON.stringify(doc.tevStages));
      expect(JSON.stringify(compileShaderGraph(folded, doc).tevStages), label).toBe(JSON.stringify(doc.tevStages));
    }
  });

  it('lays every decompiled graph out without overlaps, flowing into the Material node on the right', () => {
    for (const { label, doc } of documents) {
      const graph = decompileShader(doc);
      expect(overlappingCards(graph), label).toEqual([]);
      const output = graph.nodes.find((node) => node.type === 'output')!;
      for (const node of graph.nodes) if (node !== output) expect(node.x, `${label} ${node.id}`).toBeLessThan(output.x);
      // Every wire runs left to right.
      const xOf = new Map(graph.nodes.map((node) => [node.id, node.x]));
      for (const edge of graph.edges) expect(xOf.get(edge.from.node)!, label).toBeLessThan(xOf.get(edge.to.node)!);
    }
  });
});

/** The socket default, for the "never repeats the default" check. */
function socketDefault(node: GraphNode, socket: string): GraphInlineValue | undefined {
  return inlineInputValue({ ...node, inputValues: undefined }, socket);
}

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

  /** texture -> lerp(texture, b, t) on both pipelines, with these values typed into each lerp. */
  // An alpha lerp left at its defaults (b = 1, t = 0.5) needs two konst fractions on one stage.
  const ALPHA_ZERO = { b: 0, t: 0 } as const;

  function lerpGraph(colorValues: GraphNode['inputValues'], alphaValues: GraphNode['inputValues']): ShaderGraph {
    return wire(
      [
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 'lc', type: 'lerp', inputValues: colorValues, x: 200, y: 0 },
        { id: 'la', type: 'lerp', inputValues: alphaValues, x: 200, y: 200 },
        { id: 'o', type: 'output', x: 400, y: 0 },
      ],
      [['t', 'rgb', 'lc', 'a'], ['t', 'alpha', 'la', 'a'], ['lc', 'out', 'o', 'color'], ['la', 'out', 'o', 'alpha']],
    );
  }

  it('reads a value typed into an unwired colour input as the matching free constant', () => {
    const compiled = compileShaderGraph(lerpGraph({ b: 0, t: 1 }, ALPHA_ZERO), material);
    expect(compiled.ok).toBe(true);
    const [stage] = compiled.tevStages;
    expect([stage.colorInA, stage.colorInB, stage.colorInC, stage.colorInD]).toEqual([GX.CC.TEXC, GX.CC.ZERO, GX.CC.ONE, GX.CC.ZERO]);
    const half = compileShaderGraph(lerpGraph({ t: 0.5, b: 0.5 }, ALPHA_ZERO), material).tevStages[0];
    expect([half.colorInB, half.colorInC]).toEqual([GX.CC.HALF, GX.CC.HALF]);
  });

  it('lowers a typed-in half or one in the alpha pipeline to a konst selection, and zero to ZERO', () => {
    // The alpha operands have ZERO but no HALF or ONE; those come from the konst fractions.
    const one = compileShaderGraph(lerpGraph({}, { b: 0, t: 1 }), material);
    expect(one.ok).toBe(true);
    expect([one.tevStages[0].alphaInB, one.tevStages[0].alphaInC]).toEqual([GX.CA.ZERO, GX.CA.KONST]);
    expect(one.tevStages[0].konstAlphaSel).toBe(GX.KonstAlphaSel.KASEL_1);
    const half = compileShaderGraph(lerpGraph({}, { b: 0, t: 0.5 }), material);
    expect(half.tevStages[0].alphaInC).toBe(GX.CA.KONST);
    expect(half.tevStages[0].konstAlphaSel).toBe(GX.KonstAlphaSel.KASEL_4_8);
    // Two different fractions on one stage need two konst selections, which one stage cannot have.
    expect(compileShaderGraph(lerpGraph({}, { b: 1, t: 0.5 }), material).ok).toBe(false);
  });

  it('compiles a typed-in value exactly as a wired Value node, which still works', () => {
    const inline = lerpGraph({ b: 0.5, t: 1 }, { b: 0, t: 0.5 });
    const wired = wire(
      [
        ...lerpGraph({}, {}).nodes,
        { id: 'half', type: 'value', value: 0.5, x: 0, y: 300 },
        { id: 'one', type: 'value', value: 1, x: 0, y: 400 },
        { id: 'zero', type: 'value', value: 0, x: 0, y: 500 },
      ],
      [
        ['t', 'rgb', 'lc', 'a'], ['t', 'alpha', 'la', 'a'], ['lc', 'out', 'o', 'color'], ['la', 'out', 'o', 'alpha'],
        ['half', 'rgb', 'lc', 'b'], ['one', 'rgb', 'lc', 't'], ['zero', 'alpha', 'la', 'b'], ['half', 'alpha', 'la', 't'],
      ],
    );
    const fromInline = compileShaderGraph(inline, material);
    const fromWired = compileShaderGraph(wired, material);
    expect(fromWired.ok).toBe(true);
    expect(fromInline.tevStages).toEqual(fromWired.tevStages);
  });

  it('ignores a typed-in value on a socket that has a wire', () => {
    const graph = lerpGraph({ a: 1 }, ALPHA_ZERO);
    expect(compileShaderGraph(graph, material).tevStages[0].colorInA).toBe(GX.CC.TEXC);
  });

  it('keeps two steps the decompiler drew from two stages as two stages', () => {
    // A lone multiply that is all of stage 0's alpha, read by stage 1's add: fusing them, which is
    // right for a hand-built graph, would fold two of the file's stages into one.
    const graph = wire(
      [
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 'v', type: 'vertexColor', channel: 0, x: 0, y: 100 },
        { id: 's0a', type: 'multiply', stageTemplate: createDefaultStage(), x: 200, y: 0 },
        { id: 's1a', type: 'add', stageTemplate: createDefaultStage(), x: 400, y: 0 },
        { id: 'o', type: 'output', x: 600, y: 0 },
      ],
      [['t', 'alpha', 's0a', 'a'], ['v', 'alpha', 's0a', 'b'], ['s0a', 'out', 's1a', 'b'], ['s1a', 'out', 'o', 'alpha']],
    );
    expect(compileShaderGraph(graph, material).tevStages).toHaveLength(2);
    // The same shape without the stage ids is one fused stage, as it always was.
    const handBuilt = { ...graph, nodes: graph.nodes.map((node) => ({ ...node, id: node.id.replace(/^s(\d)a$/, 'n$1'), stageTemplate: undefined })) };
    handBuilt.edges = graph.edges.map((edge) => ({
      ...edge,
      from: { ...edge.from, node: edge.from.node.replace(/^s(\d)a$/, 'n$1') },
      to: { ...edge.to, node: edge.to.node.replace(/^s(\d)a$/, 'n$1') },
    }));
    expect(compileShaderGraph(handBuilt as ShaderGraph, material).tevStages).toHaveLength(1);
  });
});

describe('inline values and foldLiteralNodes', () => {
  const material = createDefaultMaterialDoc('test', 1);

  it('says which inputs read a typed-in value', () => {
    expect(acceptsInlineValue({ type: 'lerp' }, 't')).toBe(true);
    expect(acceptsInlineValue({ type: 'scale' }, 'x')).toBe(true);
    // The output's unwired sockets mean "nothing", and a texture's UV is not a value.
    expect(acceptsInlineValue({ type: 'output' }, 'color')).toBe(false);
    expect(acceptsInlineValue({ type: 'texture' }, 'uv')).toBe(false);
    expect(acceptsInlineValue({ type: 'lerp' }, 'nope')).toBe(false);
  });

  it('reads the typed-in value, else the default, and ignores garbage', () => {
    const lerp: GraphNode = { id: 'l', type: 'lerp', x: 0, y: 0 };
    expect(inlineInputValue(lerp, 't')).toBe(0.5);
    expect(inlineInputValue({ ...lerp, inputValues: { t: 1 } }, 't')).toBe(1);
    expect(inlineInputValue({ ...lerp, inputValues: { t: 0.25 as GraphInlineValue } }, 't')).toBe(0.5);
  });

  it('stores only values that differ from the default', () => {
    const lerp: GraphNode = { id: 'l', type: 'lerp', x: 0, y: 0 };
    const typed = withInlineValue(lerp, 'b', 0);
    expect(typed.inputValues).toEqual({ b: 0 });
    expect('inputValues' in withInlineValue(typed, 'b', 1)).toBe(false);
    expect(lerp.inputValues).toBeUndefined();
  });

  it('turns a fanned-out Value node into typed-in values and drops it', () => {
    const graph = wire(
      [
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 'zero', type: 'value', value: 0, x: 0, y: 100 },
        { id: 'l', type: 'lerp', x: 200, y: 0 },
        { id: 'm', type: 'multiply', x: 200, y: 200 },
        { id: 'o', type: 'output', x: 400, y: 0 },
      ],
      [
        ['t', 'rgb', 'l', 'a'], ['zero', 'rgb', 'l', 'b'], ['zero', 'rgb', 'l', 't'],
        ['t', 'alpha', 'm', 'a'], ['zero', 'alpha', 'm', 'b'],
        ['l', 'out', 'o', 'color'], ['m', 'out', 'o', 'alpha'],
      ],
    );
    const folded = foldLiteralNodes(graph);
    expect(folded.nodes.map((node) => node.id)).toEqual(['t', 'l', 'm', 'o']);
    expect(folded.edges.some((edge) => edge.from.node === 'zero')).toBe(false);
    expect(folded.nodes.find((node) => node.id === 'l')?.inputValues).toEqual({ b: 0, t: 0 });
    expect(folded.nodes.find((node) => node.id === 'm')?.inputValues).toEqual({ b: 0 });
    expect(compileShaderGraph(folded, material).tevStages).toEqual(compileShaderGraph(graph, material).tevStages);
  });

  it('leaves a Value node wired into the output, and one nobody wired, where they are', () => {
    const graph = wire(
      [
        { id: 'one', type: 'value', value: 1, x: 0, y: 0 },
        { id: 'spare', type: 'value', value: 0.5, x: 0, y: 100 },
        { id: 'o', type: 'output', x: 200, y: 0 },
      ],
      [['one', 'alpha', 'o', 'alpha']],
    );
    expect(foldLiteralNodes(graph)).toBe(graph);
  });

  it('omits an entry for a value that equals the socket default', () => {
    const graph = wire(
      [
        { id: 'one', type: 'value', value: 1, x: 0, y: 0 },
        { id: 'm', type: 'multiply', x: 200, y: 0 },
        { id: 'o', type: 'output', x: 400, y: 0 },
      ],
      [['one', 'rgb', 'm', 'a'], ['m', 'out', 'o', 'color']],
    );
    const folded = foldLiteralNodes(graph);
    expect(folded.nodes.map((node) => node.id)).toEqual(['m', 'o']);
    expect(folded.nodes[0].inputValues).toBeUndefined();
    expect(compileShaderGraph(folded, material).tevStages).toEqual(compileShaderGraph(graph, material).tevStages);
  });
});

describe('layoutShaderGraph', () => {
  const graph = SHADER_GRAPH_PRESETS.find((preset) => preset.id === 'texture-blend')!.graph;

  it('is deterministic and never moves a comment', () => {
    const withComment: ShaderGraph = {
      ...graph,
      nodes: [...graph.nodes, { id: 'note', type: 'comment', text: 'hi', width: 300, height: 120, x: -55, y: 77 }],
    };
    const once = layoutShaderGraph(withComment);
    expect(layoutShaderGraph(withComment)).toEqual(once);
    expect(layoutShaderGraph(once)).toEqual(once);
    expect(once.nodes.find((node) => node.id === 'note')).toMatchObject({ x: -55, y: 77 });
    // Only positions change.
    expect(once.nodes.map(({ x: _x, y: _y, ...rest }) => rest)).toEqual(withComment.nodes.map(({ x: _x, y: _y, ...rest }) => rest));
    expect(once.edges).toBe(withComment.edges);
  });

  it('puts the Material node alone on the right and keeps every wire flowing left to right', () => {
    const laid = layoutShaderGraph(graph);
    const output = laid.nodes.find((node) => node.type === 'output')!;
    for (const node of laid.nodes) if (node !== output) expect(node.x).toBeLessThan(output.x);
    const xOf = new Map(laid.nodes.map((node) => [node.id, node.x]));
    for (const edge of laid.edges) expect(xOf.get(edge.from.node)!).toBeLessThan(xOf.get(edge.to.node)!);
    expect(overlappingCards(laid)).toEqual([]);
  });

  it('puts the alpha chain in a band below the colour chain', () => {
    const laid = layoutShaderGraph(graph);
    const at = (id: string) => laid.nodes.find((node) => node.id === id)!;
    // `alpha` multiplies two sources the colour chain reads too; `mix` is colour-only.
    expect(at('alpha').y).toBeGreaterThan(at('mix').y + defaultGraphNodeSize(at('mix')).height);
    expect(at('alpha').y).toBeGreaterThan(at('base').y + defaultGraphNodeSize(at('base')).height);
  });

  it('spaces the cards by the sizes the editor measured', () => {
    const big: MeasureGraphNode = (node) => ({ ...defaultGraphNodeSize(node), width: 300, height: 200 });
    const laid = layoutShaderGraph(graph, big);
    expect(overlappingCards(laid, big)).toEqual([]);
    const columns = [...new Set(laid.nodes.map((node) => node.x))].sort((a, b) => a - b);
    for (let index = 1; index < columns.length; index++) expect(columns[index] - columns[index - 1]).toBeGreaterThanOrEqual(300);
  });

  it('lines a socket up with the measured socket it is wired to', () => {
    // A chain of single-input steps should come out as one straight row.
    const chain = wire(
      [
        { id: 'v', type: 'vertexColor', channel: 0, x: 0, y: 0 },
        { id: 's1', type: 'scale', scale: 2, bias: 0, clamp: true, x: 0, y: 0 },
        { id: 's2', type: 'scale', scale: 2, bias: 0, clamp: true, x: 0, y: 0 },
        { id: 'o', type: 'output', x: 0, y: 0 },
      ],
      [['v', 'rgb', 's1', 'x'], ['s1', 'out', 's2', 'x'], ['s2', 'out', 'o', 'color']],
    );
    const laid = layoutShaderGraph(chain);
    const ys = laid.nodes.map((node) => node.y);
    expect(new Set(ys).size).toBe(1);
  });

  it('copes with an empty graph, a cycle and a node with no wires', () => {
    expect(layoutShaderGraph({ version: 1, nodes: [], edges: [] })).toEqual({ version: 1, nodes: [], edges: [] });
    const loop = wire(
      [
        { id: 'a', type: 'add', x: 0, y: 0 },
        { id: 'b', type: 'add', x: 0, y: 0 },
        { id: 'lonely', type: 'value', value: 1, x: 0, y: 0 },
        { id: 'o', type: 'output', x: 0, y: 0 },
      ],
      [['a', 'out', 'b', 'a'], ['b', 'out', 'a', 'a'], ['b', 'out', 'o', 'color']],
    );
    const laid = layoutShaderGraph(loop);
    expect(overlappingCards(laid)).toEqual([]);
    for (const node of laid.nodes) expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
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

  it('draws each stage with the fewest steps that say it', () => {
    const doc = materialWith([
      // texture x vertex colour: one multiply per half, the zeros typed in, not wired.
      {
        colorInA: GX.CC.ZERO, colorInB: GX.CC.TEXC, colorInC: GX.CC.RASC, colorInD: GX.CC.ZERO,
        alphaInA: GX.CA.ZERO, alphaInB: GX.CA.TEXA, alphaInC: GX.CA.RASA, alphaInD: GX.CA.ZERO,
        texMap: 0, texCoordId: 0, channelId: GX.RasColorChannelID.COLOR0A0,
      },
      // previous + half a texture: an add over a lerp whose mix is typed in as 0.5.
      {
        colorInA: GX.CC.ZERO, colorInB: GX.CC.TEXC, colorInC: GX.CC.HALF, colorInD: GX.CC.CPREV,
        alphaInA: GX.CA.APREV, alphaInB: GX.CA.ZERO, alphaInC: GX.CA.ZERO, alphaInD: GX.CA.ZERO,
        texMap: 1, texCoordId: 1,
      },
    ]);
    const graph = roundTrips(doc);
    const at = (id: string) => graph.nodes.find((node) => node.id === id);
    expect(graph.nodes.filter((node) => node.type === 'value')).toEqual([]);
    expect(at('s0c')?.type).toBe('multiply');
    expect(at('s0a')?.type).toBe('multiply');
    expect(at('s0cl')).toBeUndefined();
    expect(at('s1c')?.type).toBe('add');
    expect(at('s1cl')).toMatchObject({ type: 'multiply', inputValues: { b: 0.5 } });
    // The alpha half is just "the previous alpha": an add of it, with nothing typed in.
    expect(at('s1a')).toMatchObject({ type: 'add' });
    expect(at('s1a')?.inputValues).toBeUndefined();
    // One texture card per stage, each feeding its own stage's colour and alpha.
    expect(graph.nodes.filter((node) => node.type === 'texture')).toHaveLength(2);
  });

  it('types a ONE into a colour input and a lerp\'s zero into its alpha input', () => {
    const doc = materialWith([{
      colorInA: GX.CC.TEXC, colorInB: GX.CC.ONE, colorInC: GX.CC.RASC, colorInD: GX.CC.ZERO,
      alphaInA: GX.CA.TEXA, alphaInB: GX.CA.ZERO, alphaInC: GX.CA.RASA, alphaInD: GX.CA.ZERO,
      texMap: 0, texCoordId: 0, channelId: GX.RasColorChannelID.COLOR0A0,
    }]);
    const graph = roundTrips(doc);
    // `lerp.b` defaults to 1, so a ONE there needs no entry; an alpha zero there does.
    expect(graph.nodes.find((node) => node.id === 's0c')).toMatchObject({ type: 'lerp' });
    expect(graph.nodes.find((node) => node.id === 's0c')?.inputValues).toBeUndefined();
    expect(graph.nodes.find((node) => node.id === 's0a')).toMatchObject({ type: 'lerp', inputValues: { b: 0 } });
  });

  it('keeps a whole-stage multiply apart from the add of the stage that reads it', () => {
    // The shape that used to fuse two of the file's stages into one (a course's water).
    const doc = materialWith([
      {
        colorInA: GX.CC.ZERO, colorInB: GX.CC.TEXC, colorInC: GX.CC.ONE, colorInD: GX.CC.ZERO,
        alphaInA: GX.CA.ZERO, alphaInB: GX.CA.TEXA, alphaInC: GX.CA.RASA, alphaInD: GX.CA.ZERO,
        texMap: 0, texCoordId: 0, channelId: GX.RasColorChannelID.COLOR_ZERO,
      },
      {
        colorInA: GX.CC.CPREV, colorInB: GX.CC.ZERO, colorInC: GX.CC.ZERO, colorInD: GX.CC.ZERO,
        alphaInA: GX.CA.APREV, alphaInB: GX.CA.ZERO, alphaInC: GX.CA.ZERO, alphaInD: GX.CA.KONST,
        konstAlphaSel: GX.KonstAlphaSel.KASEL_K0_A,
      },
    ]);
    const graph = roundTrips(doc);
    expect(graph.nodes.filter((node) => node.type === 'rawStage')).toEqual([]);
  });

  it('gives a source read by far-apart steps a card beside each, and merges twins in one column', () => {
    const doc = materialWith([
      // Stage 0 reads K0; stages 1..3 build on it; stage 3 reads K0 again.
      { colorInA: GX.CC.ZERO, colorInB: GX.CC.KONST, colorInC: GX.CC.ONE, colorInD: GX.CC.ZERO, konstColorSel: GX.KonstColorSel.KCSEL_K0 },
      { colorInA: GX.CC.ZERO, colorInB: GX.CC.TEXC, colorInC: GX.CC.CPREV, colorInD: GX.CC.ZERO, texMap: 0, texCoordId: 0 },
      { colorInA: GX.CC.ZERO, colorInB: GX.CC.TEXC, colorInC: GX.CC.CPREV, colorInD: GX.CC.ZERO, texMap: 1, texCoordId: 1 },
      { colorInA: GX.CC.CPREV, colorInB: GX.CC.ZERO, colorInC: GX.CC.ZERO, colorInD: GX.CC.KONST, konstColorSel: GX.KonstColorSel.KCSEL_K0 },
    ]);
    const graph = roundTrips(doc);
    const xOf = new Map(graph.nodes.map((node) => [node.id, node.x]));
    for (const node of graph.nodes.filter((entry) => entry.type === 'constant')) {
      // Each konst card sits right beside every step it feeds.
      for (const edge of graph.edges.filter((entry) => entry.from.node === node.id)) {
        expect(xOf.get(edge.to.node)! - node.x).toBeLessThanOrEqual(240);
      }
    }
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
