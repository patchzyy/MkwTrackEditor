// Hand-written types for the Emscripten glue in kinoko.mjs.
//
// Regenerate the .mjs/.wasm with `npm run build:kinoko`; this declaration is maintained by hand
// and must be kept in step with EXPORTED_FUNCTIONS / EXPORTED_RUNTIME_METHODS in
// scripts/build-kinoko.mjs. The C API itself is documented in native/kinoko-shim/kinoko_shim.h.

/** A pointer into the module's linear memory. */
export type KinokoPtr = number;

export interface KinokoModule {
  /** Re-created whenever the heap grows, so always read these off the module, never cache them. */
  readonly HEAPU8: Uint8Array;
  readonly HEAP32: Int32Array;
  readonly HEAPF32: Float32Array;

  _malloc(size: number): KinokoPtr;
  _free(ptr: KinokoPtr): void;

  _kinoko_provide_file(pathPtr: KinokoPtr, dataPtr: KinokoPtr, size: number): number;
  _kinoko_clear_files(): void;
  _kinoko_load_course(character: number, vehicle: number, driftIsAuto: number): number;
  _kinoko_set_inputs(buttons: number, stickXRaw: number, stickYRaw: number, trick: number): void;
  _kinoko_set_infinite_items(enabled: number): void;
  _kinoko_step(): void;
  _kinoko_frame(): number;
  _kinoko_read_kart_state(out: KinokoPtr): void;
  _kinoko_read_race_state(outInts: KinokoPtr, outFloats: KinokoPtr): void;
  _kinoko_read_camera_state(out: KinokoPtr): number;
  _kinoko_restart(): number;
  _kinoko_shutdown(): void;
  _kinoko_heap_size(): number;
}

export interface KinokoModuleOptions {
  /** Pre-fetched wasm bytes. When set, `locateFile` is not consulted. */
  wasmBinary?: ArrayBuffer | Uint8Array;
  /** Maps "kinoko.wasm" to the URL the bundler emitted for it. */
  locateFile?: (path: string, scriptDirectory: string) => string;
  /** Receives stdout, one line at a time. */
  print?: (line: string) => void;
  /** Receives stderr, one line at a time, plus Emscripten's own `Aborted(...)` notice. */
  printErr?: (line: string) => void;
}

declare const createKinokoModule: (options?: KinokoModuleOptions) => Promise<KinokoModule>;
export default createKinokoModule;
