import { NumberInput } from '../../components/NumberInput';

/** Row of 16-bit (0-65535) settings, one scrubbable field per key of `values`. */
export function ShortNumberInputs<T extends Record<string, number>>({ values, onChange }: { values: T; onChange: (field: keyof T, value: number) => void }) {
  return (
    <div className="settingInputs">
      {(Object.entries(values) as Array<[keyof T, number]>).map(([field, value]) => (
        <NumberInput
          key={String(field)}
          label={String(field)}
          value={value}
          min={0}
          max={0xffff}
          integer
          step={1}
          onChange={(next) => onChange(field, next)}
        />
      ))}
    </div>
  );
}
