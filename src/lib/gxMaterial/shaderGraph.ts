// Lowering a shader graph to TEV stages.
//
// A TEV stage computes, for colour and alpha independently,
//
//     out = clamp?( (d ± lerp(a, b, c) + bias) * scale )
//
// and binds at most one texture, one texture coordinate, one rasterised channel and one konst
// selection. So the compiler is a lowering pass, not a search: every math node becomes one stage,
// and the only real work is (1) fusing the shapes the hardware does in a single stage, (2) moving
// a value out of the previous-stage register when a later stage still needs it, and (3) zipping
// the colour and alpha stage lists onto the same physical stages.
//
// Colour and alpha are compiled as two independent trees hanging off the output node, because the
// hardware keeps two independent sets of registers. They meet again in `zip`, which pairs a colour
// op with an alpha op when their bindings agree and otherwise gives one of them a pass-through
// (`d = PREV`, everything else zero), which leaves the other pipeline's PREV untouched.
//
// Fields a graph has no opinion about — the konst selection a stage names even when it reads no
// konst, the swap tables, the indirect setup — come from `node.stageTemplate` when there is one.
// That is what lets `compileShaderGraph(decompileShader(m), m)` reproduce a retail material's
// stages exactly rather than approximately.

import * as GX from '../../../vendor/noclip.website/src/gx/gx_enum';
import { createPassThroughStage } from './defaults';
import { GRAPH_NODE_SOCKETS } from './types';
import type {
  CompiledShader,
  GraphDiagnostic,
  GraphEdge,
  GraphNode,
  GraphSocketType,
  GxMaterialDoc,
  GxTevStageDoc,
  ShaderGraph,
} from './types';
import { GX_LIMITS } from './materialCodec';

const MAX_STAGES = GX_LIMITS.tevStages;

/** Which pipeline a node was reached from. */
type Domain = GraphSocketType;

interface TextureBinding {
  texMap: number;
  texCoord: number;
}

interface IndirectBinding {
  indTexStage: GX.IndTexStageID;
  indTexFormat: GX.IndTexFormat;
  indTexBiasSel: GX.IndTexBiasSel;
  indTexMatrix: GX.IndTexMtxID;
  indTexWrapS: GX.IndTexWrap;
  indTexWrapT: GX.IndTexWrap;
  indTexAddPrev: boolean;
}

interface Bindings {
  texture?: TextureBinding;
  channel?: number;
  /** `GX.KonstColorSel` in the colour pipeline, `GX.KonstAlphaSel` in the alpha one. */
  konstSel?: number;
  indirect?: IndirectBinding;
}

/** One half of a TEV stage: the colour side or the alpha side. */
interface HalfOp {
  inputs: [number, number, number, number];
  op: GX.TevOp;
  bias: GX.TevBias;
  scale: GX.TevScale;
  clamp: boolean;
  regId: GX.Register;
  bindings: Bindings;
  template?: GxTevStageDoc;
  /** Set by the decompiler so the two halves of one original stage find each other again. */
  group?: number;
}

interface Slot {
  color?: HalfOp;
  alpha?: HalfOp;
  group?: number;
}

/** What a lowered subtree produced: a place a later stage can read it from. */
interface Operand {
  /** `CC` in the colour pipeline, `CA` in the alpha one. */
  input: number;
  bindings: Bindings;
  /** Which register the value can be read from, or null for a plain hardware input. */
  register: GX.Register | null;
  /**
   * True when a stage computed this value. A `register` node also names a register, but it reads
   * the register's starting colour rather than something a stage put there, so it still needs a
   * stage of its own before the hardware will output it.
   */
  produced?: boolean;
}

const COLOR_REGISTER_INPUT: Record<GX.Register, GX.CC> = {
  [GX.Register.PREV]: GX.CC.CPREV,
  [GX.Register.REG0]: GX.CC.C0,
  [GX.Register.REG1]: GX.CC.C1,
  [GX.Register.REG2]: GX.CC.C2,
};

const ALPHA_REGISTER_INPUT: Record<GX.Register, GX.CA> = {
  [GX.Register.PREV]: GX.CA.APREV,
  [GX.Register.REG0]: GX.CA.A0,
  [GX.Register.REG1]: GX.CA.A1,
  [GX.Register.REG2]: GX.CA.A2,
};

const KONST_COLOR_FOR_SLOT = [GX.KonstColorSel.KCSEL_K0, GX.KonstColorSel.KCSEL_K1, GX.KonstColorSel.KCSEL_K2, GX.KonstColorSel.KCSEL_K3];
const KONST_ALPHA_FOR_SLOT = [GX.KonstAlphaSel.KASEL_K0_A, GX.KonstAlphaSel.KASEL_K1_A, GX.KonstAlphaSel.KASEL_K2_A, GX.KonstAlphaSel.KASEL_K3_A];

const MATH_TYPES = new Set(['multiply', 'add', 'subtract', 'lerp', 'scale', 'compare', 'rawStage']);

export function compileShaderGraph(graph: ShaderGraph, material: GxMaterialDoc): CompiledShader {
  return new Compiler(graph, material).run();
}

