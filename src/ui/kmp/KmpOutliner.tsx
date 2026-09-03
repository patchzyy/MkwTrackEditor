import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, TriangleAlert } from 'lucide-react';
import {
  expansionPathForEntity,
  filterKmpOutliner,
  flattenKmpOutliner,
  outlinerRangeSelection,
  type KmpOutlinerNode,
} from './kmpOutlinerModel';
import { outlinerSection, type KmpVisibilityKey, type KmpVisibilityState } from './kmpSections';

export interface KmpOutlinerProps {
  sections: KmpOutlinerNode[];
  selectedId: string | null;
  selectedIds: readonly string[];
  visibility: KmpVisibilityState;
  onChangeVisibility: (key: KmpVisibilityKey, visible: boolean) => void;
  /** Replaces the selection with `ids`, or adds to it when `additive`. */
  onSelect: (ids: string[], options?: { additive?: boolean }) => void;
  /** Double-click: point the viewport camera at the row. */
  onFrame: (entityId: string) => void;
  /** Rendered under the tree; the mode puts the contextual action buttons there. */
  footer?: React.ReactNode;
}

/**
 * Left rail for KMP mode: the whole track as a tree of sections, groups and points.
 *
 * Rows are friendly names only — no section codes. Clicking a group or section row selects
 * everything under it, so "move this whole path group" is one click plus a drag. Search,
 * expansion and the shift-click anchor are local state; the selection itself belongs to the
 * editor.
 */
