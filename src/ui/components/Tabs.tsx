import { useRef, type ReactNode } from 'react';

export interface TabOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  /** Small count/badge shown after the label. */
  badge?: ReactNode;
  disabled?: boolean;
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/**
 * Underlined tab strip with the standard arrow-key roving-tabindex behaviour. Render the
 * matching panel yourself and give it `role="tabpanel"`.
 */
export function Tabs<T extends string>({
  label,
  value,
  options,
  onChange,
  variant = 'underline',
  className,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<TabOption<T>>;
  onChange: (value: T) => void;
  variant?: 'underline' | 'pill';
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const enabled = options.filter((option) => !option.disabled);

  function move(delta: number) {
    if (enabled.length === 0) return;
    const current = enabled.findIndex((option) => option.value === value);
    const next = enabled[(current + delta + enabled.length) % enabled.length];
    onChange(next.value);
    window.requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
    });
  }

  return (
    <div
      ref={listRef}
      className={classNames('uiTabs', `uiTabs--${variant}`, className)}
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            className={classNames('uiTab', selected && 'active')}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            <span className="uiTabLabel">{option.label}</span>
            {option.badge !== undefined && option.badge !== null && <span className="uiTabBadge">{option.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
