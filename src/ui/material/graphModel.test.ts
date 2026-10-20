import { describe, expect, it } from 'vitest';
import {
  ADDABLE_NODE_TYPES,
  NODE_SUMMARY,
  PALETTE_GROUPS,
  addNode,
  autoLayout,
  canConnect,
  compatibleNodeTypes,
  connectEdge,
  connectedSockets,
  copyNodes,
  createNode,
  deleteNodes,
  duplicateNodes,
  edgesTouching,
  fitView,
  fitViewReadable,
  READABLE_ZOOM,
  graphBounds,
  inlineValue,
  marqueeRect,
  measureCard,
  moveNodes,
  nodeAtPoint,
  countRawStages,
  nodeCaption,
  nodeSize,
  nodeSpec,
  nodeTitle,
  nodeTypeTitle,
  nodesInMarquee,
  parseClipboard,
  pasteNodes,
  removeEdges,
  resolvedMathType,
  setInputValue,
  snapToGrid,
  socketPosition,
  socketType,
  toGraphPoint,
  toScreenPoint,
  wheelGesture,
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

  it('never opens a big graph below a readable zoom, centred on the output node', () => {
    const graph = graphOf([texture('a', 0, 0), texture('b', 4000, 1600)]);
    const bounds = graphBounds(graph)!;
    const focus = graphBounds(graph, ['b'])!;
    expect(fitView(bounds, 800, 400, 48, 1).zoom).toBeLessThan(READABLE_ZOOM);
    const view = fitViewReadable(bounds, focus, 800, 400, 48, 1);
    expect(view.zoom).toBe(READABLE_ZOOM);
    const centre = toScreenPoint(view, focus.x + focus.width / 2, focus.y + focus.height / 2);
    expect(centre.x).toBeCloseTo(400, 4);
    expect(centre.y).toBeCloseTo(200, 4);
    // A graph that fits comfortably is framed exactly as before.
    const small = graphBounds(graphOf([texture('a', 0, 0), texture('b', 300, 100)]))!;
    expect(fitViewReadable(small, null, 1600, 900, 48, 1)).toEqual(fitView(small, 1600, 900, 48, 1));
  });

  it('has no bounds for an empty graph', () => {
    expect(graphBounds(graphOf([]))).toBeNull();
  });

  it('frames just the selection, without blowing one small node up past 100%', () => {
    const graph = graphOf([texture('a', 0, 0), texture('b', 2000, 800)]);
    const bounds = graphBounds(graph, ['b'])!;
    expect(bounds.x).toBe(2000);
    expect(bounds.width).toBe(nodeSize(graph.nodes[1]).width);
    expect(graphBounds(graph, ['nobody'])).toBeNull();
    expect(fitView(bounds, 1600, 900, 48, 1).zoom).toBe(1);
  });
});

