import type { KmpEntity } from '../../../lib/kmp';
import {
  enemyRouteSetting1Options,
  enemyRouteSetting2Options,
  itemRouteSetting1Options,
  itemRouteSetting2Options,
  potiRouteMotionOptions,
  potiRouteShapeOptions,
} from '../optionTables';

export function RoutePointSection({
  entity,
  onChangePointDeviation,
  onChangePointSetting,
  onChangePotiRouteSetting,
  onChangePotiPointSetting,
}: {
  entity: KmpEntity;
  onChangePointDeviation: (value: number) => void;
  onChangePointSetting: (settingIndex: number, value: number) => void;
  onChangePotiRouteSetting: (settingIndex: number, value: number) => void;
  onChangePotiPointSetting: (settingIndex: number, value: number) => void;
}) {
  return (
    <>
      {entity.pointSettings && (
        <>
          {entity.pointDeviation !== undefined && (
            <label>
              Deviation
              <input
                type="number"
                step="0.1"
                value={Number.isFinite(entity.pointDeviation) ? Number(entity.pointDeviation.toFixed(3)) : 0}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) onChangePointDeviation(value);
                }}
              />
            </label>
          )}
          {entity.section === 'ENPT' ? (
            <>
              <label>
                Mushroom / Wheelie
                <select value={entity.pointSettings[0]} onChange={(event) => onChangePointSetting(0, Number(event.currentTarget.value))}>
                  {enemyRouteSetting1Options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Drift Behavior
                <select value={entity.pointSettings[1]} onChange={(event) => onChangePointSetting(1, Number(event.currentTarget.value))}>
                  {enemyRouteSetting2Options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Route Setting 3
                <input
                  type="number"
                  min="0"
                  max="255"
                  value={entity.pointSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangePointSetting(2, Math.max(0, Math.min(0xff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          ) : entity.section === 'ITPT' ? (
            <>
              <label>
                Bullet Bill Gravity
                <select value={entity.pointSettings[0]} onChange={(event) => onChangePointSetting(0, Number(event.currentTarget.value))}>
                  {itemRouteSetting1Options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Route Priority / Stop
                <select value={entity.pointSettings[1]} onChange={(event) => onChangePointSetting(1, Number(event.currentTarget.value))}>
                  {itemRouteSetting2Options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <label>
              Point Settings
              <div className="settingInputs">
                {entity.pointSettings.map((setting, index) => (
                  <input
                    key={index}
                    aria-label={`Point setting ${index + 1}`}
                    type="number"
                    min="0"
                    max={entity.section === 'ENPT' && index > 0 ? 255 : 65535}
                    value={setting}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      const max = entity.section === 'ENPT' && index > 0 ? 0xff : 0xffff;
                      if (Number.isFinite(value)) onChangePointSetting(index, Math.max(0, Math.min(max, Math.trunc(value))));
                    }}
                  />
                ))}
              </div>
            </label>
          )}
        </>
      )}
      {entity.poti && (
        <>
          <label>
            Route Edge Mode
            <select value={entity.poti.routeSetting1} onChange={(event) => onChangePotiRouteSetting(0, Number(event.currentTarget.value))}>
              {potiRouteShapeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Motion Mode
            <select value={entity.poti.routeSetting2} onChange={(event) => onChangePotiRouteSetting(1, Number(event.currentTarget.value))}>
              {potiRouteMotionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Route Node Setting 1
            <input
              aria-label="Route node setting 1"
              type="number"
              min="0"
              max="65535"
              value={entity.poti.pointSetting1}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value)) onChangePotiPointSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
              }}
            />
          </label>
          <label>
            Route Node Setting 2
            <input
              aria-label="Route node setting 2"
              type="number"
              min="0"
              max="65535"
              value={entity.poti.pointSetting2}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value)) onChangePotiPointSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
              }}
            />
          </label>
        </>
      )}
    </>
  );
}
