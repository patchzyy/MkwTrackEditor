#!/usr/bin/env node
// Builds the vendored Kinoko physics engine (vendor/Kinoko) plus native/kinoko-shim to
// WebAssembly with Emscripten, and writes the result to src/lib/playtest/wasm/.
//
//   npm run build:kinoko            release build (-O2, no assertions)
//   npm run build:kinoko -- --debug debug build   (-O0 -g -sASSERTIONS=1)
//   npm run build:kinoko -- --clean wipe the object directory first
//   npm run build:kinoko -- --profiling keep C++ symbol names in wasm stack traces
//
// Emscripten is located through $EMSDK, else C:\Users\<you>\emsdk (Windows) / ~/emsdk. Install it
// with:
//   git clone https://github.com/emscripten-core/emsdk && cd emsdk
//   ./emsdk install latest && ./emsdk activate latest
//
// The generated kinoko.mjs / kinoko.wasm are committed: the GitHub Pages deploy does not run
// Emscripten, they are ordinary static assets.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kinokoRoot = path.join(repoRoot, 'vendor', 'Kinoko');
const shimRoot = path.join(repoRoot, 'native', 'kinoko-shim');
const buildRoot = path.join(repoRoot, 'native', 'kinoko-shim', 'build');
const outDir = path.join(repoRoot, 'src', 'lib', 'playtest', 'wasm');

const args = process.argv.slice(2);
const debug = args.includes('--debug');
const clean = args.includes('--clean');
// Kinoko's PANIC/ASSERT only print a file:line; --profiling makes the JS stack trace name the
// C++ frames that led there, which is how you find out *which* object tripped over the data.
const profiling = args.includes('--profiling');

// --- toolchain -------------------------------------------------------------------------------

function findEmscripten() {
  const candidates = [];
  if (process.env.EMSDK) candidates.push(path.join(process.env.EMSDK, 'upstream', 'emscripten'));
  if (process.env.EMSCRIPTEN) candidates.push(process.env.EMSCRIPTEN);
  candidates.push(path.join(homedir(), 'emsdk', 'upstream', 'emscripten'));

  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'emcc.py'))) return dir;
  }

  throw new Error(
    `Could not find Emscripten. Tried:\n  ${candidates.join('\n  ')}\n` +
      'Set EMSDK to your emsdk checkout, or install it there.',
  );
}

const emscriptenDir = findEmscripten();
// emsdk ships native launchers on Windows and shell wrappers elsewhere; prefer the launcher.
const emcc = ['em++.exe', 'em++.bat', 'em++']
  .map((name) => path.join(emscriptenDir, name))
  .find((candidate) => existsSync(candidate));
if (!emcc) throw new Error(`No em++ launcher in ${emscriptenDir}`);

function findNinja() {
  for (const name of ['ninja', 'ninja.exe']) {
    if (spawnSync(name, ['--version'], { encoding: 'utf8' }).status === 0) return name;
  }
  throw new Error('ninja was not found on PATH. Install it (winget install Ninja-build.Ninja).');
}

const ninja = findNinja();

// --- source list -----------------------------------------------------------------------------

