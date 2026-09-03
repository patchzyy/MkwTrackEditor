import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  applyKeyStep,
  decimalsForStep,
  formatNumberText,
  normalizeNumber,
  parseNumberText,
  scrubValue,
  type NumberRange,
} from './numberScrub';

/** Pixels the pointer must travel before a press turns into a scrub instead of a click. */
const DRAG_THRESHOLD_PX = 3;

export interface NumberInputProps extends NumberRange {
  value: number;
  onChange: (value: number) => void;
  /** Called once when a drag or typing session finishes, for history commits. */
  onCommit?: (value: number) => void;
  step?: number;
  /** Suffix rendered inside the field, e.g. `"°"` or `"u"`. Never part of the value. */
  unit?: string;
  label?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  /** Small letter shown before the value (X / Y / Z in a `VectorInput`). */
  axis?: string;
  placeholder?: string;
  /** Turns off drag-to-scrub for fields where dragging would fight another gesture. */
  scrub?: boolean;
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/**
 * Numeric field with Blender-style behaviour:
 *
 * - drag left/right on the field to scrub the value (Shift = fine, Ctrl/Cmd = coarse),
 * - arrow keys step by `step`, Page Up/Down by ten steps, with the same modifiers,
 * - typing is free-form until blur/Enter, so half-typed values like `-` do not snap to 0,
 * - `unit` renders as a suffix and is never part of the parsed text.
 */
export function NumberInput({
  value,
  onChange,
  onCommit,
  step = 1,
  unit,
  label,
  id,
  disabled,
  className,
  axis,
  placeholder,
  scrub = true,
  ...range
}: NumberInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startValue: number; moved: boolean } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const precision = range.integer ? 0 : range.precision ?? decimalsForStep(step);
  const displayValue = draft ?? formatNumberText(value, step, { ...range, precision });

  function commit(next: number): number {
    const normalized = normalizeNumber(next, step, range);
    onChange(normalized);
    return normalized;
  }

  useEffect(() => {
    if (!scrubbing) return;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };
  }, [scrubbing]);

  function handlePointerDown(event: ReactPointerEvent<HTMLInputElement>) {
    if (!scrub || disabled || event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startValue: value, moved: false };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLInputElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaPx = event.clientX - drag.startX;
    if (!drag.moved) {
      if (Math.abs(deltaPx) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      setScrubbing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    setDraft(null);
    commit(
      scrubValue({
        startValue: drag.startValue,
        deltaPx,
        step,
        modifiers: { fine: event.shiftKey, coarse: event.ctrlKey || event.metaKey },
        ...range,
      }),
    );
  }

  function endDrag(event: ReactPointerEvent<HTMLInputElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.moved) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      setScrubbing(false);
      onCommit?.(value);
    }
  }

  return (
    <span className={classNames('uiNumberInput', scrubbing && 'is-scrubbing', disabled && 'is-disabled', className)}>
      {axis && (
        <span className="uiNumberAxis" data-axis={axis.toLowerCase()} aria-hidden="true">
          {axis}
        </span>
      )}
      <input
        ref={inputRef}
        id={id}
        className="uiNumberField"
        type="text"
        inputMode="decimal"
        role="spinbutton"
        aria-label={label}
        aria-valuenow={Number.isFinite(value) ? value : undefined}
        aria-valuemin={range.min}
        aria-valuemax={range.max}
        aria-valuetext={unit ? `${displayValue}${unit}` : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        value={displayValue}
        title={label}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onChange={(event) => {
          const text = event.currentTarget.value;
          setDraft(text);
          const parsed = parseNumberText(text);
          if (parsed !== null) commit(parsed);
        }}
        onBlur={() => {
          if (draft !== null) {
            const parsed = parseNumberText(draft);
            onCommit?.(parsed !== null ? commit(parsed) : value);
          }
          setDraft(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            const parsed = draft !== null ? parseNumberText(draft) : value;
            setDraft(null);
            onCommit?.(parsed !== null ? commit(parsed) : value);
            return;
          }
          if (event.key === 'Escape') {
            setDraft(null);
            event.currentTarget.blur();
            return;
          }
          const stepped = applyKeyStep(value, event.key, step, { fine: event.shiftKey, coarse: event.ctrlKey || event.metaKey }, range);
          if (stepped === null) return;
          event.preventDefault();
          setDraft(null);
          onChange(stepped);
          onCommit?.(stepped);
        }}
      />
      {unit && (
        <span className="uiNumberUnit" aria-hidden="true">
          {unit}
        </span>
      )}
    </span>
  );
}
