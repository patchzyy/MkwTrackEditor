import { ChevronDown, ChevronRight } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useRemembered } from './useRemembered';

/**
 * The disclosure every hardware-level control in the material editor lives behind.
 *
 * Closed by default and remembered per `storageKey`, so an author who works at the GX level once
 * finds it open the next time, and everybody else never sees a blend factor. Nothing is removed
 * by the simple view — it is all in one of these.
 */
export function AdvancedBlock({
  title = 'Advanced',
  hint,
  storageKey,
  defaultOpen = false,
  children,
}: {
  title?: string;
  /** What is inside, shown as a tooltip on the bar so the user knows whether to open it. */
  hint?: string;
  storageKey: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useRemembered(storageKey, defaultOpen);
  const bodyId = useId();
  return (
    <div className={open ? 'materialAdvanced isOpen' : 'materialAdvanced'} data-category={title}>
      <button
        type="button"
        className="materialAdvancedToggle"
        aria-expanded={open}
        aria-controls={bodyId}
        title={hint}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
        <span className="materialAdvancedTitle">{title}</span>
      </button>
      <div id={bodyId} className="materialAdvancedBody" hidden={!open}>
        {open && children}
      </div>
    </div>
  );
}
