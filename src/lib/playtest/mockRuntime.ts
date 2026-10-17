/**
 * A deterministic kinematic stand-in for the Kinoko physics runtime.
 *
 * It exists for two reasons:
 *
 *  - the playtest UI (top bar, session lifecycle, HUD, chase camera, kart rendering) can be
 *    built and driven end-to-end without the WebAssembly module being ready, and
 *  - unit tests of the UI never have to instantiate WASM.
 *
 * It is *not* Mario Kart Wii physics and never will be: there is no collision, no gravity, no
 * drifting, no lap logic. It reads the first start point out of the course archive, then drives
 * a point around a horizontal plane. The start pitch/roll are kept in the reported pose so the
 * kart sits on the grid the way the editor draws it, but motion is yaw-only.
 *
 * The real runtime is `src/lib/playtest/kinokoRuntime.ts`; `src/ui/playtest/runtimeFactory.ts`
 * is the single place that chooses between them.
 */

import { parseKmp, type KmpDocument, type KmpEntity, type Vec3 } from '../kmp';
import { parseU8, type U8Entry } from '../u8';
import { decodeYaz0 } from '../yaz0';
import {
  NEUTRAL_PLAYTEST_INPUT,
  PlaytestError,
  isPlaytestBike,
  type CreatePlaytestRuntimeOptions,
  type PlaytestCameraState,
  type PlaytestCourseOptions,
  type PlaytestInput,
  type PlaytestKartState,
  type PlaytestQuat,
  type PlaytestRaceState,
  type PlaytestRuntime,
  type PlaytestRuntimeFactory,
  type PlaytestStage,
  type PlaytestVec3,
} from './types';

/** Frames of intro camera before the countdown starts. Matches the brief's timing. */
export const MOCK_INTRO_FRAMES = 172;
/** Frames of "3 / 2 / 1" countdown after the intro. */
export const MOCK_COUNTDOWN_FRAMES = 240;
/** The frame the race timer starts on. */
export const MOCK_RACE_START_FRAME = MOCK_INTRO_FRAMES + MOCK_COUNTDOWN_FRAMES;

/** Top speed in game units per frame. A real Flame Runner does roughly this. */
const MOCK_MAX_SPEED = 17;
/** How quickly the speed closes the gap to the cap, per frame. */
const MOCK_ACCELERATION = 0.022;
const MOCK_BRAKE = 0.45;
const MOCK_COAST = 0.985;
/** Peak yaw rate in radians per frame. */
const MOCK_TURN_RATE = 0.035;
/** Speed at which steering reaches its full rate. */
const MOCK_TURN_FULL_SPEED = 10;

const DEG_TO_RAD = Math.PI / 180;

const KART_WHEEL_OFFSETS: ReadonlyArray<PlaytestVec3> = [
  { x: -60, y: -20, z: 80 },
  { x: 60, y: -20, z: 80 },
  { x: -60, y: -20, z: -80 },
  { x: 60, y: -20, z: -80 },
];

const BIKE_WHEEL_OFFSETS: ReadonlyArray<PlaytestVec3> = [
  { x: 0, y: -20, z: 90 },
  { x: 0, y: -20, z: -90 },
];

/** Quaternion for a KMP rotation (degrees, applied X then Y then Z, as the editor does). */
export function quatFromKmpRotation(rotation: Vec3): PlaytestQuat {
  const hx = rotation.x * DEG_TO_RAD * 0.5;
  const hy = rotation.y * DEG_TO_RAD * 0.5;
  const hz = rotation.z * DEG_TO_RAD * 0.5;
  const cx = Math.cos(hx);
  const sx = Math.sin(hx);
  const cy = Math.cos(hy);
  const sy = Math.sin(hy);
  const cz = Math.cos(hz);
  const sz = Math.sin(hz);
  // qx * qy * qz.
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}

interface MockStartPose {
  position: Vec3;
  /** Degrees. */
  rotation: Vec3;
}

/** The start point the mock spawns on: the first non-battle KTPT, else the first KTPT. */
export function findMockStartPose(kmp: KmpDocument): MockStartPose | null {
  const starts = kmp.entities.filter((entity): entity is KmpEntity & { rotation: Vec3 } => entity.section === 'KTPT' && !!entity.rotation);
  if (starts.length === 0) return null;
  const racing = starts.find((entity) => entity.ktptPlayerIndex === undefined || entity.ktptPlayerIndex < 0);
  const start = racing ?? starts[0];
  return { position: { ...start.position }, rotation: { ...start.rotation } };
}

