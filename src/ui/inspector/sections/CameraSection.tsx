import type { getKmpCameraHeader, KmpCameraField, KmpCameraHeaderField, KmpEntity, Vec3 } from '../../../lib/kmp';
import type { ReferenceCounts } from '../../../lib/kmpEdit';
import { ReferenceSelect } from '../fields/ReferenceSelect';
import { VectorInputs } from '../fields/VectorInputs';

export function CameraSection({
  entity,
  cameraHeader,
  referenceCounts,
  onChangeCameraField,
  onChangeCameraHeaderField,
  onChangeCameraViewPosition,
}: {
  entity: KmpEntity;
  cameraHeader: ReturnType<typeof getKmpCameraHeader> | null;
  referenceCounts: ReferenceCounts;
  onChangeCameraField: (field: KmpCameraField, value: number) => void;
  onChangeCameraHeaderField: (field: KmpCameraHeaderField, value: number) => void;
  onChangeCameraViewPosition: (side: 'start' | 'end', position: Vec3) => void;
}) {
  return (
    <>
      {entity.camera && (
        <>
          {cameraHeader && (
            <label>
              Camera Starts
              <div className="vectorInputs">
                <ReferenceSelect
                  label="Intro start camera"
                  value={cameraHeader.firstIntroCam}
                  noneValue={0xff}
                  count={referenceCounts.cameras}
                  optionLabel="Camera"
                  onChange={(next) => onChangeCameraHeaderField('firstIntroCam', next)}
                />
                <ReferenceSelect
                  label="Selection start camera"
                  value={cameraHeader.firstSelectionCam}
                  noneValue={0xff}
                  count={referenceCounts.cameras}
                  optionLabel="Camera"
                  onChange={(next) => onChangeCameraHeaderField('firstSelectionCam', next)}
                />
                <span>Camera Chain</span>
              </div>
            </label>
          )}
          <label>
            Camera Settings
            <div className="settingInputs">
              {(Object.entries(entity.camera) as Array<[KmpCameraField, number]>).map(([field, value]) => {
                const floatField = field === 'zoomStart' || field === 'zoomEnd' || field === 'time';
                const byteField = field === 'type' || field === 'nextCam' || field === 'shake' || field === 'routeIndex' || field === 'start' || field === 'movie';
                if (field === 'nextCam') {
                  return <ReferenceSelect key={field} label={field} value={value} noneValue={0xff} count={referenceCounts.cameras} optionLabel="Camera" onChange={(next) => onChangeCameraField(field, next)} />;
                }
                if (field === 'routeIndex') {
                  return <ReferenceSelect key={field} label={field} value={value} noneValue={0xff} count={referenceCounts.routes} optionLabel="Route" onChange={(next) => onChangeCameraField(field, next)} />;
                }
                return (
                  <input
                    key={field}
                    aria-label={field}
                    title={field}
                    type="number"
                    min={floatField ? undefined : 0}
                    max={floatField ? undefined : byteField ? 255 : 65535}
                    step={floatField ? 0.1 : 1}
                    value={Number.isFinite(value) ? Number(value.toFixed(floatField ? 3 : 0)) : 0}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      if (!Number.isFinite(next)) return;
                      if (floatField) onChangeCameraField(field, next);
                      else onChangeCameraField(field, Math.max(0, Math.min(byteField ? 0xff : 0xffff, Math.trunc(next))));
                    }}
                  />
                );
              })}
            </div>
          </label>
          {entity.cameraView && (
            <>
              <label>
                View Start
                <VectorInputs value={entity.cameraView.start} onChange={(position) => onChangeCameraViewPosition('start', position)} />
              </label>
              <label>
                View End
                <VectorInputs value={entity.cameraView.end} onChange={(position) => onChangeCameraViewPosition('end', position)} />
              </label>
            </>
          )}
        </>
      )}
    </>
  );
}
