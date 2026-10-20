import { MoreHorizontal } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { IconButton } from '../components/Button';
import { Tooltip } from '../components/Tooltip';
import { MenuSurface, type MenuSection } from '../components/Menu';

/**
 * The "⋯" overflow menu. Everything destructive or rare lives in here so the inspector body
 * never grows a column of buttons.
 */
export function InspectorActionsMenu({ sections, label = 'Actions' }: { sections: MenuSection[]; label?: string }) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const usable = sections.filter((section) => section.items.length > 0);
  const rect = open ? anchorRef.current?.getBoundingClientRect() : undefined;
  return (
    <>
      <IconButton
        ref={anchorRef}
        size="sm"
        variant="ghost"
        className="inspectorActionsButton"
        icon={<MoreHorizontal size={15} />}
        tooltip={label}
        tooltipSide="left"
        disabled={usable.length === 0}
        disabledReason="Nothing to do with this selection"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      />
      {open && rect && (
        <MenuSurface
          anchor={{ top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right }}
          align="end"
          sections={usable}
          label={label}
          minWidth={210}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export interface InspectorHeaderAction {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Why it is disabled; replaces the label in the tooltip. */
  disabledReason?: string;
  danger?: boolean;
}

/**
 * The one header every selection gets, in every mode: icon tile, name, what kind of thing it
 * is, and a few icon actions on the right (rare ones go in the "..." menu). What the record
 * does is a tooltip on the name, never a paragraph.
 */
export function InspectorHeader({
  title,
  typeName,
  description,
  media,
  badge,
  chips,
  primary,
  actions,
  sections,
}: {
  title: ReactNode;
  /** Plain-language kind, shown under the name in sentence case. */
  typeName?: string;
  /** What this record does. Shown as a tooltip on the name and tile. */
  description?: string;
  /** Thumbnail or icon square. */
  media?: ReactNode;
  /** Short status text next to the kind, e.g. "Follows route 3". */
  badge?: ReactNode;
  /** Small facts shown as pills under the header. Falsy entries are dropped. */
  chips?: Array<string | null | false | undefined>;
  /** The one action worth a button of its own; rendered as an icon button like `actions`. */
  primary?: { label: string; icon?: ReactNode; onClick: () => void; disabled?: boolean; hint?: string };
  actions?: InspectorHeaderAction[];
  sections: MenuSection[];
}) {
  const identity = (
    <>
      {media && <div className="inspectorHeaderMedia">{media}</div>}
      <div className="inspectorHeaderCopy">
        <h3 className="inspectorHeaderTitle" title={typeof title === 'string' ? title : undefined}>
          {title}
        </h3>
        {(typeName || badge) && (
          <p className="inspectorHeaderMeta">
            {typeName && <span className="inspectorHeaderType">{typeName}</span>}
            {badge && <span className="inspectorHeaderBadge">{badge}</span>}
          </p>
        )}
      </div>
    </>
  );
  const all: InspectorHeaderAction[] = [
    ...(primary ? [{ id: 'primary', label: primary.label, icon: primary.icon, onClick: primary.onClick, disabled: primary.disabled, disabledReason: primary.hint } as InspectorHeaderAction] : []),
    ...(actions ?? []),
  ];
  const shownChips = (chips ?? []).filter((chip): chip is string => typeof chip === 'string' && chip.length > 0);
  return (
    <header className="inspectorHeader">
      <div className="inspectorHeaderRow">
        {description ? (
          <Tooltip label={description} side="left" className="inspectorHeaderIdentity">
            {identity}
          </Tooltip>
        ) : (
          <div className="inspectorHeaderIdentity">{identity}</div>
        )}
        <div className="inspectorHeaderActions">
          {all.map((action) => (
            <IconButton
              key={action.id}
              size="sm"
              variant="ghost"
              className={action.danger ? 'is-danger' : undefined}
              icon={action.icon}
              tooltip={action.label}
              tooltipSide="bottom"
              disabled={action.disabled}
              disabledReason={action.disabledReason}
              onClick={action.onClick}
            />
          ))}
          {sections.some((section) => section.items.length > 0) && <InspectorActionsMenu sections={sections} />}
        </div>
      </div>
      {shownChips.length > 0 && (
        <div className="inspectorHeaderChips">
          {shownChips.map((chip) => (
            <span className="inspectorHeaderChip" key={chip}>
              {chip}
            </span>
          ))}
        </div>
      )}
    </header>
  );
}
