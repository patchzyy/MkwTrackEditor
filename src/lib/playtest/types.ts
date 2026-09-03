// Playtest runtime contract.
//
// The playtest feature runs Mario Kart Wii's physics in the browser using Kinoko
// (https://github.com/vabold/Kinoko, MIT) compiled to WebAssembly. This file is the boundary
// between the two halves of the feature:
//
//   - `src/lib/playtest/kinokoRuntime.ts` implements `PlaytestRuntime` on top of the WASM module.
//   - `src/ui/playtest/` and the viewport consume `PlaytestRuntime` and never touch WASM directly.
//
// All positions are in game units (the same units as KMP / KCL). The viewport applies its own
// 0.1 scene scale. Rotations are unit quaternions in Kinoko's convention (`EGG::Quatf`, x/y/z/w).
// The simulation steps at a fixed 60 Hz; one `step()` is one game frame.

export type PlaytestTrick = 'none' | 'up' | 'down' | 'left' | 'right';

/** Controller state for one frame. Mirrors Kinoko's `RaceInputState`. */
export interface PlaytestInput {
  accelerate: boolean;
  brake: boolean;
  item: boolean;
  /** Hop / drift button (R on GameCube, B on Wii Remote). */
  drift: boolean;
  /** -1..1. The runtime quantizes to the 15 stick positions the game accepts ((n - 7) / 7). */
  stickX: number;
  /** -1..1, up is positive. */
  stickY: number;
  /** D-pad flick: tricks on ramps, wheelie on bikes (`up`). */
  trick: PlaytestTrick;
}

export const NEUTRAL_PLAYTEST_INPUT: Readonly<PlaytestInput> = Object.freeze({
  accelerate: false,
  brake: false,
  item: false,
  drift: false,
  stickX: 0,
  stickY: 0,
  trick: 'none',
});

export interface PlaytestVec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlaytestQuat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Pose and motion of the player kart after the most recent `step()`. */
export interface PlaytestKartState {
  position: PlaytestVec3;
  /** Full body rotation (`KartObjectProxy::fullRot()`), including lean/tilt. */
  rotation: PlaytestQuat;
  /** Body rotation without the visual tilt (`KartObjectProxy::mainRot()`). */
  mainRotation: PlaytestQuat;
  /** Scalar speed in game units per frame (`KartObjectProxy::speed()`). */
  speed: number;
  /** World-space velocity (`KartObjectProxy::velocity()`). */
  velocity: PlaytestVec3;
  /** Per-wheel contact positions, 2 for bikes and 4 for karts. */
  wheelPositions: PlaytestVec3[];
  /** Whether the kart is airborne this frame. */
  airborne: boolean;
  /** Whether a drift is currently held. */
  drifting: boolean;
  /** Whether any boost (mini-turbo, mushroom, trick, ...) is active. */
  boosting: boolean;
}

export type PlaytestStage = 'intro' | 'countdown' | 'race' | 'finished';

export interface PlaytestRaceState {
  stage: PlaytestStage;
  /** Frames simulated since `loadCourse()` / `restart()`. */
  frame: number;
  /** Race timer in milliseconds; 0 until the countdown ends. */
  timeMs: number;
  /** 1-based lap the player is on. */
  lap: number;
  /** Laps needed to finish (from the KMP STGI section). */
  maxLap: number;
  /** 0..1 progress through the current lap, from checkpoint interpolation. */
  lapCompletion: number;
  /** Current KMP checkpoint index. */
  checkpointId: number;
  /** Respawn point the player would be sent to if they fell off now. */
  respawnId: number;
  /** Lap split times in milliseconds, one per completed lap. */
  lapSplitsMs: number[];
}

/** Camera pose computed by Kinoko's own chase camera (`Render::KartCamera`), when available. */
export interface PlaytestCameraState {
  position: PlaytestVec3;
  target: PlaytestVec3;
  /** Vertical field of view in degrees. */
  fovY: number;
}

/** Numeric values match Kinoko's `Vehicle` enum in `include/Common.hh`. */
export const PLAYTEST_VEHICLES = {
  Standard_Kart_S: 0,
  Standard_Kart_M: 1,
  Standard_Kart_L: 2,
  Baby_Booster: 3,
  Classic_Dragster: 4,
  Offroader: 5,
  Mini_Beast: 6,
  Wild_Wing: 7,
  Flame_Flyer: 8,
  Cheep_Charger: 9,
  Super_Blooper: 10,
  Piranha_Prowler: 11,
  Tiny_Titan: 12,
  Daytripper: 13,
  Jetsetter: 14,
  Blue_Falcon: 15,
  Sprinter: 16,
  Honeycoupe: 17,
  Standard_Bike_S: 18,
  Standard_Bike_M: 19,
  Standard_Bike_L: 20,
  Bullet_Bike: 21,
  Mach_Bike: 22,
  Flame_Runner: 23,
  Bit_Bike: 24,
  Sugarscoot: 25,
  Wario_Bike: 26,
  Quacker: 27,
  Zip_Zip: 28,
  Shooting_Star: 29,
  Magikruiser: 30,
  Sneakster: 31,
  Spear: 32,
  Jet_Bubble: 33,
  Dolphin_Dasher: 34,
  Phantom: 35,
} as const;

