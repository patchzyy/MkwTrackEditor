import { ChevronDown, ChevronRight } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { IconButton } from './Button';

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/**
 * Dock panel shell: a fixed header strip plus a scrolling body. Panels never grow their own
 * scrollbar around the header, so headers stay pinned like they do in Unreal / Blender.
 */
export function Panel({
  className,
  children,
  ...rest
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={classNames('uiPanel', className)} {...rest}>
      {children}
    </section>
  );
}

/**
 * Panel header: optional icon, title, optional subtitle/count, and a right-aligned actions
 * slot. Pass `collapsed`/`onToggleCollapsed` to get the disclosure triangle.
 */
export function PanelHeader({
  icon,
  title,
  subtitle,
  actions,
  collapsed,
  onToggleCollapsed,
  className,
  id,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  className?: string;
  id?: string;
}) {
  const collapsible = onToggleCollapsed !== undefined;
  const titleText = typeof title === 'string' ? title : undefined;
  return (
    <header className={classNames('uiPanelHeader', collapsed && 'is-collapsed', className)} id={id}>
      {collapsible && (
        <button
          type="button"
          className="uiPanelDisclosure"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${titleText ?? 'panel'}` : `Collapse ${titleText ?? 'panel'}`}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
      )}
      {icon && <span className="uiPanelHeaderIcon">{icon}</span>}
      <h2 className="uiPanelTitle" title={titleText}>
        {title}
      </h2>
      {subtitle !== undefined && subtitle !== null && subtitle !== '' && (
        <span className="uiPanelSubtitle" title={typeof subtitle === 'string' ? subtitle : undefined}>
          {subtitle}
        </span>
      )}
      {actions && <div className="uiPanelActions">{actions}</div>}
    </header>
  );
}

/** Scrolling body of a `Panel`. */
export function PanelBody({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={classNames('uiPanelBody', className)} {...rest}>
      {children}
    </div>
  );
}

/**
 * Collapsible group inside a panel body: a small uppercase header with a disclosure
 * triangle and an optional actions slot. Remembers nothing; the caller owns the state when
 * it passes `open`/`onToggle`.
 */
export function PanelSection({
  title,
  icon,
  actions,
  defaultOpen = true,
  open,
  onToggle,
  children,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (next: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = open ?? internalOpen;
  const bodyId = useId();
  return (
    <section className={classNames('uiPanelSection', !isOpen && 'is-collapsed', className)}>
      <div className="uiPanelSectionHeader">
        <button
          type="button"
          className="uiPanelSectionToggle"
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={() => {
            if (open === undefined) setInternalOpen((value) => !value);
            onToggle?.(!isOpen);
          }}
        >
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {icon && <span className="uiPanelSectionIcon">{icon}</span>}
          <span className="uiPanelSectionTitle">{title}</span>
        </button>
        {actions && <div className="uiPanelSectionActions">{actions}</div>}
      </div>
      <div id={bodyId} className="uiPanelSectionBody" hidden={!isOpen}>
        {children}
      </div>
    </section>
  );
}

/**
 * Slim vertical rail shown in place of a collapsed dock panel. Keeps the dock's width
 * reserved so collapsing never shifts the viewport contents around.
 */
export function PanelRail({
  title,
  icon,
  onExpand,
  side = 'left',
  children,
}: {
  title: string;
  icon: ReactNode;
  onExpand: () => void;
  side?: 'left' | 'right';
  children?: ReactNode;
}) {
  return (
    <div className="uiPanelRail" data-side={side}>
      <IconButton icon={icon} tooltip={`Show ${title}`} tooltipSide={side === 'left' ? 'right' : 'left'} onClick={onExpand} />
      <span className="uiPanelRailLabel" aria-hidden="true">
        {title}
      </span>
      {children}
    </div>
  );
}
