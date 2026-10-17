// An Unreal-style layered layout for shader graphs.
//
// Data flows left to right into the Material node, which sits alone in the rightmost column. The
// colour pipeline takes the upper band and the alpha pipeline the lower one, so the two chains read
// as two rows instead of one braid; a source both of them read (a texture's colour and alpha) sits
// at the bottom of the colour band, next to the alpha band it also feeds. Within a band:
//
//  1. Columns are "as late as possible": a node sits one column left of its nearest consumer, so a
//     texture feeding the last step is beside that step rather than back at the far left. A node
//     nothing reads (a step whose result the hardware computes and throws away) stays as far left
//     as its own inputs put it.
//  2. Each column is ordered to minimise crossings — barycentre sweeps, keeping the best order
//     seen — starting from a depth-first walk from the output, so an `a` input sits above a `b`.
//  3. Heights come from a relaxation that pulls every socket level with the sockets it is wired
//     to, under the constraint that cards in a column keep their order and never overlap. Each
//     column's fit is an isotonic regression, so it is exact rather than iterative.
//
// Pure and deterministic: the same graph and the same sizes give the same positions. Comment nodes
// are annotations on a layout, not part of it, and keep theirs.
//
// Only imports the contract, so the editor can use it without pulling in the compiler.

import { GRAPH_NODE_SOCKETS } from './types';
import type { GraphEdge, GraphNode, ShaderGraph } from './types';

/** Default card width: a compact Unreal-sized node. */
export const GRAPH_LAYOUT_NODE_WIDTH = 160;
/** Default title-bar height. */
export const GRAPH_LAYOUT_HEADER_HEIGHT = 24;
/** Default height of one pin row; an input and an output share a row, as in Unreal. */
export const GRAPH_LAYOUT_PIN_ROW_HEIGHT = 22;
/** Horizontal space between one column's widest card and the next column. */
export const GRAPH_LAYOUT_COLUMN_GAP = 80;
/** Vertical space between two cards in one column. */
export const GRAPH_LAYOUT_ROW_GAP = 24;
/** Vertical space between the colour band and the alpha band. */
export const GRAPH_LAYOUT_BAND_GAP = 72;

export interface GraphNodeSize {
  width: number;
  height: number;
  /**
   * Optional: the y of each socket's centre, relative to the card's top, by socket name. Without
   * it a socket sits in the middle of its pin row (`header + row * pinRow + pinRow / 2`).
   */
  inputs?: Partial<Record<string, number>>;
  outputs?: Partial<Record<string, number>>;
}

export type MeasureGraphNode = (node: GraphNode) => GraphNodeSize;

/** Extra height a default card gives its own controls, beyond the pin rows. */
function defaultBodyHeight(node: GraphNode): number {
  switch (node.type) {
    case 'texture': return 64; // thumbnail
    case 'constant':
    case 'register': return GRAPH_LAYOUT_PIN_ROW_HEIGHT; // swatch
    case 'rawStage': return 88; // the sentence saying why it is read-only
    default: return 0;
  }
}

/** The size the layout assumes when the editor does not measure its cards. */
export function defaultGraphNodeSize(node: GraphNode): GraphNodeSize {
  if (node.type === 'comment') return { width: node.width, height: node.height };
  const spec = GRAPH_NODE_SOCKETS[node.type];
  const rows = Math.max(spec?.inputs.length ?? 0, spec?.outputs.length ?? 0);
  return {
    width: GRAPH_LAYOUT_NODE_WIDTH,
    height: GRAPH_LAYOUT_HEADER_HEIGHT + rows * GRAPH_LAYOUT_PIN_ROW_HEIGHT + defaultBodyHeight(node) + (node.label ? 18 : 0) + 6,
  };
}

/** Colour band, shared sources at the bottom of it, alpha band. */
type Band = 0 | 1 | 2;
const COLOR: Band = 0;
const SHARED: Band = 1;
const ALPHA: Band = 2;

interface Item {
  node: GraphNode;
  index: number;
  size: GraphNodeSize;
  inputs: GraphEdge[];
  outputs: GraphEdge[];
  column: number;
  band: Band;
  y: number;
  /** A point a long wire passes through in a column between its ends; not a card. */
  dummy?: boolean;
  /** The wires as the order and height passes see them: long ones split at their dummies. */
  segIn: Segment[];
  segOut: Segment[];
}

