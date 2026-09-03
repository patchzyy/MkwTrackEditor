#pragma once

#include "game/system/map/MapdataAccessorBase.hh"

#include <egg/util/Stream.hh>

namespace Kinoko::System {

class MapdataStageInfo {
public:
    struct SData {
        // KINOKO-PATCH(mkw-track-editor): byte 0 of an STGI entry is the lap count. Upstream
        // does not model it (Kinoko always races 3 laps); we surface it for the editor's HUD.
        u8 lapCount;
        u8 polePosition;
        u8 translationMode;
        u8 _3[0xc - 0x3];
    };
    STATIC_ASSERT(sizeof(SData) == 0xc);

    MapdataStageInfo(const SData *data);

    void read(EGG::Stream &stream);

    // KINOKO-PATCH(mkw-track-editor): see SData::lapCount above.
    [[nodiscard]] u8 lapCount() const {
        return m_rawData->lapCount;
    }

    [[nodiscard]] u8 polePosition() const {
        return m_rawData->polePosition;
    }

    [[nodiscard]] u8 translationMode() const {
        return m_rawData->translationMode;
    }

private:
    const SData *m_rawData;
};

class MapdataStageInfoAccessor
    : public MapdataAccessorBase<MapdataStageInfo, MapdataStageInfo::SData> {
public:
    MapdataStageInfoAccessor(const MapSectionHeader *header);
    ~MapdataStageInfoAccessor() override;
};

} // namespace Kinoko::System
