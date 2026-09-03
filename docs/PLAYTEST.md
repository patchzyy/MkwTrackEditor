# Playtest

Drive the track you are editing, in the browser, with Mario Kart Wii's own physics.

The feature is deliberately split in two halves that meet at one file, `src/lib/playtest/types.ts`:

| Half | Owns |
| --- | --- |
| Physics runtime | `src/lib/playtest/kinokoRuntime.ts` and `src/lib/playtest/wasm/` — Kinoko compiled to WebAssembly behind the `PlaytestRuntime` interface. |
| Viewport and UI | `src/ui/playtest/` and the viewport/renderer changes — everything that starts a session, feeds it input, draws the kart, moves the camera and shows the HUD. |

Neither half imports the other. The UI never touches WASM; the runtime never touches React.

## Physics runtime

Owned by the runtime half; see that section for how Kinoko is built and loaded.

`src/lib/playtest/mockRuntime.ts` is a second, deliberately dumb implementation of the same
interface: it reads the first start point out of the archive and drives a kinematic point around
a flat plane (accelerate ramps to a cap, brake decelerates, the stick yaws, intro → countdown →
race, the timer runs, the lap stays 1). It exists so the UI can be developed, unit-tested and
probed without the WebAssembly module, and it is what `scripts/probe-playtest.js` runs against.

## Viewport and UI

### Starting a session

The "Playtest" button sits next to the editor-mode switch in the top bar. It is disabled unless
a track with both a KMP and a collision mesh is loaded, and its tooltip says why. Clicking it
opens a small popover (`src/ui/playtest/PlaytestMenu.tsx`) with a curated driver list, a vehicle
list grouped into karts and bikes, a Manual/Auto drift switch, the controls summary, and Start.
The last choice is remembered in `localStorage` under `mkw.editor.playtest.v1`.

Start runs `usePlaytestSession.start()`, which:

1. packs the **current** `TrackDocument` — unsaved edits included — with
   `exportTrack(track, { common, compress: false })`. Uncompressed, because the runtime unpacks
   it immediately and Yaz0 would cost a second for nothing;
2. fetches `Race/Common.szs` (the user's imported archive if there is one, else the bundled
   `data/MarioKartWii/Race/Common.szs`);
3. `await playtestRuntimeFactory({ commonArchive, onLog })`;
4. `runtime.loadCourse(courseBytes, options)`.

While that is happening the HUD shows a single "Loading physics…" line. Any `PlaytestError`, any
throw from the runtime, and `runtime.disposed` flipping mid-session all end the session and raise
one error toast. Loading a different track while a session is running ends it too.

### The one swap point

`src/ui/playtest/runtimeFactory.ts` is the only place that names a concrete runtime:

```ts
export const playtestRuntimeFactory: PlaytestRuntimeFactory = createMockPlaytestRuntime;
```

After the WebAssembly half merges, change that one line to `createKinokoRuntime` from
`src/lib/playtest/kinokoRuntime.ts`. Nothing else in `src/ui/` refers to either implementation.

### The frame loop

The viewport already runs one `requestAnimationFrame` loop; the playtest hangs off it
(`stepPlaytest` in `src/ui/Noclip3DViewport.tsx`). Per animation frame:

1. `planFixedSteps` (`src/lib/playtest/playtestLoop.ts`) turns real elapsed milliseconds into a
   whole number of 60 Hz steps plus a carried remainder. Catch-up is capped at 4 steps and the
   rest of the time is *dropped*, so a stalled tab never has to simulate minutes of race;
2. `runtime.setInput(session.getInput())` — keyboard and gamepad, merged;
3. `runtime.step()` that many times;
4. `readKartState` / `readRaceState` / `readCameraState` once, into objects reused for the whole
   session, so a frame allocates nothing;
5. the camera and the kart model are updated from those objects.

While a session is running the CAME preview clock is skipped entirely; a playtest owns the camera.

### Controls

| Action | Keyboard | Gamepad (standard mapping) |
| --- | --- | --- |
| Accelerate | Space or X | A (0) |
| Brake | Z | B (1) |
| Steer | ← → or A / D | left stick X |
| Stick up/down | ↑ ↓ or W / S | left stick Y (up is positive) |
| Hop / drift | Shift | RB (5) or RT (7) |
| Item | C | LB (4) |
| Trick / wheelie | E (up), Q (down) | d-pad up / down |
| Restart | R | — |
| Exit | Esc | — |

Keys are matched on `KeyboardEvent.code`, so the layout is physical (WASD is WASD on AZERTY too).
Both devices are read every frame and merged: either can press any button, and whichever stick is
deflected further wins. The gamepad gets a 0.2 dead zone, rescaled so full lock still reads 1.

The mapping is pure and unit-tested in `src/ui/playtest/playtestInput.ts`; nothing there touches
the DOM. `usePlaytestSession` owns the listeners.

### Not being an editor for a while

A session is not an editing session, so for its duration:

- `document.documentElement.dataset.playtest = 'active'`. `useEditorShortcuts` and the shortcut
  overlay check it and bail out, the same way they already check `viewportCameraLook`;
