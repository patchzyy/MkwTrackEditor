import {
  Clapperboard,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Pause,
  Play,
  Plus,
  Repeat,
  Square,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Button, IconButton } from '../components/Button';
import type { CameraPreviewProgress } from '../Noclip3DViewport';
import type { ModeBottomDock } from '../modes/types';
import {
  insertIntoChainOrder,
  removeFromChainOrder,
  type CameraChainInfo,
  type CameraChainKind,
  type CameraRow,
} from './cameraDocument';
import {
  FRAMES_PER_SECOND,
  buildRulerTicks,
  clampPxPerFrame,
  formatClock,
  formatSeconds,
  frameToX,
  insertionSlot,
  layoutClips,
  layoutWidth,
  layoutWithPlaceholder,
  xToFrame,
  type ClipLayout,
  type ClipSpec,
} from './timelineLayout';
import './cameraTimeline.css';

/** Space before the first clip, so the playhead at 0 and the first clip's edge are both visible. */
const TRACK_PAD = 14;
/** Room after the last clip, where the end of the sequence is marked and a new shot can land. */
const TRACK_TAIL = 96;
const MAX_FIT_PX_PER_FRAME = 3;
const MAX_DURATION_FRAMES = 36000;
const DRAG_THRESHOLD_PX = 5;

export interface TimelinePreview {
  playing: boolean;
  /** True when the whole sequence is playing; false for a single camera. */
  sequence: boolean;
  cameraIndex: number;
  /** Paused position in frames (whole sequence, or the single camera's own). */
  time: number;
}

export interface CameraTimelineProps {
  dock: ModeBottomDock;
  chainKind: CameraChainKind;
  /** The switch only shows when both the opening and the selection-screen sequence exist. */
  showChainSwitch: boolean;
  onChangeChainKind: (kind: CameraChainKind) => void;
  chain: CameraChainInfo;
  /** Cameras in the other sequence, so they are not offered as loose cameras. */
  otherChainOrder: readonly number[];
  rows: CameraRow[];
  selectedId: string | null;
  canEdit: boolean;
  preview: TimelinePreview | null;
  /** Length of a single-camera preview, for the clock. */
  previewTotalFrames: number;
  looping: boolean;
  /** Written by the viewport every rendered frame; the playhead polls it. */
  progressRef: MutableRefObject<CameraPreviewProgress | null>;
  onSelectCamera: (index: number) => void;
  onTogglePlay: () => void;
  onStop: () => void;
  onToggleLoop: () => void;
  onScrubStart: () => void;
  onScrub: (frames: number) => void;
  onScrubEnd: () => void;
  onPreviewFrom: (frames: number) => void;
  onPreviewCamera: (index: number) => void;
  /** One undo step. */
  onSetDuration: (cameraIndex: number, frames: number) => void;
  /** One undo step: reorder, insert or take out. */
  onChangeOrder: (order: number[], message: string) => void;
  onAddShot: () => void;
}

type DragZone = 'track' | 'others' | 'none';

interface DragState {
  source: 'clip' | 'chip';
  cameraIndex: number;
  /** Pointer position in the window, for the floating copy. */
  x: number;
  y: number;
  grabX: number;
  grabY: number;
  width: number;
  durationFrames: number;
  zone: DragZone;
  slot: number;
}

interface ResizeState {
  cameraIndex: number;
  frames: number;
}

/** Runs window-level pointer listeners until the pointer is released or cancelled. */
function trackPointer(onMove: (event: PointerEvent) => void, onEnd: (event: PointerEvent, cancelled: boolean) => void) {
  document.body.classList.add('cameraTimelineDragging');
  const finish = (event: PointerEvent, cancelled: boolean) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', handleUp);
    window.removeEventListener('pointercancel', handleCancel);
    document.body.classList.remove('cameraTimelineDragging');
    onEnd(event, cancelled);
  };
  const handleUp = (event: PointerEvent) => finish(event, false);
  const handleCancel = (event: PointerEvent) => finish(event, true);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', handleUp);
  window.addEventListener('pointercancel', handleCancel);
}