export function KmpOutliner({
  sections,
  selectedId,
  selectedIds,
  visibility,
  onChangeVisibility,
  onSelect,
  onFrame,
  footer,
}: KmpOutlinerProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set<string>());
  const anchorRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => filterKmpOutliner(sections, query), [sections, query]);
  // A search shows every match without asking the user to expand anything.
  const searching = query.trim().length > 0;
  const effectiveExpanded = useMemo(() => {
    if (!searching) return expanded;
    const all = new Set<string>();
    const walk = (node: KmpOutlinerNode) => {
      if (node.children.length > 0) all.add(node.id);
      for (const child of node.children) walk(child);
    };
    for (const section of filtered) walk(section);
    return all;
  }, [expanded, filtered, searching]);

  const rows = useMemo(() => flattenKmpOutliner(filtered, effectiveExpanded), [filtered, effectiveExpanded]);

  // Opening a selection made in the viewport, so the outliner always shows what is selected.
  useEffect(() => {
    if (!selectedId) return;
    const path = expansionPathForEntity(sections, selectedId);
    if (path.length === 0) return;
    setExpanded((current) => {
      if (path.every((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of path) next.add(id);
      return next;
    });
  }, [sections, selectedId]);

  // Keep the selected row on screen when the selection changes elsewhere.
  useEffect(() => {
    if (!selectedId) return;
    const element = listRef.current?.querySelector<HTMLElement>(`[data-entity-id="${cssEscape(selectedId)}"]`);
    element?.scrollIntoView({ block: 'nearest' });
  }, [rows, selectedId]);

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleRowClick(node: KmpOutlinerNode, event: React.MouseEvent) {
    if (node.entityIds.length === 0) {
      // A section with nothing in it: expand/collapse is the only sensible action.
      if (node.children.length > 0) toggleExpanded(node.id);
      return;
    }
    if (event.shiftKey && anchorRef.current) {
      const ids = outlinerRangeSelection(rows, anchorRef.current, node.id);
      if (ids.length > 0) {
        onSelect(ids, { additive: false });
        return;
      }
    }
    anchorRef.current = node.id;
    onSelect(node.entityIds, { additive: event.ctrlKey || event.metaKey });
  }

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const totalCount = sections.reduce((sum, section) => sum + section.count, 0);

  return (
    <aside className="placeAssetsPanel kmpPanel">
      <div className="panelHeader placeAssetsHeader kmpPanelHeader">
        <div>
          <h2>Track data</h2>
          <p className="panelSubtle">
            {totalCount === 0 ? 'Load a track to see its layout data.' : `${totalCount} item${totalCount === 1 ? '' : 's'} across ${sections.filter((section) => section.count > 0).length} sections.`}
          </p>
        </div>
        <div className="kmpTreeToolbar">
          <button
            type="button"
            className="button"
            title="Expand every section"
            onClick={() => {
              const all = new Set<string>();
              const walk = (node: KmpOutlinerNode) => {
                if (node.children.length > 0) all.add(node.id);
                for (const child of node.children) walk(child);
              };
              for (const section of sections) walk(section);
              setExpanded(all);
            }}
          >
            Expand
          </button>
          <button type="button" className="button" title="Collapse every section" onClick={() => setExpanded(new Set())}>
            Collapse
          </button>
        </div>
      </div>

      <div className="kmpPanelBody">
        <input
          className="browserSearchInput kmpFilter"
          type="search"
          placeholder="Search the track (name, position, section)"
          aria-label="Search track data"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />

        <div className="kmpTree" role="tree" aria-label="Track data" ref={listRef}>
          {rows.length === 0 && <p className="kmpTreeEmpty">Nothing matches that search.</p>}
          {rows.map((row) => {
            const { node } = row;
            const isSelected = node.entityId !== null ? selectedSet.has(node.entityId) : node.entityIds.length > 0 && node.entityIds.every((id) => selectedSet.has(id));
            const isPrimary = node.entityId !== null && node.entityId === selectedId;
            const layers = node.kind === 'section' ? outlinerSection(node.section).visibility : [];
            const hidden = layers.length > 0 && layers.every((key) => visibility[key] === false);
            return (
              <div
                key={node.id}
                role="treeitem"
                aria-selected={isSelected}
                aria-expanded={row.expandable ? row.expanded : undefined}
                className={[
                  'kmpTreeRow',
                  `is${node.kind[0].toUpperCase()}${node.kind.slice(1)}`,
                  isSelected ? 'isSelected' : '',
                  isPrimary ? 'isPrimary' : '',
                  hidden ? 'isHidden' : '',
                ].filter(Boolean).join(' ')}
                style={{ paddingLeft: 4 + row.depth * 13 }}
                data-entity-id={node.entityId ?? undefined}
              >
                {row.expandable ? (
                  <button
                    type="button"
                    className="kmpTreeChevron"
                    aria-label={row.expanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleExpanded(node.id);
                    }}
                  >
                    {row.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                ) : (
                  <span className="kmpTreeChevron kmpTreeChevronSpacer" />
                )}

                <button
                  type="button"
                  className="kmpTreeLabel"
                  onClick={(event) => handleRowClick(node, event)}
                  onDoubleClick={() => node.entityIds[0] && onFrame(node.entityIds[0])}
                  title={`${node.label}${node.detail ? ` — ${node.detail}` : ''}`}
                >
                  {node.accent && <span className="kmpTreeAccent" style={{ background: node.accent }} />}
                  <span className="kmpTreeName">{node.label}</span>
                  {node.detail && <span className="kmpTreeDetail">{node.detail}</span>}
                  {node.issueLevel && (
                    <span className={`kmpTreeIssue is${node.issueLevel === 'error' ? 'Error' : 'Warning'}`} title={node.issueLevel === 'error' ? 'Has an error' : 'Has a warning'}>
                      <TriangleAlert size={12} />
                    </span>
                  )}
                  {node.kind !== 'entity' && node.count > 0 && <span className="kmpTreeCount">{node.count}</span>}
                </button>

                {layers.length > 0 && (
                  <button
                    type="button"
                    className="kmpTreeEye"
                    aria-label={hidden ? `Show ${node.label}` : `Hide ${node.label}`}
                    title={hidden ? `Show ${node.label} in the viewport` : `Hide ${node.label} in the viewport`}
                    onClick={(event) => {
                      event.stopPropagation();
                      for (const key of layers) onChangeVisibility(key, hidden);
                    }}
                  >
                    {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {footer}
      </div>
    </aside>
  );
}

/** Minimal CSS.escape for the ids we generate (`GOBJ-12`, `POTI-3-0`). */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
