import { describe, expect, it } from 'vitest';
import type { ProjectChecklist } from '../../../lib/create/analyze';
import { buildChecklist, isReadyToRace } from './checklist';

const base: ProjectChecklist = {
  world: { state: 'done', label: 'World', detail: 'Sunny.' },
  roadLoop: { state: 'done', label: 'Road loop', detail: 'A closed loop.', target: { kind: 'road', roadId: 'r' } },
  startLine: { state: 'done', label: 'Start line', detail: 'On the road.', target: { kind: 'start' } },
  itemBoxes: { state: 'done', label: 'Item boxes', detail: '5 boxes.' },
  drivable: { state: 'done', label: 'Test drive', detail: 'Ready.' },
};

describe('buildChecklist', () => {
  it('is all green except the test drive on a fresh template', () => {
    const list = buildChecklist(base, { testDriven: false });
    expect(Object.entries(list).map(([key, item]) => [key, item.state])).toEqual([
      ['world', 'done'],
      ['roadLoop', 'done'],
      ['startLine', 'done'],
      ['itemBoxes', 'done'],
      ['drivable', 'done'],
      ['testDrive', 'todo'],
    ]);
    expect(list.testDrive.detail).toContain('F5');
    expect(isReadyToRace(list)).toBe(true);
  });

  it('ticks the test drive once the design was driven', () => {
    expect(buildChecklist(base, { testDriven: true }).testDrive.state).toBe('done');
  });

  it('keeps the titles short and in plain words', () => {
    const list = buildChecklist(base, { testDriven: false });
    expect(Object.values(list).map((item) => item.title)).toEqual(['World', 'Road loop', 'Start line', 'Item boxes', 'Drivable', 'Test drive']);
  });

  it('turns analysis warnings into warnings, and a blocked drive into an error', () => {
    const list = buildChecklist(
      {
        ...base,
        roadLoop: { state: 'warn', label: 'Road loop', detail: 'The road does not form a loop yet.', target: { kind: 'road', roadId: 'r' } },
        itemBoxes: { state: 'todo', label: 'Item boxes', detail: 'Add a row.' },
        drivable: { state: 'warn', label: 'Test drive', detail: '1 thing to fix before it can be driven.' },
      },
      { testDriven: false },
    );
    expect(list.roadLoop.state).toBe('warning');
    expect(list.roadLoop.target).toEqual({ kind: 'road', roadId: 'r' });
    expect(list.itemBoxes.state).toBe('todo');
    expect(list.drivable.state).toBe('error');
    expect(list.testDrive.detail).toContain('Finish the road');
    expect(isReadyToRace(list)).toBe(false);
  });
});