interface Segment {
  from: Item;
  fromSocket: string;
  to: Item;
  toSocket: string;
}

/** How tall the gap a long wire keeps open through a column is. */
const DUMMY_HEIGHT = 6;

/**
 * Lays the graph out left to right. `measure` lets the editor pass real card sizes (and socket
 * offsets); without it, `defaultGraphNodeSize`. Returns a new graph; only `x` / `y` change.
 */
export function layoutShaderGraph(graph: ShaderGraph, measure: MeasureGraphNode = defaultGraphNodeSize): ShaderGraph {
  const items = new Map<string, Item>();
  graph.nodes.forEach((node, index) => {
    if (node.type === 'comment') return;
    items.set(node.id, { node, index, size: measure(node), inputs: [], outputs: [], column: 0, band: COLOR, y: 0, segIn: [], segOut: [] });
  });
  if (items.size === 0) return graph;
  for (const edge of graph.edges) {
    const from = items.get(edge.from.node);
    const to = items.get(edge.to.node);
    if (!from || !to || from === to) continue;
    from.outputs.push(edge);
    to.inputs.push(edge);
  }
  const list = [...items.values()];
  const output = list.find((item) => item.node.type === 'output');

  assignColumns(list, items, output);
  assignBands(list, items, output);
  alignAlphaWithSharedSources(list, items);
  const all = [...list, ...splitLongWires(list, items, graph.nodes.length)];
  const columns = orderColumns(all, output);
  placeVertically(columns);

  // Column x: every column as wide as its widest card.
  const xs: number[] = [];
  let x = 0;
  for (const column of columns) {
    xs.push(x);
    x += Math.max(0, ...column.map((item) => item.size.width)) + GRAPH_LAYOUT_COLUMN_GAP;
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const item = items.get(node.id);
      return item ? { ...node, x: xs[item.column], y: Math.round(item.y) } : node;
    }),
  };
}

// ------------------------------------------------------------------------------ columns

function assignColumns(list: Item[], items: Map<string, Item>, output: Item | undefined): void {
  // As soon as possible first: one column right of the deepest input.
  const asap = new Map<Item, number>();
  const visiting = new Set<Item>();
  const early = (item: Item): number => {
    const known = asap.get(item);
    if (known !== undefined) return known;
    if (visiting.has(item)) return 0; // a cycle; the compiler reports it, the layout just stops
    visiting.add(item);
    let column = 0;
    for (const edge of item.inputs) column = Math.max(column, early(items.get(edge.from.node)!) + 1);
    visiting.delete(item);
    asap.set(item, column);
    return column;
  };
  for (const item of list) early(item);

  // The Material node is always the rightmost column on its own.
  if (output) {
    const others = list.filter((item) => item !== output).map((item) => asap.get(item)!);
    asap.set(output, Math.max(asap.get(output)!, ...others.map((column) => column + 1)));
  }

  // Then as late as possible: one column left of the nearest consumer. Consumers sit in later
  // ASAP columns, so walking those in descending order sees every consumer first. What feeds the
  // output goes first, counting only consumers that feed it too, so a step whose result nothing
  // reads cannot drag a texture the real chain also samples off to the far left.
  const order = [...list].sort((a, b) => asap.get(b)! - asap.get(a)! || a.index - b.index);
  const live = feedsOutput(items, output);
  const assigned = new Set<Item>();
  const consumersOf = (item: Item) => item.outputs.map((edge) => items.get(edge.to.node)!).filter((consumer) => consumer !== item);
  for (const item of order) {
    if (!live.has(item)) continue;
    const consumers = consumersOf(item).filter((consumer) => live.has(consumer));
    item.column = item === output || consumers.length === 0
      ? asap.get(item)!
      : Math.min(...consumers.map((consumer) => consumer.column)) - 1;
    assigned.add(item);
  }
  // The rest: a dead end sits beside the steps its own inputs also feed (an unread alpha step next
  // to the colour step of the same stage), and what feeds only it sits just left of it.
  for (const item of order) {
    if (live.has(item)) continue;
    const consumers = consumersOf(item).filter((consumer) => assigned.has(consumer));
    if (consumers.length > 0) {
      item.column = Math.min(...consumers.map((consumer) => consumer.column)) - 1;
    } else {
      const producers = item.inputs.map((edge) => items.get(edge.from.node)!).filter((producer) => producer !== item);
      const floor = Math.max(-Infinity, ...producers.filter((producer) => assigned.has(producer)).map((producer) => producer.column + 1));
      const siblings = producers.flatMap((producer) => consumersOf(producer)).filter((sibling) => sibling !== item && assigned.has(sibling));
      const beside = siblings.length > 0 ? Math.min(...siblings.map((sibling) => sibling.column)) : asap.get(item)!;
      item.column = Math.max(beside, floor);
    }
    assigned.add(item);
  }
  if (output) output.column = Math.max(output.column, ...list.filter((item) => item !== output).map((item) => item.column + 1));
  const least = Math.min(...list.map((item) => item.column));
  for (const item of list) item.column -= least;
}

