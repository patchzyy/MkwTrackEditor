/**
 * Design -> track. `compileGeometry` is cheap enough to run on every drag frame; `compileProject`
 * adds the KMP and runs the writers; `buildTrackArchive` packs the result into a playable `.szs`.
 */
import { writeKmpFile, type KmpFile } from '../kmpFile';
import { buildU8, type U8Entry } from '../u8';
import { encodeYaz0, encodeYaz0Uncompressed } from '../yaz0';
import type {
  CompileResult,
  CompileWriters,
  CompiledGeometry,
  CreateIssue,
  CreateKit,
  CreatePreviewModel,
  CreateProject,
  GeneratedMesh,
  MaterialSource,
  Road,
  BuildModelBrres,
} from './types';
import { CollisionBuilder, MeshBuilder, emptyBounds, growBounds } from './meshBuilder';
import { buildRoadGeometry, type RoadGeometryResult } from './road';
import { buildHorizon, HORIZON_CHUNK } from './horizon';
import { buildPieceGeometry } from './pieces';
import {
  buildBoundaryCollision,
  buildTerrainField,
  buildTerrainGeometry,
  type TerrainField,
  fallPlane,
  worldBounds,
} from './terrain';
import { createSurfaceQuery } from './raycast';
import { generateKmp } from './kmpGen';
import { roadLength, sampleRoadRange } from './spline';
import { sectionRanges } from './sections';

export const MINIMAP_SURFACE_ID = 'minimap';

function meshBounds(meshes: GeneratedMesh[], collision: CollisionBuilder): CompiledGeometry['bounds'] {
  const b = emptyBounds();
  for (const m of meshes) {
    if (m.chunk === HORIZON_CHUNK) continue;
    const p = m.positions;
    for (let i = 0; i < p.length; i += 3) growBounds(b, p[i], p[i + 1], p[i + 2]);
  }
  if (!Number.isFinite(b.min.x)) {
    // Nothing visible: fall back to the collision that is not a giant fall plane.
    const p = collision.rawPositions;
    for (let i = 0; i < p.length; i += 3) {
      if (Math.abs(p[i]) < 5e4 && Math.abs(p[i + 2]) < 5e4) growBounds(b, p[i], p[i + 1], p[i + 2]);
    }
  }
  if (!Number.isFinite(b.min.x)) return { min: { x: -1000, y: 0, z: -1000 }, max: { x: 1000, y: 100, z: 1000 } };
  return { min: { ...b.min }, max: { ...b.max } };
}

/** Flat outline of the drivable surface for the minimap (Y is ignored by the writer). */
function buildMinimapMeshes(project: CreateProject): GeneratedMesh[] {
  const mb = new MeshBuilder('minimap', 'minimap');
  for (const road of project.roads) {
    for (const range of sectionRanges(road)) {
      if (range.kind === 'gap') continue;
      const samples = sampleRoadRange(road, range.from, range.to, { step: 500, maxAngleDegrees: 10 });
      if (samples.length < 2) continue;
      const l: number[] = [];
      const r: number[] = [];
      for (const s of samples) {
        const half = s.width / 2;
        l.push(mb.vertex(MINIMAP_SURFACE_ID, s.position.x - s.right.x * half, 0, s.position.z - s.right.z * half, 0, 1, 0, 0, 0, 255));
        r.push(mb.vertex(MINIMAP_SURFACE_ID, s.position.x + s.right.x * half, 0, s.position.z + s.right.z * half, 0, 1, 0, 1, 0, 255));
      }
      for (let i = 0; i + 1 < samples.length; i++) mb.facingQuad(MINIMAP_SURFACE_ID, l[i], r[i], l[i + 1], r[i + 1], 0, 1, 0);
    }
  }
  return mb.build();
}

export interface CompileGeometryOptions {
  /**
   * Draft mode for drag gestures: the terrain is built on a grid 4x coarser, the minimap outline is skipped, road cross-sections are
   * spaced 700 apart instead of 250, and (with `cache`) roads that did not change are reused. The
   * result is meant for the live preview only; always run a normal compile when the gesture ends.
   */
  draft?: boolean;
  /** Reuse work between calls (only used in draft mode). Create one per editing session. */
  cache?: GeometryCache;
}

interface CachedRoad {
  themeId: string;
  terrain: CreateProject['terrain'];
  strokes: CreateProject['terrainStrokes'];
  startParam: number | null;
  result: RoadGeometryResult;
}

