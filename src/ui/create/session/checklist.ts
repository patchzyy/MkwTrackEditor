/**
 * The Build panel's checklist (docs/CREATE.md §6.5): `analyzeProject`'s five items, remapped to
 * the session's shape, plus the "Test drive" item that only the session can know.
 */
import type { ChecklistItem as AnalysisItem, ProjectChecklist } from '../../../lib/create/analyze';
import type { ChecklistItem, CreateChecklist } from './types';

function map(item: AnalysisItem, title: string, warnState: ChecklistItem['state'] = 'warning'): ChecklistItem {
  return {
    state: item.state === 'done' ? 'done' : item.state === 'warn' ? warnState : 'todo',
    title,
    detail: item.detail,
    target: item.target,
  };
}

export function buildChecklist(analysis: ProjectChecklist, options: { testDriven: boolean }): CreateChecklist {
  const drivable = map(analysis.drivable, 'Drivable', 'error');
  const canDrive = drivable.state === 'done';
  const testDrive: ChecklistItem = options.testDriven
    ? { state: 'done', title: 'Test drive', detail: 'You took this version for a spin.' }
    : {
        state: 'todo',
        title: 'Test drive',
        detail: canDrive ? 'Take it for a spin (F5).' : 'Finish the road first, then take it for a spin.',
      };
  return {
    world: map(analysis.world, 'World'),
    roadLoop: map(analysis.roadLoop, 'Road loop'),
    startLine: map(analysis.startLine, 'Start line'),
    itemBoxes: map(analysis.itemBoxes, 'Item boxes'),
    drivable,
    testDrive,
  };
}

/** True when every item but the test drive is done: the "ready to race" state. */
export function isReadyToRace(checklist: CreateChecklist): boolean {
  return (
    checklist.world.state === 'done' &&
    checklist.roadLoop.state === 'done' &&
    checklist.startLine.state === 'done' &&
    checklist.drivable.state === 'done'
  );
}