/**
 * The alpha chain is usually shorter than the colour chain, so "as late as possible" puts its steps
 * well right of the colour steps of the same stage. Where an alpha step reads a source the colour
 * band also reads (the stage's texture), that leaves a long diagonal wire across both bands. Moving
 * the step left to just after its inputs trades it for a horizontal wire inside the alpha band,
 * which reads the way an Unreal graph does. Whatever feeds only the moved step follows it.
 */
function alignAlphaWithSharedSources(list: Item[], items: Map<string, Item>): void {
  const ascending = [...list].sort((a, b) => a.column - b.column || a.index - b.index);
  const aligned = new Set<Item>();
  for (const item of ascending) {
    if (item.band !== ALPHA) continue;
    const producers = item.inputs.map((edge) => items.get(edge.from.node)!).filter((producer) => producer !== item);
    if (!producers.some((producer) => producer.band === SHARED)) continue;
    // The cross-band inputs pin it, and so do alpha steps already aligned; an alpha-only source
    // follows it left.
    const anchors = producers.filter((producer) => producer.band !== ALPHA || aligned.has(producer));
    item.column = Math.min(item.column, Math.max(...anchors.map((producer) => producer.column)) + 1);
    aligned.add(item);
  }
  // Nothing may end up level with or right of a step it feeds. Repeated until it holds, since
  // pulling one card left can leave the card feeding it out of place again (bounded for cycles).
  for (let pass = 0, moved = true; moved && pass < list.length; pass++) {
    moved = false;
    for (const item of list) {
      const consumers = item.outputs.map((edge) => items.get(edge.to.node)!).filter((consumer) => consumer !== item);
      if (consumers.length === 0) continue;
      const limit = Math.min(...consumers.map((consumer) => consumer.column)) - 1;
      if (item.column <= limit) continue;
      item.column = limit;
      moved = true;
    }
  }
  const least = Math.min(...list.map((item) => item.column));
  for (const item of list) item.column -= least;
}

/** Every node with a path to the output, the output included. */
function feedsOutput(items: Map<string, Item>, output: Item | undefined): Set<Item> {
  const live = new Set<Item>();
  if (!output) return live;
  const stack = [output];
  live.add(output);
  while (stack.length > 0) {
    for (const edge of stack.pop()!.inputs) {
      const from = items.get(edge.from.node)!;
      if (live.has(from)) continue;
      live.add(from);
      stack.push(from);
    }
  }
  return live;
}

// ------------------------------------------------------------------------------ bands

function socketType(node: GraphNode, socket: string, side: 'inputs' | 'outputs'): 'rgb' | 'alpha' | null {
  // Maths sockets are polymorphic: their spec says `rgb`, but they carry whichever pipeline they
  // are wired into, so only a source's typed output says anything.
  if (node.type === 'rawStage') return side === 'outputs' ? (socket === 'alpha' ? 'alpha' : 'rgb') : (socket === 'prevAlpha' ? 'alpha' : 'rgb');
  const spec = GRAPH_NODE_SOCKETS[node.type];
  if (!spec || spec.inputs.some((input) => input.default !== undefined)) return null;
  return spec[side].find((entry) => entry.name === socket)?.type ?? null;
}

