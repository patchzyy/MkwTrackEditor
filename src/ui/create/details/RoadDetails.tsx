import { Repeat, Route, Trash2 } from 'lucide-react';
import { deleteRoad, reverseRoad, setRoadClosed, updateRoad, updateRoadPoint } from '../../../lib/create/ops';
import { ROAD_STYLES } from '../../../lib/create/roadStyles';
import { roadLength } from '../../../lib/create/spline';
import { estimateLapSeconds } from '../../../lib/create/analyze';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Toggle } from '../../components/Toggle';
import { Tooltip } from '../../components/Tooltip';
import { RoadProfileArt } from '../palette/RoadProfileArt';
import type { CreateSession } from '../session/types';
import { DetailsHeader, Group, TextField } from './parts';
import { Slider } from './Slider';
import { useEditing } from './useEditing';

export function RoadDetails({ session, roadId }: { session: CreateSession; roadId: string }) {
  const project = session.project;
  const edit = useEditing(session);
  const road = project?.roads.find((r) => r.id === roadId);
  if (!project || !road) return null;
  const isMain = project.roads[0]?.id === road.id;
  const length = road.points.length >= 2 ? roadLength(road) : 0;
  const seconds = Math.max(1, Math.round(estimateLapSeconds(length)));
  const avgWidth = road.points.length > 0 ? Math.round(road.points.reduce((sum, p) => sum + p.width, 0) / road.points.length) : 0;
  const canClose = road.points.length >= 3;

  return (
    <div className="crDetails" data-create-details="road">
      <DetailsHeader
        icon={<Route size={16} />}
        accent="var(--create-road)"
        title={road.name}
        subtitle={isMain ? 'Main road' : 'Extra road'}
      />
      <Group title="Name">
        <TextField label="Road name" value={road.name} onCommit={(name) => edit.set('Rename road', (p) => updateRoad(p, road.id, { name }))} />
      </Group>

      <Group title="Style" help="How the road is built: its surface, edges and walls. Sections can change this stretch by stretch.">
        <div className="crStyleGrid" role="radiogroup" aria-label="Road style">
          {ROAD_STYLES.map((style) => (
            <Tooltip key={style.id} label={style.description} side="left" className="crStyleSlot">
              <button
                type="button"
                role="radio"
                aria-checked={style.id === road.styleId}
                className={`crStyleCard${style.id === road.styleId ? ' is-selected' : ''}`}
                data-create-road-style={style.id}
                onClick={() => edit.set(`Road style: ${style.label}`, (p) => updateRoad(p, road.id, { styleId: style.id }))}
              >
                <span className="crStyleArt">
                  <RoadProfileArt kit={session.kit} themeId={project.themeId} style={style} />
                </span>
                <span className="crStyleName">{style.label}</span>
              </button>
            </Tooltip>
          ))}
        </div>
      </Group>

      <Group title="Shape">
        <Field label="Loop" help={canClose ? 'A closed loop is a circuit you can lap.' : 'Add at least three points to close the loop.'}>
          <Toggle label="Closed loop" hideLabel checked={road.closed} disabled={!road.closed && !canClose} onChange={(v) => edit.set(v ? 'Close the road loop' : 'Open the road loop', (p) => setRoadClosed(p, road.id, v))} />
        </Field>
        <Field label="Width" help="Sets the width of every point at once. Select a single point to widen just a corner.">
          <Slider
            label="Road width"
            min={1800}
            max={8000}
            step={100}
            value={avgWidth}
            format={(v) => `${v}`}
            {...edit.slider('Change road width', (v) => (p) => {
              const r = p.roads.find((x) => x.id === road.id);
              return r ? r.points.reduce((acc, pt) => updateRoadPoint(acc, road.id, pt.id, { width: v }), p) : p;
            })}
          />
        </Field>
        <p className="crFact">
          {road.points.length} points · {length > 0 ? `about ${seconds} seconds to drive` : 'not drivable yet'}
        </p>
      </Group>

      <div className="crButtonRow">
        <Button icon={<Repeat size={14} />} disabled={road.points.length < 2} disabledReason="A road needs two points before it can turn around." tooltip="Make the road run the other way" onClick={() => edit.set('Reverse road direction', (p) => reverseRoad(p, road.id))}>
          Reverse direction
        </Button>
        <Button
          variant="danger"
          icon={<Trash2 size={14} />}
          onClick={() => {
            edit.set('Delete road', (p) => deleteRoad(p, road.id));
            session.select([]);
          }}
        >
          Delete road
        </Button>
      </div>
    </div>
  );
}
