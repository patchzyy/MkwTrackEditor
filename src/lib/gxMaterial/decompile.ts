// Turning TEV stages back into a shader graph.
//
// One node cluster per stage half. A stage computes `d ± lerp(a, b, c)`, and the cluster is the
// smallest set of nodes that says the same thing: a lone `multiply` when that is all the stage
// does (`a` and `d` zero), a lone `lerp` when `d` is zero, a lone `add` / `subtract` when the lerp
// part is just `a`, and otherwise an `add` fed by a `lerp` (or a `multiply`) that the compiler
// fuses back into one stage. A `scale` node goes on top when the stage biases, scales or leaves
// its result unclamped.
//
// The hardware constants ZERO / HALF / ONE are typed into the consuming node (`inputValues`), the
// way Unreal shows an unwired pin's value, rather than wired from a shared "Value" node. The other
// inputs become source nodes — a `texture` per (sampler, coordinate), a `vertexColor` per channel,
// a `constant` per konst selection, a `register` per start colour — shared between the colour and
// alpha halves of one stage but never across stages: a texture read by stages 0 and 4 is two
// cards, each beside the step that samples it, not one card with wires across the whole graph.
// Positions come from `layoutShaderGraph`.
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
import { GRAPH_LAYOUT_COLUMN_GAP, GRAPH_LAYOUT_NODE_WIDTH, layoutShaderGraph } from './graphLayout';
import { withInlineValue } from './graphLiterals';
import type { GraphEdge, GraphInlineValue, GraphNode, GxMaterialDoc, GxTevStageDoc, ShaderGraph } from './types';

/** A socket a later node can read from. */
interface InputRef {
  node: string;
  socket: string;
}

/** What one stage operand reads: a socket to wire from, or a literal to type into the input. */
type OperandRef = InputRef | { value: GraphInlineValue };

function isLiteral(ref: OperandRef, value?: GraphInlineValue): ref is { value: GraphInlineValue } {
  return 'value' in ref && (value === undefined || ref.value === value);
}

