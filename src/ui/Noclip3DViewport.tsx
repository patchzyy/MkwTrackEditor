import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type MutableRefObject, type PointerEvent, type ReactNode } from 'react';
import { Eye, EyeOff, Move3D, RotateCcw, Scale3D } from 'lucide-react';
import { mat4, vec3, vec4 } from 'gl-matrix';
import ArrayBufferSlice from '../../vendor/noclip.website/src/ArrayBufferSlice';
import { CameraUpdateResult, FPSCameraController, OrthoCameraController, type Camera, type CameraController } from '../../vendor/noclip.website/src/Camera';
import { DataShare } from '../../vendor/noclip.website/src/DataShare';
import type { DataFetcher } from '../../vendor/noclip.website/src/DataFetcher';
import { getMatrixAxisY } from '../../vendor/noclip.website/src/MathHelpers';
import type { Destroyable, SceneContext } from '../../vendor/noclip.website/src/SceneBase';
import { InitErrorCode, initializeViewerWebGL2, resizeCanvas, type SceneGfx, type Viewer } from '../../vendor/noclip.website/src/viewer';
import { createSceneFromU8Buffer } from '../../vendor/noclip.website/src/rres/scenes';
import { buildPublicAssetUrl } from '../lib/assetPaths';
import {
  meshTransformFromGizmoPose,
  syncBrresViewportTransformSelectionPreview,
  toMeshViewportTransformSelection,
  type BrresViewportPreviewScene,
  type EditorMeshBoundsPayload,
  type EditorMeshPickPayload,
  type EditorMeshRendererScene,
  type ViewportTransformSelection,
} from '../lib/brresRenderAdapter';
import { buildU8 } from '../lib/u8';
import type { AppendableKmpSection, KmpDocument, KmpEntity, KmpRouteInsertTarget, Vec3 } from '../lib/kmp';
import { raycastDown, raycastMesh, snapPointToTriangleFeature } from '../lib/kcl';
import type { TrackDocument } from '../lib/track';
import { describeEntity } from '../lib/track';
import {
  createIdentityMeshTransform,
  meshTargetKey,
  narrowMeshGranularity,
  retargetMeshGranularity,
  widenMeshGranularity,
  type EditorMeshTarget,
  type ImportedMesh,
  type MeshEdit,
  type MeshSelectionGranularity,
  type MeshTransform,
} from '../lib/brresEditor';
import {
  buildOpeningCameraChain,
  eulerFromLookDirection,
  getOpeningSequenceDuration,
  sampleCameraPose,
  sampleOpeningSequence,
  type CameraPreviewDef,
} from '../lib/cameraPreview';
import {
  buildCameraOverlay,
  findCameraPreviewDef,
  toCameraPreviewDefs,
  type SceneOverlayCameraChainLink,
  type SceneOverlayCameraGizmo,
} from './viewport/cameraOverlay';
import { advancePreviewFrames, computePreviewCameraMatrix, toCameraFovY } from './viewport/cameraPlayback';
import {
  KMP_VISIBILITY_KEYS,
  createVisibilityState,
  pathGroupColorRgb,
  sectionForEntityId,
  type KmpVisibilityKey,
  type KmpVisibilityState,
} from './kmp/kmpSections';
import {
  applyMeshSelectionClick,
  describeMeshPick,
  makeMeshSelectionEntry,
  meshSelectionGizmoId,
  meshSelectionKeyFromGizmoId,
  toMeshTarget,
  updateMeshSelectionTransform,
  type MeshSelectionEntry,
} from './viewport/meshSelection';

interface Noclip3DViewportProps {
  track: TrackDocument | null;
  selectedId: string | null;
  selectedIds: string[];
  transformSelection?: ViewportTransformSelection | null;
  transformSelections?: ViewportTransformSelection[];
  showKmpEditorOverlay?: boolean;
  /**
   * Which editor mode the app is in. `'kmp'` keeps today's behaviour.
   * `'camera'` turns on the CAME gizmos and their picking; `'model'` turns on mesh
   * picking/transforming and hides the KMP overlays; `'visual'` hides the KMP overlays.
   */
  mode?: EditorMode;
  /** Drives the in-viewport CAME playback. `null` restores the free camera. */
  cameraPreview?: CameraPreviewRequest | null;
  onCameraPreviewEnd?: () => void;
  /** Reports the playback clock every rendered frame. Written into a ref, never into state. */
  onCameraPreviewProgress?: (progress: CameraPreviewProgress) => void;
  /** Fired when a CAME view-point handle is dragged in the viewport. */
  onMoveCameraViewPoint?: (entity: KmpEntity, which: 'start' | 'end', position: Vec3) => void;
  /**
   * Camera mode: filled in with a small imperative API for the free camera and for picking the
   * point under the middle of the viewport. Cleared when the viewport unmounts.
   */
  cameraViewportApiRef?: MutableRefObject<CameraViewportApi | null>;
  /** Model mode: how much geometry one click selects. Uncontrolled by default. */
  meshGranularity?: MeshSelectionGranularity;
  /** Model mode: mesh edits to re-apply to the renderer when the scene (re)loads. */
  meshEdits?: MeshEdit[];
  /** Model mode: objects placed as course geometry, rendered as extra model instances. */
  importedMeshes?: ImportedMesh[];
  /** Resolves the BRRES bytes behind an imported mesh's `sourcePath`. */
  resolveImportedMeshSource?: (sourcePath: string) => Uint8Array | null;
  /**
   * Model mode: the selection, when the app drives it (from the outliner). Leave it undefined and
   * the viewport keeps its own; clicks in the viewport report through `onSelectMesh` either way.
   */
  meshSelection?: EditorMeshTarget[];
  onSelectMesh?: (target: EditorMeshTarget | null, options?: { additive?: boolean; targets?: EditorMeshTarget[] }) => void;
  onTransformMesh?: (target: EditorMeshTarget, transform: MeshTransform) => void;
  onChangeMeshGranularity?: (granularity: MeshSelectionGranularity) => void;
  fillBetweenPreviewPositions?: Vec3[];
  smokeCommonUrl?: string | null;
  commonArchiveUrl?: string | null;
  tool: TransformTool;
  viewMode: ViewMode;
  collisionVisible: boolean;
  onChangeTool?: (tool: TransformTool) => void;
  onChangeViewMode?: (mode: ViewMode) => void;
  onChangeCollisionVisible?: (visible: boolean) => void;
  topRightOverlay?: ReactNode;
  getEntityLabel?: (entity: KmpEntity) => string;
  onSelect: (id: string | null, options?: { additive?: boolean }) => void;
  onSelectMany?: (ids: string[], options?: { additive?: boolean }) => void;
  onMoveEntity: (entity: KmpEntity, position: Vec3) => void;
  onRotateEntity?: (entity: KmpEntity, rotation: Vec3) => void;
  onScaleEntity?: (entity: KmpEntity, scale: Vec3) => void;
  onSelectTransformSelection?: (id: string | null) => void;
  onMoveTransformSelection?: (selection: ViewportTransformSelection, position: Vec3) => void;
  onRotateTransformSelection?: (selection: ViewportTransformSelection, rotation: Vec3) => void;
  onScaleTransformSelection?: (selection: ViewportTransformSelection, scale: Vec3) => void;
  onMoveCheckpointEndpoint?: (entity: KmpEntity, side: 'left' | 'right', position: Vec3) => void;
  onAddObject?: (objectId: number, position: Vec3) => void;
  onAddKmpPoint?: (section: AppendableKmpSection, position: Vec3) => void;
  onInsertRoutePoint?: (target: KmpRouteInsertTarget, position: Vec3) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;

  // --- KMP mode ---------------------------------------------------------------
  /**
   * Controlled per-layer visibility. When set, the viewport's own eye panel and the KMP
   * outliner show the same state; when omitted the viewport keeps its own.
   */
  sectionVisibility?: Partial<KmpVisibilityState>;
  onChangeSectionVisibility?: (key: KmpVisibilityKey, visible: boolean) => void;
  /** Colours path points, segments and route lines by their group index. */
  pathGroupColors?: boolean;
  /** Draws the quad between consecutive checkpoints, so the driving corridor is visible. */
  showCheckpointQuads?: boolean;
  /**
   * When set, the start/end handles of that path type's groups are drawn and can be dragged
   * onto each other to connect two groups.
   */
  pathLinkSection?: PathLinkSection | null;
  onLinkPathGroups?: (section: PathLinkSection, from: number, to: number) => void;
  onUnlinkPathGroups?: (section: PathLinkSection, from: number, to: number) => void;
  /** `'checkpoint'` turns a plain left-drag across the track into a new checkpoint. */
  drawTool?: DrawTool;
  onDrawCheckpoint?: (start: Vec3, end: Vec3) => void;
  /** Called when the user finishes a draw gesture, so the shell can leave draw mode. */
  onDrawToolFinished?: () => void;
  /** Entity to frame the camera on. Bump `token` to re-frame the same entity. */
  frameRequest?: { entityId: string; token: number } | null;
}

export type PathLinkSection = 'ENPT' | 'ITPT' | 'CKPT';
export type DrawTool = 'none' | 'checkpoint';

export type TransformTool = 'translate' | 'rotate' | 'scale';
export type ViewMode = 'normal' | 'dev' | 'topdown' | 'ortho';
export type EditorMode = 'kmp' | 'camera' | 'model' | 'visual';
export interface CameraPreviewRequest {
  /** CAME entity id (`CAME-<n>`) or the raw CAME index. */
  cameraId: string;
  playing: boolean;
  /** Playback position in MKW frames (60 fps). */
  time: number;
  /** Play the whole opening chain starting at this camera instead of just this one. */
  sequence?: boolean;
  /**
   * Bump this to restart the playback clock at `time` without leaving preview mode. Used for
   * scrubbing while playing, for the replay button and for looping.
   */
  seek?: number;
}

/** Where the playback clock is, reported once per rendered frame. */
export interface CameraPreviewProgress {
  /** Playback position within the whole preview (a single shot, or the whole chain). */
  frames: number;
  /** The camera currently on screen. */
  cameraIndex: number;
  /** Playback position within that camera's own shot. */
  localFrames: number;
  /** How long the whole preview runs for; `0` when it has no fixed length. */
  totalFrames: number;
}

/** Free-camera and viewport-picking helpers the camera inspector needs. */
export interface CameraViewportApi {
  /** The free camera's eye, a point 2000 units ahead of it, and the matching KMP rotation. */
  getFreeCameraPose(): { position: Vec3; target: Vec3; rotation: Vec3 } | null;
  /** Puts the free camera at `position` looking at `target` (KMP units). */
  lookFrom(position: Vec3, target: Vec3): boolean;
  /** Pulls the free camera back so a camera marker and its sight line are both in view. */
  frameCamera(position: Vec3, target: Vec3): boolean;
  /** The collision (or ground-plane) point under the middle of the viewport, in KMP units. */
  pickCenterPoint(): Vec3 | null;
}
export type { ViewportTransformSelection } from '../lib/brresRenderAdapter';
export type { MeshSelectionGranularity, EditorMeshTarget } from '../lib/brresEditor';

type GizmoAxis = 'x' | 'y' | 'z';
type GizmoPlane = 'xy' | 'xz' | 'yz';

interface SceneOverlayPoint {
  id: string;
  section: string;
  position: Vec3;
  markerText?: string;
  specialColor?: 'bulletBillCantStop';
  /** Per-point RGB override (0..1); used to colour path points by their group. */
  color?: [number, number, number];
  /** Marker radius override, for handles that must read larger than a point. */
  radius?: number;
  selected: boolean;
  hovered: boolean;
  invalid: boolean;
}

interface SceneOverlayLine {
  id: string;
  section: string;
  routeKey?: string;
  color?: [number, number, number];
  alpha?: number;
  a: Vec3;
  b: Vec3;
}

interface SceneOverlayAxis {
  ownerId: string;
  axis: GizmoAxis;
  a: Vec3;
  b: Vec3;
  hovered: boolean;
  active: boolean;
}

interface SceneOverlayPlane {
  ownerId: string;
  plane: GizmoPlane;
  a: Vec3;
  b: Vec3;
  c: Vec3;
  d: Vec3;
  hovered: boolean;
  active: boolean;
}

interface SceneOverlayCenterHandle {
  ownerId: string;
  position: Vec3;
  hovered: boolean;
  active: boolean;
}

interface SceneOverlayCheckpointEndpoint {
  id: string;
  side: 'left' | 'right';
  position: Vec3;
}

interface SceneOverlayCollisionTriangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  typeIndex: number;
}

interface SceneOverlayCheckpointWall {
  id: string;
  left: Vec3;
  right: Vec3;
  topY: number;
  selected: boolean;
  invalid: boolean;
}

interface SceneOverlayAreaVolume {
  id: string;
  shape: number;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  selected: boolean;
  hovered: boolean;
  invalid: boolean;
}

interface SceneOverlayStartSlot {
  ownerId: string;
  slotIndex: number;
  position: Vec3;
  rotation: Vec3;
  selected: boolean;
  hovered: boolean;
}

interface SceneOverlayFillBetweenPreview {
  position: Vec3;
  index: number;
}

interface SceneOverlayRouteDeviationSegment {
  id: string;
  /** `ENPT`/`ITPT` for the route corridor, `CKPT` for the quad between two checkpoints. */
  section: string;
  color?: [number, number, number];
  aLeft: Vec3;
  aRight: Vec3;
  bLeft: Vec3;
  bRight: Vec3;
  selected: boolean;
  hovered: boolean;
}

interface SceneOverlayRouteDeviationCap {
  id: string;
  section: string;
  color?: [number, number, number];
  position: Vec3;
  radius: number;
  selected: boolean;
  hovered: boolean;
}

interface SceneOverlayData {
  tool: TransformTool;
  points: SceneOverlayPoint[];
  lines: SceneOverlayLine[];
  centerHandle: SceneOverlayCenterHandle | null;
  axes: SceneOverlayAxis[];
  planes: SceneOverlayPlane[];
  checkpointEndpoints: SceneOverlayCheckpointEndpoint[];
  collisionTriangles: SceneOverlayCollisionTriangle[];
  checkpointWalls: SceneOverlayCheckpointWall[];
  areaVolumes: SceneOverlayAreaVolume[];
  startSlots: SceneOverlayStartSlot[];
  fillBetweenPreview: SceneOverlayFillBetweenPreview[];
  routeDeviationSegments: SceneOverlayRouteDeviationSegment[];
  routeDeviationCaps: SceneOverlayRouteDeviationCap[];
  cameraGizmos: SceneOverlayCameraGizmo[];
  cameraChainLinks: SceneOverlayCameraChainLink[];
}

/** Extra KMP-mode overlay content: group colouring, checkpoint quads and the two drag modes. */
interface KmpOverlayOptions {
  pathGroupColors?: boolean;
  showCheckpointQuads?: boolean;
  pathLinkSection?: PathLinkSection | null;
  pathLinkDrag?: PathLinkDragState | null;
  checkpointDraw?: CheckpointDrawState | null;
}

interface RouteInsertPreview {
  position: Vec3;
  target: KmpRouteInsertTarget;
}

interface RouteInsertCandidate {
  position: Vec3;
  target: KmpRouteInsertTarget;
}

type SceneOverlayPick =
  | { kind: 'point'; id: string }
  | { kind: 'center'; id: string }
  | { kind: 'plane'; id: string; plane: GizmoPlane }
  | { kind: 'axis'; id: string; axis: GizmoAxis }
  | { kind: 'checkpointEndpoint'; id: string; side: 'left' | 'right' }
  | { kind: 'cameraViewPoint'; id: string; which: 'start' | 'end' };

type GizmoHandleKey =
  | { kind: 'center'; id: string }
  | { kind: 'plane'; id: string; plane: GizmoPlane }
  | { kind: 'axis'; id: string; axis: GizmoAxis };

interface EntityTransformPreview {
  id: string;
  position: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
}

interface TransformSelectionTarget {
  kind: 'kmp' | 'external';
  selection: ViewportTransformSelection;
  entity?: KmpEntity;
}

interface CameraFrame {
  eye: vec3;
  target: vec3;
}

interface TrackViewBounds {
  center: vec3;
  radius: number;
}

const CAMERA_WORLD_UP = vec3.fromValues(0, 1, 0);

interface DragState {
  kind: 'entity';
  id: string;
  startX: number;
  startY: number;
  rotation?: Vec3;
  scale?: Vec3;
}

interface LinearGizmoDragState {
  kind: 'gizmo';
  mode: 'linear';
  id: string;
  axis: GizmoAxis;
  position: Vec3;
  axisOrigin: Vec3;
  axisDirection: Vec3;
  planePoint: Vec3;
  planeNormal: Vec3;
  startAxisOffset: number;
  rotation?: Vec3;
  scale?: Vec3;
}

interface AngularGizmoDragState {
  kind: 'gizmo';
  mode: 'angular';
  id: string;
  axis: GizmoAxis;
  center: Vec3;
  planeNormal: Vec3;
  angleBasisX: Vec3;
  angleBasisY: Vec3;
  startAngle: number;
  rotation: Vec3;
}

interface PlanarGizmoDragState {
  kind: 'gizmo';
  mode: 'planar';
  id: string;
  position: Vec3;
  planePoint: Vec3;
  planeNormal: Vec3;
  startHit: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
}

interface UniformScaleGizmoDragState {
  kind: 'gizmo';
  mode: 'uniformScale';
  id: string;
  center: Vec3;
  planeNormal: Vec3;
  startHit: Vec3;
  startRadius: number;
  scale: Vec3;
}

interface PlanarScaleGizmoDragState {
  kind: 'gizmo';
  mode: 'planarScale';
  id: string;
  plane: GizmoPlane;
  center: Vec3;
  planePoint: Vec3;
  planeNormal: Vec3;
  startU: number;
  startV: number;
  scale: Vec3;
}

type GizmoDragState = LinearGizmoDragState | AngularGizmoDragState | PlanarGizmoDragState | UniformScaleGizmoDragState | PlanarScaleGizmoDragState;

interface CheckpointDragState {
  kind: 'checkpointEndpoint';
  id: string;
  side: 'left' | 'right';
}

interface CameraViewPointDragState {
  kind: 'cameraViewPoint';
  id: string;
  which: 'start' | 'end';
}

type ActiveDragState = DragState | GizmoDragState | CheckpointDragState | CameraViewPointDragState;

interface CameraLookDragState {
  lastClientX: number;
  lastClientY: number;
  pointerId: number;
  pointerLocked: boolean;
  skipNextDelta: boolean;
}

interface PendingEntityDragState {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  additive: boolean;
}

type PendingInteractionCommit =
  | { kind: 'moveEntity'; entity: KmpEntity; position: Vec3 }
  | { kind: 'rotateEntity'; entity: KmpEntity; rotation: Vec3 }
  | { kind: 'scaleEntity'; entity: KmpEntity; scale: Vec3 }
  | { kind: 'moveTransformSelection'; selection: ViewportTransformSelection; position: Vec3 }
  | { kind: 'rotateTransformSelection'; selection: ViewportTransformSelection; rotation: Vec3 }
  | { kind: 'scaleTransformSelection'; selection: ViewportTransformSelection; scale: Vec3 }
  | { kind: 'moveCheckpointEndpoint'; entity: KmpEntity; side: 'left' | 'right'; position: Vec3 }
  | { kind: 'moveCameraViewPoint'; entity: KmpEntity; which: 'start' | 'end'; position: Vec3 }
  | { kind: 'transformMesh'; target: EditorMeshTarget; transform: MeshTransform };

