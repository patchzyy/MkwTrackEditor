import { MoreHorizontal } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { IconButton } from '../components/Button';
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

/**
 * The one header every selection gets: what it is, what type it is, one primary action and
 * the overflow menu. No stacks of buttons, no section codes.
 */
export function InspectorHeader({
  title,
  typeName,
  description,
  media,
  badge,
  primary,
  sections,
}: {
  title: ReactNode;
  /** Plain-language record type, shown under the title. */
  typeName?: string;
  /** One line about what this record does. */
  description?: string;
  /** Thumbnail or icon square. */
  media?: ReactNode;
  /** Short status chip next to the type, e.g. "Follows route 3". */
  badge?: ReactNode;
  primary?: { label: string; icon?: ReactNode; onClick: () => void; disabled?: boolean; hint?: string };
  sections: MenuSection[];
}) {
  return (
    <header className="inspectorHeader">
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
        {description && <p className="inspectorHeaderDescription">{description}</p>}
      </div>
      <div className="inspectorHeaderActions">
        {primary && (
          <button
            type="button"
            className="uiButton uiButton--default uiButton--sm inspectorPrimaryAction"
            disabled={primary.disabled}
            title={primary.hint}
            onClick={primary.onClick}
          >
            {primary.icon}
            <span className="uiButtonLabel">{primary.label}</span>
          </button>
        )}
        <InspectorActionsMenu sections={sections} />
      </div>
    </header>
  );
}
