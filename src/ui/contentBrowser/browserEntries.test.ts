import { describe, expect, it } from 'vitest';
import type { NoclipBrresSummary } from '../../lib/noclipBrres';
import type { CommonResourceArchive } from '../../lib/objflow';
import type { TrackDocument } from '../../lib/track';
import {
  browserEntryDrag,
  browserEntryFacts,
  browserEntryHint,
  browserFolderEntries,
  OBJECT_DRAG_TYPE,
  POINT_DRAG_TYPE,
} from './browserEntries';
import { kmpPointCatalog, type BrowserFolder } from './browserFolders';

const summary: NoclipBrresSummary = {
  models: [{ name: 'itembox', nodes: 3, materials: 2, shapes: 4 }],
  textures: [
    { name: 'box', width: 64, height: 64, format: 'CMPR' },
    { name: 'glow', width: 128, height: 64, format: 'RGB5A3' },
  ],
  previewDataUrl: 'data:image/png;base64,AA',
  animations: { srt0: ['spin'], pat0: [], clr0: [], chr0: [], vis0: [], scn0: [] },
};

// ObjFlow resource names are normalised to `<name>.brres`, so that is the key both the
// archive index and the parsed-summary map are looked up by.
const commonArchive = {
  byBaseName: new Map([['itembox.brres', {}]]),
} as unknown as CommonResourceArchive;

const track = {
  brresSummaries: { './course_model.brres': summary },
} as unknown as TrackDocument;

const context = { track, commonArchive, commonBrresSummaries: { 'itembox.brres': summary } };
const emptyContext = { track: null, commonArchive: null, commonBrresSummaries: {} };

const objectFolder: BrowserFolder = {
  id: 'common',
  group: 'objects',
  label: 'All objects',
  detail: '',
  kind: 'object',
  items: [
    { objectId: 0x65, name: 'itembox', resources: 'itembox' },
    {
      id: 'asset-1',
      source: 'sharedObjectDir',
      trackFile: null,
      trackLabel: 'Shared objects',
      path: 'Object/kuribo.brres',
      baseName: 'kuribo.brres',
      kind: 'sharedObject',
      objectId: null,
      objectLabel: null,
    },
  ],
};

describe('browserFolderEntries', () => {
  it('returns nothing for no folder', () => {
    expect(browserFolderEntries(null, emptyContext)).toEqual([]);
  });

  it('turns the KMP catalog into point entries', () => {
    const folder: BrowserFolder = { id: 'kmp', group: 'trackData', label: 'Points and routes', detail: '', kind: 'kmp', items: kmpPointCatalog };
    const entries = browserFolderEntries(folder, emptyContext);
    expect(entries).toHaveLength(kmpPointCatalog.length);
    expect(entries[0]).toMatchObject({ kind: 'point', label: 'Start Point', section: 'KTPT' });
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
  });

  it('turns track asset paths into entries with a friendly name', () => {
    const folder: BrowserFolder = { id: 'track', group: 'thisTrack', label: 'Track meshes', detail: '', kind: 'brres', items: ['./course_model.brres'] };
    const [entry] = browserFolderEntries(folder, context);
    expect(entry.kind).toBe('trackAsset');
    expect(entry.label).not.toContain('./');
    expect(entry.caption.length).toBeGreaterThan(0);
  });

  it('separates game objects from course assets', () => {
    const entries = browserFolderEntries(objectFolder, context);
    expect(entries.map((entry) => entry.kind)).toEqual(['object', 'courseAsset']);
    expect(entries[0]).toMatchObject({ label: 'Item Box', objectId: 0x65 });
    expect(entries[1]).toMatchObject({ label: 'kuribo', objectId: null });
  });
});

