#!/usr/bin/env node
/**
 * How much of a real Mario Kart Wii material the shader-graph editor can draw as nodes.
 *
 * Decompiles every material of every MDL0 in a corpus of real archives, and for each stage the
 * decompiler had to keep verbatim ("Special step" in the UI) records *why*: which operand the
 * node vocabulary has no source for, or which stage fields a recompile got wrong. The output is
 * a histogram of causes per family (driver / kart / course / object / other) and the raw-stage
 * share per family, which is what says what to build next — and, once built, that it stayed built.
 *
 * Headless: no browser, no GPU. Modules load through Vite's SSR pipeline so the TypeScript
 * sources and the `noclip-rust-support` alias resolve exactly as they do in the app.
 *
 * Usage:
 *   node scripts/shader-graph-coverage.mjs                     # the default corpus
 *   node scripts/shader-graph-coverage.mjs --limit 40          # 40 archives per family
 *   node scripts/shader-graph-coverage.mjs --family driver     # one family only
 *   node scripts/shader-graph-coverage.mjs --json out.json     # the full table
 *   node scripts/shader-graph-coverage.mjs --worst 20          # the 20 rawest materials
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CHARACTER_DIR = 'C:/Users/patchzy/AppData/Roaming/Dolphin Emulator/Load/RIIVOL2UTION/RRBeta/Character';
const NINTENDO_TRACK_DIR = 'C:/Users/patchzy/AppData/Roaming/Dolphin Emulator/Load/Riivolution/WheelWizard/RRBeta/Tracks';
const CUSTOM_TRACK_DIR = 'D:/Games/Wii/Dolphin-2/RR/RetroRewind6/CT/Tracks';
const COMMON_ARCHIVE = join(ROOT, 'public/data/MarioKartWii/Race/Common.szs');
const PREVIEW_DUMMIES = join(ROOT, 'public/data/MarioKartWii/Race/PreviewDummies.u8');

/**
 * A family is a bag of archives that were authored by the same kind of tool for the same kind of
 * surface, which is the grain the numbers are actually interesting at: a driver's face and a road
 * fail for completely different reasons.
 */
const FAMILIES = {
  driver: { label: 'driver', dirs: [CHARACTER_DIR], pick: pickDriver },
  kart: { label: 'kart', dirs: [CHARACTER_DIR], pick: pickKart },
  course: { label: 'course', dirs: [NINTENDO_TRACK_DIR, CUSTOM_TRACK_DIR], pick: pickCourse },
  object: { label: 'object', dirs: [], pick: null },
};

function parseArgs(argv) {
  const options = { limit: 24, json: null, families: null, worst: 8, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--limit') options.limit = Number(argv[++i]);
    else if (arg === '--json') options.json = argv[++i];
    else if (arg === '--family') options.families = (options.families ?? []).concat(argv[++i].split(','));
    else if (arg === '--worst') options.worst = Number(argv[++i]);
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function listFiles(dir, filter) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(filter)
    .sort()
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile());
}

/** `Driver/*.brres`, the bare driver models: one MDL0 each, no archive around it. */
function pickDriver(limit) {
  const bare = listFiles(join(CHARACTER_DIR, 'Driver'), (name) => name.toLowerCase().endsWith('.brres'));
  const inSzs = listFiles(CHARACTER_DIR, (name) => name.toLowerCase().endsWith('.szs'));
  return [
    ...bare.slice(0, Math.ceil(limit / 2)).map((path) => ({ path, member: null })),
    ...spread(inSzs, Math.floor(limit / 2)).map((path) => ({ path, member: 'driver_model.brres' })),
  ];
}

