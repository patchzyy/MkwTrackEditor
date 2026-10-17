// Pure model behind the shader-graph node editor: geometry, hit testing, socket typing, edge
// rules, selection, clipboard and layout. No React, no DOM — everything here is unit tested in
// `graphModel.test.ts`, and `GraphEditor.tsx` is only the pointer/keyboard shell around it.
// Imported from the contract file rather than from `../../lib/gxMaterial`: going through the
// barrel would pull the whole BRRES parser into the main bundle instead of leaving it behind
// `loadMaterialLibrary`.
import {
  GRAPH_NODE_SOCKETS,
  type GraphEdge,
  type GraphInlineValue,
  type GraphNode,
  type GraphNodeSpec,
  type GraphNodeType,
  type GraphSocketSpec,
  type GraphSocketType,
  type GxMaterialDoc,
  type ShaderGraph,
} from '../../lib/gxMaterial/types';
// Both of these import only the contract too, so they cost the main bundle nothing.
import { layoutShaderGraph, type GraphNodeSize } from '../../lib/gxMaterial/graphLayout';
import { acceptsInlineValue, inlineInputValue, withInlineValue } from '../../lib/gxMaterial/graphLiterals';
import { TEV_OP_OPTIONS, channelName, colorRegisterName, konstColorName, storedSlotName } from './gxOptions';

// ---------------------------------------------------------------------------- node types

// The editor works in the contract's own types. The aliases exist because the editor once had to
// carry a node type the contract did not yet declare, and every call site reads better for saying
// which union it means.
export type EditorGraphNode = GraphNode;
export type EditorGraphNodeType = GraphNodeType;
export type EditorShaderGraph = ShaderGraph;

/** Fallback for a node type from a graph written by a newer build than this one. */
const UNKNOWN_SPEC: GraphNodeSpec = { title: 'Unknown node', inputs: [], outputs: [] };

/** Socket layout for a node type. Never throws on a type this build does not know. */
export function nodeSpec(type: EditorGraphNodeType): GraphNodeSpec {
  return GRAPH_NODE_SOCKETS[type] ?? UNKNOWN_SPEC;
}

export function isCommentNode(node: EditorGraphNode): node is Extract<GraphNode, { type: 'comment' }> {
  return node.type === 'comment';
}

export function isMathNode(node: EditorGraphNode): boolean {
  return node.type === 'multiply' || node.type === 'add' || node.type === 'subtract' || node.type === 'lerp';
}

/**
 * Which colour a node's header strip is drawn in, Unreal-style: what feeds the graph, what does
 * maths on it, the result node, and the read-only step copied out of the file.
 */
export type NodeCategory = 'source' | 'math' | 'output' | 'raw' | 'note';

export const NODE_CATEGORY: Record<EditorGraphNodeType, NodeCategory> = {
  output: 'output',
  texture: 'source',
  vertexColor: 'source',
  constant: 'source',
  register: 'source',
  storedValue: 'source',
  value: 'source',
  alphaAsColor: 'source',
  multiply: 'math',
  add: 'math',
  subtract: 'math',
  lerp: 'math',
  scale: 'math',
  compare: 'math',
  indirectWarp: 'math',
  comment: 'note',
  rawStage: 'raw',
};

/** The add-node menu's headings, in order, and which node types sit under each. */
export const PALETTE_GROUPS: ReadonlyArray<{ title: string; types: readonly EditorGraphNodeType[] }> = [
  { title: 'Inputs', types: ['texture', 'vertexColor', 'constant', 'register', 'value'] },
  { title: 'Maths', types: ['multiply', 'add', 'subtract', 'lerp', 'scale'] },
  { title: 'Advanced', types: ['alphaAsColor', 'storedValue', 'compare', 'indirectWarp'] },
  { title: 'Notes', types: ['comment'] },
];

/**
 * Node types the "Add node" menu offers, in menu order. `output` is never addable (there is only
 * ever one) and neither is `rawStage`, which only the decompiler can fill in.
 */
export const ADDABLE_NODE_TYPES: GraphNodeType[] = PALETTE_GROUPS.flatMap((group) => group.types);

