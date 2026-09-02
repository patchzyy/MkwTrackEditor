export function ByteNumberInputs<T extends Record<string, number>>({ values, onChange }: { values: T; onChange: (field: keyof T, value: number) => void }) {
  return (
    <div className="settingInputs">
      {(Object.entries(values) as Array<[keyof T, number]>).map(([field, value]) => (
        <input
          key={String(field)}
          aria-label={String(field)}
          title={String(field)}
          type="number"
          min="0"
          max="255"
          value={value}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChange(field, Math.max(0, Math.min(0xff, Math.trunc(next))));
          }}
        />
      ))}
    </div>
  );
}
