import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'App.tsx');
const appSource = readFileSync(appPath, 'utf8');

describe('object profile variant coverage audit', () => {
  it('covers every variant-switcher family with a specific inspector profile and concrete object ids', () => {
    const variantSection = sliceBetween(appSource, 'function getObjectVariantOptions', 'function setMaskedBits');
    const profileSection = sliceBetween(appSource, 'function getObjectInspectorProfile', 'function fallbackObjectName');
    const inspectorSection = sliceBetween(appSource, '{entity.objectId !== undefined && objectProfile && (', '{(entity.objectId !== undefined || entity.objectSettings || entity.presenceFlags !== undefined) && (');
    const guidanceSection = sliceBetween(appSource, 'const guidanceOnlyObjectProfileNotes', 'const enemyRouteSetting1Options');

    const variantCases = [...variantSection.matchAll(/case '([^']+)':\s*variantIds = \[([^\]]+)\];/g)].map((match) => ({
      title: match[1],
      ids: match[2].split(',').map((value) => value.trim()).filter(Boolean),
    }));

    const guidanceTitles = new Set(collectMatches(guidanceSection, /(?:'([^']+)'|([A-Za-z][A-Za-z0-9 ]*))\s*:/g, 1, 2));
    const explicitControlTitles = new Set(collectMatches(inspectorSection, /objectProfile\.title === '([^']+)'/g));

    for (const variantCase of variantCases) {
      expect(variantCase.ids.length, `${variantCase.title} should expose at least one concrete variant id`).toBeGreaterThan(0);
      expect(profileSection).toContain(`title: '${variantCase.title}'`);
      expect(
        explicitControlTitles.has(variantCase.title) || guidanceTitles.has(variantCase.title),
        `${variantCase.title} should have explicit controls or an explicit guidance note`,
      ).toBe(true);
    }
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