/** One-line explanation of what a node does, used by the palette and the node tooltip. */
export const NODE_SUMMARY: Record<EditorGraphNodeType, string> = {
  output: 'What the material draws. Whatever is wired into it is the final colour and alpha.',
  texture: 'Reads one of the material\'s textures.',
  vertexColor: 'The colour the mesh brings with it — the vertex colours, or the scene lighting when the material is lit.',
  constant: 'One of the material\'s four colours. The swatch on the card edits it, live.',
  register: 'The colour a scratch slot starts at, before any step writes to it.',
  storedValue: 'Reads a slot back: whatever the steps before this one left in it.',
  value: 'A plain number — 0, a half or 1 — for feeding several inputs at once. A single input can hold one inline instead.',
  alphaAsColor: 'Uses an alpha where a colour is wanted, so one image\'s transparency can tint or blend another.',
  multiply: 'Multiplies two things together. Tinting and masking are both this.',
  add: 'Adds two things together. Brightens, and stacks glows.',
  subtract: 'Takes one thing away from another.',
  lerp: 'Fades between two things by a third. One whole hardware step, exactly.',
  scale: 'Brightens or darkens by a fixed amount, with an optional shift and clamp. Free.',
  compare: 'Picks one of two things depending on how two others compare.',
  indirectWarp: 'Uses one texture to push another texture\'s coordinates about — water, heat haze.',
  comment: 'A note to yourself. Never becomes anything in the material.',
  rawStage: 'A step this editor cannot draw as nodes, copied out of the file exactly as it was.',
};

/**
 * Node titles the way an author reads them, rather than the way the compiler names its types.
 *
 * The contract's `GRAPH_NODE_SOCKETS[type].title` is the generic name ("Texture", "Color"); this
 * folds in *which* one, so a card says "Texture 1" and "Colour 3" instead of leaving the user to
 * read the slot out of a dropdown. `nodeCaption` supplies the part after the dot — the texture's
 * actual name, the channel — which the card draws dimmed next to the title.
 */
export function nodeTypeTitle(type: EditorGraphNodeType): string {
  switch (type) {
    case 'vertexColor': return 'Vertex colour';
    case 'constant': return 'Colour';
    case 'register': return 'Start colour';
    case 'rawStage': return 'Special step';
    case 'indirectWarp': return 'Warp coordinates';
    case 'storedValue': return 'Stored value';
    case 'alphaAsColor': return 'Alpha as colour';
    default: return nodeSpec(type).title;
  }
}

export function nodeTitle(node: EditorGraphNode): string {
  switch (node.type) {
    case 'texture': return `Texture ${node.sampler + 1}`;
    // "Vertex colour 1", "Bump alpha", "Nothing (black)": the source says what the node is.
    case 'vertexColor': return channelName(node.channel);
    case 'constant': return konstColorName(node.slot);
    case 'register': return colorRegisterName(node.slot);
    case 'storedValue': return storedSlotName(node.slot);
    default: return nodeTypeTitle(node.type);
  }
}

/** The dimmed half of a node's title: which texture, which channel, what the value is. */
export function nodeCaption(node: EditorGraphNode, doc: GxMaterialDoc | null): string | null {
  switch (node.type) {
    case 'texture': return doc?.samplers[node.sampler]?.texture || 'no image';
    case 'value': return String(node.value);
    case 'scale': return `x${node.scale}${node.bias === 0 ? '' : node.bias > 0 ? ' +0.5' : ' -0.5'}`;
    case 'compare': {
      const option = TEV_OP_OPTIONS.find((entry) => entry.numeric === node.op);
      return option ? String(option.label) : null;
    }
    case 'indirectWarp': return `stage ${node.indStage + 1}`;
    case 'rawStage': return 'from the file';
    default: return null;
  }
}

// ---------------------------------------------------------------------------- geometry

/**
 * Card geometry. Every card is drawn at exactly `nodeSize` — the card's CSS height is set from it
 * and nothing inside may grow it — so the wire anchors, hit tests and layout here are the DOM.
 */
