import type { KmpAreaField, KmpEntity } from '../../../lib/kmp';
import type { ReferenceCounts } from '../../../lib/kmpEdit';
import { getAreaInspectorConfig, type AreaInspectorResources } from '../../areas/areaInspectorConfig';
import { NumberOptionSelect } from '../fields/NumberOptionSelect';
import { ReferenceSelect } from '../fields/ReferenceSelect';
import { areaShapeOptions, areaTypeOptions } from '../optionTables';
import type { InspectorScope } from './scope';

/**
 * Areas. The essentials are what the area does, what shape it is and what it points at; the
 * overlap priority and the spare tuning byte are Advanced.
 */
export function AreaSection({
  entity,
  scope,
  referenceCounts,
  areaInspectorResources,
  onChangeAreaField,
}: {
  entity: KmpEntity;
  scope: InspectorScope;
  referenceCounts: ReferenceCounts;
  areaInspectorResources: AreaInspectorResources;
  onChangeAreaField: (field: KmpAreaField, value: number) => void;
}) {
  const area = entity.area;
  if (!area) return null;
  const labels = getAreaInspectorConfig(area.type, areaInspectorResources);

  if (scope === 'advanced') {
    return (
      <div className="propertyGrid">
        <label>
          Overlap priority
          <input
            aria-label="Overlap priority"
            type="number"
            min="0"
            max="255"
            value={area.priority}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (Number.isFinite(next)) onChangeAreaField('priority', Math.max(0, Math.min(0xff, Math.trunc(next))));
            }}
          />
          <span>When two areas overlap, the higher number wins.</span>
        </label>
        <label>
          {labels?.setting2Label ?? 'Spare setting'}
          <input
            aria-label={labels?.setting2Label ?? 'Spare setting'}
            type="number"
            min="0"
            max="65535"
            value={area.setting2}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (Number.isFinite(next)) onChangeAreaField('setting2', Math.max(0, Math.min(0xffff, Math.trunc(next))));
            }}
          />
        </label>
      </div>
    );
  }

  return (
    <div className="propertyGrid">
      <label>
        What it does
        <select aria-label="What it does" value={area.type} onChange={(event) => onChangeAreaField('type', Number(event.currentTarget.value))}>
          {areaTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Shape
        <select aria-label="Shape" value={area.shape} onChange={(event) => onChangeAreaField('shape', Number(event.currentTarget.value))}>
          {areaShapeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {(labels?.cameraLabel || area.cameraIndex !== 0xff) && (
        <label>
          {labels?.cameraLabel ?? 'Camera'}
          <ReferenceSelect
            label={labels?.cameraLabel ?? 'Camera'}
            value={area.cameraIndex}
            noneValue={0xff}
            count={referenceCounts.cameras}
            optionLabel="Camera"
            onChange={(next) => onChangeAreaField('cameraIndex', next)}
          />
        </label>
      )}
      {(labels?.routeLabel || area.routeIndex !== 0xff) && (
        <label>
          {labels?.routeLabel ?? 'Path'}
          <ReferenceSelect
            label={labels?.routeLabel ?? 'Path'}
            value={area.routeIndex}
            noneValue={0xff}
            count={referenceCounts.routes}
            optionLabel="Path"
            onChange={(next) => onChangeAreaField('routeIndex', next)}
          />
        </label>
      )}
      {(labels?.enemyLabel || area.enemyIndex !== 0xff) && (
        <label>
          {labels?.enemyLabel ?? 'Enemy route point'}
          <ReferenceSelect
            label={labels?.enemyLabel ?? 'Enemy route point'}
            value={area.enemyIndex}
            noneValue={0xff}
            count={referenceCounts.enemyPoints}
            optionLabel="Enemy route point"
            onChange={(next) => onChangeAreaField('enemyIndex', next)}
          />
        </label>
      )}
      {(labels?.setting1Label || area.setting1 !== 0) && (
        <label>
          {labels?.setting1Label ?? 'Setting'}
          {labels?.setting1Options?.length ? (
            <NumberOptionSelect
              label={labels.setting1Label ?? 'Setting'}
              value={area.setting1}
              options={labels.setting1Options}
              onChange={(next) => onChangeAreaField('setting1', next)}
            />
          ) : (
            <input
              aria-label={labels?.setting1Label ?? 'Setting'}
              type="number"
              min="0"
              max="65535"
              value={area.setting1}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (Number.isFinite(next)) onChangeAreaField('setting1', Math.max(0, Math.min(0xffff, Math.trunc(next))));
              }}
            />
          )}
        </label>
      )}
      {labels?.notes?.map((note, index) => (
        <p className="inspectorNote" key={`area-note-${area.type}-${index}`}>
          {note}
        </p>
      ))}
    </div>
  );
}
