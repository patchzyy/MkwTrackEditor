import { CircleDot, Trash2, ArrowLeftToLine, ArrowRightToLine } from 'lucide-react';
import { deleteRoadPoint, insertRoadPoint, updateRoadPoint } from '../../../lib/create/ops';
import { roadParamEnd } from '../../../lib/create/spline';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { NumberInput } from '../../components/NumberInput';
import { PanelSection } from '../../components/Panel';
import { SegmentedControl } from '../../components/SegmentedControl';
import { VectorInput } from '../../components/VectorInput';
import type { CreateSession } from '../session/types';
import { DetailsHeader, Group } from './parts';
import { Slider } from './Slider';
import { useEditing } from './useEditing';

export function PointDetails({ session, roadId, pointId, onSelectRoad }: { session: CreateSession; roadId: string; pointId: string; onSelectRoad: () => void }) {
  const project = session.project;
  const edit = useEditing(session);
  const road = project?.roads.find((r) => r.id === roadId);
  const index = road ? road.points.findIndex((p) => p.id === pointId) : -1;
  const point = road && index >= 0 ? road.points[index] : null;
  if (!project || !road || !point) return null;
  const base = project.terrain.baseHeight;
  const n = road.points.length;
  const end = roadParamEnd(road);
  const canDelete = n > 2;
  const canBefore = road.closed || index > 0;
  const insertAfterParam = index + 0.5;
  const insertBeforeParam = index === 0 ? end - 0.5 : index - 0.5;

  const insert = (param: number, label: string) => {
    const result = insertRoadPoint(project, road.id, param);
    session.edit((p) => insertRoadPoint(p, road.id, param).project, { label });
    if (result.id) session.select([{ kind: 'point', roadId: road.id, pointId: result.id }]);
  };

  return (
    <div className="crDetails" data-create-details="point">
      <DetailsHeader
        icon={<CircleDot size={16} />}
        accent="var(--create-road)"
        title={`Point ${index + 1} of ${n}`}
        subtitle={
          <>
            on {road.name} ·{' '}
            <button type="button" className="crLink" onClick={onSelectRoad}>
              select the whole road
            </button>
          </>
        }
      />
      <Group title="Position">
        <Field label="Height" hint="above the ground" help="Raise a point to build a hill or a ramp. You can also Shift-drag it in the viewport.">
          <NumberInput label="Height above ground" value={Math.round(point.position.y - base)} step={50} integer unit="u" {...edit.num('Change point height', (v) => (p) => updateRoadPoint(p, road.id, point.id, { position: { ...point.position, y: base + v } }))} />
        </Field>
        <Field label="Width" help="How wide the road is at this point. The road blends smoothly between points.">
          <Slider label="Point width" min={1200} max={9000} step={100} value={Math.round(point.width)} format={(v) => `${v}`} {...edit.slider('Change point width', (v) => (p) => updateRoadPoint(p, road.id, point.id, { width: v }))} />
        </Field>
        <Field label="Bank" hint="−45° to 45°" help="Tilts the road sideways in a corner. Positive tilts the right edge down.">
          <Slider label="Bank" min={-45} max={45} step={1} value={Math.round(point.bank)} format={(v) => `${v}°`} {...edit.slider('Change bank', (v) => (p) => updateRoadPoint(p, road.id, point.id, { bank: v }))} />
        </Field>
        <Field label="Corner" asGroup help={point.corner === 'smooth' ? 'The road curves smoothly through this point.' : 'The road turns sharply here, like a hairpin.'}>
          <SegmentedControl
            label="Corner"
            value={point.corner}
            options={[
              { value: 'smooth', label: 'Smooth' },
              { value: 'sharp', label: 'Sharp' },
            ]}
            onChange={(v) => edit.set(`Make corner ${v}`, (p) => updateRoadPoint(p, road.id, point.id, { corner: v }))}
            size="sm"
          />
        </Field>
      </Group>

      <div className="crButtonRow">
        <Button icon={<ArrowLeftToLine size={14} />} disabled={!canBefore} disabledReason="This is the first point, so there is no stretch before it." onClick={() => insert(insertBeforeParam, 'Insert road point before')}>
          Add point before
        </Button>
        <Button icon={<ArrowRightToLine size={14} />} disabled={!road.closed && index >= n - 1} disabledReason="This is the last point, so there is no stretch after it." onClick={() => insert(insertAfterParam, 'Insert road point after')}>
          Add point after
        </Button>
        <Button
          variant="danger"
          icon={<Trash2 size={14} />}
          disabled={!canDelete}
          disabledReason="A road needs at least two points."
          onClick={() => {
            edit.set('Delete road point', (p) => deleteRoadPoint(p, road.id, point.id));
            session.select([{ kind: 'road', roadId: road.id }]);
          }}
        >
          Delete point
        </Button>
      </div>

      <PanelSection title="Exact position" defaultOpen={false} className="crAdvanced">
        <VectorInput
          label="Position"
          value={point.position}
          step={50}
          onChange={(v) => edit.live('Move road point', (p) => updateRoadPoint(p, road.id, point.id, { position: v }))}
          onCommit={() => edit.finish()}
        />
      </PanelSection>
    </div>
  );
}