export const NODE_WIDTH = 168;
/** The Material node is the big result node on the right, Unreal-style. */
export const OUTPUT_NODE_WIDTH = 196;
export const NODE_HEADER_HEIGHT = 22;
/** Gap between the header and the first pin row. */
export const ROWS_TOP_PADDING = 4;
export const SOCKET_SPACING = 20;
/** Centre of the first pin row, from the top of the card. */
export const SOCKET_TOP = NODE_HEADER_HEIGHT + ROWS_TOP_PADDING + SOCKET_SPACING / 2;
export const NODE_LABEL_HEIGHT = 16;
export const NODE_BOTTOM_PADDING = 6;
export const GRID_SIZE = 8;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Height of what a card draws under its pin rows. Most nodes draw nothing there: their settings
 * live in the Details panel and the title or caption says what they are set to. What stays is
 * what an author reads at a glance — the texture's thumbnail, a colour's swatch, a value — and
 * the read-only step's explanation.
 */
export function nodeBodyHeight(node: EditorGraphNode): number {
  switch (node.type) {
    case 'texture': return 60;
    case 'constant':
    case 'register': return 28;
    case 'value': return 26;
    // The result node says what it is, which also gives it the presence of Unreal's result node.
    case 'output': return 22;
    // The decompiler's one sentence (clamped to four lines) and the "Convert to nodes" button.
    case 'rawStage': return 92;
    default: return 0;
  }
}

export function nodeSize(node: EditorGraphNode): { width: number; height: number } {
  if (isCommentNode(node)) return { width: node.width, height: node.height };
  const spec = nodeSpec(node.type);
  const rows = Math.max(spec.inputs.length, spec.outputs.length);
  return {
    width: node.type === 'output' ? OUTPUT_NODE_WIDTH : NODE_WIDTH,
    height: NODE_HEADER_HEIGHT + ROWS_TOP_PADDING + rows * SOCKET_SPACING + nodeBodyHeight(node)
      + (node.label ? NODE_LABEL_HEIGHT : 0) + NODE_BOTTOM_PADDING,
  };
}

export function nodeRect(node: EditorGraphNode): Rect {
  const { width, height } = nodeSize(node);
  return { x: node.x, y: node.y, width, height };
}

/** Graph-space centre of a socket, for wire endpoints and hit testing. */
export function socketPosition(node: EditorGraphNode, socket: string, side: 'input' | 'output'): { x: number; y: number } | null {
  const spec = nodeSpec(node.type);
  const list = side === 'input' ? spec.inputs : spec.outputs;
  const index = list.findIndex((entry) => entry.name === socket);
  if (index < 0) return null;
  const { width } = nodeSize(node);
  return {
    x: node.x + (side === 'input' ? 0 : width),
    y: node.y + SOCKET_TOP + index * SOCKET_SPACING,
  };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Normalises a drag rectangle so width/height are never negative. */
export function marqueeRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

/** Ids of every node whose box overlaps the marquee. Comments are selectable like anything else. */
export function nodesInMarquee(graph: EditorShaderGraph, rect: Rect): string[] {
  return graph.nodes.filter((node) => rectsIntersect(nodeRect(node), rect)).map((node) => node.id);
}

/** Topmost node under a graph-space point; later nodes win, matching the DOM paint order. */
export function nodeAtPoint(graph: EditorShaderGraph, x: number, y: number): EditorGraphNode | null {
  for (let index = graph.nodes.length - 1; index >= 0; index--) {
    const node = graph.nodes[index];
    const rect = nodeRect(node);
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) return node;
  }
  return null;
}

/**
 * Bounding box of everything in the graph — or of just `nodeIds`, for framing a selection — for
 * fit-to-content. Null when there is nothing to frame.
 */
