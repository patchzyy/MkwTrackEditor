/**
 * Playtest controls: pure mappings from "what is pressed" to a {@link PlaytestInput}.
 *
 * Nothing here touches the DOM or React; `usePlaytestSession` owns the listeners and calls
 * these. Keyboard and gamepad are merged, so either device can press any button.
 *
 * Keys are matched on `KeyboardEvent.code`, not `key`, so the layout stays physical (WASD is
 * WASD on an AZERTY keyboard too) and modifiers do not change what a key means.
 */

import { NEUTRAL_PLAYTEST_INPUT, type PlaytestInput, type PlaytestTrick } from '../../lib/playtest/types';

/** `KeyboardEvent.code` for exiting a session. */
export const PLAYTEST_EXIT_CODE = 'Escape';
/** `KeyboardEvent.code` for restarting from the start line. */
export const PLAYTEST_RESTART_CODE = 'KeyR';

const STEER_LEFT_CODES = ['ArrowLeft', 'KeyA'];
const STEER_RIGHT_CODES = ['ArrowRight', 'KeyD'];
const STICK_UP_CODES = ['ArrowUp', 'KeyW'];
const STICK_DOWN_CODES = ['ArrowDown', 'KeyS'];
const ACCELERATE_CODES = ['Space', 'KeyX'];
// Down doubles as brake: on a keyboard "down = brake / reverse" is what everyone reaches for,
// and it makes the stand-still mini-turbo (accelerate + brake at a standstill) discoverable.
const BRAKE_CODES = ['KeyZ', 'ArrowDown', 'KeyS'];
const DRIFT_CODES = ['ShiftLeft', 'ShiftRight'];
const ITEM_CODES = ['KeyC'];
const TRICK_UP_CODES = ['KeyE'];
const TRICK_DOWN_CODES = ['KeyQ'];

/** One row of the controls summary shown in the start popover and in `docs/PLAYTEST.md`. */
export interface PlaytestControlHint {
  action: string;
  keys: string;
}

export const PLAYTEST_CONTROL_HINTS: ReadonlyArray<PlaytestControlHint> = [
  { action: 'Accelerate', keys: 'Space / X' },
  { action: 'Brake / reverse', keys: 'Z  or  ↓ / S' },
  { action: 'Steer', keys: '← →  or  A D' },
  { action: 'Hop / drift', keys: 'Shift' },
  { action: 'Stand-still mini-turbo', keys: 'Hold accelerate + brake, release brake' },
  { action: 'Trick', keys: 'E / Q' },
  { action: 'Item', keys: 'C' },
  { action: 'Restart', keys: 'R' },
  { action: 'Exit', keys: 'Esc' },
];

/** Every code the session consumes, so the listener can swallow it before the editor sees it. */
export const PLAYTEST_KEY_CODES: ReadonlySet<string> = new Set([
  ...STEER_LEFT_CODES,
  ...STEER_RIGHT_CODES,
  ...STICK_UP_CODES,
  ...STICK_DOWN_CODES,
  ...ACCELERATE_CODES,
  ...BRAKE_CODES,
  ...DRIFT_CODES,
  ...ITEM_CODES,
  ...TRICK_UP_CODES,
  ...TRICK_DOWN_CODES,
  PLAYTEST_EXIT_CODE,
  PLAYTEST_RESTART_CODE,
]);

export function isPlaytestKeyCode(code: string): boolean {
  return PLAYTEST_KEY_CODES.has(code);
}

function anyPressed(pressed: ReadonlySet<string>, codes: readonly string[]): boolean {
  for (const code of codes) if (pressed.has(code)) return true;
  return false;
}

export function neutralPlaytestInput(): PlaytestInput {
  return { ...NEUTRAL_PLAYTEST_INPUT };
}

/** Controller state for a set of held `KeyboardEvent.code`s. */
export function playtestInputFromKeys(pressed: ReadonlySet<string>): PlaytestInput {
  const left = anyPressed(pressed, STEER_LEFT_CODES);
  const right = anyPressed(pressed, STEER_RIGHT_CODES);
  const up = anyPressed(pressed, STICK_UP_CODES);
  const down = anyPressed(pressed, STICK_DOWN_CODES);
  const trickUp = anyPressed(pressed, TRICK_UP_CODES);
  const trickDown = anyPressed(pressed, TRICK_DOWN_CODES);
  return {
    accelerate: anyPressed(pressed, ACCELERATE_CODES),
    brake: anyPressed(pressed, BRAKE_CODES),
    item: anyPressed(pressed, ITEM_CODES),
    drift: anyPressed(pressed, DRIFT_CODES),
    stickX: (right ? 1 : 0) - (left ? 1 : 0),
    stickY: (up ? 1 : 0) - (down ? 1 : 0),
    trick: trickUp ? 'up' : trickDown ? 'down' : 'none',
  };
}

