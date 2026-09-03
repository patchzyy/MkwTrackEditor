import { describe, expect, it } from 'vitest';
import { buildU8, type U8Entry } from '../u8';
import { PlaytestError, DEFAULT_PLAYTEST_COURSE_OPTIONS, PLAYTEST_VEHICLES } from './types';
import {
  MOCK_INTRO_FRAMES,
  MOCK_RACE_START_FRAME,
  createMockPlaytestRuntime,
  quatFromKmpRotation,
} from './mockRuntime';
import { rotateByQuat } from '../../ui/playtest/playtestChaseCamera';

/**
 * A hand-built two-section KMP: one start point and one stage record. Small enough to keep the
 * test hermetic (no real track needed) and exactly what the mock runtime reads.
 */
function buildTestKmp({ position, rotationY, lapCount }: { position: [number, number, number]; rotationY: number; lapCount: number }): Uint8Array {
  const headerSize = 0x18;
  const ktptRecord = 0x1c;
  const stgiRecord = 0x0c;
  const total = headerSize + 8 + ktptRecord + 8 + stgiRecord;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };

  ascii(0, 'RKMD');
  view.setUint32(0x04, total);
  view.setUint16(0x08, 2);
  view.setUint16(0x0a, headerSize);
  view.setUint32(0x0c, 0x9d8);
  view.setUint32(0x10, 0);
  view.setUint32(0x14, 8 + ktptRecord);

  const ktpt = headerSize;
  ascii(ktpt, 'KTPT');
  view.setUint16(ktpt + 4, 1);
  view.setUint16(ktpt + 6, 0);
  const record = ktpt + 8;
  view.setFloat32(record + 0x00, position[0]);
  view.setFloat32(record + 0x04, position[1]);
  view.setFloat32(record + 0x08, position[2]);
  view.setFloat32(record + 0x0c, 0);
  view.setFloat32(record + 0x10, rotationY);
  view.setFloat32(record + 0x14, 0);
  view.setInt16(record + 0x18, -1);

  const stgi = record + ktptRecord;
  ascii(stgi, 'STGI');
  view.setUint16(stgi + 4, 1);
  view.setUint16(stgi + 6, 0);
  bytes[stgi + 8] = lapCount;
  return bytes;
}

function buildTestArchive(kmp: Uint8Array, { withKcl = true } = {}): Uint8Array {
  const entries: U8Entry[] = [
    { type: 'dir', path: '' },
    { type: 'file', path: 'course.kmp', data: kmp },
  ];
  if (withKcl) entries.push({ type: 'file', path: 'course.kcl', data: new Uint8Array(64) });
  return buildU8(entries);
}

const START: [number, number, number] = [1000, 250, -4000];

async function makeRuntime(archive: Uint8Array, options = DEFAULT_PLAYTEST_COURSE_OPTIONS) {
  const runtime = await createMockPlaytestRuntime({ commonArchive: new Uint8Array(4), onLog: () => {} });
  runtime.loadCourse(archive, options);
  return runtime;
}