export function graphBounds(graph: EditorShaderGraph, nodeIds?: readonly string[]): Rect | null {
  const nodes = nodeIds ? graph.nodes.filter((node) => nodeIds.includes(node.id)) : graph.nodes;
  if (nodes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const rect = nodeRect(node);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;

export interface Viewport {
  /** Graph-space point drawn at the top-left of the surface. */
  panX: number;
  panY: number;
  zoom: number;
}

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

/** Wheel-zoom that keeps the graph point under the cursor stationary. */
export function zoomAbout(view: Viewport, factor: number, screenX: number, screenY: number): Viewport {
  const zoom = clampZoom(view.zoom * factor);
  if (zoom === view.zoom) return view;
  const graphX = view.panX + screenX / view.zoom;
  const graphY = view.panY + screenY / view.zoom;
  return { zoom, panX: graphX - screenX / zoom, panY: graphY - screenY / zoom };
}

/**
 * The view that fits `bounds` into a `width` x `height` surface with a little margin. `maxZoom`
 * keeps a single small node from being blown up to fill the screen when it is framed.
 */
export function fitView(bounds: Rect | null, width: number, height: number, margin = 40, maxZoom = MAX_ZOOM): Viewport {
  if (!bounds || bounds.width === 0 || bounds.height === 0) return { panX: -width / 2, panY: -height / 2, zoom: 1 };
  const zoom = clampZoom(Math.min(maxZoom, (width - margin * 2) / bounds.width, (height - margin * 2) / bounds.height));
  return {
    zoom,
    panX: bounds.x + bounds.width / 2 - width / (2 * zoom),
    panY: bounds.y + bounds.height / 2 - height / (2 * zoom),
  };
}

export function toGraphPoint(view: Viewport, screenX: number, screenY: number): { x: number; y: number } {
  return { x: view.panX + screenX / view.zoom, y: view.panY + screenY / view.zoom };
}

export function toScreenPoint(view: Viewport, graphX: number, graphY: number): { x: number; y: number } {
  return { x: (graphX - view.panX) * view.zoom, y: (graphY - view.panY) * view.zoom };
}

export function snapToGrid(value: number, snap: boolean): number {
  return snap ? Math.round(value / GRID_SIZE) * GRID_SIZE : Math.round(value);
}

/**
 * What one wheel event means to the graph, Unreal-style: a mouse wheel zooms about the cursor, a
 * trackpad's two-finger scroll pans, and a pinch (which the browser reports as a ctrl+wheel)
 * zooms. A mouse wheel arrives in whole notches — integer deltas of 50 and up, straight down the
 * Y axis — while a trackpad sends small, often fractional deltas and moves sideways too. Some
 * trackpads do send a large integer now and then, so a gesture that has just looked like a
 * trackpad (`recentTrackpad`) stays one.
 */
export type WheelGesture = { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number };

export function wheelGesture(
  event: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean },
  recentTrackpad = false,
): WheelGesture {
  if (event.ctrlKey) {
    // Pinch deltas are a few units per event; ctrl+wheel notches are about 100. Both zoom, and the
    // clamp keeps one notch from jumping a whole zoom level.
    return { kind: 'zoom', factor: Math.max(0.8, Math.min(1.25, Math.exp(-event.deltaY * 0.01))) };
  }
  // Line-mode deltas only ever come from a real wheel.
  if (event.deltaMode === 1) return { kind: 'zoom', factor: event.deltaY < 0 ? 1.12 : 1 / 1.12 };
  const notch = event.deltaX === 0 && Number.isInteger(event.deltaY) && Math.abs(event.deltaY) >= 50;
  if (notch && !recentTrackpad) {
    return { kind: 'zoom', factor: Math.max(0.6, Math.min(1.6, Math.pow(1.12, -event.deltaY / 100))) };
  }
  return { kind: 'pan', dx: event.deltaX, dy: event.deltaY };
}

// ---------------------------------------------------------------------------- socket typing

/**
 * The type a socket carries. Math nodes are polymorphic: every socket takes the type of whatever
 * was wired in first, and they all agree, so this walks the node's existing edges to find it.
 */
export function socketType(
  graph: EditorShaderGraph,
  nodeId: string,
  socket: string,
  side: 'input' | 'output',
): GraphSocketType {
  const node = graph.nodes.find((entry) => entry.id === nodeId);
  if (!node) return 'rgb';
  const spec = nodeSpec(node.type);
  const list = side === 'input' ? spec.inputs : spec.outputs;
  const declared = list.find((entry) => entry.name === socket);
  if (!isMathNode(node) && node.type !== 'scale' && node.type !== 'compare') return declared?.type ?? 'rgb';
  return resolvedMathType(graph, nodeId) ?? declared?.type ?? 'rgb';
}

/** The type a polymorphic node has settled on, or null while nothing is wired to it. */
export function resolvedMathType(graph: EditorShaderGraph, nodeId: string): GraphSocketType | null {
  for (const edge of graph.edges) {
    if (edge.to.node === nodeId) {
      const from = graph.nodes.find((entry) => entry.id === edge.from.node);
      if (from) {
        const type = declaredSocketType(from, edge.from.socket, 'output');
        if (type) return type;
      }
    }
    if (edge.from.node === nodeId) {
      const to = graph.nodes.find((entry) => entry.id === edge.to.node);
      if (to && !isPolymorphic(to)) {
        const type = declaredSocketType(to, edge.to.socket, 'input');
        if (type) return type;
      }
    }
  }
  return null;
}

function isPolymorphic(node: EditorGraphNode): boolean {
  return isMathNode(node) || node.type === 'scale' || node.type === 'compare';
}

function declaredSocketType(node: EditorGraphNode, socket: string, side: 'input' | 'output'): GraphSocketType | null {
  const spec = nodeSpec(node.type);
  const list = side === 'input' ? spec.inputs : spec.outputs;
  const entry = list.find((candidate) => candidate.name === socket);
  if (!entry) return null;
  if (isPolymorphic(node)) return null;
  return entry.type;
}

export interface SocketRef {
  node: string;
  socket: string;
  side: 'input' | 'output';
}

/**
 * Whether a wire from `from` (an output) to `to` (an input) is allowed: opposite sides, not the
 * same node, no cycle, and either matching types or a polymorphic node that has not settled yet.
 */
export function canConnect(graph: EditorShaderGraph, from: SocketRef, to: SocketRef): { ok: boolean; reason?: string } {
  if (from.side !== 'output' || to.side !== 'input') return { ok: false, reason: 'Wires run from an output to an input.' };
  if (from.node === to.node) return { ok: false, reason: 'A node cannot feed itself.' };
  if (wouldCycle(graph, from.node, to.node)) return { ok: false, reason: 'That would make a loop.' };

  const fromNode = graph.nodes.find((entry) => entry.id === from.node);
  const toNode = graph.nodes.find((entry) => entry.id === to.node);
  if (!fromNode || !toNode) return { ok: false, reason: 'That socket is gone.' };

  const fromType = declaredSocketType(fromNode, from.socket, 'output') ?? resolvedMathType(graph, from.node);
  const toType = declaredSocketType(toNode, to.socket, 'input') ?? resolvedMathType(graph, to.node);
  if (fromType === null || toType === null) return { ok: true };
  if (fromType !== toType) {
    return { ok: false, reason: `A ${fromType === 'rgb' ? 'colour' : 'alpha'} value cannot drive ${toType === 'rgb' ? 'a colour' : 'an alpha'} input.` };
  }
  return { ok: true };
}

/** True when a wire from `fromNode` to `toNode` would close a loop. */
export function wouldCycle(graph: EditorShaderGraph, fromNode: string, toNode: string): boolean {
  const seen = new Set<string>();
  const stack = [toNode];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === fromNode) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const edge of graph.edges) if (edge.from.node === current) stack.push(edge.to.node);
  }
  return false;
}