function emptyUsage(): CompiledShader['usage'] {
  return { samplers: [], texCoords: [], channels: [], konstColors: [], registers: [], indTexStages: [] };
}

class Compiler {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly diagnostics: GraphDiagnostic[] = [];
  private readonly usage = emptyUsage();
  private readonly slots: Slot[] = [];
  /** Nodes already lowered in the current pipeline, and where their value ended up. */
  private memo = new Map<string, Operand>();
  private consumers = new Map<string, number>();
  private remainingUses = new Map<string, number>();
  private registerOwner = new Map<GX.Register, string>();
  private reservedRegisters = new Set<GX.Register>();
  private inProgress = new Set<string>();
  private readonly lowered = new Set<string>();
  /** Raw stages already emitted; they are whole stages, so both pipelines share one. */
  private readonly rawSlots = new Map<string, Slot>();
  private failed = false;
  private domain: Domain = 'rgb';
  /** Slots whose PREV value is live, so a spill knows what to copy. */
  private prevOperands: Operand[] = [];
  /** First stage this pipeline may still write to; keeps its ops in order while they interleave. */
  private cursor = 0;

  constructor(private readonly graph: ShaderGraph, private readonly material: GxMaterialDoc) {
    for (const node of graph.nodes) this.nodes.set(node.id, node);
  }

  public run(): CompiledShader {
    const output = this.graph.nodes.find((node) => node.type === 'output');
    if (!output) {
      this.error('This shader has no material output node.', undefined);
      return this.result();
    }
    this.checkEdges();

    const colorRoot = this.incoming(output.id, 'color');
    const alphaRoot = this.incoming(output.id, 'alpha');

    this.lowerPipeline('rgb', colorRoot, output.id);
    this.lowerPipeline('alpha', alphaRoot, output.id);
    this.emitOrphanRawStages();

    this.reportDanglingNodes();
    this.orderSlotsByGroup();

    if (this.slots.length > MAX_STAGES) {
      this.error(`This shader needs ${this.slots.length} TEV stages; the hardware has ${MAX_STAGES}. Simplify it or reuse a texture.`, undefined);
    }
    return this.result();
  }

  private result(): CompiledShader {
    const ok = !this.failed && !this.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
    const tevStages = ok ? this.slots.map((slot) => assembleStage(slot)) : [];
    for (const key of Object.keys(this.usage) as Array<keyof CompiledShader['usage']>) {
      this.usage[key] = [...new Set(this.usage[key])].sort((a, b) => a - b);
    }
    return { tevStages, diagnostics: this.diagnostics, ok, usage: this.usage };
  }

  // ------------------------------------------------------------------------------ graph helpers

  private incoming(nodeId: string, socket: string): GraphEdge | null {
    return this.graph.edges.find((edge) => edge.to.node === nodeId && edge.to.socket === socket) ?? null;
  }

  private error(message: string, nodeId: string | undefined, edgeId?: string): void {
    this.diagnostics.push({ severity: 'error', message, nodeId, edgeId });
    this.failed = true;
  }

  private warn(message: string, nodeId?: string, edgeId?: string): void {
    this.diagnostics.push({ severity: 'warning', message, nodeId, edgeId });
  }

  /** Socket names have to exist, and nothing may be wired twice into the same input. */
  private checkEdges(): void {
    const taken = new Set<string>();
    for (const edge of this.graph.edges) {
      const from = this.nodes.get(edge.from.node);
      const to = this.nodes.get(edge.to.node);
      if (!from || !to) {
        this.error('A wire connects a node that is not in this shader.', undefined, edge.id);
        continue;
      }
      if (!GRAPH_NODE_SOCKETS[from.type].outputs.some((socket) => socket.name === edge.from.socket)) {
        this.error(`"${GRAPH_NODE_SOCKETS[from.type].title}" has no output called "${edge.from.socket}".`, from.id, edge.id);
        continue;
      }
      if (!GRAPH_NODE_SOCKETS[to.type].inputs.some((socket) => socket.name === edge.to.socket)) {
        this.error(`"${GRAPH_NODE_SOCKETS[to.type].title}" has no input called "${edge.to.socket}".`, to.id, edge.id);
        continue;
      }
      const key = `${edge.to.node}:${edge.to.socket}`;
      if (taken.has(key)) this.error(`Two wires end on the same "${edge.to.socket}" input.`, to.id, edge.id);
      taken.add(key);
    }
  }

  /** Nodes that exist but cannot reach the output do nothing; say so instead of failing. */
  private reportDanglingNodes(): void {
    for (const node of this.graph.nodes) {
      if (node.type === 'output' || node.type === 'comment') continue;
      if (this.lowered.has(node.id)) continue;
      this.warn(`"${node.label ?? GRAPH_NODE_SOCKETS[node.type].title}" is not wired to the material output, so it does nothing.`, node.id);
    }
  }

  // -------------------------------------------------------------------------------- lowering

