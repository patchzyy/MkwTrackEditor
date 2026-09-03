import { describe, expect, it } from 'vitest';
import {
  addNode,
  autoLayout,
  canConnect,
  compatibleNodeTypes,
  connectEdge,
  copyNodes,
  createNode,
  deleteNodes,
  duplicateNodes,
  fitView,
  graphBounds,
  marqueeRect,
  moveNodes,
  nodeAtPoint,
  nodeSize,
  nodeSpec,
  nodesInMarquee,
  parseClipboard,
  pasteNodes,
  removeEdges,
  resolvedMathType,
  snapToGrid,
  socketPosition,
  socketType,
  toGraphPoint,
  toScreenPoint,
  wireAtPoint,
  wouldCycle,
  zoomAbout,
  type EditorGraphNode,
  type EditorShaderGraph,
} from './graphModel';

function graphOf(nodes: EditorGraphNode[], edges: EditorShaderGraph['edges'] = []): EditorShaderGraph {
  return { version: 1, nodes, edges };
}

const texture = (id: string, x = 0, y = 0): EditorGraphNode => ({ id, type: 'texture', x, y, sampler: 0, texCoord: 0 });
const output = (id: string, x = 400, y = 0): EditorGraphNode => ({ id, type: 'output', x, y });
const multiply = (id: string, x = 200, y = 0): EditorGraphNode => ({ id, type: 'multiply', x, y });

describe('node geometry', () => {
  it('gives a node a height that grows with its socket count', () => {
    const small = nodeSize({ id: 'v', type: 'value', x: 0, y: 0, value: 1 });
    const wide = nodeSize(multiply('m'));
    expect(small.width).toBe(wide.width);
    expect(nodeSize(output('o')).height).toBeGreaterThan(0);
  });

  it('puts input sockets on the left edge and outputs on the right', () => {
    const node = multiply('m', 100, 50);
    const input = socketPosition(node, 'a', 'input');
    const out = socketPosition(node, 'out', 'output');
    expect(input).not.toBeNull();
    expect(input!.x).toBe(100);
    expect(out!.x).toBe(100 + nodeSize(node).width);
    expect(socketPosition(node, 'nope', 'input')).toBeNull();
  });

  it('stacks a node\'s sockets one row apart', () => {
    const node = multiply('m');
    const a = socketPosition(node, 'a', 'input')!;
    const b = socketPosition(node, 'b', 'input')!;
    expect(b.y - a.y).toBe(20);
  });
});

describe('hit testing', () => {
  it('finds the node under a point, topmost first', () => {
    const graph = graphOf([texture('a', 0, 0), texture('b', 10, 10)]);
    expect(nodeAtPoint(graph, 20, 20)?.id).toBe('b');
    expect(nodeAtPoint(graph, 5, 5)?.id).toBe('a');
    expect(nodeAtPoint(graph, -50, -50)).toBeNull();
  });

  it('selects the nodes a marquee touches', () => {
    const graph = graphOf([texture('a', 0, 0), texture('b', 600, 0)]);
    expect(nodesInMarquee(graph, marqueeRect(-10, -10, 100, 100))).toEqual(['a']);
    expect(nodesInMarquee(graph, marqueeRect(700, 700, -10, -10)).sort()).toEqual(['a', 'b']);
  });

  it('normalises a marquee dragged up and to the left', () => {
    expect(marqueeRect(50, 60, 10, 20)).toEqual({ x: 10, y: 20, width: 40, height: 40 });
  });

  it('finds the wire nearest a point and ignores far ones', () => {
    const graph = connectEdge(
      graphOf([texture('a', 0, 0), output('o', 400, 0)]),
      { node: 'a', socket: 'rgb', side: 'output' },
      { node: 'o', socket: 'color', side: 'input' },
    );
    const start = socketPosition(graph.nodes[0], 'rgb', 'output')!;
    expect(wireAtPoint(graph, start.x, start.y, 6)).not.toBeNull();
    expect(wireAtPoint(graph, start.x, start.y + 400, 6)).toBeNull();
  });
});

