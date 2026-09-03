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
  /** One line under the summary saying what is inside, so the user knows whether to open it. */
  hint?: string;
  storageKey: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useRemembered(storageKey, defaultOpen);
  const bodyId = useId();
  return (
    <div className={open ? 'materialAdvanced isOpen' : 'materialAdvanced'}>
      <button
        type="button"
        className="materialAdvancedToggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
        <span className="materialAdvancedTitle">{title}</span>
        {hint && <span className="materialAdvancedHint">{hint}</span>}
      </button>
      <div id={bodyId} className="materialAdvancedBody" hidden={!open}>
        {open && children}
      </div>
    </div>
  );
}