interface Builder {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Source nodes of the stage being built, by what they read. Reset per stage. */
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

/** Wires an operand into `socket`, or types it into the node when it is a literal. */
function feed(builder: Builder, ref: OperandRef, node: GraphNode, socket: string): void {
  if (!isLiteral(ref)) {
    connect(builder, ref, node.id, socket);
    return;
  }
  const typed = withInlineValue(node, socket, ref.value);
  if (typed.inputValues) node.inputValues = typed.inputValues;
  else delete node.inputValues;
}

/**
 * Source nodes are shared within a stage — the texture a stage samples feeds its colour and its
 * alpha from one card — and made afresh for the next stage. Ids are `src<n>`, which is also how
 * `pruneUnusedSources` recognises them.
 */
function source(builder: Builder, key: string, make: (id: string, x: number, y: number) => GraphNode): string {
  const existing = builder.sources.get(key);
  if (existing) return existing;
  const id = `src${builder.sourceCount++}`;
  addNode(builder, make(id, 0, 0));
  builder.sources.set(key, id);
  return id;
}

interface StageContext {
  builder: Builder;
  /** Which node last wrote each register, per pipeline. */
  colorWriters: Map<GX.Register, InputRef>;
  alphaWriters: Map<GX.Register, InputRef>;
  /**
   * Filled in by `buildHalf` when it gives up on an operand: `"colour B: vertex colour alpha"`.
   * `decompileShaderReport` turns it into the reason the card shows, and
   * `scripts/shader-graph-coverage.mjs` into the histogram that says what to build next.
   */
  refusals: Map<number, string[]>;
}

/** Names for the two operand sets, used only in the "why is this raw" report. */
const CC_NAMES: Record<number, string> = {
  [GX.CC.CPREV]: 'previous result', [GX.CC.APREV]: 'previous alpha',
  [GX.CC.C0]: 'stored colour 1', [GX.CC.A0]: 'stored alpha 1',
  [GX.CC.C1]: 'stored colour 2', [GX.CC.A1]: 'stored alpha 2',
  [GX.CC.C2]: 'stored colour 3', [GX.CC.A2]: 'stored alpha 3',
  [GX.CC.TEXC]: 'texture colour', [GX.CC.TEXA]: 'texture alpha',
  [GX.CC.RASC]: 'vertex colour', [GX.CC.RASA]: 'vertex colour alpha',
  [GX.CC.ONE]: 'one', [GX.CC.HALF]: 'a half', [GX.CC.KONST]: 'a constant', [GX.CC.ZERO]: 'zero',
};

const CA_NAMES: Record<number, string> = {
  [GX.CA.APREV]: 'previous alpha', [GX.CA.A0]: 'stored alpha 1', [GX.CA.A1]: 'stored alpha 2',
  [GX.CA.A2]: 'stored alpha 3', [GX.CA.TEXA]: 'texture alpha', [GX.CA.RASA]: 'vertex colour alpha',
  [GX.CA.KONST]: 'a constant', [GX.CA.ZERO]: 'zero',
};

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

/** The slot-reading node, shared per slot: `'prev'`, or 0..2 for C0..C2. */
function storedValueSource(builder: Builder, slot: 'prev' | 0 | 1 | 2): string {
  return source(builder, `stored${slot}`, (id, x, y) => ({ id, type: 'storedValue', slot, x, y }));
}

/**
 * An alpha source read into a colour input. One node per distinct source in a stage, shared like
 * any other: the operand names a place, and both reads of the same place read the same thing.
 */
function alphaAsColorSource(builder: Builder, key: string, inner: (builder: Builder) => InputRef): InputRef {
  const existing = builder.sources.get(`aac:${key}`);
  if (existing) return { node: existing, socket: 'rgb' };
  const from = inner(builder);
  const id = `src${builder.sourceCount++}`;
  addNode(builder, { id, type: 'alphaAsColor', x: 0, y: 0 });
  builder.sources.set(`aac:${key}`, id);
  connect(builder, from, id, 'alpha');
  return { node: id, socket: 'rgb' };
}

function channelSource(builder: Builder, stage: GxTevStageDoc): string {
  return source(builder, `ras${stage.channelId}`, (id, x, y) => ({
    id, type: 'vertexColor', channel: stage.channelId, x, y,
  }));
}

function colorInputRef(context: StageContext, cc: GX.CC, stage: GxTevStageDoc): OperandRef | null {
  const { builder } = context;
  switch (cc) {
    case GX.CC.ZERO:
      return { value: 0 };
    case GX.CC.HALF:
      return { value: 0.5 };
    case GX.CC.ONE:
      return { value: 1 };
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
      // Nothing has written the working slot yet, so what this reads is its starting colour.
      return context.colorWriters.get(GX.Register.PREV) ?? { node: storedValueSource(builder, 'prev'), socket: 'rgb' };
    case GX.CC.C0:
    case GX.CC.C1:
    case GX.CC.C2: {
      const slot = (cc - GX.CC.C0) / 2;
      const written = context.colorWriters.get((GX.Register.REG0 + slot) as GX.Register);
      if (written) return written;
      return { node: source(builder, `reg${slot}`, (id, x, y) => ({ id, type: 'register', slot, x, y })), socket: 'rgb' };
    }

    // The alpha operands a colour input can name. Each becomes an "Alpha as colour" node over the
    // source it reads; a slot's alpha is read back through "Stored value" rather than wired across
    // from the alpha pipeline, because a colour input names a place, not another step's result.
    case GX.CC.TEXA:
      if (stage.texMap === GX.TexMapID.TEXMAP_NULL) return null;
      return alphaAsColorSource(builder, `tex${stage.texMap}:${stage.texCoordId}`, (b) => ({ node: textureSource(b, stage), socket: 'alpha' }));
    case GX.CC.RASA:
      return alphaAsColorSource(builder, `ras${stage.channelId}`, (b) => ({ node: channelSource(b, stage), socket: 'alpha' }));
    case GX.CC.APREV:
      return alphaAsColorSource(builder, 'prev', (b) => ({ node: storedValueSource(b, 'prev'), socket: 'alpha' }));
    case GX.CC.A0:
    case GX.CC.A1:
    case GX.CC.A2: {
      const slot = ((cc - GX.CC.A0) / 2) as 0 | 1 | 2;
      const register = (GX.Register.REG0 + slot) as GX.Register;
      // A slot nothing has written still holds its starting colour, and that is a different node.
      return context.alphaWriters.has(register)
        ? alphaAsColorSource(builder, `stored${slot}`, (b) => ({ node: storedValueSource(b, slot), socket: 'alpha' }))
        : alphaAsColorSource(builder, `reg${slot}`, (b) => ({
          node: source(b, `reg${slot}`, (id, x, y) => ({ id, type: 'register', slot, x, y })),
          socket: 'alpha',
        }));
    }
    default:
      return null;
  }
}

function alphaInputRef(context: StageContext, ca: GX.CA, stage: GxTevStageDoc): OperandRef | null {
  const { builder } = context;
  switch (ca) {
    // The only literal the alpha operand set has. A half or a one in alpha is a konst selection,
    // which decompiles to a `constant` node like any other konst read.
    case GX.CA.ZERO:
      return { value: 0 };
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
      return context.alphaWriters.get(GX.Register.PREV) ?? { node: storedValueSource(builder, 'prev'), socket: 'alpha' };
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

  const operands = domain === 'color'
    ? ([stage.colorInA, stage.colorInB, stage.colorInC, stage.colorInD] as number[])
    : ([stage.alphaInA, stage.alphaInB, stage.alphaInC, stage.alphaInD] as number[]);
  const inputs = domain === 'color'
    ? (operands as GX.CC[]).map((cc) => colorInputRef(context, cc, stage))
    : (operands as GX.CA[]).map((ca) => alphaInputRef(context, ca, stage));
  if (inputs.some((input) => input === null)) {
    const refused = context.refusals.get(index) ?? [];
    inputs.forEach((input, slot) => {
      if (input !== null) return;
      const name = domain === 'color' ? CC_NAMES[operands[slot]] : CA_NAMES[operands[slot]];
      refused.push(`${domain === 'color' ? 'colour' : 'alpha'} ${'ABCD'[slot]}: ${name ?? `#${operands[slot]}`}`);
    });
    context.refusals.set(index, refused);
    return null;
  }
  const [a, b, c, d] = inputs as OperandRef[];

  const op = domain === 'color' ? stage.colorOp : stage.alphaOp;
  const bias = domain === 'color' ? stage.colorBias : stage.alphaBias;
  const scale = domain === 'color' ? stage.colorScale : stage.alphaScale;
  const clamp = domain === 'color' ? stage.colorClamp : stage.alphaClamp;

  /** Adds a cluster node with its operands wired in or typed in, socket by socket. */
  const step = (node: GraphNode, wiring: Array<[OperandRef, string]>): GraphNode => {
    addNode(builder, node);
    for (const [ref, socket] of wiring) feed(builder, ref, node, socket);
    return node;
  };
  const rootId = `s${index}${letter}`;

  if (op >= GX.TevOp.COMP_R8_GT) {
    // A compare stage reuses the bias and scale fields to name the comparison, so there is no
    // scale node to add: the op says it all.
    step({ id: rootId, type: 'compare', op, x: 0, y: 0, stageTemplate: stage }, [[a, 'a'], [b, 'b'], [c, 'c'], [d, 'd']]);
    return { node: rootId, socket: 'out' };
  }

  // The fewest nodes that lower back to exactly this stage (the compiler's table, read backwards):
  //   multiply(x, y)            A=0 B=x C=y D=0
  //   lerp(x, y, t)             A=x B=y C=t D=0
  //   add / subtract(x, y)      A=y B=0 C=0 D=x
  //   add / subtract(x, step)   D=x, with a multiply or lerp feeding `b` fused into the same stage
  const subtract = op === GX.TevOp.SUB;
  const sum = subtract ? 'subtract' : 'add';
  const product = (id: string) => isLiteral(a, 0)
    ? step({ id, type: 'multiply', x: 0, y: 0, stageTemplate: stage }, [[b, 'a'], [c, 'b']])
    : step({ id, type: 'lerp', x: 0, y: 0, stageTemplate: stage }, [[a, 'a'], [b, 'b'], [c, 't']]);
  let root: GraphNode;
  // "Add K" reads better than "lerp from K to 0 by 0", so the add form wins when both fit.
  if (isLiteral(b, 0) && isLiteral(c, 0)) {
    root = step({ id: rootId, type: sum, x: 0, y: 0, stageTemplate: stage }, [[d, 'a'], [a, 'b']]);
  } else if (!subtract && isLiteral(d, 0)) {
    root = product(rootId);
  } else {
    const inner = product(`s${index}${letter}l`);
    root = step({ id: rootId, type: sum, x: 0, y: 0, stageTemplate: stage }, [[d, 'a'], [{ node: inner.id, socket: 'out' }, 'b']]);
  }

  if (bias !== GX.TevBias.ZERO || scale !== GX.TevScale.SCALE_1 || !clamp) {
    root = step({
      id: `s${index}${letter}s`,
      type: 'scale',
      scale: scaleValue(scale),
      bias: biasValue(bias),
      clamp,
      x: 0,
      y: 0,
      stageTemplate: stage,
    }, [[{ node: root.id, socket: 'out' }, 'x']]);
  }
  return { node: root.id, socket: 'out' };
}

function buildGraph(material: GxMaterialDoc, forceRaw: ReadonlySet<number>, refusals = new Map<number, string[]>()): ShaderGraph {
  const builder: Builder = { nodes: [], edges: [], sources: new Map(), sourceCount: 0 };
  const context: StageContext = { builder, colorWriters: new Map(), alphaWriters: new Map(), refusals };

  let lastColor: InputRef | null = null;
  let lastAlpha: InputRef | null = null;
  let lastStage: InputRef | null = null;

  for (let index = 0; index < material.tevStages.length; index++) {
    const stage = material.tevStages[index];
    builder.sources = new Map();
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
    addNode(builder, { id, type: 'rawStage', stage: { ...stage }, x: 0, y: 0 });
    if (lastStage) connect(builder, lastStage, id, 'prev');
    if (lastAlpha) connect(builder, lastAlpha, id, 'prevAlpha');
    const colorRef: InputRef = { node: id, socket: 'out' };
    const alphaRef: InputRef = { node: id, socket: 'alpha' };
    context.colorWriters.set(stage.colorRegId, colorRef);
    context.alphaWriters.set(stage.alphaRegId, alphaRef);
    lastColor = colorRef;
    lastAlpha = alphaRef;
    lastStage = colorRef;
  }

  const output = addNode(builder, { id: 'out', type: 'output', x: 0, y: 0 });
  if (lastColor) connect(builder, lastColor, output, 'color');
  if (lastAlpha) connect(builder, lastAlpha, output, 'alpha');

  pruneUnusedSources(builder);
  markUnusedClusters(builder, output);
  return { version: 1, nodes: builder.nodes, edges: builder.edges };
}

/**
 * A stage half whose result no later stage reads still runs on the hardware — a kart body works
 * out an alpha in stage 0 that stage 1 overwrites without looking at it. Nothing in the graph
 * points at such a cluster, so the walk from the material output would miss it and the stage would
 * come back as a pass-through. Marking its root tells the compiler to emit it anyway.
 */
function markUnusedClusters(builder: Builder, outputId: string): void {
  const reachable = new Set<string>([outputId]);
  const stack = [outputId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const edge of builder.edges) {
      if (edge.to.node !== id || reachable.has(edge.from.node)) continue;
      reachable.add(edge.from.node);
      stack.push(edge.from.node);
    }
  }
  const consumed = new Set(builder.edges.map((edge) => edge.from.node));
  for (const node of builder.nodes) {
    // The root of a cluster is the one nothing reads; the lerp and the scale inside it are wired
    // to their neighbour and are lowered along with it.
    if (reachable.has(node.id) || consumed.has(node.id)) continue;
    if (node.stageTemplate === undefined || node.type === 'rawStage') continue;
    node.unusedResult = true;
  }
}

/**
 * A half that failed to build may have left a source node behind; drop anything unwired. Only
 * the source nodes (`src<n>`) qualify: a stage cluster nobody reads still has wires running into
 * it, and removing its root would leave those wires pointing at nothing.
 */
function pruneUnusedSources(builder: Builder): void {
  // Repeated, because an "Alpha as colour" node is itself fed by a source: dropping it can leave
  // the texture behind it unread, and that one has to go too.
  for (;;) {
    const used = new Set(builder.edges.map((edge) => edge.from.node));
    const drop = new Set(builder.nodes.filter((node) => node.id.startsWith('src') && !used.has(node.id)).map((node) => node.id));
    if (drop.size === 0) break;
    builder.nodes = builder.nodes.filter((node) => !drop.has(node.id));
    builder.edges = builder.edges.filter((edge) => !drop.has(edge.to.node) && !drop.has(edge.from.node));
  }
}

/**
 * Source cards placed where an Unreal user would put them, given a first layout:
 *
 *  - A source whose readers sit two or more columns apart gets a copy beside the far ones, rather
 *    than one wire running past the cards in between. Sources are reads of a place, so a copy is
 *    free: Unreal users duplicate constants and texture samples the same way.
 *  - Sources are made per stage, so two stages the layout puts side by side can end up with two
 *    identical cards in one column — two "Start colour 1" cards one above the other. Those twins
 *    become one card.
 *
 * Neither can change what compiles, but the round trip is the promise, so it is checked, and the
 * untouched graph kept if it ever came back different.
 */
function tidySources(graph: ShaderGraph, material: GxMaterialDoc): ShaderGraph {
  const split = splitSpreadSources(graph);
  const merged = layoutShaderGraph(mergeTwinSources(split === graph ? graph : layoutShaderGraph(split)));
  if (split === graph && merged.nodes.length === graph.nodes.length) return graph;
  const compiled = compileShaderGraph(merged, material);
  return compiled.ok && firstMismatch(compiled.tevStages, material.tevStages) < 0 ? merged : graph;
}

/** Column to column distance in a default-sized layout, which is what the decompiler makes. */
const COLUMN_PITCH = GRAPH_LAYOUT_NODE_WIDTH + GRAPH_LAYOUT_COLUMN_GAP;

function isPlainSource(node: GraphNode, fed: ReadonlySet<string>): boolean {
  return node.id.startsWith('src') && !fed.has(node.id);
}

function splitSpreadSources(graph: ShaderGraph): ShaderGraph {
  const fed = new Set(graph.edges.map((edge) => edge.to.node));
  const xOf = new Map(graph.nodes.map((node) => [node.id, node.x]));
  let next = Math.max(-1, ...graph.nodes.map((node) => Number(/^src(\d+)$/.exec(node.id)?.[1] ?? -1))) + 1;
  const nodes = [...graph.nodes];
  const rewired = new Map<string, string>();
  for (const node of graph.nodes) {
    if (!isPlainSource(node, fed)) continue;
    const readers = graph.edges.filter((edge) => edge.from.node === node.id);
    const columns = [...new Set(readers.map((edge) => xOf.get(edge.to.node)!))].sort((a, b) => a - b);
    // Readers in neighbouring columns share the card; skipping a whole column starts a new one.
    let card = node.id;
    for (let index = 1; index < columns.length; index++) {
      if (columns[index] - columns[index - 1] > COLUMN_PITCH) {
        card = `src${next++}`;
        nodes.push({ ...node, id: card });
      }
      if (card === node.id) continue;
      for (const edge of readers) if (xOf.get(edge.to.node) === columns[index]) rewired.set(edge.id, card);
    }
  }
  if (rewired.size === 0) return graph;
  return {
    ...graph,
    nodes,
    edges: graph.edges.map((edge) => {
      const from = rewired.get(edge.id);
      return from ? { ...edge, from: { ...edge.from, node: from } } : edge;
    }),
  };
}

function mergeTwinSources(graph: ShaderGraph): ShaderGraph {
  const fed = new Set(graph.edges.map((edge) => edge.to.node));
  const keep = new Map<string, string>();
  const merged = new Map<string, string>();
  for (const node of graph.nodes) {
    if (!isPlainSource(node, fed)) continue;
    const { id: _id, x, y: _y, ...rest } = node;
    const key = `${x}|${JSON.stringify(rest)}`;
    const twin = keep.get(key);
    if (twin) merged.set(node.id, twin);
    else keep.set(key, node.id);
  }
  if (merged.size === 0) return graph;
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !merged.has(node.id)),
    edges: graph.edges.map((edge) => {
      const into = merged.get(edge.from.node);
      return into ? { ...edge, from: { ...edge.from, node: into } } : edge;
    }),
  };
}

