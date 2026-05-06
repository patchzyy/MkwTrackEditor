import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Box, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardPaste, Copy, Database, Download, Eye, FolderOpen, Move3D, PanelRightClose, PanelRightOpen, Redo2, RotateCcw, Scale3D, TriangleAlert, Undo2 } from 'lucide-react';
import {
  appendKmpArea,
  appendKmpCamera,
  appendKmpCheckpoint,
  appendKmpGobj,
  appendKmpPoint,
  appendKmpPotiPoint,
  appendKmpPotiRoute,
  deleteKmpEntity,
  getKmpCameraHeader,
  moveKmpEntity,
  parseKmp,
  patchKmpAreaField,
  patchKmpBattleFinishField,
  patchKmpCameraField,
  patchKmpCameraHeaderField,
  patchKmpCameraViewPosition,
  patchKmpCannonField,
  patchKmpCheckpointEndpoint,
  patchKmpCheckpointField,
  patchKmpEntityPosition,
  patchKmpEntityRotation,
  patchKmpEntityRouteIndex,
  patchKmpEntityScale,
  patchKmpGobjObjectId,
  patchKmpGobjPresenceFlags,
  patchKmpGobjSetting,
  patchKmpPathGroupLinks,
  patchKmpPointDeviation,
  patchKmpPointSetting,
  patchKmpPotiPointSetting,
  patchKmpPotiRouteSetting,
  patchKmpRespawnField,
  patchKmpStageField,
  patchKmpStageFlareColor,
  mergeKmpPathGroupWithNext,
  splitKmpPathGroup,
  type AppendableKmpSection,
  type AppendableKmpPointSection,
  type KmpAreaField,
  type KmpBattleFinishField,
  type KmpCameraField,
  type KmpCameraHeaderField,
  type KmpCheckpointField,
  type KmpCannonField,
  type KmpDocument,
  type KmpEntity,
  type KmpRespawnField,
  type KmpStageField,
  type Vec3,
} from '../lib/kmp';
import { raycastDown } from '../lib/kcl';
import { getObjFlowResourceNames, mergeCommonResourceEntries, parseCommonResourceArchive, type CommonResourceArchive, type ObjFlowEntry } from '../lib/objflow';
import { parseNoclipBrresSummary, type NoclipBrresSummary } from '../lib/noclipBrres';
import { describeEntity, exportTrack, loadTrackBytes, loadTrackFile, replaceCourseKmp, validateExportBytes, validateTrack, type TrackDocument } from '../lib/track';
import { parseU8 } from '../lib/u8';
import { comparePlaceableCourseAssetPriority, dedupePlaceableCourseAssetsForBrowser } from './browserAssetDedupe';
import { Noclip3DViewport, type TransformTool, type ViewMode } from './Noclip3DViewport';
import objectNamesById from '../generated/mkwObjectNames.json';

const objectCatalog = [
  { id: 0x65, label: 'Item Box', category: 'Gameplay' },
  { id: 0x191, label: 'Goomba', category: 'Enemies' },
  { id: 0x192, label: 'Monty Mole', category: 'Enemies' },
  { id: 0x194, label: 'Piranha Plant', category: 'Enemies' },
  { id: 0x148, label: 'Moving Platform', category: 'Gameplay' },
  { id: 0xe5, label: 'Crab', category: 'Enemies' },
  { id: 0xce, label: 'Shy Guy Obstacle', category: 'Gameplay' },
  { id: 0x197, label: 'Cataquack', category: 'Enemies' },
  { id: 0x1a5, label: 'Fire Bar', category: 'Gameplay' },
  { id: 0x162, label: 'Thwomp', category: 'Gameplay' },
  { id: 0x261, label: 'Cannon Object', category: 'Gameplay' },
];

const featuredObjectIds = [0x65, 0x191, 0x192, 0x194, 0x148, 0xe5, 0xce, 0x197, 0x1a5, 0x162, 0x261] as const;

const bundledCourseObjectResourceNames = new Set(['castle_tree1.brres', 'castle_tree2.brres', 'choropu.brres', 'kinoko_lift1.brres', 'kuribo.brres', 'npc_mii_a.brres', 'pakkun_f.brres', 'pendulum.brres']);
const guidanceOnlyObjectProfileNotes: Record<string, string> = {
  'Ambient Sound': 'This object does not use extra object settings here. Its setup comes from placement plus the Sound Range path below.',
  'Arena Finish Line': 'This object does not use extra object settings here. Its setup comes from exact placement across the arena section where laps or mission completions should count.',
  'Audience Flash': 'This object does not use complex route or collision setup here. Its main job is to support crowd presentation around the trick or ambience zone it belongs to.',
  Boo: 'This object does not use extra object settings here. Its main setup comes from placement, scale, and any linked area behavior.',
  'Burning Entry Effect': 'This object does not use extra object settings here. Its setup comes from the matching burning fall-boundary collision and the surrounding visuals, not from per-object numbers.',
  'Crowd Sound': 'This object does not use extra object settings here. Its main setup comes from placement plus the Sound Range path below.',
  'Frozen Water Effect': 'This object does not use extra object settings here. Its setup comes from icy water fall boundaries and the target slot, not from the object position itself.',
  'Half-Pipe Trigger': 'This object does not use extra object settings here. Its setup comes from exact placement against the course wall and the surrounding geometry.',
  'Invisible Barrier': 'This object does not use extra object settings here. Its setup comes from scale and placement so the invisible volume blocks only the space you intend.',
  'Jump Pad': 'This object does not use extra object settings here. Its setup comes from placement, rotation, and the takeoff and landing space you build around it.',
  'Leaf Effect': 'This object does not use extra object settings here. Its setup comes from placing the effect where players actually intersect the intended foliage zone.',
  'Lens Flare': 'This object does not use extra object settings here. Its setup comes from placement relative to the sun or bright focal point it should visually reinforce.',
  'Launch Star': 'This object does not use extra object settings here. Its setup comes from placement, facing, and the surrounding launch geometry that sells the jump in play.',
  'Moving Terrain Helper': 'This object usually works with moving-terrain collision or slot-specific setup instead of a POTI route. Check the KCL, slot behavior, and surrounding geometry before binding a path.',
  'Moving Aurora': 'This object does not use extra object settings here. Its setup comes from placement within the Rainbow Road setpiece and respecting its fixed transform limits.',
  'Pipe Hazard': 'This object does not use extra object settings here. Its setup comes from placement, scale, and the space you leave around it for readable avoidance.',
  'Snow Effect': 'This object does not use extra object settings here. Its setup comes from slot behavior and the surrounding snow presentation rather than local object values.',
  'Sea Surface': 'This object does not use extra object settings here. Its setup comes from scale, placement, and the matching slot or surrounding water logic.',
  'Pylon Obstacle': 'This object does not use extra object settings here. Its setup comes from placement, spacing, and the line choice it creates.',
  'Rolling Ball': 'This object does not use extra object settings here. Its behavior is driven by mission logic and the related CPU setup, not per-object fields in this inspector.',
  'Toad Factory Alarm': 'This object does not use extra object settings here. Its setup comes from placement near the related machinery or hazard timing you want to emphasize.',
  'Waterfall Effect': 'This object does not use extra object settings here. Its setup comes from placing the effect along the intended waterfall or flow volume so the particles support the scene.',
};
const enemyRouteSetting1Options = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Requires Mushroom' },
  { value: 2, label: 'Use Mushroom' },
  { value: 3, label: 'Allow Wheelie' },
  { value: 4, label: 'End Wheelie' },
];
const enemyRouteSetting2Options = [
  { value: 0, label: 'None' },
  { value: 1, label: 'End Drift' },
  { value: 2, label: 'Forbid Drift(?)' },
  { value: 3, label: 'Force Drift' },
];
const itemRouteSetting1Options = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Bullet Bill uses gravity' },
  { value: 2, label: 'Bullet Bill ignores gravity' },
];
const itemRouteSetting2Options = [
  { value: 0, label: 'None' },
  { value: 1, label: "Bullet Bill can't stop" },
  { value: 0x0a, label: 'Low-priority route' },
  { value: 0x0b, label: "Bullet Bill can't stop + low priority" },
];
const potiRouteShapeOptions = [
  { value: 0, label: 'Straight Edges' },
  { value: 1, label: 'Curved Edges' },
];
const potiRouteMotionOptions = [
  { value: 0, label: 'Cyclic Motion' },
  { value: 1, label: 'Back-and-Forth Motion' },
];
const areaTypeOptions = [
  { value: 0, label: 'Camera' },
  { value: 1, label: 'Environment Effect' },
  { value: 2, label: 'Fog Effect' },
  { value: 3, label: 'Moving Water' },
  { value: 4, label: 'Force Recalc' },
  { value: 5, label: 'Minimap Control' },
  { value: 6, label: 'Bloom Effect' },
  { value: 7, label: 'Enable Boos' },
  { value: 8, label: 'Object Group' },
  { value: 9, label: 'Object Unload' },
  { value: 10, label: 'Fall Boundary' },
];
const areaShapeOptions = [
  { value: 0, label: 'Box' },
  { value: 1, label: 'Cylinder' },
];
const areaEnvironmentEffectOptions = [
  { value: 0, label: 'EnvKareha' },
  { value: 1, label: 'EnvKarehaUp' },
];
const areaGroupIdOptions = Array.from({ length: 16 }, (_, value) => ({
  value,
  label: `Group ${value}`,
}));
const cannonEffectOptions = [
  { value: 0, label: 'Fast, Straight Line' },
  { value: 1, label: 'Curved' },
  { value: 2, label: 'Curved (Slow)' },
];
const itemBoxSettingOptions = [
  { value: 0x0000, label: 'Default Item Set' },
  { value: 0x0001, label: 'Banana' },
  { value: 0x0002, label: 'Mushroom' },
  { value: 0x0003, label: 'Triple Mushrooms' },
  { value: 0x0004, label: 'Star' },
  { value: 0x0005, label: 'Triple Green Shells' },
  { value: 0x0006, label: 'Banana / Mushroom (50/50)' },
  { value: 0x0007, label: 'Green Shell' },
  { value: 0x0008, label: 'Bob-omb' },
  { value: 0x0009, label: 'Red Shell' },
  { value: 0x000a, label: 'Mega Mushroom' },
  { value: 0x000b, label: 'Thunder Cloud' },
  { value: 0x000c, label: 'Star (95%) / Mushroom (5%)' },
  { value: 0x000d, label: 'Empty -> Mushroom' },
  { value: 0x000e, label: 'Empty -> Mushroom' },
  { value: 0x000f, label: 'Empty -> Mushroom' },
  { value: 0x0010, label: 'Empty -> Mushroom' },
  { value: 0x0255, label: 'Default Item Set (0x0255)' },
];
const itemBoxTimingOptions = [
  { value: 0x0000, label: 'Normal Roulette, Fast Respawn' },
  { value: 0x0002, label: 'Short Roulette, Fast Respawn' },
  { value: 0x0003, label: 'Short Roulette, Fast Respawn' },
  { value: 0x0004, label: 'Short Roulette, Medium Respawn' },
  { value: 0x0005, label: 'Normal Roulette, Medium Respawn' },
  { value: 0x0006, label: 'Normal Roulette, Slow Respawn' },
];
const driveableRingIdOptions = [
  { value: 1, label: 'Outer Ring' },
  { value: 2, label: 'Middle Ring' },
  { value: 3, label: 'Inner Ring' },
];
const epropellerDirectionOptions = [
  { value: 0, label: 'Clockwise' },
  { value: 1, label: 'Counterclockwise' },
];
const crabDirectionOptions = [
  { value: 0, label: 'Face Left' },
  { value: 1, label: 'Face Right' },
];
const spinDirectionOptions = [
  { value: 0, label: 'Clockwise' },
  { value: 1, label: 'Counterclockwise' },
];
const thwompBehaviorOptions = [
  { value: 0, label: 'No Route Behavior' },
  { value: 1, label: 'Stomp On Every Route Point' },
  { value: 2, label: 'Paired Side-Swing Thwomps' },
  { value: 3, label: 'Grounded Side-Swing Thwomp' },
];
const twanwanStartModeOptions = [
  { value: 0, label: 'Wait On First Route Point' },
  { value: 1, label: 'Start At Object Position + Release' },
];
const kartTruckTextureOptions = [
  { value: 0, label: 'Moo Moo' },
  { value: 1, label: 'Fruit' },
  { value: 2, label: 'Factory' },
];
const carBodyColorOptions = [
  { value: 0, label: 'Blue' },
  { value: 1, label: 'Red' },
  { value: 2, label: 'Yellow' },
];
const truckWagonCollisionOptions = [
  { value: 0, label: 'Collision Enabled' },
  { value: 1, label: 'No Collision / LOD Model' },
];
const shyGuyColorOptions = [
  { value: 0, label: 'Red' },
  { value: 1, label: 'Yellow' },
  { value: 2, label: 'Green' },
];
const chairliftModelOptions = [
  { value: 0, label: 'K_chairlift00' },
  { value: 1, label: 'K_chairlift01' },
];
const cataquackColorOptions = [
  { value: 0, label: 'Blue' },
  { value: 1, label: 'Red' },
  { value: 2, label: 'Violet' },
  { value: 3, label: 'Green' },
];

interface AreaInspectorOption {
  value: number;
  label: string;
}

interface AreaFogPreset {
  index: number;
  fogType: number;
  startZ: number;
  endZ: number;
  color: [number, number, number];
  fadeSpeed: number;
}

interface AreaBloomPreset {
  index: number;
  thresholdAmount: number;
  tintColor: [number, number, number];
  blur0Radius: number;
  blur0Intensity: number;
  blur1Radius: number;
  blur1Intensity: number;
}

interface AreaInspectorResources {
  fogPresets: AreaFogPreset[];
  bloomPresets: AreaBloomPreset[];
}

interface AreaInspectorConfig {
  cameraLabel?: string;
  routeLabel?: string;
  enemyLabel?: string;
  setting1Label?: string;
  setting2Label?: string;
  setting1Options?: AreaInspectorOption[];
  notes?: string[];
}

const emptyAreaInspectorResources: AreaInspectorResources = { fogPresets: [], bloomPresets: [] };

function getAreaInspectorResources(track: TrackDocument | null): AreaInspectorResources {
  if (!track) return emptyAreaInspectorResources;
  const fogEntry = track.archiveEntries.find((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('posteffect.bfg'));
  const fogPresets = fogEntry?.data ? parseAreaFogPresets(fogEntry.data) : [];
  const bloomPresets = track.archiveEntries
    .filter((entry) => entry.type === 'file' && /posteffect\/posteffect\.bblm\d*$/i.test(entry.path))
    .map((entry) => {
      const match = entry.path.match(/posteffect\.bblm(\d*)$/i);
      const suffix = match?.[1] ?? '';
      const index = suffix === '' ? 0 : Number(suffix);
      return entry.data && Number.isFinite(index) ? parseAreaBloomPreset(entry.data, index) : null;
    })
    .filter((preset): preset is AreaBloomPreset => preset !== null)
    .sort((a, b) => a.index - b.index);
  return { fogPresets, bloomPresets };
}

function parseAreaFogPresets(data: Uint8Array): AreaFogPreset[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const entrySize = 0x1c;
  const count = Math.min(4, Math.floor(data.byteLength / entrySize));
  const out: AreaFogPreset[] = [];
  for (let index = 0; index < count; index++) {
    const base = index * entrySize;
    out.push({
      index,
      fogType: view.getInt32(base, false),
      startZ: view.getFloat32(base + 0x04, false),
      endZ: view.getFloat32(base + 0x08, false),
      color: [view.getUint8(base + 0x0c), view.getUint8(base + 0x0d), view.getUint8(base + 0x0e)],
      fadeSpeed: view.getFloat32(base + 0x14, false),
    });
  }
  return out;
}

function parseAreaBloomPreset(data: Uint8Array, index: number): AreaBloomPreset | null {
  if (data.byteLength < 0xa4 || readAscii(data, 0, 4) !== 'PBLM') return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    index,
    thresholdAmount: view.getFloat32(0x10, false),
    tintColor: [view.getUint8(0x18), view.getUint8(0x19), view.getUint8(0x1a)],
    blur0Radius: view.getFloat32(0x20, false),
    blur0Intensity: view.getFloat32(0x24, false),
    blur1Radius: view.getFloat32(0x40, false),
    blur1Intensity: view.getFloat32(0x44, false),
  };
}

function readAscii(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.slice(offset, offset + length));
}

function getFogTypeLabel(fogType: number): string {
  switch (fogType) {
    case 0: return 'None';
    case 1: return 'Persp Linear';
    case 2: return 'Persp Exp';
    case 3: return 'Persp Exp2';
    case 4: return 'Persp InvExp';
    case 5: return 'Persp InvExp2';
    case 6: return 'Ortho Linear';
    case 7: return 'Ortho Exp';
    case 8: return 'Ortho Exp2';
    case 9: return 'Ortho InvExp';
    case 10: return 'Ortho InvExp2';
    default: return `Type ${fogType}`;
  }
}

function formatCompactFloat(value: number): string {
  return Number.isFinite(value) ? Number(value.toFixed(Math.abs(value) >= 10 ? 1 : 2)).toString() : '0';
}

function getAreaInspectorConfig(type: number, resources: AreaInspectorResources): AreaInspectorConfig {
  switch (type) {
    case 0:
      return {
        cameraLabel: 'Area Camera',
        notes: ['Activates the linked camera while the player is inside this AREA. Higher priority wins when multiple camera AREAs overlap.'],
      };
    case 1:
      return {
        setting1Label: 'Environment Variant',
        setting1Options: areaEnvironmentEffectOptions,
        notes: ['Overrides the local environment effect. Nintendo uses this to force EnvKareha or EnvKarehaUp in specific regions.'],
      };
    case 2:
      return {
        setting1Label: 'Fog Preset',
        setting1Options: resources.fogPresets.map((preset) => ({
          value: preset.index,
          label: `Preset ${preset.index} - ${getFogTypeLabel(preset.fogType)} - RGB ${preset.color.join('/')} - Z ${formatCompactFloat(preset.startZ)} to ${formatCompactFloat(preset.endZ)}`,
        })),
        notes: [
          'Swaps to a posteffect.bfg fog entry while inside this AREA.',
          resources.fogPresets.length > 0
            ? 'The picker below comes from the loaded track archive.'
            : 'No posteffect.bfg was found in the loaded track archive, so this stays as a raw index.',
        ],
      };
    case 3:
      return {
        routeLabel: 'Moving Terrain Route',
        setting1Label: 'Accel / Decel Amplifier',
        setting2Label: 'Water Speed',
        notes: ['Used by moving terrain. The route matters for moving-water setups, and these two settings are especially relevant for the 0x0002 KCL variant.'],
      };
    case 4:
      return {
        enemyLabel: 'Destination Enemy Point',
        notes: ['Used with Force Recalculation collision. This AREA redirects CPUs, and the AREA position and rotation are also part of the setup.'],
      };
    case 5:
      return {
        notes: ['Controls minimap behavior such as culling, visibility, and special cropped-mission-style usage. The raw parameters are not documented well enough for a high-level editor yet.'],
      };
    case 6:
      return {
        setting1Label: 'Bloom / Blur Preset',
        setting2Label: 'Transition Frames',
        setting1Options: resources.bloomPresets.map((preset) => ({
          value: preset.index,
          label: `Preset ${preset.index} - Tint ${preset.tintColor.join('/')} - Threshold ${formatCompactFloat(preset.thresholdAmount)} - Blur ${formatCompactFloat(preset.blur0Radius)}/${formatCompactFloat(preset.blur1Radius)}`,
        })),
        notes: [
          'Swaps the active posteffect.bblm file while inside this AREA.',
          resources.bloomPresets.length > 0
            ? 'Transition time is measured in frames.'
            : 'No posteffect.bblm files were found in the loaded track archive, so this stays as a raw index.',
        ],
      };
    case 7:
      return {
        notes: ['Defines a region where flying Boos can appear. There are no extra numeric parameters for the vanilla behavior.'],
      };
    case 8:
      return {
        setting1Label: 'Group ID',
        setting1Options: areaGroupIdOptions,
        notes: ['Groups objects together. Type 9 can unload matching type 8 groups that share the same group ID.'],
      };
    case 9:
      return {
        setting1Label: 'Group ID',
        setting1Options: areaGroupIdOptions,
        notes: ['Unloads objects from type 8 AREAs that use the same group ID while the player is inside this AREA.'],
      };
    case 10:
      return {
        setting1Label: 'Checkpoint Start',
        setting2Label: 'Checkpoint End',
        notes: ['Adds a fall boundary without changing KCL. In vanilla this is mainly used for tournaments and custom conditional OOB patches.'],
      };
    default:
      return {};
  }
}

const pylonColorOptions = [
  { value: 0, label: 'Red' },
  { value: 1, label: 'Blue' },
  { value: 2, label: 'Yellow' },
];
const miiSpectatorInteractionOptions = [
  { value: 0, label: 'Static Crowd' },
  { value: 1, label: 'Face Player And Clap' },
];
const topmanBehaviorOptions = [
  { value: 0, label: 'Default / Unknown' },
  { value: 1, label: 'Coward' },
  { value: 2, label: 'Aggressive' },
];
const coinModeOptions = [
  { value: 0, label: 'Battle' },
  { value: 1, label: 'Tournament / Mission' },
];
const directItemOptions = [
  { value: 0, label: 'Green Shell' },
  { value: 1, label: 'Red Shell' },
  { value: 2, label: 'Banana' },
  { value: 3, label: 'Mushroom' },
  { value: 4, label: 'Star' },
];
const beltCurveStartSideOptions = [
  { value: 0, label: 'Fast Side Starts On Right' },
  { value: 1, label: 'Fast Side Starts On Left' },
];
const audienceFlashWaluigiOptions = [
  { value: 0, label: 'Flash Waluigi A' },
  { value: 1, label: 'Flash Waluigi B' },
  { value: 2, label: 'Flash Waluigi C' },
];
const audienceFlashSkateOptions = [
  { value: 0, label: 'Flash Skate A' },
  { value: 1, label: 'Flash Skate B' },
];
const gobjPresenceModeOptions = [
  { mask: 0x01, label: '1P / Time Trial' },
  { mask: 0x02, label: '2P Split-Screen' },
  { mask: 0x04, label: '3P / 4P Split-Screen' },
];

interface ReferenceCounts {
  routes: number;
  cameras: number;
  enemyPoints: number;
  checkpoints: number;
  respawns: number;
}

interface ObjectInspectorProfile {
  title: string;
  summary: string;
  tips: string[];
  cautions?: string[];
  routeLabel?: string;
  variantLabel?: string;
}

interface ObjectOption {
  id: number;
  label: string;
  detail: string;
}

interface EditorSnapshot {
  track: TrackDocument | null;
  selectedId: string | null;
  selectedIds: string[];
}

interface ClipboardEntity {
  anchor: Vec3;
  primaryId: string | null;
  entries: Array<{
    entity: KmpEntity;
    relativeOffset: Vec3;
    order: number;
  }>;
}

const HISTORY_LIMIT = 128;

const kmpPointCatalog: Array<{ section: AppendableKmpSection; label: string; category: string }> = [
  { section: 'KTPT', label: 'Start Point', category: 'Track Data' },
  { section: 'ENPT', label: 'Enemy Route Node', category: 'Routes' },
  { section: 'ITPT', label: 'Item Route Node', category: 'Routes' },
  { section: 'CKPT', label: 'Checkpoint Pair', category: 'Routes' },
  { section: 'POTI', label: 'Movement Route', category: 'Routes' },
  { section: 'CAME', label: 'Camera', category: 'Camera' },
  { section: 'AREA', label: 'Area Trigger', category: 'Gameplay' },
  { section: 'JGPT', label: 'Respawn Point', category: 'Gameplay' },
  { section: 'CNPT', label: 'Cannon Point', category: 'Gameplay' },
  { section: 'MSPT', label: 'Battle Finish Point', category: 'Battle' },
];

type BrowserObject = (typeof objectCatalog)[number] | ObjFlowEntry;
type BrowserAssetItem = BrowserObject | PlaceableCourseAssetRecord;
type BrowserFolderId = 'featured' | 'kmp' | 'enemies' | 'nature' | 'gameplay' | 'props' | 'common' | 'track';
interface CourseAssetRecord {
  id: string;
  source: 'courseArchive' | 'sharedObjectDir';
  trackFile: string | null;
  trackLabel: string;
  path: string;
  baseName: string;
  kind: 'course' | 'skybox' | 'object' | 'sharedObject' | 'other';
}

interface PlaceableCourseAssetRecord extends CourseAssetRecord {
  objectId: number | null;
  objectLabel: string | null;
}

interface CourseAssetDatabase {
  generatedFrom: string;
  generatedAt: string;
  trackCount: number;
  assetCount: number;
  uniqueBaseNames: number;
  assets: CourseAssetRecord[];
}

type BrowserFolder =
  | { id: BrowserFolderId; label: string; detail: string; kind: 'kmp'; items: typeof kmpPointCatalog }
  | { id: BrowserFolderId; label: string; detail: string; kind: 'object'; items: BrowserAssetItem[] }
  | { id: BrowserFolderId; label: string; detail: string; kind: 'brres'; items: string[] };

