// Robustness sweep: loads every track in a folder and simulates a few hundred frames.
//   node native/kinoko-shim/sweep.mjs <dir> [limit]
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const createKinokoModule = (
  await import(pathToFileURL(path.join(root, 'src/lib/playtest/wasm/kinoko.mjs')).href)
).default;

const dir = process.argv[2];
const limit = Number(process.argv[3] ?? 1e9);
const tracks = readdirSync(dir)
  .filter((n) => n.toLowerCase().endsWith('.szs'))
  .sort()
  .slice(0, limit);

const common = new Uint8Array(
  readFileSync(path.join(root, 'public/data/MarioKartWii/Race/Common.szs')),
);
const wasmBinary = new Uint8Array(readFileSync(path.join(root, 'src/lib/playtest/wasm/kinoko.wasm')));

let ok = 0;
const failures = [];

for (const name of tracks) {
  const logs = [];
  try {
    const mod = await createKinokoModule({
      wasmBinary,
      print: (l) => logs.push(l),
      printErr: (l) => logs.push(l),
    });

    const provide = (p, bytes) => {
      const pp = mod._malloc(p.length + 1);
      mod.HEAPU8.set(new TextEncoder().encode(p + '\0'), pp);
      const dp = mod._malloc(bytes.length);
      mod.HEAPU8.set(bytes, dp);
      mod._kinoko_provide_file(pp, dp, bytes.length);
      mod._free(dp);
      mod._free(pp);
    };

    provide('Race/Common.szs', common);
    provide('Race/Course/beginner_course.szs', new Uint8Array(readFileSync(path.join(dir, name))));

    const rc = mod._kinoko_load_course(22, 23, 0);
    if (rc !== 0) throw new Error(`load status ${rc}`);

    const kartBuf = mod._malloc(32 * 4);
    mod._kinoko_set_inputs(0x1, 7, 7, 0);
    for (let i = 0; i < 700; i++) mod._kinoko_step();
    mod._kinoko_read_kart_state(kartBuf);
    const f = mod.HEAPF32.subarray(kartBuf >> 2, (kartBuf >> 2) + 32);
    if (!Number.isFinite(f[0]) || !Number.isFinite(f[11])) throw new Error('non-finite state');
    mod._kinoko_restart();
    for (let i = 0; i < 60; i++) mod._kinoko_step();
    mod._kinoko_shutdown();
    ok++;
    console.log(`ok   ${name}  speed=${f[11].toFixed(2)}`);
  } catch (error) {
    const relevant = logs.filter((l) => l.includes('ASSERT') || l.includes('PANIC')).slice(-2);
    failures.push({ name, error: String(error).split('\n')[0], relevant });
    console.log(`FAIL ${name}: ${String(error).split('\n')[0]} ${relevant.join(' | ')}`);
  }
}

console.log(`\n${ok}/${tracks.length} ok`);
for (const f of failures) console.log('  -', f.name, f.error, f.relevant.join(' | '));
