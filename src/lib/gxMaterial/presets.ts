// Ready-made shader graphs.
//
// Each preset is a hand-built graph rather than a decompiled one, so it has no stage templates and
// compiles from first principles: the node layout is the whole specification. `samplerCount` tells
// the editor how many texture layers to give the material before the preset will compile.

import type { GraphEdge, GraphNode, ShaderGraph, ShaderGraphPreset } from './types';

interface Draft {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function graph(build: (add: (node: GraphNode) => string, wire: (from: string, socket: string, to: string, input: string) => void) => void): ShaderGraph {
  const draft: Draft = { nodes: [], edges: [] };
  const add = (node: GraphNode) => {
    draft.nodes.push(node);
    return node.id;
  };
  const wire = (from: string, socket: string, to: string, input: string) => {
    draft.edges.push({ id: `e${draft.edges.length}`, from: { node: from, socket }, to: { node: to, socket: input } });
  };
  build(add, wire);
  return { version: 1, nodes: draft.nodes, edges: draft.edges };
}

function unlitTexture(): ShaderGraph {
  return graph((add, wire) => {
    const tex = add({ id: 'tex0', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 });
    const vertex = add({ id: 'vc0', type: 'vertexColor', channel: 0, x: 0, y: 220 });
    const color = add({ id: 'mulColor', type: 'multiply', x: 280, y: 40 });
    const alpha = add({ id: 'mulAlpha', type: 'multiply', x: 280, y: 300 });
    const out = add({ id: 'out', type: 'output', x: 560, y: 140 });
    wire(tex, 'rgb', color, 'a');
    wire(vertex, 'rgb', color, 'b');
    wire(tex, 'alpha', alpha, 'a');
    wire(vertex, 'alpha', alpha, 'b');
    wire(color, 'out', out, 'color');
    wire(alpha, 'out', out, 'alpha');
  });
}

function textureBlend(): ShaderGraph {
  return graph((add, wire) => {
    const first = add({ id: 'tex0', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 });
    const second = add({ id: 'tex1', type: 'texture', sampler: 1, texCoord: 1, x: 0, y: 180 });
    const vertex = add({ id: 'vc0', type: 'vertexColor', channel: 0, x: 0, y: 360 });
    // One stage can only bind one texture, so the base has to land in a register first and the
    // mix reads it back in the stage that samples the second texture.
    const base = add({ id: 'base', type: 'add', x: 300, y: 0, label: 'Base layer' });
    const mix = add({ id: 'mix', type: 'lerp', x: 600, y: 90, label: 'Blend by vertex colour' });
    const alpha = add({ id: 'alpha', type: 'multiply', x: 300, y: 380 });
    const out = add({ id: 'out', type: 'output', x: 900, y: 200 });
    wire(first, 'rgb', base, 'a');
    wire(base, 'out', mix, 'a');
    wire(second, 'rgb', mix, 'b');
    wire(vertex, 'rgb', mix, 't');
    wire(first, 'alpha', alpha, 'a');
    wire(vertex, 'alpha', alpha, 'b');
    wire(mix, 'out', out, 'color');
    wire(alpha, 'out', out, 'alpha');
  });
}

function additiveGlow(): ShaderGraph {
  return graph((add, wire) => {
    const tex = add({ id: 'tex0', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 });
    const tint = add({ id: 'k0', type: 'constant', slot: 0, x: 0, y: 180 });
    const vertex = add({ id: 'vc0', type: 'vertexColor', channel: 0, x: 0, y: 340 });
    const tinted = add({ id: 'tinted', type: 'multiply', x: 300, y: 60 });
    const boost = add({ id: 'boost', type: 'scale', scale: 2, bias: 0, clamp: true, x: 560, y: 60, label: 'Twice as bright' });
    const alpha = add({ id: 'alpha', type: 'multiply', x: 300, y: 360 });
    const out = add({ id: 'out', type: 'output', x: 840, y: 200 });
    wire(tex, 'rgb', tinted, 'a');
    wire(tint, 'rgb', tinted, 'b');
    wire(tinted, 'out', boost, 'x');
    wire(tex, 'alpha', alpha, 'a');
    wire(vertex, 'alpha', alpha, 'b');
    wire(boost, 'out', out, 'color');
    wire(alpha, 'out', out, 'alpha');
  });
}

function envMap(): ShaderGraph {
  return graph((add, wire) => {
    const base = add({ id: 'tex0', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 });
    const env = add({ id: 'tex1', type: 'texture', sampler: 1, texCoord: 1, x: 0, y: 200, label: 'Reflection (set layer 2 to env camera)' });
    const vertex = add({ id: 'vc0', type: 'vertexColor', channel: 0, x: 0, y: 400 });
    const lit = add({ id: 'lit', type: 'multiply', x: 300, y: 40 });
    const shine = add({ id: 'shine', type: 'add', x: 600, y: 120 });
    const out = add({ id: 'out', type: 'output', x: 900, y: 220 });
    wire(base, 'rgb', lit, 'a');
    wire(vertex, 'rgb', lit, 'b');
    wire(lit, 'out', shine, 'a');
    wire(env, 'rgb', shine, 'b');
    wire(shine, 'out', out, 'color');
    wire(base, 'alpha', out, 'alpha');
  });
}

function vertexColorOnly(): ShaderGraph {
  return graph((add, wire) => {
    const vertex = add({ id: 'vc0', type: 'vertexColor', channel: 0, x: 0, y: 0 });
    const color = add({ id: 'color', type: 'add', x: 300, y: 0, label: 'Pass through' });
    const alpha = add({ id: 'alpha', type: 'add', x: 300, y: 220, label: 'Pass through' });
    const out = add({ id: 'out', type: 'output', x: 600, y: 100 });
    wire(vertex, 'rgb', color, 'a');
    wire(vertex, 'alpha', alpha, 'a');
    wire(color, 'out', out, 'color');
    wire(alpha, 'out', out, 'alpha');
  });
}

export const SHADER_GRAPH_PRESETS: ShaderGraphPreset[] = [
  {
    id: 'unlit-texture',
    title: 'Texture x vertex colour',
    description: 'One texture tinted by the mesh\'s vertex colours. What most Mario Kart Wii road and scenery materials do.',
    samplerCount: 1,
    graph: unlitTexture(),
  },
  {
    id: 'lit-texture',
    title: 'Lit texture',
    description: 'The same as "Texture x vertex colour", but channel 1 takes its colour from the material register and the course lights instead of the mesh\'s vertex colours.',
    samplerCount: 1,
    graph: unlitTexture(),
  },
  {
    id: 'texture-blend',
    title: 'Blend two textures',
    description: 'Mixes a second texture over the first, masked by the mesh\'s vertex colour — the usual way a track fades road into dirt.',
    samplerCount: 2,
    graph: textureBlend(),
  },
  {
    id: 'additive-glow',
    title: 'Additive glow',
    description: 'A texture tinted by konst colour 1 and doubled in brightness. Pair it with an additive blend for lights and flames.',
    samplerCount: 1,
    graph: additiveGlow(),
  },
  {
    id: 'env-map',
    title: 'Environment map',
    description: 'A base texture plus a reflection layer. Set layer 2 to "Env camera" so its coordinates follow the view: the classic metal look.',
    samplerCount: 2,
    graph: envMap(),
  },
  {
    id: 'vertex-color-only',
    title: 'Vertex colour only',
    description: 'No texture at all — the mesh\'s own colours. Useful for skyboxes and flat-shaded scenery.',
    samplerCount: 0,
    graph: vertexColorOnly(),
  },
];

/**
 * Presets whose look needs lighting on channel 0 as well as the graph. The graph cannot say so —
 * lighting is material state, not a TEV stage — so the editor turns it on when applying these.
 */
export const PRESET_WANTS_LIGHTING: ReadonlySet<string> = new Set(['lit-texture']);
