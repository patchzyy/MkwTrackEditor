import { ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Toggle } from './Toggle';
import { collectDescendantIds, computeTreeWindow, flattenTree, handleTreeKey, type FlatTreeRow, type TreeNode } from './treeModel';

export type { TreeNode } from './treeModel';

const ROW_HEIGHT = 24;
const INDENT_PX = 14;

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export interface TreeViewProps<T> {
  label: string;
  nodes: readonly TreeNode<T>[];
  selectedId?: string | null;
  onSelect?: (id: string, node: TreeNode<T>, options: { additive: boolean }) => void;
  onActivate?: (id: string, node: TreeNode<T>) => void;
  expandedIds?: ReadonlySet<string>;
  onChangeExpanded?: (next: Set<string>) => void;
  /** Renders an extra leading column: `eye` for visibility, `checkbox` for selection. */
  column?: 'none' | 'eye' | 'checkbox';
  onToggleColumn?: (id: string, node: TreeNode<T>, next: boolean) => void;
  /** Right-click hook. Return the menu items you want; `ContextMenu` renders them. */
  onContextMenu?: (id: string, node: TreeNode<T>, event: ReactMouseEvent) => void;
  emptyMessage?: string;
  className?: string;
}

/**
 * Virtualised, keyboard-navigable tree.
 *
 * Only the rows inside the scroll window (plus a small overscan) are in the DOM, so a
 * thousand-node model tree stays at a few dozen elements. Keyboard model is the standard
 * ARIA one; see `treeModel.handleTreeKey`.
 */
export function TreeView<T>({
  label,
  nodes,
  selectedId = null,
  onSelect,
  onActivate,
  expandedIds,
  onChangeExpanded,
  column = 'none',
  onToggleColumn,
  onContextMenu,
  emptyMessage = 'Nothing here yet.',
  className,
}: TreeViewProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [internalExpanded, setInternalExpanded] = useState<Set<string>>(() => new Set());
  const [focusedId, setFocusedId] = useState<string | null>(selectedId);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(320);

  const expanded = expandedIds ?? internalExpanded;
  const rows = useMemo(() => flattenTree(nodes, expanded), [nodes, expanded]);
  const window_ = computeTreeWindow(rows.length, scrollTop, viewportHeight, ROW_HEIGHT);
  const visibleRows = rows.slice(window_.start, window_.end);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (selectedId) setFocusedId(selectedId);
  }, [selectedId]);

  function setExpanded(next: Set<string>) {
    if (expandedIds) onChangeExpanded?.(next);
    else {
      setInternalExpanded(next);
      onChangeExpanded?.(next);
    }
  }

  function toggleExpanded(row: FlatTreeRow<T>, force?: boolean) {
    const next = new Set(expanded);
    const shouldExpand = force ?? !next.has(row.id);
    if (shouldExpand) next.add(row.id);
    else {
      next.delete(row.id);
      for (const id of collectDescendantIds(row.node)) next.delete(id);
    }
    setExpanded(next);
  }

  /** Scrolls a row into view without smooth-scrolling (reduced motion friendly). */
  function revealRow(id: string) {
    const index = rows.findIndex((row) => row.id === id);
    const element = scrollRef.current;
    if (index < 0 || !element) return;
    const top = index * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
  }

  return (
    <div
      ref={scrollRef}
      className={classNames('uiTree', className)}
      role="tree"
      aria-label={label}
      tabIndex={0}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={(event) => {
        const result = handleTreeKey(rows, focusedId, event.key);
        if (!result) return;
        event.preventDefault();
        if (result.expandId) {
          const row = rows.find((candidate) => candidate.id === result.expandId);
          if (row) toggleExpanded(row, true);
        }
        if (result.collapseId) {
          const row = rows.find((candidate) => candidate.id === result.collapseId);
          if (row) toggleExpanded(row, false);
        }
        if (result.focusId) {
          setFocusedId(result.focusId);
          revealRow(result.focusId);
          const row = rows.find((candidate) => candidate.id === result.focusId);
          if (row) onSelect?.(row.id, row.node, { additive: false });
        }
        if (result.activateId) {
          const row = rows.find((candidate) => candidate.id === result.activateId);
          if (row) onActivate?.(row.id, row.node);
        }
        if (result.toggleId && column !== 'none') {
          const row = rows.find((candidate) => candidate.id === result.toggleId);
          if (row) onToggleColumn?.(row.id, row.node, !(row.node.checked ?? true));
        }
      }}
    >
      {rows.length === 0 ? (
        <p className="uiTreeEmpty">{emptyMessage}</p>
      ) : (
        <div className="uiTreeSpacer" style={{ height: `${window_.totalHeight}px` }}>
          <div className="uiTreeRows" style={{ transform: `translateY(${window_.offsetY}px)` }}>
            {visibleRows.map((row) => {
              const selected = row.id === selectedId;
              const checked = row.node.checked ?? true;
              return (
                <div
                  key={row.id}
                  className={classNames('uiTreeRow', selected && 'is-selected', row.id === focusedId && 'is-focused', row.node.disabled && 'is-disabled')}
                  role="treeitem"
                  aria-level={row.depth + 1}
                  aria-selected={selected}
                  aria-expanded={row.hasChildren ? row.expanded : undefined}
                  aria-disabled={row.node.disabled || undefined}
                  style={{ paddingLeft: `${6 + row.depth * INDENT_PX}px` }}
                  onClick={(event) => {
                    if (row.node.disabled) return;
                    setFocusedId(row.id);
                    onSelect?.(row.id, row.node, { additive: event.ctrlKey || event.metaKey });
                  }}
                  onDoubleClick={() => {
                    if (row.node.disabled) return;
                    if (row.hasChildren) toggleExpanded(row);
                    onActivate?.(row.id, row.node);
                  }}
                  onContextMenu={(event) => onContextMenu?.(row.id, row.node, event)}
                >
                  <span className="uiTreeTwisty">
                    {row.hasChildren && (
                      <button
                        type="button"
                        className="uiTreeTwistyButton"
                        tabIndex={-1}
                        aria-label={row.expanded ? `Collapse ${row.node.label}` : `Expand ${row.node.label}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleExpanded(row);
                        }}
                      >
                        {row.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    )}
                  </span>
                  {column === 'eye' && (
                    <button
                      type="button"
                      className={classNames('uiTreeEye', !checked && 'is-hidden')}
                      tabIndex={-1}
                      aria-label={checked ? `Hide ${row.node.label}` : `Show ${row.node.label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleColumn?.(row.id, row.node, !checked);
                      }}
                    >
                      {checked ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                  )}
                  {column === 'checkbox' && (
                    <span className="uiTreeCheckbox" onClick={(event) => event.stopPropagation()}>
                      <Toggle
                        variant="checkbox"
                        hideLabel
                        label={row.node.label}
                        checked={checked}
                        onChange={(next) => onToggleColumn?.(row.id, row.node, next)}
                      />
                    </span>
                  )}
                  {row.node.icon && <span className="uiTreeIcon">{row.node.icon}</span>}
                  <span className="uiTreeLabel" title={row.node.label}>
                    {row.node.label}
                  </span>
                  {row.node.detail && (
                    <span className="uiTreeDetail" title={row.node.detail}>
                      {row.node.detail}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