export function App() {
  const CONTENT_BROWSER_COLLAPSED_HEIGHT = 46;
  const CONTENT_BROWSER_DEFAULT_HEIGHT = 248;
  const CONTENT_BROWSER_MIN_HEIGHT = 140;
  const WORKSPACE_MIN_HEIGHT = 160;
  const PLACE_ASSETS_COLLAPSED_WIDTH = 52;
  const PLACE_ASSETS_DEFAULT_WIDTH = 220;
  const PLACE_ASSETS_MIN_WIDTH = 160;
  const INSPECTOR_DEFAULT_WIDTH = 320;
  const INSPECTOR_MIN_WIDTH = 220;
  const WORKSPACE_MIN_VIEWPORT_WIDTH = 320;
  const smokeTrackUrl = useMemo(() => (typeof window === 'undefined' ? null : new URL(window.location.href).searchParams.get('smokeTrack')), []);
  const smokeCallbackUrl = useMemo(() => (typeof window === 'undefined' ? null : new URL(window.location.href).searchParams.get('smokeCallback')), []);
  const smokeCommonUrl = useMemo(() => (typeof window === 'undefined' ? null : new URL(window.location.href).searchParams.get('smokeCommon')), []);
  const smokeMode = smokeTrackUrl !== null;
  const smokeReportRef = useRef<string | null>(null);
  const smokeUndoRedoStartedRef = useRef(false);
  const [track, setTrack] = useState<TrackDocument | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tool, setTool] = useState<TransformTool>('translate');
  const [viewMode, setViewMode] = useState<ViewMode>('normal');
  const [browserOpen, setBrowserOpen] = useState(true);
  const [browserHeight, setBrowserHeight] = useState(CONTENT_BROWSER_DEFAULT_HEIGHT);
  const [browserResizing, setBrowserResizing] = useState(false);
  const [placeAssetsOpen, setPlaceAssetsOpen] = useState(true);
  const [placeAssetsWidth, setPlaceAssetsWidth] = useState(PLACE_ASSETS_DEFAULT_WIDTH);
  const [browserFolder, setBrowserFolder] = useState<BrowserFolderId>('featured');
  const [browserQuery, setBrowserQuery] = useState('');
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const [sidebarResizing, setSidebarResizing] = useState<'placeAssets' | 'inspector' | null>(null);
  const [collisionVisible, setCollisionVisible] = useState(false);
  const [status, setStatus] = useState('No track loaded');
  const [commonArchive, setCommonArchive] = useState<CommonResourceArchive | null>(null);
  const [courseAssetDb, setCourseAssetDb] = useState<CourseAssetDatabase | null>(null);
  const [commonBrresSummaries, setCommonBrresSummaries] = useState<Record<string, NoclipBrresSummary>>({});
  const [commonLoadStatus, setCommonLoadStatus] = useState('idle');
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const [hasClipboardEntity, setHasClipboardEntity] = useState(false);
  const [smokeUndoRedoWorked, setSmokeUndoRedoWorked] = useState<'pending' | 'yes' | 'no'>('pending');
  const [batchOffset, setBatchOffset] = useState<Vec3>({ x: 0, y: 0, z: 0 });
  const [batchObjectId, setBatchObjectId] = useState<number | null>(null);
  const appShellRef = useRef<HTMLElement | null>(null);
  const topBarRef = useRef<HTMLElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const browserResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const sidebarResizeRef = useRef<{ side: 'placeAssets' | 'inspector'; startX: number; startWidth: number } | null>(null);
  const trackStateRef = useRef<TrackDocument | null>(track);
  const selectedIdStateRef = useRef<string | null>(selectedId);
  const selectedIdsStateRef = useRef<string[]>(selectedIds);
  const undoStackRef = useRef<EditorSnapshot[]>([]);
  const redoStackRef = useRef<EditorSnapshot[]>([]);
  const editSessionRef = useRef<EditorSnapshot | null>(null);
  const clipboardEntityRef = useRef<ClipboardEntity | null>(null);
  const objFlow = commonArchive?.objFlow ?? null;
  const selected = useMemo(() => track?.kmp?.entities.find((entity) => entity.id === selectedId) ?? null, [track, selectedId]);
  const selectedEntities = useMemo(() => {
    if (!track?.kmp || selectedIds.length === 0) return [];
    const selectedSet = new Set(selectedIds);
    return track.kmp.entities.filter((entity) => selectedSet.has(entity.id));
  }, [track, selectedIds]);
  const selectedPathInfo = useMemo(() => (selected && track?.kmp ? getPathInfo(track.kmp, selected) : null), [track, selected]);
  const canBatchReplaceObjects = useMemo(
    () => selectedEntities.length > 1 && selectedEntities.every((entity) => entity.section === 'GOBJ' && entity.objectId !== undefined),
    [selectedEntities],
  );
  const cameraHeader = useMemo(() => (track?.kmp ? getKmpCameraHeader(track.kmp) : null), [track]);
  const referenceCounts = useMemo(() => getReferenceCounts(track?.kmp ?? null), [track?.kmp]);
  const validation = useMemo(() => (track ? validateTrack(track, { common: commonArchive }) : []), [track, commonArchive]);
  const areaInspectorResources = useMemo(() => getAreaInspectorResources(track), [track]);
  const selectedObjectProfile = useMemo(() => (selected?.section === 'GOBJ' ? getObjectInspectorProfile(selected, objFlow) : null), [objFlow, selected]);
  const validationCounts = useMemo(() => {
    const errorCount = validation.filter((item) => item.level === 'error').length;
    const warningCount = validation.filter((item) => item.level === 'warning').length + (track?.warnings.length ?? 0);
    return { errorCount, warningCount };
  }, [track?.warnings.length, validation]);
  const objectOptions = useMemo<ObjectOption[]>(() => {
    const selectedObjectId = selected?.section === 'GOBJ' ? selected.objectId ?? null : null;
    const ids = new Set<number>();
    for (const key of Object.keys(objectNamesById as Record<string, string>)) {
      const parsed = Number(key);
      if (Number.isFinite(parsed)) ids.add(parsed);
    }
    for (const entry of objFlow?.entries ?? []) ids.add(entry.objectId);
    return [...ids]
      .map((id) => {
        const flow = objFlow?.byId.get(id);
        return {
          id,
          label: browserObjectTitle({ objectId: id, name: flow?.name ?? '', resources: flow?.resources ?? '' }),
          detail: flow?.resources || flow?.name || 'Unknown object',
        };
      })
      .filter((option) => option.id === selectedObjectId || isBrowsableObjectChoice(option.id, option.label, option.detail))
      .sort((a, b) => a.label.localeCompare(b.label) || a.id - b.id);
  }, [objFlow, selected]);
  const selectedObjectVariantOptions = useMemo(
    () => (selected?.section === 'GOBJ' && selectedObjectProfile ? getObjectVariantOptions(selectedObjectProfile, objectOptions) : []),
    [objectOptions, selected, selectedObjectProfile],
  );
  const quickObjectOptions = useMemo(
    () =>
      [...featuredObjectIds]
        .map((id) => objectOptions.find((option) => option.id === id))
        .filter((option): option is ObjectOption => option !== undefined),
    [objectOptions],
  );
  const realObjectCatalog = useMemo(() => {
    if (!objFlow) return [];
    return objFlow.entries
      .filter((entry) => entry.name || entry.resources)
      .filter((entry) => isBrowsableObjectEntry(entry))
      .sort((a, b) => countAvailableResources(b, commonArchive) - countAvailableResources(a, commonArchive))
      .slice(0, 180);
  }, [objFlow, commonArchive]);
  const browserFolders = useMemo<BrowserFolder[]>(() => {
    const objects = (realObjectCatalog.length ? realObjectCatalog : objectCatalog).filter((object, index, list) => index === list.findIndex((candidate) => catalogId(candidate) === catalogId(object)));
    const placeableCourseAssets = dedupePlaceableCourseAssetsForBrowser(
      courseAssetDb?.assets
        .filter((asset) => asset.kind === 'object' || asset.kind === 'sharedObject')
        .map((asset) => mapCourseAssetToPlaceable(asset, objFlow)) ?? [],
      new Set(objects.map((object) => catalogId(object))),
    ).sort((a, b) => comparePlaceableCourseAssetPriority(a, b));
    const featured = objects.filter((object) => isFeaturedObject(object)).slice(0, 18);
    const enemies = [...objects.filter((object) => classifyObjectFolder(object) === 'enemies'), ...placeableCourseAssets.filter((asset) => classifyObjectFolder(asset) === 'enemies')].slice(0, 72);
    const nature = [...objects.filter((object) => classifyObjectFolder(object) === 'nature'), ...placeableCourseAssets.filter((asset) => classifyObjectFolder(asset) === 'nature')].slice(0, 72);
    const gameplay = [...objects.filter((object) => classifyObjectFolder(object) === 'gameplay'), ...placeableCourseAssets.filter((asset) => classifyObjectFolder(asset) === 'gameplay')].slice(0, 72);
    const props = [...objects.filter((object) => classifyObjectFolder(object) === 'props'), ...placeableCourseAssets.filter((asset) => classifyObjectFolder(asset) === 'props')].slice(0, 72);
    const common = [...objects, ...placeableCourseAssets].slice(0, 240);
    const trackAssets = track?.brresFiles.slice(0, 48) ?? [];
    return [
      { id: 'featured', label: 'Common', detail: `${featured.length} highlighted objects`, kind: 'object', items: featured },
      { id: 'kmp', label: 'Track Data', detail: `${kmpPointCatalog.length} editable track records`, kind: 'kmp', items: kmpPointCatalog },
      { id: 'enemies', label: 'Enemies', detail: `${enemies.length} common enemies`, kind: 'object', items: enemies },
      { id: 'nature', label: 'Nature', detail: `${nature.length} trees and foliage`, kind: 'object', items: nature },
      { id: 'gameplay', label: 'Gameplay', detail: `${gameplay.length} interactive objects`, kind: 'object', items: gameplay },
      { id: 'props', label: 'Props', detail: `${props.length} scenery and structures`, kind: 'object', items: props },
      { id: 'common', label: 'All Objects', detail: `${common.length} placeable game objects`, kind: 'object', items: common },
      { id: 'track', label: 'Track Meshes', detail: track ? `${trackAssets.length} track asset files` : 'Load a track to list track assets', kind: 'brres', items: trackAssets },
    ].filter((folder) => folder.items.length > 0 || folder.id === 'track');
  }, [commonArchive, courseAssetDb, objFlow, realObjectCatalog, track]);
  const activeBrowserFolder = browserFolders.find((folder) => folder.id === browserFolder) ?? browserFolders[0] ?? null;
  const filteredBrowserFolder = useMemo(() => filterBrowserFolder(activeBrowserFolder, browserQuery), [activeBrowserFolder, browserQuery]);
  trackStateRef.current = track;
  selectedIdStateRef.current = selectedId;
  selectedIdsStateRef.current = selectedIds;

  useEffect(() => {
    if (!browserFolders.some((folder) => folder.id === browserFolder) && browserFolders[0]) setBrowserFolder(browserFolders[0].id);
  }, [browserFolder, browserFolders]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resize = browserResizeRef.current;
      const shell = appShellRef.current;
      if (!resize || !shell) return;
      const topBarHeight = topBarRef.current?.getBoundingClientRect().height ?? 48;
      const maxHeight = Math.max(
        CONTENT_BROWSER_MIN_HEIGHT,
        Math.floor(shell.getBoundingClientRect().height - topBarHeight - WORKSPACE_MIN_HEIGHT),
      );
      const nextHeight = Math.max(
        CONTENT_BROWSER_MIN_HEIGHT,
        Math.min(maxHeight, Math.round(resize.startHeight + (resize.startY - event.clientY))),
      );
      setBrowserOpen(true);
      setBrowserHeight(nextHeight);
    };

    const stopResize = () => {
      if (!browserResizeRef.current) return;
      browserResizeRef.current = null;
      setBrowserResizing(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resize = sidebarResizeRef.current;
      const workspace = workspaceRef.current;
      if (!resize || !workspace) return;
      const availableWidth = workspace.getBoundingClientRect().width;
      const otherWidth = resize.side === 'placeAssets'
        ? (inspectorOpen ? inspectorWidth : 0)
        : (placeAssetsOpen ? placeAssetsWidth : PLACE_ASSETS_COLLAPSED_WIDTH);
      const maxWidth = Math.max(
        resize.side === 'placeAssets' ? PLACE_ASSETS_MIN_WIDTH : INSPECTOR_MIN_WIDTH,
        Math.floor(availableWidth - otherWidth - WORKSPACE_MIN_VIEWPORT_WIDTH),
      );
      const rawWidth = resize.side === 'placeAssets'
        ? resize.startWidth + (event.clientX - resize.startX)
        : resize.startWidth + (resize.startX - event.clientX);
      const nextWidth = Math.max(
        resize.side === 'placeAssets' ? PLACE_ASSETS_MIN_WIDTH : INSPECTOR_MIN_WIDTH,
        Math.min(maxWidth, Math.round(rawWidth)),
      );
      if (resize.side === 'placeAssets') {
        setPlaceAssetsOpen(true);
        setPlaceAssetsWidth(nextWidth);
      } else {
        setInspectorOpen(true);
        setInspectorWidth(nextWidth);
      }
    };

    const stopResize = () => {
      if (!sidebarResizeRef.current) return;
      sidebarResizeRef.current = null;
      setSidebarResizing(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [inspectorOpen, inspectorWidth, placeAssetsOpen, placeAssetsWidth]);

  useEffect(() => {
    if (!browserResizing && !sidebarResizing) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = browserResizing ? 'ns-resize' : 'ew-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [browserResizing, sidebarResizing]);

  useEffect(() => {
    if (canBatchReplaceObjects) {
      setBatchObjectId(selectedEntities[0]?.objectId ?? null);
    } else {
      setBatchObjectId(null);
    }
  }, [canBatchReplaceObjects, selectedEntities]);

  function beginBrowserResize(event: React.PointerEvent<HTMLElement>) {
    browserResizeRef.current = {
      startY: event.clientY,
      startHeight: browserOpen ? browserHeight : CONTENT_BROWSER_COLLAPSED_HEIGHT,
    };
    setBrowserOpen(true);
    setBrowserResizing(true);
  }

  function beginSidebarResize(side: 'placeAssets' | 'inspector', event: React.PointerEvent<HTMLElement>) {
    sidebarResizeRef.current = {
      side,
      startX: event.clientX,
      startWidth: side === 'placeAssets' ? placeAssetsWidth : inspectorWidth,
    };
    if (side === 'placeAssets') setPlaceAssetsOpen(true);
    else setInspectorOpen(true);
    setSidebarResizing(side);
  }

  const workspaceStyle: CSSProperties = {
    ['--place-assets-width' as '--place-assets-width']: `${placeAssetsOpen ? placeAssetsWidth : PLACE_ASSETS_COLLAPSED_WIDTH}px`,
    ['--inspector-width' as '--inspector-width']: `${inspectorOpen ? inspectorWidth : 0}px`,
  };

  function syncHistoryState() {
    setHistoryState({
      undo: undoStackRef.current.length,
      redo: redoStackRef.current.length,
    });
  }

  function captureSnapshot(trackValue = trackStateRef.current, selectedValue = selectedIdStateRef.current, selectedValues = selectedIdsStateRef.current): EditorSnapshot {
    return {
      track: trackValue,
      selectedId: selectedValue,
      selectedIds: [...selectedValues],
    };
  }

  function resetHistory() {
    undoStackRef.current = [];
    redoStackRef.current = [];
    editSessionRef.current = null;
    syncHistoryState();
  }

  function pushUndoSnapshot(snapshot: EditorSnapshot) {
    undoStackRef.current = [...undoStackRef.current.slice(-(HISTORY_LIMIT - 1)), snapshot];
    redoStackRef.current = [];
    syncHistoryState();
  }

  function applySelection(nextSelectedIds: string[], nextSelectedId = nextSelectedIds.at(-1) ?? null) {
    selectedIdStateRef.current = nextSelectedId;
    selectedIdsStateRef.current = nextSelectedIds;
    setSelectedId(nextSelectedId);
    setSelectedIds(nextSelectedIds);
  }

  function applyEditorSnapshot(snapshot: EditorSnapshot) {
    trackStateRef.current = snapshot.track;
    setTrack(snapshot.track);
    applySelection(snapshot.selectedIds, snapshot.selectedId ?? snapshot.selectedIds.at(-1) ?? null);
  }

  function applyEditorChange(
    nextTrack: TrackDocument | null,
    nextSelectedId: string | null = selectedIdStateRef.current,
    recordHistory = true,
    nextSelectedIds: string[] = selectedIdsStateRef.current,
  ) {
    const current = captureSnapshot();
    if (editSessionRef.current) {
      applyEditorSnapshot({ track: nextTrack, selectedId: nextSelectedId, selectedIds: nextSelectedIds });
      return;
    }
    const selectionChanged =
      nextSelectedId !== current.selectedId ||
      nextSelectedIds.length !== current.selectedIds.length ||
      nextSelectedIds.some((value, index) => value !== current.selectedIds[index]);
    if (recordHistory && (nextTrack !== current.track || selectionChanged)) pushUndoSnapshot(current);
    applyEditorSnapshot({ track: nextTrack, selectedId: nextSelectedId, selectedIds: nextSelectedIds });
  }

  function beginEditSession() {
    if (editSessionRef.current) return;
    editSessionRef.current = captureSnapshot();
  }

  function endEditSession() {
    const before = editSessionRef.current;
    if (!before) return;
    editSessionRef.current = null;
    const after = captureSnapshot();
    if (after.track !== before.track || after.selectedId !== before.selectedId) pushUndoSnapshot(before);
  }

  function undoEdit() {
    endEditSession();
    const snapshot = undoStackRef.current.at(-1);
    if (!snapshot) return;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current.slice(-(HISTORY_LIMIT - 1)), captureSnapshot()];
    applyEditorSnapshot(snapshot);
    syncHistoryState();
    setStatus('Undid last edit.');
  }

  function redoEdit() {
    endEditSession();
    const snapshot = redoStackRef.current.at(-1);
    if (!snapshot) return;
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current.slice(-(HISTORY_LIMIT - 1)), captureSnapshot()];
    applyEditorSnapshot(snapshot);
    syncHistoryState();
    setStatus('Redid last edit.');
  }

  function selectEntity(id: string | null, additive = false) {
    if (!id) {
      if (!additive) applySelection([]);
      return;
    }
    if (!additive) {
      applySelection([id], id);
      return;
    }
    const current = selectedIdsStateRef.current;
    const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    applySelection(next, next.includes(id) ? id : next.at(-1) ?? null);
  }

  function selectEntities(ids: string[], additive = false) {
    const uniqueIds = ids.filter((id, index) => ids.indexOf(id) === index);
    if (!additive) {
      applySelection(uniqueIds, uniqueIds.at(-1) ?? null);
      return;
    }
    const current = selectedIdsStateRef.current;
    const next = [...current];
    for (const id of uniqueIds) {
      if (!next.includes(id)) next.push(id);
    }
    applySelection(next, uniqueIds.at(-1) ?? next.at(-1) ?? null);
  }

  function findMatchingEntity(document: KmpDocument, template: KmpEntity): KmpEntity | null {
    if (template.routePoint) {
      return (
        document.entities.find(
          (entity) =>
            entity.routePoint?.routeIndex === template.routePoint?.routeIndex && entity.routePoint?.pointIndex === template.routePoint?.pointIndex,
        ) ?? null
      );
    }
    return document.entities.find((entity) => entity.section === template.section && entity.index === template.index) ?? null;
  }

  function getDeletionOrder(a: KmpEntity, b: KmpEntity): number {
    if (a.routePoint && b.routePoint) {
      if (a.routePoint.routeIndex !== b.routePoint.routeIndex) return b.routePoint.routeIndex - a.routePoint.routeIndex;
      return b.routePoint.pointIndex - a.routePoint.pointIndex;
    }
    if (a.section !== b.section) return String(b.section).localeCompare(String(a.section));
    return b.index - a.index;
  }

  function canCopyEntity(entity: KmpEntity | null): boolean {
    if (!entity) return false;
    return entity.section !== 'STGI';
  }

  function canCopySelection(): boolean {
    if (selectedEntities.length > 1) return selectedEntities.every((entity) => canCopyEntity(entity));
    return canCopyEntity(selected);
  }

  function copySelectedEntity() {
    const entities = getClipboardSourceEntities(selectedEntities, selected);
    if (entities.length === 0 || !canCopySelection()) return;
    clipboardEntityRef.current = createClipboardEntity(entities, selectedIdStateRef.current);
    setHasClipboardEntity(true);
    setStatus(entities.length === 1 ? `Copied ${entityLabel(entities[0])}.` : `Copied ${entities.length} selected elements.`);
  }

  function duplicateSelectedEntity() {
    const entities = getClipboardSourceEntities(selectedEntities, selected);
    if (entities.length === 0 || !canCopySelection()) return;
    const clipboard = createClipboardEntity(entities, selectedIdStateRef.current);
    clipboardEntityRef.current = clipboard;
    setHasClipboardEntity(true);
    pasteClipboardEntity(clipboard, { x: 300, y: 0, z: 300 }, true);
  }

  function pasteClipboardEntity(clipboard = clipboardEntityRef.current, offset = { x: 300, y: 0, z: 300 }, reportDuplicate = false) {
    if (!track?.kmp || !clipboard) return;
    try {
      let current = track.kmp;
      const nextSelectedIds: string[] = [];
      let nextSelectedId: string | null = null;
      for (const entry of sortClipboardEntriesForPaste(clipboard.entries)) {
        const pastedPosition = {
          x: clipboard.anchor.x + offset.x + entry.relativeOffset.x,
          y: clipboard.anchor.y + offset.y + entry.relativeOffset.y,
          z: clipboard.anchor.z + offset.z + entry.relativeOffset.z,
        };
        const result = appendCopiedEntity(current, entry.entity, pastedPosition);
        current = parseKmp(result.bytes);
        nextSelectedIds.push(result.selectedId);
        if (entry.entity.id === clipboard.primaryId) nextSelectedId = result.selectedId;
      }
      const nextTrack = replaceCourseKmp(track, current.original);
      applyEditorChange(nextTrack, nextSelectedId ?? nextSelectedIds.at(-1) ?? null, true, nextSelectedIds);
      const count = clipboard.entries.length;
      if (count === 1) {
        setStatus(reportDuplicate ? `Duplicated ${entityLabel(clipboard.entries[0].entity)}.` : `Pasted ${entityLabel(clipboard.entries[0].entity)}.`);
      } else {
        setStatus(reportDuplicate ? `Duplicated ${count} selected elements.` : `Pasted ${count} selected elements.`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadBundledCommon() {
      try {
        if (!cancelled) setCommonLoadStatus('fetching bundled common assets');
        const response = await fetch(smokeCommonUrl ?? '/data/MarioKartWii/Race/Common.szs');
        if (!response.ok) {
          if (!cancelled) {
            setCommonLoadStatus(`fetch failed: HTTP ${response.status}`);
            if (smokeMode) setStatus(`Bundled common asset archive fetch failed: HTTP ${response.status}`);
          }
          return;
        }
        const baseCommon = parseCommonResourceArchive(new Uint8Array(await response.arrayBuffer()));
        if (!cancelled) setCommonLoadStatus('loaded base common assets');
        const common = smokeMode
          ? await withBundledCourseObjectResources(baseCommon, getSmokePreviewResourceNames(baseCommon.objFlow))
          : await withExtractedCourseAssetResources(await withBundledCourseObjectResources(baseCommon));
        if (!cancelled) {
          setCommonArchive((current) => current ?? common);
          setCommonLoadStatus(`ready: ${common.objFlow.entries.length} objects, ${common.resourceEntries.length} resources`);
          setStatus((current) => (current === 'No track loaded' ? `Loaded bundled common assets: ${common.objFlow.entries.length} game objects` : current));
        }
      } catch (error) {
        if (!cancelled) {
          setCommonLoadStatus(error instanceof Error ? `load failed: ${error.message}` : `load failed: ${String(error)}`);
          if (smokeMode) setStatus(error instanceof Error ? `Bundled common asset load failed: ${error.message}` : `Bundled common asset load failed: ${String(error)}`);
        }
        // Manual Common.szs loading remains available if the bundled file is absent.
      }
    }
    void loadBundledCommon();
    return () => {
      cancelled = true;
    };
  }, [smokeMode, smokeCommonUrl]);

  useEffect(() => {
    let cancelled = false;
    async function loadCourseAssetDb() {
      try {
        const response = await fetch('/data/MarioKartWii/Race/Course/course-asset-db.json');
        if (!response.ok) return;
        const next = (await response.json()) as CourseAssetDatabase;
        if (!cancelled) setCourseAssetDb(next);
      } catch {
        // Keep the browser usable if the optional course asset database is absent.
      }
    }
    void loadCourseAssetDb();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!smokeTrackUrl) return;
    let cancelled = false;
    async function loadSmokeTrack() {
      try {
        setStatus('Loading browser smoke track...');
        const response = await fetch(smokeTrackUrl);
        if (!response.ok) throw new Error(`Smoke track fetch failed: HTTP ${response.status}`);
        const pathName = new URL(smokeTrackUrl, window.location.href).pathname;
        const fileName = decodeURIComponent(pathName.split('/').pop() || 'smoke.szs');
        const loaded = await loadTrackBytes(new Uint8Array(await response.arrayBuffer()), fileName, { brresSummaryLimit: 4 });
        if (cancelled) return;
        applyEditorSnapshot({ track: loaded, selectedId: null, selectedIds: [] });
        resetHistory();
        setStatus(`Loaded ${fileName}: ${loaded.archiveEntries.length} files, ${loaded.kmp?.entities.length ?? 0} editable track records`);
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : String(error));
      }
    }
    void loadSmokeTrack();
    return () => {
      cancelled = true;
    };
  }, [smokeTrackUrl]);

  useEffect(() => {
    if (!commonArchive) {
      setCommonBrresSummaries({});
      return;
    }
    let cancelled = false;
    async function parseCommonSummaries() {
      const referencedResources = new Set(commonArchive.objFlow.entries.flatMap((entry) => getObjFlowResourceNames(entry).map((name) => name.toLowerCase())));
      const brresEntries = commonArchive.resourceEntries
        .filter((entry) => entry.type === 'file' && entry.data && entry.path.toLowerCase().endsWith('.brres'))
        .sort((a, b) => scoreCommonPreviewResource(b, referencedResources) - scoreCommonPreviewResource(a, referencedResources))
        .slice(0, smokeMode ? 12 : 180);
      const summaries: Record<string, NoclipBrresSummary> = {};
      for (const entry of brresEntries) {
        if (cancelled || !entry.data) return;
        try {
          const key = entry.path.split('/').pop()?.toLowerCase() ?? entry.path.toLowerCase();
          summaries[key] = await parseNoclipBrresSummary(entry.data);
          if (!cancelled) setCommonBrresSummaries({ ...summaries });
        } catch {
          // Some object resources are special-purpose BRRES files; keep the browser usable if one fails.
        }
      }
      if (!cancelled) setCommonBrresSummaries(summaries);
    }
    void parseCommonSummaries();
    return () => {
      cancelled = true;
    };
  }, [commonArchive, smokeMode]);

  useEffect(() => {
    if (!smokeCallbackUrl || typeof document === 'undefined') return;
    let cancelled = false;
    const sendReport = () => {
      const rendererStatus = document.querySelector('.rendererStatus')?.textContent?.trim() ?? '';
      const report = {
        status,
        commonLoadStatus,
        rendererStatus,
        loaded: track !== null,
        rendered: rendererStatus.includes('rendered with noclip Mario Kart Wii renderer'),
        hasCommonArchiveLoaded: commonArchive !== null,
        commonObjectCount: commonArchive?.objFlow.entries.length ?? 0,
        commonSummaryCount: Object.keys(commonBrresSummaries).length,
        hasCourseAssetDb: courseAssetDb !== null,
        hasViewportCanvas: document.querySelector('canvas.noclipCanvas') !== null,
        hasLegacyPointHandles: document.querySelector('.kmp3dHandle') !== null,
        hasNonblankViewportProbe: document.querySelector('[data-viewport-sample="nonblank"]') !== null,
        hasSmokeSelectedGobjRendered: document.querySelector('[data-smoke-selected-gobj-rendered="yes"]') !== null,
        hasSmokeSelectedGobjSnapped: document.querySelector('[data-smoke-selected-gobj-snapped="yes"]') !== null,
        hasSmokeMouseLook: document.querySelector('[data-smoke-mouselook="yes"]') !== null,
        hasSmokeUndoRedo: smokeUndoRedoWorked === 'yes',
        hasAvailableObjectResource: document.querySelector('.thumbnail.objectPreview[data-state="available"]') !== null,
        hasObjectThumbnailImage:
          document.querySelector('.thumbnail.objectPreview[data-state="available"][data-preview="image"] img[src^="data:image/png;base64,"]') !== null,
        hasInspectorToggle: document.querySelector('[aria-label="Hide inspector"], [aria-label="Show inspector"]') !== null,
        hasContentBrowserToggle: document.querySelector('[aria-label="Collapse content browser"], [aria-label="Expand content browser"]') !== null,
      };
      const ready =
        report.loaded &&
        report.rendered &&
        report.hasViewportCanvas &&
        !report.hasLegacyPointHandles &&
        report.hasNonblankViewportProbe &&
        report.hasSmokeSelectedGobjRendered &&
        report.hasSmokeSelectedGobjSnapped &&
        report.hasSmokeMouseLook &&
        report.hasSmokeUndoRedo &&
        report.hasAvailableObjectResource &&
        report.hasObjectThumbnailImage &&
        report.hasInspectorToggle &&
        report.hasContentBrowserToggle;
      const payload = JSON.stringify({ ...report, ready });
      if (payload === smokeReportRef.current) return;
      smokeReportRef.current = payload;
      const blob = new Blob([payload], { type: 'text/plain;charset=UTF-8' });
      if (!navigator.sendBeacon?.(smokeCallbackUrl, blob)) {
        void fetch(smokeCallbackUrl, { method: 'POST', mode: 'no-cors', body: blob });
      }
    };
    sendReport();
    const interval = window.setInterval(() => {
      if (cancelled) return;
      sendReport();
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [smokeCallbackUrl, status, commonLoadStatus, track, commonArchive, commonBrresSummaries, courseAssetDb, smokeUndoRedoWorked]);

  useEffect(() => {
    if (!smokeMode || smokeUndoRedoStartedRef.current || !track?.kmp || !selected || selected.section !== 'GOBJ') return;
    const beforeCount = countSectionEntities(track.kmp.entities, 'GOBJ');
    if (beforeCount === 0) return;
    smokeUndoRedoStartedRef.current = true;
    setSmokeUndoRedoWorked('pending');
    copySelectedEntity();
    duplicateSelectedEntity();

    const frame1 = window.requestAnimationFrame(() => {
      const afterDuplicateCount = countSectionEntities(trackStateRef.current?.kmp?.entities ?? [], 'GOBJ');
      if (afterDuplicateCount !== beforeCount + 1) {
        setSmokeUndoRedoWorked('no');
        return;
      }
      undoEdit();
      const frame2 = window.requestAnimationFrame(() => {
        const afterUndoCount = countSectionEntities(trackStateRef.current?.kmp?.entities ?? [], 'GOBJ');
        if (afterUndoCount !== beforeCount) {
          setSmokeUndoRedoWorked('no');
          return;
        }
        redoEdit();
        const frame3 = window.requestAnimationFrame(() => {
          const afterRedoCount = countSectionEntities(trackStateRef.current?.kmp?.entities ?? [], 'GOBJ');
          setSmokeUndoRedoWorked(afterRedoCount === beforeCount + 1 ? 'yes' : 'no');
        });
        return () => window.cancelAnimationFrame(frame3);
      });
      return () => window.cancelAnimationFrame(frame2);
    });

    return () => window.cancelAnimationFrame(frame1);
  }, [smokeMode, selected, track]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const meta = event.ctrlKey || event.metaKey;
      if (meta) {
        if (event.key.toLowerCase() === 'z') {
          event.preventDefault();
          if (event.shiftKey) redoEdit();
          else undoEdit();
          return;
        }
        if (event.key.toLowerCase() === 'y') {
          event.preventDefault();
          redoEdit();
          return;
        }
        if (event.key.toLowerCase() === 'c') {
          event.preventDefault();
          copySelectedEntity();
          return;
        }
        if (event.key.toLowerCase() === 'v') {
          event.preventDefault();
          pasteClipboardEntity();
          return;
        }
        if (event.key.toLowerCase() === 'd') {
          event.preventDefault();
          duplicateSelectedEntity();
          return;
        }
        if (event.key.toLowerCase() === 's') {
          event.preventDefault();
          downloadExport();
        }
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIdsStateRef.current.length > 0) {
        event.preventDefault();
        deleteSelectedEntity();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, track]);

  async function openFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    try {
      setStatus(`Loading ${file.name}...`);
      const loaded = await loadTrackFile(file);
      applyEditorSnapshot({ track: loaded, selectedId: null, selectedIds: [] });
      resetHistory();
      setStatus(`Loaded ${file.name}: ${loaded.archiveEntries.length} files, ${loaded.kmp?.entities.length ?? 0} editable track records`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function moveEntity(entity: KmpEntity, position: Vec3) {
    if (!track?.kmp) return;
    const nextKmp = patchKmpEntityPosition(track.kmp, entity, position);
    applyEditorChange(replaceCourseKmp(track, nextKmp));
  }

  function moveCheckpointEndpoint(entity: KmpEntity, side: 'left' | 'right', position: Vec3) {
    if (!track?.kmp) return;
    const nextKmp = patchKmpCheckpointEndpoint(track.kmp, entity, side, position);
    applyEditorChange(replaceCourseKmp(track, nextKmp));
  }

  function rotateEntity(entity: KmpEntity, rotation: Vec3) {
    if (!track?.kmp || !entity.rotation) return;
    applyEditorChange(replaceCourseKmp(track, patchKmpEntityRotation(track.kmp, entity, rotation)));
  }

  function scaleEntity(entity: KmpEntity, scale: Vec3) {
    if (!track?.kmp || !entity.scale) return;
    applyEditorChange(replaceCourseKmp(track, patchKmpEntityScale(track.kmp, entity, scale)));
  }

  function patchSelectedEntity(patch: (kmp: KmpDocument, entity: KmpEntity) => Uint8Array) {
    if (!track?.kmp || !selected) return;
    applyEditorChange(replaceCourseKmp(track, patch(track.kmp, selected)));
  }

  function addObject(objectId: number, position: Vec3) {
    if (!track?.kmp) return;
    try {
      const nextKmp = appendKmpGobj(track.kmp, objectId, position);
      const nextTrack = replaceCourseKmp(track, nextKmp);
      const newSelectedId = `GOBJ-${(nextTrack.kmp?.sections.find((section) => section.name === 'GOBJ')?.count ?? 1) - 1}`;
      applyEditorChange(nextTrack, newSelectedId, true, [newSelectedId]);
      setStatus(`Added ${browserObjectTitle({ objectId, name: objFlow?.byId.get(objectId)?.name ?? '', resources: objFlow?.byId.get(objectId)?.resources ?? '' })} at ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function addKmpPoint(section: AppendableKmpSection, position: Vec3) {
    if (!track?.kmp) return;
    try {
      const nextKmp =
        section === 'CKPT'
          ? appendKmpCheckpoint(track.kmp, position)
          : section === 'POTI'
            ? appendKmpPotiRoute(track.kmp, position)
            : section === 'AREA'
              ? appendKmpArea(track.kmp, position)
              : section === 'CAME'
                ? appendKmpCamera(track.kmp, position)
            : appendKmpPoint(track.kmp, section as AppendableKmpPointSection, position);
      const nextTrack = replaceCourseKmp(track, nextKmp);
      const nextCount = section === 'POTI' ? (nextTrack.kmp?.routes.length ?? 1) : (nextTrack.kmp?.sections.find((candidate) => candidate.name === section)?.count ?? 1);
      const newIndex = nextCount - 1;
      const newSelectedId = section === 'POTI' ? `POTI-${newIndex}-0` : `${section}-${newIndex}`;
      applyEditorChange(nextTrack, newSelectedId, true, [newSelectedId]);
      setStatus(`Added ${friendlySectionSingularLabel(section)} at ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function addPotiNode(entity: KmpEntity) {
    if (!track?.kmp || !entity.routePoint) return;
    try {
      const position = { x: entity.position.x + 300, y: entity.position.y, z: entity.position.z };
      const nextKmp = appendKmpPotiPoint(track.kmp, entity.routePoint.routeIndex, entity.routePoint.pointIndex, position);
      const nextTrack = replaceCourseKmp(track, nextKmp);
      const newSelectedId = `POTI-${entity.routePoint.routeIndex}-${entity.routePoint.pointIndex + 1}`;
      applyEditorChange(nextTrack, newSelectedId, true, [newSelectedId]);
      setStatus(`Added node to object route ${entity.routePoint.routeIndex}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function createObjectRoute(entity: KmpEntity) {
    if (!track?.kmp || entity.section !== 'GOBJ' || entity.routeIndex === undefined || entity.routeIndex !== 0xffff) return;
    try {
      const routedBytes = appendKmpPotiRoute(track.kmp, entity.position);
      const routedDoc = parseKmp(routedBytes);
      const liveEntity = routedDoc.entities.find((candidate) => candidate.id === entity.id);
      if (!liveEntity) throw new Error('Could not find the selected object after creating a route.');
      const routeIndex = Math.max(0, routedDoc.routes.length - 1);
      const nextTrack = replaceCourseKmp(track, patchKmpEntityRouteIndex(routedDoc, liveEntity, routeIndex));
      applyEditorChange(nextTrack, entity.id, true, [entity.id]);
      setStatus(`Created movement path ${routeIndex} for ${entityLabel(entity)}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function resetObjectBehavior(entity: KmpEntity) {
    if (!track?.kmp || entity.section !== 'GOBJ') return;
    try {
      let nextDoc = track.kmp;
      let liveEntity = nextDoc.entities.find((candidate) => candidate.id === entity.id);
      if (!liveEntity) return;
      nextDoc = parseKmp(patchKmpEntityRouteIndex(nextDoc, liveEntity, 0xffff));
      liveEntity = nextDoc.entities.find((candidate) => candidate.id === entity.id);
      if (!liveEntity) return;
      for (let i = 0; i < 8; i++) {
        nextDoc = parseKmp(patchKmpGobjSetting(nextDoc, liveEntity, i, 0));
        liveEntity = nextDoc.entities.find((candidate) => candidate.id === entity.id);
        if (!liveEntity) return;
      }
      nextDoc = parseKmp(patchKmpGobjPresenceFlags(nextDoc, liveEntity, 0x003f));
      applyEditorChange(replaceCourseKmp(track, nextDoc.original), entity.id, true, [entity.id]);
      setStatus(`Reset ${entityLabel(entity)} to default object behavior.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function clearObjectRoute(entity: KmpEntity) {
    if (!track?.kmp || entity.section !== 'GOBJ' || entity.routeIndex === undefined || entity.routeIndex === 0xffff) return;
    try {
      const nextTrack = replaceCourseKmp(track, patchKmpEntityRouteIndex(track.kmp, entity, 0xffff));
      applyEditorChange(nextTrack, entity.id, true, [entity.id]);
      setStatus(`Cleared movement path from ${entityLabel(entity)}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function selectObjectRoute(entity: KmpEntity) {
    if (!track?.kmp || entity.section !== 'GOBJ' || entity.routeIndex === undefined || entity.routeIndex === 0xffff) return;
    const routeId = `POTI-${entity.routeIndex}-0`;
    const routeEntity = track.kmp.entities.find((candidate) => candidate.id === routeId);
    if (!routeEntity) {
      setStatus(`Could not find movement path ${entity.routeIndex} for ${entityLabel(entity)}.`);
      return;
    }
    setSelectedId(routeId);
    setSelectedIds([routeId]);
    setStatus(`Selected movement path ${entity.routeIndex} for ${entityLabel(entity)}.`);
  }

  function applySafeFallingRockDefaults(entity: KmpEntity) {
    if (!track?.kmp || entity.section !== 'GOBJ' || !entity.objectSettings) return;
    try {
      const safeTriggerSetting = entity.objectSettings[2] === 0 ? 1 : entity.objectSettings[2];
      const nextTrack = replaceCourseKmp(track, patchKmpGobjSetting(track.kmp, entity, 2, safeTriggerSetting));
      applyEditorChange(nextTrack, entity.id, true, [entity.id]);
      setStatus(`Applied safe vanilla falling-rock defaults to ${entityLabel(entity)}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function createCannonPointFromObject(entity: KmpEntity) {
    if (!track?.kmp || entity.section !== 'GOBJ') return;
    try {
      const appended = parseKmp(appendKmpPoint(track.kmp, 'CNPT', entity.position));
      const cannonIndex = (appended.sections.find((section) => section.name === 'CNPT')?.count ?? 1) - 1;
      const newCannonId = `CNPT-${cannonIndex}`;
      const newCannon = appended.entities.find((candidate) => candidate.id === newCannonId);
      if (!newCannon) throw new Error('Could not find the new cannon point after creating it.');
      const rotated = parseKmp(patchKmpEntityRotation(appended, newCannon, entity.rotation));
      const nextTrack = replaceCourseKmp(track, rotated.original);
      applyEditorChange(nextTrack, newCannonId, true, [newCannonId]);
      setStatus(`Created cannon point ${cannonIndex} from ${entityLabel(entity)}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function applyRoulettePlatformDefaults(entity: KmpEntity) {
    if (!track?.kmp || entity.section !== 'GOBJ') return;
    try {
      let nextDoc = parseKmp(patchKmpEntityPosition(track.kmp, entity, { x: 0, y: 0, z: 0 }));
      let liveEntity = nextDoc.entities.find((candidate) => candidate.id === entity.id);
      if (!liveEntity) throw new Error('Could not find the selected roulette platform after moving it.');
      nextDoc = parseKmp(patchKmpEntityRotation(nextDoc, liveEntity, { x: 0, y: 0, z: 0 }));
      liveEntity = nextDoc.entities.find((candidate) => candidate.id === entity.id);
      if (!liveEntity) throw new Error('Could not find the selected roulette platform after rotating it.');
      nextDoc = parseKmp(patchKmpEntityScale(nextDoc, liveEntity, { x: 1, y: 1, z: 1 }));
      applyEditorChange(replaceCourseKmp(track, nextDoc.original), entity.id, true, [entity.id]);
      setStatus(`Applied required world-center defaults to ${entityLabel(entity)}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function deleteSelectedEntity() {
    if (!track?.kmp || selectedEntities.length === 0) return;
    const deletable = selectedEntities.filter((entity) => entity.section !== 'STGI').sort(getDeletionOrder);
    if (deletable.length === 0) return;
    const label = deletable.length === 1 ? entityLabel(deletable[0]) : `${deletable.length} selected elements`;
    if (!window.confirm(`Delete ${label}?`)) return;
    try {
      let current = track.kmp;
      let deletedCount = 0;
      for (const entity of deletable) {
        const live = findMatchingEntity(current, entity);
        if (!live) continue;
        current = parseKmp(deleteKmpEntity(current, live));
        deletedCount++;
      }
      if (deletedCount === 0) return;
      applyEditorChange(replaceCourseKmp(track, current.original), null, true, []);
      setStatus(deletedCount === 1 ? `Deleted ${label}.` : `Deleted ${deletedCount} selected elements.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function moveSelectedEntity(direction: -1 | 1) {
    if (!track?.kmp || !selected) return;
    try {
      const nextTrack = replaceCourseKmp(track, moveKmpEntity(track.kmp, selected, direction));
      const nextIndex = selected.routePoint ? selected.routePoint.pointIndex + direction : selected.index + direction;
      const nextId = selected.routePoint ? `POTI-${selected.routePoint.routeIndex}-${nextIndex}` : `${selected.section}-${nextIndex}`;
      const newSelectedId = nextTrack.kmp?.entities.some((entity) => entity.id === nextId) ? nextId : selected.id;
      applyEditorChange(nextTrack, newSelectedId, true, [newSelectedId]);
      setStatus(`Moved ${entityLabel(selected)} ${direction < 0 ? 'earlier' : 'later'}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function splitSelectedPathGroup() {
    if (!track?.kmp || !selected || !selectedPathInfo) return;
    try {
      applyEditorChange(
        replaceCourseKmp(track, splitKmpPathGroup(track.kmp, selected.section as 'ENPT' | 'ITPT' | 'CKPT', selectedPathInfo.groupIndex, selectedPathInfo.localIndex)),
        selected.id,
        true,
        [selected.id],
      );
      setStatus(`Split ${friendlyGroupSectionLabel(selectedPathInfo.groupSection)} group ${selectedPathInfo.groupIndex}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function mergeSelectedPathGroup() {
    if (!track?.kmp || !selected || !selectedPathInfo) return;
    try {
      applyEditorChange(
        replaceCourseKmp(track, mergeKmpPathGroupWithNext(track.kmp, selected.section as 'ENPT' | 'ITPT' | 'CKPT', selectedPathInfo.groupIndex)),
        selected.id,
        true,
        [selected.id],
      );
      setStatus(`Merged ${friendlyGroupSectionLabel(selectedPathInfo.groupSection)} group ${selectedPathInfo.groupIndex}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function snapSelectedToCollision() {
    if (!track?.kmp || !track.kcl || !selected) return;
    if (selected.checkpoint) {
      const left = raycastDown(track.kcl, selected.checkpoint.left.x, selected.checkpoint.left.z);
      const right = raycastDown(track.kcl, selected.checkpoint.right.x, selected.checkpoint.right.z);
      if (!left && !right) {
        setStatus('No collision surface found below checkpoint endpoints.');
        return;
      }
      let nextBytes = track.kmp.original;
      if (left) nextBytes = patchKmpCheckpointEndpoint(track.kmp, selected, 'left', left);
      if (right) {
        const nextDoc = parseKmp(nextBytes);
        const nextEntity = nextDoc.entities.find((entity) => entity.id === selected.id) ?? selected;
        nextBytes = patchKmpCheckpointEndpoint(nextDoc, nextEntity, 'right', right);
      }
      applyEditorChange(replaceCourseKmp(track, nextBytes));
      setStatus('Snapped checkpoint endpoints to the collision surface.');
      return;
    }

    const hit = raycastDown(track.kcl, selected.position.x, selected.position.z);
    if (!hit) {
      setStatus(`No collision surface found below ${entityLabel(selected)}.`);
      return;
    }
    applyEditorChange(replaceCourseKmp(track, patchKmpEntityPosition(track.kmp, selected, hit)));
    setStatus(`Snapped ${entityLabel(selected)} to the collision surface.`);
  }

  function offsetSelectedEntities() {
    if (!track?.kmp || selectedEntities.length < 2) return;
    if (batchOffset.x === 0 && batchOffset.y === 0 && batchOffset.z === 0) return;
    try {
      let current = track.kmp;
      let movedCount = 0;
      for (const entity of selectedEntities) {
        if (entity.section === 'STGI') continue;
        const live = findMatchingEntity(current, entity);
        if (!live) continue;
        current = parseKmp(
          patchKmpEntityPosition(current, live, {
            x: live.position.x + batchOffset.x,
            y: live.position.y + batchOffset.y,
            z: live.position.z + batchOffset.z,
          }),
        );
        movedCount++;
      }
      if (movedCount === 0) return;
      applyEditorChange(replaceCourseKmp(track, current.original), selectedIdStateRef.current, true, selectedIdsStateRef.current);
      setStatus(`Offset ${movedCount} selected elements.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function snapMultipleSelectedToCollision() {
    if (!track?.kmp || !track.kcl || selectedEntities.length < 2) return;
    try {
      let current = track.kmp;
      let snappedCount = 0;
      for (const entity of selectedEntities) {
        if (entity.section === 'STGI') continue;
        const live = findMatchingEntity(current, entity);
        if (!live) continue;
        if (live.checkpoint) {
          const left = raycastDown(track.kcl, live.checkpoint.left.x, live.checkpoint.left.z);
          const right = raycastDown(track.kcl, live.checkpoint.right.x, live.checkpoint.right.z);
          let nextBytes = current.original;
          let changed = false;
          if (left) {
            nextBytes = patchKmpCheckpointEndpoint(current, live, 'left', left);
            changed = true;
          }
          if (right) {
            const nextDoc = parseKmp(nextBytes);
            const nextEntity = findMatchingEntity(nextDoc, live) ?? live;
            nextBytes = patchKmpCheckpointEndpoint(nextDoc, nextEntity, 'right', right);
            changed = true;
          }
          if (!changed) continue;
          current = parseKmp(nextBytes);
          snappedCount++;
          continue;
        }
        const hit = raycastDown(track.kcl, live.position.x, live.position.z);
        if (!hit) continue;
        current = parseKmp(patchKmpEntityPosition(current, live, hit));
        snappedCount++;
      }
      if (snappedCount === 0) {
        setStatus('No collision surface found below the selected elements.');
        return;
      }
      applyEditorChange(replaceCourseKmp(track, current.original), selectedIdStateRef.current, true, selectedIdsStateRef.current);
      setStatus(`Snapped ${snappedCount} selected elements to the collision surface.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function replaceSelectedObjectTypes(objectId: number) {
    if (!track?.kmp || !canBatchReplaceObjects) return;
    try {
      let current = track.kmp;
      let updatedCount = 0;
      for (const entity of selectedEntities) {
        const live = findMatchingEntity(current, entity);
        if (!live || live.section !== 'GOBJ') continue;
        current = parseKmp(patchKmpGobjObjectId(current, live, objectId));
        updatedCount++;
      }
      if (updatedCount === 0) return;
      applyEditorChange(replaceCourseKmp(track, current.original), selectedIdStateRef.current, true, selectedIdsStateRef.current);
      setStatus(`Changed ${updatedCount} selected objects to ${browserObjectTitle({ objectId, name: '', resources: '' })}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function openCommon(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    try {
      const common = await withExtractedCourseAssetResources(await withBundledCourseObjectResources(parseCommonResourceArchive(new Uint8Array(await file.arrayBuffer()))));
      setCommonArchive(common);
      setStatus(`Loaded ${file.name}: ${common.objFlow.entries.length} game object definitions, ${common.resourceEntries.length} shared asset files`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function entityLabel(entity: KmpEntity): string {
    if (entity.section !== 'GOBJ' || entity.objectId === undefined) return describeEntity(entity);
    const title = browserObjectTitle({ objectId: entity.objectId, name: objFlow?.byId.get(entity.objectId)?.name ?? '', resources: objFlow?.byId.get(entity.objectId)?.resources ?? '' });
    return `${title} #${entity.index}`;
  }

  function downloadExport() {
    if (!track) return;
    const issues = validateTrack(track, { common: commonArchive });
    if (issues.length > 0) {
      const errors = issues.filter((issue) => issue.level === 'error').length;
      const warnings = issues.length - errors;
      const summary = issues
        .slice(0, 8)
        .map((issue) => {
          const presented = presentValidationIssue(issue.message);
          return `${issue.level.toUpperCase()}: ${presented.summary}${presented.detail ? ` (${presented.detail})` : ''}`;
        })
        .join('\n');
      const suffix = issues.length > 8 ? `\n...and ${issues.length - 8} more.` : '';
      const proceed = window.confirm(`Export with ${errors} errors and ${warnings} warnings?\n\n${summary}${suffix}`);
      if (!proceed) {
        setStatus('Export cancelled after validation review.');
        return;
      }
      setStatus(`Exporting with ${errors} validation errors and ${warnings} warnings.`);
    }
    const bytes = exportTrack(track, { common: commonArchive });
    const exportIssues = validateExportBytes(track, bytes, { common: commonArchive });
    if (exportIssues.length > 0) {
      const errors = exportIssues.filter((issue) => issue.level === 'error').length;
      const warnings = exportIssues.length - errors;
      const summary = exportIssues
        .slice(0, 8)
        .map((issue) => {
          const presented = presentValidationIssue(issue.message);
          return `${issue.level.toUpperCase()}: ${presented.summary}${presented.detail ? ` (${presented.detail})` : ''}`;
        })
        .join('\n');
      const suffix = exportIssues.length > 8 ? `\n...and ${exportIssues.length - 8} more.` : '';
      const proceed = errors === 0 && window.confirm(`Export self-check found ${warnings} warnings.\n\n${summary}${suffix}`);
      if (!proceed) {
        setStatus(errors ? `Export blocked: ${errors} exported archive errors.` : 'Export cancelled after archive self-check.');
        return;
      }
    }
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = track.fileName.replace(/\.szs$/i, '') + '.edited.szs';
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${link.download} (${bytes.length.toLocaleString()} bytes).`);
  }

  return (
    <main
      ref={appShellRef}
      className="appShell"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void openFiles(event.dataTransfer.files);
      }}
    >
      <header ref={topBarRef} className="topBar">
        <div className="brand">
          <Box size={18} />
          <strong>MKW Track Editor</strong>
        </div>
        <label className="button">
          <FolderOpen size={16} />
          Open .szs
          <input hidden type="file" accept=".szs" onChange={(event) => void openFiles(event.currentTarget.files)} />
        </label>
        <label className="button">
          <Database size={16} />
          Common
          <input hidden type="file" accept=".szs,.bin" onChange={(event) => void openCommon(event.currentTarget.files)} />
        </label>
        <div className="segmented">
          <button className={tool === 'translate' ? 'active' : ''} onClick={() => setTool('translate')} title="Translate">
            <Move3D size={16} />
          </button>
          <button className={tool === 'rotate' ? 'active' : ''} onClick={() => setTool('rotate')} title="Rotate">
            <RotateCcw size={16} />
          </button>
          <button className={tool === 'scale' ? 'active' : ''} onClick={() => setTool('scale')} title="Scale">
            <Scale3D size={16} />
          </button>
        </div>
        <div className="segmented viewModeSegmented" aria-label="Viewport view mode">
          <button className={viewMode === 'normal' ? 'active' : ''} onClick={() => setViewMode('normal')} title="Normal view">
            Normal
          </button>
          <button className={viewMode === 'dev' ? 'active' : ''} onClick={() => setViewMode('dev')} title="Collision dev view">
            Dev
          </button>
          <button className={viewMode === 'topdown' ? 'active' : ''} onClick={() => setViewMode('topdown')} title="Top-down view">
            Top
          </button>
          <button className={viewMode === 'ortho' ? 'active' : ''} onClick={() => setViewMode('ortho')} title="Orthographic view">
            Ortho
          </button>
        </div>
        <button className={collisionVisible ? 'button active' : 'button'} onClick={() => setCollisionVisible((value) => !value)}>
          <Eye size={16} />
          Collision
        </button>
        <button className="button" disabled={!canCopySelection()} onClick={copySelectedEntity} title="Copy selection (Ctrl/Cmd+C)">
          <Copy size={16} />
          Copy
        </button>
        <button className="button" disabled={!canCopySelection()} onClick={duplicateSelectedEntity} title="Duplicate selection (Ctrl/Cmd+D)">
          <Copy size={16} />
          Duplicate
        </button>
        <button className="button" disabled={!hasClipboardEntity || !track?.kmp} onClick={() => pasteClipboardEntity()} title="Paste copied entity (Ctrl/Cmd+V)">
          <ClipboardPaste size={16} />
          Paste
        </button>
        <button className="button" disabled={historyState.undo === 0} onClick={undoEdit} title="Undo (Ctrl/Cmd+Z)">
          <Undo2 size={16} />
          Undo
        </button>
        <button className="button" disabled={historyState.redo === 0} onClick={redoEdit} title="Redo (Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y)">
          <Redo2 size={16} />
          Redo
        </button>
        <button
          className={inspectorOpen ? 'button active' : 'button'}
          onClick={() => setInspectorOpen((value) => !value)}
          title={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
          aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
        >
          {inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          Inspector
        </button>
        <button className="button primary" disabled={!track} onClick={downloadExport} title="Export track (Ctrl/Cmd+S)">
          <Download size={16} />
          Export
        </button>
        <span className="status">{status}</span>
      </header>

      <div
        ref={workspaceRef}
        className={`${inspectorOpen ? 'workspace' : 'workspace inspectorCollapsed'}${placeAssetsOpen ? '' : ' placeAssetsCollapsed'}`}
        style={workspaceStyle}
      >
        <aside className="placeAssetsPanel">
          {placeAssetsOpen && <div className="sidebarResizeHandle sidebarResizeHandleRight" onPointerDown={(event) => beginSidebarResize('placeAssets', event)} />}
          <div className="panelHeader placeAssetsHeader">
            <div>
              <h2>Place Assets</h2>
              {placeAssetsOpen && <p className="panelSubtle">Common draggable game objects</p>}
            </div>
            <button
              className="iconButton"
              type="button"
              onClick={() => setPlaceAssetsOpen((value) => !value)}
              title={placeAssetsOpen ? 'Hide place assets' : 'Show place assets'}
              aria-label={placeAssetsOpen ? 'Hide place assets' : 'Show place assets'}
            >
              {placeAssetsOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
          </div>
          {placeAssetsOpen && (
            <div className="placeAssetsBody">
              {quickObjectOptions.length > 0 ? (
                <div className="placeAssetsGrid">
                  {quickObjectOptions.map((option) => {
                    const quickObject = objFlow?.byId.get(option.id) ?? objectCatalog.find((entry) => entry.id === option.id);
                    return (
                      <div
                        key={option.id}
                        className="placeAssetTile"
                        draggable
                        onDragStart={(event) => event.dataTransfer.setData('application/mkw-object-id', String(option.id))}
                      >
                        {quickObject && <ObjectThumbnail object={quickObject} common={commonArchive} summaries={commonBrresSummaries} />}
                        <strong>{option.label}</strong>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="muted">Load shared object data to place common objects from this rail.</p>
              )}
            </div>
          )}
        </aside>
        <Noclip3DViewport
          track={track}
          selectedId={selectedId}
          selectedIds={selectedIds}
          smokeCommonUrl={smokeCommonUrl}
          tool={tool}
          viewMode={viewMode}
          collisionVisible={collisionVisible}
          getEntityLabel={entityLabel}
          onSelect={(id, options) => selectEntity(id, options?.additive)}
          onSelectMany={(ids, options) => selectEntities(ids, options?.additive)}
          onMoveEntity={moveEntity}
          onRotateEntity={rotateEntity}
          onScaleEntity={scaleEntity}
          onMoveCheckpointEndpoint={moveCheckpointEndpoint}
          onAddObject={addObject}
          onAddKmpPoint={addKmpPoint}
          onInteractionStart={beginEditSession}
          onInteractionEnd={endEditSession}
        />
        <aside className="inspector">
          {inspectorOpen && <div className="sidebarResizeHandle sidebarResizeHandleLeft" onPointerDown={(event) => beginSidebarResize('inspector', event)} />}
          <div className="panelHeader">
            <h2>Inspector</h2>
            <button className="iconButton" type="button" onClick={() => setInspectorOpen(false)} title="Hide inspector" aria-label="Hide inspector">
              <PanelRightClose size={16} />
            </button>
          </div>
          {selectedEntities.length > 1 && (
            <BatchSelectionPanel
              count={selectedEntities.length}
              offset={batchOffset}
              onChangeOffset={setBatchOffset}
              onApplyOffset={offsetSelectedEntities}
              objectOptions={canBatchReplaceObjects ? objectOptions : []}
              objectId={batchObjectId}
              onChangeObjectId={setBatchObjectId}
              onApplyObjectId={batchObjectId !== null ? () => replaceSelectedObjectTypes(batchObjectId) : undefined}
              onDelete={deleteSelectedEntity}
              onSnapToCollision={track.kcl ? snapMultipleSelectedToCollision : undefined}
            />
          )}
          {selected ? (
            <Inspector
              entity={selected}
              label={entityLabel(selected)}
              pathInfo={selectedPathInfo}
              cameraHeader={cameraHeader}
              referenceCounts={referenceCounts}
              areaInspectorResources={areaInspectorResources}
              objectProfile={selectedObjectProfile}
              objectOptions={objectOptions}
              objectVariantOptions={selectedObjectVariantOptions}
              onChangePosition={(position) => patchSelectedEntity((kmp, entity) => patchKmpEntityPosition(kmp, entity, position))}
              onDelete={selected.section === 'STGI' ? undefined : deleteSelectedEntity}
              onMoveEarlier={selected.section === 'STGI' ? undefined : () => moveSelectedEntity(-1)}
              onMoveLater={selected.section === 'STGI' ? undefined : () => moveSelectedEntity(1)}
              onSnapToCollision={track.kcl ? snapSelectedToCollision : undefined}
              onChangeCheckpointEndpoint={(side, position) => patchSelectedEntity((kmp, entity) => patchKmpCheckpointEndpoint(kmp, entity, side, position))}
              onChangeCheckpointField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpCheckpointField(kmp, entity, field, value))}
              onChangePointDeviation={(value) => patchSelectedEntity((kmp, entity) => patchKmpPointDeviation(kmp, entity, value))}
              onChangePathGroupLinks={(side, links) => {
                if (!track.kmp || !selectedPathInfo) return;
                applyEditorChange(replaceCourseKmp(track, patchKmpPathGroupLinks(track.kmp, selectedPathInfo.groupSection, selectedPathInfo.groupIndex, side, links)));
              }}
              onSplitPathGroup={selectedPathInfo && selectedPathInfo.localIndex < selectedPathInfo.groupSize - 1 ? splitSelectedPathGroup : undefined}
              onMergePathGroup={selectedPathInfo && selectedPathInfo.nextGroups.length === 1 ? mergeSelectedPathGroup : undefined}
              onChangePointSetting={(settingIndex, value) => patchSelectedEntity((kmp, entity) => patchKmpPointSetting(kmp, entity, settingIndex, value))}
              onChangePotiRouteSetting={(settingIndex, value) => patchSelectedEntity((kmp, entity) => patchKmpPotiRouteSetting(kmp, entity, settingIndex, value))}
              onChangePotiPointSetting={(settingIndex, value) => patchSelectedEntity((kmp, entity) => patchKmpPotiPointSetting(kmp, entity, settingIndex, value))}
              onAddPotiNode={() => addPotiNode(selected)}
              onCreateObjectRoute={() => createObjectRoute(selected)}
              onResetObjectBehavior={() => resetObjectBehavior(selected)}
              onClearObjectRoute={() => clearObjectRoute(selected)}
              onSelectObjectRoute={() => selectObjectRoute(selected)}
              onApplySafeFallingRockDefaults={() => applySafeFallingRockDefaults(selected)}
              onCreateCannonPointFromObject={() => createCannonPointFromObject(selected)}
              onApplyRoulettePlatformDefaults={() => applyRoulettePlatformDefaults(selected)}
              onChangeAreaField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpAreaField(kmp, entity, field, value))}
              onChangeCameraField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpCameraField(kmp, entity, field, value))}
              onChangeCameraHeaderField={(field, value) => {
                if (!track.kmp) return;
                applyEditorChange(replaceCourseKmp(track, patchKmpCameraHeaderField(track.kmp, field, value)));
              }}
              onChangeCameraViewPosition={(side, position) => patchSelectedEntity((kmp, entity) => patchKmpCameraViewPosition(kmp, entity, side, position))}
              onChangeRespawnField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpRespawnField(kmp, entity, field, value))}
              onChangeCannonField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpCannonField(kmp, entity, field, value))}
              onChangeBattleFinishField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpBattleFinishField(kmp, entity, field, value))}
              onChangeStageField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpStageField(kmp, entity, field, value))}
              onChangeStageFlareColor={(channelIndex, value) => patchSelectedEntity((kmp, entity) => patchKmpStageFlareColor(kmp, entity, channelIndex, value))}
              onChangeRotation={(rotation) => patchSelectedEntity((kmp, entity) => patchKmpEntityRotation(kmp, entity, rotation))}
              onChangeScale={(scale) => patchSelectedEntity((kmp, entity) => patchKmpEntityScale(kmp, entity, scale))}
              onChangeObjectId={(objectId) => patchSelectedEntity((kmp, entity) => patchKmpGobjObjectId(kmp, entity, objectId))}
              onChangeRouteIndex={(routeIndex) => patchSelectedEntity((kmp, entity) => patchKmpEntityRouteIndex(kmp, entity, routeIndex))}
              onChangeObjectSetting={(settingIndex, value) => patchSelectedEntity((kmp, entity) => patchKmpGobjSetting(kmp, entity, settingIndex, value))}
              onChangePresenceFlags={(value) => patchSelectedEntity((kmp, entity) => patchKmpGobjPresenceFlags(kmp, entity, value))}
            />
          ) : (
            <p className="muted">Select an object, route node, checkpoint, start point, camera, cannon point, or respawn point in the viewport.</p>
          )}
          {selectedEntities.length > 1 && <p className="muted">{selectedEntities.length} selected. Inspector is showing the primary selection, with batch tools above.</p>}
          {track?.kmp && <KmpOverview kmp={track.kmp} onSelect={(id, options) => selectEntity(id, options?.additive)} />}
          <h2>Validation</h2>
          <div className="validationSummary">
            <span className={`validationBadge${validationCounts.errorCount > 0 ? ' error' : ''}`}>{validationCounts.errorCount} errors</span>
            <span className={`validationBadge${validationCounts.warningCount > 0 ? ' warning' : ''}`}>{validationCounts.warningCount} warnings</span>
          </div>
          <div className="validationList">
            {validation.length === 0 && <p className="muted">No validation issues for the loaded data.</p>}
            {validation.map((item, index) => {
              const presented = presentValidationIssue(item.message);
              return (
              <div className={`validationIssue ${item.level}`} key={`${item.message}-${index}`}>
                <TriangleAlert size={14} />
                <div className="validationCopy">
                  <strong>{presented.summary}</strong>
                  {presented.detail && <span>{presented.detail}</span>}
                </div>
              </div>
            )})}
            {track?.warnings.map((warning, index) => (
              <div className="validationIssue warning" key={`${warning}-${index}`}>
                <TriangleAlert size={14} />
                <div className="validationCopy">
                  <strong>Track load warning</strong>
                  <span>{warning}</span>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <section
        className={`${browserOpen ? 'contentBrowser' : 'contentBrowser collapsed'}${browserResizing ? ' resizing' : ''}`}
        style={{ height: `${browserOpen ? browserHeight : CONTENT_BROWSER_COLLAPSED_HEIGHT}px` }}
      >
        <div
          className="contentBrowserResizeHandle"
          onPointerDown={beginBrowserResize}
          role="separator"
          aria-label="Resize content browser"
          aria-orientation="horizontal"
        />
        <button className="collapseButton" onClick={() => setBrowserOpen((value) => !value)} aria-label={browserOpen ? 'Collapse content browser' : 'Expand content browser'}>
          {browserOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>
        <div className="browserHeader">
          <strong>Content Browser</strong>
          <span>
            {filteredBrowserFolder
              ? `${filteredBrowserFolder.label} · ${filteredBrowserFolder.detail}`
              : track
                ? `${track.brresFiles.length} track asset files${objFlow ? ` · ${objFlow.entries.length} game objects` : ''}`
                : 'Load a track to list archive assets'}
          </span>
        </div>
        <div className="browserSearchRow">
          <input
            className="browserSearchInput"
            type="search"
            placeholder="Search this folder"
            value={browserQuery}
            onChange={(event) => setBrowserQuery(event.currentTarget.value)}
            aria-label="Search content browser"
          />
        </div>
        <div className="browserFolders" role="tablist" aria-label="Content browser folders">
          {browserFolders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className={folder.id === activeBrowserFolder?.id ? 'browserFolder active' : 'browserFolder'}
              onClick={() => setBrowserFolder(folder.id)}
            >
              <strong>{folder.label}</strong>
              <span>{folder.detail}</span>
            </button>
          ))}
        </div>
        <div className="assetStrip">
          {filteredBrowserFolder?.kind === 'kmp' &&
            filteredBrowserFolder.items.map((item) => (
              <div className="assetTile" key={item.section} draggable onDragStart={(event) => event.dataTransfer.setData('application/mkw-point-section', item.section)}>
                <div className="thumbnail kmp">{friendlySectionLabel(item.section)}</div>
                <strong>{item.label}</strong>
                <span>{item.category}</span>
              </div>
            ))}
          {filteredBrowserFolder?.kind === 'object' &&
            filteredBrowserFolder.items.map((object) =>
              isCourseAssetBrowserItem(object) ? (
                <div
                  className={object.objectId !== null ? 'assetTile' : 'assetTile disabled'}
                  key={object.id}
                  draggable={object.objectId !== null}
                  onDragStart={(event) => {
                    if (object.objectId !== null) event.dataTransfer.setData('application/mkw-object-id', String(object.objectId));
                  }}
                >
                  <CourseAssetThumbnail asset={object} summaries={commonBrresSummaries} />
                  <strong>{object.objectLabel ?? object.baseName.replace(/\.brres$/i, '')}</strong>
                  <span>{describeCourseAsset(object)}</span>
                </div>
              ) : (
                <div className="assetTile" key={catalogId(object)} draggable onDragStart={(event) => event.dataTransfer.setData('application/mkw-object-id', String(catalogId(object)))}>
                  <ObjectThumbnail object={object} common={commonArchive} summaries={commonBrresSummaries} />
                  <strong>{browserObjectTitle(object)}</strong>
                  <span>{objectAssetLabel(object, commonArchive, commonBrresSummaries)}</span>
                </div>
              ),
            )}
          {filteredBrowserFolder?.kind === 'brres' &&
            filteredBrowserFolder.items.map((path) => (
              <div className="assetTile" key={path}>
                <div className="thumbnail brres">Asset</div>
                <strong>{friendlyTrackAssetName(path)}</strong>
                <span>{describeBrres(track?.brresSummaries[path]) || path}</span>
              </div>
            ))}
          {filteredBrowserFolder && filteredBrowserFolder.items.length === 0 && <p className="browserEmpty">No assets match this search.</p>}
        </div>
      </section>
    </main>
  );
}

function appendCopiedEntity(document: KmpDocument, entity: KmpEntity, position: Vec3): { bytes: Uint8Array; selectedId: string } {
  if (entity.routePoint) return appendCopiedPotiPoint(document, entity, position);

  let bytes: Uint8Array;
  let selectedId: string;
  switch (entity.section) {
    case 'GOBJ':
      if (entity.objectId === undefined) throw new Error('Cannot duplicate object without an object ID.');
      bytes = appendKmpGobj(document, entity.objectId, position);
      selectedId = `GOBJ-${(parseKmp(bytes).sections.find((section) => section.name === 'GOBJ')?.count ?? 1) - 1}`;
      break;
    case 'AREA':
      bytes = appendKmpArea(document, position);
      selectedId = `AREA-${(parseKmp(bytes).sections.find((section) => section.name === 'AREA')?.count ?? 1) - 1}`;
      break;
    case 'CAME':
      bytes = appendKmpCamera(document, position);
      selectedId = `CAME-${(parseKmp(bytes).sections.find((section) => section.name === 'CAME')?.count ?? 1) - 1}`;
      break;
    case 'CKPT':
      bytes = appendKmpCheckpoint(document, position);
      selectedId = `CKPT-${(parseKmp(bytes).sections.find((section) => section.name === 'CKPT')?.count ?? 1) - 1}`;
      break;
    case 'KTPT':
    case 'ENPT':
    case 'ITPT':
    case 'JGPT':
    case 'CNPT':
    case 'MSPT':
      bytes = appendKmpPoint(document, entity.section, position);
      selectedId = `${entity.section}-${(parseKmp(bytes).sections.find((section) => section.name === entity.section)?.count ?? 1) - 1}`;
      break;
    default:
      throw new Error(`Duplicating ${entity.section} is not supported yet.`);
  }

  return { bytes: patchCopiedEntity(bytes, selectedId, entity, position), selectedId };
}

function getClipboardSourceEntities(selectedEntities: KmpEntity[], selected: KmpEntity | null): KmpEntity[] {
  if (selectedEntities.length > 1) return selectedEntities;
  return selected ? [selected] : [];
}

function createClipboardEntity(entities: KmpEntity[], primaryId: string | null): ClipboardEntity {
  const primary = entities.find((entity) => entity.id === primaryId) ?? entities.at(-1) ?? entities[0];
  const anchor = cloneVec3(primary.position);
  return {
    anchor,
    primaryId: primary.id,
    entries: entities.map((entity, order) => ({
      entity: JSON.parse(JSON.stringify(entity)) as KmpEntity,
      relativeOffset: {
        x: entity.position.x - anchor.x,
        y: entity.position.y - anchor.y,
        z: entity.position.z - anchor.z,
      },
      order,
    })),
  };
}

function sortClipboardEntriesForPaste(entries: ClipboardEntity['entries']): ClipboardEntity['entries'] {
  return [...entries].sort((a, b) => {
    if (a.entity.routePoint && b.entity.routePoint) {
      if (a.entity.routePoint.routeIndex !== b.entity.routePoint.routeIndex) return b.entity.routePoint.routeIndex - a.entity.routePoint.routeIndex;
      return b.entity.routePoint.pointIndex - a.entity.routePoint.pointIndex;
    }
    if (a.entity.routePoint) return -1;
    if (b.entity.routePoint) return 1;
    return a.order - b.order;
  });
}

function appendCopiedPotiPoint(document: KmpDocument, entity: KmpEntity, position: Vec3): { bytes: Uint8Array; selectedId: string } {
  if (!entity.routePoint) throw new Error('Cannot duplicate route node without route metadata.');
  const route = document.routes[entity.routePoint.routeIndex];
  if (!route) throw new Error(`Cannot duplicate route node: route ${entity.routePoint.routeIndex} is missing.`);
  const bytes = appendKmpPotiPoint(document, entity.routePoint.routeIndex, entity.routePoint.pointIndex, position);
  const selectedId = `POTI-${entity.routePoint.routeIndex}-${entity.routePoint.pointIndex + 1}`;
  return { bytes: patchCopiedEntity(bytes, selectedId, entity, position), selectedId };
}

function patchCopiedEntity(bytes: Uint8Array, selectedId: string, source: KmpEntity, position: Vec3): Uint8Array {
  let out = bytes;
  const getTarget = () => {
    const targetDoc = parseKmp(out);
    const targetEntity = targetDoc.entities.find((candidate) => candidate.id === selectedId);
    if (!targetEntity) throw new Error(`Duplicated entity ${selectedId} could not be found.`);
    return { targetDoc, targetEntity };
  };

  if (source.rotation) {
    const { targetDoc, targetEntity } = getTarget();
    out = patchKmpEntityRotation(targetDoc, targetEntity, cloneVec3(source.rotation));
  }
  if (source.scale) {
    const { targetDoc, targetEntity } = getTarget();
    out = patchKmpEntityScale(targetDoc, targetEntity, cloneVec3(source.scale));
  }
  if (source.checkpoint) {
    let target = getTarget();
    out = patchKmpCheckpointEndpoint(target.targetDoc, target.targetEntity, 'left', offsetCheckpointPoint(source.checkpoint.left, source.position, position));
    target = getTarget();
    out = patchKmpCheckpointEndpoint(target.targetDoc, target.targetEntity, 'right', offsetCheckpointPoint(source.checkpoint.right, source.position, position));
    for (const field of ['respawnIndex', 'type', 'prev', 'next'] as const) {
      target = getTarget();
      out = patchKmpCheckpointField(target.targetDoc, target.targetEntity, field, source.checkpoint[field]);
    }
  }
  if (source.pointSettings) {
    if (source.pointDeviation !== undefined) {
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpPointDeviation(targetDoc, targetEntity, source.pointDeviation);
    }
    for (let i = 0; i < source.pointSettings.length; i++) {
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpPointSetting(targetDoc, targetEntity, i, source.pointSettings[i]);
    }
  }
  if (source.objectId !== undefined) {
    let target = getTarget();
    out = patchKmpGobjObjectId(target.targetDoc, target.targetEntity, source.objectId);
    if (source.routeIndex !== undefined) {
      target = getTarget();
      out = patchKmpEntityRouteIndex(target.targetDoc, target.targetEntity, source.routeIndex);
    }
    if (source.objectSettings) {
      for (let i = 0; i < source.objectSettings.length; i++) {
        target = getTarget();
        out = patchKmpGobjSetting(target.targetDoc, target.targetEntity, i, source.objectSettings[i]);
      }
    }
    if (source.presenceFlags !== undefined) {
      target = getTarget();
      out = patchKmpGobjPresenceFlags(target.targetDoc, target.targetEntity, source.presenceFlags);
    }
  }
  if (source.area) {
    for (const field of Object.keys(source.area) as Array<keyof NonNullable<KmpEntity['area']>>) {
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpAreaField(targetDoc, targetEntity, field, source.area[field]);
    }
  }
  if (source.camera) {
    for (const field of Object.keys(source.camera) as Array<keyof NonNullable<KmpEntity['camera']>>) {
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpCameraField(targetDoc, targetEntity, field, source.camera[field]);
    }
  }
  if (source.cameraView) {
    let target = getTarget();
    out = patchKmpCameraViewPosition(target.targetDoc, target.targetEntity, 'start', offsetCheckpointPoint(source.cameraView.start, source.position, position));
    target = getTarget();
    out = patchKmpCameraViewPosition(target.targetDoc, target.targetEntity, 'end', offsetCheckpointPoint(source.cameraView.end, source.position, position));
  }
  if (source.respawn) {
    for (const field of Object.keys(source.respawn) as Array<keyof NonNullable<KmpEntity['respawn']>>) {
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpRespawnField(targetDoc, targetEntity, field, source.respawn[field]);
    }
  }
  if (source.cannon) {
    for (const field of Object.keys(source.cannon) as Array<keyof NonNullable<KmpEntity['cannon']>>) {
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpCannonField(targetDoc, targetEntity, field, source.cannon[field]);
    }
  }
  if (source.battleFinish) {
    for (const field of Object.keys(source.battleFinish) as Array<keyof NonNullable<KmpEntity['battleFinish']>>) {
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpBattleFinishField(targetDoc, targetEntity, field, source.battleFinish[field]);
    }
  }
  if (source.stage) {
    for (const field of Object.keys(source.stage) as Array<keyof NonNullable<KmpEntity['stage']>>) {
      if (field === 'flareColor') continue;
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpStageField(targetDoc, targetEntity, field, source.stage[field] as number);
    }
    for (let i = 0; i < source.stage.flareColor.length; i++) {
      const { targetDoc, targetEntity } = getTarget();
      out = patchKmpStageFlareColor(targetDoc, targetEntity, i, source.stage.flareColor[i]);
    }
  }
  if (source.poti) {
    let target = getTarget();
    out = patchKmpPotiRouteSetting(target.targetDoc, target.targetEntity, 0, source.poti.routeSetting1);
    target = getTarget();
    out = patchKmpPotiRouteSetting(target.targetDoc, target.targetEntity, 1, source.poti.routeSetting2);
    target = getTarget();
    out = patchKmpPotiPointSetting(target.targetDoc, target.targetEntity, 0, source.poti.pointSetting1);
    target = getTarget();
    out = patchKmpPotiPointSetting(target.targetDoc, target.targetEntity, 1, source.poti.pointSetting2);
  }
  return out;
}

function cloneVec3(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function offsetCheckpointPoint(point: Vec3, sourceCenter: Vec3, targetCenter: Vec3): Vec3 {
  return {
    x: targetCenter.x + (point.x - sourceCenter.x),
    y: targetCenter.y + (point.y - sourceCenter.y),
    z: targetCenter.z + (point.z - sourceCenter.z),
  };
}

async function withBundledCourseObjectResources(common: CommonResourceArchive, allowedBaseNames?: Set<string>): Promise<CommonResourceArchive> {
  try {
    const basePath = '/data/MarioKartWii/Race/Course/Object/';
    const manifestResponse = await fetch(`${basePath}manifest.json`);
    if (!manifestResponse.ok) return common;
    const names = (await manifestResponse.json()) as string[];
    const filteredNames = allowedBaseNames?.size ? names.filter((name) => allowedBaseNames.has(toResourceBaseName(name))) : names;
    const entries = await Promise.all(
      filteredNames.map(async (name) => {
        const response = await fetch(`${basePath}${name}`);
        if (!response.ok) return null;
        return { path: `Object/${name}`, type: 'file' as const, data: new Uint8Array(await response.arrayBuffer()) };
      }),
    );
    return mergeCommonResourceEntries(common, entries.filter((entry): entry is NonNullable<(typeof entries)[number]> => entry !== null));
  } catch {
    return common;
  }
}

async function withExtractedCourseAssetResources(common: CommonResourceArchive): Promise<CommonResourceArchive> {
  try {
    const response = await fetch('/data/MarioKartWii/Race/Course/ExtractedAssets.u8');
    if (!response.ok) return common;
    const entries = parseU8(new Uint8Array(await response.arrayBuffer())).filter((entry) => entry.type === 'file' && entry.data);
    return mergeCommonResourceEntries(common, entries);
  } catch {
    return common;
  }
}

function getSmokePreviewResourceNames(objFlow: CommonResourceArchive['objFlow']): Set<string> {
  const out = new Set<string>();
  for (const objectId of featuredObjectIds) {
    const entry = objFlow.byId.get(objectId);
    if (!entry) continue;
    for (const resourceName of getObjFlowResourceNames(entry)) out.add(toResourceBaseName(resourceName));
  }
  return out;
}

function toResourceBaseName(name: string): string {
  return name.trim().replace(/\.brres$/i, '').toLowerCase();
}

function scoreCommonPreviewResource(entry: { path: string }, referencedResources: Set<string>): number {
  const baseName = entry.path.split('/').pop()?.toLowerCase() ?? '';
  return (bundledCourseObjectResourceNames.has(baseName) ? 4 : 0) + (entry.path.toLowerCase().includes('/course/object/') || entry.path.toLowerCase().startsWith('object/') ? 2 : 0) + (referencedResources.has(baseName) ? 1 : 0);
}

function countSectionEntities(entities: KmpEntity[], section: KmpEntity['section']): number {
  return entities.filter((entity) => entity.section === section).length;
}

function BatchSelectionPanel({
  count,
  offset,
  onChangeOffset,
  onApplyOffset,
  objectOptions,
  objectId,
  onChangeObjectId,
  onApplyObjectId,
  onDelete,
  onSnapToCollision,
}: {
  count: number;
  offset: Vec3;
  onChangeOffset: (value: Vec3) => void;
  onApplyOffset: () => void;
  objectOptions: ObjectOption[];
  objectId: number | null;
  onChangeObjectId: (value: number | null) => void;
  onApplyObjectId?: () => void;
  onDelete: () => void;
  onSnapToCollision?: () => void;
}) {
  return (
    <>
      <h2>Batch Edit</h2>
      <div className="propertyGrid">
        <label>
          Selection
          <span>{count} elements selected</span>
        </label>
        <label>
          Actions
          <div className="actionRow">
            <button className="inlineAction" type="button" onClick={onDelete}>
              Delete
            </button>
            <button className="inlineAction" type="button" onClick={onSnapToCollision} disabled={!onSnapToCollision}>
              Snap to Surface
            </button>
          </div>
        </label>
        <label>
          Offset Position
          <VectorInputs value={offset} onChange={onChangeOffset} />
        </label>
        <label>
          Apply Offset
          <button className="inlineAction" type="button" onClick={onApplyOffset}>
            Move selected
          </button>
        </label>
        {objectId !== null && objectOptions.length > 0 && (
          <>
            <label>
              Replace Objects
              <ObjectIdSelect value={objectId} options={objectOptions} onChange={(value) => onChangeObjectId(value)} />
            </label>
            <label>
              Apply Object Type
              <button className="inlineAction" type="button" onClick={onApplyObjectId} disabled={!onApplyObjectId}>
                Replace selected objects
              </button>
            </label>
          </>
        )}
      </div>
    </>
  );
}

function Inspector({
  entity,
  label,
  pathInfo,
  cameraHeader,
  referenceCounts,
  areaInspectorResources,
  objectProfile,
  objectOptions,
  objectVariantOptions,
  onChangePosition,
  onDelete,
  onMoveEarlier,
  onMoveLater,
  onSnapToCollision,
  onChangeCheckpointEndpoint,
  onChangeCheckpointField,
  onChangePointDeviation,
  onChangePathGroupLinks,
  onSplitPathGroup,
  onMergePathGroup,
  onChangePointSetting,
  onChangePotiRouteSetting,
  onChangePotiPointSetting,
  onAddPotiNode,
  onCreateObjectRoute,
  onResetObjectBehavior,
  onClearObjectRoute,
  onSelectObjectRoute,
  onApplySafeFallingRockDefaults,
  onCreateCannonPointFromObject,
  onApplyRoulettePlatformDefaults,
  onChangeAreaField,
  onChangeCameraField,
  onChangeCameraHeaderField,
  onChangeCameraViewPosition,
  onChangeRespawnField,
  onChangeCannonField,
  onChangeBattleFinishField,
  onChangeStageField,
  onChangeStageFlareColor,
  onChangeRotation,
  onChangeScale,
  onChangeObjectId,
  onChangeRouteIndex,
  onChangeObjectSetting,
  onChangePresenceFlags,
}: {
  entity: KmpEntity;
  label: string;
  pathInfo: PathInfo | null;
  cameraHeader: ReturnType<typeof getKmpCameraHeader> | null;
  referenceCounts: ReferenceCounts;
  areaInspectorResources: AreaInspectorResources;
  objectProfile: ObjectInspectorProfile | null;
  objectOptions: ObjectOption[];
  objectVariantOptions: ObjectOption[];
  onChangePosition: (position: Vec3) => void;
  onDelete?: () => void;
  onMoveEarlier?: () => void;
  onMoveLater?: () => void;
  onSnapToCollision?: () => void;
  onChangeCheckpointEndpoint: (side: 'left' | 'right', position: Vec3) => void;
  onChangeCheckpointField: (field: KmpCheckpointField, value: number) => void;
  onChangePointDeviation: (value: number) => void;
  onChangePathGroupLinks: (side: 'prev' | 'next', links: number[]) => void;
  onSplitPathGroup?: () => void;
  onMergePathGroup?: () => void;
  onChangePointSetting: (settingIndex: number, value: number) => void;
  onChangePotiRouteSetting: (settingIndex: number, value: number) => void;
  onChangePotiPointSetting: (settingIndex: number, value: number) => void;
  onAddPotiNode: () => void;
  onCreateObjectRoute?: () => void;
  onResetObjectBehavior?: () => void;
  onClearObjectRoute?: () => void;
  onSelectObjectRoute?: () => void;
  onApplySafeFallingRockDefaults?: () => void;
  onCreateCannonPointFromObject?: () => void;
  onApplyRoulettePlatformDefaults?: () => void;
  onChangeAreaField: (field: KmpAreaField, value: number) => void;
  onChangeCameraField: (field: KmpCameraField, value: number) => void;
  onChangeCameraHeaderField: (field: KmpCameraHeaderField, value: number) => void;
  onChangeCameraViewPosition: (side: 'start' | 'end', position: Vec3) => void;
  onChangeRespawnField: (field: KmpRespawnField, value: number) => void;
  onChangeCannonField: (field: KmpCannonField, value: number) => void;
  onChangeBattleFinishField: (field: KmpBattleFinishField, value: number) => void;
  onChangeStageField: (field: KmpStageField, value: number) => void;
  onChangeStageFlareColor: (channelIndex: number, value: number) => void;
  onChangeRotation: (rotation: Vec3) => void;
  onChangeScale: (scale: Vec3) => void;
  onChangeObjectId: (objectId: number) => void;
  onChangeRouteIndex: (routeIndex: number) => void;
  onChangeObjectSetting: (settingIndex: number, value: number) => void;
  onChangePresenceFlags: (value: number) => void;
}) {
  const areaInspectorLabels = entity.area ? getAreaInspectorConfig(entity.area.type, areaInspectorResources) : null;
  const objectPresenceBaseFlags = entity.presenceFlags !== undefined ? entity.presenceFlags & ~0x0007 : 0;
  const objectPresencePlayerFlags = entity.presenceFlags !== undefined ? entity.presenceFlags & 0x0007 : 0;
  const objectHasExtraPresenceBits = entity.presenceFlags !== undefined && objectPresenceBaseFlags !== 0;
  return (
    <div className="propertyGrid">
      <label>
        Name
        <span>{label}</span>
      </label>
      <label>
        Section
        <span>{entity.section}</span>
      </label>
      {onDelete && (
        <label>
          Delete
          <button className="inlineAction" type="button" onClick={onDelete}>
            Delete selected record
          </button>
        </label>
      )}
      {(onMoveEarlier || onMoveLater) && (
        <label>
          Order
          <div className="actionRow">
            <button className="inlineAction" type="button" onClick={onMoveEarlier} disabled={!onMoveEarlier}>
              Earlier
            </button>
            <button className="inlineAction" type="button" onClick={onMoveLater} disabled={!onMoveLater}>
              Later
            </button>
          </div>
        </label>
      )}
      {entity.section !== 'STGI' && (
        <label>
          Position
          <VectorInputs value={entity.position} onChange={onChangePosition} />
        </label>
      )}
      {entity.section !== 'STGI' && onSnapToCollision && (
        <label>
          Surface Snap
          <button className="inlineAction" type="button" onClick={onSnapToCollision}>
            Snap selected to collision
          </button>
        </label>
      )}
      {entity.checkpoint && (
        <>
          <label>
            Left Endpoint
            <VectorInputs value={entity.checkpoint.left} onChange={(position) => onChangeCheckpointEndpoint('left', position)} />
          </label>
          <label>
            Right Endpoint
            <VectorInputs value={entity.checkpoint.right} onChange={(position) => onChangeCheckpointEndpoint('right', position)} />
          </label>
          <label>
            Checkpoint Data
            <div className="settingInputs">
              <ReferenceSelect label="respawnIndex" value={entity.checkpoint.respawnIndex} noneValue={0xff} count={referenceCounts.respawns} optionLabel="Respawn" onChange={(next) => onChangeCheckpointField('respawnIndex', next)} />
              <input
                aria-label="type"
                title="type"
                type="number"
                min="0"
                max="255"
                value={entity.checkpoint.type}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeCheckpointField('type', Math.max(0, Math.min(0xff, Math.trunc(next))));
                }}
              />
              <ReferenceSelect label="prev" value={entity.checkpoint.prev} noneValue={0xff} count={referenceCounts.checkpoints} optionLabel="Checkpoint" onChange={(next) => onChangeCheckpointField('prev', next)} />
              <ReferenceSelect label="next" value={entity.checkpoint.next} noneValue={0xff} count={referenceCounts.checkpoints} optionLabel="Checkpoint" onChange={(next) => onChangeCheckpointField('next', next)} />
            </div>
          </label>
        </>
      )}
      {entity.pointSettings && (
        <>
          {entity.pointDeviation !== undefined && (
            <label>
              Deviation
              <input
                type="number"
                step="0.1"
                value={Number.isFinite(entity.pointDeviation) ? Number(entity.pointDeviation.toFixed(3)) : 0}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) onChangePointDeviation(value);
                }}
              />
            </label>
          )}
          {entity.section === 'ENPT' ? (
            <>
              <label>
                Mushroom / Wheelie
                <select value={entity.pointSettings[0]} onChange={(event) => onChangePointSetting(0, Number(event.currentTarget.value))}>
                  {enemyRouteSetting1Options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Drift Behavior
                <select value={entity.pointSettings[1]} onChange={(event) => onChangePointSetting(1, Number(event.currentTarget.value))}>
                  {enemyRouteSetting2Options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Route Setting 3
                <input
                  type="number"
                  min="0"
                  max="255"
                  value={entity.pointSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangePointSetting(2, Math.max(0, Math.min(0xff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          ) : entity.section === 'ITPT' ? (
            <>
              <label>
                Bullet Bill Gravity
                <select value={entity.pointSettings[0]} onChange={(event) => onChangePointSetting(0, Number(event.currentTarget.value))}>
                  {itemRouteSetting1Options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Route Priority / Stop
                <select value={entity.pointSettings[1]} onChange={(event) => onChangePointSetting(1, Number(event.currentTarget.value))}>
                  {itemRouteSetting2Options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <label>
              Point Settings
              <div className="settingInputs">
                {entity.pointSettings.map((setting, index) => (
                  <input
                    key={index}
                    aria-label={`Point setting ${index + 1}`}
                    type="number"
                    min="0"
                    max={entity.section === 'ENPT' && index > 0 ? 255 : 65535}
                    value={setting}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      const max = entity.section === 'ENPT' && index > 0 ? 0xff : 0xffff;
                      if (Number.isFinite(value)) onChangePointSetting(index, Math.max(0, Math.min(max, Math.trunc(value))));
                    }}
                  />
                ))}
              </div>
            </label>
          )}
        </>
      )}
      {entity.poti && (
        <>
          <label>
            Route Edge Mode
            <select value={entity.poti.routeSetting1} onChange={(event) => onChangePotiRouteSetting(0, Number(event.currentTarget.value))}>
              {potiRouteShapeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Motion Mode
            <select value={entity.poti.routeSetting2} onChange={(event) => onChangePotiRouteSetting(1, Number(event.currentTarget.value))}>
              {potiRouteMotionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Route Node Setting 1
            <input
              aria-label="Route node setting 1"
              type="number"
              min="0"
              max="65535"
              value={entity.poti.pointSetting1}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value)) onChangePotiPointSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
              }}
            />
          </label>
          <label>
            Route Node Setting 2
            <input
              aria-label="Route node setting 2"
              type="number"
              min="0"
              max="65535"
              value={entity.poti.pointSetting2}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value)) onChangePotiPointSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
              }}
            />
          </label>
        </>
      )}
      {entity.area && (
        <>
          <label>
            Area Type
            <select value={entity.area.type} onChange={(event) => onChangeAreaField('type', Number(event.currentTarget.value))}>
              {areaTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Area Shape
            <select value={entity.area.shape} onChange={(event) => onChangeAreaField('shape', Number(event.currentTarget.value))}>
              {areaShapeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <input
              type="number"
              min="0"
              max="255"
              value={entity.area.priority}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (Number.isFinite(next)) onChangeAreaField('priority', Math.max(0, Math.min(0xff, Math.trunc(next))));
              }}
            />
          </label>
          {areaInspectorLabels?.notes?.map((note, index) => (
            <label key={`area-note-${entity.area!.type}-${index}`}>
              {index === 0 ? 'Behavior' : 'Note'}
              <span>{note}</span>
            </label>
          ))}
          {(areaInspectorLabels?.cameraLabel || entity.area.cameraIndex !== 0xff) && (
            <label>
              {areaInspectorLabels?.cameraLabel ?? 'Camera'}
              <ReferenceSelect
                label={areaInspectorLabels?.cameraLabel ?? 'Camera'}
                value={entity.area.cameraIndex}
                noneValue={0xff}
                count={referenceCounts.cameras}
                optionLabel="Camera"
                onChange={(next) => onChangeAreaField('cameraIndex', next)}
              />
            </label>
          )}
          {(areaInspectorLabels?.routeLabel || entity.area.routeIndex !== 0xff) && (
            <label>
              {areaInspectorLabels?.routeLabel ?? 'Route'}
              <ReferenceSelect
                label={areaInspectorLabels?.routeLabel ?? 'Route'}
                value={entity.area.routeIndex}
                noneValue={0xff}
                count={referenceCounts.routes}
                optionLabel="Route"
                onChange={(next) => onChangeAreaField('routeIndex', next)}
              />
            </label>
          )}
          {(areaInspectorLabels?.enemyLabel || entity.area.enemyIndex !== 0xff) && (
            <label>
              {areaInspectorLabels?.enemyLabel ?? 'Enemy Point'}
              <ReferenceSelect
                label={areaInspectorLabels?.enemyLabel ?? 'Enemy Point'}
                value={entity.area.enemyIndex}
                noneValue={0xff}
                count={referenceCounts.enemyPoints}
                optionLabel="Enemy"
                onChange={(next) => onChangeAreaField('enemyIndex', next)}
              />
            </label>
          )}
          {(areaInspectorLabels?.setting1Label || entity.area.setting1 !== 0) && (
            <label>
              {areaInspectorLabels?.setting1Label ?? 'Setting 1'}
              {areaInspectorLabels?.setting1Options?.length ? (
                <NumberOptionSelect
                  label={areaInspectorLabels.setting1Label ?? 'Setting 1'}
                  value={entity.area.setting1}
                  options={areaInspectorLabels.setting1Options}
                  onChange={(next) => onChangeAreaField('setting1', next)}
                />
              ) : (
                <input
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.area.setting1}
                  onChange={(event) => {
                    const next = Number(event.currentTarget.value);
                    if (Number.isFinite(next)) onChangeAreaField('setting1', Math.max(0, Math.min(0xffff, Math.trunc(next))));
                  }}
                />
              )}
            </label>
          )}
          {(areaInspectorLabels?.setting2Label || entity.area.setting2 !== 0) && (
            <label>
              {areaInspectorLabels?.setting2Label ?? 'Setting 2'}
              <input
                type="number"
                min="0"
                max="65535"
                value={entity.area.setting2}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeAreaField('setting2', Math.max(0, Math.min(0xffff, Math.trunc(next))));
                }}
              />
            </label>
          )}
        </>
      )}
      {entity.camera && (
        <>
          {cameraHeader && (
            <label>
              Camera Starts
              <div className="vectorInputs">
                <ReferenceSelect
                  label="Intro start camera"
                  value={cameraHeader.firstIntroCam}
                  noneValue={0xff}
                  count={referenceCounts.cameras}
                  optionLabel="Camera"
                  onChange={(next) => onChangeCameraHeaderField('firstIntroCam', next)}
                />
                <ReferenceSelect
                  label="Selection start camera"
                  value={cameraHeader.firstSelectionCam}
                  noneValue={0xff}
                  count={referenceCounts.cameras}
                  optionLabel="Camera"
                  onChange={(next) => onChangeCameraHeaderField('firstSelectionCam', next)}
                />
                <span>Camera Chain</span>
              </div>
            </label>
          )}
          <label>
            Camera Settings
            <div className="settingInputs">
              {(Object.entries(entity.camera) as Array<[KmpCameraField, number]>).map(([field, value]) => {
                const floatField = field === 'zoomStart' || field === 'zoomEnd' || field === 'time';
                const byteField = field === 'type' || field === 'nextCam' || field === 'shake' || field === 'routeIndex' || field === 'start' || field === 'movie';
                if (field === 'nextCam') {
                  return <ReferenceSelect key={field} label={field} value={value} noneValue={0xff} count={referenceCounts.cameras} optionLabel="Camera" onChange={(next) => onChangeCameraField(field, next)} />;
                }
                if (field === 'routeIndex') {
                  return <ReferenceSelect key={field} label={field} value={value} noneValue={0xff} count={referenceCounts.routes} optionLabel="Route" onChange={(next) => onChangeCameraField(field, next)} />;
                }
                return (
                  <input
                    key={field}
                    aria-label={field}
                    title={field}
                    type="number"
                    min={floatField ? undefined : 0}
                    max={floatField ? undefined : byteField ? 255 : 65535}
                    step={floatField ? 0.1 : 1}
                    value={Number.isFinite(value) ? Number(value.toFixed(floatField ? 3 : 0)) : 0}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      if (!Number.isFinite(next)) return;
                      if (floatField) onChangeCameraField(field, next);
                      else onChangeCameraField(field, Math.max(0, Math.min(byteField ? 0xff : 0xffff, Math.trunc(next))));
                    }}
                  />
                );
              })}
            </div>
          </label>
          {entity.cameraView && (
            <>
              <label>
                View Start
                <VectorInputs value={entity.cameraView.start} onChange={(position) => onChangeCameraViewPosition('start', position)} />
              </label>
              <label>
                View End
                <VectorInputs value={entity.cameraView.end} onChange={(position) => onChangeCameraViewPosition('end', position)} />
              </label>
            </>
          )}
        </>
      )}
      {entity.respawn && (
        <label>
          Respawn Settings
          <ShortNumberInputs values={entity.respawn} onChange={onChangeRespawnField} />
        </label>
      )}
      {entity.cannon && (
        <>
          <label>
            Cannon Destination ID
            <input
              type="number"
              min="0"
              max="65535"
              value={entity.cannon.id}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (Number.isFinite(next)) onChangeCannonField('id', Math.max(0, Math.min(0xffff, Math.trunc(next))));
              }}
            />
          </label>
          <label>
            Launch Shape
            <select value={String(entity.cannon.effect)} onChange={(event) => onChangeCannonField('effect', Number(event.currentTarget.value))}>
              {entity.cannon.effect > 2 && (
                <option value={entity.cannon.effect}>
                  Custom #{entity.cannon.effect}
                </option>
              )}
              {cannonEffectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {entity.battleFinish && (
        <label>
          Battle Finish Settings
          <ShortNumberInputs values={entity.battleFinish} onChange={onChangeBattleFinishField} />
        </label>
      )}
      {entity.stage && (
        <>
          <label>
            Track Settings
            <div className="settingInputs">
              {(Object.entries(entity.stage).filter(([field]) => field !== 'flareColor') as Array<[KmpStageField, number]>).map(([field, value]) => {
                const speedField = field === 'speedMod';
                return (
                  <input
                    key={field}
                    aria-label={field}
                    title={field}
                    type="number"
                    min={speedField ? 0 : 0}
                    max={speedField ? undefined : 255}
                    step={speedField ? 0.1 : 1}
                    value={Number.isFinite(value) ? Number(value.toFixed(speedField ? 3 : 0)) : 0}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      if (!Number.isFinite(next)) return;
                      if (speedField) onChangeStageField(field, next);
                      else onChangeStageField(field, Math.max(0, Math.min(0xff, Math.trunc(next))));
                    }}
                  />
                );
              })}
            </div>
          </label>
          <label>
            Lens Flare RGBA
            <div className="settingInputs">
              {entity.stage.flareColor.map((channel, index) => (
                <input
                  key={index}
                  aria-label={`Lens flare channel ${index + 1}`}
                  title={['red', 'green', 'blue', 'alpha'][index]}
                  type="number"
                  min="0"
                  max="255"
                  value={channel}
                  onChange={(event) => {
                    const next = Number(event.currentTarget.value);
                    if (Number.isFinite(next)) onChangeStageFlareColor(index, Math.max(0, Math.min(0xff, Math.trunc(next))));
                  }}
                />
              ))}
            </div>
          </label>
        </>
      )}
      {entity.rotation && (
        <label>
          Rotation
          <VectorInputs value={entity.rotation} onChange={onChangeRotation} />
        </label>
      )}
      {entity.scale && (
        <label>
          Scale
          <VectorInputs value={entity.scale} onChange={onChangeScale} step={0.1} />
        </label>
      )}
      {entity.objectId !== undefined && objectProfile && (
        <>
          <label>
            Object Setup
            <span>{objectProfile.title}</span>
          </label>
          <label>
            Quick Setup
            <span>{objectProfile.summary}</span>
          </label>
          {objectProfile.tips.map((tip, index) => (
            <label key={`${objectProfile.title}-tip-${index}`}>
              Tip {index + 1}
              <span>{tip}</span>
            </label>
          ))}
          {objectProfile.cautions?.map((caution, index) => (
            <label key={`${objectProfile.title}-caution-${index}`}>
              Watch out
              <span>{caution}</span>
            </label>
          ))}
          {guidanceOnlyObjectProfileNotes[objectProfile.title] && (
            <label>
              Setup Surface
              <span>{guidanceOnlyObjectProfileNotes[objectProfile.title]}</span>
            </label>
          )}
          {objectVariantOptions.length > 1 && (
            <label>
              {objectProfile.variantLabel ?? 'Variant'}
              <select value={String(entity.objectId)} onChange={(event) => onChangeObjectId(Number(event.currentTarget.value))}>
                {objectVariantOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {entity.presenceFlags !== undefined && (
            <label>
              Visibility
              <div className="actionStack">
                <div className="toggleGrid">
                  {gobjPresenceModeOptions.map((option) => {
                    const active = (objectPresencePlayerFlags & option.mask) !== 0;
                    return (
                      <button
                        key={option.mask}
                        className={`inlineAction toggleButton${active ? ' isActive' : ''}`}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChangePresenceFlags(setMaskedBits(entity.presenceFlags ?? 0, option.mask, !active))}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <div className="actionRow">
                  <button className="inlineAction" type="button" onClick={() => onChangePresenceFlags(objectPresenceBaseFlags | 0x0007)}>
                    Show Everywhere
                  </button>
                  <button className="inlineAction" type="button" onClick={() => onChangePresenceFlags(objectPresenceBaseFlags | 0x0001)}>
                    1P Only
                  </button>
                  <button className="inlineAction" type="button" onClick={() => onChangePresenceFlags(objectPresenceBaseFlags)}>
                    Hide
                  </button>
                </div>
                <span>{describePresenceFlags(entity.presenceFlags)}</span>
                {objectHasExtraPresenceBits && <span>Keeps extra presence bits above 0x0007 for compatibility.</span>}
              </div>
            </label>
          )}
          {objectProfile.title === 'Rising Water' && entity.objectSettings && (
            <>
              <label>
                Rising Speed (Odd Stages)
                <input
                  className="routeInput"
                  type="number"
                  min="-32768"
                  max="32767"
                  value={toSigned16(entity.objectSettings[0])}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, toUnsigned16(value));
                  }}
                />
              </label>
              <label>
                Stage 5 Target Height
                <input
                  className="routeInput"
                  type="number"
                  min="-32768"
                  max="32767"
                  value={toSigned16(entity.objectSettings[1])}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, toUnsigned16(value));
                  }}
                />
              </label>
              <label>
                Stage 1 Target Height
                <input
                  className="routeInput"
                  type="number"
                  min="-32768"
                  max="32767"
                  value={toSigned16(entity.objectSettings[2])}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, toUnsigned16(value));
                  }}
                />
              </label>
              <label>
                Stage 2 Frame Count
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[3]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Stage 3 Target Height
                <input
                  className="routeInput"
                  type="number"
                  min="-32768"
                  max="32767"
                  value={toSigned16(entity.objectSettings[4])}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(4, toUnsigned16(value));
                  }}
                />
              </label>
              <label>
                Stage 4 Frame Count
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[5]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(5, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Rising Speed (Even Stages)
                <input
                  className="routeInput"
                  type="number"
                  min="-32768"
                  max="32767"
                  value={toSigned16(entity.objectSettings[6])}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(6, toUnsigned16(value));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Splash Trigger' && entity.objectSettings && (
            <label>
              Group Y KCL Index
              <input
                className="routeInput"
                type="number"
                min="0"
                max="65535"
                value={entity.objectSettings[0]}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                }}
              />
            </label>
          )}
          {objectProfile.title === 'Enemy Route Controller' && entity.objectSettings && (
            <>
              <label>
                Entry Flag
                <select value={entity.objectSettings[0]} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                  <option value={0}>Do Not Enter</option>
                  <option value={1}>Enter</option>
                </select>
              </label>
              <label>
                Time To Next Controller
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Controller ID
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Next Controller ID
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[3]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                ENPH Section Override
                <input
                  className="routeInput"
                  type="number"
                  min="-32768"
                  max="32767"
                  value={toSigned16(entity.objectSettings[7])}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(7, toUnsigned16(value));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Topman Manager' && entity.objectSettings && (
            <>
              <label>
                Manager ID
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Topmen Controlled
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                First Topman ID
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Behavior
                <select value={entity.objectSettings[3]} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                  {!topmanBehaviorOptions.some((option) => option.value === entity.objectSettings[3]) && (
                    <option value={entity.objectSettings[3]}>Custom #{entity.objectSettings[3]}</option>
                  )}
                  {topmanBehaviorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cumulative Topmen Count
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[4]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(4, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Pole Collision Controller' && entity.objectSettings && (
            <label>
              Wall KCL Variant
              <input
                className="routeInput"
                type="number"
                min="0"
                max="65535"
                value={entity.objectSettings[0]}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                }}
              />
            </label>
          )}
          {objectProfile.title === 'Coin Pickup' && entity.objectSettings && (
            <>
              <label>
                Mode
                <select value={entity.objectSettings[0]} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                  {coinModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start / Respawn Place
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Spawn Behavior
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Direct Item Spawn' && entity.objectSettings && (
            <label>
              Item Type
              <select value={entity.objectSettings[0]} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                {!directItemOptions.some((option) => option.value === entity.objectSettings[0]) && (
                  <option value={entity.objectSettings[0]}>Custom #{entity.objectSettings[0]}</option>
                )}
                {directItemOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {objectProfile.title === 'Moving Wall' && entity.objectSettings && (
            <>
              <label>
                Start Pause
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                End Pause
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Move Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Travel Distance
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[3]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Initial Delay
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[4]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(4, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Falling Block' && entity.objectSettings && (
            <>
              <label>
                Countdown Fall Time
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Extra Delay
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Pianta Spectator' && entity.objectSettings && (
            <>
              <label>
                Clap And Face Player
                <select value={entity.objectSettings[1]} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  <option value={0}>Disabled</option>
                  <option value={1}>Enabled</option>
                </select>
              </label>
              <label>
                Face Player Distance
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Clap Animation Distance
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[3]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Fireworks' && entity.objectSettings && (
            <label>
              Pop Delay
              <input
                className="routeInput"
                type="number"
                min="0"
                max="65535"
                value={entity.objectSettings[0]}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                }}
              />
            </label>
          )}
          {objectProfile.title === 'Steam Effect' && entity.objectSettings && (
            <>
              <label>
                Start Delay
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Burst Length
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Time Between Bursts
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[3]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Bowser Statue' && entity.objectSettings && (
            <>
              <label>
                Activation Distance
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Fire Behavior
                <select value={entity.objectSettings[1]} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  <option value={0}>Decoration</option>
                  <option value={1}>Obstacle</option>
                </select>
              </label>
              <label>
                Start Delay
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Audience Flash' && entity.objectSettings && entity.objectId === 0x2d2 && (
            <label>
              Flash Variant
              <select value={entity.objectSettings[0]} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                {audienceFlashWaluigiOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {objectProfile.title === 'Audience Flash' && entity.objectSettings && entity.objectId === 0x2d4 && (
            <label>
              Flash Variant
              <select value={entity.objectSettings[0]} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                {audienceFlashSkateOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {objectProfile.title === 'Lava Bubble' && entity.objectSettings && (
            <>
              <label>
                Start Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Flip Horizontally
                <select value={entity.objectSettings[1]} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  <option value={0}>Disabled</option>
                  <option value={1}>Enabled</option>
                </select>
              </label>
            </>
          )}
          {objectProfile.title === 'Flying Flock' && entity.objectSettings && (
            <>
              <label>
                Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Flock Count
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Route Boat' && entity.objectSettings && (
            <label>
              Start Speed
              <input
                className="routeInput"
                type="number"
                min="0"
                max="65535"
                value={entity.objectSettings[0]}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                }}
              />
            </label>
          )}
          {objectProfile.title === 'Item Box' && entity.objectSettings && (
            <>
              <label>
                Player Item
                <select value={String(entity.objectSettings[1])} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  {!itemBoxSettingOptions.some((option) => option.value === entity.objectSettings[1]) && (
                    <option value={entity.objectSettings[1]}>
                      Custom #{entity.objectSettings[1]}
                    </option>
                  )}
                  {itemBoxSettingOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                CPU Item
                <select value={String(entity.objectSettings[2])} onChange={(event) => onChangeObjectSetting(2, Number(event.currentTarget.value))}>
                  {!itemBoxSettingOptions.some((option) => option.value === entity.objectSettings[2]) && (
                    <option value={entity.objectSettings[2]}>
                      Custom #{entity.objectSettings[2]}
                    </option>
                  )}
                  {itemBoxSettingOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Roulette / Respawn
                <select value={String(entity.objectSettings[5])} onChange={(event) => onChangeObjectSetting(5, Number(event.currentTarget.value))}>
                  {!itemBoxTimingOptions.some((option) => option.value === entity.objectSettings[5]) && (
                    <option value={entity.objectSettings[5]}>
                      Custom #{entity.objectSettings[5]}
                    </option>
                  )}
                  {itemBoxTimingOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {entity.objectId === 0xc9 && (
                <>
                  <label>
                    Start Speed
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[0]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Route Start Point
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[4]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(4, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Shadow
                    <select value={String(entity.objectSettings[3])} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                      {entity.objectSettings[3] !== 0 && entity.objectSettings[3] !== 1 && (
                        <option value={entity.objectSettings[3]}>
                          Custom #{entity.objectSettings[3]}
                        </option>
                      )}
                      <option value="0">Render Shadow</option>
                      <option value="1">Hide Shadow</option>
                    </select>
                  </label>
                </>
              )}
              {entity.objectId === 0xd4 && (
                <>
                  <label>
                    Speed
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[0]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Start Delay
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[4]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(4, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Time Between Boxes
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[5]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(5, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Box Count
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[6]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(6, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Shadow
                    <select value={String(entity.objectSettings[3])} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                      {entity.objectSettings[3] !== 0 && entity.objectSettings[3] !== 1 && (
                        <option value={entity.objectSettings[3]}>
                          Custom #{entity.objectSettings[3]}
                        </option>
                      )}
                      <option value="0">Render Shadow</option>
                      <option value="1">Hide Shadow</option>
                    </select>
                  </label>
                </>
              )}
              {entity.objectId === 0xd5 && (
                <>
                  <label>
                    Speed
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[0]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Start Delay
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[4]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(4, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Shadow
                    <select value={String(entity.objectSettings[3])} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                      {entity.objectSettings[3] !== 0 && entity.objectSettings[3] !== 1 && (
                        <option value={entity.objectSettings[3]}>
                          Custom #{entity.objectSettings[3]}
                        </option>
                      )}
                      <option value="0">Render Shadow</option>
                      <option value="1">Hide Shadow</option>
                    </select>
                  </label>
                </>
              )}
              {entity.objectId === 0xee && (
                <>
                  <label>
                    Cycle Time
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[0]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Start Delay
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[4]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(4, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Shadow
                    <select value={String(entity.objectSettings[3])} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                      {entity.objectSettings[3] !== 0 && entity.objectSettings[3] !== 1 && (
                        <option value={entity.objectSettings[3]}>
                          Custom #{entity.objectSettings[3]}
                        </option>
                      )}
                      <option value="0">Render Shadow</option>
                      <option value="1">Hide Shadow</option>
                    </select>
                  </label>
                </>
              )}
            </>
          )}
          {objectProfile.title === 'Podoboo' && entity.objectSettings && (
            <>
              <label>
                Start Delay (frames after GO)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Respawn Interval (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Landing Distance
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Volcano Rock' && entity.objectSettings && (
            <>
              <label>
                Fireball Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Delay Before Starting
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Time Between Fireballs
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Time Until Fire Goes Out
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[3]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Goomba' && entity.objectSettings && (
            <>
              <label>
                Respawn Time
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Animation Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Penguin' && entity.objectSettings && (
            <label>
              Speed
              <input
                className="routeInput"
                type="number"
                min="0"
                max="65535"
                value={entity.objectSettings[0]}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                }}
              />
            </label>
          )}
          {objectProfile.title === 'Monty Mole' && entity.objectSettings && (
            <>
              <label>
                Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Start Delay (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Shy Guy' && entity.objectSettings && (
            <>
              <label>
                Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Color
                <select value={String(entity.objectSettings[1])} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  {!shyGuyColorOptions.some((option) => option.value === entity.objectSettings[1]) && (
                    <option value={entity.objectSettings[1]}>
                      Custom #{entity.objectSettings[1]}
                    </option>
                  )}
                  {shyGuyColorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {objectProfile.title === 'Ski Lift' && entity.objectSettings && (
            <label>
              Chairlift Model
              <select value={String(entity.objectSettings[0])} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                {!chairliftModelOptions.some((option) => option.value === entity.objectSettings[0]) && (
                  <option value={entity.objectSettings[0]}>
                    Custom #{entity.objectSettings[0]}
                  </option>
                )}
                {chairliftModelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {objectProfile.title === 'Shy Guy Obstacle' && entity.objectSettings && entity.objectId === 0x0ce && (
            <>
              <label>
                Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Vertical Bob Strength
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Shy Guy Obstacle' && entity.objectSettings && entity.objectId === 0x0ea && (
            <>
              <label>
                Source Ship Route
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Flight Time (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Balloon Hazard' && entity.objectSettings && (
            <>
              <label>
                Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Max Vertical Drift
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Cataquack' && entity.objectSettings && (
            <>
              <label>
                Color
                <select value={String(entity.objectSettings[0])} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                  {!cataquackColorOptions.some((option) => option.value === entity.objectSettings[0]) && (
                    <option value={entity.objectSettings[0]}>
                      Custom #{entity.objectSettings[0]}
                    </option>
                  )}
                  {cataquackColorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Detection Distance
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Flame Jet' && entity.objectSettings && entity.objectId === 0x1fd && (
            <>
              <label>
                Cycle Length (frames + 9 seconds)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Start Delay (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Size Factor
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Flame Jet' && entity.objectSettings && entity.objectId === 0x212 && (
            <>
              <label>
                Total Cycle Length
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Start Delay (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Drop Height / 384
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Idle Time Offset
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[3]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Flame Jet' && entity.objectSettings && entity.objectId === 0x216 && (
            <>
              <label>
                Time Outside Lava
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Start Delay (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Time Outside-Lava Mode
                <select value={String(entity.objectSettings[2])} onChange={(event) => onChangeObjectSetting(2, Number(event.currentTarget.value))}>
                  {entity.objectSettings[2] !== 0 && entity.objectSettings[2] !== 1 && (
                    <option value={entity.objectSettings[2]}>
                      Custom #{entity.objectSettings[2]}
                    </option>
                  )}
                  <option value="0">Use Default 5 Seconds</option>
                  <option value="1">Use Setting 1</option>
                </select>
              </label>
            </>
          )}
          {objectProfile.title === 'Angry Sun' && entity.objectSettings && (
            <>
              <label>
                Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Start Delay (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Quicksand' && entity.objectSettings && (
            <>
              <label>
                Center Thwomp
                <select value={String(entity.objectSettings[0])} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                  {entity.objectSettings[0] !== 0 && entity.objectSettings[0] !== 1 && (
                    <option value={entity.objectSettings[0]}>
                      Custom #{entity.objectSettings[0]}
                    </option>
                  )}
                  <option value="0">Use Thwomp</option>
                  <option value="1">No Thwomp</option>
                </select>
              </label>
              <label>
                Sand Wave Length
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Wave Travel Time
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Crusher' && entity.objectSettings && (
            <>
              <label>
                Start Delay (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Sleep Time (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Breakable Box' && entity.objectSettings && entity.objectId === 0xd3 && (
            <>
              <label>
                Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Item Reward
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Reward Chance
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Start Delay
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[4]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(4, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Time Between Boxes
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[5]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(5, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Maximum Boxes
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[6]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(6, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Pokey' && entity.objectSettings && (
            <label>
              Speed
              <input
                className="routeInput"
                type="number"
                min="0"
                max="65535"
                value={entity.objectSettings[0]}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                }}
              />
            </label>
          )}
          {objectProfile.title === 'Swooper' && entity.objectSettings && (
            <>
              <label>
                Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Next Group Delay (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Swoops Per Group
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Route Drift
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[3]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Maximum Height
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[4]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(4, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Spacing Within Group
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[5]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(5, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Start Delay (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[6]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(6, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Bowser Fireball' && entity.objectSettings && (
            <>
              <label>
                Source Ship Route
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Flight Time (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Chain Chomp' && entity.objectSettings && (
            entity.objectId === 0x0eb ? (
              <>
                <label>
                  Route Speed
                  <input
                    className="routeInput"
                    type="number"
                    min="0"
                    max="65535"
                    value={entity.objectSettings[0]}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                    }}
                  />
                </label>
                <label>
                  Start Mode
                  <select value={String(entity.objectSettings[1])} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                    {!twanwanStartModeOptions.some((option) => option.value === entity.objectSettings[1]) && (
                      <option value={entity.objectSettings[1]}>
                        Custom #{entity.objectSettings[1]}
                      </option>
                    )}
                    {twanwanStartModeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Sine Amplitude
                  <input
                    className="routeInput"
                    type="number"
                    min="0"
                    max="65535"
                    value={entity.objectSettings[2]}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                    }}
                  />
                </label>
                <label>
                  Sine Period (frames)
                  <input
                    className="routeInput"
                    type="number"
                    min="0"
                    max="65535"
                    value={entity.objectSettings[3]}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                    }}
                  />
                </label>
                <label>
                  Start Delay (frames)
                  <input
                    className="routeInput"
                    type="number"
                    min="0"
                    max="65535"
                    value={entity.objectSettings[4]}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (Number.isFinite(value)) onChangeObjectSetting(4, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                    }}
                  />
                </label>
                <label>
                  Target Route Start Delay (frames)
                  <input
                    className="routeInput"
                    type="number"
                    min="0"
                    max="65535"
                    value={entity.objectSettings[5]}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (Number.isFinite(value)) onChangeObjectSetting(5, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                    }}
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  Chain Length
                  <input
                    className="routeInput"
                    type="number"
                    min="0"
                    max="65535"
                    value={entity.objectSettings[0]}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                    }}
                  />
                </label>
                <label>
                  Start Delay (frames)
                  <input
                    className="routeInput"
                    type="number"
                    min="0"
                    max="65535"
                    value={entity.objectSettings[5]}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (Number.isFinite(value)) onChangeObjectSetting(5, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                    }}
                  />
                </label>
                <label>
                  Sleep Time (frames)
                  <input
                    className="routeInput"
                    type="number"
                    min="0"
                    max="65535"
                    value={entity.objectSettings[6]}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (Number.isFinite(value)) onChangeObjectSetting(6, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                    }}
                  />
                </label>
              </>
            )
          )}
          {objectProfile.title === 'Thwomp' && entity.objectSettings && (
            <>
              <label>
                Route Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Route Behavior
                <select value={String(entity.objectSettings[1])} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  {!thwompBehaviorOptions.some((option) => option.value === entity.objectSettings[1]) && (
                    <option value={entity.objectSettings[1]}>
                      Custom #{entity.objectSettings[1]}
                    </option>
                  )}
                  {thwompBehaviorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start Delay (frames after GO)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Sleep Time (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[3]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              {entity.routeIndex === 0xffff && <label><span>Without a route, Route Speed and Route Behavior should stay at 0.</span></label>}
            </>
          )}
          {objectProfile.title === 'Traffic Vehicle' && entity.objectSettings && (
            <>
              {(entity.objectId === 0xde || entity.objectId === 0xf3 || entity.objectId === 0xd0) && (
                <>
                  <label>
                    Route Start Point
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[0]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Speed 0
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[1]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Speed 1
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[2]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                </>
              )}
              {(entity.objectId === 0xcc || entity.objectId === 0xe7 || entity.objectId === 0xe8 || entity.objectId === 0x181) && (
                <>
                  <label>
                    Speed
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[0]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Acceleration
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[1]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Pause Time
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[2]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                </>
              )}
              {entity.objectId === 0xd0 && (
                <label>
                  Truck Texture
                  <select value={String(entity.objectSettings[3])} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                    {!kartTruckTextureOptions.some((option) => option.value === entity.objectSettings[3]) && (
                      <option value={entity.objectSettings[3]}>
                        Custom #{entity.objectSettings[3]}
                      </option>
                    )}
                    {kartTruckTextureOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {entity.objectId === 0xd1 && (
                <label>
                  Car Color
                  <select value={String(entity.objectSettings[3])} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                    {!carBodyColorOptions.some((option) => option.value === entity.objectSettings[3]) && (
                      <option value={entity.objectSettings[3]}>
                        Custom #{entity.objectSettings[3]}
                      </option>
                    )}
                    {carBodyColorOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {entity.objectId === 0x19b && (
                <>
                  <label>
                    Speed
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[0]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Delay Before Group Truck Spawns (frames)
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[1]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Delay Before First Group Spawns (frames)
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[2]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Collision Mode
                    <select value={String(entity.objectSettings[3])} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                      {!truckWagonCollisionOptions.some((option) => option.value === entity.objectSettings[3]) && (
                        <option value={entity.objectSettings[3]}>
                          Custom #{entity.objectSettings[3]}
                        </option>
                      )}
                      {truckWagonCollisionOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </>
          )}
          {objectProfile.title === 'Moving Platform' && entity.objectSettings && (
            <>
              {entity.objectId === 0x25c && (
                <>
                  <label>
                    Fast Side Starts
                    <select value={String(entity.objectSettings[1])} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                      {!beltCurveStartSideOptions.some((option) => option.value === entity.objectSettings[1]) && (
                        <option value={entity.objectSettings[1]}>
                          Custom #{entity.objectSettings[1]}
                        </option>
                      )}
                      {beltCurveStartSideOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Time Until Switch
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[2]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Time Until Switch Back
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[3]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                </>
              )}
              {(entity.objectId === 0x25e || entity.objectId === 0x260) && (
                <>
                  <label>
                    Speed 1 (units per second)
                    <input
                      className="routeInput"
                      type="number"
                      min="-32768"
                      max="32767"
                      value={decodeSigned16(entity.objectSettings[1])}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(1, encodeSigned16(value));
                      }}
                    />
                  </label>
                  <label>
                    Time Until Speed 2
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[2]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Speed 2 (units per second)
                    <input
                      className="routeInput"
                      type="number"
                      min="-32768"
                      max="32767"
                      value={decodeSigned16(entity.objectSettings[3])}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(3, encodeSigned16(value));
                      }}
                    />
                  </label>
                  <label>
                    Total Time Until Speed 3
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[4]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(4, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Speed 3 (units per second)
                    <input
                      className="routeInput"
                      type="number"
                      min="-32768"
                      max="32767"
                      value={decodeSigned16(entity.objectSettings[5])}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(5, encodeSigned16(value));
                      }}
                    />
                  </label>
                </>
              )}
            </>
          )}
          {objectProfile.title === 'Cow' && entity.objectSettings && (
            <>
              <label>
                Follower Count
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Start Delay (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Tumbleweed' && entity.objectSettings && (
            <>
              <label>
                Item Reward
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Reward Chance
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Traffic Cone' && entity.objectSettings && (
            <>
              <label>
                Cone Color
                <select value={String(entity.objectSettings[0])} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                  {!pylonColorOptions.some((option) => option.value === entity.objectSettings[0]) && (
                    <option value={entity.objectSettings[0]}>
                      Custom #{entity.objectSettings[0]}
                    </option>
                  )}
                  {pylonColorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                </select>
              </label>
              <label>
                Start Delay (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[5]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(5, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Sleep Time (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[6]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(6, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                One-Time Shoot
                <button
                  className={entity.objectSettings[6] === 0 ? 'inlineAction toggleButton isActive' : 'inlineAction toggleButton'}
                  type="button"
                  onClick={() => onChangeObjectSetting(6, entity.objectSettings[6] === 0 ? 60 : 0)}
                >
                  {entity.objectSettings[6] === 0 ? 'Enabled (Sleep Time = 0)' : 'Disabled'}
                </button>
              </label>
            </>
          )}
          {objectProfile.title === 'Mii Spectator' && entity.objectSettings && (entity.objectId === 0x2eb || entity.objectId === 0x2ec) && (
            <>
              <label>
                Crowd Interaction
                <select value={String(entity.objectSettings[1])} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  {!miiSpectatorInteractionOptions.some((option) => option.value === entity.objectSettings[1]) && (
                    <option value={entity.objectSettings[1]}>
                      Custom #{entity.objectSettings[1]}
                    </option>
                  )}
                  {miiSpectatorInteractionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Face Player Distance
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Clap Animation Distance
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[3]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Wiggler' && entity.objectSettings && (
            <>
              <label>
                Primary Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              {(entity.objectId === 0xf0 || entity.objectId === 0xf2) && (
                <>
                  <label>
                    Stop Time Before Speed Change (frames)
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[1]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Secondary Speed
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[2]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Player Trigger Point For Speed 2
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[3]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Angry Speed
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[4]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(4, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Player Trigger Point For Angry Speed
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[5]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(5, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                  <label>
                    Alternate Stop Time Before Angry Speed (frames)
                    <input
                      className="routeInput"
                      type="number"
                      min="0"
                      max="65535"
                      value={entity.objectSettings[6]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(6, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  </label>
                </>
              )}
            </>
          )}
          {objectProfile.title === 'Spinner Hazard' && entity.objectSettings && entity.objectId === 0x016 && (
            <>
              <label>
                Manager ID
                <input
                  className="routeInput"
                  type="number"
                  min="1"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(1, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Controlled Topmen
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                First Topman ID
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Topman Behavior
                <select value={String(entity.objectSettings[3])} onChange={(event) => onChangeObjectSetting(3, Number(event.currentTarget.value))}>
                  {!topmanBehaviorOptions.some((option) => option.value === entity.objectSettings[3]) && (
                    <option value={entity.objectSettings[3]}>
                      Custom #{entity.objectSettings[3]}
                    </option>
                  )}
                  {topmanBehaviorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {objectProfile.title === 'Piranha Plant' && entity.objectSettings && (
            <label>
              Idle Time Between Attacks (frames)
              <input
                className="routeInput"
                type="number"
                min="0"
                max="65535"
                value={entity.objectSettings[0]}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                }}
              />
            </label>
          )}
          {objectProfile.title === 'Crab' && entity.objectSettings && (
            <>
              <label>
                Speed
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                View Direction
                <select value={String(entity.objectSettings[1])} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  {!crabDirectionOptions.some((option) => option.value === entity.objectSettings[1]) && (
                    <option value={entity.objectSettings[1]}>
                      Custom #{entity.objectSettings[1]}
                    </option>
                  )}
                  {crabDirectionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {objectProfile.title === 'Fire Bar' && entity.objectSettings && (() => {
            const spin = decodeWrappedSpin(entity.objectSettings[1]);
            const isFireRing = entity.objectId === 0x1a1;
            return (
              <>
                <label>
                  {isFireRing ? 'Fireball Count' : 'Fireballs Per Arm'}
                  <input
                    className="routeInput"
                    type="number"
                    min="0"
                    max="65535"
                    value={entity.objectSettings[0]}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                    }}
                  />
                </label>
                <label>
                  Spin Direction
                  <select
                    value={String(spin.direction)}
                    onChange={(event) => onChangeObjectSetting(1, encodeWrappedSpin(spin.speed, Number(event.currentTarget.value)))}
                  >
                    {spinDirectionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Spin Speed
                  <input
                    className="routeInput"
                    type="number"
                    min="0"
                    max="65535"
                    value={spin.speed}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (Number.isFinite(value)) onChangeObjectSetting(1, encodeWrappedSpin(value, spin.direction));
                    }}
                  />
                </label>
                <label>
                  {isFireRing ? 'Pulsation Factor' : 'Fireball Spacing'}
                  <input
                    className="routeInput"
                    type="number"
                    min="0"
                    max="65535"
                    value={entity.objectSettings[2]}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                    }}
                  />
                </label>
                <label>
                  {isFireRing ? 'Radius' : 'Number Of Arms'}
                  <input
                    className="routeInput"
                    type="number"
                    min="0"
                    max="65535"
                    value={entity.objectSettings[3]}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                    }}
                  />
                </label>
              </>
            );
          })()}
          {objectProfile.title === 'Driveable Ring' && entity.objectSettings && (
            <>
              <label>
                Ring Layout
                <select value={String(entity.objectSettings[0])} onChange={(event) => onChangeObjectSetting(0, Number(event.currentTarget.value))}>
                  {!driveableRingIdOptions.some((option) => option.value === entity.objectSettings[0]) && (
                    <option value={entity.objectSettings[0]}>
                      Custom #{entity.objectSettings[0]}
                    </option>
                  )}
                  {driveableRingIdOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start Shake After (seconds)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Shake Duration (seconds)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[2]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(2, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Fall Delay (frames)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[3]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(3, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Electric Propeller' && entity.objectSettings && (
            <>
              <label>
                Rotations Per 12 Seconds
                <input
                  className="routeInput"
                  type="number"
                  min="1"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(1, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Rotation Direction
                <select value={String(entity.objectSettings[1])} onChange={(event) => onChangeObjectSetting(1, Number(event.currentTarget.value))}>
                  {!epropellerDirectionOptions.some((option) => option.value === entity.objectSettings[1]) && (
                    <option value={entity.objectSettings[1]}>
                      Custom #{entity.objectSettings[1]}
                    </option>
                  )}
                  {epropellerDirectionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Slowdown Factor (LE-CODE)
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[7]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(7, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            </>
          )}
          {objectProfile.title === 'Star Gate' && entity.objectSettings && (
            <>
              <label>
                Gate Number
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[0]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(0, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Trigger
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.objectSettings[1]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangeObjectSetting(1, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
              <label>
                Airborne Shadow
                <select value={String(entity.objectSettings[2])} onChange={(event) => onChangeObjectSetting(2, Number(event.currentTarget.value))}>
                  {entity.objectSettings[2] !== 0 && entity.objectSettings[2] !== 1 && (
                    <option value={entity.objectSettings[2]}>
                      Custom #{entity.objectSettings[2]}
                    </option>
                  )}
                  <option value="0">Normal</option>
                  <option value="1">Increase Shadow Height</option>
                </select>
              </label>
            </>
          )}
          {objectProfile.title === 'Falling Rock' && entity.objectSettings && (
            <label>
              Safety Setup
              <div className="actionRow">
                <button className="inlineAction" type="button" onClick={onApplySafeFallingRockDefaults} disabled={!onApplySafeFallingRockDefaults}>
                  Apply Safe Vanilla Defaults
                </button>
              </div>
              <span>{entity.objectSettings[2] === 0 ? 'Setting 3 is currently unsafe for vanilla Mario Kart Wii.' : `Setting 3 is currently ${entity.objectSettings[2]}.`}</span>
            </label>
          )}
          {objectProfile.title === 'Cannon Object' && (
            <label>
              Cannon Setup
              <div className="actionRow">
                <button className="inlineAction" type="button" onClick={onCreateCannonPointFromObject} disabled={!onCreateCannonPointFromObject}>
                  Create Cannon Point
                </button>
              </div>
              <span>Creates a cannon point at this prop so you can tune the actual launch logic next.</span>
            </label>
          )}
          {objectProfile.title === 'Roulette Platform' && (
            <label>
              Roulette Setup
              <div className="actionRow">
                <button className="inlineAction" type="button" onClick={onApplyRoulettePlatformDefaults} disabled={!onApplyRoulettePlatformDefaults}>
                  Apply Required Defaults
                </button>
              </div>
              <span>Mario Kart Wii expects this object at the world center with zero rotation and a scale of 1 on all axes.</span>
            </label>
          )}
          {objectProfile.routeLabel && entity.routeIndex !== undefined && entity.routeIndex !== 0xffff && (
            <label>
              {objectProfile.routeLabel}
              <div className="actionRow">
                <button className="inlineAction" type="button" onClick={onSelectObjectRoute} disabled={!onSelectObjectRoute}>
                  Select Path
                </button>
              </div>
              <span>Jumps straight to the first node of the bound route so you can edit motion without searching the scene.</span>
            </label>
          )}
          {(onResetObjectBehavior || onClearObjectRoute) && (
            <label>
              Object Actions
              <div className="actionRow">
                <button className="inlineAction" type="button" onClick={onResetObjectBehavior} disabled={!onResetObjectBehavior}>
                  Reset Defaults
                </button>
                <button className="inlineAction" type="button" onClick={onClearObjectRoute} disabled={!onClearObjectRoute || entity.routeIndex === undefined || entity.routeIndex === 0xffff}>
                  Clear Path
                </button>
              </div>
            </label>
          )}
        </>
      )}
      {entity.routeIndex !== undefined && (
        <label>
          {objectProfile?.routeLabel ?? 'Path'}
          <div className="actionStack">
            <ReferenceSelect label={objectProfile?.routeLabel ?? 'Object route'} value={entity.routeIndex} noneValue={0xffff} count={referenceCounts.routes} optionLabel="Route" onChange={onChangeRouteIndex} />
            {objectProfile?.routeLabel && entity.routeIndex === 0xffff && onCreateObjectRoute && (
              <button className="inlineAction" type="button" onClick={onCreateObjectRoute}>
                Create movement path
              </button>
            )}
          </div>
        </label>
      )}
      {(entity.objectId !== undefined || entity.objectSettings || entity.presenceFlags !== undefined) && (
        <details className="advancedDetails">
          <summary>Advanced object data</summary>
          <div className="advancedDetailsBody">
            {entity.objectId !== undefined && (
              <label>
                Object
                <ObjectIdSelect value={entity.objectId} options={objectOptions} onChange={onChangeObjectId} />
              </label>
            )}
            {entity.objectSettings && (
              <label>
                Object Slots
                <div className="settingInputs">
                  {entity.objectSettings.map((setting, index) => (
                    <input
                      key={index}
                      aria-label={`Setting ${index + 1}`}
                      title={`Setting ${index + 1}`}
                      type="number"
                      min="0"
                      max="65535"
                      value={setting}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onChangeObjectSetting(index, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                      }}
                    />
                  ))}
                </div>
              </label>
            )}
            {entity.presenceFlags !== undefined && (
              <label>
                Presence Flags
                <input
                  className="routeInput"
                  type="number"
                  min="0"
                  max="65535"
                  value={entity.presenceFlags}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangePresenceFlags(Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              </label>
            )}
          </div>
        </details>
      )}
      {entity.routePoint && (
        <label>
          Route Node
          <div className="actionRow">
            <span>
              route {entity.routePoint.routeIndex} · node {entity.routePoint.pointIndex}
            </span>
            <button className="inlineAction" type="button" onClick={onAddPotiNode}>
              Add Node
            </button>
          </div>
        </label>
      )}
      {pathInfo && (
        <>
          <label>
            Path Group
            <span>
              {pathInfo.groupSection} #{pathInfo.groupIndex} · point {pathInfo.localIndex + 1}/{pathInfo.groupSize}
            </span>
          </label>
          {(onSplitPathGroup || onMergePathGroup) && (
            <label>
              Group Operations
              <div className="actionRow">
                <button className="inlineAction" type="button" onClick={onSplitPathGroup} disabled={!onSplitPathGroup}>
                  Split
                </button>
                <button className="inlineAction" type="button" onClick={onMergePathGroup} disabled={!onMergePathGroup}>
                  Merge Next
                </button>
              </div>
            </label>
          )}
          <label>
            Group Links
            <div className="vectorInputs">
              <input
                aria-label="Previous groups"
                title="Previous groups"
                value={pathInfo.prevGroups.join(', ')}
                onChange={(event) => onChangePathGroupLinks('prev', parseGroupLinkText(event.currentTarget.value))}
              />
              <input
                aria-label="Next groups"
                title="Next groups"
                value={pathInfo.nextGroups.join(', ')}
                onChange={(event) => onChangePathGroupLinks('next', parseGroupLinkText(event.currentTarget.value))}
              />
              <span>{pathInfo.groupSection}</span>
            </div>
          </label>
        </>
      )}
    </div>
  );
}

function VectorInputs({ value, onChange, step = 1 }: { value: Vec3; onChange: (value: Vec3) => void; step?: number }) {
  return (
    <div className="vectorInputs">
      {(['x', 'y', 'z'] as const).map((axis) => (
        <input
          key={axis}
          aria-label={axis.toUpperCase()}
          type="number"
          step={step}
          value={Number.isFinite(value[axis]) ? Number(value[axis].toFixed(4)) : 0}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChange({ ...value, [axis]: next });
          }}
        />
      ))}
    </div>
  );
}

function ShortNumberInputs<T extends Record<string, number>>({ values, onChange }: { values: T; onChange: (field: keyof T, value: number) => void }) {
  return (
    <div className="settingInputs">
      {(Object.entries(values) as Array<[keyof T, number]>).map(([field, value]) => (
        <input
          key={String(field)}
          aria-label={String(field)}
          title={String(field)}
          type="number"
          min="0"
          max="65535"
          value={value}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChange(field, Math.max(0, Math.min(0xffff, Math.trunc(next))));
          }}
        />
      ))}
    </div>
  );
}

function ByteNumberInputs<T extends Record<string, number>>({ values, onChange }: { values: T; onChange: (field: keyof T, value: number) => void }) {
  return (
    <div className="settingInputs">
      {(Object.entries(values) as Array<[keyof T, number]>).map(([field, value]) => (
        <input
          key={String(field)}
          aria-label={String(field)}
          title={String(field)}
          type="number"
          min="0"
          max="255"
          value={value}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChange(field, Math.max(0, Math.min(0xff, Math.trunc(next))));
          }}
        />
      ))}
    </div>
  );
}

function ReferenceSelect({
  label,
  value,
  noneValue,
  count,
  optionLabel,
  onChange,
}: {
  label: string;
  value: number;
  noneValue: number;
  count: number;
  optionLabel: string;
  onChange: (value: number) => void;
}) {
  const normalized = value === noneValue || value >= count ? String(value) : String(value);
  return (
    <select
      className="referenceSelect"
      aria-label={label}
      title={label}
      value={normalized}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
    >
      <option value={noneValue}>None</option>
      {value !== noneValue && value >= count && <option value={value}>Missing #{value}</option>}
      {Array.from({ length: count }, (_, index) => (
        <option value={index} key={index}>
          {optionLabel} #{index}
        </option>
      ))}
    </select>
  );
}

function NumberOptionSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: AreaInspectorOption[];
  onChange: (value: number) => void;
}) {
  return (
    <select
      className="referenceSelect"
      aria-label={label}
      title={label}
      value={String(value)}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
    >
      {!options.some((option) => option.value === value) && <option value={value}>Custom #{value}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function ObjectIdSelect({ value, options, onChange }: { value: number; options: ObjectOption[]; onChange: (value: number) => void }) {
  const [query, setQuery] = useState('');
  const trimmed = query.trim().toLowerCase();
  const selected = options.find((option) => option.id === value) ?? null;
  const filtered = trimmed
    ? options.filter((option) => `${option.label} ${option.detail} ${option.id.toString(16)} ${option.id}`.toLowerCase().includes(trimmed))
    : options;
  const visibleOptions = selected && !filtered.some((option) => option.id === selected.id) ? [selected, ...filtered] : filtered;
  return (
    <div className="objectPicker">
      <input
        className="objectPickerSearch"
        type="search"
        value={query}
        placeholder="Filter objects by name or ID"
        aria-label="Filter objects"
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <select className="referenceSelect" aria-label="Object" title="Object" value={String(value)} onChange={(event) => onChange(Number(event.currentTarget.value))}>
        {visibleOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function KmpOverview({ kmp, onSelect }: { kmp: KmpDocument; onSelect: (id: string, options?: { additive?: boolean }) => void }) {
  const stage = kmp.entities.find((entity) => entity.section === 'STGI');
  return (
    <>
      <h2>Track Graphs</h2>
      <div className="propertyGrid">
        {stage && (
          <label>
            Track Settings
            <button className="inlineAction" type="button" onClick={(event) => onSelect(stage.id, { additive: event.shiftKey })}>
              Track settings
            </button>
          </label>
        )}
        {kmp.pathGraphs.map((graph) => (
          <label key={graph.groupSection}>
            {friendlySectionLabel(graph.pointSection)}
            <span>
              {graph.groups.length} path groups · {graph.edges.length} connections
            </span>
          </label>
        ))}
        <label>
          Object Routes
          <span>
            {kmp.routes.length} routes · {kmp.routes.reduce((sum, route) => sum + route.points.length, 0)} points
          </span>
        </label>
      </div>
    </>
  );
}

function friendlySectionLabel(section: string): string {
  switch (section) {
    case 'KTPT':
      return 'Start Points';
    case 'ENPT':
      return 'Enemy Routes';
    case 'ITPT':
      return 'Item Routes';
    case 'CKPT':
      return 'Checkpoints';
    case 'POTI':
      return 'Object Routes';
    case 'CAME':
      return 'Cameras';
    case 'AREA':
      return 'Areas';
    case 'JGPT':
      return 'Respawn Points';
    case 'CNPT':
      return 'Cannon Points';
    case 'MSPT':
      return 'Battle Finish Points';
    case 'STGI':
      return 'Track Settings';
    default:
      return section;
  }
}

function friendlySectionSingularLabel(section: string): string {
  switch (section) {
    case 'KTPT':
      return 'start point';
    case 'ENPT':
      return 'enemy route point';
    case 'ITPT':
      return 'item route point';
    case 'CKPT':
      return 'checkpoint';
    case 'POTI':
      return 'object route';
    case 'CAME':
      return 'camera';
    case 'AREA':
      return 'area trigger';
    case 'JGPT':
      return 'respawn point';
    case 'CNPT':
      return 'cannon point';
    case 'MSPT':
      return 'battle finish point';
    default:
      return section.toLowerCase();
  }
}

function friendlyGroupSectionLabel(section: string): string {
  switch (section) {
    case 'ENPH':
      return 'enemy route';
    case 'ITPH':
      return 'item route';
    case 'CKPH':
      return 'checkpoint';
    default:
      return section;
  }
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : 'nan';
}

function parseGroupLinkText(value: string): number[] {
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part))
    .map((part) => Math.max(0, Math.min(255, Math.trunc(part))));
}

function catalogId(object: (typeof objectCatalog)[number] | ObjFlowEntry): number {
  return 'id' in object ? object.id : object.objectId;
}

function ObjectThumbnail({
  object,
  common,
  summaries,
}: {
  object: (typeof objectCatalog)[number] | ObjFlowEntry;
  common: CommonResourceArchive | null;
  summaries: Record<string, NoclipBrresSummary>;
}) {
  const id = catalogId(object);
  const resources = objectResources(object);
  const primaryResource = resources[0] ?? ('resources' in object ? object.resources : object.label);
  const hasModel = resources.some((resource) => common?.byBaseName.has(resource.toLowerCase()));
  const summary = firstResourceSummary(resources, summaries);
  return (
    <div className="thumbnail objectPreview" data-state={hasModel ? 'available' : 'missing'} data-preview={summary?.previewDataUrl ? 'image' : 'fallback'}>
      {summary?.previewDataUrl && <img src={summary.previewDataUrl} alt="" />}
      {!summary?.previewDataUrl && <span className="previewModel">{summary ? `${summary.models.length} models · ${summary.textures.length} textures` : shortAssetName(primaryResource)}</span>}
      {!summary?.previewDataUrl && (
        <span className="previewStack" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}

function CourseAssetThumbnail({ asset, summaries }: { asset: PlaceableCourseAssetRecord; summaries: Record<string, NoclipBrresSummary> }) {
  const summary = summaries[asset.baseName.toLowerCase()];
  return (
    <div className="thumbnail objectPreview" data-state={asset.objectId !== null ? 'available' : 'missing'} data-preview={summary?.previewDataUrl ? 'image' : 'fallback'}>
      {summary?.previewDataUrl && <img src={summary.previewDataUrl} alt="" />}
      {!summary?.previewDataUrl && <span className="previewModel">{summary ? `${summary.models.length} models · ${summary.textures.length} textures` : shortAssetName(asset.baseName)}</span>}
      {!summary?.previewDataUrl && (
        <span className="previewStack" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}

function objectAssetLabel(object: (typeof objectCatalog)[number] | ObjFlowEntry, common: CommonResourceArchive | null, summaries: Record<string, NoclipBrresSummary>): string {
  if ('category' in object) return object.category;
  const resources = objectResources(object);
  if (resources.length === 0) return 'Game Object';
  const available = resources.filter((resource) => common?.byBaseName.has(resource.toLowerCase())).length;
  const summary = firstResourceSummary(resources, summaries);
  return summary
    ? `${available}/${resources.length} resources · ${summary.models.length} models · ${summary.textures.length} textures`
    : `${available}/${resources.length} resources · ${resources.slice(0, 2).map(shortAssetName).join(', ')}`;
}

function browserObjectTitle(object: (typeof objectCatalog)[number] | ObjFlowEntry): string {
  const knownName = getKnownObjectName(catalogId(object));
  if (knownName) return knownName;
  if ('label' in object) return object.label;
  return object.name || object.resources || 'Unknown object';
}

function countAvailableResources(object: ObjFlowEntry, common: CommonResourceArchive | null): number {
  return getObjFlowResourceNames(object).filter((resource) => common?.byBaseName.has(resource.toLowerCase())).length;
}

function objectResources(object: (typeof objectCatalog)[number] | ObjFlowEntry): string[] {
  return 'resources' in object ? getObjFlowResourceNames(object) : [];
}

function classifyObjectFolder(object: BrowserAssetItem): Exclude<BrowserFolderId, 'featured' | 'kmp' | 'common' | 'track'> {
  const text = browserItemSearchText(object);
  if (/(kuribo|goomba|choropu|pakkun|killer|wanwan|heyho|nokonoko|koopa|sanbo|crab|fish|enemy|boss)/.test(text)) return 'enemies';
  if (/(tree|wood|bush|grass|flower|plant|leaf|palm|forest|kinoko|mushroom|cactus)/.test(text)) return 'nature';
  if (/(item|lift|cannon|route|switch|gear|pendulum|flipper|jump|belt|panel|launcher|goal|sound|effect)/.test(text)) return 'gameplay';
  return 'props';
}

function isFeaturedObject(object: BrowserObject): boolean {
  const text = objectSearchText(object);
  return /(kuribo|goomba|tree|item|box|cannon|pakkun|choropu|npc_mii|pendulum|lift|kinoko)/.test(text);
}

function objectSearchText(object: BrowserObject): string {
  return [
    browserObjectTitle(object),
    'label' in object ? object.label : object.name,
    'category' in object ? object.category : '',
    ...objectResources(object),
  ]
    .join(' ')
    .toLowerCase();
}

function isCourseAssetBrowserItem(object: BrowserAssetItem): object is PlaceableCourseAssetRecord {
  return 'trackLabel' in object;
}

function browserItemSearchText(object: BrowserAssetItem): string {
  if (isCourseAssetBrowserItem(object)) {
    return [object.objectLabel ?? object.baseName.replace(/\.brres$/i, ''), object.trackLabel, object.path, object.kind]
      .join(' ')
      .toLowerCase();
  }
  return objectSearchText(object);
}

function isBrowsableObjectEntry(entry: ObjFlowEntry): boolean {
  const text = objectSearchText(entry);
  return !/(^|\s)(dummy|escalator_group|sound_lift|truckchimsmk|truckchimsmkw)(\s|$)/.test(text);
}

function isBrowsableObjectChoice(id: number, label: string, detail: string): boolean {
  const text = `${getKnownObjectName(id) ?? ''} ${label} ${detail}`.toLowerCase();
  return !/(^|\s)(dummy|escalator_group|sound_lift|truckchimsmk|truckchimsmkw)(\s|$)/.test(text);
}

function filterBrowserFolder(folder: BrowserFolder | null, query: string): BrowserFolder | null {
  if (!folder) return null;
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return folder;
  if (folder.kind === 'kmp') {
    const items = folder.items.filter((item) => `${item.label} ${item.section} ${item.category}`.toLowerCase().includes(trimmed));
    return { ...folder, detail: `${items.length} matching records`, items };
  }
  if (folder.kind === 'object') {
    const items = folder.items.filter((item) => browserItemSearchText(item).includes(trimmed));
    return { ...folder, detail: `${items.length} matching objects`, items };
  }
  const items = folder.items.filter((item) => item.toLowerCase().includes(trimmed));
  return { ...folder, detail: `${items.length} matching track asset files`, items };
}

function mapCourseAssetToPlaceable(asset: CourseAssetRecord, objFlow: CommonResourceArchive['objFlow'] | null): PlaceableCourseAssetRecord {
  const objectId = findObjectIdForAsset(asset, objFlow);
  return {
    ...asset,
    objectId,
    objectLabel: objectId !== null ? browserObjectTitle({ objectId, name: objFlow?.byId.get(objectId)?.name ?? '', resources: objFlow?.byId.get(objectId)?.resources ?? '' }) : null,
  };
}

function findObjectIdForAsset(asset: CourseAssetRecord, objFlow: CommonResourceArchive['objFlow'] | null): number | null {
  const baseName = asset.baseName.toLowerCase();
  for (const entry of objFlow?.entries ?? []) {
    const resources = getObjFlowResourceNames(entry).map((resource) => resource.toLowerCase());
    if (resources.includes(baseName)) return entry.objectId;
  }
  return null;
}

function getObjectInspectorProfile(entity: KmpEntity, objFlow: CommonResourceArchive['objFlow'] | null): ObjectInspectorProfile | null {
  if (entity.section !== 'GOBJ' || entity.objectId === undefined) return null;
  const flow = objFlow?.byId.get(entity.objectId);
  const sourceText = [flow?.name ?? '', flow?.resources ?? '', fallbackObjectName(entity.objectId)].join(' ').toLowerCase();

  if (/(^|\s)(airblock)(\s|$)/.test(sourceText)) {
    return {
      title: 'Invisible Barrier',
      summary: 'Invisible blocking volume. Use it when you need to stop glides, jumps, or out-of-bounds movement without adding visible geometry to the course.',
      tips: ['Scale it to the minimum volume that solves the problem so the invisible wall stays predictable.', 'Check the barrier from gameplay camera angles and from top view so it does not accidentally block a fair recovery line.'],
    };
  }
  if (/(^|\s)(psea)(\s|$)/.test(sourceText)) {
    return {
      title: 'Sea Surface',
      summary: 'Large water surface object. Use it to support the surrounding beach or shoreline presentation without relying on the course model alone.',
      tips: ['Scale and place it so the visible water line matches the nearby coast and horizon.', 'Check the section from the racing line and from free camera so the water plane does not clip obvious terrain edges.'],
    };
  }
  if (/(^|\s)(venice_nami)(\s|$)/.test(sourceText)) {
    return {
      title: 'Rising Water',
      summary: 'Multi-stage rising and falling water controller. Set the stage heights and timings first, then verify the full cycle against the collision and respawn flow.',
      tips: ['Treat the placed Y position as the baseline; all target heights are relative to that origin.', 'If players can touch this water, pair it with the proper splash object so respawns and effects stay stable.'],
      cautions: ['This is a staged tide controller, not a generic decorative plane. Check the full cycle in motion before treating the setup as finished.'],
    };
  }
  if (/(^|\s)(pocha|pochayogan|pochamori)(\s|$)/.test(sourceText)) {
    return {
      title: 'Splash Trigger',
      summary: 'Collision-driven splash effect. Use it to connect water, lava, or leaf-splash collision to the correct effect region without placing visual clutter on the racing line.',
      tips: ['Match the Group Y KCL Index below to the collision group that should trigger the splash.', 'The object position itself matters far less than the matching KCL and group index, so verify the collision first.'],
    };
  }
  if (/(^|\s)(lensfx)(\s|$)/.test(sourceText)) {
    return {
      title: 'Lens Flare',
      summary: 'Sun-facing flare helper. Use it to reinforce a bright light source like the sun without baking the whole effect into the course model.',
      tips: ['Place it near the matching sun or bright focal point instead of scattering it loosely through the skybox.', 'Check the effect from the main racing line so the flare supports the scene instead of distracting from the route.'],
    };
  }
  if (/(^|\s)(entry)(\s|$)/.test(sourceText)) {
    return {
      title: 'Burning Entry Effect',
      summary: 'Fall-boundary fire effect helper. Use it when a burning out-of-bounds zone should wrap the player in the proper visual effect.',
      tips: ['Pair it with the correct burning fall-boundary collision instead of treating it like a standalone hazard.', 'Check the target slot and surrounding presentation so the fire effect fits the course theme.'],
    };
  }
  if (/(^|\s)(coin)(\s|$)/.test(sourceText)) {
    return {
      title: 'Coin Pickup',
      summary: 'Battle or mission coin pickup. Use it to define where coins appear, when they respawn, and how they behave in Coin Runners or tournament-style setups.',
      tips: ['Use the mode and spawn fields below consistently across a set of coins so their appearance timing feels deliberate.', 'Check coin placement from gameplay view; battle pickups need to be obvious without cluttering the arena.'],
      cautions: ['Some coins intentionally spawn later, so verify your start/respawn logic in context instead of assuming every placed coin appears immediately.'],
    };
  }
  if (/(^|\s)(itemdirect)(\s|$)/.test(sourceText)) {
    return {
      title: 'Direct Item Spawn',
      summary: 'Tournament-style placed item spawner. Use it when a specific item should exist directly on the track instead of coming from an item box.',
      tips: ['Keep the item type count small and readable so players can understand why an item is placed there.', 'Do not spam these across a track; the vanilla game is known to break online if too many are used.'],
      cautions: ['These do not appear in Time Trials, so avoid making them critical to a route that should still make sense there.', 'Vanilla online play is unsafe beyond 10 placed ItemDirect objects.'],
    };
  }
  if (/(^|\s)(wlwallgc|cara1)(\s|$)/.test(sourceText)) {
    return {
      title: 'Moving Wall',
      summary: 'Constant-speed back-and-forth mover. Use it for horizontal blockers, moving walls, or similar scripted motion that pauses cleanly at each end.',
      tips: ['The motion direction comes from object rotation, so set the facing first before tuning timing values.', 'Verify the full back-and-forth cycle in scene view; these objects pause at each end instead of moving as a sine wave.'],
    };
  }
  if (/(^|\s)(obakeblocksfcc|obakeblock2sfcc|obakeblock3sfcc)(\s|$)/.test(sourceText)) {
    return {
      title: 'Falling Block',
      summary: 'Ghost Valley falling block. Use it when you need touch-triggered or timed block drops that still read clearly from the racing line.',
      tips: ['On slot 5.3 the Y rotation affects fall direction instead of the visual block rotation, so verify both gameplay and visuals together.', 'If you use timed falling behavior, tune the countdown timing as a group so nearby blocks feel coordinated rather than random.'],
      cautions: ['These blocks are slot-sensitive; outside the intended slot they can lose solidity or special behavior.', 'Large block counts are possible, but only if the target slot and fall logic are set up carefully.'],
    };
  }
  if (/(^|\s)(eline_control)(\s|$)/.test(sourceText)) {
    return {
      title: 'Enemy Route Controller',
      summary: 'CPU route controller object. Use it to chain enemy-line behavior changes instead of forcing every CPU path edit directly into ENPT and ENPH alone.',
      tips: ['Treat Controller ID 0 as the chain terminator and make sure each next-controller link points where you expect.', 'Verify the linked ENPH section and controller timing together, because the controller chain and enemy path graph interact.'],
      cautions: ['This is easy to misconfigure silently. Check the full controller chain in sequence instead of editing one controller in isolation.'],
    };
  }
  if (/(^|\s)(begoman_manager)(\s|$)/.test(sourceText)) {
    return {
      title: 'Topman Manager',
      summary: 'Galaxy Colosseum Topman wave controller. Use it to define which Topmen belong to each manager and how later waves unlock after the earlier ones are defeated.',
      tips: ['Keep manager IDs and first-controlled Topman IDs organized before tuning the behavior fields.', 'Check the target slot early; this object is slot-restricted and does not behave like a generic obstacle spawner.'],
      cautions: ['Wave order comes from the manager chain, so mismatched IDs or counts can make later groups fail to appear as intended.'],
    };
  }
  if (/(^|\s)(ice)(\s|$)/.test(sourceText)) {
    return {
      title: 'Frozen Water Effect',
      summary: 'Respawn ice-effect helper. Use it to enable the frozen-water presentation for icy fall boundaries on the proper slot.',
      tips: ['This effect is global once enabled, so focus on the target slot and boundary setup rather than the object position.', 'Use it only when the track really has icy water behavior; otherwise it adds confusion without gameplay value.'],
    };
  }
  if (/(^|\s)(startline2d)(\s|$)/.test(sourceText)) {
    return {
      title: 'Arena Finish Line',
      summary: '2D finish-line helper for arena-style laps or mission-style goals. Place it exactly where the completion line should register.',
      tips: ['Line it up from top view so the counted crossing spans the intended width of the arena path.', 'Check the player approach and lap flow so the line reads clearly instead of feeling arbitrary.'],
    };
  }
  if (/(^|\s)(dummypole)(\s|$)/.test(sourceText)) {
    return {
      title: 'Pole Collision Controller',
      summary: 'Solidity helper for pole-style obstacles. Use it when the visible pole needs the correct wall collision variant to match the intended hit behavior.',
      tips: ['Treat the Wall KCL Variant below as the key field; this object mainly exists to define collision behavior for the pole it supports.', 'Check the supported visual pole and nearby wall space together so the resulting collision is readable in motion.'],
    };
  }
  if (/(^|\s)(monte_a)(\s|$)/.test(sourceText)) {
    return {
      title: 'Pianta Spectator',
      summary: 'Single Pianta crowd actor. Use it to add trackside life, then tune when it turns to face the player and when it starts clapping.',
      tips: ['Keep the rotation and clap distances close to the actual player route so the reaction reads intentionally.', 'These work best off the main racing surface, supporting a nearby setpiece instead of cluttering the line.'],
    };
  }
  if (/(^|\s)(hanabi)(\s|$)/.test(sourceText)) {
    return {
      title: 'Fireworks',
      summary: 'Cutscene firework helper. Use it to support intro or celebration presentation on tracks that rely on a GP-only firework cue.',
      tips: ['Set the pop timing against the intro camera sequence instead of tuning it blind from free camera.', 'Treat this as presentation timing, not gameplay collision or route logic.'],
    };
  }
  if (/(^|\s)(leaf_effect)(\s|$)/.test(sourceText)) {
    return {
      title: 'Leaf Effect',
      summary: 'Leaf-drive effect helper. Use it when players should kick up leaves while driving or flying through a foliage-heavy section.',
      tips: ['Place it where the player can actually intersect the foliage zone instead of treating it as a distant decoration.', 'Check the slot and surrounding scene effects so the leaf burst reads cleanly and does not get lost in other particles.'],
    };
  }
  if (/(^|\s)(starring)(\s|$)/.test(sourceText)) {
    return {
      title: 'Launch Star',
      summary: 'Rainbow Road launch-star helper. Use it when the course geometry and presentation are designed around a dramatic launch transition.',
      tips: ['Align it with the intended player approach and landing arc before treating the setup as finished.', 'Check the surrounding visuals so the launch star reads as a deliberate focal point rather than a loose prop.'],
    };
  }
  if (/(^|\s)(steam)(\s|$)/.test(sourceText)) {
    return {
      title: 'Steam Effect',
      summary: 'Toad’s Factory steam burst effect. Use it to add readable hazard atmosphere around machinery with a clear delay and pulse rhythm.',
      tips: ['Tune delay, burst length, and repeat spacing together instead of editing them one at a time.', 'Keep the effect near the machine or lane it is supposed to sell so the particle timing makes visual sense.'],
    };
  }
  if (/(^|\s)(alarm)(\s|$)/.test(sourceText)) {
    return {
      title: 'Toad Factory Alarm',
      summary: 'Factory alarm effect helper. Use it as presentation support for moving machinery, hazard timing, or industrial setpieces.',
      tips: ['Place it where the visual source of the alarm is obvious instead of treating it as generic ambience.', 'Pair it with the relevant machine or hazard cycle so the alarm feels motivated.'],
    };
  }
  if (/(^|\s)(koopafigure64)(\s|$)/.test(sourceText)) {
    return {
      title: 'Bowser Statue',
      summary: 'Bowser’s Castle statue hazard. Use it when you want proximity-based flame breathing with visible warning space before the player commits.',
      tips: ['Set the activation distance and start delay together so the statue reads early instead of firing unfairly into the player path.', 'Check the target lane from the racing line; this hazard is about readable timing, not just visual scale.'],
    };
  }
  if (/(^|\s)(aurora)(\s|$)/.test(sourceText)) {
    return {
      title: 'Moving Aurora',
      summary: 'Rainbow Road moving setpiece strip. Use it as part of the stage presentation while respecting its fixed transform behavior.',
      tips: ['Because it cannot be rotated or scaled, treat placement and surrounding scene composition as the real setup work.', 'Check it in motion against the rest of the Rainbow Road backdrop so the movement reads intentional.'],
    };
  }
  if (/(^|\s)(boble)(\s|$)/.test(sourceText)) {
    return {
      title: 'Lava Bubble',
      summary: 'Route-driven lava bubble hazard. Use it when you want a simple bouncing fire threat with readable timing and spacing.',
      tips: ['Keep the route and start speed simple so the jump rhythm reads clearly from the player line.', 'If you flip the model behavior, verify the result from multiple camera angles so the motion still reads naturally.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(seagull|bird)(\s|$)/.test(sourceText)) {
    return {
      title: 'Flying Flock',
      summary: 'Route-following flying wildlife. Use it to add motion to the sky space without turning it into a distracting gameplay threat.',
      tips: ['Keep the path clean and readable against the skybox so the flock motion supports the scene instead of looking erratic.', 'Use modest counts; repeated flying silhouettes become visual noise quickly.'],
      routeLabel: 'Flight Path',
    };
  }
  if (/(^|\s)(cruiserr)(\s|$)/.test(sourceText)) {
    return {
      title: 'Route Boat',
      summary: 'Route-following boat setpiece. Use it to add readable trackside motion or moving water traffic without crowding the race line.',
      tips: ['Check the boat from the main approach angle so its speed feels intentional rather than random background drift.', 'Use top or ortho view to keep the full route away from obvious shoreline clipping or collision confusion.'],
      routeLabel: 'Boat Path',
    };
  }
  if (/(^|\s)(fallbsa|fallbsb|fall_mh|fall_y)(\s|$)/.test(sourceText)) {
    return {
      title: 'Waterfall Effect',
      summary: 'Waterfall particle helper. Use it to reinforce large moving water setpieces where the visual flow needs extra depth beyond the model alone.',
      tips: ['Place the effect along the visible flow volume, not just at the source, so the full waterfall reads convincingly.', 'Match any effect variant to the surrounding waterfall asset set before finalizing the scene.'],
    };
  }
  if (/(^|\s)(envsnow)(\s|$)/.test(sourceText)) {
    return {
      title: 'Snow Effect',
      summary: 'Global snow presentation helper. Use it when the track slot and surrounding scene are meant to carry an active snow effect.',
      tips: ['Treat this as a slot-and-scene effect, not as a local prop you can tune with placement alone.', 'Check the snow density against other particles so the course stays readable in motion.'],
    };
  }
  if (/(^|\s)(flash_l|flash_b|flash_w|flash_m|flash_s)(\s|$)/.test(sourceText)) {
    return {
      title: 'Audience Flash',
      summary: 'Crowd camera-flash effect helper. Use it to reinforce tricks, ambience cues, or crowd reactions around a spectacle-heavy section.',
      tips: ['Keep the effect near the intended audience zone or stadium setpiece so the flashes feel connected to the crowd.', 'If you use a variant-selecting flash object, match the chosen variant to the surrounding venue assets.'],
    };
  }
  if (/(^|\s)(itembox|f_itembox|s_itembox|w_itembox|sin_itembox|w_itemboxline)(\s|$)/.test(sourceText)) {
    return {
      title: 'Item Box',
      summary: 'Standard pickup object. Place it where racers can clearly drive through it, then use surface snap to settle it onto the course surface.',
      tips: ['Item boxes do not need a movement path.', 'Use duplicate and multi-select tools to lay out repeated box patterns quickly.'],
      variantLabel: 'Box Type',
    };
  }
  if (/(^|\s)(sound_mii)(\s|$)/.test(sourceText)) {
    return {
      title: 'Crowd Sound',
      summary: 'Ambient audience sound source. Place it near spectator spaces so the audio presence matches what the player sees in that part of the course.',
      tips: ['Keep it off the racing surface and near the crowd or set-piece it is meant to support.', 'Its sound range comes from the assigned route, so set the Sound Range path first and shape that route around the spectator zone instead of the racing line.'],
      cautions: ['Treat this as support for nearby crowd or Mii-themed scenery, not as a general-purpose hazard or obstacle.', 'Vanilla Mario Kart Wii only uses this object on slots 1.1 and 3.1.'],
      routeLabel: 'Sound Range',
    };
  }
  if (/(^|\s)(sound_river|sound_water_fall|sound_lake|sound_big_fall|sound_sea|sound_fountain|sound_volcano|sound_audience|sound_big_river|sound_sand_fall|sound_lift)(\s|$)/.test(sourceText)) {
    return {
      title: 'Ambient Sound',
      summary: 'Route-driven sound emitter. Place it near the visual source and shape the bound route around the space where the audio should feel present.',
      tips: ['Use the Sound Range path below to describe where the effect should be heard instead of dropping the object directly on the racing line.', 'Check the sound source against the surrounding scenery so the route length and placement match what the player sees.'],
      cautions: ['Most vanilla sound objects are slot-dependent, so verify the target slot before relying on them for critical ambience.', 'These are support objects, not hazards or collision props. Keep them out of the player path unless you deliberately want them visible.'],
      routeLabel: 'Sound Range',
    };
  }
  if (/(^|\s)(koopaball)(\s|$)/.test(sourceText)) {
    return {
      title: 'Bowser Fireball',
      summary: 'Rolling hazard projectile. Place it where the player can recognize the threat path early and still react with a clear line choice.',
      tips: ['Check the hazard from the racing line so it reads before the player is committed.', 'Use top or ortho view to keep enough room around the projectile path for fair avoidance.'],
      cautions: ['Avoid combining rolling projectile hazards with blind corners, forced landings, or crowded obstacle stacks where their motion becomes hard to read.', 'This object depends on the Bowser Castle airship asset set and is only known to work on slot 6.2 in vanilla Mario Kart Wii.'],
      routeLabel: 'Projectile Path',
    };
  }
  if (/(^|\s)(sunds)(\s|$)/.test(sourceText)) {
    return {
      title: 'Angry Sun',
      summary: 'Route-driven overhead hazard. Place it where the player can read the drop path and the waiting time between attacks before the section becomes too busy.',
      tips: ['Use the movement path below to shape where the sun pauses and where it drops hazards.', 'Top or ortho view is the fastest way to verify that the sun stays over the intended section of track.'],
      cautions: ['This object is only known to work on a small set of vanilla slots, and its route setting 2 values change whether it waits or drops a FireSnake hazard.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(penguin_s|penguin_m|penguin_l)(\s|$)/.test(sourceText)) {
    return {
      title: 'Penguin',
      summary: 'Sliding wildlife obstacle. Place it where the player can read the occupied space and still react cleanly without mistaking it for background decoration.',
      tips: ['Use top or ortho view to keep enough room around the penguin for a fair line choice.', 'Use the variant switcher below to swap between small, medium, and large penguins without rebuilding the placement.'],
      cautions: ['Avoid hiding penguins in heavy snow clutter, blind crests, or tight wall sections where their collision becomes hard to read.'],
      routeLabel: 'Movement Path',
      variantLabel: 'Penguin Type',
    };
  }
  if (/(^|\s)(basabasa)(\s|$)/.test(sourceText)) {
    return {
      title: 'Swooper',
      summary: 'Flying bat hazard. Place it where the player can identify the flight space early instead of being surprised at the last instant.',
      tips: ['Check the bat from the racing line and from top view so its occupied airspace is obvious.', 'Keep repeated bat groups spaced out enough that each threat remains readable on its own.'],
      cautions: ['Avoid combining flying bat hazards with dark ceilings, tunnel clutter, or stacked moving hazards where the silhouette disappears.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(kuribo|goomba)(\s|$)/.test(sourceText)) {
    return {
      title: 'Goomba',
      summary: 'Basic walking enemy. Keep it on solid ground and away from walls or tiny seams so the obstacle reads cleanly in play.',
      tips: ['Snap it to the collision surface after placement.', 'Duplicate one tuned setup to build repeated enemy groups.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(choropu|choropu2|choropu_ground)(\s|$)/.test(sourceText)) {
    return {
      title: 'Monty Mole',
      summary: 'Pop-up enemy object. Place it on a clear patch of terrain where the attack is easy for the player to read.',
      tips: ['Place it directly on the collision surface.', 'Avoid burying it inside steep banks or decorative geometry.'],
      cautions: ['Vanilla Mario Kart Wii should not mix choropu and choropu2 in the same track because they share the same model resource.'],
      routeLabel: 'Movement Path',
      variantLabel: 'Variant',
    };
  }
  if (/(^|\s)(firesnake|firesnake_v)(\s|$)/.test(sourceText)) {
    return {
      title: 'Podoboo',
      summary: 'Jumping lava hazard. Place it where the player can read the launch and landing space clearly before committing to the line.',
      tips: ['Check the hazard from the racing line and from top view so the landing space stays obvious.', 'Keep enough room around the landing zone that the obstacle pressures the line instead of making the section feel arbitrary.'],
      cautions: ['Avoid stacking jumping lava hazards into blind turns, wall squeezes, or forced landings where the motion becomes unreadable.'],
    };
  }
  if (/(^|\s)(koopafirebar|wlfirebargc|wlfireringgc)(\s|$)/.test(sourceText)) {
    return {
      title: 'Fire Bar',
      summary: 'Rotating hazard. Place it where racers can read the sweep arc early enough to react, especially on narrow lines.',
      tips: ['Check the arc from the racing line, not just from the object center.', 'Use duplicate sparingly; too many sweep hazards in a row become visual noise quickly.'],
      cautions: ['Avoid placing fire bars where their sweep overlaps blind turns, boost landings, or forced-motion sections.'],
      variantLabel: 'Fire Bar Type',
    };
  }
  if (/(^|\s)(heyhoshipgba|heyhoballgba|heyhotreegbac)(\s|$)/.test(sourceText)) {
    return {
      title: 'Shy Guy Obstacle',
      summary: 'Trackside hazard object. Place it where the player can identify the obstacle behavior early and still make a clean steering choice.',
      tips: ['Check the obstacle from the racing line and from top or ortho view to verify spacing.', 'Use the variant switcher below to swap between the common Shy Guy obstacle styles without replacing the placement.'],
      cautions: ['Do not stack multiple busy hazards into the same short reaction window; these obstacles work best when their threat is visually distinct.'],
      routeLabel: entity.objectId === 0x0ce ? 'Flight Path' : undefined,
      variantLabel: 'Obstacle Type',
    };
  }
  if (/(^|\s)(heyho2)(\s|$)/.test(sourceText)) {
    return {
      title: 'Ski Lift',
      summary: 'Chairlift manager from DK Summit. Assign a path first, then tune the chairlift model while checking the moving line from the player route.',
      tips: ['Use the movement path field below to bind the lift to a full loop before adjusting anything else.', 'Check the line from top or ortho view so the lift spacing stays readable over the course section below.'],
      cautions: ['This is not a roaming ground enemy. It manages a moving chairlift setpiece, so ground-level Shy Guy assumptions do not apply here.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(heyho)(\s|$)/.test(sourceText)) {
    return {
      title: 'Shy Guy',
      summary: 'Small roaming obstacle. Place it where the player can identify the occupied space clearly without losing the route to clutter.',
      tips: ['Check the placement from the racing line so the obstacle reads early enough to steer around.', 'Use the variant switcher below to swap between the common Shy Guy styles without replacing the setup.'],
      cautions: ['Avoid dropping small roaming hazards into already busy line checks where players cannot distinguish them from scenery quickly enough.'],
      routeLabel: 'Movement Path',
      variantLabel: 'Shy Guy Type',
    };
  }
  if (/(^|\s)(woodbox|w_woodbox|bblock)(\s|$)/.test(sourceText)) {
    return {
      title: 'Breakable Box',
      summary: 'Simple breakable obstacle. Place it where it adds line pressure or decoration without turning the route into clutter.',
      tips: ['Use duplicate and multi-select to lay out repeated box groups quickly.', 'Check spacing from the racing line so the box reads as a choice, not random collision noise.'],
      cautions: ['Avoid stacking boxes so tightly that players cannot read which ones are solid threats and which lines remain open.'],
      variantLabel: 'Box Type',
    };
  }
  if (/(^|\s)(mashballoongc|castleballoon1|mii_balloon)(\s|$)/.test(sourceText)) {
    return {
      title: 'Balloon Hazard',
      summary: 'Large floating obstacle prop. Place it where it shapes the player line clearly without turning the route into visual clutter.',
      tips: ['Check the balloon from both the racing line and top view so its footprint is obvious.', 'Use scale and duplicate carefully; large floating props can dominate the scene quickly.'],
      cautions: ['Keep oversized floating hazards away from blind landings, cannons, and spawn zones so they do not create unreadable collisions.'],
      routeLabel: 'Flight Path',
    };
  }
  if (/(^|\s)(dossun|dossunc|dossunc_soko|kdossunc)(\s|$)/.test(sourceText)) {
    return {
      title: 'Thwomp',
      summary: 'Large crushing hazard. Place it where the player can read the drop zone early and still make a deliberate steering decision.',
      tips: ['Check the hazard from the racing line and from top view so its occupied space is obvious.', 'Leave enough lateral room that the player has a readable safe option instead of a blind guess.'],
      cautions: ['Avoid stacking multiple drop hazards into the same short reaction window or placing them immediately after forced landings.'],
      variantLabel: 'Thwomp Type',
    };
  }
  if (/(^|\s)(sanbo|sanbo_big)(\s|$)/.test(sourceText)) {
    return {
      title: 'Pokey',
      summary: 'Tall desert hazard. Place it where the player can identify its occupied space clearly without blocking the whole route.',
      tips: ['Use the larger variants sparingly; they dominate narrow sections quickly.', 'Check from top or ortho view to keep enough room around the hazard for clean line choices.'],
      cautions: ['Do not bury Pokey variants in cluttered scenery where their hit space becomes hard to read.'],
      routeLabel: 'Movement Path',
      variantLabel: 'Pokey Type',
    };
  }
  if (/(^|\s)(cow)(\s|$)/.test(sourceText)) {
    return {
      title: 'Cow',
      summary: 'Large wandering obstacle. Place it where the player can read the occupied space early and still make a deliberate steering choice around it.',
      tips: ['Check the obstacle from the racing line and from top view so the footprint is obvious.', 'Use duplicate sparingly; repeated large animals can clutter the route quickly.'],
      cautions: ['Avoid placing cows on blind crests, in narrow wall channels, or inside other busy hazards where their body space becomes hard to judge.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(pylon01)(\s|$)/.test(sourceText)) {
    return {
      title: 'Traffic Cone',
      summary: 'Reactive road cone from Daisy Circuit. Use it to shape line pressure without turning the route into clutter.',
      tips: ['Check cone spacing from the racing line so the obstacle reads as a clear steering choice instead of visual noise.', 'Use the start and sleep timing below carefully so the cone behavior matches the traffic pattern you want instead of spamming the start grid.'],
      cautions: ['This object is slot-restricted in vanilla Mario Kart Wii and too many effect-heavy cones near the start can cause major slowdown.'],
    };
  }
  if (/(^|\s)(karehayama)(\s|$)/.test(sourceText)) {
    return {
      title: 'Tumbleweed',
      summary: 'Rolling desert obstacle. Place it where the player can read the crossing space early instead of discovering it at the last instant.',
      tips: ['Check the hazard from the racing line and from top or ortho view so the crossing space stays obvious.', 'Leave enough room on both sides that the player can make a clean avoidance choice instead of a blind guess.', 'Use the item controls below only when you deliberately want the tumbleweed pile to hand out an item when hit.'],
      cautions: ['Avoid dropping tumbleweeds into blind crests, narrow wall channels, or stacked hazard sections where the moving footprint becomes hard to read.'],
    };
  }
  if (/(^|\s)(quicksand)(\s|$)/.test(sourceText)) {
    return {
      title: 'Quicksand',
      summary: 'Area-style terrain hazard. Place it where the player can read the trap space clearly and still understand the intended safe line around it.',
      tips: ['Check the footprint from top or ortho view so the dangerous area is obvious before turn-in.', 'Keep enough clear ground nearby that the hazard pressures a line choice instead of feeling unavoidable.'],
      cautions: ['Avoid hiding quicksand inside heavy terrain clutter, under jumps, or immediately after blind landings where players cannot read the trap in time.'],
    };
  }
  if (/(^|\s)(volcanoball1)(\s|$)/.test(sourceText)) {
    return {
      title: 'Volcano Rock',
      summary: 'Route-driven falling fireball hazard. Bind it to a route and keep its route points close together so the motion stays stable in-game.',
      tips: ['Check the full path from the racing line and from top view so the fireball reads early and the landing space stays fair.', 'Keep route points relatively close together; long gaps can break this object badly in vanilla Mario Kart Wii.'],
      cautions: ['Avoid spawning volcano rocks into blind landings or cramped walls where the player cannot read the incoming threat before contact.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(m_obj_jump|m_obj_s_jump|m_obj_s_jump2|m_obj_jump2|m_obj_start)(\s|$)/.test(sourceText)) {
    return {
      title: 'Jump Pad',
      summary: 'Launch ramp object. Place it where the player can read the takeoff and landing line cleanly before committing to the jump.',
      tips: ['Check the object from the racing line and from top or ortho view so the takeoff angle stays readable.', 'Use surface snap and rotation together so the pad sits cleanly on the intended approach surface.'],
      cautions: ['Avoid pointing jump pads into blind landings, walls, or stacked hazards where the forced motion becomes unreadable.'],
      variantLabel: 'Jump Type',
    };
  }
  if (/(^|\s)(stargate)(\s|$)/.test(sourceText)) {
    return {
      title: 'Star Gate',
      summary: 'Drive-through gate prop. Place it where the player can identify the gate opening cleanly from the racing line instead of clipping it at the last second.',
      tips: ['Check the gate from the racing line and from top or ortho view so the opening stays centered on the intended route.', 'Use rotation controls to line the gate up with the approach instead of forcing a late steering correction.'],
      cautions: ['Avoid stacking gates into blind jumps, wall squeezes, or busy scenery where the opening becomes hard to read.'],
    };
  }
  if (/(^|\s)(casino_roulette)(\s|$)/.test(sourceText)) {
    return {
      title: 'Roulette Platform',
      summary: 'World-center rotating terrain gimmick. Use it only when the entire course setup is designed around a roulette-style moving floor.',
      tips: ['Keep the object at the world center and verify the route from top or ortho view before committing to the gimmick.', 'Check player, item, and respawn behavior carefully; rotating terrain changes how the whole section plays, not just the visible model.'],
      cautions: ['Do not treat this like a normal decorative prop. If the track layout is not built around rotating terrain, the result will be confusing or broken in play.'],
    };
  }
  if (/(^|\s)(rm_ring1)(\s|$)/.test(sourceText)) {
    return {
      title: 'Driveable Ring',
      summary: 'Galaxy Colosseum ring object. Set which ring it controls, then tune the shake and fall timing so the gimmick is readable in play.',
      tips: ['Use top or ortho view to verify which ring zone this object is meant to control.', 'Keep enough warning time before the ring falls that players can understand what is happening and react deliberately.'],
      cautions: ['Avoid using ring fall timing that triggers immediately without readable shake time, especially near jumps or forced-motion sections.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(hp_pipe)(\s|$)/.test(sourceText)) {
    return {
      title: 'Half-Pipe Trigger',
      summary: 'Half-pipe style trigger object. Place it only where the surrounding course geometry and player approach are built for trick-wall movement.',
      tips: ['Check the approach and exit from the racing line so the player can read the half-pipe entry early.', 'Use dev or top view to make sure the trigger sits exactly where the intended wall-riding section begins.'],
      cautions: ['Avoid dropping half-pipe triggers into ordinary ground sections or cluttered scenery where players cannot tell why their movement changed.'],
    };
  }
  if (/(^|\s)(utsubodokan)(\s|$)/.test(sourceText)) {
    return {
      title: 'Pipe Hazard',
      summary: 'Large pop-out hazard. Place it where the player can read the occupied space early and still understand the safe line around it.',
      tips: ['Check the hazard from the racing line and from top or ortho view so the footprint is obvious.', 'Leave enough lateral room that the player has a deliberate avoidance path instead of a blind guess.'],
      cautions: ['Avoid hiding large pop-out hazards in tunnel clutter, behind walls, or immediately after blind landings where the threat appears too late.'],
    };
  }
  if (/(^|\s)(honeball)(\s|$)/.test(sourceText)) {
    return {
      title: 'Rolling Ball',
      summary: 'Moving hazard ball. Place it where the player can read the crossing path and react with a clean line choice before contact.',
      tips: ['Check the hazard from the racing line and from top view so the crossing path is easy to understand.', 'This object is mission-style logic; its placement point does not matter and it behaves around a CPU target instead of following normal track-space authoring assumptions.'],
      cautions: ['Avoid mixing rolling-ball hazards into blind corners, wall squeezes, or stacked moving hazards where the motion path becomes unreadable.', 'For mission use, define exactly one CPU or the behavior becomes unreliable.'],
    };
  }
  if (/(^|\s)(epropeller)(\s|$)/.test(sourceText)) {
    return {
      title: 'Electric Propeller',
      summary: 'Rotating hazard from Koopa Cape. Set the spin speed and direction so the obstacle reads clearly from the player approach.',
      tips: ['Check the propeller from the racing line so the blade timing is readable before the player commits.', 'Use top or ortho view to verify the propeller sits centered on the intended corridor instead of clipping nearby walls.'],
      cautions: ['Very fast propeller timing can become unreadable in narrow channels. Use the slowdown factor only when you deliberately target LE-CODE behavior.'],
    };
  }
  if (/(^|\s)(pile)(\s|$)/.test(sourceText)) {
    return {
      title: 'Pylon Obstacle',
      summary: 'Simple course obstacle. Place it where it shapes the line clearly without turning the route into clutter.',
      tips: ['Use duplicate and multi-select to build repeated obstacle rows quickly.', 'Check spacing from the racing line so the obstacle reads as a clear steering choice.'],
      cautions: ['Avoid stacking too many small blockers into one short reaction window where the route becomes noisy instead of readable.'],
    };
  }
  if (/(^|\s)(poihana)(\s|$)/.test(sourceText)) {
    return {
      title: 'Cataquack',
      summary: 'Line-disrupting enemy. Place it where the player can read the approach early and still understand where the safe space is around the attack zone.',
      tips: ['Check the enemy from the racing line so its occupied zone is readable before turn-in.', 'Leave enough lateral room that the player has a deliberate avoidance option instead of a blind guess.'],
      cautions: ['Avoid stacking Cataquacks into already crowded hazard sections where their push threat becomes visually ambiguous.'],
    };
  }
  if (/(^|\s)(envfire|flamepole|flamepole_v|flamepole_v_big)(\s|$)/.test(sourceText)) {
    return {
      title: 'Flame Jet',
      summary: 'Stationary fire hazard. Place it where the player can recognize the threat early and still make a deliberate line choice.',
      tips: ['Use dev, top, or ortho view to check that the flame sits cleanly on the intended side of the route.', 'Leave enough lateral room that the hazard pressures the line instead of making the section feel arbitrary.'],
      cautions: ['Avoid hiding flame hazards behind walls, props, or terrain crests where the player cannot read the danger before committing.'],
      variantLabel: 'Flame Type',
    };
  }
  if (/(^|\s)(pakkun_f|puchi_pakkun|pakkun_dokan)(\s|$)/.test(sourceText)) {
    return {
      title: 'Piranha Plant',
      summary: 'Stationary hazard. Use it to pressure a line choice or defend a narrow space without hard-blocking the whole track.',
      tips: ['Leave enough steering room around the hazard.', 'Open Advanced object data only when you need non-default behavior.'],
      variantLabel: 'Variant',
    };
  }
  if (/(^|\s)(crab)(\s|$)/.test(sourceText)) {
    return {
      title: 'Crab',
      summary: 'Small moving obstacle. Keep it on visible ground where it reads as a hazard instead of visual clutter.',
      tips: ['Avoid placing crab objects flush against walls.', 'Duplicate a placed crab to make consistent obstacle groups.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(insekia|insekib|dkrockgc|volcanorock1)(\s|$)/.test(sourceText)) {
    return {
      title: 'Falling Rock',
      summary: 'Hazard prop that needs its object data configured before it is safe to use on a vanilla track.',
      tips: ['Place it where the player can read the threat early.', 'Open Advanced object data if you need to tune its raw behavior values.'],
      cautions: ['Vanilla Mario Kart Wii is known to crash if InsekiA or InsekiB keeps Setting 3 at 0.'],
    };
  }
  if (/(^|\s)(press|press_soko)(\s|$)/.test(sourceText)) {
    return {
      title: 'Crusher',
      summary: 'Heavy timing hazard. Place it where the player can see the cycle early enough to react instead of being surprised at the last second.',
      tips: ['Check the hazard from the racing line, not just from free camera angles.', 'Use dev view or top view to make sure the crusher clears nearby walls and props cleanly.'],
      cautions: ['Avoid placing crushers flush against blind corners or decorative ceilings where the timing becomes hard to read.'],
    };
  }
  if (/(^|\s)(hwanwan|wanwan|twanwan|twanwan_ue)(\s|$)/.test(sourceText)) {
    return {
      title: 'Chain Chomp',
      summary: 'Large moving hazard. Give it visible approach space and enough room around the racing line so the threat reads clearly before contact.',
      tips: ['Place it where the player can identify the danger from a distance.', 'Use duplication sparingly; repeated large hazards can clutter the line quickly.'],
      cautions: ['Keep large hazards away from spawn zones, cannons, and other forced-motion sections so they do not create unreadable failures.'],
      routeLabel: 'Movement Path',
      variantLabel: 'Chomp Type',
    };
  }
  if (/(^|\s)(b_teresa|bgteresasfc)(\s|$)/.test(sourceText)) {
    return {
      title: 'Boo',
      summary: 'Floating ghost obstacle. Place it where the player can clearly read the occupied airspace without mistaking it for background ambience.',
      tips: ['Check the hazard from the racing line and from dev or top view so the height and footprint stay readable.', 'The SNES Ghost Valley Boo variant is controlled by AREA type 07 and the object position itself does not drive the visible path; set the AREA up first.', 'Use the variant switcher below to swap between the common Boo variants without rebuilding the placement.'],
      cautions: ['Avoid hiding ghost obstacles in dark scenery, tunnel clutter, or overlapping particle-heavy set pieces where their silhouette disappears.', 'The SNES Ghost Valley Boo cannot go below Y=3000, and the background Boo variant looks best with scale values around 3 to 4.'],
      variantLabel: 'Boo Type',
    };
  }
  if (/(^|\s)(hanachan|bosshanachan|bosshanachanhead)(\s|$)/.test(sourceText)) {
    return {
      title: 'Wiggler',
      summary: 'Large caterpillar hazard. Place it where the player can recognize the body space and react before the section becomes crowded.',
      tips: ['Use top or ortho view to keep enough room around the hazard for clear racing lines.', 'Use the variant switcher below to swap between regular and boss variants without replacing the placement.'],
      cautions: ['Avoid dropping large body-style hazards into narrow sections, blind crests, or cluttered scenery where their footprint becomes unreadable.'],
      routeLabel: 'Movement Path',
      variantLabel: 'Wiggler Type',
    };
  }
  if (/(^|\s)(begoman_manager|begoman_spike)(\s|$)/.test(sourceText)) {
    return {
      title: 'Spinner Hazard',
      summary: 'Rotating hazard object. Place it where the player can read the spin zone early and still make a clean line choice around it.',
      tips: ['Check the occupied space from the racing line and from top view so the hazard footprint is obvious.', 'Use the variant switcher below to move between the common spinner variants without rebuilding the setup.'],
      cautions: ['Avoid stacking rotating hazards into boost landings, blind corners, or cramped walls where the spin zone becomes unreadable.', 'The spawned Topman variant only works on specific slots, and it must be the first placed game object to appear at all.'],
      variantLabel: 'Spinner Type',
    };
  }
  if (/(^|\s)(escalator|escalator_group|belteasy|beltcrossing|beltcurvea|beltcurveb|belt|bulldozer_left|bulldozer_right|townbridgedsc|venice_hasi)(\s|$)/.test(sourceText)) {
    return {
      title: 'Moving Terrain Helper',
      summary: 'Moving-terrain support object. Use it to define how surrounding KCL or slot-specific motion behaves, then verify the setup from both player view and top view.',
      tips: ['Check the related moving-road or moving-terrain collision first; several of these objects do not use a POTI route at all.', 'Use the object position, rotation, and nearby KCL as the main setup controls before you touch advanced fields.'],
    };
  }
  if (/(^|\s)(k_sticklift00|kinoko_lift1|kinoko_ud|kinoko_bend|kinoko_nm|kinoko_kuki|pendulum|dkship64|dkturibashigcc|dkmarutagcc|crane|venice_gondola|twistedway|dkfalls)(\s|$)/.test(sourceText)) {
    return {
      title: 'Moving Platform',
      summary: 'Route-driven moving object. Assign a path first, then verify the motion from the player line and from top or ortho view.',
      tips: ['Use the path field below to bind the object to a route.', 'Leave route visibility on while setting movement up, then hide it again from the viewport eye menu.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(cara1|cara2|cara3|carb|car_body|truckwagon|k_bomb_car|k_bomb_car1|kart_truck)(\s|$)/.test(sourceText)) {
    return {
      title: 'Traffic Vehicle',
      summary: 'Route-driven vehicle hazard. Bind it to a path, then check its motion from the racing line so it reads early and stays fair.',
      tips: ['Use the traffic path field below to create, bind, or jump to its route.', 'Top or ortho view is the fastest way to clean up long traffic paths.'],
      cautions: ['Keep traffic well clear of walls, decorative props, and blind corners so collisions stay readable in play.'],
      routeLabel: 'Traffic Path',
      variantLabel: 'Vehicle Type',
    };
  }
  if (/(^|\s)(tree_cannon|donkycannongc|donkycannon_wii|donkycannon|cannon)(\s|$)/.test(sourceText)) {
    return {
      title: 'Cannon Object',
      summary: 'Launch object. Place it with the intended player approach in mind and verify its facing from the main 3D view.',
      tips: ['Use rotation controls to verify launch direction.', 'Keep the entry area visually clear so the cannon reads immediately.'],
      cautions: ['This object is only the visible cannon prop. The actual launch behavior still depends on cannon points and matching cannon-trigger collision.'],
    };
  }
  if (/(^|\s)(npc_mii|shmiiobj|dk_miiobj|miiobjd|mare_a|mare_b|miiposter)(\s|$)/.test(sourceText)) {
    const daisyCrowd = entity.objectId === 0x2e8 || entity.objectId === 0x2e9 || entity.objectId === 0x2ea;
    return {
      title: 'Mii Spectator',
      summary: 'Decorative crowd object. Use it to add life to spectator spaces without interfering with track collision or racing lines.',
      tips: ['These are best placed off the main racing surface.', 'Duplicate one placement to build crowd clusters quickly.', 'The Noki spectator variants below can face the player and clap when you tune their distance settings.'],
      cautions: daisyCrowd ? ['These Daisy Circuit crowd variants are limited to one instance each in vanilla Mario Kart Wii; more than one can crash the game.'] : undefined,
      variantLabel: 'Crowd Variant',
    };
  }

  return {
    title: flow?.name || flow?.resources || fallbackObjectName(entity.objectId),
    summary: 'Base-game object. Use placement, rotation, scale, path binding, and collision snap from the main inspector tools first.',
    tips: ['Only open Advanced object data when you need non-default behavior.', 'Use duplication and multi-select for repeated placements.'],
    routeLabel: entity.routeIndex !== undefined ? 'Path' : undefined,
  };
}

function fallbackObjectName(objectId: number): string {
  return getKnownObjectName(objectId) ?? `Unknown object ${objectId}`;
}

function getObjectVariantOptions(profile: ObjectInspectorProfile, objectOptions: ObjectOption[]): ObjectOption[] {
  let variantIds: number[] = [];
  switch (profile.title) {
    case 'Item Box':
      variantIds = [0x65, 0x76, 0xc9, 0xd4, 0xee, 0xd5];
      break;
    case 'Monty Mole':
      variantIds = [0x192, 0x19a, 0x1a0];
      break;
    case 'Fire Bar':
      variantIds = [0x195, 0x1a1, 0x1a5];
      break;
    case 'Chain Chomp':
      variantIds = [0xe9, 0xeb, 0xef, 0x196];
      break;
    case 'Shy Guy Obstacle':
      variantIds = [0xce, 0xea, 0x14a];
      break;
    case 'Shy Guy':
      variantIds = [0x19c];
      break;
    case 'Breakable Box':
      variantIds = [0x70, 0xd3];
      break;
    case 'Thwomp':
      variantIds = [0xdb, 0xdc, 0xf1, 0x162];
      break;
    case 'Pokey':
      variantIds = [0x199, 0x1ab, 0x1ac];
      break;
    case 'Penguin':
      variantIds = [0xd7, 0xd8, 0xd9];
      break;
    case 'Boo':
      variantIds = [0x18c, 0x18f];
      break;
    case 'Piranha Plant':
      variantIds = [0x194, 0x1a2, 0x1aa];
      break;
    case 'Flame Jet':
      variantIds = [0x2ee, 0x1fd, 0x212, 0x216];
      break;
    case 'Jump Pad':
      variantIds = [0x20f, 0x213, 0x21a, 0x21b, 0x2f0];
      break;
    case 'Wiggler':
      variantIds = [0xe2, 0xf0, 0xf2];
      break;
    case 'Mii Spectator':
      variantIds = [0x139, 0x13a, 0x13b, 0x167, 0x168, 0x169, 0x16b, 0x16c, 0x2e8, 0x2e9, 0x2ea, 0x2eb, 0x2ec];
      break;
    case 'Spinner Hazard':
      variantIds = [0x16, 0x1a3];
      break;
    case 'Traffic Vehicle':
      variantIds = [0xcc, 0xd0, 0xd1, 0xde, 0xe7, 0xe8, 0xf3, 0x181, 0x19b];
      break;
    default:
      return [];
  }
  const byId = new Map(objectOptions.map((option) => [option.id, option]));
  return variantIds
    .map((id) => byId.get(id))
    .filter((option): option is ObjectOption => option !== undefined);
}

function setMaskedBits(value: number, mask: number, enabled: boolean): number {
  return enabled ? value | mask : value & ~mask;
}

function decodeWrappedSpin(value: number): { direction: number; speed: number } {
  if (value <= 0x7fff) return { direction: 1, speed: value };
  return { direction: 0, speed: 0x10000 - value };
}

function encodeWrappedSpin(speed: number, direction: number): number {
  const clampedSpeed = Math.max(0, Math.min(0xffff, Math.trunc(speed)));
  if (clampedSpeed === 0) return 0;
  return direction === 0 ? (0x10000 - clampedSpeed) & 0xffff : clampedSpeed;
}

function decodeSigned16(value: number): number {
  return value >= 0x8000 ? value - 0x10000 : value;
}

function encodeSigned16(value: number): number {
  const clamped = Math.max(-0x8000, Math.min(0x7fff, Math.trunc(value)));
  return clamped < 0 ? clamped + 0x10000 : clamped;
}

function describePresenceFlags(value: number): string {
  const activeLabels = gobjPresenceModeOptions.filter((option) => (value & option.mask) !== 0).map((option) => option.label);
  const lowBits = value & 0x0007;
  const summary = activeLabels.length > 0 ? activeLabels.join(', ') : 'Hidden in all player-count modes';
  return `${summary} (${formatPresenceFlagsHex(value)}${value !== lowBits ? ` behaves like ${formatPresenceFlagsHex(lowBits)} in vanilla MKWii` : ''})`;
}

function formatPresenceFlagsHex(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

function presentValidationIssue(message: string): { summary: string; detail?: string } {
  if (message === 'course_model.brres is missing.') return { summary: 'The course model is missing.', detail: 'Exported tracks need course geometry to render in-game.' };
  if (message === 'course.kmp is missing.') return { summary: 'The track data file is missing.', detail: 'The course cannot load gameplay objects, paths, or start data without course.kmp.' };
  if (message === 'course.kcl is missing; snapping and collision overlay are unavailable.') return { summary: 'Collision data is missing.', detail: 'Surface snapping and collision-based editing will not work until the track collision data is present.' };
  if (message === 'No start position is defined.') return { summary: 'No player start position is set.' };
  if (message === 'Checkpoints are missing.') return { summary: 'No checkpoints are set.' };
  if (message === 'Respawn points are missing.') return { summary: 'No respawn points are set.', detail: 'Lakitu recoveries will not have a valid place to send the player.' };
  if (message === 'Enemy route points exist without enemy path groups.') return { summary: 'Enemy routes are incomplete.', detail: 'Enemy route points exist, but they are not grouped into usable path sections.' };
  if (message === 'Item route points exist without item path groups.') return { summary: 'Item routes are incomplete.', detail: 'Item route points exist, but they are not grouped into usable path sections.' };
  if (message === 'Checkpoints exist without checkpoint path groups.') return { summary: 'Checkpoint groups are incomplete.', detail: 'The checkpoints exist, but their path-group structure is missing.' };
  if (message.includes('groups cover') && message.includes('points.')) return { summary: 'A route group does not cover all of its points.', detail: message };
  if (message.includes('has points but no path connections.')) return { summary: 'A route has points but no connections.', detail: message };
  if (message.includes('appears disconnected')) return { summary: 'A route appears disconnected.', detail: message };
  if (message.includes('intro start references missing camera')) return { summary: 'The intro camera start is invalid.', detail: message };
  if (message.includes('selection start references missing camera')) return { summary: 'The selection camera start is invalid.', detail: message };
  if (message.startsWith('Checkpoint ') && message.includes('references missing respawn point')) return { summary: 'A checkpoint points to a respawn that does not exist.', detail: message };
  if (message.startsWith('Checkpoint ') && message.includes('references missing previous checkpoint')) return { summary: 'A checkpoint previous-link is invalid.', detail: message };
  if (message.startsWith('Checkpoint ') && message.includes('references missing next checkpoint')) return { summary: 'A checkpoint next-link is invalid.', detail: message };
  if (message.startsWith('Object ') && message.includes('requires a route')) return { summary: 'A route-driven object is missing its route.', detail: message };
  if (message.startsWith('Object ') && message.includes('references missing route')) return { summary: 'An object points to a route that does not exist.', detail: message };
  if (message.startsWith('Area ') && message.includes('references missing route')) return { summary: 'An area points to a route that does not exist.', detail: message };
  if (message.startsWith('Area ') && message.includes('references missing camera')) return { summary: 'An area points to a camera that does not exist.', detail: message };
  if (message.startsWith('Camera ') && message.includes('references missing route')) return { summary: 'A camera points to a route that does not exist.', detail: message };
  if (message.startsWith('Camera ') && message.includes('references missing next camera')) return { summary: 'A camera chain points to a camera that does not exist.', detail: message };
  if (message === 'Common.szs is not loaded; object resource validation is unavailable.') return { summary: 'Common object data is not loaded.', detail: 'Object resource checks are limited until the shared game asset archive is available.' };
  if (message.includes('has no ObjFlow definition in Common.szs')) return { summary: 'An object type is missing its shared game definition.', detail: 'The shared game object data does not contain a definition for this object type.' };
  if (message.includes('references missing resource')) return { summary: 'An object is missing one of its required model files.', detail: message };
  if (message.includes('is a gameplay object but is hidden for some multiplayer player counts')) return { summary: 'A gameplay object is hidden in some multiplayer modes.', detail: message };
  if (message.includes('unsupported player item-box setting')) return { summary: 'An item box uses an unsupported player-item setting.', detail: message };
  if (message.includes('unsupported CPU item-box setting')) return { summary: 'An item box uses an unsupported CPU-item setting.', detail: message };
  if (message.includes('unsupported item-box timing setting')) return { summary: 'An item box uses an unsupported timing setting.', detail: message };
  if (message.includes('Monty Mole variants choropu and choropu2 are both present')) return { summary: 'Two incompatible Monty Mole variants are mixed together.', detail: message };
  if (message.includes('has Setting 3 left at 0, which is known to crash vanilla Mario Kart Wii')) return { summary: 'A falling rock still uses a crash-prone setting.', detail: message };
  if (message.includes('Daisy Circuit') || message.includes('MiiObjD')) return { summary: 'A Daisy Circuit crowd object is duplicated.', detail: message };
  if (message.includes('slot-restricted objects')) return { summary: 'This track uses objects that only work on certain vanilla slots.', detail: message };
  if (message.includes('begoman_spike must be the first placed game object')) return { summary: 'A Topman hazard is ordered incorrectly.', detail: message };
  return { summary: message };
}

function getKnownObjectName(objectId: number | undefined): string | null {
  if (objectId === undefined) return null;
  const raw = (objectNamesById as Record<string, string>)[String(objectId)];
  if (!raw) return null;
  return humanizeObjectName(raw);
}

function humanizeObjectName(value: string): string {
  const normalized = value
    .trim()
    .replace(/_/g, ' ')
    .replace(/itembox/gi, 'item box')
    .replace(/sticklift/gi, 'stick lift')
    .replace(/firebar/gi, 'fire bar')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d+)/g, '$1 $2')
    .replace(/\s+/g, ' ');
  return normalized
    .split(' ')
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'npc') return 'NPC';
      if (lower === 'mii') return 'Mii';
      if (lower === 'gc' || lower === 'gba' || lower === 'sfc' || lower === 'ds' || lower === 'wii') return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function toSigned16(value: number): number {
  return value & 0x8000 ? value - 0x10000 : value;
}

function toUnsigned16(value: number): number {
  const clamped = Math.max(-0x8000, Math.min(0x7fff, Math.trunc(value)));
  return clamped < 0 ? clamped + 0x10000 : clamped;
}

function shortAssetName(resource: string): string {
  return resource.replace(/\.[^.]+$/, '').replace(/_/g, ' ').slice(0, 18) || 'model';
}

function friendlyTrackAssetName(path: string): string {
  const fileName = path.split('/').pop() ?? path;
  const lower = fileName.toLowerCase();
  if (lower === 'course_model.brres') return 'Course Model';
  if (lower === 'vrcorn_model.brres') return 'Skybox Model';
  if (lower.endsWith('.brres')) return shortAssetName(fileName);
  return fileName;
}

function firstResourceSummary(resources: string[], summaries: Record<string, NoclipBrresSummary>): NoclipBrresSummary | undefined {
  for (const resource of resources) {
    const summary = summaries[resource.toLowerCase()];
    if (summary) return summary;
  }
  return undefined;
}

function describeCourseAsset(asset: PlaceableCourseAssetRecord): string {
  const kindLabel =
    asset.kind === 'sharedObject'
      ? 'shared object'
      : asset.kind === 'course'
        ? 'course mesh'
        : asset.kind === 'skybox'
        ? 'skybox'
          : 'course asset';
  return asset.objectId !== null ? `${kindLabel} · drag to place · ${asset.trackLabel}` : `${kindLabel} · reference only · ${asset.trackLabel}`;
}

function describeBrres(summary: TrackDocument['brresSummaries'][string] | undefined): string {
  if (!summary) return '';
  return `${summary.models.length} models · ${summary.textures.length} textures · ${Object.values(summary.animations).flat().length} animations`;
}

interface PathInfo {
  groupSection: 'ENPH' | 'ITPH' | 'CKPH';
  groupIndex: number;
  groupSize: number;
  localIndex: number;
  prevGroups: number[];
  nextGroups: number[];
}

function getPathInfo(kmp: KmpDocument, entity: KmpEntity): PathInfo | null {
  const graph = kmp.pathGraphs.find((candidate) => candidate.pointSection === entity.section);
  if (!graph) return null;
  const group = graph.groups.find((candidate) => entity.index >= candidate.startIndex && entity.index < candidate.startIndex + candidate.pointCount);
  if (!group) return null;
  return {
    groupSection: graph.groupSection,
    groupIndex: group.index,
    groupSize: group.pointCount,
    localIndex: entity.index - group.startIndex,
    prevGroups: group.prevGroups,
    nextGroups: group.nextGroups,
  };
}

function getReferenceCounts(kmp: KmpDocument | null): ReferenceCounts {
  if (!kmp) return { routes: 0, cameras: 0, enemyPoints: 0, checkpoints: 0, respawns: 0 };
  const sectionCount = (section: string) => kmp.sections.find((candidate) => candidate.name === section)?.count ?? 0;
  return {
    routes: kmp.routes.length || sectionCount('POTI'),
    cameras: sectionCount('CAME'),
    enemyPoints: sectionCount('ENPT'),
    checkpoints: sectionCount('CKPT'),
    respawns: sectionCount('JGPT'),
  };
}
