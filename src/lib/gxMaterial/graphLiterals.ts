// Inline input values: the literal an unwired socket reads, typed into the node itself.
//
// The TEV gives every stage three free constants — zero, a half and one — so a step whose `A`
// input is "0" needs no node at all to say so. An older graph (and an older decompiler) spelled
// that as a separate "Value" node wired into every input that wanted it, which on a real material
// is one node with a dozen wires fanned out across the whole canvas. `inputValues` is the Unreal
// way of saying the same thing, and `foldLiteralNodes` turns the one into the other.
//
// Only imports the contract, so the editor can use it without pulling in the compiler.

import { GRAPH_NODE_SOCKETS } from './types';
import type { GraphInlineValue, GraphNode, GraphNodeType, ShaderGraph } from './types';

/**
 * The node types whose unwired inputs the compiler reads as literals. The material output's
 * sockets have defaults too, but an unwired output means "this pipeline computes nothing", not
 * "write a constant", so a value typed there would do nothing and the editor should not offer it.
 */
const INLINE_VALUE_TYPES: ReadonlySet<GraphNodeType> = new Set<GraphNodeType>([
  'multiply', 'add', 'subtract', 'lerp', 'scale', 'compare',
]);

/** Does this input read `inputValues[socket]` when nothing is wired to it? */
export function acceptsInlineValue(node: Pick<GraphNode, 'type'>, socket: string): boolean {
  if (!INLINE_VALUE_TYPES.has(node.type)) return false;
  return GRAPH_NODE_SOCKETS[node.type].inputs.some((input) => input.name === socket && input.default !== undefined);
}

/**
 * What an unwired input reads: the value typed into the node, else the socket's default. Anything
 * that is not one of the three hardware literals (a hand-edited or corrupt save) reads as the
 * default rather than as an operand the hardware does not have.
 */
export function inlineInputValue(node: GraphNode, socket: string): GraphInlineValue {
  const typed = node.inputValues?.[socket];
  if (typed === 0 || typed === 0.5 || typed === 1) return typed;
  return GRAPH_NODE_SOCKETS[node.type]?.inputs.find((input) => input.name === socket)?.default ?? 0;
}

/**
 * `node` with `inputValues[socket]` set to `value`, or the entry removed when `value` is the
 * socket's default — a default needs no entry, and leaving none keeps saved graphs small and
 * `inputValues` absent on a node that never had a value typed in.
 */
export function withInlineValue<T extends GraphNode>(node: T, socket: string, value: GraphInlineValue): T {
  const fallback = GRAPH_NODE_SOCKETS[node.type]?.inputs.find((input) => input.name === socket)?.default;
  const next: Partial<Record<string, GraphInlineValue>> = { ...node.inputValues };
  if (value === fallback) delete next[socket];
  else next[socket] = value;
  const { inputValues: _previous, ...rest } = node;
  return (Object.keys(next).length > 0 ? { ...rest, inputValues: next } : rest) as T;
}

/**
 * Turns "Value" nodes wired into inputs into inline values on the nodes they feed, and drops a
 * Value node once nothing reads it any more. A wire into something that does not read inline
 * values — the material output, a raw stage's ordering input — is left alone, and so is the Value
 * node feeding it. Compiling the result gives exactly the stages the input graph did: an inline
 * literal and a wired Value node both lower through the same `literal` path.
 *
 * Pure: returns the input graph itself when there is nothing to fold.
 */
export function foldLiteralNodes(graph: ShaderGraph): ShaderGraph {
  const values = new Map<string, GraphInlineValue>();
  for (const node of graph.nodes) if (node.type === 'value') values.set(node.id, node.value);
  if (values.size === 0) return graph;

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const typed = new Map<string, GraphNode>();
  const folded = new Set<string>();
  for (const edge of graph.edges) {
    const value = values.get(edge.from.node);
    if (value === undefined) continue;
    const target = typed.get(edge.to.node) ?? nodesById.get(edge.to.node);
    if (!target || !acceptsInlineValue(target, edge.to.socket)) continue;
    typed.set(target.id, withInlineValue(target, edge.to.socket, value));
    folded.add(edge.id);
  }
  if (folded.size === 0) return graph;

  const edges = graph.edges.filter((edge) => !folded.has(edge.id));
  const stillRead = new Set(edges.map((edge) => edge.from.node));
  const nodes = graph.nodes
    .filter((node) => node.type !== 'value' || stillRead.has(node.id) || !wasFoldedFrom(graph, folded, node.id))
    .map((node) => typed.get(node.id) ?? node);
  return { ...graph, nodes, edges };
}

/** A Value node nobody had wired to begin with is the author's, and stays. */
function wasFoldedFrom(graph: ShaderGraph, folded: ReadonlySet<string>, nodeId: string): boolean {
  return graph.edges.some((edge) => edge.from.node === nodeId && folded.has(edge.id));
}
