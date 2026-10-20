/**
 * Project file migration: turns whatever was stored (older version, hand-edited JSON, partial data)
 * into a valid current `CreateProject`.
 */
import {
  CREATE_PROJECT_VERSION,
  type CreateProject,
  type GenerationOptions,
  type Road,
  type RoadSection,
  type TerrainSettings,
  type TrackSettings,
} from '../types';
import { createId } from '../ids';
import { normalizeSections } from './sections';

export const DEFAULT_SETTINGS: TrackSettings = {
  laps: 3,
  polePosition: 'left',
  narrowStart: false,
  speedFactor: 1,
  lensFlare: true,
  flareColor: [255, 255, 255, 75],
};

export const DEFAULT_TERRAIN: TerrainSettings = {
  enabled: true,
  baseHeight: 0,
  margin: 5000,
  cellSize: 400,
  surface: { slot: 'ground' },
  boundary: 'wall',
};

export const DEFAULT_GENERATION: GenerationOptions = {
  checkpointSpacing: 5000,
  keyCheckpoints: 5,
  enemySpacing: 3500,
  itemSpacing: 3300,
  respawnEvery: 4,
  cameras: true,
  lockedKmpSections: [],
};

export class ProjectMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectMigrationError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function vec(v: unknown, fallback: { x: number; y: number; z: number }) {
  if (!isObject(v)) return { ...fallback };
  return { x: num(v.x, fallback.x), y: num(v.y, fallback.y), z: num(v.z, fallback.z) };
}

/**
 * Accepts parsed JSON of any known project version and returns a current project. Throws a
 * `ProjectMigrationError` when it is not a Create project at all, or comes from a newer editor.
 */
export function migrateProject(input: unknown): CreateProject {
  if (!isObject(input)) throw new ProjectMigrationError('This file is not a track design.');
  const version = num(input.version, 1);
  if (version > CREATE_PROJECT_VERSION) {
    throw new ProjectMigrationError('This design was made with a newer version of the editor and cannot be opened here.');
  }
  // Version 1 is current; future migrations chain here (v1 -> v2 -> ...).
  const roads: Road[] = Array.isArray(input.roads)
    ? input.roads.filter(isObject).map((r) => {
        const points = Array.isArray(r.points)
          ? r.points.filter(isObject).map((p) => ({
              id: typeof p.id === 'string' ? p.id : createId('pt'),
              position: vec(p.position, { x: 0, y: 0, z: 0 }),
              width: Math.max(200, num(p.width, 3600)),
              bank: Math.max(-80, Math.min(80, num(p.bank, 0))),
              corner: p.corner === 'sharp' ? ('sharp' as const) : ('smooth' as const),
            }))
          : [];
        const road: Road = {
          id: typeof r.id === 'string' ? r.id : createId('road'),
          name: typeof r.name === 'string' ? r.name : 'Road',
          closed: r.closed === true && points.length >= 3,
          points,
          styleId: typeof r.styleId === 'string' ? r.styleId : 'circuit',
          sections: Array.isArray(r.sections) ? (r.sections.filter(isObject) as unknown as RoadSection[]) : [],
        };
        if (isObject(r.branch)) road.branch = r.branch as unknown as Road['branch'];
        return normalizeSections(road);
      })
    : [];
  const settings = { ...DEFAULT_SETTINGS, ...(isObject(input.settings) ? (input.settings as Partial<TrackSettings>) : {}) };
  const terrain = { ...DEFAULT_TERRAIN, ...(isObject(input.terrain) ? (input.terrain as Partial<TerrainSettings>) : {}) };
  const generation = { ...DEFAULT_GENERATION, ...(isObject(input.generation) ? (input.generation as Partial<GenerationOptions>) : {}) };
  const start = isObject(input.start) ? input.start : {};
  const now = Date.now();
  const project: CreateProject = {
    version: CREATE_PROJECT_VERSION,
    id: typeof input.id === 'string' ? input.id : createId('project'),
    name: typeof input.name === 'string' ? input.name : 'My track',
    createdAt: num(input.createdAt, now),
    updatedAt: num(input.updatedAt, now),
    themeId: typeof input.themeId === 'string' ? input.themeId : '',
    settings,
    roads,
    start: {
      roadId: typeof start.roadId === 'string' ? start.roadId : (roads[0]?.id ?? ''),
      param: num(start.param, 0),
    },
    terrain,
    terrainStrokes: Array.isArray(input.terrainStrokes) ? (input.terrainStrokes as CreateProject['terrainStrokes']) : [],
    pieces: Array.isArray(input.pieces) ? (input.pieces as CreateProject['pieces']) : [],
    props: Array.isArray(input.props) ? (input.props as CreateProject['props']) : [],
    generation,
  };
  if (isObject(input.compiledHashes)) project.compiledHashes = input.compiledHashes as Record<string, string>;
  if (project.start.roadId && !roads.some((r) => r.id === project.start.roadId)) {
    project.start = { roadId: roads[0]?.id ?? '', param: 0 };
  }
  return project;
}
