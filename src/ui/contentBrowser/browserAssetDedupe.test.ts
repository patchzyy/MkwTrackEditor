import { describe, expect, it } from 'vitest';

import { dedupePlaceableCourseAssetsForBrowser } from './browserAssetDedupe';

describe('browser asset dedupe', () => {
  it('collapses repeated mapped course assets and prefers the shared-object representative', () => {
    const assets = dedupePlaceableCourseAssetsForBrowser(
      [
        {
          id: 'track-a:itembox',
          source: 'courseAssetDb',
          trackFile: 'course_a.szs',
          trackLabel: 'Track A',
          path: 'course_a/Object/itembox.brres',
          baseName: 'itembox.brres',
          kind: 'object',
          objectId: 0x65,
          objectLabel: 'Item Box',
        },
        {
          id: 'shared:itembox',
          source: 'sharedObjectDir',
          trackFile: null,
          trackLabel: 'Shared Objects',
          path: 'Object/itembox.brres',
          baseName: 'itembox.brres',
          kind: 'sharedObject',
          objectId: 0x65,
          objectLabel: 'Item Box',
        },
        {
          id: 'track-b:itembox',
          source: 'courseAssetDb',
          trackFile: 'course_b.szs',
          trackLabel: 'Track B',
          path: 'course_b/Object/itembox.brres',
          baseName: 'itembox.brres',
          kind: 'object',
          objectId: 0x65,
          objectLabel: 'Item Box',
        },
      ],
      new Set(),
    );

    expect(assets).toHaveLength(1);
    expect(assets[0]?.source).toBe('sharedObjectDir');
    expect(assets[0]?.objectId).toBe(0x65);
  });

  it('drops mapped course assets when the logical object already exists in the main browser catalog', () => {
    const assets = dedupePlaceableCourseAssetsForBrowser(
      [
        {
          id: 'shared:itembox',
          source: 'sharedObjectDir',
          trackFile: null,
          trackLabel: 'Shared Objects',
          path: 'Object/itembox.brres',
          baseName: 'itembox.brres',
          kind: 'sharedObject',
          objectId: 0x65,
          objectLabel: 'Item Box',
        },
      ],
      new Set([0x65]),
    );

    expect(assets).toEqual([]);
  });

  it('keeps one representative for unmapped duplicate assets based on basename', () => {
    const assets = dedupePlaceableCourseAssetsForBrowser([
      {
        id: 'track-a:decor',
        source: 'courseAssetDb',
        trackFile: 'course_a.szs',
        trackLabel: 'Track A',
        path: 'course_a/Object/custom_decor.brres',
        baseName: 'custom_decor.brres',
        kind: 'object',
        objectId: null,
        objectLabel: null,
      },
      {
        id: 'track-b:decor',
        source: 'courseAssetDb',
        trackFile: 'course_b.szs',
        trackLabel: 'Track B',
        path: 'course_b/Object/custom_decor.brres',
        baseName: 'custom_decor.brres',
        kind: 'object',
        objectId: null,
        objectLabel: null,
      },
    ]);

    expect(assets).toHaveLength(1);
    expect(assets[0]?.baseName).toBe('custom_decor.brres');
  });
});
