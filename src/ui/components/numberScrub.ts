/**
 * Pure maths behind `NumberInput`'s Blender-style drag-to-scrub and keyboard stepping.
 *
 * Nothing in here touches the DOM, so it can be unit tested directly
 * (`numberScrub.test.ts`).
 */

/** Modifier keys held while scrubbing or stepping. */
export interface ScrubModifiers {
  /** Shift: move in tenths of a step. */
  fine?: boolean;
  /** Ctrl/Cmd: move in tens of a step. */
  coarse?: boolean;
}

export interface NumberRange {
  min?: number;
  max?: number;
  /** Round the result to a whole number. */
  integer?: boolean;
  /** Decimal places for the result. Defaults to the precision implied by `step`. */
  precision?: number;
}

export interface ScrubOptions extends NumberRange {
  /** Value at the moment the drag started. */
  startValue: number;
  /** Horizontal pointer movement since the drag started, in CSS pixels. */
  deltaPx: number;
  /** Value change for one whole step. */
  step: number;
  modifiers?: ScrubModifiers;
  /** Pixels of travel that equal one step. Defaults to 4, like Blender's slider drag. */
  pixelsPerStep?: number;
}

/** Multiplier applied to `step` for the currently held modifiers. */
export function scrubMultiplier(modifiers: ScrubModifiers | undefined): number {
  if (modifiers?.fine) return 0.1;
  if (modifiers?.coarse) return 10;
  return 1;
}

/** Number of decimals implied by a step size (0.25 -> 2, 1 -> 0, 0.001 -> 3). */
export function decimalsForStep(step: number): number {
  if (!Number.isFinite(step) || step === 0) return 0;
  const text = Math.abs(step).toFixed(10).replace(/0+$/, '');
  const dot = text.indexOf('.');
  if (dot < 0) return 0;
  return Math.min(6, text.length - dot - 1);
}

/** Rounds away binary float noise (0.1 + 0.2 -> 0.3) at a fixed number of decimals. */
export function roundToPrecision(value: number, precision: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** Math.max(0, Math.min(12, precision));
  return Math.round(value * factor + (value < 0 ? -1e-9 : 1e-9)) / factor;
}

/** Clamps to `min`/`max` when they are set, leaving the value alone otherwise. */
export function clampNumber(value: number, range: NumberRange | undefined): number {
  let next = value;
  if (range?.min !== undefined && next < range.min) next = range.min;
  if (range?.max !== undefined && next > range.max) next = range.max;
  return next;
}

/** Rounds/clamps a raw number into the shape the field accepts. */
export function normalizeNumber(value: number, step: number, range: NumberRange | undefined): number {
  if (!Number.isFinite(value)) return clampNumber(0, range);
  const precision = range?.integer ? 0 : range?.precision ?? decimalsForStep(step);
  return clampNumber(roundToPrecision(value, precision), range);
}

/**
 * Value for a drag that started at `startValue` and has travelled `deltaPx` pixels.
 * Dragging right increases, dragging left decreases.
 */
export function scrubValue(options: ScrubOptions): number {
  const { startValue, deltaPx, step, modifiers, pixelsPerStep = 4 } = options;
  const pixels = pixelsPerStep > 0 ? pixelsPerStep : 4;
  const effectiveStep = step * scrubMultiplier(modifiers);
  const raw = startValue + (deltaPx / pixels) * effectiveStep;
  return normalizeNumber(raw, effectiveStep, options);
}

/** Steps per key press: 1 step for arrows, 10 steps for Page Up/Down. `null` for other keys. */
export function stepsForKey(key: string): number | null {
  if (key === 'ArrowUp') return 1;
  if (key === 'ArrowDown') return -1;
  if (key === 'PageUp') return 10;
  if (key === 'PageDown') return -10;
  return null;
}

/**
 * Result of an arrow/page key press on a number field, or `null` when the key is not one
 * the field handles.
 */
export function applyKeyStep(
  value: number,
  key: string,
  step: number,
  modifiers: ScrubModifiers | undefined,
  range?: NumberRange,
): number | null {
  const steps = stepsForKey(key);
  if (steps === null) return null;
  const effectiveStep = step * scrubMultiplier(modifiers);
  return normalizeNumber(value + steps * effectiveStep, effectiveStep, range);
}

/**
 * Parses what the user typed. Accepts a comma decimal separator and simple arithmetic-free
 * numbers; returns `null` for anything that is not a finite number so the caller can keep
 * showing the draft text instead of snapping to 0.
 */
export function parseNumberText(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Display text for a value: fixed precision with trailing zeros trimmed. */
export function formatNumberText(value: number, step: number, range?: NumberRange): string {
  if (!Number.isFinite(value)) return '0';
  const precision = range?.integer ? 0 : range?.precision ?? decimalsForStep(step);
  if (precision === 0) return String(Math.round(value));
  const fixed = value.toFixed(precision);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}
