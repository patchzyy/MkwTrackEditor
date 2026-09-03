import type { KmpEntity, Vec3 } from '../../../lib/kmp';
import { VectorInputs } from '../fields/VectorInputs';
import type { KmpRecordSummary } from '../recordSummary';

/**
 * Where the record sits in the world. Every placed record starts with this, in the same
 * order, so the inspector reads the same whatever is selected.
 *
 * Checkpoints are the exception: their "position" is the pair of endpoints, so the plain
 * position row moves into Advanced (see `recordSummary`) and `CheckpointSection` shows the
 * endpoints instead.
 */
export function PlacementSection({
  entity,
  summary,
  showPosition = true,
  onChangePosition,
  onChangeRotation,
  onChangeScale,
}: {
  entity: KmpEntity;
  summary: KmpRecordSummary;
  showPosition?: boolean;
  onChangePosition: (position: Vec3) => void;
  onChangeRotation: (rotation: Vec3) => void;
  onChangeScale: (scale: Vec3) => void;
}) {
  if (!summary.hasPosition && !summary.hasRotation && !summary.hasScale) return null;
  const wantsPosition = showPosition && summary.hasPosition;
  if (!wantsPosition && !summary.hasRotation && !summary.hasScale) return null;
  return (
    <div className="propertyGrid">
      {wantsPosition && (
        <label>
          Position
          <VectorInputs value={entity.position} onChange={onChangePosition} />
        </label>
      )}
      {summary.hasRotation && entity.rotation && (
        <label>
          Rotation
          <VectorInputs value={entity.rotation} onChange={onChangeRotation} />
        </label>
      )}
      {summary.hasScale && entity.scale && (
        <label>
          Size
          <VectorInputs value={entity.scale} onChange={onChangeScale} step={0.1} />
        </label>
      )}
    </div>
  );
}