/** Live playback position without re-rendering the app: polls the viewport's progress ref. */
function useLiveFrames(playing: boolean, progressRef: MutableRefObject<CameraPreviewProgress | null>, pausedFrames: number): number {
  const [live, setLive] = useState<number | null>(null);
  useEffect(() => {
    if (!playing) {
      setLive(null);
      return;
    }
    let handle = 0;
    const tick = () => {
      const frames = progressRef.current?.frames ?? null;
      setLive((current) => (current === frames ? current : frames));
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, progressRef]);
  return playing && live !== null ? live : pausedFrames;
}

function toCssColor(color: [number, number, number]): string {
  const channel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255);
  return `rgb(${channel(color[0])}, ${channel(color[1])}, ${channel(color[2])})`;
}

function describeAreas(areas: readonly number[]): string | null {
  if (areas.length === 0) return null;
  return areas.length === 1 ? `Area ${areas[0]}` : `${areas.length} areas`;
}

interface ClipProps {
  layout: ClipLayout;
  row: CameraRow | undefined;
  durationFrames: number;
  selected: boolean;
  dragging: boolean;
  warning: string | null;
  canEdit: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, layout: ClipLayout) => void;
  onClick: (cameraIndex: number) => void;
  onDoubleClick: (layout: ClipLayout) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>, layout: ClipLayout) => void;
  onRemove: (cameraIndex: number) => void;
}

