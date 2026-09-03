/**
 * `PlaytestRuntime` on top of Kinoko compiled to WebAssembly.
 *
 * Kinoko (https://github.com/vabold/Kinoko, MIT) is a C++ reimplementation of Mario Kart Wii's
 * physics engine. `vendor/Kinoko` holds the sources, `native/kinoko-shim` the C API this file
 * talks to, and `scripts/build-kinoko.mjs` builds both into `./wasm/kinoko.{mjs,wasm}`.
 * See `docs/PLAYTEST.md` for the rebuild instructions and the known limitations.
 *
 * One runtime owns one WASM module instance. `dispose()` drops it; the instance is not reused.
 */

import createKinokoModule, { type KinokoModule, type KinokoPtr } from './wasm/kinoko.mjs';
import kinokoWasmUrl from './wasm/kinoko.wasm?url';
import {
  PlaytestError,
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
  type PlaytestTrick,
  type PlaytestVec3,
} from './types';

// Buffer layouts; keep in step with native/kinoko-shim/kinoko_shim.h.
const KART_STATE_FLOATS = 32;
const RACE_STATE_INTS = 8;
const RACE_STATE_FLOATS = 8;
const CAMERA_STATE_FLOATS = 8;

const COMMON_ARCHIVE_PATH = 'Race/Common.szs';
/** Kinoko keys courses by slot; the shim always loads whatever is registered here. */
const COURSE_ARCHIVE_PATH = 'Race/Course/beginner_course.szs';

const STATUS_MESSAGES: Record<number, string> = {
  1: 'a course is already loaded',
  2: 'the course or common archive was not registered',
  3: 'the engine heap could not be allocated',
  4: 'no course is loaded',
  5: 'invalid argument',
};

const TRICK_CODES: Record<PlaytestTrick, number> = {
  none: 0,
  up: 1,
  down: 2,
  left: 3,
  right: 4,
};

/** How many log lines to keep for attaching to a `PlaytestError`. */
const LOG_HISTORY = 32;

function vec3(): PlaytestVec3 {
  return { x: 0, y: 0, z: 0 };
}

function quat(): PlaytestQuat {
  return { x: 0, y: 0, z: 0, w: 1 };
}

function readVec(source: Float32Array, offset: number, out: PlaytestVec3): PlaytestVec3 {
  out.x = source[offset];
  out.y = source[offset + 1];
  out.z = source[offset + 2];
  return out;
}

function readQuat(source: Float32Array, offset: number, out: PlaytestQuat): PlaytestQuat {
  out.x = source[offset];
  out.y = source[offset + 1];
  out.z = source[offset + 2];
  out.w = source[offset + 3];
  return out;
}

/**
 * Mario Kart Wii only accepts 15 stick positions per axis, `(n - 7) / 7` for n in 0..14. Anything
 * else fails `RaceInputState::isValid()` and the input is rejected outright, so quantize here.
 */
function quantizeStick(value: number): number {
  if (!Number.isFinite(value)) return 7;
  const raw = Math.round(value * 7) + 7;
  return raw < 0 ? 0 : raw > 14 ? 14 : raw;
}

function stageFromKinoko(stage: number): PlaytestStage {
  switch (stage) {
    case 0:
      return 'intro';
    case 1:
      return 'countdown';
    case 2:
      return 'race';
    default:
      // FinishLocal (3) and FinishGlobal (4) both mean "the player's race is over".
      return 'finished';
  }
}

function isYaz0(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 0x10 &&
    bytes[0] === 0x59 /* Y */ &&
    bytes[1] === 0x61 /* a */ &&
    bytes[2] === 0x7a /* z */
  );
}

class KinokoRuntime implements PlaytestRuntime {
  #module: KinokoModule | null;
  #onLog: (line: string) => void;
  #log: string[];
  #commonArchive: Uint8Array;

  #kartPtr: KinokoPtr = 0;
  #raceIntsPtr: KinokoPtr = 0;
  #raceFloatsPtr: KinokoPtr = 0;
  #cameraPtr: KinokoPtr = 0;

  #loaded = false;
  #disposed = false;

