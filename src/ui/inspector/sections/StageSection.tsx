import type { KmpEntity, KmpStageField } from '../../../lib/kmp';
import { RgbaColorField } from '../fields/RgbaColorField';
import type { InspectorScope } from './scope';
import { PropertyRow } from '../PropertySheet';

/** One row per STGI field, in the order a track author cares about them. */
const STAGE_FIELDS: Array<{
  field: KmpStageField;
  label: string;
  help: string;
  min: number;
  max: number;
  step?: number;
  scope: InspectorScope;
  options?: Array<{ value: number; label: string }>;
}> = [
  { field: 'lapCount', label: 'Laps', help: 'How many laps a race on this track takes. Three is what every retail track uses.', min: 1, max: 9, scope: 'essentials' },
  {
    field: 'polePosition',
    label: 'Pole position',
    help: 'Which side of the grid the first-place driver starts on.',
    min: 0,
    max: 1,
    scope: 'essentials',
    options: [
      { value: 0, label: 'Left' },
      { value: 1, label: 'Right' },
    ],
  },
  {
    field: 'driverDistance',
    label: 'Grid spacing',
    help: 'How far apart the drivers stand on the starting grid.',
    min: 0,
    max: 1,
    scope: 'essentials',
    options: [
      { value: 0, label: 'Normal' },
      { value: 1, label: 'Narrow' },
    ],
  },
  {
    field: 'lensFlareFlash',
    label: 'Lens flare flash',
    help: 'Turns on the white flash the sun flare makes as it passes the camera.',
    min: 0,
    max: 1,
    scope: 'essentials',
    options: [
      { value: 0, label: 'Off' },
      { value: 1, label: 'On' },
    ],
  },
  {
    field: 'speedMod',
    label: 'Speed multiplier',
    help: 'Scales how fast everything drives. 0 means the normal 1x; the game only keeps the top two bytes of this number.',
    min: 0,
    max: 10,
    step: 0.1,
    scope: 'essentials',
  },
  { field: 'unknown1', label: 'Reserved byte 1', help: 'Unused by the game. Kept so an export matches the original file.', min: 0, max: 255, scope: 'advanced' },
  { field: 'unknown2', label: 'Reserved byte 2', help: 'Unused by the game. Kept so an export matches the original file.', min: 0, max: 255, scope: 'advanced' },
];

/** Track-wide settings (STGI): laps, grid layout, lens flare and the global speed multiplier. */
export function StageSection({
  entity,
  scope,
  onChangeStageField,
  onChangeStageFlareColor,
}: {
  entity: KmpEntity;
  scope: InspectorScope;
  onChangeStageField: (field: KmpStageField, value: number) => void;
  onChangeStageFlareColor: (channelIndex: number, value: number) => void;
}) {
  const stage = entity.stage;
  if (!stage) return null;
  const fields = STAGE_FIELDS.filter((meta) => meta.scope === scope);
  if (fields.length === 0 && scope === 'advanced') return null;
  return (
    <div className="propertyGrid">
      {fields.map((meta) => {
        const value = stage[meta.field];
        return (
          <PropertyRow key={meta.field} label={meta.label} help={meta.field === 'speedMod' && value === 0 ? `${meta.help} Currently the normal 1x speed.` : meta.help}>
            {meta.options ? (
              <select
                aria-label={meta.label}
                value={String(meta.options.some((option) => option.value === value) ? value : meta.options[0].value)}
                onChange={(event) => onChangeStageField(meta.field, Number(event.currentTarget.value))}
              >
                {meta.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label={meta.label}
                type="number"
                min={meta.min}
                max={meta.max}
                step={meta.step ?? 1}
                value={Number.isFinite(value) ? Number(value.toFixed(meta.step ? 3 : 0)) : 0}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (!Number.isFinite(next)) return;
                  onChangeStageField(meta.field, meta.step ? next : Math.max(meta.min, Math.min(meta.max, Math.trunc(next))));
                }}
              />
            )}
          </PropertyRow>
        );
      })}
      {scope === 'essentials' && (
        <PropertyRow label="Sun flare colour" help="The colour and strength of the sun flare drawn over the track.">
          <RgbaColorField
            value={[stage.flareColor[0] ?? 0, stage.flareColor[1] ?? 0, stage.flareColor[2] ?? 0, stage.flareColor[3] ?? 0]}
            onChange={(next) => {
              for (let channel = 0; channel < 4; channel++) {
                if (next[channel] !== stage.flareColor[channel]) onChangeStageFlareColor(channel, next[channel]);
              }
            }}
          />
        </PropertyRow>
      )}
    </div>
  );
}
