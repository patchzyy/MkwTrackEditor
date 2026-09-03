import { describe, expect, it } from 'vitest';
import { NEUTRAL_PLAYTEST_INPUT } from '../../lib/playtest/types';
import {
  PLAYTEST_EXIT_CODE,
  PLAYTEST_RESTART_CODE,
  applyDeadZone,
  isPlaytestKeyCode,
  mergePlaytestInputs,
  playtestInputFromGamepad,
  playtestInputFromKeys,
  type PlaytestGamepadLike,
} from './playtestInput';

const keys = (...codes: string[]) => playtestInputFromKeys(new Set(codes));

function pad(overrides: { axes?: number[]; pressed?: number[] } = {}): PlaytestGamepadLike {
  const pressedSet = new Set(overrides.pressed ?? []);
  return {
    axes: overrides.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressedSet.has(index), value: pressedSet.has(index) ? 1 : 0 })),
    connected: true,
  };
}

describe('playtestInputFromKeys', () => {
  it('is neutral with nothing held', () => {
    expect(keys()).toEqual(NEUTRAL_PLAYTEST_INPUT);
  });

  it('maps both accelerate keys and the brake keys', () => {
    expect(keys('Space').accelerate).toBe(true);
    expect(keys('KeyX').accelerate).toBe(true);
    expect(keys('KeyZ').brake).toBe(true);
    expect(keys('KeyZ').accelerate).toBe(false);
    // Down doubles as brake so a stand-still mini-turbo is Space + Down.
    expect(keys('ArrowDown').brake).toBe(true);
    expect(keys('KeyS').brake).toBe(true);
    expect(keys('ArrowUp').brake).toBe(false);
  });

  it('holds accelerate and brake together for a stand-still mini-turbo', () => {
    const input = keys('Space', 'KeyZ');
    expect(input.accelerate).toBe(true);
    expect(input.brake).toBe(true);
  });

  it('steers with the arrows and with A/D, and cancels when both are held', () => {
    expect(keys('ArrowRight').stickX).toBe(1);
    expect(keys('KeyD').stickX).toBe(1);
    expect(keys('ArrowLeft').stickX).toBe(-1);
    expect(keys('KeyA').stickX).toBe(-1);
    expect(keys('KeyA', 'KeyD').stickX).toBe(0);
  });

  it('reports the stick up axis as positive', () => {
    expect(keys('ArrowUp').stickY).toBe(1);
    expect(keys('KeyW').stickY).toBe(1);
    expect(keys('ArrowDown').stickY).toBe(-1);
    expect(keys('KeyS').stickY).toBe(-1);
    expect(keys('KeyW', 'KeyS').stickY).toBe(0);
  });

  it('maps drift to either shift, item to C and tricks to E/Q', () => {
    expect(keys('ShiftLeft').drift).toBe(true);
    expect(keys('ShiftRight').drift).toBe(true);
    expect(keys('KeyC').item).toBe(true);
    expect(keys('KeyE').trick).toBe('up');
    expect(keys('KeyQ').trick).toBe('down');
    expect(keys('KeyE', 'KeyQ').trick).toBe('up');
  });

  it('keeps the stick inside -1..1 even with every steering key held', () => {
    const input = keys('ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD', 'ArrowUp', 'KeyW');
    expect(input.stickX).toBe(0);
    expect(input.stickY).toBe(1);
  });

  it('claims every key it consumes, including exit and restart', () => {
    for (const code of ['Space', 'KeyX', 'KeyZ', 'KeyA', 'KeyD', 'ArrowUp', 'ShiftLeft', 'KeyC', 'KeyE', 'KeyQ', PLAYTEST_EXIT_CODE, PLAYTEST_RESTART_CODE]) {
      expect(isPlaytestKeyCode(code)).toBe(true);
    }
    expect(isPlaytestKeyCode('KeyB')).toBe(false);
    expect(isPlaytestKeyCode('Tab')).toBe(false);
  });
});

describe('applyDeadZone', () => {
  it('zeroes small deflections and rescales the rest to reach full lock', () => {
    expect(applyDeadZone(0.1, 0.2)).toBe(0);
    expect(applyDeadZone(-0.2, 0.2)).toBe(0);
    expect(applyDeadZone(1, 0.2)).toBeCloseTo(1, 6);
    expect(applyDeadZone(-1, 0.2)).toBeCloseTo(-1, 6);
    expect(applyDeadZone(0.6, 0.2)).toBeCloseTo(0.5, 6);
  });

  it('never leaves the -1..1 range, whatever the pad reports', () => {
    expect(applyDeadZone(4, 0.2)).toBe(1);
    expect(applyDeadZone(Number.NaN, 0.2)).toBe(0);
  });
});

describe('playtestInputFromGamepad', () => {
  it('returns null without a connected pad', () => {
    expect(playtestInputFromGamepad(null)).toBeNull();
    expect(playtestInputFromGamepad({ ...pad(), connected: false })).toBeNull();
  });

  it('maps the standard buttons', () => {
    expect(playtestInputFromGamepad(pad({ pressed: [0] }))?.accelerate).toBe(true);
    expect(playtestInputFromGamepad(pad({ pressed: [1] }))?.brake).toBe(true);
    expect(playtestInputFromGamepad(pad({ pressed: [4] }))?.item).toBe(true);
    expect(playtestInputFromGamepad(pad({ pressed: [5] }))?.drift).toBe(true);
    expect(playtestInputFromGamepad(pad({ pressed: [7] }))?.drift).toBe(true);
    expect(playtestInputFromGamepad(pad({ pressed: [12] }))?.trick).toBe('up');
    expect(playtestInputFromGamepad(pad({ pressed: [13] }))?.trick).toBe('down');
  });

  it('reads the left stick and flips the browser Y axis so up is positive', () => {
    const input = playtestInputFromGamepad(pad({ axes: [1, -1, 0, 0] }));
    expect(input?.stickX).toBeCloseTo(1, 6);
    expect(input?.stickY).toBeCloseTo(1, 6);
  });
});

describe('mergePlaytestInputs', () => {
  it('lets either device press a button', () => {
    const merged = mergePlaytestInputs(keys('Space'), playtestInputFromGamepad(pad({ pressed: [1, 5] })));
    expect(merged.accelerate).toBe(true);
    expect(merged.brake).toBe(true);
    expect(merged.drift).toBe(true);
  });

  it('keeps the stick that is deflected furthest', () => {
    const merged = mergePlaytestInputs(keys(), playtestInputFromGamepad(pad({ axes: [-1, 0, 0, 0] })));
    expect(merged.stickX).toBeCloseTo(-1, 6);
    const keyboardWins = mergePlaytestInputs(keys('ArrowRight'), playtestInputFromGamepad(pad({ axes: [0.3, 0, 0, 0] })));
    expect(keyboardWins.stickX).toBe(1);
  });

  it('passes the keyboard through unchanged when there is no pad', () => {
    expect(mergePlaytestInputs(keys('KeyX'), null)).toEqual(keys('KeyX'));
  });

  it('prefers whichever device is flicking a trick', () => {
    expect(mergePlaytestInputs(keys(), playtestInputFromGamepad(pad({ pressed: [12] }))).trick).toBe('up');
    expect(mergePlaytestInputs(keys('KeyQ'), playtestInputFromGamepad(pad())).trick).toBe('down');
  });
});