interface CachedTerrain {
  key: unknown[];
  field: TerrainField;
  meshes: GeneratedMesh[];
  collision: CollisionBuilder;
}

/**
 * Remembers the expensive parts of a draft compile: per-road geometry (keyed by the road object, which
 * `ops` replace when a road changes) and the terrain (keyed by everything it depends on).
 */
export interface GeometryCache {
  roads: WeakMap<Road, CachedRoad>;
  terrain: CachedTerrain | null;
}

export function createGeometryCache(): GeometryCache {
  return { roads: new WeakMap(), terrain: null };
}

const DRAFT_TERRAIN_COARSE = 4;
const DRAFT_ROAD_STEP = 700;

function sameList(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Geometry only: meshes by chunk, collision, minimap outline and bounds. */
export function compileGeometry(project: CreateProject, kit: CreateKit, options: CompileGeometryOptions = {}): CompiledGeometry {
  const draft = options.draft === true;
  const cache = draft ? options.cache : undefined;
  const wb = worldBounds(project);

  // Terrain: reused as a whole when nothing it depends on changed (e.g. while a piece is dragged).
  const terrainKey: unknown[] = [project.terrain, project.terrainStrokes, project.themeId, draft, ...project.roads];
  let field: TerrainField;
  let terrainMeshes: GeneratedMesh[] = [];
  let terrainCollision = new CollisionBuilder();
  if (cache?.terrain && sameList(cache.terrain.key, terrainKey)) {
    field = cache.terrain.field;
    terrainMeshes = cache.terrain.meshes;
    terrainCollision = cache.terrain.collision;
  } else {
    field = buildTerrainField(project, kit, { coarse: draft ? DRAFT_TERRAIN_COARSE : 1, bounds: wb });
    if (field.enabled) {
      const terrain = buildTerrainGeometry(field, project, kit);
      terrainMeshes = terrain.meshes;
      terrainCollision = terrain.collision;
    }
    if (cache) cache.terrain = { key: terrainKey, field, meshes: terrainMeshes, collision: terrainCollision };
  }

  const meshes: GeneratedMesh[] = [];
  const collision = new CollisionBuilder();

  for (const road of project.roads) {
    if (road.points.length < 2) continue;
    const startParam = project.start.roadId === road.id ? project.start.param : null;
    const hit = cache?.roads.get(road);
    let g: RoadGeometryResult;
    if (hit && hit.themeId === project.themeId && hit.terrain === project.terrain && hit.strokes === project.terrainStrokes && hit.startParam === startParam) {
      g = hit.result;
    } else {
      g = buildRoadGeometry(project, kit, road, field, draft ? { step: DRAFT_ROAD_STEP, maxAngleDegrees: 12 } : {});
      cache?.roads.set(road, { themeId: project.themeId, terrain: project.terrain, strokes: project.terrainStrokes, startParam, result: g });
    }
    meshes.push(...g.meshes);
    collision.append(g.collision);
  }

  const pieces = buildPieceGeometry(project, kit);
  meshes.push(...pieces.meshes);
  collision.append(pieces.collision);

  if (field.enabled) {
    meshes.push(...terrainMeshes);
    collision.append(terrainCollision);
  }

  // World edges and the safety net below everything.
  const bounds = emptyBounds();
  growBounds(bounds, wb.minX, wb.minY, wb.minZ);
  growBounds(bounds, wb.maxX, wb.maxY, wb.maxZ);
  if (field.enabled) buildBoundaryCollision(field, project, collision, bounds);
  const lowest = Math.min(wb.minY, field.enabled ? field.minY : Infinity);
  if (project.roads.some((r) => r.points.length >= 2) || field.enabled) {
    const pad = field.enabled ? 22000 : 14000;
    const floorY = lowest - (field.enabled ? 3500 : 3000);
    fallPlane(collision, wb.minX - pad, wb.minZ - pad, wb.maxX + pad, wb.maxZ + pad, floorY);
  }

  // The horizon is its own chunk, built last so it never counts towards the bounds.
  if (field.enabled) {
    const horizon = buildHorizon(field, project, kit);
    meshes.push(...horizon.meshes);
    collision.append(horizon.collision);
  }

  const minimap = draft ? [] : buildMinimapMeshes(project);
  return {
    meshes,
    collision: collision.build(),
    minimap,
    bounds: meshBounds(meshes, collision),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Hashing
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Fast non-cryptographic hash of bytes, as a short string. */
export function hashBytes(input: Uint8Array): string {
  // Word-wise hashing needs an aligned view; copy the rare unaligned one so results never depend on alignment.
  const bytes = input.byteOffset % 4 === 0 ? input : input.slice();
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ bytes.length;
  const words = Math.floor(bytes.length / 4);
  const view = new Uint32Array(bytes.buffer, bytes.byteOffset, words);
  for (let i = 0; i < words; i++) {
    h1 = Math.imul(h1 ^ view[i], 0x01000193);
    h2 = Math.imul(h2 + view[i], 0x85ebca6b) ^ (h2 >>> 13);
  }
  for (let i = words * 4; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193);
    h2 = Math.imul(h2 + bytes[i], 0x85ebca6b) ^ (h2 >>> 13);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function viewOf(typed: Float32Array | Uint32Array | Uint8Array | Uint16Array): Uint8Array {
  return new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
}

const meshHashes = new WeakMap<GeneratedMesh, string>();

/** Hash of a mesh list's content (what a preview model depends on). Per-mesh hashes are memoised. */
export function hashMeshes(meshes: GeneratedMesh[]): string {
  let out = `${meshes.length}`;
  for (const m of meshes) {
    let h = meshHashes.get(m);
    if (h === undefined) {
      h = `${m.surfaceId}:${hashBytes(viewOf(m.positions))}${hashBytes(viewOf(m.normals))}${hashBytes(viewOf(m.uvs))}${hashBytes(viewOf(m.colors))}${hashBytes(viewOf(m.indices))}`;
      meshHashes.set(m, h);
    }
    out += `|${h}`;
  }
  return out;
}

export function computeFileHashes(files: Map<string, Uint8Array>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, bytes] of files) out[path] = hashBytes(bytes);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Materials
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** `MaterialSource`s for every surface the meshes use (missing swatches are reported). */
export function materialsFor(meshes: GeneratedMesh[], kit: CreateKit, issues?: CreateIssue[]): MaterialSource[] {
  const seen = new Set<string>();
  const out: MaterialSource[] = [];
  for (const mesh of meshes) {
    if (seen.has(mesh.surfaceId)) continue;
    seen.add(mesh.surfaceId);
    const surface = kit.surface(mesh.surfaceId);
    if (!surface) {
      issues?.push({ level: 'error', code: 'kit.missing-surface', message: `A material used by this track (${mesh.surfaceId}) is missing from the asset kit.` });
      continue;
    }
    const bytes = kit.file(surface.swatch);
    if (!bytes) issues?.push({ level: 'warning', code: 'kit.missing-swatch', message: `The material "${surface.label}" could not be loaded.` });
    out.push({
      surfaceId: surface.id,
      brres: bytes ?? new Uint8Array(0),
      modelName: surface.modelName,
      materialName: surface.materialName,
      translucent: surface.translucent,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Whole project
// ─────────────────────────────────────────────────────────────────────────────────────────────

function minimapMaterial(kit: CreateKit): MaterialSource {
  const info = kit.catalog.minimap;
  return {
    surfaceId: MINIMAP_SURFACE_ID,
    brres: kit.file(info.swatch) ?? new Uint8Array(0),
    modelName: 'map',
    materialName: info.materialName,
    translucent: false,
  };
}

/** Geometry + KMP + every file of the archive. `previousKmp` supplies sections the user locked. */
export function compileProject(
  project: CreateProject,
  kit: CreateKit,
  writers: CompileWriters,
  previousKmp?: KmpFile | null,
): CompileResult {
  const started = now();
  const geometry = compileGeometry(project, kit);
  const issues: CreateIssue[] = [];
  const surface = createSurfaceQuery(geometry.collision);
  const gen = generateKmp(project, kit, { ground: surface.groundAt, previous: previousKmp ?? null });
  issues.push(...gen.issues);

  const files = new Map<string, Uint8Array>();
  const materials = materialsFor(geometry.meshes, kit, issues);
  files.set('course_model.brres', writers.buildModelBrres({ modelName: 'course', meshes: geometry.meshes, materials, copyAnimations: true }));
  files.set('course.kcl', writers.buildKcl(geometry.collision));
  files.set('course.kmp', writeKmpFile(gen.kmp));
  if (geometry.minimap.length > 0) {
    files.set('map_model.brres', writers.buildMinimapBrres({ meshes: geometry.minimap, material: minimapMaterial(kit) }));
  }
  const theme = kit.theme(project.themeId);
  if (theme) {
    for (const [archivePath, kitPath] of Object.entries(theme.files)) {
      const bytes = kit.file(kitPath);
      if (bytes) files.set(archivePath, bytes);
      else issues.push({ level: 'warning', code: 'kit.missing-theme-file', message: `A file of the "${theme.label}" world (${archivePath}) is missing from the asset kit.` });
    }
  } else {
    issues.push({ level: 'error', code: 'theme.missing', message: 'The chosen world is not available.', fix: 'Pick another world.' });
  }

  let triangles = 0;
  for (const m of geometry.meshes) triangles += m.indices.length / 3;
  const roadLen = project.roads[0] ? roadLength(project.roads[0]) : 0;
  return {
    geometry,
    kmp: gen.kmp,
    files,
    issues,
    stats: {
      roadLength: roadLen,
      triangles,
      collisionTriangles: geometry.collision.flags.length,
      checkpoints: gen.checkpoints,
      itemBoxes: gen.itemBoxes,
      objects: gen.objects,
      millis: now() - started,
    },
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Packs the compiled files into a course archive (`U8`, Yaz0-compressed unless `compress: false`). */
export function buildTrackArchive(result: Pick<CompileResult, 'files'>, options: { compress?: boolean } = {}): Uint8Array {
  const entries: U8Entry[] = [{ path: '.', type: 'directory' }];
  const dirs = new Set<string>();
  const names = [...result.files.keys()].sort((a, b) => {
    const da = a.includes('/') ? 1 : 0;
    const db = b.includes('/') ? 1 : 0;
    return da - db || a.localeCompare(b);
  });
  for (const name of names) {
    const parts = name.split('/');
    let prefix = '.';
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = `${prefix}/${parts[i]}`;
      if (!dirs.has(prefix)) {
        dirs.add(prefix);
        entries.push({ path: prefix, type: 'directory' });
      }
    }
    entries.push({ path: `./${name}`, type: 'file', data: result.files.get(name) });
  }
  const u8 = buildU8(entries);
  return options.compress === false ? encodeYaz0Uncompressed(u8) : encodeYaz0(u8);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Live preview models
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface PreviewCacheEntry {
  hash: string;
  model: CreatePreviewModel;
}

export type PreviewCache = Map<string, PreviewCacheEntry>;

/**
 * One generated BRRES per chunk (`road:<id>`, `terrain`, `pieces`). A chunk whose meshes did not
 * change keeps its model (same object, same `revision`), so only the dragged road is rebuilt.
 * Chunks that no longer exist are dropped from `cache`.
 */
export function buildPreviewModels(
  geometry: CompiledGeometry,
  kit: CreateKit,
  buildModelBrres: BuildModelBrres,
  cache: PreviewCache,
): CreatePreviewModel[] {
  const byChunk = new Map<string, GeneratedMesh[]>();
  for (const mesh of geometry.meshes) {
    const list = byChunk.get(mesh.chunk);
    if (list) list.push(mesh);
    else byChunk.set(mesh.chunk, [mesh]);
  }
  for (const key of [...cache.keys()]) if (!byChunk.has(key)) cache.delete(key);

  const models: CreatePreviewModel[] = [];
  for (const [chunk, meshes] of byChunk) {
    const hash = hashMeshes(meshes);
    const cached = cache.get(chunk);
    if (cached && cached.hash === hash) {
      models.push(cached.model);
      continue;
    }
    const materials = materialsFor(meshes, kit);
    // noclip caches models globally by MDL0 name, so the name carries a content hash: it changes exactly
    // when the chunk's meshes do, and a cached (unchanged) chunk keeps its name and revision.
    const modelName = `preview_${chunk.replace(/[^A-Za-z0-9_]/g, '_')}_${hashBytes(new TextEncoder().encode(hash)).slice(0, 8)}`;
    const brres = buildModelBrres({ modelName, meshes, materials, copyAnimations: true });
    const model: CreatePreviewModel = { key: chunk, revision: (cached?.model.revision ?? 0) + 1, brres, modelName };
    cache.set(chunk, { hash, model });
    models.push(model);
  }
  models.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return models;
}
