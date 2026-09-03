/**
 * The section vocabulary shared by the KMP outliner, the viewport visibility filter and the
 * scene overlay. One key per thing a track author thinks of as a "layer" of the track.
 */

/** Visibility keys understood by the viewport overlay builder. */
export type KmpVisibilityKey =
  | 'KTPT'
  | 'ENPT'
  | 'ITPT'
  | 'CKPT'
  | 'GOBJ'
  | 'POTI_OBJECT'
  | 'POTI_CAMERA'
  | 'JGPT'
  | 'AREA'
  | 'CAME'
  | 'CNPT'
  | 'MSPT';

export const KMP_VISIBILITY_KEYS: KmpVisibilityKey[] = [
  'KTPT',
  'ENPT',
  'ITPT',
  'CKPT',
  'GOBJ',
  'POTI_OBJECT',
  'POTI_CAMERA',
  'JGPT',
  'AREA',
  'CAME',
  'CNPT',
  'MSPT',
];

export type KmpVisibilityState = Record<KmpVisibilityKey, boolean>;

export function createVisibilityState(value = true): KmpVisibilityState {
  const state = {} as KmpVisibilityState;
  for (const key of KMP_VISIBILITY_KEYS) state[key] = value;
  return state;
}

/** Outliner sections, in the order they appear in the panel. */
export type KmpOutlinerSectionKey =
  | 'start'
  | 'enemy'
  | 'item'
  | 'checkpoint'
  | 'respawn'
  | 'object'
  | 'route'
  | 'area'
  | 'camera'
  | 'cannon'
  | 'battle'
  | 'stage';

export interface KmpOutlinerSectionMeta {
  key: KmpOutlinerSectionKey;
  /** Panel heading, e.g. "Enemy routes". */
  label: string;
  /** Used in status messages, e.g. "enemy route point". */
  singular: string;
  /** KMP entity-id prefix for the records in this section. */
  entityPrefix: string;
  /** Viewport layers this section's eye toggle controls. Empty means "always drawn". */
  visibility: KmpVisibilityKey[];
  /** Set for the three grouped path sections. */
  pathSection?: 'ENPT' | 'ITPT' | 'CKPT';
}

export const KMP_OUTLINER_SECTIONS: KmpOutlinerSectionMeta[] = [
  { key: 'start', label: 'Start points', singular: 'start point', entityPrefix: 'KTPT', visibility: ['KTPT'] },
  { key: 'enemy', label: 'Enemy routes', singular: 'enemy route point', entityPrefix: 'ENPT', visibility: ['ENPT'], pathSection: 'ENPT' },
  { key: 'item', label: 'Item routes', singular: 'item route point', entityPrefix: 'ITPT', visibility: ['ITPT'], pathSection: 'ITPT' },
  { key: 'checkpoint', label: 'Checkpoints', singular: 'checkpoint', entityPrefix: 'CKPT', visibility: ['CKPT'], pathSection: 'CKPT' },
  { key: 'respawn', label: 'Respawns', singular: 'respawn point', entityPrefix: 'JGPT', visibility: ['JGPT'] },
  { key: 'object', label: 'Objects', singular: 'object', entityPrefix: 'GOBJ', visibility: ['GOBJ'] },
  { key: 'route', label: 'Routes', singular: 'route', entityPrefix: 'POTI', visibility: ['POTI_OBJECT', 'POTI_CAMERA'] },
  { key: 'area', label: 'Areas', singular: 'area', entityPrefix: 'AREA', visibility: ['AREA'] },
  { key: 'camera', label: 'Cameras', singular: 'camera', entityPrefix: 'CAME', visibility: ['CAME'] },
  { key: 'cannon', label: 'Cannons', singular: 'cannon point', entityPrefix: 'CNPT', visibility: ['CNPT'] },
  { key: 'battle', label: 'Battle finish points', singular: 'battle finish point', entityPrefix: 'MSPT', visibility: ['MSPT'] },
  { key: 'stage', label: 'Track settings', singular: 'track settings', entityPrefix: 'STGI', visibility: [] },
];

const SECTION_BY_KEY = new Map(KMP_OUTLINER_SECTIONS.map((section) => [section.key, section]));
const SECTION_BY_PREFIX = new Map(KMP_OUTLINER_SECTIONS.map((section) => [section.entityPrefix, section]));

export function outlinerSection(key: KmpOutlinerSectionKey): KmpOutlinerSectionMeta {
  const section = SECTION_BY_KEY.get(key);
  if (!section) throw new Error(`Unknown outliner section ${key}`);
  return section;
}

/** Maps a KMP entity id ("GOBJ-4", "POTI-1-2") back to its outliner section. */
export function sectionForEntityId(entityId: string | null | undefined): KmpOutlinerSectionMeta | null {
  if (!entityId) return null;
  const prefix = entityId.split('-')[0];
  return SECTION_BY_PREFIX.get(prefix) ?? null;
}

/**
 * Per-group colours. Path groups are told apart by colour in the viewport and the outliner,
 * exactly like hlorenzi's editor does, so a branch is obvious at a glance.
 */
export const PATH_GROUP_COLORS = [
  '#4ea1ff',
  '#ffb547',
  '#6fdc7a',
  '#ff7ba8',
  '#b98cff',
  '#4fd6d0',
  '#ffe066',
  '#ff8f5e',
  '#8fb4ff',
  '#c7e56a',
  '#ff6b6b',
  '#5ad1a0',
];

export function pathGroupColor(groupIndex: number): string {
  if (!Number.isFinite(groupIndex) || groupIndex < 0) return PATH_GROUP_COLORS[0];
  return PATH_GROUP_COLORS[Math.trunc(groupIndex) % PATH_GROUP_COLORS.length];
}

/** The same palette as linear 0..1 RGB, for the noclip scene overlay. */
export function pathGroupColorRgb(groupIndex: number): [number, number, number] {
  const hex = pathGroupColor(groupIndex);
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}
