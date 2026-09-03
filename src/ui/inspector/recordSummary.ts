/**
 * What the property inspector shows first, and what it hides behind "Advanced".
 *
 * The inspector used to render every field a KMP record has in one flat wall. This module is
 * the single place that decides, per record type, which fields a track author needs on screen
 * ("essentials") and which are low-level plumbing they only occasionally touch ("advanced").
 * It is pure data plus a few lookups so it can be unit tested without React.
 */
import type { KmpEntity } from '../../lib/kmp';

/** The kinds of record the inspector knows how to describe, keyed off the KMP section. */
export type KmpRecordKind =
  | 'object'
  | 'checkpoint'
  | 'enemyPoint'
  | 'itemPoint'
  | 'routePoint'
  | 'area'
  | 'camera'
  | 'respawn'
  | 'cannon'
  | 'startPoint'
  | 'battleFinish'
  | 'stage'
  | 'unknown';

/**
 * A named group of controls in the inspector. One id can cover several form rows as long as
 * they belong together for the reader (all four checkpoint links, say).
 */
export type InspectorFieldId =
  | 'position'
  | 'rotation'
  | 'scale'
  | 'objectVariant'
  | 'objectSettings'
  | 'objectRoute'
  | 'objectPresence'
  | 'objectType'
  | 'objectRawSettings'
  | 'objectRawPresence'
  | 'checkpointEndpoints'
  | 'checkpointRespawn'
  | 'checkpointLinks'
  | 'pathPointSettings'
  | 'pathPointExtras'
  | 'routeShape'
  | 'routeNodeSettings'
  | 'areaType'
  | 'areaTargets'
  | 'areaTuning'
  | 'cameraBasics'
  | 'cameraChain'
  | 'respawnTuning'
  | 'cannonSettings'
  | 'battleFinishSettings'
  | 'startPlayer'
  | 'stageSettings'
  | 'stageReserved'
  | 'pathGroupLinks';

export interface RecordFieldPlan {
  /** Plain-language name of the record type, singular, sentence case. */
  typeName: string;
  /** One line explaining what the record does, for the header. */
  description: string;
  /** Shown directly, in this order. */
  essential: readonly InspectorFieldId[];
  /** Shown only when the reader opens the Advanced disclosure. */
  advanced: readonly InspectorFieldId[];
}

const RECORD_PLANS: Record<KmpRecordKind, RecordFieldPlan> = {
  object: {
    typeName: 'Object',
    description: 'A prop, hazard or pickup placed on the track.',
    essential: ['position', 'rotation', 'scale', 'objectVariant', 'objectRoute', 'objectSettings', 'objectPresence'],
    advanced: ['objectType', 'objectRawSettings', 'objectRawPresence'],
  },
  checkpoint: {
    typeName: 'Checkpoint',
    description: 'A line across the road that tracks race position and counts laps.',
    essential: ['checkpointEndpoints', 'checkpointRespawn'],
    advanced: ['position', 'checkpointLinks', 'pathGroupLinks'],
  },
  enemyPoint: {
    typeName: 'Enemy route point',
    description: 'A point on the line the computer drivers follow.',
    essential: ['position', 'pathPointSettings'],
    advanced: ['pathPointExtras', 'pathGroupLinks'],
  },
  itemPoint: {
    typeName: 'Item route point',
    description: 'A point on the path red shells and Bullet Bills follow.',
    essential: ['position', 'pathPointSettings'],
    advanced: ['pathPointExtras', 'pathGroupLinks'],
  },
  routePoint: {
    typeName: 'Route point',
    description: 'A node on a movement path that objects and cameras can follow.',
    essential: ['position', 'routeShape'],
    advanced: ['routeNodeSettings'],
  },
  area: {
    typeName: 'Area',
    description: 'A volume that changes something — camera, fog, music — while a driver is inside it.',
    essential: ['position', 'rotation', 'scale', 'areaType', 'areaTargets'],
    advanced: ['areaTuning'],
  },
  camera: {
    typeName: 'Camera',
    description: 'A camera shot for the opening pan, a replay or an area trigger.',
    essential: ['position', 'rotation', 'cameraBasics'],
    advanced: ['cameraChain'],
  },
  respawn: {
    typeName: 'Respawn point',
    description: 'Where Lakitu puts a driver back on the road after a fall.',
    essential: ['position', 'rotation'],
    advanced: ['respawnTuning'],
  },
  cannon: {
    typeName: 'Cannon point',
    description: 'Where a cannon fires drivers to, and how the flight looks.',
    essential: ['position', 'rotation', 'cannonSettings'],
    advanced: [],
  },
  startPoint: {
    typeName: 'Start point',
    description: 'Where the drivers line up on the starting grid.',
    essential: ['position', 'rotation', 'startPlayer'],
    advanced: [],
  },
  battleFinish: {
    typeName: 'Battle finish point',
    description: 'A finish position used by battle and mission modes.',
    essential: ['position', 'rotation'],
    advanced: ['battleFinishSettings'],
  },
  stage: {
    typeName: 'Track settings',
    description: 'Track-wide rules: laps, the starting grid and the sun flare.',
    essential: ['stageSettings'],
    advanced: ['stageReserved'],
  },
  unknown: {
    typeName: 'Record',
    description: 'A record in the track layout.',
    essential: ['position', 'rotation', 'scale'],
    advanced: [],
  },
};

