import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

const OPEN_DELAY_MS = 350;
const GAP = 8;

/** Renders `⌘`-style key hints inside tooltips, menus and the shortcut sheet. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="uiKbd">{children}</kbd>;
}

/**
 * Splits "Ctrl+Shift+Z" into individual `<Kbd>` chips.
 * Falsy input renders nothing so callers can pass an optional shortcut straight through.
 */
export function KbdSequence({ shortcut }: { shortcut?: string | null }) {
  if (!shortcut) return null;
  const parts = shortcut.split(/\s*\+\s*/).filter(Boolean);
  return (
    <span className="uiKbdSequence">
      {parts.map((part, index) => (
        <Kbd key={`${part}-${index}`}>{part}</Kbd>
      ))}
    </span>
  );
}

/**
 * Hover/focus tooltip. Positioned with fixed coordinates in a portal so panels with
 * `overflow: hidden` cannot clip it. Falls back to the native `title` when the tooltip is
 * disabled, and always mirrors the label into `aria-describedby`.
 */
export function Tooltip({
  label,
  shortcut,
  side = 'bottom',
  disabled = false,
  children,
  className,
}: {
  label: ReactNode;
  shortcut?: string | null;
  side?: TooltipSide;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const tooltipId = useId();

  const close = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setPosition(null);
  }, []);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const top =
      side === 'top' ? rect.top - GAP : side === 'bottom' ? rect.bottom + GAP : rect.top + rect.height / 2;
    const left =
      side === 'left' ? rect.left - GAP : side === 'right' ? rect.right + GAP : rect.left + rect.width / 2;
    setPosition({ top, left });
  }, [side]);

  const open = useCallback(
    (immediate: boolean) => {
      if (disabled) return;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (immediate) {
        place();
        return;
      }
      timerRef.current = window.setTimeout(place, OPEN_DELAY_MS);
    },
    [disabled, place],
  );

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (!position) return;
    const dismiss = () => close();
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('pointerdown', dismiss, true);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('pointerdown', dismiss, true);
    };
  }, [close, position]);

  const plainLabel = typeof label === 'string' ? (shortcut ? `${label} (${shortcut})` : label) : undefined;

  return (
    <span
      ref={anchorRef}
      className={className ? `uiTooltipAnchor ${className}` : 'uiTooltipAnchor'}
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return;
        open(false);
      }}
      onPointerLeave={close}
      onFocusCapture={() => open(true)}
      onBlurCapture={close}
      aria-describedby={position ? tooltipId : undefined}
      title={disabled ? plainLabel : undefined}
    >
      {children}
      {position !== null &&
        typeof document !== 'undefined' &&
        createPortal(
          <span
            id={tooltipId}
            role="tooltip"
            className="uiTooltip"
            data-side={side}
            style={{ top: `${position.top}px`, left: `${position.left}px` }}
          >
            <span className="uiTooltipLabel">{label}</span>
            <KbdSequence shortcut={shortcut} />
          </span>,
          document.body,
        )}
    </span>
  );
}
