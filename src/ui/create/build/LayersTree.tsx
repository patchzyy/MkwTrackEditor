import { Crosshair, Pencil, Repeat, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteSelection, reverseRoad, updateRoad } from '../../../lib/create/ops';
import type { CreateSelection } from '../../../lib/create/types';
import { EmptyState } from '../../components/EmptyState';
import { MenuSurface, type MenuSection } from '../../components/Menu';
import { TreeView } from '../../components/TreeView';
import type { CreateSession } from '../session/types';
import type { CreateTools } from '../tools/useCreateTools';
import { ancestorsFor, buildLayerNodes, defaultExpanded, nodeIdFor, type LayerNode } from './layersModel';

const DELETE_LABEL: Record<CreateSelection['kind'], string> = {
  road: 'Delete road',
  point: 'Delete road point',
  section: 'Delete section',
  piece: 'Delete piece',
  prop: 'Delete object',
  stroke: 'Delete terrain stroke',
  start: 'Delete',
};

interface MenuState {
  x: number;
  y: number;
  selection: CreateSelection;
  renaming: boolean;
}

function RenameField({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <form
      className="crRenameForm"
      onSubmit={(event) => {
        event.preventDefault();
        onDone(value);
      }}
    >
      <label>
        <span>Road name</span>
        <input ref={ref} value={value} onChange={(event) => setValue(event.currentTarget.value)} onKeyDown={(event) => event.key === 'Escape' && onDone(null)} />
      </label>
    </form>
  );
}

/**
 * The Layers outliner: everything in the design as a tree. Click selects, double-click frames it
 * in the viewport, right-click offers rename / reverse / delete.
 */
export function LayersTree({ session, tools }: { session: CreateSession; tools: CreateTools }) {
  const project = session.project;
  const nodes = useMemo(() => (project ? buildLayerNodes(project, session.kit) : []), [project, session.kit]);
  const [expanded, setExpanded] = useState<Set<string>>(() => (project ? defaultExpanded(project) : new Set()));
  const [menu, setMenu] = useState<MenuState | null>(null);
  const selection = session.selection;
  const primary = selection[0] ? nodeIdFor(selection[0]) : null;

  // Reveal whatever the viewport just selected.
  const selectionKey = selection.map(nodeIdFor).join('|');
  useEffect(() => {
    if (!project || selection.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const sel of selection) {
        for (const id of ancestorsFor(sel, project)) if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  // A freshly added road opens up by itself.
  const roadIds = project?.roads.map((r) => r.id).join('|') ?? '';
  useEffect(() => {
    if (!project) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const road of project.roads) if (!prev.has(`road:${road.id}`) && !next.has(`road:${road.id}`)) {
        next.add(`road:${road.id}`);
        next.add('group:roads');
        changed = true;
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roadIds]);

  if (!project) return null;
  if (nodes.length === 0) {
    return (
      <EmptyState
        size="sm"
        title="Nothing here yet"
        description="Your road will show up here. Pick the Road tool (R) and click on the ground."
      />
    );
  }

  const menuSections = (state: MenuState): MenuSection[] => {
    const sel = state.selection;
    const items: MenuSection['items'] = [
      { id: 'frame', label: 'Show in the viewport', icon: <Crosshair size={13} />, shortcut: 'F', onSelect: () => tools.frameSelection([sel]) },
    ];
    if (sel.kind === 'road') {
      items.push({ id: 'rename', label: 'Rename', icon: <Pencil size={13} />, onSelect: () => setMenu({ ...state, renaming: true }) });
      items.push({
        id: 'reverse',
        label: 'Reverse direction',
        icon: <Repeat size={13} />,
        onSelect: () => session.edit((p) => reverseRoad(p, sel.roadId), { label: 'Reverse road direction' }),
      });
    }
    const sections: MenuSection[] = [{ id: 'main', items }];
    if (sel.kind !== 'start') {
      sections.push({
        id: 'danger',
        items: [
          {
            id: 'delete',
            label: DELETE_LABEL[sel.kind],
            icon: <Trash2 size={13} />,
            shortcut: 'Del',
            danger: true,
            onSelect: () => {
              session.edit((p) => deleteSelection(p, [sel]), { label: DELETE_LABEL[sel.kind] });
              session.select([]);
            },
          },
        ],
      });
    }
    return sections;
  };

  const onSelect = (id: string, node: LayerNode, options: { additive: boolean }) => {
    if (node.data) {
      session.select(node.data, { additive: options.additive });
      return;
    }
    // A group row: open or close it.
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const road = menu?.renaming && menu.selection.kind === 'road' ? project.roads.find((r) => r.id === (menu.selection as { roadId: string }).roadId) : null;

  return (
    <>
      <TreeView<CreateSelection | null>
        label="Layers"
        className="crLayerTree"
        nodes={nodes}
        selectedId={primary}
        expandedIds={expanded}
        onChangeExpanded={setExpanded}
        onSelect={onSelect}
        onActivate={(_id, node) => {
          if (!node.data) return;
          session.select(node.data);
          tools.frameSelection([node.data]);
        }}
        onContextMenu={(_id, node, event) => {
          if (!node.data) return;
          event.preventDefault();
          session.select(node.data);
          setMenu({ x: event.clientX, y: event.clientY, selection: node.data, renaming: false });
        }}
      />
      {menu && !menu.renaming && <MenuSurface anchor={{ top: menu.y, left: menu.x }} sections={menuSections(menu)} onClose={() => setMenu(null)} label="Layer actions" minWidth={200} />}
      {menu && road && (
        <MenuSurface anchor={{ top: menu.y, left: menu.x }} onClose={() => setMenu(null)} label="Rename road" minWidth={220}>
          <RenameField
            initial={road.name}
            onDone={(name) => {
              setMenu(null);
              if (name !== null && name.trim() && name !== road.name) session.edit((p) => updateRoad(p, road.id, { name: name.trim() }), { label: 'Rename road' });
            }}
          />
        </MenuSurface>
      )}
    </>
  );
}
