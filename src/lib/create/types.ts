/**
 * Create mode — the contract.
 *
 * Create mode is a "Mario Maker for Mario Kart Wii": the user designs a track out of high-level
 * pieces (a road drawn as a spline, sections along it, terrain paint, gameplay pieces, scenery)
 * and the editor compiles that design into a complete, playable course archive
 * (`course_model.brres`, `course.kcl`, `course.kmp`, `map_model.brres`, `vrcorn_model.brres`,
 * `posteffect/*`).
 *
 * The design (`CreateProject`) is the source of truth. Everything in the archive is derived from
 * it by `compileProject`. The project is plain JSON so it can live in the undo history, in
 * IndexedDB and in a downloadable project file.
 *
 * Layering (see docs/CREATE.md for the full brief and file ownership):
 *
 *   src/lib/create/types.ts            this file — shared by every workstream, owned by the lead
 *   src/lib/create/writers/**          MDL0/BRRES + KCL + minimap writers        (workstream A)
 *   src/lib/create/kit/**, scripts/build-create-kit.mjs, public/data/MarioKartWii/Create/**
 *                                       the asset kit extracted from retail tracks (workstream B)
 *   src/lib/create/{spline,road,terrain,pieces,props,kmpGen,compile,ops,templates,analyze}*.ts
 *                                       design → geometry/KMP → archive            (workstream C)
 *   src/ui/Noclip3DViewport.tsx + vendored scene: the `createView` viewport prop (workstream D)
 *   src/ui/create/**                    the Create mode UI                          (workstream E)
 *
 * Units are Mario Kart Wii world units (a kart is roughly 150 units long). +Y is up. Positions use
 * the same `Vec3` (`{x, y, z}`) as `kmpFile.ts`.
 */

import type { Vec3 } from '../kmpFile';

export type { Vec3 };

export interface Vec2 {
  x: number;
  z: number;
}

/** Current `CreateProject.version`. Bump and add a migration in `ops/migrate.ts` on any schema change. */
export const CREATE_PROJECT_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The design document
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface CreateProject {
  version: typeof CREATE_PROJECT_VERSION;
  /** Stable id (random), also the IndexedDB key. */
  id: string;
  name: string;
  /** `Date.now()` stamps. */
  createdAt: number;
  updatedAt: number;
  /** `KitTheme.id`. Switching theme re-skins every slot-based surface (Mario Maker "game style"). */
  themeId: string;
  settings: TrackSettings;
  /** `roads[0]` is the main circuit. Additional roads are branches/shortcuts (see `RoadBranch`). */
  roads: Road[];
  /** Where the race starts and laps are counted. Anchored to a road. */
  start: StartLine;
  terrain: TerrainSettings;
  /** Paint and sculpt strokes applied to the terrain, in order. Vector data, rasterised at compile. */
  terrainStrokes: TerrainStroke[];
  /** Gameplay pieces attached to a road (boost panels, ramps, item boxes, hazards). */
  pieces: Piece[];
  /** Free-standing objects placed on the terrain (scenery, hazards that are not road-attached). */
  props: Prop[];
  generation: GenerationOptions;
  /**
   * Bookkeeping for the bridge between the design and the compiled track document, so the UI can
   * tell when a generated file was hand-edited in another mode. Keyed by archive path.
   */
  compiledHashes?: Record<string, string>;
}

export interface TrackSettings {
  /** 1..9 (retail limit). */
  laps: number;
  polePosition: 'left' | 'right';
  narrowStart: boolean;
  /** Global speed factor written to STGI. 1 = normal. */
  speedFactor: number;
  lensFlare: boolean;
  /** RGBA 0..255. */
  flareColor: [number, number, number, number];
}

/**
 * A position along a road, as a spline parameter: `u = i + t` means `t` (0..1) of the way from
 * control point `i` to control point `i + 1` (wrapping to 0 on a closed road). Anchoring to
 * control points rather than to a distance keeps sections and pieces where the user put them
 * when an unrelated part of the road is reshaped. `ops` remaps parameters when points are
 * inserted or deleted.
 */
