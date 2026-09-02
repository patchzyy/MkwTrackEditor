import type { KmpEntity } from '../../../lib/kmp';
import { setMaskedBits } from '../../../lib/kmpEdit';
import type { ObjectOption } from '../../objects/objectCatalog';
import { gobjPresenceModeOptions } from '../../objects/objectOptionTables';
import { describePresenceFlags, guidanceOnlyObjectProfileNotes, type ObjectInspectorProfile } from '../../objects/objectProfiles';
import { ObjectSettingsFields } from '../objectSettings/ObjectSettingsFields';

export function ObjectSetupSection({
  entity,
  objectProfile,
  objectVariantOptions,
  onChangeObjectId,
  onChangePresenceFlags,
  onChangeObjectSetting,
  onResetObjectBehavior,
  onClearObjectRoute,
  onSelectObjectRoute,
  onApplySafeFallingRockDefaults,
  onCreateCannonPointFromObject,
  onApplyRoulettePlatformDefaults,
}: {
  entity: KmpEntity;
  objectProfile: ObjectInspectorProfile | null;
  objectVariantOptions: ObjectOption[];
  onChangeObjectId: (objectId: number) => void;
  onChangePresenceFlags: (value: number) => void;
  onChangeObjectSetting: (settingIndex: number, value: number) => void;
  onResetObjectBehavior?: () => void;
  onClearObjectRoute?: () => void;
  onSelectObjectRoute?: () => void;
  onApplySafeFallingRockDefaults?: () => void;
  onCreateCannonPointFromObject?: () => void;
  onApplyRoulettePlatformDefaults?: () => void;
}) {
  const objectSettings = entity.objectSettings;
  const objectPresenceBaseFlags = entity.presenceFlags !== undefined ? entity.presenceFlags & ~0x0007 : 0;
  const objectPresencePlayerFlags = entity.presenceFlags !== undefined ? entity.presenceFlags & 0x0007 : 0;
  const objectHasExtraPresenceBits = entity.presenceFlags !== undefined && objectPresenceBaseFlags !== 0;
  return (
    <>
      {entity.objectId !== undefined && objectProfile && <div className="detailsSectionHeader">Object Setup</div>}
      {entity.objectId !== undefined && objectProfile && (
        <>
          <label>
            Object Setup
            <span>{objectProfile.title}</span>
          </label>
          <label>
            Quick Setup
            <span>{objectProfile.summary}</span>
          </label>
          {objectProfile.tips.map((tip, index) => (
            <label key={`${objectProfile.title}-tip-${index}`}>
              Tip {index + 1}
              <span>{tip}</span>
            </label>
          ))}
          {objectProfile.cautions?.map((caution, index) => (
            <label key={`${objectProfile.title}-caution-${index}`}>
              Watch out
              <span>{caution}</span>
            </label>
          ))}
          {guidanceOnlyObjectProfileNotes[objectProfile.title] && (
            <label>
              Setup Surface
              <span>{guidanceOnlyObjectProfileNotes[objectProfile.title]}</span>
            </label>
          )}
          {objectVariantOptions.length > 1 && (
            <label>
              {objectProfile.variantLabel ?? 'Variant'}
              <select value={String(entity.objectId)} onChange={(event) => onChangeObjectId(Number(event.currentTarget.value))}>
                {objectVariantOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {entity.presenceFlags !== undefined && (
            <label>
              Visibility
              <div className="actionStack">
                <div className="toggleGrid">
                  {gobjPresenceModeOptions.map((option) => {
                    const active = (objectPresencePlayerFlags & option.mask) !== 0;
                    return (
                      <button
                        key={option.mask}
                        className={`inlineAction toggleButton${active ? ' isActive' : ''}`}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChangePresenceFlags(setMaskedBits(entity.presenceFlags ?? 0, option.mask, !active))}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <div className="actionRow">
                  <button className="inlineAction" type="button" onClick={() => onChangePresenceFlags(objectPresenceBaseFlags | 0x0007)}>
                    Show Everywhere
                  </button>
                  <button className="inlineAction" type="button" onClick={() => onChangePresenceFlags(objectPresenceBaseFlags | 0x0001)}>
                    1P Only
                  </button>
                  <button className="inlineAction" type="button" onClick={() => onChangePresenceFlags(objectPresenceBaseFlags)}>
                    Hide
                  </button>
                </div>
                <span>{describePresenceFlags(entity.presenceFlags)}</span>
                {objectHasExtraPresenceBits && <span>Keeps extra presence bits above 0x0007 for compatibility.</span>}
              </div>
            </label>
          )}
          <ObjectSettingsFields entity={entity} objectProfile={objectProfile} onChangeObjectSetting={onChangeObjectSetting} />
          {objectProfile.title === 'Falling Rock' && objectSettings && (
            <label>
              Safety Setup
              <div className="actionRow">
                <button className="inlineAction" type="button" onClick={onApplySafeFallingRockDefaults} disabled={!onApplySafeFallingRockDefaults}>
                  Apply Safe Vanilla Defaults
                </button>
              </div>
              <span>{objectSettings[2] === 0 ? 'Setting 3 is currently unsafe for vanilla Mario Kart Wii.' : `Setting 3 is currently ${objectSettings[2]}.`}</span>
            </label>
          )}
          {objectProfile.title === 'Cannon Object' && (
            <label>
              Cannon Setup
              <div className="actionRow">
                <button className="inlineAction" type="button" onClick={onCreateCannonPointFromObject} disabled={!onCreateCannonPointFromObject}>
                  Create Cannon Point
                </button>
              </div>
              <span>Creates a cannon point at this prop so you can tune the actual launch logic next.</span>
            </label>
          )}
          {objectProfile.title === 'Roulette Platform' && (
            <label>
              Roulette Setup
              <div className="actionRow">
                <button className="inlineAction" type="button" onClick={onApplyRoulettePlatformDefaults} disabled={!onApplyRoulettePlatformDefaults}>
                  Apply Required Defaults
                </button>
              </div>
              <span>Mario Kart Wii expects this object at the world center with zero rotation and a scale of 1 on all axes.</span>
            </label>
          )}
          {objectProfile.routeLabel && entity.routeIndex !== undefined && entity.routeIndex !== 0xffff && (
            <label>
              {objectProfile.routeLabel}
              <div className="actionRow">
                <button className="inlineAction" type="button" onClick={onSelectObjectRoute} disabled={!onSelectObjectRoute}>
                  Select Path
                </button>
              </div>
              <span>Jumps straight to the first node of the bound route so you can edit motion without searching the scene.</span>
            </label>
          )}
          {(onResetObjectBehavior || onClearObjectRoute) && (
            <label>
              Object Actions
              <div className="actionRow">
                <button className="inlineAction" type="button" onClick={onResetObjectBehavior} disabled={!onResetObjectBehavior}>
                  Reset Defaults
                </button>
                <button className="inlineAction" type="button" onClick={onClearObjectRoute} disabled={!onClearObjectRoute || entity.routeIndex === undefined || entity.routeIndex === 0xffff}>
                  Clear Path
                </button>
              </div>
            </label>
          )}
        </>
      )}
    </>
  );
}
