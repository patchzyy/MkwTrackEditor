import type { KmpEntity } from '../../../lib/kmp';
import { decodeSigned16, decodeWrappedSpin, encodeSigned16, encodeWrappedSpin } from '../../../lib/kmpEdit';
import {
  beltCurveStartSideOptions,
  carBodyColorOptions,
  crabDirectionOptions,
  driveableRingIdOptions,
  epropellerDirectionOptions,
  kartTruckTextureOptions,
  miiSpectatorInteractionOptions,
  pylonColorOptions,
  spinDirectionOptions,
  thwompBehaviorOptions,
  topmanBehaviorOptions,
  truckWagonCollisionOptions,
  twanwanStartModeOptions,
} from '../../objects/objectOptionTables';
import type { ObjectInspectorProfile } from '../../objects/objectProfiles';

export function ObjectSettingsFields3({
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
          {objectProfile.title === 'Bowser Fireball' && objectSettings && (
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
          {objectProfile.title === 'Chain Chomp' && objectSettings && (
            entity.objectId === 0x0eb ? (
              <>
                <label>
                  Route Speed
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
                  Start Mode
                  <select value={String(objectSettings[1])} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                    {!twanwanStartModeOptions.some((option) => option.value === objectSettings[1]) && (
                      <option value={objectSettings[1]}>
                        Custom #{objectSettings[1]}
                      </option>
                    )}
                    {twanwanStartModeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Sine Amplitude
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
                  Sine Period (frames)
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
                  Start Delay (frames)
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
                  Target Route Start Delay (frames)
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
              </>
            ) : (
              <>
                <label>
                  Chain Length
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
                    value={objectSettings[5]}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (Number.isFinite(value)) onChangeObjectSetting(5, Math.max(0, Math.min(0xffff, Math.trunc(value))));
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
                    value={objectSettings[6]}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (Number.isFinite(value)) onChangeObjectSetting(6, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                    }}
                  />
                </label>
              </>
            )
          )}
          {objectProfile.title === 'Thwomp' && objectSettings && (
            <>
              <label>
                Route Speed
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
                Route Behavior
                <select value={String(objectSettings[1])} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  {!thwompBehaviorOptions.some((option) => option.value === objectSettings[1]) && (
                    <option value={objectSettings[1]}>
                      Custom #{objectSettings[1]}
                    </option>
                  )}
                  {thwompBehaviorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start Delay (frames after GO)
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
                Sleep Time (frames)
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
              {entity.routeIndex === 0xffff && <label><span>Without a route, Route Speed and Route Behavior should stay at 0.</span></label>}
            </>
          )}
          {objectProfile.title === 'Traffic Vehicle' && objectSettings && (
            <>
              {(entity.objectId === 0xde || entity.objectId === 0xf3 || entity.objectId === 0xd0) && (
                <>
                  <label>
                    Route Start Point
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
                    Speed 0
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
                    Speed 1
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
              {(entity.objectId === 0xcc || entity.objectId === 0xe7 || entity.objectId === 0xe8 || entity.objectId === 0x181) && (
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
                    Acceleration
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
                    Pause Time
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
              {entity.objectId === 0xd0 && (
                <label>
                  Truck Texture
                  <select value={String(objectSettings[3])} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                    {!kartTruckTextureOptions.some((option) => option.value === objectSettings[3]) && (
                      <option value={objectSettings[3]}>
                        Custom #{objectSettings[3]}
                      </option>
                    )}
                    {kartTruckTextureOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {entity.objectId === 0xd1 && (
                <label>
                  Car Color
                  <select value={String(objectSettings[3])} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                    {!carBodyColorOptions.some((option) => option.value === objectSettings[3]) && (
                      <option value={objectSettings[3]}>
                        Custom #{objectSettings[3]}
                      </option>
                    )}
                    {carBodyColorOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {entity.objectId === 0x19b && (
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
                    Delay Before Group Truck Spawns (frames)
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
                    Delay Before First Group Spawns (frames)
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
                    Collision Mode
                    <select value={String(objectSettings[3])} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                      {!truckWagonCollisionOptions.some((option) => option.value === objectSettings[3]) && (
                        <option value={objectSettings[3]}>
                          Custom #{objectSettings[3]}
                        </option>
                      )}
                      {truckWagonCollisionOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </>
          )}
          {objectProfile.title === 'Moving Platform' && objectSettings && (
            <>
              {entity.objectId === 0x25c && (
                <>
                  <label>
                    Fast Side Starts
                    <select value={String(objectSettings[1])} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                      {!beltCurveStartSideOptions.some((option) => option.value === objectSettings[1]) && (
                        <option value={objectSettings[1]}>
                          Custom #{objectSettings[1]}
                        </option>
                      )}
                      {beltCurveStartSideOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Time Until Switch
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
                    Time Until Switch Back
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
              {(entity.objectId === 0x25e || entity.objectId === 0x260) && (
                <>
                  <label>
                    Speed 1 (units per second)
                    <input
                      className="routeInput"
                      type="number"
                      min="-32768"
                      max="32767"
                      value={decodeSigned16(objectSettings[1])}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(1, encodeSigned16(value));
                      }}
                    />
                  </label>
                  <label>
                    Time Until Speed 2
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
                    Speed 2 (units per second)
                    <input
                      className="routeInput"
                      type="number"
                      min="-32768"
                      max="32767"
                      value={decodeSigned16(objectSettings[3])}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(3, encodeSigned16(value));
                      }}
                    />
                  </label>
                  <label>
                    Total Time Until Speed 3
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
                    Speed 3 (units per second)
                    <input
                      className="routeInput"
                      type="number"
                      min="-32768"
                      max="32767"
                      value={decodeSigned16(objectSettings[5])}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(5, encodeSigned16(value));
                      }}
                    />
                  </label>
                </>
              )}
            </>
          )}
          {objectProfile.title === 'Cow' && objectSettings && (
            <>
              <label>
                Follower Count
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
                  value={objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Tumbleweed' && objectSettings && (
            <>
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
            </>
          )}
          {objectProfile.title === 'Traffic Cone' && objectSettings && (
            <>
              <label>
                Cone Color
                <select value={String(objectSettings[0])} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                  {!pylonColorOptions.some((option) => option.value === objectSettings[0]) && (
                    <option value={objectSettings[0]}>
                      Custom #{objectSettings[0]}
                    </option>
                  )}
                  {pylonColorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                </select>
              </label>
              <label>
                Start Delay (frames)
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
                Sleep Time (frames)
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
                One-Time Shoot
                <button
                  className={objectSettings[6] === 0 ? 'inlineAction toggleButton isActive' : 'inlineAction toggleButton'}
                  type="button"
                  onClick={() => onChangeObjectSetting(6, objectSettings[6] === 0 ? 60 : 0)}
                >
                  {objectSettings[6] === 0 ? 'Enabled (Sleep Time = 0)' : 'Disabled'}
                </button>
              </label>
            </>
          )}
          {objectProfile.title === 'Mii Spectator' && objectSettings && (entity.objectId === 0x2eb || entity.objectId === 0x2ec) && (
            <>
              <label>
                Crowd Interaction
                <select value={String(objectSettings[1])} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  {!miiSpectatorInteractionOptions.some((option) => option.value === objectSettings[1]) && (
                    <option value={objectSettings[1]}>
                      Custom #{objectSettings[1]}
                    </option>
                  )}
                  {miiSpectatorInteractionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
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
          {objectProfile.title === 'Wiggler' && objectSettings && (
            <>
              <label>
                Primary Speed
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
              {(entity.objectId === 0xf0 || entity.objectId === 0xf2) && (
                <>
                  <label>
                    Stop Time Before Speed Change (frames)
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
                    Secondary Speed
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
                    Player Trigger Point For Speed 2
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
                    Angry Speed
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
                    Player Trigger Point For Angry Speed
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
                    Alternate Stop Time Before Angry Speed (frames)
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
          )}
          {objectProfile.title === 'Spinner Hazard' && objectSettings && entity.objectId === 0x016 && (
            <>
              <label>
                Manager ID
                <input
                  className="routeInput"
                  type="number"
                  min="1"
                  max="65535"
                  value={objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(1, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Controlled Topmen
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
                Topman Behavior
                <select value={String(objectSettings[3])} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                  {!topmanBehaviorOptions.some((option) => option.value === objectSettings[3]) && (
                    <option value={objectSettings[3]}>
                      Custom #{objectSettings[3]}
                    </option>
                  )}
                  {topmanBehaviorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {objectProfile.title === 'Piranha Plant' && objectSettings && (
            <label>
              Idle Time Between Attacks (frames)
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
          {objectProfile.title === 'Crab' && objectSettings && (
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
                View Direction
                <select value={String(objectSettings[1])} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  {!crabDirectionOptions.some((option) => option.value === objectSettings[1]) && (
                    <option value={objectSettings[1]}>
                      Custom #{objectSettings[1]}
                    </option>
                  )}
                  {crabDirectionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {objectProfile.title === 'Fire Bar' && objectSettings && (() => {
            const spin = decodeWrappedSpin(objectSettings[1]);
            const isFireRing = entity.objectId === 0x1a1;
            return (
              <>
                <label>
                  {isFireRing ? 'Fireball Count' : 'Fireballs Per Arm'}
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
                  Spin Direction
                  <select
                    value={String(spin.direction)}
                    onChange={(event) => onChangeObjectSetting(1, encodeWrappedSpin(spin.speed, Number(event.currentTarget.value)))}
                  >
                    {spinDirectionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Spin Speed
                  <input
                    className="routeInput"
                    type="number"
                    min="0"
                    max="65535"
                    value={spin.speed}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (Number.isFinite(value)) onChangeObjectSetting(1, encodeWrappedSpin(value, spin.direction));
                    }}
                  />
                </label>
                <label>
                  {isFireRing ? 'Pulsation Factor' : 'Fireball Spacing'}
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
                  {isFireRing ? 'Radius' : 'Number Of Arms'}
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
            );
          })()}
          {objectProfile.title === 'Driveable Ring' && objectSettings && (
            <>
              <label>
                Ring Layout
                <select value={String(objectSettings[0])} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                  {!driveableRingIdOptions.some((option) => option.value === objectSettings[0]) && (
                    <option value={objectSettings[0]}>
                      Custom #{objectSettings[0]}
                    </option>
                  )}
                  {driveableRingIdOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start Shake After (seconds)
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
                Shake Duration (seconds)
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
                Fall Delay (frames)
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
          {objectProfile.title === 'Electric Propeller' && objectSettings && (
            <>
              <label>
                Rotations Per 12 Seconds
                <input
                  className="routeInput"
                  type="number"
                  min="1"
                  max="65535"
                  value={objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(1, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Rotation Direction
                <select value={String(objectSettings[1])} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  {!epropellerDirectionOptions.some((option) => option.value === objectSettings[1]) && (
                    <option value={objectSettings[1]}>
                      Custom #{objectSettings[1]}
                    </option>
                  )}
                  {epropellerDirectionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Slowdown Factor (LE-CODE)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={objectSettings[7]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(7, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Star Gate' && objectSettings && (
            <>
              <label>
                Gate Number
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
                Trigger
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
                Airborne Shadow
                <select value={String(objectSettings[2])} onChange={(event) => onChangeObjectSetting(2, Number(event.currentTarget.value))}>
                  {objectSettings[2] !== 0 && objectSettings[2] !== 1 && (
                    <option value={objectSettings[2]}>
                      Custom #{objectSettings[2]}
                    </option>
                  )}
                  <option value="0">Normal</option>
                  <option value="1">Increase Shadow Height</option>
                </select>
              </label>
            </>
          )}
    </>
  );
}
