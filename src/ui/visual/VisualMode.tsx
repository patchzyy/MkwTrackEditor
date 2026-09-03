import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { replaceArchiveFile } from '../../lib/track';
import { getTrackPostEffectResources } from '../inspector/postEffectResources';
import { usePostEffectActions } from '../state/usePostEffectActions';
import type { EditorModeContext, ModeUi } from '../modes/types';
import { VisualInspector } from './VisualInspector';
import { VisualOutliner } from './VisualOutliner';
import { VisualRenderOverlay } from './VisualRenderOverlay';
import { useVisualArchive } from './useVisualArchive';
import {
  applyTextureReplacement,
  buildTextureReplacement,
  exportTextureAsPng,
  readImageFile,
  type BuildReplacementOptions,
} from './textureReplace';
import {
  buildAnimationRows,
  findArchiveBytes,
  listVisualArchivePaths,
  maxAnimationFrames,
  toSceneArchivePath,
  type VisualAnimationRow,
  type VisualSelection,
  type VisualTextureInfo,
} from './visualArchive';
import {
  applyVisualRenderSettings,
  defaultVisualRenderSettings,
  type VisualRendererScene,
  type VisualRenderSettings,
  type VisualSceneAnimation,
  type VisualSceneCapabilities,
  type VisualSceneModel,
} from './visualScene';
import './visual.css';

/** The archive the renderer draws as the skybox; the "Skybox" toggle maps onto its visibility. */
const SKYBOX_SCENE_PATH = './vrcorn_model.brres';

/**
 * Visual mode: the non-KMP look of the track — the course, skybox and minimap BRRES archives,
 * their materials and textures, their SRT0/PAT0/CLR0/CHR0/VIS0 animations, and the `posteffect/`
 * bloom, depth-of-field, fog and lighting files. Owns everything under `src/ui/visual/`.
 *
 * Every KMP overlay is hidden while the mode is active (`showKmpEditorOverlay: false`), so what
 * the viewport shows is what the game would draw. The renderer side of this lives in the Visual
 * mode region of `vendor/noclip.website/src/MarioKartWii/Scenes_MarioKartWii.ts`, reached through
 * the structural `VisualRendererScene` interface in `./visualScene.ts`.
 */
