import type { KmpEntity } from '../../../lib/kmp';
import type { ObjectOption } from '../../objects/objectCatalog';
import { ObjectIdSelect } from '../fields/ObjectIdSelect';

export function AdvancedObjectSection({
  entity,
  objectOptions,
  onChangeObjectId,
  onChangeObjectSetting,
  onChangePresenceFlags,
}: {
  entity: KmpEntity;
  objectOptions: ObjectOption[];
  onChangeObjectId: (objectId: number) => void;
  onChangeObjectSetting: (settingIndex: number, value: number) => void;
  onChangePresenceFlags: (value: number) => void;
}) {
  return (
    <>
      {(entity.objectId !== undefined || entity.objectSettings || entity.presenceFlags !== undefined) && (
        <details className="advancedDetails">
          <summary>Advanced object data</summary>
          <div className="advancedDetailsBody">
            {entity.objectId !== undefined && (
              <label>
                Object
                <ObjectIdSelect value={entity.objectId} options={objectOptions} onChange={onChangeObjectId} />
              </label>
            )}
            {entity.objectSettings && (
              <label>
                Object Slots
                <div className="settingInputs">
                  {entity.objectSettings.map((setting, index) => (
                    <input
                      key={index}
                      aria-label={`Setting ${index + 1}`}
                      title={`Setting ${index + 1}`}
                      type="number"
                      min="0"
                      max="65535"
                      value={setting}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(index, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  ))}
                </div>
              </label>
            )}
            {entity.presenceFlags !== undefined && (
              <label>
                Presence Flags
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.presenceFlags}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangePresenceFlags(Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            )}
          </div>
        </details>
      )}
    </>
  );
}
