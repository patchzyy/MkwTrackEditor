import { ChevronDown } from 'lucide-react';
import type { ReactNode, SelectHTMLAttributes } from 'react';

export interface SelectOption<T extends string | number> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/**
 * Native `<select>` with the editor's chrome. Native is deliberate: it keeps keyboard and
 * screen-reader behaviour correct and copes with the several-hundred-entry object lists.
 * `options` is optional so callers can pass `<option>`/`<optgroup>` children instead.
 */
export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
  size = 'md',
  className,
  children,
  ...rest
}: {
  label: string;
  value: T;
  options?: ReadonlyArray<SelectOption<T>>;
  onChange: (value: string) => void;
  size?: 'sm' | 'md';
  className?: string;
  children?: ReactNode;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'size' | 'children'>) {
  return (
    <span className={classNames('uiSelect', `uiSelect--${size}`, rest.disabled && 'is-disabled', className)}>
      <select
        className="referenceSelect uiSelectField"
        aria-label={label}
        title={label}
        value={String(value)}
        onChange={(event) => onChange(event.currentTarget.value)}
        {...rest}
      >
        {options?.map((option) => (
          <option key={String(option.value)} value={String(option.value)} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown className="uiSelectChevron" size={13} aria-hidden="true" />
    </span>
  );
}
