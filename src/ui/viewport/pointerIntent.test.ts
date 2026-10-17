import { describe, expect, it } from 'vitest';
import {
  CLICK_SLOP_PX,
  MAX_CAMERA_LOOK_DELTA_PX,
  beginGesture,
  cameraLookDelta,
  cameraModeForButton,
  cursorForGesture,
  isAdditiveSelection,
  isCollisionSnap,
  movedBeyondSlop,
  readModifiers,
  shouldCommitOnEnd,
  shouldSelectOnRelease,
  toViewportMouseButton,
  usesPointerLock,
  type GestureEndReason,
  type ViewportGesture,
} from './pointerIntent';

const noModifiers = { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false };

function gesture(overrides: Partial<ViewportGesture> = {}): ViewportGesture {
  return {
    ...beginGesture({
      kind: 'select',
      pointerId: 1,
      button: 'left',
      clientX: 100,
      clientY: 100,
      modifiers: noModifiers,
    }),
    ...overrides,
  };
}

describe('button mapping', () => {
  it('names the three buttons the viewport cares about', () => {
    expect(toViewportMouseButton(0)).toBe('left');
    expect(toViewportMouseButton(1)).toBe('middle');
    expect(toViewportMouseButton(2)).toBe('right');
    expect(toViewportMouseButton(4)).toBe('other');
  });

  it('reads the modifiers a gesture has to remember until release', () => {
    expect(readModifiers({ altKey: true, shiftKey: false, ctrlKey: true, metaKey: false })).toEqual({
      altKey: true,
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
    });
  });

  it('treats shift, ctrl and meta as additive and ctrl/meta as collision snap', () => {
    expect(isAdditiveSelection({ shiftKey: true, ctrlKey: false, metaKey: false })).toBe(true);
    expect(isAdditiveSelection({ shiftKey: false, ctrlKey: true, metaKey: false })).toBe(true);
    expect(isAdditiveSelection({ shiftKey: false, ctrlKey: false, metaKey: false })).toBe(false);
    expect(isCollisionSnap({ ctrlKey: false, metaKey: true })).toBe(true);
    expect(isCollisionSnap({ ctrlKey: false, metaKey: false })).toBe(false);
  });
});

describe('click slop', () => {
  it('keeps a press inside the slop a click', () => {
    const g = gesture();
    expect(movedBeyondSlop(g, 100 + CLICK_SLOP_PX - 1, 100)).toBe(false);
    expect(movedBeyondSlop(g, 102, 102)).toBe(false);
  });

  it('stops being a click once it travels', () => {
    const g = gesture();
    expect(movedBeyondSlop(g, 100 + CLICK_SLOP_PX, 100)).toBe(true);
    expect(movedBeyondSlop(g, 100, 140)).toBe(true);
  });

  it('only selects on a real left release that never moved', () => {
    expect(shouldSelectOnRelease(gesture(), 'pointerup')).toBe(true);
    expect(shouldSelectOnRelease(gesture({ moved: true }), 'pointerup')).toBe(false);
    expect(shouldSelectOnRelease(gesture({ kind: 'drag' }), 'pointerup')).toBe(false);
    expect(shouldSelectOnRelease(gesture({ button: 'right', kind: 'camera' }), 'pointerup')).toBe(false);
    for (const reason of ['pointercancel', 'lostcapture', 'blur', 'escape', 'teardown'] as GestureEndReason[]) {
      expect(shouldSelectOnRelease(gesture(), reason)).toBe(false);
    }
  });
});

describe('ending a gesture', () => {
  it('keeps the edit for every interruption except Escape', () => {
    expect(shouldCommitOnEnd('pointerup')).toBe(true);
    expect(shouldCommitOnEnd('pointercancel')).toBe(true);
    expect(shouldCommitOnEnd('lostcapture')).toBe(true);
    expect(shouldCommitOnEnd('blur')).toBe(true);
    expect(shouldCommitOnEnd('teardown')).toBe(true);
    expect(shouldCommitOnEnd('escape')).toBe(false);
  });
});