/** Node types whose outputs can legally drive `to`, for the drag-to-empty-space palette. */
export function compatibleNodeTypes(graph: EditorShaderGraph, socket: SocketRef): EditorGraphNodeType[] {
  return ADDABLE_NODE_TYPES.filter((type) => {
    const spec = nodeSpec(type);
    const list = socket.side === 'output' ? spec.inputs : spec.outputs;
    if (list.length === 0) return false;
    const probe: EditorShaderGraph = {
      ...graph,
      nodes: [...graph.nodes, { id: '__probe', type, x: 0, y: 0 } as EditorGraphNode],
    };
    return list.some((entry) => {
      const other: SocketRef = { node: '__probe', socket: entry.name, side: socket.side === 'output' ? 'input' : 'output' };
      const [output, input] = socket.side === 'output' ? [socket, other] : [other, socket];
      return canConnect(probe, output, input).ok;
    });
  });
}

// ---------------------------------------------------------------------------- edits

let idCounter = 0;

/** Deterministic-ish unique id. Tests pass their own via `withIdFactory`. */
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Adds an edge, replacing whatever already fed the destination input — an input socket takes one
 * wire. Returns the graph unchanged when the connection is not allowed.
 */
export function connectEdge(graph: EditorShaderGraph, from: SocketRef, to: SocketRef): EditorShaderGraph {
  if (!canConnect(graph, from, to).ok) return graph;
  const edges = graph.edges.filter((edge) => !(edge.to.node === to.node && edge.to.socket === to.socket));
  edges.push({ id: newId('e'), from: { node: from.node, socket: from.socket }, to: { node: to.node, socket: to.socket } });
  return { ...graph, edges };
}

