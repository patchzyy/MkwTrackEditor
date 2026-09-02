import { describe, expect, it } from 'vitest';
import { isAuxiliaryModelName, modelNameFromResourcePath, selectThumbnailModelNames } from './modelSelection';

describe('isAuxiliaryModelName', () => {
  it('recognises LOD and shadow companion models', () => {
    expect(isAuxiliaryModelName('itembox-low')).toBe(true);
    expect(isAuxiliaryModelName('itembox-shadow')).toBe(true);
    expect(isAuxiliaryModelName('castletree1_low')).toBe(true);
    expect(isAuxiliaryModelName('kart_LOD')).toBe(true);
    expect(isAuxiliaryModelName('thing collision')).toBe(true);
  });

  it('leaves real object models alone', () => {
    expect(isAuxiliaryModelName('itembox')).toBe(false);
    expect(isAuxiliaryModelName('castletree1')).toBe(false);
    expect(isAuxiliaryModelName('lowpoly')).toBe(false);
    expect(isAuxiliaryModelName('shadowmoon')).toBe(false);
  });
});

describe('modelNameFromResourcePath', () => {
  it('strips directories and the extension', () => {
    expect(modelNameFromResourcePath('Extracted/itembox.brres')).toBe('itembox');
    expect(modelNameFromResourcePath('./castletree1.brres')).toBe('castletree1');
    expect(modelNameFromResourcePath('a\\b\\PalmTree.BRRES')).toBe('PalmTree');
    expect(modelNameFromResourcePath('star')).toBe('star');
  });
});

describe('selectThumbnailModelNames', () => {
  it('prefers the model named after the archive', () => {
    expect(selectThumbnailModelNames(['itembox-low', 'itembox-shadow', 'itembox'], 'itembox')).toEqual(['itembox']);
  });

  it('matches the preferred name case-insensitively', () => {
    expect(selectThumbnailModelNames(['PalmTree'], 'palmtree')).toEqual(['PalmTree']);
  });

  it('drops LOD and shadow models when there is no preferred name', () => {
    expect(selectThumbnailModelNames(['itembox-low', 'itembox-shadow', 'itembox'])).toEqual(['itembox']);
  });

  it('keeps every part of a multi-part object', () => {
    expect(selectThumbnailModelNames(['kart_body', 'kart_wheel'])).toEqual(['kart_body', 'kart_wheel']);
  });

  it('falls back to every model when the filter would empty the list', () => {
    expect(selectThumbnailModelNames(['thing-low', 'thing-shadow'])).toEqual(['thing-low', 'thing-shadow']);
  });

  it('falls back to the auxiliary filter when the preferred name is absent', () => {
    expect(selectThumbnailModelNames(['course', 'course-low'], 'vrcorn')).toEqual(['course']);
  });

  it('handles an empty archive', () => {
    expect(selectThumbnailModelNames([], 'anything')).toEqual([]);
  });
});
