import { useRef } from 'react';
import './slider.css';

/**
 * A range slider with an optional value readout. `onBegin` / `onEnd` bracket one drag so a caller
 * can turn it into a single undo step (keyboard presses count as their own tiny drag).
 */
export function Slider({
  value,
  min,
  max,
  step = 1,
  label,
  onChange,
  onBegin,
  onEnd,
  format,
  disabled,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  onChange: (value: number) => void;
  onBegin?: () => void;
  onEnd?: () => void;
  format?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}) {
  const active = useRef(false);
  const begin = () => {
    if (active.current) return;
    active.current = true;
    onBegin?.();
  };
  const end = () => {
    if (!active.current) return;
    active.current = false;
    onEnd?.();
  };
  const fraction = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  return (
    <span className={`crSlider${className ? ` ${className}` : ''}`}>
      <input
        type="range"
        className="crSliderInput"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ ['--fill' as string]: `${fraction * 100}%` }}
        onPointerDown={begin}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={begin}
        onKeyUp={end}
        onBlur={end}
        onChange={(event) => {
          begin();
          onChange(Number(event.currentTarget.value));
          // A change without a pointer or key (assistive tech, tests) closes itself.
          if (!document.activeElement || document.activeElement !== event.currentTarget) end();
        }}
      />
      {format && <span className="crSliderValue">{format(value)}</span>}
    </span>
  );
}