export function removeEdges(graph: EditorShaderGraph, edgeIds: readonly string[]): EditorShaderGraph {
  if (edgeIds.length === 0) return graph;
  const drop = new Set(edgeIds);
  return { ...graph, edges: graph.edges.filter((edge) => !drop.has(edge.id)) };
}

/** Deletes nodes and every wire touching them. The Material output node cannot be deleted. */
export function deleteNodes(graph: EditorShaderGraph, nodeIds: readonly string[]): EditorShaderGraph {
  const drop = new Set(graph.nodes.filter((node) => nodeIds.includes(node.id) && node.type !== 'output').map((node) => node.id));
  if (drop.size === 0) return graph;
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !drop.has(node.id)),
    edges: graph.edges.filter((edge) => !drop.has(edge.from.node) && !drop.has(edge.to.node)),
  };
}

export function moveNodes(graph: EditorShaderGraph, nodeIds: readonly string[], dx: number, dy: number, snap = false): EditorShaderGraph {
  const move = new Set(nodeIds);
  if (move.size === 0) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      move.has(node.id) ? { ...node, x: snapToGrid(node.x + dx, snap), y: snapToGrid(node.y + dy, snap) } : node,
    ),
  };
}

export function patchNode<T extends EditorGraphNode>(graph: EditorShaderGraph, nodeId: string, patch: Partial<T>): EditorShaderGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === nodeId ? ({ ...node, ...patch } as EditorGraphNode) : node)),
  };
}

export function addNode(graph: EditorShaderGraph, node: EditorGraphNode): EditorShaderGraph {
  return { ...graph, nodes: [...graph.nodes, node] };
}

/** A new node of `type` at a graph position, with the defaults its controls start from. */
export function createNode(type: EditorGraphNodeType, x: number, y: number): EditorGraphNode {
  const base = { id: newId('n'), x: Math.round(x), y: Math.round(y) };
  switch (type) {
    case 'texture': return { ...base, type, sampler: 0, texCoord: 0 };
    case 'vertexColor': return { ...base, type, channel: 0 };
    case 'constant': return { ...base, type, slot: 0 };
    case 'register': return { ...base, type, slot: 0 };
    case 'storedValue': return { ...base, type, slot: 'prev' };
    case 'value': return { ...base, type, value: 1 };
    case 'alphaAsColor': return { ...base, type };
    case 'scale': return { ...base, type, scale: 2, bias: 0, clamp: true };
    case 'compare': return { ...base, type, op: 8 as never };
    case 'indirectWarp': return { ...base, type, indStage: 0, matrix: 1 as never, format: 0 as never, bias: 0 as never, wrapS: 0 as never, wrapT: 0 as never, addPrevious: false };
    case 'comment': return { ...base, type, width: 240, height: 120, text: 'Note' };
    // `rawStage` is never in the palette: it only ever comes from the decompiler, which has a
    // stage to put in it. Made here it would be an empty one, so it is refused instead.
    case 'rawStage': throw new Error('A raw stage cannot be added by hand.');
    default: return { ...base, type } as EditorGraphNode;
  }
}

/**
 * Copies nodes and the wires wholly inside the selection, offset so the duplicate is visible.
 * Ids are regenerated; the Material output node is never duplicated (there is only ever one).
 */
export function duplicateNodes(
  graph: EditorShaderGraph,
  nodeIds: readonly string[],
  offsetX = 24,
  offsetY = 24,
): { graph: EditorShaderGraph; newIds: string[] } {
  const source = graph.nodes.filter((node) => nodeIds.includes(node.id) && node.type !== 'output');
  if (source.length === 0) return { graph, newIds: [] };
  const remap = new Map(source.map((node) => [node.id, newId('n')]));
  const nodes = source.map((node) => ({ ...node, id: remap.get(node.id)!, x: node.x + offsetX, y: node.y + offsetY }));
  const edges = graph.edges
    .filter((edge) => remap.has(edge.from.node) && remap.has(edge.to.node))
    .map((edge) => ({
      id: newId('e'),
      from: { node: remap.get(edge.from.node)!, socket: edge.from.socket },
      to: { node: remap.get(edge.to.node)!, socket: edge.to.socket },
    }));
  return {
    graph: { ...graph, nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...edges] },
    newIds: nodes.map((node) => node.id),
  };
}

