// Forced include (via `-include`) for every Kinoko translation unit.
//
// Upstream builds Kinoko with GCC/libstdc++, whose headers transitively drag in most of the
// standard library. Emscripten uses libc++, which is much stricter about what each header
// exposes, so a from-scratch build hits dozens of "no member named 'fill' in namespace 'std'"
// style errors in code that never included <algorithm> itself.
//
// Supplying the headers here instead of editing ~50 vendored files keeps `vendor/Kinoko` a clean
// copy of upstream. Nothing in this file changes behaviour; it only makes declarations visible.

#pragma once

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <compare>
#include <concepts>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <iterator>
#include <limits>
#include <list>
#include <memory>
#include <numeric>
#include <span>
#include <string>
#include <type_traits>
#include <unordered_map>
#include <utility>
#include <vector>