  private lowerPipeline(domain: Domain, root: GraphEdge | null, outputId: string): void {
    this.domain = domain;
    this.memo = new Map();
    this.remainingUses = new Map();
    this.registerOwner = new Map();
    this.reservedRegisters = new Set();
    this.prevOperands = [];
    this.cursor = 0;
    this.consumers = this.countConsumers(root);

    // Registers a `register` node reads have to survive; never allocate over them.
    for (const node of this.graph.nodes) {
      if (node.type === 'register') this.reservedRegisters.add((GX.Register.REG0 + Math.max(0, Math.min(2, node.slot))) as GX.Register);
    }

    if (!root) return;
    const result = this.lowerEdgeValue(root, outputId, domain === 'rgb' ? 'color' : 'alpha');
    // A source wired straight to the output — a texture's alpha, say — is not a stage yet. The
    // hardware reads the previous-stage register at the end, so copy it there.
    if (!result.produced) {
      const zero = this.literal(0);
      this.place({
        inputs: [zero.input, zero.input, zero.input, result.input],
        op: GX.TevOp.ADD,
        bias: GX.TevBias.ZERO,
        scale: GX.TevScale.SCALE_1,
        clamp: true,
        regId: GX.Register.PREV,
        bindings: result.bindings,
      });
    }
  }

  /**
   * A raw stage is a whole stage the author pinned, so it runs whether or not the output reads
   * it. Anything the two traversals missed is emitted here, left to right.
   */
  private emitOrphanRawStages(): void {
    const orphans = this.graph.nodes
      .filter((node) => node.type === 'rawStage' && !this.rawSlots.has(node.id))
      .sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
    if (orphans.length === 0) return;
    this.domain = 'rgb';
    this.memo = new Map();
    for (const node of orphans) {
      if (this.rawSlots.has(node.id)) continue;
      this.lowered.add(node.id);
      this.rawStageOperand(node.id);
    }
  }

