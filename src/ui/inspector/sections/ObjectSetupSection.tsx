import type { KmpEntity } from '../../../lib/kmp';
import { setMaskedBits } from '../../../lib/kmpEdit';
import { Toggle } from '../../components/Toggle';
import type { ObjectOption } from '../../objects/objectCatalog';
import { gobjPresenceModeOptions } from '../../objects/objectOptionTables';
import { describePresenceModes, guidanceOnlyObjectProfileNotes, type ObjectInspectorProfile } from '../../objects/objectProfiles';
import { ObjectSettingsFields } from '../objectSettings/ObjectSettingsFields';

/**
 * What an object actually needs on screen: which variant it is, its own friendly settings, and
 * the three game modes it appears in.
 *
 * The raw object id, the eight raw setting slots and the presence bit mask live in the
 * inspector's single Advanced disclosure; the preset and route buttons live in the header's
 * actions menu. Nothing here is a number the game happens to store.
 */
export function ObjectSetupSection({
  entity,
  objectProfile,
  objectVariantOptions,
  onChangeObjectId,
  onChangePresenceFlags,
  onChangeObjectSetting,
  part = 'settings',
}: {
  entity: KmpEntity;
  objectProfile: ObjectInspectorProfile | null;
  objectVariantOptions: ObjectOption[];
  onChangeObjectId: (objectId: number) => void;
  onChangePresenceFlags: (value: number) => void;
  onChangeObjectSetting: (settingIndex: number, value: number) => void;
  /** `settings` is the variant and the object's own controls; `presence` is the game-mode list. */
  part?: 'settings' | 'presence';
}) {
  if (entity.objectId === undefined || !objectProfile) return null;
  const presenceFlags = entity.presenceFlags;
  const guidance = guidanceOnlyObjectProfileNotes[objectProfile.title];
  const behaviourNote = objectBehaviourNote(objectProfile, entity);
  if (part === 'presence') {
    if (presenceFlags === undefined) return null;
    return (
      <>
        <div className="inspectorCheckList">
          {gobjPresenceModeOptions.map((option) => (
            <Toggle
              key={option.mask}
              variant="checkbox"
              label={option.friendlyLabel}
              checked={(presenceFlags & option.mask) !== 0}
              onChange={(checked) => onChangePresenceFlags(setMaskedBits(presenceFlags, option.mask, checked))}
            />
          ))}
        </div>
        <p className={`inspectorNote${(presenceFlags & 0x0007) === 0 ? ' is-warning' : ''}`}>{describePresenceModes(presenceFlags)}</p>
      </>
    );
  }
  return (
    <>
      {objectVariantOptions.length > 1 && (
        <div className="propertyGrid">
          <label>
            {objectProfile.variantLabel ?? 'Variant'}
            <select aria-label={objectProfile.variantLabel ?? 'Variant'} value={String(entity.objectId)} onChange={(event) => onChangeObjectId(Number(event.currentTarget.value))}>
              {objectVariantOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="propertyGrid">
        <ObjectSettingsFields entity={entity} objectProfile={objectProfile} onChangeObjectSetting={onChangeObjectSetting} />
      </div>
      {behaviourNote && <p className="inspectorNote is-warning">{behaviourNote}</p>}
      {guidance && <p className="inspectorNote">{guidance}</p>}
    </>
  );
}

/** The one-line warning a few objects need next to their settings, in plain words. */
function objectBehaviourNote(profile: ObjectInspectorProfile, entity: KmpEntity): string | null {
  if (profile.title === 'Falling Rock' && entity.objectSettings && entity.objectSettings[2] === 0) {
    return 'This rock is set up in a way vanilla Mario Kart Wii does not handle. Use "Apply safe defaults" in the actions menu.';
  }
  if (profile.title === 'Roulette Platform') {
    return 'Mario Kart Wii expects this platform at the world centre, unrotated and at scale 1. "Apply required defaults" in the actions menu does that.';
  }
  return null;
}
