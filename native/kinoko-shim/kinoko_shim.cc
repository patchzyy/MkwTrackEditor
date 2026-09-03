// Emscripten shim around Kinoko.
//
// Kinoko's own entry point (`source/host/main.cc`) is a command line replay/test harness. This
// file replaces it with a small re-entrant C API that the browser drives one frame at a time:
// provide the archives, load a course, push inputs, step, read state back.
//
// Everything here runs on the calling thread and is single-instance: one WASM module instance is
// one playtest session.

#include "kinoko_shim.h"

#include <egg/core/ExpHeap.hh>
#include <egg/core/SceneManager.hh>

#include <game/kart/KartMove.hh>
#include <game/kart/KartObjectManager.hh>
#include <game/kart/KartParam.hh>
#include <game/render/KartCamera.hh>
#include <game/system/CourseMap.hh>
#include <game/system/KPadDirector.hh>
#include <game/system/RaceConfig.hh>
#include <game/system/RaceManager.hh>
#include <game/system/map/MapdataStageInfo.hh>

#include <host/SceneCreatorDynamic.hh>

#include <algorithm>
#include <cstdlib>
#include <cstring>

using namespace Kinoko;

// Defined in kinoko_files.cc.
bool KinokoShimHasFile(const char *path);
size_t KinokoShimFileSize(const char *path);

namespace {

/// Course slot we load every archive into.
///
/// `ObjectDirector::createObjects`, `KartSub`, `KartModel` and a handful of objects branch on the
/// course id, so the slot has to be one nothing special-cases. Luigi Circuit ("beginner_course")
/// is referenced nowhere outside `COURSE_NAMES`, which makes it the neutral choice.
constexpr Course NEUTRAL_COURSE = Course::Luigi_Circuit;

constexpr const char *COMMON_PATH = "Race/Common.szs";
constexpr const char *COURSE_PATH = "Race/Course/beginner_course.szs";

/// Kinoko's `MEMORY_SPACE_SIZE` is 16 MiB, which is enough for the retail courses it replays but
/// not for large custom tracks: the course archive is decompressed into this heap and then the
/// KCL, KMP and object models are allocated out of it too. We size from the archives instead.
constexpr size_t HEAP_BASE = 48u * 1024u * 1024u;
constexpr size_t HEAP_MAX = 512u * 1024u * 1024u;

void *s_memorySpace = nullptr;
size_t s_memorySpaceSize = 0;
EGG::Heap *s_rootHeap = nullptr;
EGG::SceneManager *s_sceneMgr = nullptr;
Host::SceneCreatorDynamic *s_sceneCreator = nullptr;

bool s_loaded = false;
int32_t s_frame = 0;

Character s_character = Character::Mario;
Vehicle s_vehicle = Vehicle::Standard_Kart_M;
bool s_driftIsAuto = false;

u16 s_buttons = 0;
u8 s_stickXRaw = 7;
u8 s_stickYRaw = 7;
System::Trick s_trick = System::Trick::None;

void OnRaceConfigInit(System::RaceConfig *config, void * /* arg */) {
    auto &scenario = config->raceScenario();
    scenario.course = NEUTRAL_COURSE;

    auto &player = scenario.players[0];
    player.character = s_character;
    player.vehicle = s_vehicle;
    player.driftIsAuto = s_driftIsAuto;
    player.type = System::RaceConfig::Player::Type::Local;
}

void PushInputs() {
    auto *director = System::KPadDirector::Instance();
    if (!director) {
        return;
    }

    auto *controller = director->hostController();
    if (!controller) {
        return;
    }

    controller->setInputsRawStick(s_buttons, s_stickXRaw, s_stickYRaw, s_trick);
}

void WriteVec(float *out, const EGG::Vector3f &v) {
    out[0] = v.x;
    out[1] = v.y;
    out[2] = v.z;
}

void WriteQuat(float *out, const EGG::Quatf &q) {
    out[0] = q.v.x;
    out[1] = q.v.y;
    out[2] = q.v.z;
    out[3] = q.w;
}

float TimerToMs(const System::Timer &timer) {
    if (!timer.valid) {
        return 0.0f;
    }

    return static_cast<float>(timer.min) * 60000.0f + static_cast<float>(timer.sec) * 1000.0f +
            static_cast<float>(timer.mil);
}

void TearDown() {
    if (s_sceneMgr) {
        while (auto *scene = s_sceneMgr->currentScene()) {
            // Scene heaps are locked once their engines are initialised; destruction frees
            // through the handle, but the nested scene creation on the way out does not.
            scene->heap()->enableAllocation();
            s_sceneMgr->destroyCurrentSceneNoIncoming(true);
        }

        EGG::egg_delete(s_sceneMgr);
        s_sceneMgr = nullptr;
    }

    if (s_sceneCreator) {
        EGG::egg_delete(s_sceneCreator);
        s_sceneCreator = nullptr;
    }

    if (s_rootHeap) {
        s_rootHeap->destroy();
        s_rootHeap = nullptr;
    }

    EGG::SceneManager::SetRootHeap(nullptr);

    if (s_memorySpace) {
        free(s_memorySpace);
        s_memorySpace = nullptr;
        s_memorySpaceSize = 0;
    }

    s_loaded = false;
    s_frame = 0;
}

} // namespace

