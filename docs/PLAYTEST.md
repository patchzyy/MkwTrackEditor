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

**Kart state** (`float[32]`): `[0..2]` position, `[3..6]` `fullRot` quaternion (x, y, z, w),
`[7..10]` `mainRot` quaternion, `[11]` speed, `[12..14]` velocity, `[15]` wheel count,
`[16..27]` four wheel positions, `[28]` airborne, `[29]` drifting, `[30]` boosting, `[31]` spare.

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
- **Input.** `setInput()` maps the four buttons to Kinoko's bitmask and quantizes each stick axis
  to the 15 positions the game accepts, `(n - 7) / 7` for n in 0..14. Anything else fails
  `RaceInputState::isValid()` and the frame's input is thrown away, so quantizing is not optional.
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
start, and that both a non-Yaz0 archive and a malformed-but-Yaz0 archive raise `PlaytestError`.
It skips itself when the fixtures are not on the machine. It also prints the average `step()` cost.

For a wider check after touching the engine:

```bash
node native/kinoko-shim/smoke.mjs public/dev-tracks/Z0.szs
node native/kinoko-shim/sweep.mjs "D:/Games/Wii/Dolphin-2/RR/RetroRewind6/CT/Tracks"
```

## Viewport and UI

<!-- Owned by the UI half of the playtest feature. -->
