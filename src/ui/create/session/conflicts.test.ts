import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildTrackArchive, compileProject, computeFileHashes } from '../../../lib/create/compile';
import { useDeterministicIds } from '../../../lib/create/ids';
import { createKitFromArchive } from '../../../lib/create/kit';
import { createProjectFromTemplate } from '../../../lib/create/templates';
import type { CompileResult } from '../../../lib/create/types';
import { writers } from '../../../lib/create/writers';
import { readKmpFile, writeKmpFile } from '../../../lib/kmpFile';
import { loadTrackBytes, replaceArchiveFile, replaceCourseKmp, type TrackDocument } from '../../../lib/track';
import {
  addLockedSections,
  changedKmpSections,
  describeChangedFile,
  detectConflicts,
  sectionsToLock,
} from './conflicts';
import { findBytes } from './trackBridge';

const KIT_PATH = 'public/data/MarioKartWii/Create/create-kit.szs';

describe('describeChangedFile', () => {
  it('speaks plainly', () => {
    expect(describeChangedFile('course.kmp', ['checkpoints'])).toBe('checkpoints');
    expect(describeChangedFile('./course.kmp', ['checkpoints', 'cameras'])).toBe('checkpoints and cameras');
    expect(describeChangedFile('course.kmp', ['enemy', 'item', 'objects'])).toBe('computer driver routes, item routes and objects');
    expect(describeChangedFile('course.kmp')).toBe('the race layout');
    expect(describeChangedFile('./course.kcl')).toBe('the collision');
    expect(describeChangedFile('course_model.brres')).toBe('the course model');
    expect(describeChangedFile('posteffect/posteffect.bfg')).toBe('the lighting and effects');
  });
});

describe('addLockedSections', () => {
  it('merges without duplicates', () => {
    expect(addLockedSections(['checkpoints'], ['checkpoints', 'cameras'])).toEqual(['checkpoints', 'cameras']);
  });
});

describe.skipIf(!existsSync(KIT_PATH))('detecting hand edits', () => {
  let result: CompileResult;
  let doc: TrackDocument;
  let hashes: Record<string, string>;
  let generated: ReturnType<typeof readKmpFile>;

  beforeAll(async () => {
    useDeterministicIds();
    const kit = createKitFromArchive(new Uint8Array(readFileSync(KIT_PATH)));
    const project = createProjectFromTemplate('oval', { name: 'Conflicts', themeId: 'sunny', laps: 3 }, kit);
    result = compileProject(project, kit, writers);
    doc = await loadTrackBytes(buildTrackArchive(result), 'conflicts.szs', { modelPreviews: false });
    hashes = computeFileHashes(result.files);
    generated = readKmpFile(result.files.get('course.kmp')!);
  }, 120_000);

  it('finds nothing when the document is as compiled', () => {
    expect(detectConflicts({ compiledHashes: hashes, track: doc, generatedKmp: generated })).toEqual([]);
    expect(detectConflicts({ compiledHashes: undefined, track: doc })).toEqual([]);
    expect(detectConflicts({ compiledHashes: hashes, track: null })).toEqual([]);
  });

  it('names the parts of the layout that were edited', () => {
    const edit = readKmpFile(findBytes(doc.archiveEntries, 'course.kmp')!);
    edit.checkpoints[2] = { ...edit.checkpoints[2], x1: edit.checkpoints[2].x1 + 500 };
    const edited = replaceCourseKmp(doc, writeKmpFile(edit));
    const conflicts = detectConflicts({ compiledHashes: hashes, track: edited, generatedKmp: generated });
    expect(conflicts).toEqual([{ path: 'course.kmp', what: 'checkpoints' }]);
    expect(sectionsToLock(conflicts, generated, edited.kmpFile)).toEqual(['checkpoints']);
  });

  it('flags other files that changed', () => {
    const edited = replaceArchiveFile(doc, './course_model.brres', new Uint8Array([1, 2, 3]));
    const conflicts = detectConflicts({ compiledHashes: hashes, track: edited, generatedKmp: generated });
    expect(conflicts).toEqual([{ path: 'course_model.brres', what: 'the course model' }]);
    expect(sectionsToLock(conflicts, generated, edited.kmpFile)).toEqual([]);
  });

  it('flags Model-mode edits that live on the document', () => {
    const edited = { ...doc, meshEdits: [{} as never] };
    expect(detectConflicts({ compiledHashes: hashes, track: edited })).toEqual([{ path: 'course_model.brres', what: 'the course model' }]);
  });

  it('does not repeat a change the user already decided about', () => {
    const edited = replaceArchiveFile(doc, './course.kcl', new Uint8Array([7, 7, 7, 7]));
    const first = detectConflicts({ compiledHashes: hashes, track: edited });
    expect(first).toHaveLength(1);
    const now = { 'course.kcl': computeFileHashes(new Map([['x', new Uint8Array([7, 7, 7, 7])]])).x };
    expect(detectConflicts({ compiledHashes: hashes, track: edited, acknowledged: now })).toEqual([]);
  });

  it('sees two sections when two were edited', () => {
    const edit = readKmpFile(findBytes(doc.archiveEntries, 'course.kmp')!);
    edit.checkpoints[1] = { ...edit.checkpoints[1], z1: edit.checkpoints[1].z1 + 100 };
    edit.objects[0] = { ...edit.objects[0], position: { ...edit.objects[0].position, y: edit.objects[0].position.y + 10 } };
    expect(changedKmpSections(generated, readKmpFile(writeKmpFile(edit))).sort()).toEqual(['checkpoints', 'objects']);
  });
});
