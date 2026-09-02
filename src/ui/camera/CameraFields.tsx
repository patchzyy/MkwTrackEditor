import type { ReactNode } from 'react';
import type { KmpEntity, Vec3 } from '../../lib/kmp';
import { formatFrames, framesToSeconds, getCameraTypeInfo, secondsToFrames } from '../../lib/cameraPreview';
import { VectorInputs } from '../inspector/fields/VectorInputs';
import { NO_CAMERA_LINK, readCameraValues, type CameraValues } from './cameraDocument';
import {
  CAMERA_FIELD_HINTS,
  CAMERA_TYPE_OPTIONS,
  CAMERA_USAGE_GROUP_LABELS,
  getCameraFieldRelevance,
  getViewStartHint,
  getViewStartLabel,
} from './cameraFieldMeta';

/** A label + control + one-line plain-language hint, in the inspector's property grid. */
export function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <label className="cameraField">
      <span className="cameraFieldLabel">
        {label}
        <span className="cameraFieldHint">{hint}</span>
      </span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  hint,
  value,
  step = 1,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className={suffix ? 'cameraNumberWithSuffix' : undefined}>
        <input
          type="number"
          aria-label={label}
          step={step}
          min={min}
          max={max}
          value={Number.isFinite(value) ? Number(value.toFixed(4)) : 0}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (!Number.isFinite(next)) return;
            const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, next));
            onChange(clamped);
          }}
        />
        {suffix && <span className="cameraFieldSuffix">{suffix}</span>}
      </div>
    </Field>
  );
}

function CameraSelect({
  label,
  hint,
  value,
  count,
  currentIndex,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  count: number;
  currentIndex?: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <select aria-label={label} value={String(value)} onChange={(event) => onChange(Number(event.currentTarget.value))}>
        <option value={NO_CAMERA_LINK}>None (ends here)</option>
        {value !== NO_CAMERA_LINK && value >= count && <option value={value}>Missing camera {value}</option>}
        {Array.from({ length: count }, (_, index) => (
          <option key={index} value={index} disabled={index === currentIndex}>
            Camera {index}
            {index === currentIndex ? ' (this one)' : ''}
          </option>
        ))}
      </select>
    </Field>
  );
}

export interface CameraFieldsProps {
  entity: KmpEntity;
  /** How many cameras the track has, for the hand-over dropdown. */
  cameraCount: number;
  /** How many movement paths the track has, for the route dropdown. */
  routeCount: number;
  /** Number of points in each route, so the picker can flag unusable ones. */
  routePointCounts?: number[];
  /**
   * Show the position/rotation block. The KMP-mode inspector already has its own transform
   * section for the selected record, so it turns this off.
   */
  showPlacement?: boolean;
  onChange: (values: Partial<CameraValues>, statusMessage?: string) => void;
}

/**
 * The friendly CAME property editor. Shared by the Camera-mode inspector and by the KMP-mode
 * inspector's camera section, so a camera reads the same everywhere in the editor.
 */