/** The parts of a `Gamepad` this module reads. Keeps the mapping testable without a browser. */
export interface PlaytestGamepadLike {
  axes: ArrayLike<number>;
  buttons: ArrayLike<{ pressed: boolean; value?: number }>;
  connected?: boolean;
}

/** Standard-mapping button indices. */
const GAMEPAD_ACCELERATE = 0;
const GAMEPAD_BRAKE = 1;
const GAMEPAD_ITEM = 4;
const GAMEPAD_DRIFT_BUMPER = 5;
const GAMEPAD_DRIFT_TRIGGER = 7;
const GAMEPAD_DPAD_UP = 12;
const GAMEPAD_DPAD_DOWN = 13;

export const PLAYTEST_GAMEPAD_DEAD_ZONE = 0.2;

function buttonPressed(gamepad: PlaytestGamepadLike, index: number): boolean {
  const button = gamepad.buttons[index];
  if (!button) return false;
  return button.pressed || (button.value ?? 0) > 0.5;
}

/**
 * Applies a radial-style dead zone to one axis and rescales what is left back to 0..1, so the
 * stick still reaches full lock at the edge instead of topping out at `1 - deadZone`.
 */
export function applyDeadZone(value: number, deadZone: number = PLAYTEST_GAMEPAD_DEAD_ZONE): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  if (magnitude <= deadZone) return 0;
  const scaled = (magnitude - deadZone) / (1 - deadZone);
  return Math.sign(value) * Math.min(1, scaled);
}

/** Controller state for one gamepad. Left stick steers; up on the stick is positive `stickY`. */
export function playtestInputFromGamepad(
  gamepad: PlaytestGamepadLike | null | undefined,
  deadZone: number = PLAYTEST_GAMEPAD_DEAD_ZONE,
): PlaytestInput | null {
  if (!gamepad || gamepad.connected === false) return null;
  const trickUp = buttonPressed(gamepad, GAMEPAD_DPAD_UP);
  const trickDown = buttonPressed(gamepad, GAMEPAD_DPAD_DOWN);
  return {
    accelerate: buttonPressed(gamepad, GAMEPAD_ACCELERATE),
    brake: buttonPressed(gamepad, GAMEPAD_BRAKE),
    item: buttonPressed(gamepad, GAMEPAD_ITEM),
    drift: buttonPressed(gamepad, GAMEPAD_DRIFT_BUMPER) || buttonPressed(gamepad, GAMEPAD_DRIFT_TRIGGER),
    stickX: applyDeadZone(gamepad.axes[0] ?? 0, deadZone),
    // Browsers report the Y axis positive-down; the contract wants up positive.
    stickY: applyDeadZone(-(gamepad.axes[1] ?? 0), deadZone),
    trick: trickUp ? 'up' : trickDown ? 'down' : 'none',
  };
}

function mergeTrick(a: PlaytestTrick, b: PlaytestTrick): PlaytestTrick {
  return a !== 'none' ? a : b;
}

function mergeAxis(a: number, b: number): number {
  return Math.abs(b) > Math.abs(a) ? b : a;
}

/** Either device can press any button; the stick deflected furthest wins. */
export function mergePlaytestInputs(a: PlaytestInput, b: PlaytestInput | null): PlaytestInput {
  if (!b) return a;
  return {
    accelerate: a.accelerate || b.accelerate,
    brake: a.brake || b.brake,
    item: a.item || b.item,
    drift: a.drift || b.drift,
    stickX: mergeAxis(a.stickX, b.stickX),
    stickY: mergeAxis(a.stickY, b.stickY),
    trick: mergeTrick(a.trick, b.trick),
  };
}

/** The first connected gamepad's state, or `null` when there is no gamepad support/pad. */
export function readConnectedGamepadInput(deadZone: number = PLAYTEST_GAMEPAD_DEAD_ZONE): PlaytestInput | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  let pads: ReturnType<typeof navigator.getGamepads>;
  try {
    pads = navigator.getGamepads();
  } catch {
    return null;
  }
  for (const pad of pads) {
    if (!pad || !pad.connected) continue;
    const input = playtestInputFromGamepad(pad, deadZone);
    if (input) return input;
  }
  return null;
}
