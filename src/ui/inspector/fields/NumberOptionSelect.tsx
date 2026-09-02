import type { AreaInspectorOption } from '../../areas/areaInspectorConfig';

export function NumberOptionSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: AreaInspectorOption[];
  onChange: (value: number) => void;
}) {
  return (
    <select
      className="referenceSelect"
      aria-label={label}
      title={label}
      value={String(value)}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
    >
      {!options.some((option) => option.value === value) && <option value={value}>Custom #{value}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
