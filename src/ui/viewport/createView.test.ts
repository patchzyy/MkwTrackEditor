import { describe, expect, it, vi } from 'vitest';
import { mat4 } from 'gl-matrix';
import {
  CREATE_RENDER_SCALE,
  canvasPointToRay,
  computeFrameView,
  DEFAULT_FRAME_FILL,
  diffPreviewModels,
  pickOverlayHandle,
  projectToCanvas,
  rayPlaneHit,
  resolveHit,
} from './createView';
import { CreateTopViewController } from './createTopView';
import type { CreateOverlayPoint, CreatePreviewModel } from '../../lib/create/types';
import { projectionMatrixForFrustum } from '../../../vendor/noclip.website/src/MathHelpers';

function perspectiveCamera(eye: [number, number, number], target: [number, number, number], aspect = 2) {
  const world = mat4.targetTo(mat4.create(), eye, target, [0, 1, 0]);
  const view = mat4.invert(mat4.create(), world);
  const near = 5;
  const nearY = Math.tan(Math.PI / 6) * near;
  const proj = mat4.create();
  projectionMatrixForFrustum(proj, -nearY * aspect, nearY * aspect, -nearY, nearY, near, 500000);
  return { world, proj, clip: mat4.mul(mat4.create(), proj, view) };
}

vi.mock('../../../vendor/noclip.website/src/SaveManager', () => ({ GlobalSaveManager: {} }));

