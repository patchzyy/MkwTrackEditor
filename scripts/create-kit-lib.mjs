/**
 * Shared helpers for the Create-mode asset kit scripts (`build-create-kit.mjs` and friends).
 *
 *  - `startVite()` loads the TypeScript library sources through Vite SSR exactly like
 *    `scripts/batch-track-check.mjs` does, so the kit is built by the same code the editor runs.
 *  - PNG encode / decode (zlib is all Node needs), RGBA resize, a tiny digit font for contact sheets.
 *  - `surveyCourseModel()` measures a retail `course_model.brres`: per material, the textures, the
 *    lighting indices, animation targets, the KCL flag underneath it and its UV density.
 */

import { createServer } from 'vite';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_RETAIL_DIR = 'D:/Games/Wii/mkw-retail-extract/DATA/files/Race/Course';

export function retailDir() {
  return process.env.MKW_RETAIL_COURSE_DIR || DEFAULT_RETAIL_DIR;
}

// ------------------------------------------------------------------------------------ vite

export async function startVite() {
  const server = await createServer({
    root: ROOT,
    configFile: resolve(ROOT, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    logLevel: 'error',
  });
  const load = (p) => server.ssrLoadModule(p);
  const mods = {
    server,
    yaz0: await load('/src/lib/yaz0.ts'),
    u8: await load('/src/lib/u8.ts'),
    brresRaw: await load('/src/lib/brres/brresRaw.ts'),
    mdl0Raw: await load('/src/lib/brres/mdl0Raw.ts'),
    gxVertex: await load('/src/lib/brres/gxVertex.ts'),
    meshBake: await load('/src/lib/brres/meshBake.ts'),
    archive: await load('/src/lib/gxMaterial/archive.ts'),
    kcl: await load('/src/lib/kcl.ts'),
    kmpFile: await load('/src/lib/kmpFile.ts'),
    noclipBrres: await load('/vendor/noclip.website/src/rres/brres.ts'),
    gxTexture: await load('/vendor/noclip.website/src/gx/gx_texture.ts'),
    slice: (await load('/vendor/noclip.website/src/ArrayBufferSlice.ts')).default,
    tex0Brres: await load('/src/lib/tex0Brres.ts'),
    tex0Codec: await load('/src/lib/tex0Codec.ts'),
    posteffects: await load('/src/lib/posteffects.ts'),
  };
  return mods;
}

// ------------------------------------------------------------------------------------ archives

/** Reads a retail `.szs` into `Map<path without leading './', bytes>` (files only). */
export function readSzs(mods, file) {
  const raw = new Uint8Array(readFileSync(file));
  const data = mods.yaz0.isYaz0(raw) ? mods.yaz0.decodeYaz0(raw) : raw;
  const files = new Map();
  for (const entry of mods.u8.parseU8(data)) {
    if (entry.type === 'file') files.set(entry.path.replace(/^\.?\//, ''), entry.data);
  }
  return files;
}

export function listRetailTracks() {
  const dir = retailDir();
  const out = [];
  for (const name of readdirSyncSafe(dir)) {
    if (!name.endsWith('.szs') || name.endsWith('_d.szs')) continue;
    out.push(name.replace(/\.szs$/, ''));
  }
  return out.sort();
}

function readdirSyncSafe(dir) {
  return existsSync(dir) ? readdirSync(dir) : [];
}

// ------------------------------------------------------------------------------------ PNG

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGBA8 -> PNG bytes. Deterministic (fixed zlib level, no timestamps). */
export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', idat),
      chunk('IEND', new Uint8Array(0)),
    ]),
  );
}

