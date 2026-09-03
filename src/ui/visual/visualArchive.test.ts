import { describe, expect, it } from 'vitest';
import type { TrackDocument } from '../../lib/track';
import {
  animationKindLabel,
  buildAnimationRows,
  describeVisualArchive,
  findArchiveBytes,
  formatByteSize,
  listVisualArchivePaths,
  maxAnimationFrames,
  sumTextureBytes,
  toSceneArchivePath,
  type VisualAnimationInfo,
  type VisualArchiveInfo,
} from './visualArchive';
import {
  applyVisualRenderSettings,
  defaultVisualRenderSettings,
  matchesVisualPreset,
  visualPresets,
  type VisualRendererScene,
  type VisualRenderSettings,
} from './visualScene';

function makeTrack(paths: string[]): TrackDocument {
  return {
    archiveEntries: paths.map((path) => ({ type: 'file' as const, path, data: new Uint8Array([path.length]) })),
  } as unknown as TrackDocument;
}

describe('describeVisualArchive', () => {
  it('names the three archives an author thinks about by role', () => {
    expect(describeVisualArchive('course_model.brres')).toEqual({ label: 'Track model', role: 'course' });
    expect(describeVisualArchive('vrcorn_model.brres')).toEqual({ label: 'Skybox', role: 'skybox' });
    expect(describeVisualArchive('map_model.brres')).toEqual({ label: 'Minimap', role: 'minimap' });
  });

  it('falls back to the file name for object archives, and is case insensitive', () => {
    expect(describeVisualArchive('Course_Model.brres').role).toBe('course');
    expect(describeVisualArchive('itembox.brres')).toEqual({ label: 'itembox', role: 'object' });
    expect(describeVisualArchive('effect/sub/Kuribo.brres')).toEqual({ label: 'Kuribo', role: 'object' });
  });
});

describe('listVisualArchivePaths', () => {
  it('lists only .brres, course first then skybox, minimap and the rest alphabetically', () => {
    const track = makeTrack(['course.kmp', 'itembox.brres', 'map_model.brres', 'vrcorn_model.brres', 'course_model.brres', 'Aaa.brres']);
    expect(listVisualArchivePaths(track)).toEqual([
      'course_model.brres',
      'vrcorn_model.brres',
      'map_model.brres',
      'Aaa.brres',
      'itembox.brres',
    ]);
  });

  it('is empty without a track', () => {
    expect(listVisualArchivePaths(null)).toEqual([]);
  });
});

describe('findArchiveBytes', () => {
  it('matches the path case insensitively and returns null when absent', () => {
    const track = makeTrack(['course_model.brres']);
    expect(findArchiveBytes(track, 'COURSE_MODEL.BRRES')).toBeInstanceOf(Uint8Array);
    expect(findArchiveBytes(track, 'nope.brres')).toBeNull();
    expect(findArchiveBytes(null, 'course_model.brres')).toBeNull();
  });
});

describe('toSceneArchivePath', () => {
  it('adds the renderer’s ./ prefix exactly once', () => {
    expect(toSceneArchivePath('course_model.brres')).toBe('./course_model.brres');
    expect(toSceneArchivePath('./course_model.brres')).toBe('./course_model.brres');
  });
});

describe('buildAnimationRows', () => {
  const parsed: VisualAnimationInfo[] = [
    { kind: 'srt0', name: 'course', duration: 120, loopMode: 1, loops: true },
    { kind: 'pat0', name: 'blink', duration: 30, loopMode: 0, loops: false },
    { kind: 'scn0', name: 'lights', duration: 60, loopMode: 1, loops: true },
    { kind: 'clr0', name: 'unloaded', duration: 10, loopMode: 0, loops: false },
  ];

  it('takes enabled and togglable from the renderer, keeping the parsed list as the source of truth', () => {
    const rows = buildAnimationRows(parsed, [
      { kind: 'srt0', name: 'course', enabled: true, supported: true },
      { kind: 'pat0', name: 'blink', enabled: false, supported: true },
      { kind: 'scn0', name: 'lights', enabled: false, supported: false },
    ]);
    expect(rows.map((row) => [row.name, row.enabled, row.togglable])).toEqual([
      ['course', true, true],
      ['blink', false, true],
      ['lights', false, false],
      // Not reported by the renderer at all: the archive is not loaded in the viewport.
      ['unloaded', false, false],
    ]);
  });

  it('does not confuse two animations that share a name across kinds', () => {
    const rows = buildAnimationRows(
      [
        { kind: 'srt0', name: 'same', duration: 1, loopMode: 1, loops: true },
        { kind: 'clr0', name: 'same', duration: 1, loopMode: 1, loops: true },
      ],
      [{ kind: 'clr0', name: 'same', enabled: true, supported: true }],
    );
    expect(rows.map((row) => [row.kind, row.enabled])).toEqual([
      ['srt0', false],
      ['clr0', true],
    ]);
  });

  it('reports the longest animation as the scrubber range', () => {
    expect(maxAnimationFrames(parsed)).toBe(120);
    expect(maxAnimationFrames([])).toBe(0);
    expect(maxAnimationFrames([{ kind: 'srt0', name: 'a', duration: 59.4, loopMode: 1, loops: true }])).toBe(60);
  });
});

