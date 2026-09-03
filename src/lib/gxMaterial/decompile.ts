// Turning TEV stages back into a shader graph.
//
// One node cluster per stage, laid out left to right. A stage computes `d ± lerp(a, b, c)`, so
// its cluster is an `add` (or `subtract`) fed by a `lerp`, with a `scale` node on top when the
// stage biases, scales or leaves its result unclamped. The four inputs become shared source
// nodes: one `texture` per (sampler, coordinate) pair, one `vertexColor` per channel, one
// `constant` per konst selection, one `register` per register the material starts with, and
// `value` nodes for the hardware constants.
//
// Two things make the round trip exact rather than approximate:
//
//  - Each cluster node carries the original stage as its `stageTemplate`, so the fields the graph
//    has no opinion about — the konst selection a stage names even when it reads no konst, the
//    swap tables, the indirect setup — come back unchanged.
//  - Anything the node vocabulary genuinely cannot say (an alpha value used as a colour input, a
//    stage reading the previous-stage register before any stage wrote it) becomes a `rawStage`
//    node holding the stage verbatim.
//
// Which of the two applies is not guessed: `decompileShader` compiles what it built, compares it
// against the material, and re-does any stage that came back different as a raw stage. So the
// invariant the tests check — `compile(decompile(m)).tevStages` equals `m.tevStages` — holds by
// construction, and the raw-stage count measures how much of a real material the graph model
// captures rather than being something that can silently drift.

import * as GX from '../../../vendor/noclip.website/src/gx/gx_enum';
import { compileShaderGraph } from './shaderGraph';
import type { GraphEdge, GraphNode, GxMaterialDoc, GxTevStageDoc, ShaderGraph } from './types';

const STAGE_SPACING = 260;
const ROW_COLOR = 0;
const ROW_ALPHA = 360;

/** A socket a later node can read from. */
interface InputRef {
  node: string;
  socket: string;
}

interface Builder {
  nodes: GraphNode[];
  edges: GraphEdge[];
  sources: Map<string, string>;
  sourceCount: number;
}

interface Checkpoint {
  nodes: number;
  edges: number;
  sources: Array<[string, string]>;
  sourceCount: number;
}

function checkpoint(builder: Builder): Checkpoint {
  return { nodes: builder.nodes.length, edges: builder.edges.length, sources: [...builder.sources], sourceCount: builder.sourceCount };
}

function restore(builder: Builder, mark: Checkpoint): void {
  builder.nodes.length = mark.nodes;
  builder.edges.length = mark.edges;
  builder.sources = new Map(mark.sources);
  builder.sourceCount = mark.sourceCount;
}

function addNode(builder: Builder, node: GraphNode): string {
  builder.nodes.push(node);
  return node.id;
}

function connect(builder: Builder, from: InputRef, to: string, toSocket: string): void {
  builder.edges.push({
    id: `e${builder.edges.length}`,
    from: { node: from.node, socket: from.socket },
    to: { node: to, socket: toSocket },
  });
}

/** Source nodes are shared: one per distinct thing the stages read. */
function source(builder: Builder, key: string, make: (id: string, x: number, y: number) => GraphNode): string {
  const existing = builder.sources.get(key);
  if (existing) return existing;
  const index = builder.sourceCount++;
  const id = `src${index}`;
  addNode(builder, make(id, -260, index * 90));
  builder.sources.set(key, id);
  return id;
}

interface StageContext {
  builder: Builder;
  /** Which node last wrote each register, per pipeline. */
  colorWriters: Map<GX.Register, InputRef>;
  alphaWriters: Map<GX.Register, InputRef>;
}

function konstSlotOf(sel: number): number {
  // K0..K3 as RGB (0x0C..0x0F) or as a single channel (0x10..0x1F, four per channel).
  if (sel >= 0x0c && sel <= 0x0f) return sel - 0x0c;
  if (sel >= 0x10) return (sel - 0x10) & 0x03;
  return 0;
}

function textureSource(builder: Builder, stage: GxTevStageDoc): string {
  return source(builder, `tex${stage.texMap}:${stage.texCoordId}`, (id, x, y) => ({
    id, type: 'texture', sampler: stage.texMap, texCoord: stage.texCoordId, x, y,
  }));
}

function channelSource(builder: Builder, stage: GxTevStageDoc): string {
  return source(builder, `ras${stage.channelId}`, (id, x, y) => ({
    id, type: 'vertexColor', channel: stage.channelId === GX.RasColorChannelID.COLOR1A1 ? 1 : 0, x, y,
  }));
}

