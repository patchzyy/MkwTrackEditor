import { Flag, Paintbrush, Trash2 } from 'lucide-react';
import { deleteTerrainStroke, updateSettings } from '../../../lib/create/ops';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Toggle } from '../../components/Toggle';
import { strokeLabel } from '../build/layersModel';
import type { CreateSession } from '../session/types';
import type { CreateTools } from '../tools/useCreateTools';
import { DetailsHeader, Group } from './parts';
import { useEditing } from './useEditing';

/** The start line: where the race begins and how the grid lines up. */
export function StartDetails({ session, tools }: { session: CreateSession; tools: CreateTools }) {
  const project = session.project;
  const edit = useEditing(session);
  if (!project) return null;
  const { settings } = project;
  return (
    <div className="crDetails" data-create-details="start">
      <DetailsHeader icon={<Flag size={16} />} accent="var(--create-start)" title="Start line" subtitle="The race starts here and laps are counted when you cross it." />
      <Group title="Position">
        <p className="crFact">Drag it along the main road, or use the Start tool and click where it should go.</p>
        <div className="crButtonRow">
          <Button icon={<Flag size={14} />} onClick={() => tools.setTool('start')}>
            Use the Start tool
          </Button>
        </div>
      </Group>
      <Group title="Grid">
        <Field label="Start side" asGroup help="Which side of the road the first racer lines up on.">
          <SegmentedControl
            label="Start side"
            value={settings.polePosition}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
            ]}
            onChange={(v) => edit.set('Change start side', (p) => updateSettings(p, { polePosition: v }))}
            size="sm"
          />
        </Field>
        <Field label="Narrow grid" help="Lines the racers up closer together. Good for narrow roads.">
          <Toggle label="Narrow grid" hideLabel checked={settings.narrowStart} onChange={(v) => edit.set('Narrow start grid', (p) => updateSettings(p, { narrowStart: v }))} />
        </Field>
      </Group>
    </div>
  );
}

/** A paint or sculpt stroke picked from the Layers list. */
export function StrokeDetails({ session, strokeId }: { session: CreateSession; strokeId: string }) {
  const project = session.project;
  const edit = useEditing(session);
  const stroke = project?.terrainStrokes.find((s) => s.id === strokeId);
  if (!project || !stroke) return null;
  return (
    <div className="crDetails" data-create-details="stroke">
      <DetailsHeader icon={<Paintbrush size={16} />} accent="var(--create-terrain)" title={strokeLabel(stroke, session.kit, project.themeId)} subtitle="One brush stroke on the ground" />
      <p className="crFact">Strokes apply in order, so deleting one does not disturb the others. You can undo a stroke straight after painting it with Ctrl+Z.</p>
      <div className="crButtonRow">
        <Button
          variant="danger"
          icon={<Trash2 size={14} />}
          onClick={() => {
            edit.set('Delete terrain stroke', (p) => deleteTerrainStroke(p, stroke.id));
            session.select([]);
          }}
        >
          Delete stroke
        </Button>
      </div>
    </div>
  );
}
