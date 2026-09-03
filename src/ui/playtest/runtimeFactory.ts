import { createMockPlaytestRuntime } from '../../lib/playtest/mockRuntime';
import type { PlaytestRuntimeFactory } from '../../lib/playtest/types';

/**
 * The single place the playtest UI decides which physics runtime it drives.
 *
 * Everything else — `usePlaytestSession`, the viewport, the HUD — goes through this constant and
 * only ever sees the `PlaytestRuntime` interface from `src/lib/playtest/types.ts`.
 *
 * INTEGRATOR: once the Kinoko WebAssembly half has landed, import `createKinokoRuntime` from
 * `../../lib/playtest/kinokoRuntime` instead of `createMockPlaytestRuntime`, and assign it to
 * `playtestRuntimeFactory` below. That is the whole integration.
 *
 * Nothing else in `src/ui/` has to change. `createMockPlaytestRuntime` stays in the tree: it is
 * what the unit tests and `scripts/probe-playtest.js` run against, so the UI can be exercised
 * without WASM.
 */
export const playtestRuntimeFactory: PlaytestRuntimeFactory = createMockPlaytestRuntime;
