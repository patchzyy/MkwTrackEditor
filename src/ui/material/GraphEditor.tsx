import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { CompiledShader, GraphDiagnostic, GxMaterialDoc } from '../../lib/gxMaterial';
import type { VisualTextureInfo } from '../visual/visualArchive';
import { GraphNodeCard } from './GraphNodeCard';
import {
  ADDABLE_NODE_TYPES,
  addNode,
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
  nodePaletteSection,
  nodeSpec,
  nodeTypeTitle,
  nodesInMarquee,
  parseClipboard,
  pasteNodes,
  patchNode,
  removeEdges,
  socketPosition,
  toGraphPoint,
  wireAtPoint,
  wirePath,
  zoomAbout,
  NODE_SUMMARY,
  type EditorGraphNode,
  type EditorGraphNodeType,
  type EditorShaderGraph,
  type SocketRef,
  type Viewport,
} from './graphModel';
import type { MaterialDocChange } from './MaterialInspector';

export interface GraphEditorProps {
  graph: EditorShaderGraph;
  doc: GxMaterialDoc | null;
  compiled: CompiledShader | null;
  textures: VisualTextureInfo[];
  archivePath: string;
  archiveBytes: Uint8Array | null;
  onChangeGraph: (graph: EditorShaderGraph, options?: { record?: boolean; undoFrom?: EditorShaderGraph }) => void;
  onChangeDoc: MaterialDocChange;
  onUndo: () => void;
  onRedo: () => void;
  /** Re-reads the material's steps and replaces the graph. Offered on every "Special step" card. */
  onConvertRawStages?: () => void;
  /** True when a fresh read of the material's steps would leave no "Special step" behind. */
  rawStagesConvertible?: boolean;
  /** Bumped by the toolbar's fit button. */
  fitRequest: number;
}

type Drag =
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | { kind: 'node'; ids: string[]; lastX: number; lastY: number; moved: boolean; before: EditorShaderGraph }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; additive: boolean }
  | { kind: 'wire'; from: SocketRef; x: number; y: number };

interface PaletteState {
  screenX: number;
  screenY: number;
  graphX: number;
  graphY: number;
  from: SocketRef | null;
  types: EditorGraphNodeType[];
}

/**
 * The node editor. SVG for the wires, absolutely positioned DOM for the nodes, one transformed
 * layer for pan and zoom — no graph library, because everything a node can be is fixed by the GX
 * TEV and a general-purpose one would only get in the way.
 *
 * Pan: middle-drag, space+drag, or two-finger scroll. Zoom: wheel about the cursor, 0.25x..2x.
 * All the maths lives in `graphModel.ts`; this component is the pointer and keyboard shell.
 */