  constructor(
    module: KinokoModule,
    commonArchive: Uint8Array,
    log: string[],
    onLog: (line: string) => void,
  ) {
    this.#module = module;
    this.#commonArchive = commonArchive;
    this.#log = log;
    this.#onLog = onLog;

    this.#kartPtr = module._malloc(KART_STATE_FLOATS * 4);
    this.#raceIntsPtr = module._malloc(RACE_STATE_INTS * 4);
    this.#raceFloatsPtr = module._malloc(RACE_STATE_FLOATS * 4);
    this.#cameraPtr = module._malloc(CAMERA_STATE_FLOATS * 4);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Runs `fn` against the module. Any trap (Kinoko's `PANIC`/`ASSERT` call `abort()`, which
   * Emscripten turns into a `WebAssembly.RuntimeError`) leaves the instance unusable, so the
   * runtime marks itself disposed and rethrows as a `PlaytestError` with the tail of the log.
   */
  #guard<T>(what: string, fn: (module: KinokoModule) => T): T {
    const module = this.#module;
    if (!module || this.#disposed) {
      throw new PlaytestError(`Playtest runtime has been disposed (while trying to ${what}).`);
    }

    try {
      return fn(module);
    } catch (cause) {
      // A PlaytestError is our own doing (a bad argument, say) and left the module intact.
      if (cause instanceof PlaytestError) throw cause;
      this.#disposed = true;
      this.#module = null;
      const tail = this.#log.slice(-8).join('\n');
      throw new PlaytestError(
        `Kinoko trapped while trying to ${what}.${tail ? `\n${tail}` : ''}`,
        { cause },
      );
    }
  }

  #fail(what: string, message: string): never {
    const tail = this.#log.slice(-8).join('\n');
    throw new PlaytestError(`Could not ${what}: ${message}.${tail ? `\n${tail}` : ''}`);
  }

  /** Copies `bytes` into the module and registers them under `path`. */
  #provideFile(module: KinokoModule, path: string, bytes: Uint8Array): void {
    const pathBytes = new TextEncoder().encode(`${path}\0`);
    const pathPtr = module._malloc(pathBytes.length);
    const dataPtr = module._malloc(Math.max(bytes.length, 1));
    try {
      module.HEAPU8.set(pathBytes, pathPtr);
      module.HEAPU8.set(bytes, dataPtr);
      const status = module._kinoko_provide_file(pathPtr, dataPtr, bytes.length);
      if (status !== 0) {
        this.#fail(`register ${path}`, STATUS_MESSAGES[status] ?? `status ${status}`);
      }
    } finally {
      module._free(dataPtr);
      module._free(pathPtr);
    }
  }

  loadCourse(courseArchive: Uint8Array, options: PlaytestCourseOptions): void {
    if (this.#disposed) {
      throw new PlaytestError('Playtest runtime has been disposed.');
    }

    if (!isYaz0(courseArchive)) {
      this.#fail(
        'load the course',
        'the archive is not a Yaz0 .szs (it does not start with the Yaz0 magic)',
      );
    }

    const commonArchive = this.#commonArchive;
    if (!isYaz0(commonArchive)) {
      this.#fail('load the course', 'Race/Common.szs is not a Yaz0 .szs');
    }

    const status = this.#guard('load the course', (module) => {
      this.#provideFile(module, COMMON_ARCHIVE_PATH, commonArchive);
      this.#provideFile(module, COURSE_ARCHIVE_PATH, courseArchive);
      return module._kinoko_load_course(
        options.character,
        options.vehicle,
        options.driftIsAuto ? 1 : 0,
      );
    });

    if (status !== 0) {
      this.#fail('load the course', STATUS_MESSAGES[status] ?? `status ${status}`);
    }

    this.#loaded = true;
  }

  setInput(input: PlaytestInput): void {
    const buttons =
      (input.accelerate ? 0x1 : 0) |
      (input.brake ? 0x2 : 0) |
      (input.item ? 0x4 : 0) |
      (input.drift ? 0x8 : 0);

    const stickX = quantizeStick(input.stickX);
    const stickY = quantizeStick(input.stickY);
    const trick = TRICK_CODES[input.trick] ?? 0;

    this.#guard('set the controller input', (module) => {
      module._kinoko_set_inputs(buttons, stickX, stickY, trick);
    });
  }

  step(): void {
    if (!this.#loaded) {
      throw new PlaytestError('step() was called before loadCourse().');
    }

    this.#guard('step the simulation', (module) => {
      module._kinoko_step();
    });
  }

  readKartState(out?: PlaytestKartState): PlaytestKartState {
    const state: PlaytestKartState = out ?? {
      position: vec3(),
      rotation: quat(),
      mainRotation: quat(),
      speed: 0,
      velocity: vec3(),
      wheelPositions: [],
      airborne: false,
      drifting: false,
      boosting: false,
    };

    this.#guard('read the kart state', (module) => {
      module._kinoko_read_kart_state(this.#kartPtr);
      const floats = module.HEAPF32.subarray(
        this.#kartPtr >> 2,
        (this.#kartPtr >> 2) + KART_STATE_FLOATS,
      );

      readVec(floats, 0, state.position);
      readQuat(floats, 3, state.rotation);
      readQuat(floats, 7, state.mainRotation);
      state.speed = floats[11];
      readVec(floats, 12, state.velocity);

      const wheelCount = Math.max(0, Math.min(4, floats[15] | 0));
      const wheels = state.wheelPositions;
      wheels.length = wheelCount;
      for (let i = 0; i < wheelCount; i++) {
        wheels[i] = readVec(floats, 16 + i * 3, wheels[i] ?? vec3());
      }

      state.airborne = floats[28] !== 0;
      state.drifting = floats[29] !== 0;
      state.boosting = floats[30] !== 0;
    });

    return state;
  }

  readRaceState(out?: PlaytestRaceState): PlaytestRaceState {
    const state: PlaytestRaceState = out ?? {
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

    this.#guard('read the race state', (module) => {
      module._kinoko_read_race_state(this.#raceIntsPtr, this.#raceFloatsPtr);
      const ints = module.HEAP32.subarray(
        this.#raceIntsPtr >> 2,
        (this.#raceIntsPtr >> 2) + RACE_STATE_INTS,
      );
      const floats = module.HEAPF32.subarray(
        this.#raceFloatsPtr >> 2,
        (this.#raceFloatsPtr >> 2) + RACE_STATE_FLOATS,
      );

      state.stage = stageFromKinoko(ints[0]);
      state.frame = ints[1];
      state.lap = ints[2];
      // Courses without an STGI section report 0; Kinoko itself always finishes after 3 laps.
      state.maxLap = ints[3] > 0 ? ints[3] : 3;
      state.checkpointId = ints[4];
      state.respawnId = ints[5];

      state.timeMs = floats[0];
      state.lapCompletion = floats[1];

      const splitCount = Math.max(0, Math.min(3, ints[6]));
      const splits = state.lapSplitsMs;
      splits.length = splitCount;
      for (let i = 0; i < splitCount; i++) {
        splits[i] = floats[2 + i];
      }
    });

    return state;
  }

  readCameraState(out?: PlaytestCameraState): PlaytestCameraState | null {
    const state: PlaytestCameraState = out ?? {
      position: vec3(),
      target: vec3(),
      fovY: 0,
    };

    const ok = this.#guard('read the camera state', (module) => {
      if (module._kinoko_read_camera_state(this.#cameraPtr) === 0) return false;

      const floats = module.HEAPF32.subarray(
        this.#cameraPtr >> 2,
        (this.#cameraPtr >> 2) + CAMERA_STATE_FLOATS,
      );
      readVec(floats, 0, state.position);
      readVec(floats, 3, state.target);
      state.fovY = floats[6];
      return true;
    });

    return ok ? state : null;
  }

  restart(): void {
    if (!this.#loaded) {
      throw new PlaytestError('restart() was called before loadCourse().');
    }

    const status = this.#guard('restart the race', (module) => module._kinoko_restart());
    if (status !== 0) {
      this.#fail('restart the race', STATUS_MESSAGES[status] ?? `status ${status}`);
    }
  }

  dispose(): void {
    if (this.#disposed) return;

    const module = this.#module;
    this.#disposed = true;
    this.#module = null;
    this.#loaded = false;

    if (!module) return;
    try {
      module._kinoko_shutdown();
      module._kinoko_clear_files();
      module._free(this.#kartPtr);
      module._free(this.#raceIntsPtr);
      module._free(this.#raceFloatsPtr);
      module._free(this.#cameraPtr);
    } catch (cause) {
      // The instance is being thrown away either way; a trap during teardown is not actionable.
      this.#onLog(`kinoko: teardown failed: ${String(cause)}`);
    }
  }
}

export const createKinokoRuntime: PlaytestRuntimeFactory = async (
  options: CreatePlaytestRuntimeOptions,
): Promise<PlaytestRuntime> => {
  const onLog = options.onLog ?? ((line: string) => console.warn(line));
  const log: string[] = [];

  const record = (line: string) => {
    if (line.length === 0) return;
    log.push(line);
    if (log.length > LOG_HISTORY) log.shift();
    onLog(line);
  };

  let module: KinokoModule;
  try {
    module = await createKinokoModule({
      // Tests hand us the bytes directly; the browser lets Vite's asset URL resolve them.
      ...(options.wasmBinary ? { wasmBinary: options.wasmBinary } : { locateFile: () => kinokoWasmUrl }),
      print: record,
      printErr: record,
    });
  } catch (cause) {
    throw new PlaytestError('Could not instantiate the Kinoko WebAssembly module.', { cause });
  }

  return new KinokoRuntime(module, options.commonArchive, log, onLog);
};

export default createKinokoRuntime;
