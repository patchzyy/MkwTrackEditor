import type { ReactNode } from 'react';
import { Tooltip, type TooltipSide } from './Tooltip';

export interface SegmentedOption<T extends string> {
  value: T;
  /** Visible label. Omit for an icon-only segment; `tooltip` then supplies the a11y name. */
  label?: ReactNode;
  icon?: ReactNode;
  tooltip?: string;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/**
 * Mutually exclusive choice rendered as one joined pill: viewport tools, view modes, the
 * editor-mode switch. Keeps the legacy `segmented` class so existing CSS and call sites
 * continue to work.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'md',
  tooltipSide = 'bottom',
  className,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  tooltipSide?: TooltipSide;
  className?: string;
}) {
  return (
    <div className={classNames('segmented', 'uiSegmented', `uiSegmented--${size}`, className)} role="group" aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value;
        const tooltipText = option.disabled && option.disabledReason ? option.disabledReason : option.tooltip;
        const button = (
          <button
            key={option.value}
            type="button"
            className={classNames('uiSegment', selected && 'active', !option.label && 'uiSegment--iconOnly')}
            aria-pressed={selected}
            aria-label={option.label ? undefined : option.tooltip}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            {option.label !== undefined && <span className="uiSegmentLabel">{option.label}</span>}
          </button>
        );
        if (!tooltipText) return <span key={option.value} className="uiSegmentSlot">{button}</span>;
        return (
          <Tooltip
            key={option.value}
            label={tooltipText}
            shortcut={option.disabled ? undefined : option.shortcut}
            side={tooltipSide}
            className="uiSegmentSlot"
          >
            {button}
          </Tooltip>
        );
      })}
    </div>
  );
}