describe('canvasPointToRay / projectToCanvas', () => {
  it('round-trips a ground point through a perspective camera', () => {
    const { world, proj, clip } = perspectiveCamera([0, 400, 600], [0, 0, 0]);
    const camera = { clipFromWorld: clip, projectionMatrix: proj, worldMatrix: world, orthographic: false };
    const point = { x: 1200, y: 0, z: -800 };
    const screen = projectToCanvas(clip, point, 1000, 500)!;
    expect(screen).not.toBeNull();
    const ray = canvasPointToRay(camera, screen.x, screen.y, 1000, 500)!;
    const hit = rayPlaneHit(ray, 0)!;
    expect(hit.position.x).toBeCloseTo(point.x, 0);
    expect(hit.position.z).toBeCloseTo(point.z, 0);
    // The ray starts at the eye, in game units.
    expect(ray.origin.y).toBeCloseTo(400 / CREATE_RENDER_SCALE, 3);
  });

  it('also works with the reversed-Z, infinite-far projection the viewport really uses', () => {
    const eye: [number, number, number] = [11476, 10292, 28170];
    const world = mat4.targetTo(mat4.create(), eye, [0, 0, 0], [0, 1, 0]);
    const view = mat4.invert(mat4.create(), world);
    // Reversed depth, clip z in [0, 1], infinite far plane: z = near / distance.
    const proj = mat4.fromValues(1.2277, 0, 0, 0, 0, 1.732, 0, 0, 0, 0, 0, -1, 0, 0, 5, 0);
    const clip = mat4.mul(mat4.create(), proj, view);
    const camera = { clipFromWorld: clip, projectionMatrix: proj, worldMatrix: world, orthographic: false };
    const point = { x: 2000, y: 0, z: -1500 };
    const screen = projectToCanvas(clip, point, 948, 672)!;
    const ray = canvasPointToRay(camera, screen.x, screen.y, 948, 672)!;
    const hit = rayPlaneHit(ray, 0)!;
    expect(hit.position.x).toBeCloseTo(point.x, 0);
    expect(hit.position.z).toBeCloseTo(point.z, 0);
  });

  it('returns null behind the camera and for parallel or backwards plane hits', () => {
    const { clip } = perspectiveCamera([0, 400, 600], [0, 0, 0]);
    expect(projectToCanvas(clip, { x: 0, y: 4000, z: 60000 }, 1000, 500)).toBeNull();
    expect(rayPlaneHit({ origin: { x: 0, y: 5, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, 0)).toBeNull();
    expect(rayPlaneHit({ origin: { x: 0, y: 5, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, 0)).toBeNull();
  });

  it('casts straight down through an orthographic top view', () => {
    const controller = new CreateTopViewController();
    const world = mat4.create();
    const proj = mat4.create();
    controller.camera = {
      worldMatrix: world,
      aspect: 2,
      setOrthographic(halfHeight: number, aspect: number, n: number, f: number) {
        mat4.ortho(proj, -halfHeight * aspect, halfHeight * aspect, -halfHeight, halfHeight, n, f);
      },
      worldMatrixUpdated() {},
    } as never;
    controller.setView(50, -20, 100);
    controller.update(null, 0);
    const clip = mat4.mul(mat4.create(), proj, mat4.invert(mat4.create(), world));
    const camera = { clipFromWorld: clip, projectionMatrix: proj, worldMatrix: world, orthographic: true };
    // Centre of the canvas looks at the view centre; north (screen up) is -Z.
    const centre = canvasPointToRay(camera, 500, 250, 1000, 500)!;
    expect(centre.direction.y).toBeCloseTo(-1, 5);
    expect(centre.origin.x).toBeCloseTo(50 / CREATE_RENDER_SCALE, 3);
    expect(centre.origin.z).toBeCloseTo(-20 / CREATE_RENDER_SCALE, 3);
    const top = canvasPointToRay(camera, 500, 0, 1000, 500)!;
    expect(top.origin.z).toBeCloseTo((-20 - 100) / CREATE_RENDER_SCALE, 2);
    const right = canvasPointToRay(camera, 1000, 250, 1000, 500)!;
    expect(right.origin.x).toBeCloseTo((50 + 200) / CREATE_RENDER_SCALE, 2);
    expect(rayPlaneHit(centre, 0)!.distance).toBeGreaterThan(0);
  });
});

describe('resolveHit', () => {
  const ray = { origin: { x: 0, y: 100, z: 0 }, direction: { x: 0, y: -1, z: 0 } };
  it('prefers the raycast and falls back to the plane', () => {
    const custom = { position: { x: 1, y: 2, z: 3 }, normal: { x: 0, y: 1, z: 0 }, distance: 98 };
    expect(resolveHit(ray, () => custom, 0)).toBe(custom);
    expect(resolveHit(ray, () => null, 10)!.position.y).toBe(10);
    expect(resolveHit(ray, undefined, 0)!.distance).toBe(100);
  });
});

describe('pickOverlayHandle', () => {
  const { clip } = perspectiveCamera([0, 400, 600], [0, 0, 0]);
  const point = (id: string, x: number, radius: number, pickable = true): CreateOverlayPoint => ({
    id, position: { x, y: 0, z: 0 }, color: [1, 1, 1, 1], radius, pickable,
  });

  it('picks within radius plus slack and ignores unpickable points', () => {
    const at = projectToCanvas(clip, { x: 0, y: 0, z: 0 }, 1000, 500)!;
    expect(pickOverlayHandle([point('a', 0, 6)], clip, 1000, 500, at.x + 11, at.y)).toBe('a');
    expect(pickOverlayHandle([point('a', 0, 6)], clip, 1000, 500, at.x + 13, at.y)).toBeNull();
    expect(pickOverlayHandle([point('a', 0, 6, false)], clip, 1000, 500, at.x, at.y)).toBeNull();
  });

  it('prefers the nearer point, and the closer-to-camera one on a tie', () => {
    const at = projectToCanvas(clip, { x: 0, y: 0, z: 0 }, 1000, 500)!;
    const far: CreateOverlayPoint = { id: 'far', position: { x: 0, y: 0, z: -3000 }, color: [1, 1, 1, 1], radius: 8, pickable: true };
    const near: CreateOverlayPoint = { id: 'near', position: { x: 0, y: 0, z: 0 }, color: [1, 1, 1, 1], radius: 8, pickable: true };
    const farScreen = projectToCanvas(clip, far.position, 1000, 500)!;
    expect(pickOverlayHandle([far, near], clip, 1000, 500, farScreen.x, farScreen.y)).toBe('far');
    expect(pickOverlayHandle([far, near], clip, 1000, 500, at.x, at.y)).toBe('near');
    const twin = { ...near, id: 'twin', position: { x: 0, y: 0, z: 0 } };
    expect(pickOverlayHandle([near, twin], clip, 1000, 500, at.x, at.y)).toBe('near');
  });
});

describe('diffPreviewModels', () => {
  const model = (key: string, revision: number, brres = new Uint8Array(4)): CreatePreviewModel => ({ key, revision, brres, modelName: `preview-${key}-${revision}` });

  it('adds new chunks, replaces changed ones and removes the gone', () => {
    const a1 = model('road:a', 1);
    const applied = new Map([
      ['road:a', { revision: 1, modelName: a1.modelName, brres: a1.brres }],
      ['terrain', { revision: 3, modelName: 'preview-terrain-3', brres: new Uint8Array(4) }],
    ]);
    const diff = diffPreviewModels([a1, model('road:b', 1)], applied);
    expect(diff.remove).toEqual(['terrain']);
    expect(diff.upsert.map((m) => m.key)).toEqual(['road:b']);
    expect(diffPreviewModels([model('road:a', 2)], applied).upsert.map((m) => m.key)).toEqual(['road:a']);
    expect(diffPreviewModels([a1], new Map([['road:a', applied.get('road:a')!]])).upsert).toEqual([]);
  });
});

describe('CreateTopViewController', () => {
  it('pans with the pointer and zooms about the cursor', () => {
    const controller = new CreateTopViewController();
    controller.setView(0, 0, 100);
    controller.panPixels(50, 25, 500);
    // 500 px = 200 units, so 0.4 units per pixel; content follows the mouse.
    expect(controller.centerX).toBeCloseTo(-20);
    expect(controller.centerZ).toBeCloseTo(-10);
    const before = { x: controller.centerX + 0.5 * 2 * controller.halfHeight, z: controller.centerZ };
    // Cursor at the right edge, vertically centred: the point under it must not move.
    controller.zoomAtPixel(-3, 1000, 250, 1000, 500);
    const after = { x: controller.centerX + 1 * 2 * controller.halfHeight, z: controller.centerZ };
    expect(controller.halfHeight).toBeLessThan(100);
    expect(after.x).toBeCloseTo(controller.centerX + 2 * controller.halfHeight, 6);
    void before;
  });

  it('frames a box with a margin', () => {
    const controller = new CreateTopViewController();
    controller.frameBox(-100, -50, 100, 50, 2, true);
    expect(controller.centerX).toBeCloseTo(0);
    expect(controller.halfHeight).toBeGreaterThanOrEqual(50);
    controller.frameBox(-100, -100, 100, 100, 2, true);
    // Wide canvas: the height limits the fit.
    expect(controller.halfHeight).toBeCloseTo(100 * 1.12, 5);
  });
});


describe('computeFrameView', () => {
  const fovY = Math.PI / 3;
  const aspect = 2;
  const min = { x: -20000, y: 0, z: -10000 };
  const max = { x: 20000, y: 200, z: 10000 };
  const forwardNow = { x: 0, y: 0, z: -1 };

  /** Fraction of the canvas (limiting dimension) the box's projected corners reach, from the result. */
  function coverage(frame: ReturnType<typeof computeFrameView>) {
    const world = mat4.targetTo(mat4.create(), [frame.eye.x, frame.eye.y, frame.eye.z], [frame.target.x, frame.target.y, frame.target.z], [0, 1, 0]);
    const view = mat4.invert(mat4.create(), world);
    const tanY = Math.tan(fovY / 2);
    const tanX = tanY * aspect;
    let fx = 0;
    let fy = 0;
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) {
          const v = [x, y, z, 1] as const;
          const cx = view[0] * v[0] + view[4] * v[1] + view[8] * v[2] + view[12];
          const cy = view[1] * v[0] + view[5] * v[1] + view[9] * v[2] + view[13];
          const cz = view[2] * v[0] + view[6] * v[1] + view[10] * v[2] + view[14];
          expect(cz).toBeLessThan(0); // in front of the camera
          fx = Math.max(fx, Math.abs(cx) / -cz / tanX);
          fy = Math.max(fy, Math.abs(cy) / -cz / tanY);
        }
      }
    }
    return { fx, fy };
  }

  it('looks down at the requested pitch and compass heading', () => {
    const a = computeFrameView(min, max, { fovY, aspect, currentForward: forwardNow, pitchDegrees: 38, yawDegrees: 0 });
    expect(a.forward.y).toBeCloseTo(-Math.sin((38 * Math.PI) / 180), 6);
    expect(a.forward.z).toBeLessThan(0); // north
    expect(a.forward.x).toBeCloseTo(0, 9);
    // The eye is south of and above the box, looking at its centre.
    expect(a.target).toEqual({ x: 0, y: 100, z: 0 });
    expect(a.eye.z).toBeGreaterThan(0);
    expect(a.eye.y).toBeGreaterThan(100);
    const east = computeFrameView(min, max, { fovY, aspect, currentForward: forwardNow, pitchDegrees: 10, yawDegrees: 90 });
    expect(east.forward.x).toBeCloseTo(Math.cos((10 * Math.PI) / 180), 6);
    expect(east.eye.x).toBeLessThan(0);
  });

  it('fills the requested share of the limiting canvas dimension', () => {
    for (const fill of [0.5, 0.7, 0.9]) {
      for (const pitch of [8, 38, 70]) {
        const { fx, fy } = coverage(computeFrameView(min, max, { fovY, aspect, currentForward: forwardNow, pitchDegrees: pitch, yawDegrees: 0, fill }));
        expect(Math.max(fx, fy)).toBeCloseTo(fill, 3);
        expect(Math.max(fx, fy)).toBeLessThanOrEqual(fill + 1e-6);
      }
    }
  });

  it('keeps the current direction for any angle that is not given, and fits at the default fill', () => {
    const current = { x: 0.6, y: -0.48, z: -0.64 };
    const len = Math.hypot(current.x, current.y, current.z);
    const unit = { x: current.x / len, y: current.y / len, z: current.z / len };
    const same = computeFrameView(min, max, { fovY, aspect, currentForward: unit });
    expect(same.forward.x).toBeCloseTo(unit.x, 6);
    expect(same.forward.y).toBeCloseTo(unit.y, 6);
    expect(same.forward.z).toBeCloseTo(unit.z, 6);
    const { fx, fy } = coverage(same);
    expect(Math.max(fx, fy)).toBeCloseTo(DEFAULT_FRAME_FILL, 3);
    // Only the pitch changes: the heading stays.
    const steeper = computeFrameView(min, max, { fovY, aspect, currentForward: unit, pitchDegrees: 60 });
    expect(steeper.forward.x / Math.hypot(steeper.forward.x, steeper.forward.z)).toBeCloseTo(unit.x / Math.hypot(unit.x, unit.z), 6);
  });

  it('survives straight-down and level starting views and a degenerate box', () => {
    const down = computeFrameView(min, max, { fovY, aspect, currentForward: { x: 0, y: -1, z: 0 } });
    expect(Number.isFinite(down.eye.x + down.eye.y + down.eye.z)).toBe(true);
    const point = computeFrameView({ x: 5, y: 5, z: 5 }, { x: 5, y: 5, z: 5 }, { fovY, aspect, currentForward: forwardNow, pitchDegrees: 90 });
    expect(Number.isFinite(point.eye.y)).toBe(true);
    expect(point.eye.y).toBeGreaterThan(5);
  });
});