describe('camera gestures', () => {
  const perspective = { orthographic: false, mouseLookAllowed: true };
  const ortho = { orthographic: true, mouseLookAllowed: true };

  it('turns in place with a perspective camera and orbits an orthographic one', () => {
    expect(cameraModeForButton('right', perspective)).toBe('look');
    expect(cameraModeForButton('left', perspective)).toBe('look');
    expect(cameraModeForButton('middle', perspective)).toBe('look');
    expect(cameraModeForButton('right', ortho)).toBe('orbit');
    expect(cameraModeForButton('middle', ortho)).toBe('pan');
  });

  it('refuses to move the camera while something else owns it', () => {
    expect(cameraModeForButton('right', { orthographic: false, mouseLookAllowed: false })).toBeNull();
    expect(cameraModeForButton('left', { orthographic: true, mouseLookAllowed: false })).toBeNull();
    expect(cameraModeForButton('other', perspective)).toBeNull();
  });

  it.each(['blender27', 'blender'] as const)('%s reserves the middle button for navigation', (preset) => {
    for (const orthographic of [true, false]) {
      const options = { preset, orthographic, mouseLookAllowed: true, modifiers: noModifiers };
      expect(cameraModeForButton('middle', options)).toBe('orbit');
      expect(cameraModeForButton('left', options)).toBeNull();
      expect(cameraModeForButton('right', options)).toBeNull();
      expect(cameraModeForButton('middle', { ...options, modifiers: { ...noModifiers, shiftKey: true } })).toBe('pan');
      expect(cameraModeForButton('middle', { ...options, modifiers: { ...noModifiers, ctrlKey: true } })).toBe('zoom');
      expect(cameraModeForButton('middle', { ...options, mouseLookAllowed: false })).toBeNull();
    }
  });

  it('accepts right-click selection only when the legacy selection button is requested', () => {
    const rightClick = gesture({ button: 'right' });
    expect(shouldSelectOnRelease(rightClick, 'pointerup')).toBe(false);
    expect(shouldSelectOnRelease(rightClick, 'pointerup', 'right')).toBe(true);
    expect(shouldSelectOnRelease({ ...rightClick, moved: true }, 'pointerup', 'right')).toBe(false);
    expect(shouldSelectOnRelease(rightClick, 'escape', 'right')).toBe(false);
  });

  it('locks the pointer only for the right-button first-person look', () => {
    expect(usesPointerLock(gesture({ kind: 'camera', button: 'right', camera: 'look' }))).toBe(true);
    // A left-drag look uses capture and a cursor change, so it can never eat the user's mouse.
    expect(usesPointerLock(gesture({ kind: 'select', button: 'left', camera: 'look' }))).toBe(false);
    expect(usesPointerLock(gesture({ kind: 'camera', button: 'right', camera: 'orbit' }))).toBe(false);
    expect(usesPointerLock(gesture({ kind: 'camera', button: 'middle', camera: 'look' }))).toBe(false);
    expect(usesPointerLock(gesture({ kind: 'drag', button: 'left' }))).toBe(false);
  });

  it('drops junk deltas instead of throwing the camera across the track', () => {
    expect(cameraLookDelta(8, -3)).toEqual({ dx: 8, dy: -3 });
    expect(cameraLookDelta(8, -3, { skip: true })).toBeNull();
    expect(cameraLookDelta(MAX_CAMERA_LOOK_DELTA_PX + 1, 0)).toBeNull();
    expect(cameraLookDelta(0, -(MAX_CAMERA_LOOK_DELTA_PX + 1))).toBeNull();
    expect(cameraLookDelta(Number.NaN, 0)).toBeNull();
    expect(cameraLookDelta(0, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('cursor', () => {
  it('shows the gesture in progress', () => {
    expect(cursorForGesture(null)).toBe('default');
    expect(cursorForGesture(gesture())).toBe('default');
    expect(cursorForGesture(gesture({ kind: 'drag' }))).toBe('drag');
    expect(cursorForGesture(gesture({ camera: 'look' }))).toBe('look');
    expect(cursorForGesture(gesture({ kind: 'camera', button: 'right', camera: 'orbit' }))).toBe('look');
  });
});
