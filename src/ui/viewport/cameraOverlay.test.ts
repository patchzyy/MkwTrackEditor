import { describe, expect, it } from 'vitest';
import type { KmpDocument, KmpEntity, KmpRoute } from '../../lib/kmp';
import { buildCameraOverlay, findCameraPreviewDef, getCameraEntities, toCameraPreviewDefs } from './cameraOverlay';

function makeCamera(index: number, overrides: Partial<NonNullable<KmpEntity['camera']>> = {}, viewOverrides?: Partial<NonNullable<KmpEntity['cameraView']>>): KmpEntity {
  return {
    id: `CAME-${index}`,
    section: 'CAME',
    index,
    position: { x: index * 100, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    rawOffset: 0,
    recordSize: 0x48,
    camera: {
      type: 5,
      nextCam: 0xff,
      shake: 0,
      routeIndex: 0xff,
      vCam: 0,
      vZoom: 100,
      vView: 100,
      start: 0,
      movie: 0,
      zoomStart: 60,
      zoomEnd: 30,
      time: 100,
      ...overrides,
    },
    cameraView: {
      start: { x: 0, y: 0, z: 1000 },
      end: { x: 500, y: 0, z: 1000 },
      ...viewOverrides,
    },
  };
}

function makeDocument(entities: KmpEntity[], routes: KmpRoute[] = [], firstIntroCam = 0): KmpDocument {
  return {
    original: new Uint8Array(0),
    sections: [{ name: 'CAME', count: entities.length, headerData: (firstIntroCam << 8) | 0, offset: 0, data: new Uint8Array(0), entries: entities }],
    entities,
    pathGraphs: [],
    routes,
    warnings: [],
  };
}

describe('camera overlay', () => {
  it('only looks at CAME entities', () => {
    const other: KmpEntity = { id: 'ENPT-0', section: 'ENPT', index: 0, position: { x: 0, y: 0, z: 0 }, rawOffset: 0, recordSize: 0x14 };
    expect(getCameraEntities(makeDocument([makeCamera(0), other]))).toHaveLength(1);
    expect(getCameraEntities(null)).toHaveLength(0);
  });

  it('maps CAME records onto preview definitions', () => {
    const defs = toCameraPreviewDefs(makeDocument([makeCamera(0, { vView: 250, zoomEnd: 20 })]));
    expect(defs[0]).toMatchObject({ index: 0, id: 'CAME-0', type: 5, vView: 250, zoomStart: 60, zoomEnd: 20 });
    expect(defs[0].viewStart).toEqual({ x: 0, y: 0, z: 1000 });
    expect(defs[0].route).toBeNull();
  });

  it('resolves the POTI route and its point speeds', () => {
    const route: KmpRoute = {
      index: 3,
      rawOffset: 0,
      setting1: 0,
      setting2: 0,
      points: [
        { position: { x: 0, y: 0, z: 0 }, setting1: 5, setting2: 0, rawOffset: 0, routeIndex: 3, pointIndex: 0 },
        { position: { x: 100, y: 0, z: 0 }, setting1: 7, setting2: 0, rawOffset: 0, routeIndex: 3, pointIndex: 1 },
      ],
    };
    const defs = toCameraPreviewDefs(makeDocument([makeCamera(0, { routeIndex: 3 })], [route]));
    expect(defs[0].route).toEqual([
      { position: { x: 0, y: 0, z: 0 }, speed: 5 },
      { position: { x: 100, y: 0, z: 0 }, speed: 7 },
    ]);
  });

  it('builds gizmos with type labels and selection state', () => {
    const document = makeDocument([makeCamera(0), makeCamera(1, { type: 0 })]);
    const overlay = buildCameraOverlay(document, { selectedIds: new Set(['CAME-1']), hoveredId: 'CAME-0' });
    expect(overlay.cameraGizmos).toHaveLength(2);
    expect(overlay.cameraGizmos[0]).toMatchObject({ id: 'CAME-0', label: 'Cam 0 - OP_FixMoveAt', hovered: true, selected: false });
    expect(overlay.cameraGizmos[1]).toMatchObject({ id: 'CAME-1', label: 'Cam 1 - Goal', selected: true, hovered: false });
  });

  it('numbers the opening chain and links it', () => {
    const document = makeDocument([
      makeCamera(0, { nextCam: 1, time: 220 }),
      makeCamera(1, { nextCam: 2, time: 257 }),
      makeCamera(2, { nextCam: 0xff, time: 294 }),
    ], [], 0);
    const overlay = buildCameraOverlay(document);
    expect(overlay.firstIntroCam).toBe(0);
    expect(overlay.openingChain.map((s) => s.cameraIndex)).toEqual([0, 1, 2]);
    expect(overlay.cameraGizmos.map((g) => g.openingOrder)).toEqual([1, 2, 3]);
    expect(overlay.cameraChainLinks).toHaveLength(2);
    expect(overlay.cameraChainLinks[0]).toMatchObject({ order: 1 });
  });

  it('handles a missing document', () => {
    const overlay = buildCameraOverlay(null);
    expect(overlay.cameraGizmos).toHaveLength(0);
    expect(overlay.openingChain).toHaveLength(0);
  });

  it('finds a preview definition by entity id or index', () => {
    const defs = toCameraPreviewDefs(makeDocument([makeCamera(0), makeCamera(1)]));
    expect(findCameraPreviewDef(defs, 'CAME-1')?.index).toBe(1);
    expect(findCameraPreviewDef(defs, 1)?.index).toBe(1);
    expect(findCameraPreviewDef(defs, 'nope')).toBeNull();
    expect(findCameraPreviewDef(defs, null)).toBeNull();
  });
});