describe('auto layout', () => {
  it('measures each card exactly as it is drawn, pins included', () => {
    const size = measureCard(multiply('m'));
    expect(size.width).toBe(nodeSize(multiply('m')).width);
    expect(size.inputs?.b! - size.inputs?.a!).toBe(20);
    expect(size.outputs?.out).toBe(socketPosition(multiply('m', 0, 0), 'out', 'output')!.y);
    expect(measureCard(output('o')).width).toBeGreaterThan(size.width);
  });

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

describe('inline values', () => {
  it('lets a step input hold a value, and nothing else', () => {
    expect(inlineValue(multiply('m'), 'a')).toBe(1);
    // A texture's coordinates mean nothing without a wire, and an unwired Material input means
    // "this half computes nothing" rather than a constant.
    expect(inlineValue(texture('t'), 'uv')).toBeNull();
    expect(inlineValue(output('o'), 'alpha')).toBeNull();
  });

  it('reads the inline value, falling back to the socket default', () => {
    const lerp: EditorGraphNode = { id: 'l', type: 'lerp', x: 0, y: 0 };
    expect(inlineValue(lerp, 't')).toBe(0.5);
    const graph = setInputValue(graphOf([lerp]), 'l', 't', 1);
    expect(inlineValue(graph.nodes[0], 't')).toBe(1);
    expect(graph.nodes[0].inputValues).toEqual({ t: 1 });
    // Setting it back to the default leaves no entry behind.
    expect(setInputValue(graph, 'l', 't', 0.5).nodes[0].inputValues).toBeUndefined();
    // The other inputs are untouched and still read their defaults.
    expect(inlineValue(graph.nodes[0], 'a')).toBe(0);
  });

  it('reports which sockets have wires, so a card can draw its pins filled', () => {
    const graph = connectEdge(graphOf([texture('a'), output('o')]), { node: 'a', socket: 'rgb', side: 'output' }, { node: 'o', socket: 'color', side: 'input' });
    const wired = connectedSockets(graph);
    expect(wired.has('a|rgb|output')).toBe(true);
    expect(wired.has('o|color|input')).toBe(true);
    expect(wired.has('o|alpha|input')).toBe(false);
    expect(edgesTouching(graph, ['o'])).toHaveLength(1);
    expect(edgesTouching(graph, ['nobody'])).toHaveLength(0);
  });
});

describe('the wheel', () => {
  const event = (deltaY: number, extra: Partial<{ deltaX: number; deltaMode: number; ctrlKey: boolean }> = {}) =>
    ({ deltaX: 0, deltaMode: 0, ctrlKey: false, deltaY, ...extra });

  it('zooms on a mouse wheel notch, in towards the cursor for a notch up', () => {
    const up = wheelGesture(event(-100));
    const down = wheelGesture(event(120));
    expect(up.kind).toBe('zoom');
    expect(down.kind).toBe('zoom');
    expect(up.kind === 'zoom' && up.factor).toBeGreaterThan(1);
    expect(down.kind === 'zoom' && down.factor).toBeLessThan(1);
    expect(wheelGesture(event(3, { deltaMode: 1 })).kind).toBe('zoom');
  });

  it('pans on a trackpad two-finger scroll', () => {
    expect(wheelGesture(event(4.5))).toEqual({ kind: 'pan', dx: 0, dy: 4.5 });
    expect(wheelGesture(event(12, { deltaX: 30 }))).toEqual({ kind: 'pan', dx: 30, dy: 12 });
    // A trackpad's occasional big integer stays a pan while the gesture is still going.
    expect(wheelGesture(event(100), true).kind).toBe('pan');
  });

  it('zooms on a pinch, which arrives as a ctrl+wheel, without jumping on a ctrl+wheel notch', () => {
    const pinch = wheelGesture(event(-6, { ctrlKey: true }));
    expect(pinch.kind === 'zoom' && pinch.factor).toBeGreaterThan(1);
    const notch = wheelGesture(event(100, { ctrlKey: true }));
    expect(notch.kind === 'zoom' && notch.factor).toBeGreaterThanOrEqual(0.8);
  });
});

describe('raw stages', () => {
  it('has ordering-only inputs, one per pipeline, and both outputs', () => {
    const spec = nodeSpec('rawStage');
    expect(spec.title).toBe('Raw stage');
    expect(spec.inputs.map((socket) => socket.name)).toEqual(['prev', 'prevAlpha']);
    expect(spec.outputs.map((socket) => socket.name)).toEqual(['out', 'alpha']);
  });

  it('cannot be added by hand — it only ever comes from the decompiler', () => {
    expect(ADDABLE_NODE_TYPES).not.toContain('rawStage');
    expect(() => createNode('rawStage', 0, 0)).toThrow();
  });

  it('falls back rather than throwing on a node type this build does not know', () => {
    const spec = nodeSpec('somethingNewer' as never);
    expect(spec.inputs).toHaveLength(0);
    expect(spec.outputs).toHaveLength(0);
  });
});

describe('stage templates', () => {
  it('carries a node stage template through duplicate and paste', () => {
    const stageTemplate = { texMap: 3 } as never;
    const graph = graphOf([{ ...texture('t'), stageTemplate }, output('o')]);
    const duplicated = duplicateNodes(graph, ['t']);
    expect(duplicated.graph.nodes.find((node) => node.id === duplicated.newIds[0])).toHaveProperty('stageTemplate', stageTemplate);
    const pasted = pasteNodes(graph, copyNodes(graph, ['t']), 0, 0);
    expect(pasted.graph.nodes.find((node) => node.id === pasted.newIds[0])).toHaveProperty('stageTemplate', stageTemplate);
  });
});

describe('the new nodes', () => {
  it('offers them in the palette, with the hardware ones under Advanced', () => {
    expect(ADDABLE_NODE_TYPES).toContain('alphaAsColor');
    expect(ADDABLE_NODE_TYPES).toContain('storedValue');
    const groupOf = (type: string) => PALETTE_GROUPS.find((group) => group.types.includes(type as never))?.title;
    for (const type of ['alphaAsColor', 'storedValue', 'compare', 'indirectWarp']) expect(groupOf(type)).toBe('Advanced');
    // The everyday half stays the everyday half.
    for (const type of ['texture', 'vertexColor', 'constant']) expect(groupOf(type)).toBe('Inputs');
    for (const type of ['multiply', 'lerp', 'scale']) expect(groupOf(type)).toBe('Maths');
    // Every addable type is under exactly one heading, and the two that cannot be added are under none.
    expect(new Set(ADDABLE_NODE_TYPES).size).toBe(ADDABLE_NODE_TYPES.length);
    expect(ADDABLE_NODE_TYPES).not.toContain('output');
    expect(ADDABLE_NODE_TYPES).not.toContain('rawStage');
  });

  it('names them in words, and explains each in one line', () => {
    expect(nodeTypeTitle('alphaAsColor')).toBe('Alpha as colour');
    expect(nodeTypeTitle('storedValue')).toBe('Stored value');
    expect(nodeTitle({ id: 's', type: 'storedValue', slot: 'prev', x: 0, y: 0 })).toBe('Working slot');
    expect(nodeTitle({ id: 's', type: 'storedValue', slot: 1, x: 0, y: 0 })).toBe('Stored slot 2');
    for (const type of ADDABLE_NODE_TYPES) {
      expect(NODE_SUMMARY[type].length).toBeGreaterThan(20);
      for (const jargon of ['TEV', 'TEXMAP', 'KONST', 'CPREV', 'RASA']) expect(NODE_SUMMARY[type]).not.toContain(jargon);
    }
  });

  it('names a vertex colour after the source it rasterises', () => {
    expect(nodeTitle({ id: 'v', type: 'vertexColor', channel: 0, x: 0, y: 0 })).toBe('Vertex colour 1');
    expect(nodeTitle({ id: 'v', type: 'vertexColor', channel: 5, x: 0, y: 0 })).toBe('Bump alpha');
    expect(nodeTitle({ id: 'v', type: 'vertexColor', channel: 7, x: 0, y: 0 })).toBe('Nothing (black)');
    expect(nodeCaption({ id: 'v', type: 'vertexColor', channel: 0, x: 0, y: 0 }, null)).toBeNull();
  });

  it('starts a new one on the sensible default', () => {
    expect(createNode('storedValue', 0, 0)).toMatchObject({ type: 'storedValue', slot: 'prev' });
    expect(createNode('alphaAsColor', 0, 0)).toMatchObject({ type: 'alphaAsColor' });
  });

  it('takes an alpha wire and gives a colour one', () => {
    const graph = graphOf(
      [
        { id: 't', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 'aac', type: 'alphaAsColor', x: 200, y: 0 },
        multiply('m'),
      ],
    );
    expect(canConnect(graph, { node: 't', socket: 'alpha', side: 'output' }, { node: 'aac', socket: 'alpha', side: 'input' }).ok).toBe(true);
    // A colour cannot go in: the hardware has no operand for it, so neither does the socket.
    expect(canConnect(graph, { node: 't', socket: 'rgb', side: 'output' }, { node: 'aac', socket: 'alpha', side: 'input' }).ok).toBe(false);
    const wired = connectEdge(graph, { node: 'aac', socket: 'rgb', side: 'output' }, { node: 'm', socket: 'a', side: 'input' });
    expect(socketType(wired, 'm', 'out', 'output')).toBe('rgb');
  });
});

describe('graphs saved by an older build', () => {
  // The node model gained only optional fields, so the stored version stays 1 and a graph written
  // before any of this loads unchanged. What does change is that some of its read-only cards are
  // now expressible, which is what `countRawStages` is compared against on load.
  const legacy: EditorShaderGraph = JSON.parse(JSON.stringify({
    version: 1,
    nodes: [
      { id: 'src0', type: 'texture', sampler: 0, texCoord: 0, x: -260, y: 0 },
      { id: 'src1', type: 'vertexColor', channel: 1, x: -260, y: 90 },
      { id: 's0c', type: 'add', x: 0, y: 0, stageTemplate: { texMap: 0 } },
      { id: 's1r', type: 'rawStage', x: 260, y: 0, stage: { texMap: 1 } },
      { id: 'out', type: 'output', x: 520, y: 180 },
    ],
    edges: [
      { id: 'e0', from: { node: 'src0', socket: 'rgb' }, to: { node: 's0c', socket: 'a' } },
      { id: 'e1', from: { node: 's0c', socket: 'out' }, to: { node: 's1r', socket: 'prev' } },
      { id: 'e2', from: { node: 's1r', socket: 'out' }, to: { node: 'out', socket: 'color' } },
    ],
  }));

  it('still loads: every node type and socket it names still exists', () => {
    expect(legacy.version).toBe(1);
    for (const node of legacy.nodes) expect(nodeSpec(node.type).title).not.toBe('Unknown node');
    for (const edge of legacy.edges) {
      const from = legacy.nodes.find((node) => node.id === edge.from.node)!;
      const to = legacy.nodes.find((node) => node.id === edge.to.node)!;
      expect(nodeSpec(from.type).outputs.some((socket) => socket.name === edge.from.socket)).toBe(true);
      expect(nodeSpec(to.type).inputs.some((socket) => socket.name === edge.to.socket)).toBe(true);
    }
    // A `vertexColor` saved as channel 1 still means the second lighting channel.
    expect(nodeTitle(legacy.nodes[1])).toBe('Vertex colour 2');
  });

  it('counts its read-only cards, which is what decides whether re-reading gains anything', () => {
    expect(countRawStages(legacy)).toBe(1);
    expect(countRawStages(graphOf([output('o')]))).toBe(0);
    expect(countRawStages(null)).toBe(0);
  });

  it('survives every edit the editor makes, so the layout is not lost on the way', () => {
    const moved = moveNodes(legacy, ['s1r'], 10, 10);
    expect(moved.nodes.find((node) => node.id === 's1r')).toMatchObject({ x: 270, y: 10 });
    const pasted = pasteNodes(legacy, copyNodes(legacy, ['s0c']), 0, 0);
    expect(pasted.graph.nodes.find((node) => node.id === pasted.newIds[0])).toHaveProperty('stageTemplate');
  });
});

describe('what a node is called', () => {
  it('folds the slot into the title, so the card says which one', () => {
    expect(nodeTitle({ ...texture('t'), sampler: 1 })).toBe('Texture 2');
    expect(nodeTitle({ id: 'k', type: 'constant', slot: 2, x: 0, y: 0 })).toBe('Colour 3');
    expect(nodeTitle({ id: 'r', type: 'register', slot: 0, x: 0, y: 0 })).toBe('Start colour 1');
  });

  it('never says a hardware name', () => {
    const titles = [...ADDABLE_NODE_TYPES, 'output', 'rawStage'].map((type) => nodeTypeTitle(type as never));
    for (const title of titles) {
      for (const jargon of ['TEV', 'TEXMAP', 'KONST', 'RAS', 'konst', 'Raw']) expect(title).not.toContain(jargon);
    }
    expect(nodeTypeTitle('vertexColor')).toBe('Vertex colour');
    expect(nodeTypeTitle('rawStage')).toBe('Special step');
  });

  it('captions a texture node with the image it reads', () => {
    const doc = { samplers: [{ texture: 'road_tex' }, { texture: '' }] } as never;
    expect(nodeCaption({ ...texture('t'), sampler: 0 }, doc)).toBe('road_tex');
    expect(nodeCaption({ ...texture('t'), sampler: 1 }, doc)).toBe('no image');
    expect(nodeCaption({ ...texture('t'), sampler: 0 }, null)).toBe('no image');
  });

  it('has no caption for a node that needs none', () => {
    expect(nodeCaption(output('o'), null)).toBeNull();
    expect(nodeCaption(multiply('m'), null)).toBeNull();
  });
});
