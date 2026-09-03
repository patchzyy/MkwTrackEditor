// Throwaway harness for poking at the raw WASM module without the TypeScript wrapper.
//   node native/kinoko-shim/smoke.mjs [path/to/course.szs]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const createKinokoModule = (
  await import(pathToFileURL(path.join(root, 'src/lib/playtest/wasm/kinoko.mjs')).href)
).default;

const coursePath = process.argv[2] ?? path.join(root, 'public/dev-tracks/nintendo_1.szs');
const common = new Uint8Array(readFileSync(path.join(root, 'public/data/MarioKartWii/Race/Common.szs')));
const course = new Uint8Array(readFileSync(coursePath));

const logs = [];
const mod = await createKinokoModule({
  print: (line) => { logs.push(line); console.log('[kinoko]', line); },
  printErr: (line) => { logs.push(line); console.log('[kinoko:err]', line); },
});

function provide(name, bytes) {
  const pathPtr = mod._malloc(name.length + 1);
  mod.HEAPU8.set(new TextEncoder().encode(name + '\0'), pathPtr);
  const dataPtr = mod._malloc(bytes.length);
  mod.HEAPU8.set(bytes, dataPtr);
  const rc = mod._kinoko_provide_file(pathPtr, dataPtr, bytes.length);
  mod._free(dataPtr);
  mod._free(pathPtr);
  if (rc !== 0) throw new Error(`provide ${name} -> ${rc}`);
}

provide('Race/Common.szs', common);
provide('Race/Course/beginner_course.szs', course);

console.log('loading', coursePath, `(${course.length} bytes)`);
const rc = mod._kinoko_load_course(22 /* Funky Kong */, 23 /* Flame Runner */, 0);
console.log('load ->', rc, 'heap', mod._kinoko_heap_size() / 1024 / 1024, 'MiB');
if (rc !== 0) process.exit(1);

const kartBuf = mod._malloc(32 * 4);
const raceInts = mod._malloc(8 * 4);
const raceFloats = mod._malloc(8 * 4);
const camBuf = mod._malloc(8 * 4);

function kart() { mod._kinoko_read_kart_state(kartBuf); return mod.HEAPF32.subarray(kartBuf >> 2, (kartBuf >> 2) + 32); }
function race() {
  mod._kinoko_read_race_state(raceInts, raceFloats);
  return {
    ints: Array.from(mod.HEAP32.subarray(raceInts >> 2, (raceInts >> 2) + 8)),
    floats: Array.from(mod.HEAPF32.subarray(raceFloats >> 2, (raceFloats >> 2) + 8)),
  };
}

const start = Array.from(kart().subarray(0, 3));
console.log('start pos', start, 'race', race());

mod._kinoko_set_inputs(0x1, 7, 7, 0);
const t0 = performance.now();
const FRAMES = 900;
const stages = new Set();
for (let i = 0; i < FRAMES; i++) {
  mod._kinoko_step();
  stages.add(race().ints[0]);
}
const t1 = performance.now();

const k = kart();
const end = Array.from(k.subarray(0, 3));
const dist = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
console.log('end pos', end, 'dist', dist.toFixed(1));
console.log('speed', k[11], 'wheels', k[15], 'airborne', k[28], 'drift', k[29], 'boost', k[30]);
console.log('stages seen', [...stages], 'race', race());
console.log('camera ok', mod._kinoko_read_camera_state(camBuf), Array.from(mod.HEAPF32.subarray(camBuf >> 2, (camBuf >> 2) + 8)));
console.log(`step: ${((t1 - t0) / FRAMES).toFixed(3)} ms/frame`);

console.log('restart ->', mod._kinoko_restart());
console.log('pos after restart', Array.from(kart().subarray(0, 3)));
mod._kinoko_shutdown();
console.log('shutdown ok');