export function CameraFields({ entity, cameraCount, routeCount, routePointCounts = [], showPlacement = true, onChange }: CameraFieldsProps) {
  const values = readCameraValues(entity);
  const typeInfo = getCameraTypeInfo(values.type);
  const relevance = getCameraFieldRelevance(values.type);

  const groups: Array<[string, typeof CAMERA_TYPE_OPTIONS]> = (['opening', 'replay', 'goal', 'unused'] as const)
    .map((usage) => [CAMERA_USAGE_GROUP_LABELS[usage], CAMERA_TYPE_OPTIONS.filter((option) => option.usage === usage)] as [string, typeof CAMERA_TYPE_OPTIONS])
    .filter(([, options]) => options.length > 0);

  const setVec = (key: 'position' | 'rotation' | 'viewStart' | 'viewEnd') => (next: Vec3) => onChange({ [key]: next } as Partial<CameraValues>);

  return (
    <div className="cameraFields">
      <div className="detailsSectionHeader">Behavior</div>
      <Field label="Type" hint={CAMERA_FIELD_HINTS.type}>
        <select aria-label="Type" value={String(values.type)} onChange={(event) => onChange({ type: Number(event.currentTarget.value) })}>
          {!CAMERA_TYPE_OPTIONS.some((option) => option.value === values.type) && <option value={values.type}>Unknown type {values.type}</option>}
          {groups.map(([groupLabel, options]) => (
            <optgroup key={groupLabel} label={groupLabel}>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <p className="cameraTypeDescription">{typeInfo.description}</p>

      {relevance.nextCamera && (
        <CameraSelect
          label="Hands over to"
          hint={CAMERA_FIELD_HINTS.nextCamera}
          value={values.nextCam}
          count={cameraCount}
          currentIndex={entity.index}
          onChange={(next) => onChange({ nextCam: next })}
        />
      )}

      <Field label="Movement path" hint={CAMERA_FIELD_HINTS.route}>
        <select
          aria-label="Movement path"
          value={String(values.routeIndex)}
          disabled={!relevance.route}
          title={relevance.route ? undefined : 'Only route cameras follow a movement path.'}
          onChange={(event) => onChange({ routeIndex: Number(event.currentTarget.value) })}
        >
          <option value={NO_CAMERA_LINK}>None</option>
          {values.routeIndex !== NO_CAMERA_LINK && values.routeIndex >= routeCount && <option value={values.routeIndex}>Missing path {values.routeIndex}</option>}
          {Array.from({ length: routeCount }, (_, index) => (
            <option key={index} value={index}>
              Path {index}
              {routePointCounts[index] !== undefined ? ` (${routePointCounts[index]} points)` : ''}
            </option>
          ))}
        </select>
      </Field>

      {relevance.duration && (
        <>
          <NumberField
            label="Duration"
            hint={CAMERA_FIELD_HINTS.duration}
            value={values.time}
            step={1}
            min={0}
            suffix="frames"
            onChange={(next) => onChange({ time: next })}
          />
          <NumberField
            label="Duration (seconds)"
            hint="The same length in seconds, if that is easier to think in."
            value={Number(framesToSeconds(values.time).toFixed(3))}
            step={0.1}
            min={0}
            suffix="s"
            onChange={(next) => onChange({ time: secondsToFrames(next) })}
          />
        </>
      )}

      {showPlacement && (
        <>
          <div className="detailsSectionHeader">Placement</div>
          {relevance.position && (
            <Field label="Position" hint={CAMERA_FIELD_HINTS.position}>
              <VectorInputs value={values.position} onChange={setVec('position')} />
            </Field>
          )}
          <Field label="Rotation" hint={CAMERA_FIELD_HINTS.rotation}>
            <VectorInputs value={values.rotation} onChange={setVec('rotation')} />
          </Field>
        </>
      )}

      <div className="detailsSectionHeader">Framing</div>
      <Field label={getViewStartLabel(values.type)} hint={getViewStartHint(values.type)}>
        <VectorInputs value={values.viewStart} onChange={setVec('viewStart')} />
      </Field>
      {relevance.viewEnd && (
        <>
          <Field label="Looks at (end)" hint={CAMERA_FIELD_HINTS.viewEnd}>
            <VectorInputs value={values.viewEnd} onChange={setVec('viewEnd')} />
          </Field>
          <NumberField
            label="Pan speed"
            hint={CAMERA_FIELD_HINTS.viewSpeed}
            value={values.vView}
            step={10}
            min={0}
            max={0xffff}
            suffix="units / 100 f"
            onChange={(next) => onChange({ vView: Math.round(next) })}
          />
        </>
      )}
      {relevance.zoom && (
        <>
          <NumberField
            label="Zoom start"
            hint={CAMERA_FIELD_HINTS.zoomStart}
            value={values.zoomStart}
            step={1}
            min={1}
            max={179}
            suffix="degrees"
            onChange={(next) => onChange({ zoomStart: next })}
          />
          <NumberField
            label="Zoom end"
            hint={CAMERA_FIELD_HINTS.zoomEnd}
            value={values.zoomEnd}
            step={1}
            min={1}
            max={179}
            suffix="degrees"
            onChange={(next) => onChange({ zoomEnd: next })}
          />
          <NumberField
            label="Zoom speed"
            hint={CAMERA_FIELD_HINTS.zoomSpeed}
            value={values.vZoom}
            step={10}
            min={0}
            max={0xffff}
            suffix="deg / 100 f"
            onChange={(next) => onChange({ vZoom: Math.round(next) })}
          />
        </>
      )}
      {relevance.moveSpeed && (
        <NumberField
          label="Travel speed"
          hint={CAMERA_FIELD_HINTS.moveSpeed}
          value={values.vCam}
          step={10}
          min={0}
          max={0xffff}
          suffix="units / 100 f"
          onChange={(next) => onChange({ vCam: Math.round(next) })}
        />
      )}

      <details className="advancedDetails cameraAdvanced">
        <summary>Rarely used</summary>
        <div className="advancedDetailsBody">
          <NumberField label="Shake" hint={CAMERA_FIELD_HINTS.shake} value={values.shake} min={0} max={255} onChange={(next) => onChange({ shake: Math.round(next) })} />
          <NumberField label="Start flag" hint={CAMERA_FIELD_HINTS.startFlag} value={values.start} min={0} max={255} onChange={(next) => onChange({ start: Math.round(next) })} />
          <NumberField label="Movie flag" hint={CAMERA_FIELD_HINTS.movieFlag} value={values.movie} min={0} max={255} onChange={(next) => onChange({ movie: Math.round(next) })} />
          {!relevance.duration && (
            <NumberField label="Duration" hint={`${CAMERA_FIELD_HINTS.duration} This type ignores it.`} value={values.time} min={0} suffix="frames" onChange={(next) => onChange({ time: next })} />
          )}
          {!relevance.nextCamera && (
            <CameraSelect
              label="Hands over to"
              hint={`${CAMERA_FIELD_HINTS.nextCamera} This type ignores it.`}
              value={values.nextCam}
              count={cameraCount}
              currentIndex={entity.index}
              onChange={(next) => onChange({ nextCam: next })}
            />
          )}
        </div>
      </details>

      <p className="cameraFieldsFooter">Shot length: {formatFrames(values.time)}</p>
    </div>
  );
}