interface MarqueeSelectionState {
  additive: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface RouteVisibilityItem {
  key: RouteVisibilityKey;
  label: string;
}

/** In-progress drag from one path group's end handle towards another group's start handle. */
interface PathLinkDragState {
  section: PathLinkSection;
  fromGroup: number;
  /** `'end'` drags forwards (from -> to); `'start'` drags backwards (to -> from). */
  fromSide: 'start' | 'end';
  anchor: Vec3;
  cursor: Vec3;
  hoverGroup: number | null;
}

/** In-progress "draw a checkpoint across the track" gesture. */
interface CheckpointDrawState {
  start: Vec3;
  current: Vec3;
}

/** Overlay id prefix for the group connection handles; never a real KMP entity id. */
const PATH_LINK_HANDLE_PREFIX = '__path-link__';

function pathLinkHandleId(section: PathLinkSection, groupIndex: number, side: 'start' | 'end'): string {
  return `${PATH_LINK_HANDLE_PREFIX}${section}:${groupIndex}:${side}`;
}

function parsePathLinkHandleId(id: string): { section: PathLinkSection; groupIndex: number; side: 'start' | 'end' } | null {
  if (!id.startsWith(PATH_LINK_HANDLE_PREFIX)) return null;
  const [section, rawGroup, side] = id.slice(PATH_LINK_HANDLE_PREFIX.length).split(':');
  const groupIndex = Number(rawGroup);
  if (!Number.isInteger(groupIndex) || (side !== 'start' && side !== 'end')) return null;
  if (section !== 'ENPT' && section !== 'ITPT' && section !== 'CKPT') return null;
  return { section, groupIndex, side };
}

/** The KMP outliner and the viewport share one vocabulary of visibility layers. */
type RouteVisibilityKey = KmpVisibilityKey;
type DofMode = 'full' | 'reduced' | 'off';

const MKW_RENDER_SCALE = 0.1;
const ENTITY_DRAG_START_THRESHOLD_PX = 4;
const MAX_CAMERA_LOOK_DELTA_PX = 240;
const ROUTE_INSERT_SNAP_MAX_DISTANCE = 900;
/** Shorter drags than this are treated as a mis-click rather than a new checkpoint. */
const MIN_CHECKPOINT_DRAW_WIDTH = 200;
/** Numpad view shortcuts, matching the habit of every other 3D editor. */
const NUMPAD_VIEW_MODES: Record<string, ViewMode | undefined> = {
  Numpad1: 'normal',
  Numpad5: 'ortho',
  Numpad7: 'topdown',
  Numpad0: 'dev',
};
const CAMERA_MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE', 'PageUp', 'PageDown', 'Space', 'KeyC', 'ControlLeft', 'ControlRight'] as const;
const startSlotPixelCenterX = 59;
const startSlotWidePixelWidth = 50;
const startSlotWidePixelDepth = 256;
const startSlotNarrowPixelDepth = 229;
const startSlotPixelOffsets = [
  { x: 19.5, y: 14.5 },
  { x: 51.5, y: 32.5 },
  { x: 83.5, y: 50.5 },
  { x: 35.5, y: 88.5 },
  { x: 67.5, y: 106.5 },
  { x: 99.5, y: 125.5 },
  { x: 19.5, y: 159.5 },
  { x: 51.5, y: 177.5 },
  { x: 83.5, y: 195.5 },
  { x: 35.5, y: 233.5 },
  { x: 67.5, y: 251.5 },
  { x: 99.5, y: 270.5 },
] as const;

function isAdditiveSelectionModifier(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey;
}

function isCollisionSnapModifier(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.ctrlKey || event.metaKey;
}

function getTrackViewBounds(track: TrackDocument): TrackViewBounds | null {
  const min = vec3.fromValues(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const max = vec3.fromValues(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

  const expand = (point: { x: number; y: number; z: number }) => {
    min[0] = Math.min(min[0], point.x);
    min[1] = Math.min(min[1], point.y);
    min[2] = Math.min(min[2], point.z);
    max[0] = Math.max(max[0], point.x);
    max[1] = Math.max(max[1], point.y);
    max[2] = Math.max(max[2], point.z);
  };

  for (const triangle of track.kcl?.triangles ?? []) {
    expand(triangle.a);
    expand(triangle.b);
    expand(triangle.c);
  }
  for (const entity of track.kmp?.entities ?? []) expand(entity.position);

  if (!Number.isFinite(min[0]) || !Number.isFinite(max[0])) return null;

  const center = vec3.fromValues(
    ((min[0] + max[0]) * 0.5) * MKW_RENDER_SCALE,
    ((min[1] + max[1]) * 0.5) * MKW_RENDER_SCALE,
    ((min[2] + max[2]) * 0.5) * MKW_RENDER_SCALE,
  );
  const spanX = (max[0] - min[0]) * MKW_RENDER_SCALE;
  const spanY = (max[1] - min[1]) * MKW_RENDER_SCALE;
  const spanZ = (max[2] - min[2]) * MKW_RENDER_SCALE;
  const radius = Math.max(240, Math.hypot(spanX, spanZ) * 0.65, spanY * 1.1);

  return { center, radius };
}

function getInitialCameraFrame(track: TrackDocument): CameraFrame {
  const bounds = getTrackViewBounds(track);
  if (!bounds) {
    return {
      eye: vec3.fromValues(0, 900, 2200),
      target: vec3.fromValues(0, 0, 0),
    };
  }

  return {
    eye: vec3.fromValues(bounds.center[0] + bounds.radius * 0.55, bounds.center[1] + bounds.radius * 0.45, bounds.center[2] + bounds.radius * 1.35),
    target: bounds.center,
  };
}

/**
 * Camera controller used while a CAME preview is playing: it ignores all input so the
 * fly controls cannot fight the scripted camera. The previous controller is restored
 * when the preview stops.
 */
class PreviewCameraController implements CameraController {
  public camera!: Camera;
  public forceUpdate = false;
  private dirty = true;

  public cameraUpdateForced(): void {
    this.dirty = true;
  }

  public update(): CameraUpdateResult {
    if (!this.dirty) return CameraUpdateResult.Unchanged;
    this.dirty = false;
    return CameraUpdateResult.Changed;
  }

  public setSceneMoveSpeedMult(): void {
  }

  public getKeyMoveSpeed(): number | null {
    return null;
  }

  public setKeyMoveSpeed(): void {
  }
}

function applyFPSCameraFrame(controller: FPSCameraController, frame: CameraFrame) {
  const camera = controller.camera;
  if (!camera) return;
  mat4.targetTo(camera.worldMatrix, frame.eye, frame.target, CAMERA_WORLD_UP);
  vec3.zero(camera.linearVelocity);
  camera.worldMatrixUpdated();
  controller.cameraUpdateForced();
  controller.forceUpdate = true;
}

export function Noclip3DViewport({
  track,
  selectedId,
  selectedIds,
  transformSelection = null,
  transformSelections = [],
  showKmpEditorOverlay = true,
  mode = 'kmp',
  cameraPreview = null,
  onCameraPreviewEnd,
  onCameraPreviewProgress,
  onMoveCameraViewPoint,
  cameraViewportApiRef,
  meshGranularity,
  meshEdits,
  importedMeshes,
  resolveImportedMeshSource,
  meshSelection,
  onSelectMesh,
  onTransformMesh,
  onChangeMeshGranularity,
  fillBetweenPreviewPositions = [],
  smokeCommonUrl = null,
  commonArchiveUrl = null,
  tool,
  viewMode,
  collisionVisible,
  onChangeTool,
  onChangeViewMode,
  onChangeCollisionVisible,
  topRightOverlay,
  getEntityLabel = describeEntity,
  onSelect,
  onSelectMany,
  onMoveEntity,
  onRotateEntity,
  onScaleEntity,
  onSelectTransformSelection,
  onMoveTransformSelection,
  onRotateTransformSelection,
  onScaleTransformSelection,
  onMoveCheckpointEndpoint,
  onAddObject,
  onAddKmpPoint,
  onInsertRoutePoint,
  onInteractionStart,
  onInteractionEnd,
  sectionVisibility,
  onChangeSectionVisibility,
  pathGroupColors = false,
  showCheckpointQuads = false,
  pathLinkSection = null,
  onLinkPathGroups,
  onUnlinkPathGroups,
  drawTool = 'none',
  onDrawCheckpoint,
  onDrawToolFinished,
  frameRequest = null,
}: Noclip3DViewportProps) {
  const smokeMode = typeof window !== 'undefined' && new URL(window.location.href).searchParams.has('smokeTrack');
  const smokeAddObjectId =
    typeof window !== 'undefined'
      ? (() => {
          const value = new URL(window.location.href).searchParams.get('smokeAddObject');
          const parsed = value ? Number(value) : NaN;
          return Number.isFinite(parsed) ? parsed : null;
        })()
      : null;
  const viewportRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uiContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const sceneRef = useRef<SceneGfx | null>(null);
  const destroyablePoolRef = useRef<Destroyable[]>([]);
  const frameRef = useRef<number | null>(null);
  const interactionCommitFrameRef = useRef<number | null>(null);
  const pendingInteractionCommitRef = useRef<PendingInteractionCommit | null>(null);
  const smokeProbeFrameRef = useRef(0);
  const smokePlacementDoneRef = useRef(false);
  const smokePlacementUsedCollisionRef = useRef(false);
  const smokeMouseLookDoneRef = useRef(false);
  const smokeViewportSampleRef = useRef<'pending' | 'blank' | 'nonblank'>('pending');
  const trackRef = useRef<TrackDocument | null>(null);
  const collisionVisibleRef = useRef(collisionVisible);
  const selectedIdRef = useRef<string | null>(selectedId);
  const selectedIdsRef = useRef<string[]>(selectedIds);
  const toolRef = useRef<TransformTool>(tool);
  const viewModeRef = useRef<ViewMode>(viewMode);
  const routeVisibilityRef = useRef<Record<RouteVisibilityKey, boolean>>(createVisibilityState(true));
  const hoveredIdRef = useRef<string | null>(null);
  const hoveredHandleRef = useRef<GizmoHandleKey | null>(null);
  const activeHandleRef = useRef<GizmoHandleKey | null>(null);
  const overlayCameraPositionRef = useRef<Vec3 | null>(null);
  const draggingEntityRef = useRef<ActiveDragState | null>(null);
  const pendingEntityDragRef = useRef<PendingEntityDragState | null>(null);
  const cameraLookDragRef = useRef<CameraLookDragState | null>(null);
  const [status, setStatus] = useState('Drop a Mario Kart Wii .szs track anywhere in the editor');
  const [viewerReady, setViewerReady] = useState(false);
  const [smokeViewportSample, setSmokeViewportSample] = useState<'pending' | 'blank' | 'nonblank'>('pending');
  const [smokeSelectedGobjRendered, setSmokeSelectedGobjRendered] = useState<'pending' | 'yes' | 'no'>('pending');
  const [smokeSelectedGobjSnapped, setSmokeSelectedGobjSnapped] = useState<'pending' | 'yes' | 'no'>('pending');
  const [smokeMouseLookWorked, setSmokeMouseLookWorked] = useState<'pending' | 'yes' | 'no'>('pending');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredHandle, setHoveredHandle] = useState<GizmoHandleKey | null>(null);
  const [previewTransform, setPreviewTransform] = useState<EntityTransformPreview | null>(null);
  const [routeInsertPreview, setRouteInsertPreview] = useState<RouteInsertPreview | null>(null);
  const [routePanelOpen, setRoutePanelOpen] = useState(false);
  const [dofMode, setDofMode] = useState<DofMode>('off');
  const [internalRouteVisibility, setInternalRouteVisibility] = useState<Record<RouteVisibilityKey, boolean>>(createVisibilityState(true));
  // A stable signature so the controlled object identity does not re-run the overlay effect.
  const controlledVisibilitySignature = sectionVisibility
    ? KMP_VISIBILITY_KEYS.map((key) => (sectionVisibility[key] === false ? '0' : '1')).join('')
    : null;
  const routeVisibility = useMemo<Record<RouteVisibilityKey, boolean>>(
    () => {
      if (controlledVisibilitySignature === null) return internalRouteVisibility;
      const state = createVisibilityState(true);
      for (const key of KMP_VISIBILITY_KEYS) if (sectionVisibility?.[key] === false) state[key] = false;
      return state;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controlledVisibilitySignature, internalRouteVisibility],
  );
  /** Single entry point for a layer toggle, so controlled and uncontrolled behave the same. */
  function setLayerVisible(key: RouteVisibilityKey, visible: boolean) {
    if (onChangeSectionVisibility) onChangeSectionVisibility(key, visible);
    else setInternalRouteVisibility((current) => ({ ...current, [key]: visible }));
  }
  const [pathLinkDrag, setPathLinkDrag] = useState<PathLinkDragState | null>(null);
  const pathLinkDragRef = useRef<PathLinkDragState | null>(null);
  const [checkpointDraw, setCheckpointDraw] = useState<CheckpointDrawState | null>(null);
  const checkpointDrawRef = useRef<CheckpointDrawState | null>(null);
  const [marqueeSelection, setMarqueeSelection] = useState<MarqueeSelectionState | null>(null);
  const marqueeSelectionRef = useRef<MarqueeSelectionState | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number; snapToFeatures: boolean; altKey: boolean } | null>(null);
  const suppressNextClickRef = useRef(false);
  const onMoveEntityRef = useRef(onMoveEntity);
  const onRotateEntityRef = useRef(onRotateEntity);
  const onScaleEntityRef = useRef(onScaleEntity);
  const transformSelectionRef = useRef<ViewportTransformSelection | null>(transformSelection);
  const transformSelectionsRef = useRef<ViewportTransformSelection[]>(transformSelections);
  const showKmpEditorOverlayRef = useRef(showKmpEditorOverlay);
  const onSelectTransformSelectionRef = useRef(onSelectTransformSelection);
  const onMoveTransformSelectionRef = useRef(onMoveTransformSelection);
  const onRotateTransformSelectionRef = useRef(onRotateTransformSelection);
  const onScaleTransformSelectionRef = useRef(onScaleTransformSelection);
  const onMoveCheckpointEndpointRef = useRef(onMoveCheckpointEndpoint);
  const onMoveCameraViewPointRef = useRef(onMoveCameraViewPoint);
  const onSelectMeshRef = useRef(onSelectMesh);
  const onTransformMeshRef = useRef(onTransformMesh);
  const onChangeMeshGranularityRef = useRef(onChangeMeshGranularity);
  const onCameraPreviewEndRef = useRef(onCameraPreviewEnd);
  const modeRef = useRef<EditorMode>(mode);
  /** Dev-hook override so `window.__mkwViewport.setMode` survives re-renders. */
  const devModeOverrideRef = useRef<EditorMode | null>(null);
  const devCaptureRef = useRef<{ request: boolean; dataUrl: string | null }>({ request: false, dataUrl: null });
  const [internalMeshGranularity, setInternalMeshGranularity] = useState<MeshSelectionGranularity>('component');
  const activeMeshGranularity = meshGranularity ?? internalMeshGranularity;
  const meshGranularityRef = useRef<MeshSelectionGranularity>(activeMeshGranularity);
  const [meshSelections, setMeshSelections] = useState<MeshSelectionEntry[]>([]);
  const meshSelectionsRef = useRef<MeshSelectionEntry[]>(meshSelections);
  const [hoveredMeshKey, setHoveredMeshKey] = useState<string | null>(null);
  const hoveredMeshRef = useRef<{ key: string; target: EditorMeshTarget } | null>(null);
  /** Mesh edits currently pushed into the renderer, so they can be lifted when they go away. */
  const appliedMeshEditsRef = useRef<Map<string, EditorMeshTarget>>(new Map());
  /** Meshes that currently have duplicates in the renderer, so they can be cleared. */
  const appliedMeshCopiesRef = useRef<Map<string, EditorMeshTarget>>(new Map());
  /** Placed-object id to the renderer instance standing in for it. */
  const importedMeshInstancesRef = useRef<Map<string, { instanceId: string; signature: string }>>(new Map());
  const resolveImportedMeshSourceRef = useRef(resolveImportedMeshSource);
  const cameraPreviewRef = useRef<CameraPreviewRequest | null>(cameraPreview);
  /** Dev-hook override so `window.__mkwViewport.previewCamera` survives re-renders. */
  const devCameraPreviewRef = useRef<CameraPreviewRequest | null | undefined>(undefined);
  const cameraPreviewStateRef = useRef<{
    frames: number;
    lastTimeMs: number | null;
    savedCameraMatrix: mat4 | null;
    savedFovY: number | null;
    active: boolean;
    sequence: ReturnType<typeof buildOpeningCameraChain> | null;
    startIndex: number;
    seek: number | undefined;
  }>({ frames: 0, lastTimeMs: null, savedCameraMatrix: null, savedFovY: null, active: false, sequence: null, startIndex: 0, seek: undefined });
  const onCameraPreviewProgressRef = useRef(onCameraPreviewProgress);
  const cameraPreviewMatrixRef = useRef(mat4.create());
  const cameraPreviewDefsRef = useRef<CameraPreviewDef[]>([]);
  const previousCameraControllerRef = useRef<CameraController | null>(null);
  const cameraPreviewLabelRef = useRef<string | null>(null);
  const [cameraPreviewLabel, setCameraPreviewLabel] = useState<string | null>(null);
  const selected = track?.kmp?.entities.find((entity) => entity.id === selectedId) ?? null;
  const selectionHudLabel = transformSelection?.label ?? (selected ? getEntityLabel(selected) : null);
  const sceneKey = track ? getSceneKey(track) : null;
  const gobjSignature = track ? getGobjSignature(track) : 'nogobj';
  const routeItems = track ? getRouteVisibilityItems(track) : [];
  trackRef.current = track;
  collisionVisibleRef.current = collisionVisible;
  selectedIdRef.current = selectedId;
  selectedIdsRef.current = selectedIds;
  toolRef.current = tool;
  viewModeRef.current = viewMode;
  routeVisibilityRef.current = routeVisibility;
  pathLinkDragRef.current = pathLinkDrag;
  checkpointDrawRef.current = checkpointDraw;
  hoveredIdRef.current = hoveredId;
  hoveredHandleRef.current = hoveredHandle;
  onMoveEntityRef.current = onMoveEntity;
  onRotateEntityRef.current = onRotateEntity;
  onScaleEntityRef.current = onScaleEntity;
  transformSelectionRef.current = transformSelection;
  transformSelectionsRef.current = transformSelections;
  showKmpEditorOverlayRef.current = showKmpEditorOverlay;
  onSelectTransformSelectionRef.current = onSelectTransformSelection;
  onMoveTransformSelectionRef.current = onMoveTransformSelection;
  onRotateTransformSelectionRef.current = onRotateTransformSelection;
  onScaleTransformSelectionRef.current = onScaleTransformSelection;
  onMoveCheckpointEndpointRef.current = onMoveCheckpointEndpoint;
  onMoveCameraViewPointRef.current = onMoveCameraViewPoint;
  onSelectMeshRef.current = onSelectMesh;
  resolveImportedMeshSourceRef.current = resolveImportedMeshSource;
  onTransformMeshRef.current = onTransformMesh;
  onChangeMeshGranularityRef.current = onChangeMeshGranularity;
  onCameraPreviewEndRef.current = onCameraPreviewEnd;
  onCameraPreviewProgressRef.current = onCameraPreviewProgress;
  modeRef.current = devModeOverrideRef.current ?? mode;
  meshGranularityRef.current = activeMeshGranularity;
  meshSelectionsRef.current = meshSelections;
  cameraPreviewRef.current = devCameraPreviewRef.current !== undefined ? devCameraPreviewRef.current : cameraPreview;
  cameraPreviewDefsRef.current = track?.kmp ? toCameraPreviewDefs(track.kmp) : [];

  useEffect(() => {
    const canvas: HTMLCanvasElement | null = canvasRef.current;
    const viewport: HTMLElement | null = viewportRef.current;
    if (!canvas || !viewport) return;
    const canvasElement: HTMLCanvasElement = canvas;
    const viewportElement: HTMLElement = viewport;
    let cancelled = false;

    async function bootViewer() {
      const result = await initializeViewerWebGL2(canvasElement);
      if (cancelled) return;
      if (result.error !== InitErrorCode.SUCCESS || !result.viewer) {
        setStatus('WebGL2 is unavailable; noclip renderer cannot start in this browser.');
        return;
      }
      const viewer: Viewer = result.viewer;
      viewerRef.current = viewer;
      setViewerReady(true);
      const resizeObserver = new ResizeObserver(() => resizeToDisplay());
      resizeObserver.observe(viewportElement);
      resizeToDisplay();
      setViewportCameraLookActive(false);
      const tick = (time: number) => {
        stepCameraPreview(time);
        const restoreSuppressedKeys = withSuppressedCameraMovementKeys(viewer);
        viewer.update({ time, webXRContext: null });
        restoreSuppressedKeys();
        if (import.meta.env.DEV && devCaptureRef.current.request) {
          try {
            devCaptureRef.current = { request: false, dataUrl: canvasElement.toDataURL('image/png') };
          } catch {
            devCaptureRef.current = { request: false, dataUrl: null };
          }
        }
        const cameraPosition = getViewerCameraPosition(viewer);
        if (selectedIdRef.current && hasCameraPositionChanged(cameraPosition, overlayCameraPositionRef.current)) {
          overlayCameraPositionRef.current = cameraPosition;
          syncSceneOverlay(trackRef.current, selectedIdRef.current);
        } else if (!selectedIdRef.current) {
          overlayCameraPositionRef.current = cameraPosition;
        }
        if (smokeMode && smokeViewportSampleRef.current !== 'nonblank' && smokeProbeFrameRef.current++ % 12 === 0) {
          const sample = sampleViewportState(canvasElement);
          if (sample && sample !== smokeViewportSampleRef.current) {
            smokeViewportSampleRef.current = sample;
            setSmokeViewportSample(sample);
          }
        }
        if (smokeMode && selectedIdRef.current?.startsWith('GOBJ-')) {
          const scene = sceneRef.current as (SceneGfx & { hasEditorGobjIndex?: (index: number) => boolean }) | null;
          const match = /^GOBJ-(\d+)$/.exec(selectedIdRef.current);
          const selectedIndex = match ? Number(match[1]) : -1;
          const rendered = selectedIndex >= 0 && scene?.hasEditorGobjIndex ? scene.hasEditorGobjIndex(selectedIndex) : false;
          setSmokeSelectedGobjRendered(rendered ? 'yes' : 'no');
          setSmokeSelectedGobjSnapped(smokePlacementUsedCollisionRef.current ? 'yes' : 'no');
        }
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);

      return () => resizeObserver.disconnect();
    }

    let cleanupResize: (() => void) | undefined;
    void bootViewer().then((cleanup) => {
      cleanupResize = cleanup;
    });

    function resizeToDisplay() {
      const rect = viewportElement.getBoundingClientRect();
      resizeCanvas(canvasElement, Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)), window.devicePixelRatio || 1);
    }

    return () => {
      cancelled = true;
      setViewportCameraLookActive(false);
      flushPendingInteractionCommit();
      cleanupResize?.();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      const viewer = viewerRef.current;
      if (viewer) {
        sceneRef.current?.destroy(viewer.gfxDevice);
        for (const item of destroyablePoolRef.current) item.destroy(viewer.gfxDevice);
      }
      sceneRef.current = null;
      viewerRef.current = null;
      destroyablePoolRef.current = [];
      setViewerReady(false);
    };
  }, []);

  useEffect(() => {
    const handleBlur = () => releaseCameraLook();
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('blur', handleBlur);
      releaseCameraLook();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleNativePointerDown = (event: globalThis.PointerEvent) => {
      if (event.button !== 2 || draggingEntityRef.current || !supportsMouseLook(viewModeRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      canvas.focus();
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {}
      cameraLookDragRef.current = {
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        pointerId: event.pointerId,
        pointerLocked: document.pointerLockElement === canvas,
        skipNextDelta: false,
      };
      setViewportCameraLookActive(true);
      if (viewerRef.current) viewerRef.current.inputManager.buttons = event.buttons;
      try {
        canvas.requestPointerLock?.();
      } catch {}
    };

    const handleNativePointerMove = (event: globalThis.PointerEvent) => {
      const cameraLook = cameraLookDragRef.current;
      if (!cameraLook || event.pointerId !== cameraLook.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const viewer = viewerRef.current;
      if (!viewer) return;
      const pointerLocked = document.pointerLockElement === canvas;
      if (cameraLook.skipNextDelta || cameraLook.pointerLocked !== pointerLocked) {
        cameraLookDragRef.current = {
          lastClientX: event.clientX,
          lastClientY: event.clientY,
          pointerId: event.pointerId,
          pointerLocked,
          skipNextDelta: false,
        };
        return;
      }
      const dx = pointerLocked ? event.movementX : event.clientX - cameraLook.lastClientX;
      const dy = pointerLocked ? event.movementY : event.clientY - cameraLook.lastClientY;
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > MAX_CAMERA_LOOK_DELTA_PX || Math.abs(dy) > MAX_CAMERA_LOOK_DELTA_PX) {
        cameraLookDragRef.current = {
          lastClientX: event.clientX,
          lastClientY: event.clientY,
          pointerId: event.pointerId,
          pointerLocked,
          skipNextDelta: false,
        };
        return;
      }
      viewer.inputManager.buttons = event.buttons || 2;
      applyDirectCameraLook(viewer, dx, dy);
      cameraLookDragRef.current = {
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        pointerId: event.pointerId,
        pointerLocked,
        skipNextDelta: false,
      };
    };

    const handleNativePointerRelease = (event: globalThis.PointerEvent) => {
      const cameraLook = cameraLookDragRef.current;
      if (!cameraLook || event.pointerId !== cameraLook.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      releaseCameraLook(canvas);
    };

    const handleNativeContextMenu = (event: globalThis.MouseEvent) => {
      event.preventDefault();
    };

    const handlePointerLockChange = () => {
      const cameraLook = cameraLookDragRef.current;
      if (!cameraLook) return;
      cameraLookDragRef.current = {
        ...cameraLook,
        pointerLocked: document.pointerLockElement === canvas,
        skipNextDelta: true,
      };
    };

    canvas.addEventListener('pointerdown', handleNativePointerDown);
    canvas.addEventListener('pointermove', handleNativePointerMove);
    canvas.addEventListener('pointerup', handleNativePointerRelease);
    canvas.addEventListener('pointercancel', handleNativePointerRelease);
    canvas.addEventListener('contextmenu', handleNativeContextMenu);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    return () => {
      canvas.removeEventListener('pointerdown', handleNativePointerDown);
      canvas.removeEventListener('pointermove', handleNativePointerMove);
      canvas.removeEventListener('pointerup', handleNativePointerRelease);
      canvas.removeEventListener('pointercancel', handleNativePointerRelease);
      canvas.removeEventListener('contextmenu', handleNativeContextMenu);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    const uiContainer = uiContainerRef.current;
    if (!viewerReady || !viewer || !uiContainer) return;
    const sceneTrack = trackRef.current;
    if (!sceneTrack) {
      setStatus('Drop a Mario Kart Wii .szs track anywhere in the editor');
      viewer.setScene(null);
      return;
    }

    let cancelled = false;
    const sceneViewer: Viewer = viewer;
    const sceneUiContainer: HTMLElement = uiContainer;
    const loadingTrack: TrackDocument = sceneTrack;
    async function loadScene() {
      try {
        setStatus('Loading track in noclip Mario Kart Wii renderer...');
        sceneRef.current?.destroy(sceneViewer.gfxDevice);
        for (const item of destroyablePoolRef.current) item.destroy(sceneViewer.gfxDevice);
        destroyablePoolRef.current = [];

        const archiveBytes = buildU8(loadingTrack.archiveEntries);
        const dataShare = new DataShare();
        const dataFetcher = makeLocalDataFetcher(commonArchiveUrl ?? smokeCommonUrl);
        const context: SceneContext = {
          device: sceneViewer.gfxDevice,
          dataFetcher,
          dataShare,
          uiContainer: sceneUiContainer,
          destroyablePool: destroyablePoolRef.current,
          inputManager: sceneViewer.inputManager,
          viewerInput: sceneViewer.viewerRenderInput,
          initialSceneTime: 0,
        };
        const scene = await createSceneFromU8Buffer(context, new ArrayBufferSlice(archiveBytes.buffer, archiveBytes.byteOffset, archiveBytes.byteLength));
        if (cancelled) {
          scene.destroy(sceneViewer.gfxDevice);
          return;
        }
        sceneRef.current = scene;
        sceneViewer.setScene(scene);
        (scene as SceneGfx & EditorMeshRendererScene).setEditorMode?.(modeRef.current);
        syncSceneOverlay(loadingTrack, selectedIdRef.current);
        applyViewMode(loadingTrack, true);
        setStatus(`${loadingTrack.fileName} Sigma`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    }

    void loadScene();
    return () => {
      cancelled = true;
    };
  }, [sceneKey, viewerReady]);

  useEffect(() => {
    syncRenderedGobjTransforms(track);
  }, [track?.kmp?.entities]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const scene = sceneRef.current as SceneGfx & {
      rebuildEditorGobjs?: (device: unknown, kmpBuffer: ArrayBufferSlice) => void;
    } | null;
    if (!viewer || !scene?.rebuildEditorGobjs || !track?.kmp) return;
    scene.rebuildEditorGobjs(
      viewer.gfxDevice,
      new ArrayBufferSlice(track.kmp.original.buffer, track.kmp.original.byteOffset, track.kmp.original.byteLength),
    );
  }, [gobjSignature]);

  useEffect(() => {
    syncSceneOverlay(track, selectedId);
  }, [
    fillBetweenPreviewPositions,
    previewTransform,
    routeInsertPreview,
    track?.kmp,
    track?.kcl,
    selectedId,
    selectedIds,
    transformSelection,
    transformSelections,
    showKmpEditorOverlay,
    hoveredId,
    hoveredHandle,
    collisionVisible,
    tool,
    routeVisibility,
    viewMode,
  ]);

  useEffect(() => {
    const updateFromLastPointer = (altKey: boolean) => {
      const pointer = lastPointerRef.current;
      if (!pointer) {
        if (!altKey) setRouteInsertPreview(null);
        return;
      }
      lastPointerRef.current = { ...pointer, altKey };
      updateRouteInsertPreview(pointer.x, pointer.y, altKey, pointer.snapToFeatures);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') updateFromLastPointer(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') updateFromLastPointer(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    const pointer = lastPointerRef.current;
    if (!pointer?.altKey) {
      setRouteInsertPreview(null);
      return;
    }
    updateRouteInsertPreview(pointer.x, pointer.y, true, pointer.snapToFeatures);
  }, [track?.kmp, selectedId, selectedIds]);

  useEffect(() => {
    const trackValue = trackRef.current;
    const hoveredEntity = hoveredIdRef.current
      ? trackValue?.kmp?.entities.find((entity) => entity.id === hoveredIdRef.current) ?? null
      : null;
    if (!hoveredEntity) return;
    const routeUsage = getPotiRouteUsage(trackValue?.kmp ?? null);
    const forcedVisibleObjectRoutes = getForcedVisibleObjectRoutes(trackValue?.kmp ?? null, selectedIdsRef.current, routeUsage);
    if (!isEntityVisibleForRouteFilter(hoveredEntity, routeVisibility, trackValue?.kmp ?? null, routeUsage, forcedVisibleObjectRoutes)) setHoveredId(null);
  }, [routeVisibility, track?.kmp, selectedIds]);

  useEffect(() => {
    applyViewMode(track, false);
  }, [viewMode, viewerReady]);

  useEffect(() => {
    const scene = sceneRef.current as SceneGfx & {
      setEditorDOFMode?: (mode: DofMode) => void;
    } | null;
    scene?.setEditorDOFMode?.(dofMode);
  }, [dofMode, viewerReady, sceneKey]);

  // Push the editor mode into the renderer and reset mode-specific state.
  useEffect(() => {
    const scene = getMeshScene();
    scene?.setEditorMode?.(mode);
    if (mode !== 'model') {
      hoveredMeshRef.current = null;
      setHoveredMeshKey(null);
      if (meshSelectionsRef.current.length > 0) applyMeshSelection([], false);
      scene?.setEditorMeshHighlight?.([]);
    } else {
      updateMeshHighlight();
    }
    if (mode !== 'camera' && cameraPreviewRef.current) {
      cameraPreviewRef.current = null;
      endCameraPreview(viewerRef.current, true);
    }
    syncSceneOverlay(trackRef.current, selectedIdRef.current);
  }, [mode, viewerReady, sceneKey]);

  // Camera mode is about cameras, so it starts with the racing-line overlays (enemy/item routes,
  // checkpoints, respawns, object routes) switched off; camera markers, the routes they fly and
  // the areas that trigger them stay on. The eye menu still overrides this, and leaving the mode
  // puts the user's own choices back.
  useEffect(() => {
    if (mode !== 'camera') return;
    const saved = routeVisibilityRef.current;
    setRouteVisibility({ ...saved, ENPT: false, ITPT: false, CKPT: false, JGPT: false, POTI_OBJECT: false, POTI_CAMERA: true, AREA: true, CAME: true });
    return () => setRouteVisibility(saved);
  }, [mode]);

  /**
   * Mirrors the document's mesh edits into the renderer.
   *
   * The document is the source of truth, so this both applies the edits that are there and lifts
   * the ones that are not: an edit removed by undo, or reset from the inspector, has to put its
   * mesh back where it started. The selection's own copy of the transform is refreshed too, so
   * the gizmo follows an undo instead of floating where the mesh used to be.
   */
  useEffect(() => {
    const scene = getMeshScene();
    if (!scene?.setEditorMeshTransform) return;
    const applied = appliedMeshEditsRef.current;
    const next = new Map<string, EditorMeshTarget>();
    for (const edit of meshEdits ?? []) {
      const key = meshTargetKey(edit.target);
      next.set(key, edit.target);
      scene.setEditorMeshTransform?.(edit.target, { kind: 'trs', ...edit.transform });
      scene.setEditorMeshVisible?.(edit.target, edit.visible && !edit.deleted);
    }
    for (const [key, target] of applied) {
      if (next.has(key)) continue;
      scene.setEditorMeshTransform?.(target, null);
      scene.setEditorMeshVisible?.(target, true);
    }
    appliedMeshEditsRef.current = next;

    if (meshSelectionsRef.current.length > 0) {
      const byKey = new Map((meshEdits ?? []).map((edit) => [meshTargetKey(edit.target), edit.transform]));
      const refreshed = meshSelectionsRef.current.map((entry) => ({
        ...entry,
        transform: byKey.get(entry.key) ?? createIdentityMeshTransform(),
      }));
      setMeshSelections(refreshed);
      meshSelectionsRef.current = refreshed;
      updateMeshHighlight();
    }
  }, [meshEdits, viewerReady, sceneKey]);

  /**
   * Mirrors duplicated meshes into the renderer. A duplicate is the same geometry drawn a second
   * time somewhere else, so it costs one draw call and no extra vertex data — and it keeps
   * standing when the original is hidden or deleted.
   */
  useEffect(() => {
    const scene = getMeshScene();
    if (!scene?.setEditorMeshCopies) return;
    const byTarget = new Map<string, { target: EditorMeshTarget; transforms: MeshTransform[] }>();
    for (const mesh of importedMeshes ?? []) {
      if (!mesh.sourceShape || !mesh.visible) continue;
      const key = meshTargetKey(mesh.sourceShape);
      const entry = byTarget.get(key) ?? { target: mesh.sourceShape, transforms: [] };
      entry.transforms.push(mesh.transform);
      byTarget.set(key, entry);
    }
    // Anything that had copies last time and does not now gets cleared.
    for (const [key, target] of appliedMeshCopiesRef.current) {
      if (!byTarget.has(key)) scene.setEditorMeshCopies?.(target, []);
    }
    const applied = new Map<string, EditorMeshTarget>();
    for (const [key, entry] of byTarget) {
      scene.setEditorMeshCopies?.(entry.target, entry.transforms.map((transform) => ({ kind: 'trs' as const, ...transform })));
      applied.set(key, entry.target);
    }
    appliedMeshCopiesRef.current = applied;
  }, [importedMeshes, viewerReady, sceneKey]);

  /**
   * Renders the objects placed as course geometry. Each one is an extra model instance; the diff
   * against what is already in the scene keeps a move from re-parsing the BRRES.
   */
  useEffect(() => {
    const scene = getMeshScene();
    if (!scene?.addEditorModelInstance) return;
    const live = importedMeshInstancesRef.current;
    const wanted = (importedMeshes ?? []).filter((mesh) => !mesh.sourceShape);

    for (const [id, entry] of [...live]) {
      if (!wanted.some((mesh) => mesh.id === id)) {
        removeImportedMeshInstance(entry.instanceId);
        live.delete(id);
      }
    }
    for (const mesh of wanted) {
      const signature = `${mesh.sourcePath}::${mesh.modelName}`;
      const existing = live.get(mesh.id);
      if (existing && existing.signature === signature) {
        scene.updateEditorModelInstance?.(existing.instanceId, importedMeshMatrix(mesh.transform));
        scene.setEditorModelInstanceVisible?.(existing.instanceId, mesh.visible);
        continue;
      }
      if (existing) {
        removeImportedMeshInstance(existing.instanceId);
        live.delete(mesh.id);
      }
      const bytes = resolveImportedMeshSourceRef.current?.(mesh.sourcePath);
      if (!bytes) continue;
      const instanceId = addImportedMeshInstance(bytes, mesh.modelName || null, {});
      if (instanceId === null) continue;
      scene.updateEditorModelInstance?.(instanceId, importedMeshMatrix(mesh.transform));
      scene.setEditorModelInstanceVisible?.(instanceId, mesh.visible);
      live.set(mesh.id, { instanceId, signature });
    }
  }, [importedMeshes, viewerReady, sceneKey]);

  // The outliner drives the selection when the app passes one in.
  useEffect(() => {
    if (meshSelection === undefined || modeRef.current !== 'model') return;
    const wanted = meshSelection.map((target) => meshTargetKey(target)).join('|');
    if (wanted === meshSelectionsRef.current.map((entry) => entry.key).join('|')) return;
    const editsByKey = new Map((meshEdits ?? []).map((edit) => [meshTargetKey(edit.target), edit.transform]));
    const entries = meshSelection
      .map((target) => makeMeshEntryFromTarget(target, describeMeshTarget(target), editsByKey.get(meshTargetKey(target))))
      .filter((entry): entry is MeshSelectionEntry => entry !== null);
    applyMeshSelection(entries, false);
  }, [meshSelection, mode, viewerReady, sceneKey]);

  // `]` widens the mesh selection unit, `[` narrows it.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (modeRef.current !== 'model') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.key === ']') {
        event.preventDefault();
        changeMeshGranularity(widenMeshGranularity(meshGranularityRef.current));
      } else if (event.key === '[') {
        event.preventDefault();
        changeMeshGranularity(narrowMeshGranularity(meshGranularityRef.current));
      } else if (event.key === 'f' || event.key === 'F') {
        if (frameMeshSelection()) event.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [meshGranularity]);

  useEffect(() => {
    syncSceneOverlay(trackRef.current, selectedIdRef.current);
  }, [meshSelections]);

  // KMP-mode keyboard: F frames the selection, H hides its layer, the numpad switches views.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (modeRef.current === 'model') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (document.documentElement.dataset.viewportCameraLook === 'active') return;
      if (event.key === 'f' || event.key === 'F') {
        if (frameKmpEntity(null)) event.preventDefault();
        return;
      }
      if (event.key === 'h' || event.key === 'H') {
        const selectedSection = sectionForEntityId(selectedIdRef.current);
        const layers = selectedSection?.visibility ?? [];
        if (layers.length === 0) return;
        event.preventDefault();
        const nextVisible = layers.some((key) => routeVisibilityRef.current[key] === false);
        for (const key of layers) setLayerVisible(key, nextVisible);
        return;
      }
      const numpadView = NUMPAD_VIEW_MODES[event.code];
      if (numpadView && onChangeViewMode) {
        event.preventDefault();
        onChangeViewMode(numpadView);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChangeViewMode, onChangeSectionVisibility, routeVisibility]);

  // The outliner asks for a specific entity to be framed; the token re-triggers the same one.
  useEffect(() => {
    if (!frameRequest) return;
    frameKmpEntity(frameRequest.entityId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameRequest?.token, frameRequest?.entityId]);

  // Dev-only hook so the viewport's new features can be driven from DevTools while the
  // app UI is still being wired up.
  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return;
    const api = {
      setMode: (next: EditorMode | null) => {
        devModeOverrideRef.current = next;
        modeRef.current = next ?? mode;
        getMeshScene()?.setEditorMode?.(modeRef.current);
        syncSceneOverlay(trackRef.current, selectedIdRef.current);
      },
      getMode: () => modeRef.current,
      pickMeshAt: (clientX: number, clientY: number) => pickMeshAtClient(clientX, clientY),
      selectMeshAt: (clientX: number, clientY: number, additive = false) => {
        selectMeshFromClient(clientX, clientY, additive);
        return meshSelectionsRef.current.map((entry) => entry.target);
      },
      getSelectedMesh: () => meshSelectionsRef.current.map((entry) => ({ target: entry.target, label: entry.label, transform: entry.transform })),
      setMeshGranularity: (granularity: MeshSelectionGranularity) => changeMeshGranularity(granularity),
      transformMesh: (target: EditorMeshTarget, transform: MeshTransform | null) => {
        const applied = getMeshScene()?.setEditorMeshTransform?.(target, transform === null ? null : { kind: 'trs', ...transform }) ?? false;
        applyMeshTransform(meshTargetKey(target), transform ?? createIdentityMeshTransform());
        updateMeshHighlight();
        return applied;
      },
      setMeshVisible: (target: EditorMeshTarget, visible: boolean) => getMeshScene()?.setEditorMeshVisible?.(target, visible) ?? false,
      listMeshes: () => getMeshScene()?.listEditorMeshes?.() ?? [],
      getMeshBounds: (target: EditorMeshTarget) => getMeshBounds(target),
      frameMeshSelection: () => frameMeshSelection(),
      addImportedMesh: (brres: ArrayBuffer | Uint8Array, modelName: string | null, placement?: { position?: Vec3; rotation?: Vec3; scale?: Vec3 }) =>
        addImportedMeshInstance(brres, modelName, placement),
      removeImportedMesh: (id: string) => removeImportedMeshInstance(id),
      listImportedMeshes: () => getMeshScene()?.listEditorModelInstances?.() ?? [],
      pickRay: (clientX: number, clientY: number) => {
        const canvas = canvasRef.current;
        const scene = sceneRef.current as (SceneGfx & { getEditorPickRay?: (x: number, y: number) => unknown }) | null;
        if (!canvas || !scene?.getEditorPickRay) return null;
        const rect = canvas.getBoundingClientRect();
        return scene.getEditorPickRay((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height);
      },
      previewCamera: (cameraId: string | number, options: { play?: boolean; time?: number; sequence?: boolean } = {}) => {
        const request: CameraPreviewRequest = {
          cameraId: typeof cameraId === 'number' ? `CAME-${cameraId}` : cameraId,
          playing: options.play ?? false,
          time: options.time ?? 0,
          sequence: options.sequence ?? false,
        };
        devCameraPreviewRef.current = request;
        cameraPreviewRef.current = request;
        return true;
      },
      stopCameraPreview: () => {
        devCameraPreviewRef.current = null;
        cameraPreviewRef.current = null;
        endCameraPreview(viewerRef.current, true);
      },
      playOpeningSequence: () => {
        const started = playOpeningSequence();
        if (started) devCameraPreviewRef.current = cameraPreviewRef.current;
        return started;
      },
      getCameraOverlay: () =>
        buildCameraOverlay(trackRef.current?.kmp ?? null, {
          selectedIds: new Set([...(selectedIdsRef.current ?? []), ...(selectedIdRef.current ? [selectedIdRef.current] : [])]),
          hoveredId: hoveredIdRef.current,
        }),
      getCameras: () => cameraPreviewDefsRef.current,
      /** The overlay handle under a screen point — how probes locate a camera view-point handle. */
      pickHandleAt: (clientX: number, clientY: number) =>
        canvasRef.current ? pickSceneHandle(sceneRef.current, clientX, clientY, canvasRef.current) : null,
      /** Grabs the WebGL frame as a PNG data URL (the drawing buffer is not preserved). */
      captureFrame: async (): Promise<string | null> => {
        devCaptureRef.current = { request: true, dataUrl: null };
        for (let i = 0; i < 120; i++) {
          if (!devCaptureRef.current.request) return devCaptureRef.current.dataUrl;
          await new Promise((resolve) => setTimeout(resolve, 32));
        }
        devCaptureRef.current.request = false;
        return null;
      },
    };
    (window as unknown as { __mkwViewport?: typeof api }).__mkwViewport = api;
    return () => {
      delete (window as unknown as { __mkwViewport?: typeof api }).__mkwViewport;
    };
  }, [viewerReady, sceneKey]);

  // Uncontrolled mode only: forget toggles for layers the loaded track does not have.
  useEffect(() => {
    if (sectionVisibility) return;
    setInternalRouteVisibility((current) => {
      const next = createVisibilityState(true);
      let changed = false;
      for (const item of routeItems) {
        next[item.key] = current[item.key] ?? true;
        if (next[item.key] !== current[item.key]) changed = true;
      }
      for (const key of KMP_VISIBILITY_KEYS) {
        if (current[key] === false && !routeItems.some((item) => item.key === key)) changed = true;
      }
      return changed ? next : current;
    });
  }, [routeItems, sectionVisibility]);

  useEffect(() => {
    if (!smokeMode || smokeAddObjectId === null || smokePlacementDoneRef.current || !onAddObject) return;
    let cancelled = false;
    let frame = 0;
    const tryPlace = () => {
      if (cancelled || smokePlacementDoneRef.current) return;
      if (!track?.kmp || !viewerReady || !sceneRef.current || !canvasRef.current) {
        frame = requestAnimationFrame(tryPlace);
        return;
      }
      const rect = canvasRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        frame = requestAnimationFrame(tryPlace);
        return;
      }
      const smokeAnchor = track.kmp.entities.find((entity) => entity.position) ?? null;
      const anchorClient =
        smokeAnchor && viewerRef.current ? projectWorldToClient(smokeAnchor.position, canvasRef.current, viewerRef.current) : null;
      const placement = placeFromScreenDetailed(anchorClient?.x ?? rect.left + rect.width * 0.5, anchorClient?.y ?? rect.top + rect.height * 0.5, 0);
      if (!placement || placement.source === 'plane') {
        frame = requestAnimationFrame(tryPlace);
        return;
      }
      smokePlacementDoneRef.current = true;
      smokePlacementUsedCollisionRef.current = true;
      onAddObject(smokeAddObjectId, placement.position);
    };
    tryPlace();
    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
    };
  }, [onAddObject, smokeAddObjectId, smokeMode, track?.kmp, viewerReady]);

  useEffect(() => {
    if (!smokeMode || smokeMouseLookDoneRef.current) return;
    let cancelled = false;
    let frame = 0;
    let attempts = 0;
    const tryMouseLook = () => {
      if (cancelled || smokeMouseLookDoneRef.current) return;
      const canvas = canvasRef.current;
      const viewer = viewerRef.current;
      if (!viewerReady || !canvas || !viewer) {
        frame = requestAnimationFrame(tryMouseLook);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        frame = requestAnimationFrame(tryMouseLook);
        return;
      }
      const startX = rect.left + rect.width * 0.5;
      const startY = rect.top + rect.height * 0.5;
      const pointerId = 91 + attempts;
      const before = getCameraSmokeSignature(viewer);
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 2,
          buttons: 2,
          clientX: startX,
          clientY: startY,
          pointerId,
          pointerType: 'mouse',
        }),
      );
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          button: -1,
          buttons: 2,
          clientX: startX + 56,
          clientY: startY + 24,
          pointerId,
          pointerType: 'mouse',
        }),
      );
      canvas.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          button: 2,
          buttons: 0,
          clientX: startX + 56,
          clientY: startY + 24,
          pointerId,
          pointerType: 'mouse',
        }),
      );
      requestAnimationFrame(() => {
        if (cancelled || smokeMouseLookDoneRef.current) return;
        const after = getCameraSmokeSignature(viewer);
        if (before !== after) {
          smokeMouseLookDoneRef.current = true;
          setSmokeMouseLookWorked('yes');
          return;
        }
        attempts++;
        if (attempts >= 12) {
          smokeMouseLookDoneRef.current = true;
          setSmokeMouseLookWorked('no');
          return;
        }
        frame = requestAnimationFrame(tryMouseLook);
      });
    };
    tryMouseLook();
    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
    };
  }, [smokeMode, viewerReady]);

  function placeFromScreen(clientX: number, clientY: number, planeY = 0, snapToFeatures = false): Vec3 | null {
    return placeFromScreenDetailed(clientX, clientY, planeY, snapToFeatures)?.position ?? null;
  }

  function placeFromScreenDetailed(clientX: number, clientY: number, planeY = 0, snapToFeatures = false): { position: Vec3; source: 'mesh' | 'down' | 'plane' } | null {
    const viewer = viewerRef.current;
    const canvas = canvasRef.current;
    if (!viewer || !canvas) return null;
    const ray = screenToWorldRay(clientX, clientY, canvas, viewer);
    if (ray && trackRef.current?.kcl) {
      const hit = raycastMesh(
        trackRef.current.kcl,
        { x: ray.origin.x / MKW_RENDER_SCALE, y: ray.origin.y / MKW_RENDER_SCALE, z: ray.origin.z / MKW_RENDER_SCALE },
        ray.direction,
      );
      if (hit) {
        const snappedPosition = snapToFeatures ? snapPointToTriangleFeature(hit.position, hit.triangle).position : hit.position;
        return { position: snappedPosition, source: 'mesh' };
      }
    }
    const point = screenToWorldOnPlane(clientX, clientY, canvas, viewer, planeY * MKW_RENDER_SCALE);
    if (!point) return null;
    const unscaled = { x: point.x / MKW_RENDER_SCALE, y: point.y / MKW_RENDER_SCALE, z: point.z / MKW_RENDER_SCALE };
    const snapped = trackRef.current?.kcl ? raycastDown(trackRef.current.kcl, unscaled.x, unscaled.z) : null;
    if (snapped) return { position: snapped, source: 'down' };
    return { position: unscaled, source: 'plane' };
  }

  function setViewportCameraLookActive(active: boolean) {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.viewportCameraLook = active ? 'active' : 'inactive';
  }

  function setHoveredGizmoHandle(next: GizmoHandleKey | null) {
    if (gizmoHandleEquals(hoveredHandleRef.current, next)) return;
    hoveredHandleRef.current = next;
    setHoveredHandle(next);
  }

  function setActiveGizmoHandle(next: GizmoHandleKey | null) {
    activeHandleRef.current = next;
  }

  function setDragPreview(next: EntityTransformPreview | null) {
    setPreviewTransform((current) => {
      if (!current && !next) return current;
      if (current && next && current.id === next.id) {
        const samePosition =
          current.position.x === next.position.x &&
          current.position.y === next.position.y &&
          current.position.z === next.position.z;
        const sameRotation =
          current.rotation?.x === next.rotation?.x &&
          current.rotation?.y === next.rotation?.y &&
          current.rotation?.z === next.rotation?.z;
        const sameScale =
          current.scale?.x === next.scale?.x &&
          current.scale?.y === next.scale?.y &&
          current.scale?.z === next.scale?.z;
        if (samePosition && sameRotation && sameScale) return current;
      }
      return next;
    });
  }

  function withSuppressedCameraMovementKeys(viewer: Viewer) {
    if (cameraLookDragRef.current) return () => {};
    const suppressed = new Map<string, boolean>();
    for (const key of CAMERA_MOVE_KEYS) {
      const value = viewer.inputManager.keysDown.get(key);
      if (value !== undefined) {
        suppressed.set(key, value);
        viewer.inputManager.keysDown.delete(key);
      }
    }
    return () => {
      for (const [key, value] of suppressed) viewer.inputManager.keysDown.set(key, value);
    };
  }

  function flushPendingInteractionCommit() {
    if (interactionCommitFrameRef.current !== null) {
      cancelAnimationFrame(interactionCommitFrameRef.current);
      interactionCommitFrameRef.current = null;
    }
    const pending = pendingInteractionCommitRef.current;
    if (!pending) return;
    pendingInteractionCommitRef.current = null;
    if (pending.kind === 'moveEntity') {
      onMoveEntityRef.current(pending.entity, pending.position);
      return;
    }
    if (pending.kind === 'rotateEntity') {
      onRotateEntityRef.current?.(pending.entity, pending.rotation);
      return;
    }
    if (pending.kind === 'scaleEntity') {
      onScaleEntityRef.current?.(pending.entity, pending.scale);
      return;
    }
    if (pending.kind === 'transformMesh') {
      onTransformMeshRef.current?.(pending.target, pending.transform);
      return;
    }
    if (pending.kind === 'moveCameraViewPoint') {
      onMoveCameraViewPointRef.current?.(pending.entity, pending.which, pending.position);
      return;
    }
    if (pending.kind === 'moveTransformSelection') {
      if (commitMeshTransformSelection(pending.selection, pending.position, pending.selection.rotation, pending.selection.scale)) return;
      onMoveTransformSelectionRef.current?.(pending.selection, pending.position);
      return;
    }
    if (pending.kind === 'rotateTransformSelection') {
      if (commitMeshTransformSelection(pending.selection, pending.selection.position, pending.rotation, pending.selection.scale)) return;
      onRotateTransformSelectionRef.current?.(pending.selection, pending.rotation);
      return;
    }
    if (pending.kind === 'scaleTransformSelection') {
      if (commitMeshTransformSelection(pending.selection, pending.selection.position, pending.selection.rotation, pending.scale)) return;
      onScaleTransformSelectionRef.current?.(pending.selection, pending.scale);
      return;
    }
    onMoveCheckpointEndpointRef.current?.(pending.entity, pending.side, pending.position);
  }

  /** Mesh gizmo drags commit through `onTransformMesh`, not the BRRES-node callbacks. */
  function commitMeshTransformSelection(
    selection: ViewportTransformSelection,
    position: Vec3,
    rotation: Vec3 | undefined,
    scale: Vec3 | undefined,
  ): boolean {
    const rendererTarget = selection.rendererTarget;
    if (rendererTarget?.kind !== 'editorMesh') return false;
    const transform = meshTransformFromGizmoPose(rendererTarget.baseCenter, position, rotation, scale);
    applyMeshTransform(meshTargetKey(rendererTarget.target), transform);
    onTransformMeshRef.current?.(rendererTarget.target, transform);
    updateMeshHighlight();
    return true;
  }

  function scheduleInteractionCommit(pending: PendingInteractionCommit) {
    pendingInteractionCommitRef.current = pending;
    if (
      pending.kind === 'moveTransformSelection' ||
      pending.kind === 'rotateTransformSelection' ||
      pending.kind === 'scaleTransformSelection'
    ) {
      return;
    }
    if (interactionCommitFrameRef.current !== null) return;
    interactionCommitFrameRef.current = requestAnimationFrame(() => {
      interactionCommitFrameRef.current = null;
      flushPendingInteractionCommit();
    });
  }

  function startEntityDrag(entity: KmpEntity, clientX: number, clientY: number) {
    onSelect(entity.id);
    onInteractionStart?.();
    draggingEntityRef.current = { kind: 'entity', id: entity.id, startX: clientX, startY: clientY, rotation: entity.rotation, scale: entity.scale };
  }

  function updateActiveDrag(clientX: number, clientY: number, snapToFeatures = false) {
    const drag = draggingEntityRef.current;
    if (!drag) return;
    if (drag.kind === 'gizmo') {
      handleGizmoPointerMove(clientX, clientY, drag, snapToFeatures);
      return;
    }
    if (drag.kind === 'checkpointEndpoint') {
      handleCheckpointEndpointPointerMove(clientX, clientY, drag, snapToFeatures);
      return;
    }
    if (drag.kind === 'cameraViewPoint') {
      handleCameraViewPointPointerMove(clientX, clientY, drag, snapToFeatures);
      return;
    }
    const entity = trackRef.current?.kmp?.entities.find((candidate) => candidate.id === drag.id);
    if (!entity) return;
    if (tool === 'translate') {
      const position = placeFromScreen(clientX, clientY, entity.position.y, snapToFeatures);
      if (position) {
        setDragPreview({ id: entity.id, position, rotation: entity.rotation, scale: entity.scale });
        syncRenderedGobjTransform(entity, position, entity.rotation, entity.scale);
        scheduleInteractionCommit({ kind: 'moveEntity', entity, position });
      }
      return;
    }
    if (tool === 'rotate' && drag.rotation && entity.rotation) {
      const delta = clientX - drag.startX;
      const rotation = { ...drag.rotation, y: drag.rotation.y + delta };
      setDragPreview({ id: entity.id, position: entity.position, rotation, scale: entity.scale });
      syncRenderedGobjTransform(entity, entity.position, rotation, entity.scale);
      scheduleInteractionCommit({ kind: 'rotateEntity', entity, rotation });
      return;
    }
    if (tool === 'scale' && drag.scale && entity.scale) {
      const factor = Math.max(0.05, 1 + (drag.startY - clientY) / 140);
      const scale = { x: drag.scale.x * factor, y: drag.scale.y * factor, z: drag.scale.z * factor };
      setDragPreview({ id: entity.id, position: entity.position, rotation: entity.rotation, scale });
      syncRenderedGobjTransform(entity, entity.position, entity.rotation, scale);
      scheduleInteractionCommit({ kind: 'scaleEntity', entity, scale });
    }
  }

  /** World position of a path group's first or last point, where its link handle is drawn. */
  function getPathGroupHandlePosition(section: PathLinkSection, groupIndex: number, side: 'start' | 'end'): Vec3 | null {
    const kmp = trackRef.current?.kmp;
    if (!kmp) return null;
    const graph = kmp.pathGraphs.find((candidate) => candidate.pointSection === section);
    const group = graph?.groups.find((candidate) => candidate.index === groupIndex);
    if (!group) return null;
    const graphPoints = kmp.entities.filter((entity) => entity.section === section);
    const entity = side === 'start' ? graphPoints[group.startIndex] : graphPoints[group.startIndex + group.pointCount - 1];
    return entity ? entity.position : null;
  }

  /**
   * Frames the free camera on a KMP entity (F). Mirrors `frameMeshSelection`, but sized from
   * the entity's own extent instead of a mesh bounding box.
   */
  function frameKmpEntity(entityId: string | null): boolean {
    const viewer = viewerRef.current;
    const kmp = trackRef.current?.kmp;
    if (!viewer || !kmp) return false;
    const ids = entityId ? [entityId] : selectedIdsRef.current;
    const entities = kmp.entities.filter((entity) => ids.includes(entity.id));
    if (entities.length === 0) return false;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    const include = (position: Vec3) => {
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
      minZ = Math.min(minZ, position.z);
      maxX = Math.max(maxX, position.x);
      maxY = Math.max(maxY, position.y);
      maxZ = Math.max(maxZ, position.z);
    };
    for (const entity of entities) {
      include(entity.position);
      if (entity.checkpoint) {
        include(entity.checkpoint.left);
        include(entity.checkpoint.right);
      }
    }
    if (!Number.isFinite(minX)) return false;
    const center = vec3.fromValues(
      ((minX + maxX) / 2) * MKW_RENDER_SCALE,
      ((minY + maxY) / 2) * MKW_RENDER_SCALE,
      ((minZ + maxZ) / 2) * MKW_RENDER_SCALE,
    );
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * MKW_RENDER_SCALE;
    const radius = Math.max(120, extent);
    const controller = viewer.cameraController instanceof FPSCameraController ? viewer.cameraController : new FPSCameraController();
    if (!(viewer.cameraController instanceof FPSCameraController)) viewer.setCameraController(controller);
    applyFPSCameraFrame(controller, {
      eye: vec3.fromValues(center[0] + radius * 1.6, center[1] + radius * 1.2, center[2] + radius * 1.9),
      target: center,
    });
    controller.update(viewer.inputManager, 0);
    viewer.camera.worldMatrixUpdated();
    return true;
  }

  function handleCanvasPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button === 2) return;
    if (event.button !== 0 || draggingEntityRef.current) return;
    if (event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const additiveSelection = isAdditiveSelectionModifier(event);
    const scene = sceneRef.current as SceneGfx & {
      pickEditorHandle?: (normalizedX: number, normalizedY: number) => SceneOverlayPick | null;
    } | null;
    const scenePick = pickSceneHandle(scene, event.clientX, event.clientY, event.currentTarget);

    // Dragging one group's connection handle onto another group's wires the two together.
    const linkHandle = scenePick?.kind === 'point' ? parsePathLinkHandleId(scenePick.id) : null;
    if (linkHandle && pathLinkSection === linkHandle.section) {
      const anchor = getPathGroupHandlePosition(linkHandle.section, linkHandle.groupIndex, linkHandle.side);
      if (anchor) {
        event.preventDefault();
        event.stopPropagation();
        const next: PathLinkDragState = {
          section: linkHandle.section,
          fromGroup: linkHandle.groupIndex,
          fromSide: linkHandle.side,
          anchor,
          cursor: anchor,
          hoverGroup: null,
        };
        pathLinkDragRef.current = next;
        setPathLinkDrag(next);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }

    // "Draw a checkpoint": a plain left-drag across the track becomes one checkpoint line.
    if (drawTool === 'checkpoint' && onDrawCheckpoint && !additiveSelection) {
      const start = placeFromScreen(event.clientX, event.clientY, 0, isCollisionSnapModifier(event));
      if (start) {
        event.preventDefault();
        event.stopPropagation();
        const next: CheckpointDrawState = { start, current: start };
        checkpointDrawRef.current = next;
        setCheckpointDraw(next);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }

    const pickedHandle = pickToGizmoHandle(scenePick);
    const transformTarget = pickTransformSelectionFromPick(scenePick);
    const entity = transformTarget?.entity ?? pickEntityFromPick(scenePick) ?? pickEntityFromScreenPosition(event.clientX, event.clientY);
    if (additiveSelection && !scenePick && !entity) {
      event.preventDefault();
      event.stopPropagation();
      const nextMarquee = { additive: true, startX: event.clientX, startY: event.clientY, currentX: event.clientX, currentY: event.clientY };
      marqueeSelectionRef.current = nextMarquee;
      setMarqueeSelection(nextMarquee);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (additiveSelection && scenePick && scenePick.kind !== 'point') return;
    if (event.shiftKey) return;
    if (scenePick?.kind === 'center') {
      const drag = transformTarget && viewerRef.current ? createCenterGizmoDragState(transformTarget.selection, toolRef.current, event.clientX, event.clientY, event.currentTarget, viewerRef.current) : null;
      if (!transformTarget || !drag) return;
      event.preventDefault();
      event.stopPropagation();
      if (transformTarget.kind === 'kmp' && transformTarget.entity) onSelect(transformTarget.entity.id);
      onInteractionStart?.();
      setActiveGizmoHandle(pickedHandle);
      setHoveredGizmoHandle(pickedHandle);
      setDragPreview({ id: transformTarget.selection.id, position: transformTarget.selection.position, rotation: transformTarget.selection.rotation, scale: transformTarget.selection.scale });
      draggingEntityRef.current = drag;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (scenePick?.kind === 'plane') {
      const drag = transformTarget && viewerRef.current ? createPlaneGizmoDragState(transformTarget.selection, scenePick.plane, toolRef.current, event.clientX, event.clientY, event.currentTarget, viewerRef.current) : null;
      if (!transformTarget || !drag) return;
      event.preventDefault();
      event.stopPropagation();
      if (transformTarget.kind === 'kmp' && transformTarget.entity) onSelect(transformTarget.entity.id);
      onInteractionStart?.();
      setActiveGizmoHandle(pickedHandle);
      setHoveredGizmoHandle(pickedHandle);
      setDragPreview({ id: transformTarget.selection.id, position: transformTarget.selection.position, rotation: transformTarget.selection.rotation, scale: transformTarget.selection.scale });
      draggingEntityRef.current = drag;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (scenePick?.kind === 'axis') {
      const drag = transformTarget && viewerRef.current ? createGizmoDragState(transformTarget.selection, scenePick.axis, toolRef.current, event.clientX, event.clientY, event.currentTarget, viewerRef.current) : null;
      if (!transformTarget || !drag) return;
      event.preventDefault();
      event.stopPropagation();
      if (transformTarget.kind === 'kmp' && transformTarget.entity) onSelect(transformTarget.entity.id);
      onInteractionStart?.();
      setActiveGizmoHandle(pickedHandle);
      setHoveredGizmoHandle(pickedHandle);
      setDragPreview({ id: transformTarget.selection.id, position: transformTarget.selection.position, rotation: transformTarget.selection.rotation, scale: transformTarget.selection.scale });
      draggingEntityRef.current = drag;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (scenePick?.kind === 'checkpointEndpoint') {
      if (!entity?.checkpoint) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect(entity.id);
      onInteractionStart?.();
      draggingEntityRef.current = { kind: 'checkpointEndpoint', id: entity.id, side: scenePick.side };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (scenePick?.kind === 'cameraViewPoint') {
      const cameraEntity = trackRef.current?.kmp?.entities.find((candidate) => candidate.id === scenePick.id);
      if (!cameraEntity?.cameraView) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect(cameraEntity.id);
      onInteractionStart?.();
      draggingEntityRef.current = { kind: 'cameraViewPoint', id: cameraEntity.id, which: scenePick.which };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (!entity) return;
    event.preventDefault();
    event.stopPropagation();
    pendingEntityDragRef.current = { id: entity.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, additive: additiveSelection };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCanvasPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (cameraLookDragRef.current && event.pointerId === cameraLookDragRef.current.pointerId) return;
    lastPointerRef.current = {
      x: event.clientX,
      y: event.clientY,
      snapToFeatures: isCollisionSnapModifier(event),
      altKey: event.altKey,
    };
    if (marqueeSelectionRef.current) {
      const nextMarquee = { ...marqueeSelectionRef.current, currentX: event.clientX, currentY: event.clientY };
      marqueeSelectionRef.current = nextMarquee;
      setMarqueeSelection(nextMarquee);
      return;
    }
    if (checkpointDrawRef.current) {
      const current = placeFromScreen(event.clientX, event.clientY, checkpointDrawRef.current.start.y, isCollisionSnapModifier(event));
      if (current) {
        const next = { ...checkpointDrawRef.current, current };
        checkpointDrawRef.current = next;
        setCheckpointDraw(next);
      }
      return;
    }
    if (pathLinkDragRef.current) {
      const drag = pathLinkDragRef.current;
      const cursor = placeFromScreen(event.clientX, event.clientY, drag.anchor.y, false) ?? drag.cursor;
      const scene = sceneRef.current as SceneGfx & {
        pickEditorHandle?: (normalizedX: number, normalizedY: number) => SceneOverlayPick | null;
      } | null;
      const pick = pickSceneHandle(scene, event.clientX, event.clientY, event.currentTarget);
      const handle = pick?.kind === 'point' ? parsePathLinkHandleId(pick.id) : null;
      const hoverGroup = handle && handle.section === drag.section && handle.groupIndex !== drag.fromGroup ? handle.groupIndex : null;
      const next = { ...drag, cursor, hoverGroup };
      pathLinkDragRef.current = next;
      setPathLinkDrag(next);
      return;
    }
    const pendingEntityDrag = pendingEntityDragRef.current;
    if (pendingEntityDrag && event.pointerId === pendingEntityDrag.pointerId) {
      const entity = trackRef.current?.kmp?.entities.find((candidate) => candidate.id === pendingEntityDrag.id);
      if (!entity) {
        pendingEntityDragRef.current = null;
        return;
      }
      const moved = Math.hypot(event.clientX - pendingEntityDrag.startX, event.clientY - pendingEntityDrag.startY);
      if (moved >= ENTITY_DRAG_START_THRESHOLD_PX) {
        pendingEntityDragRef.current = null;
        startEntityDrag(entity, pendingEntityDrag.startX, pendingEntityDrag.startY);
        updateActiveDrag(event.clientX, event.clientY, isCollisionSnapModifier(event));
      }
      return;
    }
    if (draggingEntityRef.current) {
      updateActiveDrag(event.clientX, event.clientY, isCollisionSnapModifier(event));
      return;
    }
    updateRouteInsertPreview(event.clientX, event.clientY, event.altKey, isCollisionSnapModifier(event));
    updateHoveredEntity(event.clientX, event.clientY, event.currentTarget);
  }

  function clearActiveDrag(event?: PointerEvent<HTMLCanvasElement>) {
    if (cameraLookDragRef.current && (!event || event.pointerId === cameraLookDragRef.current.pointerId || event.button === 2)) {
      releaseCameraLook(event?.currentTarget ?? canvasRef.current);
      return;
    }
    if (marqueeSelectionRef.current) {
      completeMarqueeSelection(event?.currentTarget ?? canvasRef.current);
      return;
    }
    if (checkpointDrawRef.current) {
      const draw = checkpointDrawRef.current;
      checkpointDrawRef.current = null;
      setCheckpointDraw(null);
      suppressNextClickRef.current = true;
      if (Math.hypot(draw.current.x - draw.start.x, draw.current.z - draw.start.z) >= MIN_CHECKPOINT_DRAW_WIDTH) {
        onDrawCheckpoint?.(draw.start, draw.current);
        onDrawToolFinished?.();
      }
      return;
    }
    if (pathLinkDragRef.current) {
      const drag = pathLinkDragRef.current;
      pathLinkDragRef.current = null;
      setPathLinkDrag(null);
      suppressNextClickRef.current = true;
      if (drag.hoverGroup !== null && drag.hoverGroup !== drag.fromGroup) {
        if (drag.fromSide === 'end') onLinkPathGroups?.(drag.section, drag.fromGroup, drag.hoverGroup);
        else onLinkPathGroups?.(drag.section, drag.hoverGroup, drag.fromGroup);
      }
      return;
    }
    const pendingEntityDrag = pendingEntityDragRef.current;
    if (pendingEntityDrag && (!event || event.pointerId === pendingEntityDrag.pointerId)) {
      pendingEntityDragRef.current = null;
      suppressNextClickRef.current = true;
      onSelect(pendingEntityDrag.id, { additive: pendingEntityDrag.additive });
    }
    flushPendingInteractionCommit();
    const hadDrag = draggingEntityRef.current !== null;
    draggingEntityRef.current = null;
    setActiveGizmoHandle(null);
    setDragPreview(null);
    if (hadDrag) onInteractionEnd?.();
  }

  function handleCanvasPointerLeave() {
    if (marqueeSelectionRef.current) return;
    setHoveredGizmoHandle(null);
    if (hoveredIdRef.current !== null) setHoveredId(null);
    lastPointerRef.current = null;
    setRouteInsertPreview(null);
  }

function handleGizmoPointerMove(clientX: number, clientY: number, drag: GizmoDragState, snapToFeatures = false) {
  const target = findTransformSelectionById(drag.id);
  const viewer = viewerRef.current;
  const canvas = canvasRef.current;
  if (!target || !viewer || !canvas) return;
  const selection = target.selection;
  if (drag.mode === 'angular') {
    const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, drag.center, drag.planeNormal);
    if (!hit) return;
    const angle = ringAngleForHit(hit, drag.center, drag.angleBasisX, drag.angleBasisY);
    if (angle === null) return;
    const deltaDegrees = -normalizeAngle(angle - drag.startAngle) * (180 / Math.PI);
    const rotation = addAxisDelta(drag.rotation, drag.axis, deltaDegrees);
    setDragPreview({ id: selection.id, position: selection.position, rotation, scale: selection.scale });
    if (target.kind === 'kmp' && target.entity) {
      syncRenderedGobjTransform(target.entity, selection.position, rotation, selection.scale);
      scheduleInteractionCommit({ kind: 'rotateEntity', entity: target.entity, rotation });
    } else {
      syncRenderedTransformSelection(selection, selection.position, rotation, selection.scale);
      scheduleInteractionCommit({ kind: 'rotateTransformSelection', selection, rotation });
    }
    return;
  }
  if (drag.mode === 'planar') {
    const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, drag.planePoint, drag.planeNormal);
    if (!hit) return;
    let position = {
      x: drag.position.x + (hit.x - drag.startHit.x) / MKW_RENDER_SCALE,
      y: drag.position.y + (hit.y - drag.startHit.y) / MKW_RENDER_SCALE,
      z: drag.position.z + (hit.z - drag.startHit.z) / MKW_RENDER_SCALE,
    };
    if (snapToFeatures) position = snapDraggedPositionToCollision(position);
    setDragPreview({ id: selection.id, position, rotation: selection.rotation, scale: selection.scale });
    if (target.kind === 'kmp' && target.entity) {
      syncRenderedGobjTransform(target.entity, position, selection.rotation, selection.scale);
      scheduleInteractionCommit({ kind: 'moveEntity', entity: target.entity, position });
    } else {
      syncRenderedTransformSelection(selection, position, selection.rotation, selection.scale);
      scheduleInteractionCommit({ kind: 'moveTransformSelection', selection, position });
    }
    return;
  }
  if (drag.mode === 'uniformScale') {
    const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, scaleVec3(drag.center, MKW_RENDER_SCALE), drag.planeNormal);
    if (!hit) return;
    const center = scaleVec3(drag.center, MKW_RENDER_SCALE);
    const radius = Math.hypot(hit.x - center.x, hit.y - center.y, hit.z - center.z);
    const factor = Math.max(0.05, Math.min(20, radius / drag.startRadius));
    const scale = {
      x: drag.scale.x * factor,
      y: drag.scale.y * factor,
      z: drag.scale.z * factor,
    };
    setDragPreview({ id: selection.id, position: selection.position, rotation: selection.rotation, scale });
    if (target.kind === 'kmp' && target.entity) {
      syncRenderedGobjTransform(target.entity, selection.position, selection.rotation, scale);
      scheduleInteractionCommit({ kind: 'scaleEntity', entity: target.entity, scale });
    } else {
      syncRenderedTransformSelection(selection, selection.position, selection.rotation, scale);
      scheduleInteractionCommit({ kind: 'scaleTransformSelection', selection, scale });
    }
    return;
  }
  if (drag.mode === 'planarScale') {
    const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, drag.planePoint, drag.planeNormal);
    if (!hit) return;
    const local = {
      x: (hit.x - drag.planePoint.x) / MKW_RENDER_SCALE,
      y: (hit.y - drag.planePoint.y) / MKW_RENDER_SCALE,
      z: (hit.z - drag.planePoint.z) / MKW_RENDER_SCALE,
    };
    const currentU = drag.plane === 'xy' || drag.plane === 'xz' ? local.x : local.y;
    const currentV = drag.plane === 'xy' ? local.y : local.z;
    const factorU = Math.max(0.05, Math.min(20, Math.abs(currentU) / Math.max(0.1, Math.abs(drag.startU))));
    const factorV = Math.max(0.05, Math.min(20, Math.abs(currentV) / Math.max(0.1, Math.abs(drag.startV))));
    const scale =
      drag.plane === 'xy'
        ? { x: drag.scale.x * factorU, y: drag.scale.y * factorV, z: drag.scale.z }
        : drag.plane === 'xz'
          ? { x: drag.scale.x * factorU, y: drag.scale.y, z: drag.scale.z * factorV }
          : { x: drag.scale.x, y: drag.scale.y * factorU, z: drag.scale.z * factorV };
    setDragPreview({ id: selection.id, position: selection.position, rotation: selection.rotation, scale });
    if (target.kind === 'kmp' && target.entity) {
      syncRenderedGobjTransform(target.entity, selection.position, selection.rotation, scale);
      scheduleInteractionCommit({ kind: 'scaleEntity', entity: target.entity, scale });
    } else {
      syncRenderedTransformSelection(selection, selection.position, selection.rotation, scale);
      scheduleInteractionCommit({ kind: 'scaleTransformSelection', selection, scale });
    }
    return;
  }
  const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, drag.planePoint, drag.planeNormal);
  if (!hit) return;
  const worldDelta = (dot(subVec3(hit, drag.axisOrigin), drag.axisDirection) - drag.startAxisOffset) / MKW_RENDER_SCALE;
  if (toolRef.current === 'translate') {
    let position = addAxisDelta(drag.position, drag.axis, worldDelta);
    if (snapToFeatures) position = snapDraggedPositionToCollision(position);
    setDragPreview({ id: selection.id, position, rotation: selection.rotation, scale: selection.scale });
    if (target.kind === 'kmp' && target.entity) {
      syncRenderedGobjTransform(target.entity, position, selection.rotation, selection.scale);
      scheduleInteractionCommit({ kind: 'moveEntity', entity: target.entity, position });
    } else {
      syncRenderedTransformSelection(selection, position, selection.rotation, selection.scale);
      scheduleInteractionCommit({ kind: 'moveTransformSelection', selection, position });
    }
    return;
  }
  if (toolRef.current === 'scale' && drag.scale) {
    const factor = Math.max(0.05, 1 + worldDelta / 350);
    const scale = multiplyAxis(drag.scale, drag.axis, factor);
    setDragPreview({ id: selection.id, position: selection.position, rotation: selection.rotation, scale });
    if (target.kind === 'kmp' && target.entity) {
      syncRenderedGobjTransform(target.entity, selection.position, selection.rotation, scale);
      scheduleInteractionCommit({ kind: 'scaleEntity', entity: target.entity, scale });
    } else {
      syncRenderedTransformSelection(selection, selection.position, selection.rotation, scale);
      scheduleInteractionCommit({ kind: 'scaleTransformSelection', selection, scale });
    }
  }
}

function snapDraggedPositionToCollision(position: Vec3): Vec3 {
  const kcl = trackRef.current?.kcl;
  if (!kcl) return position;
  const hit = raycastMesh(kcl, { x: position.x, y: 100000, z: position.z }, { x: 0, y: -1, z: 0 });
  if (!hit) return position;
  return snapPointToTriangleFeature(hit.position, hit.triangle).position;
}

  function handleCheckpointEndpointPointerMove(clientX: number, clientY: number, drag: CheckpointDragState, snapToFeatures = false) {
    const entity = trackRef.current?.kmp?.entities.find((candidate) => candidate.id === drag.id);
    if (!entity?.checkpoint) return;
    const current = entity.checkpoint[drag.side];
    const next = placeFromScreen(clientX, clientY, current.y, snapToFeatures);
    if (next) scheduleInteractionCommit({ kind: 'moveCheckpointEndpoint', entity, side: drag.side, position: next });
  }

  function handleCameraViewPointPointerMove(clientX: number, clientY: number, drag: CameraViewPointDragState, snapToFeatures = false) {
    const entity = trackRef.current?.kmp?.entities.find((candidate) => candidate.id === drag.id);
    if (!entity?.cameraView) return;
    const current = drag.which === 'start' ? entity.cameraView.start : entity.cameraView.end;
    const next = placeFromScreen(clientX, clientY, current.y, snapToFeatures);
    if (next) scheduleInteractionCommit({ kind: 'moveCameraViewPoint', entity, which: drag.which, position: next });
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const rawObjectId = event.dataTransfer.getData('application/mkw-object-id');
    const rawKmpSection = event.dataTransfer.getData('application/mkw-point-section') as AppendableKmpSection | '';
    if (!rawObjectId && !rawKmpSection) return;
    const position = placeFromScreen(event.clientX, event.clientY, 0, isCollisionSnapModifier(event));
    if (!position) return;
    if (rawKmpSection) {
      onAddKmpPoint?.(rawKmpSection, position);
      return;
    }
    const objectId = Number(rawObjectId);
    if (Number.isFinite(objectId)) onAddObject?.(objectId, position);
  }

  function handleCanvasClick(event: MouseEvent<HTMLCanvasElement>) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    const track = trackRef.current;
    const canvas = canvasRef.current;
    if (!track?.kmp || !canvas || draggingEntityRef.current) return;
    const scene = sceneRef.current as SceneGfx & {
      pickEditorHandle?: (normalizedX: number, normalizedY: number) => SceneOverlayPick | null;
    } | null;
    if (event.altKey) {
      const candidate = onInsertRoutePoint ? resolveRouteInsertCandidate(event.clientX, event.clientY, isCollisionSnapModifier(event)) : null;
      event.preventDefault();
      event.stopPropagation();
      if (candidate) onInsertRoutePoint?.(candidate.target, candidate.position);
      return;
    }
    const scenePick = pickSceneHandle(scene, event.clientX, event.clientY, canvas);
    const pickedTransformSelection = pickTransformSelectionFromPick(scenePick);
    if (pickedTransformSelection?.kind === 'external') {
      onSelectTransformSelectionRef.current?.(pickedTransformSelection.selection.id);
      return;
    }
    if (modeRef.current === 'model') {
      // Do not re-pick when the click was really the end of a gizmo drag.
      if (scenePick && (scenePick.kind === 'axis' || scenePick.kind === 'plane' || scenePick.kind === 'center')) return;
      selectMeshFromClient(event.clientX, event.clientY, isAdditiveSelectionModifier(event));
      return;
    }
    const picked = pickedTransformSelection?.entity ?? pickEntityFromPick(scenePick) ?? pickEntityFromScreenPosition(event.clientX, event.clientY);
    onSelect(picked?.id ?? null, { additive: isAdditiveSelectionModifier(event) });
  }

  function handleCanvasContextMenu(event: MouseEvent<HTMLCanvasElement>) {
    event.preventDefault();
  }

  function releaseCameraLook(canvas: HTMLCanvasElement | null = canvasRef.current) {
    const drag = cameraLookDragRef.current;
    if (!drag) return;
    if (canvas?.hasPointerCapture?.(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    viewerRef.current?.inputManager.onGrabReleased();
    cameraLookDragRef.current = null;
    setViewportCameraLookActive(false);
    if (canvas && document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
  }

  function completeMarqueeSelection(canvas: HTMLCanvasElement | null) {
    const marquee = marqueeSelectionRef.current;
    marqueeSelectionRef.current = null;
    setMarqueeSelection(null);
    suppressNextClickRef.current = true;
    if (!canvas || !marquee) return;
    if (modeRef.current === 'model') {
      selectMeshesInMarquee(marquee, canvas);
      return;
    }
    const scene = sceneRef.current as SceneGfx & {
      pickEditorPointsInRect?: (normalizedX0: number, normalizedY0: number, normalizedX1: number, normalizedY1: number) => string[];
    } | null;
    const selectedIds = pickScenePointsInRect(scene, marquee, canvas);
    onSelectMany?.(selectedIds, { additive: marquee.additive });
  }

  /** Model mode marquee: every mesh whose centre falls inside the rectangle. */
  function selectMeshesInMarquee(marquee: MarqueeSelectionState, canvas: HTMLCanvasElement) {
    const scene = getMeshScene();
    if (!scene?.pickEditorMeshesInRect) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const picks = scene.pickEditorMeshesInRect(
      clamp01((marquee.startX - rect.left) / rect.width),
      clamp01((marquee.startY - rect.top) / rect.height),
      clamp01((marquee.currentX - rect.left) / rect.width),
      clamp01((marquee.currentY - rect.top) / rect.height),
      meshGranularityRef.current,
    );
    const entries: MeshSelectionEntry[] = [];
    for (const pick of picks) {
      const entry = makeMeshEntryFromTarget(toMeshTarget(pick, meshGranularityRef.current), describeMeshPick(pick));
      if (entry && !entries.some((candidate) => candidate.key === entry.key)) entries.push(entry);
    }
    const next = marquee.additive
      ? [...meshSelectionsRef.current, ...entries.filter((entry) => !meshSelectionsRef.current.some((candidate) => candidate.key === entry.key))]
      : entries;
    applyMeshSelection(next, true, marquee.additive);
  }

  function pickEntityFromPick(pick: SceneOverlayPick | null): KmpEntity | null {
    if (!pick) return null;
    return trackRef.current?.kmp?.entities.find((entity) => entity.id === pick.id) ?? null;
  }

  function toEntityTransformSelection(entity: KmpEntity): ViewportTransformSelection {
    return {
      id: entity.id,
      label: getEntityLabel(entity),
      position: entity.position,
      rotation: entity.rotation,
      scale: entity.scale,
    };
  }

  function pickTransformSelectionFromPick(pick: SceneOverlayPick | null): TransformSelectionTarget | null {
    if (!pick) return null;
    const meshTarget = findMeshTransformSelection(pick.id);
    if (meshTarget) return meshTarget;
    if (transformSelectionRef.current && pick.id === transformSelectionRef.current.id) {
      return { kind: 'external', selection: transformSelectionRef.current };
    }
    const external = transformSelectionsRef.current.find((candidate) => candidate.id === pick.id);
    if (external) return { kind: 'external', selection: external };
    const entity = pickEntityFromPick(pick);
    if (!entity) return null;
    return { kind: 'kmp', entity, selection: toEntityTransformSelection(entity) };
  }

  function findTransformSelectionById(id: string): TransformSelectionTarget | null {
    const meshTarget = findMeshTransformSelection(id);
    if (meshTarget) return meshTarget;
    if (transformSelectionRef.current?.id === id) return { kind: 'external', selection: transformSelectionRef.current };
    const external = transformSelectionsRef.current.find((candidate) => candidate.id === id);
    if (external) return { kind: 'external', selection: external };
    const entity = trackRef.current?.kmp?.entities.find((candidate) => candidate.id === id);
    if (!entity) return null;
    return { kind: 'kmp', entity, selection: toEntityTransformSelection(entity) };
  }

  function pickEntityFromScreenPosition(clientX: number, clientY: number): KmpEntity | null {
    if (!showKmpEditorOverlayRef.current) return null;
    const track = trackRef.current;
    const viewer = viewerRef.current;
    const canvas = canvasRef.current;
    if (!track?.kmp || !viewer || !canvas) return null;
    const routeUsage = getPotiRouteUsage(track.kmp);
    return pickEntityFromScreen(
      getVisibleEntitiesForRouteFilter(track.kmp.entities, routeVisibilityRef.current, track.kmp, routeUsage),
      clientX,
      clientY,
      canvas,
      viewer,
    );
  }

  function syncRenderedGobjTransforms(nextTrack: TrackDocument | null) {
    if (!nextTrack?.kmp || !sceneRef.current) return;
    for (const entity of nextTrack.kmp.entities) syncRenderedGobjTransform(entity, entity.position, entity.rotation, entity.scale);
  }

  function syncRenderedGobjTransform(entity: KmpEntity, position: Vec3, rotation?: Vec3, scale?: Vec3) {
    if (entity.section !== 'GOBJ' || !rotation || !scale) return;
    const scene = sceneRef.current as SceneGfx & {
      updateEditorGobjTransform?: (index: number, translation: Vec3, rotation: Vec3, scale: Vec3) => boolean;
    } | null;
    scene?.updateEditorGobjTransform?.(entity.index, position, rotation, scale);
  }

  function syncRenderedTransformSelection(selection: ViewportTransformSelection, position: Vec3, rotation?: Vec3, scale?: Vec3) {
    const scene = sceneRef.current as SceneGfx & BrresViewportPreviewScene | null;
    syncBrresViewportTransformSelectionPreview(scene, selection, position, rotation, scale);
  }

  //#region Model mode: mesh picking / transforming

  function getMeshScene(): (SceneGfx & EditorMeshRendererScene) | null {
    return sceneRef.current as (SceneGfx & EditorMeshRendererScene) | null;
  }

  function pickMeshAtClient(clientX: number, clientY: number): EditorMeshPickPayload | null {
    const canvas = canvasRef.current;
    const scene = getMeshScene();
    if (!canvas || !scene?.pickEditorMesh) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return scene.pickEditorMesh((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height, meshGranularityRef.current);
  }

  function getMeshBounds(target: EditorMeshTarget): EditorMeshBoundsPayload | null {
    return getMeshScene()?.getEditorMeshComponentBounds?.(target) ?? null;
  }

  function makeMeshEntryFromTarget(target: EditorMeshTarget, label: string, transform?: MeshTransform): MeshSelectionEntry | null {
    const bounds = getMeshBounds(target);
    if (!bounds) return null;
    const current = transform ?? createIdentityMeshTransform();
    // `getEditorMeshComponentBounds` reports the *current* box, so back out the live offset.
    const baseCenter = {
      x: bounds.center.x - current.translation.x,
      y: bounds.center.y - current.translation.y,
      z: bounds.center.z - current.translation.z,
    };
    return makeMeshSelectionEntry(target, label, baseCenter, current);
  }

  function applyMeshSelection(next: MeshSelectionEntry[], notify: boolean, additive = false) {
    setMeshSelections(next);
    meshSelectionsRef.current = next;
    updateMeshHighlight();
    if (notify) {
      onSelectMeshRef.current?.(next.length > 0 ? next[next.length - 1].target : null, {
        additive,
        targets: next.map((entry) => entry.target),
      });
    }
  }

  function updateMeshHighlight() {
    const scene = getMeshScene();
    if (!scene?.setEditorMeshHighlight) return;
    if (modeRef.current !== 'model') {
      scene.setEditorMeshHighlight([]);
      return;
    }
    const targets: Array<{ target: EditorMeshTarget; selected: boolean }> = meshSelectionsRef.current.map((entry) => ({
      target: entry.target,
      selected: true,
    }));
    const hovered = hoveredMeshRef.current;
    if (hovered && !meshSelectionsRef.current.some((entry) => entry.key === hovered.key))
      targets.push({ target: hovered.target, selected: false });
    scene.setEditorMeshHighlight(targets);
  }

  function selectMeshFromClient(clientX: number, clientY: number, additive: boolean): boolean {
    const pick = pickMeshAtClient(clientX, clientY);
    if (!pick) {
      if (!additive) applyMeshSelection([], true, additive);
      return false;
    }
    const target = toMeshTarget(pick, meshGranularityRef.current);
    const entry = makeMeshEntryFromTarget(target, describeMeshPick(pick));
    if (!entry) return false;
    applyMeshSelection(applyMeshSelectionClick(meshSelectionsRef.current, entry, additive), true, additive);
    return true;
  }

  function updateHoveredMesh(clientX: number, clientY: number) {
    if (modeRef.current !== 'model') {
      if (hoveredMeshRef.current !== null) {
        hoveredMeshRef.current = null;
        setHoveredMeshKey(null);
        updateMeshHighlight();
      }
      return;
    }
    const pick = pickMeshAtClient(clientX, clientY);
    const target = pick ? toMeshTarget(pick, meshGranularityRef.current) : null;
    const key = target ? meshTargetKey(target) : null;
    if (key === (hoveredMeshRef.current?.key ?? null)) return;
    hoveredMeshRef.current = target && key ? { key, target } : null;
    setHoveredMeshKey(key);
    updateMeshHighlight();
  }

  function changeMeshGranularity(next: MeshSelectionGranularity) {
    if (next === meshGranularityRef.current) return;
    meshGranularityRef.current = next;
    if (meshGranularity === undefined) setInternalMeshGranularity(next);
    onChangeMeshGranularityRef.current?.(next);
    const retargeted = meshSelectionsRef.current
      .map((entry) => makeMeshEntryFromTarget(retargetMeshGranularity(entry.target, next), entry.label, entry.transform))
      .filter((entry): entry is MeshSelectionEntry => entry !== null);
    // De-duplicate: widening can collapse several components onto one shape.
    const unique: MeshSelectionEntry[] = [];
    for (const entry of retargeted) if (!unique.some((candidate) => candidate.key === entry.key)) unique.push(entry);
    applyMeshSelection(unique, true);
  }

  /** Frames the free camera on the current mesh selection (F in model mode). */
  function frameMeshSelection(): boolean {
    const viewer = viewerRef.current;
    const entry = meshSelectionsRef.current[meshSelectionsRef.current.length - 1];
    if (!viewer || !entry) return false;
    const bounds = getMeshBounds(entry.target);
    if (!bounds) return false;
    const controller = viewer.cameraController instanceof FPSCameraController ? viewer.cameraController : new FPSCameraController();
    if (!(viewer.cameraController instanceof FPSCameraController)) viewer.setCameraController(controller);
    const radius = Math.max(60, bounds.radius) * MKW_RENDER_SCALE;
    const center = vec3.fromValues(
      bounds.center.x * MKW_RENDER_SCALE,
      bounds.center.y * MKW_RENDER_SCALE,
      bounds.center.z * MKW_RENDER_SCALE,
    );
    applyFPSCameraFrame(controller, {
      eye: vec3.fromValues(center[0] + radius * 1.6, center[1] + radius * 1.1, center[2] + radius * 1.9),
      target: center,
    });
    controller.update(viewer.inputManager, 0);
    viewer.camera.worldMatrixUpdated();
    return true;
  }

  /**
   * Adds an object BRRES to the scene as course geometry. `matrix` is optional; when it is
   * omitted the model is placed at `position` (game units) with `scale` applied.
   */
  function addImportedMeshInstance(
    brres: ArrayBuffer | Uint8Array,
    modelName: string | null,
    placement: { position?: Vec3; rotation?: Vec3; scale?: Vec3 } = {},
  ): string | null {
    const viewer = viewerRef.current;
    const scene = getMeshScene();
    if (!viewer || !scene?.addEditorModelInstance) return null;
    const bytes = brres instanceof Uint8Array ? brres : new Uint8Array(brres);
    const slice = new ArrayBufferSlice(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const matrix = mat4.create();
    const position = placement.position ?? { x: 0, y: 0, z: 0 };
    const rotation = placement.rotation ?? { x: 0, y: 0, z: 0 };
    const scale = placement.scale ?? { x: 1, y: 1, z: 1 };
    const deg = Math.PI / 180;
    mat4.fromTranslation(matrix, [position.x * MKW_RENDER_SCALE, position.y * MKW_RENDER_SCALE, position.z * MKW_RENDER_SCALE]);
    mat4.rotateY(matrix, matrix, rotation.y * deg);
    mat4.rotateX(matrix, matrix, rotation.x * deg);
    mat4.rotateZ(matrix, matrix, rotation.z * deg);
    mat4.scale(matrix, matrix, [scale.x * MKW_RENDER_SCALE, scale.y * MKW_RENDER_SCALE, scale.z * MKW_RENDER_SCALE]);
    return scene.addEditorModelInstance(viewer.gfxDevice, slice, modelName, matrix);
  }

  /** Scene-space placement matrix for an imported mesh, in the renderer's units. */
  function importedMeshMatrix(transform: MeshTransform): mat4 {
    const matrix = mat4.create();
    const deg = Math.PI / 180;
    mat4.fromTranslation(matrix, [
      transform.translation.x * MKW_RENDER_SCALE,
      transform.translation.y * MKW_RENDER_SCALE,
      transform.translation.z * MKW_RENDER_SCALE,
    ]);
    mat4.rotateY(matrix, matrix, transform.rotation.y * deg);
    mat4.rotateX(matrix, matrix, transform.rotation.x * deg);
    mat4.rotateZ(matrix, matrix, transform.rotation.z * deg);
    mat4.scale(matrix, matrix, [
      transform.scale.x * MKW_RENDER_SCALE,
      transform.scale.y * MKW_RENDER_SCALE,
      transform.scale.z * MKW_RENDER_SCALE,
    ]);
    return matrix;
  }

  /** Fallback label for a target that came from the outliner rather than from a pick. */
  function describeMeshTarget(target: EditorMeshTarget): string {
    const listed = getMeshScene()?.listEditorMeshes?.() ?? [];
    const match = listed.find(
      (entry: { drawOpIndex?: number; shapeName?: string; nodeName?: string }) => entry.drawOpIndex === target.drawOpIndex,
    );
    if (target.granularity === 'node') return match?.nodeName || `Bone ${target.nodeId}`;
    return match?.shapeName || `Mesh ${target.drawOpIndex + 1}`;
  }

  function removeImportedMeshInstance(id: string): boolean {
    const viewer = viewerRef.current;
    const scene = getMeshScene();
    if (!viewer || !scene?.removeEditorModelInstance) return false;
    return scene.removeEditorModelInstance(viewer.gfxDevice, id);
  }

  function applyMeshTransform(key: string, transform: MeshTransform) {
    const next = updateMeshSelectionTransform(meshSelectionsRef.current, key, transform);
    setMeshSelections(next);
    meshSelectionsRef.current = next;
  }

  function getMeshTransformSelections(): ViewportTransformSelection[] {
    if (modeRef.current !== 'model') return [];
    return meshSelectionsRef.current.map((entry) =>
      toMeshViewportTransformSelection(entry.target, entry.baseCenter, entry.transform, entry.label, meshSelectionGizmoId(entry)),
    );
  }

  function findMeshTransformSelection(id: string): TransformSelectionTarget | null {
    if (!id.startsWith('editor-mesh::')) return null;
    const key = meshSelectionKeyFromGizmoId(id);
    const entry = meshSelectionsRef.current.find((candidate) => candidate.key === key);
    if (!entry) return null;
    return {
      kind: 'external',
      selection: toMeshViewportTransformSelection(entry.target, entry.baseCenter, entry.transform, entry.label, id),
    };
  }

  //#endregion

  //#region Camera preview playback

  function getCameraPreviewDef(request: CameraPreviewRequest | null): CameraPreviewDef | null {
    if (!request) return null;
    return findCameraPreviewDef(cameraPreviewDefsRef.current, request.cameraId);
  }

  function beginCameraPreview(viewer: Viewer): void {
    const state = cameraPreviewStateRef.current;
    if (state.active) return;
    state.active = true;
    state.frames = 0;
    state.lastTimeMs = null;
    state.savedCameraMatrix = mat4.clone(viewer.camera.worldMatrix);
    state.savedFovY = viewer.camera.fovY;
    previousCameraControllerRef.current = viewer.cameraController;
    viewer.setCameraController(new PreviewCameraController());
    setViewportCameraLookActive(false);
  }

  function endCameraPreview(viewer: Viewer | null, restore: boolean): void {
    const state = cameraPreviewStateRef.current;
    if (!state.active) return;
    state.active = false;
    state.sequence = null;
    state.lastTimeMs = null;
    setCameraPreviewLabel(null);
    if (!viewer) return;
    const previous = previousCameraControllerRef.current;
    previousCameraControllerRef.current = null;
    if (previous) viewer.setCameraController(previous);
    else viewer.setCameraController(new FPSCameraController());
    if (restore && state.savedCameraMatrix) {
      mat4.copy(viewer.camera.worldMatrix, state.savedCameraMatrix);
      if (state.savedFovY !== null) viewer.camera.setPerspective(state.savedFovY, getViewerAspect(viewer), 4, 500000);
      viewer.camera.worldMatrixUpdated();
      viewer.cameraController?.cameraUpdateForced();
    }
    state.savedCameraMatrix = null;
    state.savedFovY = null;
  }

  function stepCameraPreview(timeMs: number): void {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const request = cameraPreviewRef.current;
    const state = cameraPreviewStateRef.current;
    if (!request) {
      endCameraPreview(viewer, true);
      return;
    }
    const startDef = getCameraPreviewDef(request);
    if (!startDef) {
      endCameraPreview(viewer, true);
      return;
    }
    if (!state.active || state.startIndex !== startDef.index) {
      if (state.active && state.startIndex !== startDef.index) {
        state.frames = 0;
        state.lastTimeMs = null;
      }
      state.startIndex = startDef.index;
      state.seek = request.seek;
      beginCameraPreview(viewer);
      state.sequence = request.sequence ? buildOpeningCameraChain(cameraPreviewDefsRef.current, startDef.index) : null;
    }

    // A bumped `seek` restarts the clock at `request.time` without leaving preview mode.
    if (request.seek !== state.seek) {
      state.seek = request.seek;
      state.frames = Math.max(0, request.time);
      state.lastTimeMs = null;
    }

    if (request.playing) {
      const delta = state.lastTimeMs === null ? 0 : timeMs - state.lastTimeMs;
      state.lastTimeMs = timeMs;
      state.frames = advancePreviewFrames(state.frames, delta);
    } else {
      state.lastTimeMs = null;
      state.frames = Math.max(0, request.time);
    }

    let def = startDef;
    let localFrames = state.frames;
    if (state.sequence && state.sequence.length > 0) {
      const sample = sampleOpeningSequence(state.sequence, state.frames);
      if (!sample) {
        onCameraPreviewEndRef.current?.();
        endCameraPreview(viewer, true);
        return;
      }
      def = cameraPreviewDefsRef.current.find((candidate) => candidate.index === sample.cameraIndex) ?? startDef;
      localFrames = sample.localFrame;
    } else if (def.time > 0 && state.frames > def.time && request.playing) {
      onCameraPreviewEndRef.current?.();
      endCameraPreview(viewer, true);
      return;
    }

    const pose = sampleCameraPose(def, localFrames);
    computePreviewCameraMatrix(cameraPreviewMatrixRef.current, pose, MKW_RENDER_SCALE);
    mat4.copy(viewer.camera.worldMatrix, cameraPreviewMatrixRef.current);
    viewer.camera.setPerspective(toCameraFovY(pose.fovDegrees), getViewerAspect(viewer), 4, 500000);
    viewer.camera.worldMatrixUpdated();
    viewer.cameraController?.cameraUpdateForced();
    const label = `Camera ${def.index} - ${Math.round(localFrames)}f`;
    if (label !== cameraPreviewLabelRef.current) {
      cameraPreviewLabelRef.current = label;
      setCameraPreviewLabel(label);
    }
    onCameraPreviewProgressRef.current?.({
      frames: state.frames,
      cameraIndex: def.index,
      localFrames,
      totalFrames: state.sequence ? getOpeningSequenceDuration(state.sequence) : Math.max(0, startDef.time),
    });
  }

  /** Chains through the opening cameras starting at the CAME header's intro camera. */
  function playOpeningSequence(): boolean {
    const kmp = trackRef.current?.kmp;
    if (!kmp) return false;
    const overlay = buildCameraOverlay(kmp);
    if (overlay.openingChain.length === 0) return false;
    const first = overlay.openingChain[0];
    const state = cameraPreviewStateRef.current;
    state.frames = 0;
    state.lastTimeMs = null;
    cameraPreviewRef.current = { cameraId: `CAME-${first.cameraIndex}`, playing: true, time: 0, sequence: true };
    return true;
  }

  /**
   * The free camera's world matrix. While a preview is playing the live matrix belongs to the
   * CAME pose, so the saved pre-preview matrix is used instead: the "from viewport" buttons
   * always mean the camera the user was flying.
   */
  function getFreeCameraMatrix(): mat4 | null {
    const viewer = viewerRef.current;
    if (!viewer) return null;
    const state = cameraPreviewStateRef.current;
    return state.active && state.savedCameraMatrix ? state.savedCameraMatrix : viewer.camera.worldMatrix;
  }

  function getFreeCameraController(viewer: Viewer): FPSCameraController {
    if (viewer.cameraController instanceof FPSCameraController) return viewer.cameraController;
    const controller = new FPSCameraController();
    viewer.setCameraController(controller);
    return controller;
  }

  const cameraViewportApi: CameraViewportApi = {
    getFreeCameraPose() {
      const world = getFreeCameraMatrix();
      if (!world) return null;
      const position = { x: world[12] / MKW_RENDER_SCALE, y: world[13] / MKW_RENDER_SCALE, z: world[14] / MKW_RENDER_SCALE };
      // gl-matrix `targetTo` puts `eye - target` in the third column, so forward is its negation.
      const forward = { x: -world[8], y: -world[9], z: -world[10] };
      const length = Math.hypot(forward.x, forward.y, forward.z) || 1;
      const unit = { x: forward.x / length, y: forward.y / length, z: forward.z / length };
      const reach = 2000;
      return {
        position,
        target: { x: position.x + unit.x * reach, y: position.y + unit.y * reach, z: position.z + unit.z * reach },
        rotation: eulerFromLookDirection(unit),
      };
    },
    lookFrom(position, target) {
      const viewer = viewerRef.current;
      if (!viewer) return false;
      const controller = getFreeCameraController(viewer);
      applyFPSCameraFrame(controller, {
        eye: vec3.fromValues(position.x * MKW_RENDER_SCALE, position.y * MKW_RENDER_SCALE, position.z * MKW_RENDER_SCALE),
        target: vec3.fromValues(target.x * MKW_RENDER_SCALE, target.y * MKW_RENDER_SCALE, target.z * MKW_RENDER_SCALE),
      });
      controller.update(viewer.inputManager, 0);
      viewer.camera.worldMatrixUpdated();
      return true;
    },
    frameCamera(position, target) {
      const viewer = viewerRef.current;
      if (!viewer) return false;
      let dx = target.x - position.x;
      let dy = target.y - position.y;
      let dz = target.z - position.z;
      const span = Math.hypot(dx, dy, dz);
      if (span <= 1e-4) {
        dx = 0;
        dy = 0;
        dz = 1;
      } else {
        dx /= span;
        dy /= span;
        dz /= span;
      }
      const distance = Math.max(900, Math.min(9000, span * 0.45));
      const eye = vec3.fromValues(
        (position.x - dx * distance) * MKW_RENDER_SCALE,
        (position.y - dy * distance + distance * 0.35) * MKW_RENDER_SCALE,
        (position.z - dz * distance) * MKW_RENDER_SCALE,
      );
      const controller = getFreeCameraController(viewer);
      applyFPSCameraFrame(controller, {
        eye,
        target: vec3.fromValues(position.x * MKW_RENDER_SCALE, position.y * MKW_RENDER_SCALE, position.z * MKW_RENDER_SCALE),
      });
      controller.update(viewer.inputManager, 0);
      viewer.camera.worldMatrixUpdated();
      return true;
    },
    pickCenterPoint() {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return placeFromScreen(rect.left + rect.width / 2, rect.top + rect.height / 2);
    },
  };
  if (cameraViewportApiRef) cameraViewportApiRef.current = cameraViewportApi;
  useEffect(() => {
    if (!cameraViewportApiRef) return;
    return () => {
      cameraViewportApiRef.current = null;
    };
  }, [cameraViewportApiRef]);

  //#endregion

  function syncSceneOverlay(nextTrack: TrackDocument | null, nextSelectedId: string | null) {
    const scene = sceneRef.current as SceneGfx & {
      setEditorOverlayData?: (data: SceneOverlayData) => void;
    } | null;
    overlayCameraPositionRef.current = getViewerCameraPosition(viewerRef.current);
    const cameraOverlay = modeRef.current === 'camera'
      ? buildCameraOverlay(nextTrack?.kmp ?? null, {
          selectedIds: new Set([...(selectedIdsRef.current ?? []), ...(nextSelectedId ? [nextSelectedId] : [])]),
          hoveredId: hoveredIdRef.current,
        })
      : { cameraGizmos: [], cameraChainLinks: [] };
    scene?.setEditorOverlayData?.(
      buildSceneOverlayData(
        nextTrack,
        nextSelectedId,
        selectedIdsRef.current,
        transformSelectionRef.current,
        transformSelectionsRef.current,
        showKmpEditorOverlayRef.current && modeRef.current !== 'model' && modeRef.current !== 'visual',
        fillBetweenPreviewPositions,
        previewTransform,
        hoveredIdRef.current,
        hoveredHandleRef.current,
        activeHandleRef.current,
        collisionVisibleRef.current,
        toolRef.current,
        routeVisibilityRef.current,
        viewModeRef.current,
        getViewerCameraPosition(viewerRef.current),
        routeInsertPreview,
        cameraOverlay.cameraGizmos,
        cameraOverlay.cameraChainLinks,
        getMeshTransformSelections(),
        {
          pathGroupColors,
          showCheckpointQuads,
          pathLinkSection,
          pathLinkDrag: pathLinkDragRef.current,
          checkpointDraw: checkpointDrawRef.current,
        },
      ),
    );
  }

  function updateHoveredEntity(clientX: number, clientY: number, canvas: HTMLCanvasElement) {
    const scene = sceneRef.current as SceneGfx & {
      pickEditorHandle?: (normalizedX: number, normalizedY: number) => SceneOverlayPick | null;
    } | null;
    const scenePick = pickSceneHandle(scene, clientX, clientY, canvas);
    setHoveredGizmoHandle(pickToGizmoHandle(scenePick));
    if (modeRef.current === 'model') {
      if (!scenePick) updateHoveredMesh(clientX, clientY);
      if (hoveredIdRef.current !== null) setHoveredId(null);
      return;
    }
    const hoveredTransformSelection = pickTransformSelectionFromPick(scenePick);
    const hovered = hoveredTransformSelection?.entity ?? pickEntityFromPick(scenePick) ?? pickEntityFromScreenPosition(clientX, clientY);
    const nextHoveredId = hoveredTransformSelection?.selection.id ?? hovered?.id ?? null;
    if (nextHoveredId !== hoveredIdRef.current) setHoveredId(nextHoveredId);
  }

  function updateRouteInsertPreview(clientX: number, clientY: number, altKey: boolean, snapToFeatures: boolean) {
    if (!altKey || draggingEntityRef.current || pendingEntityDragRef.current || marqueeSelectionRef.current || cameraLookDragRef.current) {
      setRouteInsertPreview(null);
      return;
    }
    const next = resolveRouteInsertCandidate(clientX, clientY, snapToFeatures);
    setRouteInsertPreview((current) => (routeInsertPreviewEquals(current, next) ? current : next));
  }

  function resolveRouteInsertCandidate(clientX: number, clientY: number, snapToFeatures: boolean): RouteInsertCandidate | null {
    const track = trackRef.current;
    const canvas = canvasRef.current;
    const viewer = viewerRef.current;
    if (!track?.kmp || !canvas || !viewer) return null;
    const cursorPosition = placeFromScreen(clientX, clientY, 0, snapToFeatures);
    if (!cursorPosition) return null;
    return getRouteInsertCandidate(track.kmp, selectedIdRef.current, cursorPosition, clientX, clientY, canvas, viewer);
  }

  function applyViewMode(nextTrack: TrackDocument | null, resetFrame: boolean) {
    const viewer = viewerRef.current;
    const scene = sceneRef.current as SceneGfx & {
      setEditorViewMode?: (mode: ViewMode) => void;
    } | null;
    if (!viewer || !nextTrack || !scene) return;

    const nextMode = viewModeRef.current;
    scene.setEditorViewMode?.(nextMode);
    if (nextMode === 'normal' || nextMode === 'dev') {
      const shouldResetCamera = resetFrame || !(viewer.cameraController instanceof FPSCameraController);
      const controller = viewer.cameraController instanceof FPSCameraController ? viewer.cameraController : new FPSCameraController();
      if (!(viewer.cameraController instanceof FPSCameraController)) viewer.setCameraController(controller);
      viewer.camera.setPerspective(Math.PI / 3, getViewerAspect(viewer), 4, 500000);
      if (shouldResetCamera) {
        applyFPSCameraFrame(controller, getInitialCameraFrame(nextTrack));
        controller.update(viewer.inputManager, 0);
      }
      viewer.camera.worldMatrixUpdated();
      return;
    }

    const bounds = getTrackViewBounds(nextTrack) ?? {
      center: vec3.fromValues(0, 0, 0),
      radius: 480,
    };
    const controller = viewer.cameraController instanceof OrthoCameraController ? viewer.cameraController : new OrthoCameraController();
    if (!(viewer.cameraController instanceof OrthoCameraController)) viewer.setCameraController(controller);
    vec3.copy(controller.translation, bounds.center);
    controller.txVel = 0;
    controller.tyVel = 0;
    controller.shouldOrbit = false;
    controller.z = -Math.max(220, bounds.radius * 2.4);
    controller.zTarget = controller.z;
    if (nextMode === 'topdown') {
      controller.x = -Math.PI * 0.5;
      controller.xTarget = controller.x;
      controller.y = Math.PI - 0.001;
      controller.yTarget = controller.y;
    } else {
      controller.x = -Math.PI * 0.75;
      controller.xTarget = controller.x;
      controller.y = Math.PI * 0.68;
      controller.yTarget = controller.y;
    }
    controller.forceUpdate = true;
    controller.update(viewer.inputManager, 0);
  }

  return (
    <section ref={viewportRef} className="viewport" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <div ref={uiContainerRef} className="noclipUiHost" />
      <div className="viewportToolbar">
        <div className="segmented viewportToolSegmented" aria-label="Viewport tool">
          <button
            type="button"
            className={tool === 'translate' ? 'active' : ''}
            onClick={() => onChangeTool?.('translate')}
            title="Translate"
            aria-label="Translate"
          >
            <Move3D size={16} />
          </button>
          <button
            type="button"
            className={tool === 'rotate' ? 'active' : ''}
            onClick={() => onChangeTool?.('rotate')}
            title="Rotate"
            aria-label="Rotate"
          >
            <RotateCcw size={16} />
          </button>
          <button
            type="button"
            className={tool === 'scale' ? 'active' : ''}
            onClick={() => onChangeTool?.('scale')}
            title="Scale"
            aria-label="Scale"
          >
            <Scale3D size={16} />
          </button>
        </div>
        <label className="viewportModeSelect">
          <span>View</span>
          <select value={viewMode} onChange={(event) => onChangeViewMode?.(event.currentTarget.value as ViewMode)} aria-label="Viewport view mode">
            <option value="normal">Normal</option>
            <option value="dev">Dev</option>
            <option value="topdown">Top</option>
            <option value="ortho">Ortho</option>
          </select>
        </label>
      </div>
      <div className="viewportTopRightStack">
        <div className="routeVisibilityHud">
          <button
            type="button"
            className="iconButton routeVisibilityButton"
            onClick={() => setRoutePanelOpen((value) => !value)}
            aria-label={routePanelOpen ? 'Hide route visibility' : 'Show route visibility'}
            title={routePanelOpen ? 'Hide route visibility' : 'Show route visibility'}
          >
            {routeItems.some((item) => routeVisibility[item.key] === false) ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          {routePanelOpen && (
            <div className="routeVisibilityPanel">
              <strong>Visibility</strong>
              {routeItems.length === 0 ? (
                <span className="routeVisibilityEmpty">No routes in the loaded track.</span>
              ) : (
                routeItems.map((item) => (
                  <label key={item.key} className="routeVisibilityRow">
                    <input
                      type="checkbox"
                      checked={routeVisibility[item.key] ?? true}
                      onChange={() => setLayerVisible(item.key, !(routeVisibility[item.key] ?? true))}
                    />
                    <span>{item.label}</span>
                  </label>
                ))
              )}
              <div className="routePanelSection">
                <strong>Viewport</strong>
                <label className="routeVisibilityRow">
                  <input
                    type="checkbox"
                    checked={collisionVisible}
                    onChange={(event) => onChangeCollisionVisible?.(event.currentTarget.checked)}
                  />
                  <span>Collision</span>
                </label>
              </div>
              <div className="routePanelSection">
                <strong>Depth Of Field</strong>
                <div className="routeModeButtons">
                  <button
                    type="button"
                    className={dofMode === 'full' ? 'routeModeButton active' : 'routeModeButton'}
                    onClick={() => setDofMode('full')}
                  >
                    Full
                  </button>
                  <button
                    type="button"
                    className={dofMode === 'reduced' ? 'routeModeButton active' : 'routeModeButton'}
                    onClick={() => setDofMode('reduced')}
                  >
                    Reduced
                  </button>
                  <button
                    type="button"
                    className={dofMode === 'off' ? 'routeModeButton active' : 'routeModeButton'}
                    onClick={() => setDofMode('off')}
                  >
                    Off
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        {topRightOverlay}
      </div>
      <canvas
        ref={canvasRef}
        className="noclipCanvas"
        onClick={handleCanvasClick}
        onContextMenu={handleCanvasContextMenu}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerLeave={handleCanvasPointerLeave}
        onPointerUp={clearActiveDrag}
        onPointerCancel={clearActiveDrag}
      />
      {marqueeSelection && <div className="marqueeSelection" style={getMarqueeStyle(marqueeSelection, canvasRef.current)} />}
      {smokeMode && (
        <div
          hidden
          data-viewport-sample={smokeViewportSample}
          data-smoke-selected-gobj-rendered={smokeSelectedGobjRendered}
          data-smoke-selected-gobj-snapped={smokeSelectedGobjSnapped}
          data-smoke-mouselook={smokeMouseLookWorked}
        />
      )}
      <div className="rendererStatus">{status}</div>
      {selectionHudLabel && <div className="selectionHud">{selectionHudLabel}</div>}
    </section>
  );
}

function getSceneKey(track: TrackDocument): string {
  return track.sourceId ?? `${track.fileName}:${track.brresFiles.join('|')}:${track.kcl?.triangles.length ?? 0}`;
}

function getGobjSignature(track: TrackDocument): string {
  if (!track.kmp) return 'nogobj';
  const gobjSignature = track.kmp.entities
    .filter((entity) => entity.section === 'GOBJ')
    .map((entity) =>
      [
        entity.index,
        entity.objectId ?? -1,
        entity.routeIndex ?? -1,
        entity.presenceFlags ?? -1,
        ...(entity.objectSettings ?? []),
      ].join(':'),
    )
    .join('|');
  const potiSignature = track.kmp.routes
    .map((route) =>
      [
        route.index,
        route.setting1,
        route.setting2,
        ...route.points.flatMap((point) => [
          point.pointIndex,
          point.position.x,
          point.position.y,
          point.position.z,
          point.setting1,
          point.setting2,
        ]),
      ].join(':'),
    )
    .join('|');
  return `${gobjSignature}#${potiSignature}`;
}

function buildSceneOverlayData(
  track: TrackDocument | null,
  selectedId: string | null,
  selectedIds: string[],
  transformSelection: ViewportTransformSelection | null,
  transformSelections: ViewportTransformSelection[],
  showKmpEditorOverlay: boolean,
  fillBetweenPreviewPositions: Vec3[],
  previewTransform: EntityTransformPreview | null,
  hoveredId: string | null,
  hoveredHandle: GizmoHandleKey | null,
  activeHandle: GizmoHandleKey | null,
  collisionVisible: boolean,
  tool: TransformTool,
  routeVisibility: Record<string, boolean>,
  viewMode: ViewMode,
  cameraPosition: Vec3 | null,
  routeInsertPreview: RouteInsertPreview | null,
  cameraGizmos: SceneOverlayCameraGizmo[] = [],
  cameraChainLinks: SceneOverlayCameraChainLink[] = [],
  meshTransformSelections: ViewportTransformSelection[] = [],
  kmpOptions: KmpOverlayOptions = {},
): SceneOverlayData {
  const activeMeshSelection = meshTransformSelections.length > 0 ? meshTransformSelections[meshTransformSelections.length - 1] : null;
  if (activeMeshSelection) transformSelection = activeMeshSelection;
  if (!track?.kmp && !transformSelection) return { tool, points: [], lines: [], centerHandle: null, axes: [], planes: [], checkpointEndpoints: [], collisionTriangles: [], checkpointWalls: [], areaVolumes: [], startSlots: [], fillBetweenPreview: [], routeDeviationSegments: [], routeDeviationCaps: [], cameraGizmos, cameraChainLinks };
  const kmp = track?.kmp ?? null;
  const showCollision = viewMode === 'dev' && collisionVisible;
  const showKmpData = !!kmp && showKmpEditorOverlay;
  const selectedSet = new Set(showKmpData ? selectedIds : []);
  if (showKmpData && selectedId) selectedSet.add(selectedId);
  const routeUsage = getPotiRouteUsage(kmp);
  const forcedVisibleObjectRoutes = showKmpData ? getForcedVisibleObjectRoutes(kmp, selectedSet, routeUsage) : new Set<number>();
  const visibleEntities = showKmpData && kmp ? getVisibleEntitiesForRouteFilter(kmp.entities, routeVisibility, kmp, routeUsage, forcedVisibleObjectRoutes) : [];
  const invalidIds = showKmpData && track ? collectInvalidEntityIds(track) : new Set<string>();
  const selectedEntity = showKmpData && kmp && selectedId ? kmp.entities.find((entity) => entity.id === selectedId) ?? null : null;
  const activeSelection = transformSelection ?? (selectedEntity ? {
    id: selectedEntity.id,
    label: selectedEntity.id,
    position: selectedEntity.position,
    rotation: selectedEntity.rotation,
    scale: selectedEntity.scale,
  } : null);
  const selectedPreview = previewTransform && previewTransform.id === activeSelection?.id ? previewTransform : null;
  const selectedPosition = selectedPreview?.position ?? activeSelection?.position ?? null;

  const applyPreviewPosition = (entity: KmpEntity): Vec3 => (
    previewTransform && previewTransform.id === entity.id ? previewTransform.position : entity.position
  );

  // Which path group (or POTI route) each point belongs to, so everything in one group shares
  // a colour the way hlorenzi's editor colours paths.
  const groupIndexByEntityId = new Map<string, number>();
  for (const graph of showKmpData ? kmp?.pathGraphs ?? [] : []) {
    for (const group of graph.groups) {
      for (let index = group.startIndex; index < group.startIndex + group.pointCount; index++) {
        groupIndexByEntityId.set(`${graph.pointSection}-${index}`, group.index);
      }
    }
  }
  const useGroupColors = !!kmpOptions.pathGroupColors && showKmpData;
  const groupColorFor = (entityId: string, section: string, routeIndex?: number): [number, number, number] | undefined => {
    if (!useGroupColors) return undefined;
    if (section === 'POTI') return routeIndex === undefined ? undefined : pathGroupColorRgb(routeIndex);
    if (section !== 'ENPT' && section !== 'ITPT' && section !== 'CKPT') return undefined;
    const groupIndex = groupIndexByEntityId.get(entityId);
    return groupIndex === undefined ? undefined : pathGroupColorRgb(groupIndex);
  };

  const points: SceneOverlayPoint[] = visibleEntities
    .map((entity): SceneOverlayPoint => ({
      id: entity.id,
      section: String(entity.section),
      position: applyPreviewPosition(entity),
      color: groupColorFor(entity.id, String(entity.section), entity.routePoint?.routeIndex),
      markerText:
        entity.section === 'POTI' &&
        entity.routePoint &&
        getPotiRouteVisibilityKey(entity.routePoint.routeIndex, routeUsage) === 'POTI_OBJECT'
          ? String(entity.routePoint.routeIndex)
          : undefined,
      specialColor:
        entity.section === 'ITPT' && (entity.pointSettings?.[1] === 1 || entity.pointSettings?.[1] === 0x0b)
          ? 'bulletBillCantStop'
          : undefined,
      selected: selectedSet.has(entity.id),
      hovered: entity.id === hoveredId && entity.id !== selectedId,
      invalid: false,
    }));
  for (const external of transformSelections) {
    points.push({
      id: external.id,
      section: 'MODEL_NODE',
      position: previewTransform && previewTransform.id === external.id ? previewTransform.position : external.position,
      markerText: undefined,
      selected: transformSelection?.id === external.id,
      hovered: hoveredId === external.id && transformSelection?.id !== external.id,
      invalid: false,
    });
  }
  if (routeInsertPreview) {
    points.push({
      id: '__route-insert-preview__',
      section: 'ROUTE_INSERT_PREVIEW',
      position: routeInsertPreview.position,
      selected: false,
      hovered: false,
      invalid: false,
    });
  }
  for (const point of points) point.invalid = invalidIds.has(point.id);

  const selectedDeviationSections = new Set<'ENPT' | 'ITPT'>();
  for (const entity of visibleEntities) {
    if (!selectedSet.has(entity.id)) continue;
    if (entity.section === 'ENPT' || entity.section === 'ITPT') selectedDeviationSections.add(entity.section);
  }

  const routeDeviationSegments: SceneOverlayRouteDeviationSegment[] = [];
  const routeDeviationCaps: SceneOverlayRouteDeviationCap[] = visibleEntities
    .filter((entity): entity is KmpEntity & { section: 'ENPT' | 'ITPT' } => (entity.section === 'ENPT' || entity.section === 'ITPT') && selectedDeviationSections.has(entity.section) && (entity.pointDeviation ?? 0) > 0)
    .map((entity) => ({
      id: `${entity.id}-cap`,
      section: entity.section,
      position: applyPreviewPosition(entity),
      radius: Math.max(0, (entity.pointDeviation ?? 0) * 50),
      selected: selectedSet.has(entity.id),
      hovered: entity.id === hoveredId && entity.id !== selectedId,
    }));

  const lines: SceneOverlayLine[] = [];
  for (const graph of showKmpData ? kmp?.pathGraphs ?? [] : []) {
    if (routeVisibility[graph.pointSection] === false) continue;
    const graphPoints = (kmp?.entities ?? []).filter((entity) => entity.section === graph.pointSection);
    for (const group of graph.groups) {
      const routeKey = graph.pointSection;
      for (let pointIndex = group.startIndex; pointIndex < group.startIndex + group.pointCount - 1; pointIndex++) {
        const a = graphPoints[pointIndex];
        const b = graphPoints[pointIndex + 1];
        if (!a || !b) continue;
        lines.push({ id: `${routeKey}-seq-${pointIndex}`, routeKey, section: graph.pointSection, color: groupColorFor(a.id, graph.pointSection), a: applyPreviewPosition(a), b: applyPreviewPosition(b) });
        if (graph.pointSection === 'ENPT' || graph.pointSection === 'ITPT') {
          const segment = buildRouteDeviationSegment(`${routeKey}-deviation-seq-${pointIndex}`, graph.pointSection, a, b, applyPreviewPosition, selectedSet, hoveredId, selectedId);
          if (segment && selectedDeviationSections.has(graph.pointSection)) routeDeviationSegments.push(segment);
        }
      }
      for (const nextGroupIndex of group.nextGroups) {
        const a = graphPoints[group.startIndex + group.pointCount - 1];
        const nextGroup = graph.groups.find((candidate) => candidate.index === nextGroupIndex);
        const b = nextGroup ? graphPoints[nextGroup.startIndex] : null;
        if (!a || !b) continue;
        lines.push({
          id: `${routeKey}-next-${group.index}-${nextGroupIndex}`,
          routeKey,
          section: graph.pointSection,
          color: useGroupColors ? pathGroupColorRgb(group.index) : undefined,
          alpha: 0.7,
          a: applyPreviewPosition(a),
          b: applyPreviewPosition(b),
        });
        if (graph.pointSection === 'ENPT' || graph.pointSection === 'ITPT') {
          const segment = buildRouteDeviationSegment(`${routeKey}-deviation-next-${group.index}-${nextGroupIndex}`, graph.pointSection, a, b, applyPreviewPosition, selectedSet, hoveredId, selectedId);
          if (segment && selectedDeviationSections.has(graph.pointSection)) routeDeviationSegments.push(segment);
        }
      }
    }
  }
  for (const route of showKmpData ? kmp?.routes ?? [] : []) {
    const routeKey = getPotiRouteVisibilityKey(route.index, routeUsage);
    if (!isPotiRouteVisible(route.index, routeVisibility, routeUsage, forcedVisibleObjectRoutes)) continue;
    for (let i = 0; i < route.points.length - 1; i++) {
      lines.push({
        id: `POTI-line-${route.index}-${i}`,
        routeKey,
        section: 'POTI',
        color: useGroupColors ? pathGroupColorRgb(route.index) : undefined,
        a: route.points[i].position,
        b: route.points[i + 1].position,
      });
    }
  }
  for (const entity of (showKmpData ? kmp?.entities ?? [] : []).filter((candidate) => candidate.section === 'CKPT' && candidate.checkpoint)) {
    if (routeVisibility.CKPT === false) continue;
    lines.push({
      id: `CKPT-span-${entity.id}`,
      routeKey: 'CKPT',
      section: 'CKPT',
      color: groupColorFor(entity.id, 'CKPT'),
      a: entity.checkpoint!.left,
      b: entity.checkpoint!.right,
    });
  }

  // The quad between two consecutive checkpoints: the strip of track the game counts as
  // "between these two checkpoints". Makes gaps and crossed checkpoints obvious.
  if (kmpOptions.showCheckpointQuads && showKmpData && routeVisibility.CKPT !== false) {
    const checkpointGraph = kmp?.pathGraphs.find((graph) => graph.pointSection === 'CKPT');
    const checkpointEntities = (kmp?.entities ?? []).filter((entity) => entity.section === 'CKPT');
    for (const group of checkpointGraph?.groups ?? []) {
      const pairs: Array<[KmpEntity, KmpEntity, number]> = [];
      for (let index = group.startIndex; index < group.startIndex + group.pointCount - 1; index++) {
        const a = checkpointEntities[index];
        const b = checkpointEntities[index + 1];
        if (a?.checkpoint && b?.checkpoint) pairs.push([a, b, group.index]);
      }
      for (const nextGroupIndex of group.nextGroups) {
        const a = checkpointEntities[group.startIndex + group.pointCount - 1];
        const nextGroup = checkpointGraph?.groups.find((candidate) => candidate.index === nextGroupIndex);
        const b = nextGroup ? checkpointEntities[nextGroup.startIndex] : null;
        if (a?.checkpoint && b?.checkpoint) pairs.push([a, b, group.index]);
      }
      for (const [a, b, groupIndex] of pairs) {
        routeDeviationSegments.push({
          id: `CKPT-quad-${a.id}-${b.id}`,
          section: 'CKPT',
          color: useGroupColors ? pathGroupColorRgb(groupIndex) : undefined,
          aLeft: a.checkpoint!.left,
          aRight: a.checkpoint!.right,
          bLeft: b.checkpoint!.left,
          bRight: b.checkpoint!.right,
          selected: selectedSet.has(a.id) || selectedSet.has(b.id),
          hovered: hoveredId === a.id || hoveredId === b.id,
        });
      }
    }
  }

  // Group connection handles: one sphere at each group's first and last point. Dragging from
  // one onto another is how paths get wired together in the viewport.
  const linkSection = kmpOptions.pathLinkSection ?? null;
  if (linkSection && showKmpData && routeVisibility[linkSection] !== false) {
    const graph = kmp?.pathGraphs.find((candidate) => candidate.pointSection === linkSection);
    const graphPoints = (kmp?.entities ?? []).filter((entity) => entity.section === linkSection);
    for (const group of graph?.groups ?? []) {
      const first = graphPoints[group.startIndex];
      const last = graphPoints[group.startIndex + group.pointCount - 1];
      const color = pathGroupColorRgb(group.index);
      if (first) {
        points.push({
          id: pathLinkHandleId(linkSection, group.index, 'start'),
          section: 'PATH_LINK_HANDLE',
          position: applyPreviewPosition(first),
          color,
          radius: 22,
          selected: false,
          hovered: kmpOptions.pathLinkDrag?.hoverGroup === group.index,
          invalid: false,
        });
      }
      if (last) {
        points.push({
          id: pathLinkHandleId(linkSection, group.index, 'end'),
          section: 'PATH_LINK_HANDLE',
          position: applyPreviewPosition(last),
          color,
          radius: 26,
          selected: kmpOptions.pathLinkDrag?.fromGroup === group.index,
          hovered: false,
          invalid: false,
        });
      }
    }
  }
  if (kmpOptions.pathLinkDrag) {
    lines.push({
      id: '__path-link-drag__',
      section: 'PATH_LINK_DRAG',
      color: [1, 1, 1],
      a: kmpOptions.pathLinkDrag.anchor,
      b: kmpOptions.pathLinkDrag.cursor,
    });
  }
  if (kmpOptions.checkpointDraw) {
    lines.push({
      id: '__checkpoint-draw__',
      section: 'CHECKPOINT_DRAW',
      color: [1, 0.86, 0.2],
      a: kmpOptions.checkpointDraw.start,
      b: kmpOptions.checkpointDraw.current,
    });
    points.push(
      { id: '__checkpoint-draw-start__', section: 'CHECKPOINT_DRAW', position: kmpOptions.checkpointDraw.start, color: [1, 0.86, 0.2], selected: false, hovered: false, invalid: false },
      { id: '__checkpoint-draw-end__', section: 'CHECKPOINT_DRAW', position: kmpOptions.checkpointDraw.current, color: [1, 0.86, 0.2], selected: false, hovered: false, invalid: false },
    );
  }

  let centerHandle: SceneOverlayCenterHandle | null = null;
  const axes: SceneOverlayAxis[] = [];
  const planes: SceneOverlayPlane[] = [];
  const checkpointEndpoints: SceneOverlayCheckpointEndpoint[] = [];
  const collisionTriangles: SceneOverlayCollisionTriangle[] =
    showCollision && track?.kcl
      ? track.kcl.triangles.map((triangle) => ({
          a: triangle.a,
          b: triangle.b,
          c: triangle.c,
          typeIndex: triangle.flag & 0x1f,
        }))
      : [];
  const checkpointWalls =
    selectedEntity?.section === 'CKPT'
      ? visibleEntities
          .filter((entity): entity is KmpEntity & { section: 'CKPT'; checkpoint: NonNullable<KmpEntity['checkpoint']> } => entity.section === 'CKPT' && !!entity.checkpoint)
          .map((entity) => ({
            id: entity.id,
            left: entity.checkpoint.left,
            right: entity.checkpoint.right,
            topY: getCheckpointWallTopY(track!),
            selected: entity.id === selectedEntity.id,
            invalid: invalidIds.has(entity.id),
          }))
      : [];
  const startSlots = showKmpData && kmp ? buildRaceStartSlots(kmp, visibleEntities, selectedSet, hoveredId) : [];
  const fillBetweenPreview = fillBetweenPreviewPositions.map((position, index) => ({ position, index }));
  const areaVolumes: SceneOverlayAreaVolume[] = visibleEntities
    .filter((entity): entity is KmpEntity & { section: 'AREA'; area: NonNullable<KmpEntity['area']>; rotation: Vec3; scale: Vec3 } => (
      entity.section === 'AREA' &&
      !!entity.area &&
      !!entity.rotation &&
      !!entity.scale &&
      selectedSet.has(entity.id)
    ))
    .map((entity) => ({
      id: entity.id,
      shape: entity.area.shape,
      position: previewTransform && previewTransform.id === entity.id ? previewTransform.position : entity.position,
      rotation: previewTransform?.id === entity.id && previewTransform.rotation ? previewTransform.rotation : entity.rotation,
      scale: previewTransform?.id === entity.id && previewTransform.scale ? previewTransform.scale : entity.scale,
      selected: selectedSet.has(entity.id),
      hovered: entity.id === hoveredId && entity.id !== selectedId,
      invalid: invalidIds.has(entity.id),
    }));
  const selectedHiddenByRouteFilter = !!selectedEntity && !isEntityVisibleForRouteFilter(selectedEntity, routeVisibility, kmp!, routeUsage, forcedVisibleObjectRoutes);
  if (activeSelection && selectedPosition && !selectedHiddenByRouteFilter) {
    const length = getGizmoLength(activeSelection.position, cameraPosition, activeSelection.scale);
    const planeSize = length * 0.28;
    centerHandle = {
      ownerId: activeSelection.id,
      position: selectedPosition,
      hovered: gizmoHandleEquals(hoveredHandle, { kind: 'center', id: activeSelection.id }),
      active: gizmoHandleEquals(activeHandle, { kind: 'center', id: activeSelection.id }),
    };
    axes.push(
      {
        ownerId: activeSelection.id,
        axis: 'x',
        a: selectedPosition,
        b: { x: selectedPosition.x + length, y: selectedPosition.y, z: selectedPosition.z },
        hovered: gizmoHandleEquals(hoveredHandle, { kind: 'axis', id: activeSelection.id, axis: 'x' }),
        active: gizmoHandleEquals(activeHandle, { kind: 'axis', id: activeSelection.id, axis: 'x' }),
      },
      {
        ownerId: activeSelection.id,
        axis: 'y',
        a: selectedPosition,
        b: { x: selectedPosition.x, y: selectedPosition.y + length, z: selectedPosition.z },
        hovered: gizmoHandleEquals(hoveredHandle, { kind: 'axis', id: activeSelection.id, axis: 'y' }),
        active: gizmoHandleEquals(activeHandle, { kind: 'axis', id: activeSelection.id, axis: 'y' }),
      },
      {
        ownerId: activeSelection.id,
        axis: 'z',
        a: selectedPosition,
        b: { x: selectedPosition.x, y: selectedPosition.y, z: selectedPosition.z + length },
        hovered: gizmoHandleEquals(hoveredHandle, { kind: 'axis', id: activeSelection.id, axis: 'z' }),
        active: gizmoHandleEquals(activeHandle, { kind: 'axis', id: activeSelection.id, axis: 'z' }),
      },
    );
    if (tool === 'translate' || tool === 'scale') {
      planes.push(
        {
          ownerId: activeSelection.id,
          plane: 'xy',
          a: selectedPosition,
          b: { x: selectedPosition.x + planeSize, y: selectedPosition.y, z: selectedPosition.z },
          c: { x: selectedPosition.x + planeSize, y: selectedPosition.y + planeSize, z: selectedPosition.z },
          d: { x: selectedPosition.x, y: selectedPosition.y + planeSize, z: selectedPosition.z },
          hovered: gizmoHandleEquals(hoveredHandle, { kind: 'plane', id: activeSelection.id, plane: 'xy' }),
          active: gizmoHandleEquals(activeHandle, { kind: 'plane', id: activeSelection.id, plane: 'xy' }),
        },
        {
          ownerId: activeSelection.id,
          plane: 'xz',
          a: selectedPosition,
          b: { x: selectedPosition.x + planeSize, y: selectedPosition.y, z: selectedPosition.z },
          c: { x: selectedPosition.x + planeSize, y: selectedPosition.y, z: selectedPosition.z + planeSize },
          d: { x: selectedPosition.x, y: selectedPosition.y, z: selectedPosition.z + planeSize },
          hovered: gizmoHandleEquals(hoveredHandle, { kind: 'plane', id: activeSelection.id, plane: 'xz' }),
          active: gizmoHandleEquals(activeHandle, { kind: 'plane', id: activeSelection.id, plane: 'xz' }),
        },
        {
          ownerId: activeSelection.id,
          plane: 'yz',
          a: selectedPosition,
          b: { x: selectedPosition.x, y: selectedPosition.y + planeSize, z: selectedPosition.z },
          c: { x: selectedPosition.x, y: selectedPosition.y + planeSize, z: selectedPosition.z + planeSize },
          d: { x: selectedPosition.x, y: selectedPosition.y, z: selectedPosition.z + planeSize },
          hovered: gizmoHandleEquals(hoveredHandle, { kind: 'plane', id: activeSelection.id, plane: 'yz' }),
          active: gizmoHandleEquals(activeHandle, { kind: 'plane', id: activeSelection.id, plane: 'yz' }),
        },
      );
    }
    if (selectedEntity?.checkpoint) {
      checkpointEndpoints.push(
        { id: selectedEntity.id, side: 'left', position: selectedEntity.checkpoint.left },
        { id: selectedEntity.id, side: 'right', position: selectedEntity.checkpoint.right },
      );
    }
  }

  return { tool, points, lines, centerHandle, axes, planes, checkpointEndpoints, collisionTriangles, checkpointWalls, areaVolumes, startSlots, fillBetweenPreview, routeDeviationSegments, routeDeviationCaps, cameraGizmos, cameraChainLinks };
}

function getRouteInsertCandidate(
  kmp: KmpDocument | null,
  selectedId: string | null,
  cursorPosition: Vec3,
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  viewer: Viewer,
): RouteInsertCandidate | null {
  if (!kmp || !selectedId) return null;
  const selected = kmp.entities.find((entity) => entity.id === selectedId);
  if (!selected) return null;
  const selectedPotiRouteIndex = getSelectedPotiRouteIndex(selected);
  if (selectedPotiRouteIndex !== null) {
    const route = kmp.routes[selectedPotiRouteIndex];
    if (!route || route.points.length === 0) return null;
    const placement = getNearestPotiRouteInsertPlacement(route.points.map((point) => point.position), cursorPosition, clientX, clientY, canvas, viewer);
    if (!placement) return null;
    return {
      position: placement.position,
      target: {
        section: 'POTI',
        routeIndex: route.index,
        afterPointIndex: placement.afterPointIndex,
      },
    };
  }
  if (selected.section !== 'ENPT' && selected.section !== 'ITPT' && selected.section !== 'CKPT') return null;
  const graph = kmp.pathGraphs.find((candidate) => candidate.pointSection === selected.section);
  const group = graph?.groups.find((candidate) => selected.index >= candidate.startIndex && selected.index < candidate.startIndex + candidate.pointCount);
  if (!graph || !group) return null;
  const groupPoints = kmp.entities
    .filter((entity) => entity.section === selected.section)
    .slice(group.startIndex, group.startIndex + group.pointCount)
    .map((entity) => entity.position);
  if (groupPoints.length === 0) return null;
  const segment = getNearestRouteInsertSegment(groupPoints, cursorPosition);
  if (!segment) return null;
  return {
    position: segment.snapped ? segment.position : cursorPosition,
    target: segment.snapped
      ? {
          section: selected.section,
          groupIndex: group.index,
          afterPointIndex: segment.afterPointIndex,
          mode: 'insert',
        }
      : {
          section: selected.section,
          groupIndex: group.index,
          localPointIndex: selected.index - group.startIndex,
          mode: 'fork',
        },
  };
}

function getSelectedPotiRouteIndex(selected: KmpEntity): number | null {
  if (selected.routePoint) return selected.routePoint.routeIndex;
  if (selected.routeIndex !== undefined && selected.routeIndex !== 0xffff) return selected.routeIndex;
  return null;
}

function getNearestPotiRouteInsertPlacement(
  points: readonly Vec3[],
  cursorPosition: Vec3,
  _clientX: number,
  _clientY: number,
  _canvas: HTMLCanvasElement,
  _viewer: Viewer,
): { afterPointIndex: number; position: Vec3 } | null {
  if (points.length === 0) return null;
  const segment = points.length > 1 ? getNearestRouteInsertSegment(points, cursorPosition) : null;
  if (segment?.snapped) return { afterPointIndex: segment.afterPointIndex, position: segment.position };
  if (points.length === 1) return { afterPointIndex: 0, position: cursorPosition };

  const nearestPointIndex = getNearestRoutePointIndex(points, cursorPosition);
  if (nearestPointIndex === null) {
    return {
      afterPointIndex: segment?.afterPointIndex ?? (points.length - 1),
      position: cursorPosition,
    };
  }

  return {
    afterPointIndex: getNearestPointInsertAfterIndex(points, nearestPointIndex, cursorPosition),
    position: cursorPosition,
  };
}

function getNearestRoutePointIndex(
  points: readonly Vec3[],
  cursorPosition: Vec3,
): number | null {
  let bestIndex: number | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i++) {
    const offset = subVec3(points[i], cursorPosition);
    const distanceSq = dot(offset, offset);
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function getNearestPointInsertAfterIndex(
  points: readonly Vec3[],
  pointIndex: number,
  cursorPosition: Vec3,
): number {
  if (points.length <= 1) return 0;
  if (pointIndex <= 0) {
    return dot(subVec3(cursorPosition, points[0]), subVec3(points[1], points[0])) < 0 ? -1 : 0;
  }
  if (pointIndex >= points.length - 1) {
    const lastIndex = points.length - 1;
    return dot(subVec3(cursorPosition, points[lastIndex]), subVec3(points[lastIndex], points[lastIndex - 1])) > 0 ? lastIndex : lastIndex - 1;
  }

  const previousProjection = projectPointOntoSegment(points[pointIndex - 1], points[pointIndex], cursorPosition);
  const nextProjection = projectPointOntoSegment(points[pointIndex], points[pointIndex + 1], cursorPosition);
  const previousOffset = subVec3(previousProjection, cursorPosition);
  const nextOffset = subVec3(nextProjection, cursorPosition);
  if (dot(previousOffset, previousOffset) <= dot(nextOffset, nextOffset)) return pointIndex - 1;
  return pointIndex;
}

function getNearestRouteInsertSegment(
  points: readonly Vec3[],
  cursorPosition: Vec3,
): { afterPointIndex: number; position: Vec3; snapped: boolean } | null {
  if (points.length <= 1) return null;
  let best: { afterPointIndex: number; position: Vec3; distanceSq: number } | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const projected = projectPointOntoSegment(points[i], points[i + 1], cursorPosition);
    const offset = subVec3(projected, cursorPosition);
    const distanceSq = dot(offset, offset);
    if (!best || distanceSq < best.distanceSq) {
      best = { afterPointIndex: i, position: projected, distanceSq };
    }
  }
  if (!best) return null;
  return {
    afterPointIndex: best.afterPointIndex,
    position: best.position,
    snapped: best.distanceSq <= ROUTE_INSERT_SNAP_MAX_DISTANCE * ROUTE_INSERT_SNAP_MAX_DISTANCE,
  };
}

function projectPointOntoSegment(a: Vec3, b: Vec3, point: Vec3): Vec3 {
  const ab = subVec3(b, a);
  const lengthSq = dot(ab, ab);
  if (lengthSq <= 0.000001) return a;
  const t = Math.min(1, Math.max(0, dot(subVec3(point, a), ab) / lengthSq));
  return {
    x: a.x + ab.x * t,
    y: a.y + ab.y * t,
    z: a.z + ab.z * t,
  };
}

function routeInsertPreviewEquals(a: RouteInsertPreview | null, b: RouteInsertPreview | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    a.position.z === b.position.z &&
    a.target.section === b.target.section &&
    ('routeIndex' in a.target ? a.target.routeIndex : a.target.groupIndex) === ('routeIndex' in b.target ? b.target.routeIndex : b.target.groupIndex) &&
    routeInsertPointIndex(a.target) === routeInsertPointIndex(b.target)
  );
}

function routeInsertPointIndex(target: KmpRouteInsertTarget): number {
  return 'afterPointIndex' in target ? target.afterPointIndex : target.localPointIndex;
}

function buildRouteDeviationSegment(
  id: string,
  section: 'ENPT' | 'ITPT',
  a: KmpEntity,
  b: KmpEntity,
  getPosition: (entity: KmpEntity) => Vec3,
  selectedSet: ReadonlySet<string>,
  hoveredId: string | null,
  selectedId: string | null,
): SceneOverlayRouteDeviationSegment | null {
  const radiusA = Math.max(0, (a.pointDeviation ?? 0) * 50);
  const radiusB = Math.max(0, (b.pointDeviation ?? 0) * 50);
  if (radiusA <= 0 && radiusB <= 0) return null;
  const positionA = getPosition(a);
  const positionB = getPosition(b);
  const dx = positionB.x - positionA.x;
  const dz = positionB.z - positionA.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.001) return null;
  const offsetX = (-dz / length);
  const offsetZ = (dx / length);
  return {
    id,
    section,
    aLeft: { x: positionA.x + offsetX * radiusA, y: positionA.y, z: positionA.z + offsetZ * radiusA },
    aRight: { x: positionA.x - offsetX * radiusA, y: positionA.y, z: positionA.z - offsetZ * radiusA },
    bLeft: { x: positionB.x + offsetX * radiusB, y: positionB.y, z: positionB.z + offsetZ * radiusB },
    bRight: { x: positionB.x - offsetX * radiusB, y: positionB.y, z: positionB.z - offsetZ * radiusB },
    selected: selectedSet.has(a.id) || selectedSet.has(b.id),
    hovered: (a.id === hoveredId || b.id === hoveredId) && hoveredId !== selectedId,
  };
}

function buildRaceStartSlots(
  kmp: KmpDocument,
  visibleEntities: readonly KmpEntity[],
  selectedSet: ReadonlySet<string>,
  hoveredId: string | null,
): SceneOverlayStartSlot[] {
  const ktptEntities = kmp.entities.filter((entity): entity is KmpEntity & { section: 'KTPT'; rotation: Vec3 } => entity.section === 'KTPT' && !!entity.rotation);
  if (ktptEntities.length === 0) return [];
  const hasBattlePlayerAssignments = ktptEntities.filter((entity) => (entity.ktptPlayerIndex ?? -1) >= 0).length >= 12;
  if (hasBattlePlayerAssignments) return [];
  const startEntity = ktptEntities[0] ?? visibleEntities.find((entity) => isRaceStartPointEntity(entity)) ?? null;
  if (!startEntity?.rotation) return [];
  const poleRight = kmp.entities.find((entity) => entity.section === 'STGI')?.stage?.polePosition === 1;
  const narrow = kmp.entities.find((entity) => entity.section === 'STGI')?.stage?.driverDistance === 1;
  const lengthScale = narrow ? 4800 / startSlotNarrowPixelDepth : 5300 / startSlotWidePixelDepth;
  const widthScale = 1000 / startSlotWidePixelWidth;
  const slots: SceneOverlayStartSlot[] = [];
  for (let slotIndex = 0; slotIndex < startSlotPixelOffsets.length; slotIndex++) {
    const slot = startSlotPixelOffsets[slotIndex];
    const localX = (slot.x - startSlotPixelCenterX) * widthScale * (poleRight ? -1 : 1);
    const localZ = -((slot.y - startSlotPixelOffsets[0].y) * lengthScale);
    slots.push({
      ownerId: startEntity.id,
      slotIndex,
      position: transformLocalOffset(startEntity.position, startEntity.rotation, localX, 0, localZ),
      rotation: startEntity.rotation,
      selected: selectedSet.has(startEntity.id),
      hovered: hoveredId === startEntity.id && !selectedSet.has(startEntity.id),
    });
  }
  return slots;
}

function isRaceStartPointEntity(entity: KmpEntity): entity is KmpEntity & { section: 'KTPT'; rotation: Vec3 } {
  return entity.section === 'KTPT' && !!entity.rotation && (entity.ktptPlayerIndex === undefined || entity.ktptPlayerIndex < 0);
}

function transformLocalOffset(origin: Vec3, rotation: Vec3, x: number, y: number, z: number): Vec3 {
  const matrix = mat4.create();
  const point = vec4.fromValues(x, y, z, 1);
  mat4.identity(matrix);
  mat4.translate(matrix, matrix, [origin.x, origin.y, origin.z]);
  mat4.rotateX(matrix, matrix, rotation.x * Math.PI / 180);
  mat4.rotateY(matrix, matrix, rotation.y * Math.PI / 180);
  mat4.rotateZ(matrix, matrix, rotation.z * Math.PI / 180);
  vec4.transformMat4(point, point, matrix);
  return { x: point[0], y: point[1], z: point[2] };
}

function getCheckpointWallTopY(track: TrackDocument): number {
  let maxY = 0;
  for (const triangle of track.kcl?.triangles ?? []) {
    maxY = Math.max(maxY, triangle.a.y, triangle.b.y, triangle.c.y);
  }
  for (const entity of track.kmp?.entities ?? []) {
    maxY = Math.max(maxY, entity.position.y);
    if (entity.checkpoint) maxY = Math.max(maxY, entity.checkpoint.left.y, entity.checkpoint.right.y);
  }
  return Math.max(4000, maxY + 2000);
}

function isEntityVisibleForRouteFilter(
  entity: KmpEntity,
  routeVisibility: Record<string, boolean>,
  kmp: KmpDocument | null,
  routeUsage?: PotiRouteUsage,
  forcedVisibleObjectRoutes?: ReadonlySet<number>,
): boolean {
  if (entity.section === 'STGI') return false;
  if (entity.section === 'KTPT') return routeVisibility.KTPT !== false;
  if (entity.section === 'ENPT') return routeVisibility.ENPT !== false;
  if (entity.section === 'ITPT') return routeVisibility.ITPT !== false;
  if (entity.section === 'CKPT') return routeVisibility.CKPT !== false;
  if (entity.section === 'GOBJ') return routeVisibility.GOBJ !== false;
  if (entity.section === 'JGPT') return routeVisibility.JGPT !== false;
  if (entity.section === 'AREA') return routeVisibility.AREA !== false;
  if (entity.section === 'CAME') return routeVisibility.CAME !== false;
  if (entity.section === 'CNPT') return routeVisibility.CNPT !== false;
  if (entity.section === 'MSPT') return routeVisibility.MSPT !== false;
  if (entity.section === 'POTI' && entity.routePoint) {
    return isPotiRouteVisible(entity.routePoint.routeIndex, routeVisibility, routeUsage ?? getPotiRouteUsage(kmp), forcedVisibleObjectRoutes);
  }
  return true;
}

function getVisibleEntitiesForRouteFilter(
  entities: readonly KmpEntity[],
  routeVisibility: Record<string, boolean>,
  kmp: KmpDocument | null,
  routeUsage?: PotiRouteUsage,
  forcedVisibleObjectRoutes?: ReadonlySet<number>,
): KmpEntity[] {
  return entities.filter((entity) => isEntityVisibleForRouteFilter(entity, routeVisibility, kmp, routeUsage, forcedVisibleObjectRoutes));
}

function supportsMouseLook(viewMode: ViewMode): boolean {
  return viewMode === 'normal' || viewMode === 'dev';
}

function getViewerAspect(viewer: Viewer): number {
  if (viewer.canvas.width > 0 && viewer.canvas.height > 0) return viewer.canvas.width / viewer.canvas.height;
  return viewer.camera.aspect || 1;
}

function getRouteVisibilityItems(track: TrackDocument): RouteVisibilityItem[] {
  if (!track.kmp) return [];
  const items: RouteVisibilityItem[] = [];
  const routeUsage = getPotiRouteUsage(track.kmp);
  const hasSection = (section: string) => track.kmp!.entities.some((entity) => entity.section === section);
  if (hasSection('KTPT')) items.push({ key: 'KTPT', label: 'Start Points' });
  if (track.kmp.pathGraphs.some((graph) => graph.pointSection === 'ENPT')) items.push({ key: 'ENPT', label: 'Enemy Routes' });
  if (track.kmp.pathGraphs.some((graph) => graph.pointSection === 'ITPT')) items.push({ key: 'ITPT', label: 'Item Routes' });
  if (track.kmp.pathGraphs.some((graph) => graph.pointSection === 'CKPT')) items.push({ key: 'CKPT', label: 'Checkpoint Routes' });
  if (hasSection('GOBJ')) items.push({ key: 'GOBJ', label: 'Objects' });
  if (track.kmp.routes.length > 0 && (routeUsage.objectRoutes.size > 0 || routeUsage.unusedRoutes.size > 0)) items.push({ key: 'POTI_OBJECT', label: 'Object Routes' });
  if (track.kmp.routes.length > 0 && routeUsage.cameraRoutes.size > 0) items.push({ key: 'POTI_CAMERA', label: 'Camera Routes' });
  if (hasSection('JGPT')) items.push({ key: 'JGPT', label: 'Respawn Points' });
  if (hasSection('AREA')) items.push({ key: 'AREA', label: 'Area Triggers' });
  if (hasSection('CAME')) items.push({ key: 'CAME', label: 'Cameras' });
  if (hasSection('CNPT')) items.push({ key: 'CNPT', label: 'Cannon Points' });
  if (hasSection('MSPT')) items.push({ key: 'MSPT', label: 'Battle Finish Points' });
  return items;
}

interface PotiRouteUsage {
  objectRoutes: Set<number>;
  cameraRoutes: Set<number>;
  unusedRoutes: Set<number>;
}

function getPotiRouteUsage(kmp: KmpDocument | null): PotiRouteUsage {
  const objectRoutes = new Set<number>();
  const cameraRoutes = new Set<number>();
  const unusedRoutes = new Set<number>();
  if (!kmp) return { objectRoutes, cameraRoutes, unusedRoutes };
  for (const route of kmp.routes) unusedRoutes.add(route.index);
  for (const entity of kmp.entities) {
    if (entity.routeIndex === undefined || entity.routeIndex === 0xffff) continue;
    unusedRoutes.delete(entity.routeIndex);
    if (entity.section === 'CAME') cameraRoutes.add(entity.routeIndex);
    else if (entity.section === 'GOBJ') objectRoutes.add(entity.routeIndex);
  }
  return { objectRoutes, cameraRoutes, unusedRoutes };
}

function getPotiRouteVisibilityKey(routeIndex: number, routeUsage: PotiRouteUsage): RouteVisibilityKey {
  if (routeUsage.cameraRoutes.has(routeIndex) && !routeUsage.objectRoutes.has(routeIndex)) return 'POTI_CAMERA';
  return 'POTI_OBJECT';
}

function getForcedVisibleObjectRoutes(
  kmp: KmpDocument | null,
  selectedIds: Iterable<string>,
  routeUsage: PotiRouteUsage,
): Set<number> {
  const forcedRoutes = new Set<number>();
  if (!kmp) return forcedRoutes;
  for (const id of selectedIds) {
    const entity = kmp.entities.find((candidate) => candidate.id === id);
    if (!entity) continue;
    if (entity.section === 'GOBJ' && entity.routeIndex !== undefined && entity.routeIndex !== 0xffff) {
      if (getPotiRouteVisibilityKey(entity.routeIndex, routeUsage) === 'POTI_OBJECT') forcedRoutes.add(entity.routeIndex);
      continue;
    }
    if (entity.section === 'POTI' && entity.routePoint) {
      if (getPotiRouteVisibilityKey(entity.routePoint.routeIndex, routeUsage) === 'POTI_OBJECT') forcedRoutes.add(entity.routePoint.routeIndex);
    }
  }
  return forcedRoutes;
}

function isPotiRouteVisible(
  routeIndex: number,
  routeVisibility: Record<string, boolean>,
  routeUsage: PotiRouteUsage,
  forcedVisibleObjectRoutes?: ReadonlySet<number>,
): boolean {
  if (forcedVisibleObjectRoutes?.has(routeIndex)) return true;
  const objectVisible = routeVisibility.POTI_OBJECT !== false;
  const cameraVisible = routeVisibility.POTI_CAMERA !== false;
  const usedByObject = routeUsage.objectRoutes.has(routeIndex) || routeUsage.unusedRoutes.has(routeIndex);
  const usedByCamera = routeUsage.cameraRoutes.has(routeIndex);
  if (usedByObject && usedByCamera) return objectVisible || cameraVisible;
  if (usedByCamera) return cameraVisible;
  return objectVisible;
}

function collectInvalidEntityIds(track: TrackDocument): Set<string> {
  const invalidIds = new Set<string>();
  if (!track.kmp) return invalidIds;
  const count = (section: string) => track.kmp?.sections.find((candidate) => candidate.name === section)?.count ?? 0;
  const potiCount = track.kmp.routes.length || count('POTI');
  const cameraCount = count('CAME');
  const enemyPointCount = count('ENPT');
  const checkpointCount = count('CKPT');
  const respawnCount = count('JGPT');

  for (const entity of track.kmp.entities) {
    if (entity.checkpoint) {
      if (
        (entity.checkpoint.respawnIndex !== 0xff && entity.checkpoint.respawnIndex >= respawnCount) ||
        (entity.checkpoint.prev !== 0xff && entity.checkpoint.prev >= checkpointCount) ||
        (entity.checkpoint.next !== 0xff && entity.checkpoint.next >= checkpointCount)
      ) {
        invalidIds.add(entity.id);
      }
    }
    if (entity.section === 'GOBJ' && entity.routeIndex !== undefined && entity.routeIndex !== 0xffff && entity.routeIndex >= potiCount) {
      invalidIds.add(entity.id);
    }
    if (entity.area) {
      if (
        (entity.area.routeIndex !== 0xff && entity.area.routeIndex >= potiCount) ||
        (entity.area.cameraIndex !== 0xff && entity.area.cameraIndex >= cameraCount) ||
        (entity.area.enemyIndex !== 0xff && entity.area.enemyIndex >= enemyPointCount)
      ) {
        invalidIds.add(entity.id);
      }
    }
    if (entity.camera) {
      if (
        (entity.camera.routeIndex !== 0xff && entity.camera.routeIndex >= potiCount) ||
        (entity.camera.nextCam !== 0xff && entity.camera.nextCam >= cameraCount)
      ) {
        invalidIds.add(entity.id);
      }
    }
  }

  return invalidIds;
}

function createGizmoDragState(
  selection: ViewportTransformSelection,
  axis: GizmoAxis,
  tool: TransformTool,
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  viewer: Viewer,
): GizmoDragState | null {
  if (tool === 'rotate' && selection.rotation) return createAngularGizmoDragState(selection, axis, clientX, clientY, canvas, viewer);
  const axisDirection = axisDirectionFor(axis);
  const planePoint = scaleVec3(selection.position, MKW_RENDER_SCALE);
  const cameraForward = getCameraForward(canvas, viewer);
  const planeNormal = getAxisDragPlaneNormal(axisDirection, cameraForward);
  if (!planeNormal) return null;
  const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, planePoint, planeNormal);
  if (!hit) return null;
  return {
    kind: 'gizmo',
    mode: 'linear',
    id: selection.id,
    axis,
    position: selection.position,
    axisOrigin: planePoint,
    axisDirection,
    planePoint,
    planeNormal,
    startAxisOffset: dot(subVec3(hit, planePoint), axisDirection),
    rotation: selection.rotation,
    scale: selection.scale,
  };
}

function createCenterGizmoDragState(
  selection: ViewportTransformSelection,
  tool: TransformTool,
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  viewer: Viewer,
): GizmoDragState | null {
  const planePoint = scaleVec3(selection.position, MKW_RENDER_SCALE);
  const planeNormal = getCameraForward(canvas, viewer);
  const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, planePoint, planeNormal);
  if (!hit) return null;
  if (tool === 'scale' && selection.scale) {
    const startRadius = Math.max(1, Math.hypot(hit.x - planePoint.x, hit.y - planePoint.y, hit.z - planePoint.z));
    return {
      kind: 'gizmo',
      mode: 'uniformScale',
      id: selection.id,
      center: selection.position,
      planeNormal,
      startHit: hit,
      startRadius,
      scale: selection.scale,
    };
  }
  return {
    kind: 'gizmo',
    mode: 'planar',
    id: selection.id,
    position: selection.position,
    planePoint,
    planeNormal,
    startHit: hit,
    rotation: selection.rotation,
    scale: selection.scale,
  };
}

function createPlaneGizmoDragState(
  selection: ViewportTransformSelection,
  plane: GizmoPlane,
  tool: TransformTool,
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  viewer: Viewer,
): GizmoDragState | null {
  const planePoint = scaleVec3(selection.position, MKW_RENDER_SCALE);
  const planeNormal = plane === 'xy' ? { x: 0, y: 0, z: 1 } : plane === 'xz' ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, planePoint, planeNormal);
  if (!hit) return null;
  if (tool === 'scale' && selection.scale) {
    const local = {
      x: (hit.x - planePoint.x) / MKW_RENDER_SCALE,
      y: (hit.y - planePoint.y) / MKW_RENDER_SCALE,
      z: (hit.z - planePoint.z) / MKW_RENDER_SCALE,
    };
    return {
      kind: 'gizmo',
      mode: 'planarScale',
      id: selection.id,
      plane,
      center: selection.position,
      planePoint,
      planeNormal,
      startU: plane === 'xy' || plane === 'xz' ? local.x : local.y,
      startV: plane === 'xy' ? local.y : local.z,
      scale: selection.scale,
    };
  }
  return {
    kind: 'gizmo',
    mode: 'planar',
    id: selection.id,
    position: selection.position,
    planePoint,
    planeNormal,
    startHit: hit,
    rotation: selection.rotation,
    scale: selection.scale,
  };
}

function createAngularGizmoDragState(
  selection: ViewportTransformSelection,
  axis: GizmoAxis,
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  viewer: Viewer,
): GizmoDragState | null {
  const center = scaleVec3(selection.position, MKW_RENDER_SCALE);
  const planeNormal = axisDirectionFor(axis);
  const hit = intersectScreenWithPlane(clientX, clientY, canvas, viewer, center, planeNormal);
  if (!hit || !selection.rotation) return null;
  const { x: angleBasisX, y: angleBasisY } = getRotateRingBasis(axis);
  const startAngle = ringAngleForHit(hit, center, angleBasisX, angleBasisY);
  if (startAngle === null) return null;
  return {
    kind: 'gizmo',
    mode: 'angular',
    id: selection.id,
    axis,
    center,
    planeNormal,
    angleBasisX,
    angleBasisY,
    startAngle,
    rotation: selection.rotation,
  };
}

function pickEntityFromScreen(entities: KmpEntity[], clientX: number, clientY: number, canvas: HTMLCanvasElement, viewer: Viewer): KmpEntity | null {
  const ray = screenToWorldRay(clientX, clientY, canvas, viewer);
  if (!ray) return null;
  const origin = { x: ray.origin.x / MKW_RENDER_SCALE, y: ray.origin.y / MKW_RENDER_SCALE, z: ray.origin.z / MKW_RENDER_SCALE };
  let best: { entity: KmpEntity; score: number } | null = null;
  for (const entity of entities) {
    if (entity.section === 'STGI') continue;
    const t = dot(subVec3(entity.position, origin), ray.direction);
    if (t < 0) continue;
    const closest = {
      x: origin.x + ray.direction.x * t,
      y: origin.y + ray.direction.y * t,
      z: origin.z + ray.direction.z * t,
    };
    const distance = distanceVec3(entity.position, closest);
    const radius = pickRadius(entity);
    if (distance > radius) continue;
    const score = distance / radius + t * 0.00001;
    if (!best || score < best.score) best = { entity, score };
  }
  return best?.entity ?? null;
}

function pickSceneHandle(
  scene: (SceneGfx & { pickEditorHandle?: (normalizedX: number, normalizedY: number) => SceneOverlayPick | null }) | null,
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
): SceneOverlayPick | null {
  if (!scene?.pickEditorHandle) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const normalizedX = (clientX - rect.left) / rect.width;
  const normalizedY = (clientY - rect.top) / rect.height;
  if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) return null;
  return scene.pickEditorHandle(normalizedX, normalizedY);
}

function pickScenePointsInRect(
  scene: (SceneGfx & { pickEditorPointsInRect?: (normalizedX0: number, normalizedY0: number, normalizedX1: number, normalizedY1: number) => string[] }) | null,
  marquee: MarqueeSelectionState,
  canvas: HTMLCanvasElement,
): string[] {
  if (!scene?.pickEditorPointsInRect) return [];
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return [];
  const normalizedX0 = clamp01((marquee.startX - rect.left) / rect.width);
  const normalizedY0 = clamp01((marquee.startY - rect.top) / rect.height);
  const normalizedX1 = clamp01((marquee.currentX - rect.left) / rect.width);
  const normalizedY1 = clamp01((marquee.currentY - rect.top) / rect.height);
  return scene.pickEditorPointsInRect(normalizedX0, normalizedY0, normalizedX1, normalizedY1);
}

function getMarqueeStyle(marquee: MarqueeSelectionState, canvas: HTMLCanvasElement | null) {
  const rect = canvas?.getBoundingClientRect();
  const offsetLeft = rect?.left ?? 0;
  const offsetTop = rect?.top ?? 0;
  const left = Math.min(marquee.startX, marquee.currentX) - offsetLeft;
  const top = Math.min(marquee.startY, marquee.currentY) - offsetTop;
  const width = Math.abs(marquee.currentX - marquee.startX);
  const height = Math.abs(marquee.currentY - marquee.startY);
  return {
    left,
    top,
    width,
    height,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pickToGizmoHandle(pick: SceneOverlayPick | null): GizmoHandleKey | null {
  if (!pick) return null;
  if (pick.kind === 'center') return { kind: 'center', id: pick.id };
  if (pick.kind === 'plane') return { kind: 'plane', id: pick.id, plane: pick.plane };
  if (pick.kind === 'axis') return { kind: 'axis', id: pick.id, axis: pick.axis };
  return null;
}

function gizmoHandleEquals(a: GizmoHandleKey | null, b: GizmoHandleKey | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind || a.id !== b.id) return false;
  if (a.kind === 'center') return true;
  if (a.kind === 'plane' && b.kind === 'plane') return a.plane === b.plane;
  if (a.kind === 'axis' && b.kind === 'axis') return a.axis === b.axis;
  return false;
}

function pickRadius(entity: KmpEntity): number {
  if (entity.section === 'GOBJ') return Math.max(260, Math.min(1800, Math.max(entity.scale?.x ?? 1, entity.scale?.y ?? 1, entity.scale?.z ?? 1) * 0.65));
  if (entity.section === 'CKPT') return 520;
  if (entity.section === 'AREA') return Math.max(360, Math.min(2000, Math.max(entity.scale?.x ?? 1, entity.scale?.y ?? 1, entity.scale?.z ?? 1) * 0.35));
  return 260;
}

function getGizmoLength(position: Vec3, cameraPosition: Vec3 | null, scale?: Vec3): number {
  const scaleLength = scale ? Math.max(scale.x, scale.y, scale.z) * 1.1 : 0;
  const baseLength = Math.max(180, Math.min(900, scaleLength || 260));
  if (!cameraPosition) return baseLength;
  const dx = position.x - cameraPosition.x;
  const dy = position.y - cameraPosition.y;
  const dz = position.z - cameraPosition.z;
  const distance = Math.hypot(dx, dy, dz);
  const distanceLength = Math.max(30, distance * 0.08);
  return Math.max(600, Math.min(1800, Math.max(baseLength, distanceLength)));
}

function getViewerCameraPosition(viewer: Viewer | null): Vec3 | null {
  if (!viewer) return null;
  const world = viewer.camera.worldMatrix;
  return {
    x: world[12] / MKW_RENDER_SCALE,
    y: world[13] / MKW_RENDER_SCALE,
    z: world[14] / MKW_RENDER_SCALE,
  };
}

function hasCameraPositionChanged(next: Vec3 | null, previous: Vec3 | null): boolean {
  if (!next || !previous) return true;
  return Math.hypot(next.x - previous.x, next.y - previous.y, next.z - previous.z) >= 1;
}

function addAxisDelta(vector: Vec3, axis: GizmoAxis, delta: number): Vec3 {
  return {
    x: axis === 'x' ? vector.x + delta : vector.x,
    y: axis === 'y' ? vector.y + delta : vector.y,
    z: axis === 'z' ? vector.z + delta : vector.z,
  };
}

function multiplyAxis(vector: Vec3, axis: GizmoAxis, factor: number): Vec3 {
  return {
    x: axis === 'x' ? vector.x * factor : vector.x,
    y: axis === 'y' ? vector.y * factor : vector.y,
    z: axis === 'z' ? vector.z * factor : vector.z,
  };
}

function axisDirectionFor(axis: GizmoAxis): Vec3 {
  if (axis === 'x') return { x: 1, y: 0, z: 0 };
  if (axis === 'y') return { x: 0, y: 1, z: 0 };
  return { x: 0, y: 0, z: 1 };
}

function getRotateRingBasis(axis: GizmoAxis): { x: Vec3; y: Vec3 } {
  if (axis === 'x') return { x: { x: 0, y: 1, z: 0 }, y: { x: 0, y: 0, z: 1 } };
  if (axis === 'y') return { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 0, z: 1 } };
  return { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 } };
}

function scaleVec3(vector: Vec3, scale: number): Vec3 {
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

function subVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function scaleDirection(direction: Vec3, amount: number): Vec3 {
  return { x: direction.x * amount, y: direction.y * amount, z: direction.z * amount };
}

function normalize(vector: Vec3): Vec3 | null {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length < 0.000001) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function distanceVec3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function ringAngleForHit(hit: Vec3, center: Vec3, basisX: Vec3, basisY: Vec3): number | null {
  const offset = subVec3(hit, center);
  const x = dot(offset, basisX);
  const y = dot(offset, basisY);
  if (Math.hypot(x, y) < 0.0001) return null;
  return Math.atan2(y, x);
}

function normalizeAngle(angle: number): number {
  while (angle <= -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  return angle;
}

function screenToWorldRay(clientX: number, clientY: number, canvas: HTMLCanvasElement, viewer: Viewer): { origin: Vec3; direction: Vec3 } | null {
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
  const inv = mat4.invert(mat4.create(), viewer.camera.clipFromWorldMatrix);
  if (!inv) return null;
  const near = vec4.fromValues(ndcX, ndcY, -1, 1);
  const far = vec4.fromValues(ndcX, ndcY, 1, 1);
  vec4.transformMat4(near, near, inv);
  vec4.transformMat4(far, far, inv);
  for (const point of [near, far]) {
    point[0] /= point[3];
    point[1] /= point[3];
    point[2] /= point[3];
  }
  const direction = vec3.normalize(vec3.create(), vec3.fromValues(far[0] - near[0], far[1] - near[1], far[2] - near[2]));
  return {
    origin: { x: near[0], y: near[1], z: near[2] },
    direction: { x: direction[0], y: direction[1], z: direction[2] },
  };
}

function projectWorldToClient(position: Vec3, canvas: HTMLCanvasElement, viewer: Viewer): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const clip = vec4.transformMat4(
    vec4.create(),
    vec4.fromValues(position.x * MKW_RENDER_SCALE, position.y * MKW_RENDER_SCALE, position.z * MKW_RENDER_SCALE, 1),
    viewer.camera.clipFromWorldMatrix,
  );
  if (!Number.isFinite(clip[3]) || Math.abs(clip[3]) < 0.00001) return null;
  const ndcX = clip[0] / clip[3];
  const ndcY = clip[1] / clip[3];
  if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) return null;
  return {
    x: rect.left + (ndcX * 0.5 + 0.5) * rect.width,
    y: rect.top + (0.5 - ndcY * 0.5) * rect.height,
  };
}

function screenToWorldOnPlane(clientX: number, clientY: number, canvas: HTMLCanvasElement, viewer: Viewer, planeY: number): Vec3 | null {
  const ray = screenToWorldRay(clientX, clientY, canvas, viewer);
  if (!ray || Math.abs(ray.direction.y) < 0.00001) return null;
  const t = (planeY - ray.origin.y) / ray.direction.y;
  if (t < 0) return null;
  return {
    x: ray.origin.x + ray.direction.x * t,
    y: planeY,
    z: ray.origin.z + ray.direction.z * t,
  };
}

function intersectScreenWithPlane(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  viewer: Viewer,
  planePoint: Vec3,
  planeNormal: Vec3,
): Vec3 | null {
  const ray = screenToWorldRay(clientX, clientY, canvas, viewer);
  if (!ray) return null;
  const denominator = dot(ray.direction, planeNormal);
  if (Math.abs(denominator) < 0.00001) return null;
  const distance = dot(subVec3(planePoint, ray.origin), planeNormal) / denominator;
  if (!Number.isFinite(distance) || distance < 0) return null;
  return addVec3(ray.origin, scaleDirection(ray.direction, distance));
}

function getCameraForward(canvas: HTMLCanvasElement, viewer: Viewer): Vec3 {
  const rect = canvas.getBoundingClientRect();
  const centerX = rect.left + rect.width * 0.5;
  const centerY = rect.top + rect.height * 0.5;
  return screenToWorldRay(centerX, centerY, canvas, viewer)?.direction ?? { x: 0, y: 0, z: -1 };
}

function getAxisDragPlaneNormal(axisDirection: Vec3, cameraForward: Vec3): Vec3 | null {
  const forwardComponent = subVec3(cameraForward, scaleDirection(axisDirection, dot(cameraForward, axisDirection)));
  const primary = normalize(forwardComponent);
  if (primary) return primary;

  const up = { x: 0, y: 1, z: 0 };
  const upComponent = subVec3(up, scaleDirection(axisDirection, dot(up, axisDirection)));
  const fallback = normalize(upComponent);
  if (fallback) return fallback;

  return normalize(cross(axisDirection, { x: 0, y: 0, z: 1 })) ?? normalize(cross(axisDirection, { x: 1, y: 0, z: 0 }));
}

function applyDirectCameraLook(viewer: Viewer, dx: number, dy: number) {
  const invertXMult = viewer.inputManager.invertX ? -1 : 1;
  const invertYMult = viewer.inputManager.invertY ? -1 : 1;
  const yaw = dx * (-1 / 500) * invertXMult;
  const pitch = dy * (-1 / 500) * invertYMult;
  const viewUp = vec3.create();
  getMatrixAxisY(viewUp, viewer.camera.viewMatrix);
  mat4.rotate(viewer.camera.worldMatrix, viewer.camera.worldMatrix, yaw, viewUp);
  mat4.rotate(viewer.camera.worldMatrix, viewer.camera.worldMatrix, pitch, vec3.fromValues(1, 0, 0));
  viewer.camera.worldMatrixUpdated();
}

function getCameraSmokeSignature(viewer: Viewer): string {
  const matrix = viewer.camera.worldMatrix;
  return [matrix[0], matrix[1], matrix[2], matrix[4], matrix[5], matrix[6], matrix[8], matrix[9], matrix[10], matrix[12], matrix[13], matrix[14]]
    .map((value) => value.toFixed(4))
    .join(',');
}

function sampleViewportState(canvas: HTMLCanvasElement): 'blank' | 'nonblank' | null {
  const gl = canvas.getContext('webgl2');
  if (!gl) return null;
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  if (width < 32 || height < 32) return null;

  const x0 = Math.max(0, Math.floor(width * 0.12));
  const x1 = Math.min(width, Math.floor(width * 0.7));
  const y0 = Math.max(0, Math.floor(height * 0.22));
  const y1 = Math.min(height, Math.floor(height * 0.78));
  const sampleWidth = Math.max(1, x1 - x0);
  const sampleHeight = Math.max(1, y1 - y0);
  const rgba = new Uint8Array(sampleWidth * sampleHeight * 4);
  gl.readPixels(x0, y0, sampleWidth, sampleHeight, gl.RGBA, gl.UNSIGNED_BYTE, rgba);

  let count = 0;
  let sum = 0;
  let sumSq = 0;
  let nonDark = 0;
  const colors = new Set<string>();
  for (let y = 0; y < sampleHeight; y += 4) {
    for (let x = 0; x < sampleWidth; x += 4) {
      const offset = (y * sampleWidth + x) * 4;
      const r = rgba[offset];
      const g = rgba[offset + 1];
      const b = rgba[offset + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += luma;
      sumSq += luma * luma;
      count++;
      if (luma > 28) nonDark++;
      if (colors.size < 4096) colors.add(`${r >> 3},${g >> 3},${b >> 3}`);
    }
  }

  const mean = sum / Math.max(1, count);
  const variance = sumSq / Math.max(1, count) - mean * mean;
  const channelStdDev = Math.sqrt(Math.max(0, variance));
  const nonDarkRatio = nonDark / Math.max(1, count);
  return colors.size >= 64 && channelStdDev >= 8 && nonDarkRatio >= 0.005 ? 'nonblank' : 'blank';
}

function makeLocalDataFetcher(commonArchiveUrl?: string | null): DataFetcher {
  return {
    fetchData: async (path: string) => {
      const url = commonArchiveUrl && path === 'MarioKartWii/Race/Common.szs' ? commonArchiveUrl : buildPublicAssetUrl(`data/${path}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to load renderer data ${path}: ${response.status}`);
      return new ArrayBufferSlice(await response.arrayBuffer()) as never;
    },
  } as unknown as DataFetcher;
}
