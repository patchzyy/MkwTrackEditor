#!/usr/bin/env node
/**
 * Builds the Create-mode asset kit from the retail game.
 *
 *   npm run build:create-kit
 *   MKW_RETAIL_COURSE_DIR=D:/.../Race/Course npm run build:create-kit
 *
 * Output: public/data/MarioKartWii/Create/create-kit.szs (Yaz0 U8) holding
 *   kit.json               the `CreateKitCatalog` (see src/lib/create/types.ts)
 *   swatches/*.brres       one small BRRES per source course; each holds a MDL0 with the materials of
 *                          every surface cut from that course (textures deduplicated inside)
 *   thumbs/<surface>.png   64x64 palette tiles
 *   themes/<theme>/...     sky model + post-effect files copied from the theme's donor course
 *   previews/<theme>.png   ~320x180 theme cards (rendered by scripts/create-kit-previews.mjs)
 *
 * The curation lives in scripts/create-kit-spec.mjs; docs/CREATE-KIT.md explains the choices.
 * Deterministic: the same retail extract and the same spec always produce the same bytes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  ROOT, startVite, retailDir, loadTrackCached, getSurvey, makeTextureFor, encodeTexture, buildSingleLayerDoc, buildKeptDoc,
  encodePng, decodePng, resizeImage, cropImage, adjustImage, averageColor,
} from './create-kit-lib.mjs';
import { SURFACES, EXTRA_SURFACES, THEMES, SCENERY } from './create-kit-spec.mjs';

const OUT_DIR = join(ROOT, 'public/data/MarioKartWii/Create');
const OUT_FILE = join(OUT_DIR, 'create-kit.szs');
const GENERATED_AT = '2026-10-20T00:00:00.000Z'; // fixed on purpose: the kit is reproducible

/** Default KCL flag (u16) per surface category / id family. Measured retail flags are logged next to them. */
function defaultFlag(spec) {
  if (spec.flag !== undefined) return spec.flag;
  const id = spec.id;
  switch (spec.category) {
    case 'road': return 0x0000;
    case 'curb': return 0x0000;
    case 'decal': return 0x0000;
    case 'boost': return 0x0006;
    case 'ice': return 0x0005;
    case 'water': return 0x000a; // Solid Fall: you touch the surface, splash and respawn
    case 'lava': return 0x0050; // Fall Boundary, variant 2 (the lava variant retail uses)
    case 'underside': return 0x000c;
    case 'wall': return id.startsWith('fence.') ? 0x000d : 0x000c; // fences: invisible wall, see-through art
    case 'offroad': return id.startsWith('mud.') ? 0x0044 : 0x0002; // heavy off-road mud / weak off-road dirt
    case 'ground':
      if (id.startsWith('sand.')) return 0x0003; // off-road
      if (id.startsWith('space.')) return 0x0003;
      return id.startsWith('snow.') ? 0x0003 : 0x0083; // off-road, grass variant
    default: return 0x0000;
  }
}

