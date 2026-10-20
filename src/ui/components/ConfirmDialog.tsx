import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';

/**
 * A small modal question: a title, a sentence, an optional list, and up to three buttons. Escape or
 * a click on the scrim picks `onCancel`; the primary button is focused first so Enter confirms.
 */
export function ConfirmDialog({
  title,
  children,
  items,
  confirmLabel,
  cancelLabel = 'Cancel',
  extraLabel,
  onConfirm,
  onCancel,
  onExtra,
}: {
  title: string;
  children?: ReactNode;
  /** A short list under the sentence (the problems found). */
  items?: readonly string[];
  confirmLabel: string;
  cancelLabel?: string;
  /** An optional third choice between Cancel and the primary button ("Show me"). */
  extraLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onExtra?: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel]);
  return (
    <div className="uiShortcutScrim" onPointerDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="uiConfirm" role="alertdialog" aria-modal="true" aria-label={title} data-confirm-dialog>
        <h2>{title}</h2>
        {children && <p>{children}</p>}
        {items && items.length > 0 && (
          <ul>
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        <div className="uiConfirmActions">
          <Button onClick={onCancel}>{cancelLabel}</Button>
          {extraLabel && onExtra && <Button onClick={onExtra}>{extraLabel}</Button>}
          <Button ref={confirmRef} variant="primary" onClick={onConfirm} data-confirm-ok>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
