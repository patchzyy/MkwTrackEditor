import type { KmpEntity } from '../../../lib/kmp';
import {
  enemyRouteSetting1Options,
  enemyRouteSetting2Options,
  itemRouteSetting1Options,
  itemRouteSetting2Options,
  potiRouteMotionOptions,
  potiRouteShapeOptions,
} from '../optionTables';
import type { InspectorScope } from './scope';
import { PropertyRow } from '../PropertySheet';

/**
 * Enemy / item route points and object-route (POTI) nodes.
 *
 * Essentials are the choices that have a plain-language meaning — what the CPU does here, how
 * the path is shaped, how a follower moves along it. The corridor width, the spare byte and
 * the two per-node numbers are Advanced.
 */
export function RoutePointSection({
  entity,
  scope,
  onChangePointDeviation,
  onChangePointSetting,
  onChangePotiRouteSetting,
  onChangePotiPointSetting,
}: {
  entity: KmpEntity;
  scope: InspectorScope;
  onChangePointDeviation: (value: number) => void;
  onChangePointSetting: (settingIndex: number, value: number) => void;
  onChangePotiRouteSetting: (settingIndex: number, value: number) => void;
  onChangePotiPointSetting: (settingIndex: number, value: number) => void;
}) {
  const pointSettings = entity.pointSettings;
  const poti = entity.poti;
  if (!pointSettings && !poti) return null;

  if (scope === 'advanced') {
    const showSpare = pointSettings !== undefined && entity.section === 'ENPT';
    const showRaw = pointSettings !== undefined && entity.section !== 'ENPT' && entity.section !== 'ITPT';
    if (entity.pointDeviation === undefined && !showSpare && !showRaw && !poti) return null;
    return (
      <div className="propertyGrid">
        {entity.pointDeviation !== undefined && (
          <PropertyRow label="Corridor width" help="How far off this point a driver or item may stray.">
            <input
              aria-label="Corridor width"
              type="number"
              step="0.1"
              value={Number.isFinite(entity.pointDeviation) ? Number(entity.pointDeviation.toFixed(3)) : 0}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value)) onChangePointDeviation(value);
              }}
            />
          </PropertyRow>
        )}
        {showSpare && pointSettings && (
          <PropertyRow label="Spare byte" help="Unused by the game. Kept so an export matches the original file.">
            <input
              aria-label="Spare byte"
              type="number"
              min="0"
              max="255"
              value={pointSettings[2]}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value)) onChangePointSetting(2, Math.max(0, Math.min(0xff, Math.trunc(value))));
              }}
            />
          </PropertyRow>
        )}
        {showRaw && pointSettings && (
          <label>
            Raw point settings
            <div className="settingInputs">
              {pointSettings.map((setting, index) => (
                <input
                  key={index}
                  aria-label={`Point setting ${index + 1}`}
                  type="number"
                  min="0"
                  max="65535"
                  value={setting}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangePointSetting(index, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              ))}
            </div>
          </label>
        )}
        {poti && (
          <>
            <PropertyRow label="Node value 1" help="Usually the speed a follower moves at when it leaves this node.">
              <input
                aria-label="Node value 1"
                type="number"
                min="0"
                max="65535"
                value={poti.pointSetting1}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) onChangePotiPointSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                }}
              />
            </PropertyRow>
            <PropertyRow label="Node value 2" help="Usually how long a follower waits at this node.">
              <input
                aria-label="Node value 2"
                type="number"
                min="0"
                max="65535"
                value={poti.pointSetting2}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) onChangePotiPointSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                }}
              />
            </PropertyRow>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      {pointSettings && entity.section === 'ENPT' && (
        <div className="propertyGrid">
          <label>
            Mushroom / wheelie
            <select aria-label="Mushroom / wheelie" value={pointSettings[0]} onChange={(event) => onChangePointSetting(0, Number(event.currentTarget.value))}>
              {enemyRouteSetting1Options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Drifting
            <select aria-label="Drifting" value={pointSettings[1]} onChange={(event) => onChangePointSetting(1, Number(event.currentTarget.value))}>
              {enemyRouteSetting2Options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {pointSettings && entity.section === 'ITPT' && (
        <div className="propertyGrid">
          <label>
            Bullet Bill gravity
            <select aria-label="Bullet Bill gravity" value={pointSettings[0]} onChange={(event) => onChangePointSetting(0, Number(event.currentTarget.value))}>
              {itemRouteSetting1Options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Shell behaviour
            <select aria-label="Shell behaviour" value={pointSettings[1]} onChange={(event) => onChangePointSetting(1, Number(event.currentTarget.value))}>
              {itemRouteSetting2Options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {poti && (
        <div className="propertyGrid">
          <label>
            Path shape
            <select aria-label="Path shape" value={poti.routeSetting1} onChange={(event) => onChangePotiRouteSetting(0, Number(event.currentTarget.value))}>
              {potiRouteShapeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Movement
            <select aria-label="Movement" value={poti.routeSetting2} onChange={(event) => onChangePotiRouteSetting(1, Number(event.currentTarget.value))}>
              {potiRouteMotionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </>
  );
}