describe('socket typing', () => {
  it('reports the declared type of a fixed socket', () => {
    const graph = graphOf([texture('a')]);
    expect(socketType(graph, 'a', 'rgb', 'output')).toBe('rgb');
    expect(socketType(graph, 'a', 'alpha', 'output')).toBe('alpha');
  });

  it('leaves a math node untyped until something is wired to it', () => {
    const graph = graphOf([multiply('m')]);
    expect(resolvedMathType(graph, 'm')).toBeNull();
  });

  it('fixes a math node\'s type from the first wire', () => {
    const graph = connectEdge(
      graphOf([texture('a'), multiply('m')]),
      { node: 'a', socket: 'alpha', side: 'output' },
      { node: 'm', socket: 'a', side: 'input' },
    );
    expect(resolvedMathType(graph, 'm')).toBe('alpha');
    expect(socketType(graph, 'm', 'b', 'input')).toBe('alpha');
    expect(socketType(graph, 'm', 'out', 'output')).toBe('alpha');
  });
});

describe('connection rules', () => {
  const base = graphOf([texture('a'), multiply('m'), output('o')]);

  it('rejects output-to-output and input-to-input', () => {
    expect(canConnect(base, { node: 'a', socket: 'rgb', side: 'output' }, { node: 'm', socket: 'out', side: 'output' }).ok).toBe(false);
    expect(canConnect(base, { node: 'a', socket: 'rgb', side: 'input' }, { node: 'm', socket: 'a', side: 'input' }).ok).toBe(false);
  });

  it('rejects a node feeding itself', () => {
    expect(canConnect(base, { node: 'm', socket: 'out', side: 'output' }, { node: 'm', socket: 'a', side: 'input' }).ok).toBe(false);
  });

  it('rejects a colour value driving an alpha input', () => {
    const verdict = canConnect(base, { node: 'a', socket: 'rgb', side: 'output' }, { node: 'o', socket: 'alpha', side: 'input' });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/alpha/i);
  });

  it('accepts a matching pair', () => {
    expect(canConnect(base, { node: 'a', socket: 'rgb', side: 'output' }, { node: 'o', socket: 'color', side: 'input' }).ok).toBe(true);
  });

  it('rejects a wire that would close a loop', () => {
    let graph = connectEdge(base, { node: 'a', socket: 'rgb', side: 'output' }, { node: 'm', socket: 'a', side: 'input' });
    graph = connectEdge(graph, { node: 'm', socket: 'out', side: 'output' }, { node: 'o', socket: 'color', side: 'input' });
    // a already feeds m, so wiring m back into a would close the loop; m into o's chain does not.
    expect(wouldCycle(graph, 'm', 'a')).toBe(true);
    expect(wouldCycle(graph, 'a', 'm')).toBe(false);
    expect(canConnect(graph, { node: 'm', socket: 'out', side: 'output' }, { node: 'a', socket: 'uv', side: 'input' }).ok).toBe(false);
  });

  it('offers only node types that could legally be wired to a socket', () => {
    const types = compatibleNodeTypes(base, { node: 'o', socket: 'alpha', side: 'input' });
    expect(types).toContain('texture');
    expect(types).not.toContain('comment');
  });
});

describe('edges', () => {
  it('replaces whatever already fed an input socket', () => {
    let graph = graphOf([texture('a'), texture('b'), output('o')]);
    graph = connectEdge(graph, { node: 'a', socket: 'rgb', side: 'output' }, { node: 'o', socket: 'color', side: 'input' });
    graph = connectEdge(graph, { node: 'b', socket: 'rgb', side: 'output' }, { node: 'o', socket: 'color', side: 'input' });
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].from.node).toBe('b');
  });

  it('leaves an output socket free to feed several inputs', () => {
    let graph = graphOf([texture('a'), multiply('m'), output('o')]);
    graph = connectEdge(graph, { node: 'a', socket: 'rgb', side: 'output' }, { node: 'm', socket: 'a', side: 'input' });
    graph = connectEdge(graph, { node: 'a', socket: 'rgb', side: 'output' }, { node: 'm', socket: 'b', side: 'input' });
    expect(graph.edges).toHaveLength(2);
  });

  it('ignores a connection that is not allowed', () => {
    const graph = graphOf([texture('a'), output('o')]);
    expect(connectEdge(graph, { node: 'a', socket: 'rgb', side: 'output' }, { node: 'o', socket: 'alpha', side: 'input' })).toBe(graph);
  });

  it('removes wires by id', () => {
    const graph = connectEdge(
      graphOf([texture('a'), output('o')]),
      { node: 'a', socket: 'rgb', side: 'output' },
      { node: 'o', socket: 'color', side: 'input' },
    );
    expect(removeEdges(graph, [graph.edges[0].id]).edges).toHaveLength(0);
    expect(removeEdges(graph, [])).toBe(graph);
  });
});

