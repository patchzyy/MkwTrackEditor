import { describe, expect, it } from 'vitest';
import {
  KMP_RECORD_SIZE,
  KMP_SECTION_ORDER,
  areaTypeName,
  cameraTypeName,
  checkpointTypeName,
  cloneKmpFile,
  createEmptyKmpFile,
  decodeRespawnExtraData,
  effectiveSpeedModifier,
  presenceFlagLabels,
  readKmpFile,
  totalRoutePointCount,
  writeKmpFile,
  type KmpFile,
} from './kmpFile';
import { decodeYaz0 } from './yaz0';
import { parseU8 } from './u8';
import { CUSTOM_TRACK_DIR, NINTENDO_TRACK_DIR, listTracks, readTrackBytes } from './realTrackFixtures.testdata';

function courseKmp(path: string): Uint8Array | undefined {
  return parseU8(decodeYaz0(readTrackBytes(path))).find((entry) => entry.path.toLowerCase().endsWith('course.kmp'))?.data;
}

function firstByteDifference(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : length;
}

const customTracks = listTracks(CUSTOM_TRACK_DIR, 30);
const nintendoTracks = listTracks(NINTENDO_TRACK_DIR, 15);

describe('KMP structured model', () => {
  it('writes an empty document that reads back identically', () => {
    const empty = createEmptyKmpFile();
    const bytes = writeKmpFile(empty);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RKMD');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(4, false)).toBe(bytes.length);
    expect(view.getUint16(8, false)).toBe(15);
    expect(view.getUint16(0x0a, false)).toBe(0x4c);
    expect(view.getUint32(0x0c, false)).toBe(0x9d8);

    const reread = readKmpFile(bytes);
    expect(reread.sectionLayout).toEqual([...KMP_SECTION_ORDER]);
    expect(reread.stage[0].lapCount).toBe(3);
    expect([...writeKmpFile(reread)]).toEqual([...bytes]);
  });

  it('round-trips every field of every section', () => {
    const file = createEmptyKmpFile();
    file.startPoints.push({ position: { x: 1, y: 2, z: 3 }, rotation: { x: 4, y: 5, z: 6 }, playerIndex: -1, padding: 0 });
    file.enemyPoints.push({ position: { x: 7, y: 8, z: 9 }, range: 10.5, setting1: 0x1234, setting2: 0x56, setting3: 0x78 });
    file.enemyGroups.push({ start: 0, length: 1, prev: [], next: [0], linkFlags: 0x0041 });
    file.itemPoints.push({ position: { x: 11, y: 12, z: 13 }, range: 14.25, setting1: 0x2345, setting2: 0x6789 });
    file.itemGroups.push({ start: 0, length: 1, prev: [0], next: [0], linkFlags: 0 });
    file.checkpoints.push({ x1: -100, z1: -200, x2: 100, z2: 200, respawnIndex: 0, type: 0, prev: 0xff, next: 0xff });
    file.checkpointGroups.push({ start: 0, length: 1, prev: [0], next: [0], linkFlags: 0 });
    file.objects.push({
      objectId: 0x65,
      extendedPresence: 0x0102,
      position: { x: 20, y: 21, z: 22 },
      rotation: { x: 23, y: 24, z: 25 },
      scale: { x: 1.5, y: 2.5, z: 3.5 },
      routeIndex: 0,
      settings: [1, 2, 3, 4, 5, 6, 7, 8],
      presenceFlags: 0x3f,
    });
    file.routes.push({
      smooth: 1,
      forwardBackward: 1,
      points: [
        { position: { x: 30, y: 31, z: 32 }, setting1: 60, setting2: 3 },
        { position: { x: 33, y: 34, z: 35 }, setting1: 120, setting2: 4 },
        { position: { x: 36, y: 37, z: 38 }, setting1: 30, setting2: 0 },
      ],
    });
    file.areas.push({
      shape: 1,
      type: 3,
      cameraIndex: 0xff,
      priority: 7,
      position: { x: 40, y: 41, z: 42 },
      rotation: { x: 43, y: 44, z: 45 },
      scale: { x: 2, y: 3, z: 4 },
      setting1: 0x1111,
      setting2: 0x2222,
      routeIndex: 0,
      enemyPointIndex: 0,
      padding: 0,
    });
    file.cameras.push({
      type: 5,
      nextIndex: 0xff,
      shake: 0,
      routeIndex: 0,
      pointVelocity: 111,
      zoomVelocity: 222,
      viewVelocity: 333,
      start: 1,
      movie: 2,
      position: { x: 50, y: 51, z: 52 },
      rotation: { x: 53, y: 54, z: 55 },
      zoomStart: 60,
      zoomEnd: 30,
      viewStart: { x: 56, y: 57, z: 58 },
      viewEnd: { x: 59, y: 60, z: 61 },
      time: 240,
    });
    file.respawnPoints.push({ position: { x: 70, y: 71, z: 72 }, rotation: { x: 73, y: 74, z: 75 }, id: 0, extraUserData: -1 });
    file.cannonPoints.push({ position: { x: 80, y: 81, z: 82 }, rotation: { x: 83, y: 84, z: 85 }, id: 0, shootEffect: 2 });
    file.battleFinishPoints.push({ position: { x: 90, y: 91, z: 92 }, rotation: { x: 93, y: 94, z: 95 }, id: 0, unknown: 0 });
    file.stage[0] = {
      lapCount: 5,
      polePosition: 1,
      driverDistance: 1,
      lensFlareFlash: 1,
      unknown1: 0,
      flareColor: [0xe6, 0xe6, 0xe6, 0x4b],
      unknown2: 0,
      speedModifier: 1.5,
    };
    file.firstOpeningCamera = 0;
    file.firstSelectionCamera = 0;

    const bytes = writeKmpFile(file);
    const reread = readKmpFile(bytes);

    expect(reread.startPoints).toEqual(file.startPoints);
    expect(reread.enemyPoints).toEqual(file.enemyPoints);
    expect(reread.enemyGroups[0].linkFlags).toBe(0x0041);
    expect(reread.enemyGroups[0].prev).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(reread.enemyGroups[0].next[0]).toBe(0);
    expect(reread.itemPoints).toEqual(file.itemPoints);
    expect(reread.checkpoints).toEqual(file.checkpoints);
    expect(reread.objects).toEqual(file.objects);
    expect(reread.routes).toEqual(file.routes);
    expect(reread.areas).toEqual(file.areas);
    expect(reread.cameras).toEqual(file.cameras);
    expect(reread.respawnPoints).toEqual(file.respawnPoints);
    expect(reread.cannonPoints).toEqual(file.cannonPoints);
    expect(reread.battleFinishPoints).toEqual(file.battleFinishPoints);
    expect(reread.stage[0]).toEqual(file.stage[0]);
    expect(reread.firstOpeningCamera).toBe(0);
    expect([...writeKmpFile(reread)]).toEqual([...bytes]);
  });

  it('records the total route point count in the route section header', () => {
    const file = createEmptyKmpFile();
    file.routes.push({ smooth: 0, forwardBackward: 0, points: [1, 2, 3].map((n) => ({ position: { x: n, y: n, z: n }, setting1: 0, setting2: 0 })) });
    file.routes.push({ smooth: 0, forwardBackward: 0, points: [4, 5].map((n) => ({ position: { x: n, y: n, z: n }, setting1: 0, setting2: 0 })) });
    expect(totalRoutePointCount(file)).toBe(5);
    const bytes = writeKmpFile(file);
    const reread = readKmpFile(bytes);
    expect(reread.raw.headerValues.POTI).toBe(5);
    expect(reread.routes.map((route) => route.points.length)).toEqual([3, 2]);
  });

  it('splits the camera section header into the opening and selection camera indices', () => {
    const file = createEmptyKmpFile();
    file.cameras.push({
      type: 5,
      nextIndex: 1,
      shake: 0,
      routeIndex: 0xff,
      pointVelocity: 0,
      zoomVelocity: 0,
      viewVelocity: 0,
      start: 0,
      movie: 0,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      zoomStart: 0,
      zoomEnd: 0,
      viewStart: { x: 0, y: 0, z: 0 },
      viewEnd: { x: 0, y: 0, z: 0 },
      time: 0,
    });
    file.firstOpeningCamera = 3;
    file.firstSelectionCamera = 7;
    const reread = readKmpFile(writeKmpFile(file));
    expect(reread.firstOpeningCamera).toBe(3);
    expect(reread.firstSelectionCamera).toBe(7);
    expect(reread.raw.headerValues.CAME).toBe(0x0307);
  });

  it('encodes the speed modifier as the top two bytes of a float', () => {
    for (const [value, expected] of [
      [1, 0x3f80],
      [0.5, 0x3f00],
      [2, 0x4000],
    ] as const) {
      const file = createEmptyKmpFile();
      file.stage[0].speedModifier = value;
      const bytes = writeKmpFile(file);
      const reread = readKmpFile(bytes);
      expect(reread.stage[0].speedModifier).toBe(value);
      const stgiStart = bytes.length - KMP_RECORD_SIZE.STGI;
      expect((bytes[stgiStart + 0x0a] << 8) | bytes[stgiStart + 0x0b]).toBe(expected);
    }
  });

  it('treats a zero speed modifier as 1x', () => {
    const file = createEmptyKmpFile();
    expect(effectiveSpeedModifier(file.stage[0])).toBe(1);
    file.stage[0].speedModifier = 1.5;
    expect(effectiveSpeedModifier(file.stage[0])).toBe(1.5);
  });

  it('preserves sections the editor does not understand', () => {
    // Hand-build a 16-section KMP whose extra "XTRA" section sits between STGI and the end.
    const sections = [...KMP_SECTION_ORDER, 'XTRA'];
    const headerSize = 0x10 + sections.length * 4;
    const payloads: Record<string, Uint8Array> = { XTRA: Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2]) };
    payloads.STGI = Uint8Array.from([3, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0x4b, 0, 0x3f, 0x80]);
    const counts: Record<string, number> = { STGI: 1, XTRA: 2 };

    const body: number[] = [];
    const offsets: number[] = [];
    for (const name of sections) {
      offsets.push(body.length);
      for (const char of name) body.push(char.charCodeAt(0));
      const count = counts[name] ?? 0;
      body.push((count >> 8) & 0xff, count & 0xff, 0, 0);
      for (const byte of payloads[name] ?? []) body.push(byte);
    }

    const bytes = new Uint8Array(headerSize + body.length);
    const view = new DataView(bytes.buffer);
    bytes.set([0x52, 0x4b, 0x4d, 0x44], 0);
    view.setUint32(4, bytes.length, false);
    view.setUint16(8, sections.length, false);
    view.setUint16(0x0a, headerSize, false);
    view.setUint32(0x0c, 0x9d8, false);
    for (let i = 0; i < offsets.length; i++) view.setUint32(0x10 + i * 4, offsets[i], false);
    bytes.set(body, headerSize);

    const file = readKmpFile(bytes);
    expect(file.unknownSections.map((section) => section.name)).toEqual(['XTRA']);
    expect(file.unknownSections[0].count).toBe(2);
    expect([...file.unknownSections[0].payload]).toEqual([9, 8, 7, 6, 5, 4, 3, 2]);
    expect(file.warnings.some((warning) => warning.includes('XTRA'))).toBe(true);
    expect(file.stage[0].lapCount).toBe(3);
    expect(file.stage[0].speedModifier).toBe(1);
    expect([...writeKmpFile(file)]).toEqual([...bytes]);
  });

  it('exposes friendly names for enum-like fields', () => {
    expect(areaTypeName(0)).toBe('Camera trigger');
    expect(areaTypeName(0x0a)).toBe('Fall boundary');
    expect(cameraTypeName(5)).toBe('Opening pan along a route');
    expect(checkpointTypeName(0)).toBe('Lap counter');
    expect(checkpointTypeName(0xff)).toBe('Normal checkpoint');
    expect(checkpointTypeName(3)).toBe('Key checkpoint 3');
    expect(presenceFlagLabels(0x3f)).toHaveLength(3);
    expect(presenceFlagLabels(0)).toHaveLength(0);
    expect(decodeRespawnExtraData(-1)).toEqual({ soundTriggerId: null, extra: 0 });
    expect(decodeRespawnExtraData(305)).toEqual({ soundTriggerId: 2, extra: 5 });
  });

  it('clones deeply so edits do not leak into the original', () => {
    const file = createEmptyKmpFile();
    file.startPoints.push({ position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, playerIndex: -1, padding: 0 });
    const copy = cloneKmpFile(file);
    copy.startPoints[0].position.x = 99;
    copy.stage[0].flareColor[0] = 1;
    expect(file.startPoints[0].position.x).toBe(1);
    expect(file.stage[0].flareColor[0]).toBe(0xff);
  });
});

