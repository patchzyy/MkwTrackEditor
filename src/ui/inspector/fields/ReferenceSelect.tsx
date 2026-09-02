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
  const normalized = value === noneValue || value >= count ? String(value) : String(value);
  return (
    <select
      className="referenceSelect"
      aria-label={label}
      title={label}
      value={normalized}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
    >
      <option value={noneValue}>None</option>
      {value !== noneValue && value >= count && <option value={value}>Missing #{value}</option>}
      {Array.from({ length: count }, (_, index) => (
        <option value={index} key={index}>
          {optionLabel} #{index}
        </option>
      ))}
    </select>
  );
}