async function main() {
  const startedAt = Date.now();
  const dir = retailDir();
  if (!existsSync(dir)) {
    console.error(`Retail course folder not found: ${dir}\nSet MKW_RETAIL_COURSE_DIR to the extract's Race/Course folder.`);
    process.exit(2);
  }
  const mods = await startVite();
  try {
    const writer = await mods.server.ssrLoadModule('/src/lib/create/writers/modelWriter.ts');
    const buildModelBrres = writer.buildModelBrres;
    const cache = new Map();
    const surfaces = [...SURFACES, ...EXTRA_SURFACES];

    // ------------------------------------------------------------------ prepare materials per course
    /** groups per track: { brres, used:Set(material), surfaces:[...] } */
    const groups = new Map();
    const built = []; // per surface result
    for (const spec of surfaces) {
      const survey = await getSurvey(mods, cache, spec.track);
      const wantedTexture = spec.tex?.from?.name;
      const mat = spec.material
        ? survey.materials.find((m) => m.name === spec.material)
        : survey.materials.find((m) => m.layers.some((l) => l.texture === wantedTexture));
      if (!mat) throw new Error(`${spec.id}: no material for ${spec.track}/${spec.material ?? wantedTexture}`);
      const entry = await loadTrackCached(mods, cache, spec.track);

      let list = groups.get(spec.track);
      if (!list) groups.set(spec.track, (list = []));
      let group = list.find((g) => !g.used.has(mat.name));
      if (!group) {
        group = { track: spec.track, index: list.length, brres: entry.files.get('course_model.brres'), used: new Set(), surfaces: [] };
        list.push(group);
      }

      // texture
      const baseLayer = (wantedTexture && mat.layers.find((l) => l.texture === wantedTexture)) || mat.base;
      const isKeep = spec.mode === 'keep';
      const recipe = isKeep ? null : await makeTextureFor(mods, cache, spec, baseLayer?.texture);
      let image = null;
      let textureName = null;
      let palette = '';
      let sourceImage;
      if (recipe && recipe.reuse) {
        textureName = recipe.reuse;
        palette = group_paletteFor(mods, group.brres, mat, recipe.reuse);
        sourceImage = entry.textures.get(recipe.reuse);
      } else if (recipe) {
        image = recipe;
        textureName = `kit_${spec.id.replace(/[^A-Za-z0-9]/g, '_')}`;
        const encoded = encodeTexture(mods, image, {});
        encoded.name = textureName;
        group.brres = mods.archive.addTexture(group.brres, encoded);
        sourceImage = image;
      } else if (baseLayer) {
        sourceImage = survey.textures.get(baseLayer.texture) ?? null;
      }

      // material doc
      const doc = mods.archive.decodeMaterial(group.brres, 'course', mat.name);
      let next;
      if (isKeep) {
        next = buildKeptDoc(doc);
      } else {
        const layer = recipe && !recipe.reuse ? baseLayer : mat.layers.find((l) => l.texture === (textureName ?? baseLayer.texture)) ?? baseLayer;
        const mipped = image ? image.width > 1 && image.height > 1 : true;
        next = buildSingleLayerDoc(doc, layer, { textureName: image ? textureName : undefined, mipped });
        if (recipe && recipe.reuse) {
          next.samplers[0].texture = textureName;
          next.samplers[0].palette = palette;
        }
      }
      const cullNone = spec.cull === 'none' || (spec.cull === undefined && (spec.category === 'wall' || spec.category === 'underside'));
      if (cullNone) next.cullMode = 0;
      else if (spec.cull === 'back') next.cullMode = 2;
      const animated = mat.animated;
      const materialName = animated || isKeep ? mat.name : `k_${spec.id.replace(/[^A-Za-z0-9]/g, '_')}`;
      next.name = materialName;
      const result = mods.archive.applyMaterial(group.brres, 'course', mat.name, next);
      group.brres = result.brres;
      group.used.add(materialName);
      group.used.add(mat.name);
      const channel = next.channels[0];
      const record = {
        spec, group, materialName, translucent: next.translucent, sourceImage, image,
        usesVertexColor: !!channel && channel.color.materialSource === 1 && next.tevStages.some((s) => s.channelId === 0 && [s.colorInA, s.colorInB, s.colorInC, s.colorInD].includes(10)),
        measured: mat.flags.slice(0, 2).map((f) => `0x${f.flag.toString(16)}`).join('/'),
        retailUv: mat.base?.uvWorld ?? null,
        animated,
      };
      group.surfaces.push(record);
      built.push(record);
    }

    // ------------------------------------------------------------------ swatches
    const swatchFiles = new Map(); // kit path -> bytes
    for (const [track, list] of groups) {
      for (const group of list) {
        const name = `swatches/${track}${list.length > 1 ? `.${group.index + 1}` : ''}.brres`;
        group.path = name;
        const meshes = [];
        const materials = [];
        for (const rec of group.surfaces) {
          const [wu, wv] = rec.spec.world;
          const size = 1000;
          meshes.push({
            name: `quad_${rec.spec.id.replace(/[^A-Za-z0-9]/g, '_')}`,
            surfaceId: rec.spec.id,
            positions: new Float32Array([0, 0, 0, 0, 0, size, size, 0, 0, size, 0, size]),
            normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
            uvs: new Float32Array([0, 0, 0, size / wv, size / wu, 0, size / wu, size / wv].map((v, i) => v)),
            colors: new Uint8Array(16).fill(255),
            indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
            chunk: 'swatch',
          });
          materials.push({ surfaceId: rec.spec.id, brres: group.brres, modelName: 'course', materialName: rec.materialName, translucent: rec.translucent });
        }
        // uv: x runs along u, z along v
        meshes.forEach((m, i) => {
          const [wu, wv] = group.surfaces[i].spec.world;
          const size = 1000;
          m.uvs = new Float32Array([0, 0, 0, size / wv, size / wu, 0, size / wu, size / wv]);
        });
        const bytes = buildModelBrres({ modelName: 'swatch', meshes, materials, copyAnimations: true });
        swatchFiles.set(name, bytes);
      }
    }

    // ------------------------------------------------------------------ minimap swatch
    const mapFiles = (await loadTrackCached(mods, cache, 'beginner_course')).files;
    const mapBrres = mapFiles.get('map_model.brres');
    const mapMat = mods.archive.listArchiveMaterials('map', mapBrres).models[0];
    const minimapMaterialName = mapMat.materials[0].materialName;
    const minimapBytes = buildModelBrres({
      modelName: 'swatch',
      meshes: [{ name: 'quad', surfaceId: 'minimap', positions: new Float32Array([0, 0, 0, 0, 0, 1000, 1000, 0, 0, 1000, 0, 1000]), normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), uvs: new Float32Array(8), colors: new Uint8Array(16).fill(255), indices: new Uint32Array([0, 1, 2, 1, 3, 2]), chunk: 'swatch' }],
      materials: [{ surfaceId: 'minimap', brres: mapBrres, modelName: mapMat.modelName, materialName: minimapMaterialName, translucent: false }],
      copyAnimations: false,
    });
    swatchFiles.set('swatches/minimap.brres', minimapBytes);

    // ------------------------------------------------------------------ thumbnails
    const thumbs = new Map();
    for (const rec of built) {
      const spec = rec.spec;
      let img = null;
      if (spec.thumb?.color) {
        const [r, g, b] = spec.thumb.color;
        const px = new Uint8Array(64 * 64 * 4);
        for (let i = 0; i < 64 * 64; i++) { px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255; }
        img = { width: 64, height: 64, rgba: px };
      } else if (spec.thumb?.from) {
        const t = (await loadTrackCached(mods, cache, spec.thumb.from.track ?? spec.track)).textures.get(spec.thumb.from.name);
        img = { width: t.width, height: t.height, rgba: t.rgba };
        if (spec.thumb.crop) img = cropImage(img, spec.thumb.crop);
        if (spec.thumb.tint) img = adjustImage(img, { tint: spec.thumb.tint, ...(spec.thumb.adjust ?? {}) });
      } else if (rec.image) img = rec.image;
      else if (rec.sourceImage) img = { width: rec.sourceImage.width, height: rec.sourceImage.height, rgba: rec.sourceImage.rgba };
      if (!img) throw new Error(`${spec.id}: no thumbnail source`);
      thumbs.set(spec.id, thumbnail64(img));
    }

    // ------------------------------------------------------------------ catalog
    const kitSurfaces = built.map((rec) => {
      const spec = rec.spec;
      return {
        id: spec.id,
        label: spec.label,
        category: spec.category,
        swatch: rec.group.path,
        modelName: 'swatch',
        materialName: rec.materialName,
        textureWorldSize: [spec.world[0], spec.world[1]],
        kclFlag: defaultFlag(spec),
        translucent: rec.translucent,
        sourceTrack: spec.track,
        thumbnail: `thumbs/${spec.id}.png`,
        usesVertexColor: rec.usesVertexColor,
        // additive (not in the contract): 'decal' = a single piece (boost panel); u runs across it, v from its rear edge (1) to its front edge (0)
        ...(spec.uvMode ? { uvMode: spec.uvMode } : {}),
        // additive: the swatch carries SRT0 / PAT0 animation (scrolling water, lava, boost arrows); compile with copyAnimations
        ...(rec.animated ? { animated: true } : {}),
      };
    });

    // themes
    const themeFiles = new Map();
    const themes = [];
    const previewDir = join(OUT_DIR, 'previews');
    for (const t of THEMES) {
      const donor = await loadTrackCached(mods, cache, t.donorTrack);
      const files = {};
      for (const [path, bytes] of donor.files) {
        const keep = path === 'vrcorn_model.brres' || path.startsWith('posteffect/') || path === 'course.bmm' || path === 'course.btiEnv' || path === 'course.btiMat';
        if (!keep) continue;
        const kitPath = `themes/${t.id}/${path}`;
        themeFiles.set(kitPath, path.endsWith('.bfg') ? linearFog(mods, bytes) : bytes);
        files[path] = kitPath;
      }
      if (!files['vrcorn_model.brres']) throw new Error(`${t.id}: donor ${t.donorTrack} has no vrcorn_model.brres`);
      const donorKmp = mods.kmpFile.readKmpFile(donor.files.get('course.kmp'));
      const baseHeight = Math.round(donorKmp.startPoints[0]?.position.y ?? 0);
      const previewPath = join(previewDir, `${t.id}.png`);
      let preview;
      if (existsSync(previewPath)) preview = new Uint8Array(readFileSync(previewPath));
      else preview = composePreview(t, kitSurfaces, thumbs);
      themeFiles.set(`previews/${t.id}.png`, preview);
      themes.push({
        id: t.id, label: t.label, description: t.description, donorTrack: t.donorTrack,
        slots: { ...t.slots }, files, preview: `previews/${t.id}.png`, accent: t.accent,
        defaultRoadStyle: t.defaultRoadStyle, terrain: t.terrain,
        // additive (not in the contract): world Y of the ground the donor's sky dome was built for
        baseHeight,
      });
    }

    const catalog = {
      version: 1,
      generatedAt: GENERATED_AT,
      surfaces: kitSurfaces,
      themes,
      minimap: { swatch: 'swatches/minimap.brres', materialName: minimapMaterialName },
      scenery: SCENERY ?? [],
    };

    // ------------------------------------------------------------------ scenery sanity
    {
      const objflow = await mods.server.ssrLoadModule('/src/lib/objflow.ts');
      const common = objflow.parseCommonResourceArchive(new Uint8Array(readFileSync(join(ROOT, 'public/data/MarioKartWii/Race/Common.szs'))));
      const extracted = new Set(mods.u8.parseU8(new Uint8Array(readFileSync(join(ROOT, 'public/data/MarioKartWii/Race/Course/ExtractedAssets.u8')))).filter((e) => e.type === 'file').map((e) => e.path.split('/').pop().toLowerCase()));
      for (const entry of catalog.scenery) {
        const flow = common.objFlow.byId.get(entry.objectId);
        if (!flow) throw new Error(`scenery 0x${entry.objectId.toString(16)} (${entry.label}) is not in ObjFlow.bin`);
        const missing = objflow.getObjFlowResourceNames(flow).filter((r) => !common.byBaseName.has(r.toLowerCase()) && !extracted.has(r.toLowerCase()));
        if (missing.length) console.warn(`  note: scenery 0x${entry.objectId.toString(16)} ${entry.label}: models not bundled: ${missing.join(', ')}`);
      }
    }

    // ------------------------------------------------------------------ pack
    const entries = [{ path: 'kit.json', type: 'file', data: new TextEncoder().encode(JSON.stringify(catalog, null, 1)) }];
    for (const [p, b] of [...swatchFiles].sort((a, b) => a[0].localeCompare(b[0]))) entries.push({ path: p, type: 'file', data: b });
    for (const [id, png] of [...thumbs].sort((a, b) => a[0].localeCompare(b[0]))) entries.push({ path: `thumbs/${id}.png`, type: 'file', data: png });
    for (const [p, b] of [...themeFiles].sort((a, b) => a[0].localeCompare(b[0]))) entries.push({ path: p, type: 'file', data: b });
    const u8 = mods.u8.buildU8(entries);
    const szs = mods.yaz0.encodeYaz0(u8, { searchDepth: 64 });
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_FILE, szs);

    // ------------------------------------------------------------------ report
    const sum = (pred) => entries.filter((e) => pred(e.path)).reduce((s, e) => s + e.data.length, 0);
    console.log(`kit: ${surfaces.length} surfaces, ${themes.length} themes, ${swatchFiles.size} swatch files`);
    console.log(`u8 ${(u8.length / 1048576).toFixed(2)} MB -> yaz0 ${(szs.length / 1048576).toFixed(2)} MB  (${Math.round((Date.now() - startedAt) / 1000)} s)`);
    console.log(`  swatches ${(sum((p) => p.startsWith('swatches/')) / 1024).toFixed(0)} KB, thumbs ${(sum((p) => p.startsWith('thumbs/')) / 1024).toFixed(0)} KB, themes ${(sum((p) => p.startsWith('themes/')) / 1024).toFixed(0)} KB, previews ${(sum((p) => p.startsWith('previews/')) / 1024).toFixed(0)} KB`);
    if (process.env.KIT_VERBOSE) {
      for (const [p, b] of swatchFiles) console.log(`  ${p} ${(b.length / 1024).toFixed(0)} KB`);
      for (const rec of built) console.log(`  ${rec.spec.id.padEnd(20)} flag 0x${defaultFlag(rec.spec).toString(16)} (retail ${rec.measured || '-'}) xlu=${rec.translucent ? 1 : 0} vc=${rec.usesVertexColor ? 1 : 0} anim=${rec.animated ? 1 : 0} retailUV=${rec.retailUv ? rec.retailUv.map(Math.round).join('x') : '-'} world=${rec.spec.world.join('x')}`);
    }
  } finally {
    await mods.server.close();
  }
}

