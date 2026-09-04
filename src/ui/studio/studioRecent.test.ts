import { describe, expect, it } from 'vitest';
import { STUDIO_RECENT_BYTE_BUDGET, STUDIO_RECENT_LIMIT, studioRecentId, trimStudioRecents } from './studioRecent';

function entry(fileName: string, openedAt: number, size = 1024) {
  return { id: studioRecentId(fileName), fileName, size, openedAt };
}

describe('studio recent files', () => {
  it('keys an entry by file name, case-insensitively, so reopening updates it', () => {
    expect(studioRecentId('Z0.szs')).toBe(studioRecentId('z0.SZS'));
  });

  it('puts the newest first and keeps one entry per file', () => {
    const trimmed = trimStudioRecents([entry('a.szs', 1), entry('b.szs', 3), entry('a.szs', 5)]);
    expect(trimmed.map((item) => item.fileName)).toEqual(['a.szs', 'b.szs']);
    expect(trimmed[0].openedAt).toBe(5);
  });

  it('caps the list by count', () => {
    const many = Array.from({ length: STUDIO_RECENT_LIMIT + 4 }, (_, index) => entry(`t${index}.szs`, index));
    expect(trimStudioRecents(many)).toHaveLength(STUDIO_RECENT_LIMIT);
  });

  it('caps the list by total size, dropping the oldest', () => {
    const big = Math.floor(STUDIO_RECENT_BYTE_BUDGET / 2) + 1;
    const trimmed = trimStudioRecents([entry('old.szs', 1, big), entry('mid.szs', 2, big), entry('new.szs', 3, big)]);
    expect(trimmed.map((item) => item.fileName)).toEqual(['new.szs']);
  });

  it('still keeps the newest file even when it alone is over the budget', () => {
    const huge = STUDIO_RECENT_BYTE_BUDGET * 2;
    expect(trimStudioRecents([entry('huge.szs', 1, huge)]).map((item) => item.fileName)).toEqual(['huge.szs']);
  });
});
