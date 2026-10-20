/**
 * Test helper: drives a track in Kinoko with a pursuit controller that follows a polyline (the
 * generated enemy route). Used by the compile integration tests.
 */
import { readFileSync } from 'node:fs';
import { createKinokoRuntime } from '../../playtest/kinokoRuntime';
import {
  DEFAULT_PLAYTEST_COURSE_OPTIONS,
  NEUTRAL_PLAYTEST_INPUT,
  type PlaytestRuntime,
} from '../../playtest/types';

export interface DrivePoint {
  x: number;
  y?: number;
  z: number;
}

export interface DriveOptions {
  /** Stop after this many racing frames. */
  maxRaceFrames?: number;
  /** Stop as soon as this lap number is reached (1-based lap counter after crossing the line). */
  stopAtLap?: number;
  lookahead?: number;
  steerGain?: number;
  /** Flip if the kart steers away from the route. */
  steerSign?: 1 | -1;
}

export interface DriveResult {
  finalLap: number;
  maxLap: number;
  raceFrames: number;
  respawns: number;
  timeMs: number;
  lapSplitsMs: number[];
  /** Maximum distance from the closest route segment seen. */
  maxOffRoute: number;
  stage: string;
  distance: number;
  /** Highest speed seen (units per frame); boost pads and ramps push it well above cruising speed. */
  maxSpeed: number;
  /** Frames where the kart was further than `offRouteLimit` from the route. */
  trace: Array<{ frame: number; x: number; z: number; lap: number; speed: number }>;
}

export async function makeRuntime(): Promise<PlaytestRuntime> {
  const wasm = readFileSync('src/lib/playtest/wasm/kinoko.wasm');
  return createKinokoRuntime({
    commonArchive: new Uint8Array(readFileSync('public/data/MarioKartWii/Race/Common.szs')),
    wasmBinary: new Uint8Array(wasm),
    onLog: () => {},
  });
}

function yawOfVelocity(vx: number, vz: number): number {
  return Math.atan2(vx, vz);
}

/** Drives `archive` around `route` (a closed polyline of world positions). */
export function driveRoute(runtime: PlaytestRuntime, archive: Uint8Array, route: DrivePoint[], options: DriveOptions = {}): DriveResult {
  runtime.loadCourse(archive, { ...DEFAULT_PLAYTEST_COURSE_OPTIONS });
  const lookaheadBase = options.lookahead ?? 2600;
  const gain = options.steerGain ?? 2.2;
  const sign = options.steerSign ?? -1;
  const maxRace = options.maxRaceFrames ?? 60 * 240;
  const n = route.length;

  let guard = 0;
  runtime.setInput({ ...NEUTRAL_PLAYTEST_INPUT });
  while (runtime.readRaceState().stage !== 'race' && guard++ < 1200) runtime.step();
  runtime.setInput({ ...NEUTRAL_PLAYTEST_INPUT, accelerate: true });

  let progressIndex = 0;
  let respawns = 0;
  let maxSpeed = 0;
  let maxOff = 0;
  let prev = { ...runtime.readKartState().position };
  const start = { ...prev };
  let heading = 0;
  const trace: DriveResult['trace'] = [];
  const race = runtime.readRaceState();
  let raceFrames = 0;
  for (; raceFrames < maxRace; raceFrames++) {
    const kart = runtime.readKartState();
    maxSpeed = Math.max(maxSpeed, kart.speed);
    const p = kart.position;
    const jump = Math.hypot(p.x - prev.x, p.z - prev.z, (p.y - prev.y) * 0.5);
    if (jump > 2500) respawns++;
    const vx = p.x - prev.x;
    const vz = p.z - prev.z;
    if (Math.hypot(vx, vz) > 2) heading = yawOfVelocity(vx, vz);
    prev = { x: p.x, y: p.y, z: p.z };

    // Advance the progress index to the nearest route point within a forward window.
    let best = progressIndex;
    let bestD = Infinity;
    for (let k = -2; k <= 12; k++) {
      const idx = (((progressIndex + k) % n) + n) % n;
      const d = Math.hypot(route[idx].x - p.x, route[idx].z - p.z);
      if (d < bestD) {
        bestD = d;
        best = idx;
      }
    }
    progressIndex = best;
    if (respawns > 0 && bestD > 3000) {
      // After a respawn, re-acquire globally.
      let gb = 0;
      let gd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(route[i].x - p.x, route[i].z - p.z);
        if (d < gd) {
          gd = d;
          gb = i;
        }
      }
      progressIndex = gb;
    }
    maxOff = Math.max(maxOff, bestD);

    const look = lookaheadBase + Math.max(0, kart.speed) * 15;
    let target = route[progressIndex];
    let acc = 0;
    for (let k = 0; k < n; k++) {
      const a = route[(progressIndex + k) % n];
      const b = route[(progressIndex + k + 1) % n];
      acc += Math.hypot(b.x - a.x, b.z - a.z);
      target = b;
      if (acc >= look) break;
    }
    const want = Math.atan2(target.x - p.x, target.z - p.z);
    let err = want - heading;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    const stick = Math.max(-1, Math.min(1, sign * err * gain));
    runtime.setInput({ ...NEUTRAL_PLAYTEST_INPUT, accelerate: true, stickX: stick });
    runtime.step();
    if (raceFrames % 60 === 0) {
      runtime.readRaceState(race);
      trace.push({ frame: raceFrames, x: p.x, z: p.z, lap: race.lap, speed: kart.speed });
    }
    runtime.readRaceState(race);
    if (race.stage === 'finished') break;
    if (options.stopAtLap && race.lap >= options.stopAtLap) break;
  }
  const end = runtime.readKartState().position;
  runtime.readRaceState(race);
  return {
    finalLap: race.lap,
    maxLap: race.maxLap,
    raceFrames,
    respawns,
    timeMs: race.timeMs,
    lapSplitsMs: [...race.lapSplitsMs],
    maxOffRoute: maxOff,
    stage: race.stage,
    distance: Math.hypot(end.x - start.x, end.z - start.z),
    maxSpeed,
    trace,
  };
}
