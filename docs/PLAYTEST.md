# Playtest

Playtest drives the track you are editing with Mario Kart Wii's real physics, in the browser, at
60 Hz. It is experimental: it simulates one local player on the course you have loaded, with no
items, no CPUs and no online.

The feature has two halves, split by `src/lib/playtest/types.ts`:

- **Physics runtime** — `src/lib/playtest/kinokoRuntime.ts` implements `PlaytestRuntime` on top of
  a WebAssembly build of Kinoko. Documented below.
- **Viewport and UI** — consumes `PlaytestRuntime` and never touches WASM directly. See the
  section at the bottom.

## Physics runtime

### What Kinoko is

[Kinoko](https://github.com/vabold/Kinoko) is a C++23 reimplementation of Mario Kart Wii's physics
engine by vabold. It is accurate enough to replay retail time-trial ghosts frame-for-frame, which
means it also drives a kart around a *custom* track the way the real game would.

It is MIT-licensed. A trimmed copy lives in `vendor/Kinoko/`; `vendor/Kinoko/VENDORED.md` records
the upstream commit, everything that was left out, and every local patch. Keep that file current.

Kinoko only implements the physics and the parts of the game the physics depends on — the KCL
collision, the KMP (checkpoints, respawns, objects, routes, areas), the kart/driver stat tables and
the chase camera. There are no graphics, no sound, no menus.

### Layout

| Path | What |
| --- | --- |
| `vendor/Kinoko/` | Upstream sources (trimmed + patched). |
| `native/kinoko-shim/kinoko_shim.h` | The exported C API and its buffer layouts. |
| `native/kinoko-shim/kinoko_shim.cc` | Heap setup, scene lifecycle, per-frame input, state readback. Replaces upstream's `source/host/main.cc`. |
| `native/kinoko-shim/kinoko_files.cc` | In-memory `Abstract::File`. Replaces upstream's `source/abstract/File.cc`. |
| `native/kinoko-shim/kinoko_prelude.hh` | Force-included standard headers; see VENDORED.md. |
| `native/kinoko-shim/smoke.mjs` | Dev harness: load one `.szs`, drive it, print the state. |
| `native/kinoko-shim/sweep.mjs` | Dev harness: load every `.szs` in a folder and report failures. |
| `scripts/build-kinoko.mjs` | The build. |
| `src/lib/playtest/wasm/kinoko.{mjs,wasm}` | Generated, and **committed**. |
| `src/lib/playtest/wasm/kinoko.d.mts` | Hand-written types for the Emscripten glue. |
| `src/lib/playtest/kinokoRuntime.ts` | `PlaytestRuntime` implementation. |

### Rebuilding the WebAssembly

The generated `kinoko.mjs` and `kinoko.wasm` are checked in on purpose: they are ordinary static
assets, and neither `npm run build` nor the GitHub Pages deploy runs Emscripten. You only need the
toolchain when you change `vendor/Kinoko/` or `native/kinoko-shim/`.

```bash
# One-off: install Emscripten (~1.5 GB).
git clone https://github.com/emscripten-core/emsdk ~/emsdk
cd ~/emsdk && ./emsdk install latest && ./emsdk activate latest

# Then, from the repo root:
npm run build:kinoko                # release: -O2, no assertions
npm run build:kinoko -- --debug     # -O0 -g -sASSERTIONS=1 -DBUILD_DEBUG
npm run build:kinoko -- --profiling # release + C++ symbol names in wasm stack traces
npm run build:kinoko -- --clean     # wipe the object directory first
```

The build script finds Emscripten via `$EMSDK`, then `$EMSCRIPTEN`, then `~/emsdk/upstream/
emscripten`; it does not need emsdk on your `PATH`. It generates a Ninja file in
`native/kinoko-shim/build/` (gitignored) and runs `ninja`, so rebuilds are incremental. A cold
build of the 174 translation units takes about a minute; a relink takes three seconds.

**Always commit the regenerated `kinoko.mjs` and `kinoko.wasm` together with the source change.**

When something asserts, `--profiling` is the tool to reach for: Kinoko's `PANIC` / `ASSERT` only
print a `file:line`, but with symbol names the JavaScript stack trace tells you which object or
subsystem walked into the bad data.

### The C API

Full layouts are in `native/kinoko-shim/kinoko_shim.h`; that header is the authority and
`kinokoRuntime.ts` mirrors its constants. In summary:

```c
int    kinoko_provide_file(const char *path, const uint8_t *data, size_t size);
void   kinoko_clear_files(void);
int    kinoko_load_course(int character, int vehicle, int driftIsAuto);
void   kinoko_set_inputs(uint16_t buttons, uint8_t stickXRaw, uint8_t stickYRaw, int trick);
void   kinoko_step(void);
int32_t kinoko_frame(void);
void   kinoko_read_kart_state(float *out);                       /* 32 floats */
void   kinoko_read_race_state(int32_t *outInts, float *outFloats); /* 8 ints + 8 floats */
int    kinoko_read_camera_state(float *out);                     /* 8 floats */
int    kinoko_restart(void);
void   kinoko_shutdown(void);
size_t kinoko_heap_size(void);
```

Everything returning `int` returns `0` on success and a small `KINOKO_ERR_*` code otherwise. All
readers write into a caller-owned buffer, so the TypeScript side allocates one buffer per struct
at construction and never allocates per frame.

**Kart state** (`float[36]`): `[0..2]` position, `[3..6]` `fullRot` quaternion (x, y, z, w),
`[7..10]` `mainRot` quaternion, `[11]` speed, `[12..14]` velocity, `[15]` wheel count,
`[16..27]` four wheel positions, `[28]` airborne, `[29]` drifting, `[30]` boosting, `[31]` mini-turbo kind (0 none, 1 stand-still charging, 2 stand-still charged, 3 drift
charging, 4 drift mini-turbo ready, 5 super mini-turbo ready), `[32]` mini-turbo charge 0..1,
`[33..35]` spare.

**Race state** (`int32[8]` + `float[8]`): ints are stage (Kinoko's raw `RaceManager::Stage`),
frame, lap, STGI lap count, checkpoint id, respawn id, lap-split count, spare; floats are
timer in ms, lap completion, three lap splits in ms, race completion, two spare.

**Camera state** (`float[8]`): `[0..2]` position, `[3..5]` target, `[6]` vertical FOV in degrees,
`[7]` spare.

#### Files and the course slot

The build uses `-sFILESYSTEM=0`. Instead of a virtual filesystem, `kinoko_provide_file()`
registers archive bytes under the path Kinoko will ask for, and the shim's `Abstract::File::Load`
copies them into the engine heap. Two files are needed:

- `Race/Common.szs` — kart/driver parameter tables, hitboxes, `ObjFlow.bin`. Ships in
  `public/data/MarioKartWii/Race/Common.szs`.
- `Race/Course/beginner_course.szs` — the course under test.

Kinoko addresses courses by retail slot, and several places in the engine branch on the course id
(rGV2's blocks, Moonview's cars, Shy Guy Beach's ships, the Chain Chomp's pitch). The shim always
uses **Luigi Circuit** (`Course::Luigi_Circuit`, file name `beginner_course`) because it is the
only slot nothing special-cases. Whatever archive you register at that path is what gets simulated.

#### Memory

`kinoko_load_course()` mallocs one block and turns it into the root `EGG::ExpHeap`, the way
upstream's `main.cc` does. Upstream fixes it at 16 MiB, which is not enough: the course archive is
decompressed into that heap and then the KCL, KMP and object collision are allocated out of it.
The shim uses 48 MiB plus twelve times the combined compressed archive size, capped at 512 MiB.
`kinoko_heap_size()` reports what was chosen. `kinoko_shutdown()` unwinds the scene stack,
destroys the heap and frees the block; the registered files survive so a later load does not have
to re-upload them.

### The TypeScript runtime

`createKinokoRuntime({ commonArchive, wasmBinary?, onLog? })` instantiates one WASM module and
returns a `PlaytestRuntime`. One runtime owns one module instance; `dispose()` throws the instance
away rather than recycling it.

- **Resolving the `.wasm`.** In the browser the runtime imports `./wasm/kinoko.wasm?url` and hands
  Emscripten a `locateFile`, so Vite emits the binary as a normal hashed asset. Pass `wasmBinary`
  instead when you already have the bytes (the tests do this, because Node cannot resolve Vite's
  asset URL).
- **Input.** `setInput()` maps the four buttons to Kinoko's bitmask with `packPlaytestButtons()`
  and quantizes each stick axis to the 15 positions the game accepts, `(n - 7) / 7` for n in
  0..14. Anything else fails `RaceInputState::isValid()` and the frame's input is thrown away, so
  quantizing is not optional.
- **Hop is brake.** Mario Kart Wii has one physical button for both: `RaceInputState` bit 0x2 is
  "Braking/Drifting" and bit 0x8 is set *on top of it* when the button went down while
  accelerating (`KPadGhostFaceButtonsStream`, `KPadController.hh`). `packPlaytestButtons()`
  therefore raises 0x2 for `brake` **or** `drift`. Without that, the hop button was pure 0x8: it
  could not brake, and it could not charge a stand-still mini-turbo, because
  `KartMove::calcSsmtStart` requires the `Accelerate` and `Brake` status bits together. While the
  kart is moving the accelerate bit wins, so the extra brake bit costs a drift nothing.
- **Traps.** Kinoko reports every unexpected condition with `PANIC` / `ASSERT`, which `printf` and
  then `abort()`. Under Emscripten that becomes a JavaScript `WebAssembly.RuntimeError` and the
  module instance is dead. Every entry point is wrapped: on a trap the runtime marks itself
  `disposed`, and rethrows a `PlaytestError` with the last log lines attached. Callers should treat
  a `PlaytestError` from `loadCourse()` as "this track cannot be playtested" and drop the runtime.
- **Logging.** `onLog` receives Kinoko's stdout and stderr, one line at a time; it defaults to
  `console.warn`. `restart()` and `dispose()` legitimately print three
  `... instance not explicitly handled!` warnings each, because scene teardown destroys the
  singletons through the heap disposer rather than through their `DestroyInstance()`. They are
  harmless.
- **Threading.** Everything is synchronous and runs on the calling thread. A frame costs about
  **0.02 ms** on this machine (Ryzen-class desktop, Node 24), i.e. roughly 0.1 % of a 60 Hz frame
  budget, so it is fine to step it inline from a `requestAnimationFrame` loop. Fast-forwarding by
  stepping several hundred frames in one go is also cheap.

### Mapping onto the contract

Most fields come straight out of Kinoko. These needed a decision:

| Contract field | Source | Note |
| --- | --- | --- |
| `airborne` | `!status().onBit(eStatus::TouchingGround)` | Kinoko has no single "in air" flag; `TouchingGround` is set when any part of the vehicle touches floor KCL. |
| `drifting` | `DriftManual \| DriftAuto \| SlipdriftCharge \| Hop` | Covers manual drift, automatic drift and the hop that starts one, so the UI can light up during the whole gesture. |
| `boosting` | `Boost \| MushroomBoost \| RampBoost \| ZipperBoost` | Mini-turbo, mushroom, ramp/trick and zipper boosts. |
| `maxLap` | STGI byte 0 | Read via a patched `MapdataStageInfo::lapCount()`. **Kinoko itself always ends the race after three laps** regardless of STGI, so on a 5-lap track the HUD will say "lap 3 / 5" and then finish. Falls back to 3 when the KMP has no STGI section. |
| `lap` | `RaceManager::Player::m_currentLap`, clamped to >= 1 | Kinoko counts from 0 before the first finish-line crossing. |
| `lapSplitsMs` | `Player::getLapSplit(n)` | Only the completed laps are reported. |
| `stage` | `RaceManager::Stage` | `FinishLocal` and `FinishGlobal` both map to `'finished'`. |
| `timeMs` | `Timer{min, sec, mil}` | `min * 60000 + sec * 1000 + mil`. Zero until the countdown ends. |
| `fovY` | `KartParam::KartCameraParam::fov` | A real value from `kartCameraParam.bin` (55 degrees for most vehicles), not a constant. Kinoko assumes the 16:9 camera. |

The camera pose comes from `Render::KartCamera`'s forward `KartCameraState`, which `GameScene`
recomputes every frame. Kinoko does not model the intro fly-through or the finish camera, so
during `'intro'` the camera already sits behind the kart.

### Known limitations

- **Not bit-exact with console.** Kinoko flushes denormals to zero to match the Wii's PowerPC
  FPU; WebAssembly has no way to do that, and `-ffp-contract=off` only covers fusing. Long runs
  will drift from a console/Dolphin result. Fine for feeling out a track, not for ghost
  verification.
- **About 5 % of custom tracks fail to load.** Across the local test sets, 200/210 Retro Rewind
  Nintendo-slot tracks and 121/128 `Z*.szs` custom tracks load and drive. The rest trip a Kinoko
  assertion on data it does not expect, and surface as a `PlaytestError`:
  - `Types.hh:99 ASSERT: idx < m_size` from `RailSpline::invalidateTransitions` (a POTI route with
    fewer points than the spline code assumes) or from `ObjectCowHerd::calc`.
  - `RailInterpolator.hh:55` from `ObjectCarTGE::init` (a route-following object whose route is
    empty).
  - `Types.hh:252 ASSERT: initialized() && !full()` from `ObjectDossunc::load` (more instances of
    one object than Kinoko's fixed-capacity vector holds).
  - `ObjectHeyho.cc:23` (a Shy Guy whose route has no vertical extent).
  - `Stream.cc:13 ASSERT: !bad()` from `ObjColMgr` on an object `.kcl` that is present but
    truncated.
  A missing object `.kcl` used to be the most common failure and is now handled: such objects are
  skipped and simply have no collision (see patch 4 in `vendor/Kinoko/VENDORED.md`).
- **Unknown objects have no collision.** Object IDs Kinoko does not implement, and IDs beyond the
  retail `ObjFlow.bin` range that custom-track packs add, become `ObjectNoImpl`: they exist but
  never collide.
- **150cc only.** There is no 200cc, and no mirror mode.
- **No items, no CPUs, no online.** The item button is wired through to Kinoko but only the item
  behaviour Kinoko implements will happen. There is exactly one player.
- **Three laps.** See `maxLap` above.
- **Battle arenas** load (they are ordinary KMP/KCL) but the race logic assumes a lap course.

### Testing

`src/lib/playtest/kinokoRuntime.test.ts` loads `public/data/MarioKartWii/Race/Common.szs` plus a
course from `public/dev-tracks/` (falling back to the Dolphin track folders in
`src/lib/realTrackFixtures.testdata.ts`), holds accelerate through the intro and countdown and for
600 racing frames, and checks the kart moved, the stage progressed, `restart()` returned it to the
start, that a bare U8 archive (what `exportTrack({ compress: false })` produces) is accepted, and
that both a garbage archive and a malformed-but-Yaz0 archive raise `PlaytestError`.
It skips itself when the fixtures are not on the machine. It also prints the average `step()` cost.

For a wider check after touching the engine:

```bash
node native/kinoko-shim/smoke.mjs public/dev-tracks/Z0.szs
node native/kinoko-shim/sweep.mjs "D:/Games/Wii/Dolphin-2/RR/RetroRewind6/CT/Tracks"
```

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
export const playtestRuntimeFactory: PlaytestRuntimeFactory = createKinokoRuntime;
```

Nothing else in `src/ui/` refers to an implementation. `createMockPlaytestRuntime` from
`src/lib/playtest/mockRuntime.ts` implements the same interface with a kinematic stand-in; swap it
in here to exercise the UI without the WebAssembly module.

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
| Brake / reverse | Z, ↓, S or Shift | B (1), RB (5) or RT (7) |
| Steer | ← → or A / D | left stick X |
| Stick up/down | ↑ ↓ or W / S | left stick Y (up is positive) |
| Stand-still mini-turbo | hold accelerate + Shift (or brake) at a standstill, release it | same |
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

`scripts/probe-playtest.js` drives the whole feature in a real browser, with the Kinoko runtime:

```bash
npx vite --host 127.0.0.1 --port 5194 --strictPort
PROBE_PREFIX=playtest PROBE_PORT=9371 PROBE_SIZE=1600x1000 \
  node scripts/ui-shell-probe.mjs "http://127.0.0.1:5194/?smokeTrack=/dev-tracks/Z0.szs" scripts/probe-playtest.js
```

It opens the popover, starts a session, holds accelerate through the countdown into the race,
asserts the HUD reaches stage `race` with a rising speed, steers, restarts, exits, and checks the
editor came back with the same KMP overlay it had before. Screenshots land in `docs/screenshots/`
as `playtest-01-menu`, `-02-countdown`, `-03-racing`, `-04-back-in-editor`.