function colorInputRef(context: StageContext, cc: GX.CC, stage: GxTevStageDoc): InputRef | null {
  const { builder } = context;
  switch (cc) {
    case GX.CC.ZERO:
      return { node: source(builder, 'v0', (id, x, y) => ({ id, type: 'value', value: 0, x, y })), socket: 'rgb' };
    case GX.CC.HALF:
      return { node: source(builder, 'v0.5', (id, x, y) => ({ id, type: 'value', value: 0.5, x, y })), socket: 'rgb' };
    case GX.CC.ONE:
      return { node: source(builder, 'v1', (id, x, y) => ({ id, type: 'value', value: 1, x, y })), socket: 'rgb' };
    case GX.CC.TEXC:
      if (stage.texMap === GX.TexMapID.TEXMAP_NULL) return null;
      return { node: textureSource(builder, stage), socket: 'rgb' };
    case GX.CC.RASC:
      return { node: channelSource(builder, stage), socket: 'rgb' };
    case GX.CC.KONST:
      return {
        node: source(builder, `kc${stage.konstColorSel}`, (id, x, y) => ({
          id, type: 'constant', slot: konstSlotOf(stage.konstColorSel), colorSel: stage.konstColorSel, x, y,
        })),
        socket: 'rgb',
      };
    case GX.CC.CPREV:
      return context.colorWriters.get(GX.Register.PREV) ?? null;
    case GX.CC.C0:
    case GX.CC.C1:
    case GX.CC.C2: {
      const slot = (cc - GX.CC.C0) / 2;
      const written = context.colorWriters.get((GX.Register.REG0 + slot) as GX.Register);
      if (written) return written;
      return { node: source(builder, `reg${slot}`, (id, x, y) => ({ id, type: 'register', slot, x, y })), socket: 'rgb' };
    }
    default:
      // An alpha value used as a colour input: there is no cross-pipeline wire in the graph.
      return null;
  }
}

function alphaInputRef(context: StageContext, ca: GX.CA, stage: GxTevStageDoc): InputRef | null {
  const { builder } = context;
  switch (ca) {
    case GX.CA.ZERO:
      return { node: source(builder, 'v0', (id, x, y) => ({ id, type: 'value', value: 0, x, y })), socket: 'alpha' };
    case GX.CA.TEXA:
      if (stage.texMap === GX.TexMapID.TEXMAP_NULL) return null;
      return { node: textureSource(builder, stage), socket: 'alpha' };
    case GX.CA.RASA:
      return { node: channelSource(builder, stage), socket: 'alpha' };
    case GX.CA.KONST:
      return {
        node: source(builder, `ka${stage.konstAlphaSel}`, (id, x, y) => ({
          id, type: 'constant', slot: konstSlotOf(stage.konstAlphaSel), alphaSel: stage.konstAlphaSel, x, y,
        })),
        socket: 'alpha',
      };
    case GX.CA.APREV:
      return context.alphaWriters.get(GX.Register.PREV) ?? null;
    case GX.CA.A0:
    case GX.CA.A1:
    case GX.CA.A2: {
      const slot = ca - GX.CA.A0;
      const written = context.alphaWriters.get((GX.Register.REG0 + slot) as GX.Register);
      if (written) return written;
      return { node: source(builder, `reg${slot}`, (id, x, y) => ({ id, type: 'register', slot, x, y })), socket: 'alpha' };
    }
    default:
      return null;
  }
}

function scaleValue(scale: GX.TevScale): 0.5 | 1 | 2 | 4 {
  return scale === GX.TevScale.SCALE_2 ? 2 : scale === GX.TevScale.SCALE_4 ? 4 : scale === GX.TevScale.DIVIDE_2 ? 0.5 : 1;
}

function biasValue(bias: GX.TevBias): -0.5 | 0 | 0.5 {
  return bias === GX.TevBias.ADDHALF ? 0.5 : bias === GX.TevBias.SUBHALF ? -0.5 : 0;
}

/** Builds one half of a stage's cluster, or returns null when the graph cannot express it. */
function buildHalf(context: StageContext, stage: GxTevStageDoc, index: number, domain: 'color' | 'alpha'): InputRef | null {
  const { builder } = context;
  const letter = domain === 'color' ? 'c' : 'a';
  const x = index * STAGE_SPACING;
  const y = domain === 'color' ? ROW_COLOR : ROW_ALPHA;

  const inputs = domain === 'color'
    ? ([stage.colorInA, stage.colorInB, stage.colorInC, stage.colorInD] as GX.CC[]).map((cc) => colorInputRef(context, cc, stage))
    : ([stage.alphaInA, stage.alphaInB, stage.alphaInC, stage.alphaInD] as GX.CA[]).map((ca) => alphaInputRef(context, ca, stage));
  if (inputs.some((input) => input === null)) return null;
  const [a, b, c, d] = inputs as InputRef[];

  const op = domain === 'color' ? stage.colorOp : stage.alphaOp;
  const bias = domain === 'color' ? stage.colorBias : stage.alphaBias;
  const scale = domain === 'color' ? stage.colorScale : stage.alphaScale;
  const clamp = domain === 'color' ? stage.colorClamp : stage.alphaClamp;

  if (op >= GX.TevOp.COMP_R8_GT) {
    // A compare stage reuses the bias and scale fields to name the comparison, so there is no
    // scale node to add: the op says it all.
    const root = addNode(builder, { id: `s${index}${letter}`, type: 'compare', op, x, y, stageTemplate: stage });
    connect(builder, a, root, 'a');
    connect(builder, b, root, 'b');
    connect(builder, c, root, 'c');
    connect(builder, d, root, 'd');
    return { node: root, socket: 'out' };
  }

  // `d ± lerp(a, b, c)` is one stage; the lerp feeds the add's second input and the compiler
  // fuses the pair back together.
  const lerp = addNode(builder, { id: `s${index}${letter}l`, type: 'lerp', x: x - 100, y: y + 150, stageTemplate: stage });
  connect(builder, a, lerp, 'a');
  connect(builder, b, lerp, 'b');
  connect(builder, c, lerp, 't');
  let root = addNode(builder, {
    id: `s${index}${letter}`,
    type: op === GX.TevOp.SUB ? 'subtract' : 'add',
    x,
    y,
    stageTemplate: stage,
  });
  connect(builder, d, root, 'a');
  connect(builder, { node: lerp, socket: 'out' }, root, 'b');

  if (bias !== GX.TevBias.ZERO || scale !== GX.TevScale.SCALE_1 || !clamp) {
    const scaleNode = addNode(builder, {
      id: `s${index}${letter}s`,
      type: 'scale',
      scale: scaleValue(scale),
      bias: biasValue(bias),
      clamp,
      x: x + 120,
      y,
      stageTemplate: stage,
    });
    connect(builder, { node: root, socket: 'out' }, scaleNode, 'x');
    root = scaleNode;
  }
  return { node: root, socket: 'out' };
}

