import type { KmpEntity } from '../../../lib/kmp';
import type { ReferenceCounts } from '../../../lib/kmpEdit';
import type { ObjectInspectorProfile } from '../../objects/objectProfiles';

const NO_ROUTE = 0xffff;

/**
 * One row for an object's movement path: what it follows now, and the single button that
 * makes sense next — "Edit" when it has a path, "Create path" when it does not.
 *
 * Routes are shown 1-based, matching the outliner ("Path 3", not "route index 2").
 */
export function ObjectRouteSection({
  entity,
  objectProfile,
  referenceCounts,
  onChangeRouteIndex,
  onCreateObjectRoute,
  onSelectObjectRoute,
}: {
  entity: KmpEntity;
  objectProfile: ObjectInspectorProfile | null;
  referenceCounts: ReferenceCounts;
  onChangeRouteIndex: (routeIndex: number) => void;
  onCreateObjectRoute?: () => void;
  onSelectObjectRoute?: () => void;
}) {
  if (entity.routeIndex === undefined) return null;
  const routeIndex = entity.routeIndex;
  const hasRoute = routeIndex !== NO_ROUTE;
  const label = objectProfile?.routeLabel ?? 'Movement path';
  const missing = hasRoute && routeIndex >= referenceCounts.routes;
  return (
    <div className="propertyGrid">
      <label>
        {label}
        <div className="inspectorRouteRow">
          <select
            aria-label={label}
            value={String(routeIndex)}
            onChange={(event) => onChangeRouteIndex(Number(event.currentTarget.value))}
          >
            <option value={String(NO_ROUTE)}>Does not follow a path</option>
            {missing && <option value={String(routeIndex)}>Missing path {routeIndex + 1}</option>}
            {Array.from({ length: referenceCounts.routes }, (_, index) => (
              <option key={index} value={String(index)}>
                Follows path {index + 1}
              </option>
            ))}
          </select>
          {hasRoute && !missing && onSelectObjectRoute && (
            <button type="button" className="inlineAction" onClick={onSelectObjectRoute}>
              Edit
            </button>
          )}
          {!hasRoute && onCreateObjectRoute && (
            <button type="button" className="inlineAction" onClick={onCreateObjectRoute}>
              Create path
            </button>
          )}
        </div>
      </label>
    </div>
  );
}
