import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { KbdSequence } from './Tooltip';

export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  /** Shown as a tooltip-style hint under the label when the item is disabled. */
  disabledReason?: string;
  danger?: boolean;
  onSelect?: () => void;
}

export interface MenuSection {
  id: string;
  /** Small uppercase heading above the group. */
  title?: string;
  items: MenuItem[];
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/**
 * Floating menu surface used by the File menu, the viewport overlay popover and
 * `ContextMenu`. Positions itself inside the window, closes on Escape / outside click, and
 * traps arrow-key focus across the enabled items.
 */
export function MenuSurface({
  anchor,
  sections,
  onClose,
  label,
  align = 'start',
  minWidth = 220,
  children,
}: {
  /** Screen-space rectangle (or point) the menu should hang off. */
  anchor: { top: number; left: number; bottom?: number; right?: number };
  sections?: MenuSection[];
  onClose: () => void;
  label: string;
  align?: 'start' | 'end';
  minWidth?: number;
  children?: ReactNode;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: anchor.bottom ?? anchor.top, left: anchor.left });

  useLayoutEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const preferredLeft = align === 'end' ? (anchor.right ?? anchor.left) - rect.width : anchor.left;
    const left = Math.max(8, Math.min(preferredLeft, window.innerWidth - rect.width - 8));
    const preferredTop = anchor.bottom ?? anchor.top;
    const top = preferredTop + rect.height > window.innerHeight - 8 ? Math.max(8, anchor.top - rect.height - 4) : preferredTop;
    setPosition({ top, left });
  }, [align, anchor.bottom, anchor.left, anchor.right, anchor.top]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!surfaceRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={surfaceRef}
      className="uiMenu"
      role="menu"
      aria-label={label}
      style={{ top: `${position.top}px`, left: `${position.left}px`, minWidth: `${minWidth}px` }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const items = Array.from(surfaceRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
        if (items.length === 0) return;
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        items[(current + delta + items.length) % items.length].focus();
      }}
    >
      {sections?.map((section, sectionIndex) => (
        <div className="uiMenuSection" key={section.id}>
          {sectionIndex > 0 && <div className="uiMenuSeparator" role="separator" />}
          {section.title && <div className="uiMenuSectionTitle">{section.title}</div>}
          {section.items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={classNames('uiMenuItem', item.danger && 'is-danger')}
              disabled={item.disabled}
              title={item.disabled ? item.disabledReason : undefined}
              onClick={() => {
                item.onSelect?.();
                onClose();
              }}
            >
              <span className="uiMenuItemIcon">{item.icon}</span>
              <span className="uiMenuItemLabel">{item.label}</span>
              {item.disabled && item.disabledReason ? (
                <span className="uiMenuItemHint">{item.disabledReason}</span>
              ) : (
                <KbdSequence shortcut={item.shortcut} />
              )}
            </button>
          ))}
        </div>
      ))}
      {children}
    </div>,
    document.body,
  );
}

/**
 * Right-click menu. Render it conditionally from a `{ x, y, items }` state that your
 * `onContextMenu` handler sets.
 */
export function ContextMenu({
  x,
  y,
  sections,
  onClose,
  label = 'Context menu',
}: {
  x: number;
  y: number;
  sections: MenuSection[];
  onClose: () => void;
  label?: string;
}) {
  return <MenuSurface anchor={{ top: y, left: x }} sections={sections} onClose={onClose} label={label} minWidth={180} />;
}
