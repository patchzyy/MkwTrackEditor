import type { ReactNode } from 'react';

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/**
 * Horizontal strip of controls. `floating` gives the translucent, blurred look used for the
 * overlays that sit on top of the 3D viewport.
 */
export function Toolbar({
  label,
  floating = false,
  className,
  children,
}: {
  label: string;
  floating?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={classNames('uiToolbar', floating && 'uiToolbar--floating', className)} role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}

/** Groups related toolbar controls so the separators land in sensible places. */
export function ToolbarGroup({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={classNames('uiToolbarGroup', className)}>{children}</div>;
}

/** 1px vertical rule between toolbar groups. */
export function ToolbarSeparator() {
  return <span className="uiToolbarSeparator" role="separator" aria-orientation="vertical" />;
}

/** Pushes everything after it to the right-hand end of the toolbar. */
export function ToolbarSpacer() {
  return <span className="uiToolbarSpacer" aria-hidden="true" />;
}