  private countConsumers(root: GraphEdge | null): Map<string, number> {
    const counts = new Map<string, number>();
    if (!root) return counts;
    const seen = new Set<string>();
    const stack = [root.from.node];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const edge of this.graph.edges) {
        if (edge.to.node !== id) continue;
        // A raw stage's ordering wires carry no value, so they are not a use of what they
        // point at; counting them would spill a result nobody actually reads twice.
        if (!this.isOrderingEdge(edge)) counts.set(edge.from.node, (counts.get(edge.from.node) ?? 0) + 1);
        stack.push(edge.from.node);
      }
    }
    return counts;
  }

  private isOrderingEdge(edge: GraphEdge): boolean {
    return this.nodes.get(edge.to.node)?.type === 'rawStage' && (edge.to.socket === 'prev' || edge.to.socket === 'prevAlpha');
  }

  /** Resolves an input socket to an operand, using the socket's default when nothing is wired. */
  private lowerInput(nodeId: string, socket: string): Operand {
    const edge = this.incoming(nodeId, socket);
    if (edge) return this.lowerEdgeValue(edge, nodeId, socket);
    const node = this.nodes.get(nodeId)!;
    const spec = GRAPH_NODE_SOCKETS[node.type].inputs.find((input) => input.name === socket);
    return this.literal(spec?.default ?? 0);
  }

  private lowerEdgeValue(edge: GraphEdge, toNode: string, toSocket: string): Operand {
    const from = this.nodes.get(edge.from.node);
    if (!from) return this.literal(0);
    const sourceType = this.socketDomain(from, edge.from.socket);
    if (sourceType !== this.domain) {
      const to = this.nodes.get(toNode);
      this.error(
        `"${GRAPH_NODE_SOCKETS[from.type].title}.${edge.from.socket}" is ${sourceType === 'rgb' ? 'a colour' : 'an alpha'} value, ` +
        `but "${GRAPH_NODE_SOCKETS[to?.type ?? 'output'].title}.${toSocket}" takes ${this.domain === 'rgb' ? 'a colour' : 'an alpha'} one.`,
        from.id,
        edge.id,
      );
      return this.literal(0);
    }
    return this.lowerNode(edge.from.node, toNode, edge.from.socket);
  }

  /** A source node's socket has a fixed type; a math node takes the type of the pipeline. */
  private socketDomain(node: GraphNode, socket: string): Domain {
    if (MATH_TYPES.has(node.type) && node.type !== 'rawStage') return this.domain;
    if (node.type === 'rawStage') return socket === 'alpha' ? 'alpha' : 'rgb';
    return GRAPH_NODE_SOCKETS[node.type].outputs.find((output) => output.name === socket)?.type ?? this.domain;
  }

  private lowerNode(nodeId: string, _consumerId: string, socket: string): Operand {
    const cached = this.memo.get(nodeId);
    if (cached) {
      this.consumeMemo(nodeId);
      return cached;
    }
    if (this.inProgress.has(nodeId)) {
      this.error('This shader has a loop; a value cannot depend on itself.', nodeId);
      return this.literal(0);
    }
    const node = this.nodes.get(nodeId);
    if (!node) return this.literal(0);

    this.inProgress.add(nodeId);
    const operand = this.lowerNodeUncached(node, socket);
    this.inProgress.delete(nodeId);
    this.lowered.add(nodeId);

    const uses = this.consumers.get(nodeId) ?? 1;
    if (uses > 1 && operand.produced && operand.register === GX.Register.PREV) {
      // Consumed more than once, so it cannot live in the previous-stage register.
      const moved = this.spill(operand, nodeId);
      this.memo.set(nodeId, moved);
      this.remainingUses.set(nodeId, uses - 1);
      return moved;
    }
    if (uses > 1) {
      this.memo.set(nodeId, operand);
      this.remainingUses.set(nodeId, uses - 1);
    }
    return operand;
  }

  private consumeMemo(nodeId: string): void {
    const left = (this.remainingUses.get(nodeId) ?? 1) - 1;
    this.remainingUses.set(nodeId, left);
    if (left > 0) return;
    const operand = this.memo.get(nodeId);
    if (operand?.register !== null && operand?.register !== undefined && operand.register !== GX.Register.PREV) {
      if (this.registerOwner.get(operand.register) === nodeId) this.registerOwner.delete(operand.register);
    }
  }

  private lowerNodeUncached(node: GraphNode, socket: string): Operand {
    switch (node.type) {
      case 'value':
        return this.literal(node.value);
      case 'texture':
        return this.textureOperand(node.sampler, node.texCoord, socket === 'alpha' || this.domain === 'alpha', node.id);
      case 'vertexColor':
        return this.channelOperand(node.channel, node.id);
      case 'constant':
        return this.konstOperand(node, socket);
      case 'register':
        return this.registerOperand(node.slot, node.id);
      case 'indirectWarp':
        // Meaningful only as a texture node's `uv` input; on its own it carries no colour.
        this.warn('An indirect warp only does something when it feeds a texture\'s UV input.', node.id);
        return this.literal(0);
      case 'rawStage':
        return this.rawStageOperand(node.id);
      case 'multiply':
      case 'add':
      case 'subtract':
      case 'lerp':
      case 'compare':
      case 'scale':
        return this.mathOperand(node);
      case 'output':
      case 'comment':
      default:
        return this.literal(0);
    }
  }

  // ---------------------------------------------------------------------------------- operands

  private literal(value: number): Operand {
    if (this.domain === 'rgb') {
      const input = value === 1 ? GX.CC.ONE : value === 0.5 ? GX.CC.HALF : GX.CC.ZERO;
      return { input, bindings: {}, register: null };
    }
    // The alpha input set has no ONE or HALF, so those come from a konst selection.
    if (value === 1) return { input: GX.CA.KONST, bindings: { konstSel: GX.KonstAlphaSel.KASEL_1 }, register: null };
    if (value === 0.5) return { input: GX.CA.KONST, bindings: { konstSel: GX.KonstAlphaSel.KASEL_4_8 }, register: null };
    return { input: GX.CA.ZERO, bindings: {}, register: null };
  }

  private textureOperand(sampler: number, texCoord: number, alpha: boolean, nodeId: string): Operand {
    if (sampler < 0 || sampler >= this.material.samplers.length) {
      this.error(`This texture reads slot ${sampler + 1}, but the material only has ${this.material.samplers.length}.`, nodeId);
      return this.literal(0);
    }
    if (texCoord < 0 || texCoord >= this.material.texGens.length) {
      this.error(`This texture uses coordinate ${texCoord + 1}, but the material only generates ${this.material.texGens.length}.`, nodeId);
      return this.literal(0);
    }
    this.usage.samplers.push(sampler);
    this.usage.texCoords.push(texCoord);
    const bindings: Bindings = { texture: { texMap: sampler, texCoord } };
    const warp = this.indirectBindingFor(nodeId);
    if (warp) bindings.indirect = warp;
    return { input: alpha ? GX.CA.TEXA : GX.CC.TEXC, bindings, register: null };
  }

  /** An `indirectWarp` wired into a texture's UV input becomes that stage's indirect setup. */
  private indirectBindingFor(textureNodeId: string): IndirectBinding | undefined {
    const edge = this.incoming(textureNodeId, 'uv');
    if (!edge) return undefined;
    const warp = this.nodes.get(edge.from.node);
    if (!warp || warp.type !== 'indirectWarp') {
      this.error('Only an indirect warp can drive a texture\'s UV input.', textureNodeId, edge.id);
      return undefined;
    }
    this.lowered.add(warp.id);
    if (warp.indStage < 0 || warp.indStage >= this.material.indTexStages.length) {
      this.error(`This warp reads indirect stage ${warp.indStage + 1}, but the material only has ${this.material.indTexStages.length}.`, warp.id);
      return undefined;
    }
    this.usage.indTexStages.push(warp.indStage);
    return {
      indTexStage: warp.indStage,
      indTexFormat: warp.format,
      indTexBiasSel: warp.bias,
      indTexMatrix: warp.matrix,
      indTexWrapS: warp.wrapS,
      indTexWrapT: warp.wrapT,
      indTexAddPrev: warp.addPrevious,
    };
  }

  private channelOperand(channel: number, nodeId: string): Operand {
    if (channel < 0 || channel >= Math.max(1, this.material.channels.length)) {
      this.error(`This vertex colour reads channel ${channel + 1}, but the material only has ${this.material.channels.length}.`, nodeId);
      return this.literal(0);
    }
    this.usage.channels.push(channel);
    return {
      input: this.domain === 'rgb' ? GX.CC.RASC : GX.CA.RASA,
      bindings: { channel: channel === 1 ? GX.RasColorChannelID.COLOR1A1 : GX.RasColorChannelID.COLOR0A0 },
      register: null,
    };
  }

  private konstOperand(node: Extract<GraphNode, { type: 'constant' }>, socket: string): Operand {
    const slot = Math.max(0, Math.min(3, node.slot));
    const alpha = socket === 'alpha' || this.domain === 'alpha';
    const sel = alpha ? node.alphaSel ?? KONST_ALPHA_FOR_SLOT[slot] : node.colorSel ?? KONST_COLOR_FOR_SLOT[slot];
    // The eight hardware fractions are not one of the material's four konst colours.
    if (sel >= 0x0c) this.usage.konstColors.push(slot);
    return { input: alpha ? GX.CA.KONST : GX.CC.KONST, bindings: { konstSel: sel }, register: null };
  }

  private registerOperand(slot: number, nodeId: string): Operand {
    const clamped = Math.max(0, Math.min(2, slot));
    const register = (GX.Register.REG0 + clamped) as GX.Register;
    if (this.registerOwner.has(register)) {
      this.warn(`Register ${clamped + 1} is read here after an earlier stage overwrote it, so its starting colour is gone.`, nodeId);
    }
    this.usage.registers.push(clamped);
    return {
      input: this.domain === 'rgb' ? COLOR_REGISTER_INPUT[register] : ALPHA_REGISTER_INPUT[register],
      bindings: {},
      register,
    };
  }

  private rawStageOperand(nodeId: string): Operand {
    const node = this.nodes.get(nodeId) as Extract<GraphNode, { type: 'rawStage' }>;
    const stage = node.stage;

    // Order first: whatever runs before this stage in this pipeline has to be emitted before it.
    // That holds for both pipelines, so it happens even when the other one already placed the
    // stage: the alpha half of whatever precedes it still has to be lowered.
    const orderSocket = this.domain === 'rgb' ? 'prev' : 'prevAlpha';
    const before = this.incoming(nodeId, orderSocket);
    if (before) this.lowerEdgeValue(before, nodeId, orderSocket);

    const emitted = this.rawSlots.get(nodeId);
    if (emitted) return this.rawStageResult(stage);

    const half = (domain: Domain): HalfOp => ({
      inputs: domain === 'rgb'
        ? [stage.colorInA, stage.colorInB, stage.colorInC, stage.colorInD]
        : [stage.alphaInA, stage.alphaInB, stage.alphaInC, stage.alphaInD],
      op: domain === 'rgb' ? stage.colorOp : stage.alphaOp,
      bias: domain === 'rgb' ? stage.colorBias : stage.alphaBias,
      scale: domain === 'rgb' ? stage.colorScale : stage.alphaScale,
      clamp: domain === 'rgb' ? stage.colorClamp : stage.alphaClamp,
      regId: domain === 'rgb' ? stage.colorRegId : stage.alphaRegId,
      bindings: {},
      template: stage,
      group: groupOf(node),
    });
    if (stage.texMap !== GX.TexMapID.TEXMAP_NULL) {
      if (stage.texMap >= this.material.samplers.length) {
        // A pinned stage is copied out as it stands, so a slot the material has no layer for is
        // something to point at rather than something to refuse: retail tracks ship materials
        // like this and rewriting one unchanged has to keep working.
        this.warn(`This stage samples texture slot ${stage.texMap + 1}, but the material only has ${this.material.samplers.length}.`, nodeId);
      } else {
        this.usage.samplers.push(stage.texMap);
        this.usage.texCoords.push(stage.texCoordId);
      }
    }
    const slot: Slot = { color: half('rgb'), alpha: half('alpha'), group: groupOf(node) };
    this.slots.push(slot);
    this.rawSlots.set(nodeId, slot);
    this.prevOperands = this.prevOperands.filter((operand) => operand.register !== GX.Register.PREV);
    return this.rawStageResult(stage);
  }

  private rawStageResult(stage: GxTevStageDoc): Operand {
    const register = this.domain === 'rgb' ? stage.colorRegId : stage.alphaRegId;
    const operand: Operand = {
      input: this.domain === 'rgb' ? COLOR_REGISTER_INPUT[register] : ALPHA_REGISTER_INPUT[register],
      bindings: {},
      register,
      produced: true,
    };
    if (register === GX.Register.PREV) this.prevOperands.push(operand);
    return operand;
  }

  // ------------------------------------------------------------------------------- math nodes

  private mathOperand(node: GraphNode): Operand {
    if (node.type === 'scale') return this.scaleOperand(node);

    const inputNames = GRAPH_NODE_SOCKETS[node.type].inputs.map((input) => input.name);
    const fused = node.type === 'add' || node.type === 'subtract' ? this.fusibleSecondOperand(node.id) : null;
    const refs = fused ? ['a'] : inputNames;

    const operands: Operand[] = [];
    for (const name of refs) {
      // A sibling that emits stages would clobber the previous-stage register, so move anything
      // living there into a real register before walking it.
      if (this.subtreeEmitsStages(node.id, name)) this.spillLivePrev();
      operands.push(this.lowerInput(node.id, name));
    }
    if (fused) {
      for (const name of fused.inputs) {
        if (this.subtreeEmitsStages(fused.node.id, name)) this.spillLivePrev();
        operands.push(this.lowerInput(fused.node.id, name));
      }
      this.lowered.add(fused.node.id);
    }

    let inputs: [number, number, number, number];
    let op: GX.TevOp = GX.TevOp.ADD;
    const zero = this.literal(0);
    if (fused) {
      const [d, ...rest] = operands;
      const [a, b, c] = fused.kind === 'lerp' ? rest : [zero, rest[0], rest[1]];
      inputs = [a.input, b.input, c.input, d.input];
      op = node.type === 'subtract' ? GX.TevOp.SUB : GX.TevOp.ADD;
      return this.emitMath(node, inputs, op, [a, b, c, d]);
    }

    switch (node.type) {
      case 'multiply': {
        const [a, b] = operands;
        inputs = [zero.input, a.input, b.input, zero.input];
        return this.emitMath(node, inputs, GX.TevOp.ADD, [zero, a, b, zero]);
      }
      case 'add':
      case 'subtract': {
        const [a, b] = operands;
        // out = d ± ((1 - c) * a + c * b) with c = 0 is just d ± a: no konst needed.
        inputs = [b.input, zero.input, zero.input, a.input];
        return this.emitMath(node, inputs, node.type === 'subtract' ? GX.TevOp.SUB : GX.TevOp.ADD, [b, zero, zero, a]);
      }
      case 'lerp': {
        const [a, b, t] = operands;
        inputs = [a.input, b.input, t.input, zero.input];
        return this.emitMath(node, inputs, GX.TevOp.ADD, [a, b, t, zero]);
      }
      case 'compare': {
        const [a, b, c, d] = operands;
        if (node.op < GX.TevOp.COMP_R8_GT) {
          this.error('A compare node needs one of the TEV comparison operations.', node.id);
          return this.literal(0);
        }
        inputs = [a.input, b.input, c.input, d.input];
        return this.emitMath(node, inputs, node.op, [a, b, c, d]);
      }
      default:
        return this.literal(0);
    }
  }

  /**
   * `d + lerp(a, b, c)` is one TEV stage, so an `add` or `subtract` whose second operand is a
   * `lerp` or `multiply` used nowhere else collapses into it.
   */
  private fusibleSecondOperand(nodeId: string): { node: GraphNode; kind: 'lerp' | 'multiply'; inputs: string[] } | null {
    const edge = this.incoming(nodeId, 'b');
    if (!edge) return null;
    const source = this.nodes.get(edge.from.node);
    if (!source) return null;
    if ((this.consumers.get(source.id) ?? 1) > 1) return null;
    if (source.type === 'lerp') return { node: source, kind: 'lerp', inputs: ['a', 'b', 't'] };
    if (source.type === 'multiply') return { node: source, kind: 'multiply', inputs: ['a', 'b'] };
    return null;
  }

  private scaleOperand(node: Extract<GraphNode, { type: 'scale' }>): Operand {
    const bias = node.bias === 0.5 ? GX.TevBias.ADDHALF : node.bias === -0.5 ? GX.TevBias.SUBHALF : GX.TevBias.ZERO;
    const scale = node.scale === 2 ? GX.TevScale.SCALE_2 : node.scale === 4 ? GX.TevScale.SCALE_4 : node.scale === 0.5 ? GX.TevScale.DIVIDE_2 : GX.TevScale.SCALE_1;

    const edge = this.incoming(node.id, 'x');
    const producer = edge ? this.nodes.get(edge.from.node) : null;
    const canFuse = producer !== null && producer !== undefined && MATH_TYPES.has(producer.type) && producer.type !== 'rawStage'
      && (this.consumers.get(producer.id) ?? 1) === 1;

    const operand = this.lowerInput(node.id, 'x');
    const half = this.lastHalf();
    if (canFuse && half && half.bias === GX.TevBias.ZERO && half.scale === GX.TevScale.SCALE_1 && half.op < GX.TevOp.COMP_R8_GT) {
      half.bias = bias;
      half.scale = scale;
      half.clamp = node.clamp;
      if (node.stageTemplate) half.template = node.stageTemplate;
      if (groupOf(node) !== undefined) half.group = groupOf(node);
      return operand;
    }
    // Nothing to fuse into (or it already has a bias): a pass-through stage carries the scale.
    const zero = this.literal(0);
    const result = this.emitMath(node, [zero.input, zero.input, zero.input, operand.input], GX.TevOp.ADD, [zero, zero, zero, operand]);
    const emitted = this.lastHalf();
    if (emitted) {
      emitted.bias = bias;
      emitted.scale = scale;
      emitted.clamp = node.clamp;
    }
    return result;
  }

  private lastHalf(): HalfOp | undefined {
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const half = this.domain === 'rgb' ? this.slots[i].color : this.slots[i].alpha;
      if (half) return half;
    }
    return undefined;
  }

  private emitMath(node: GraphNode, inputs: [number, number, number, number], op: GX.TevOp, operands: Operand[]): Operand {
    const bindings = this.mergeOperandBindings(operands, node.id);
    const template = node.stageTemplate;
    const half: HalfOp = {
      inputs,
      op,
      bias: GX.TevBias.ZERO,
      scale: GX.TevScale.SCALE_1,
      clamp: template ? (this.domain === 'rgb' ? template.colorClamp : template.alphaClamp) : true,
      regId: template ? (this.domain === 'rgb' ? template.colorRegId : template.alphaRegId) : GX.Register.PREV,
      bindings,
      template,
      group: groupOf(node),
    };
    if (op >= GX.TevOp.COMP_R8_GT) {
      half.bias = GX.TevBias.$HWB_COMPARE;
      half.scale = ((op - GX.TevOp.COMP_R8_GT) >>> 1) as GX.TevScale;
    }
    this.place(half);

    this.prevOperands = this.prevOperands.filter((operand) => operand.register !== GX.Register.PREV);
    const result: Operand = {
      input: this.domain === 'rgb' ? COLOR_REGISTER_INPUT[half.regId] : ALPHA_REGISTER_INPUT[half.regId],
      bindings: {},
      register: half.regId,
      produced: true,
    };
    if (half.regId === GX.Register.PREV) this.prevOperands.push(result);
    return result;
  }

  /**
   * Puts a half-op on a stage: onto the slot with the same group when the decompiler paired them,
   * onto the first slot whose other half is free and compatible, or onto a new stage.
   */
  private place(half: HalfOp): void {
    const key = this.domain === 'rgb' ? 'color' : 'alpha';
    const other = this.domain === 'rgb' ? 'alpha' : 'color';
    if (half.group !== undefined) {
      const index = this.slots.findIndex((candidate) => candidate.group === half.group && candidate[key] === undefined);
      if (index >= 0 && bindingsCompatible(half.bindings, this.slots[index][other]?.bindings)) {
        this.slots[index][key] = half;
        this.cursor = index + 1;
        return;
      }
    }
    // Otherwise ride along on the first stage from here on whose other half is free and whose
    // bindings agree. Searching forward only is what keeps this pipeline's ops in order.
    for (let index = this.cursor; index < this.slots.length; index++) {
      const slot = this.slots[index];
      if (slot[key] !== undefined) continue;
      if (slot.group !== undefined && half.group !== undefined) continue;
      if (!bindingsCompatible(half.bindings, slot[other]?.bindings)) continue;
      slot[key] = half;
      this.cursor = index + 1;
      return;
    }
    this.slots.push({ [key]: half, group: half.group } as Slot);
    this.cursor = this.slots.length;
  }

  /** Does walking this input emit stages, i.e. would it overwrite the previous-stage register? */
  private subtreeEmitsStages(nodeId: string, socket: string): boolean {
    const edge = this.incoming(nodeId, socket);
    if (!edge) return false;
    const seen = new Set<string>();
    const stack = [edge.from.node];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = this.nodes.get(id);
      if (node && MATH_TYPES.has(node.type) && !this.memo.has(id) && !this.rawSlots.has(id)) return true;
      for (const inbound of this.graph.edges) if (inbound.to.node === id) stack.push(inbound.from.node);
    }
    return false;
  }

  private spillLivePrev(): void {
    for (const operand of [...this.prevOperands]) this.spill(operand, undefined, true);
    this.prevOperands = [];
  }

  /** Copies a value out of the previous-stage register into one of C0..C2 with a pass-through. */
  private spill(operand: Operand, ownerId: string | undefined, mutate = false): Operand {
    const register = this.allocateRegister(ownerId);
    if (register === null) {
      this.error(
        'This shader needs more than the three temporary colour registers the hardware has; split the material or reuse a texture.',
        ownerId,
      );
      return operand;
    }
    const zero = this.literal(0);
    const half: HalfOp = {
      inputs: [zero.input, zero.input, zero.input, operand.input],
      op: GX.TevOp.ADD,
      bias: GX.TevBias.ZERO,
      scale: GX.TevScale.SCALE_1,
      clamp: true,
      regId: register,
      bindings: {},
    };
    this.place(half);
    const moved: Operand = {
      input: this.domain === 'rgb' ? COLOR_REGISTER_INPUT[register] : ALPHA_REGISTER_INPUT[register],
      bindings: {},
      register,
      produced: true,
    };
    this.usage.registers.push(register - GX.Register.REG0);
    if (mutate) {
      operand.input = moved.input;
      operand.register = moved.register;
      operand.produced = true;
      return operand;
    }
    return moved;
  }

  private allocateRegister(ownerId: string | undefined): GX.Register | null {
    for (const register of [GX.Register.REG0, GX.Register.REG1, GX.Register.REG2]) {
      if (this.registerOwner.has(register)) continue;
      if (this.reservedRegisters.has(register)) continue;
      this.registerOwner.set(register, ownerId ?? `spill:${register}`);
      return register;
    }
    // Every register is reserved by a `register` node; take one anyway rather than fail outright.
    for (const register of [GX.Register.REG0, GX.Register.REG1, GX.Register.REG2]) {
      if (this.registerOwner.has(register)) continue;
      this.registerOwner.set(register, ownerId ?? `spill:${register}`);
      this.warn('A temporary value had to reuse a register whose starting colour the shader reads.', ownerId);
      return register;
    }
    return null;
  }

  private mergeOperandBindings(operands: readonly Operand[], nodeId: string): Bindings {
    const merged: Bindings = {};
    for (const operand of operands) {
      for (const key of ['texture', 'channel', 'konstSel', 'indirect'] as const) {
        const value = operand.bindings[key];
        if (value === undefined) continue;
        const existing = merged[key];
        if (existing === undefined) {
          (merged as Record<string, unknown>)[key] = value;
        } else if (JSON.stringify(existing) !== JSON.stringify(value)) {
          this.error(
            key === 'texture'
              ? 'One TEV stage can only sample one texture; copy one of them into a register in an earlier stage.'
              : key === 'channel'
                ? 'One TEV stage can only read one vertex-colour channel.'
                : key === 'konstSel'
                  ? 'One TEV stage can only use one constant colour.'
                  : 'One TEV stage can only use one indirect warp.',
            nodeId,
          );
        }
      }
    }
    return merged;
  }

  /**
   * When every stage carries a group — which is what the decompiler produces — the groups are the
   * original stage order, so restoring it puts a stage whose colour or alpha half is unreachable
   * from the output back where it belongs.
   */
  private orderSlotsByGroup(): void {
    if (this.slots.length === 0) return;
    const groups = this.slots.map((slot) => slot.group);
    if (groups.some((group) => group === undefined)) return;
    if (new Set(groups).size !== groups.length) return;
    const sorted = [...this.slots].sort((a, b) => a.group! - b.group!);
    this.slots.length = 0;
    this.slots.push(...sorted);
  }
}

