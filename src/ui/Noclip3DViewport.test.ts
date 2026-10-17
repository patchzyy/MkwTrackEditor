import { describe, expect, it, vi } from 'vitest';
import { appendKmpArea, appendKmpCamera, appendKmpGobj, appendKmpPoint, appendKmpPotiRoute, parseKmp, patchKmpAreaField, patchKmpCameraField, patchKmpEntityRouteIndex } from '../lib/kmp';
import { createEmptyKmpFile, writeKmpFile } from '../lib/kmpFile';
import { getVisibleEntitiesForRouteFilter } from './Noclip3DViewport';

vi.mock('../../vendor/noclip.website/src/SaveManager', () => ({ GlobalSaveManager: {} }));

describe('Camera mode picking', () => {
  it('only allows cameras and their exclusive route points, even when other layers are visible', () => {
    const position = { x: 0, y: 0, z: 0 };
    let kmp = parseKmp(writeKmpFile(createEmptyKmpFile()));
    for (let route = 0; route < 4; route++) kmp = parseKmp(appendKmpPotiRoute(kmp, position));
    for (let camera = 0; camera < 3; camera++) {
      kmp = parseKmp(appendKmpCamera(kmp, position));
      kmp = parseKmp(patchKmpCameraField(kmp, kmp.entities.find((entity) => entity.id === `CAME-${camera}`)!, 'routeIndex', camera));
    }
    kmp = parseKmp(appendKmpPoint(kmp, 'ENPT', position));
    kmp = parseKmp(appendKmpGobj(kmp, 101, position));
    kmp = parseKmp(patchKmpEntityRouteIndex(kmp, kmp.entities.find((entity) => entity.id === 'GOBJ-0')!, 1));
    kmp = parseKmp(appendKmpArea(kmp, position));
    kmp = parseKmp(patchKmpAreaField(kmp, kmp.entities.find((entity) => entity.id === 'AREA-0')!, 'routeIndex', 2));
    expect(getVisibleEntitiesForRouteFilter(kmp.entities, {}, kmp, undefined, undefined, true).map((entity) => entity.id)).toEqual([
      'CAME-0', 'CAME-1', 'CAME-2', 'POTI-0-0',
    ]);
    expect(getVisibleEntitiesForRouteFilter(kmp.entities, {}, kmp).map((entity) => entity.id)).toContain('GOBJ-0');
    expect(getVisibleEntitiesForRouteFilter(kmp.entities, { POTI_CAMERA: false }, kmp, undefined, undefined, true).map((entity) => entity.id)).toEqual(['CAME-0', 'CAME-1', 'CAME-2']);
  });
});
