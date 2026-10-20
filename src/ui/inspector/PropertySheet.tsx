import { ChevronDown, ChevronRight, Info, Search, X } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Tooltip } from '../components/Tooltip';
import { useInspectorDisclosure } from './inspectorPreferences';
import './propertySheet.css';

/**
 * The shared "Details" look: collapsible categories holding two-column property rows, an
 * Unreal-style search box on top, and one empty state.
 *
 * Every inspector (KMP records, cameras, meshes, track settings) renders its rows with the
 * `.propertyGrid label`, `Field` or `PropertyRow` markup. {@link DetailsSheet} filters all of
 * them the same way, so a row never has to opt in to being searchable.
 */

const DetailsQueryContext = createContext('');

/** The current "Search details" text, lower-cased and trimmed. Empty means no filtering. */
export function useDetailsQuery(): string {
  return useContext(DetailsQueryContext);
}

/** Every markup flavour a property row comes in. */
const ROW_SELECTOR = '.propertyGrid > label, .propertyGrid > .uiField, .propertyGrid > .cameraField, .advancedDetailsBody > label, .propRow, .uiField, .cameraField';
const LABEL_SELECTOR = ':scope > .propRowLabel, :scope > .uiFieldLabel, :scope > .cameraFieldLabel';

function rowLabel(row: Element): string {
  const named = row.querySelector(LABEL_SELECTOR);
  if (named) return named.textContent ?? '';
  let text = '';
  for (const node of Array.from(row.childNodes)) if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
  if (text.trim()) return text;
  const first = row.firstElementChild;
  if (first && first.querySelector('input, select, button, textarea') === null) return first.textContent ?? '';
  return row.getAttribute('aria-label') ?? row.textContent ?? '';
}

/**
 * Hides the rows and categories that do not match `query`. Works on class names only (no
 * attribute or child changes React owns), so a re-render never fights it. Returns whether the
 * sheet has any rows at all, which decides if the search box is worth showing.
 */
export function applyDetailsFilter(root: HTMLElement, query: string): boolean {
  const rows = Array.from(root.querySelectorAll(ROW_SELECTOR));
  const searching = query.length > 0;
  root.dataset.searching = searching ? 'true' : 'false';
  for (const row of rows) row.classList.toggle('is-filtered', searching && !rowLabel(row).toLowerCase().includes(query));
  const categories = Array.from(root.querySelectorAll('.detailsCategory'));
  // Deepest first, so an outer category sees what its inner ones decided.
  for (const category of categories.reverse()) {
    if (!searching) {
      category.classList.remove('is-filtered');
      continue;
    }
    const nameMatches = (category.getAttribute('data-category') ?? '').toLowerCase().includes(query);
    if (nameMatches) {
      for (const row of category.querySelectorAll(ROW_SELECTOR)) row.classList.remove('is-filtered');
      category.classList.remove('is-filtered');
      continue;
    }
    const hasMatch = Array.from(category.querySelectorAll(ROW_SELECTOR)).some((row) => !row.classList.contains('is-filtered'));
    category.classList.toggle('is-filtered', !hasMatch);
  }
  return rows.length > 0;
}

/**
 * Wraps a whole Details panel: shows the search box (when there is anything to search) and
 * keeps the filter applied as the panel's content changes.
 */
export function DetailsSheet({ children, className }: { children: ReactNode; className?: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState('');
  const [searchable, setSearchable] = useState(false);
  const query = text.trim().toLowerCase();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const run = () => {
      frame = 0;
      setSearchable(applyDetailsFilter(root, query));
    };
    run();
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(run);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [query]);

  return (
    <DetailsQueryContext.Provider value={query}>
      <div ref={rootRef} className={className ? `detailsSheet ${className}` : 'detailsSheet'} data-searching="false">
        {(searchable || text !== '') && (
          <div className="detailsSearch">
            <Search size={13} aria-hidden="true" />
            <input
              type="text"
              value={text}
              placeholder="Search details"
              aria-label="Search details"
              spellCheck={false}
              onChange={(event) => setText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && text) {
                  event.stopPropagation();
                  setText('');
                }
              }}
            />
            {text && (
              <button type="button" className="detailsSearchClear" aria-label="Clear search" onClick={() => setText('')}>
                <X size={12} />
              </button>
            )}
          </div>
        )}
        {children}
        {query && <p className="detailsSearchNone">Nothing matches that search.</p>}
      </div>
    </DetailsQueryContext.Provider>
  );
}

/**
 * A full-width collapsible bar with its rows underneath. Whether it is open is remembered per
 * name. A category whose children render nothing hides itself, so callers can wrap a group of
 * conditional sections without checking whether any of them applies.
 */
export function DetailsCategory({
  name,
  help,
  badge,
  defaultOpen = true,
  className,
  children,
}: {
  name: string;
  /** Hover text for the small info icon next to the name. */
  help?: ReactNode;
  /** Short status shown at the right end of the bar, e.g. "2 errors". */
  badge?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useInspectorDisclosure(`category:${name}`, defaultOpen);
  return (
    <section className={`detailsCategory${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`} data-category={name}>
      <button type="button" className="detailsCategoryBar" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
        <span className="detailsCategoryName">{name}</span>
        {help && (
          <Tooltip label={help} side="left" className="detailsCategoryHelp">
            <Info size={12} aria-label="About this section" />
          </Tooltip>
        )}
        {badge && <span className="detailsCategoryBadge">{badge}</span>}
      </button>
      <div className="detailsCategoryBody">{children}</div>
    </section>
  );
}

/**
 * One property row: label on the left (hover for `help`), control on the right, optional unit
 * after the control. Renders a `<label>` so a click on the name focuses the control.
 */
export function PropertyRow({
  label,
  help,
  unit,
  wide = false,
  className,
  children,
}: {
  label: ReactNode;
  /** Plain-language explanation, shown as a tooltip on the label. */
  help?: ReactNode;
  /** Unit text placed after the control, e.g. "frames". */
  unit?: string;
  /** Stacks the control under the label (three-axis rows). */
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const text = typeof label === 'string' ? label : undefined;
  const name = (
    <span className="propRowLabelText" title={help ? undefined : text}>
      {label}
    </span>
  );
  return (
    <label className={`propRow${wide ? ' isWide' : ''}${help ? ' hasHelp' : ''}${className ? ` ${className}` : ''}`}>
      <span className="propRowLabel">
        {help ? (
          <Tooltip label={help} side="left" className="propRowTip">
            {name}
          </Tooltip>
        ) : (
          name
        )}
      </span>
      <span className="propRowControl">
        {children}
        {unit && <span className="propRowUnit">{unit}</span>}
      </span>
    </label>
  );
}

/** The centred "nothing here yet" hint a Details panel shows when nothing is selected. */
export function DetailsEmpty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="detailsEmpty">
      {icon && <span className="detailsEmptyIcon">{icon}</span>}
      <p>{children}</p>
    </div>
  );
}
