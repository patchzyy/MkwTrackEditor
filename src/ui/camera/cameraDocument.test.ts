import { describe, expect, it } from 'vitest';
import { appendKmpArea, parseKmp, patchKmpAreaField, type KmpDocument, type Vec3 } from '../../lib/kmp';
import {
  NO_CAMERA_LINK,
  addCamera,
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
  listCameraRows,
  moveCamera,
  readCameraValues,
  remapCameraIndex,
  reorderChain,
  setChainOrder,
  setChainStart,
  type CameraValues,
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
