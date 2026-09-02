import { parseGroupLinkText, type PathInfo } from '../../../lib/kmpEdit';

export function PathGroupSection({
  pathInfo,
  onChangePathGroupLinks,
  onSplitPathGroup,
  onMergePathGroup,
}: {
  pathInfo: PathInfo | null;
  onChangePathGroupLinks: (side: 'prev' | 'next', links: number[]) => void;
  onSplitPathGroup?: () => void;
  onMergePathGroup?: () => void;
}) {
  return (
    <>
      {pathInfo && (
        <>
          <label>
            Path Group
            <span>
              {pathInfo.groupSection} #{pathInfo.groupIndex} · point {pathInfo.localIndex + 1}/{pathInfo.groupSize}
            </span>
          </label>
          {(onSplitPathGroup || onMergePathGroup) && (
            <label>
              Group Operations
              <div className="actionRow">
                <button className="inlineAction" type="button" onClick={onSplitPathGroup} disabled={!onSplitPathGroup}>
                  Split
                </button>
                <button className="inlineAction" type="button" onClick={onMergePathGroup} disabled={!onMergePathGroup}>
                  Merge Next
                </button>
              </div>
            </label>
          )}
          <label>
            Group Links
            <div className="vectorInputs">
              <input
                aria-label="Previous groups"
                title="Previous groups"
                value={pathInfo.prevGroups.join(', ')}
                onChange={(event) => onChangePathGroupLinks('prev', parseGroupLinkText(event.currentTarget.value))}
              />
              <input
                aria-label="Next groups"
                title="Next groups"
                value={pathInfo.nextGroups.join(', ')}
                onChange={(event) => onChangePathGroupLinks('next', parseGroupLinkText(event.currentTarget.value))}
              />
              <span>{pathInfo.groupSection}</span>
            </div>
          </label>
        </>
      )}
    </>
  );
}
