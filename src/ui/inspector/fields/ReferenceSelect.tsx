import { Select } from '../../components/Select';

/**
 * Picks another record by index (a route, a camera, a checkpoint …). `noneValue` is the
 * sentinel the KMP format uses for "not linked"; an out-of-range index is surfaced as a
 * "Missing" option rather than silently snapping to something valid.
 *
 * The stored value is the raw 0-based KMP index, but the reader is shown the same 1-based
 * numbering the outliner uses, so "Respawn point 1" means the first one in the list.
 */
export function ReferenceSelect({
  label,
  value,
  noneValue,
  count,
  optionLabel,
  onChange,
}: {
  label: string;
  value: number;
  noneValue: number;
  count: number;
  optionLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <Select label={label} value={value} onChange={(next) => onChange(Number(next))}>
      <option value={noneValue}>None</option>
      {value !== noneValue && value >= count && (
        <option value={value}>
          {optionLabel} {value + 1} (missing)
        </option>
      )}
      {Array.from({ length: count }, (_, index) => (
        <option value={index} key={index}>
          {optionLabel} {index + 1}
        </option>
      ))}
    </Select>
  );
}
