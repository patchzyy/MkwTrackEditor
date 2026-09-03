import type { KmpEntity } from '../../../lib/kmp';
import type { ObjectOption } from '../../objects/objectCatalog';
import { formatPresenceFlagsHex } from '../../objects/objectProfiles';
import { ObjectIdSelect } from '../fields/ObjectIdSelect';

/**
 * The raw object record: the type picker over every id in the game, the eight setting slots as
 * numbers, and the presence bit mask. Rendered only inside the inspector's single Advanced
 * disclosure — the friendly equivalents are in `ObjectSetupSection`.
 */
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
  if (entity.objectId === undefined && !entity.objectSettings && entity.presenceFlags === undefined) return null;
  return (
    <div className="propertyGrid">
      {entity.objectId !== undefined && (
        <label>
          Object type
          <ObjectIdSelect value={entity.objectId} options={objectOptions} onChange={onChangeObjectId} />
          <span>Object id {entity.objectId} (0x{entity.objectId.toString(16).toUpperCase()})</span>
        </label>
      )}
      {entity.objectSettings && (
        <label>
          Raw setting slots
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
          Presence flags
          <input
            className="routeInput"
            aria-label="Presence flags"
            type="number"
            min="0"
            max="65535"
            value={entity.presenceFlags}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value)) onChangePresenceFlags(Math.max(0, Math.min(0xffff, Math.trunc(value))));
            }}
          />
          <span>{formatPresenceFlagsHex(entity.presenceFlags)}. Only the bottom three bits matter in vanilla Mario Kart Wii.</span>
        </label>
      )}
    </div>
  );
}