describe('mock playtest runtime', () => {
  it('starts on the first KTPT, facing the way it points', async () => {
    const archive = buildTestArchive(buildTestKmp({ position: START, rotationY: 90, lapCount: 3 }));
    const runtime = await makeRuntime(archive);

    const kart = runtime.readKartState();
    expect(kart.position).toEqual({ x: START[0], y: START[1], z: START[2] });
    expect(kart.speed).toBe(0);
    // Yaw 90 degrees means the kart faces +X.
    const forward = rotateByQuat(kart.rotation, { x: 0, y: 0, z: 1 });
    expect(forward.x).toBeCloseTo(1, 5);
    expect(forward.z).toBeCloseTo(0, 5);
    // ...and it matches the quaternion the euler helper produces for the same rotation.
    expect(kart.rotation).toEqual(quatFromKmpRotation({ x: 0, y: 90, z: 0 }));
    runtime.dispose();
  });

  it('reads the lap count from STGI', async () => {
    const runtime = await makeRuntime(buildTestArchive(buildTestKmp({ position: START, rotationY: 0, lapCount: 5 })));
    expect(runtime.readRaceState().maxLap).toBe(5);
    runtime.dispose();
  });

  it('walks intro -> countdown -> race and only then runs the timer', async () => {
    const runtime = await makeRuntime(buildTestArchive(buildTestKmp({ position: START, rotationY: 0, lapCount: 3 })));
    expect(runtime.readRaceState().stage).toBe('intro');

    for (let i = 0; i < MOCK_INTRO_FRAMES; i++) runtime.step();
    expect(runtime.readRaceState().stage).toBe('countdown');
    expect(runtime.readRaceState().timeMs).toBe(0);

    for (let i = runtime.readRaceState().frame; i < MOCK_RACE_START_FRAME; i++) runtime.step();
    const atStart = runtime.readRaceState();
    expect(atStart.stage).toBe('race');
    expect(atStart.timeMs).toBe(0);
    expect(atStart.lap).toBe(1);

    for (let i = 0; i < 60; i++) runtime.step();
    expect(runtime.readRaceState().timeMs).toBeCloseTo(1000, 6);
    expect(runtime.readRaceState().lap).toBe(1);
    runtime.dispose();
  });

  it('ignores input until the flag drops, then accelerates forward', async () => {
    const runtime = await makeRuntime(buildTestArchive(buildTestKmp({ position: START, rotationY: 0, lapCount: 3 })));
    runtime.setInput({ accelerate: true, brake: false, item: false, drift: false, stickX: 0, stickY: 0, trick: 'none' });

    // The last countdown frame: still stationary.
    for (let i = 0; i < MOCK_RACE_START_FRAME - 1; i++) runtime.step();
    expect(runtime.readRaceState().stage).toBe('countdown');
    expect(runtime.readKartState().position.z).toBe(START[2]);

    for (let i = 0; i < 121; i++) runtime.step();
    const moving = runtime.readKartState();
    // Yaw 0 faces +Z, so the kart has moved forward along +Z and nowhere else.
    expect(moving.speed).toBeGreaterThan(3);
    expect(moving.position.z).toBeGreaterThan(START[2] + 100);
    expect(moving.position.x).toBeCloseTo(START[0], 5);
    expect(moving.position.y).toBeCloseTo(START[1], 5);
    expect(moving.velocity.z).toBeCloseTo(moving.speed, 5);
    runtime.dispose();
  });

  it('brakes back to a standstill', async () => {
    const runtime = await makeRuntime(buildTestArchive(buildTestKmp({ position: START, rotationY: 0, lapCount: 3 })));
    runtime.setInput({ accelerate: true, brake: false, item: false, drift: false, stickX: 0, stickY: 0, trick: 'none' });
    for (let i = 0; i < MOCK_RACE_START_FRAME + 120; i++) runtime.step();
    expect(runtime.readKartState().speed).toBeGreaterThan(3);

    runtime.setInput({ accelerate: false, brake: true, item: false, drift: false, stickX: 0, stickY: 0, trick: 'none' });
    for (let i = 0; i < 120; i++) runtime.step();
    expect(runtime.readKartState().speed).toBe(0);
    runtime.dispose();
  });

  it('steers: the stick turns the kart, and it only turns while it is moving', async () => {
    const archive = buildTestArchive(buildTestKmp({ position: START, rotationY: 0, lapCount: 3 }));
    const headingAfterSteering = async (stickX: number) => {
      const runtime = await makeRuntime(archive);
      runtime.setInput({ accelerate: true, brake: false, item: false, drift: false, stickX: 0, stickY: 0, trick: 'none' });
      for (let i = 0; i < MOCK_RACE_START_FRAME + 120; i++) runtime.step();
      runtime.setInput({ accelerate: true, brake: false, item: false, drift: false, stickX, stickY: 0, trick: 'none' });
      for (let i = 0; i < 20; i++) runtime.step();
      const forward = rotateByQuat(runtime.readKartState().mainRotation, { x: 0, y: 0, z: 1 });
      runtime.dispose();
      return forward;
    };

    // Yaw 0 faces +Z; right turns the nose towards +X and left towards -X.
    expect((await headingAfterSteering(1)).x).toBeGreaterThan(0.2);
    expect((await headingAfterSteering(-1)).x).toBeLessThan(-0.2);

    // A parked kart does not pivot on the spot.
    const parked = await makeRuntime(archive);
    parked.setInput({ accelerate: false, brake: false, item: false, drift: false, stickX: 1, stickY: 0, trick: 'none' });
    for (let i = 0; i < MOCK_RACE_START_FRAME + 60; i++) parked.step();
    expect(rotateByQuat(parked.readKartState().mainRotation, { x: 0, y: 0, z: 1 }).x).toBeCloseTo(0, 6);
    parked.dispose();
  });

  it('restart puts the kart back on the start line', async () => {
    const runtime = await makeRuntime(buildTestArchive(buildTestKmp({ position: START, rotationY: 0, lapCount: 3 })));
    runtime.setInput({ accelerate: true, brake: false, item: false, drift: false, stickX: 0, stickY: 0, trick: 'none' });
    for (let i = 0; i < MOCK_RACE_START_FRAME + 120; i++) runtime.step();
    runtime.restart();

    const kart = runtime.readKartState();
    const race = runtime.readRaceState();
    expect(kart.position).toEqual({ x: START[0], y: START[1], z: START[2] });
    expect(kart.speed).toBe(0);
    expect(race.frame).toBe(0);
    expect(race.stage).toBe('intro');
    runtime.dispose();
  });

  it('reports four wheels for a kart and two for a bike', async () => {
    const archive = buildTestArchive(buildTestKmp({ position: START, rotationY: 0, lapCount: 3 }));
    const kart = await makeRuntime(archive, { ...DEFAULT_PLAYTEST_COURSE_OPTIONS, vehicle: PLAYTEST_VEHICLES.Standard_Kart_M });
    expect(kart.readKartState().wheelPositions).toHaveLength(4);
    kart.dispose();

    const bike = await makeRuntime(archive, { ...DEFAULT_PLAYTEST_COURSE_OPTIONS, vehicle: PLAYTEST_VEHICLES.Mach_Bike });
    expect(bike.readKartState().wheelPositions).toHaveLength(2);
    bike.dispose();
  });

  it('has no camera of its own, so the UI falls back to its chase camera', async () => {
    const runtime = await makeRuntime(buildTestArchive(buildTestKmp({ position: START, rotationY: 0, lapCount: 3 })));
    expect(runtime.readCameraState()).toBeNull();
    runtime.dispose();
  });

  it('refuses an archive with no collision mesh, and one with no start point', async () => {
    const noKcl = buildTestArchive(buildTestKmp({ position: START, rotationY: 0, lapCount: 3 }), { withKcl: false });
    const runtime = await createMockPlaytestRuntime({ commonArchive: new Uint8Array(4), onLog: () => {} });
    expect(() => runtime.loadCourse(noKcl, DEFAULT_PLAYTEST_COURSE_OPTIONS)).toThrow(PlaytestError);

    const noStart = buildTestKmp({ position: START, rotationY: 0, lapCount: 3 });
    new DataView(noStart.buffer).setUint16(0x18 + 4, 0); // KTPT count = 0
    expect(() => runtime.loadCourse(buildTestArchive(noStart), DEFAULT_PLAYTEST_COURSE_OPTIONS)).toThrow(/start position/i);
    runtime.dispose();
  });

  it('cannot be used after dispose', async () => {
    const runtime = await makeRuntime(buildTestArchive(buildTestKmp({ position: START, rotationY: 0, lapCount: 3 })));
    runtime.dispose();
    expect(runtime.disposed).toBe(true);
    expect(() => runtime.step()).toThrow(PlaytestError);
  });
});