function buildGraph(material: GxMaterialDoc, forceRaw: ReadonlySet<number>): ShaderGraph {
  const builder: Builder = { nodes: [], edges: [], sources: new Map(), sourceCount: 0 };
  const context: StageContext = { builder, colorWriters: new Map(), alphaWriters: new Map() };

  let lastColor: InputRef | null = null;
  let lastAlpha: InputRef | null = null;
  let lastStage: InputRef | null = null;

  for (let index = 0; index < material.tevStages.length; index++) {
    const stage = material.tevStages[index];
    const mark = checkpoint(builder);
    const color = forceRaw.has(index) ? null : buildHalf(context, stage, index, 'color');
    const alpha = color === null || forceRaw.has(index) ? null : buildHalf(context, stage, index, 'alpha');

    if (color !== null && alpha !== null) {
      context.colorWriters.set(stage.colorRegId, color);
      context.alphaWriters.set(stage.alphaRegId, alpha);
      lastColor = color;
      lastAlpha = alpha;
      lastStage = color;
      continue;
    }

    restore(builder, mark);
    const id = `s${index}r`;
    addNode(builder, { id, type: 'rawStage', stage: { ...stage }, x: index * STAGE_SPACING, y: ROW_COLOR });
    if (lastStage) connect(builder, lastStage, id, 'prev');
    const colorRef: InputRef = { node: id, socket: 'out' };
    const alphaRef: InputRef = { node: id, socket: 'alpha' };
    context.colorWriters.set(stage.colorRegId, colorRef);
    context.alphaWriters.set(stage.alphaRegId, alphaRef);
    lastColor = colorRef;
    lastAlpha = alphaRef;
    lastStage = colorRef;
  }

  const output = addNode(builder, {
    id: 'out',
    type: 'output',
    x: material.tevStages.length * STAGE_SPACING,
    y: ROW_COLOR + 180,
  });
  if (lastColor) connect(builder, lastColor, output, 'color');
  if (lastAlpha) connect(builder, lastAlpha, output, 'alpha');

  pruneUnusedSources(builder);
  return { version: 1, nodes: builder.nodes, edges: builder.edges };
}

/** A half that failed to build may have left a source node behind; drop anything unwired. */
function pruneUnusedSources(builder: Builder): void {
  const used = new Set(builder.edges.map((edge) => edge.from.node));
  builder.nodes = builder.nodes.filter((node) => node.type === 'output' || node.type === 'rawStage' || used.has(node.id));
}

function stagesEqual(a: GxTevStageDoc, b: GxTevStageDoc): boolean {
  return (Object.keys(a) as Array<keyof GxTevStageDoc>).every((key) => a[key] === b[key]);
}

function firstMismatch(compiled: readonly GxTevStageDoc[], expected: readonly GxTevStageDoc[]): number {
  for (let i = 0; i < expected.length; i++) {
    if (!compiled[i] || !stagesEqual(compiled[i], expected[i])) return i;
  }
  return compiled.length === expected.length ? -1 : Math.max(0, expected.length - 1);
}

export function decompileShader(material: GxMaterialDoc): ShaderGraph {
  const forceRaw = new Set<number>();
  for (let attempt = 0; attempt <= material.tevStages.length; attempt++) {
    const graph = buildGraph(material, forceRaw);
    const compiled = compileShaderGraph(graph, material);
    const bad = compiled.ok ? firstMismatch(compiled.tevStages, material.tevStages) : 0;
    if (compiled.ok && bad < 0) return graph;
    if (forceRaw.has(bad)) break;
    forceRaw.add(bad);
  }
  return buildGraph(material, new Set(material.tevStages.map((_, index) => index)));
}
