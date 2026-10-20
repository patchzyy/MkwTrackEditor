/**
 * Drives the real Mario Kart Wii physics (Kinoko, compiled to WebAssembly) on a track made
 * entirely of generated files: the KCL from `buildKcl`, a KMP from the editor's own writer and a
 * course model from `buildModelBrres`. If any of those were wrong the kart would fall through the
 * floor, stick to walls or never leave the line.
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { writeKmpFile } from '../../kmpFile';
import { createKinokoRuntime } from '../../playtest/kinokoRuntime';
import { DEFAULT_PLAYTEST_COURSE_OPTIONS, NEUTRAL_PLAYTEST_INPUT, type PlaytestInput, type PlaytestKartState, type PlaytestRuntime } from '../../playtest/types';
import { buildU8 } from '../../u8';
import { encodeYaz0Uncompressed } from '../../yaz0';
import { buildKcl } from './kclWriter';
import { buildModelBrres } from './modelWriter';
import { buildStadium, buildStadiumKmp, type Stadium } from './stadiumFixture.testdata';
import { commonMaterial } from './writerFixtures.testdata';

const COMMON_PATH = 'public/data/MarioKartWii/Race/Common.szs';
const WASM_PATH = 'src/lib/playtest/wasm/kinoko.wasm';
const haveRuntime = existsSync(COMMON_PATH) && existsSync(WASM_PATH);

function packTrack(stadium: Stadium, startS: number): Uint8Array {
  const model = buildModelBrres({
    modelName: 'course',
    meshes: stadium.meshes,
    materials: [
      commonMaterial('kinoko.brres', 'kinoko', 'kinoko', 'road'),
      commonMaterial('kinoko.brres', 'kinoko', 'kinoko', 'wall'),
    ],
    copyAnimations: false,
  });
  const entries = [
    { type: 'dir' as const, path: '' },
    { type: 'file' as const, path: 'course.kmp', data: writeKmpFile(buildStadiumKmp(stadium, startS)) },
    { type: 'file' as const, path: 'course.kcl', data: buildKcl(stadium.collision) },
    { type: 'file' as const, path: 'course_model.brres', data: model },
  ];
  return encodeYaz0Uncompressed(buildU8(entries));
}

async function makeRuntime(): Promise<PlaytestRuntime> {
  return createKinokoRuntime({
    commonArchive: new Uint8Array(readFileSync(COMMON_PATH)),
    wasmBinary: new Uint8Array(readFileSync(WASM_PATH)),
    onLog: () => {},
  });
}

function rotate(q: { x: number; y: number; z: number; w: number }, v: [number, number, number]): [number, number, number] {
  // v' = v + 2 q.xyz x (q.xyz x v + w v)
  const [x, y, z] = v;
  const tx = q.y * z - q.z * y + q.w * x;
  const ty = q.z * x - q.x * z + q.w * y;
  const tz = q.x * y - q.y * x + q.w * z;
  return [x + 2 * (q.y * tz - q.z * ty), y + 2 * (q.z * tx - q.x * tz), z + 2 * (q.x * ty - q.y * tx)];
}

interface DriveLog {
  frames: number;
  maxSpeed: number;
  minY: number;
  maxY: number;
  maxStep: number;
  airborneFrames: number;
  /** Furthest the kart ever was from the road centre line, as a fraction of the half width. */
  maxOffCentre: number;
  lastState: PlaytestKartState;
  lapProgress: number;
}

/** Pure-pursuit driver: aim at a point a little ahead on the centre line. */
function drive(
  runtime: PlaytestRuntime,
  stadium: Stadium,
  frames: number,
  hooks: { onFrame?: (state: PlaytestKartState, frame: number) => void } = {},
): DriveLog {
  const log: DriveLog = {
    frames: 0, maxSpeed: 0, minY: Infinity, maxY: -Infinity, maxStep: 0, airborneFrames: 0, maxOffCentre: 0,
    lastState: runtime.readKartState(), lapProgress: 0,
  };
  let previous = { ...runtime.readKartState().position };
  let sHint = 0;
  for (let frame = 0; frame < frames; frame++) {
    const state = runtime.readKartState();
    // Nearest centre-line sample (searching forward from the last one, wrapping).
    let best = Infinity;
    let bestS = sHint;
    for (const p of stadium.centerline) {
      const d = Math.hypot(p.x - state.position.x, p.z - state.position.z);
      if (d < best) { best = d; bestS = p.s; }
    }
    sHint = bestS;
    const target = stadium.at(bestS + 700);
    const forward = rotate(state.rotation, [0, 0, 1]);
    const toX = target.x - state.position.x, toZ = target.z - state.position.z;
    const toLength = Math.hypot(toX, toZ) || 1;
    const fLength = Math.hypot(forward[0], forward[2]) || 1;
    // Right of heading (hx, hz) is (-hz, hx).
    const rightDot = (toX / toLength) * (-forward[2] / fLength) + (toZ / toLength) * (forward[0] / fLength);
    const forwardDot = (toX / toLength) * (forward[0] / fLength) + (toZ / toLength) * (forward[2] / fLength);
    const steer = Math.max(-1, Math.min(1, Math.atan2(rightDot, forwardDot) * 1.6));
    const input: PlaytestInput = { ...NEUTRAL_PLAYTEST_INPUT, accelerate: true, stickX: steer };
    runtime.setInput(input);
    runtime.step();
    const after = runtime.readKartState();
    hooks.onFrame?.(after, frame);

    log.frames++;
    log.maxSpeed = Math.max(log.maxSpeed, after.speed);
    log.minY = Math.min(log.minY, after.position.y);
    log.maxY = Math.max(log.maxY, after.position.y);
    log.maxStep = Math.max(log.maxStep, Math.hypot(after.position.x - previous.x, after.position.y - previous.y, after.position.z - previous.z));
    if (after.airborne) log.airborneFrames++;
    log.maxOffCentre = Math.max(log.maxOffCentre, best / (stadium.options.roadWidth / 2));
    log.lastState = after;
    previous = { ...after.position };
  }
  return log;
}

