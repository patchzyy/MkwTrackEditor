/**
 * `useCreateTools`: the active tool, the armed palette item and the pointer / keyboard plumbing
 * between the viewport (`createView`) and the pure tool modules. This is the only place that
 * touches React, the session and the camera; everything it decides is made by `tools/*.ts`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { deleteSelection as deleteSelectionOp, selectionExists, updateSection } from '../../../lib/create/ops';
import type {
  CreateCameraApi,
  CreateHit,
  CreateOverlay,
  CreatePointerEvent,
  CreatePointerResult,
  CreateRay,
  CreateSelection,
  SurfaceRef,
  Vec3,
} from '../../../lib/create/types';
import { buildCreateOverlay } from '../overlay/buildCreateOverlay';
import type { CreateSession } from '../session/types';
import { defaultArmedFor, isPaintable, toolForItem } from './armed';
import { selectionBounds, roadsBounds } from './bounds';
import { dropItem, previewForDrop } from './drop';
import { flashHint } from './hints';
import { PERSPECTIVE_VIEW } from '../viewport/framing';
import { brushKeyFor, isTypingTarget, mapKey, resizeBrush } from './keys';
import { nextLaneMode } from './lanes';
import { rayPlane } from './pick';
import { activeRoad, type RoadState } from './roadTool';
import { initialToolStates, TOOL_MODULES } from './registry';
import {
  BRUSH_LIMITS,
  DEFAULT_BRUSH,
  type ArmedItem,
  type BrushSettings,
  type HintSpec,
  type HoverTarget,
  type LaneMode,
  type Modifiers,
  type ToolCommand,
  type ToolCtx,
  type ToolId,
  type ToolPreview,
  type ToolStep,
} from './types';

export const DRAG_MIME = 'application/x-mkw-create-item';

/** The tile being dragged. `dataTransfer` data is unreadable during `dragover`, so it also lives here. */
let currentDrag: ArmedItem | null = null;
export function beginPaletteDrag(item: ArmedItem, dataTransfer: DataTransfer): void {
  currentDrag = item;
  dataTransfer.setData(DRAG_MIME, JSON.stringify(item));
  dataTransfer.setData('text/plain', item.label);
  dataTransfer.effectAllowed = 'copy';
}
export function endPaletteDrag(): void {
  currentDrag = null;
}
/** True while a palette tile is being dragged, so the shell never mistakes it for a file drop. */
export function isPaletteDragActive(): boolean {
  return currentDrag !== null;
}

/** A framed box narrower than this (units) is "a thing", not "a stretch": it gets a roomier frame. */
const SMALL_FRAME_SIZE = 12000;

export interface UseCreateToolsOptions {
  /** Create mode is showing a design. Keyboard shortcuts and pointer handling are off otherwise. */
  enabled: boolean;
  /** Filled by the viewport (`createView.cameraApiRef`). */
  cameraApiRef: MutableRefObject<CreateCameraApi | null>;
}

export interface CreateViewPart {
  overlay: CreateOverlay;
  onPointer: (event: CreatePointerEvent) => CreatePointerResult;
  cursor: string;
}

export interface CreateTools {
  activeTool: ToolId;
  setTool: (tool: ToolId) => void;
  /** The item armed for the active tool (what a click will place or apply). */
  armed: ArmedItem | null;
  armedByTool: Partial<Record<ToolId, ArmedItem>>;
  /** Arm a palette tile: switches to its tool, or applies it straight away when that makes sense. */
  arm: (item: ArmedItem) => void;
  disarm: () => void;
  laneMode: LaneMode;
  brush: BrushSettings;
  setBrush: (patch: Partial<BrushSettings>) => void;
  createViewPart: CreateViewPart;
  /** The sentence under the toolbar, with its modifier chips. */
  hint: HintSpec;
  hover: HoverTarget | null;
  modifiers: Modifiers;
  topView: boolean;
  /** The faint scale grid is on (top view while drawing the first road). */
  showGrid: boolean;
  setTopView: (enabled: boolean) => void;
  toggleTopView: () => void;
  frameSelection: (selection?: readonly CreateSelection[]) => void;
  deleteSelection: () => void;
  /** Key handling for the shell to route plain keys to (tool letters, [ ], Esc...). True when it acted. */
  onKey: (event: KeyboardEvent) => boolean;
  /** The tool wants this key before the shell's global commands (Backspace while drawing a road). */
  ownsKey: (event: KeyboardEvent) => boolean;
  /** Show a one-off message in the hint strip. */
  flash: (message: string, tone?: 'warn' | 'ready') => void;
}