describe('browserEntryDrag', () => {
  it('drags a point by its section', () => {
    const [point] = browserFolderEntries(
      { id: 'kmp', group: 'trackData', label: '', detail: '', kind: 'kmp', items: [kmpPointCatalog[0]] },
      emptyContext,
    );
    expect(browserEntryDrag(point)).toEqual({ type: POINT_DRAG_TYPE, value: 'KTPT' });
  });

  it('drags an object by its id', () => {
    const [object] = browserFolderEntries(objectFolder, context);
    expect(browserEntryDrag(object)).toEqual({ type: OBJECT_DRAG_TYPE, value: '101' });
  });

  it('refuses to drag a course asset with no object id, and says so', () => {
    const [, asset] = browserFolderEntries(objectFolder, context);
    expect(browserEntryDrag(asset)).toBeNull();
    expect(browserEntryHint(asset)).toContain('no placeable object id');
  });

  it('refuses to drag a track asset file', () => {
    const [entry] = browserFolderEntries(
      { id: 'track', group: 'thisTrack', label: '', detail: '', kind: 'brres', items: ['./course_model.brres'] },
      context,
    );
    expect(browserEntryDrag(entry)).toBeNull();
  });

  it('tells the user a draggable entry is draggable', () => {
    const [object] = browserFolderEntries(objectFolder, context);
    expect(browserEntryHint(object)).toContain('drag into the viewport');
  });
});

describe('browserEntryFacts', () => {
  it('explains a point in plain language, with no section code as the value', () => {
    const [point] = browserFolderEntries(
      { id: 'kmp', group: 'trackData', label: '', detail: '', kind: 'kmp', items: [kmpPointCatalog[1]] },
      emptyContext,
    );
    const facts = browserEntryFacts(point, emptyContext);
    expect(facts.map((fact) => fact.label)).toEqual(['Kind', 'Category', 'How to place']);
    // Singular and sentence-cased: this tile is one point, not the whole section.
    expect(facts[0].value).toBe('Enemy route point');
  });

  it('reports an object id in both hex and decimal, and which models are loaded', () => {
    const [object] = browserFolderEntries(objectFolder, context);
    const facts = browserEntryFacts(object, context);
    expect(facts[0]).toEqual({ label: 'Object id', value: '0x65 (101)' });
    expect(facts.find((fact) => fact.label === 'Available')?.value).toBe('All models are loaded');
    expect(facts.find((fact) => fact.label === 'Model')?.value).toContain('4 shapes');
    expect(facts.find((fact) => fact.label === 'Textures')?.value).toContain('largest 128x64 RGB5A3');
    expect(facts.find((fact) => fact.label === 'Animations')?.value).toBe('1 SRT0');
  });

  it('reports how many of an object’s models are missing', () => {
    const [object] = browserFolderEntries(objectFolder, emptyContext);
    const facts = browserEntryFacts(object, emptyContext);
    expect(facts.find((fact) => fact.label === 'Available')?.value).toBe('0 of 1 models loaded');
  });

  it('tells the user to import Common.szs for a built-in catalog object with no resources', () => {
    const folder: BrowserFolder = {
      id: 'featured',
      group: 'objects',
      label: 'Favourites',
      detail: '',
      kind: 'object',
      items: [{ id: 0x65, label: 'Item Box', category: 'Gameplay' }],
    };
    const [object] = browserFolderEntries(folder, emptyContext);
    const facts = browserEntryFacts(object, emptyContext);
    expect(facts.find((fact) => fact.label === 'Available')?.value).toContain('Common.szs');
  });

  it('says outright when a course asset cannot be placed', () => {
    const [, asset] = browserFolderEntries(objectFolder, context);
    const facts = browserEntryFacts(asset, context);
    expect(facts.find((fact) => fact.label === 'Object id')?.value).toContain('Not placeable');
    expect(facts.find((fact) => fact.label === 'From')?.value).toBe('Shared objects');
  });

  it('describes a track asset with its own file name', () => {
    const [entry] = browserFolderEntries(
      { id: 'track', group: 'thisTrack', label: '', detail: '', kind: 'brres', items: ['./course_model.brres'] },
      context,
    );
    const facts = browserEntryFacts(entry, context);
    expect(facts.find((fact) => fact.label === 'File')?.value).toBe('course_model.brres');
    expect(facts.some((fact) => fact.label === 'Model')).toBe(true);
  });
});