function stagesEqual(a: GxTevStageDoc, b: GxTevStageDoc): boolean {
  return (Object.keys(a) as Array<keyof GxTevStageDoc>).every((key) => a[key] === b[key]);
}

/** Field-by-field diff of a recompiled stage against the one the file holds. */
function differingFields(compiled: GxTevStageDoc | undefined, expected: GxTevStageDoc): string[] {
  if (!compiled) return ['(no stage compiled)'];
  return (Object.keys(expected) as Array<keyof GxTevStageDoc>).filter((key) => compiled[key] !== expected[key]);
}

function firstMismatch(compiled: readonly GxTevStageDoc[], expected: readonly GxTevStageDoc[]): number {
  for (let i = 0; i < expected.length; i++) {
    if (!compiled[i] || !stagesEqual(compiled[i], expected[i])) return i;
  }
  return compiled.length === expected.length ? -1 : Math.max(0, expected.length - 1);
}

/** Why one stage had to be kept verbatim instead of being drawn as nodes. */
export interface RawStageCause {
  /** Index into `material.tevStages`. */
  index: number;
  /**
   * `'operand'` — an input the node vocabulary has no source for; `refusals` names them.
   * `'mismatch'` — the nodes recompiled to a different stage; `fields` names what came back wrong.
   * `'fallback'` — the search stopped making progress and the whole material went verbatim.
   */
  kind: 'operand' | 'mismatch' | 'fallback';
  /** For `'operand'`: `["colour B: vertex colour alpha"]`. */
  refusals: string[];
  /** For `'mismatch'`: the `GxTevStageDoc` keys that differed. */
  fields: string[];
  /** For `'mismatch'`: `"colorRegId 1 -> 0"` per field, for the histogram's detail column. */
  details: string[];
}