/**
 * Which original TEV stage a node belongs to, by the id convention the decompiler uses (`s3c`,
 * `s3a`, `s3r`). It is how the colour and alpha halves of one stage find each other again after
 * being compiled through two separate trees. Nodes the editor creates have their own ids and no
 * group, which is right: there is no original stage to line up with.
 */
function groupOf(node: GraphNode): number | undefined {
  const match = /^s(\d+)[a-z]+$/.exec(node.id);
  return match ? Number(match[1]) : undefined;
}

function bindingsCompatible(a: Bindings, b: Bindings | undefined): boolean {
  if (!b) return true;
  for (const key of ['texture', 'channel', 'indirect'] as const) {
    const left = a[key];
    const right = b[key];
    if (left === undefined || right === undefined) continue;
    if (JSON.stringify(left) !== JSON.stringify(right)) return false;
  }
  return true;
}

function assembleStage(slot: Slot): GxTevStageDoc {
  const base = slot.color?.template ?? slot.alpha?.template ?? createPassThroughStage();
  const stage: GxTevStageDoc = { ...base };

  if (slot.color) {
    const half = slot.color;
    stage.colorInA = half.inputs[0];
    stage.colorInB = half.inputs[1];
    stage.colorInC = half.inputs[2];
    stage.colorInD = half.inputs[3];
    stage.colorOp = half.op;
    stage.colorBias = half.bias;
    stage.colorScale = half.scale;
    stage.colorClamp = half.clamp;
    stage.colorRegId = half.regId;
  } else {
    stage.colorInA = GX.CC.ZERO;
    stage.colorInB = GX.CC.ZERO;
    stage.colorInC = GX.CC.ZERO;
    stage.colorInD = GX.CC.CPREV;
    stage.colorOp = GX.TevOp.ADD;
    stage.colorBias = GX.TevBias.ZERO;
    stage.colorScale = GX.TevScale.SCALE_1;
    stage.colorClamp = true;
    stage.colorRegId = GX.Register.PREV;
  }

  if (slot.alpha) {
    const half = slot.alpha;
    stage.alphaInA = half.inputs[0];
    stage.alphaInB = half.inputs[1];
    stage.alphaInC = half.inputs[2];
    stage.alphaInD = half.inputs[3];
    stage.alphaOp = half.op;
    stage.alphaBias = half.bias;
    stage.alphaScale = half.scale;
    stage.alphaClamp = half.clamp;
    stage.alphaRegId = half.regId;
  } else {
    stage.alphaInA = GX.CA.ZERO;
    stage.alphaInB = GX.CA.ZERO;
    stage.alphaInC = GX.CA.ZERO;
    stage.alphaInD = GX.CA.APREV;
    stage.alphaOp = GX.TevOp.ADD;
    stage.alphaBias = GX.TevBias.ZERO;
    stage.alphaScale = GX.TevScale.SCALE_1;
    stage.alphaClamp = true;
    stage.alphaRegId = GX.Register.PREV;
  }

  const texture = slot.color?.bindings.texture ?? slot.alpha?.bindings.texture;
  if (texture) {
    stage.texMap = texture.texMap;
    stage.texCoordId = texture.texCoord;
  }
  const channel = slot.color?.bindings.channel ?? slot.alpha?.bindings.channel;
  if (channel !== undefined) stage.channelId = channel;
  if (slot.color?.bindings.konstSel !== undefined) stage.konstColorSel = slot.color.bindings.konstSel;
  if (slot.alpha?.bindings.konstSel !== undefined) stage.konstAlphaSel = slot.alpha.bindings.konstSel;

  const indirect = slot.color?.bindings.indirect ?? slot.alpha?.bindings.indirect;
  if (indirect) Object.assign(stage, indirect);
  return stage;
}
