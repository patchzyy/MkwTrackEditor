import { Copy, CopyPlus, Focus, Trash2, Unlink } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { CompiledShader, GraphDiagnostic, GraphInlineValue, GxMaterialDoc } from '../../lib/gxMaterial';
import { ContextMenu, type MenuSection } from '../components';
import type { VisualTextureInfo } from '../visual/visualArchive';
import { GraphNodeCard } from './GraphNodeCard';
import {
  ADDABLE_NODE_TYPES,
  PALETTE_GROUPS,
  addNode,
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
  graphBounds,
  marqueeRect,
  moveNodes,
  nodeRect,
  nodeSpec,
  nodeTypeTitle,
  nodesInMarquee,
  parseClipboard,
  pasteNodes,
  patchNode,
  removeEdges,
  setInputValue,
  socketPosition,
  socketType,
  toGraphPoint,
  wheelGesture,
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
  /** Bumped by the toolbar's "frame all" button. */
  fitRequest: number;
  /**
   * Which material the graph belongs to. When it changes the selection is cleared and the new
   * graph is framed; edits to the same material keep both.
   */
  contextKey?: string;
  /** Called whenever the node selection changes, including clearing to `[]`. */
  onSelectionChange?: (nodeIds: string[]) => void;
  /** When `key` changes, selects `nodeIds` and frames them. */
  selectionRequest?: { nodeIds: string[]; key: number } | null;
  /** Offered in the empty-graph card next to "add a node", e.g. the preset menu. */
  emptyAction?: ReactNode;
}

type Drag =
  /** Right-, middle- or space-drag. A right press that never moves is a click: it opens a menu. */
  | { kind: 'pan'; button: number; startX: number; startY: number; panX: number; panY: number; nodeId: string | null }
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

interface MenuState {
  x: number;
  y: number;
  sections: MenuSection[];
}

/** How far a right press may wander and still count as a click that opens the menu. */
const CLICK_SLOP = 4;
/** After a trackpad-looking wheel event, how long the gesture is still treated as a trackpad. */
const TRACKPAD_MEMORY_MS = 400;

/**
 * Whether a wheel event belongs to something layered over the canvas — the add-node menu, a
 * text field, a dropdown, any scrolling list — rather than to the canvas itself. Such an event
 * must scroll that thing and never pan or zoom the graph underneath it.
 */
function wheelBelongsToOverlay(target: EventTarget | null, surface: HTMLElement): boolean {
  let element = target instanceof Element ? target : null;
  while (element && element !== surface) {
    if (element.matches('select, [role="menu"], [role="listbox"], [role="dialog"], [data-graph-overlay]')) return true;
    // A field being typed in keeps the wheel; a comment's text box sitting on the grid does not.
    if (element.matches('input, textarea') && element === document.activeElement) return true;
    if (element instanceof HTMLElement && element.scrollHeight > element.clientHeight + 1) {
      const overflow = getComputedStyle(element).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') return true;
    }
    element = element.parentElement;
  }
  return false;
}

