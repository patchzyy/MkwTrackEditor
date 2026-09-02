import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
const { readKmpFile, writeKmpFile } = await server.ssrLoadModule('/src/lib/kmpFile.ts');
const { decodeYaz0 } = await server.ssrLoadModule('/src/lib/yaz0.ts');
const { parseU8 } = await server.ssrLoadModule('/src/lib/u8.ts');

const dirs = ['D:/Games/Wii/Dolphin-2/RR/RetroRewind6/CT/Tracks', 'C:/Users/patchzy/AppData/Roaming/Dolphin Emulator/Load/Riivolution/WheelWizard/RRBeta/Tracks'];
let ok = 0;
let fail = 0;
const failures = [];
for (const dir of dirs) {
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.szs'));
  for (const name of files) {
    let kmpBytes;
    try {
      const entries = parseU8(decodeYaz0(new Uint8Array(readFileSync(join(dir, name)))));
      kmpBytes = entries.find((e) => e.path.toLowerCase().endsWith('course.kmp'))?.data;
    } catch (e) {
      failures.push([name, 'archive: ' + e.message]);
      fail++;
      continue;
    }
    if (!kmpBytes) continue;
    try {
      const file = readKmpFile(kmpBytes);
      const out = writeKmpFile(file);
      if (out.length !== kmpBytes.length) {
        failures.push([name, `length ${out.length} vs ${kmpBytes.length}`]);
        fail++;
        continue;
      }
      let diff = -1;
      for (let i = 0; i < out.length; i++) if (out[i] !== kmpBytes[i]) { diff = i; break; }
      if (diff >= 0) {
        const sec = file.sectionLayout.join(',');
        failures.push([name, `byte ${diff} (0x${diff.toString(16)}) got ${out[diff]} want ${kmpBytes[diff]} sections=${sec}`]);
        fail++;
      } else ok++;
    } catch (e) {
      failures.push([name, 'parse: ' + e.message]);
      fail++;
    }
  }
}
console.log('ok', ok, 'fail', fail);
for (const f of failures.slice(0, 25)) console.log(' ', f[0], '->', f[1]);
await server.close();
