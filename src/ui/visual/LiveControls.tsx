import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { colorToHex, cssColor, hexToColor } from './colorMath';
import type { RgbColor } from '../../lib/posteffects';

/**
 * Controls for the Environment panel that follow one rule: while the pointer (or a key) is moving
 * the value they call `onPreview` for every change, and when it lets go they call `onCommit`
 * once. The caller turns the first into a viewport preview and the second into one undo step.
 *
 * "Letting go" is the browser's own `change` event, which a range or colour input fires on
 * release (and once per keyboard step), so keyboard and pointer both behave.
 */
function useReleaseEvent(ref: { current: HTMLInputElement | null }, onRelease: () => void) {
  const latest = useRef(onRelease);
  latest.current = onRelease;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handler = () => latest.current();
    element.addEventListener('change', handler);
    return () => element.removeEventListener('change', handler);
  }, [ref]);
}

export function LiveSlider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  label,
  format,
  disabled,
  onPreview,
  onCommit,
  lowLabel,
  highLabel,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Accessible name (the row label is not always the input's label). */
  label: string;
  /** Readout text for the current value. Omit for no readout. */
  format?: (value: number) => string;
  disabled?: boolean;
  /** Called on every change while dragging. */
  onPreview?: (value: number) => void;
  /** Called once when the drag ends. */
  onCommit: (value: number) => void;
  /** Words under the two ends of the track ("Everything" / "Only the brightest"). */
  lowLabel?: string;
  highLabel?: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [local, setLocal] = useState<number | null>(null);
  const localRef = useRef<number | null>(null);
  const shown = local ?? value;
  const fraction = max > min ? Math.max(0, Math.min(1, (shown - min) / (max - min))) : 0;

  useReleaseEvent(ref, () => {
    const final = localRef.current;
    localRef.current = null;
    setLocal(null);
    if (final !== null) onCommit(final);
  });

  return (
    <span className="visualSliderWrap">
      <span className="visualSliderRow">
        <input
          ref={ref}
          className="visualSlider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={shown}
          disabled={disabled}
          aria-label={label}
          style={{ '--fill': `${fraction * 100}%` } as CSSProperties}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            localRef.current = next;
            setLocal(next);
            onPreview?.(next);
          }}
        />
        {format && <output className="visualSliderValue">{format(shown)}</output>}
      </span>
      {(lowLabel || highLabel) && (
        <span className="visualSliderEnds" aria-hidden="true">
          <span>{lowLabel}</span>
          <span>{highLabel}</span>
        </span>
      )}
    </span>
  );
}

/** A colour swatch that is the picker: click it, drag around in the OS colour dialog, close it. */
export function LiveSwatch({
  value,
  label,
  disabled,
  size = 'md',
  showHex = false,
  onPreview,
  onCommit,
}: {
  value: RgbColor;
  label: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** Writes the colour's hex code next to the swatch. */
  showHex?: boolean;
  onPreview?: (value: RgbColor) => void;
  onCommit: (value: RgbColor) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [local, setLocal] = useState<RgbColor | null>(null);
  const localRef = useRef<RgbColor | null>(null);
  const shown = local ?? value;

  useReleaseEvent(ref, () => {
    const final = localRef.current;
    localRef.current = null;
    setLocal(null);
    if (final) onCommit(final);
  });

  const swatch = (
    <span
      className={`visualSwatch${size === 'sm' ? ' isSmall' : ''}${disabled ? ' isDisabled' : ''}`}
      style={{ '--swatch': cssColor(shown) } as CSSProperties}
      title={`${label} (${colorToHex(shown).toUpperCase()})`}
    >
      <input
        ref={ref}
        type="color"
        value={colorToHex(shown)}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const next = hexToColor(event.currentTarget.value);
          localRef.current = next;
          setLocal(next);
          onPreview?.(next);
        }}
      />
    </span>
  );
  if (!showHex) return swatch;
  return (
    <span className="visualSwatchWithHex">
      {swatch}
      <code>{colorToHex(shown).toUpperCase()}</code>
    </span>
  );
}

/** A tiny sun / shadow / fog colour strip, used on the look chips and in the Details summary. */
export function LookStrip({ colors }: { colors: ReadonlyArray<RgbColor | null> }) {
  const shown = colors.filter((color): color is RgbColor => color !== null);
  const gradient =
    shown.length > 1
      ? `linear-gradient(90deg, ${shown.map((color, index) => `${cssColor(color)} ${(index / (shown.length - 1)) * 100}%`).join(', ')})`
      : shown.length === 1
        ? cssColor(shown[0])
        : 'var(--surface-4)';
  return <span className="visualLookStrip" style={{ background: gradient }} aria-hidden="true" />;
}

/** A switch that reads as a sentence: "Fog  [on]". Wrapper so rows stay consistent. */
export function RowNote({ children }: { children: ReactNode }) {
  return <p className="visualRowNote">{children}</p>;
}