/**
 * One plain sentence for the card: what about this step the editor cannot draw. It is the whole
 * point of the "Special step" not being a dead end — the user should never have to guess.
 */
function describeCause(cause: RawStageCause, stage: GxTevStageDoc | undefined): string {
  if (cause.kind === 'fallback') {
    return 'This material\'s steps could not be separated into nodes without changing what it draws, '
      + 'so every one of them is kept exactly as the file has it.';
  }
  if (cause.kind === 'operand') {
    const reads = cause.refusals.map((entry) => entry.replace(/^(colour|alpha) [ABCD]: /, ''));
    const unique = [...new Set(reads)];
    if (stage && stage.texMap === GX.TexMapID.TEXMAP_NULL && unique.some((entry) => entry.startsWith('texture'))) {
      return 'It reads a texture, but no texture is bound to this step, and the editor has no node '
        + 'for a texture that is not there.';
    }
    if (unique.length > 0) return `It reads ${unique.join(' and ')}, which the editor has no node for.`;
    return 'It uses something the editor has no node for.';
  }
  return `Drawn as nodes this step would not come back exactly as the file has it (${cause.fields.slice(0, 4).join(', ')}), `
    + 'so it is kept verbatim instead.';
}

export interface DecompileReport {
  graph: ShaderGraph;
  /** One entry per raw stage in `graph`, in stage order. Empty when the graph is fully expressed. */
  causes: RawStageCause[];
  /** How many of `material.tevStages` came back as `rawStage` nodes. */
  rawStages: number;
  stages: number;
}

