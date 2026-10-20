import { CircleAlert, TriangleAlert, Wrench } from 'lucide-react';
import { useState } from 'react';
import type { TrackIssue } from '../../lib/kmpValidation';
import { DetailsCategory } from './PropertySheet';

export interface TrackProblemFix {
  label: string;
  run: () => void;
}

interface Row {
  key: string;
  level: 'error' | 'warning';
  message: string;
  entityId?: string;
  fix: TrackProblemFix | null;
}

/**
 * The "what is wrong with this track" summary shared by the empty Details panel and the Track
 * tab: error/warning counts, one "fix everything" button, and a short list of one-line issues
 * (errors first) with the rest behind "Show all".
 */
export function TrackProblems({
  name = 'Problems',
  defaultOpen = true,
  issues,
  loadWarnings = [],
  limit = 3,
  quickFix,
  onFixAll,
  onSelectEntity,
}: {
  name?: string;
  defaultOpen?: boolean;
  issues: readonly TrackIssue[];
  /** Warnings raised while the archive was loaded. They have no record to jump to. */
  loadWarnings?: readonly string[];
  /** How many issues show before "Show all". */
  limit?: number;
  /** Maps an issue to its one-click repair, when there is one. */
  quickFix?: (issue: TrackIssue) => TrackProblemFix | null;
  onFixAll?: () => void;
  /** Called with the record an issue is about, so the author can jump to it. */
  onSelectEntity?: (entityId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows: Row[] = [
    ...issues.map((issue, index) => ({
      key: `${issue.code}-${issue.entityId ?? ''}-${index}`,
      level: issue.level,
      message: issue.message,
      entityId: issue.entityId,
      fix: quickFix?.(issue) ?? null,
    })),
    ...loadWarnings.map((warning, index) => ({ key: `load-${index}`, level: 'warning' as const, message: warning, entityId: undefined, fix: null })),
  ].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  const errorCount = rows.filter((row) => row.level === 'error').length;
  const warningCount = rows.length - errorCount;
  const visible = expanded ? rows : rows.slice(0, limit);
  const canFixAny = rows.some((row) => row.fix);

  return (
    <DetailsCategory
      name={name}
      defaultOpen={defaultOpen}
      badge={
        <>
          <span className={`validationBadge${errorCount > 0 ? ' error' : ''}`}>{errorCount} errors</span>
          <span className={`validationBadge${warningCount > 0 ? ' warning' : ''}`}>{warningCount} warnings</span>
        </>
      }
    >
      <div className="trackProblems">
        {rows.length === 0 ? (
          <p className="kmpReady">Nothing to fix. This track is ready to export.</p>
        ) : (
          <>
            {onFixAll && (
              <button
                type="button"
                className="inlineAction trackProblemsFixAll"
                disabled={!canFixAny}
                title="Applies every available fix in one undo step. Missing files and layout problems still need manual edits, and generated routes should be reviewed."
                onClick={onFixAll}
              >
                Fix all repairable issues
              </button>
            )}
            <ul className="trackProblemList">
              {visible.map((row) => {
                const Icon = row.level === 'error' ? CircleAlert : TriangleAlert;
                return (
                  <li className={`trackProblem ${row.level}`} key={row.key}>
                    <Icon size={13} aria-hidden="true" />
                    {row.entityId && onSelectEntity ? (
                      <button type="button" className="trackProblemText kmpIssueLink" title={row.message} onClick={() => onSelectEntity(row.entityId!)}>
                        {row.message}
                      </button>
                    ) : (
                      <span className="trackProblemText" title={row.message}>
                        {row.message}
                      </span>
                    )}
                    {row.fix && (
                      <button type="button" className="trackProblemFix" title={row.fix.label} aria-label={row.fix.label} onClick={row.fix.run}>
                        <Wrench size={12} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {rows.length > limit && (
              <button type="button" className="trackProblemsMore" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                {expanded ? 'Show fewer' : `Show all ${rows.length}`}
              </button>
            )}
          </>
        )}
      </div>
    </DetailsCategory>
  );
}
