import type { KmpEntity } from '../../../lib/kmp';

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
      <label>
        Used by
        <select
          aria-label="Player this start point is for"
          title="Races leave this on 'Any driver'. Battle arenas give each player their own start point."
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
        <span>
          {playerIndex < 0
            ? 'The grid spreads every driver out from this point. This is what a race track wants.'
            : `Only player ${playerIndex + 1} starts here. Battle arenas use this; a race track normally should not.`}
        </span>
      </label>
    </div>
  );
}
