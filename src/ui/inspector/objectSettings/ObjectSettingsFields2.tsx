import type { KmpEntity } from '../../../lib/kmp';
import {
  cataquackColorOptions,
  chairliftModelOptions,
  itemBoxSettingOptions,
  itemBoxTimingOptions,
  shyGuyColorOptions,
} from '../../objects/objectOptionTables';
import type { ObjectInspectorProfile } from '../../objects/objectProfiles';

export function ObjectSettingsFields2({
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
          {objectProfile.title === 'Item Box' && objectSettings && (
            <>
              <label>
                Player Item
                <select value={String(objectSettings[1])} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  {!itemBoxSettingOptions.some((option) => option.value === objectSettings[1]) && (
                    <option value={objectSettings[1]}>
                      Custom #{objectSettings[1]}
                    </option>
                  )}
                  {itemBoxSettingOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                CPU Item
                <select value={String(objectSettings[2])} onChange={(event) => onChangeObjectSetting(2, Number(event.currentTarget.value))}>
                  {!itemBoxSettingOptions.some((option) => option.value === objectSettings[2]) && (
                    <option value={objectSettings[2]}>
                      Custom #{objectSettings[2]}
                    </option>
                  )}
                  {itemBoxSettingOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Roulette / Respawn
                <select value={String(objectSettings[5])} onChange={(event) => onChangeObjectSetting(5, Number(event.currentTarget.value))}>
                  {!itemBoxTimingOptions.some((option) => option.value === objectSettings[5]) && (
                    <option value={objectSettings[5]}>
                      Custom #{objectSettings[5]}
                    </option>
                  )}
                  {itemBoxTimingOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {entity.objectId === 0xc9 && (
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
                    Route Start Point
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
                  <label>
                    Shadow
                    <select value={String(objectSettings[3])} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                      {objectSettings[3] !== 0 && objectSettings[3] !== 1 && (
                        <option value={objectSettings[3]}>
                          Custom #{objectSettings[3]}
                        </option>
                      )}
                      <option value="0">Render Shadow</option>
                      <option value="1">Hide Shadow</option>
                    </select>
                  </label>
                </>
              )}
              {entity.objectId === 0xd4 && (
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
                    Start Delay
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
                  <label>
                    Time Between Boxes
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
                    Box Count
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={objectSettings[6]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(6, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Shadow
                    <select value={String(objectSettings[3])} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                      {objectSettings[3] !== 0 && objectSettings[3] !== 1 && (
                        <option value={objectSettings[3]}>
                          Custom #{objectSettings[3]}
                        </option>
                      )}
                      <option value="0">Render Shadow</option>
                      <option value="1">Hide Shadow</option>
                    </select>
                  </label>
                </>
              )}
              {entity.objectId === 0xd5 && (
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
                    Start Delay
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
                  <label>
                    Shadow
                    <select value={String(objectSettings[3])} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                      {objectSettings[3] !== 0 && objectSettings[3] !== 1 && (
                        <option value={objectSettings[3]}>
                          Custom #{objectSettings[3]}
                        </option>
                      )}
                      <option value="0">Render Shadow</option>
                      <option value="1">Hide Shadow</option>
                    </select>
                  </label>
                </>
              )}
              {entity.objectId === 0xee && (
                <>
                  <label>
                    Cycle Time
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
                    Start Delay
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
                  <label>
                    Shadow
                    <select value={String(objectSettings[3])} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                      {objectSettings[3] !== 0 && objectSettings[3] !== 1 && (
                        <option value={objectSettings[3]}>
                          Custom #{objectSettings[3]}
                        </option>
                      )}
                      <option value="0">Render Shadow</option>
                      <option value="1">Hide Shadow</option>
                    </select>
                  </label>
                </>
              )}
            </>
          )}
          {objectProfile.title === 'Podoboo' && objectSettings && (
            <>
              <label>
                Start Delay (frames after GO)
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
                Respawn Interval (frames)
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
                Landing Distance
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
          {objectProfile.title === 'Volcano Rock' && objectSettings && (
            <>
              <label>
                Fireball Speed
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
                Delay Before Starting
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
                Time Between Fireballs
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
                Time Until Fire Goes Out
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
          {objectProfile.title === 'Goomba' && objectSettings && (
            <>
              <label>
                Respawn Time
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
                Speed
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
                Animation Speed
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
          {objectProfile.title === 'Penguin' && objectSettings && (
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
          )}
          {objectProfile.title === 'Monty Mole' && objectSettings && (
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
                Start Delay (frames)
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
          {objectProfile.title === 'Shy Guy' && objectSettings && (
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
                Color
                <select value={String(objectSettings[1])} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  {!shyGuyColorOptions.some((option) => option.value === objectSettings[1]) && (
                    <option value={objectSettings[1]}>
                      Custom #{objectSettings[1]}
                    </option>
                  )}
                  {shyGuyColorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {objectProfile.title === 'Ski Lift' && objectSettings && (
            <label>
              Chairlift Model
              <select value={String(objectSettings[0])} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                {!chairliftModelOptions.some((option) => option.value === objectSettings[0]) && (
                  <option value={objectSettings[0]}>
                    Custom #{objectSettings[0]}
                  </option>
                )}
                {chairliftModelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {objectProfile.title === 'Shy Guy Obstacle' && objectSettings && entity.objectId === 0x0ce && (
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
                Vertical Bob Strength
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
          {objectProfile.title === 'Shy Guy Obstacle' && objectSettings && entity.objectId === 0x0ea && (
            <>
              <label>
                Source Ship Route
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
                Flight Time (frames)
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
          {objectProfile.title === 'Balloon Hazard' && objectSettings && (
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
                Max Vertical Drift
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
          {objectProfile.title === 'Cataquack' && objectSettings && (
            <>
              <label>
                Color
                <select value={String(objectSettings[0])} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                  {!cataquackColorOptions.some((option) => option.value === objectSettings[0]) && (
                    <option value={objectSettings[0]}>
                      Custom #{objectSettings[0]}
                    </option>
                  )}
                  {cataquackColorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Detection Distance
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
          {objectProfile.title === 'Flame Jet' && objectSettings && entity.objectId === 0x1fd && (
            <>
              <label>
                Cycle Length (frames + 9 seconds)
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
                Start Delay (frames)
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
                Size Factor
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
          {objectProfile.title === 'Flame Jet' && objectSettings && entity.objectId === 0x212 && (
            <>
              <label>
                Total Cycle Length
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
                Start Delay (frames)
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
                Drop Height / 384
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
                Idle Time Offset
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
          {objectProfile.title === 'Flame Jet' && objectSettings && entity.objectId === 0x216 && (
            <>
              <label>
                Time Outside Lava
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
                Start Delay (frames)
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
                Time Outside-Lava Mode
                <select value={String(objectSettings[2])} onChange={(event) => onChangeObjectSetting(2, Number(event.currentTarget.value))}>
                  {objectSettings[2] !== 0 && objectSettings[2] !== 1 && (
                    <option value={objectSettings[2]}>
                      Custom #{objectSettings[2]}
                    </option>
                  )}
                  <option value="0">Use Default 5 Seconds</option>
                  <option value="1">Use Setting 1</option>
                </select>
              </label>
            </>
          )}
          {objectProfile.title === 'Angry Sun' && objectSettings && (
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
                Start Delay (frames)
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
          {objectProfile.title === 'Quicksand' && objectSettings && (
            <>
              <label>
                Center Thwomp
                <select value={String(objectSettings[0])} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                  {objectSettings[0] !== 0 && objectSettings[0] !== 1 && (
                    <option value={objectSettings[0]}>
                      Custom #{objectSettings[0]}
                    </option>
                  )}
                  <option value="0">Use Thwomp</option>
                  <option value="1">No Thwomp</option>
                </select>
              </label>
              <label>
                Sand Wave Length
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
                Wave Travel Time
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
          {objectProfile.title === 'Crusher' && objectSettings && (
            <>
              <label>
                Start Delay (frames)
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
                Sleep Time (frames)
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
          {objectProfile.title === 'Breakable Box' && objectSettings && entity.objectId === 0xd3 && (
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
                Item Reward
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
                Reward Chance
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
                Start Delay
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
              <label>
                Time Between Boxes
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
                Maximum Boxes
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[6]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(6, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Pokey' && objectSettings && (
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
          )}
          {objectProfile.title === 'Swooper' && objectSettings && (
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
                Next Group Delay (frames)
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
                Swoops Per Group
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
                Route Drift
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
                Maximum Height
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
              <label>
                Spacing Within Group
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
                Start Delay (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[6]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(6, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
    </>
  );
}