/**
 * The node editor. SVG for the wires, absolutely positioned DOM for the nodes, one transformed
 * layer for pan and zoom — no graph library, because everything a node can be is fixed by the GX
 * TEV and a general-purpose one would only get in the way.
 *
 * Controls follow Unreal's material editor: right-drag (or middle-drag) pans, the wheel zooms
 * about the cursor, a trackpad's two-finger scroll pans and a pinch zooms, left-drag on the grid
 * is a marquee, and a right-click that does not move opens the add-node menu (or, on a node or a
 * wire, that thing's menu). F frames the selection, Home frames everything.
 *
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
  contextKey = '',
  onSelectionChange,
  selectionRequest,
  emptyAction,
}: GraphEditorProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<Viewport>({ panX: -80, panY: -160, zoom: 1 });
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [shakeNode, setShakeNode] = useState<string | null>(null);
  const [rejectMessage, setRejectMessage] = useState<string | null>(null);
  const spaceRef = useRef(false);
  const clipboardRef = useRef<string | null>(null);
  const panMovedRef = useRef(false);
  const trackpadUntilRef = useRef(0);
  /** Last pointer position over the grid, in graph space: where a paste lands. */
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

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
  const connected = useMemo(() => connectedSockets(graph), [graph]);

  // ------------------------------------------------------------------ framing

  /** Frames `ids`, or the whole graph. Never zooms past 100%: one small node should not fill the screen. */
  const frame = useCallback((ids?: readonly string[], readable = false) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const bounds = graphBounds(graphRef.current, ids && ids.length > 0 ? ids : undefined);
    if (readable) {
      // Opening a material: a big graph stays at a zoom the labels can be read at, centred on the
      // node the material ends in, instead of shrinking to a 25% overview nobody can use.
      const output = graphRef.current.nodes.find((node) => node.type === 'output');
      setView(fitViewReadable(bounds, output ? nodeRect(output) : null, rect.width, rect.height, 48, 1));
      return;
    }
    setView(fitView(bounds, rect.width, rect.height, 48, 1));
  }, []);

  useEffect(() => {
    if (fitRequest === 0) return;
    // A layout or a preset arrives in the same render as the request; wait for it to paint.
    const handle = window.requestAnimationFrame(() => frame());
    return () => window.cancelAnimationFrame(handle);
  }, [frame, fitRequest]);

  // A newly opened material starts framed and unselected rather than wherever the last one was.
  useEffect(() => {
    setSelectedNodes([]);
    setSelectedEdges([]);
    setPalette(null);
    setMenu(null);
  }, [contextKey]);
  const graphIdentity = `${contextKey}#${graph.nodes[0]?.id ?? ''}`;
  useEffect(() => {
    const timer = window.setTimeout(() => frame(undefined, true), 30);
    return () => window.clearTimeout(timer);
  }, [frame, graphIdentity]);

  // Undo, a preset or "Reset" can take selected nodes away; the selection follows.
  useEffect(() => {
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const edgeIds = new Set(graph.edges.map((edge) => edge.id));
    setSelectedNodes((current) => (current.every((id) => nodeIds.has(id)) ? current : current.filter((id) => nodeIds.has(id))));
    setSelectedEdges((current) => (current.every((id) => edgeIds.has(id)) ? current : current.filter((id) => edgeIds.has(id))));
  }, [graph]);

  const requestKey = selectionRequest?.key;
  useEffect(() => {
    if (!selectionRequest) return;
    const known = new Set(graphRef.current.nodes.map((node) => node.id));
    const ids = selectionRequest.nodeIds.filter((id) => known.has(id));
    setSelectedNodes(ids);
    setSelectedEdges([]);
    if (ids.length === 0) return;
    const timer = window.setTimeout(() => frame(ids), 40);
    return () => window.clearTimeout(timer);
    // Only a new key is a new request; the ids ride along with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, frame]);

  const reportedRef = useRef('');
  useEffect(() => {
    const key = selectedNodes.join('|');
    if (key === reportedRef.current) return;
    reportedRef.current = key;
    onSelectionChange?.(selectedNodes);
  }, [onSelectionChange, selectedNodes]);

  useEffect(() => {
    // Space is a pan modifier too, but it is also the playtest's drift button, so the listener
    // stands down while a race is running.
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

  // ------------------------------------------------------------------ wheel

  // A native listener, not React's: React's wheel handler is passive, so it could not stop the
  // page from scrolling or the browser from zooming on a pinch.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const onWheel = (event: WheelEvent) => {
      if (wheelBelongsToOverlay(event.target, surface)) return;
      event.preventDefault();
      const now = performance.now();
      const gesture = wheelGesture(event, now < trackpadUntilRef.current);
      if (gesture.kind === 'pan') {
        trackpadUntilRef.current = now + TRACKPAD_MEMORY_MS;
        setView((current) => ({ ...current, panX: current.panX + gesture.dx / current.zoom, panY: current.panY + gesture.dy / current.zoom }));
        return;
      }
      if (event.ctrlKey) trackpadUntilRef.current = now + TRACKPAD_MEMORY_MS;
      const rect = surface.getBoundingClientRect();
      setView((current) => zoomAbout(current, gesture.factor, event.clientX - rect.left, event.clientY - rect.top));
    };
    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => surface.removeEventListener('wheel', onWheel);
  }, []);

  // ------------------------------------------------------------------ edits shared by keys and menus

  const deleteSelection = useCallback((nodeIds: readonly string[], edgeIds: readonly string[]) => {
    let next = graphRef.current;
    if (edgeIds.length > 0) next = removeEdges(next, edgeIds);
    if (nodeIds.length > 0) next = deleteNodes(next, nodeIds);
    if (next !== graphRef.current) onChangeGraph(next);
    setSelectedNodes([]);
    setSelectedEdges([]);
  }, [onChangeGraph]);

  const duplicateSelection = useCallback((nodeIds: readonly string[]) => {
    const result = duplicateNodes(graphRef.current, nodeIds);
    if (result.newIds.length === 0) return;
    onChangeGraph(result.graph);
    setSelectedNodes(result.newIds);
  }, [onChangeGraph]);

  const copySelection = useCallback((nodeIds: readonly string[]) => {
    const payload = JSON.stringify(copyNodes(graphRef.current, nodeIds));
    clipboardRef.current = payload;
    return payload;
  }, []);

  // ------------------------------------------------------------------ palette and menus

  const openPalette = useCallback(
    (clientX: number, clientY: number, from: SocketRef | null = null) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      const point = pointToGraph(clientX, clientY);
      setMenu(null);
      setPaletteQuery('');
      setPaletteIndex(0);
      setPalette({
        screenX: rect ? clientX - rect.left : 0,
        screenY: rect ? clientY - rect.top : 0,
        graphX: point.x,
        graphY: point.y,
        from,
        types: from ? compatibleNodeTypes(graphRef.current, from) : ADDABLE_NODE_TYPES,
      });
    },
    [pointToGraph],
  );

  /** A right-click that did not drag: the node's menu, the wire's, or "add a node" on empty grid. */
  const openContextMenu = useCallback(
    (clientX: number, clientY: number, nodeId: string | null) => {
      const current = graphRef.current;
      if (nodeId) {
        const ids = selectedNodes.includes(nodeId) ? selectedNodes : [nodeId];
        setSelectedNodes(ids);
        setSelectedEdges([]);
        setPalette(null);
        const onlyOutput = ids.every((id) => current.nodes.find((node) => node.id === id)?.type === 'output');
        const wires = edgesTouching(current, ids);
        const outputReason = 'The Material node is the result; there is only ever one.';
        setMenu({
          x: clientX,
          y: clientY,
          sections: [
            {
              id: 'edit',
              title: ids.length === 1 ? 'Node' : `${ids.length} nodes`,
              items: [
                { id: 'duplicate', label: 'Duplicate', icon: <CopyPlus size={14} />, shortcut: 'Ctrl+D', disabled: onlyOutput, disabledReason: outputReason, onSelect: () => duplicateSelection(ids) },
                {
                  id: 'copy',
                  label: 'Copy',
                  icon: <Copy size={14} />,
                  shortcut: 'Ctrl+C',
                  disabled: onlyOutput,
                  disabledReason: outputReason,
                  onSelect: () => { void navigator.clipboard?.writeText(copySelection(ids)).catch(() => undefined); },
                },
                { id: 'disconnect', label: 'Break all wires', icon: <Unlink size={14} />, disabled: wires.length === 0, disabledReason: 'Nothing is wired to it.', onSelect: () => onChangeGraph(removeEdges(graphRef.current, wires)) },
                { id: 'frame', label: 'Frame', icon: <Focus size={14} />, shortcut: 'F', onSelect: () => frame(ids) },
              ],
            },
            {
              id: 'delete',
              items: [
                { id: 'delete', label: 'Delete', icon: <Trash2 size={14} />, shortcut: 'Delete', danger: true, disabled: onlyOutput, disabledReason: outputReason, onSelect: () => deleteSelection(ids, []) },
              ],
            },
          ],
        });
        return;
      }
      const point = pointToGraph(clientX, clientY);
      const wire = wireAtPoint(current, point.x, point.y, 8 / viewRef.current.zoom);
      if (wire) {
        setSelectedEdges([wire.id]);
        setSelectedNodes([]);
        setPalette(null);
        setMenu({
          x: clientX,
          y: clientY,
          sections: [{ id: 'wire', title: 'Wire', items: [{ id: 'delete', label: 'Delete wire', icon: <Trash2 size={14} />, shortcut: 'Delete', danger: true, onSelect: () => deleteSelection([], [wire.id]) }] }],
        });
        return;
      }
      openPalette(clientX, clientY);
    },
    [copySelection, deleteSelection, duplicateSelection, frame, onChangeGraph, openPalette, pointToGraph, selectedNodes],
  );

  // ------------------------------------------------------------------ dragging

  const finishWire = useCallback(
    (from: SocketRef, clientX: number, clientY: number) => {
      const target = document.elementFromPoint(clientX, clientY)?.closest('[data-socket]') as HTMLElement | null;
      if (!target) {
        // Released over nothing: offer the nodes that could legally be wired here.
        openPalette(clientX, clientY, from);
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
    [onChangeGraph, openPalette],
  );

  useEffect(() => {
    if (!drag) return;

    const move = (event: PointerEvent) => {
      if (drag.kind === 'pan') {
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!panMovedRef.current && Math.hypot(dx, dy) < CLICK_SLOP) return;
        panMovedRef.current = true;
        setView((current) => ({ ...current, panX: drag.panX - dx / current.zoom, panY: drag.panY - dy / current.zoom }));
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
      if (drag.kind === 'pan') {
        if (drag.button === 2 && !panMovedRef.current && event.type === 'pointerup') openContextMenu(event.clientX, event.clientY, drag.nodeId);
      } else if (drag.kind === 'marquee') {
        const rect = marqueeRect(drag.x0, drag.y0, drag.x1, drag.y1);
        const hits = nodesInMarquee(graphRef.current, rect);
        setSelectedNodes((current) => (drag.additive ? [...new Set([...current, ...hits])] : hits));
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
  }, [drag, finishWire, onChangeGraph, openContextMenu, pointToGraph]);

  // ------------------------------------------------------------------ pointer entry points

  const onSurfacePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      surfaceRef.current?.focus({ preventScroll: true });
      setPalette(null);
      setMenu(null);
      if (event.button === 2 || event.button === 1 || (event.button === 0 && spaceRef.current)) {
        event.preventDefault();
        panMovedRef.current = false;
        const nodeId = (event.target as Element).closest('[data-node]')?.getAttribute('data-node') ?? null;
        setDrag({ kind: 'pan', button: event.button, startX: event.clientX, startY: event.clientY, panX: view.panX, panY: view.panY, nodeId });
        return;
      }
      if (event.button !== 0) return;
      const point = pointToGraph(event.clientX, event.clientY);
      const wire = wireAtPoint(graph, point.x, point.y, 8 / view.zoom);
      if (wire) {
        setSelectedEdges([wire.id]);
        setSelectedNodes([]);
        return;
      }
      if (!event.shiftKey && !event.ctrlKey) {
        setSelectedNodes([]);
        setSelectedEdges([]);
      }
      setDrag({ kind: 'marquee', x0: point.x, y0: point.y, x1: point.x, y1: point.y, additive: event.shiftKey || event.ctrlKey });
    },
    [graph, pointToGraph, view.panX, view.panY, view.zoom],
  );

  const onPointerDownNode = useCallback(
    (event: ReactPointerEvent<HTMLElement>, nodeId: string) => {
      // Right and middle presses fall through to the surface, which pans or opens the node menu.
      if (event.button !== 0 || spaceRef.current) return;
      event.stopPropagation();
      surfaceRef.current?.focus({ preventScroll: true });
      setPalette(null);
      setMenu(null);
      const toggle = event.shiftKey || event.ctrlKey;
      const next = toggle
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
      if (event.button !== 0 || spaceRef.current) return;
      event.stopPropagation();
      event.preventDefault();
      surfaceRef.current?.focus({ preventScroll: true });
      // Alt+click breaks every wire on a pin, as in Unreal.
      if (event.altKey) {
        const wires = graphRef.current.edges
          .filter((edge) => (side === 'input' ? edge.to : edge.from).node === nodeId && (side === 'input' ? edge.to : edge.from).socket === socket)
          .map((edge) => edge.id);
        if (wires.length > 0) onChangeGraph(removeEdges(graphRef.current, wires));
        return;
      }
      const point = pointToGraph(event.clientX, event.clientY);
      setDrag({ kind: 'wire', from: { node: nodeId, socket, side }, x: point.x, y: point.y });
    },
    [onChangeGraph, pointToGraph],
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
      surfaceRef.current?.focus({ preventScroll: true });
    },
    [onChangeGraph, palette],
  );

  // ------------------------------------------------------------------ keyboard

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
      };

      if (event.key === 'Delete' || event.key === 'Backspace') {
        handled();
        deleteSelection(selectedNodes, selectedEdges);
        return;
      }
      if (ctrl && key === 'd') {
        handled();
        duplicateSelection(selectedNodes);
        return;
      }
      if (ctrl && key === 'z' && !event.shiftKey) {
        handled();
        onUndo();
        return;
      }
      if (ctrl && (key === 'y' || (key === 'z' && event.shiftKey))) {
        handled();
        onRedo();
        return;
      }
      if (ctrl && key === 'a') {
        handled();
        setSelectedNodes(graph.nodes.map((node) => node.id));
        return;
      }
      if (!ctrl && !event.altKey && key === 'f') {
        handled();
        frame(selectedNodes);
        return;
      }
      if (event.key === 'Home') {
        handled();
        frame();
        return;
      }
      if (event.key === 'Escape') {
        setPalette(null);
        setMenu(null);
        setSelectedNodes([]);
        setSelectedEdges([]);
      }
    },
    [deleteSelection, duplicateSelection, frame, graph.nodes, onRedo, onUndo, selectedEdges, selectedNodes],
  );

  const onCopy = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (selectedNodes.length === 0) return;
      event.clipboardData.setData('text/plain', copySelection(selectedNodes));
      event.preventDefault();
    },
    [copySelection, selectedNodes],
  );

  const onPaste = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      const text = event.clipboardData.getData('text/plain') || clipboardRef.current || '';
      const clipboard = parseClipboard(text);
      if (!clipboard) return;
      event.preventDefault();
      // Pasted where the pointer is, as Unreal does; with no pointer over the grid, near the top left.
      const at = pointerRef.current ?? { x: view.panX + 60, y: view.panY + 60 };
      const result = pasteNodes(graph, clipboard, at.x, at.y);
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
    return [{ edge, start, end, alpha: socketType(graph, fromNode.id, edge.from.socket, 'output') === 'alpha' }];
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
  const query = paletteQuery.trim().toLowerCase();
  const paletteGroups = PALETTE_GROUPS.map((group) => ({
    title: group.title,
    types: group.types.filter((type) =>
      (palette?.types ?? []).includes(type) &&
      (query.length === 0 || `${nodeTypeTitle(type)} ${NODE_SUMMARY[type]}`.toLowerCase().includes(query)),
    ),
  })).filter((group) => group.types.length > 0);
  const paletteTypes = paletteGroups.flatMap((group) => group.types);
  const activeType = paletteTypes[Math.min(paletteIndex, paletteTypes.length - 1)];
  const isEmpty = !graph.nodes.some((node) => node.type !== 'output' && node.type !== 'comment');

  const onPatchNode = (nodeId: string, patch: Partial<EditorGraphNode>) => onChangeGraph(patchNode(graph, nodeId, patch));
  const onSetInputValue = (nodeId: string, socket: string, value: GraphInlineValue) => onChangeGraph(setInputValue(graph, nodeId, socket, value));

  return (
    <div
      ref={surfaceRef}
      className={drag?.kind === 'pan' && panMovedRef.current ? 'graphSurface panning' : 'graphSurface'}
      tabIndex={0}
      role="application"
      aria-label="Shader graph"
      aria-roledescription="node graph"
      // Read by the probes; also the zoom readout in the corner.
      data-zoom={view.zoom.toFixed(3)}
      data-pan={`${Math.round(view.panX)},${Math.round(view.panY)}`}
      onPointerDown={onSurfacePointerDown}
      onPointerMove={(event) => { pointerRef.current = pointToGraph(event.clientX, event.clientY); }}
      onPointerLeave={() => { pointerRef.current = null; }}
      onDoubleClick={(event) => {
        if ((event.target as Element).closest('[data-node], [data-graph-overlay]')) return;
        openPalette(event.clientX, event.clientY);
      }}
      // The right button is handled on release (see the pan drag); the browser's own menu never shows.
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onPaste={onPaste}
    >
      <div
        className="graphViewport"
        style={{ transform: `translate(${-view.panX * view.zoom}px, ${-view.panY * view.zoom}px) scale(${view.zoom})` }}
      >
        <svg className="graphWires" width="1" height="1" aria-hidden="true">
          {wires.map(({ edge, start, end, alpha }) => (
            <path
              key={edge.id}
              className={[
                'graphWire',
                alpha && 'graphWire--alpha',
                (selectedEdges.includes(edge.id) || selectedNodes.includes(edge.from.node) || selectedNodes.includes(edge.to.node)) && 'selected',
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
            connected={connected}
            onPatch={(patch) => onPatchNode(node.id, patch)}
            onSetInputValue={(socket, value) => onSetInputValue(node.id, socket, value)}
            onChangeDoc={onChangeDoc}
            onConvertRawStages={onConvertRawStages}
            rawStagesConvertible={rawStagesConvertible}
            onPointerDownNode={onPointerDownNode}
            onPointerDownSocket={onPointerDownSocket}
          />
        ))}
      </div>

      {isEmpty && !palette && (
        <div className="graphEmpty" data-graph-overlay onPointerDown={(event) => event.stopPropagation()}>
          <strong>Start building this shader</strong>
          <span>
            Right-click the grid to add a node, then drag from its pin into the Material node&apos;s
            <em> Colour</em> or <em>Alpha</em>.
          </span>
          <div className="graphEmptyActions">
            <button
              type="button"
              className="graphEmptyButton"
              onClick={() => {
                const rect = surfaceRef.current?.getBoundingClientRect();
                if (rect) openPalette(rect.left + rect.width * 0.3, rect.top + rect.height * 0.35);
              }}
            >
              Add a node
            </button>
            {emptyAction}
          </div>
        </div>
      )}

      <p className="graphHints" aria-hidden="true">
        <span><kbd>Right-drag</kbd> pan</span>
        <span><kbd>Scroll</kbd> zoom</span>
        <span><kbd>Right-click</kbd> add node</span>
        <span><kbd>F</kbd> frame</span>
      </p>
      <p className="graphZoom" aria-live="off">{Math.round(view.zoom * 100)}%</p>

      {rejectMessage && <p className="graphReject" role="status">{rejectMessage}</p>}

      {palette && (
        <div
          className="graphPalette"
          data-graph-overlay
          // Kept inside the surface: opened near the bottom or the right edge it would otherwise
          // hang off the dock, where the shell clips it.
          style={{
            left: Math.max(4, Math.min(palette.screenX, (surfaceRef.current?.clientWidth ?? 0) - 284)),
            top: Math.max(4, Math.min(palette.screenY, (surfaceRef.current?.clientHeight ?? 0) - 324)),
          }}
          role="dialog"
          aria-label="Add node"
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <input
            autoFocus
            type="search"
            className="graphPaletteSearch"
            placeholder={palette.from ? 'Add a node wired to this pin…' : 'Search nodes…'}
            aria-label="Search node types"
            value={paletteQuery}
            onChange={(event) => {
              setPaletteQuery(event.currentTarget.value);
              setPaletteIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setPalette(null);
                surfaceRef.current?.focus({ preventScroll: true });
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const delta = event.key === 'ArrowDown' ? 1 : -1;
                setPaletteIndex((index) => (Math.min(index, paletteTypes.length - 1) + delta + paletteTypes.length) % Math.max(1, paletteTypes.length));
              }
              if (event.key === 'Enter' && activeType) addFromPalette(activeType);
            }}
          />
          {/* Grouped like Unreal's menu: what a material is normally made of first, then the
              hardware showing through under Advanced. Every heading is a signpost, not a
              disclosure, because hiding a node is how a node nobody finds happens. */}
          <ul className="graphPaletteList" role="listbox" aria-label="Node types">
            {paletteGroups.map((group) => (
              <li key={group.title} className="graphPaletteGroup">
                <span className="graphPaletteHeading">{group.title}</span>
                <ul>
                  {group.types.map((type) => (
                    <li key={type}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={type === activeType}
                        className={type === activeType ? 'active' : undefined}
                        onPointerEnter={() => setPaletteIndex(paletteTypes.indexOf(type))}
                        onClick={() => addFromPalette(type)}
                      >
                        <strong>{nodeTypeTitle(type)}</strong>
                        <span>{NODE_SUMMARY[type]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {paletteTypes.length === 0 && <li className="graphPaletteEmpty">No node matches that.</li>}
          </ul>
        </div>
      )}

      {/* The menu is portalled to the body, but React still bubbles its events up through here;
          without this a click on an item would reach the canvas first and close the menu. */}
      {menu && (
        <div
          className="graphMenuHost"
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <ContextMenu x={menu.x} y={menu.y} sections={menu.sections} onClose={() => setMenu(null)} label="Graph menu" />
        </div>
      )}
    </div>
  );
}
