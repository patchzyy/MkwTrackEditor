import type { Vec3 } from '../../lib/kmp';
import type { ObjectOption } from '../objects/objectCatalog';
import { ObjectIdSelect } from './fields/ObjectIdSelect';
import { VectorInputs } from './fields/VectorInputs';

export function BatchSelectionPanel({
  count,
  offset,
  onChangeOffset,
  onApplyOffset,
  objectOptions,
  objectId,
  onChangeObjectId,
  onApplyObjectId,
  onDelete,
}: {
  count: number;
  offset: Vec3;
  onChangeOffset: (value: Vec3) => void;
  onApplyOffset: () => void;
  objectOptions: ObjectOption[];
  objectId: number | null;
  onChangeObjectId: (value: number | null) => void;
  onApplyObjectId?: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <h2>Batch Edit</h2>
      <div className="propertyGrid">
        <label>
          Selection
          <span>{count} elements selected</span>
        </label>
        <label>
          Actions
          <div className="actionRow">
            <button className="inlineAction" type="button" onClick={onDelete}>
              Delete
            </button>
          </div>
        </label>
        <label>
          Offset Position
          <VectorInputs value={offset} onChange={onChangeOffset} />
        </label>
        <label>
          Apply Offset
          <button className="inlineAction" type="button" onClick={onApplyOffset}>
            Move selected
          </button>
        </label>
        {objectId !== null && objectOptions.length > 0 && (
          <>
            <label>
              Replace Objects
              <ObjectIdSelect value={objectId} options={objectOptions} onChange={(value) => onChangeObjectId(value)} />
            </label>
            <label>
              Apply Object Type
              <button className="inlineAction" type="button" onClick={onApplyObjectId} disabled={!onApplyObjectId}>
                Replace selected objects
              </button>
            </label>
          </>
        )}
      </div>
    </>
  );
}
