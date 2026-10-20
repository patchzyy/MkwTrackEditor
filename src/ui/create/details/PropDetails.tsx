import { ArrowDownToLine, Trash2, TreePine } from 'lucide-react';
import { deleteProp, updateProp } from '../../../lib/create/ops';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { NumberInput } from '../../components/NumberInput';
import { PanelSection } from '../../components/Panel';
import { Toggle } from '../../components/Toggle';
import { VectorInput } from '../../components/VectorInput';
import type { CreateAssets } from '../palette/assets';
import { sceneryName } from '../build/layersModel';
import { ObjectArt } from '../palette/TileArt';
import type { CreateSession } from '../session/types';
import { DetailsHeader, Group } from './parts';
import { Slider } from './Slider';
import { useEditing } from './useEditing';

/** Picks which object a prop is: the world's scenery first, then everything the game has. */
function ObjectPicker({ session, assets, objectId, onPick }: { session: CreateSession; assets: CreateAssets; objectId: number; onPick: (id: number) => void }) {
  const project = session.project;
  const kit = session.kit;
  const own = kit && project ? kit.catalog.scenery.filter((s) => s.themeIds.includes(project.themeId)) : [];
  const ownIds = new Set(own.map((s) => s.objectId));
  const others = (assets.objectOptions ?? []).filter((o) => !ownIds.has(o.id));
  const known = ownIds.has(objectId) || others.some((o) => o.id === objectId);
  return (
    <div className="crObjectPicker">
      <span className="crObjectPreview">
        <ObjectArt objectId={objectId} assets={assets} />
      </span>
      <select
        className="referenceSelect crObjectSelect"
        aria-label="Object"
        value={objectId}
        onChange={(event) => onPick(Number(event.currentTarget.value))}
      >
        {!known && <option value={objectId}>{sceneryName(objectId, kit)}</option>}
        {own.length > 0 && (
          <optgroup label="Scenery for this world">
            {own.map((s) => (
              <option key={s.objectId} value={s.objectId}>
                {s.label}
              </option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label="Every object in the game">
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}

export function PropDetails({ session, propId, assets }: { session: CreateSession; propId: string; assets: CreateAssets }) {
  const project = session.project;
  const edit = useEditing(session);
  const prop = project?.props.find((p) => p.id === propId);
  if (!project || !prop) return null;
  const uniform = Math.round(((prop.scale.x + prop.scale.y + prop.scale.z) / 3) * 100) / 100;

  return (
    <div className="crDetails" data-create-details="prop">
      <DetailsHeader icon={<TreePine size={16} />} accent="var(--create-scenery)" title={sceneryName(prop.objectId, session.kit)} subtitle="Scenery object" />
      <Group title="Object" help="Change what this is without moving it.">
        <ObjectPicker session={session} assets={assets} objectId={prop.objectId} onPick={(id) => edit.set(`Replace with ${sceneryName(id, session.kit)}`, (p) => updateProp(p, prop.id, { objectId: id, settings: undefined }))} />
      </Group>
      <Group title="Placement">
        <Field label="Turn" hint="degrees">
          <NumberInput label="Turn" value={Math.round(prop.rotation.y)} min={-360} max={360} step={5} integer unit="°" {...edit.num('Turn object', (v) => (p) => updateProp(p, prop.id, { rotation: { ...prop.rotation, y: v } }))} />
        </Field>
        <Field label="Size" hint="1 = normal">
          <Slider label="Size" min={0.2} max={4} step={0.05} value={uniform} format={(v) => `${v.toFixed(2)}×`} {...edit.slider('Resize object', (v) => (p) => updateProp(p, prop.id, { scale: { x: v, y: v, z: v } }))} />
        </Field>
        <Field label="Stick to the ground" help="Keeps it sitting on the ground, even after you sculpt hills.">
          <Toggle label="Stick to the ground" hideLabel checked={prop.snapToGround} onChange={(v) => edit.set(v ? 'Stick object to the ground' : 'Free the object from the ground', (p) => updateProp(p, prop.id, { snapToGround: v }))} />
        </Field>
      </Group>
      <PanelSection title="Exact values" defaultOpen={false} className="crAdvanced">
        <Field label="Position" asGroup>
          <VectorInput label="Position" value={prop.position} step={50} onChange={(v) => edit.live('Move object', (p) => updateProp(p, prop.id, { position: v }))} onCommit={() => edit.finish()} />
        </Field>
        <Field label="Rotation" asGroup>
          <VectorInput label="Rotation" value={prop.rotation} step={5} onChange={(v) => edit.live('Rotate object', (p) => updateProp(p, prop.id, { rotation: v }))} onCommit={() => edit.finish()} />
        </Field>
        <Field label="Scale" asGroup>
          <VectorInput label="Scale" value={prop.scale} step={0.05} precision={2} onChange={(v) => edit.live('Scale object', (p) => updateProp(p, prop.id, { scale: v }))} onCommit={() => edit.finish()} />
        </Field>
      </PanelSection>
      <div className="crButtonRow">
        <Button
          icon={<ArrowDownToLine size={14} />}
          onClick={() => edit.set('Drop object to the ground', (p) => updateProp(p, prop.id, { snapToGround: true }))}
          tooltip="Put it on the ground under it"
        >
          Snap to ground
        </Button>
        <Button
          variant="danger"
          icon={<Trash2 size={14} />}
          onClick={() => {
            edit.set('Delete object', (p) => deleteProp(p, prop.id));
            session.select([]);
          }}
        >
          Delete object
        </Button>
      </div>
    </div>
  );
}