export interface GraphClipboard {
  kind: 'mkw-shader-graph';
  nodes: EditorGraphNode[];
  edges: GraphEdge[];
}

/** The selection as JSON, for Ctrl+C. Positions are relative to the selection's top-left. */
export function copyNodes(graph: EditorShaderGraph, nodeIds: readonly string[]): GraphClipboard {
  const nodes = graph.nodes.filter((node) => nodeIds.includes(node.id) && node.type !== 'output');
  const ids = new Set(nodes.map((node) => node.id));
  const originX = nodes.length > 0 ? Math.min(...nodes.map((node) => node.x)) : 0;
  const originY = nodes.length > 0 ? Math.min(...nodes.map((node) => node.y)) : 0;
  return {
    kind: 'mkw-shader-graph',
    nodes: nodes.map((node) => ({ ...node, x: node.x - originX, y: node.y - originY })),
    edges: graph.edges.filter((edge) => ids.has(edge.from.node) && ids.has(edge.to.node)),
  };
}

export function parseClipboard(text: string): GraphClipboard | null {
  try {
    const parsed = JSON.parse(text) as GraphClipboard;
    if (parsed?.kind !== 'mkw-shader-graph' || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Pastes a clipboard at a graph position, with fresh ids. */
export function pasteNodes(
  graph: EditorShaderGraph,
  clipboard: GraphClipboard,
  x: number,
  y: number,
): { graph: EditorShaderGraph; newIds: string[] } {
  if (clipboard.nodes.length === 0) return { graph, newIds: [] };
  const remap = new Map(clipboard.nodes.map((node) => [node.id, newId('n')]));
  const nodes = clipboard.nodes.map((node) => ({ ...node, id: remap.get(node.id)!, x: node.x + x, y: node.y + y }));
  const edges = clipboard.edges
    .filter((edge) => remap.has(edge.from.node) && remap.has(edge.to.node))
    .map((edge) => ({
      id: newId('e'),
      from: { node: remap.get(edge.from.node)!, socket: edge.from.socket },
      to: { node: remap.get(edge.to.node)!, socket: edge.to.socket },
    }));
  return {
    graph: { ...graph, nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...edges] },
    newIds: nodes.map((node) => node.id),
  };
}

// ---------------------------------------------------------------------------- layout

/**
 * The size and pin positions of a card exactly as `GraphNodeCard` draws it, for the layout: every
 * card is drawn at `nodeSize`, with pin row `i` centred at `SOCKET_TOP + i * SOCKET_SPACING`.
 */
export function measureCard(node: EditorGraphNode): GraphNodeSize {
  const spec = nodeSpec(node.type);
  const at = (list: readonly GraphSocketSpec[]) =>
    Object.fromEntries(list.map((socket, index) => [socket.name, SOCKET_TOP + index * SOCKET_SPACING]));
  return { ...nodeSize(node), inputs: at(spec.inputs), outputs: at(spec.outputs) };
}

/**
 * Unreal-style layered layout, left to right into the Material node, with the colour pipeline
 * above the alpha one (`layoutShaderGraph`), measured against the cards this editor draws.
 * Comments keep their position — they are annotations on a layout, not part of it.
 */
export function autoLayout(graph: EditorShaderGraph): EditorShaderGraph {
  return layoutShaderGraph(graph, measureCard);
}

// ---------------------------------------------------------------------------- wires

/** Cubic bezier `d` for a wire, with the handles scaled to the horizontal gap. */
export function wirePath(x0: number, y0: number, x1: number, y1: number): string {
  const handle = Math.max(28, Math.min(140, Math.abs(x1 - x0) * 0.5));
  return `M ${x0} ${y0} C ${x0 + handle} ${y0}, ${x1 - handle} ${y1}, ${x1} ${y1}`;
}

/** Squared distance from a point to a wire, sampled along the curve, for click-to-select. */
export function distanceToWire(x0: number, y0: number, x1: number, y1: number, px: number, py: number): number {
  const handle = Math.max(28, Math.min(140, Math.abs(x1 - x0) * 0.5));
  let best = Infinity;
  for (let step = 0; step <= 24; step++) {
    const t = step / 24;
    const u = 1 - t;
    const x = u * u * u * x0 + 3 * u * u * t * (x0 + handle) + 3 * u * t * t * (x1 - handle) + t * t * t * x1;
    const y = u * u * u * y0 + 3 * u * u * t * y0 + 3 * u * t * t * y1 + t * t * t * y1;
    best = Math.min(best, Math.hypot(x - px, y - py));
  }
  return best;
}

/** The wire nearest a graph-space point, within `tolerance` graph units. */
export function wireAtPoint(graph: EditorShaderGraph, x: number, y: number, tolerance = 8): GraphEdge | null {
  let best: GraphEdge | null = null;
  let bestDistance = tolerance;
  for (const edge of graph.edges) {
    const fromNode = graph.nodes.find((node) => node.id === edge.from.node);
    const toNode = graph.nodes.find((node) => node.id === edge.to.node);
    if (!fromNode || !toNode) continue;
    const start = socketPosition(fromNode, edge.from.socket, 'output');
    const end = socketPosition(toNode, edge.to.socket, 'input');
    if (!start || !end) continue;
    const distance = distanceToWire(start.x, start.y, end.x, end.y, x, y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = edge;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------- misc

/** The socket an input is fed from, or null when nothing is wired to it. */
export function inputSource(graph: EditorShaderGraph, nodeId: string, socket: string): GraphEdge | null {
  return graph.edges.find((edge) => edge.to.node === nodeId && edge.to.socket === socket) ?? null;
}

export function socketSpecs(node: EditorGraphNode, side: 'input' | 'output'): GraphSocketSpec[] {
  const spec = nodeSpec(node.type);
  return side === 'input' ? spec.inputs : spec.outputs;
}

/** Ids of the wires touching any of `nodeIds`, for "Disconnect" on the node menu. */
export function edgesTouching(graph: EditorShaderGraph, nodeIds: readonly string[]): string[] {
  return graph.edges.filter((edge) => nodeIds.includes(edge.from.node) || nodeIds.includes(edge.to.node)).map((edge) => edge.id);
}

/** `node|socket|side` for every socket with a wire on it, so a card can draw its pins filled. */
export function connectedSockets(graph: EditorShaderGraph): Set<string> {
  const connected = new Set<string>();
  for (const edge of graph.edges) {
    connected.add(`${edge.from.node}|${edge.from.socket}|output`);
    connected.add(`${edge.to.node}|${edge.to.socket}|input`);
  }
  return connected;
}

/** The values an input can hold inline, in the order the card's little switch shows them. */
export const INLINE_VALUES: readonly GraphInlineValue[] = [0, 0.5, 1];

/**
 * What an unwired input shows inline, or null when it cannot hold a value: a texture's
 * coordinates, a warp's bump map and a special step's ordering input mean nothing without a wire,
 * and an unwired Material input means "this half computes nothing", not a constant.
 */
export function inlineValue(node: EditorGraphNode, socket: string): GraphInlineValue | null {
  return acceptsInlineValue(node, socket) ? inlineInputValue(node, socket) : null;
}

/** Sets the inline value of one input, Unreal-style: the number typed into the node itself. */
export function setInputValue(graph: EditorShaderGraph, nodeId: string, socket: string, value: GraphInlineValue): EditorShaderGraph {
  return { ...graph, nodes: graph.nodes.map((node) => (node.id === nodeId ? withInlineValue(node, socket, value) : node)) };
}

/** How the card and the Details panel write an inline value: `½`, not `0.5`. */
export function inlineValueLabel(value: GraphInlineValue): string {
  return value === 0.5 ? '½' : String(value);
}

/**
 * How many steps in a graph are the read-only "Special step" card. Comparing a stored graph's
 * count with what a fresh read of the material gives is what decides whether re-reading would
 * gain anything, so it lives here rather than being spelled out at each call site.
 */
export function countRawStages(graph: EditorShaderGraph | null | undefined): number {
  return graph ? graph.nodes.filter((node) => node.type === 'rawStage').length : 0;
}

/** An empty graph with just the Material node, for a material with no stages. */
export function emptyGraph(): EditorShaderGraph {
  return { version: 1, nodes: [{ id: newId('n'), type: 'output', x: 0, y: 0 }], edges: [] };
}