describe('formatting helpers', () => {
  it('sums the archive’s texture bytes', () => {
    const archive = {
      textures: [{ byteLength: 100 }, { byteLength: 24 }],
    } as unknown as VisualArchiveInfo;
    expect(sumTextureBytes(archive)).toBe(124);
  });

  it('scales byte sizes to something readable', () => {
    expect(formatByteSize(512)).toBe('512 B');
    expect(formatByteSize(2048)).toBe('2.0 KB');
    expect(formatByteSize(1024 * 200)).toBe('200 KB');
    expect(formatByteSize(1024 * 1024 * 3)).toBe('3.0 MB');
  });

  it('labels every animation kind in the authors language', () => {
    expect(animationKindLabel('srt0')).toBe('Texture movement');
    expect(animationKindLabel('vis0')).toBe('Visibility');
  });
});

/** Records what `applyVisualRenderSettings` asked the renderer to do. */
function makeRecordingScene() {
  const calls: Array<[string, unknown]> = [];
  const scene: VisualRendererScene = {
    setEditorTexturesEnabled: (value) => calls.push(['textures', value]),
    setEditorVertexColorsEnabled: (value) => calls.push(['vertexColors', value]),
    setEditorLightingEnabled: (value) => calls.push(['lighting', value]),
    setEditorBloomEnabled: (value) => calls.push(['bloom', value]),
    setEditorDOFMode: (value) => calls.push(['dof', value]),
    setEditorWireframe: (value) => (calls.push(['wireframe', value]), true),
    setEditorObjectPreviewsVisible: (value) => calls.push(['objects', value]),
    setEditorSceneModelVisible: (path, value) => (calls.push([`model:${path}`, value]), true),
  };
  return { scene, calls };
}

describe('applyVisualRenderSettings', () => {
  it('pushes every setting at the renderer, and the skybox toggle at the vrcorn archive', () => {
    const { scene, calls } = makeRecordingScene();
    const settings: VisualRenderSettings = { ...defaultVisualRenderSettings, lighting: false, depthOfField: true };
    applyVisualRenderSettings(scene, settings, './vrcorn_model.brres');
    expect(Object.fromEntries(calls)).toEqual({
      textures: true,
      vertexColors: true,
      lighting: false,
      bloom: true,
      dof: 'full',
      wireframe: false,
      objects: true,
      'model:./vrcorn_model.brres': true,
    });
  });

  it('turns depth of field off rather than to a reduced mode when it is unchecked', () => {
    const { scene, calls } = makeRecordingScene();
    applyVisualRenderSettings(scene, { ...defaultVisualRenderSettings, depthOfField: false }, './vrcorn_model.brres');
    expect(calls).toContainEqual(['dof', 'off']);
  });

  it('does nothing without a scene', () => {
    expect(() => applyVisualRenderSettings(null, defaultVisualRenderSettings, './vrcorn_model.brres')).not.toThrow();
  });

  it('tolerates a renderer that implements none of the visual API', () => {
    expect(() => applyVisualRenderSettings({}, defaultVisualRenderSettings, './vrcorn_model.brres')).not.toThrow();
  });
});

describe('visual presets', () => {
  it('recognises the game look as the default', () => {
    const game = visualPresets.find((preset) => preset.id === 'game')!;
    expect(matchesVisualPreset(defaultVisualRenderSettings, game)).toBe(true);
  });

  it('matches only the keys the preset pins down, so unrelated toggles do not break the match', () => {
    const flat = visualPresets.find((preset) => preset.id === 'flat')!;
    const settings = { ...defaultVisualRenderSettings, ...flat.settings } as VisualRenderSettings;
    expect(matchesVisualPreset(settings, flat)).toBe(true);
    // `objects` is not part of any preset.
    expect(matchesVisualPreset({ ...settings, objects: false }, flat)).toBe(true);
    expect(matchesVisualPreset({ ...settings, lighting: true }, flat)).toBe(false);
  });

  it('has exactly one preset matching the wireframe look', () => {
    const wireframe = visualPresets.find((preset) => preset.id === 'wireframe')!;
    const settings = { ...defaultVisualRenderSettings, ...wireframe.settings } as VisualRenderSettings;
    expect(visualPresets.filter((preset) => matchesVisualPreset(settings, preset)).map((preset) => preset.id)).toEqual(['wireframe']);
  });
});
