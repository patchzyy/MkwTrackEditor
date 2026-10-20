import { useId, type ReactNode } from 'react';
import { Tooltip } from './Tooltip';

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/**
 * One labelled row in a property grid: label on the left, control on the right. `help` is a
 * tooltip on the label, not a paragraph. Use inside `.propertyGrid` (or any `FieldGroup`).
 *
 * `Field` renders a `<label>` when the control is a single form element (the common case)
 * and falls back to a `<div role="group">` when `asGroup` is set, so multi-control rows such
 * as `VectorInput` do not steal the click from the first input.
 */
export function Field({
  label,
  help,
  hint,
  asGroup = false,
  htmlFor,
  className,
  children,
}: {
  label: ReactNode;
  /** Longer explanation, shown as a tooltip when the label is hovered. */
  help?: ReactNode;
  /** Short right-aligned hint next to the label (units, ranges). */
  hint?: ReactNode;
  asGroup?: boolean;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  const labelText = typeof label === 'string' ? label : undefined;
  const hasHelp = help !== undefined && help !== null && help !== '';
  const name = (
    <span className="uiFieldLabelText" title={hasHelp ? undefined : labelText}>
      {label}
    </span>
  );
  const content = (
    <>
      <span className={classNames('uiFieldLabel', hasHelp && 'hasHelp')}>
        {hasHelp ? (
          <Tooltip label={help} side="left" className="uiFieldTip">
            {name}
          </Tooltip>
        ) : (
          name
        )}
        {hint !== undefined && hint !== null && hint !== '' && <span className="uiFieldHint">{hint}</span>}
      </span>
      <span className="uiFieldControl">{children}</span>
    </>
  );
  if (asGroup) {
    return (
      <div className={classNames('uiField', className)} role="group" aria-label={labelText}>
        {content}
      </div>
    );
  }
  return (
    <label className={classNames('uiField', className)} htmlFor={htmlFor}>
      {content}
    </label>
  );
}

/** Horizontal run of controls that share one row (buttons, a control plus a unit switch). */
export function FieldRow({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={classNames('uiFieldRow', className)}>{children}</div>;
}

/**
 * Container for a run of `Field`s. Keeps the legacy `propertyGrid` class so the inspector
 * sections owned by other engineers keep their current alignment.
 */
export function FieldGroup({ title, className, children }: { title?: ReactNode; className?: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className={classNames('propertyGrid', 'uiFieldGroup', className)} role="group" aria-labelledby={title ? id : undefined}>
      {title && (
        <div className="detailsSectionHeader" id={id}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}
