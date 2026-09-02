import type { KmpEntity } from '../../../lib/kmp';
import { toSigned16, toUnsigned16 } from '../../../lib/kmpEdit';
import {
  audienceFlashSkateOptions,
  audienceFlashWaluigiOptions,
  coinModeOptions,
  directItemOptions,
  topmanBehaviorOptions,
} from '../../objects/objectOptionTables';
import type { ObjectInspectorProfile } from '../../objects/objectProfiles';

export function ObjectSettingsFields1({
  entity,
  objectProfile,
  onChangeObjectSetting,
}: {
  entity: KmpEntity;
  objectProfile: ObjectInspectorProfile;
  onChangeObjectSetting: (settingIndex: number, value: number) => void;
}) {
  const objectSettings = entity.objectSettings;
  return (
    <>
          {objectProfile.title === 'Rising Water' && objectSettings && (
            <>
              <label>
                Rising Speed (Odd Stages)
                <input
                  className="routeInput"
                  type="number"
                  min="-32768"
                  max="32767"
                  value={toSigned16(objectSettings[0])}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, toUnsigned16(value));
                  }}
                />
              </label>
              <label>
                Stage 5 Target Height
                <input
                  className="routeInput"
                  type="number"
                  min="-32768"
                  max="32767"
                  value={toSigned16(objectSettings[1])}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, toUnsigned16(value));
                  }}
                />
              </label>
              <label>
                Stage 1 Target Height
                <input
                  className="routeInput"
                  type="number"
                  min="-32768"
                  max="32767"
                  value={toSigned16(objectSettings[2])}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, toUnsigned16(value));
                  }}
                />
              </label>
              <label>
                Stage 2 Frame Count
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[3]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Stage 3 Target Height
                <input
                  className="routeInput"
                  type="number"
                  min="-32768"
                  max="32767"
                  value={toSigned16(objectSettings[4])}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(4, toUnsigned16(value));
                  }}
                />
              </label>
              <label>
                Stage 4 Frame Count
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[5]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(5, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Rising Speed (Even Stages)
                <input
                  className="routeInput"
                  type="number"
                  min="-32768"
                  max="32767"
                  value={toSigned16(objectSettings[6])}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(6, toUnsigned16(value));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Splash Trigger' && objectSettings && (
            <label>
              Group Y KCL Index
              <input
                className="routeInput"
                type="number"
                min="0"
                max="65535"
                value={objectSettings[0]}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                }}
              />
            </label>
          )}
          {objectProfile.title === 'Enemy Route Controller' && objectSettings && (
            <>
              <label>
                Entry Flag
                <select value={objectSettings[0]} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                  <option value={0}>Do Not Enter</option>
                  <option value={1}>Enter</option>
                </select>
              </label>
              <label>
                Time To Next Controller
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Controller ID
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Next Controller ID
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[3]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                ENPH Section Override
                <input
                  className="routeInput"
                  type="number"
                  min="-32768"
                  max="32767"
                  value={toSigned16(objectSettings[7])}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(7, toUnsigned16(value));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Topman Manager' && objectSettings && (
            <>
              <label>
                Manager ID
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Topmen Controlled
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                First Topman ID
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Behavior
                <select value={objectSettings[3]} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                  {!topmanBehaviorOptions.some((option) => option.value === objectSettings[3]) && (
                    <option value={objectSettings[3]}>Custom #{objectSettings[3]}</option>
                  )}
                  {topmanBehaviorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cumulative Topmen Count
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[4]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(4, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Pole Collision Controller' && objectSettings && (
            <label>
              Wall KCL Variant
              <input
                className="routeInput"
                type="number"
                min="0"
                max="65535"
                value={objectSettings[0]}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                }}
              />
            </label>
          )}
          {objectProfile.title === 'Coin Pickup' && objectSettings && (
            <>
              <label>
                Mode
                <select value={objectSettings[0]} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                  {coinModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start / Respawn Place
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Spawn Behavior
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Direct Item Spawn' && objectSettings && (
            <label>
              Item Type
              <select value={objectSettings[0]} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                {!directItemOptions.some((option) => option.value === objectSettings[0]) && (
                  <option value={objectSettings[0]}>Custom #{objectSettings[0]}</option>
                )}
                {directItemOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {objectProfile.title === 'Moving Wall' && objectSettings && (
            <>
              <label>
                Start Pause
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                End Pause
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Move Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Travel Distance
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[3]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Initial Delay
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[4]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(4, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Falling Block' && objectSettings && (
            <>
              <label>
                Countdown Fall Time
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Extra Delay
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Pianta Spectator' && objectSettings && (
            <>
              <label>
                Clap And Face Player
                <select value={objectSettings[1]} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  <option value={0}>Disabled</option>
                  <option value={1}>Enabled</option>
                </select>
              </label>
              <label>
                Face Player Distance
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Clap Animation Distance
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[3]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Fireworks' && objectSettings && (
            <label>
              Pop Delay
              <input
                className="routeInput"
                type="number"
                min="0"
                max="65535"
                value={objectSettings[0]}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                }}
              />
            </label>
          )}
          {objectProfile.title === 'Steam Effect' && objectSettings && (
            <>
              <label>
                Start Delay
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Burst Length
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Time Between Bursts
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[3]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Bowser Statue' && objectSettings && (
            <>
              <label>
                Activation Distance
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Fire Behavior
                <select value={objectSettings[1]} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  <option value={0}>Decoration</option>
                  <option value={1}>Obstacle</option>
                </select>
              </label>
              <label>
                Start Delay
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Audience Flash' && objectSettings && entity.objectId === 0x2d2 && (
            <label>
              Flash Variant
              <select value={objectSettings[0]} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                {audienceFlashWaluigiOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {objectProfile.title === 'Audience Flash' && objectSettings && entity.objectId === 0x2d4 && (
            <label>
              Flash Variant
              <select value={objectSettings[0]} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                {audienceFlashSkateOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {objectProfile.title === 'Lava Bubble' && objectSettings && (
            <>
              <label>
                Start Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Flip Horizontally
                <select value={objectSettings[1]} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  <option value={0}>Disabled</option>
                  <option value={1}>Enabled</option>
                </select>
              </label>
            </>
          )}
          {objectProfile.title === 'Flying Flock' && objectSettings && (
            <>
              <label>
                Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Flock Count
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Route Boat' && objectSettings && (
            <label>
              Start Speed
              <input
                className="routeInput"
                type="number"
                min="0"
                max="65535"
                value={objectSettings[0]}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                }}
              />
            </label>
          )}
    </>
  );
}
