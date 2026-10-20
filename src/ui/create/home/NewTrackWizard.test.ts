import { describe, expect, it } from 'vitest';
import { nextRadioIndex } from './NewTrackWizard';

describe('nextRadioIndex', () => {
  it('moves along a row and wraps', () => {
    expect(nextRadioIndex('ArrowRight', 0, 6)).toBe(1);
    expect(nextRadioIndex('ArrowRight', 5, 6)).toBe(0);
    expect(nextRadioIndex('ArrowLeft', 0, 6)).toBe(5);
  });

  it('moves between rows of a grid without wrapping off the ends', () => {
    expect(nextRadioIndex('ArrowDown', 1, 11, 4)).toBe(5);
    expect(nextRadioIndex('ArrowDown', 9, 11, 4)).toBe(10);
    expect(nextRadioIndex('ArrowUp', 5, 11, 4)).toBe(1);
    expect(nextRadioIndex('ArrowUp', 2, 11, 4)).toBe(0);
  });

  it('jumps to the ends and ignores other keys', () => {
    expect(nextRadioIndex('Home', 4, 11)).toBe(0);
    expect(nextRadioIndex('End', 4, 11)).toBe(10);
    expect(nextRadioIndex('a', 4, 11)).toBeNull();
    expect(nextRadioIndex('ArrowRight', 0, 0)).toBeNull();
  });
});