function assignBands(list: Item[], items: Map<string, Item>, output: Item | undefined): void {
  const reached = new Map<Item, Set<'rgb' | 'alpha'>>();
  const mark = (item: Item, pipeline: 'rgb' | 'alpha') => {
    const set = reached.get(item) ?? new Set();
    if (set.has(pipeline)) return false;
    set.add(pipeline);
    reached.set(item, set);
    return true;
  };
  // Walk back from the output: everything behind its `color` input is the colour pipeline, and
  // so on. A raw stage's two ordering inputs say for themselves which pipeline they belong to.
  if (output) {
    const stack: Array<[Item, 'rgb' | 'alpha']> = [];
    for (const edge of output.inputs) {
      const pipeline = edge.to.socket === 'alpha' ? 'alpha' : 'rgb';
      const from = items.get(edge.from.node)!;
      if (mark(from, pipeline)) stack.push([from, pipeline]);
    }
    while (stack.length > 0) {
      const [item, pipeline] = stack.pop()!;
      for (const edge of item.inputs) {
        const next = item.node.type === 'rawStage' ? socketType(item.node, edge.to.socket, 'inputs')! : pipeline;
        const from = items.get(edge.from.node)!;
        if (mark(from, next)) stack.push([from, next]);
      }
    }
  }
  const bandOf = (set: Set<'rgb' | 'alpha'>): Band => (set.size === 2 ? SHARED : set.has('alpha') ? ALPHA : COLOR);
  for (const [item, set] of reached) item.band = bandOf(set);

  // Nodes the output never reaches — a step whose result nothing reads, and its sources — take
  // the pipeline their wires say: a typed source socket, or a neighbour already placed.
  const pending = new Set(list.filter((item) => item !== output && !reached.has(item)));
  for (let changed = true; changed && pending.size > 0;) {
    changed = false;
    for (const item of list) {
      if (!pending.has(item)) continue;
      const votes = new Set<'rgb' | 'alpha'>();
      for (const edge of item.inputs) {
        const from = items.get(edge.from.node)!;
        const typed = socketType(from.node, edge.from.socket, 'outputs');
        if (typed) votes.add(typed);
        else if (!pending.has(from)) votes.add(from.band === ALPHA ? 'alpha' : 'rgb');
      }
      for (const edge of item.outputs) {
        const to = items.get(edge.to.node)!;
        if (!pending.has(to) && to !== output) votes.add(to.band === ALPHA ? 'alpha' : 'rgb');
      }
      if (votes.size === 0) continue;
      item.band = bandOf(votes);
      pending.delete(item);
      changed = true;
    }
  }
  // A step with no wires at all — an unread stage half that reads only literals — has nothing to
  // vote with; the decompiler's id convention (`s3a…` is stage 3's alpha half) still says.
  for (const item of pending) if (/^s\d+a[a-z]*$/.test(item.node.id)) item.band = ALPHA;

  // A source the colour pipeline reaches that also feeds a step in the alpha band is shared,
  // whatever reached it first: it belongs at the seam between the two bands.
  for (const item of list) {
    if (item.inputs.length > 0 || item.band !== COLOR) continue;
    if (item.outputs.some((edge) => items.get(edge.to.node)!.band === ALPHA)) item.band = SHARED;
  }
  if (output) output.band = COLOR;
}

// ------------------------------------------------------------------------------ long wires

/**
 * A wire that skips columns gets a dummy point in every column it passes through, so the order and
 * height passes keep a lane open for it instead of parking a card on top of it. Only wires inside
 * one band region get them: a wire between the colour and alpha bands crosses the seam anyway.
 */
function splitLongWires(list: Item[], items: Map<string, Item>, firstIndex: number): Item[] {
  const dummies: Item[] = [];
  const region = (item: Item) => (item.band === ALPHA ? ALPHA : COLOR);
  for (const from of list) {
    for (const edge of from.outputs) {
      const to = items.get(edge.to.node)!;
      if (to === from) continue;
      let previous: Item = from;
      let socket = edge.from.socket;
      if (to.column - from.column > 1 && region(from) === region(to)) {
        for (let column = from.column + 1; column < to.column; column++) {
          const dummy: Item = {
            node: from.node,
            index: firstIndex + dummies.length,
            size: { width: 0, height: DUMMY_HEIGHT },
            inputs: [],
            outputs: [],
            column,
            band: region(from),
            y: 0,
            dummy: true,
            segIn: [],
            segOut: [],
          };
          dummies.push(dummy);
          link(previous, socket, dummy, '');
          previous = dummy;
          socket = '';
        }
      }
      link(previous, socket, to, edge.to.socket);
    }
  }
  return dummies;
}

