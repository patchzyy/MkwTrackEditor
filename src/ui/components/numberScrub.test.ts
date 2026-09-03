import { describe, expect, it } from 'vitest';
import {
  applyKeyStep,
  clampNumber,
  decimalsForStep,
  formatNumberText,
  normalizeNumber,
  parseNumberText,
  roundToPrecision,
  scrubMultiplier,
  scrubValue,
  stepsForKey,
} from './numberScrub';

describe('scrubMultiplier', () => {
  it('is 1 with no modifiers, a tenth with Shift and ten with Ctrl', () => {
    expect(scrubMultiplier(undefined)).toBe(1);
    expect(scrubMultiplier({})).toBe(1);
    expect(scrubMultiplier({ fine: true })).toBe(0.1);
    expect(scrubMultiplier({ coarse: true })).toBe(10);
  });

  it('prefers fine when both modifiers are held', () => {
    expect(scrubMultiplier({ fine: true, coarse: true })).toBe(0.1);
  });
});

describe('decimalsForStep', () => {
  it('reads the decimals out of the step size', () => {
    expect(decimalsForStep(1)).toBe(0);
    expect(decimalsForStep(0.25)).toBe(2);
    expect(decimalsForStep(0.001)).toBe(3);
    expect(decimalsForStep(-0.5)).toBe(1);
  });

  it('is 0 for a degenerate step', () => {
    expect(decimalsForStep(0)).toBe(0);
    expect(decimalsForStep(Number.NaN)).toBe(0);
  });
});

describe('roundToPrecision', () => {
  it('removes binary float noise', () => {
    expect(roundToPrecision(0.1 + 0.2, 2)).toBe(0.3);
    expect(roundToPrecision(1.005, 2)).toBe(1.01);
  });

  it('rounds negatives away from zero at the halfway point', () => {
    expect(roundToPrecision(-1.005, 2)).toBe(-1.01);
  });

  it('maps a non-finite value to 0', () => {
    expect(roundToPrecision(Number.NaN, 2)).toBe(0);
    expect(roundToPrecision(Number.POSITIVE_INFINITY, 2)).toBe(0);
  });
});

describe('clampNumber', () => {
  it('leaves the value alone when no range is given', () => {
    expect(clampNumber(-9999, undefined)).toBe(-9999);
    expect(clampNumber(5, {})).toBe(5);
  });

  it('clamps to each end independently', () => {
    expect(clampNumber(-5, { min: 0 })).toBe(0);
    expect(clampNumber(500, { max: 100 })).toBe(100);
    expect(clampNumber(50, { min: 0, max: 100 })).toBe(50);
  });
});

describe('normalizeNumber', () => {
  it('rounds to the precision implied by the step', () => {
    expect(normalizeNumber(1.23456, 0.01, undefined)).toBe(1.23);
    expect(normalizeNumber(1.5, 1, undefined)).toBe(2);
  });

  it('honours an explicit precision and the integer flag', () => {
    expect(normalizeNumber(1.23456, 0.01, { precision: 4 })).toBe(1.2346);
    expect(normalizeNumber(1.6, 0.01, { integer: true })).toBe(2);
  });

  it('clamps after rounding', () => {
    expect(normalizeNumber(1.999, 0.01, { max: 1.5 })).toBe(1.5);
  });

  it('maps a non-finite value into range', () => {
    expect(normalizeNumber(Number.NaN, 1, { min: 3 })).toBe(3);
  });
});

describe('scrubValue', () => {
  it('increases to the right and decreases to the left', () => {
    expect(scrubValue({ startValue: 0, deltaPx: 40, step: 1 })).toBe(10);
    expect(scrubValue({ startValue: 0, deltaPx: -40, step: 1 })).toBe(-10);
    expect(scrubValue({ startValue: 5, deltaPx: 0, step: 1 })).toBe(5);
  });

  it('applies the modifier multiplier', () => {
    expect(scrubValue({ startValue: 0, deltaPx: 40, step: 1, modifiers: { fine: true } })).toBe(1);
    expect(scrubValue({ startValue: 0, deltaPx: 40, step: 1, modifiers: { coarse: true } })).toBe(100);
  });

  it('respects pixelsPerStep and falls back on a bad one', () => {
    expect(scrubValue({ startValue: 0, deltaPx: 40, step: 1, pixelsPerStep: 20 })).toBe(2);
    expect(scrubValue({ startValue: 0, deltaPx: 40, step: 1, pixelsPerStep: 0 })).toBe(10);
  });

  it('clamps the scrubbed value', () => {
    expect(scrubValue({ startValue: 0, deltaPx: 4000, step: 1, max: 12 })).toBe(12);
  });
});

describe('stepsForKey and applyKeyStep', () => {
  it('maps the arrow and page keys', () => {
    expect(stepsForKey('ArrowUp')).toBe(1);
    expect(stepsForKey('ArrowDown')).toBe(-1);
    expect(stepsForKey('PageUp')).toBe(10);
    expect(stepsForKey('PageDown')).toBe(-10);
    expect(stepsForKey('Enter')).toBeNull();
  });

  it('returns null for keys the field does not handle', () => {
    expect(applyKeyStep(1, 'Enter', 1, undefined)).toBeNull();
  });

  it('steps by one step, or ten for Page keys', () => {
    expect(applyKeyStep(1, 'ArrowUp', 0.5, undefined)).toBe(1.5);
    expect(applyKeyStep(1, 'PageDown', 1, undefined)).toBe(-9);
  });

  it('combines modifiers with the step and clamps', () => {
    expect(applyKeyStep(1, 'ArrowUp', 1, { fine: true })).toBe(1.1);
    expect(applyKeyStep(1, 'ArrowUp', 1, { coarse: true }, { max: 5 })).toBe(5);
  });
});

describe('parseNumberText', () => {
  it('accepts a comma decimal separator', () => {
    expect(parseNumberText('1,5')).toBe(1.5);
    expect(parseNumberText(' -2.25 ')).toBe(-2.25);
  });

  it('returns null for drafts the user is still typing', () => {
    expect(parseNumberText('')).toBeNull();
    expect(parseNumberText('-')).toBeNull();
    expect(parseNumberText('.')).toBeNull();
    expect(parseNumberText('-.')).toBeNull();
  });

  it('returns null for text that is not a number', () => {
    expect(parseNumberText('abc')).toBeNull();
    expect(parseNumberText('1 2')).toBeNull();
  });
});

describe('formatNumberText', () => {
  it('trims trailing zeros', () => {
    expect(formatNumberText(1.5, 0.001)).toBe('1.5');
    expect(formatNumberText(2, 0.01)).toBe('2');
  });

  it('shows whole numbers for integer fields', () => {
    expect(formatNumberText(2.6, 1)).toBe('3');
    expect(formatNumberText(2.6, 0.1, { integer: true })).toBe('3');
  });

  it('is safe with a non-finite value', () => {
    expect(formatNumberText(Number.NaN, 1)).toBe('0');
  });
});
