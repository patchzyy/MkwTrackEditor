import { createKinokoRuntime } from '../../lib/playtest/kinokoRuntime';
import type { PlaytestRuntimeFactory } from '../../lib/playtest/types';

/**
 * The single place the playtest UI decides which physics runtime it drives.
 *
 * Everything else — `usePlaytestSession`, the viewport, the HUD — goes through this constant and
 * only ever sees the `PlaytestRuntime` interface from `src/lib/playtest/types.ts`.
 *
 * The app runs Kinoko (Mario Kart Wii's physics engine compiled to WebAssembly; see
 * `docs/PLAYTEST.md`). `createMockPlaytestRuntime` in `src/lib/playtest/mockRuntime.ts` implements
 * the same interface with a kinematic stand-in; the unit tests use it, and swapping it in here
 * lets the UI be exercised without the WASM module.
 */
export const playtestRuntimeFactory: PlaytestRuntimeFactory = createKinokoRuntime;