export type RoadParam = number;

export interface Road {
  id: string;
  name: string;
  /** Closed loop (a circuit). The main road must be closed for a valid race track. */
  closed: boolean;
  points: RoadPoint[];
  /** Default cross-section style for the whole road (`RoadStyle.id`). */
  styleId: string;
  /**
   * Sections tile the road: `sections[k]` runs from `sections[k].start` to `sections[k + 1].start`
   * (the last one runs to the end of the road, or around to `sections[0].start` when closed).
   * Always at least one section, `sections[0].start === 0`, sorted by `start`.
   */
  sections: RoadSection[];
  /** Set on a branch/shortcut road: where it leaves and rejoins another road. */
  branch?: RoadBranch;
}

export interface RoadBranch {
  fromRoadId: string;
  fromParam: RoadParam;
  toRoadId: string;
  toParam: RoadParam;
}

export interface RoadPoint {
  id: string;
  /** Centre of the drivable surface, world space. */
  position: Vec3;
  /** Width of the drivable surface (excluding curbs/shoulders), in units. */
  width: number;
  /** Roll in degrees around the driving direction. Positive tilts the right edge down. */
  bank: number;
  /** `smooth` = Catmull-Rom through the point; `sharp` = a corner (tangent discontinuity). */
  corner: 'smooth' | 'sharp';
}

export type SectionKind =
  /** Road surface on solid ground (or on an embankment when raised). */
  | 'road'
  /** Road deck with an underside and no terrain beneath; falling off = fall boundary. */
  | 'bridge'
  /** No surface at all — a gap to jump. The road before it should end in a ramp. */
  | 'gap'
  /** Road with walls and a ceiling. */
  | 'tunnel';

export type EdgeWall = 'none' | 'barrier' | 'wall' | 'fence' | 'invisible';

export interface RoadEdge {
  /** Red/white style curb strip next to the road. */
  curb: boolean;
  /** Off-road strip beyond the curb (`SurfaceRef`), or `null` for none. */
  shoulder: SurfaceRef | null;
  /** Width of the shoulder strip. */
  shoulderWidth: number;
  wall: EdgeWall;
  wallHeight: number;
}

export interface RoadSection {
  id: string;
  start: RoadParam;
  kind: SectionKind;
  /** Overrides on top of the road's `RoadStyle`. `undefined` = inherit. */
  surface?: SurfaceRef;
  left?: Partial<RoadEdge>;
  right?: Partial<RoadEdge>;
  /** Optional user label shown in the outliner. */
  label?: string;
}

/**
 * Surfaces are referenced either by theme slot (re-skins when the theme changes — the default)
 * or by an explicit kit surface id (stays the same in every theme).
 */
export type SurfaceRef = { slot: SurfaceSlot } | { surfaceId: string };

/**
 * The semantic surface slots every theme fills. A theme maps each slot to a `KitSurface`.
 * Keep this list short and meaningful — it is what the user sees in the palette.
 */
export type SurfaceSlot =
  | 'road'
  | 'roadAlt'
  | 'curb'
  | 'shoulder'
  | 'ground'
  | 'groundAlt'
  | 'wall'
  | 'barrier'
  | 'fence'
  | 'cliff'
  | 'underside'
  | 'sand'
  | 'mud'
  | 'ice'
  | 'water'
  | 'lava'
  | 'boost'
  | 'startLine';

export interface StartLine {
  roadId: string;
  param: RoadParam;
}

export interface TerrainSettings {
  /** `false` = no ground at all (a sky track: falling off anywhere is a fall boundary). */
  enabled: boolean;
  /** World Y of the flat ground before sculpting. */
  baseHeight: number;
  /** Ground extends this far beyond the bounds of everything placed. */
  margin: number;
  /** Grid cell size used to rasterise paint/sculpt. */
  cellSize: number;
  surface: SurfaceRef;
  /** What happens at the edge of the world. */
  boundary: 'wall' | 'fall';
}

