import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Tooltip, type TooltipSide } from './Tooltip';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

interface BaseButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. Use 16px lucide icons for `md`, 14px for `sm`. */
  icon?: ReactNode;
  /** Pressed / selected look, mirrored to `aria-pressed`. */
  active?: boolean;
  /** Tooltip text. Also used as the accessible name when there is no visible label. */
  tooltip?: string;
  /** Keyboard shortcut shown in the tooltip, e.g. `"Ctrl+Z"`. */
  shortcut?: string;
  tooltipSide?: TooltipSide;
  /** Explains a disabled button. Replaces `tooltip` while `disabled` is true. */
  disabledReason?: string;
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/**
 * Text (optionally icon + text) button. `className` is appended, so legacy class names such
 * as `button` keep working while call sites migrate.
 */
export const Button = forwardRef<HTMLButtonElement, BaseButtonProps>(function Button(
  {
    variant = 'default',
    size = 'md',
    icon,
    active,
    tooltip,
    shortcut,
    tooltipSide = 'bottom',
    disabledReason,
    className,
    children,
    disabled,
    type,
    'aria-label': ariaLabel,
    ...rest
  },
  ref,
) {
  const label = disabled && disabledReason ? disabledReason : tooltip;
  const button = (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classNames('uiButton', `uiButton--${variant}`, `uiButton--${size}`, active && 'is-active', className)}
      aria-pressed={active === undefined ? undefined : active}
      aria-label={ariaLabel ?? (children ? undefined : tooltip)}
      disabled={disabled}
      {...rest}
    >
      {icon}
      {children !== undefined && children !== null && children !== false && <span className="uiButtonLabel">{children}</span>}
    </button>
  );
  if (!label) return button;
  // A disabled button emits no pointer events, so the tooltip has to sit on the wrapper.
  return (
    <Tooltip label={label} shortcut={disabled ? undefined : shortcut} side={tooltipSide} className={disabled ? 'uiTooltipAnchor--overlay' : undefined}>
      {button}
    </Tooltip>
  );
});

/** Square icon-only button. `tooltip` is required so it always has an accessible name. */
export const IconButton = forwardRef<HTMLButtonElement, Omit<BaseButtonProps, 'children' | 'icon'> & { icon: ReactNode; tooltip: string }>(
  function IconButton({ className, icon, ...rest }, ref) {
    return (
      <Button ref={ref} className={classNames('uiIconButton', className)} icon={icon} {...rest} />
    );
  },
);

/**
 * Viewport / toolbar tool button. Same shape as `IconButton` but styled for the translucent
 * toolbar surfaces and defaults to a `top`-side tooltip.
 */
export const ToolButton = forwardRef<HTMLButtonElement, Omit<BaseButtonProps, 'children'> & { tooltip: string }>(function ToolButton(
  { className, tooltipSide = 'bottom', ...rest },
  ref,
) {
  return <Button ref={ref} className={classNames('uiToolButton', className)} tooltipSide={tooltipSide} {...rest} />;
});
