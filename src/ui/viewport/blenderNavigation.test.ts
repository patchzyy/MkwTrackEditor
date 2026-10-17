import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mat4, vec3 } from 'gl-matrix';

vi.mock('../../../vendor/noclip.website/src/SaveManager', () => ({ GlobalSaveManager: { loadSetting: (_key: string, value: unknown) => value } }));
import { Camera } from '../../../vendor/noclip.website/src/Camera';
import { BlenderCameraController, readNavigationPreset, saveNavigationPreset } from './blenderNavigation';
import type InputManager from '../../../vendor/noclip.website/src/InputManager';

const input = {} as InputManager;
function makeController() {
  const controller = new BlenderCameraController();
  controller.camera = new Camera();
  controller.camera.aspect = 1.5;
  controller.camera.clipSpaceNearZ = -1;
  controller.setFrame([0, 0, 1000], [0, 0, 0]);
  controller.update(input, 0);
  return controller;
}

describe('Blender navigation geometry', () => {
  it('orbits around a fixed pivot at a fixed distance without roll', () => {
    const c = makeController();
    c.orbit(120, 60);
    c.update(input, 0);
    expect(vec3.distance(c.pivot, c.camera.worldMatrix.slice(12, 15))).toBeCloseTo(1000, 3);
    expect(Array.from(c.pivot)).toEqual([0, 0, 0]);
    expect(c.camera.worldMatrix[1]).toBeCloseTo(0);
    c.orbit(0, 100000);
    c.update(input, 0);
    expect(Array.from(c.camera.worldMatrix).every(Number.isFinite)).toBe(true);
  });

  it('pans the eye and pivot together in screen space', () => {
    const c = makeController();
    const before = mat4.clone(c.camera.worldMatrix);
    c.pan(100, 50, 1000);
    c.update(input, 0);
    expect(c.pivot[0]).toBeLessThan(0);
    expect(c.pivot[1]).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) expect(c.camera.worldMatrix[12 + i] - before[12 + i]).toBeCloseTo(c.pivot[i], 3);
    expect(c.distance).toBe(1000);
  });

  it('zooms proportionally and keeps the pivot in front of the eye', () => {
    const c = makeController();
    c.zoom(-1);
    expect(c.distance).toBeLessThan(1000);
    c.zoom(1);
    expect(c.distance).toBeCloseTo(1000);
    c.zoom(-10000);
    expect(c.distance).toBe(1);
    c.zoom(10000);
    expect(c.distance).toBe(1e7);
  });

  it('matches perspective and orthographic scale at the pivot', () => {
    const c = makeController();
    const perspectiveScale = c.camera.projectionMatrix[5] / c.distance;
    c.orthographic = true;
    c.update(input, 0);
    expect(c.camera.isOrthographic).toBe(true);
    expect(c.camera.projectionMatrix[5]).toBeCloseTo(perspectiveScale, 6);
  });

  it('sets front, right, top and opposite views in track coordinates', () => {
    const c = makeController();
    c.axisView('right', false);
    c.update(input, 0);
    expect(c.camera.worldMatrix[12]).toBeCloseTo(1000);
    c.axisView('front', true);
    c.update(input, 0);
    expect(c.camera.worldMatrix[14]).toBeCloseTo(-1000);
    c.axisView('top', true);
    c.update(input, 0);
    expect(c.camera.worldMatrix[13]).toBeLessThan(-999);
  });

  it('adopts an externally framed camera without moving the view', () => {
    const c = makeController();
    mat4.targetTo(c.camera.worldMatrix, [900, 400, 800], [20, 10, 30], [0, 1, 0]);
    const before = mat4.clone(c.camera.worldMatrix);
    c.cameraUpdateForced();
    c.update(input, 0);
    for (let i = 0; i < 16; i++) expect(c.camera.worldMatrix[i]).toBeCloseTo(before[i], 3);
  });
});

describe('navigation preference', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    } });
  });
  it('defaults to editor and remembers each supported preset', () => {
    expect(readNavigationPreset()).toBe('editor');
    for (const preset of ['blender27', 'blender', 'editor'] as const) {
      saveNavigationPreset(preset);
      expect(readNavigationPreset()).toBe(preset);
    }
    window.localStorage.setItem('mkw.viewport.navigation', 'unknown');
    expect(readNavigationPreset()).toBe('editor');
  });
  it('works when browser storage is unavailable', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('blocked'); } });
    expect(readNavigationPreset()).toBe('editor');
    expect(() => saveNavigationPreset('blender')).not.toThrow();
  });
});
