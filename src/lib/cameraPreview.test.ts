import { describe, expect, it } from 'vitest';
import {
  buildOpeningCameraChain,
  computeFrustumCorners,
  eulerFromLookDirection,
  formatFrames,
  framesToSeconds,
  getCameraAnimationFrames,
  lookDirectionFromEuler,
  secondsToFrames,
  getCameraTypeInfo,
  getOpeningSequenceDuration,
  getRouteDistanceAtFrame,
  getRouteLength,
  isOpeningCameraType,
  sampleCameraPose,
  sampleCameraPosition,
  sampleCameraViewPoint,
  sampleCameraZoom,
  sampleOpeningSequence,
  samplePolylineByDistance,
  type CameraPreviewDef,
} from './cameraPreview';

function makeCamera(overrides: Partial<CameraPreviewDef> = {}): CameraPreviewDef {
  return {
    index: 0,
    type: 5,
    nextCam: 0xff,
    routeIndex: 0xff,
    vCam: 0,
    vZoom: 100,
    vView: 100,
    zoomStart: 60,
    zoomEnd: 30,
    time: 220,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    viewStart: { x: 0, y: 0, z: 100 },
    viewEnd: { x: 100, y: 0, z: 100 },
    route: null,
    ...overrides,
  };
}

describe('camera type metadata', () => {
  it('names every documented type', () => {
    expect(getCameraTypeInfo(0).name).toBe('Goal');
    expect(getCameraTypeInfo(4).name).toBe('KartPathFollow');
    expect(getCameraTypeInfo(5).name).toBe('OP_FixMoveAt');
    expect(getCameraTypeInfo(6).name).toBe('OP_PathMoveAt');
    expect(getCameraTypeInfo(9).name).toBe('Unknown');
  });

  it('falls back for out-of-range types', () => {
    expect(getCameraTypeInfo(42).id).toBe(-1);
  });

  it('knows which types are opening pans', () => {
    expect([4, 5, 6].every(isOpeningCameraType)).toBe(true);
    expect([0, 1, 2, 3, 7].some(isOpeningCameraType)).toBe(false);
  });
});

describe('view point interpolation', () => {
  it('starts at view start', () => {
    expect(sampleCameraViewPoint(makeCamera(), 0)).toEqual({ x: 0, y: 0, z: 100 });
  });

  it('moves at vView / 100 units per frame', () => {
    // vView 100 => 1 unit/frame, span is 100 units.
    expect(sampleCameraViewPoint(makeCamera(), 50).x).toBeCloseTo(50, 6);
  });

  it('clamps at view end and stops', () => {
    expect(sampleCameraViewPoint(makeCamera(), 500)).toEqual({ x: 100, y: 0, z: 100 });
  });

  it('stays at view start when the view speed is zero', () => {
    expect(sampleCameraViewPoint(makeCamera({ vView: 0 }), 100)).toEqual({ x: 0, y: 0, z: 100 });
  });
});

describe('zoom interpolation', () => {
  it('interpolates from zoom start toward zoom end at vZoom / 100 per frame', () => {
    expect(sampleCameraZoom(makeCamera(), 0)).toBe(60);
    expect(sampleCameraZoom(makeCamera(), 10)).toBeCloseTo(50, 6);
    expect(sampleCameraZoom(makeCamera(), 30)).toBeCloseTo(30, 6);
  });

  it('does not overshoot zoom end', () => {
    expect(sampleCameraZoom(makeCamera(), 10000)).toBeCloseTo(30, 6);
  });

  it('zooms in the other direction too', () => {
    expect(sampleCameraZoom(makeCamera({ zoomStart: 20, zoomEnd: 80, vZoom: 200 }), 10)).toBeCloseTo(40, 6);
  });
});

describe('route motion', () => {
  const route = [
    { position: { x: 0, y: 0, z: 0 }, speed: 2 },
    { position: { x: 100, y: 0, z: 0 }, speed: 4 },
    { position: { x: 100, y: 0, z: 100 }, speed: 0 },
  ];

  it('measures polyline length', () => {
    expect(getRouteLength(route)).toBeCloseTo(200, 6);
  });

  it('samples by distance', () => {
    expect(samplePolylineByDistance(route, 150)).toEqual({ x: 100, y: 0, z: 50 });
    expect(samplePolylineByDistance(route, -5)).toEqual({ x: 0, y: 0, z: 0 });
    expect(samplePolylineByDistance(route, 9999)).toEqual({ x: 100, y: 0, z: 100 });
  });

  it('blends per-point speeds in units per frame', () => {
    expect(getRouteDistanceAtFrame(route, 25)).toBeCloseTo(64.872127, 6);
    const firstSegmentFrames = 50 * Math.log(2);
    expect(getRouteDistanceAtFrame(route, firstSegmentFrames)).toBeCloseTo(100, 6);
    expect(getRouteDistanceAtFrame(route, firstSegmentFrames + 10)).toBeCloseTo(140, 6);
  });

  it('drives the camera position for routed cameras', () => {
    const camera = makeCamera({ type: 6, routeIndex: 0, route });
    expect(sampleCameraPosition(camera, 25).x).toBeCloseTo(64.872127, 6);
  });

  it('keeps a routeless camera at its position', () => {
    expect(sampleCameraPosition(makeCamera({ position: { x: 7, y: 8, z: 9 } }), 100)).toEqual({ x: 7, y: 8, z: 9 });
  });
});

