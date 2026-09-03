import type { getKmpCameraHeader, KmpCameraField, KmpCameraHeaderField, KmpEntity, Vec3 } from '../../../lib/kmp';
import type { ReferenceCounts } from '../../../lib/kmpEdit';
import { CameraFields, Field } from '../../camera/CameraFields';
import { NO_CAMERA_LINK, type CameraValues } from '../../camera/cameraDocument';
import type { InspectorScope } from './scope';

function ChainStartSelect({
  label,
  hint,
  value,
  count,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  count: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <select aria-label={label} value={String(value)} onChange={(event) => onChange(Number(event.currentTarget.value))}>
        <option value={NO_CAMERA_LINK}>None</option>
        {value !== NO_CAMERA_LINK && value >= count && <option value={value}>Missing camera {value}</option>}
        {Array.from({ length: count }, (_, index) => (
          <option key={index} value={index}>
            Camera {index}
          </option>
        ))}
      </select>
    </Field>
  );
}

/**
 * Camera settings for the KMP-mode inspector. It renders the same friendly editor Camera mode
 * uses ({@link CameraFields}) so a camera reads identically wherever it is selected.
 *
 * The two "which camera starts a pan" pickers are track-wide rather than a property of the
 * selected shot, so they sit in Advanced; Camera mode's chain editor is the place to build a
 * pan. Placement is left to the inspector's own placement section.
 */
export function CameraSection({
  entity,
  scope,
  cameraHeader,
  referenceCounts,
  onChangeCameraField,
  onChangeCameraHeaderField,
  onChangeCameraViewPosition,
}: {
  entity: KmpEntity;
  scope: InspectorScope;
  cameraHeader: ReturnType<typeof getKmpCameraHeader> | null;
  referenceCounts: ReferenceCounts;
  onChangeCameraField: (field: KmpCameraField, value: number) => void;
  onChangeCameraHeaderField: (field: KmpCameraHeaderField, value: number) => void;
  onChangeCameraViewPosition: (side: 'start' | 'end', position: Vec3) => void;
}) {
  if (!entity.camera) return null;

  if (scope === 'advanced') {
    if (!cameraHeader) return null;
    return (
      <div className="propertyGrid">
        <ChainStartSelect
          label="Opening pan starts at"
          hint="Track-wide"
          value={cameraHeader.firstIntroCam}
          count={referenceCounts.cameras}
          onChange={(next) => onChangeCameraHeaderField('firstIntroCam', next)}
        />
        <ChainStartSelect
          label="Selection pan starts at"
          hint="Track-wide"
          value={cameraHeader.firstSelectionCam}
          count={referenceCounts.cameras}
          onChange={(next) => onChangeCameraHeaderField('firstSelectionCam', next)}
        />
      </div>
    );
  }

  // The KMP inspector patches one field per edit, and every control here changes exactly one.
  function applyValues(values: Partial<CameraValues>) {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      if (key === 'viewStart') onChangeCameraViewPosition('start', value as Vec3);
      else if (key === 'viewEnd') onChangeCameraViewPosition('end', value as Vec3);
      else if (key !== 'position' && key !== 'rotation') onChangeCameraField(key as KmpCameraField, value as number);
    }
  }

  return (
    <div className="propertyGrid">
      <CameraFields entity={entity} cameraCount={referenceCounts.cameras} routeCount={referenceCounts.routes} showPlacement={false} onChange={applyValues} />
    </div>
  );
}
