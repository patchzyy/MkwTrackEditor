import { useState } from 'react';
import { Field } from '../../components/Field';
import { NumberInput } from '../../components/NumberInput';
import { SegmentedControl, type SegmentedOption } from '../../components/SegmentedControl';
import type { Mutate } from '../tools/types';
import { HelpLabel } from './parts';
import { matchPreset, type Preset } from './presets';
import type { Editing } from './useEditing';

const CUSTOM = 'custom';

/**
 * A number the user should not have to understand: a few named choices ("Normal / Fast / Faster"),
 * with the exact value one click away under "Exact value". A value that is none of the presets
 * (an old design, a hand-typed number) shows as an extra highlighted choice and opens the exact
 * box by itself, so nothing is ever hidden.
 */
export function PresetField({
  label,
  help,
  presets,
  value,
  editing,
  undoLabel,
  mutate,
  exact,
}: {
  label: string;
  help: string;
  presets: readonly Preset[];
  value: number;
  editing: Editing;
  undoLabel: string;
  mutate: (value: number) => Mutate;
  exact: { min: number; max: number; step: number; precision?: number; integer?: boolean; unit?: string };
}) {
  const [exactOpen, setExactOpen] = useState(false);
  const matched = matchPreset(presets, value);
  const showExact = exactOpen || !matched;
  const options: Array<SegmentedOption<string>> = presets.map((p) => ({ value: String(p.value), label: p.label, tooltip: p.tooltip }));
  if (!matched) options.push({ value: CUSTOM, label: `${Number(value.toFixed(exact.precision ?? 2))}${exact.unit ?? ''}`, tooltip: 'Your own value' });
  return (
    <Field label={<HelpLabel help={help}>{label}</HelpLabel>} asGroup className="crPresetField">
      <div className="crPresetControl">
        <SegmentedControl
          label={label}
          value={matched ? String(matched.value) : CUSTOM}
          options={options}
          onChange={(v) => {
            if (v !== CUSTOM) editing.set(undoLabel, mutate(Number(v)));
          }}
          size="sm"
        />
        {showExact && (
          <NumberInput
            label={`${label}, exact value`}
            value={value}
            min={exact.min}
            max={exact.max}
            step={exact.step}
            precision={exact.precision}
            integer={exact.integer}
            unit={exact.unit}
            {...editing.num(undoLabel, mutate)}
          />
        )}
        {matched && (
          <button type="button" className="crLink crPresetExact" onClick={() => setExactOpen((open) => !open)} aria-expanded={exactOpen}>
            {exactOpen ? 'Hide exact value' : 'Exact value'}
          </button>
        )}
      </div>
    </Field>
  );
}