function skipToRace(runtime: PlaytestRuntime): void {
  let guard = 0;
  while (runtime.readRaceState().stage !== 'race' && guard++ < 700) runtime.step();
  expect(runtime.readRaceState().stage).toBe('race');
}

describe.skipIf(!haveRuntime)('Kinoko on generated tracks', () => {
  it('keeps a kart on a generated stadium for ten seconds, in the lane, without respawning', async () => {
    const stadium = buildStadium({ straight: 8000, radius: 2000, roadWidth: 2500, wallHeight: 400 });
    const startS = 1000;
    const runtime = await makeRuntime();
    try {
      runtime.loadCourse(packTrack(stadium, startS), DEFAULT_PLAYTEST_COURSE_OPTIONS);
      const start = runtime.readKartState();
      expect(Math.abs(start.position.y)).toBeLessThan(300);
      skipToRace(runtime);
      const log = drive(runtime, stadium, 600);

      // On the ground the whole time, at road height.
      expect(log.minY).toBeGreaterThan(-60);
      expect(log.maxY).toBeLessThan(150);
      // No teleports (a respawn would jump hundreds of units in one frame).
      expect(log.maxStep).toBeLessThan(200);
      // A real racing speed, and the kart actually travelled round the track.
      expect(log.maxSpeed).toBeGreaterThan(40);
      expect(log.maxOffCentre).toBeLessThan(1);
      const travelled = Math.hypot(log.lastState.position.x - start.position.x, log.lastState.position.z - start.position.z);
      expect(travelled).toBeGreaterThan(3000);
      expect(log.airborneFrames).toBeLessThan(30);
    } finally {
      runtime.dispose();
    }
  }, 120_000);

  it('collides with generated walls instead of leaving the track', async () => {
    const stadium = buildStadium({ straight: 8000, radius: 2000, roadWidth: 2500, wallHeight: 400 });
    const runtime = await makeRuntime();
    try {
      runtime.loadCourse(packTrack(stadium, 1000), DEFAULT_PLAYTEST_COURSE_OPTIONS);
      skipToRace(runtime);
      // Floor it and steer hard right (into the inner wall on the straight, then out of the lane).
      runtime.setInput({ ...NEUTRAL_PLAYTEST_INPUT, accelerate: true, stickX: 1 });
      let minY = Infinity;
      let maxDistance = 0;
      const start = runtime.readKartState().position;
      for (let i = 0; i < 400; i++) {
        runtime.step();
        const state = runtime.readKartState();
        minY = Math.min(minY, state.position.y);
        // Distance from the stadium centre line: the ring plus walls bound the kart.
        let nearest = Infinity;
        for (const p of stadium.centerline) nearest = Math.min(nearest, Math.hypot(p.x - state.position.x, p.z - state.position.z));
        maxDistance = Math.max(maxDistance, nearest);
      }
      expect(Number.isFinite(runtime.readKartState().position.x)).toBe(true);
      expect(minY).toBeGreaterThan(-100); // never fell through the floor
      expect(maxDistance).toBeLessThan(stadium.options.roadWidth / 2 + 300); // never got past the wall
      void start;
    } finally {
      runtime.dispose();
    }
  }, 120_000);

  it('speeds the kart up on a generated boost panel', async () => {
    const boost: [number, number] = [4000, 6000];
    const stadium = buildStadium({ straight: 8000, radius: 2000, roadWidth: 2500, wallHeight: 400, boost });
    const plain = buildStadium({ straight: 8000, radius: 2000, roadWidth: 2500, wallHeight: 400 });

    const run = async (track: Stadium): Promise<{ speedAt: (s: number) => number; peak: number; speeds: Array<[number, number]> }> => {
      const runtime = await makeRuntime();
      try {
        runtime.loadCourse(packTrack(track, 600), DEFAULT_PLAYTEST_COURSE_OPTIONS);
        skipToRace(runtime);
        const speeds: Array<[number, number]> = [];
        let peak = 0;
        drive(runtime, track, 320, {
          onFrame: (state) => {
            // Arc length of the kart along the bottom straight.
            speeds.push([state.position.x + 4000, state.speed]);
            peak = Math.max(peak, state.speed);
          },
        });
        return { speedAt: (s) => speeds.reduce((best, entry) => (Math.abs(entry[0] - s) < Math.abs(best[0] - s) ? entry : best), speeds[0])[1], peak, speeds };
      } finally {
        runtime.dispose();
      }
    };

    const boosted = await run(stadium);
    const reference = await run(plain);
    // Compare the speed just after the panel to the same place on the plain road.
    const afterPanel = boost[1] + 400;
    expect(boosted.speedAt(afterPanel)).toBeGreaterThan(reference.speedAt(afterPanel) + 8);
    expect(boosted.peak).toBeGreaterThan(reference.peak + 8);
  }, 180_000);
});