/** PNG (8-bit RGB/RGBA/gray, non-interlaced) -> { width, height, rgba }. */
export function decodePng(bytes) {
  const buf = Buffer.from(bytes);
  let pos = 8;
  let width = 0, height = 0, colorType = 6, bitDepth = 8;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('decodePng: only 8-bit PNGs are supported');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0;
  if (!channels) throw new Error(`decodePng: unsupported color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (channels === 4) for (let k = 0; k < 4; k++) rgba[i * 4 + k] = out[i * 4 + k];
    else if (channels === 3) { rgba[i * 4] = out[i * 3]; rgba[i * 4 + 1] = out[i * 3 + 1]; rgba[i * 4 + 2] = out[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
    else { const g = out[i * channels]; rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g; rgba[i * 4 + 3] = channels === 2 ? out[i * 2 + 1] : 255; }
  }
  return { width, height, rgba };
}

/** Box-filter resize of an RGBA image (premultiplied-correct averaging). */
export function resizeRgba(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = (y * sh) / dh, y1 = ((y + 1) * sh) / dh;
    for (let x = 0; x < dw; x++) {
      const x0 = (x * sw) / dw, x1 = ((x + 1) * sw) / dw;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const w = wy * (Math.min(xx + 1, x1) - Math.max(xx, x0));
          const i = (Math.min(yy, sh - 1) * sw + Math.min(xx, sw - 1)) * 4;
          const al = src[i + 3] / 255;
          r += src[i] * al * w; g += src[i + 1] * al * w; b += src[i + 2] * al * w; a += al * w; wsum += w;
        }
      }
      const o = (y * dw + x) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = Math.round((a / wsum) * 255);
    }
  }
  return out;
}

// 3x5 digit font for contact-sheet labels.
const DIGITS = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111',
};

export function drawNumber(rgba, width, x0, y0, value, scale = 2) {
  const text = String(value);
  // dark backing so labels read on any texture
  for (let yy = -1; yy < 5 * scale + 1; yy++) for (let xx = -1; xx < text.length * 4 * scale + 1; xx++) {
    const i = ((y0 + yy) * width + x0 + xx) * 4;
    if (i >= 0 && i + 3 < rgba.length) { rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 255; }
  }
  [...text].forEach((ch, ci) => {
    const bits = DIGITS[ch];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      if (bits[r * 3 + c] !== '1') continue;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const i = ((y0 + r * scale + sy) * width + x0 + ci * 4 * scale + c * scale + sx) * 4;
        rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 0; rgba[i + 3] = 255;
      }
    }
  });
}

/** Builds a numbered contact sheet of `{width,height,rgba}` images, `cell` px square cells. */
export function contactSheet(images, { cell = 96, columns = 8 } = {}) {
  const rows = Math.max(1, Math.ceil(images.length / columns));
  const width = columns * cell, height = rows * cell;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < out.length; i += 4) { const cx = ((i / 4) % width), cy = Math.floor(i / 4 / width); const v = ((cx >> 3) + (cy >> 3)) & 1 ? 70 : 100; out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255; }
  images.forEach((img, index) => {
    if (!img) return;
    const col = index % columns, row = Math.floor(index / columns);
    const scale = Math.min((cell - 2) / img.width, (cell - 2) / img.height);
    const dw = Math.max(1, Math.round(img.width * scale)), dh = Math.max(1, Math.round(img.height * scale));
    const small = resizeRgba(img.rgba, img.width, img.height, dw, dh);
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const s = (y * dw + x) * 4;
      const d = ((row * cell + 1 + y) * width + col * cell + 1 + x) * 4;
      const a = small[s + 3] / 255;
      out[d] = Math.round(small[s] * a + out[d] * (1 - a));
      out[d + 1] = Math.round(small[s + 1] * a + out[d + 1] * (1 - a));
      out[d + 2] = Math.round(small[s + 2] * a + out[d + 2] * (1 - a));
    }
    drawNumber(out, width, col * cell + 2, row * cell + 2, index);
  });
  return { width, height, rgba: out };
}

// ------------------------------------------------------------------------------------ textures

/** Decodes every TEX0 in a BRRES (palettes resolved) -> Map<name, {width,height,rgba,format}>. */
export async function decodeBrresTextures(mods, brres) {
  const rres = mods.noclipBrres.parse(new mods.slice(brres.slice().buffer));
  const out = new Map();
  for (const tex of rres.tex0) {
    try {
      const chain = mods.gxTexture.calcMipChain(tex, 1);
      const mip = chain.mipLevels[0];
      const decoded = await mods.gxTexture.decodeTexture(mip);
      const px = decoded.pixels;
      out.set(tex.name, {
        width: mip.width,
        height: mip.height,
        rgba: new Uint8Array(px.buffer, px.byteOffset, px.byteLength).slice(),
        format: tex.format,
      });
    } catch (error) {
      out.set(tex.name, null);
    }
  }
  return { textures: out, rres };
}

// ------------------------------------------------------------------------------------ survey

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function len(a) { return Math.hypot(a[0], a[1], a[2]); }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function weightedMedian(pairs) {
  // pairs: [value, weight]
  if (pairs.length === 0) return null;
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((s, p) => s + p[1], 0);
  let acc = 0;
  for (const [v, w] of sorted) { acc += w; if (acc >= total / 2) return v; }
  return sorted[sorted.length - 1][0];
}

/** Builds a lookup that returns the unit XZ travel direction of the nearest enemy-route point. */
export function makeRoadDirection(kmp) {
  const pts = [];
  kmp.enemyGroups.forEach((group, gi) => {
    for (let k = 0; k < group.length; k++) {
      const p = kmp.enemyPoints[group.start + k];
      if (!p) continue;
      const prev = k > 0 ? kmp.enemyPoints[group.start + k - 1] : null;
      let next = k + 1 < group.length ? kmp.enemyPoints[group.start + k + 1] : null;
      if (!next) {
        const ng = group.next.find((n) => n !== 0xff && kmp.enemyGroups[n]);
        if (ng !== undefined) next = kmp.enemyPoints[kmp.enemyGroups[ng].start];
      }
      const a = prev ?? p;
      const b = next ?? p;
      let dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
      const l = Math.hypot(dx, dz);
      if (l < 1e-3) continue;
      pts.push({ x: p.position.x, z: p.position.z, dx: dx / l, dz: dz / l, range: p.range });
    }
  });
  return (x, z, maxDist = 900) => {
    let best = null, bd = Infinity;
    for (const p of pts) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best && Math.sqrt(bd) < maxDist ? best : null;
  };
}

/**
 * Surveys one `course_model.brres`. `files` is the track's file map (for `course.kcl`/`course.kmp`).
 * Returns { materials: [...], textures: Map }.
 */
export async function surveyCourseModel(mods, files, { kclSamples = 160 } = {}) {
  const brres = files.get('course_model.brres');
  const kcl = files.has('course.kcl') ? mods.kcl.parseKcl(files.get('course.kcl')) : null;
  const kmp = files.has('course.kmp') ? mods.kmpFile.readKmpFile(files.get('course.kmp')) : null;
  const roadDir = kmp ? makeRoadDirection(kmp) : () => null;

  const raw = mods.brresRaw.readBrresRaw(brres);
  const subFile = raw.groups.find((g) => g.name === mods.brresRaw.BRRES_MODELS_GROUP).entries[0];
  const model = new mods.mdl0Raw.Mdl0Editor(subFile.data, mods.brresRaw.makeSubFileNameReader(raw, subFile));
  const listing = mods.archive.listArchiveMaterials('course_model.brres', brres);
  const summaries = new Map(listing.models[0].materials.map((m) => [m.materialName, m]));
  const joints = mods.meshBake.computeJointMatrices(model);
  const shapes = model.listShapes();
  const materials = model.listMaterials();
  const { textures, rres } = await decodeBrresTextures(mods, brres);

  // Animation targets.
  const animSrt = new Map();
  for (const anim of rres.srt0) for (const m of anim.matAnimations) {
    const list = animSrt.get(m.materialName) ?? [];
    list.push({ anim: anim.name, texAnims: m.texAnimations.length, data: m.texAnimations });
    animSrt.set(m.materialName, list);
  }
  const animPat = new Map();
  for (const anim of rres.pat0) for (const m of anim.matAnimations) {
    const list = animPat.get(m.materialName) ?? [];
    list.push({ anim: anim.name, texNames: anim.texNames });
    animPat.set(m.materialName, list);
  }
  const animClr = new Set();
  for (const anim of rres.clr0 ?? []) for (const m of anim.matAnimations ?? []) animClr.add(m.materialName);

  const info = materials.map((m) => {
    const doc = mods.archive.decodeMaterial(brres, subFile.name, m.name);
    return {
      name: m.name,
      index: m.index,
      translucent: doc.translucent,
      cullMode: doc.cullMode,
      lightSetIndex: doc.lightSetIndex,
      fogIndex: doc.fogIndex,
      textures: doc.samplers.map((s) => s.texture),
      palettes: doc.samplers.map((s) => s.palette),
      wrap: doc.samplers.map((s) => [s.wrapS, s.wrapT]),
      mapModes: doc.samplers.map((s) => s.mapMode),
      texSrts: doc.texSrts,
      texGens: doc.texGens.map((g) => ({ type: g.type, source: g.source, matrix: g.matrix })),
      channel0: doc.channels[0]
        ? { colorLit: doc.channels[0].color.lightingEnabled, colorSrc: doc.channels[0].color.materialSource, alphaSrc: doc.channels[0].alpha.materialSource, mat: doc.channels[0].materialColor }
        : null,
      channelCount: doc.channels.length,
      stageCount: doc.tevStages.length,
      konst: doc.konstColors,
      blend: doc.blend,
      alphaTest: doc.alphaTest,
      depth: doc.depth,
      meshes: summaries.get(m.name)?.meshes ?? [],
      animSrt: (animSrt.get(m.name) ?? []).map((a) => a.anim),
      animPat: (animPat.get(m.name) ?? []).map((a) => a.anim),
      animClr: animClr.has(m.name),
      tris: 0,
      area: 0,
      hasVertexColor: false,
      bbox: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity],
      samples: [], // {pos:[3 verts], uv:[3 verts], area}
    };
  });

  // Layers: every sampler a TEV stage reads, with the UV set its texgen pulls from. Retail materials
  // usually pair the real surface texture with a whole-track light map; the light map is not what
  // makes a surface look like asphalt, so the "base" layer is the texture-like one.
  const docs = materials.map((m) => mods.archive.decodeMaterial(brres, subFile.name, m.name));
  info.forEach((mat, i) => {
    const doc = docs[i];
    const layers = [];
    for (const st of doc.tevStages) {
      if (!(st.texMap >= 0 && st.texMap < 8) || !doc.samplers[st.texMap]) continue;
      if (layers.some((l) => l.sampler === st.texMap && l.texCoord === st.texCoordId)) continue;
      const gen = doc.texGens[st.texCoordId];
      const plain = !!gen && gen.type === 1 && gen.source >= 4 && gen.source <= 11;
      layers.push({ sampler: st.texMap, texCoord: st.texCoordId, uvSet: plain ? gen.source - 4 : -1, genSource: gen?.source ?? -1, texture: doc.samplers[st.texMap].texture, mapMode: doc.samplers[st.texMap].mapMode });
    }
    mat.layers = layers;
    mat.uvSets = [...new Set(layers.filter((l) => l.uvSet >= 0).map((l) => l.uvSet))];
    mat.texGenSources = doc.texGens.map((g) => g.source);
  });

  // Geometry.
  const ops = mods.meshBake.collectDrawOps(model);
  const SAMPLE_CAP = 600;
  const dv = new DataView(model.data.buffer, model.data.byteOffset, model.data.byteLength);
  const { GX_ATTR } = mods.gxVertex;
  for (const ref of ops) {
    const mat = info[ref.op.materialId];
    const shape = shapes[ref.op.shapeId];
    if (!mat || !shape) continue;
    const joint = joints[shape.mtxIdx] ?? joints[0];
    let cache;
    try {
      cache = mods.meshBake.readShapeGeometryCache(model, shape, joint);
    } catch { continue; }
    if (!cache) continue;
    const sets = mat.uvSets.length ? mat.uvSets : [0];
    const prim = mods.gxVertex.readPrimitiveVertices(
      model.data.subarray(shape.primOffset, shape.primOffset + shape.primSize),
      cache.vcd,
      [GX_ATTR.POS, ...sets.map((k) => GX_ATTR.TEX0 + k)],
    );
    mat.hasVertexColor = mat.hasVertexColor || (cache.vcd.types[GX_ATTR.CLR0] ?? 0) !== 0;
    const uvSources = sets.map((k) => {
      const id = dv.getInt16(shape.offset + 0x50 + k * 2);
      const arr = id >= 0 ? model.getVertexArray('vtxTxc', id) : null;
      return { set: k, values: arr ? model.readVertexArrayValues(arr) : null, comps: arr ? model.vertexArrayFormat(arr).componentCount : 0, idx: prim.attributeIndices.get(GX_ATTR.TEX0 + k) };
    });
    const j = joint;
    const world = (i) => {
      const x = cache.localPositions[i * 3], y = cache.localPositions[i * 3 + 1], z = cache.localPositions[i * 3 + 2];
      return [
        j[0] * x + j[4] * y + j[8] * z + j[12],
        j[1] * x + j[5] * y + j[9] * z + j[13],
        j[2] * x + j[6] * y + j[10] * z + j[14],
      ];
    };
    const uvOf = (src, i) => {
      if (!src.values || !src.idx || src.idx[i] < 0) return null;
      return [src.values[src.idx[i] * src.comps], src.comps > 1 ? src.values[src.idx[i] * src.comps + 1] : 0];
    };
    const idx = prim.indices;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const p = [world(idx[t]), world(idx[t + 1]), world(idx[t + 2])];
      const area = len(cross(sub(p[1], p[0]), sub(p[2], p[0]))) / 2;
      mat.tris++;
      mat.area += area;
      for (const v of p) for (let k = 0; k < 3; k++) {
        mat.bbox[k] = Math.min(mat.bbox[k], v[k]);
        mat.bbox[k + 3] = Math.max(mat.bbox[k + 3], v[k]);
      }
      if (area < 1e-3) continue;
      const uvs = {};
      for (const src of uvSources) {
        const uv = [uvOf(src, idx[t]), uvOf(src, idx[t + 1]), uvOf(src, idx[t + 2])];
        if (uv.every(Boolean)) uvs[src.set] = uv;
      }
      mat.samples.push({ p, uvs, area });
    }
  }

  const LIGHTMAP_NAME = /kage|shadow|lightmap|light_map|lmap|^lm_|_lm$/i;
  for (const mat of info) {
    mat.samples.sort((a, b) => b.area - a.area);
    const kept = mat.samples.slice(0, SAMPLE_CAP);
    const keptArea = kept.reduce((sum, x) => sum + x.area, 0);
    const flagHist = new Map();
    let flagTotal = 0;
    let kclTried = 0;
    for (const s of kept) {
      if (kcl && kclTried < kclSamples) {
        kclTried++;
        const c = [0, 1, 2].map((k) => (s.p[0][k] + s.p[1][k] + s.p[2][k]) / 3);
        const hit = mods.kcl.raycastDownDetailed(kcl, c[0], c[2], c[1] + 25);
        if (hit && hit.distance < 80) {
          flagHist.set(hit.triangle.flag, (flagHist.get(hit.triangle.flag) ?? 0) + s.area);
          flagTotal += s.area;
        }
      }
    }
    mat.flags = [...flagHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([flag, a]) => ({ flag, share: flagTotal ? a / flagTotal : 0 }));
    mat.flagCoverage = keptArea ? flagTotal / keptArea : 0;

    // Per-layer UV density and orientation against the travel direction.
    for (const layer of mat.layers) {
      const srt = mat.texSrts[layer.texCoord];
      const sx = srt ? srt.scaleS : 1;
      const sy = srt ? srt.scaleT : 1;
      layer.srt = srt ? [srt.scaleS, srt.scaleT, srt.rotation, srt.translateS, srt.translateT] : [1, 1, 0, 0, 0];
      const pu = [], pv = [];
      const dirAlong = { u: 0, v: 0, uPos: 0, uNeg: 0, vPos: 0, vNeg: 0 };
      let dirW = 0;
      if (layer.uvSet < 0) { layer.uvWorld = null; continue; }
      for (const s of kept) {
        const uv = s.uvs[layer.uvSet];
        if (!uv) continue;
        const e1 = sub(s.p[1], s.p[0]), e2 = sub(s.p[2], s.p[0]);
        const d1 = [(uv[1][0] - uv[0][0]) * sx, (uv[1][1] - uv[0][1]) * sy];
        const d2 = [(uv[2][0] - uv[0][0]) * sx, (uv[2][1] - uv[0][1]) * sy];
        const det = d1[0] * d2[1] - d1[1] * d2[0];
        if (Math.abs(det) < 1e-9) continue;
        const Pu = [0, 1, 2].map((k) => (e1[k] * d2[1] - e2[k] * d1[1]) / det);
        const Pv = [0, 1, 2].map((k) => (e2[k] * d1[0] - e1[k] * d2[0]) / det);
        const lu = len(Pu), lv = len(Pv);
        if (lu < 1e-6 || lv < 1e-6) continue;
        pu.push([lu, s.area]);
        pv.push([lv, s.area]);
        const c = [0, 1, 2].map((k) => (s.p[0][k] + s.p[1][k] + s.p[2][k]) / 3);
        const dir = roadDir(c[0], c[2]);
        if (dir) {
          const au = (Pu[0] * dir.dx + Pu[2] * dir.dz) / (Math.hypot(Pu[0], Pu[2]) || 1e-9);
          const av = (Pv[0] * dir.dx + Pv[2] * dir.dz) / (Math.hypot(Pv[0], Pv[2]) || 1e-9);
          dirW += s.area;
          if (Math.abs(au) > Math.abs(av)) { dirAlong.u += s.area; if (au > 0) dirAlong.uPos += s.area; else dirAlong.uNeg += s.area; }
          else { dirAlong.v += s.area; if (av > 0) dirAlong.vPos += s.area; else dirAlong.vNeg += s.area; }
        }
      }
      layer.uvWorld = pu.length ? [weightedMedian(pu), weightedMedian(pv)] : null;
      layer.uvDir = dirW > 0 ? dirAlong : null;
    }
    // Base layer.
    const candidates = mat.layers.filter((l) => l.mapMode === 'texcoord' || l.mapMode === undefined);
    const texLike = candidates.filter((l) => !LIGHTMAP_NAME.test(l.texture) && l.uvSet >= 0);
    const pool = texLike.length ? texLike : candidates.length ? candidates : mat.layers;
    pool.sort((a, b) => (a.uvWorld ? Math.hypot(...a.uvWorld) : 1e12) - (b.uvWorld ? Math.hypot(...b.uvWorld) : 1e12));
    mat.base = pool[0] ?? null;
    mat.animated = mat.animSrt.length > 0 || mat.animPat.length > 0;
    delete mat.samples;
  }
  return { materials: info, textures, rres, kcl, kmp };
}

// ------------------------------------------------------------------------------------ images

/** {width,height,rgba} helpers. All pure. */
export function cropImage(img, [x, y, w, h]) {
  const out = new Uint8Array(w * h * 4);
  for (let yy = 0; yy < h; yy++) {
    const sy = Math.min(img.height - 1, Math.max(0, y + yy));
    for (let xx = 0; xx < w; xx++) {
      const sx = Math.min(img.width - 1, Math.max(0, x + xx));
      const s = (sy * img.width + sx) * 4, d = (yy * w + xx) * 4;
      out[d] = img.rgba[s]; out[d + 1] = img.rgba[s + 1]; out[d + 2] = img.rgba[s + 2]; out[d + 3] = img.rgba[s + 3];
    }
  }
  return { width: w, height: h, rgba: out };
}

export function resizeImage(img, w, h) {
  if (img.width === w && img.height === h) return img;
  return { width: w, height: h, rgba: resizeRgba(img.rgba, img.width, img.height, w, h) };
}

/** Rotates by quarter turns clockwise. */
export function rotateImage(img, quarterTurns) {
  let cur = img;
  for (let i = 0; i < ((quarterTurns % 4) + 4) % 4; i++) {
    const { width: w, height: h } = cur;
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      // (x,y) -> (h-1-y, x) in an image of size (h, w)
      const d = (x * h + (h - 1 - y)) * 4;
      out[d] = cur.rgba[s]; out[d + 1] = cur.rgba[s + 1]; out[d + 2] = cur.rgba[s + 2]; out[d + 3] = cur.rgba[s + 3];
    }
    cur = { width: h, height: w, rgba: out };
  }
  return cur;
}

export function flipImage(img, { x = false, y = false } = {}) {
  const { width: w, height: h } = img;
  const out = new Uint8Array(w * h * 4);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const sx = x ? w - 1 - xx : xx, sy = y ? h - 1 - yy : yy;
    const s = (sy * w + sx) * 4, d = (yy * w + xx) * 4;
    out[d] = img.rgba[s]; out[d + 1] = img.rgba[s + 1]; out[d + 2] = img.rgba[s + 2]; out[d + 3] = img.rgba[s + 3];
  }
  return { width: w, height: h, rgba: out };
}

/** Multiplies RGB by `tint` (0..2 per channel) and adds `brightness` (-255..255). */
export function adjustImage(img, { tint = [1, 1, 1], brightness = 0, contrast = 1 } = {}) {
  const out = new Uint8Array(img.rgba);
  for (let i = 0; i < out.length; i += 4) for (let k = 0; k < 3; k++) {
    const v = ((out[i + k] - 128) * contrast + 128) * tint[k] + brightness;
    out[i + k] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return { width: img.width, height: img.height, rgba: out };
}

/**
 * Makes an image tile by cross-fading it with a half-offset copy of itself: the borders of the
 * result come from the middle of the source (which is continuous across the wrap) and the middle
 * stays the source. `strength` 0..1 is how much of the image is blended (1 = whole image).
 */
export function makeSeamless(img, strength = 0.5) {
  const { width: w, height: h } = img;
  const out = new Uint8Array(w * h * 4);
  const wt = (t, n) => {
    // 1 at the border, 0 inside the central (1 - strength) of the axis
    const d = Math.min(t, n - 1 - t) / (n / 2); // 0 at border, 1 at centre
    const k = Math.min(1, d / strength);
    const s = k * k * (3 - 2 * k); // smoothstep
    return 1 - s;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const mix = wt(x, w) + wt(y, h) - wt(x, w) * wt(y, h);
    const sx = (x + (w >> 1)) % w, sy = (y + (h >> 1)) % h;
    const s0 = (y * w + x) * 4, s1 = (sy * w + sx) * 4;
    for (let k = 0; k < 4; k++) out[s0 + k] = Math.round(img.rgba[s0 + k] * (1 - mix) + img.rgba[s1 + k] * mix);
  }
  return { width: w, height: h, rgba: out };
}

export function hasAlpha(img) {
  for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] < 250) return true;
  return false;
}

export function nearestPow2(n) { let p = 1; while (p * 2 <= n * 1.2) p *= 2; return Math.max(4, p); }

/** Average RGB of an image (0..255). */
export function averageColor(img) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < img.rgba.length; i += 4) { const a = img.rgba[i + 3] / 255; r += img.rgba[i] * a; g += img.rgba[i + 1] * a; b += img.rgba[i + 2] * a; n += a; }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [128, 128, 128];
}

/** Encodes an image to TEX0 bytes for `addTexture`. Format is CMPR unless the image has alpha. */
export function encodeTexture(mods, img, { format, mipCount } = {}) {
  const codec = mods.tex0Codec;
  const fmtName = format ?? (hasAlpha(img) ? 'RGB5A3' : 'CMPR');
  const gx = codec.tex0FormatValue(fmtName);
  const maxMips = codec.maxMipCount(img.width, img.height);
  const mips = Math.max(1, Math.min(mipCount ?? 5, maxMips));
  const data = codec.encodeTex0Data({ width: img.width, height: img.height, pixels: img.rgba }, gx, img.width, img.height, mips);
  return { name: undefined, format: gx, width: img.width, height: img.height, mipCount: mips, data };
}

// ------------------------------------------------------------------------------------ materials

const GX = { CC_ZERO: 15, CC_TEXC: 8, CC_RASC: 10, CA_ZERO: 7, CA_TEXA: 4, CA_RASA: 5 };

/**
 * Normalises a retail material into the shape generated geometry can use:
 *   - one texture layer (the surface texture, not the whole-track light map), sampled through UV set 0;
 *   - one TEV stage `TEXTURE * VERTEX COLOUR` (x1, so white vertex colour is neutral);
 *   - light set -1 (no dependency on `posteffect.blight`; the vertex colour carries the baked light)
 *     and fog index 0 (course fog from `posteffect.bfg`, when the theme has one).
 * Blend, alpha test, depth and cull state are kept from the retail material (cut-out fences, water).
 */
export function buildSingleLayerDoc(doc, base, { textureName, palette = '', mipped = true, wrap } = {}) {
  const out = structuredClone(doc);
  const sampler = structuredClone(doc.samplers[base.sampler]);
  if (textureName) { sampler.texture = textureName; sampler.palette = palette; }
  if (wrap) { sampler.wrapS = wrap[0]; sampler.wrapT = wrap[1]; }
  sampler.minFilter = mipped ? 5 : 1;
  sampler.magFilter = 1;
  sampler.lodBias = 0;
  sampler.mapMode = 'texcoord';
  out.samplers = [sampler];
  out.texSrts = [{ scaleS: 1, scaleT: 1, rotation: 0, translateS: 0, translateT: 0, refCamera: -1, refLight: -1 }];
  const gen = structuredClone(doc.texGens[base.texCoord] ?? doc.texGens[0]);
  gen.type = 1; gen.source = 4; gen.matrix = 60; gen.normalize = false; gen.postMatrix = 64;
  out.texGens = [gen];
  const stage = structuredClone(doc.tevStages.find((s) => s.texMap === base.sampler && s.texCoordId === base.texCoord) ?? doc.tevStages[0]);
  Object.assign(stage, {
    colorInA: GX.CC_ZERO, colorInB: GX.CC_TEXC, colorInC: GX.CC_RASC, colorInD: GX.CC_ZERO,
    colorOp: 0, colorBias: 0, colorScale: 0, colorClamp: true, colorRegId: 0,
    alphaInA: GX.CA_ZERO, alphaInB: GX.CA_TEXA, alphaInC: GX.CA_RASA, alphaInD: GX.CA_ZERO,
    alphaOp: 0, alphaBias: 0, alphaScale: 0, alphaClamp: true, alphaRegId: 0,
    texCoordId: 0, texMap: 0, channelId: 0,
  });
  out.tevStages = [stage];
  out.indTexStages = [];
  out.lightSetIndex = -1;
  out.fogIndex = 0;
  return out;
}

/** 'keep' mode: the retail material untouched, apart from the lighting normalisation. */
export function buildKeptDoc(doc) {
  const out = structuredClone(doc);
  out.lightSetIndex = -1;
  out.fogIndex = out.fogIndex === -1 ? 0 : out.fogIndex;
  return out;
}

// ------------------------------------------------------------------------------------ recipes

/** Loads (and caches) a retail track: its file map and its decoded course-model textures. */
export async function loadTrackCached(mods, cache, track) {
  let entry = cache.get(track);
  if (!entry) {
    const files = readSzs(mods, `${retailDir()}/${track}.szs`);
    const { textures, rres } = await decodeBrresTextures(mods, files.get('course_model.brres'));
    entry = { files, textures, rres };
    cache.set(track, entry);
  }
  return entry;
}

/**
 * Applies a texture recipe (see create-kit-spec.mjs) and returns the final RGBA image, or null when
 * the recipe does not touch the pixels (`tex` has neither `from`, `crop`, `rot`, `flip*`, `tint`
 * nor `size` — then the retail TEX0 is reused verbatim).
 */
export async function makeTextureFor(mods, cache, spec, baseTexture) {
  const tex = spec.tex ?? {};
  const touches = tex.from || tex.crop || tex.rot || tex.flipX || tex.flipY || tex.tint || tex.size || tex.seamless || tex.adjust || tex.flatten;
  if (!touches) return null;
  const onlyFrom = tex.from && !(tex.crop || tex.rot || tex.flipX || tex.flipY || tex.tint || tex.size || tex.seamless || tex.adjust || tex.flatten);
  if (onlyFrom && (!tex.from.track || tex.from.track === spec.track)) return { reuse: tex.from.name };
  const srcTrack = tex.from?.track ?? spec.track;
  const srcName = tex.from?.name ?? baseTexture;
  const entry = await loadTrackCached(mods, cache, srcTrack);
  const src = entry.textures.get(srcName);
  if (!src) throw new Error(`${spec.id}: texture "${srcName}" not found in ${srcTrack}`);
  let img = { width: src.width, height: src.height, rgba: src.rgba };
  if (tex.crop) img = cropImage(img, tex.crop);
  if (tex.flatten) img = flattenImage(img, tex.flatten);
  if (tex.seamless) img = makeSeamless(img, tex.seamlessStrength ?? 0.55);
  if (tex.rot) img = rotateImage(img, tex.rot);
  if (tex.flipX || tex.flipY) img = flipImage(img, { x: !!tex.flipX, y: !!tex.flipY });
  if (tex.tint || tex.adjust) img = adjustImage(img, { tint: tex.tint ?? [1, 1, 1], ...(tex.adjust ?? {}) });
  const size = tex.size ?? [nearestPow2(img.width), nearestPow2(img.height)];
  img = resizeImage(img, size[0], size[1]);
  return img;
}

/** Survey of a retail course, cached on the track entry. */
export async function getSurvey(mods, cache, track) {
  const entry = await loadTrackCached(mods, cache, track);
  if (!entry.survey) entry.survey = await surveyCourseModel(mods, entry.files);
  return entry.survey;
}

/**
 * Removes the low-frequency light/dark drift of a texture (wrap-around box blur, three passes) and
 * keeps the average colour, so a cross-faded copy does not show a visible blotch where the seams were.
 */
export function flattenImage(img, radiusFraction = 0.25) {
  const { width: w, height: h } = img;
  const rx = Math.max(1, Math.round(w * radiusFraction)), ry = Math.max(1, Math.round(h * radiusFraction));
  const blurAxis = (src, n, m, r, stride, step) => {
    // src: Float32Array of n lines, each of length m, element (line, i) at line * stride + i * step
    const out = new Float32Array(src.length);
    for (let line = 0; line < n; line++) {
      const base = line * stride;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[base + ((k + m) % m) * step];
      for (let i = 0; i < m; i++) {
        out[base + i * step] = acc / (2 * r + 1);
        acc += src[base + ((i + r + 1) % m) * step] - src[base + ((i - r + m * 4) % m) * step];
      }
    }
    return out;
  };
  const out = new Uint8Array(img.rgba);
  for (let c = 0; c < 3; c++) {
    let plane = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) plane[i] = img.rgba[i * 4 + c];
    let blur = plane;
    for (let pass = 0; pass < 3; pass++) {
      blur = blurAxis(blur, h, w, rx, w, 1);
      blur = blurAxis(blur, w, h, ry, 1, w);
    }
    let mean = 0;
    for (let i = 0; i < w * h; i++) mean += blur[i];
    mean /= w * h;
    for (let i = 0; i < w * h; i++) out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(plane[i] - blur[i] + mean)));
  }
  return { width: w, height: h, rgba: out };
}
