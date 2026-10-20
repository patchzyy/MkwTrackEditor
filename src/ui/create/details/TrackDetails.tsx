import { Globe, Sparkles } from 'lucide-react';
import { renameProject, setTheme, updateGeneration, updateSettings, updateTerrain } from '../../../lib/create/ops';
import { Field } from '../../components/Field';
import { PanelSection } from '../../components/Panel';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Toggle } from '../../components/Toggle';
import type { CreateSession } from '../session/types';
import { DetailsHeader, Group, HelpLabel, Stepper, SurfacePicker, TextField, WorldPicker, surfacesOf } from './parts';
import { PresetField } from './PresetField';
import { CHECKPOINT_PRESETS, DRIVER_ROUTE_PRESETS, ITEM_ROUTE_PRESETS, SPEED_PRESETS } from './presets';
import { useEditing } from './useEditing';

/** Spelled-out explanations of the generated values: what they do, in a sentence. */
export const GENERATED_HELP = {
  checkpointSpacing: 'How often the game checks your progress around the lap. Closer gates make it harder to cut corners.',
  keyCheckpoints: 'Gates every racer must pass in order, so nobody can skip half the track.',
  enemySpacing: 'How finely computer drivers follow the road. Smaller is smoother but heavier.',
  itemSpacing: 'How finely homing items follow the road to find a target.',
  respawnEvery: 'Racers who fall off drop back onto the road at a safe spot, one every few gates.',
  cameras: 'The fly-by before the race and the camera that follows the winner over the line.',
} as const;

/**
 * Nothing selected: the track's own settings. Everything fits without scrolling; the longer
 * explanations are one hover away on each label.
 */
