// Pure model behind the shader-graph node editor: geometry, hit testing, socket typing, edge
// rules, selection, clipboard and layout. No React, no DOM — everything here is unit tested in
// `graphModel.test.ts`, and `GraphEditor.tsx` is only the pointer/keyboard shell around it.
// Imported from the contract file rather than from `../../lib/gxMaterial`: this is the only
// *value* the editor needs from the library, and going through the barrel would pull the whole
// BRRES parser into the main bundle instead of leaving it behind `loadMaterialLibrary`.
import {
  GRAPH_NODE_SOCKETS,
  type GraphEdge,
  type GraphNode,
  type GraphNodeSpec,
  type GraphNodeType,
  type GraphSocketSpec,
  type GraphSocketType,
  type GxMaterialDoc,
  type ShaderGraph,
} from '../../lib/gxMaterial/types';
import { colorRegisterName, konstColorName } from './gxOptions';

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

/** Node types the "Add node" palette offers, in menu order. `output` is never addable twice. */
export const ADDABLE_NODE_TYPES: GraphNodeType[] = [
  'texture', 'vertexColor', 'constant', 'register', 'value',
  'multiply', 'add', 'subtract', 'lerp', 'scale', 'compare', 'indirectWarp', 'comment',
];

export const NODE_CATEGORY: Record<EditorGraphNodeType, 'source' | 'math' | 'output' | 'note'> = {
  output: 'output',
  texture: 'source',
  vertexColor: 'source',
  constant: 'source',
  register: 'source',
  value: 'source',
  multiply: 'math',
  add: 'math',
  subtract: 'math',
  lerp: 'math',
  scale: 'math',
  compare: 'math',
  indirectWarp: 'math',
  comment: 'note',
  rawStage: 'output',
};

/** One-line explanation of what a node does, used by the palette and the node tooltip. */
export const NODE_SUMMARY: Record<EditorGraphNodeType, string> = {
  output: 'What the material draws. Whatever is wired into it is the final colour and alpha.',
  texture: 'Reads one of the material\'s textures.',
  vertexColor: 'The colour the mesh brings with it — the vertex colours, or the scene lighting when the material is lit.',
  constant: 'One of the material\'s four colours. The swatch on the card edits it, live.',
  register: 'The colour a scratch slot starts at, before any step writes to it.',
  value: 'A plain number the hardware supplies for free: 0, a half, or 1.',
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
    default: return nodeSpec(type).title;
  }
}

export function nodeTitle(node: EditorGraphNode): string {
  switch (node.type) {
    case 'texture': return `Texture ${node.sampler + 1}`;
    case 'constant': return konstColorName(node.slot);
    case 'register': return colorRegisterName(node.slot);
    default: return nodeTypeTitle(node.type);
  }
}

/** The dimmed half of a node's title: which texture, which channel, what the value is. */
export function nodeCaption(node: EditorGraphNode, doc: GxMaterialDoc | null): string | null {
  switch (node.type) {
    case 'texture': return doc?.samplers[node.sampler]?.texture || 'no image';
    case 'vertexColor': return `channel ${node.channel + 1}`;
    case 'value': return String(node.value);
    case 'scale': return `x${node.scale}${node.bias === 0 ? '' : node.bias > 0 ? ' +0.5' : ' -0.5'}`;
    case 'rawStage': return 'from the file';
    default: return null;
  }
}

// ---------------------------------------------------------------------------- geometry

export const NODE_WIDTH = 176;
export const NODE_HEADER_HEIGHT = 24;
export const SOCKET_SPACING = 20;
export const SOCKET_TOP = NODE_HEADER_HEIGHT + 12;
export const GRID_SIZE = 8;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Extra height a node's own controls take, on top of its socket rows. */
export function nodeBodyHeight(node: EditorGraphNode): number {
  switch (node.type) {
    case 'texture': return 96;
    case 'constant': return 56;
    case 'register': return 30;
    case 'value': return 30;
    case 'scale': return 62;
    case 'compare': return 30;
    case 'indirectWarp': return 94;
    case 'vertexColor': return 30;
    // Four detail rows plus the sentence that explains why the card is read-only.
    case 'rawStage': return 122;
    default: return 0;
  }
}

