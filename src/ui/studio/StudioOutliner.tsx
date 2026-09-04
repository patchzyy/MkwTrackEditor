import { Box, ChevronDown, ChevronRight, Eye, EyeOff, Image, Layers, Pause, Play, Search, X } from 'lucide-react';
import { useMemo } from 'react';
import type { GxMaterialRef } from '../../lib/gxMaterial';
import { EmptyState, IconButton, Tooltip } from '../components';
import { flattenTree } from '../components/treeModel';
import { studioMaterialRefEquals, type StudioNodeData, type StudioTreeNode } from './studioOutlinerModel';

export interface StudioOutlinerProps {
  tree: StudioTreeNode[];
  query: string;
  onChangeQuery: (query: string) => void;
  expanded: string[];
  onChangeExpanded: (ids: string[]) => void;
  selected: GxMaterialRef | null;
  onSelectMaterial: (ref: GxMaterialRef) => void;
  onToggleArchive: (archivePath: string, visible: boolean) => void;
  onToggleModel: (archivePath: string, modelName: string, visible: boolean) => void;
  onToggleAnimation: (archivePath: string, kind: string, name: string, enabled: boolean) => void;
  hasDocument: boolean;
}

/**
 * The studio's asset outliner: archives, their models, each model's materials, the archive's
 * textures and its animations.
 *
 * The affordance on a row is whatever that row *is*: an eye on things that are drawn, a play
 * button on things that move, nothing on a material or a texture (those are selected, not
 * toggled). That is why this is not a plain `TreeView` with the eye column — one column cannot
 * mean two things.
 */
export function StudioOutliner({
  tree,
  query,
  onChangeQuery,
  expanded,
  onChangeExpanded,
  selected,
  onSelectMaterial,
  onToggleArchive,
  onToggleModel,
  onToggleAnimation,
  hasDocument,
}: StudioOutlinerProps) {
  const searching = query.trim().length > 0;
  const expandedSet = useMemo(() => {
    if (!searching) return new Set(expanded);
    // While searching everything is open, so a hit is never hidden behind a collapsed branch.
    const all = new Set<string>();
    const walk = (nodes: readonly StudioTreeNode[]) => {
      for (const node of nodes) {
        if (node.children?.length) {
          all.add(node.id);
          walk(node.children);
        }
      }
    };
    walk(tree);
    return all;
  }, [expanded, searching, tree]);

  const rows = useMemo(() => flattenTree(tree, expandedSet), [expandedSet, tree]);

  function toggleExpanded(id: string) {
    onChangeExpanded(expanded.includes(id) ? expanded.filter((entry) => entry !== id) : [...expanded, id]);
  }

  return (
    <aside className="placeAssetsPanel studioOutliner" aria-label="Studio outliner">
      <div className="panelHeader placeAssetsHeader">
        <div>
          <h2>Outliner</h2>
          <p className="panelSubtle">Models, materials, textures and animations in what is open.</p>
        </div>
      </div>

      <div className="studioOutlinerSearch">
        <Search size={13} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="Search models, materials, textures, animations"
          aria-label="Search the studio outliner"
          onChange={(event) => onChangeQuery(event.currentTarget.value)}
        />
        {query !== '' && <IconButton tooltip="Clear the search" size="sm" icon={<X size={12} />} onClick={() => onChangeQuery('')} />}
      </div>

      <div className="studioOutlinerBody">
        {!hasDocument ? (
          <EmptyState
            icon={<Box size={22} />}
            title="Nothing open"
            description="Open a .brres, .szs or .u8 model archive, or load the demo character."
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Search size={22} />} title="No matches" description="Nothing in this archive matches that search." />
        ) : (
          <ul className="studioTree" role="tree" aria-label="Studio contents">
            {rows.map((row) => {
              const data = row.node.data as StudioNodeData | undefined;
              const isMaterial = data?.kind === 'material';
              const isSelected = isMaterial && studioMaterialRefEquals(selected, data.ref);
              return (
                <li
                  key={row.id}
                  role="treeitem"
                  aria-level={row.depth + 1}
                  aria-selected={isSelected}
                  aria-expanded={row.hasChildren ? row.expanded : undefined}
                  className={[
                    'studioTreeRow',
                    isSelected ? 'is-selected' : '',
                    row.node.disabled ? 'is-disabled' : '',
                    `is-${data?.kind ?? 'folder'}`,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{ paddingLeft: `${6 + row.depth * 13}px` }}
                  onClick={() => {
                    if (isMaterial && data.kind === 'material') onSelectMaterial(data.ref);
                    else if (row.hasChildren) toggleExpanded(row.id);
                  }}
                >
                  <span className="studioTreeTwisty">
                    {row.hasChildren && (
                      <button
                        type="button"
                        className="studioTreeTwistyButton"
                        aria-label={row.expanded ? `Collapse ${row.node.label}` : `Expand ${row.node.label}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleExpanded(row.id);
                        }}
                      >
                        {row.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    )}
                  </span>

                  {data?.kind === 'archive' && (
                    <VisibilityButton
                      label={row.node.label}
                      visible={row.node.checked ?? true}
                      onToggle={(visible) => onToggleArchive(data.archivePath, visible)}
                    />
                  )}
                  {data?.kind === 'model' && (
                    <VisibilityButton
                      label={row.node.label}
                      visible={row.node.checked ?? true}
                      onToggle={(visible) => onToggleModel(data.archivePath, data.modelName, visible)}
                    />
                  )}
                  {data?.kind === 'animation' && (
                    <button
                      type="button"
                      className={`studioTreePlay${data.enabled ? ' is-playing' : ''}`}
                      disabled={!data.supported}
                      aria-label={data.enabled ? `Stop ${row.node.label}` : `Play ${row.node.label}`}
                      title={data.supported ? (data.enabled ? 'Stop this animation' : 'Play this animation') : 'The renderer cannot play this kind of animation.'}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleAnimation(data.archivePath, data.animationKind, data.animationName, !data.enabled);
                      }}
                    >
                      {data.enabled ? <Pause size={11} /> : <Play size={11} />}
                    </button>
                  )}
                  {data?.kind === 'texture' && (
                    <span className="studioTreeIcon" aria-hidden="true">
                      <Image size={11} />
                    </span>
                  )}
                  {data?.kind === 'material' && (
                    <span className="studioTreeIcon" aria-hidden="true">
                      <Layers size={11} />
                    </span>
                  )}

                  <span className="studioTreeLabel" title={row.node.label}>
                    {row.node.label}
                  </span>
                  {row.node.detail && <span className="studioTreeDetail">{row.node.detail}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

function VisibilityButton({ label, visible, onToggle }: { label: string; visible: boolean; onToggle: (visible: boolean) => void }) {
  return (
    <Tooltip label={visible ? `Hide ${label}` : `Show ${label}`} side="right">
      <button
        type="button"
        className={`studioTreeEye${visible ? '' : ' is-hidden'}`}
        aria-label={visible ? `Hide ${label}` : `Show ${label}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(!visible);
        }}
      >
        {visible ? <Eye size={11} /> : <EyeOff size={11} />}
      </button>
    </Tooltip>
  );
}
