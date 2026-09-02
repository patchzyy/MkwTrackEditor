import { useState } from 'react';
import type { ObjectOption } from '../../objects/objectCatalog';

export function ObjectIdSelect({ value, options, onChange }: { value: number; options: ObjectOption[]; onChange: (value: number) => void }) {
  const [query, setQuery] = useState('');
  const trimmed = query.trim().toLowerCase();
  const selected = options.find((option) => option.id === value) ?? null;
  const filtered = trimmed
    ? options.filter((option) => `${option.label} ${option.detail} ${option.id.toString(16)} ${option.id}`.toLowerCase().includes(trimmed))
    : options;
  const visibleOptions = selected && !filtered.some((option) => option.id === selected.id) ? [selected, ...filtered] : filtered;
  return (
    <div className="objectPicker">
      <input
        className="objectPickerSearch"
        type="search"
        value={query}
        placeholder="Filter objects by name or ID"
        aria-label="Filter objects"
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <select className="referenceSelect" aria-label="Object" title="Object" value={String(value)} onChange={(event) => onChange(Number(event.currentTarget.value))}>
        {visibleOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
