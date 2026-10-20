/** What clicking a checklist row does (docs/CREATE.md 6.5): switch tool, or select and frame the problem. Pure. */
import type { CreateIssue, CreateProject, CreateSelection } from '../../../lib/create/types';
import type { CreateChecklist, ChecklistItem } from '../session/types';
import { pieceItem } from '../tools/armed';
import type { ArmedItem, ToolId } from '../tools/types';

export type ChecklistKey = keyof CreateChecklist;

export type ChecklistAction =
  | { type: 'trackSettings' }
  | { type: 'tool'; tool: ToolId; arm?: ArmedItem; select?: CreateSelection[]; frame?: boolean }
  | { type: 'show'; selection: CreateSelection }
  | { type: 'testDrive' }
  | { type: 'none' };

export function checklistAction(key: ChecklistKey, item: ChecklistItem, project: CreateProject, issues: readonly CreateIssue[]): ChecklistAction {
  const main = project.roads[0];
  switch (key) {
    case 'world':
      return { type: 'trackSettings' };
    case 'roadLoop':
      if (!main || main.points.length < 2) return { type: 'tool', tool: 'road' };
      if (!main.closed) return { type: 'tool', tool: 'road', select: [{ kind: 'road', roadId: main.id }], frame: true };
      return { type: 'show', selection: { kind: 'road', roadId: main.id } };
    case 'startLine':
      if (item.state === 'done' && main) return { type: 'show', selection: { kind: 'start' } };
      return { type: 'tool', tool: 'start' };
    case 'itemBoxes':
      return { type: 'tool', tool: 'pieces', arm: pieceItem('itemRow') };
    case 'drivable': {
      if (item.state === 'done') return { type: 'none' };
      const error = issues.find((i) => i.level === 'error' && i.target);
      const target = error?.target ?? item.target;
      return target ? { type: 'show', selection: target } : { type: 'none' };
    }
    case 'testDrive':
      return { type: 'testDrive' };
  }
}

export const CHECKLIST_ORDER: ChecklistKey[] = ['world', 'roadLoop', 'startLine', 'itemBoxes', 'drivable', 'testDrive'];

/** How many of the steps are done, for the progress bar. */
export function checklistProgress(checklist: CreateChecklist): { done: number; total: number } {
  const done = CHECKLIST_ORDER.filter((key) => checklist[key].state === 'done').length;
  return { done, total: CHECKLIST_ORDER.length };
}

/** A one-line hint under the checklist title: what to do next. */
export function nextStep(checklist: CreateChecklist): string {
  for (const key of CHECKLIST_ORDER) {
    const item = checklist[key];
    if (item.state === 'done') continue;
    if (key === 'itemBoxes' && item.state === 'todo') continue; // a suggestion, not a blocker
    return item.detail;
  }
  return 'All set. Take it for a spin (F5), or keep decorating.';
}