extern "C" int kinoko_load_course(int character, int vehicle, int driftIsAuto) {
    if (s_loaded) {
        TearDown();
    }

    if (character < 0 || character >= static_cast<int>(Character::Max)) {
        return KINOKO_ERR_BAD_ARGUMENT;
    }

    if (vehicle < 0 || vehicle >= static_cast<int>(Vehicle::Max)) {
        return KINOKO_ERR_BAD_ARGUMENT;
    }

    if (!KinokoShimHasFile(COMMON_PATH) || !KinokoShimHasFile(COURSE_PATH)) {
        return KINOKO_ERR_MISSING_FILE;
    }

    s_character = static_cast<Character>(character);
    s_vehicle = static_cast<Vehicle>(vehicle);
    s_driftIsAuto = driftIsAuto != 0;

    // Both archives are decompressed into the engine heap and then parsed out of it, so budget a
    // multiple of the compressed sizes on top of the fixed base.
    size_t archiveBytes = KinokoShimFileSize(COMMON_PATH) + KinokoShimFileSize(COURSE_PATH);
    size_t size = HEAP_BASE + archiveBytes * 12;
    if (size > HEAP_MAX) {
        size = HEAP_MAX;
    }

    s_memorySpace = malloc(size);
    if (!s_memorySpace) {
        return KINOKO_ERR_OUT_OF_MEMORY;
    }
    s_memorySpaceSize = size;

    s_rootHeap = EGG::ExpHeap::create(s_memorySpace, size, DEFAULT_OPT);
    if (!s_rootHeap) {
        free(s_memorySpace);
        s_memorySpace = nullptr;
        s_memorySpaceSize = 0;
        return KINOKO_ERR_OUT_OF_MEMORY;
    }

    s_rootHeap->setName("EGGRoot");
    s_rootHeap->becomeCurrentHeap();
    EGG::SceneManager::SetRootHeap(s_rootHeap);

    s_sceneCreator = EGG::egg_new<Host::SceneCreatorDynamic>();
    s_sceneMgr = EGG::egg_new<EGG::SceneManager>(s_sceneCreator);

    System::RaceConfig::RegisterInitCallback(OnRaceConfigInit, nullptr);

    s_sceneMgr->changeScene(static_cast<int>(Host::SceneId::Root));

    s_loaded = true;
    s_frame = 0;
    s_buttons = 0;
    s_stickXRaw = 7;
    s_stickYRaw = 7;
    s_trick = System::Trick::None;
    PushInputs();

    return KINOKO_OK;
}

extern "C" void kinoko_set_inputs(uint16_t buttons, uint8_t stickXRaw, uint8_t stickYRaw,
        int trick) {
    s_buttons = static_cast<u16>(buttons & 0xf);
    s_stickXRaw = stickXRaw > 14 ? 14 : stickXRaw;
    s_stickYRaw = stickYRaw > 14 ? 14 : stickYRaw;
    s_trick = (trick >= 0 && trick <= 4) ? static_cast<System::Trick>(trick) : System::Trick::None;

    if (s_loaded) {
        PushInputs();
    }
}

extern "C" void kinoko_step(void) {
    if (!s_loaded || !s_sceneMgr) {
        return;
    }

    PushInputs();
    s_sceneMgr->calc();
    ++s_frame;
}

extern "C" int32_t kinoko_frame(void) {
    return s_frame;
}

