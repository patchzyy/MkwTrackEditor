import type { KmpEntity } from '../../../lib/kmp';
import { PropertyRow } from '../PropertySheet';

/**
 * Start points (KTPT). The only field beyond position and rotation is the player index, which
 * pins the start to one grid slot; races leave it unset and let the grid spread the drivers out.
 */
export function StartPointSection({
  entity,
  onChangePlayerIndex,
}: {
  entity: KmpEntity;
  onChangePlayerIndex: (playerIndex: number) => void;
}) {
  if (entity.section !== 'KTPT' || entity.ktptPlayerIndex === undefined) return null;
  const playerIndex = entity.ktptPlayerIndex;
  return (
    <div className="propertyGrid">
      <PropertyRow
        label="Used by"
        help={
          playerIndex < 0
            ? 'The grid spreads every driver out from this point. This is what a race track wants.'
            : `Only player ${playerIndex + 1} starts here. Battle arenas use this; a race track normally should not.`
        }
      >
        <select
          aria-label="Player this start point is for"
          value={String(playerIndex < 0 ? -1 : playerIndex)}
          onChange={(event) => onChangePlayerIndex(Number(event.currentTarget.value))}
        >
          <option value="-1">Any driver</option>
          {Array.from({ length: 12 }, (_, index) => (
            <option key={index} value={index}>
              Player {index + 1} only
            </option>
          ))}
        </select>
      </PropertyRow>
    </div>
  );
}