export type TerrainStroke = PaintStroke | SculptStroke;

export interface PaintStroke {
  id: string;
  kind: 'paint';
  /** `null` = erase back to the terrain's base surface. */
  surface: SurfaceRef | null;
  radius: number;
  /** Polyline of brush centres (a single point = a stamp). */
  points: Vec2[];
}

export interface SculptStroke {
  id: string;
  kind: 'sculpt';
  mode: 'raise' | 'lower' | 'flatten' | 'smooth';
  radius: number;
  /** Units per stamp at the brush centre (falls off smoothly to 0 at `radius`). */
  strength: number;
  /** Target height for `flatten`. */
  targetHeight?: number;
  points: Vec2[];
}

export type PieceKind =
  /** Flat dash panel on the road surface. KCL boost panel. */
  | 'boostPanel'
  /** Ramp that boosts and launches. KCL boost ramp. */
  | 'boostRamp'
  /** Trick ramp (trickable road). */
  | 'trickRamp'
  /** A row of item boxes across the road. */
  | 'itemRow'
  /** A road-attached hazard or object (Goomba, Thwomp, ...), by ObjFlow object id. */
  | 'object';

export interface Piece {
  id: string;
  kind: PieceKind;
  roadId: string;
  param: RoadParam;
  /** Lateral position: -1 = left edge of the drivable surface, 0 = centre, +1 = right edge. */
  lateral: number;
  /** Width across the road, in units (panels, ramps) — ignored for `object`. */
  width: number;
  /** Length along the road, in units (panels, ramps). */
  length: number;
  /** Ramp height at its tip (ramps only). */
  height?: number;
  /** `itemRow`: number of boxes. */
  count?: number;
  /** `object`: ObjFlow object id. */
  objectId?: number;
  /** `object`: the eight GOBJ setting words; defaults come from the object's profile. */
  settings?: number[];
}

export interface Prop {
  id: string;
  /** ObjFlow object id placed as a GOBJ. */
  objectId: number;
  position: Vec3;
  /** Degrees. */
  rotation: Vec3;
  scale: Vec3;
  settings?: number[];
  /** Snap to the ground under it at compile time (true for everything the brush scatters). */
  snapToGround: boolean;
}

export interface GenerationOptions {
  /** Distance between generated checkpoints along the road. */
  checkpointSpacing: number;
  /** Number of key checkpoints (excluding the lap line) spread around the lap. */
  keyCheckpoints: number;
  /** Distance between generated CPU (enemy) route points. */
  enemySpacing: number;
  /** Distance between generated item route points. */
  itemSpacing: number;
  /** One respawn point every this many checkpoints. */
  respawnEvery: number;
  /** Generate the opening fly-by and goal cameras. */
  cameras: boolean;
  /** Sections of the generated KMP that the user hand-edited elsewhere and wants kept as-is. */
  lockedKmpSections: KmpSectionKey[];
}

