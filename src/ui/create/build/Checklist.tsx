import { ArrowRight, Check, ChevronDown, ChevronRight, CircleAlert, Circle, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { CreateSession } from '../session/types';
import type { CreateTools } from '../tools/useCreateTools';
import { checklistAction, CHECKLIST_ORDER, checklistProgress, nextStep, type ChecklistAction, type ChecklistKey } from './checklistActions';

const ICONS: Record<'done' | 'todo' | 'warning' | 'error', ReactNode> = {
  done: <Check size={12} strokeWidth={3.2} />,
  todo: <Circle size={10} />,
  warning: <TriangleAlert size={12} />,
  error: <CircleAlert size={12} />,
};

/** Runs what a checklist row asks for against the session and tools. */
export function runChecklistAction(action: ChecklistAction, session: CreateSession, tools: CreateTools): void {
  switch (action.type) {
    case 'trackSettings':
      session.select([]);
      return;
    case 'tool':
      if (action.arm) tools.arm(action.arm);
      else tools.setTool(action.tool);
      if (action.select) session.select(action.select);
      if (action.frame && action.select) tools.frameSelection(action.select);
      return;
    case 'show':
      session.select([action.selection]);
      tools.frameSelection([action.selection]);
      return;
    case 'testDrive':
      if (session.canTestDrive) void session.testDrive();
      else tools.flash(session.testDriveDisabledReason ?? 'Finish the road first, then take it for a spin.');
      return;
    case 'none':
      return;
  }
}

/** Window heights below this start the checklist collapsed, so the Layers list gets the room. */
const COMPACT_HEIGHT_PX = 860;

function useCompactHeight(): boolean {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerHeight < COMPACT_HEIGHT_PX);
  useEffect(() => {
    const onResize = () => setCompact(window.innerHeight < COMPACT_HEIGHT_PX);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return compact;
}

/**
 * "What makes a race track": World, Road loop, Start line, Item boxes, Drivable, Test drive. Each
 * row says in one sentence where you are; clicking it jumps to the tool or the problem.
 */
export function Checklist({ session, tools }: { session: CreateSession; tools: CreateTools }) {
  const checklist = session.checklist;
  const project = session.project;
  const compact = useCompactHeight();
  // Open while there is work to do, folded to its progress bar once everything is done or the window
  // is short. The user's own click on the header always wins.
  const [manual, setManual] = useState<boolean | null>(null);
  if (!checklist || !project) {
    return (
      <div className="crChecklist" data-create-checklist>
        <p className="crChecklistWait">Getting your track ready...</p>
      </div>
    );
  }
  const progress = checklistProgress(checklist);
  const allDone = progress.done === progress.total;
  const collapsed = manual ?? (allDone || compact);
  return (
    <div className={`crChecklist${collapsed ? ' is-collapsed' : ''}`} data-create-checklist data-collapsed={collapsed || undefined}>
      <button
        type="button"
        className="crChecklistHead"
        aria-expanded={!collapsed}
        title={collapsed ? 'Show the checklist' : 'Fold the checklist'}
        onClick={() => setManual(!collapsed)}
        data-create-action="toggle-checklist"
      >
        {collapsed ? <ChevronRight size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
        <strong>{allDone ? 'Everything is done' : `${progress.done} of ${progress.total} done`}</strong>
        <span className="crProgress" aria-hidden="true">
          <i style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </span>
      </button>
      <p className="crChecklistNext">{nextStep(checklist)}</p>
      {!collapsed && <ul className="crCheckList">
        {CHECKLIST_ORDER.map((key: ChecklistKey) => {
          const item = checklist[key];
          const action = checklistAction(key, item, project, session.issues);
          const clickable = action.type !== 'none';
          return (
            <li key={key}>
              <button
                type="button"
                className={`crCheckItem is-${item.state}`}
                data-check-state={item.state}
                data-check-key={key}
                disabled={!clickable}
                onClick={() => runChecklistAction(action, session, tools)}
              >
                <span className="crCheckIcon" aria-hidden="true">
                  {ICONS[item.state]}
                </span>
                <span className="crCheckText">
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </span>
                {clickable && <ArrowRight size={13} className="crCheckGo" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>}
    </div>
  );
}