/**
 * Fog normalisation. Retail courses mostly use the exponential EGG fog types (2-5); the editor's
 * renderer saturates those to a flat wash of the fog colour a few hundred units from the camera, and
 * the numbers are tuned for each course's own scale anyway. Theme fog is therefore written as plain
 * linear fog (type 1) that starts where the donor's did (at least 30000 units out) and ends at the
 * donor's end distance (at least 420000, past the sky dome), which keeps the donor's haze colour
 * on the horizon without drowning the road.
 */
function linearFog(mods, bytes) {
  const entries = mods.posteffects.parseBfgFogEntries(bytes);
  const next = entries.map((e) => {
    if (e.fogType < 1) return e;
    // presets the author left unusable (end <= start) are switched off rather than guessed at
    if (!(e.endZ > e.startZ)) return { ...e, fogType: 0, startZ: 0, endZ: 0 };
    if (e.fogType > 5) return e;
    return { ...e, fogType: 1, startZ: Math.max(30000, e.startZ), endZ: Math.max(420000, e.endZ) };
  });
  return mods.posteffects.writeBfgFogEntries(bytes, next);
}

function group_paletteFor(mods, brres, mat, textureName) {
  const doc = mods.archive.decodeMaterial(brres, 'course', mat.name);
  return doc.samplers.find((s) => s.texture === textureName)?.palette ?? '';
}

