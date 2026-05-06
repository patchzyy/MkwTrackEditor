import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'App.tsx');
const appSource = readFileSync(appPath, 'utf8');

describe('object profile featured coverage audit', () => {
  it('covers every highlighted common object with a specific inspector profile instead of the generic fallback', () => {
    const featuredIds = extractNumericArray(appSource, 'const featuredObjectIds = [', '] as const;');
    expect(featuredIds).toEqual([0x65, 0x191, 0x192, 0x194, 0x148, 0xe5, 0xce, 0x197, 0x1a5, 0x162, 0x261]);

    const variantSection = sliceBetween(appSource, 'function getObjectVariantOptions', 'function setMaskedBits');
    const variantIds = [...variantSection.matchAll(/variantIds = \[([^\]]+)\];/g)]
      .flatMap((match) => match[1].split(','))
      .map((value) => value.trim())
      .filter(Boolean)
      .map(parseNumericLiteral);
    const variantSet = new Set(variantIds);

    const singletonProfileChecks = [
      { id: 0x191, title: 'Goomba' },
      { id: 0x148, title: 'Moving Platform' },
      { id: 0xe5, title: 'Crab' },
      { id: 0x197, title: 'Cataquack' },
      { id: 0x261, title: 'Cannon Object' },
    ];

    for (const id of featuredIds) {
      if (variantSet.has(id)) continue;
      const singleton = singletonProfileChecks.find((entry) => entry.id === id);
      expect(singleton, `featured object 0x${id.toString(16)} should be covered by a specific profile`).toBeTruthy();
      expect(appSource).toContain(`title: '${singleton!.title}'`);
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

function extractNumericArray(source: string, startMarker: string, endMarker: string): number[] {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not extract numeric array between "${startMarker}" and "${endMarker}"`);
  }
  return source
    .slice(start + startMarker.length, end)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(parseNumericLiteral);
}

function parseNumericLiteral(value: string): number {
  return Number(value);
}