/**
 * The decompiler with its working shown. `decompileShader` is this without the bookkeeping; the
 * report is what the "Special step" card explains to the user and what the coverage script counts.
 */
export function decompileShaderReport(material: GxMaterialDoc): DecompileReport {
  const forceRaw = new Set<number>();
  const causes = new Map<number, RawStageCause>();
  let refusals = new Map<number, string[]>();
  let graph: ShaderGraph | null = null;

  for (let attempt = 0; attempt <= material.tevStages.length; attempt++) {
    refusals = new Map();
    graph = buildGraph(material, forceRaw, refusals);
    const compiled = compileShaderGraph(graph, material);
    const bad = compiled.ok ? firstMismatch(compiled.tevStages, material.tevStages) : 0;
    if (compiled.ok && bad < 0) break;
    if (forceRaw.has(bad)) {
      // No progress left: every stage goes verbatim, and nothing more specific can be said.
      const all = new Set(material.tevStages.map((_, index) => index));
      refusals = new Map();
      graph = buildGraph(material, all, refusals);
      for (const index of all) {
        causes.set(index, { index, kind: 'fallback', refusals: refusals.get(index) ?? [], fields: [], details: [] });
      }
      break;
    }
    const fields = differingFields(compiled.tevStages[bad], material.tevStages[bad]);
    causes.set(bad, {
      index: bad,
      kind: 'mismatch',
      refusals: [],
      fields,
      details: fields.map((field) => {
        const key = field as keyof GxTevStageDoc;
        return `${field} ${String(material.tevStages[bad][key])} -> ${String(compiled.tevStages[bad]?.[key])}`;
      }),
    });
    forceRaw.add(bad);
  }

  const rawIndices = (graph?.nodes ?? [])
    .filter((node) => node.type === 'rawStage')
    .map((node) => Number(/^s(\d+)r$/.exec(node.id)?.[1] ?? -1))
    .filter((index) => index >= 0);
  for (const index of rawIndices) {
    if (causes.has(index)) continue;
    causes.set(index, { index, kind: 'operand', refusals: refusals.get(index) ?? [], fields: [], details: [] });
  }
  // A stage pinned mid-search may have become expressible once a later one was pinned too; only
  // the raw nodes that survived into the final graph are really raw.
  for (const index of [...causes.keys()]) if (!rawIndices.includes(index)) causes.delete(index);

  const result = tidySources(layoutShaderGraph(graph ?? buildGraph(material, forceRaw)), material);
  const ordered = [...causes.values()].sort((a, b) => a.index - b.index);
  // The card explains itself, so the sentence travels with the node — including into IndexedDB.
  for (const cause of ordered) {
    const node = result.nodes.find((entry) => entry.id === `s${cause.index}r`);
    if (node?.type === 'rawStage') node.reason = describeCause(cause, material.tevStages[cause.index]);
  }
  return { graph: result, causes: ordered, rawStages: rawIndices.length, stages: material.tevStages.length };
}

export function decompileShader(material: GxMaterialDoc): ShaderGraph {
  return decompileShaderReport(material).graph;
}
