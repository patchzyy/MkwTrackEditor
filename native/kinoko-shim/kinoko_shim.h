// C API exported from the Kinoko WASM build.
//
// This header documents the ABI that `src/lib/playtest/kinokoRuntime.ts` talks to. It is not
// compiled into the TypeScript build; it exists so the shim's two translation units agree and
// so the layouts have one authoritative definition.
//
// Buffer layouts (all indices are element indices, not byte offsets):
//
//   kinoko_read_kart_state(float out[KINOKO_KART_STATE_FLOATS])
//     [0..2]   position x, y, z                (game units)
//     [3..6]   fullRot quaternion x, y, z, w
//     [7..10]  mainRot quaternion x, y, z, w
//     [11]     speed                           (units per frame)
//     [12..14] velocity x, y, z
//     [15]     wheel count (2 for bikes, 4 for karts)
//     [16..27] wheel positions, 4 * (x, y, z); entries past the wheel count are zero
//     [28]     airborne  (0 or 1)
//     [29]     drifting  (0 or 1)
//     [30]     boosting  (0 or 1)
//     [31]     mini-turbo kind: 0 none, 1 stand-still charging, 2 stand-still charged,
//              3 drift MT charging, 4 drift MT charged (blue), 5 drift SMT charged (orange)
//     [32]     mini-turbo charge, 0..1 (progress towards the next level; 1 when charged)
//     [33]     mushrooms left in the item slot (time trials start with 3; 0 when empty)
//     [34..35] reserved
//
//   kinoko_read_race_state(int32_t outInts[KINOKO_RACE_STATE_INTS],
//                          float outFloats[KINOKO_RACE_STATE_FLOATS])
//     ints  [0] stage, using Kinoko's RaceManager::Stage numbering
//               (0 Intro, 1 Countdown, 2 Race, 3 FinishLocal, 4 FinishGlobal)
//           [1] frames stepped since load/restart
//           [2] current lap, 1-based and clamped to >= 1
//           [3] lap count from the KMP STGI section, or 0 when the course has no STGI
//           [4] current checkpoint index
//           [5] respawn (JGPT) index the player would be sent to
//           [6] number of valid lap splits in floats[2..4]
//           [7] reserved
//     floats[0] race timer in milliseconds
//           [1] lap completion, 0..1
//           [2..4] lap splits in milliseconds (only the first ints[6] entries are meaningful)
//           [5] race completion (lap index + lap completion)
//           [6..7] reserved
//
//   kinoko_read_camera_state(float out[KINOKO_CAMERA_STATE_FLOATS])
//     [0..2] camera position x, y, z
//     [3..5] camera target x, y, z
//     [6]    vertical FOV in degrees
//     [7]    reserved

#ifndef KINOKO_SHIM_H
#define KINOKO_SHIM_H

#include <stddef.h>
#include <stdint.h>

#define KINOKO_KART_STATE_FLOATS 36
#define KINOKO_RACE_STATE_INTS 8
#define KINOKO_RACE_STATE_FLOATS 8
#define KINOKO_CAMERA_STATE_FLOATS 8

// Status codes returned by kinoko_load_course / kinoko_restart.
#define KINOKO_OK 0
#define KINOKO_ERR_ALREADY_LOADED 1
#define KINOKO_ERR_MISSING_FILE 2
#define KINOKO_ERR_OUT_OF_MEMORY 3
#define KINOKO_ERR_NOT_LOADED 4
#define KINOKO_ERR_BAD_ARGUMENT 5

#ifdef __cplusplus
extern "C" {
#endif

/// Registers an in-memory file. `path` is matched the way Kinoko asks for it, with any leading
/// '/' ignored (so "Race/Common.szs" and "/Race/Common.szs" are the same key). The bytes are
/// copied, so the caller may free `data` afterwards. Re-registering a path replaces it.
/// Returns 0 on success.
int kinoko_provide_file(const char *path, const uint8_t *data, size_t size);

/// Drops every registered file. Does not touch a loaded race.
void kinoko_clear_files(void);

/// Boots the engine on the course registered as "Race/Course/beginner_course.szs" with a single
/// local player. Returns one of the KINOKO_* status codes. Traps (via Kinoko's PANIC) if the
/// archive is not a simulable course; the caller is expected to catch that.
int kinoko_load_course(int character, int vehicle, int driftIsAuto);

/// Replaces the controller state used by subsequent kinoko_step() calls.
/// `stickXRaw` / `stickYRaw` are 7-centered raw stick values in 0..14.
/// `trick` is 0 none, 1 up, 2 down, 3 left, 4 right.
void kinoko_set_inputs(uint16_t buttons, uint8_t stickXRaw, uint8_t stickYRaw, int trick);

/// When non-zero, the player's item slot is topped back up to three mushrooms after every frame.
/// Survives kinoko_restart(); reset by nothing but another call.
void kinoko_set_infinite_items(int enabled);

/// Simulates one 60 Hz frame.
void kinoko_step(void);

/// Number of frames stepped since the last load/restart.
int32_t kinoko_frame(void);

void kinoko_read_kart_state(float *out);
void kinoko_read_race_state(int32_t *outInts, float *outFloats);
/// Returns 1 when the camera was readable, 0 otherwise (in which case `out` is left untouched).
int kinoko_read_camera_state(float *out);

/// Restarts the race on the same course with the same player options.
int kinoko_restart(void);

/// Tears the race down and releases the engine's memory space. Registered files are kept, so a
/// later kinoko_load_course() works without re-providing them.
void kinoko_shutdown(void);

/// Total bytes of the engine memory space, or 0 when nothing is loaded. Diagnostics only.
size_t kinoko_heap_size(void);

#ifdef __cplusplus
}
#endif

#endif // KINOKO_SHIM_H
