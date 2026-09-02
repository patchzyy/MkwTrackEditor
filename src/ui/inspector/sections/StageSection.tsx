import type { KmpEntity, KmpStageField } from '../../../lib/kmp';

export function StageSection({
  entity,
  onChangeStageField,
  onChangeStageFlareColor,
}: {
  entity: KmpEntity;
  onChangeStageField: (field: KmpStageField, value: number) => void;
  onChangeStageFlareColor: (channelIndex: number, value: number) => void;
}) {
  return (
    <>
      {entity.stage && (
        <>
          <label>
            Track Settings
            <div className="settingInputs">
              {(Object.entries(entity.stage).filter(([field]) => field !== 'flareColor') as Array<[KmpStageField, number]>).map(([field, value]) => {
                const speedField = field === 'speedMod';
                return (
                  <input
                    key={field}
                    aria-label={field}
                    title={field}
                    type="number"
                    min={speedField ? 0 : 0}
                    max={speedField ? undefined : 255}
                    step={speedField ? 0.1 : 1}
                    value={Number.isFinite(value) ? Number(value.toFixed(speedField ? 3 : 0)) : 0}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      if (!Number.isFinite(next)) return;
                      if (speedField) onChangeStageField(field, next);
                      else onChangeStageField(field, Math.max(0, Math.min(0xff, Math.trunc(next))));
                    }}
                  />
                );
              })}
            </div>
          </label>
          <label>
            Lens Flare RGBA
            <div className="settingInputs">
              {entity.stage.flareColor.map((channel, index) => (
                <input
                  key={index}
                  aria-label={`Lens flare channel ${index + 1}`}
                  title={['red', 'green', 'blue', 'alpha'][index]}
                  type="number"
                  min="0"
                  max="255"
                  value={channel}
                  onChange={(event) => {
                    const next = Number(event.currentTarget.value);
                    if (Number.isFinite(next)) onChangeStageFlareColor(index, Math.max(0, Math.min(0xff, Math.trunc(next))));
                  }}
                />
              ))}
            </div>
          </label>
        </>
      )}
    </>
  );
}