export type KmpSectionKey =
  | 'startPoints'
  | 'enemy'
  | 'item'
  | 'checkpoints'
  | 'objects'
  | 'routes'
  | 'areas'
  | 'cameras'
  | 'respawnPoints'
  | 'stage';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Road styles (defined in code by workstream C, `roadStyles.ts`)
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface RoadStyle {
  id: string;
  label: string;
  description: string;
  surface: SurfaceRef;
  left: RoadEdge;
  right: RoadEdge;
  /** Surface for the vertical sides of a raised road / embankment. */
  skirt: SurfaceRef;
  /** Surface under a bridge deck. */
  underside: SurfaceRef;
  /** Curb strip width when an edge has `curb: true`. */
  curbWidth: number;
  /** Default width for new points on a road with this style. */
  defaultWidth: number;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The asset kit (workstream B) — extracted from the retail game
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Where the kit lives in the deployed site (relative to BASE_URL). */
export const CREATE_KIT_PATH = 'data/MarioKartWii/Create/create-kit.szs';

export type SurfaceCategory =
  | 'road'
  | 'offroad'
  | 'curb'
  | 'wall'
  | 'ground'
  | 'water'
  | 'lava'
  | 'boost'
  | 'decal'
  | 'underside'
  | 'ice';

/** The parsed `kit.json` inside the kit archive. */
export interface CreateKitCatalog {
  version: 1;
  generatedAt: string;
  surfaces: KitSurface[];
  themes: KitTheme[];
  /** Minimap material source (a retail `map_model.brres` reduced to its material + textures). */
  minimap: { swatch: string; materialName: string };
  /** Hand-picked scenery for the Scenery palette, per theme (ObjFlow ids). */
  scenery: KitSceneryEntry[];
}

export interface KitSurface {
  /** Stable id, e.g. `luigi.asphalt`. */
  id: string;
  label: string;
  category: SurfaceCategory;
  /** Path inside the kit archive of the swatch `.brres`: one MDL0 holding this material (+ TEX0, PLT0, SRT0/PAT0 if animated). */
  swatch: string;
  modelName: string;
  materialName: string;
  /** World units covered by one UV repeat, [along, across], measured from the retail geometry. */
  textureWorldSize: [number, number];
  /** Default KCL flag (full u16: type | variant << 5 | ...). See `kclFlag()` in `writers/kclFlags.ts`. */
  kclFlag: number;
  /** Drawn in the translucent list. */
  translucent: boolean;
  /** Track the material came from, for credits/tooltips (e.g. `beginner_course`). */
  sourceTrack: string;
  /** Path inside the kit archive of a small PNG preview (64×64), for palette tiles. */
  thumbnail: string;
  /** Whether the material reads vertex colour (so the writer must supply colour 0). */
  usesVertexColor: boolean;
  /**
   * `tile` (default): world-space tiling, u along the road, v across (v grows downward on
   * vertical faces). `decal`: one image stretched over the piece (u = lateral 0..1,
   * v = 1 - along/length), e.g. the boost arrow.
   */
  uvMode?: 'tile' | 'decal';
  /** Has SRT0/PAT0 animations (compile with `copyAnimations: true`). */
  animated?: boolean;
}

export interface KitTheme {
  id: string;
  label: string;
  description: string;
  /** Retail track the theme's sky, lighting and post effects come from. */
  donorTrack: string;
  /** Slot → `KitSurface.id`. Every `SurfaceSlot` must be present. */
  slots: Record<SurfaceSlot, string>;
  /** Archive files copied verbatim into the compiled track: archive path → kit archive path. */
  files: Record<string, string>;
  /** Path inside the kit archive of a preview image (sky/landscape screenshot, ~320×180 PNG). */
  preview: string;
  /** CSS gradient for UI cards when the preview has not loaded. */
  accent: [string, string];
  /** Default `RoadStyle.id` for new roads in this theme. */
  defaultRoadStyle: string;
  /** Default terrain on/off for this theme (e.g. a sky theme starts with no ground). */
  terrain: boolean;
  /** Donor start-grid height: ground/road base Y so the design sits inside the sky dome. */
  baseHeight?: number;
}

export interface KitSceneryEntry {
  objectId: number;
  label: string;
  themeIds: string[];
  /** Default scale and the spacing the scatter brush should use. */
  scale: number;
  spacing: number;
}

/** The loaded kit: catalog plus lazy access to the archive's files. */
export interface CreateKit {
  catalog: CreateKitCatalog;
  /** Bytes of a file inside the kit archive (`swatch`, `thumbnail`, theme files). */
  file(path: string): Uint8Array | null;
  surface(id: string): KitSurface | null;
  theme(id: string): KitTheme | null;
  /** Resolve a `SurfaceRef` in a theme (falls back to the first theme's slot when missing). */
  resolveSurface(ref: SurfaceRef, themeId: string): KitSurface;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Generated geometry (workstream C produces, workstream A consumes)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** One draw call worth of generated triangles, in one material. */
export interface GeneratedMesh {
  /** Unique within a model; becomes the shape name. */
  name: string;
  /** `KitSurface.id` (already resolved — no slots here). */
  surfaceId: string;
  /** xyz per vertex. */
  positions: Float32Array;
  /** xyz per vertex, unit length. */
  normals: Float32Array;
  /** uv per vertex (world-space tiling already applied). */
  uvs: Float32Array;
  /** rgba per vertex, 0..255 (baked lighting / ambient occlusion). White when unused. */
  colors: Uint8Array;
  /**
   * Triangle list. Winding: the face normal `(b − a) × (c − a)` points to the visible / solid
   * side (the writers flip triangles that disagree with the vertex normals, and `buildKcl` treats
   * that side as solid), so road tops must wind upward.
   */
  indices: Uint32Array;
  /** Draw priority byte (retail uses it to order decals over the surface below). Default 0. */
  drawPriority?: number;
  /**
   * Preview chunk this mesh belongs to (e.g. `road:<id>`, `terrain`, `pieces`). The UI builds
   * one preview model per chunk so dragging one road only rebuilds that road.
   */
  chunk: string;
}

/** Collision triangles, flat arrays. */
export interface GeneratedCollision {
  /** xyz per vertex. */
  positions: Float32Array;
  /** Triangle list. */
  indices: Uint32Array;
  /** One full u16 KCL flag per triangle. */
  flags: Uint16Array;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Writers (workstream A) — signatures implemented in src/lib/create/writers/
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Where a generated mesh's material comes from: a swatch BRRES holding that material. */
export interface MaterialSource {
  /** Must equal `GeneratedMesh.surfaceId`. */
  surfaceId: string;
  brres: Uint8Array;
  modelName: string;
  materialName: string;
  translucent: boolean;
}

export interface ModelBuildInput {
  /** MDL0 name (`course` for course_model.brres, `map` for map_model.brres, anything for previews). */
  modelName: string;
  meshes: GeneratedMesh[];
  materials: MaterialSource[];
  /** Copy SRT0/PAT0 animations that target the copied materials (scrolling water, boost panels). */
  copyAnimations: boolean;
}

/** `writers/modelWriter.ts`: build a complete `.brres` (MDL0 v11 + TEX0/PLT0 [+ SRT0/PAT0]) from scratch. */
export type BuildModelBrres = (input: ModelBuildInput) => Uint8Array;

export interface KclBuildOptions {
  /** Prism thickness written to the header. Default: the retail value. */
  prismThickness?: number;
  /** Max triangles per octree leaf before subdividing. */
  maxTrianglesPerLeaf?: number;
  /** Smallest octree cube edge. */
  minCubeSize?: number;
}

/** `writers/kclWriter.ts`: build `course.kcl` (with octree) from triangles + flags. */
export type BuildKcl = (collision: GeneratedCollision, options?: KclBuildOptions) => Uint8Array;

export interface MinimapBuildInput {
  /** Flat (top-down) outline meshes of the drivable area; Y is ignored. */
  meshes: GeneratedMesh[];
  material: MaterialSource;
}

/** `writers/minimapWriter.ts`: build `map_model.brres` the game's minimap accepts. */
export type BuildMinimapBrres = (input: MinimapBuildInput) => Uint8Array;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Compile (workstream C)
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface CompileWriters {
  buildModelBrres: BuildModelBrres;
  buildKcl: BuildKcl;
  buildMinimapBrres: BuildMinimapBrres;
}

export type CreateIssueLevel = 'error' | 'warning' | 'info';

/** A problem with the design, phrased for the user. */
export interface CreateIssue {
  level: CreateIssueLevel;
  code: string;
  /** One short sentence, no jargon ("The road does not form a loop yet."). */
  message: string;
  /** What the user can do about it ("Click the first point to close it."). */
  fix?: string;
  /** What to select/frame when the user clicks "Show me". */
  target?: CreateSelection;
}

/** The geometry half of a compile — cheap enough to run on every drag frame. */
export interface CompiledGeometry {
  meshes: GeneratedMesh[];
  collision: GeneratedCollision;
  /** Flat outline meshes for the minimap. */
  minimap: GeneratedMesh[];
  /** Axis-aligned bounds of everything generated. */
  bounds: { min: Vec3; max: Vec3 };
  /**
   * `project.props` with every `snapToGround` prop dropped onto the ground this geometry actually has
   * (derived; the design is not touched). Present when the design has such props. The KMP and the
   * viewport's prop handles should use these positions rather than `project.props`.
   */
  snappedProps?: Prop[];
}

export interface CompileResult {
  geometry: CompiledGeometry;
  /** The generated KMP (structured; write with `writeKmpFile`). */
  kmp: import('../kmpFile').KmpFile;
  /** Archive path → bytes, ready for `buildU8`. Includes theme files and every generated file. */
  files: Map<string, Uint8Array>;
  issues: CreateIssue[];
  stats: CompileStats;
}

export interface CompileStats {
  roadLength: number;
  triangles: number;
  collisionTriangles: number;
  checkpoints: number;
  itemBoxes: number;
  objects: number;
  millis: number;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Selection (shared by C's analysis "Show me" targets and E's UI)
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type CreateSelection =
  | { kind: 'road'; roadId: string }
  | { kind: 'point'; roadId: string; pointId: string }
  | { kind: 'section'; roadId: string; sectionId: string }
  | { kind: 'piece'; pieceId: string }
  | { kind: 'prop'; propId: string }
  | { kind: 'start' }
  | { kind: 'stroke'; strokeId: string };

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The viewport bridge (workstream D implements in Noclip3DViewport, workstream E feeds it)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** RGBA, each 0..1. */
export type OverlayColor = [number, number, number, number];

export interface CreateOverlayPoint {
  /** Pickable handles report this id back in `CreatePointerEvent.handleId`. */
  id: string;
  position: Vec3;
  color: OverlayColor;
  /** Screen-space radius in CSS pixels. */
  radius: number;
  pickable: boolean;
  /** Draws a ring around the point. */
  ring?: boolean;
  label?: string;
}

export interface CreateOverlayLine {
  points: Vec3[];
  color: OverlayColor;
  /** Closes the polyline. */
  closed?: boolean;
  /** Dashed rendering (e.g. spline centre line, rubber band). */
  dashed?: boolean;
  /** Draw on top of geometry (ignore depth). Default true. */
  onTop?: boolean;
}

export interface CreateOverlayTriangles {
  /** xyz per vertex, triangle list (no indices). */
  positions: Float32Array;
  color: OverlayColor;
}

export interface CreateOverlayLabel {
  position: Vec3;
  text: string;
}

export interface CreateOverlay {
  points: CreateOverlayPoint[];
  lines: CreateOverlayLine[];
  /** Translucent fills: selected-section tint, brush footprint, piece ghost. */
  triangles: CreateOverlayTriangles[];
  labels: CreateOverlayLabel[];
}

/** A generated model shown live in the viewport instead of (or as well as) the course model. */
export interface CreatePreviewModel {
  /** Stable per chunk (`road:<id>`, `terrain`...). */
  key: string;
  /*
   * NOTE: noclip caches MDL0s globally by name, so `modelName` must be unique per chunk and
   * revision (e.g. `preview-road-<id>-<rev>`), never `course`.
   */
  /** Bumped whenever `brres` changes; the viewport reloads the chunk when it differs. */
  revision: number;
  brres: Uint8Array;
  modelName: string;
}

export interface CreateRay {
  origin: Vec3;
  direction: Vec3;
}

export interface CreateHit {
  position: Vec3;
  normal: Vec3;
  distance: number;
}

export interface CreatePointerEvent {
  phase: 'down' | 'move' | 'up' | 'hover' | 'leave' | 'cancel';
  /** 0 left, 1 middle, 2 right. `hover`/`leave` report 0. */
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  /** CSS pixels relative to the canvas. */
  screen: { x: number; y: number };
  ray: CreateRay;
  /** `createView.raycast(ray)` if given and it hit, else the ray against the plane `y = groundPlaneY`. */
  hit: CreateHit | null;
  /** The pickable overlay point under the cursor (screen-space test), if any. */
  handleId: string | null;
}

/**
 * `consumed` = Create mode handled it; for a `down`, the viewport captures the pointer and keeps
 * sending `move` until `up`/`cancel`, with no camera motion, no pointer lock and no selection.
 * `pass` = let the viewport do its normal camera/selection handling.
 */
export type CreatePointerResult = 'consumed' | 'pass';

/** Options for `CreateCameraApi.frameBounds`. */
export interface CreateFrameOptions {
  /** Angle below the horizon the camera looks down at: 0 level, 90 straight down. Default: keep the current pitch. */
  pitchDegrees?: number;
  /** Compass heading of the look direction, clockwise from north: 0 looks towards -Z, 90 towards +X. Default: keep the current heading. */
  yawDegrees?: number;
  /** How much of the canvas (its limiting dimension) the box fills, 0..1. Default 0.85. */
  fill?: number;
  /** `false` jumps there instead of gliding. Default true. */
  animate?: boolean;
}

export interface CreateCameraApi {
  /**
   * Frame an AABB. In 3D the camera glides (or jumps with `animate: false`) to a spot that fits the
   * box at `fill`, looking along the given pitch / yaw. The top view only uses `fill` (as its
   * margin); it is always straight down and north-up.
   */
  frameBounds(min: Vec3, max: Vec3, options?: CreateFrameOptions): void;
  /** Switch between the free 3D camera and a top-down orthographic planning view. */
  setTopView(enabled: boolean): void;
  isTopView(): boolean;
  /**
   * True once the scene for the current track is built. The viewport places its own default camera
   * at that moment, so a frame requested earlier is overwritten: wait for this before the first one.
   */
  isSceneReady(): boolean;
  /** Current eye position and forward direction. */
  getPose(): { eye: Vec3; forward: Vec3 };
  /** Project a world point to CSS pixels on the canvas (null when behind the camera). */
  project(point: Vec3): { x: number; y: number } | null;
  /**
   * The world ray under a canvas point (CSS pixels relative to the canvas), e.g. for HTML5
   * drag-and-drop from the palette, which produces no pointer events on the canvas.
   */
  screenToRay(x: number, y: number): CreateRay;
  /** The canvas element's bounding rect, to convert client coordinates. */
  canvasRect(): DOMRect | null;
}

/** The `createView` prop on `Noclip3DViewport`. When set, the viewport is in Create mode. */
export interface CreateViewProps {
  /** Hide the track's own `course_model` draw calls; the preview models replace them. */
  hideCourseModel: boolean;
  models: CreatePreviewModel[];
  overlay: CreateOverlay;
  /** Ground the pointer is raycast against (the design's own collision, kept up to date by E). */
  raycast?: (ray: CreateRay) => CreateHit | null;
  /** Fallback plane when `raycast` misses. */
  groundPlaneY: number;
  onPointer?: (event: CreatePointerEvent) => CreatePointerResult;
  /** CSS cursor while hovering the canvas. */
  cursor?: string;
  /** Show the generated KMP overlays (checkpoints, routes) read-only. */
  showRaceLines: boolean;
  /** Receives the camera API once the viewport is ready. */
  cameraApiRef?: { current: CreateCameraApi | null };
}
