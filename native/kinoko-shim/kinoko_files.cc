// In-memory replacement for Kinoko's `Abstract::File`.
//
// Upstream's `source/abstract/File.cc` reads through `std::ifstream`. We build with
// `-sFILESYSTEM=0`, so there is no filesystem to read from: instead the JavaScript side hands us
// the archive bytes up front with `kinoko_provide_file()` and this translation unit serves them.
//
// `Abstract::File::Load` must return a buffer allocated from the current EGG heap, because
// `DvdArchive` frees it with `EGG::egg_free`. The registry itself lives in ordinary malloc'd
// memory so that files can be provided before the engine heap exists and survive a shutdown.

#include "kinoko_shim.h"

#include <abstract/File.hh>
#include <egg/core/Heap.hh>

#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace {

struct ProvidedFile {
    std::string path;
    std::vector<uint8_t> data;
};

std::vector<ProvidedFile> &Registry() {
    // Function-local static: no global constructor ordering concerns.
    static std::vector<ProvidedFile> registry;
    return registry;
}

/// Kinoko asks for paths both with and without a leading slash, and `Abstract::File::Load`
/// normalises by stripping it. We key on the stripped form.
const char *Normalise(const char *path) {
    return (path && path[0] == '/') ? path + 1 : path;
}

const ProvidedFile *Find(const char *path) {
    const char *key = Normalise(path);
    if (!key) {
        return nullptr;
    }

    for (const auto &entry : Registry()) {
        if (entry.path == key) {
            return &entry;
        }
    }

    return nullptr;
}

} // namespace

bool KinokoShimHasFile(const char *path) {
    return Find(path) != nullptr;
}

size_t KinokoShimTotalProvidedBytes() {
    size_t total = 0;
    for (const auto &entry : Registry()) {
        total += entry.data.size();
    }
    return total;
}

size_t KinokoShimFileSize(const char *path) {
    const ProvidedFile *entry = Find(path);
    return entry ? entry->data.size() : 0;
}

namespace Kinoko::Abstract::File {

u8 *Load(const char *path, size_t &size) {
    const ProvidedFile *entry = Find(path);
    if (!entry) {
        PANIC("File with provided path %s was not registered!", path ? path : "(null)");
    }

    size = entry->data.size();
    u8 *buffer = static_cast<u8 *>(EGG::egg_alloc(size, 4));
    memcpy(buffer, entry->data.data(), size);
    return buffer;
}

void Append(const char * /* path */, const char * /* data */, size_t /* size */) {
    // No writable filesystem in the browser build. Kinoko only uses this for replay reports.
}

int Remove(const char * /* path */) {
    return 0;
}

} // namespace Kinoko::Abstract::File

extern "C" int kinoko_provide_file(const char *path, const uint8_t *data, size_t size) {
    if (!path || (!data && size != 0)) {
        return KINOKO_ERR_BAD_ARGUMENT;
    }

    const std::string key = Normalise(path);
    auto &registry = Registry();

    for (auto &entry : registry) {
        if (entry.path == key) {
            entry.data.assign(data, data + size);
            return KINOKO_OK;
        }
    }

    ProvidedFile entry;
    entry.path = key;
    entry.data.assign(data, data + size);
    registry.push_back(std::move(entry));
    return KINOKO_OK;
}

extern "C" void kinoko_clear_files(void) {
    Registry().clear();
    Registry().shrink_to_fit();
}