export function useVisualMode(ctx: EditorModeContext): ModeUi {
  const active = ctx.editorMode === 'visual';
  const { track, history, selection, setStatus } = ctx;

  const sceneRef = useRef<VisualRendererScene | null>(null);
  // Bumped whenever the renderer's own state changes, so the panels re-read it.
  const [sceneVersion, setSceneVersion] = useState(0);
  const [archivePath, setArchivePath] = useState<string | null>(null);
  const [visualSelection, setVisualSelection] = useState<VisualSelection>(null);
  const [settings, setSettings] = useState<VisualRenderSettings>(defaultVisualRenderSettings);
  const [hiddenModels, setHiddenModels] = useState<Record<string, boolean>>({});
  const [animationsPlaying, setAnimationsPlaying] = useState(true);
  const [animationFrame, setAnimationFrame] = useState<number | null>(null);
  const [textureRevision, setTextureRevision] = useState(0);

  const archivePaths = useMemo(() => listVisualArchivePaths(track), [track]);
  const effectivePath = archivePath !== null && archivePaths.includes(archivePath) ? archivePath : (archivePaths[0] ?? null);
  const archiveBytes = useMemo(
    () => (effectivePath ? findArchiveBytes(track, effectivePath) : null),
    [track, effectivePath],
  );
  const { archive, loading } = useVisualArchive(active ? effectivePath : null, active ? archiveBytes : null);

  const postEffectResources = useMemo(() => getTrackPostEffectResources(track), [track]);
  const postEffectActions = usePostEffectActions({ track, postEffectResources, selection, history, setStatus });

  /** The track's `posteffect/*` files as they stand right now, for the live-preview effect. */
  const postEffectFiles = useMemo(
    () =>
      (track?.archiveEntries ?? [])
        .filter((entry) => entry.type === 'file' && /^posteffect\//i.test(entry.path) && entry.data)
        .map((entry) => ({ path: entry.path, data: entry.data as Uint8Array })),
    [track?.archiveEntries],
  );
  const postEffectFilesRef = useRef(postEffectFiles);
  postEffectFilesRef.current = postEffectFiles;
  // What the renderer has already been given, so a scene load is not immediately undone by a
  // redundant re-apply of the very files the scene just parsed.
  const appliedPostEffectsRef = useRef(new Map<string, Uint8Array>());

  const onVisualSceneChange = useCallback((scene: VisualRendererScene | null) => {
    sceneRef.current = scene;
    appliedPostEffectsRef.current = new Map(postEffectFilesRef.current.map((file) => [file.path, file.data]));
    setSceneVersion((version) => version + 1);
  }, []);

  // Renderer state, re-read whenever the scene or one of our mutations changes it.
  const sceneModels = useMemo<VisualSceneModel[]>(
    () => (active ? (sceneRef.current?.listEditorSceneModels?.() ?? []) : []),
    [active, sceneVersion],
  );
  // The checkboxes follow this hook's own state rather than the renderer's, so a click shows
  // immediately instead of waiting for the next time the renderer state is re-read.
  const displayModels = useMemo<VisualSceneModel[]>(
    () =>
      sceneModels.map((model) => ({
        ...model,
        visible: model.archivePath === SKYBOX_SCENE_PATH ? settings.skybox : hiddenModels[model.archivePath] !== true,
      })),
    [sceneModels, settings.skybox, hiddenModels],
  );
  const capabilities = useMemo<VisualSceneCapabilities | null>(
    () => (active ? (sceneRef.current?.getEditorVisualCapabilities?.() ?? null) : null),
    [active, sceneVersion],
  );
  const liveAnimations = useMemo<VisualSceneAnimation[]>(
    () => (active && effectivePath ? (sceneRef.current?.listEditorAnimations?.(toSceneArchivePath(effectivePath)) ?? []) : []),
    [active, effectivePath, sceneVersion],
  );
  const animations = useMemo<VisualAnimationRow[]>(
    () => buildAnimationRows(archive?.animations ?? [], liveAnimations),
    [archive, liveAnimations],
  );
  const animationLength = useMemo(() => maxAnimationFrames(archive?.animations ?? []), [archive]);

  // Push the render toggles at the renderer. Re-runs after a scene (re)load so a freshly built
  // scene comes up looking the way the author left it.
  useEffect(() => {
    if (!active) return;
    applyVisualRenderSettings(sceneRef.current, settings, SKYBOX_SCENE_PATH);
  }, [active, settings, sceneVersion]);

  // Per-model visibility, which is independent of the render toggles.
  useEffect(() => {
    if (!active) return;
    const scene = sceneRef.current;
    if (!scene) return;
    for (const model of scene.listEditorSceneModels?.() ?? []) {
      if (model.archivePath === SKYBOX_SCENE_PATH) continue;
      const shouldBeVisible = hiddenModels[model.archivePath] !== true;
      if (model.visible !== shouldBeVisible) scene.setEditorSceneModelVisible?.(model.archivePath, shouldBeVisible);
    }
  }, [active, hiddenModels, sceneVersion]);

  // Live preview for the post-effect editor: the scene is not rebuilt when an archive file
  // changes (its key is the source track), so edited `posteffect/*` files are pushed in directly.
  useEffect(() => {
    if (!active) return;
    const scene = sceneRef.current;
    if (!scene?.applyEditorPostEffectFile) return;
    let changed = false;
    for (const file of postEffectFiles) {
      if (appliedPostEffectsRef.current.get(file.path) === file.data) continue;
      appliedPostEffectsRef.current.set(file.path, file.data);
      if (scene.applyEditorPostEffectFile(file.path, file.data)) changed = true;
    }
    if (changed) setSceneVersion((version) => version + 1);
  }, [active, postEffectFiles, sceneVersion]);

  // Leaving Visual mode puts the viewport back to the plain game look, so the other modes are not
  // left staring at a wireframe someone switched on here.
  useEffect(() => {
    if (active) return;
    applyVisualRenderSettings(sceneRef.current, defaultVisualRenderSettings, SKYBOX_SCENE_PATH);
    sceneRef.current?.setEditorAnimationsPlaying?.(true);
    sceneRef.current?.setEditorSceneTimeFrames?.(null);
  }, [active]);

  const changeSettings = useCallback((patch: Partial<VisualRenderSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const setModelVisible = useCallback(
    (sceneArchivePath: string, visible: boolean) => {
      if (sceneArchivePath === SKYBOX_SCENE_PATH) {
        changeSettings({ skybox: visible });
        return;
      }
      setHiddenModels((current) => ({ ...current, [sceneArchivePath]: !visible }));
    },
    [changeSettings],
  );

  const setAnimationEnabled = useCallback(
    (row: VisualAnimationRow, enabled: boolean) => {
      if (!effectivePath) return;
      const applied = sceneRef.current?.setEditorAnimationEnabled?.(toSceneArchivePath(effectivePath), row.kind, row.name, enabled);
      if (applied) {
        setSceneVersion((version) => version + 1);
        setStatus(`${enabled ? 'Playing' : 'Stopped'} ${row.name}.`);
      }
    },
    [effectivePath, setStatus],
  );

  const setPlaying = useCallback((playing: boolean) => {
    const scene = sceneRef.current;
    setAnimationsPlaying(playing);
    if (playing) {
      // Resuming also releases the scrubber, otherwise the clock stays pinned to one frame.
      scene?.setEditorSceneTimeFrames?.(null);
      setAnimationFrame(null);
      scene?.setEditorAnimationsPlaying?.(true);
      return;
    }
    scene?.setEditorAnimationsPlaying?.(false);
    const frame = scene?.getEditorSceneTimeFrames?.();
    setAnimationFrame(Number.isFinite(frame) ? Math.round(frame as number) : 0);
  }, []);

  const scrubAnimations = useCallback((frame: number | null) => {
    const scene = sceneRef.current;
    if (frame === null) {
      scene?.setEditorSceneTimeFrames?.(null);
      scene?.setEditorAnimationsPlaying?.(true);
      setAnimationsPlaying(true);
      setAnimationFrame(null);
      return;
    }
    scene?.setEditorAnimationsPlaying?.(false);
    scene?.setEditorSceneTimeFrames?.(frame);
    setAnimationsPlaying(false);
    setAnimationFrame(frame);
  }, []);

  const replaceTexture = useCallback(
    async (texture: VisualTextureInfo, file: File, options: BuildReplacementOptions): Promise<string[]> => {
      const currentTrack = track;
      if (!currentTrack || !effectivePath) throw new Error('Load a track before replacing a texture.');
      const bytes = findArchiveBytes(currentTrack, effectivePath);
      if (!bytes) throw new Error(`${effectivePath} is not in this track any more.`);

      const image = await readImageFile(file);
      const replacement = buildTextureReplacement(image, texture, options);
      const nextBytes = applyTextureReplacement(bytes, texture.name, replacement);
      history.applyEditorChange(
        replaceArchiveFile(currentTrack, effectivePath, nextBytes),
        selection.selectedIdRef.current,
        true,
        selection.selectedIdsRef.current,
      );

      const notes = [...replacement.notes];
      const live = sceneRef.current?.reloadEditorTexture?.(texture.name, {
        format: replacement.format,
        width: replacement.width,
        height: replacement.height,
        mipCount: replacement.mipCount,
        data: replacement.pixelData,
      });
      if (live !== true) {
        notes.push('The viewport keeps the old pixels until the track is reloaded — it can only swap a texture in place at its original size and format.');
      }
      setTextureRevision((revision) => revision + 1);
      setStatus(`Replaced ${texture.name} with ${file.name}.`);
      return notes;
    },
    [track, effectivePath, history, selection, setStatus],
  );

  const exportTexture = useCallback(
    async (texture: VisualTextureInfo) => {
      if (!archiveBytes) throw new Error('This archive is not loaded.');
      await exportTextureAsPng(archiveBytes, texture);
      setStatus(`Saved ${texture.name}.png.`);
    },
    [archiveBytes, setStatus],
  );

  if (!active) return {};

  return {
    viewportProps: {
      mode: 'visual',
      showKmpEditorOverlay: false,
      onVisualSceneChange,
    },
    leftPanel: (
      <VisualOutliner
        archivePaths={archivePaths}
        archivePath={effectivePath}
        onSelectArchive={(path) => {
          setArchivePath(path);
          setVisualSelection(null);
        }}
        archive={archive}
        archiveBytes={archiveBytes}
        loading={loading}
        textureRevision={textureRevision}
        sceneModels={displayModels}
        animations={animations}
        selection={visualSelection}
        onSelect={setVisualSelection}
        onSetModelVisible={setModelVisible}
        onSetAnimationEnabled={setAnimationEnabled}
        animationsPlaying={animationsPlaying}
        animationFrame={animationFrame}
        animationLength={animationLength}
        onSetAnimationsPlaying={setPlaying}
        onScrubAnimations={scrubAnimations}
      />
    ),
    inspector: (
      <VisualInspector
        archive={archive}
        archiveBytes={archiveBytes}
        textureRevision={textureRevision}
        loading={loading}
        selection={visualSelection}
        onSelect={setVisualSelection}
        animations={animations}
        onSetAnimationEnabled={setAnimationEnabled}
        onReplaceTexture={replaceTexture}
        onExportTexture={exportTexture}
        postEffectResources={postEffectResources}
        postEffectActions={postEffectActions}
      />
    ),
    topRightOverlay: (
      <VisualRenderOverlay settings={settings} onChange={changeSettings} capabilities={capabilities} hasScene={sceneRef.current !== null} />
    ),
  };
}
