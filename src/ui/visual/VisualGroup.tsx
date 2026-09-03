import type { ReactNode } from 'react';

/** One collapsible section of the Visual-mode left panel. */
export function VisualGroup({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="visualGroup">
      <button type="button" className="visualGroupHeader" aria-expanded={open} onClick={onToggle}>
        <span className="visualGroupChevron" aria-hidden="true">
          {open ? '▼' : '▶'}
        </span>
        {title}
        {count !== undefined && <span className="visualGroupCount">{count}</span>}
      </button>
      {open && <div className="visualGroupBody">{children}</div>}
    </section>
  );
}