describe('node edits', () => {
  it('deletes nodes and the wires that touched them, but never the Material node', () => {
    const graph = connectEdge(
      graphOf([texture('a'), output('o')]),
      { node: 'a', socket: 'rgb', side: 'output' },
      { node: 'o', socket: 'color', side: 'input' },
    );
    const next = deleteNodes(graph, ['a', 'o']);
    expect(next.nodes.map((node) => node.id)).toEqual(['o']);
    expect(next.edges).toHaveLength(0);
  });

  it('moves only the named nodes, and snaps to the 8px grid on request', () => {
    const graph = graphOf([texture('a', 0, 0), texture('b', 100, 0)]);
    const moved = moveNodes(graph, ['a'], 13, 5);
    expect(moved.nodes[0]).toMatchObject({ x: 13, y: 5 });
    expect(moved.nodes[1]).toMatchObject({ x: 100, y: 0 });
    expect(moveNodes(graph, ['a'], 13, 5, true).nodes[0]).toMatchObject({ x: 16, y: 8 });
  });

  it('snapToGrid rounds when snapping is off', () => {
    expect(snapToGrid(13.4, false)).toBe(13);
    expect(snapToGrid(13.4, true)).toBe(16);
  });

  it('duplicates a selection with fresh ids and its internal wires', () => {
    let graph = graphOf([texture('a'), multiply('m'), output('o')]);
    graph = connectEdge(graph, { node: 'a', socket: 'rgb', side: 'output' }, { node: 'm', socket: 'a', side: 'input' });
    graph = connectEdge(graph, { node: 'm', socket: 'out', side: 'output' }, { node: 'o', socket: 'color', side: 'input' });
    const result = duplicateNodes(graph, ['a', 'm']);
    expect(result.newIds).toHaveLength(2);
    expect(result.graph.nodes).toHaveLength(5);
    // The internal a -> m wire is copied; the m -> output wire is not.
    expect(result.graph.edges).toHaveLength(3);
    expect(new Set(result.graph.nodes.map((node) => node.id)).size).toBe(5);
  });

  it('never duplicates the Material node', () => {
    const graph = graphOf([output('o')]);
    expect(duplicateNodes(graph, ['o']).newIds).toEqual([]);
  });

  it('round-trips a selection through the clipboard', () => {
    let graph = graphOf([texture('a', 40, 60), multiply('m', 240, 60), output('o')]);
    graph = connectEdge(graph, { node: 'a', socket: 'rgb', side: 'output' }, { node: 'm', socket: 'a', side: 'input' });
    const clipboard = copyNodes(graph, ['a', 'm']);
    // Positions are stored relative to the selection's top-left.
    expect(clipboard.nodes[0]).toMatchObject({ x: 0, y: 0 });
    const parsed = parseClipboard(JSON.stringify(clipboard));
    expect(parsed).not.toBeNull();
    const pasted = pasteNodes(graph, parsed!, 500, 500);
    expect(pasted.newIds).toHaveLength(2);
    expect(pasted.graph.nodes.find((node) => node.id === pasted.newIds[0])).toMatchObject({ x: 500, y: 500 });
    expect(pasted.graph.edges).toHaveLength(2);
  });

  it('rejects clipboard text that is not a shader graph', () => {
    expect(parseClipboard('not json')).toBeNull();
    expect(parseClipboard('{"kind":"something-else"}')).toBeNull();
  });

  it('creates each node type with usable defaults', () => {
    expect(createNode('texture', 1, 2)).toMatchObject({ type: 'texture', sampler: 0, texCoord: 0, x: 1, y: 2 });
    expect(createNode('scale', 0, 0)).toMatchObject({ scale: 2, bias: 0, clamp: true });
    expect(createNode('comment', 0, 0)).toMatchObject({ width: 240, height: 120 });
    expect(createNode('value', 0, 0)).toMatchObject({ value: 1 });
  });

  it('adds a node without touching the wires', () => {
    const graph = graphOf([output('o')]);
    const next = addNode(graph, texture('a'));
    expect(next.nodes).toHaveLength(2);
    expect(next.edges).toBe(graph.edges);
  });
});

