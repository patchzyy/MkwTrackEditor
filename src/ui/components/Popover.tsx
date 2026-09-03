import { useEffect, useRef, useState, type ReactNode } from 'react';

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/**
 * Small anchored panel that opens next to its trigger and closes on Escape or an outside
 * click. Unlike `MenuSurface` it renders in place (not in a portal) so it inherits the
 * viewport's stacking context and can safely sit over the canvas.
 */
export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'end',
  label,
  className,
}: {
  /** Render prop for the button. `open` lets you show a pressed state. */
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'end';
  label: string;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;

  function setOpen(next: boolean) {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  }

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className={classNames('uiPopoverRoot', className)}>
      {trigger({ open: isOpen, toggle: () => setOpen(!isOpen) })}
      {isOpen && (
        <div className="uiPopover" data-align={align} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}
