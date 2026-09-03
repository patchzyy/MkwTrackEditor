import type { AreaInspectorOption } from '../../areas/areaInspectorConfig';
import { Select } from '../../components/Select';

/** Dropdown over a fixed table of numeric values, with a fallback entry for unknown ones. */
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
    <Select label={label} value={value} onChange={(next) => onChange(Number(next))}>
      {!options.some((option) => option.value === value) && <option value={value}>Custom #{value}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}
