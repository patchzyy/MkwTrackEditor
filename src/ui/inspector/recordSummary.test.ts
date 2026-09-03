import { describe, expect, it } from 'vitest';
import type { KmpEntity } from '../../lib/kmp';
import {
  describeKmpRecord,
  isAdvancedField,
  isEssentialField,
  kmpRecordKind,
  recordFieldPlan,
  KMP_RECORD_KINDS,
  type InspectorFieldId,
} from './recordSummary';

const origin = { x: 0, y: 0, z: 0 };

function entityOf(section: string, extra: Partial<KmpEntity> = {}): KmpEntity {
  return { id: `${section}-0`, section, index: 0, position: origin, rawOffset: 0, recordSize: 0x20, ...extra } as unknown as KmpEntity;
}

describe('kmpRecordKind', () => {
  it('maps every KMP section a user can select to a friendly kind', () => {
    expect(kmpRecordKind('GOBJ')).toBe('object');
    expect(kmpRecordKind('CKPT')).toBe('checkpoint');
    expect(kmpRecordKind('ENPT')).toBe('enemyPoint');
    expect(kmpRecordKind('ITPT')).toBe('itemPoint');
    expect(kmpRecordKind('POTI')).toBe('routePoint');
    expect(kmpRecordKind('AREA')).toBe('area');
    expect(kmpRecordKind('CAME')).toBe('camera');
    expect(kmpRecordKind('JGPT')).toBe('respawn');
    expect(kmpRecordKind('CNPT')).toBe('cannon');
    expect(kmpRecordKind('KTPT')).toBe('startPoint');
    expect(kmpRecordKind('MSPT')).toBe('battleFinish');
    expect(kmpRecordKind('STGI')).toBe('stage');
  });

  it('falls back to the generic kind for group sections and junk', () => {
    expect(kmpRecordKind('ENPH')).toBe('unknown');
    expect(kmpRecordKind('')).toBe('unknown');
  });
});

describe('field plans', () => {
  it('never lists a field as both essential and advanced', () => {
    for (const kind of KMP_RECORD_KINDS) {
      const plan = recordFieldPlan(kind);
      const overlap = plan.essential.filter((field) => plan.advanced.includes(field));
      expect(overlap, `${kind} lists ${overlap.join(', ')} twice`).toEqual([]);
    }
  });

  it('gives every record kind at least one essential field and a plain-language name', () => {
    for (const kind of KMP_RECORD_KINDS) {
      const plan = recordFieldPlan(kind);
      expect(plan.essential.length, `${kind} has nothing to show`).toBeGreaterThan(0);
      expect(plan.typeName).not.toMatch(/^[A-Z]{4}$/);
      expect(plan.description.length).toBeGreaterThan(10);
    }
  });

  it('keeps raw object data out of the essentials and in the advanced list', () => {
    const raw: InspectorFieldId[] = ['objectType', 'objectRawSettings', 'objectRawPresence'];
    for (const field of raw) {
      expect(isEssentialField('object', field)).toBe(false);
      expect(isAdvancedField('object', field)).toBe(true);
    }
  });

  it('keeps the controls an author reaches for first in the essentials', () => {
    for (const field of ['position', 'objectRoute', 'objectSettings', 'objectPresence'] as InspectorFieldId[]) {
      expect(isEssentialField('object', field)).toBe(true);
      expect(isAdvancedField('object', field)).toBe(false);
    }
    expect(isEssentialField('checkpoint', 'checkpointRespawn')).toBe(true);
    expect(isAdvancedField('checkpoint', 'checkpointLinks')).toBe(true);
    expect(isEssentialField('enemyPoint', 'pathPointSettings')).toBe(true);
    expect(isAdvancedField('enemyPoint', 'pathGroupLinks')).toBe(true);
    expect(isEssentialField('stage', 'stageSettings')).toBe(true);
    expect(isAdvancedField('stage', 'stageReserved')).toBe(true);
  });

  it('claims every field id somewhere, so nothing is silently unreachable', () => {
    const claimed = new Set<InspectorFieldId>();
    for (const kind of KMP_RECORD_KINDS) {
      const plan = recordFieldPlan(kind);
      for (const field of [...plan.essential, ...plan.advanced]) claimed.add(field);
    }
    const allFields: InspectorFieldId[] = [
      'position',
      'rotation',
      'scale',
      'objectVariant',
      'objectSettings',
      'objectRoute',
      'objectPresence',
      'objectType',
      'objectRawSettings',
      'objectRawPresence',
      'checkpointEndpoints',
      'checkpointRespawn',
      'checkpointLinks',
      'pathPointSettings',
      'pathPointExtras',
      'routeShape',
      'routeNodeSettings',
      'areaType',
      'areaTargets',
      'areaTuning',
      'cameraBasics',
      'cameraChain',
      'respawnTuning',
      'cannonSettings',
      'battleFinishSettings',
      'startPlayer',
      'stageSettings',
      'stageReserved',
      'pathGroupLinks',
    ];
    expect(allFields.filter((field) => !claimed.has(field))).toEqual([]);
  });
});

describe('describeKmpRecord', () => {
  it('describes an object with a 1-based ordinal and its transform capabilities', () => {
    const summary = describeKmpRecord(entityOf('GOBJ', { index: 11, rotation: origin, scale: { x: 1, y: 1, z: 1 } }));
    expect(summary.kind).toBe('object');
    expect(summary.typeName).toBe('Object');
    expect(summary.ordinal).toBe(12);
    expect(summary.hasPosition).toBe(true);
    expect(summary.hasRotation).toBe(true);
    expect(summary.hasScale).toBe(true);
  });

  it('does not offer a position for the track settings record', () => {
    const summary = describeKmpRecord(entityOf('STGI'));
    expect(summary.hasPosition).toBe(false);
    expect(summary.hasRotation).toBe(false);
    expect(summary.hasScale).toBe(false);
  });
});
