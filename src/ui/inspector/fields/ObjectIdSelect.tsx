import { Search, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Select } from '../../components/Select';
import type { ObjectOption } from '../../objects/objectCatalog';

/**
 * Object picker: a filter box over the several-hundred-entry object list plus a native
 * select. The currently selected object is always kept in the list, even when it does not
 * match the filter, so the field never appears to change value on its own.
 */
export function ObjectIdSelect({ value, options, onChange }: { value: number; options: ObjectOption[]; onChange: (value: number) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const trimmed = query.trim().toLowerCase();
  const selected = options.find((option) => option.id === value) ?? null;
  const filtered = trimmed
    ? options.filter((option) => `${option.label} ${option.detail} ${option.id.toString(16)} ${option.id}`.toLowerCase().includes(trimmed))
    : options;
  const visibleOptions = selected && !filtered.some((option) => option.id === selected.id) ? [selected, ...filtered] : filtered;
  return (
    <div className="objectPicker">
      <div className="objectPickerFilter">
        <Search size={13} aria-hidden="true" />
        <input
          ref={inputRef}
          className="objectPickerSearch"
          type="search"
          value={query}
          placeholder="Filter by name or ID"
          aria-label="Filter objects"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {query && (
          <button
            type="button"
            className="browserSearchClear"
            aria-label="Clear object filter"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <Select label="Object" value={value} onChange={(next) => onChange(Number(next))}>
        {visibleOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
      {trimmed && (
        <span className="objectPickerCount">
          {visibleOptions.length} of {options.length} objects
        </span>
      )}
    </div>
  );
}
