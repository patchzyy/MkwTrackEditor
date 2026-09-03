import { NumberInput } from './NumberInput';

/** Clamps to a 0-255 channel value. */
function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHex(rgb: readonly [number, number, number]): string {
  return `#${rgb.map((channel) => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`;
}

function fromHex(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16) || 0,
    parseInt(value.slice(2, 4), 16) || 0,
    parseInt(value.slice(4, 6), 16) || 0,
  ];
}

/**
 * Colour swatch plus a hex readout, with an optional alpha channel. The visible swatch is a
 * real `<input type="color">` so the OS picker still opens; the hex text is read-only and
 * exists so the value can be seen and copied.
 */
export function ColorField({
  value,
  onChange,
  alpha,
  onChangeAlpha,
  label,
  disabled,
  className,
}: {
  value: readonly [number, number, number];
  onChange: (value: [number, number, number]) => void;
  /** 0-255 alpha. Omit for an opaque colour field. */
  alpha?: number;
  onChangeAlpha?: (alpha: number) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const hex = toHex(value);
  return (
    <div className={className ? `colorField uiColorField ${className}` : 'colorField uiColorField'} role="group" aria-label={label}>
      <span className="uiColorSwatch" style={{ '--ui-color-swatch': hex } as React.CSSProperties}>
        <input
          type="color"
          className="uiColorInput"
          aria-label={label ? `${label} colour` : 'Colour'}
          title={hex.toUpperCase()}
          value={hex}
          disabled={disabled}
          onChange={(event) => onChange(fromHex(event.currentTarget.value))}
        />
        <span className="uiColorHex">{hex.toUpperCase()}</span>
      </span>
      {alpha !== undefined && onChangeAlpha && (
        <NumberInput
          label={label ? `${label} opacity` : 'Opacity'}
          value={alpha}
          min={0}
          max={255}
          integer
          step={1}
          disabled={disabled}
          onChange={(next) => onChangeAlpha(clampChannel(next))}
        />
      )}
    </div>
  );
}