function collect(dir, ext, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

const sources = [
  ...collect(path.join(kinokoRoot, 'source'), '.cc'),
  ...collect(shimRoot, '.cc'),
].sort();

if (sources.length === 0) throw new Error('No .cc sources found; is vendor/Kinoko populated?');

// --- flags -----------------------------------------------------------------------------------

// Mirrors upstream configure.py, minus -Werror (a different compiler than upstream's g++ finds
// different warnings) and minus the x86-only bits. -fshort-wchar has to stay: GhostFile's
// STATIC_ASSERTs on struct sizes depend on a 2-byte wchar_t.
const commonFlags = [
  '-DREVOLUTION',
  '-fcheck-new',
  '-ffp-contract=off',
  '-fno-asynchronous-unwind-tables',
  '-fno-exceptions',
  '-fno-rtti',
  '-fshort-wchar',
  '-fstack-protector-strong',
  '-std=c++23',
  '-Wall',
  '-Wextra',
  '-Wno-delete-non-virtual-dtor',
  '-Wno-unused-parameter',
  // libc++ does not leak the standard headers libstdc++ does; see kinoko_prelude.hh.
  '-include',
  path.relative(buildRoot, path.join(shimRoot, 'kinoko_prelude.hh')).replaceAll('\\', '/'),
  '-isystem',
  path.relative(buildRoot, path.join(kinokoRoot, 'include')).replaceAll('\\', '/'),
  '-isystem',
  path.relative(buildRoot, path.join(kinokoRoot, 'source')).replaceAll('\\', '/'),
  '-I',
  path.relative(buildRoot, shimRoot).replaceAll('\\', '/'),
];

const optFlags = debug ? ['-O0', '-g', '-DBUILD_DEBUG'] : ['-O2'];

const exportedFunctions = [
  '_kinoko_provide_file',
  '_kinoko_clear_files',
  '_kinoko_load_course',
  '_kinoko_set_inputs',
  '_kinoko_set_infinite_items',
  '_kinoko_step',
  '_kinoko_frame',
  '_kinoko_read_kart_state',
  '_kinoko_read_race_state',
  '_kinoko_read_camera_state',
  '_kinoko_restart',
  '_kinoko_shutdown',
  '_kinoko_heap_size',
  '_malloc',
  '_free',
];

const exportedRuntimeMethods = ['HEAPU8', 'HEAP32', 'HEAPF32'];

// Emscripten only emits the `Module[...]` reads for the API entries listed here, and `wasmBinary`
// is NOT in the default list. Without it the tests would silently fall through to fetching
// kinoko.wasm off disk instead of using the bytes they were handed.
const incomingModuleJsApi = [
  'wasmBinary',
  'locateFile',
  'instantiateWasm',
  'print',
  'printErr',
  'onAbort',
];

const linkFlags = [
  ...optFlags,
  '-sMODULARIZE=1',
  '-sEXPORT_ES6=1',
  "-sEXPORT_NAME='createKinokoModule'",
  '-sENVIRONMENT=web,worker,node',
  '-sALLOW_MEMORY_GROWTH=1',
  '-sINITIAL_MEMORY=134217728',
  '-sMAXIMUM_MEMORY=1073741824',
  '-sFILESYSTEM=0',
  '-sSTACK_SIZE=1048576',
  '-sDISABLE_EXCEPTION_CATCHING=1',
  `-sEXPORTED_FUNCTIONS=${JSON.stringify(exportedFunctions)}`,
  `-sEXPORTED_RUNTIME_METHODS=${JSON.stringify(exportedRuntimeMethods)}`,
  `-sINCOMING_MODULE_JS_API=${JSON.stringify(incomingModuleJsApi)}`,
  debug ? '-sASSERTIONS=1' : '-sASSERTIONS=0',
  ...(profiling ? ['--profiling-funcs'] : []),
];

// --- ninja file ------------------------------------------------------------------------------

mkdirSync(buildRoot, { recursive: true });
mkdirSync(outDir, { recursive: true });

const rel = (p) => path.relative(buildRoot, p).replaceAll('\\', '/');
// Ninja treats ':' as a path separator in build statements, so absolute Windows paths have to
// stay relative to the build directory.
const escape = (s) => s.replaceAll('$', '$$').replaceAll(' ', '$ ');

const objSuffix = debug ? '.d.o' : '.o';
const lines = [];
lines.push('ninja_required_version = 1.8');
lines.push(`emcc = ${escape(emcc)}`);
lines.push(`ccflags = ${[...commonFlags, ...optFlags].join(' ')}`);
lines.push(`ldflags = ${linkFlags.join(' ')}`);
lines.push('');
lines.push('rule cc');
lines.push('  command = $emcc -MD -MF $out.d $ccflags -c $in -o $out');
lines.push('  depfile = $out.d');
lines.push('  deps = gcc');
lines.push('  description = CC $out');
lines.push('');
lines.push('rule link');
lines.push('  command = $emcc $ldflags $in -o $out');
lines.push('  description = LINK $out');
lines.push('');

const objects = [];
for (const src of sources) {
  const relSrc = rel(src);
  const obj = `obj/${path.relative(repoRoot, src).replaceAll('\\', '/')}${objSuffix}`;
  objects.push(obj);
  lines.push(`build ${escape(obj)}: cc ${escape(relSrc)}`);
}
lines.push('');
lines.push(`build ${escape(rel(path.join(outDir, 'kinoko.mjs')))}: link ${objects.map(escape).join(' ')}`);
lines.push('');
lines.push(`default ${escape(rel(path.join(outDir, 'kinoko.mjs')))}`);
lines.push('');

const ninjaFile = path.join(buildRoot, 'build.ninja');
writeFileSync(ninjaFile, lines.join('\n'));

if (clean) {
  const result = spawnSync(ninja, ['-C', buildRoot, '-t', 'clean'], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`[kinoko] emscripten: ${emscriptenDir}`);
console.log(`[kinoko] ${sources.length} translation units, ${debug ? 'debug' : 'release'} build`);

const started = Date.now();
const build = spawnSync(ninja, ['-C', buildRoot], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const wasm = path.join(outDir, 'kinoko.wasm');
const glue = path.join(outDir, 'kinoko.mjs');
for (const file of [wasm, glue]) {
  if (!existsSync(file)) throw new Error(`Expected ${file} to exist after the link step`);
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `[kinoko] done in ${seconds}s — kinoko.wasm ${(statSync(wasm).size / 1024 / 1024).toFixed(2)} MiB, ` +
    `kinoko.mjs ${(statSync(glue).size / 1024).toFixed(0)} KiB`,
);
