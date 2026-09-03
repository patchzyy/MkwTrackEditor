/**
 * End-to-end checks for the Kinoko WASM runtime.
 *
 * These need real game data: `public/data/MarioKartWii/Race/Common.szs` (committed) plus at least
 * one course archive. Course archives are not in the repository, so the suite looks in
 * `public/dev-tracks/` first and then falls back to the local Dolphin track folders described in
 * `src/lib/realTrackFixtures.testdata.ts`; if nothing turns up it skips, the same way
 * `kcl.test.ts` does.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createKinokoRuntime } from './kinokoRuntime';
import {
  DEFAULT_PLAYTEST_COURSE_OPTIONS,
  NEUTRAL_PLAYTEST_INPUT,
  PlaytestError,
  type PlaytestInput,
  type PlaytestRuntime,
} from './types';
import { listTracks, NINTENDO_TRACK_DIR, CUSTOM_TRACK_DIR } from '../realTrackFixtures.testdata';

const COMMON_PATH = 'public/data/MarioKartWii/Race/Common.szs';
const WASM_PATH = 'src/lib/playtest/wasm/kinoko.wasm';

/** First existing path, or null. */
function pick(...candidates: (string | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

const nintendoTrack = pick(
  join('public', 'dev-tracks', 'nintendo_1.szs'),
  listTracks(NINTENDO_TRACK_DIR, 1)[0],
);
const customTrack = pick(join('public', 'dev-tracks', 'Z0.szs'), listTracks(CUSTOM_TRACK_DIR, 1)[0]);

const haveFixtures = existsSync(COMMON_PATH) && existsSync(WASM_PATH) && nintendoTrack !== null;

const read = (path: string) => new Uint8Array(readFileSync(path));

async function makeRuntime(): Promise<PlaytestRuntime> {
  const wasm = readFileSync(WASM_PATH);
  return createKinokoRuntime({
    commonArchive: read(COMMON_PATH),
    // Node cannot resolve Vite's `?url` asset path, so hand the bytes over directly.
    wasmBinary: new Uint8Array(wasm),
    onLog: () => {},
  });
}

function input(overrides: Partial<PlaytestInput>): PlaytestInput {
  return { ...NEUTRAL_PLAYTEST_INPUT, ...overrides };
}

describe.skipIf(!haveFixtures)('kinokoRuntime', () => {
  it('simulates a retail course and reaches racing speed', async () => {
    const runtime = await makeRuntime();
    try {
      runtime.loadCourse(read(nintendoTrack!), DEFAULT_PLAYTEST_COURSE_OPTIONS);

      const start = runtime.readKartState();
      const startPos = { ...start.position };
      expect(runtime.readRaceState().stage).toBe('intro');
      expect(start.wheelPositions.length).toBeGreaterThanOrEqual(2);

      runtime.setInput(input({ accelerate: true }));

      const stages = new Set<string>();
      const timings: number[] = [];
      const step = () => {
        const t0 = performance.now();
        runtime.step();
        timings.push(performance.now() - t0);
        stages.add(runtime.readRaceState().stage);
      };

      // The intro runs 172 frames and the countdown another 240; step through both first.
      let introFrames = 0;
      while (runtime.readRaceState().stage !== 'race' && introFrames < 600) {
        step();
        introFrames++;
      }
      expect(introFrames).toBeLessThan(600);

      const RACING_FRAMES = 600;
      for (let i = 0; i < RACING_FRAMES; i++) step();

      const average = timings.reduce((sum, ms) => sum + ms, 0) / timings.length;
      console.log(`kinoko step(): ${average.toFixed(4)} ms/frame over ${timings.length} frames`);

      expect([...stages]).toEqual(expect.arrayContaining(['intro', 'countdown', 'race']));

      const end = runtime.readKartState();
      const distance = Math.hypot(
        end.position.x - startPos.x,
        end.position.y - startPos.y,
        end.position.z - startPos.z,
      );
      expect(distance).toBeGreaterThan(2000);
      expect(end.speed).toBeGreaterThan(0);
      expect(Number.isFinite(end.rotation.w)).toBe(true);

      const race = runtime.readRaceState();
      expect(race.frame).toBe(introFrames + RACING_FRAMES);
      expect(race.stage).toBe('race');
      expect(race.timeMs).toBeGreaterThan(0);
      expect(race.lap).toBeGreaterThanOrEqual(1);
      expect(race.maxLap).toBeGreaterThanOrEqual(1);

      const camera = runtime.readCameraState();
      expect(camera).not.toBeNull();
      expect(camera!.fovY).toBeGreaterThan(0);
      // The chase camera sits behind the kart, so it is near it but not on top of it.
      const cameraDistance = Math.hypot(
        camera!.position.x - end.position.x,
        camera!.position.y - end.position.y,
        camera!.position.z - end.position.z,
      );
      expect(cameraDistance).toBeGreaterThan(0);
      expect(cameraDistance).toBeLessThan(20000);

      runtime.restart();
      const restarted = runtime.readKartState();
      expect(runtime.readRaceState().frame).toBe(0);
      expect(runtime.readRaceState().stage).toBe('intro');
      const restartDelta = Math.hypot(
        restarted.position.x - startPos.x,
        restarted.position.y - startPos.y,
        restarted.position.z - startPos.z,
      );
      expect(restartDelta).toBeLessThan(1);
    } finally {
      runtime.dispose();
    }

    expect(runtime.disposed).toBe(true);
    expect(() => runtime.step()).toThrow(PlaytestError);
  }, 120_000);

  it.skipIf(!customTrack)('simulates a custom track', async () => {
    const runtime = await makeRuntime();
    try {
      runtime.loadCourse(read(customTrack!), DEFAULT_PLAYTEST_COURSE_OPTIONS);
      runtime.setInput(input({ accelerate: true }));

      const start = { ...runtime.readKartState().position };
      for (let i = 0; i < 1100; i++) runtime.step();
      const end = runtime.readKartState();

      const distance = Math.hypot(
        end.position.x - start.x,
        end.position.y - start.y,
        end.position.z - start.z,
      );
      expect(distance).toBeGreaterThan(2000);
      expect(runtime.readRaceState().stage).toBe('race');
    } finally {
      runtime.dispose();
    }
  }, 120_000);

  it('quantizes stick input instead of rejecting it', async () => {
    const runtime = await makeRuntime();
    try {
      runtime.loadCourse(read(nintendoTrack!), DEFAULT_PLAYTEST_COURSE_OPTIONS);
      // 0.31 is not one of the 15 legal stick positions; the runtime has to round it to 0.2857.
      runtime.setInput(input({ accelerate: true, stickX: 0.31, stickY: -1.7, trick: 'up' }));
      for (let i = 0; i < 480; i++) runtime.step();
      expect(runtime.readRaceState().stage).not.toBe('intro');
      expect(Number.isFinite(runtime.readKartState().speed)).toBe(true);
    } finally {
      runtime.dispose();
    }
  }, 120_000);

  it('rejects an archive that is not a Yaz0 .szs without breaking the module', async () => {
    const runtime = await makeRuntime();
    try {
      const garbage = new Uint8Array(4096);
      for (let i = 0; i < garbage.length; i++) garbage[i] = (i * 37) & 0xff;

      expect(() => runtime.loadCourse(garbage, DEFAULT_PLAYTEST_COURSE_OPTIONS)).toThrow(
        PlaytestError,
      );
      // The module never ran, so the runtime is still usable for a real course.
      expect(runtime.disposed).toBe(false);

      runtime.loadCourse(read(nintendoTrack!), DEFAULT_PLAYTEST_COURSE_OPTIONS);
      runtime.step();
      expect(runtime.readRaceState().frame).toBe(1);
    } finally {
      runtime.dispose();
    }
  }, 120_000);

  it('turns a trap on malformed Yaz0 data into a PlaytestError and marks itself disposed', async () => {
    const runtime = await makeRuntime();
    try {
      // A valid Yaz0 header in front of noise: Kinoko decompresses it and then asserts on the
      // archive signature, which calls abort() inside the WASM module.
      const fake = new Uint8Array(8192);
      fake.set([0x59, 0x61, 0x7a, 0x30]);
      // Expanded size 0x1000, big-endian.
      fake[4] = 0x00;
      fake[5] = 0x00;
      fake[6] = 0x10;
      fake[7] = 0x00;
      for (let i = 0x10; i < fake.length; i++) fake[i] = 0xff;

      expect(() => runtime.loadCourse(fake, DEFAULT_PLAYTEST_COURSE_OPTIONS)).toThrow(PlaytestError);
      expect(runtime.disposed).toBe(true);
      expect(() => runtime.step()).toThrow(PlaytestError);
    } finally {
      runtime.dispose();
    }
  }, 120_000);
});