/** Centre-square crop, box-resized to 64x64, as a PNG. */
function thumbnail64(img) {
  const s = Math.min(img.width, img.height);
  const cropped = cropImage(img, [Math.floor((img.width - s) / 2), Math.floor((img.height - s) / 2), s, s]);
  const small = resizeImage(cropped, 64, 64);
  // flatten alpha onto mid grey so cut-outs (fences) stay readable
  const px = new Uint8Array(small.rgba);
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    const bg = ((((i >> 2) % 64) >> 3) + (Math.floor(i / 4 / 64) >> 3)) & 1 ? 84 : 112;
    for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] * a + bg * (1 - a));
    px[i + 3] = 255;
  }
  return encodePng(64, 64, px);
}

/** Fallback preview card: the accent gradient with the theme's road and ground swatches. */
function composePreview(theme, kitSurfaces, thumbs) {
  const W = 320, H = 180;
  const px = new Uint8Array(W * H * 4);
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [a, b] = theme.accent.map(hex);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = y / H;
    for (let k = 0; k < 3; k++) px[(y * W + x) * 4 + k] = Math.round(a[k] * (1 - t) + b[k] * t);
    px[(y * W + x) * 4 + 3] = 255;
  }
  const put = (id, x0, y0, w, h) => {
    const png = decodePng(thumbs.get(id));
    const img = resizeImage({ width: 64, height: 64, rgba: png.rgba }, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) px[((y0 + y) * W + x0 + x) * 4 + k] = img.rgba[(y * w + x) * 4 + k];
  };
  put(theme.slots.ground, 0, 110, 320, 70);
  put(theme.slots.road, 40, 120, 240, 40);
  return encodePng(W, H, px);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
