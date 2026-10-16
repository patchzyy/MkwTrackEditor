// Inspector for gravity field AREAs (type 11). The raw AREA bytes double as gravity settings
// (mode in routeIndex, volume / next gate in enemyIndex, flags at 0x2E), so this replaces the
// generic AREA rows with purpose-built controls. Edits that span a whole path chain are applied
// as one undo step.
import { ArrowLeft, ArrowRight, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  GravityFlag,
  GravityMode,
  GRAVITY_NORMAL_STRENGTH,
  GRAVITY_PATH_END,
  findGravityIssues,
  getGravityChainOf,
  getGravityEffectiveFlag,
  getGravityMode,
  getGravityNextGate,
  getGravityTransitionFrames,
  getGravityVolume,
  gravityCameraOptions,
  gravityModeColors,
  gravityModeOptions,
  gravityResetOptions,
  gravityVolumeOptions,
  isGravityPathGate,
  planGravityFlagChange,
  planGravityModeChange,
  planGravityNextGate,
  planGravityVolumeChange,
  type GravityAreaPatch,
  type GravityAreaRecord,
} from '../../lib/gravityField';
import { Button, NumberInput, SegmentedControl, Select } from '../components';
import './gravity.css';

const STRENGTH_SLIDER_MAX = 300;

function rgb(mode: number, alpha = 1): string {
  const [r, g, b] = gravityModeColors[mode] ?? gravityModeColors[GravityMode.Parallel];
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${alpha})`;
}

/** Small line drawings of what each mode does (arrows = the direction gravity pulls). */
function ModeGlyph({ mode }: { mode: number }) {
  const arrow = (x1: number, y1: number, x2: number, y2: number, key: string) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const s = 2.6;
    return (
      <g key={key}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} />
        <polyline points={`${x2 - ux * s - uy * s},${y2 - uy * s + ux * s} ${x2},${y2} ${x2 - ux * s + uy * s},${y2 - uy * s - ux * s}`} />
      </g>
    );
  };
  let body: ReactNode;
  switch (mode) {
    case GravityMode.PointAttract:
      body = (
        <>
          <circle cx="12" cy="12" r="3.2" />
          {[0, 90, 180, 270].map((deg) => {
            const t = (deg * Math.PI) / 180;
            return arrow(12 + Math.cos(t) * 10.5, 12 + Math.sin(t) * 10.5, 12 + Math.cos(t) * 5.6, 12 + Math.sin(t) * 5.6, `a${deg}`);
          })}
        </>
      );
      break;
    case GravityMode.PointRepel:
      body = (
        <>
          <circle cx="12" cy="12" r="10" strokeDasharray="2 2" />
          {[45, 135, 225, 315].map((deg) => {
            const t = (deg * Math.PI) / 180;
            return arrow(12 + Math.cos(t) * 2.5, 12 + Math.sin(t) * 2.5, 12 + Math.cos(t) * 8, 12 + Math.sin(t) * 8, `a${deg}`);
          })}
        </>
      );
      break;
    case GravityMode.AxisAttract:
      body = (
        <>
          <rect x="10" y="3" width="4" height="18" rx="2" />
          {arrow(2, 8, 8, 8, 'l1')}
          {arrow(2, 16, 8, 16, 'l2')}
          {arrow(22, 8, 16, 8, 'r1')}
          {arrow(22, 16, 16, 16, 'r2')}
        </>
      );
      break;
    case GravityMode.AxisRepel:
      body = (
        <>
          <ellipse cx="12" cy="12" rx="10" ry="10" />
          {[0, 120, 240].map((deg) => {
            const t = ((deg + 90) * Math.PI) / 180;
            return arrow(12 + Math.cos(t) * 2, 12 + Math.sin(t) * 2, 12 + Math.cos(t) * 7.6, 12 + Math.sin(t) * 7.6, `a${deg}`);
          })}
        </>
      );
      break;
    case GravityMode.Path:
      body = (
        <>
          <path d="M3 18 C 8 18, 9 6, 14 6 S 19 12, 21 12" />
          <path d="M3 21 C 8 21, 9 9, 14 9 S 19 15, 21 15" strokeOpacity="0.45" />
          {arrow(6, 11, 6, 16, 'g1')}
          {arrow(15, 1.5, 15, 5, 'g2')}
        </>
      );
      break;
    default:
      body = (
        <>
          <line x1="3" y1="21" x2="21" y2="21" />
          {arrow(6, 3, 6, 17, 'p1')}
          {arrow(12, 3, 12, 17, 'p2')}
          {arrow(18, 3, 18, 17, 'p3')}
        </>
      );
  }
  return (
    <svg className="gravityModeGlyph" viewBox="0 0 24 24" aria-hidden="true">
      {body}
    </svg>
  );
}

export function GravityFieldSection({
  record,
  records,
  onApplyPatches,
  onExtendChain,
  onSelectArea,
}: {
  record: GravityAreaRecord;
  records: readonly (GravityAreaRecord | undefined)[];
  onApplyPatches: (patches: GravityAreaPatch[]) => void;
  onExtendChain?: () => void;
  onSelectArea?: (index: number) => void;
}) {
  const mode = getGravityMode(record);
  const isGate = isGravityPathGate(record);
  const color = rgb(mode);
  const modeOption = gravityModeOptions.find((option) => option.value === mode) ?? gravityModeOptions[0];
  const percent = record.setting1 === 0 ? 100 : (record.setting1 / GRAVITY_NORMAL_STRENGTH) * 100;
  const resetOn = getGravityEffectiveFlag(records, record, GravityFlag.ResetOnExit);
  const cameraUpright = getGravityEffectiveFlag(records, record, GravityFlag.CameraWorldUp);
  const chain = isGate ? getGravityChainOf(records, record.index) : [record.index];
  const ordered = isGate ? orderChain(records, chain) : chain;
  const position = ordered.indexOf(record.index);
  const next = isGate ? getGravityNextGate(records, record.index) : -1;
  const previous = isGate ? records.findIndex((candidate, index) => !!candidate && getGravityNextGate(records, index) === record.index) : -1;
  const gateOptions = records
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate, index }) => !!candidate && isGravityPathGate(candidate) && index !== record.index);
  const issues = findGravityIssues(records).filter((issue) => chain.includes(issue.index));
  const chainNote = isGate && chain.length > 1 ? ' Applies to the whole chain.' : '';

  const setStrength = (pct: number) => {
    const value = Math.round((Math.max(0, Math.min(1000, pct)) / 100) * GRAVITY_NORMAL_STRENGTH);
    onApplyPatches([{ index: record.index, field: 'setting1', value: Math.min(0xffff, value) }]);
  };

  return (
    <div className="gravityField" style={{ ['--gravity-color' as string]: color, ['--gravity-soft' as string]: rgb(mode, 0.14) }}>
      <div className="gravityField__group">
        <span className="gravityField__title">Field mode</span>
        <div className="gravityField__modes" role="radiogroup" aria-label="Field mode">
          {gravityModeOptions.map((option) => {
            const active = option.value === mode;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                className={`gravityModeCard${active ? ' is-active' : ''}`}
                style={{ ['--gravity-card' as string]: rgb(option.value) }}
                title={option.description}
                onClick={() => !active && onApplyPatches(planGravityModeChange(record, option.value))}
              >
                <ModeGlyph mode={option.value} />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
        <p className="inspectorNote">{modeOption.description}</p>
      </div>

      {!isGate && (
        <div className="gravityField__group">
          <span className="gravityField__title">Volume</span>
          <SegmentedControl
            label="Volume"
            size="sm"
            value={String(getGravityVolume(record))}
            options={gravityVolumeOptions.map((option) => ({ value: String(option.value), label: option.label, tooltip: option.description }))}
            onChange={(value) => onApplyPatches(planGravityVolumeChange(record, Number(value)))}
          />
        </div>
      )}

      {isGate && (
        <div className="gravityField__group">
          <span className="gravityField__title">
            Gate chain
            <span className="gravityField__badge">{chain.length === 1 ? 'unlinked' : `gate ${position + 1} of ${ordered.length}`}</span>
          </span>
          {ordered.length > 1 && (
            <div className="gravityChain" aria-label="Gates in this chain">
              {ordered.map((index, i) => (
                <button
                  key={index}
                  type="button"
                  className={`gravityChain__gate${index === record.index ? ' is-current' : ''}`}
                  title={`Gravity field ${index + 1}`}
                  onClick={() => index !== record.index && onSelectArea?.(index)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
          <label className="gravityField__row">
            <span>Next gate</span>
            <Select
              label="Next gate"
              size="sm"
              value={next >= 0 ? next : GRAVITY_PATH_END}
              onChange={(value) => onApplyPatches(planGravityNextGate(records, record, Number(value)))}
            >
              <option value={GRAVITY_PATH_END}>End of chain</option>
              {record.enemyIndex !== GRAVITY_PATH_END && next < 0 && <option value={record.enemyIndex}>Area {record.enemyIndex + 1} (not a gate)</option>}
              {gateOptions.map(({ index }) => (
                <option key={index} value={index}>
                  Gravity field {index + 1}
                </option>
              ))}
            </Select>
          </label>
          <div className="gravityField__actions">
            <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} />} disabled={previous < 0} disabledReason="This is the first gate" onClick={() => previous >= 0 && onSelectArea?.(previous)}>
              Previous
            </Button>
            <Button size="sm" variant="ghost" icon={<ArrowRight size={14} />} disabled={next < 0} disabledReason="This is the last gate" onClick={() => next >= 0 && onSelectArea?.(next)}>
              Next
            </Button>
            <Button size="sm" icon={<Plus size={14} />} disabled={!onExtendChain} tooltip="Add a gate after this one, further along the chain" onClick={onExtendChain}>
              Add gate
            </Button>
          </div>
        </div>
      )}

      <div className="gravityField__group">
        <span className="gravityField__title">
          Strength
          <span className="gravityField__badge">{record.setting1 === 0 ? 'normal' : `${record.setting1} / 1300`}</span>
        </span>
        <div className="gravityStrength">
          <input
            type="range"
            aria-label="Gravity strength"
            min={0}
            max={STRENGTH_SLIDER_MAX}
            step={5}
            value={Math.min(STRENGTH_SLIDER_MAX, percent)}
            onChange={(event) => setStrength(Number(event.currentTarget.value))}
          />
          <NumberInput label="Gravity strength percent" value={Math.round(percent * 10) / 10} min={0} max={1000} step={5} unit="%" onChange={setStrength} />
        </div>
      </div>

      <label className="gravityField__row">
        <span>Transition</span>
        <NumberInput
          label="Transition frames"
          value={record.setting2}
          min={0}
          max={600}
          step={1}
          unit="f"
          onChange={(value) => onApplyPatches([{ index: record.index, field: 'setting2', value: Math.max(0, Math.min(600, Math.round(value))) }])}
        />
        <span className="gravityField__hint">
          {record.setting2 === 0 ? 'default, ' : ''}
          {(getGravityTransitionFrames(record.setting2) / 60).toFixed(2)} s blend on entering
        </span>
      </label>

      <div className="gravityField__group">
        <span className="gravityField__title">Gravity resets</span>
        <SegmentedControl
          label="Gravity resets"
          size="sm"
          value={resetOn ? 'exit' : 'land'}
          options={gravityResetOptions.map((option) => ({ value: option.value ? 'exit' : 'land', label: option.label, tooltip: option.description }))}
          onChange={(value) => onApplyPatches(planGravityFlagChange(records, record, GravityFlag.ResetOnExit, value === 'exit'))}
        />
        <p className="inspectorNote">{(gravityResetOptions[resetOn ? 1 : 0]).description + chainNote}</p>
      </div>

      <div className="gravityField__group">
        <span className="gravityField__title">Camera</span>
        <SegmentedControl
          label="Camera"
          size="sm"
          value={cameraUpright ? 'upright' : 'follow'}
          options={gravityCameraOptions.map((option) => ({ value: option.value ? 'upright' : 'follow', label: option.label, tooltip: option.description }))}
          onChange={(value) => onApplyPatches(planGravityFlagChange(records, record, GravityFlag.CameraWorldUp, value === 'upright'))}
        />
        <p className="inspectorNote">{(gravityCameraOptions[cameraUpright ? 1 : 0]).description + chainNote}</p>
      </div>

      {issues.map((issue, i) => (
        <p className="inspectorNote is-warning" key={`gravity-issue-${i}`}>
          {issue.index === record.index ? '' : `Gravity field ${issue.index + 1}: `}
          {issue.message}
        </p>
      ))}
      <p className="inspectorNote">Higher overlap priority (Advanced) wins where gravity fields overlap.</p>
    </div>
  );
}

/** Gates of a chain in link order (starting from a gate nothing links to; loops start anywhere). */
function orderChain(records: readonly (GravityAreaRecord | undefined)[], chain: number[]): number[] {
  const inChain = new Set(chain);
  const hasPrevious = new Set(chain.map((index) => getGravityNextGate(records, index)).filter((index) => inChain.has(index)));
  const start = chain.find((index) => !hasPrevious.has(index)) ?? chain[0];
  const ordered: number[] = [];
  const seen = new Set<number>();
  for (let index = start; index >= 0 && inChain.has(index) && !seen.has(index); index = getGravityNextGate(records, index)) {
    ordered.push(index);
    seen.add(index);
  }
  // Branches (several gates linking into one) are listed after the main line.
  for (const index of chain) if (!seen.has(index)) ordered.push(index);
  return ordered;
}
