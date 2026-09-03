import { NumberInput } from './NumberInput';
import type { NumberRange } from './numberScrub';

export interface Vector3Value {
  x: number;
  y: number;
  z: number;
}

const AXES = ['x', 'y', 'z'] as const;

/**
 * Three scrubbable number fields for an X/Y/Z triple, colour-coded per axis. Keeps the
 * legacy `vectorInputs` class so existing inspector CSS keeps applying.
 */
export function VectorInput({
  value,
  onChange,
  onCommit,
  step = 1,
  unit,
  label,
  disabled,
  className,
  ...range
}: {
  value: Vector3Value;
  onChange: (value: Vector3Value) => void;
  onCommit?: (value: Vector3Value) => void;
  step?: number;
  unit?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
} & NumberRange) {
  return (
    <div className={className ? `vectorInputs uiVectorInput ${className}` : 'vectorInputs uiVectorInput'} role="group" aria-label={label}>
      {AXES.map((axis) => (
        <NumberInput
          key={axis}
          axis={axis.toUpperCase()}
          label={label ? `${label} ${axis.toUpperCase()}` : axis.toUpperCase()}
          value={Number.isFinite(value[axis]) ? value[axis] : 0}
          step={step}
          unit={unit}
          disabled={disabled}
          onChange={(next) => onChange({ ...value, [axis]: next })}
          onCommit={(next) => onCommit?.({ ...value, [axis]: next })}
          {...range}
        />
      ))}
    </div>
  );
}