export type PlaytestVehicle = (typeof PLAYTEST_VEHICLES)[keyof typeof PLAYTEST_VEHICLES];

/** Numeric values match Kinoko's `Character` enum in `include/Common.hh` (non-Mii subset). */
export const PLAYTEST_CHARACTERS = {
  Mario: 0,
  Baby_Peach: 1,
  Waluigi: 2,
  Bowser: 3,
  Baby_Daisy: 4,
  Dry_Bones: 5,
  Baby_Mario: 6,
  Luigi: 7,
  Toad: 8,
  Donkey_Kong: 9,
  Yoshi: 10,
  Wario: 11,
  Baby_Luigi: 12,
  Toadette: 13,
  Koopa_Troopa: 14,
  Daisy: 15,
  Peach: 16,
  Birdo: 17,
  Diddy_Kong: 18,
  King_Boo: 19,
  Bowser_Jr: 20,
  Dry_Bowser: 21,
  Funky_Kong: 22,
  Rosalina: 23,
} as const;

export type PlaytestCharacter = (typeof PLAYTEST_CHARACTERS)[keyof typeof PLAYTEST_CHARACTERS];

/** Is this vehicle a bike (two wheels, can wheelie) rather than a kart? */
export function isPlaytestBike(vehicle: number): boolean {
  return vehicle >= PLAYTEST_VEHICLES.Standard_Bike_S;
}

export interface PlaytestCourseOptions {
  character: PlaytestCharacter;
  vehicle: PlaytestVehicle;
  /** Automatic drift (no hop; drifts by steering). */
  driftIsAuto: boolean;
}

export const DEFAULT_PLAYTEST_COURSE_OPTIONS: Readonly<PlaytestCourseOptions> = Object.freeze({
  character: PLAYTEST_CHARACTERS.Funky_Kong,
  vehicle: PLAYTEST_VEHICLES.Flame_Runner,
  driftIsAuto: false,
});

/**
 * A live physics session for one course. Create it with `createKinokoRuntime()`; call
 * `loadCourse()` before anything else. All methods are synchronous and run on the calling thread.
 */
export interface PlaytestRuntime {
  /**
   * Loads a course archive (a `.szs`, Yaz0-compressed or with an uncompressed Yaz0 wrapper) and
   * starts a race with a single local player. Throws `PlaytestError` if the archive cannot be
   * simulated (missing `course.kmp` / `course.kcl`, no start position, ...).
   */
  loadCourse(courseArchive: Uint8Array, options: PlaytestCourseOptions): void;
  /** Sets the controller state used by subsequent `step()` calls. */
  setInput(input: PlaytestInput): void;
  /** Simulates one 60 Hz frame. */
  step(): void;
  /** Reads the player kart pose after the last `step()`. Reuses `out` when provided. */
  readKartState(out?: PlaytestKartState): PlaytestKartState;
  readRaceState(out?: PlaytestRaceState): PlaytestRaceState;
  /** Kinoko's chase camera for this frame, or `null` if the build does not expose it. */
  readCameraState(out?: PlaytestCameraState): PlaytestCameraState | null;
  /** Restarts the current course from the start line with the same options. */
  restart(): void;
  /** Tears down the session. The runtime cannot be used afterwards. */
  dispose(): void;
  /** True once `dispose()` has been called or the WASM module has trapped. */
  readonly disposed: boolean;
}

export class PlaytestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PlaytestError';
  }
}

export interface CreatePlaytestRuntimeOptions {
  /** Decoded or Yaz0-compressed `Race/Common.szs` bytes (kart/driver parameters and hitboxes). */
  commonArchive: Uint8Array;
  /**
   * Pre-fetched WASM binary. When omitted the runtime resolves the `.wasm` asset itself via
   * Vite's `?url` import, which is what the browser path uses.
   */
  wasmBinary?: ArrayBuffer | Uint8Array;
  /** Receives Kinoko's log output (WARN / PANIC lines). Defaults to `console.warn`. */
  onLog?: (line: string) => void;
}

export type PlaytestRuntimeFactory = (options: CreatePlaytestRuntimeOptions) => Promise<PlaytestRuntime>;