describe('sampleCameraPose', () => {
  it('produces position, target and fov together', () => {
    const pose = sampleCameraPose(makeCamera(), 25);
    expect(pose.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(pose.target.x).toBeCloseTo(25, 6);
    expect(pose.fovDegrees).toBeCloseTo(35, 6);
  });

  it('shows a static pose for player-tracking types', () => {
    const pose = sampleCameraPose(makeCamera({ type: 3 }), 100);
    expect(pose.target).toEqual({ x: 0, y: 0, z: 100 });
  });

  it('reports roll from the CAME rotation', () => {
    expect(sampleCameraPose(makeCamera({ rotation: { x: 0, y: 0, z: 15 } }), 0).roll).toBe(15);
  });
});

describe('opening camera chain', () => {
  const cameras = [
    makeCamera({ index: 0, nextCam: 1, time: 220 }),
    makeCamera({ index: 1, nextCam: 2, time: 257 }),
    makeCamera({ index: 2, nextCam: 0xff, time: 294 }),
  ];

  it('walks the next-camera chain and accumulates times', () => {
    const steps = buildOpeningCameraChain(cameras, 0);
    expect(steps.map((step) => step.cameraIndex)).toEqual([0, 1, 2]);
    expect(steps[1].startFrame).toBe(220);
    expect(steps[2].startFrame).toBe(477);
    expect(getOpeningSequenceDuration(steps)).toBe(771);
  });

  it('stops on a loop back to an already-visited camera', () => {
    const looping = [
      makeCamera({ index: 0, nextCam: 1, time: 10 }),
      makeCamera({ index: 1, nextCam: 0, time: 10 }),
    ];
    expect(buildOpeningCameraChain(looping, 0)).toHaveLength(2);
  });

  it('stops on a dangling next-camera index', () => {
    expect(buildOpeningCameraChain([makeCamera({ index: 0, nextCam: 77, time: 10 })], 0)).toHaveLength(1);
  });

  it('returns nothing when the first camera does not exist', () => {
    expect(buildOpeningCameraChain(cameras, 0xff)).toHaveLength(0);
  });

  it('maps a global time onto the active camera', () => {
    const steps = buildOpeningCameraChain(cameras, 0);
    expect(sampleOpeningSequence(steps, 0)).toMatchObject({ cameraIndex: 0, localFrame: 0 });
    expect(sampleOpeningSequence(steps, 300)).toMatchObject({ cameraIndex: 1, localFrame: 80 });
    expect(sampleOpeningSequence(steps, 500)).toMatchObject({ cameraIndex: 2, localFrame: 23 });
    expect(sampleOpeningSequence(steps, 771)).toBeNull();
  });
});

describe('getCameraAnimationFrames', () => {
  it('uses the declared time when it is the longest', () => {
    expect(getCameraAnimationFrames(makeCamera({ time: 220 }))).toBe(220);
  });

  it('extends to cover a slow pan', () => {
    expect(getCameraAnimationFrames(makeCamera({ time: 0, vView: 10 }))).toBeCloseTo(1000, 6);
  });
});

describe('computeFrustumCorners', () => {
  it('produces four corners around the view axis', () => {
    const corners = computeFrustumCorners({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 100 }, 90, 1, 100);
    expect(corners).toHaveLength(4);
    for (const corner of corners) {
      expect(corner.z).toBeCloseTo(100, 4);
      expect(Math.abs(corner.x)).toBeCloseTo(100, 4);
      expect(Math.abs(corner.y)).toBeCloseTo(100, 4);
    }
  });

  it('widens with the aspect ratio', () => {
    const wide = computeFrustumCorners({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 60, 2, 100);
    const narrow = computeFrustumCorners({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 60, 1, 100);
    expect(Math.abs(wide[0].x)).toBeGreaterThan(Math.abs(narrow[0].x));
  });

  it('does not blow up when position and target coincide', () => {
    const corners = computeFrustumCorners({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 }, 60, 1, 50);
    for (const corner of corners) {
      expect(Number.isFinite(corner.x)).toBe(true);
      expect(Number.isFinite(corner.y)).toBe(true);
      expect(Number.isFinite(corner.z)).toBe(true);
    }
  });
});

describe('frames and seconds', () => {
  it('converts at 60 fps in both directions', () => {
    expect(framesToSeconds(120)).toBeCloseTo(2);
    expect(secondsToFrames(1.5)).toBeCloseTo(90);
    expect(formatFrames(90)).toBe('90 frames (1.50 s)');
    expect(formatFrames(Number.NaN)).toBe('0 frames (0.00 s)');
  });
});

describe('KMP rotation and look direction', () => {
  it('round-trips a look direction through the rotation field', () => {
    const directions = [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
      { x: 0.5, y: 0.5, z: -0.7071 },
      { x: -0.3, y: -0.8, z: 0.4 },
    ];
    for (const direction of directions) {
      const length = Math.hypot(direction.x, direction.y, direction.z);
      const unit = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
      const back = lookDirectionFromEuler(eulerFromLookDirection(unit));
      expect(back.x).toBeCloseTo(unit.x, 5);
      expect(back.y).toBeCloseTo(unit.y, 5);
      expect(back.z).toBeCloseTo(unit.z, 5);
    }
  });

  it('uses +Z as the zero-rotation facing and +X as a quarter turn', () => {
    expect(eulerFromLookDirection({ x: 0, y: 0, z: 1 })).toEqual({ x: 0, y: 0, z: 0 });
    expect(eulerFromLookDirection({ x: 1, y: 0, z: 0 }).y).toBeCloseTo(90);
    // Looking down is a positive pitch in the KMP rotation field.
    expect(eulerFromLookDirection({ x: 0, y: -1, z: 0 }).x).toBeCloseTo(90);
  });

  it('falls back to no rotation for a zero-length direction', () => {
    expect(eulerFromLookDirection({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });
});