export function nodeSize(node: EditorGraphNode): { width: number; height: number } {
  if (isCommentNode(node)) return { width: node.width, height: node.height };
  const spec = nodeSpec(node.type);
  const rows = Math.max(spec.inputs.length, spec.outputs.length);
  return {
    width: NODE_WIDTH,
    // The caption under the title is part of the node's box; leaving it out of the height is what
    // makes a laid-out graph overlap.
    height: NODE_HEADER_HEIGHT + 10 + rows * SOCKET_SPACING + nodeBodyHeight(node) + (node.label ? 18 : 0) + 10,
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

/** Bounding box of everything in the graph, for fit-to-content. Null when the graph is empty. */
export function graphBounds(graph: EditorShaderGraph): Rect | null {
  if (graph.nodes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of graph.nodes) {
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

/** The view that fits `bounds` into a `width` x `height` surface with a little margin. */
export function fitView(bounds: Rect | null, width: number, height: number, margin = 40): Viewport {
  if (!bounds || bounds.width === 0 || bounds.height === 0) return { panX: -width / 2, panY: -height / 2, zoom: 1 };
  const zoom = clampZoom(Math.min((width - margin * 2) / bounds.width, (height - margin * 2) / bounds.height));
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
    case 'value': return { ...base, type, value: 1 };
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

const LAYOUT_COLUMN = NODE_WIDTH + 84;
const LAYOUT_ROW = 24;

/**
 * Left-to-right layered layout, "as late as possible": a node's column is set by how far it still
 * is from the Material node, so a texture feeding the last stage sits next to that stage rather
 * than back at the far left with every other source. Laying it out the other way round (one column
 * right of the deepest input) piles every source into column 0, which for a real material is a
 * single unreadable stack.
 *
 * Comments keep their position — they are annotations on a layout, not part of it.
 */
export function autoLayout(graph: EditorShaderGraph): EditorShaderGraph {
  const laidOut = graph.nodes.filter((node) => !isCommentNode(node));
  if (laidOut.length === 0) return graph;

  const distance = new Map<string, number>();
  const visiting = new Set<string>();
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  /** Longest path from this node to a node nothing consumes (the Material node, normally). */
  function distanceToSink(nodeId: string): number {
    const known = distance.get(nodeId);
    if (known !== undefined) return known;
    if (visiting.has(nodeId)) return 0; // a cycle: stop rather than recurse for ever
    visiting.add(nodeId);
    let best = 0;
    for (const edge of graph.edges) {
      if (edge.from.node !== nodeId) continue;
      const to = nodeById.get(edge.to.node);
      if (!to || isCommentNode(to)) continue;
      best = Math.max(best, distanceToSink(to.id) + 1);
    }
    visiting.delete(nodeId);
    distance.set(nodeId, best);
    return best;
  }

  for (const node of laidOut) distanceToSink(node.id);
  const longest = Math.max(0, ...laidOut.map((node) => distance.get(node.id) ?? 0));
  const columnOf = (node: EditorGraphNode) => longest - (distance.get(node.id) ?? 0);

  const columns = new Map<number, EditorGraphNode[]>();
  for (const node of laidOut) {
    const column = columnOf(node);
    const list = columns.get(column) ?? [];
    list.push(node);
    columns.set(column, list);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [column, list] of columns) {
    const heights = list.map((node) => nodeSize(node).height);
    const total = heights.reduce((sum, height) => sum + height + LAYOUT_ROW, -LAYOUT_ROW);
    let y = -total / 2;
    list.forEach((node, index) => {
      positions.set(node.id, { x: column * LAYOUT_COLUMN, y: Math.round(y) });
      y += heights[index] + LAYOUT_ROW;
    });
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const position = positions.get(node.id);
      return position ? { ...node, x: position.x, y: position.y } : node;
    }),
  };
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

/** An empty graph with just the Material node, for a material with no stages. */
export function emptyGraph(): EditorShaderGraph {
  return { version: 1, nodes: [{ id: newId('n'), type: 'output', x: 0, y: 0 }], edges: [] };
}
