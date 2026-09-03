import { Check, Minus } from 'lucide-react';
import { useId, type ReactNode } from 'react';

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/**
 * On/off control. `variant="switch"` is the pill used in property rows; `variant="checkbox"`
 * is the compact box used in lists and visibility popovers.
 */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  indeterminate = false,
  disabled = false,
  variant = 'switch',
  hideLabel = false,
  className,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  indeterminate?: boolean;
  disabled?: boolean;
  variant?: 'switch' | 'checkbox';
  hideLabel?: boolean;
  className?: string;
  id?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const labelText = typeof label === 'string' ? label : undefined;
  return (
    <label className={classNames('uiToggle', `uiToggle--${variant}`, disabled && 'is-disabled', className)} htmlFor={inputId}>
      <input
        id={inputId}
        className="uiToggleInput"
        type="checkbox"
        role={variant === 'switch' ? 'switch' : undefined}
        checked={checked}
        disabled={disabled}
        aria-label={hideLabel ? labelText : undefined}
        aria-checked={indeterminate ? 'mixed' : checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="uiToggleVisual" aria-hidden="true">
        {variant === 'checkbox' && (indeterminate ? <Minus size={11} /> : checked ? <Check size={11} /> : null)}
      </span>
      {!hideLabel && (
        <span className="uiToggleCopy">
          <span className="uiToggleLabel" title={labelText}>
            {label}
          </span>
          {description && <span className="uiToggleDescription">{description}</span>}
        </span>
      )}
    </label>
  );
}
