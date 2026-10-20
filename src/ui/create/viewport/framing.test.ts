import { describe, expect, it } from 'vitest';
import { BLANK_HALF_EXTENT, TEMPLATE_VIEW, openingView } from './framing';

const bounds = { min: { x: -1, y: 0, z: -2 }, max: { x: 3, y: 4, z: 5 } };
const fallback = { min: { x: -9, y: 0, z: -9 }, max: { x: 9, y: 9, z: 9 } };

describe('openingView', () => {
  it('opens a blank design (no road) in the top view over a wide patch of ground', () => {
    const view = openingView({ roads: [] }, null, fallback);
    expect(view.kind).toBe('top');
    expect(view.min.x).toBe(-BLANK_HALF_EXTENT);
    expect(view.max.z).toBe(BLANK_HALF_EXTENT);
  });

  it('opens a template in perspective at a downward 3/4 angle with the track filling about 70% of the canvas (box fill 0.8)', () => {
    const view = openingView({ roads: [{} as never] }, bounds, fallback);
    expect(view.kind).toBe('perspective');
    if (view.kind !== 'perspective') return;
    expect(view.options.pitchDegrees).toBeGreaterThanOrEqual(35);
    expect(view.options.pitchDegrees).toBeLessThanOrEqual(40);
    expect(view.options.fill).toBeCloseTo(0.8, 5);
    expect(view.options.animate).toBe(false);
    expect(view.min).toEqual(bounds.min);
    expect(TEMPLATE_VIEW.fill).toBe(0.8);
  });

  it('falls back to the generated geometry bounds when the design has no extent', () => {
    const view = openingView({ roads: [{} as never] }, null, fallback);
    expect(view.min).toEqual(fallback.min);
  });
});