/** `kart_model.brres` out of the vehicle+driver archives, plus the standalone `AllKart` ones. */
function pickKart(limit) {
  const inSzs = listFiles(CHARACTER_DIR, (name) => name.toLowerCase().endsWith('.szs'));
  const allKart = listFiles(join(CHARACTER_DIR, 'AllKart'), (name) => name.toLowerCase().endsWith('.szs'));
  return [
    ...spread(inSzs, Math.ceil(limit / 2)).map((path) => ({ path, member: 'kart_model.brres' })),
    ...spread(allKart, Math.floor(limit / 2)).map((path) => ({ path, member: null })),
  ];
}

function pickCourse(limit) {
  const nintendo = listFiles(NINTENDO_TRACK_DIR, (name) => name.toLowerCase().endsWith('.szs'));
  const custom = listFiles(CUSTOM_TRACK_DIR, (name) => name.toLowerCase().endsWith('.szs'));
  return [
    ...spread(nintendo, Math.ceil(limit / 2)).map((path) => ({ path, member: 'course_model.brres' })),
    ...spread(custom, Math.floor(limit / 2)).map((path) => ({ path, member: 'course_model.brres' })),
  ];
}

/** `count` entries spread evenly through a list, so a sample is not just the first alphabetically. */
function spread(list, count) {
  if (list.length <= count) return list;
  const step = list.length / count;
  return Array.from({ length: count }, (_, index) => list[Math.floor(index * step)]);
}

