import { Play } from 'lucide-react';
import { useState } from 'react';
import type { PlaytestCourseOptions } from '../../lib/playtest/types';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Popover } from '../components/Popover';
import { SegmentedControl } from '../components/SegmentedControl';
import { Select } from '../components/Select';
import { PLAYTEST_CONTROL_HINTS } from './playtestInput';
import { PLAYTEST_BIKE_CHOICES, PLAYTEST_CHARACTER_CHOICES, PLAYTEST_KART_CHOICES } from './playtestOptions';

/**
 * The top-bar "Playtest" control: a button that opens a small popover with the driver, the
 * vehicle, the drift mode, a controls reminder and Start.
 *
 * Everything here is one of the shared components, so it matches the rest of the header.
 */
export function PlaytestMenu({
  options,
  onChangeOptions,
  disabledReason,
  loading,
  onStart,
}: {
  options: PlaytestCourseOptions;
  onChangeOptions: (options: PlaytestCourseOptions) => void;
  /** Non-null when the loaded track cannot be driven. Disables the button and explains why. */
  disabledReason: string | null;
  loading: boolean;
  onStart: () => void;
}) {
  const [open, setOpen] = useState(false);
  const disabled = disabledReason !== null || loading;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      label="Playtest settings"
      className="playtestMenu"
      trigger={({ toggle, open: isOpen }) => (
        <Button
          icon={<Play size={15} />}
          active={isOpen}
          tooltip="Playtest the track in the browser (experimental)"
          disabledReason={disabledReason ?? undefined}
          disabled={disabled}
          onClick={toggle}
        >
          Playtest
        </Button>
      )}
    >
      <div className="playtestMenuBody">
        <div className="playtestMenuHeader">
          <strong>Playtest</strong>
          <span className="playtestMenuBadge">Experimental</span>
        </div>

        <Field label="Driver">
          <Select
            label="Driver"
            value={options.character}
            options={PLAYTEST_CHARACTER_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))}
            onChange={(value) => onChangeOptions({ ...options, character: Number(value) as PlaytestCourseOptions['character'] })}
            size="sm"
          />
        </Field>

        <Field label="Vehicle">
          <Select
            label="Vehicle"
            value={options.vehicle}
            onChange={(value) => onChangeOptions({ ...options, vehicle: Number(value) as PlaytestCourseOptions['vehicle'] })}
            size="sm"
          >
            <optgroup label="Karts">
              {PLAYTEST_KART_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Bikes">
              {PLAYTEST_BIKE_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>

        <Field label="Drift" asGroup>
          <SegmentedControl
            label="Drift mode"
            size="sm"
            value={options.driftIsAuto ? 'auto' : 'manual'}
            options={[
              { value: 'manual', label: 'Manual', tooltip: 'Hop and drift by hand (Shift)' },
              { value: 'auto', label: 'Auto', tooltip: 'The kart drifts for you when you steer' },
            ]}
            onChange={(value) => onChangeOptions({ ...options, driftIsAuto: value === 'auto' })}
          />
        </Field>

        <dl className="playtestControls">
          {PLAYTEST_CONTROL_HINTS.map((hint) => (
            <div key={hint.action} className="playtestControlsRow">
              <dt>{hint.action}</dt>
              <dd>{hint.keys}</dd>
            </div>
          ))}
        </dl>
        <p className="playtestMenuHint">A gamepad works too: left stick steers, A accelerates, B brakes, RB hops and drifts (and brakes).</p>

        <Button
          variant="primary"
          icon={<Play size={15} />}
          onClick={() => {
            setOpen(false);
            onStart();
          }}
          disabled={disabled}
          className="playtestStartButton"
        >
          Start
        </Button>
      </div>
    </Popover>
  );
}
