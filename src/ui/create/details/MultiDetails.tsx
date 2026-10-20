import { Dices, Layers, Shuffle, Trash2 } from 'lucide-react';
import { deleteSelection, updateProp } from '../../../lib/create/ops';
import { createRandom } from '../../../lib/create/math';
import type { CreateSelection } from '../../../lib/create/types';
import { Button } from '../../components/Button';
import type { CreateSession } from '../session/types';
import { DetailsHeader, Group } from './parts';
import { useEditing } from './useEditing';

const NOUN: Record<CreateSelection['kind'], [string, string]> = {
  road: ['road', 'roads'],
  point: ['road point', 'road points'],
  section: ['section', 'sections'],
  piece: ['piece', 'pieces'],
  prop: ['object', 'objects'],
  stroke: ['terrain stroke', 'terrain strokes'],
  start: ['start line', 'start line'],
};

/** "3 road points and 2 objects" */
export function describeSelection(selection: readonly CreateSelection[]): string {
  const counts = new Map<CreateSelection['kind'], number>();
  for (const sel of selection) counts.set(sel.kind, (counts.get(sel.kind) ?? 0) + 1);
  const parts = [...counts.entries()].map(([kind, n]) => `${n} ${NOUN[kind][n === 1 ? 0 : 1]}`);
  if (parts.length <= 1) return parts[0] ?? 'nothing';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function MultiDetails({ session }: { session: CreateSession }) {
  const edit = useEditing(session);
  const project = session.project;
  if (!project) return null;
  const selection = session.selection;
  const propIds = selection.filter((s): s is Extract<CreateSelection, { kind: 'prop' }> => s.kind === 'prop').map((s) => s.propId);
  const deletable = selection.filter((s) => s.kind !== 'start');
  return (
    <div className="crDetails" data-create-details="multi">
      <DetailsHeader icon={<Layers size={16} />} accent="var(--text)" title={`${selection.length} selected`} subtitle={describeSelection(selection)} />
      {propIds.length > 1 && (
        <Group title="Objects" help="Give a patch of scenery a more natural look.">
          <div className="crButtonRow">
            <Button
              icon={<Shuffle size={14} />}
              onClick={() =>
                edit.set('Randomise rotation', (p) => {
                  const rand = createRandom(propIds.length * 7919 + Math.round(Date.now() % 100000));
                  return propIds.reduce((acc, id) => updateProp(acc, id, { rotation: { x: 0, y: Math.round(rand() * 360), z: 0 } }), p);
                })
              }
            >
              Randomise turn
            </Button>
            <Button
              icon={<Dices size={14} />}
              onClick={() =>
                edit.set('Randomise size', (p) => {
                  const rand = createRandom(propIds.length * 104729 + Math.round(Date.now() % 100000));
                  return propIds.reduce((acc, id) => {
                    const prop = acc.props.find((x) => x.id === id);
                    const s = (prop ? (prop.scale.x + prop.scale.y + prop.scale.z) / 3 : 1) * (0.8 + rand() * 0.45);
                    return updateProp(acc, id, { scale: { x: s, y: s, z: s } });
                  }, p);
                })
              }
            >
              Randomise size
            </Button>
          </div>
        </Group>
      )}
      <div className="crButtonRow">
        <Button
          variant="danger"
          icon={<Trash2 size={14} />}
          disabled={deletable.length === 0}
          onClick={() => {
            edit.set(`Delete ${deletable.length} items`, (p) => deleteSelection(p, deletable));
            session.select([]);
          }}
        >
          Delete {deletable.length === selection.length ? 'all' : `${deletable.length}`}
        </Button>
      </div>
      <p className="crFact">Shift-click adds or removes things from the selection.</p>
    </div>
  );
}