function pad(text, width) {
  const value = String(text);
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function padStart(text, width) {
  const value = String(text);
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

function percent(part, whole) {
  return whole === 0 ? '  —  ' : `${((part / whole) * 100).toFixed(1)}%`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const server = await createServer({
    root: ROOT,
    configFile: join(ROOT, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    logLevel: 'error',
  });

  const report = {
    families: {},
    causes: {},
    worst: [],
    archives: 0,
    materials: 0,
    stages: 0,
    rawStages: 0,
    rawMaterials: 0,
  };

  try {
    const yaz0 = await server.ssrLoadModule('/src/lib/yaz0.ts');
    const u8 = await server.ssrLoadModule('/src/lib/u8.ts');
    const brresRaw = await server.ssrLoadModule('/src/lib/brres/brresRaw.ts');
    const mdl0Raw = await server.ssrLoadModule('/src/lib/brres/mdl0Raw.ts');
    const codec = await server.ssrLoadModule('/src/lib/gxMaterial/materialCodec.ts');
    const decompile = await server.ssrLoadModule('/src/lib/gxMaterial/decompile.ts');
    const graph = await server.ssrLoadModule('/src/lib/gxMaterial/shaderGraph.ts');

    /** Every BRRES inside a `.szs`/`.u8`, or the file itself when it already is one. */
    function brresIn(path, member) {
      const bytes = new Uint8Array(readFileSync(path));
      if (path.toLowerCase().endsWith('.brres')) return [{ name: path.split(/[\\/]/).pop(), data: bytes }];
      const raw = bytes[0] === 0x59 && bytes[1] === 0x61 ? yaz0.decodeYaz0(bytes) : bytes;
      let entries;
      try {
        entries = u8.parseU8(raw);
      } catch {
        return [];
      }
      return entries
        .filter((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('.brres') && (entry.data?.length ?? 0) > 512)
        .filter((entry) => !member || entry.path.toLowerCase().endsWith(member.toLowerCase()))
        .map((entry) => ({ name: entry.path.split('/').pop(), data: entry.data }));
    }

    function materialsIn(data) {
      const out = [];
      const raw = brresRaw.readBrresRaw(data);
      const models = raw.groups.find((group) => group.name === brresRaw.BRRES_MODELS_GROUP)?.entries ?? [];
      for (const subFile of models) {
        let editor;
        try {
          editor = new mdl0Raw.Mdl0Editor(subFile.data, brresRaw.makeSubFileNameReader(raw, subFile));
        } catch {
          continue;
        }
        if (editor.version !== 0x0b) continue;
        const view = new DataView(editor.data.buffer, editor.data.byteOffset, editor.data.byteLength);
        for (const entry of editor.getDic('material')?.entries ?? []) {
          const size = view.getUint32(entry.offset + codec.MATERIAL_FIELDS.size);
          const tevOffset = entry.offset + view.getUint32(entry.offset + codec.MATERIAL_FIELDS.tevOffset);
          try {
            out.push({
              model: subFile.name,
              material: entry.name,
              doc: codec.decodeMaterialBlock({
                block: editor.data.slice(entry.offset, entry.offset + size),
                tev: editor.data.slice(tevOffset, tevOffset + codec.TEV_BLOCK_SIZE),
                name: entry.name,
                readName: (offset) => editor.readNameAt(entry.offset + offset),
              }),
            });
          } catch {
            // A material this decoder cannot read is not this script's subject.
          }
        }
      }
      return out;
    }

    function bump(family, key, where, count = 1) {
      const bucket = (report.causes[key] ??= { total: 0, byFamily: {}, examples: [] });
      bucket.total += count;
      bucket.byFamily[family] = (bucket.byFamily[family] ?? 0) + count;
      if (where && bucket.examples.length < 3) bucket.examples.push(where);
    }

    function checkArchive(family, label, data) {
      const stats = (report.families[family] ??= {
        archives: 0, materials: 0, stages: 0, rawStages: 0, rawMaterials: 0, roundTripFailures: [],
      });
      stats.archives += 1;
      report.archives += 1;
      for (const { model, material, doc } of materialsIn(data)) {
        const result = decompile.decompileShaderReport(doc);
        stats.materials += 1;
        stats.stages += result.stages;
        stats.rawStages += result.rawStages;
        report.materials += 1;
        report.stages += result.stages;
        report.rawStages += result.rawStages;
        if (result.rawStages > 0) {
          stats.rawMaterials += 1;
          report.rawMaterials += 1;
          report.worst.push({ family, label, model, material, raw: result.rawStages, stages: result.stages });
        }

        for (const cause of result.causes) {
          const where = `${label} · ${model} · ${material} #${cause.index}`;
          if (cause.kind === 'operand' || cause.kind === 'fallback') {
            const keys = cause.refusals.length > 0
              ? [...new Set(cause.refusals.map((entry) => entry.replace(/^(colour|alpha) [ABCD]: /, (m, side) => `${side} input reads `)))]
              : [cause.kind === 'fallback' ? 'no progress: whole material verbatim' : 'unknown refusal'];
            for (const key of keys) bump(family, key, where);
          } else {
            const keys = cause.fields.length > 0 ? cause.fields : ['(stage count)'];
            for (const key of keys) bump(family, `recompiled differently: ${key}`, `${where} [${cause.details.join(', ')}]`);
          }
        }

        // The promise the editor makes: what it draws recompiles to exactly what the file holds.
        const compiled = graph.compileShaderGraph(result.graph, doc);
        if (!compiled.ok || JSON.stringify(compiled.tevStages) !== JSON.stringify(doc.tevStages)) {
          stats.roundTripFailures.push(`${label}/${model}/${material}`);
        }
      }
    }

    const wanted = options.families ?? Object.keys(FAMILIES);
    for (const family of wanted) {
      const spec = FAMILIES[family];
      if (!spec) throw new Error(`unknown family: ${family}`);
      const files = family === 'object'
        ? (existsSync(COMMON_ARCHIVE) ? [{ path: COMMON_ARCHIVE, member: null }] : [])
          .concat(existsSync(PREVIEW_DUMMIES) ? [{ path: PREVIEW_DUMMIES, member: null }] : [])
        : spec.pick(options.limit);
      if (files.length === 0) {
        console.warn(`! nothing to read for family "${family}"`);
        continue;
      }
      for (const { path, member } of files) {
        const label = path.split(/[\\/]/).slice(-2).join('/');
        let archives;
        try {
          archives = brresIn(path, member);
        } catch (error) {
          console.warn(`! ${label}: ${error.message}`);
          continue;
        }
        for (const archive of archives) checkArchive(family, `${label}:${archive.name}`, archive.data);
      }
      if (!options.quiet) {
        const stats = report.families[family];
        console.log(
          `${pad(family, 8)} ${padStart(stats.archives, 4)} archives  ${padStart(stats.materials, 5)} materials  ` +
          `${padStart(stats.stages, 6)} stages  ${padStart(stats.rawStages, 5)} raw (${percent(stats.rawStages, stats.stages)})`,
        );
      }
    }
  } finally {
    await server.close();
  }

  report.worst.sort((a, b) => b.raw - a.raw || b.stages - a.stages);

  console.log('');
  console.log('='.repeat(88));
  console.log('Raw ("Special step") share per family');
  console.log('');
  console.log(`${pad('family', 10)} ${padStart('archives', 8)} ${padStart('materials', 9)} ${padStart('stages', 7)} ${padStart('raw', 6)} ${padStart('raw %', 7)} ${padStart('mats w/ raw', 12)}`);
  for (const [family, stats] of Object.entries(report.families)) {
    console.log(
      `${pad(family, 10)} ${padStart(stats.archives, 8)} ${padStart(stats.materials, 9)} ${padStart(stats.stages, 7)} ` +
      `${padStart(stats.rawStages, 6)} ${padStart(percent(stats.rawStages, stats.stages), 7)} ${padStart(`${stats.rawMaterials} (${percent(stats.rawMaterials, stats.materials)})`, 12)}`,
    );
  }
  console.log(
    `${pad('ALL', 10)} ${padStart(report.archives, 8)} ${padStart(report.materials, 9)} ${padStart(report.stages, 7)} ` +
    `${padStart(report.rawStages, 6)} ${padStart(percent(report.rawStages, report.stages), 7)} ${padStart(`${report.rawMaterials} (${percent(report.rawMaterials, report.materials)})`, 12)}`,
  );

  const causes = Object.entries(report.causes).sort((a, b) => b[1].total - a[1].total);
  console.log('');
  console.log('Why a stage stayed raw (a stage can have more than one reason)');
  console.log('');
  const width = Math.min(58, Math.max(20, ...causes.map(([key]) => key.length)));
  const familyNames = Object.keys(report.families);
  console.log(`${pad('cause', width)} ${padStart('count', 6)}  ${familyNames.map((name) => padStart(name, 8)).join(' ')}`);
  console.log('-'.repeat(width + 8 + familyNames.length * 9));
  for (const [key, bucket] of causes) {
    console.log(
      `${pad(key.slice(0, width), width)} ${padStart(bucket.total, 6)}  ` +
      familyNames.map((name) => padStart(bucket.byFamily[name] ?? 0, 8)).join(' '),
    );
  }

  const failures = Object.entries(report.families).flatMap(([family, stats]) =>
    stats.roundTripFailures.map((entry) => `${family}: ${entry}`),
  );
  console.log('');
  if (failures.length === 0) {
    console.log(`Round trip: every one of ${report.materials} materials recompiles byte-exactly.`);
  } else {
    console.log(`Round trip: ${failures.length} of ${report.materials} materials FAILED to recompile exactly:`);
    for (const entry of failures.slice(0, 20)) console.log(`  ${entry}`);
  }

  if (options.worst > 0 && report.worst.length > 0) {
    console.log('');
    console.log(`The ${Math.min(options.worst, report.worst.length)} materials with the most raw stages:`);
    for (const entry of report.worst.slice(0, options.worst)) {
      console.log(`  ${pad(entry.family, 8)} ${entry.raw}/${entry.stages}  ${entry.label} · ${entry.model} · ${entry.material}`);
    }
  }

  if (options.json) {
    writeFileSync(options.json, JSON.stringify(report, null, 2));
    console.log('');
    console.log(`Full table written to ${options.json}`);
  }

  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