describe('pan and zoom', () => {
  it('clamps zoom to 0.25x..2x', () => {
    const view = { panX: 0, panY: 0, zoom: 1 };
    expect(zoomAbout(view, 100, 0, 0).zoom).toBe(2);
    expect(zoomAbout(view, 0.001, 0, 0).zoom).toBe(0.25);
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const view = { panX: 10, panY: 20, zoom: 1 };
    const before = toGraphPoint(view, 300, 200);
    const after = zoomAbout(view, 1.5, 300, 200);
    const point = toGraphPoint(after, 300, 200);
    expect(point.x).toBeCloseTo(before.x, 6);
    expect(point.y).toBeCloseTo(before.y, 6);
  });

  it('round-trips graph and screen coordinates', () => {
    const view = { panX: -30, panY: 40, zoom: 0.75 };
    const screen = toScreenPoint(view, 120, 200);
    const graph = toGraphPoint(view, screen.x, screen.y);
    expect(graph.x).toBeCloseTo(120, 6);
    expect(graph.y).toBeCloseTo(200, 6);
  });

  it('fits the whole graph into the surface', () => {
    const graph = graphOf([texture('a', 0, 0), texture('b', 2000, 800)]);
    const bounds = graphBounds(graph)!;
    const view = fitView(bounds, 800, 400);
    expect(view.zoom).toBeLessThan(1);
    expect(view.zoom).toBeGreaterThanOrEqual(0.25);
    // The centre of the bounds ends up at the centre of the surface.
    const centre = toScreenPoint(view, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    expect(centre.x).toBeCloseTo(400, 4);
    expect(centre.y).toBeCloseTo(200, 4);
  });

  it('has no bounds for an empty graph', () => {
    expect(graphBounds(graphOf([]))).toBeNull();
  });
});

describe('auto layout', () => {
  it('puts a source in the column just left of what it feeds, not back at the far left', () => {
    // `late` feeds the last node in the chain, so it belongs beside it rather than beside `early`.
    let graph = graphOf([texture('early'), texture('late'), multiply('m1'), multiply('m2'), output('o')]);
    graph = connectEdge(graph, { node: 'early', socket: 'rgb', side: 'output' }, { node: 'm1', socket: 'a', side: 'input' });
    graph = connectEdge(graph, { node: 'm1', socket: 'out', side: 'output' }, { node: 'm2', socket: 'a', side: 'input' });
    graph = connectEdge(graph, { node: 'late', socket: 'rgb', side: 'output' }, { node: 'm2', socket: 'b', side: 'input' });
    graph = connectEdge(graph, { node: 'm2', socket: 'out', side: 'output' }, { node: 'o', socket: 'color', side: 'input' });
    const laid = autoLayout(graph);
    const x = (id: string) => laid.nodes.find((node) => node.id === id)!.x;
    expect(x('early')).toBeLessThan(x('late'));
    expect(x('late')).toBe(x('m1'));
    expect(x('m2')).toBeGreaterThan(x('late'));
    expect(x('o')).toBeGreaterThan(x('m2'));
  });

  it('puts a node one column right of its deepest input, with the Material node last', () => {
    let graph = graphOf([texture('a', 900, 900), multiply('m', 0, 0), output('o', 10, 10)]);
    graph = connectEdge(graph, { node: 'a', socket: 'rgb', side: 'output' }, { node: 'm', socket: 'a', side: 'input' });
    graph = connectEdge(graph, { node: 'm', socket: 'out', side: 'output' }, { node: 'o', socket: 'color', side: 'input' });
    const laid = autoLayout(graph);
    const x = (id: string) => laid.nodes.find((node) => node.id === id)!.x;
    expect(x('a')).toBe(0);
    expect(x('m')).toBeGreaterThan(x('a'));
    expect(x('o')).toBeGreaterThan(x('m'));
  });

  it('leaves comments where the author put them', () => {
    const comment: EditorGraphNode = { id: 'c', type: 'comment', x: 777, y: 333, width: 200, height: 100, text: 'note' };
    const laid = autoLayout(graphOf([comment, output('o')]));
    expect(laid.nodes.find((node) => node.id === 'c')).toMatchObject({ x: 777, y: 333 });
  });

  it('survives a graph with a cycle rather than recursing for ever', () => {
    const graph = graphOf(
      [multiply('m1'), multiply('m2')],
      [
        { id: 'e1', from: { node: 'm1', socket: 'out' }, to: { node: 'm2', socket: 'a' } },
        { id: 'e2', from: { node: 'm2', socket: 'out' }, to: { node: 'm1', socket: 'a' } },
      ],
    );
    expect(() => autoLayout(graph)).not.toThrow();
  });
});

describe('raw stages', () => {
  it('gives an unknown node type a read-only spec instead of throwing', () => {
    const spec = nodeSpec('rawStage');
    expect(spec.title).toBe('Raw stage');
    expect(spec.inputs).toHaveLength(0);
    expect(spec.outputs.map((socket) => socket.name)).toEqual(['out', 'alpha']);
  });
});
