import type { KmpBattleFinishField, KmpCannonField, KmpEntity, KmpRespawnField } from '../../../lib/kmp';
import { ShortNumberInputs } from '../fields/ShortNumberInputs';
import { cannonEffectOptions } from '../optionTables';
import type { InspectorScope } from './scope';

/**
 * Respawn points, cannon points and battle finish points.
 *
 * A respawn point is entirely defined by where it is and which way it faces, so its two raw
 * words are Advanced. A cannon point's destination id and flight shape are the whole point of
 * the record, so they stay up front.
 */
export function RespawnCannonSection({
  entity,
  scope,
  onChangeRespawnField,
  onChangeCannonField,
  onChangeBattleFinishField,
}: {
  entity: KmpEntity;
  scope: InspectorScope;
  onChangeRespawnField: (field: KmpRespawnField, value: number) => void;
  onChangeCannonField: (field: KmpCannonField, value: number) => void;
  onChangeBattleFinishField: (field: KmpBattleFinishField, value: number) => void;
}) {
  if (scope === 'advanced') {
    if (!entity.respawn && !entity.battleFinish) return null;
    return (
      <div className="propertyGrid">
        {entity.respawn && (
          <label>
            Respawn id and sound
            <ShortNumberInputs values={entity.respawn} onChange={onChangeRespawnField} />
          </label>
        )}
        {entity.battleFinish && (
          <label>
            Battle finish id
            <ShortNumberInputs values={entity.battleFinish} onChange={onChangeBattleFinishField} />
          </label>
        )}
      </div>
    );
  }

  if (!entity.cannon) return null;
  return (
    <div className="propertyGrid">
      <label>
        Cannon number
        <input
          aria-label="Cannon number"
          type="number"
          min="0"
          max="65535"
          value={entity.cannon.id}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChangeCannonField('id', Math.max(0, Math.min(0xffff, Math.trunc(next))));
          }}
        />
        <span>The cannon object with this number fires drivers to this point.</span>
      </label>
      <label>
        Flight shape
        <select aria-label="Flight shape" value={String(entity.cannon.effect)} onChange={(event) => onChangeCannonField('effect', Number(event.currentTarget.value))}>
          {entity.cannon.effect > 2 && <option value={entity.cannon.effect}>Custom #{entity.cannon.effect}</option>}
          {cannonEffectOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
