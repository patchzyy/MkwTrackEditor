import type { KmpCheckpointField, KmpEntity, Vec3 } from '../../../lib/kmp';
import type { ReferenceCounts } from '../../../lib/kmpEdit';
import { ReferenceSelect } from '../fields/ReferenceSelect';
import { VectorInputs } from '../fields/VectorInputs';

export function CheckpointSection({
  entity,
  referenceCounts,
  onChangeCheckpointEndpoint,
  onChangeCheckpointField,
}: {
  entity: KmpEntity;
  referenceCounts: ReferenceCounts;
  onChangeCheckpointEndpoint: (side: 'left' | 'right', position: Vec3) => void;
  onChangeCheckpointField: (field: KmpCheckpointField, value: number) => void;
}) {
  return (
    <>
      {entity.checkpoint && (
        <>
          <label>
            Left Endpoint
            <VectorInputs value={entity.checkpoint.left} onChange={(position) => onChangeCheckpointEndpoint('left', position)} />
          </label>
          <label>
            Right Endpoint
            <VectorInputs value={entity.checkpoint.right} onChange={(position) => onChangeCheckpointEndpoint('right', position)} />
          </label>
          <label>
            Checkpoint Data
            <div className="settingInputs">
              <ReferenceSelect label="respawnIndex" value={entity.checkpoint.respawnIndex} noneValue={0xff} count={referenceCounts.respawns} optionLabel="Respawn" onChange={(next) => onChangeCheckpointField('respawnIndex', next)} />
              <input
                aria-label="type"
                title="type"
                type="number"
                min="0"
                max="255"
                value={entity.checkpoint.type}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeCheckpointField('type', Math.max(0, Math.min(0xff, Math.trunc(next))));
                }}
              />
              <ReferenceSelect label="prev" value={entity.checkpoint.prev} noneValue={0xff} count={referenceCounts.checkpoints} optionLabel="Checkpoint" onChange={(next) => onChangeCheckpointField('prev', next)} />
              <ReferenceSelect label="next" value={entity.checkpoint.next} noneValue={0xff} count={referenceCounts.checkpoints} optionLabel="Checkpoint" onChange={(next) => onChangeCheckpointField('next', next)} />
            </div>
          </label>
        </>
      )}
    </>
  );
}
