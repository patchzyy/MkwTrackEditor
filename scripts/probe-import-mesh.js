// Probe body for scripts/viewport-dev-probe.mjs: imports an object BRRES into the scene
// as course geometry and checks that it becomes pickable, then removes it again.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Minimal U8 reader so the probe can pull a .brres out of the bundled asset pool.
function readU8Archive(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0) !== 0x55aa382d) throw new Error('not a U8 archive');
  const firstNode = view.getUint32(0x04);
  const nodeCount = view.getUint32(firstNode + 0x08);
  const stringTable = firstNode + nodeCount * 12;
  const files = [];
  for (let i = 0; i < nodeCount; i++) {
    const offset = firstNode + i * 12;
    const type = view.getUint8(offset);
    const nameOffset = (view.getUint8(offset + 1) << 16) | view.getUint16(offset + 2);
    const dataOffset = view.getUint32(offset + 4);
    const size = view.getUint32(offset + 8);
    if (type !== 0) continue;
    let end = stringTable + nameOffset;
    while (view.getUint8(end) !== 0) end++;
    const name = new TextDecoder().decode(new Uint8Array(buffer, stringTable + nameOffset, end - (stringTable + nameOffset)));
    files.push({ name, dataOffset, size });
  }
  return files;
}

const response = await fetch('/data/MarioKartWii/Race/Course/ExtractedAssets.u8');
if (!response.ok) return { error: 'ExtractedAssets.u8 missing: ' + response.status };
const pool = await response.arrayBuffer();
const files = readU8Archive(pool).filter((f) => f.name.toLowerCase().endsWith('.brres'));
if (files.length === 0) return { error: 'no BRRES in the asset pool' };
const chosen = files.find((f) => /itembox|tree|kuribo/i.test(f.name)) ?? files[0];
const brres = new Uint8Array(pool, chosen.dataOffset, chosen.size);

[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Model')?.click();
await sleep(500);
mkw.setMode('model');
mkw.setMeshGranularity('shape');
const before = mkw.listMeshes().length;

const reference = mkw.listMeshes()[0];
const bounds = reference ? mkw.getMeshBounds(reference) : null;
const at = bounds ? { x: bounds.center.x, y: bounds.center.y + 3000, z: bounds.center.z } : { x: 0, y: 2000, z: 0 };
const id = mkw.addImportedMesh(brres, null, { position: at, scale: { x: 40, y: 40, z: 40 } });
await sleep(1200);
const after = mkw.listMeshes().length;

const importedMeshes = mkw.listMeshes().filter((m) => m.archivePath.includes('editor-imported'));
if (importedMeshes.length > 0) {
  mkw.selectMeshAt(0, 0, false);
  const bbox = mkw.getMeshBounds(importedMeshes[0]);
  if (bbox) {
    // Frame the import by selecting it through the renderer bounds.
    mkw.setMeshGranularity('shape');
  }
}
await shot('model-imported-mesh');

const ids = mkw.listImportedMeshes();
const removedOk = mkw.removeImportedMesh(id);
await sleep(800);
const removed = mkw.listMeshes().length;
await shot('model-imported-mesh-removed');

return { id, before, after, removed, removedOk, ids, chosen: chosen.name, brresFiles: files.length, importedDrawCalls: importedMeshes.length, placedAt: at };
