import type { KmpAreaField, KmpEntity } from '../../../lib/kmp';
import type { ReferenceCounts } from '../../../lib/kmpEdit';
import { getAreaInspectorConfig, type AreaInspectorResources } from '../../areas/areaInspectorConfig';
import { NumberOptionSelect } from '../fields/NumberOptionSelect';
import { ReferenceSelect } from '../fields/ReferenceSelect';
import { areaShapeOptions, areaTypeOptions } from '../optionTables';

export function AreaSection({
  entity,
  referenceCounts,
  areaInspectorResources,
  onChangeAreaField,
}: {
  entity: KmpEntity;
  referenceCounts: ReferenceCounts;
  areaInspectorResources: AreaInspectorResources;
  onChangeAreaField: (field: KmpAreaField, value: number) => void;
}) {
  const areaInspectorLabels = entity.area ? getAreaInspectorConfig(entity.area.type, areaInspectorResources) : null;
  return (
    <>
      {entity.area && (
        <>
          <label>
            Area Type
            <select value={entity.area.type} onChange={(event) => onChangeAreaField('type', Number(event.currentTarget.value))}>
              {areaTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Area Shape
            <select value={entity.area.shape} onChange={(event) => onChangeAreaField('shape', Number(event.currentTarget.value))}>
              {areaShapeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <input
              type="number"
              min="0"
              max="255"
              value={entity.area.priority}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (Number.isFinite(next)) onChangeAreaField('priority', Math.max(0, Math.min(0xff, Math.trunc(next))));
              }}
            />
          </label>
          {areaInspectorLabels?.notes?.map((note, index) => (
            <label key={`area-note-${entity.area!.type}-${index}`}>
              {index === 0 ? 'Behavior' : 'Note'}
              <span>{note}</span>
            </label>
          ))}
          {(areaInspectorLabels?.cameraLabel || entity.area.cameraIndex !== 0xff) && (
            <label>
              {areaInspectorLabels?.cameraLabel ?? 'Camera'}
              <ReferenceSelect
                label={areaInspectorLabels?.cameraLabel ?? 'Camera'}
                value={entity.area.cameraIndex}
                noneValue={0xff}
                count={referenceCounts.cameras}
                optionLabel="Camera"
                onChange={(next) => onChangeAreaField('cameraIndex', next)}
              />
            </label>
          )}
          {(areaInspectorLabels?.routeLabel || entity.area.routeIndex !== 0xff) && (
            <label>
              {areaInspectorLabels?.routeLabel ?? 'Route'}
              <ReferenceSelect
                label={areaInspectorLabels?.routeLabel ?? 'Route'}
                value={entity.area.routeIndex}
                noneValue={0xff}
                count={referenceCounts.routes}
                optionLabel="Route"
                onChange={(next) => onChangeAreaField('routeIndex', next)}
              />
            </label>
          )}
          {(areaInspectorLabels?.enemyLabel || entity.area.enemyIndex !== 0xff) && (
            <label>
              {areaInspectorLabels?.enemyLabel ?? 'Enemy Point'}
              <ReferenceSelect
                label={areaInspectorLabels?.enemyLabel ?? 'Enemy Point'}
                value={entity.area.enemyIndex}
                noneValue={0xff}
                count={referenceCounts.enemyPoints}
                optionLabel="Enemy"
                onChange={(next) => onChangeAreaField('enemyIndex', next)}
              />
            </label>
          )}
          {(areaInspectorLabels?.setting1Label || entity.area.setting1 !== 0) && (
            <label>
              {areaInspectorLabels?.setting1Label ?? 'Setting 1'}
              {areaInspectorLabels?.setting1Options?.length ? (
                <NumberOptionSelect
                  label={areaInspectorLabels.setting1Label ?? 'Setting 1'}
                  value={entity.area.setting1}
                  options={areaInspectorLabels.setting1Options}
                  onChange={(next) => onChangeAreaField('setting1', next)}
                />
              ) : (
                <input
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.area.setting1}
                  onChange={(event) => {
                    const next = Number(event.currentTarget.value);
                    if (Number.isFinite(next)) onChangeAreaField('setting1', Math.max(0, Math.min(0xffff, Math.trunc(next))));
                  }}
                />
              )}
            </label>
          )}
          {(areaInspectorLabels?.setting2Label || entity.area.setting2 !== 0) && (
            <label>
              {areaInspectorLabels?.setting2Label ?? 'Setting 2'}
              <input
                type="number"
                min="0"
                max="65535"
                value={entity.area.setting2}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeAreaField('setting2', Math.max(0, Math.min(0xffff, Math.trunc(next))));
                }}
              />
            </label>
          )}
        </>
      )}
    </>
  );
}
