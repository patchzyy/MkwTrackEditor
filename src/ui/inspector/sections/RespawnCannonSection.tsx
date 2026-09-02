import type { KmpBattleFinishField, KmpCannonField, KmpEntity, KmpRespawnField } from '../../../lib/kmp';
import { ShortNumberInputs } from '../fields/ShortNumberInputs';
import { cannonEffectOptions } from '../optionTables';

export function RespawnCannonSection({
  entity,
  onChangeRespawnField,
  onChangeCannonField,
  onChangeBattleFinishField,
}: {
  entity: KmpEntity;
  onChangeRespawnField: (field: KmpRespawnField, value: number) => void;
  onChangeCannonField: (field: KmpCannonField, value: number) => void;
  onChangeBattleFinishField: (field: KmpBattleFinishField, value: number) => void;
}) {
  return (
    <>
      {entity.respawn && (
        <label>
          Respawn Settings
          <ShortNumberInputs values={entity.respawn} onChange={onChangeRespawnField} />
        </label>
      )}
      {entity.cannon && (
        <>
          <label>
            Cannon Destination ID
            <input
              type="number"
              min="0"
              max="65535"
              value={entity.cannon.id}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (Number.isFinite(next)) onChangeCannonField('id', Math.max(0, Math.min(0xffff, Math.trunc(next))));
              }}
            />
          </label>
          <label>
            Launch Shape
            <select value={String(entity.cannon.effect)} onChange={(event) => onChangeCannonField('effect', Number(event.currentTarget.value))}>
              {entity.cannon.effect > 2 && (
                <option value={entity.cannon.effect}>
                  Custom #{entity.cannon.effect}
                </option>
              )}
              {cannonEffectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {entity.battleFinish && (
        <label>
          Battle Finish Settings
          <ShortNumberInputs values={entity.battleFinish} onChange={onChangeBattleFinishField} />
        </label>
      )}
    </>
  );
}
