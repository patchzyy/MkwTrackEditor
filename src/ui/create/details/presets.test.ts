import { describe, expect, it } from 'vitest';
import { CHECKPOINT_PRESETS, DRIVER_ROUTE_PRESETS, ITEM_ROUTE_PRESETS, SPEED_PRESETS, matchPreset } from './presets';
import { DEFAULT_GENERATION } from '../../../lib/create/ops/migrate';

describe('speed presets', () => {
  it('map Normal / Fast / Faster to 1.0 / 1.1 / 1.2', () => {
    expect(SPEED_PRESETS.map((p) => [p.label, p.value])).toEqual([['Normal', 1], ['Fast', 1.1], ['Faster', 1.2]]);
  });

  it('recognise a value that is a preset and flag any other as custom', () => {
    expect(matchPreset(SPEED_PRESETS, 1)?.label).toBe('Normal');
    expect(matchPreset(SPEED_PRESETS, 1.1)?.label).toBe('Fast');
    expect(matchPreset(SPEED_PRESETS, 1.1000001)?.label).toBe('Fast');
    expect(matchPreset(SPEED_PRESETS, 1.15)).toBeNull();
    expect(matchPreset(SPEED_PRESETS, 0.75)).toBeNull();
  });
});

describe('generated-spacing presets', () => {
  it('have the design defaults as their Normal choice, so a fresh design shows "Normal"', () => {
    expect(matchPreset(CHECKPOINT_PRESETS, DEFAULT_GENERATION.checkpointSpacing)?.label).toBe('Normal');
    expect(matchPreset(DRIVER_ROUTE_PRESETS, DEFAULT_GENERATION.enemySpacing)?.label).toBe('Normal');
    expect(matchPreset(ITEM_ROUTE_PRESETS, DEFAULT_GENERATION.itemSpacing)?.label).toBe('Normal');
  });
});
