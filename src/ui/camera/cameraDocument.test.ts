import { describe, expect, it } from 'vitest';
import { appendKmpArea, appendKmpPotiRoute, parseKmp, patchKmpAreaField, type KmpDocument, type Vec3 } from '../../lib/kmp';
import { readKmpFile, writeKmpFile } from '../../lib/kmpFile';
import { getRouteTravelFrames, sampleCameraPose } from '../../lib/cameraPreview';
import { toCameraPreviewDefs } from '../viewport/cameraOverlay';
import {
  NO_CAMERA_LINK,
  addCamera,
  addCameraToChain,
  applyCameraValues,
  buildCameraDeleteRemap,
  buildCameraMoveRemap,
  createDefaultCameraValues,
  deleteCamera,
  duplicateCamera,
  filterCameraRows,
  findCameraEntity,
  getCameraChain,
  getCameraChainStarts,
  insertIntoChainOrder,
  generateIntroCameras,
  listCameraRows,
  moveCamera,
  readCameraValues,
  remapCameraIndex,
  removeFromChainOrder,
  reorderChain,
  setChainOrder,
  setChainStart,
  type CameraValues,
  type IntroCameraShot,
} from './cameraDocument';

const SECTION_NAMES = ['KTPT', 'ENPT', 'ENPH', 'ITPT', 'ITPH', 'CKPT', 'CKPH', 'GOBJ', 'POTI', 'AREA', 'CAME', 'JGPT', 'CNPT', 'MSPT', 'STGI'];

/** A valid but empty course.kmp, so these tests do not need a real track file. */
function createEmptyKmp(): KmpDocument {
  const headerSize = 0x10 + SECTION_NAMES.length * 4;
  const bytes = new Uint8Array(headerSize + SECTION_NAMES.length * 8);
  const view = new DataView(bytes.buffer);
  const encoder = new TextEncoder();
  bytes.set(encoder.encode('RKMD'), 0);
  view.setUint32(0x04, bytes.length, false);
  view.setUint16(0x08, SECTION_NAMES.length, false);
  view.setUint16(0x0a, headerSize, false);
  view.setUint32(0x0c, 2520, false);
  SECTION_NAMES.forEach((name, index) => {
    const sectionOffset = headerSize + index * 8;
    view.setUint32(0x10 + index * 4, sectionOffset - headerSize, false);
    bytes.set(encoder.encode(name), sectionOffset);
    view.setUint16(sectionOffset + 4, 0, false);
    view.setUint16(sectionOffset + 6, 0, false);
  });
  return parseKmp(bytes);
}

