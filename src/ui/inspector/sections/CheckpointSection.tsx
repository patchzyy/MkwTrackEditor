import type { KmpCheckpointField, KmpEntity, Vec3 } from '../../../lib/kmp';
import type { ReferenceCounts } from '../../../lib/kmpEdit';
import { ReferenceSelect } from '../fields/ReferenceSelect';
import { VectorInputs } from '../fields/VectorInputs';
import type { InspectorScope } from './scope';
import { PropertyRow } from '../PropertySheet';

/**
 * Checkpoints. The essentials are the two ends of the line and the respawn a driver who falls
 * here comes back at; the raw type byte and the prev/next chain stay in Advanced, because the
 * checkpoint tools above the property sheet already set them from plain language.
 */
export function CheckpointSection({
  entity,
  scope,
  referenceCounts,
  onChangeCheckpointEndpoint,
  onChangeCheckpointField,
}: {
  entity: KmpEntity;
  scope: InspectorScope;
  referenceCounts: ReferenceCounts;
  onChangeCheckpointEndpoint: (side: 'left' | 'right', position: Vec3) => void;
  onChangeCheckpointField: (field: KmpCheckpointField, value: number) => void;
}) {
  const checkpoint = entity.checkpoint;
  if (!checkpoint) return null;

  if (scope === 'essentials') {
    return (
      <div className="propertyGrid">
        <label>
          Left end
          <VectorInputs value={checkpoint.left} onChange={(position) => onChangeCheckpointEndpoint('left', position)} />
        </label>
        <label>
          Right end
          <VectorInputs value={checkpoint.right} onChange={(position) => onChangeCheckpointEndpoint('right', position)} />
        </label>
        <label>
          Respawn used here
          <ReferenceSelect
            label="Respawn used here"
            value={checkpoint.respawnIndex}
            noneValue={0xff}
            count={referenceCounts.respawns}
            optionLabel="Respawn point"
            onChange={(next) => onChangeCheckpointField('respawnIndex', next)}
          />
        </label>
      </div>
    );
  }

  return (
    <div className="propertyGrid">
      <PropertyRow label="Checkpoint type byte" help="255 is an ordinary checkpoint, 0 is the finish line, 1 and up are key checkpoints.">
        <input
          aria-label="Checkpoint type byte"
          type="number"
          min="0"
          max="255"
          value={checkpoint.type}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChangeCheckpointField('type', Math.max(0, Math.min(0xff, Math.trunc(next))));
          }}
        />
      </PropertyRow>
      <label>
        Previous checkpoint
        <ReferenceSelect label="Previous checkpoint" value={checkpoint.prev} noneValue={0xff} count={referenceCounts.checkpoints} optionLabel="Checkpoint" onChange={(next) => onChangeCheckpointField('prev', next)} />
      </label>
      <label>
        Next checkpoint
        <ReferenceSelect label="Next checkpoint" value={checkpoint.next} noneValue={0xff} count={referenceCounts.checkpoints} optionLabel="Checkpoint" onChange={(next) => onChangeCheckpointField('next', next)} />
      </label>
    </div>
  );
}
