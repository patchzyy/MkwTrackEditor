import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const dirs = ['D:/Games/Wii/Dolphin-2/RR/RetroRewind6/CT/Tracks', 'C:/Users/patchzy/AppData/Roaming/Dolphin Emulator/Load/Riivolution/WheelWizard/RRBeta/Tracks'];
function decodeYaz0(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const n = dv.getUint32(4);
  const out = new Uint8Array(n);
  let src = 16, dst = 0, vb = 0, code = 0;
  while (dst < n) {
    if (vb === 0) { code = data[src++]; vb = 8; }
    if (code & 0x80) { out[dst++] = data[src++]; }
    else {
      const b1 = data[src++], b2 = data[src++];
      const dist = ((b1 & 0x0f) << 8) | b2;
      let c = b1 >>> 4;
      if (c === 0) c = data[src++] + 0x12; else c += 2;
      const cs = dst - (dist + 1);
      for (let i = 0; i < c && dst < n; i++) out[dst++] = out[cs + i];
    }
    code = (code << 1) & 0xff; vb--;
  }
  return out;
}
for (const d of dirs) {
  const f = readdirSync(d).filter((x) => x.toLowerCase().endsWith('.szs')).slice(0, 2);
  for (const name of f) {
    const raw = new Uint8Array(readFileSync(join(d, name)));
    const u8 = decodeYaz0(raw);
    const dv = new DataView(u8.buffer);
    console.log(name, 'magic', dv.getUint32(0).toString(16), 'rootOff', dv.getUint32(4), 'tblSize', dv.getUint32(8), 'dataOff', dv.getUint32(12), 'len', u8.length, 'resv', dv.getUint32(16), dv.getUint32(20), dv.getUint32(24), dv.getUint32(28));
    const rootOffset = dv.getUint32(4);
    const nodeCount = dv.getUint32(rootOffset + 8);
    const strTab = rootOffset + nodeCount * 12;
    const nodes = [];
    for (let i = 0; i < nodeCount; i++) { const o = rootOffset + i * 12; const tn = dv.getUint32(o); nodes.push({ type: tn >>> 24, nameOff: tn & 0xffffff, dataOff: dv.getUint32(o + 4), size: dv.getUint32(o + 8) }); }
    const nameAt = (off) => { let e = strTab + off; while (u8[e] !== 0) e++; return new TextDecoder().decode(u8.slice(strTab + off, e)); };
    console.log('  nodeCount', nodeCount);
    for (let i = 0; i < Math.min(nodeCount, 12); i++) { const n = nodes[i]; console.log('   ', i, n.type ? 'D' : 'F', JSON.stringify(nameAt(n.nameOff)), n.dataOff, n.size, n.type ? '' : 'align:' + (n.dataOff % 32)); }
    const aligns = new Set();
    for (const n of nodes) if (!n.type) aligns.add(n.dataOff % 32);
    console.log('  file dataOff %32 set:', [...aligns].join(','));
    const files = nodes.filter((n) => !n.type).slice();
    const sorted = files.slice().sort((a, b) => a.dataOff - b.dataOff);
    console.log('  fileOrderMatchesNodeOrder:', files.every((n, i) => n.dataOff === sorted[i].dataOff));
    let ok = true, cur = null;
    for (const n of sorted) { if (cur !== null && n.dataOff !== Math.ceil(cur / 32) * 32) ok = false; cur = n.dataOff + n.size; }
    console.log('  contiguous32:', ok, 'firstFileOff', sorted[0]?.dataOff, 'tailAfterLast', u8.length - (sorted.at(-1).dataOff + sorted.at(-1).size));
  }
}
