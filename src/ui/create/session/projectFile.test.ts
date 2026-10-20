import { beforeAll, describe, expect, it } from 'vitest';
import { useDeterministicIds } from '../../../lib/create/ids';
import { createBlankProject, createProjectFromTemplate } from '../../../lib/create/templates';
import {
  duplicateProjectData,
  parseProjectFile,
  ProjectFileError,
  projectFileName,
  projectOutline,
  reidentifyImportedProject,
  relativeTime,
  serializeProjectFile,
  summarizeProject,
  uniqueProjectName,
  MAX_OUTLINE_POINTS,
} from './projectFile';

beforeAll(() => useDeterministicIds());

const options = { name: 'Test track', themeId: 'sunny', laps: 3 };

describe('summaries', () => {
  it('draws the main road inside the unit square', () => {
    const project = createProjectFromTemplate('oval', options);
    const outline = projectOutline(project);
    expect(outline.length).toBeGreaterThan(8);
    expect(outline.length).toBeLessThanOrEqual(MAX_OUTLINE_POINTS * 1.5);
    for (const p of outline) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.z).toBeGreaterThanOrEqual(0);
      expect(p.z).toBeLessThanOrEqual(1);
    }
    const summary = summarizeProject(project);
    expect(summary).toMatchObject({ id: project.id, name: 'Test track', themeId: 'sunny', closed: true });
  });

  it('has an empty outline for a design with no road', () => {
    const blank = createBlankProject(options);
    expect(projectOutline(blank)).toEqual([]);
    expect(summarizeProject(blank).closed).toBe(false);
  });
});

describe('project files', () => {
  it('round-trips a design', () => {
    const project = createProjectFromTemplate('kidney', options);
    const text = serializeProjectFile(project);
    expect(parseProjectFile(text)).toEqual(project);
  });

  it('accepts a bare design without the wrapper', () => {
    const project = createProjectFromTemplate('oval', options);
    expect(parseProjectFile(JSON.stringify(project)).id).toBe(project.id);
  });

  it('rejects things that are not designs with a friendly error', () => {
    expect(() => parseProjectFile('not json')).toThrow(ProjectFileError);
    expect(() => parseProjectFile('{"hello": 1}')).toThrow('not a track design');
    expect(() => parseProjectFile('[]')).toThrow(ProjectFileError);
  });

  it('refuses designs from a newer editor', () => {
    const project = { ...createBlankProject(options), version: 99 };
    expect(() => parseProjectFile(JSON.stringify({ project }))).toThrow(/newer version/);
  });

  it('repairs a partial design', () => {
    const parsed = parseProjectFile(JSON.stringify({ name: 'x', themeId: 'sunny', roads: [] }));
    expect(parsed.settings.laps).toBe(3);
    expect(parsed.terrainStrokes).toEqual([]);
    expect(parsed.generation.cameras).toBe(true);
  });

  it('names files from the design name', () => {
    expect(projectFileName({ ...createBlankProject(options), name: 'My: cool/track?' })).toBe('My-cooltrack.mkwcreate.json');
    expect(projectFileName({ ...createBlankProject(options), name: '   ' })).toBe('my-track.mkwcreate.json');
  });
});

describe('copies', () => {
  it('duplicates with a new identity and without compile bookkeeping', () => {
    const project = { ...createProjectFromTemplate('oval', options), compiledHashes: { 'course.kmp': 'abc' } };
    const copy = duplicateProjectData(project, 1234);
    expect(copy.id).not.toBe(project.id);
    expect(copy.name).toBe('Test track copy');
    expect(copy.createdAt).toBe(1234);
    expect(copy.compiledHashes).toBeUndefined();
    expect(copy.roads).toEqual(project.roads);
    // Deep copy: editing the copy leaves the original alone.
    copy.roads[0].points[0].width = 1;
    expect(project.roads[0].points[0].width).not.toBe(1);
  });

  it('gives an imported design a new id only when it would collide', () => {
    const project = createBlankProject(options);
    expect(reidentifyImportedProject(project, new Set()).id).toBe(project.id);
    expect(reidentifyImportedProject(project, new Set([project.id])).id).not.toBe(project.id);
  });

  it('picks the first free name', () => {
    expect(uniqueProjectName('My track', [])).toBe('My track');
    expect(uniqueProjectName('My track', ['My track'])).toBe('My track 2');
    expect(uniqueProjectName('My track', ['my track', 'My track 2'])).toBe('My track 3');
  });
});

describe('relativeTime', () => {
  const now = 1_700_000_000_000;
  it('speaks in plain words', () => {
    expect(relativeTime(now - 5_000, now)).toBe('just now');
    expect(relativeTime(now - 3 * 60_000, now)).toBe('3 min ago');
    expect(relativeTime(now - 60 * 60_000, now)).toBe('1 hour ago');
    expect(relativeTime(now - 5 * 3_600_000, now)).toBe('5 hours ago');
    expect(relativeTime(now - 26 * 3_600_000, now)).toBe('yesterday');
    expect(relativeTime(now - 4 * 86_400_000, now)).toBe('4 days ago');
  });
});
