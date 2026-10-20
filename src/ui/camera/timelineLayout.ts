// Pure geometry for the camera timeline: where clips sit, where the ruler ticks go and which
// slot a drag lands in. No React and no DOM, so the maths is unit-tested.

export const FRAMES_PER_SECOND = 60;
/** A clip never gets narrower than this, so a very short shot can still be grabbed. */
export const MIN_CLIP_WIDTH = 64;
export const MIN_PX_PER_FRAME = 0.15;
export const MAX_PX_PER_FRAME = 8;

/** One block on the timeline. `cameraIndex` is -1 for the drop placeholder. */
export interface ClipLayout {
  cameraIndex: number;
  startFrame: number;
  durationFrames: number;
  left: number;
  width: number;
  placeholder?: boolean;
}

export interface ClipSpec {
  cameraIndex: number;
  durationFrames: number;
}

export function clampPxPerFrame(value: number): number {
  return Math.max(MIN_PX_PER_FRAME, Math.min(MAX_PX_PER_FRAME, value));
}

/**
 * Lays clips end to end. Width follows duration, except that very short clips are held to
 * {@link MIN_CLIP_WIDTH}; `frameToX` and `xToFrame` account for that so the playhead never drifts.
 */
export function layoutClips(clips: readonly ClipSpec[], pxPerFrame: number): ClipLayout[] {
  const layouts: ClipLayout[] = [];
  let left = 0;
  let startFrame = 0;
  for (const clip of clips) {
    const duration = Math.max(0, clip.durationFrames);
    const width = Math.max(MIN_CLIP_WIDTH, duration * pxPerFrame);
    layouts.push({ cameraIndex: clip.cameraIndex, startFrame, durationFrames: duration, left, width });
    left += width;
    startFrame += duration;
  }
  return layouts;
}

/** Total width of a layout. */
export function layoutWidth(layouts: readonly ClipLayout[]): number {
  const last = layouts[layouts.length - 1];
  return last ? last.left + last.width : 0;
}

/** Sequence frame to pixel offset from the start of the first clip. Beyond the end it stays linear. */
export function frameToX(layouts: readonly ClipLayout[], frame: number, pxPerFrame: number): number {
  if (layouts.length === 0) return Math.max(0, frame) * pxPerFrame;
  if (frame <= 0) return 0;
  for (const clip of layouts) {
    const end = clip.startFrame + clip.durationFrames;
    if (frame < end) return clip.left + ((frame - clip.startFrame) / clip.durationFrames) * clip.width;
  }
  return layoutWidth(layouts) + (frame - totalFramesOf(layouts)) * pxPerFrame;
}

/** Inverse of {@link frameToX}. Never negative. */
export function xToFrame(layouts: readonly ClipLayout[], x: number, pxPerFrame: number): number {
  if (x <= 0) return 0;
  if (layouts.length === 0) return x / pxPerFrame;
  for (const clip of layouts) {
    if (x < clip.left + clip.width) {
      if (clip.durationFrames <= 0) return clip.startFrame;
      return clip.startFrame + ((x - clip.left) / clip.width) * clip.durationFrames;
    }
  }
  return totalFramesOf(layouts) + (x - layoutWidth(layouts)) / pxPerFrame;
}

export function totalFramesOf(layouts: readonly ClipLayout[]): number {
  const last = layouts[layouts.length - 1];
  return last ? last.startFrame + last.durationFrames : 0;
}

/**
 * Which slot a dragged camera drops into (0 = before the first clip), counting only the clips
 * that stay put. A clip whose centre is left of the pointer is passed.
 */
export function insertionSlot(layouts: readonly ClipLayout[], x: number): number {
  let slot = 0;
  for (const clip of layouts) {
    if (clip.left + clip.width / 2 < x) slot++;
  }
  return slot;
}

/** Puts a placeholder of `durationFrames` into `clips` at `slot` and lays the lot out. */
export function layoutWithPlaceholder(clips: readonly ClipSpec[], slot: number, durationFrames: number, pxPerFrame: number): ClipLayout[] {
  const specs = [...clips];
  const at = Math.max(0, Math.min(specs.length, slot));
  specs.splice(at, 0, { cameraIndex: -1, durationFrames });
  return layoutClips(specs, pxPerFrame).map((layout) => (layout.cameraIndex === -1 ? { ...layout, placeholder: true } : layout));
}

export interface RulerTick {
  frame: number;
  major: boolean;
  label: string | null;
}

/** Seconds between labelled ticks, chosen so labels stay at least `minLabelPx` apart. */
export function pickRulerStepSeconds(pxPerFrame: number, minLabelPx = 56): number {
  const pxPerSecond = pxPerFrame * FRAMES_PER_SECOND;
  for (const step of [1, 2, 5, 10, 15, 30, 60, 120, 300]) {
    if (step * pxPerSecond >= minLabelPx) return step;
  }
  return 600;
}

/**
 * Ruler ticks up to `endFrame`. Major ticks fall on whole seconds and carry a label every
 * `stepSeconds`; minor ticks split each step into fifths (or halves) when there is room.
 */
export function buildRulerTicks(endFrame: number, pxPerFrame: number): RulerTick[] {
  const stepSeconds = pickRulerStepSeconds(pxPerFrame);
  const minorEach = stepSeconds >= 5 ? stepSeconds / 5 : stepSeconds === 1 ? 0.2 : 0.5;
  const minorPx = minorEach * FRAMES_PER_SECOND * pxPerFrame;
  const subdivisions = minorPx >= 8 ? Math.round(stepSeconds / minorEach) : 1;
  const ticks: RulerTick[] = [];
  const limitSeconds = Math.ceil(endFrame / FRAMES_PER_SECOND / stepSeconds) * stepSeconds;
  for (let step = 0; step <= limitSeconds / stepSeconds; step++) {
    const seconds = step * stepSeconds;
    ticks.push({ frame: seconds * FRAMES_PER_SECOND, major: true, label: formatRulerLabel(seconds) });
    if (subdivisions > 1) {
      for (let sub = 1; sub < subdivisions; sub++) {
        ticks.push({ frame: (seconds + (sub * stepSeconds) / subdivisions) * FRAMES_PER_SECOND, major: false, label: null });
      }
    }
  }
  return ticks;
}

function formatRulerLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/** "3.4 s" */
export function formatSeconds(frames: number): string {
  const safe = Number.isFinite(frames) ? Math.max(0, frames) : 0;
  return `${(safe / FRAMES_PER_SECOND).toFixed(1)} s`;
}

/** "3.4 s · 204 f / 12.0 s" (the total is left off when there is none). */
export function formatClock(frames: number, totalFrames: number): string {
  const safe = Number.isFinite(frames) ? Math.max(0, frames) : 0;
  const head = `${formatSeconds(safe)} · ${Math.round(safe)} f`;
  return totalFrames > 0 ? `${head} / ${formatSeconds(totalFrames)}` : head;
}
