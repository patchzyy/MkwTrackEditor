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

import {
  createKinokoRuntime,
  packPlaytestButtons,
  PLAYTEST_BUTTON_ACCELERATE,
  PLAYTEST_BUTTON_BRAKE,
  PLAYTEST_BUTTON_DRIFT,
  PLAYTEST_BUTTON_ITEM,
} from './kinokoRuntime';
import {
  DEFAULT_PLAYTEST_COURSE_OPTIONS,
  NEUTRAL_PLAYTEST_INPUT,
  PlaytestError,
  type PlaytestInput,
  type PlaytestRuntime,
} from './types';
import { listTracks, NINTENDO_TRACK_DIR, CUSTOM_TRACK_DIR } from '../realTrackFixtures.testdata';
import { decodeYaz0 } from '../yaz0';

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

describe('packPlaytestButtons', () => {
  it("packs the four logical buttons into Kinoko's bitmask", () => {
    expect(packPlaytestButtons(input({}))).toBe(0);
    expect(packPlaytestButtons(input({ accelerate: true }))).toBe(PLAYTEST_BUTTON_ACCELERATE);
    expect(packPlaytestButtons(input({ brake: true }))).toBe(PLAYTEST_BUTTON_BRAKE);
    expect(packPlaytestButtons(input({ item: true }))).toBe(PLAYTEST_BUTTON_ITEM);
  });

  it('raises the brake bit for the hop button, because the game has one button for both', () => {
    // `RaceInputState` bit 0x2 is "Braking/Drifting"; 0x8 only says it happened while
    // accelerating. A hop that does not set 0x2 can neither brake nor charge a stand-still
    // mini-turbo (`KartMove::calcSsmtStart` needs Accelerate + Brake).
    expect(packPlaytestButtons(input({ drift: true }))).toBe(
      PLAYTEST_BUTTON_BRAKE | PLAYTEST_BUTTON_DRIFT,
    );
    expect(packPlaytestButtons(input({ accelerate: true, drift: true }))).toBe(
      PLAYTEST_BUTTON_ACCELERATE | PLAYTEST_BUTTON_BRAKE | PLAYTEST_BUTTON_DRIFT,
    );
    // Brake and hop together are still just those bits; nothing double-counts.
    expect(packPlaytestButtons(input({ accelerate: true, brake: true, drift: true }))).toBe(
      PLAYTEST_BUTTON_ACCELERATE | PLAYTEST_BUTTON_BRAKE | PLAYTEST_BUTTON_DRIFT,
    );
  });

  it('never sets a bit outside the low nibble that RaceInputState validates', () => {
    const all = packPlaytestButtons(
      input({ accelerate: true, brake: true, item: true, drift: true }),
    );
    expect(all & ~0xf).toBe(0);
    expect(all).toBe(0xf);
  });
});

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

  it('accepts a bare U8 archive, which is what exportTrack({ compress: false }) produces', async () => {
    const runtime = await makeRuntime();
    try {
      runtime.loadCourse(decodeYaz0(read(nintendoTrack!)), DEFAULT_PLAYTEST_COURSE_OPTIONS);
      runtime.step();
      expect(runtime.readRaceState().frame).toBe(1);
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

  it('charges a stand-still mini-turbo from the hop button alone', async () => {
    const runtime = await makeRuntime();
    try {
      runtime.loadCourse(read(nintendoTrack!), DEFAULT_PLAYTEST_COURSE_OPTIONS);

      // Sit still through the intro and the countdown.
      runtime.setInput(input({}));
      let guard = 0;
      while (runtime.readRaceState().stage !== 'race' && guard++ < 600) runtime.step();
      expect(runtime.readRaceState().stage).toBe('race');

      // Accelerate + hop at a standstill: this is the stand-still mini-turbo in the real game.
      runtime.setInput(input({ accelerate: true, drift: true }));
      for (let i = 0; i < 90; i++) runtime.step();

      const charging = runtime.readKartState();
      expect(charging.miniTurbo.kind).toBe('standstill');
      expect(charging.miniTurbo.level).toBe(1);
      expect(Math.abs(charging.speed)).toBeLessThan(10);

      // Releasing the hop button fires the boost.
      runtime.setInput(input({ accelerate: true }));
      let boosted = false;
      let peak = 0;
      for (let i = 0; i < 30; i++) {
        runtime.step();
        const state = runtime.readKartState();
        boosted ||= state.boosting;
        peak = Math.max(peak, state.speed);
      }
      expect(boosted).toBe(true);
      expect(peak).toBeGreaterThan(30);
    } finally {
      runtime.dispose();
    }
  }, 120_000);

  it('still hops and drifts with the same button while moving', async () => {
    const runtime = await makeRuntime();
    try {
      runtime.loadCourse(read(nintendoTrack!), DEFAULT_PLAYTEST_COURSE_OPTIONS);

      runtime.setInput(input({ accelerate: true }));
      let guard = 0;
      while (runtime.readRaceState().stage !== 'race' && guard++ < 600) runtime.step();
      // Holding accelerate through the whole countdown burns out, which costs about 100 frames;
      // give the kart time to actually get going before measuring the cruising speed.
      for (let i = 0; i < 300; i++) runtime.step();
      const cruising = runtime.readKartState().speed;
      expect(cruising).toBeGreaterThan(20);

      // Hop and hold a left drift: the extra brake bit must not stop the kart.
      runtime.setInput(input({ accelerate: true, drift: true, stickX: -1 }));
      let drifted = false;
      let chargedLevel = -1;
      let speedIntoDrift = 0;
      // 60 frames is long enough to hop, land, drift and charge a blue mini-turbo, and short
      // enough that a hard lock does not put the kart into the scenery on every course.
      for (let i = 0; i < 60; i++) {
        runtime.step();
        const state = runtime.readKartState();
        drifted ||= state.drifting;
        if (state.miniTurbo.kind === 'drift') chargedLevel = Math.max(chargedLevel, state.miniTurbo.level);
        if (i === 20) {
          speedIntoDrift = state.speed;
          // Mid-drift the kart is fast, so accelerate beats the brake bit and the charge is a
          // drift mini-turbo, not a stand-still one. (Once a wall stops the kart, accelerate +
          // hop legitimately becomes a stand-still charge again, so only check while moving.)
          expect(state.miniTurbo.kind).not.toBe('standstill');
        }
      }
      expect(drifted).toBe(true);
      expect(chargedLevel).toBeGreaterThanOrEqual(0);
      expect(speedIntoDrift).toBeGreaterThan(cruising * 0.5);
    } finally {
      runtime.dispose();
    }
  }, 120_000);
});
