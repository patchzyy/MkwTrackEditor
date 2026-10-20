import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { CreateIssue } from '../../../lib/create/types';
import { Button } from '../../components/Button';
import { Popover } from '../../components/Popover';

export type HealthState = 'checking' | 'ready' | 'fix';

export interface HealthSummary {
  state: HealthState;
  /** Things that stop the track from being raceable, plus warnings the user should know about. */
  problems: CreateIssue[];
  tips: CreateIssue[];
  label: string;
}

/** Pure: turns the analysis into the chip's label. Only errors count as "things to fix"; warnings and info are tips. */
export function summariseHealth(issues: readonly CreateIssue[], busy: boolean, hasDesign: boolean): HealthSummary {
  const problems = issues.filter((i) => i.level === 'error');
  const tips = issues.filter((i) => i.level !== 'error');
  if (!hasDesign) return { state: 'checking', problems, tips, label: 'Checking your track...' };
  if (problems.length === 0) {
    if (busy && issues.length === 0) return { state: 'checking', problems, tips, label: 'Checking your track...' };
    return { state: 'ready', problems, tips, label: 'Ready to race' };
  }
  const count = problems.length;
  return { state: 'fix', problems, tips, label: count === 1 ? '1 thing to fix' : `${count} things to fix` };
}

function IssueIcon({ level }: { level: CreateIssue['level'] }) {
  if (level === 'error') return <CircleAlert size={14} className="crIssueIcon is-error" />;
  if (level === 'warning') return <TriangleAlert size={14} className="crIssueIcon is-warning" />;
  return <Info size={14} className="crIssueIcon is-info" />;
}

/**
 * Bottom-left "Ready to race" / "2 things to fix" chip. Clicking it lists what is wrong in plain
 * words, each with a "Show me" that selects and frames the problem.
 */
export function HealthChip({
  issues,
  busy,
  hasDesign,
  onShowMe,
}: {
  issues: readonly CreateIssue[];
  busy: boolean;
  hasDesign: boolean;
  onShowMe: (issue: CreateIssue) => void;
}) {
  const health = summariseHealth(issues, busy, hasDesign);
  return (
    <div className="crHealth">
      <Popover
        label="Track health"
        align="start"
        className="crHealthPopover"
        trigger={({ open, toggle }) => (
          <button type="button" className={`crHealthChip is-${health.state}${open ? ' is-open' : ''}`} onClick={toggle} aria-expanded={open} data-create-health={health.state}>
            {health.state === 'ready' ? <CircleCheck size={14} /> : health.state === 'checking' ? <LoaderCircle size={14} className="createSpin" /> : <TriangleAlert size={14} />}
            <span>{health.label}</span>
            {health.state === 'ready' && health.tips.length > 0 && <span className="crHealthTip">{health.tips.length} {health.tips.length === 1 ? 'tip' : 'tips'}</span>}
          </button>
        )}
      >
        <div className="crHealthList">
          {health.problems.length === 0 && health.tips.length === 0 && (
            <p className="crHealthEmpty">
              <CircleCheck size={15} /> Nothing to fix. Press F5 and take it for a spin!
            </p>
          )}
          {[...health.problems, ...health.tips].map((issue, index) => (
            <div key={`${issue.code}-${index}`} className={`crIssue is-${issue.level}`}>
              <IssueIcon level={issue.level} />
              <div className="crIssueText">
                <strong>{issue.message}</strong>
                {issue.fix && <span>{issue.fix}</span>}
              </div>
              {issue.target && (
                <Button size="sm" onClick={() => onShowMe(issue)} data-create-action="show-me">
                  Show me
                </Button>
              )}
            </div>
          ))}
        </div>
      </Popover>
    </div>
  );
}
