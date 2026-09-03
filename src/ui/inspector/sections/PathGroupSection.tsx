import { parseGroupLinkText, type PathInfo } from '../../../lib/kmpEdit';

/**
 * Low-level view of the group a path point belongs to.
 *
 * KMP mode's path tools already do all of this with named buttons and link chips, so this is
 * Advanced-only: it exists for the author who wants to type a link list directly.
 */
export function PathGroupSection({
  pathInfo,
  onChangePathGroupLinks,
}: {
  pathInfo: PathInfo | null;
  onChangePathGroupLinks: (side: 'prev' | 'next', links: number[]) => void;
}) {
  if (!pathInfo) return null;
  return (
    <div className="propertyGrid">
      <label>
        Group
        <span>
          Group {pathInfo.groupIndex + 1} · point {pathInfo.localIndex + 1} of {pathInfo.groupSize}
        </span>
      </label>
      <label>
        Group links
        <div className="vectorInputs">
          <input aria-label="Comes from groups" title="Comes from groups" value={pathInfo.prevGroups.join(', ')} onChange={(event) => onChangePathGroupLinks('prev', parseGroupLinkText(event.currentTarget.value))} />
          <input aria-label="Leads to groups" title="Leads to groups" value={pathInfo.nextGroups.join(', ')} onChange={(event) => onChangePathGroupLinks('next', parseGroupLinkText(event.currentTarget.value))} />
          <span>0-based</span>
        </div>
      </label>
    </div>
  );
}