export function GraphEditor({
  graph,
  doc,
  compiled,
  textures,
  archivePath,
  archiveBytes,
  onChangeGraph,
  onChangeDoc,
  onUndo,
  onRedo,
  onConvertRawStages,
  rawStagesConvertible,
  fitRequest,
}: GraphEditorProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<Viewport>({ panX: -80, panY: -160, zoom: 1 });
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [shakeNode, setShakeNode] = useState<string | null>(null);
  const [rejectMessage, setRejectMessage] = useState<string | null>(null);
  const spaceRef = useRef(false);
  const clipboardRef = useRef<string | null>(null);

  const graphRef = useRef(graph);
  graphRef.current = graph;
  const viewRef = useRef(view);
  viewRef.current = view;

  const diagnosticsByNode = useMemo(() => {
    const map = new Map<string, GraphDiagnostic[]>();
    for (const diagnostic of compiled?.diagnostics ?? []) {
      if (!diagnostic.nodeId) continue;
      map.set(diagnostic.nodeId, [...(map.get(diagnostic.nodeId) ?? []), diagnostic]);
    }
    return map;
  }, [compiled]);
  const diagnosticEdges = useMemo(
    () => new Set((compiled?.diagnostics ?? []).map((diagnostic) => diagnostic.edgeId).filter(Boolean) as string[]),
    [compiled],
  );

  const fit = useCallback(() => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    setView(fitView(graphBounds(graphRef.current), rect.width, rect.height));
  }, []);

  useEffect(() => {
    if (fitRequest === 0) return;
    fit();
  }, [fit, fitRequest]);

  // A newly opened material starts framed rather than wherever the last one was left.
  const graphIdentity = graph.nodes.length > 0 ? graph.nodes[0].id : '';
  useEffect(() => {
    const timer = window.setTimeout(fit, 30);
    return () => window.clearTimeout(timer);
  }, [fit, graphIdentity]);

  useEffect(() => {
    // Space is the graph's pan modifier, but it is also the playtest's drift button, so the
    // listener stands down while a race is running.
    const playtesting = () => document.documentElement.dataset.playtest === 'active';
    const down = (event: KeyboardEvent) => { if (event.code === 'Space' && !playtesting()) spaceRef.current = true; };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') spaceRef.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    if (!rejectMessage) return;
    const timer = window.setTimeout(() => setRejectMessage(null), 2200);
    return () => window.clearTimeout(timer);
  }, [rejectMessage]);

  const pointToGraph = useCallback((clientX: number, clientY: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return toGraphPoint(viewRef.current, clientX - rect.left, clientY - rect.top);
  }, []);

  // ------------------------------------------------------------------ dragging

  useEffect(() => {
    if (!drag) return;

    const move = (event: PointerEvent) => {
      if (drag.kind === 'pan') {
        setView((current) => ({
          ...current,
          panX: drag.panX - (event.clientX - drag.startX) / current.zoom,
          panY: drag.panY - (event.clientY - drag.startY) / current.zoom,
        }));
        return;
      }
      const point = pointToGraph(event.clientX, event.clientY);
      if (drag.kind === 'node') {
        const snap = event.ctrlKey || event.metaKey;
        const dx = point.x - drag.lastX;
        const dy = point.y - drag.lastY;
        if (dx === 0 && dy === 0) return;
        onChangeGraph(moveNodes(graphRef.current, drag.ids, dx, dy, snap), { record: false });
        setDrag({ ...drag, lastX: point.x, lastY: point.y, moved: true });
        return;
      }
      if (drag.kind === 'marquee') {
        setDrag({ ...drag, x1: point.x, y1: point.y });
        return;
      }
      setDrag({ ...drag, x: point.x, y: point.y });
    };

    const up = (event: PointerEvent) => {
      if (drag.kind === 'marquee') {
        const rect = marqueeRect(drag.x0, drag.y0, drag.x1, drag.y1);
        const hits = nodesInMarquee(graphRef.current, rect);
        setSelectedNodes(drag.additive ? [...new Set([...selectedNodes, ...hits])] : hits);
        setSelectedEdges([]);
      } else if (drag.kind === 'node' && drag.moved) {
        // The whole drag coalesces into one graph-history entry: the moves themselves were not
        // recorded, and the release records the pre-drag graph as the step to come back to.
        onChangeGraph(graphRef.current, { record: true, undoFrom: drag.before });
      } else if (drag.kind === 'wire') {
        finishWire(drag.from, event.clientX, event.clientY);
      }
      setDrag(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, onChangeGraph, pointToGraph, selectedNodes]);

  const finishWire = useCallback(
    (from: SocketRef, clientX: number, clientY: number) => {
      const target = document.elementFromPoint(clientX, clientY)?.closest('[data-socket]') as HTMLElement | null;
      if (!target) {
        // Released over nothing: offer the nodes that could legally be wired here.
        const point = pointToGraph(clientX, clientY);
        const rect = surfaceRef.current?.getBoundingClientRect();
        setPaletteQuery('');
        setPalette({
          screenX: rect ? clientX - rect.left : 0,
          screenY: rect ? clientY - rect.top : 0,
          graphX: point.x,
          graphY: point.y,
          from,
          types: compatibleNodeTypes(graphRef.current, from),
        });
        return;
      }
      const [nodeId, socket, side] = (target.dataset.socket ?? '').split('|');
      if (!nodeId || side === from.side) return;
      const to: SocketRef = { node: nodeId, socket, side: side as 'input' | 'output' };
      const [output, input] = from.side === 'output' ? [from, to] : [to, from];
      const verdict = canConnect(graphRef.current, output, input);
      if (!verdict.ok) {
        setShakeNode(input.node);
        setRejectMessage(verdict.reason ?? 'Those sockets cannot be connected.');
        window.setTimeout(() => setShakeNode(null), 400);
        return;
      }
      onChangeGraph(connectEdge(graphRef.current, output, input));
    },
    [onChangeGraph, pointToGraph],
  );

  // ------------------------------------------------------------------ pointer entry points

  const onSurfacePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button === 2) return;
      surfaceRef.current?.focus();
      setPalette(null);
      if (event.button === 1 || spaceRef.current) {
        event.preventDefault();
        setDrag({ kind: 'pan', startX: event.clientX, startY: event.clientY, panX: view.panX, panY: view.panY });
        return;
      }
      const point = pointToGraph(event.clientX, event.clientY);
      const wire = wireAtPoint(graph, point.x, point.y, 8 / view.zoom);
      if (wire) {
        setSelectedEdges([wire.id]);
        setSelectedNodes([]);
        return;
      }
      if (!event.shiftKey) {
        setSelectedNodes([]);
        setSelectedEdges([]);
      }
      setDrag({ kind: 'marquee', x0: point.x, y0: point.y, x1: point.x, y1: point.y, additive: event.shiftKey });
    },
    [graph, pointToGraph, view.panX, view.panY, view.zoom],
  );

  const onPointerDownNode = useCallback(
    (event: ReactPointerEvent<HTMLElement>, nodeId: string) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      surfaceRef.current?.focus();
      setPalette(null);
      const next = event.shiftKey
        ? selectedNodes.includes(nodeId)
          ? selectedNodes.filter((id) => id !== nodeId)
          : [...selectedNodes, nodeId]
        : selectedNodes.includes(nodeId)
          ? selectedNodes
          : [nodeId];
      setSelectedNodes(next);
      setSelectedEdges([]);
      const point = pointToGraph(event.clientX, event.clientY);
      setDrag({ kind: 'node', ids: next.length > 0 ? next : [nodeId], lastX: point.x, lastY: point.y, moved: false, before: graphRef.current });
    },
    [pointToGraph, selectedNodes],
  );

  const onPointerDownSocket = useCallback(
    (event: ReactPointerEvent<HTMLElement>, nodeId: string, socket: string, side: 'input' | 'output') => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      surfaceRef.current?.focus();
      const point = pointToGraph(event.clientX, event.clientY);
      setDrag({ kind: 'wire', from: { node: nodeId, socket, side }, x: point.x, y: point.y });
    },
    [pointToGraph],
  );

  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Two-finger scroll pans; a wheel (or ctrl+scroll) zooms about the cursor.
    if (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      setView((current) => ({ ...current, panX: current.panX + event.deltaX / current.zoom, panY: current.panY + event.deltaY / current.zoom }));
      return;
    }
    setView((current) => zoomAbout(current, event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - rect.left, event.clientY - rect.top));
  }, []);

  // ------------------------------------------------------------------ palette

  const openPalette = useCallback(
    (clientX: number, clientY: number) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      const point = pointToGraph(clientX, clientY);
      setPaletteQuery('');
      setPalette({
        screenX: rect ? clientX - rect.left : 0,
        screenY: rect ? clientY - rect.top : 0,
        graphX: point.x,
        graphY: point.y,
        from: null,
        types: ADDABLE_NODE_TYPES,
      });
    },
    [pointToGraph],
  );

  const addFromPalette = useCallback(
    (type: EditorGraphNodeType) => {
      if (!palette) return;
      const node = createNode(type, palette.graphX, palette.graphY);
      let next = addNode(graphRef.current, node);
      if (palette.from) {
        const spec = nodeSpec(type);
        const list = palette.from.side === 'output' ? spec.inputs : spec.outputs;
        for (const socket of list) {
          const other: SocketRef = { node: node.id, socket: socket.name, side: palette.from.side === 'output' ? 'input' : 'output' };
          const [output, input] = palette.from.side === 'output' ? [palette.from, other] : [other, palette.from];
          if (!canConnect(next, output, input).ok) continue;
          next = connectEdge(next, output, input);
          break;
        }
      }
      onChangeGraph(next);
      setSelectedNodes([node.id]);
      setPalette(null);
    },
    [onChangeGraph, palette],
  );

  // ------------------------------------------------------------------ keyboard

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      const ctrl = event.ctrlKey || event.metaKey;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        let next = graph;
        if (selectedEdges.length > 0) next = removeEdges(next, selectedEdges);
        if (selectedNodes.length > 0) next = deleteNodes(next, selectedNodes);
        if (next !== graph) onChangeGraph(next);
        setSelectedNodes([]);
        setSelectedEdges([]);
        return;
      }
      if (ctrl && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        const result = duplicateNodes(graph, selectedNodes);
        if (result.newIds.length > 0) {
          onChangeGraph(result.graph);
          setSelectedNodes(result.newIds);
        }
        return;
      }
      if (ctrl && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        onUndo();
        return;
      }
      if (ctrl && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
        event.preventDefault();
        onRedo();
        return;
      }
      if (ctrl && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelectedNodes(graph.nodes.map((node) => node.id));
        return;
      }
      if (event.key === 'Escape') {
        setPalette(null);
        setSelectedNodes([]);
        setSelectedEdges([]);
      }
    },
    [graph, onChangeGraph, onRedo, onUndo, selectedEdges, selectedNodes],
  );

  const onCopy = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (selectedNodes.length === 0) return;
      const payload = JSON.stringify(copyNodes(graph, selectedNodes));
      clipboardRef.current = payload;
      event.clipboardData.setData('text/plain', payload);
      event.preventDefault();
    },
    [graph, selectedNodes],
  );

  const onPaste = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      const text = event.clipboardData.getData('text/plain') || clipboardRef.current || '';
      const clipboard = parseClipboard(text);
      if (!clipboard) return;
      event.preventDefault();
      const result = pasteNodes(graph, clipboard, view.panX + 60, view.panY + 60);
      onChangeGraph(result.graph);
      setSelectedNodes(result.newIds);
    },
    [graph, onChangeGraph, view.panX, view.panY],
  );

  // ------------------------------------------------------------------ render

  const wires = graph.edges.flatMap((edge) => {
    const fromNode = graph.nodes.find((node) => node.id === edge.from.node);
    const toNode = graph.nodes.find((node) => node.id === edge.to.node);
    if (!fromNode || !toNode) return [];
    const start = socketPosition(fromNode, edge.from.socket, 'output');
    const end = socketPosition(toNode, edge.to.socket, 'input');
    if (!start || !end) return [];
    return [{ edge, start, end }];
  });

  const dragWire = drag?.kind === 'wire'
    ? (() => {
        const node = graph.nodes.find((entry) => entry.id === drag.from.node);
        if (!node) return null;
        const anchor = socketPosition(node, drag.from.socket, drag.from.side);
        if (!anchor) return null;
        return drag.from.side === 'output'
          ? { start: anchor, end: { x: drag.x, y: drag.y } }
          : { start: { x: drag.x, y: drag.y }, end: anchor };
      })()
    : null;

  const marquee = drag?.kind === 'marquee' ? marqueeRect(drag.x0, drag.y0, drag.x1, drag.y1) : null;
  const paletteTypes = (palette?.types ?? []).filter((type) =>
    paletteQuery.trim().length === 0 ||
    `${nodeTypeTitle(type)} ${NODE_SUMMARY[type]}`.toLowerCase().includes(paletteQuery.trim().toLowerCase()),
  );

  return (
    <div
      ref={surfaceRef}
      className="graphSurface"
      tabIndex={0}
      role="application"
      aria-label="Shader graph"
      // Read by `scripts/probe-material-ui.js`; also the zoom readout in the corner.
      data-zoom={view.zoom.toFixed(3)}
      title={`Zoom ${Math.round(view.zoom * 100)}%`}
      onPointerDown={onSurfacePointerDown}
      onDoubleClick={(event) => openPalette(event.clientX, event.clientY)}
      onContextMenu={(event) => {
        event.preventDefault();
        openPalette(event.clientX, event.clientY);
      }}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onPaste={onPaste}
    >
      <div
        className="graphViewport"
        style={{ transform: `translate(${-view.panX * view.zoom}px, ${-view.panY * view.zoom}px) scale(${view.zoom})` }}
      >
        <svg className="graphWires" width="1" height="1" aria-hidden="true">
          {wires.map(({ edge, start, end }) => (
            <path
              key={edge.id}
              className={[
                'graphWire',
                selectedEdges.includes(edge.id) && 'selected',
                diagnosticEdges.has(edge.id) && 'invalid',
              ].filter(Boolean).join(' ')}
              d={wirePath(start.x, start.y, end.x, end.y)}
            />
          ))}
          {dragWire && <path className="graphWire dragging" d={wirePath(dragWire.start.x, dragWire.start.y, dragWire.end.x, dragWire.end.y)} />}
        </svg>

        {marquee && (
          <div className="graphMarquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />
        )}

        {graph.nodes.map((node) => (
          <GraphNodeCard
            key={node.id}
            graph={graph}
            node={node}
            doc={doc}
            textures={textures}
            archivePath={archivePath}
            archiveBytes={archiveBytes}
            selected={selectedNodes.includes(node.id)}
            shake={shakeNode === node.id}
            diagnostics={diagnosticsByNode.get(node.id) ?? []}
            onPatch={(patch) => onChangeGraph(patchNode(graph, node.id, patch as Partial<EditorGraphNode>))}
            onChangeDoc={onChangeDoc}
            onConvertRawStages={onConvertRawStages}
            rawStagesConvertible={rawStagesConvertible}
            onPointerDownNode={onPointerDownNode}
            onPointerDownSocket={onPointerDownSocket}
          />
        ))}
      </div>

      <p className="graphZoom" aria-live="off">{Math.round(view.zoom * 100)}%</p>

      {rejectMessage && <p className="graphReject" role="status">{rejectMessage}</p>}

      {palette && (
        <div
          className="graphPalette"
          // Kept inside the surface: opened near the bottom or the right edge it would otherwise
          // hang off the dock, where the shell clips it.
          style={{
            left: Math.max(0, Math.min(palette.screenX, (surfaceRef.current?.clientWidth ?? 0) - 268)),
            top: Math.max(0, Math.min(palette.screenY, (surfaceRef.current?.clientHeight ?? 0) - 292)),
          }}
          role="dialog"
          aria-label="Add node"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <input
            autoFocus
            type="search"
            className="graphPaletteSearch"
            placeholder="Add node…"
            aria-label="Search node types"
            value={paletteQuery}
            onChange={(event) => setPaletteQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setPalette(null);
              if (event.key === 'Enter' && paletteTypes[0]) addFromPalette(paletteTypes[0]);
            }}
          />
          {/* Two sections, not one long list: what a material is normally made of, then the four
              that are the hardware showing through. Both are always visible — the heading is a
              signpost, not a disclosure, because hiding them is how a node nobody finds happens. */}
          <ul className="graphPaletteList">
            {paletteTypes.filter((type) => nodePaletteSection(type) === 'basic').map((type) => (
              <li key={type}>
                <button type="button" onClick={() => addFromPalette(type)}>
                  <strong>{nodeTypeTitle(type)}</strong>
                  <span>{NODE_SUMMARY[type]}</span>
                </button>
              </li>
            ))}
            {paletteTypes.some((type) => nodePaletteSection(type) === 'advanced') && (
              <li className="graphPaletteHeading" aria-hidden="true">Advanced</li>
            )}
            {paletteTypes.filter((type) => nodePaletteSection(type) === 'advanced').map((type) => (
              <li key={type}>
                <button type="button" onClick={() => addFromPalette(type)}>
                  <strong>{nodeTypeTitle(type)}</strong>
                  <span>{NODE_SUMMARY[type]}</span>
                </button>
              </li>
            ))}
            {paletteTypes.length === 0 && <li className="graphPaletteEmpty">No node matches that.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
