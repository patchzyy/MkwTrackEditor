import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TrackIssue } from '../../lib/kmpValidation';
import { TrackProblems } from './TrackProblems';

const issue = (n: number, level: TrackIssue['level'] = 'warning'): TrackIssue => ({
  level,
  code: `test.issue-${n}`,
  message: `Problem number ${n}`,
  entityId: `GOBJ-${n}`,
});

describe('TrackProblems', () => {
  it('shows the counts, the fix button and only the first three issues', () => {
    const issues = [issue(1), issue(2), issue(3), issue(4), issue(5)];
    const markup = renderToStaticMarkup(<TrackProblems issues={issues} onFixAll={vi.fn()} onSelectEntity={vi.fn()} />);
    expect(markup).toContain('0 errors');
    expect(markup).toContain('5 warnings');
    expect(markup).toContain('Fix all repairable issues');
    expect(markup).toContain('Problem number 3');
    expect(markup).not.toContain('Problem number 4');
    expect(markup).toContain('Show all 5');
  });

  it('lists errors before warnings', () => {
    const markup = renderToStaticMarkup(<TrackProblems issues={[issue(1), issue(2), issue(3, 'error')]} onSelectEntity={vi.fn()} />);
    expect(markup.indexOf('Problem number 3')).toBeLessThan(markup.indexOf('Problem number 1'));
  });

  it('counts load warnings and offers no Show all when everything fits', () => {
    const markup = renderToStaticMarkup(<TrackProblems issues={[issue(1)]} loadWarnings={['Could not read a file']} />);
    expect(markup).toContain('2 warnings');
    expect(markup).toContain('Could not read a file');
    expect(markup).not.toContain('Show all');
  });

  it('says so when there is nothing to fix', () => {
    const markup = renderToStaticMarkup(<TrackProblems issues={[]} onFixAll={vi.fn()} />);
    expect(markup).toContain('ready to export');
    expect(markup).not.toContain('Fix all repairable issues');
  });
});