function link(from: Item, fromSocket: string, to: Item, toSocket: string): void {
  const segment: Segment = { from, fromSocket, to, toSocket };
  from.segOut.push(segment);
  to.segIn.push(segment);
}

function socketRank(item: Item, socket: string, side: 'inputs' | 'outputs'): { rank: number; count: number } {
  if (item.dummy) return { rank: 0, count: 1 };
  const sockets = GRAPH_NODE_SOCKETS[item.node.type]?.[side] ?? [];
  return { rank: Math.max(0, sockets.findIndex((entry) => entry.name === socket)), count: Math.max(1, sockets.length) };
}

// ------------------------------------------------------------------------------ order

function orderColumns(list: Item[], output: Item | undefined): Item[][] {
  // Depth-first from the output, inputs in socket order: `a` above `b`, colour above alpha.
  const visit = new Map<Item, number>();
  const walk = (item: Item) => {
    if (visit.has(item)) return;
    visit.set(item, visit.size);
    const inputs = [...item.segIn].sort((a, b) => socketRank(item, a.toSocket, 'inputs').rank - socketRank(item, b.toSocket, 'inputs').rank);
    for (const segment of inputs) walk(segment.from);
  };
  if (output) walk(output);
  // Unreached clusters start from their roots — the nodes nothing reads — in graph order.
  for (const item of list) if (item.segOut.length === 0) walk(item);
  for (const item of list) walk(item);

  const count = Math.max(...list.map((item) => item.column)) + 1;
  const columns: Item[][] = Array.from({ length: count }, () => []);
  for (const item of list) columns[item.column].push(item);
  const position = new Map<Item, number>();
  const sortColumn = (column: Item[], key: (item: Item) => number) => {
    column.sort((a, b) => a.band - b.band || key(a) - key(b) || a.index - b.index);
    column.forEach((item, index) => position.set(item, index));
  };
  for (const column of columns) sortColumn(column, (item) => visit.get(item)!);

  // Where along its column a wire end sits, with the socket's rank breaking ties between two wires
  // into one card.
  const portOf = (item: Item, socket: string, side: 'inputs' | 'outputs') => {
    const { rank, count: sockets } = socketRank(item, socket, side);
    return position.get(item)! + (rank + 0.5) / sockets;
  };
  const segments = list.flatMap((item) => item.segOut);
  const crossings = () => {
    let total = 0;
    for (let i = 0; i < segments.length; i++) {
      const a = segments[i];
      for (let j = i + 1; j < segments.length; j++) {
        const b = segments[j];
        if (a.from.column !== b.from.column || a.to.column !== b.to.column) continue;
        const top = portOf(a.from, a.fromSocket, 'outputs') - portOf(b.from, b.fromSocket, 'outputs');
        const bottom = portOf(a.to, a.toSocket, 'inputs') - portOf(b.to, b.toSocket, 'inputs');
        if (top * bottom < 0) total++;
      }
    }
    return total;
  };

  let best = columns.map((column) => [...column]);
  let bestCrossings = crossings();
  for (let sweep = 0; sweep < 8 && bestCrossings > 0; sweep++) {
    const leftward = sweep % 2 === 0;
    const sequence = leftward ? [...columns.keys()].reverse() : [...columns.keys()];
    for (const index of sequence) {
      const column = columns[index];
      const key = new Map<Item, number>();
      for (const item of column) {
        const ends = leftward
          ? item.segOut.map((segment) => portOf(segment.to, segment.toSocket, 'inputs'))
          : item.segIn.map((segment) => portOf(segment.from, segment.fromSocket, 'outputs'));
        key.set(item, ends.length > 0 ? ends.reduce((sum, value) => sum + value, 0) / ends.length : position.get(item)!);
      }
      sortColumn(column, (item) => key.get(item)!);
    }
    const now = crossings();
    if (now < bestCrossings) {
      bestCrossings = now;
      best = columns.map((column) => [...column]);
    }
  }
  return best;
}