describe.runIf(customTracks.length >= 20)('KMP round-trip on real custom tracks', () => {
  it(`writes ${customTracks.length} Retro Rewind tracks back byte-for-byte`, () => {
    let checked = 0;
    for (const path of customTracks) {
      const bytes = courseKmp(path);
      if (!bytes) continue;
      checked++;
      const written = writeKmpFile(readKmpFile(bytes));
      expect(firstByteDifference(written, bytes), `${path} differs`).toBe(-1);
    }
    expect(checked).toBeGreaterThanOrEqual(20);
  });

  it('parses plausible values out of every section it finds', () => {
    const seen = new Set<string>();
    for (const path of customTracks) {
      const bytes = courseKmp(path);
      if (!bytes) continue;
      const file: KmpFile = readKmpFile(bytes);
      for (const section of file.sectionLayout) seen.add(section);
      expect(file.version).toBeGreaterThan(0);
      expect(file.headerSize).toBeGreaterThanOrEqual(0x10 + file.sectionOrder.length * 4);
      expect(file.stage.length).toBeGreaterThan(0);
      expect(file.raw.headerValues.POTI ?? totalRoutePointCount(file)).toBe(totalRoutePointCount(file));
      for (const group of file.enemyGroups) {
        expect(group.start + group.length).toBeLessThanOrEqual(file.enemyPoints.length);
      }
      for (const object of file.objects) expect(object.settings).toHaveLength(8);
    }
    for (const section of KMP_SECTION_ORDER) expect(seen.has(section), `${section} never seen`).toBe(true);
  });
});

describe.runIf(nintendoTracks.length >= 10)('KMP round-trip on retail tracks', () => {
  it(`writes ${nintendoTracks.length} Nintendo tracks back byte-for-byte`, () => {
    let checked = 0;
    for (const path of nintendoTracks) {
      const bytes = courseKmp(path);
      if (!bytes) continue;
      checked++;
      const written = writeKmpFile(readKmpFile(bytes));
      expect(firstByteDifference(written, bytes), `${path} differs`).toBe(-1);
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });
});
