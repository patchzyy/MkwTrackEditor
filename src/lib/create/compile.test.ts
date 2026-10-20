import { beforeAll, describe, expect, it } from 'vitest';
import { parseU8 } from '../u8';
import { decodeYaz0, isYaz0 } from '../yaz0';
import { readKmpFile } from '../kmpFile';
import { validateKmpFile } from '../kmpValidation';
import { loadTrackBytes } from '../track';
import type { BuildModelBrres, CompileWriters, CreateKit, CreateProject } from './types';
import { useDeterministicIds } from './ids';
import { createStubWriters, createSyntheticKit } from './__tests__/syntheticKit';
import { createProjectFromTemplate } from './templates';
import { addRoad, updateGeneration, updateRoadPoint } from './ops';
import {
  buildPreviewModels,
  buildTrackArchive,
  compileGeometry,
  compileProject,
  computeFileHashes,
  hashBytes,
  hashMeshes,
  type PreviewCache,
} from './compile';

let kit: CreateKit;
beforeAll(() => {
  useDeterministicIds();
  kit = createSyntheticKit();
});

const make = (id: string): CreateProject => createProjectFromTemplate(id, { name: 'My Track', themeId: 'test', laps: 3 }, kit);

describe('compileProject', () => {
  it('writes every file of a track archive', () => {
    const calls: string[] = [];
    const base = createStubWriters();
    const writers: CompileWriters = {
      buildModelBrres: (input) => {
        calls.push(`model:${input.modelName}:${input.materials.length}:${input.copyAnimations}`);
        return base.buildModelBrres(input);
      },
      buildKcl: (c, o) => {
        calls.push(`kcl:${c.flags.length}`);
        return base.buildKcl(c, o);
      },
      buildMinimapBrres: (input) => {
        calls.push(`map:${input.meshes.length}:${input.material.surfaceId}`);
        return base.buildMinimapBrres(input);
      },
    };
    const result = compileProject(make('oval'), kit, writers);
    expect([...result.files.keys()].sort()).toEqual(['course.kcl', 'course.kmp', 'course_model.brres', 'map_model.brres', 'posteffect/posteffect.blight']);
    expect(calls[0]).toMatch(/^model:course:\d+:true$/);
    expect(calls[1]).toBe(`kcl:${result.geometry.collision.flags.length}`);
    expect(calls[2]).toMatch(/^map:\d+:minimap$/);
    // Materials: one per surface actually used, each resolved from the kit.
    const used = new Set(result.geometry.meshes.map((m) => m.surfaceId));
    expect(Number(calls[0].split(':')[2])).toBe(used.size);
    expect(result.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(result.issues.map((i) => i.code)).toContain('kit.missing-swatch'); // the synthetic kit has no swatch files
    const kmp = readKmpFile(result.files.get('course.kmp')!);
    expect(validateKmpFile(kmp).filter((i) => i.level === 'error')).toEqual([]);
    expect(result.stats.checkpoints).toBe(kmp.checkpoints.length);
    expect(result.stats.itemBoxes).toBe(15);
    expect(result.stats.triangles).toBeGreaterThan(10000);
    expect(result.stats.collisionTriangles).toBe(result.geometry.collision.flags.length);
    expect(result.stats.roadLength).toBeGreaterThan(100000);
    expect(result.stats.millis).toBeGreaterThan(0);
  });

  it('keeps locked KMP sections from the previous KMP', () => {
    const p = make('oval');
    const first = compileProject(p, kit, createStubWriters());
    const edited = readKmpFile(first.files.get('course.kmp')!);
    edited.enemyPoints[0] = { ...edited.enemyPoints[0], range: 77 };
    const second = compileProject(updateGeneration(p, { lockedKmpSections: ['enemy'] }), kit, createStubWriters(), edited);
    expect(second.kmp.enemyPoints[0].range).toBe(77);
    expect(readKmpFile(second.files.get('course.kmp')!).enemyPoints[0].range).toBe(77);
  });

  it('reports a missing world', () => {
    const p = { ...make('oval'), themeId: 'nope' };
    const result = compileProject(p, kit, createStubWriters());
    expect(result.issues.map((i) => i.code)).toContain('theme.missing');
  });

  it('compiles an empty design without throwing', () => {
    const result = compileProject(make('blank'), kit, createStubWriters());
    expect(result.files.get('course.kmp')).toBeDefined();
    expect(result.geometry.meshes.every((m) => m.chunk === 'terrain' || m.chunk === 'horizon')).toBe(true);
  });
});

describe('buildTrackArchive', () => {
  it('packs a Yaz0-compressed U8 with the files at the root and directories for subfolders', () => {
    const result = compileProject(make('oval'), kit, createStubWriters());
    const szs = buildTrackArchive(result);
    expect(isYaz0(szs)).toBe(true);
    const entries = parseU8(decodeYaz0(szs));
    const names = entries.map((e) => `${e.type[0]}:${e.path}`);
    expect(names).toContain('f:./course.kmp');
    expect(names).toContain('f:./course.kcl');
    expect(names).toContain('f:./course_model.brres');
    expect(names).toContain('f:./map_model.brres');
    expect(names).toContain('d:./posteffect');
    expect(names).toContain('f:./posteffect/posteffect.blight');
    const kmp = entries.find((e) => e.path === './course.kmp')!;
    expect(Buffer.from(kmp.data!).equals(Buffer.from(result.files.get('course.kmp')!))).toBe(true);
  });

  it('can skip compression and still load as a track', async () => {
    const result = compileProject(make('kidney'), kit, createStubWriters());
    const small = buildTrackArchive(result);
    const raw = buildTrackArchive(result, { compress: false });
    expect(isYaz0(raw)).toBe(true);
    expect(raw.length).toBeGreaterThan(small.length);
    expect(Buffer.from(decodeYaz0(raw)).equals(Buffer.from(decodeYaz0(small)))).toBe(true);
    const doc = await loadTrackBytes(small, 'kidney.szs', { modelPreviews: false });
    expect(doc.kmpFile?.checkpoints.length).toBe(result.kmp.checkpoints.length);
    expect(doc.archiveEntries.some((e) => e.path.endsWith('course.kcl'))).toBe(true);
  });
});

describe('buildPreviewModels', () => {
  const trackWithTwoRoads = (): CreateProject => {
    let p = make('oval');
    const far = addRoad(p, {
      points: [
        { position: { x: -30000, y: 0, z: 60000 } },
        { position: { x: -20000, y: 0, z: 62000 } },
        { position: { x: -10000, y: 0, z: 60000 } },
      ],
      name: 'Side road',
    });
    p = far.project;
    return p;
  };

  function spyBuilder(): { build: BuildModelBrres; calls: string[] } {
    const calls: string[] = [];
    const writers = createStubWriters();
    return {
      calls,
      build: (input) => {
        calls.push(input.modelName);
        return writers.buildModelBrres(input);
      },
    };
  }

  it('builds one model per chunk and only rebuilds chunks whose meshes changed', () => {
    const spy = spyBuilder();
    const cache: PreviewCache = new Map();
    const p = trackWithTwoRoads();
    const geo = compileGeometry(p, kit);
    const first = buildPreviewModels(geo, kit, spy.build, cache);
    const keys = first.map((m) => m.key);
    expect(keys).toContain('terrain');
    expect(keys).toContain('pieces');
    expect(keys.filter((k) => k.startsWith('road:'))).toHaveLength(2);
    expect(first.every((m) => m.revision === 1)).toBe(true);
    expect(spy.calls.length).toBe(first.length);
    spy.calls.length = 0;

    // Same design again: nothing is rebuilt and the very same model objects come back.
    const again = buildPreviewModels(compileGeometry(p, kit), kit, spy.build, cache);
    expect(spy.calls).toEqual([]);
    again.forEach((m, i) => expect(m).toBe(first[i]));

    // Drag a point of the side road: only that road (and the terrain it flattens) changes.
    const side = p.roads[1];
    const moved = updateRoadPoint(p, side.id, side.points[1].id, { position: { x: -23000, y: 0, z: 61000 } });
    const third = buildPreviewModels(compileGeometry(moved, kit), kit, spy.build, cache);
    const byKey = (list: typeof third, key: string) => list.find((m) => m.key === key)!;
    expect(byKey(third, `road:${p.roads[0].id}`)).toBe(byKey(first, `road:${p.roads[0].id}`));
    expect(byKey(third, 'pieces')).toBe(byKey(first, 'pieces'));
    expect(byKey(third, `road:${side.id}`).revision).toBe(2);
    expect(byKey(third, 'terrain').revision).toBe(2);
    expect(spy.calls.map((n) => n.replace(/_[0-9a-f]{8}$/, '')).sort()).toEqual([`preview_road_${side.id}`, 'preview_terrain'].sort());
    // The name changes with the content and stays put for a cached chunk.
    expect(byKey(third, `road:${side.id}`).modelName).not.toBe(byKey(first, `road:${side.id}`).modelName);
    expect(byKey(third, 'pieces').modelName).toBe(byKey(first, 'pieces').modelName);
    // Model names are usable as MDL0 names.
    for (const m of third) expect(m.modelName).toMatch(/^[A-Za-z0-9_]+$/);

    // Removing a road drops its chunk from the cache.
    const removed = buildPreviewModels(compileGeometry({ ...moved, roads: [moved.roads[0]], pieces: moved.pieces }, kit), kit, spy.build, cache);
    expect(removed.some((m) => m.key === `road:${side.id}`)).toBe(false);
    expect(cache.has(`road:${side.id}`)).toBe(false);
  });
});

describe('hashing', () => {
  it('is stable, sensitive, and works on unaligned views', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(hashBytes(a)).toBe(hashBytes(a.slice()));
    expect(hashBytes(a)).not.toBe(hashBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 10])));
    const buf = new Uint8Array(32);
    buf.set([9, 8, 7, 6, 5, 4, 3], 1);
    expect(hashBytes(buf.subarray(1, 8))).toBe(hashBytes(new Uint8Array([9, 8, 7, 6, 5, 4, 3])));
    expect(hashBytes(new Uint8Array(0))).toMatch(/^[0-9a-f]{16}$/);
  });

  it('hashes meshes and files', () => {
    const geo = compileGeometry(make('oval'), kit);
    expect(hashMeshes(geo.meshes)).toBe(hashMeshes(compileGeometry(make('oval'), kit).meshes));
    const hashes = computeFileHashes(new Map([['a', new Uint8Array([1])], ['b', new Uint8Array([2])]]));
    expect(Object.keys(hashes)).toEqual(['a', 'b']);
    expect(hashes.a).not.toBe(hashes.b);
  });
});

describe('performance', () => {
  it('compiles the geometry of a typical track quickly once warm', () => {
    const p = make('oval');
    for (let i = 0; i < 3; i++) compileGeometry(p, kit);
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t = performance.now();
      compileGeometry(p, kit);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    console.log(`compileGeometry(oval) median ${median.toFixed(1)} ms (min ${times[0].toFixed(1)}, max ${times[times.length - 1].toFixed(1)})`);
    // The budget is 30 ms on a developer machine; leave generous slack so shared CI hardware passes.
    expect(median).toBeLessThan(120);
  });
});
