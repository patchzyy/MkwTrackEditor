import { ChevronDown, ChevronRight } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useInspectorDisclosure, type InspectorDisclosureId } from './inspectorPreferences';

/**
 * A quiet "there is more here" strip inside the inspector. Closed by default, and whichever
 * way the author leaves it is remembered across sessions (see `inspectorPreferences`).
 *
 * Used for the single per-record **Advanced** section and for the per-object **tips**.
 */
export function Disclosure({
  id,
  title,
  hint,
  children,
}: {
  id: InspectorDisclosureId;
  title: string;
  /** Short line shown next to the title while the section is closed. */
  hint?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useInspectorDisclosure(id);
  const bodyId = useId();
  return (
    <section className={`inspectorDisclosure${open ? ' is-open' : ''}`} data-disclosure={id}>
      <button type="button" className="inspectorDisclosureToggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="inspectorDisclosureTitle">{title}</span>
        {hint && !open && <span className="inspectorDisclosureHint">{hint}</span>}
      </button>
      <div id={bodyId} className="inspectorDisclosureBody" hidden={!open}>
        {open && children}
      </div>
    </section>
  );
}

/**
 * The one Advanced section a record gets. Everything technical — raw numbers, ids, reserved
 * bytes, low-level links — goes in here and nowhere else.
 */
export function AdvancedDisclosure({ children, hint = 'raw values and ids' }: { children: ReactNode; hint?: string }) {
  return (
    <Disclosure id="advanced" title="Advanced" hint={hint}>
      {children}
    </Disclosure>
  );
}
