import { describe, expect, it } from 'vitest';
import type { CreateIssue } from '../../../lib/create/types';
import { TOOL_ORDER } from '../tools/types';
import { CARD_WIDTH, COACH_STEPS, COACH_STORAGE_KEY, coachSeen, markCoachSeen, placeCoachCard, resetCoachMarks, type StorageLike } from './coach';
import { brushReadout } from './CreateChrome';
import { summariseHealth } from './HealthChip';
import { describeConflicts } from './ConflictBanner';
import { TOOL_INFO } from './toolInfo';

const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

describe('tool bar info', () => {
  it('lists every tool once, in order, with its documented key and a sentence', () => {
    expect(TOOL_INFO.map((t) => t.id)).toEqual([...TOOL_ORDER]);
    expect(TOOL_INFO.map((t) => t.key)).toEqual(['V', 'R', 'S', 'P', 'B', 'H', 'D', 'G']);
    for (const tool of TOOL_INFO) expect(tool.description.endsWith('.')).toBe(true);
  });
});

describe('coach marks', () => {
  it('has the four documented steps', () => {
    expect(COACH_STEPS.map((s) => s.id)).toEqual(['viewport', 'tools', 'palette', 'testDrive']);
  });

  it('is remembered once finished and can be reset', () => {
    const storage = memory();
    expect(coachSeen(storage)).toBe(false);
    markCoachSeen(storage);
    expect(storage.data.get(COACH_STORAGE_KEY)).toBe('done');
    expect(coachSeen(storage)).toBe(true);
    resetCoachMarks(storage);
    expect(coachSeen(storage)).toBe(false);
    expect(coachSeen(null)).toBe(false);
  });

  it('places the card under or over its target and keeps it inside the viewport', () => {
    const bounds = { left: 0, top: 0, width: 1000, height: 700 };
    const below = placeCoachCard({ left: 400, top: 40, width: 200, height: 50 }, 160, bounds, 'below');
    expect(below.side).toBe('below');
    expect(below.top).toBeGreaterThan(90);
    expect(below.left + CARD_WIDTH / 2).toBeCloseTo(500, 0);
    const above = placeCoachCard({ left: 100, top: 600, width: 300, height: 80 }, 160, bounds, 'above');
    expect(above.top + 160).toBeLessThan(600);
    const edge = placeCoachCard({ left: 950, top: 40, width: 40, height: 40 }, 160, bounds, 'below');
    expect(edge.left + CARD_WIDTH).toBeLessThanOrEqual(1000);
    const centre = placeCoachCard(null, 160, bounds, 'center');
    expect(centre.side).toBeNull();
    expect(centre.left + CARD_WIDTH / 2).toBeCloseTo(500, 0);
  });
});

describe('health chip', () => {
  const issue = (level: CreateIssue['level'], message = 'm'): CreateIssue => ({ level, code: level, message });
  it('is ready when there are no errors, counting warnings as tips', () => {
    expect(summariseHealth([], false, true)).toMatchObject({ state: 'ready', label: 'Ready to race' });
    expect(summariseHealth([issue('warning')], false, true)).toMatchObject({ state: 'ready', tips: [expect.anything()] });
  });
  it('counts errors as things to fix', () => {
    expect(summariseHealth([issue('error')], false, true).label).toBe('1 thing to fix');
    expect(summariseHealth([issue('error'), issue('error'), issue('info')], false, true).label).toBe('2 things to fix');
  });
  it('says it is checking until there is a design to check', () => {
    expect(summariseHealth([], false, false).state).toBe('checking');
    expect(summariseHealth([], true, true).state).toBe('checking');
  });
});

describe('small formatters', () => {
  it('describes conflicts as one phrase', () => {
    expect(describeConflicts([])).toBe('the track');
    expect(describeConflicts([{ path: 'a', what: 'checkpoints' }])).toBe('checkpoints');
    expect(describeConflicts([{ path: 'a', what: 'checkpoints' }, { path: 'b', what: 'the course model' }, { path: 'c', what: 'checkpoints' }])).toBe('checkpoints and the course model');
  });
  it('reads brush sizes', () => {
    expect(brushReadout(1800)).toBe('Brush 1.8k');
    expect(brushReadout(3000)).toBe('Brush 3k');
    expect(brushReadout(600)).toBe('Brush 600');
  });
});