/** Laps the track asks for (STGI), clamped to something a race can actually run. */
export function findMockLapCount(kmp: KmpDocument): number {
  const stage = kmp.entities.find((entity) => entity.section === 'STGI')?.stage;
  const laps = stage?.lapCount ?? 3;
  return Number.isFinite(laps) && laps >= 1 && laps <= 9 ? laps : 3;
}

function findArchiveFile(entries: U8Entry[], fileName: string): U8Entry | undefined {
  const target = fileName.toLowerCase();
  return entries.find((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith(target));
}

function emptyKartState(): PlaytestKartState {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    mainRotation: { x: 0, y: 0, z: 0, w: 1 },
    speed: 0,
    velocity: { x: 0, y: 0, z: 0 },
    wheelPositions: [],
    airborne: false,
    drifting: false,
    boosting: false,
    miniTurbo: { kind: 'none', level: 0, charge: 0 },
    mushrooms: 3,
  };
}

function emptyRaceState(): PlaytestRaceState {
  return {
    stage: 'intro',
    frame: 0,
    timeMs: 0,
    lap: 1,
    maxLap: 3,
    lapCompletion: 0,
    checkpointId: 0,
    respawnId: 0,
    lapSplitsMs: [],
  };
}

function clampStick(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function stageForFrame(frame: number): PlaytestStage {
  if (frame < MOCK_INTRO_FRAMES) return 'intro';
  if (frame < MOCK_RACE_START_FRAME) return 'countdown';
  return 'race';
}

class MockPlaytestRuntime implements PlaytestRuntime {
  private readonly log: (line: string) => void;
  private loaded = false;
  private isDisposed = false;
  private start: MockStartPose = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
  private options: PlaytestCourseOptions | null = null;
  private maxLap = 3;
  private frame = 0;
  private yaw = 0;
  private speed = 0;
  private position: PlaytestVec3 = { x: 0, y: 0, z: 0 };
  private input: PlaytestInput = { ...NEUTRAL_PLAYTEST_INPUT };

  constructor(options: CreatePlaytestRuntimeOptions) {
    this.log = options.onLog ?? ((line) => console.warn(line));
    if (options.commonArchive.length === 0) this.log('WARN: playtest mock runtime got an empty Common archive');
  }

  public get disposed(): boolean {
    return this.isDisposed;
  }

  public loadCourse(courseArchive: Uint8Array, options: PlaytestCourseOptions): void {
    this.assertUsable();
    let entries: U8Entry[];
    try {
      entries = parseU8(decodeYaz0(courseArchive));
    } catch (error) {
      throw new PlaytestError('This track archive could not be unpacked for playtesting.', { cause: error });
    }
    const kmpEntry = findArchiveFile(entries, 'course.kmp');
    if (!kmpEntry?.data) throw new PlaytestError('This track has no course.kmp, so it cannot be driven.');
    if (!findArchiveFile(entries, 'course.kcl')?.data) throw new PlaytestError('This track has no collision mesh (course.kcl), so it cannot be driven.');

    let kmp: KmpDocument;
    try {
      kmp = parseKmp(kmpEntry.data);
    } catch (error) {
      throw new PlaytestError('This track’s course.kmp could not be read for playtesting.', { cause: error });
    }
    const start = findMockStartPose(kmp);
    if (!start) throw new PlaytestError('This track has no start position, so there is nowhere to start the race.');

    this.start = start;
    this.maxLap = findMockLapCount(kmp);
    this.options = { ...options };
    this.loaded = true;
    this.resetToStart();
  }

  public setInput(input: PlaytestInput): void {
    this.input = {
      accelerate: !!input.accelerate,
      brake: !!input.brake,
      item: !!input.item,
      drift: !!input.drift,
      stickX: clampStick(input.stickX),
      stickY: clampStick(input.stickY),
      trick: input.trick ?? 'none',
    };
  }

  public step(): void {
    this.assertUsable();
    this.assertLoaded();
    this.frame++;
    if (stageForFrame(this.frame) !== 'race') return;

    if (this.input.accelerate && !this.input.brake) {
      this.speed += (MOCK_MAX_SPEED - this.speed) * MOCK_ACCELERATION;
    } else if (this.input.brake) {
      this.speed = Math.max(0, this.speed - MOCK_BRAKE);
    } else {
      this.speed *= MOCK_COAST;
      if (this.speed < 0.01) this.speed = 0;
    }

    const turnScale = Math.min(1, this.speed / MOCK_TURN_FULL_SPEED);
    this.yaw += this.input.stickX * MOCK_TURN_RATE * turnScale;

    this.position.x += Math.sin(this.yaw) * this.speed;
    this.position.z += Math.cos(this.yaw) * this.speed;
  }

  public readKartState(out: PlaytestKartState = emptyKartState()): PlaytestKartState {
    out.position.x = this.position.x;
    out.position.y = this.position.y;
    out.position.z = this.position.z;
    const rotation = quatFromKmpRotation({ x: this.start.rotation.x, y: (this.yaw * 180) / Math.PI, z: this.start.rotation.z });
    out.rotation.x = rotation.x;
    out.rotation.y = rotation.y;
    out.rotation.z = rotation.z;
    out.rotation.w = rotation.w;
    out.mainRotation.x = rotation.x;
    out.mainRotation.y = rotation.y;
    out.mainRotation.z = rotation.z;
    out.mainRotation.w = rotation.w;
    out.speed = this.speed;
    out.velocity.x = Math.sin(this.yaw) * this.speed;
    out.velocity.y = 0;
    out.velocity.z = Math.cos(this.yaw) * this.speed;
    const offsets = this.options && isPlaytestBike(this.options.vehicle) ? BIKE_WHEEL_OFFSETS : KART_WHEEL_OFFSETS;
    while (out.wheelPositions.length < offsets.length) out.wheelPositions.push({ x: 0, y: 0, z: 0 });
    out.wheelPositions.length = offsets.length;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    for (let i = 0; i < offsets.length; i++) {
      const offset = offsets[i];
      const wheel = out.wheelPositions[i];
      wheel.x = this.position.x + offset.x * cos + offset.z * sin;
      wheel.y = this.position.y + offset.y;
      wheel.z = this.position.z - offset.x * sin + offset.z * cos;
    }
    out.airborne = false;
    out.drifting = this.input.drift && this.speed > 0;
    out.boosting = false;
    out.miniTurbo.kind = 'none';
    out.miniTurbo.level = 0;
    out.miniTurbo.charge = 0;
    return out;
  }

  public readRaceState(out: PlaytestRaceState = emptyRaceState()): PlaytestRaceState {
    out.stage = stageForFrame(this.frame);
    out.frame = this.frame;
    out.timeMs = out.stage === 'race' ? ((this.frame - MOCK_RACE_START_FRAME) * 1000) / 60 : 0;
    out.lap = 1;
    out.maxLap = this.maxLap;
    out.lapCompletion = 0;
    out.checkpointId = 0;
    out.respawnId = 0;
    out.lapSplitsMs.length = 0;
    return out;
  }

  /** The mock has no camera of its own; the UI falls back to its own chase camera. */
  public readCameraState(_out?: PlaytestCameraState): PlaytestCameraState | null {
    return null;
  }

  public restart(): void {
    this.assertUsable();
    this.assertLoaded();
    this.resetToStart();
  }

  public dispose(): void {
    this.isDisposed = true;
    this.loaded = false;
  }

  private resetToStart(): void {
    this.frame = 0;
    this.speed = 0;
    this.yaw = this.start.rotation.y * DEG_TO_RAD;
    this.position = { ...this.start.position };
    this.input = { ...NEUTRAL_PLAYTEST_INPUT };
  }

  private assertUsable(): void {
    if (this.isDisposed) throw new PlaytestError('This playtest session has already ended.');
  }

  private assertLoaded(): void {
    if (!this.loaded) throw new PlaytestError('No course is loaded in this playtest session.');
  }
}

/**
 * Builds the mock runtime. Async purely to match {@link PlaytestRuntimeFactory}; nothing here
 * actually waits on anything.
 */
export const createMockPlaytestRuntime: PlaytestRuntimeFactory = async (options: CreatePlaytestRuntimeOptions) =>
  new MockPlaytestRuntime(options);