/** Which record type a KMP section belongs to. */
export function kmpRecordKind(section: string): KmpRecordKind {
  switch (section) {
    case 'GOBJ':
      return 'object';
    case 'CKPT':
      return 'checkpoint';
    case 'ENPT':
      return 'enemyPoint';
    case 'ITPT':
      return 'itemPoint';
    case 'POTI':
      return 'routePoint';
    case 'AREA':
      return 'area';
    case 'CAME':
      return 'camera';
    case 'JGPT':
      return 'respawn';
    case 'CNPT':
      return 'cannon';
    case 'KTPT':
      return 'startPoint';
    case 'MSPT':
      return 'battleFinish';
    case 'STGI':
      return 'stage';
    default:
      return 'unknown';
  }
}

/** True when the field belongs on screen straight away for this record type. */
export function isEssentialField(kind: KmpRecordKind, field: InspectorFieldId): boolean {
  return RECORD_PLANS[kind].essential.includes(field);
}

/** True when the field is only reachable through the Advanced disclosure. */
export function isAdvancedField(kind: KmpRecordKind, field: InspectorFieldId): boolean {
  return RECORD_PLANS[kind].advanced.includes(field);
}

/** The full plan for a record type: names plus both field lists. */
export function recordFieldPlan(kind: KmpRecordKind): RecordFieldPlan {
  return RECORD_PLANS[kind];
}

export interface KmpRecordSummary {
  kind: KmpRecordKind;
  /** Plain-language record type, e.g. "Object" or "Enemy route point". */
  typeName: string;
  /** One-line explanation of what the record does. */
  description: string;
  /** Human index, 1-based, matching how the outliner counts. */
  ordinal: number;
  hasPosition: boolean;
  hasRotation: boolean;
  hasScale: boolean;
}

/** Everything the inspector header needs to introduce the selected record. */
export function describeKmpRecord(entity: Pick<KmpEntity, 'section' | 'index' | 'rotation' | 'scale'>): KmpRecordSummary {
  const kind = kmpRecordKind(entity.section);
  const plan = RECORD_PLANS[kind];
  return {
    kind,
    typeName: plan.typeName,
    description: plan.description,
    ordinal: entity.index + 1,
    hasPosition: kind !== 'stage',
    hasRotation: entity.rotation !== undefined,
    hasScale: entity.scale !== undefined,
  };
}

/** Every record kind. Used by the unit test to keep the table complete. */
export const KMP_RECORD_KINDS = Object.keys(RECORD_PLANS) as KmpRecordKind[];
