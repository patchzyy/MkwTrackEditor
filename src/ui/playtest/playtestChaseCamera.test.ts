import { describe, expect, it } from 'vitest';
import { quatFromKmpRotation } from '../../lib/playtest/mockRuntime';
import type { PlaytestQuat } from '../../lib/playtest/types';
import {
  DEFAULT_CHASE_CAMERA_PARAMS,
  chaseCameraGoal,
  createChaseCameraState,
  kartForward,
  rotateByQuat,
  smoothingForFrames,
  stepChaseCamera,
  type ChaseCameraKart,
} from './playtestChaseCamera';

const IDENTITY: PlaytestQuat = { x: 0, y: 0, z: 0, w: 1 };

function kartAt(position: { x: number; y: number; z: number }, yawDegrees = 0, speed = 0): ChaseCameraKart {
  return { position, mainRotation: quatFromKmpRotation({ x: 0, y: yawDegrees, z: 0 }), speed };
}

describe('rotateByQuat', () => {
  it('leaves a vector alone under the identity rotation', () => {
    expect(rotateByQuat(IDENTITY, { x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('turns the forward axis to +X at 90 degrees of yaw', () => {
    const forward = kartForward(quatFromKmpRotation({ x: 0, y: 90, z: 0 }));
    expect(forward.x).toBeCloseTo(1, 6);
    expect(forward.y).toBeCloseTo(0, 6);
    expect(forward.z).toBeCloseTo(0, 6);
  });

  it('turns the forward axis to -Z at 180 degrees of yaw', () => {
    const forward = kartForward(quatFromKmpRotation({ x: 0, y: 180, z: 0 }));
    expect(forward.z).toBeCloseTo(-1, 6);
  });
});

describe('chaseCameraGoal', () => {
  const params = DEFAULT_CHASE_CAMERA_PARAMS;

  it('sits behind and above a stationary kart, looking ahead of it', () => {
    const goal = chaseCameraGoal(kartAt({ x: 0, y: 0, z: 0 }), params);
    expect(goal.position.z).toBeCloseTo(-params.distance, 5);
    expect(goal.position.x).toBeCloseTo(0, 5);
    expect(goal.position.y).toBeCloseTo(params.height, 5);
    expect(goal.target.z).toBeCloseTo(params.targetAhead, 5);
    expect(goal.target.y).toBeCloseTo(params.targetHeight, 5);
  });

  it('follows the kart round: at 90 degrees of yaw it sits at -X', () => {
    const goal = chaseCameraGoal(kartAt({ x: 0, y: 0, z: 0 }, 90), params);
    expect(goal.position.x).toBeCloseTo(-params.distance, 4);
    expect(goal.position.z).toBeCloseTo(0, 4);
    expect(goal.target.x).toBeCloseTo(params.targetAhead, 4);
  });

  it('pulls further back at speed, and no further once past the reference speed', () => {
    const parked = chaseCameraGoal(kartAt({ x: 0, y: 0, z: 0 }, 0, 0), params);
    const fast = chaseCameraGoal(kartAt({ x: 0, y: 0, z: 0 }, 0, params.speedReference), params);
    const faster = chaseCameraGoal(kartAt({ x: 0, y: 0, z: 0 }, 0, params.speedReference * 4), params);
    expect(-fast.position.z).toBeGreaterThan(-parked.position.z);
    expect(-fast.position.z).toBeCloseTo(params.distance + params.speedDistance, 5);
    expect(faster.position.z).toBeCloseTo(fast.position.z, 5);
  });

  it('keeps the camera level when the kart is pitched', () => {
    const pitched: ChaseCameraKart = {
      position: { x: 0, y: 0, z: 0 },
      mainRotation: quatFromKmpRotation({ x: 40, y: 0, z: 0 }),
      speed: 0,
    };
    const goal = chaseCameraGoal(pitched, params);
    expect(goal.position.y).toBeCloseTo(params.height, 5);
    expect(Math.hypot(goal.position.x, goal.position.z)).toBeCloseTo(params.distance, 4);
  });
});

describe('smoothingForFrames', () => {
  it('is the plain factor for one frame', () => {
    expect(smoothingForFrames(0.25, 1)).toBeCloseTo(0.25, 9);
  });

  it('closes more of the gap over more frames, without ever overshooting', () => {
    expect(smoothingForFrames(0.25, 4)).toBeGreaterThan(0.25);
    expect(smoothingForFrames(0.25, 1000)).toBeLessThanOrEqual(1);
    expect(smoothingForFrames(0.25, 0)).toBe(0);
  });

  it('two half-frames compose into the same easing as one whole frame', () => {
    const whole = smoothingForFrames(0.3, 1);
    const half = smoothingForFrames(0.3, 0.5);
    expect(1 - (1 - half) * (1 - half)).toBeCloseTo(whole, 9);
  });
});

describe('stepChaseCamera', () => {
  it('snaps to the goal on the first frame instead of flying in from the origin', () => {
    const state = createChaseCameraState();
    const kart = kartAt({ x: 5000, y: 200, z: -1000 });
    stepChaseCamera(state, kart, DEFAULT_CHASE_CAMERA_PARAMS, 1);
    expect(state.initialized).toBe(true);
    expect(state.position).toEqual(chaseCameraGoal(kart, DEFAULT_CHASE_CAMERA_PARAMS).position);
  });

  it('lags behind a jump and then converges on it', () => {
    const state = createChaseCameraState();
    stepChaseCamera(state, kartAt({ x: 0, y: 0, z: 0 }));
    const teleported = kartAt({ x: 10000, y: 0, z: 0 });
    stepChaseCamera(state, teleported, DEFAULT_CHASE_CAMERA_PARAMS, 1);
    const afterOne = state.position.x;
    expect(afterOne).toBeGreaterThan(0);
    expect(afterOne).toBeLessThan(10000);

    for (let i = 0; i < 300; i++) stepChaseCamera(state, teleported, DEFAULT_CHASE_CAMERA_PARAMS, 1);
    expect(state.position.x).toBeCloseTo(chaseCameraGoal(teleported, DEFAULT_CHASE_CAMERA_PARAMS).position.x, 3);
  });

  it('reuses the state object rather than allocating a new one', () => {
    const state = createChaseCameraState();
    const position = state.position;
    stepChaseCamera(state, kartAt({ x: 1, y: 2, z: 3 }));
    stepChaseCamera(state, kartAt({ x: 4, y: 5, z: 6 }));
    expect(state.position).toBe(position);
  });
});
