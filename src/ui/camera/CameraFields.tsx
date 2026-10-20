import type { ReactNode } from 'react';
import type { KmpEntity, Vec3 } from '../../lib/kmp';
import { framesToSeconds, getCameraTypeInfo, secondsToFrames } from '../../lib/cameraPreview';
import { NumberInput } from '../components/NumberInput';
import { VectorInput } from '../components/VectorInput';
import { DetailsCategory, PropertyRow } from '../inspector/PropertySheet';
import { NO_CAMERA_LINK, readCameraValues, type CameraValues } from './cameraDocument';
import {
  CAMERA_FIELD_HINTS,
  CAMERA_TYPE_OPTIONS,
  CAMERA_USAGE_GROUP_LABELS,
  getCameraFieldRelevance,
  getViewStartHint,
  getViewStartLabel,
} from './cameraFieldMeta';

/**
 * A label and a control in the Details panel's two-column row. `hint` is the plain-language
 * explanation and appears as a tooltip on the label, not as a paragraph. `wide` stacks the
 * control under the label, which the three-axis vector rows need.
 */
export function Field({ label, hint, wide, children }: { label: string; hint: string; wide?: boolean; children: ReactNode }) {
  return (
    <PropertyRow label={label} help={hint} wide={wide}>
      {children}
    </PropertyRow>
  );
}

/** Three scrubbable axis boxes. Track coordinates run to five digits, so two decimals is plenty. */
function CameraVectorInputs({ value, onChange, step = 1, label }: { value: Vec3; onChange: (value: Vec3) => void; step?: number; label: string }) {
  return <VectorInput value={value} onChange={onChange} step={step} precision={2} label={label} />;
}

function NumberField({
  label,
  hint,
  value,
  step = 1,
  min,
  max,
  suffix,
  precision,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  precision?: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <NumberInput label={label} value={Number.isFinite(value) ? value : 0} step={step} min={min} max={max} unit={suffix} precision={precision} onChange={onChange} />
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
      <DetailsCategory name="Behavior">
        <div className="propertyGrid">
          <Field label="Type" hint={`${CAMERA_FIELD_HINTS.type} ${typeInfo.description}`}>
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

          <Field label="Movement path" hint={relevance.route ? CAMERA_FIELD_HINTS.route : `${CAMERA_FIELD_HINTS.route} This camera type does not follow one.`}>
            <select
              aria-label="Movement path"
              value={String(values.routeIndex)}
              disabled={!relevance.route}
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
                value={Number(framesToSeconds(values.time).toFixed(2))}
                step={0.1}
                precision={2}
                min={0}
                suffix="s"
                onChange={(next) => onChange({ time: secondsToFrames(next) })}
              />
            </>
          )}
        </div>
      </DetailsCategory>

      {showPlacement && (
        <DetailsCategory name="Placement">
          <div className="propertyGrid">
            {relevance.position && (
              <Field label="Position" hint={CAMERA_FIELD_HINTS.position} wide>
                <CameraVectorInputs label="Position" value={values.position} onChange={setVec('position')} />
              </Field>
            )}
            <Field label="Rotation" hint={CAMERA_FIELD_HINTS.rotation} wide>
              <CameraVectorInputs label="Rotation" value={values.rotation} onChange={setVec('rotation')} />
            </Field>
          </div>
        </DetailsCategory>
      )}

      <DetailsCategory name="Framing">
        <div className="propertyGrid">
          <Field label={getViewStartLabel(values.type)} hint={getViewStartHint(values.type)} wide>
            <CameraVectorInputs label={getViewStartLabel(values.type)} value={values.viewStart} onChange={setVec('viewStart')} />
          </Field>
          {relevance.viewEnd && (
            <>
              <Field label="Looks at (end)" hint={CAMERA_FIELD_HINTS.viewEnd} wide>
                <CameraVectorInputs label="Looks at (end)" value={values.viewEnd} onChange={setVec('viewEnd')} />
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
        </div>
      </DetailsCategory>

      <DetailsCategory name="Rarely used" defaultOpen={false}>
        <div className="propertyGrid">
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
      </DetailsCategory>
    </div>
  );
}
