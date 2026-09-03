# Vendored Kinoko

`vendor/Kinoko/` is an in-tree copy of [Kinoko](https://github.com/vabold/Kinoko), a C++23
reimplementation of Mario Kart Wii's physics engine. It powers the editor's playtest feature; see
`docs/PLAYTEST.md`.

- **Upstream:** https://github.com/vabold/Kinoko
- **Commit:** `6307c7f0307ed3d97c3417316dc4378fa67fbeee`
- **Licence:** MIT (`LICENSE`, kept verbatim)

It is a copy, not a submodule: edit it in place, keep the patches minimal, and list every one of
them below.

## What was taken

- `include/` — verbatim.
- `source/` — verbatim except for the trims and patches below.
- `LICENSE` — verbatim.

## What was left out

| Path | Why |
| --- | --- |
| `source/host/` except `SceneCreatorDynamic.{cc,hh}` and `SceneId.hh` | `main.cc`, `KSystem`, `KTestSystem`, `KReplaySystem`, `Option` and `Context` are Kinoko's command line replay/test harness. `main.cc` also uses x86 `_MM_SET_DENORMALS_ZERO_MODE`, and `Context.hh` pulls in `<filesystem>`. `native/kinoko-shim/kinoko_shim.cc` replaces all of it. The library still declares `friend class Host::Context` in a dozen headers; a friend declaration of a class that is never defined is fine. |
| `source/abstract/File.cc` | Replaced by `native/kinoko-shim/kinoko_files.cc`, which serves archives out of memory instead of `std::ifstream`. The build uses `-sFILESYSTEM=0`, so there is nothing to read from. `File.hh` is kept and unmodified. |
| `samples/`, `docs/`, `tools/`, `vendor/ninja_syntax.py`, `CMakeLists.txt`, `configure.py`, `testCases.json`, `Doxyfile`, `.github/` | Upstream build/test tooling and documentation. We build with `scripts/build-kinoko.mjs`. |

## Local patches

Every patch is marked in-place with a `KINOKO-PATCH(mkw-track-editor)` comment.

### Accessors the shim needs

1. **`source/game/system/RaceManager.hh`** — added `RaceManager::Player::currentLap()`,
   `maxLapReached()` and `lapCompletion()`. Upstream keeps `m_currentLap`, `m_maxLap` and
   `m_lapCompletion` private and has no consumer for them; `PlaytestRaceState` needs all three.

2. **`source/game/render/KartCamera.hh`** — added `KartCameraState::pos()` /
   `KartCameraState::targetPos()`, and `KartCamera::forwardCamera()` / `KartCamera::fov()`.
   Upstream computes the chase camera every frame but never reads the result back out, so the
   fields are private. `PlaytestCameraState` needs them.

3. **`source/game/system/map/MapdataStageInfo.hh`** — named byte 0 of an STGI entry `lapCount`
   (it was inside a `_0[0x1 - 0x0]` padding array) and added a `lapCount()` getter. Kinoko always
   races three laps and so never reads it; `PlaytestRaceState.maxLap` is specified to come from
   STGI. The struct layout and its `STATIC_ASSERT(sizeof(SData) == 0xc)` are unchanged.

### Robustness on custom tracks

4. **`source/game/field/obj/ObjectDrivable.{hh,cc}` + `ObjectKCL.{hh,cc}`** — added a virtual
   `ObjectDrivable::hasCollisionFile()` (default `true`, overridden by `ObjectKCL` to check that
   `<kclName>.kcl` is actually in the course archive) and made `ObjectDrivable::load()` skip
   objects for which it returns false. Custom tracks routinely place a retail drivable object
   without shipping its collision mesh; upstream passes the resulting null file into `ObjColMgr`
   and asserts, taking the whole race down. Skipped objects are never registered with
   `BoxColManager`, so nothing else in the engine can reach them. This took the local
   Retro Rewind track set from 195/210 to 200/210 loading successfully. No effect when the file
   is present.

5. **`source/game/kart/KartMove.hh`** — added `smtCharge()`, `ssmtCharge()` and `isSsmtCharged()`
   getters next to the existing `mtCharge()`. The playtest HUD shows the mini-turbo charge bar
   (the stand-in for the game's sparks) and the shim reads these to fill kart floats `[31..32]`.

### Emscripten / libc++ compatibility

Upstream builds with GCC and libstdc++. Emscripten uses Clang and libc++, which is stricter.

4. **`source/game/field/KColData.cc`** (4 lines) — compares a raw `u16 *` against
   `m_prismCache.begin()` / `.end()`. `std::array::iterator` is a plain pointer in libstdc++ but a
   `__wrap_iter` in libc++, so the comparisons do not compile. Changed to `.data()` and
   `.data() + .size()`, which is the same address arithmetic.

5. **`source/game/system/map/MapdataCheckPoint.cc`** (3 loops) — replaced
   `std::views::enumerate(...)` with plain indexed loops. `std::views::enumerate` is C++23 but
   Emscripten's libc++ does not ship it at all. The loop bodies are otherwise unchanged.

No patch changes any physics behaviour.

### Not a patch, but worth knowing

`native/kinoko-shim/kinoko_prelude.hh` is force-included (`-include`) into every Kinoko
translation unit. It only adds standard-library includes (`<algorithm>`, `<bit>`, `<span>`, ...)
that libstdc++ leaks transitively and libc++ does not. Without it around fifty files fail to
compile on "no member named 'fill' in namespace 'std'" and friends. Doing it at the build level
keeps the vendored sources unmodified.

## Updating to a newer upstream

1. Clone the new revision, copy `include/`, `source/` and `LICENSE` over the top.
2. Re-apply the patches above (search upstream for the same expressions).
3. Delete `source/abstract/File.cc` and everything in `source/host/` except the scene creator.
4. `npm run build:kinoko && npm test`.
5. Update the commit hash at the top of this file, and note any new patch here.
