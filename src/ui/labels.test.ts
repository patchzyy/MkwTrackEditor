import { describe, expect, it } from 'vitest';
import {
  describeBrres,
  describeCourseAsset,
  fallbackObjectName,
  fmt,
  friendlyGroupSectionLabel,
  friendlySectionLabel,
  friendlySectionSingularLabel,
  friendlyTrackAssetName,
  getKnownObjectName,
  humanizeObjectName,
  presentValidationIssue,
  shortAssetName,
} from './labels';
import type { PlaceableCourseAssetRecord } from '../lib/courseAssets';

const KMP_SECTIONS = ['KTPT', 'ENPT', 'ITPT', 'CKPT', 'POTI', 'CAME', 'AREA', 'JGPT', 'CNPT', 'MSPT', 'STGI'];

describe('friendly section labels', () => {
  it('never shows a raw KMP section code to the user', () => {
    for (const section of KMP_SECTIONS) {
      const label = friendlySectionLabel(section);
      expect(label, `${section} should have a friendly plural label`).not.toBe(section);
      expect(label).toMatch(/^[A-Z][A-Za-z ]+$/);

      const singular = friendlySectionSingularLabel(section);
      expect(singular).not.toBe(section);
      expect(singular).toMatch(/^[a-z][a-z ]+$/);
    }
  });

  it('uses editor words rather than KMP jargon', () => {
    expect(friendlySectionLabel('ENPT')).toBe('Enemy Routes');
    expect(friendlySectionLabel('CKPT')).toBe('Checkpoints');
    expect(friendlySectionLabel('STGI')).toBe('Track Settings');
    expect(friendlyGroupSectionLabel('ENPH')).toBe('enemy route');
    expect(friendlyGroupSectionLabel('ITPH')).toBe('item route');
    expect(friendlyGroupSectionLabel('CKPH')).toBe('checkpoint');
  });

  it('falls back to the raw name for sections it does not know', () => {
    expect(friendlySectionLabel('WXYZ')).toBe('WXYZ');
    expect(friendlySectionSingularLabel('WXYZ')).toBe('wxyz');
    expect(friendlyGroupSectionLabel('WXYZ')).toBe('WXYZ');
  });
});

describe('object names', () => {
  it('turns internal object names into readable words', () => {
    expect(humanizeObjectName('kinoko_lift1')).toBe('Kinoko Lift 1');
    expect(humanizeObjectName('itembox')).toBe('Item Box');
    expect(humanizeObjectName('npc_mii_a')).toBe('NPC Mii A');
    expect(humanizeObjectName('firebar')).toBe('Fire Bar');
  });

  it('resolves known ids and falls back readably for unknown ones', () => {
    expect(getKnownObjectName(0x65)).toBe('Item Box');
    expect(getKnownObjectName(0xfffe)).toBeNull();
    expect(getKnownObjectName(undefined)).toBeNull();
    expect(fallbackObjectName(0xfffe)).toBe('Unknown object 65534');
  });
});

describe('asset labels', () => {
  it('names the well-known track archives', () => {
    expect(friendlyTrackAssetName('course_model.brres')).toBe('Course Model');
    expect(friendlyTrackAssetName('./vrcorn_model.brres')).toBe('Skybox Model');
    expect(friendlyTrackAssetName('./posteffect/posteffect.bfg')).toBe('posteffect.bfg');
    expect(shortAssetName('kinoko_lift1.brres')).toBe('kinoko lift1');
  });

  it('describes BRRES summaries and course assets in plain words', () => {
    expect(describeBrres(undefined)).toBe('');
    expect(describeBrres({ models: ['a'], textures: ['t1', 't2'], animations: { srt: ['x'] } } as never)).toBe('1 models · 2 textures · 1 animations');

    const asset = {
      id: 'a',
      source: 'sharedObjectDir',
      trackFile: null,
      trackLabel: 'Shared objects',
      path: 'Object/kuribo.brres',
      baseName: 'kuribo.brres',
      kind: 'sharedObject',
      objectId: 0x191,
      objectLabel: 'Goomba',
    } satisfies PlaceableCourseAssetRecord;
    expect(describeCourseAsset(asset)).toBe('shared object · drag to place · Shared objects');
    expect(describeCourseAsset({ ...asset, objectId: null })).toBe('shared object · reference only · Shared objects');
  });

  it('formats numbers defensively', () => {
    expect(fmt(1.25)).toBe('1.3');
    expect(fmt(Number.NaN)).toBe('nan');
  });
});

describe('validation messages', () => {
  it('rewrites technical validator output into user-facing wording', () => {
    expect(presentValidationIssue('course.kmp is missing.')).toEqual({
      summary: 'The track data file is missing.',
      detail: 'The course cannot load gameplay objects, paths, or start data without course.kmp.',
    });
    expect(presentValidationIssue('No start position is defined.')).toEqual({ summary: 'No player start position is set.' });
    expect(presentValidationIssue('Checkpoint 4 references missing respawn point 9.')).toEqual({
      summary: 'A checkpoint points to a respawn that does not exist.',
      detail: 'Checkpoint 4 references missing respawn point 9.',
    });
  });

  it('passes unknown messages through unchanged', () => {
    expect(presentValidationIssue('Something new happened.')).toEqual({ summary: 'Something new happened.' });
  });
});