extern "C" void kinoko_read_kart_state(float *out) {
    if (!out) {
        return;
    }

    memset(out, 0, KINOKO_KART_STATE_FLOATS * sizeof(float));

    auto *manager = Kart::KartObjectManager::Instance();
    if (!s_loaded || !manager) {
        return;
    }

    const auto *kart = manager->object(0);

    WriteVec(&out[0], kart->pos());
    WriteQuat(&out[3], kart->fullRot());
    WriteQuat(&out[7], kart->mainRot());
    out[11] = kart->speed();
    WriteVec(&out[12], kart->velocity());

    u16 tireCount = kart->tireCount();
    if (tireCount > 4) {
        tireCount = 4;
    }
    out[15] = static_cast<float>(tireCount);
    for (u16 i = 0; i < tireCount; ++i) {
        WriteVec(&out[16 + i * 3], kart->wheelPos(i));
    }

    const auto &status = kart->status();
    out[28] = status.onBit(Kart::eStatus::TouchingGround) ? 0.0f : 1.0f;
    out[29] = status.onBit(Kart::eStatus::DriftManual, Kart::eStatus::DriftAuto,
                      Kart::eStatus::SlipdriftCharge, Kart::eStatus::Hop) ?
            1.0f :
            0.0f;
    out[30] = status.onBit(Kart::eStatus::Boost, Kart::eStatus::MushroomBoost,
                      Kart::eStatus::RampBoost, Kart::eStatus::ZipperBoost) ?
            1.0f :
            0.0f;

    // Mini-turbo charge for the HUD. Stand-still MT: hold accelerate + brake for 75 frames, then
    // release brake. Drift MT: 270 charge frames to blue, then (karts only) 300 more to orange.
    const auto *move = kart->move();
    if (move) {
        constexpr float SSMT_MAX = 75.0f;
        constexpr float MT_MAX = 270.0f;
        constexpr float SMT_MAX = 300.0f;
        if (status.onBit(Kart::eStatus::ChargingSSMT) || move->isSsmtCharged()) {
            bool charged = move->isSsmtCharged();
            out[31] = charged ? 2.0f : 1.0f;
            out[32] = charged ? 1.0f : std::min(1.0f, static_cast<float>(move->ssmtCharge()) / SSMT_MAX);
        } else {
            switch (move->driftState()) {
            case Kart::KartMove::DriftState::ChargingMt:
                out[31] = 3.0f;
                out[32] = std::min(1.0f, static_cast<float>(move->mtCharge()) / MT_MAX);
                break;
            case Kart::KartMove::DriftState::ChargedMt: // == ChargingSmt
                out[31] = 4.0f;
                out[32] = std::min(1.0f, static_cast<float>(move->smtCharge()) / SMT_MAX);
                break;
            case Kart::KartMove::DriftState::ChargedSmt:
                out[31] = 5.0f;
                out[32] = 1.0f;
                break;
            default:
                break;
            }
        }
    }
}

extern "C" void kinoko_read_race_state(int32_t *outInts, float *outFloats) {
    if (outInts) {
        memset(outInts, 0, KINOKO_RACE_STATE_INTS * sizeof(int32_t));
    }
    if (outFloats) {
        memset(outFloats, 0, KINOKO_RACE_STATE_FLOATS * sizeof(float));
    }

    auto *raceMgr = System::RaceManager::Instance();
    if (!s_loaded || !raceMgr || !outInts || !outFloats) {
        return;
    }

    const auto &player = raceMgr->player();

    outInts[0] = static_cast<int32_t>(raceMgr->stage());
    outInts[1] = s_frame;

    s16 lap = player.currentLap();
    outInts[2] = lap < 1 ? 1 : static_cast<int32_t>(lap);

    auto *courseMap = System::CourseMap::Instance();
    const auto *stageInfo = courseMap ? courseMap->getStageInfo() : nullptr;
    outInts[3] = stageInfo ? static_cast<int32_t>(stageInfo->lapCount()) : 0;

    outInts[4] = static_cast<int32_t>(player.checkpointId());
    outInts[5] = static_cast<int32_t>(player.jugemId());

    outFloats[0] = TimerToMs(raceMgr->timerManager().currentTimer());
    outFloats[1] = player.lapCompletion();
    outFloats[5] = player.raceCompletion();

    const auto &lapTimers = player.lapTimers();
    int32_t splitCount = 0;
    for (size_t i = 0; i < lapTimers.size(); ++i) {
        if (!lapTimers[i].valid) {
            break;
        }

        outFloats[2 + i] = TimerToMs(player.getLapSplit(i + 1));
        ++splitCount;
    }
    outInts[6] = splitCount;
}

extern "C" int kinoko_read_camera_state(float *out) {
    if (!out) {
        return 0;
    }

    auto *camera = Render::KartCamera::Instance();
    if (!s_loaded || !camera) {
        return 0;
    }

    memset(out, 0, KINOKO_CAMERA_STATE_FLOATS * sizeof(float));

    const auto &state = camera->forwardCamera();
    WriteVec(&out[0], state.pos());
    WriteVec(&out[3], state.targetPos());
    out[6] = camera->fov();

    return 1;
}

extern "C" int kinoko_restart(void) {
    if (!s_loaded || !s_sceneMgr) {
        return KINOKO_ERR_NOT_LOADED;
    }

    if (auto *scene = s_sceneMgr->currentScene()) {
        scene->heap()->enableAllocation();
    }

    // A full scene rebuild is the only reliable reset: `reinitCurrentScene()` keeps the root
    // scene's singletons alive but leaves the race heap in a state that has already been
    // allocation-locked, and re-running `configure()` on it panics.
    s_sceneMgr->changeScene(static_cast<int>(Host::SceneId::Root));

    s_frame = 0;
    PushInputs();
    return KINOKO_OK;
}

extern "C" void kinoko_shutdown(void) {
    TearDown();
}

extern "C" size_t kinoko_heap_size(void) {
    return s_memorySpaceSize;
}
