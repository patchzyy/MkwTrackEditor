import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildTrackArchive, compileProject } from '../../../lib/create/compile';
import { useDeterministicIds } from '../../../lib/create/ids';
import { createKitFromArchive } from '../../../lib/create/kit';
import { updateSection } from '../../../lib/create/ops';
import { createProjectFromTemplate } from '../../../lib/create/templates';
import type { CompileResult, CreateKit, CreateProject } from '../../../lib/create/types';
import { writers } from '../../../lib/create/writers';
import { loadTrackBytes, replaceCourseKmp, type TrackDocument } from '../../../lib/track';
import { readKmpFile } from '../../../lib/kmpFile';
import {
  collectObjectResources,
  createSourceId,
  findBytes,
  isCreateSourceId,
  mergeCompileIntoTrack,
  normalizeArchivePath,
} from './trackBridge';

const KIT_PATH = 'public/data/MarioKartWii/Create/create-kit.szs';
const have = existsSync(KIT_PATH);

describe('archive paths', () => {
  it('treats spellings of one path as the same file', () => {
    expect(normalizeArchivePath('./Course.KMP')).toBe('course.kmp');
    expect(normalizeArchivePath('course.kmp')).toBe('course.kmp');
    expect(normalizeArchivePath('.\\posteffect\\a.bloom')).toBe('posteffect/a.bloom');
  });

  it('recognises create documents', () => {
    expect(createSourceId('p1')).toBe('create:p1');
    expect(isCreateSourceId('create:p1')).toBe(true);
    expect(isCreateSourceId('create:p1', 'p2')).toBe(false);
    expect(isCreateSourceId('track.szs:123:456')).toBe(false);
    expect(isCreateSourceId(undefined)).toBe(false);
  });
});

describe.skipIf(!have)('merging a compile into the track document', () => {
  let kit: CreateKit;
  let project: CreateProject;
  let first: CompileResult;
  let doc: TrackDocument;

  beforeAll(async () => {
    useDeterministicIds();
    kit = createKitFromArchive(new Uint8Array(readFileSync(KIT_PATH)));
    project = createProjectFromTemplate('oval', { name: 'Bridge test', themeId: 'sunny', laps: 3 }, kit);
    first = compileProject(project, kit, writers);
    doc = { ...(await loadTrackBytes(buildTrackArchive(first), 'bridge.szs', { modelPreviews: false })), sourceId: createSourceId(project.id) };
  }, 120_000);

  it('opens the first compile as a normal track', () => {
    expect(doc.kmpFile?.checkpoints.length).toBe(first.kmp.checkpoints.length);
    expect(findBytes(doc.archiveEntries, 'course.kcl')).not.toBeNull();
    expect(doc.sourceId).toBe('create:' + project.id);
  });

  it('swaps changed files in place and re-parses the layout', () => {
    const edited = updateSection(project, project.roads[0].id, project.roads[0].sections[0].id, { label: 'Start straight' });
    const moved = { ...edited, settings: { ...edited.settings, laps: 5 } };
    const second = compileProject(moved, kit, writers);
    const next = mergeCompileIntoTrack(doc, second.files, { previousPaths: first.files.keys() });
    expect(next).not.toBe(doc);
    expect(next.sourceId).toBe(doc.sourceId);
    expect(next.fileName).toBe(doc.fileName);
    // The same entry list, in the same order, with the same spelling.
    expect(next.archiveEntries.map((e) => e.path)).toEqual(doc.archiveEntries.map((e) => e.path));
    expect(readKmpFile(findBytes(next.archiveEntries, 'course.kmp')!).stage[0].lapCount).toBe(5);
    expect(next.kmpFile?.stage[0].lapCount).toBe(5);
    expect(next.kmp).toBeDefined();
    expect(next.kcl).toBeDefined();
    // Files the design did not change keep their bytes.
    expect(findBytes(next.archiveEntries, 'posteffect/posteffect.blight')).toEqual(findBytes(doc.archiveEntries, 'posteffect/posteffect.blight'));
  }, 60_000);

  it('never overwrites a file the user chose to keep', () => {
    const second = compileProject({ ...project, settings: { ...project.settings, laps: 7 } }, kit, writers);
    const next = mergeCompileIntoTrack(doc, second.files, { keepPaths: new Set(['course.kmp']) });
    expect(findBytes(next.archiveEntries, 'course.kmp')).toBe(findBytes(doc.archiveEntries, 'course.kmp'));
    expect(findBytes(next.archiveEntries, 'course.kcl')).not.toBeNull();
  }, 60_000);

  it('removes files the design no longer produces, and adds new ones with their folders', () => {
    const files = new Map(first.files);
    files.delete('map_model.brres');
    files.set('posteffect/new.bloom', new Uint8Array([1, 2, 3]));
    const next = mergeCompileIntoTrack(doc, files, { previousPaths: first.files.keys() });
    expect(findBytes(next.archiveEntries, 'map_model.brres')).toBeNull();
    expect(findBytes(next.archiveEntries, 'posteffect/new.bloom')).not.toBeNull();
    expect(next.archiveEntries.filter((e) => e.type === 'directory' && e.path.toLowerCase().endsWith('posteffect'))).toHaveLength(1);
    expect(next.brresFiles).not.toContain('./map_model.brres');
  });

  it('clears model edits when asked', () => {
    const withEdits = { ...doc, meshEdits: [{} as never], importedMeshes: [{} as never] };
    const next = mergeCompileIntoTrack(withEdits, first.files, { clearMeshEdits: true });
    expect(next.meshEdits).toBeUndefined();
    expect(next.importedMeshes).toBeUndefined();
  });

  it('adds the object models the generated objects need', () => {
    const common = {
      objFlow: { byId: new Map([[0x65, { objectId: 0x65, name: 'itembox', resources: 'itembox' }]]) },
      byBaseName: new Map([['itembox.brres', { path: 'itembox.brres', type: 'file' as const, data: new Uint8Array([9, 9]) }]]),
    } as never;
    const resources = collectObjectResources(first.kmp, common);
    expect(first.kmp.objects.some((o) => o.objectId === 0x65)).toBe(true);
    expect([...resources.keys()]).toEqual(['itembox.brres']);
    const next = mergeCompileIntoTrack(doc, first.files, { resources });
    expect(findBytes(next.archiveEntries, 'itembox.brres')).toEqual(new Uint8Array([9, 9]));
    // A second merge does not duplicate it.
    const again = mergeCompileIntoTrack(next, first.files, { resources });
    expect(again.archiveEntries.filter((e) => e.path.toLowerCase().endsWith('itembox.brres'))).toHaveLength(1);
  });

  it('keeps hand edits visible to the conflict check', () => {
    const edited = replaceCourseKmp(doc, findBytes(doc.archiveEntries, 'course.kmp')!);
    expect(edited.kmpFile).toBeDefined();
  });
});