export function TrackDetails({ session }: { session: CreateSession }) {
  const project = session.project;
  const edit = useEditing(session);
  if (!project) return null;
  const kit = session.kit;
  const stats = session.compileStats?.stats;
  const { settings, terrain, generation } = project;
  const coveringName = kit ? kit.resolveSurface(terrain.surface, project.themeId).label : '';

  return (
    <div className="crDetails" data-create-details="track">
      <DetailsHeader icon={<Globe size={16} />} accent="var(--accent)" title="Your track" subtitle={stats ? `${stats.checkpoints} checkpoints · ${stats.itemBoxes} item boxes` : 'Click something to edit it'} />

      <Group title="Name">
        <TextField label="Track name" value={project.name} onCommit={(name) => edit.set('Rename track', (p) => renameProject(p, name))} />
      </Group>

      <Group title="World">
        <WorldPicker kit={kit} value={project.themeId} onPick={(t) => edit.set(`Change world: ${t.label}`, (p) => setTheme(p, t.id, kit))} />
      </Group>

      <Group title="Race">
        <Field label="Laps">
          <Stepper label="Laps" value={settings.laps} min={1} max={9} onChange={(v) => edit.set('Change laps', (p) => updateSettings(p, { laps: v }))} />
        </Field>
        <Field label={<HelpLabel help="Which side of the road the first racer lines up on.">Start side</HelpLabel>} asGroup>
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
        <Field label={<HelpLabel help="Lines the racers up closer together. Good for narrow roads.">Narrow grid</HelpLabel>}>
          <Toggle label="Narrow grid" hideLabel checked={settings.narrowStart} onChange={(v) => edit.set('Narrow start grid', (p) => updateSettings(p, { narrowStart: v }))} />
        </Field>
        <PresetField
          label="Speed"
          help="How fast the whole race is. Fast and Faster make every kart quicker, like a higher engine class."
          presets={SPEED_PRESETS}
          value={settings.speedFactor}
          editing={edit}
          undoLabel="Change speed"
          mutate={(v) => (p) => updateSettings(p, { speedFactor: v })}
          exact={{ min: 0.5, max: 2, step: 0.05, precision: 2, unit: '×' }}
        />
      </Group>

      <Group title="Ground">
        <Field label={<HelpLabel help="Land under and around the road. Switch it off for a sky track: falling off the road then means falling into the void.">Ground</HelpLabel>}>
          <Toggle label="Ground" hideLabel checked={terrain.enabled} onChange={(v) => edit.set(v ? 'Turn the ground on' : 'Turn the ground off', (p) => updateTerrain(p, { enabled: v }))} />
        </Field>
        {terrain.enabled && (
          <>
            <Field label={<span className="crLabelStack">Covering<small data-create-covering-name>{coveringName}</small></span>} asGroup>
              <SurfacePicker
                small
                kit={kit}
                themeId={project.themeId}
                surfaces={surfacesOf(kit, project.themeId, ['ground', 'offroad', 'ice']).slice(0, 12)}
                value={terrain.surface}
                onPick={(ref) => ref && edit.set('Change ground covering', (p) => updateTerrain(p, { surface: ref }))}
              />
            </Field>
            <Field label={<HelpLabel help={terrain.boundary === 'wall' ? 'An invisible wall keeps everyone on the map.' : 'Drive off the edge and you fall and respawn.'}>World edge</HelpLabel>} asGroup>
              <SegmentedControl
                label="Edge of the world"
                value={terrain.boundary}
                options={[
                  { value: 'wall', label: 'Wall' },
                  { value: 'fall', label: 'Drop-off' },
                ]}
                onChange={(v) => edit.set('Change world edge', (p) => updateTerrain(p, { boundary: v }))}
                size="sm"
              />
            </Field>
          </>
        )}
      </Group>

      <PanelSection title="Generated for you" icon={<Sparkles size={13} />} defaultOpen={false} className="crAdvanced">
        <p className="crGroupHelp">The editor builds the checkpoints, driver routes, respawn spots and cameras for you. These dials only matter if you want to fine-tune them.</p>
        <PresetField
          label="Checkpoint spacing"
          help={GENERATED_HELP.checkpointSpacing}
          presets={CHECKPOINT_PRESETS}
          value={generation.checkpointSpacing}
          editing={edit}
          undoLabel="Change checkpoint spacing"
          mutate={(v) => (p) => updateGeneration(p, { checkpointSpacing: v })}
          exact={{ min: 2500, max: 12000, step: 250, integer: true }}
        />
        <Field label={<HelpLabel help={GENERATED_HELP.keyCheckpoints}>Key checkpoints</HelpLabel>}>
          <Stepper label="Key checkpoints" value={generation.keyCheckpoints} min={1} max={12} onChange={(v) => edit.set('Change key checkpoints', (p) => updateGeneration(p, { keyCheckpoints: v }))} />
        </Field>
        <PresetField
          label="Driver routes"
          help={GENERATED_HELP.enemySpacing}
          presets={DRIVER_ROUTE_PRESETS}
          value={generation.enemySpacing}
          editing={edit}
          undoLabel="Change driver route spacing"
          mutate={(v) => (p) => updateGeneration(p, { enemySpacing: v })}
          exact={{ min: 1500, max: 9000, step: 250, integer: true }}
        />
        <PresetField
          label="Item routes"
          help={GENERATED_HELP.itemSpacing}
          presets={ITEM_ROUTE_PRESETS}
          value={generation.itemSpacing}
          editing={edit}
          undoLabel="Change item route spacing"
          mutate={(v) => (p) => updateGeneration(p, { itemSpacing: v })}
          exact={{ min: 1500, max: 9000, step: 250, integer: true }}
        />
        <Field label={<HelpLabel help={GENERATED_HELP.respawnEvery}>Respawn spots</HelpLabel>}>
          <Stepper label="Respawn spots" value={generation.respawnEvery} min={1} max={10} onChange={(v) => edit.set('Change respawn spots', (p) => updateGeneration(p, { respawnEvery: v }))} format={(v) => `every ${v}`} />
        </Field>
        <Field label={<HelpLabel help={GENERATED_HELP.cameras}>Cameras</HelpLabel>}>
          <Toggle label="Cameras" hideLabel checked={generation.cameras} onChange={(v) => edit.set(v ? 'Turn cameras on' : 'Turn cameras off', (p) => updateGeneration(p, { cameras: v }))} />
        </Field>
        <Field label={<HelpLabel help="A lens flare when you look toward the sun.">Sun glare</HelpLabel>}>
          <Toggle label="Sun glare" hideLabel checked={settings.lensFlare} onChange={(v) => edit.set('Change sun glare', (p) => updateSettings(p, { lensFlare: v }))} />
        </Field>
      </PanelSection>
    </div>
  );
}
