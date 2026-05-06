import { describe, expect, it } from 'vitest';

import type { KmpEntity } from '../lib/kmp';
import { buildFillBetweenPositions, getFillBetweenSelection } from './fillBetween';

function makeObject(id: string, objectId: number, position: KmpEntity['position']): KmpEntity {
  return {
    id,
    section: 'GOBJ',
    index: Number(id.split('-').at(-1) ?? 0),
    rawOffset: 0,
    recordSize: 0,
    position,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    objectId,
  };
}

describe('fill-between helpers', () => {
  it('accepts exactly two matching objects', () => {
    const result = getFillBetweenSelection([
      makeObject('GOBJ-4', 0x65, { x: 0, y: 0, z: 0 }),
      makeObject('GOBJ-7', 0x65, { x: 90, y: 30, z: -30 }),
    ]);
    expect(result?.objectId).toBe(0x65);
    expect(result?.endpoints.map((entity) => entity.id)).toEqual(['GOBJ-4', 'GOBJ-7']);
  });

  it('rejects mismatched or non-object selections', () => {
    expect(
      getFillBetweenSelection([
        makeObject('GOBJ-1', 0x65, { x: 0, y: 0, z: 0 }),
        makeObject('GOBJ-2', 0x191, { x: 50, y: 0, z: 0 }),
      ]),
    ).toBeNull();
    expect(
      getFillBetweenSelection([
        makeObject('GOBJ-1', 0x65, { x: 0, y: 0, z: 0 }),
        {
          id: 'ENPT-0',
          section: 'ENPT',
          index: 0,
          rawOffset: 0,
          recordSize: 0,
          position: { x: 10, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        } as KmpEntity,
      ]),
    ).toBeNull();
  });

  it('builds evenly spaced positions between endpoints', () => {
    expect(buildFillBetweenPositions({ x: 0, y: 0, z: 0 }, { x: 100, y: 50, z: -20 }, 3)).toEqual([
      { x: 25, y: 12.5, z: -5 },
      { x: 50, y: 25, z: -10 },
      { x: 75, y: 37.5, z: -15 },
    ]);
    expect(buildFillBetweenPositions({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 }, 0)).toEqual([]);
  });
});