- the session's own `keydown`/`keyup` listeners are installed in the capture phase and
  `preventDefault()` every key they consume, so Space cannot scroll and R cannot switch tools;
- the viewport ignores clicks, pointer drags, picking, gizmo drags and drag-and-drop placement;
- the viewport toolbar, the route-visibility panel, the renderer status pill and the selection
  pill are not rendered;
- the left dock, the inspector and the content browser collapse. Their previous state is
  remembered and restored on exit;
- the status bar reads "Playtesting — Esc to exit".

Exiting restores the editor exactly as it was: the mode and the selection are never touched, the
docks come back, and the viewport puts back the camera controller *and* the camera pose it saved
when the session started.

### Camera

`PlaytestCameraController` (`src/ui/playtest/playtestCamera.ts`) is installed for the session and
ignores the input manager entirely, so the fly controls cannot fight the race camera. Each frame
it takes `runtime.readCameraState()` when the runtime has one, and otherwise falls back to the TS
chase camera in `playtestChaseCamera.ts`: behind the kart along `mainRotation`'s forward axis,
above it, looking at a point ahead, exponentially smoothed on both position and target, with
extra distance at speed. The smoothing is expressed per 60 Hz frame and rescaled for the real
frame time, so it eases identically at 30, 60 or 144 Hz.

The maths lives in `playtestChaseCamera.ts` rather than in the controller because the controller
imports the vendored noclip `Camera` module, which touches `window` at import time and so cannot
be loaded from a node test.

### The kart

Drawn in the noclip scene, never as a DOM overlay. `MarioKartWiiRenderer.setPlaytestKart(state)`
in `vendor/noclip.website/src/MarioKartWii/Scenes_MarioKartWii.ts` takes a position in game units
and a quaternion, and renders the same dummy kart + driver the start-grid preview already uses
(`./Preview/fk_lb_kart_model.brres`, `./Preview/fk_lb_driver_model.brres`) through a shared
`createDummyKartRenderer`. While a kart is set, the twelve start-slot dummies are hidden and
`drawEditorOverlay` returns immediately, so no gizmo, path line, checkpoint wall or area box is
drawn. Passing `null` puts all of that back.

Wheels keep the model's own attachment-node placement rather than being driven from
`PlaytestKartState.wheelPositions`; on the dummy model the suspension nodes already sit where the
body expects them, and moving them independently reads worse.

### HUD

`PlaytestHud.tsx`, absolutely positioned inside the viewport container, `pointer-events: none`
except for the two buttons. Lap and race timer top-left, speed bottom-left, "Restart (R)" and
"Exit (Esc)" top-right, the countdown (and the finish time) centred. It reads the live sample
from a ref in its own animation loop at ~30 Hz and only calls `setState` when a string the user
can see changes, so the editor shell never re-renders at 60 Hz. The formatting is pure and
unit-tested in `playtestHudModel.ts`.

### Out of scope, on purpose

- No AI racers, items, replays, ghosts or online. One local player, one kart.
- No lap or finish logic in the mock runtime: the lap counter stays at 1 and the race never ends.
  The HUD already renders the `finished` stage and the final time for when the real runtime
  reports them.
- The kart is the untextured dummy preview model, not the chosen character and vehicle. The
  character/vehicle choice is passed to the runtime (it changes the physics) but not to the
  renderer.
- No in-race editing, no rewind, no free camera during a session, no split screen.

### Tests and the probe

| File | Covers |
| --- | --- |
| `src/lib/playtest/playtestLoop.test.ts` | The fixed-step accumulator: 60/120/30 Hz, catch-up, the cap, hostile inputs. |
| `src/lib/playtest/mockRuntime.test.ts` | Start pose from KTPT, laps from STGI, stage progression, accelerate/brake/steer, restart, wheel counts, the error cases. Builds its own two-section KMP, so it needs no real track. |
| `src/ui/playtest/playtestInput.test.ts` | Every key and gamepad button, the dead zone, and the merge. |
| `src/ui/playtest/playtestChaseCamera.test.ts` | Quaternion rotation, the camera goal, frame-rate-independent smoothing, convergence. |
| `src/ui/playtest/playtestHudModel.test.ts` | Time, speed and countdown formatting. |

`scripts/probe-playtest.js` drives the whole feature in a real browser, against the mock runtime:

```bash
npx vite --host 127.0.0.1 --port 5194 --strictPort
PROBE_PREFIX=playtest PROBE_PORT=9371 PROBE_SIZE=1600x1000 \
  node scripts/ui-shell-probe.mjs "http://127.0.0.1:5194/?smokeTrack=/dev-tracks/Z0.szs" scripts/probe-playtest.js
```

It opens the popover, starts a session, holds accelerate through the countdown into the race,
asserts the HUD reaches stage `race` with a rising speed, steers, restarts, exits, and checks the
editor came back with the same KMP overlay it had before. Screenshots land in `docs/screenshots/`
as `playtest-01-menu`, `-02-countdown`, `-03-racing`, `-04-back-in-editor`.