// ------------------------------------------------------------------------------ heights

function socketOffset(item: Item, socket: string, side: 'inputs' | 'outputs'): number {
  if (item.dummy) return DUMMY_HEIGHT / 2;
  const measured = item.size[side]?.[socket];
  if (measured !== undefined) return measured;
  const { rank } = socketRank(item, socket, side);
  return GRAPH_LAYOUT_HEADER_HEIGHT + rank * GRAPH_LAYOUT_PIN_ROW_HEIGHT + GRAPH_LAYOUT_PIN_ROW_HEIGHT / 2;
}

/**
 * Vertical positions, one band region at a time (colour + shared, then alpha), so the alpha band
 * starts below the colour band's lowest card. Wires that cross between the regions do not pull.
 */
function placeVertically(columns: Item[][]): void {
  const regions: Array<(item: Item) => boolean> = [(item) => item.band !== ALPHA, (item) => item.band === ALPHA];
  let top = 0;
  for (const inRegion of regions) {
    const stacks = columns.map((column) => column.filter(inRegion)).filter((column) => column.length > 0);
    if (stacks.length === 0) continue;
    for (const stack of stacks) {
      let y = 0;
      for (const item of stack) {
        item.y = y;
        y += item.size.height + GRAPH_LAYOUT_ROW_GAP;
      }
    }
    // Alternate sweeps, ending on a leftward one so the sources settle against the steps they feed.
    for (let sweep = 0; sweep < 12; sweep++) {
      const leftward = sweep % 2 === 1;
      const sequence = leftward ? [...stacks].reverse() : stacks;
      for (const stack of sequence) relaxStack(stack, inRegion);
    }
    const cards = stacks.flat();
    const least = Math.min(...cards.map((item) => item.y));
    const most = Math.max(...cards.map((item) => item.y + item.size.height));
    for (const item of cards) item.y += top - least;
    top += most - least + GRAPH_LAYOUT_BAND_GAP;
  }
}

/**
 * Moves one column's cards as close as they can get to level with what they are wired to, keeping
 * their order and their spacing: a weighted isotonic regression (pool adjacent violators) on the
 * desired positions with each card's cumulative offset taken out.
 */
function relaxStack(stack: Item[], inRegion: (item: Item) => boolean): void {
  const desired: number[] = [];
  const weights: number[] = [];
  for (const item of stack) {
    let sum = 0;
    let weight = 0;
    for (const segment of item.segIn) {
      const from = segment.from;
      if (!inRegion(from) || from.column === item.column) continue;
      sum += from.y + socketOffset(from, segment.fromSocket, 'outputs') - socketOffset(item, segment.toSocket, 'inputs');
      weight++;
    }
    for (const segment of item.segOut) {
      const to = segment.to;
      if (!inRegion(to) || to.column === item.column) continue;
      sum += to.y + socketOffset(to, segment.toSocket, 'inputs') - socketOffset(item, segment.fromSocket, 'outputs');
      weight++;
    }
    desired.push(weight > 0 ? sum / weight : item.y);
    weights.push(Math.max(weight, 0.25));
  }

  const offsets: number[] = [];
  let offset = 0;
  for (const item of stack) {
    offsets.push(offset);
    offset += item.size.height + GRAPH_LAYOUT_ROW_GAP;
  }
  // Pool adjacent violators over z = desired - offset, which has to be non-decreasing.
  const blocks: Array<{ value: number; weight: number; count: number }> = [];
  desired.forEach((value, index) => {
    blocks.push({ value: value - offsets[index], weight: weights[index], count: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].value > blocks[blocks.length - 1].value) {
      const last = blocks.pop()!;
      const prev = blocks[blocks.length - 1];
      const weight = prev.weight + last.weight;
      prev.value = (prev.value * prev.weight + last.value * last.weight) / weight;
      prev.weight = weight;
      prev.count += last.count;
    }
  });
  let index = 0;
  for (const block of blocks) {
    for (let k = 0; k < block.count; k++, index++) stack[index].y = block.value + offsets[index];
  }
}
