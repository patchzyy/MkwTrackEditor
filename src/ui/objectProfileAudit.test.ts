import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'App.tsx');
const appSource = readFileSync(appPath, 'utf8');

describe('object profile audit', () => {
  it('gives every named object profile either explicit controls or an explicit guidance-only note', () => {
    const profileSource = sliceBetween(appSource, 'function getObjectInspectorProfile', 'function presentValidationIssue');
    const inspectorSource = sliceBetween(appSource, '{entity.objectId !== undefined && objectProfile && (', '{(entity.objectId !== undefined || entity.objectSettings || entity.presenceFlags !== undefined) && (');
    const guidanceSource = sliceBetween(appSource, 'const guidanceOnlyObjectProfileNotes', 'const enemyRouteSetting1Options');

    const profileTitles = collectMatches(profileSource, /title: '([^']+)'/g);
    const explicitControlTitles = collectMatches(inspectorSource, /objectProfile\.title === '([^']+)'/g);
    const guidanceOnlyTitles = collectMatches(guidanceSource, /(?:'([^']+)'|([A-Za-z][A-Za-z0-9 ]*))\s*:/g, 1, 2);

    const covered = new Set([...explicitControlTitles, ...guidanceOnlyTitles]);
    const missing = [...profileTitles].filter((title) => !covered.has(title)).sort();

    expect(inspectorSource).toContain('Object Setup');
    expect(appSource).toContain('Advanced object data');
    expect(inspectorSource).toContain('Setup Surface');
    expect(missing).toEqual([]);
  });
});

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not slice source between "${startMarker}" and "${endMarker}"`);
  }
  return source.slice(start, end);
}

function collectMatches(source: string, pattern: RegExp, ...candidateGroups: number[]): string[] {
  const out = new Set<string>();
  for (const match of source.matchAll(pattern)) {
    const value = candidateGroups.length > 0 ? candidateGroups.map((index) => match[index]).find(Boolean) : match[1];
    if (value) out.add(value);
  }
  return [...out];
}