function vec(x: number, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

function cameraValues(overrides: Partial<CameraValues> = {}): CameraValues {
  return {
    ...createDefaultCameraValues({ position: vec(0), viewStart: vec(0, 0, 1000) }),
    ...overrides,
  };
}

/** Builds a document with `count` cameras whose positions identify them. */
function withCameras(count: number, overrides: Array<Partial<CameraValues>> = []): KmpDocument {
  let document = createEmptyKmp();
  for (let index = 0; index < count; index++) {
    document = parseKmp(addCamera(document, cameraValues({ position: vec(index * 100), ...overrides[index] })).bytes);
  }
  return document;
}

function nextCams(document: KmpDocument): number[] {
  return document.entities.filter((entity) => entity.section === 'CAME').map((entity) => entity.camera?.nextCam ?? -1);
}

function cameraPositionsX(document: KmpDocument): number[] {
  return document.entities.filter((entity) => entity.section === 'CAME').map((entity) => entity.position.x);
}

describe('camera document fixture', () => {
  it('adds cameras with the requested values', () => {
    const document = withCameras(2);
    expect(cameraPositionsX(document)).toEqual([0, 100]);
    const first = findCameraEntity(document, 0);
    expect(first).not.toBeNull();
    expect(readCameraValues(first!)).toMatchObject({ type: 5, time: 120, vView: 100, zoomStart: 60, nextCam: NO_CAMERA_LINK });
    expect(first!.cameraView?.start).toEqual(vec(0, 0, 1000));
  });

  it('writes only the fields it is given', () => {
    let document = withCameras(1);
    document = parseKmp(applyCameraValues(document, 'CAME-0', { time: 45, zoomEnd: 30, viewEnd: vec(9, 8, 7) }));
    const camera = findCameraEntity(document, 0)!;
    expect(camera.camera?.time).toBeCloseTo(45);
    expect(camera.camera?.zoomEnd).toBeCloseTo(30);
    expect(camera.camera?.zoomStart).toBeCloseTo(60);
    expect(camera.cameraView?.end).toEqual(vec(9, 8, 7));
  });
});

describe('intro camera generation', () => {
  const shots: IntroCameraShot[] = [
    { time: 100, points: [
      { position: vec(0), target: vec(0, 0, 1000), rotation: vec(0), fovDegrees: 60 },
      { position: vec(300, 400), target: vec(300, 400, 1000), rotation: vec(0), fovDegrees: 40 },
    ] },
    { time: 257, points: [{ position: vec(800), target: vec(800, 0, 1000), rotation: vec(0), fovDegrees: 55 }] },
    { time: 294, points: [{ position: vec(1200), target: vec(1200, 0, 1000), rotation: vec(0), fovDegrees: 70 }] },
  ];

  it('creates linked opening cameras with captured positions, targets and zoom', () => {
    const result = generateIntroCameras(createEmptyKmp(), shots);
    const document = parseKmp(result.bytes);
    expect(result.selectedId).toBe('CAME-0');
    expect(getCameraChain(document, 'opening').order).toEqual([0, 1, 2]);
    expect(nextCams(document)).toEqual([1, 2, NO_CAMERA_LINK]);
    const file = readKmpFile(result.bytes);
    expect(file.routes).toHaveLength(1);
    expect(file.routes[0].smooth).toBe(0);
    expect(file.routes[0].points[0].position).toEqual(shots[0].points[0].position);
    expect(file.routes[0].points.at(-1)!.position).toEqual(shots[0].points.at(-1)!.position);
    expect(file.routes[0].points.at(-1)!.setting1).toBeLessThan(file.routes[0].points[0].setting1);
    expect(file.cameras[0].pointVelocity).toBe(500);
    const defs = toCameraPreviewDefs(document);
    expect(defs.map((def) => def.type)).toEqual([5, 5, 5]);
    expect(sampleCameraPose(defs[0], 0)).toMatchObject({ position: vec(0), target: vec(0, 0, 1000), fovDegrees: 60 });
    expect(sampleCameraPose(defs[0], getRouteTravelFrames(defs[0].route!))).toMatchObject({ position: vec(300, 400), target: vec(300, 400, 1000), fovDegrees: 40 });
    expect(defs[1]).toMatchObject({ routeIndex: NO_CAMERA_LINK, time: 257, zoomStart: 55, zoomEnd: 55 });
    expect(sampleCameraPose(defs[1], 257)).toMatchObject({ position: shots[1].points[0].position, target: shots[1].points[0].target });
  });

  it('keeps each shot aimed at its own fixed focal target', () => {
    const targets = [vec(500, 300, 2000), vec(-800, 600, 4000), vec(2000, 900, -500)];
    const focusedShots = shots.map((shot, index) => ({
      ...shot,
      points: [0, 1, 2].map((point) => ({
        position: vec(index * 1000 + point * 300, point * 200), target: targets[index], rotation: vec(0), fovDegrees: 60,
      })),
    }));
    const result = generateIntroCameras(createEmptyKmp(), focusedShots);
    const file = readKmpFile(result.bytes);
    expect(file.cameras).toHaveLength(3);
    const defs = toCameraPreviewDefs(parseKmp(result.bytes));
    for (const [index, def] of defs.entries()) {
      expect(def.vView).toBe(1);
      for (const frame of [0, 50, 100, def.time]) {
        expect(sampleCameraPose(def, frame).target).toEqual(targets[index]);
      }
    }
  });

  it('uses all captures to reduce angular error while keeping one camera per shot', () => {
    const shot: IntroCameraShot = {
      time: 220,
      points: [0, 50, 500, 900, 1000].map((x, index) => ({
        position: vec(x), target: vec(x, [0, 500, 700, 500, 0][index], 2000), rotation: vec(0), fovDegrees: 60,
      })),
    };
    const document = parseKmp(generateIntroCameras(createEmptyKmp(), [shot, shots[1], shots[2]]).bytes);
    const defs = toCameraPreviewDefs(document);
    expect(getCameraChain(document, 'opening').order).toEqual([0, 1, 2]);
    expect(defs.map((def) => def.time)).toEqual([220, 257, 294]);
    expect(document.routes[0].points[0].position).toEqual(shot.points[0].position);
    expect(document.routes[0].points.at(-1)!.position).toEqual(shot.points.at(-1)!.position);
    const def = defs[0];
    const travelFrames = getRouteTravelFrames(def.route!, def.vCam / 100);
    const endpointsOnly = { ...def, viewStart: shot.points[0].target, viewEnd: shot.points.at(-1)!.target, vView: 400 };
    let fittedError = 0;
    let endpointsError = 0;
    for (const point of shot.points) {
      const frame = point.position.x / 1000 * travelFrames;
      const pose = sampleCameraPose(def, frame);
      const oldPose = sampleCameraPose(endpointsOnly, frame);
      const capturedPitch = Math.atan2(point.target.y, 2000);
      fittedError += (Math.atan2(pose.target.y - pose.position.y, pose.target.z - pose.position.z) - capturedPitch) ** 2;
      endpointsError += (Math.atan2(oldPose.target.y - oldPose.position.y, oldPose.target.z - oldPose.position.z) - capturedPitch) ** 2;
    }
    expect(fittedError).toBeLessThan(endpointsError / 2);
    const regenerated = parseKmp(generateIntroCameras(document, [shot, shots[1], shots[2]]).bytes);
    expect(regenerated.entities.filter((entity) => entity.section === 'CAME')).toHaveLength(3);
    expect(regenerated.routes).toHaveLength(1);
  });

  it('gently rounds route corners while preserving endpoints and a fixed focal target', () => {
    const target = vec(500, 300, 2000);
    const shot: IntroCameraShot = {
      time: 220,
      points: [vec(0), vec(1000), vec(1000, 1000)].map((position) => ({ position, target, rotation: vec(0), fovDegrees: 60 })),
    };
    const result = generateIntroCameras(createEmptyKmp(), [shot, shots[1], shots[2]]);
    const file = readKmpFile(result.bytes);
    const positions = file.routes[0].points.map((point) => point.position);
    expect(file.cameras).toHaveLength(3);
    expect(file.cameras[0]).toMatchObject({ viewVelocity: 1, viewStart: target, viewEnd: target, time: 220 });
    expect(file.routes[0].smooth).toBe(0);
    expect(positions).toEqual(expect.arrayContaining([vec(0), vec(900), vec(943.75, 6.25), vec(975, 25), vec(993.75, 56.25), vec(1000, 100), vec(1000, 1000)]));
    const def = toCameraPreviewDefs(parseKmp(result.bytes))[0];
    expect(getRouteTravelFrames(def.route!, def.vCam / 100)).toBeGreaterThan(shot.time);
    expect(sampleCameraPose(def, 100).target).toEqual(target);
  });

  it('eases down toward the endpoint without changing shot duration or focal target', () => {
    const shot: IntroCameraShot = {
      time: 220,
      points: [0, 1001].map((x) => ({ position: vec(x), target: vec(500, 300, 2000), rotation: vec(0), fovDegrees: 60 })),
    };
    const document = parseKmp(generateIntroCameras(createEmptyKmp(), [shot, shots[1], shots[2]]).bytes);
    const def = toCameraPreviewDefs(document)[0];
    expect(getRouteTravelFrames(def.route!, def.vCam / 100)).toBeGreaterThan(shot.time);
    for (const frame of [0, 180, 199, 200.2, 201, 219, 220]) {
      const pose = sampleCameraPose(def, frame);
      expect(pose.target).toEqual(vec(500, 300, 2000));
    }
    expect(sampleCameraPose(def, 220).position.x).toBeGreaterThan(sampleCameraPose(def, 219).position.x);
    expect(sampleCameraPose(def, 220).position.x).toBeLessThan(shot.points[1].position.x);
    const earlySpeed = sampleCameraPose(def, 50).position.x - sampleCameraPose(def, 49).position.x;
    const lateSpeed = sampleCameraPose(def, 220).position.x - sampleCameraPose(def, 219).position.x;
    expect(lateSpeed).toBeLessThan(earlySpeed / 2);
    expect(def.time).toBe(shot.time);
  });

  it('targets thirty frames of movement beyond each assigned shot duration', () => {
    const movingShots = [220, 257, 294].map((time) => ({
      time,
      points: [0, 10000].map((x) => ({ position: vec(x), target: vec(500, 300, 2000), rotation: vec(0), fovDegrees: 60 })),
    }));
    const document = parseKmp(generateIntroCameras(createEmptyKmp(), movingShots).bytes);
    const defs = toCameraPreviewDefs(document);
    for (const [index, def] of defs.entries()) {
      expect(def.time).toBe(movingShots[index].time);
      const movementFrames = getRouteTravelFrames(def.route!, def.vCam / 100);
      expect(Math.abs(movementFrames - def.time - 30)).toBeLessThan(5);
      expect(sampleCameraPose(def, def.time).position.x).toBeLessThan(10000);
      expect(sampleCameraPose(def, def.time).position.x).toBeGreaterThan(sampleCameraPose(def, def.time - 1).position.x);
    }
  });

  it('fits intermediate viewing angles for a stationary pan without adding cameras', () => {
    const shot: IntroCameraShot = {
      time: 100,
      points: [
        { position: vec(0), target: vec(0, 0, 2000), rotation: vec(0), fovDegrees: 60 },
        { position: vec(0), target: vec(2000), rotation: vec(0, 90), fovDegrees: 50 },
        { position: vec(0), target: vec(0, 0, -2000), rotation: vec(0, 180), fovDegrees: 40 },
      ],
    };
    const document = parseKmp(generateIntroCameras(createEmptyKmp(), [shot, shots[1], shots[2]]).bytes);
    const defs = toCameraPreviewDefs(document);
    expect(defs).toHaveLength(3);
    const middle = sampleCameraPose(defs[0], 50);
    expect(middle.position).toEqual(vec(0));
    expect(middle.target.x).toBeGreaterThan(0);
    expect(middle.target.z).toBeCloseTo(0);
    expect(middle.fovDegrees).toBe(50);
  });

  it('updates existing cameras in chain order and reuses exclusive routes on repeated generation', () => {
    let document = withCameras(5);
    document = parseKmp(setChainOrder(document, 'opening', [3, 1, 4]));
    document = parseKmp(setChainStart(document, 'selection', 2));
    const unchanged = readKmpFile(document.original);
    document = parseKmp(generateIntroCameras(document, shots).bytes);
    document = parseKmp(generateIntroCameras(document, shots).bytes);
    const file = readKmpFile(document.original);
    expect(file.cameras).toHaveLength(5);
    expect(file.routes).toHaveLength(1);
    expect(getCameraChain(document, 'opening').order).toEqual([3, 1, 4]);
    expect(file.firstSelectionCamera).toBe(2);
    expect(file.cameras[0]).toEqual(unchanged.cameras[0]);
    expect(file.cameras[2]).toEqual(unchanged.cameras[2]);
    expect(file.cameras[3].time).toBe(100);
  });

  it('clears inherited flags and uses captured rotation and look-at points', () => {
    let document = withCameras(3, [{ shake: 4, start: 1, movie: 2, rotation: vec(10, 20, 30) }]);
    document = parseKmp(setChainOrder(document, 'opening', [0, 1, 2]));
    const shot = { ...shots[0], points: shots[0].points.map((point) => ({ ...point, rotation: vec(15, 45, 5) })) };
    const result = generateIntroCameras(document, [shot, shots[1], shots[2]]);
    const file = readKmpFile(result.bytes);
    for (const camera of file.cameras) {
      expect(camera).toMatchObject({ type: 5, shake: 0, start: 0, movie: 0 });
    }
    expect(file.cameras[0]).toMatchObject({ viewStart: shot.points[0].target, viewEnd: shot.points.at(-1)!.target });
    expect(file.cameras[0].rotation).toEqual(vec(15, 45, 5));
    expect(sampleCameraPose(toCameraPreviewDefs(parseKmp(result.bytes))[0], 0).roll).toBe(5);
  });

  it('preserves a shared route and its references when replacing an intro path', () => {
    let document = withCameras(4, [{ routeIndex: 0 }, {}, {}, { routeIndex: 0 }]);
    document = parseKmp(appendKmpPotiRoute(document, vec(9000)));
    document = parseKmp(setChainOrder(document, 'opening', [0, 1, 2]));
    const file = readKmpFile(generateIntroCameras(document, shots).bytes);
    expect(file.routes).toHaveLength(2);
    expect(file.routes[0].points[0].position).toEqual(vec(9000));
    expect(file.cameras[0].routeIndex).toBe(1);
    expect(file.cameras[3].routeIndex).toBe(0);
  });

  it('creates missing cameras without changing unrelated sections', () => {
    let document = withCameras(1);
    document = parseKmp(appendKmpArea(document, vec(4321)));
    document = parseKmp(setChainOrder(document, 'opening', [0]));
    const before = readKmpFile(document.original);
    const file = readKmpFile(generateIntroCameras(document, shots).bytes);
    expect(file.cameras).toHaveLength(3);
    expect(file.areas).toEqual(before.areas);
    expect(file.startPoints).toEqual(before.startPoints);
    expect(writeKmpFile(file)).toEqual(writeKmpFile(readKmpFile(writeKmpFile(file))));
  });

  it('rejects incomplete captures and speeds that cannot fit the KMP fields', () => {
    expect(() => generateIntroCameras(createEmptyKmp(), [{ ...shots[0], points: [] }, shots[1], shots[2]])).toThrow('Capture at least one');
    expect(() => generateIntroCameras(createEmptyKmp(), [{ ...shots[0], time: 0 }, shots[1], shots[2]])).toThrow('positive duration');
  });

  it('rejects camera speed and zoom speed overflow instead of clamping or wrapping the stored values', () => {
    const shot = { time: 1, points: [0, 2674].map((x) => ({ position: vec(x), target: vec(0, 0, 1000), rotation: vec(0), fovDegrees: 60 })) };
    const file = readKmpFile(generateIntroCameras(createEmptyKmp(), [shot, shots[1], shots[2]]).bytes);
    expect(file.cameras[0].pointVelocity).toBeLessThanOrEqual(65535);
    expect(() => generateIntroCameras(createEmptyKmp(), [{ ...shot, points: [shot.points[0], { ...shot.points[1], position: vec(20000) }] }, shots[1], shots[2]])).toThrow('Increase its duration');
    expect(() => generateIntroCameras(createEmptyKmp(), [{
      time: 0.01,
      points: [30, 100].map((fovDegrees) => ({ position: vec(0), target: vec(0, 0, 1000), rotation: vec(0), fovDegrees })),
    }, shots[1], shots[2]])).toThrow('Increase its duration');
  });
});

describe('camera index remapping', () => {
  it('shifts the cameras after a deleted one down by one', () => {
    expect(buildCameraDeleteRemap(4, 1)).toEqual([0, -1, 1, 2]);
    expect(buildCameraDeleteRemap(3, 2)).toEqual([0, 1, -1]);
  });

  it('renumbers a move the way a list splice does', () => {
    // Move index 0 to the end: 0,1,2 -> 1,2,0
    expect(buildCameraMoveRemap(3, 0, 2)).toEqual([2, 0, 1]);
    // Move index 2 to the front: 0,1,2 -> 2,0,1
    expect(buildCameraMoveRemap(3, 2, 0)).toEqual([1, 2, 0]);
    expect(buildCameraMoveRemap(3, 1, 1)).toEqual([0, 1, 2]);
  });

  it('keeps "none", clears deleted references and leaves already-broken ones alone', () => {
    const remap = buildCameraDeleteRemap(3, 1);
    expect(remapCameraIndex(NO_CAMERA_LINK, remap)).toBe(NO_CAMERA_LINK);
    expect(remapCameraIndex(0, remap)).toBe(0);
    expect(remapCameraIndex(1, remap)).toBe(NO_CAMERA_LINK);
    expect(remapCameraIndex(2, remap)).toBe(1);
    expect(remapCameraIndex(9, remap)).toBe(9);
  });
});

describe('deleting a camera', () => {
  it('renumbers the chain, the areas that trigger it and the header starts', () => {
    let document = withCameras(4);
    document = parseKmp(setChainOrder(document, 'opening', [0, 1, 2, 3]));
    document = parseKmp(setChainStart(document, 'selection', 3));
    document = parseKmp(appendKmpArea(document, vec(0)));
    document = parseKmp(patchKmpAreaField(document, document.entities.find((entity) => entity.section === 'AREA')!, 'cameraIndex', 2));

    const result = deleteCamera(document, 1);
    const next = parseKmp(result.bytes);

    expect(cameraPositionsX(next)).toEqual([0, 200, 300]);
    // 0 -> (deleted 1 becomes none), old 2 and 3 are now 1 and 2.
    expect(nextCams(next)).toEqual([NO_CAMERA_LINK, 2, NO_CAMERA_LINK]);
    expect(getCameraChainStarts(next)).toEqual({ opening: 0, selection: 2 });
    expect(next.entities.find((entity) => entity.section === 'AREA')?.area?.cameraIndex).toBe(1);
    expect(result.selectedId).toBe('CAME-1');
  });

  it('clears the header when the chain start itself is deleted', () => {
    let document = withCameras(1);
    document = parseKmp(setChainStart(document, 'opening', 0));
    const next = parseKmp(deleteCamera(document, 0).bytes);
    expect(cameraPositionsX(next)).toEqual([]);
    expect(getCameraChainStarts(next).opening).toBe(NO_CAMERA_LINK);
  });
});

describe('reordering cameras', () => {
  it('moves the record and keeps the chain playing in the same order', () => {
    let document = withCameras(3);
    document = parseKmp(setChainOrder(document, 'opening', [0, 1, 2]));

    const next = parseKmp(moveCamera(document, 2, 0).bytes);
    expect(cameraPositionsX(next)).toEqual([200, 0, 100]);
    // Play order is still the same three cameras, now numbered 1, 2, 0.
    expect(getCameraChain(next, 'opening').order).toEqual([1, 2, 0]);
    expect(getCameraChainStarts(next).opening).toBe(1);
  });

  it('is a no-op when the camera is already in place', () => {
    const document = withCameras(2);
    expect(moveCamera(document, 1, 1).bytes).toBe(document.original);
  });
});

describe('duplicating a camera', () => {
  it('copies every field, including the hand-over target', () => {
    let document = withCameras(2, [{ type: 6, time: 33, vCam: 250, zoomStart: 80, zoomEnd: 20, viewEnd: vec(5, 6, 7), rotation: vec(1, 2, 3) }]);
    document = parseKmp(applyCameraValues(document, 'CAME-0', { nextCam: 1 }));

    const result = duplicateCamera(document, 0);
    const next = parseKmp(result.bytes);
    expect(result.selectedId).toBe('CAME-2');
    const copy = readCameraValues(findCameraEntity(next, 2)!);
    const source = readCameraValues(findCameraEntity(next, 0)!);
    expect(copy).toEqual(source);
    expect(copy.nextCam).toBe(1);
  });
});

describe('camera chains', () => {
  it('rewrites the hand-over links and the header from a play order', () => {
    let document = withCameras(3);
    document = parseKmp(setChainOrder(document, 'opening', [2, 0, 1]));
    expect(nextCams(document)).toEqual([1, NO_CAMERA_LINK, 0]);
    expect(getCameraChainStarts(document).opening).toBe(2);
    expect(getCameraChain(document, 'opening').order).toEqual([2, 0, 1]);
  });

  it('adds up the total duration of the chain', () => {
    let document = withCameras(2, [{ time: 60 }, { time: 90 }]);
    document = parseKmp(setChainOrder(document, 'opening', [0, 1]));
    const chain = getCameraChain(document, 'opening');
    expect(chain.totalFrames).toBeCloseTo(150);
    expect(chain.warnings).toEqual([]);
  });

  it('warns when the chain loops back on itself', () => {
    let document = withCameras(2);
    document = parseKmp(setChainOrder(document, 'opening', [0, 1]));
    document = parseKmp(applyCameraValues(document, 'CAME-1', { nextCam: 0 }));
    const chain = getCameraChain(document, 'opening');
    expect(chain.loopsAt).toBe(0);
    expect(chain.warnings.join(' ')).toContain('loops back');
  });

  it('warns when the chain hands over to a camera that does not exist', () => {
    let document = withCameras(1);
    document = parseKmp(setChainStart(document, 'opening', 0));
    document = parseKmp(applyCameraValues(document, 'CAME-0', { nextCam: 7 }));
    const chain = getCameraChain(document, 'opening');
    expect(chain.missingAt).toBe(7);
    expect(chain.warnings.join(' ')).toContain('does not exist');
  });

  it('warns when the chain starts at a camera that does not exist', () => {
    let document = withCameras(1);
    document = parseKmp(setChainStart(document, 'opening', 6));
    const chain = getCameraChain(document, 'opening');
    expect(chain.missingAt).toBe(6);
    expect(chain.order).toEqual([]);
  });

  it('warns about a camera the pan can never advance past', () => {
    let document = withCameras(1, [{ time: 0, vView: 0, vZoom: 0, viewEnd: vec(0, 0, 1000) }]);
    document = parseKmp(setChainStart(document, 'opening', 0));
    const chain = getCameraChain(document, 'opening');
    expect(chain.zeroDurationAt).toEqual([0]);
    expect(chain.warnings.join(' ')).toContain('no duration');
  });

  it('reports no chain at all when the header points at "none"', () => {
    const document = withCameras(2);
    const chain = getCameraChain(document, 'selection');
    expect(chain.first).toBe(0);
    expect(chain.order).toEqual([0]);
  });

  it('moves an entry within a play order', () => {
    expect(reorderChain([3, 1, 2], 0, 2)).toEqual([1, 2, 3]);
    expect(reorderChain([3, 1, 2], 2, 0)).toEqual([2, 3, 1]);
    expect(reorderChain([3, 1, 2], 5, 0)).toEqual([3, 1, 2]);
  });
});

describe('timeline chain editing', () => {
  it('inserts a camera at a slot, counting among the other cameras', () => {
    expect(insertIntoChainOrder([0, 1, 2], 5, 1)).toEqual([0, 5, 1, 2]);
    expect(insertIntoChainOrder([0, 1, 2], 5, 99)).toEqual([0, 1, 2, 5]);
    expect(insertIntoChainOrder([0, 1, 2], 5, -3)).toEqual([5, 0, 1, 2]);
  });

  it('moves a camera that is already in the order instead of duplicating it', () => {
    expect(insertIntoChainOrder([0, 1, 2], 0, 2)).toEqual([1, 2, 0]);
    expect(insertIntoChainOrder([0, 1, 2], 2, 0)).toEqual([2, 0, 1]);
    expect(insertIntoChainOrder([0, 1, 2], 1, 1)).toEqual([0, 1, 2]);
  });

  it('takes a camera out of an order', () => {
    expect(removeFromChainOrder([0, 1, 2], 1)).toEqual([0, 2]);
    expect(removeFromChainOrder([0, 1, 2], 9)).toEqual([0, 1, 2]);
  });

  it('rewires hand-overs and the header when the first clip changes', () => {
    let document = withCameras(3);
    document = parseKmp(setChainOrder(document, 'opening', [0, 1, 2]));
    document = parseKmp(setChainOrder(document, 'opening', insertIntoChainOrder([0, 1, 2], 2, 0)));
    expect(getCameraChainStarts(document).opening).toBe(2);
    expect(nextCams(document)).toEqual([1, NO_CAMERA_LINK, 0]);
    expect(getCameraChain(document, 'opening').order).toEqual([2, 0, 1]);
  });

  it('splices an outside camera into the middle of the chain', () => {
    let document = withCameras(4);
    document = parseKmp(setChainOrder(document, 'opening', [0, 1, 2]));
    document = parseKmp(setChainOrder(document, 'opening', insertIntoChainOrder([0, 1, 2], 3, 1)));
    expect(getCameraChain(document, 'opening').order).toEqual([0, 3, 1, 2]);
    expect(nextCams(document)).toEqual([3, 2, NO_CAMERA_LINK, 1]);
  });

  it('appends a new shot to the end of the chain in one edit', () => {
    let document = withCameras(2);
    document = parseKmp(setChainOrder(document, 'opening', [0, 1]));
    const result = addCameraToChain(document, 'opening', cameraValues({ position: vec(900) }));
    expect(result.selectedId).toBe('CAME-2');
    const next = parseKmp(result.bytes);
    expect(getCameraChain(next, 'opening').order).toEqual([0, 1, 2]);
    expect(nextCams(next)).toEqual([1, 2, NO_CAMERA_LINK]);
  });

  it('starts a chain with the new shot when none exists yet', () => {
    const result = addCameraToChain(createEmptyKmp(), 'selection', cameraValues());
    const next = parseKmp(result.bytes);
    expect(getCameraChainStarts(next).selection).toBe(0);
    expect(getCameraChain(next, 'selection').order).toEqual([0]);
  });

  it('ends a chain that used to loop when a shot is appended', () => {
    let document = withCameras(2);
    document = parseKmp(setChainOrder(document, 'opening', [0, 1]));
    document = parseKmp(applyCameraValues(document, 'CAME-1', { nextCam: 0 }));
    const next = parseKmp(addCameraToChain(document, 'opening', cameraValues()).bytes);
    const chain = getCameraChain(next, 'opening');
    expect(chain.order).toEqual([0, 1, 2]);
    expect(chain.loopsAt).toBeNull();
  });
});

describe('the camera outliner model', () => {
  it('reports chain places, area references and the chain starts', () => {
    let document = withCameras(3, [{ type: 5 }, { type: 1 }, { type: 6, routeIndex: 0 }]);
    document = parseKmp(setChainOrder(document, 'opening', [0, 2]));
    document = parseKmp(setChainStart(document, 'selection', 1));
    document = parseKmp(appendKmpArea(document, vec(0)));
    document = parseKmp(patchKmpAreaField(document, document.entities.find((entity) => entity.section === 'AREA')!, 'cameraIndex', 1));

    const rows = listCameraRows(document);
    expect(rows.map((row) => row.index)).toEqual([0, 1, 2]);
    expect(rows[0].openingOrder).toBe(1);
    expect(rows[2].openingOrder).toBe(2);
    expect(rows[1].openingOrder).toBe(0);
    expect(rows[0].isOpeningStart).toBe(true);
    expect(rows[1].isSelectionStart).toBe(true);
    expect(rows[1].selectionOrder).toBe(1);
    expect(rows[1].usedByAreas).toEqual([0]);
    expect(rows[2].routeIndex).toBe(0);
    expect(rows[1].typeInfo.label).toBe('Fixed, tracks player');
  });

  it('filters on index, type, route and badges', () => {
    let document = withCameras(3, [{ type: 5 }, { type: 1 }, { type: 6, routeIndex: 0 }]);
    document = parseKmp(setChainOrder(document, 'opening', [0, 2]));
    const rows = listCameraRows(document);

    expect(filterCameraRows(rows, '').map((row) => row.index)).toEqual([0, 1, 2]);
    expect(filterCameraRows(rows, 'camera 1').map((row) => row.index)).toEqual([1]);
    expect(filterCameraRows(rows, 'tracks player').map((row) => row.index)).toEqual([1]);
    expect(filterCameraRows(rows, 'route 0').map((row) => row.index)).toEqual([2]);
    expect(filterCameraRows(rows, 'opening 2').map((row) => row.index)).toEqual([2]);
    expect(filterCameraRows(rows, 'nothing here')).toEqual([]);
  });

  it('returns nothing for a track with no cameras', () => {
    expect(listCameraRows(createEmptyKmp())).toEqual([]);
    expect(listCameraRows(null)).toEqual([]);
  });
});