const Clip = memo(function Clip({
  layout,
  row,
  durationFrames,
  selected,
  dragging,
  warning,
  canEdit,
  onPointerDown,
  onClick,
  onDoubleClick,
  onResizeStart,
  onRemove,
}: ClipProps) {
  const color = toCssColor(row?.typeInfo.color ?? [0.6, 0.6, 0.66]);
  const label = row?.typeInfo.label ?? 'Unknown';
  return (
    <div
      className={['cameraClip', selected ? 'isSelected' : '', dragging ? 'isDragging' : '', warning ? 'hasWarning' : ''].filter(Boolean).join(' ')}
      style={{ left: layout.left + 1, width: Math.max(0, layout.width - 2), '--clip-color': color } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Camera ${layout.cameraIndex}, ${formatSeconds(durationFrames)}`}
      title={`${row?.typeInfo.description ?? ''}\nClick to select, double-click to play from here${canEdit ? ', drag to reorder' : ''}.`.trim()}
      data-camera-index={layout.cameraIndex}
      onPointerDown={(event) => onPointerDown(event, layout)}
      onClick={() => onClick(layout.cameraIndex)}
      onDoubleClick={() => onDoubleClick(layout)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onClick(layout.cameraIndex);
        }
      }}
    >
      <div className="cameraClipTop">
        <span className="cameraClipName">Camera {layout.cameraIndex}</span>
        <span className="cameraClipTime">{formatSeconds(durationFrames)}</span>
      </div>
      <div className="cameraClipBottom">
        <span className="cameraClipType">{label}</span>
        {warning && (
          <span className="cameraClipWarn" title={warning} aria-label={warning}>
            <TriangleAlert size={12} />
          </span>
        )}
        {canEdit && (
          <button
            type="button"
            className="cameraClipRemove"
            title="Take this shot out of the sequence. The camera stays in the track."
            aria-label={`Take camera ${layout.cameraIndex} out of the sequence`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(layout.cameraIndex);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <X size={11} />
          </button>
        )}
      </div>
      {canEdit && (
        <div
          className="cameraClipHandle"
          title="Drag to change how long this shot lasts"
          onPointerDown={(event) => onResizeStart(event, layout)}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        />
      )}
    </div>
  );
});

/**
 * Camera mode's bottom dock: the opening (or selection-screen) pan laid out as a timeline.
 * Shots are clips whose width is their duration; the playhead scrubs the whole sequence in the
 * viewport. Every edit here goes through the same document edits the inspector and the outliner
 * use, one undo step per gesture.
 */
export function CameraTimeline({
  dock,
  chainKind,
  showChainSwitch,
  onChangeChainKind,
  chain,
  otherChainOrder,
  rows,
  selectedId,
  canEdit,
  preview,
  previewTotalFrames,
  looping,
  progressRef,
  onSelectCamera,
  onTogglePlay,
  onStop,
  onToggleLoop,
  onScrubStart,
  onScrub,
  onScrubEnd,
  onPreviewFrom,
  onPreviewCamera,
  onSetDuration,
  onChangeOrder,
  onAddShot,
}: CameraTimelineProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const othersRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);

  const [pxPerFrame, setPxPerFrame] = useState(1);
  const [viewWidth, setViewWidth] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [resize, setResize] = useState<ResizeState | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const rowByIndex = useMemo(() => new Map(rows.map((row) => [row.index, row])), [rows]);
  const specs = useMemo<ClipSpec[]>(
    () => chain.steps.map((step) => ({ cameraIndex: step.cameraIndex, durationFrames: step.durationFrames })),
    [chain.steps],
  );
  const hasClips = specs.length > 0;
  const hasUnknownStart = !hasClips && chain.missingAt !== null;

  // --- Latest values for the window-level pointer handlers. ---------------------------------
  const latest = useRef({ pxPerFrame, specs, chain, canEdit, onChangeOrder, onSetDuration, onScrub, onScrubStart, onScrubEnd, onSelectCamera, onPreviewFrom });
  latest.current = { pxPerFrame, specs, chain, canEdit, onChangeOrder, onSetDuration, onScrub, onScrubStart, onScrubEnd, onSelectCamera, onPreviewFrom };

  // --- Size and zoom. -----------------------------------------------------------------------
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setViewWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [dock.open]);

  const fitPxPerFrame = useCallback(
    (totalFrames: number) => {
      const room = Math.max(120, viewWidth - TRACK_PAD - TRACK_TAIL);
      return Math.min(MAX_FIT_PX_PER_FRAME, clampPxPerFrame(room / Math.max(totalFrames, FRAMES_PER_SECOND * 2)));
    },
    [viewWidth],
  );

  // Fit once when a sequence appears or the other one is shown; later edits keep the zoom.
  const fitKey = `${chainKind}:${hasClips ? chain.first : 'none'}:${viewWidth > 0}`;
  const fittedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (viewWidth <= 0 || fittedKeyRef.current === fitKey) return;
    fittedKeyRef.current = fitKey;
    setPxPerFrame(fitPxPerFrame(chain.totalFrames));
  }, [chain.totalFrames, fitKey, fitPxPerFrame, viewWidth]);

  // Ctrl+wheel zooms around the pointer. Native listener: React's wheel handler is passive.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const target = scrollRef.current;
      if (!target) return;
      const current = latest.current.pxPerFrame;
      const next = clampPxPerFrame(current * Math.exp(-event.deltaY * 0.0025));
      if (next === current) return;
      const rect = target.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const anchor = (pointerX + target.scrollLeft - TRACK_PAD) / current;
      setPxPerFrame(next);
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, anchor * next + TRACK_PAD - pointerX);
      });
    }
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [dock.open]);

  // --- Layout. ------------------------------------------------------------------------------
  const effectiveSpecs = useMemo(
    () => (resize ? specs.map((spec) => (spec.cameraIndex === resize.cameraIndex ? { ...spec, durationFrames: resize.frames } : spec)) : specs),
    [resize, specs],
  );
  const baseLayouts = useMemo(() => layoutClips(effectiveSpecs, pxPerFrame), [effectiveSpecs, pxPerFrame]);

  const displayLayouts = useMemo(() => {
    if (!drag) return baseLayouts;
    const remaining = effectiveSpecs.filter((spec) => !(drag.source === 'clip' && spec.cameraIndex === drag.cameraIndex));
    if (drag.zone === 'track') return layoutWithPlaceholder(remaining, drag.slot, drag.durationFrames, pxPerFrame);
    if (drag.source === 'clip' && drag.zone === 'others') return layoutClips(remaining, pxPerFrame);
    return baseLayouts;
  }, [baseLayouts, drag, effectiveSpecs, pxPerFrame]);

  const lanesWidth = layoutWidth(displayLayouts);
  const contentWidth = Math.max(viewWidth, TRACK_PAD + lanesWidth + TRACK_TAIL);
  const endFrame = Math.max(chain.totalFrames, ((contentWidth - TRACK_PAD) / pxPerFrame) | 0);
  const ticks = useMemo(() => buildRulerTicks(endFrame, pxPerFrame), [endFrame, pxPerFrame]);

  const warningsByCamera = useMemo(() => {
    const map = new Map<number, string>();
    for (const index of chain.zeroDurationAt) {
      map.set(index, 'This shot has no length, so the sequence cannot move past it. Give it a duration.');
    }
    const last = chain.order[chain.order.length - 1];
    if (last !== undefined) {
      if (chain.loopsAt !== null) {
        map.set(last, `This shot hands over to camera ${chain.loopsAt}, which already played, so the sequence never ends.`);
      } else if (chain.missingAt !== null) {
        map.set(last, `This shot hands over to camera ${chain.missingAt}, which does not exist.`);
      }
    }
    return map;
  }, [chain]);

  // --- Playhead. ----------------------------------------------------------------------------
  const live = useLiveFrames(preview?.playing ?? false, progressRef, preview?.time ?? 0);
  const previewStart = useMemo(() => {
    if (!preview) return 0;
    if (preview.sequence) return 0;
    const step = chain.steps.find((candidate) => candidate.cameraIndex === preview.cameraIndex);
    return step ? step.startFrame : null;
  }, [chain.steps, preview]);
  const playheadFrames = previewStart === null ? null : (preview ? live : 0) + previewStart;
  const singleOutsideChain = preview !== null && !preview.sequence && previewStart === null;
  const clockFrames = preview ? (singleOutsideChain ? live : (playheadFrames ?? 0)) : 0;
  const clockTotal = singleOutsideChain ? previewTotalFrames : chain.totalFrames;
  const playheadX = playheadFrames === null ? null : TRACK_PAD + frameToX(baseLayouts, Math.min(playheadFrames, chain.totalFrames), pxPerFrame);

  // Keep the playhead on screen while it plays.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || playheadX === null || !preview?.playing) return;
    if (playheadX > element.scrollLeft + element.clientWidth - 24 || playheadX < element.scrollLeft) {
      element.scrollLeft = Math.max(0, playheadX - 48);
    }
  }, [playheadX, preview?.playing]);

  // Bring a newly selected clip into view.
  // (scrollIntoView would also scroll the dock itself, which clips its overflow.)
  const orderKey = chain.order.join(',');
  useEffect(() => {
    const container = scrollRef.current;
    if (!selectedId || !container) return;
    const clip = container.querySelector<HTMLElement>(`.cameraClip[data-camera-index="${selectedId.replace('CAME-', '')}"]`);
    if (!clip) return;
    const view = container.getBoundingClientRect();
    const box = clip.getBoundingClientRect();
    if (box.left < view.left) container.scrollLeft -= view.left - box.left + 16;
    else if (box.right > view.right) container.scrollLeft += box.right - view.right + 16;
  }, [selectedId, orderKey]);

  // --- Gestures. ----------------------------------------------------------------------------
  function contentX(clientX: number): number {
    const element = scrollRef.current;
    if (!element) return 0;
    return clientX - element.getBoundingClientRect().left + element.scrollLeft - TRACK_PAD;
  }

  function beginScrub(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || !hasClips) return;
    event.preventDefault();
    bodyRef.current?.focus({ preventScroll: true });
    const scrubTo = (clientX: number) => {
      const { specs: currentSpecs, pxPerFrame: px, chain: currentChain } = latest.current;
      const layouts = layoutClips(currentSpecs, px);
      const frames = Math.max(0, Math.min(currentChain.totalFrames, xToFrame(layouts, contentX(clientX), px)));
      latest.current.onScrub(frames);
    };
    latest.current.onScrubStart();
    setScrubbing(true);
    scrubTo(event.clientX);
    trackPointer(
      (move) => scrubTo(move.clientX),
      () => {
        setScrubbing(false);
        latest.current.onScrubEnd();
      },
    );
  }

  function computeDrag(event: PointerEvent, base: Pick<DragState, 'source' | 'cameraIndex' | 'grabX' | 'grabY' | 'width' | 'durationFrames'>): DragState {
    const scroll = scrollRef.current?.getBoundingClientRect();
    const others = othersRef.current?.getBoundingClientRect();
    const within = (rect: DOMRect | undefined, margin: number) =>
      !!rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top - margin && event.clientY <= rect.bottom + margin;
    let zone: DragZone = 'none';
    if (base.source === 'clip' && within(others, 6)) zone = 'others';
    else if (within(scroll, 22)) zone = 'track';
    const { specs: currentSpecs, pxPerFrame: px } = latest.current;
    const remaining = currentSpecs.filter((spec) => !(base.source === 'clip' && spec.cameraIndex === base.cameraIndex));
    const centre = contentX(event.clientX - base.grabX + base.width / 2);
    const slot = insertionSlot(layoutClips(remaining, px), centre);
    return { ...base, x: event.clientX, y: event.clientY, zone, slot };
  }

  function beginClipDrag(event: ReactPointerEvent<HTMLElement>, source: 'clip' | 'chip', cameraIndex: number, durationFrames: number) {
    if (event.button !== 0 || !latest.current.canEdit) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const base = {
      source,
      cameraIndex,
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
      width: source === 'clip' ? rect.width : Math.max(88, durationFrames * latest.current.pxPerFrame),
      durationFrames,
    };
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let last: DragState | null = null;
    trackPointer(
      (move) => {
        if (!dragging && Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        last = computeDrag(move, base);
        setDrag(last);
      },
      (_end, cancelled) => {
        setDrag(null);
        if (!dragging) return;
        // The click that follows a drag must not select or preview.
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
        if (cancelled || !last) return;
        const { chain: currentChain, onChangeOrder: change } = latest.current;
        if (last.zone === 'others' && source === 'clip') {
          change(removeFromChainOrder(currentChain.order, cameraIndex), `Took camera ${cameraIndex} out of the sequence.`);
        } else if (last.zone === 'track') {
          const next = insertIntoChainOrder(currentChain.order, cameraIndex, last.slot);
          const unchanged = next.length === currentChain.order.length && next.every((value, i) => value === currentChain.order[i]);
          if (!unchanged) {
            change(next, source === 'clip' ? 'Reordered the sequence.' : `Added camera ${cameraIndex} to the sequence.`);
          }
        }
      },
    );
  }

  function beginResize(event: ReactPointerEvent<HTMLDivElement>, layout: ClipLayout) {
    if (event.button !== 0 || !latest.current.canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    const { pxPerFrame: px } = latest.current;
    const startX = event.clientX;
    const startFrames = layout.durationFrames;
    // A clip held at its minimum width is stretched by that, not by its real duration.
    const pixelsPerFrame = layout.durationFrames > 0 ? layout.width / layout.durationFrames : px;
    let frames = startFrames;
    setResize({ cameraIndex: layout.cameraIndex, frames });
    trackPointer(
      (move) => {
        frames = Math.max(1, Math.min(MAX_DURATION_FRAMES, Math.round(startFrames + (move.clientX - startX) / pixelsPerFrame)));
        setResize({ cameraIndex: layout.cameraIndex, frames });
      },
      (_end, cancelled) => {
        setResize(null);
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
        if (cancelled || Math.round(frames) === Math.round(startFrames)) return;
        latest.current.onSetDuration(layout.cameraIndex, frames);
      },
    );
  }

  const handleClipPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, layout: ClipLayout) => {
      bodyRef.current?.focus({ preventScroll: true });
      beginClipDrag(event, 'clip', layout.cameraIndex, layout.durationFrames);
    },
    // beginClipDrag reads everything through `latest`, so it is safe to capture once.
    [],
  );
  const handleClipClick = useCallback((cameraIndex: number) => {
    if (suppressClickRef.current) return;
    latest.current.onSelectCamera(cameraIndex);
  }, []);
  const handleClipDoubleClick = useCallback((layout: ClipLayout) => {
    if (suppressClickRef.current) return;
    latest.current.onPreviewFrom(layout.startFrame);
  }, []);
  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, layout: ClipLayout) => beginResize(event, layout),
    [],
  );
  const handleRemove = useCallback((cameraIndex: number) => {
    const { chain: currentChain, onChangeOrder: change } = latest.current;
    change(removeFromChainOrder(currentChain.order, cameraIndex), `Took camera ${cameraIndex} out of the sequence.`);
  }, []);

  // --- Keyboard. ----------------------------------------------------------------------------
  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== ' ') return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select')) return;
    event.preventDefault();
    event.stopPropagation();
    onTogglePlay();
  }

  // --- Derived bits. ------------------------------------------------------------------------
  const chainIndexes = useMemo(() => new Set(chain.order), [chain.order]);
  const otherCameras = useMemo(
    () => rows.filter((row) => !chainIndexes.has(row.index) && !otherChainOrder.includes(row.index)),
    [chainIndexes, otherChainOrder, rows],
  );
  const draggedRow = drag ? rowByIndex.get(drag.cameraIndex) : undefined;
  const sequenceName = chainKind === 'opening' ? 'opening pan' : 'selection-screen pan';
  const canPlay = hasClips || preview !== null;
  const playing = preview?.playing ?? false;

  return (
    <section
      className={`contentBrowser cameraTimelineDock${dock.open ? '' : ' collapsed'}${dock.resizing ? ' resizing' : ''}`}
      style={{ height: `${dock.open ? dock.height : dock.collapsedHeight}px` }}
      aria-label="Camera timeline"
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => {
        if (event.key === ' ' && !(event.target as HTMLElement).closest('input, textarea, select')) event.preventDefault();
      }}
    >
      <div
        className="contentBrowserResizeHandle"
        onPointerDown={dock.onBeginResize}
        onDoubleClick={dock.onResetSize}
        role="separator"
        aria-label="Resize timeline"
        aria-orientation="horizontal"
        title="Drag to resize, double-click to reset"
      />

      <div className="cameraTimelineHeader">
        <Clapperboard size={14} aria-hidden="true" className="cameraTimelineIcon" />
        <strong className="cameraTimelineTitle">Timeline</strong>
        {showChainSwitch && (
          <div className="cameraTimelineSwitch" role="tablist" aria-label="Which sequence to show">
            <button
              type="button"
              role="tab"
              aria-selected={chainKind === 'opening'}
              className={chainKind === 'opening' ? 'isActive' : ''}
              title="Plays over the track before the countdown"
              onClick={() => onChangeChainKind('opening')}
            >
              Opening pan
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={chainKind === 'selection'}
              className={chainKind === 'selection' ? 'isActive' : ''}
              title="Plays behind the character-selection screen"
              onClick={() => onChangeChainKind('selection')}
            >
              Selection screen
            </button>
          </div>
        )}

        <div className="cameraTimelineTransport" role="group" aria-label="Playback">
          <IconButton
            size="sm"
            variant="ghost"
            icon={playing ? <Pause size={15} /> : <Play size={15} />}
            tooltip={playing ? 'Pause' : hasClips ? `Play the ${sequenceName}` : 'Play'}
            shortcut="Space"
            tooltipSide="top"
            disabled={!canPlay}
            className="cameraTimelinePlay"
            onClick={onTogglePlay}
          />
          <IconButton
            size="sm"
            variant="ghost"
            icon={<Square size={14} />}
            tooltip="Stop and go back to the free camera"
            shortcut="Esc"
            tooltipSide="top"
            disabled={!preview}
            onClick={onStop}
          />
          <IconButton
            size="sm"
            variant="ghost"
            icon={<Repeat size={14} />}
            tooltip="Restart when it reaches the end"
            tooltipSide="top"
            active={looping}
            onClick={onToggleLoop}
          />
        </div>
        <output className="cameraTimelineClock" aria-label="Playback position">
          {formatClock(clockFrames, clockTotal)}
        </output>

        <div className="cameraTimelineHeaderEnd">
          {dock.open && (
            <>
              <Button
                size="sm"
                icon={<Plus size={14} />}
                tooltip={`Add a camera where you are looking from, at the end of the ${sequenceName}`}
                tooltipSide="top"
                disabled={!canEdit}
                onClick={onAddShot}
              >
                Add shot
              </Button>
              <IconButton
                size="sm"
                variant="ghost"
                icon={<Maximize2 size={14} />}
                tooltip="Fit the whole sequence (Ctrl + scroll zooms)"
                tooltipSide="top"
                disabled={!hasClips}
                onClick={() => {
                  setPxPerFrame(fitPxPerFrame(chain.totalFrames));
                  if (scrollRef.current) scrollRef.current.scrollLeft = 0;
                }}
              />
            </>
          )}
          <IconButton
            size="sm"
            variant="ghost"
            icon={dock.open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            tooltip={dock.open ? 'Collapse timeline' : 'Expand timeline'}
            aria-label={dock.open ? 'Collapse timeline' : 'Expand timeline'}
            tooltipSide="top"
            className="collapseButton"
            onClick={dock.onToggleOpen}
          />
        </div>
      </div>

      <div ref={bodyRef} className="cameraTimelineBody" tabIndex={-1}>
        <div ref={scrollRef} className={`cameraTimelineScroll${scrubbing ? ' isScrubbing' : ''}`}>
          <div className="cameraTimelineContent" style={{ width: contentWidth }}>
            <div className="cameraRuler" onPointerDown={beginScrub} aria-hidden="true">
              {ticks.map((tick) => {
                const x = TRACK_PAD + frameToX(baseLayouts, tick.frame, pxPerFrame);
                return (
                  <span key={tick.frame} className={tick.major ? 'cameraRulerTick isMajor' : 'cameraRulerTick'} style={{ left: x }}>
                    {tick.label && <span className="cameraRulerLabel">{tick.label}</span>}
                  </span>
                );
              })}
            </div>

            <div className="cameraLane" onPointerDown={beginScrub}>
              {hasClips && chain.totalFrames > 0 && (
                <span className="cameraLaneEnd" style={{ left: TRACK_PAD + layoutWidth(baseLayouts) }} aria-hidden="true" />
              )}
              {!hasClips && (
                <div className="cameraLaneEmpty">
                  {hasUnknownStart
                    ? `This sequence starts at camera ${chain.missingAt}, which does not exist.`
                    : canEdit
                      ? 'No shots yet. Add shot places a camera where you are looking from, or drag one in from Other cameras.'
                      : 'No shots yet.'}
                </div>
              )}
              <div className="cameraLaneClips" style={{ left: TRACK_PAD }}>
                {displayLayouts.map((layout) => {
                  if (layout.placeholder) {
                    return <div key="placeholder" className="cameraClipPlaceholder" style={{ left: layout.left, width: layout.width }} />;
                  }
                  const row = rowByIndex.get(layout.cameraIndex);
                  return (
                    <Clip
                      key={layout.cameraIndex}
                      layout={layout}
                      row={row}
                      durationFrames={layout.durationFrames}
                      selected={selectedId === `CAME-${layout.cameraIndex}`}
                      dragging={drag?.source === 'clip' && drag.cameraIndex === layout.cameraIndex}
                      warning={warningsByCamera.get(layout.cameraIndex) ?? null}
                      canEdit={canEdit}
                      onPointerDown={handleClipPointerDown}
                      onClick={handleClipClick}
                      onDoubleClick={handleClipDoubleClick}
                      onResizeStart={handleResizeStart}
                      onRemove={handleRemove}
                    />
                  );
                })}
              </div>
            </div>

            {playheadX !== null && hasClips && !drag && (
              <div className={`cameraPlayhead${scrubbing ? ' isScrubbing' : ''}`} style={{ left: playheadX }} aria-hidden="true">
                <span className="cameraPlayheadHead" />
              </div>
            )}
          </div>
        </div>

        <div ref={othersRef} className={`cameraOthers${drag?.zone === 'others' ? ' isDropTarget' : ''}`}>
          <span className="cameraOthersLabel" title="Replay and area-triggered cameras are not part of the sequence. Drag one into the timeline to add it.">
            Other cameras
          </span>
          <div className="cameraOthersChips">
            {otherCameras.length === 0 && <span className="cameraOthersEmpty">Every camera is in a sequence.</span>}
            {otherCameras.map((row) => {
              const area = describeAreas(row.usedByAreas);
              const duration = row.timeFrames > 0 ? row.timeFrames : row.animatedFrames;
              return (
                <button
                  key={row.id}
                  type="button"
                  className={['cameraChip', selectedId === row.id ? 'isSelected' : '', drag?.source === 'chip' && drag.cameraIndex === row.index ? 'isDragging' : ''].filter(Boolean).join(' ')}
                  style={{ '--clip-color': toCssColor(row.typeInfo.color) } as React.CSSProperties}
                  title={`${row.typeInfo.description}\nClick to select, double-click to preview${canEdit ? ', drag into the timeline to add it to the sequence' : ''}.`}
                  onPointerDown={(event) => beginClipDrag(event, 'chip', row.index, duration > 0 ? duration : 120)}
                  onClick={() => {
                    if (!suppressClickRef.current) onSelectCamera(row.index);
                  }}
                  onDoubleClick={() => {
                    if (!suppressClickRef.current) onPreviewCamera(row.index);
                  }}
                >
                  <span className="cameraChipDot" />
                  <span className="cameraChipName">Camera {row.index}</span>
                  <span className="cameraChipType">{area ?? row.typeInfo.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {drag && (
        <div
          className={`cameraClip cameraClipGhost${drag.zone === 'others' ? ' isDetaching' : ''}${drag.zone === 'none' ? ' isLoose' : ''}`}
          style={
            {
              left: drag.x - drag.grabX,
              top: drag.y - drag.grabY,
              width: drag.width,
              '--clip-color': toCssColor(draggedRow?.typeInfo.color ?? [0.6, 0.6, 0.66]),
            } as React.CSSProperties
          }
          aria-hidden="true"
        >
          <div className="cameraClipTop">
            <span className="cameraClipName">Camera {drag.cameraIndex}</span>
            <span className="cameraClipTime">{formatSeconds(drag.durationFrames)}</span>
          </div>
          <div className="cameraClipBottom">
            <span className="cameraClipType">{drag.zone === 'others' ? 'Release to take it out' : (draggedRow?.typeInfo.label ?? '')}</span>
          </div>
        </div>
      )}
    </section>
  );
}