const NO_MODS: Modifiers = { shift: false, ctrl: false, alt: false };
const FLASH_MS = 4200;

function deleteLabel(selection: readonly CreateSelection[]): string {
  if (selection.length > 1) return `Delete ${selection.length} items`;
  switch (selection[0]?.kind) {
    case 'road':
      return 'Delete road';
    case 'point':
      return 'Delete road point';
    case 'section':
      return 'Delete section';
    case 'piece':
      return 'Delete piece';
    case 'prop':
      return 'Delete object';
    case 'stroke':
      return 'Delete terrain stroke';
    default:
      return 'Delete';
  }
}

export function useCreateTools(session: CreateSession, options: UseCreateToolsOptions): CreateTools {
  const { enabled, cameraApiRef } = options;
  const [activeTool, setActiveToolState] = useState<ToolId>('select');
  const [armedByTool, setArmedByTool] = useState<Partial<Record<ToolId, ArmedItem>>>({});
  const [laneMode, setLaneMode] = useState<LaneMode>('auto');
  const [brush, setBrushState] = useState<BrushSettings>(DEFAULT_BRUSH);
  const [topView, setTopViewState] = useState(false);
  const [modifiers, setModifiers] = useState<Modifiers>(NO_MODS);
  const [visual, setVisual] = useState<{ hover: HoverTarget | null; preview: ToolPreview | null; cursor: string }>({ hover: null, preview: null, cursor: 'default' });
  const [flashState, setFlashState] = useState<{ message: string; at: number; tone: 'warn' | 'ready' } | null>(null);
  const [, setStateVersion] = useState(0);

  // Everything the event handlers read lives in refs, so they never go stale between renders.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const toolRef = useRef(activeTool);
  toolRef.current = activeTool;
  const armedRef = useRef(armedByTool);
  armedRef.current = armedByTool;
  const laneRef = useRef(laneMode);
  laneRef.current = laneMode;
  const brushRef = useRef(brush);
  brushRef.current = brush;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const modsRef = useRef<Modifiers>(NO_MODS);
  const toolStates = useRef<Record<ToolId, unknown>>(initialToolStates());
  const lastEvent = useRef<CreatePointerEvent | null>(null);
  const pending = useRef<{ hover: HoverTarget | null; preview: ToolPreview | null; cursor: string } | null>(null);
  const frame = useRef<number | null>(null);
  const flashTimer = useRef<number | null>(null);

  const flush = useCallback(() => {
    frame.current = null;
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setVisual((prev) => (prev.hover === next.hover && prev.preview === next.preview && prev.cursor === next.cursor ? prev : next));
    setStateVersion((v) => v + 1);
  }, []);

  const queueVisual = useCallback(
    (next: { hover: HoverTarget | null; preview: ToolPreview | null; cursor: string }) => {
      pending.current = next;
      if (frame.current === null) frame.current = window.requestAnimationFrame(flush);
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  const flash = useCallback((message: string, tone: 'warn' | 'ready' = 'warn') => {
    setFlashState({ message, at: Date.now(), tone });
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashState(null), FLASH_MS);
  }, []);

  // ── Context handed to the pure tools ─────────────────────────────────────────────────────
  const makeCtx = useCallback((): ToolCtx => {
    const s = sessionRef.current;
    const project = s.project;
    if (!project) throw new Error('Create tools need an open design.');
    // The design's own ground height (it starts at the world's base height) is the plane tools click on.
    const groundPlaneY = project.terrain.baseHeight;
    return {
      project,
      kit: s.kit,
      samples: s.samples,
      selection: s.selection,
      armed: armedRef.current[toolRef.current] ?? null,
      brush: brushRef.current,
      laneMode: laneRef.current,
      groundPlaneY,
      unitsPerPixel: (point: Vec3) => {
        const api = cameraApiRef.current;
        if (!api) return 20;
        const p0 = api.project(point);
        if (!p0) return 20;
        let best = 0;
        for (const axis of [{ x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 100 }]) {
          const p1 = api.project({ x: point.x + axis.x, y: point.y + axis.y, z: point.z + axis.z });
          if (p1) best = Math.max(best, Math.hypot(p1.x - p0.x, p1.y - p0.y));
        }
        return best > 0.01 ? 100 / best : 20;
      },
      project2d: (point: Vec3) => cameraApiRef.current?.project(point) ?? null,
    };
  }, [cameraApiRef]);

  // ── Running commands ─────────────────────────────────────────────────────────────────────
  const setToolRef = useRef<(tool: ToolId) => void>(() => undefined);

  const runCommands = useCallback(
    (commands: ToolCommand[]) => {
      const s = sessionRef.current;
      for (const cmd of commands) {
        switch (cmd.type) {
          case 'edit':
            s.edit(cmd.mutate, { label: cmd.label });
            break;
          case 'begin':
            s.beginGesture({ label: cmd.label });
            break;
          case 'update':
            s.updateGesture(cmd.mutate);
            break;
          case 'end':
            s.endGesture();
            break;
          case 'cancel':
            s.cancelGesture();
            break;
          case 'select':
            s.select(cmd.selection);
            break;
          case 'setTool':
            setToolRef.current(cmd.tool);
            break;
          case 'flash':
            flash(cmd.message, cmd.tone);
            break;
        }
      }
    },
    [flash],
  );

  const applyStep = useCallback(
    (tool: ToolId, step: ToolStep<unknown>, immediate = false) => {
      toolStates.current[tool] = step.state;
      if (step.commands.length > 0) runCommands(step.commands);
      const next = { hover: step.hover, preview: step.preview, cursor: step.cursor };
      if (immediate) {
        pending.current = null;
        setVisual(next);
        setStateVersion((v) => v + 1);
      } else queueVisual(next);
    },
    [queueVisual, runCommands],
  );

  // ── Tool switching ───────────────────────────────────────────────────────────────────────
  const setTool = useCallback(
    (tool: ToolId) => {
      const s = sessionRef.current;
      if (!s.project) return;
      const previous = toolRef.current;
      if (previous === tool) return;
      const leaving = TOOL_MODULES[previous].leave(makeCtx(), toolStates.current[previous]);
      toolStates.current[previous] = leaving.state;
      if (leaving.commands.length > 0) runCommands(leaving.commands);
      toolStates.current[tool] = TOOL_MODULES[tool].initial();
      const armed = defaultArmedFor(tool, armedRef.current[tool] ?? null, s.project, s.kit);
      if (armed && armed !== armedRef.current[tool]) {
        armedRef.current = { ...armedRef.current, [tool]: armed };
        setArmedByTool(armedRef.current);
      }
      toolRef.current = tool;
      setActiveToolState(tool);
      setLaneMode('auto');
      pending.current = null;
      setVisual({ hover: null, preview: null, cursor: 'default' });
    },
    [makeCtx, runCommands],
  );
  setToolRef.current = setTool;

  const armInto = useCallback((item: ArmedItem) => {
    const tool = toolForItem(item);
    armedRef.current = { ...armedRef.current, [tool]: item };
    setArmedByTool(armedRef.current);
    return tool;
  }, []);

  const arm = useCallback(
    (item: ArmedItem) => {
      const s = sessionRef.current;
      if (!s.project) return;
      if (item.kind === 'surface' && item.category !== 'erase' && !isPaintable(item.category)) {
        // Road-like surfaces apply to the selected section instead of arming the brush.
        const sections = s.selection.filter((sel): sel is Extract<CreateSelection, { kind: 'section' }> => sel.kind === 'section');
        if (item.category === 'road' && item.surface && sections.length > 0) {
          const surface: SurfaceRef = item.surface;
          s.edit(
            (p) => sections.reduce((acc, sel) => updateSection(acc, sel.roadId, sel.sectionId, { surface }), p),
            { label: `Road surface: ${item.label}` },
          );
          return;
        }
        flash(item.category === 'road' ? 'Select a road section first (click the road), then pick a surface. You can also drag the tile onto the road.' : `${item.label} is used automatically by roads and walls.`);
        return;
      }
      const tool = armInto(item);
      if (toolRef.current !== tool) setTool(tool);
      else setVisual((v) => ({ ...v }));
    },
    [armInto, flash, setTool],
  );

  const disarm = useCallback(() => {
    const tool = toolRef.current;
    const next = { ...armedRef.current };
    delete next[tool];
    armedRef.current = next;
    setArmedByTool(next);
  }, []);

  // ── Pointer ──────────────────────────────────────────────────────────────────────────────
  const onPointer = useCallback(
    (event: CreatePointerEvent): CreatePointerResult => {
      if (!enabledRef.current || !sessionRef.current.project) return 'pass';
      lastEvent.current = event;
      if (event.shift !== modsRef.current.shift || event.ctrl !== modsRef.current.ctrl || event.alt !== modsRef.current.alt) {
        modsRef.current = { shift: event.shift, ctrl: event.ctrl, alt: event.alt };
        setModifiers(modsRef.current);
      }
      const tool = toolRef.current;
      const step = TOOL_MODULES[tool].pointer(event, makeCtx(), toolStates.current[tool]);
      const immediate = event.phase === 'down' || event.phase === 'up' || event.phase === 'cancel';
      applyStep(tool, step, immediate);
      return step.consumed ? 'consumed' : 'pass';
    },
    [applyStep, makeCtx],
  );

  // Replays the last pointer position as a hover so previews follow key presses (lane, Shift...).
  const refreshHover = useCallback(() => {
    const last = lastEvent.current;
    if (!last || !enabledRef.current || !sessionRef.current.project) return;
    const tool = toolRef.current;
    const state = toolStates.current[tool];
    const step = TOOL_MODULES[tool].pointer({ ...last, phase: 'hover', button: 0, shift: modsRef.current.shift, ctrl: modsRef.current.ctrl, alt: modsRef.current.alt }, makeCtx(), state);
    // Never replace a drag in progress: only the visuals are taken from a replay.
    queueVisual({ hover: step.hover, preview: step.preview, cursor: step.cursor });
  }, [makeCtx, queueVisual]);

  // ── Camera helpers ───────────────────────────────────────────────────────────────────────
  /**
   * Switches the planning view. Leaving it frames the track from the usual 3/4 angle instead of
   * restoring whatever low, distant pose the free camera had; nothing else here ever moves the camera.
   */
  const setTopView = useCallback((on: boolean) => {
    const api = cameraApiRef.current;
    if (!api) return;
    api.setTopView(on);
    if (!on) {
      const s = sessionRef.current;
      const bounds = s.project ? roadsBounds(s.project, s.samples) : null;
      if (bounds) api.frameBounds(bounds.min, bounds.max, PERSPECTIVE_VIEW);
    }
    setTopViewState(api.isTopView());
  }, [cameraApiRef]);

  const toggleTopView = useCallback(() => {
    const api = cameraApiRef.current;
    if (!api) return;
    setTopView(!api.isTopView());
  }, [cameraApiRef, setTopView]);

  /** F, and the checklist's "show me": an explicit request to look at something. */
  const frameSelection = useCallback(
    (selection?: readonly CreateSelection[]) => {
      const s = sessionRef.current;
      const api = cameraApiRef.current;
      if (!s.project || !api) return;
      const sel = selection ?? s.selection;
      const bounds = sel.length > 0 ? selectionBounds(s.project, s.samples, sel) : roadsBounds(s.project, s.samples);
      if (!bounds) return;
      // A single point or piece is a small box: fill much less of the view with it, so it is seen in context.
      const small = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) < SMALL_FRAME_SIZE;
      api.frameBounds(bounds.min, bounds.max, api.isTopView() ? undefined : { ...PERSPECTIVE_VIEW, fill: small ? 0.3 : PERSPECTIVE_VIEW.fill });
    },
    [cameraApiRef],
  );

  const deleteSelection = useCallback(() => {
    const s = sessionRef.current;
    if (!s.project) return;
    const existing = s.selection.filter((sel) => selectionExists(s.project!, sel));
    const deletable = existing.filter((sel) => sel.kind !== 'start');
    if (existing.length === 0) return;
    if (deletable.length === 0) {
      flash('The start line cannot be deleted. Drag it, or use the Start tool (G), to move it.');
      return;
    }
    s.edit((p) => deleteSelectionOp(p, deletable), { label: deleteLabel(deletable) });
    s.select([]);
  }, [flash]);

  const setBrush = useCallback((patch: Partial<BrushSettings>) => {
    setBrushState((prev) => {
      const next = { ...prev, ...patch };
      next.paintRadius = Math.max(BRUSH_LIMITS.min, Math.min(BRUSH_LIMITS.max, next.paintRadius));
      next.sculptRadius = Math.max(BRUSH_LIMITS.min, Math.min(BRUSH_LIMITS.max, next.sculptRadius));
      next.sceneryRadius = Math.max(BRUSH_LIMITS.min, Math.min(BRUSH_LIMITS.max, next.sceneryRadius));
      next.sculptStrength = Math.max(20, Math.min(600, next.sculptStrength));
      brushRef.current = next;
      return next;
    });
  }, []);

  // ── Keyboard ─────────────────────────────────────────────────────────────────────────────
  // The shell may route keys here (`onKey`) and this hook also listens on the window itself; an
  // event handled once is remembered so the two paths never act twice.
  const handledKeys = useRef(new WeakSet<KeyboardEvent>());

  const trackModifiers = useCallback(
    (event: KeyboardEvent) => {
      const next = { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey };
      if (next.shift === modsRef.current.shift && next.ctrl === modsRef.current.ctrl && next.alt === modsRef.current.alt) return;
      modsRef.current = next;
      setModifiers(next);
      refreshHover();
    },
    [refreshHover],
  );

  const onKey = useCallback(
    (event: KeyboardEvent): boolean => {
      if (handledKeys.current.has(event)) return true;
      if (!enabledRef.current) return false;
      if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt') {
        trackModifiers(event);
        return false;
      }
      if (event.repeat && event.key !== '[' && event.key !== ']') return false;
      if (isTypingTarget(event.target)) return false;
      const s = sessionRef.current;
      if (!s.project) return false;
      const action = mapKey(event, toolRef.current);
      if (!action) return false;
      const done = (): boolean => {
        handledKeys.current.add(event);
        return true;
      };
      switch (action.type) {
        case 'tool':
          setTool(action.tool);
          return done();
        case 'topView':
          toggleTopView();
          return done();
        case 'frame':
          frameSelection();
          return done();
        case 'lane':
          if (toolRef.current !== 'pieces') return false;
          setLaneMode((m) => {
            const next = nextLaneMode(m, action.direction);
            laneRef.current = next;
            return next;
          });
          window.setTimeout(refreshHover, 0);
          return done();
        case 'brush': {
          const key = brushKeyFor(toolRef.current);
          if (!key) return false;
          setBrush({ [key]: resizeBrush(brushRef.current[key], action.direction, BRUSH_LIMITS.min, BRUSH_LIMITS.max) });
          window.setTimeout(refreshHover, 0);
          return done();
        }
        case 'toolKey': {
          const tool = toolRef.current;
          const step = TOOL_MODULES[tool].key(action.key, makeCtx(), toolStates.current[tool]);
          if (step) {
            applyStep(tool, step, true);
            return done();
          }
          if (action.key === 'Escape' && s.selection.length > 0) {
            s.select([]);
            return done();
          }
          return false;
        }
        case 'delete':
          // Delete / Backspace on a selection belong to the shell (it owns the design's undo).
          return false;
      }
    },
    [applyStep, frameSelection, makeCtx, refreshHover, setBrush, setTool, toggleTopView, trackModifiers],
  );

  /**
   * Whether the active tool wants this key ahead of the shell's global Create commands. Only
   * Backspace while a road is being drawn: it takes the last point back instead of deleting the
   * selection (which is the road being drawn). A key this hook already handled stays claimed, so
   * the answer does not flip when the shell asks second.
   */
  const ownsKey = useCallback((event: KeyboardEvent): boolean => {
    if (handledKeys.current.has(event)) return true;
    if (event.key !== 'Backspace' || !enabledRef.current || !sessionRef.current.project) return false;
    return toolRef.current === 'road' && (toolStates.current.road as RoadState).drawingRoadId !== null;
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const blocked = () => document.documentElement.dataset.playtest === 'active' || document.documentElement.dataset.viewportCameraLook === 'active';
    const onKeyDown = (event: KeyboardEvent) => {
      if (blocked()) return;
      if (onKey(event)) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt') trackModifiers(event);
    };
    const onBlur = () => {
      modsRef.current = NO_MODS;
      setModifiers(NO_MODS);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [enabled, onKey, trackModifiers]);

  // ── Palette drag and drop onto the viewport ──────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return undefined;
    const rayAt = (clientX: number, clientY: number): { ray: CreateRay; hit: Vec3 | null } | null => {
      const api = cameraApiRef.current;
      const rect = api?.canvasRect();
      if (!api || !rect) return null;
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
      const ray = api.screenToRay(clientX - rect.left, clientY - rect.top);
      const ctx = sessionRef.current.project ? makeCtx() : null;
      let hit: CreateHit | null = null;
      try {
        hit = sessionRef.current.raycast(ray);
      } catch {
        hit = null;
      }
      const position = hit?.position ?? (ctx ? rayPlane(ray, ctx.groundPlaneY) : null);
      return { ray, hit: position };
    };
    const hasItem = (event: DragEvent) => currentDrag !== null || !!event.dataTransfer?.types.includes(DRAG_MIME);
    const onDragOver = (event: DragEvent) => {
      if (!hasItem(event) || !sessionRef.current.project) return;
      const at = rayAt(event.clientX, event.clientY);
      if (!at) {
        queueVisual({ hover: null, preview: null, cursor: 'default' });
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      const item = currentDrag;
      if (item && at.hit) queueVisual({ hover: null, preview: previewForDrop(item, at.hit, makeCtx()), cursor: 'copy' });
    };
    const onDrop = (event: DragEvent) => {
      const item = currentDrag;
      if (!item || !sessionRef.current.project) return;
      const at = rayAt(event.clientX, event.clientY);
      if (!at) return;
      event.preventDefault();
      currentDrag = null;
      if (!at.hit) return;
      const result = dropItem(item, at.hit, makeCtx());
      runCommands(result.commands);
      queueVisual({ hover: null, preview: null, cursor: 'default' });
    };
    const onDragEnd = () => {
      currentDrag = null;
      queueVisual({ hover: null, preview: null, cursor: 'default' });
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onDragEnd);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onDragEnd);
    };
  }, [cameraApiRef, enabled, makeCtx, queueVisual, runCommands]);

  // A design change can make the tool's remembered ids stale (an undone road...).
  const project = session.project;
  const projectId = project?.id ?? null;
  useEffect(() => {
    toolStates.current = initialToolStates();
    pending.current = null;
    setVisual({ hover: null, preview: null, cursor: 'default' });
  }, [projectId]);

  // ── Derived output ───────────────────────────────────────────────────────────────────────
  const activeRoadId = project && activeTool === 'road' ? activeRoad(makeCtx(), toolStates.current.road as RoadState)?.road.id ?? null : null;

  // The scale grid is a drawing aid: top view, while there is no road yet or the Road tool is out.
  const showGrid = topView && !!project && (project.roads.length === 0 || activeTool === 'road');

  const overlay = useMemo<CreateOverlay>(() => {
    if (!project) return { points: [], lines: [], triangles: [], labels: [] };
    return buildCreateOverlay({
      project,
      samples: session.samples,
      selection: session.selection,
      tool: activeTool,
      hover: visual.hover,
      preview: visual.preview,
      activeRoadId,
      closeHover: visual.hover?.kind === 'close',
      unitsPerPixel: (point) => makeCtx().unitsPerPixel(point),
      grid: showGrid,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, session.samples, session.selection, activeTool, visual.hover, visual.preview, activeRoadId, makeCtx, showGrid]);

  const hint = useMemo<HintSpec>(() => {
    if (flashState) return flashHint(flashState.message, flashState.tone);
    if (!project) return { text: 'Open or create a track to start building.', chips: [] };
    return TOOL_MODULES[activeTool].hint(makeCtx(), toolStates.current[activeTool], visual.hover, modifiers);
    // The tool state lives in a ref; `visual` changes whenever it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashState, project, activeTool, visual, modifiers, laneMode, armedByTool, brush, session.selection, makeCtx]);

  const createViewPart = useMemo<CreateViewPart>(() => ({ overlay, onPointer, cursor: visual.cursor }), [overlay, onPointer, visual.cursor]);

  return {
    activeTool,
    setTool,
    armed: armedByTool[activeTool] ?? null,
    armedByTool,
    arm,
    disarm,
    laneMode,
    brush,
    setBrush,
    createViewPart,
    hint,
    hover: visual.hover,
    modifiers,
    topView,
    showGrid,
    setTopView,
    toggleTopView,
    frameSelection,
    deleteSelection,
    onKey,
    ownsKey,
    flash,
  };
}
