import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listModelNames, listModelSlots } from '../../lib/materialSlots';
import type { SurfaceHighlight, SurfacePick, SurfacePickingOptions, SurfaceRendererScene } from '../../lib/surfacePick';
import {
  assignDrawOpMaterial,
  ensureTrackLocalArchive,
  findTrackArchiveEntry,
  replaceArchiveFile,
  resolveArchiveBytes,
} from '../../lib/track';
import type { EditorModeContext, ModeBottomDock, ModeUi } from '../modes/types';
import { usePostEffectActions } from '../state/usePostEffectActions';
import { EnvironmentPanel, type AnimationGroup } from './EnvironmentPanel';
import { MaterialsDock, type MaterialsDockTab } from './MaterialsDock';
import { VisualDetails, type SlotView } from './VisualDetails';
import { VisualRenderOverlay } from './VisualRenderOverlay';
import { useEnvironment } from './useEnvironment';
import { useVisualArchive } from './useVisualArchive';
import {
  applyTextureReplacement,
  buildTextureReplacement,
  exportTextureAsPng,
  readImageFile,
  type BuildReplacementOptions,
} from './textureReplace';
import {
  listVisualArchivePaths,
  toSceneArchivePath,
  type VisualMaterialInfo,
  type VisualModelInfo,
  type VisualTextureInfo,
} from './visualArchive';
import {
  applyVisualRenderSettings,
  defaultVisualRenderSettings,
  type VisualRendererScene,
  type VisualRenderSettings,
  type VisualSceneAnimation,
  type VisualSceneModel,
} from './visualScene';
import './visual.css';

/** The archive the renderer draws as the skybox; the "Show sky" switch maps onto its visibility. */
const SKYBOX_SCENE_PATH = './vrcorn_model.brres';

const stripDot = (path: string) => path.replace(/^\.\//, '');

type SceneWithSurfaces = VisualRendererScene & SurfaceRendererScene;

/**
 * Visual mode: how the track looks. Left, the Environment panel (lighting, fog, glow and looks);
 * right, the Details of the surface you clicked (its materials) or of a texture picked below;
 * bottom, the Materials browser, where a click gives the active slot a new material.
 *
 * Materials are only browsed and assigned here. Editing one is the Material tab's job.
 * Owns everything under `src/ui/visual/`; the renderer side is in the Visual mode region of
 * `vendor/noclip.website/src/MarioKartWii/Scenes_MarioKartWii.ts`, reached through the
 * structural `VisualRendererScene` and `SurfaceRendererScene` interfaces.
 */
export function useVisualMode(ctx: EditorModeContext): ModeUi {
  const active = ctx.editorMode === 'visual';
  const { track, trackRef, history, selection, setStatus, commonArchive, refreshScene } = ctx;

  const sceneRef = useRef<SceneWithSurfaces | null>(null);
  // Bumped whenever the renderer's own state changes, so the panels re-read it.
  const [sceneVersion, setSceneVersion] = useState(0);
  const [archivePath, setArchivePath] = useState<string | null>(null);
  const [settings, setSettings] = useState<VisualRenderSettings>(defaultVisualRenderSettings);
  const [hiddenModels, setHiddenModels] = useState<Record<string, boolean>>({});
  const [animationsPlaying, setAnimationsPlaying] = useState(true);
  const [animationFrame, setAnimationFrame] = useState<number | null>(null);
  const [textureRevision, setTextureRevision] = useState(0);
  const [dockTab, setDockTab] = useState<MaterialsDockTab>('materials');
  const [selectedTexture, setSelectedTexture] = useState<string | null>(null);

  // The clicked surface and which of its slots the dock will fill.
  const [surface, setSurface] = useState<SurfacePick | null>(null);
  const [activeDrawOp, setActiveDrawOp] = useState<number | null>(null);
  const [hoverDrawOp, setHoverDrawOp] = useState<number | null>(null);
  const [browsedMaterial, setBrowsedMaterial] = useState<{ modelName: string; materialIndex: number } | null>(null);
  const dockRef = useRef<ModeBottomDock | null>(null);

  const env = useEnvironment({ track, trackRef, history, selection, setStatus });
  const postEffectActions = usePostEffectActions({ track, postEffectResources: env.resources, selection, history, setStatus });

  // --- which archive the dock and Details are looking at ---------------------------------------

  const archivePaths = useMemo(() => listVisualArchivePaths(track), [track]);
  const effectivePath = archivePath !== null && archivePaths.includes(archivePath) ? archivePath : (archivePaths[0] ?? null);
  const surfaceBrowsable = surface !== null && surface.kind !== 'placed';
  const scopePath = surfaceBrowsable ? stripDot(surface.archivePath) : effectivePath;
  const scopeBytes = useMemo(() => {
    if (!track || !scopePath) return null;
    if (surfaceBrowsable) return resolveArchiveBytes(track, commonArchive, surface.archivePath)?.bytes ?? null;
    return findTrackArchiveEntry(track, scopePath)?.data ?? null;
    // `surface` only matters through its archive path here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, commonArchive, scopePath, surfaceBrowsable]);
  const { archive, loading } = useVisualArchive(active ? scopePath : null, active ? scopeBytes : null);

  // --- renderer state ----------------------------------------------------------------------------

  /** What the renderer has already been given, so a scene load is not undone by a redundant re-apply. */
  const appliedPostEffectsRef = useRef(new Map<string, Uint8Array>());
  const postEffectFilesRef = useRef(env.effectiveFiles);
  postEffectFilesRef.current = env.effectiveFiles;
  /** The archive bytes the live scene reflects after our material swaps, to follow undo and redo. */
  const sceneBytesRef = useRef(new Map<string, Uint8Array>());

  const onVisualSceneChange = useCallback((scene: VisualRendererScene | null) => {
    sceneRef.current = scene as SceneWithSurfaces | null;
    appliedPostEffectsRef.current = new Map(postEffectFilesRef.current.map((file) => [file.path, file.data]));
    sceneBytesRef.current = new Map();
    setSceneVersion((version) => version + 1);
  }, []);

  const sceneModels = useMemo<VisualSceneModel[]>(
    () => (active ? (sceneRef.current?.listEditorSceneModels?.() ?? []) : []),
    [active, sceneVersion],
  );
  // The switches follow this hook's own state rather than the renderer's, so a click shows
  // immediately instead of waiting for the next time the renderer state is re-read.
  const displayModels = useMemo<VisualSceneModel[]>(
    () =>
      sceneModels.map((model) => ({
        ...model,
        visible: model.archivePath === SKYBOX_SCENE_PATH ? settings.skybox : hiddenModels[model.archivePath] !== true,
      })),
    [sceneModels, settings.skybox, hiddenModels],
  );
  const animationGroups = useMemo<AnimationGroup[]>(() => {
    if (!active) return [];
    const scene = sceneRef.current;
    return displayModels
      .filter((model) => model.kind !== 'imported')
      .map((model) => ({
        archivePath: model.archivePath,
        label: stripDot(model.archivePath),
        rows: scene?.listEditorAnimations?.(model.archivePath) ?? [],
      }))
      .filter((group) => group.rows.length > 0);
  }, [active, displayModels, sceneVersion]);
  const animationLength = useMemo(
    () => animationGroups.reduce((longest, group) => Math.max(longest, ...group.rows.map((row) => row.duration)), 0),
    [animationGroups],
  );

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

  // Live preview for the Environment panel. The scene is not rebuilt when an archive file
  // changes (its key is the source track), so edited and drafted `posteffect/*` files are pushed
  // in directly. While a slider is dragged the draft is what lands here, frame by frame.
  useEffect(() => {
    if (!active) return;
    const scene = sceneRef.current;
    if (!scene?.applyEditorPostEffectFile) return;
    let changed = false;
    for (const file of env.effectiveFiles) {
      if (appliedPostEffectsRef.current.get(file.path) === file.data) continue;
      appliedPostEffectsRef.current.set(file.path, file.data);
      if (scene.applyEditorPostEffectFile(file.path, file.data)) changed = true;
    }
    if (changed) setSceneVersion((version) => version + 1);
  }, [active, env.effectiveFiles, sceneVersion]);

  // Leaving Visual mode puts the viewport back to the plain game look, so the other modes are not
  // left staring at a wireframe someone switched on here.
  useEffect(() => {
    if (active) return;
    applyVisualRenderSettings(sceneRef.current, defaultVisualRenderSettings, SKYBOX_SCENE_PATH);
    sceneRef.current?.setEditorAnimationsPlaying?.(true);
    sceneRef.current?.setEditorSceneTimeFrames?.(null);
    env.discard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // A different track starts with a clean selection.
  const trackKey = track ? `${track.sourceId ?? ''}|${track.fileName}` : '';
  useEffect(() => {
    setSurface(null);
    setActiveDrawOp(null);
    setSelectedTexture(null);
    setBrowsedMaterial(null);
    setArchivePath(null);
  }, [trackKey]);

  // Undo and redo change archive bytes behind the live scene's back. For the archives we have
  // swapped materials in, follow the track: hot swap whatever differs, or rebuild if the draw
  // lists no longer line up.
  useEffect(() => {
    if (!active || !track) return;
    const scene = sceneRef.current;
    if (!scene) return;
    for (const [key, shown] of [...sceneBytesRef.current]) {
      const entry = findTrackArchiveEntry(track, key);
      const now = entry?.data;
      if (!entry || !now || now === shown) continue;
      sceneBytesRef.current.set(key, now);
      let rebuild = false;
      try {
        const sceneKey = toSceneArchivePath(entry.path);
        const names = new Set([...modelNamesOf(shown), ...modelNamesOf(now)]);
        for (const modelName of names) {
          const before = listModelSlots(shown, modelName);
          const after = listModelSlots(now, modelName);
          if (before.length !== after.length || before.some((slot, i) => slot.pass !== after[i].pass)) {
            rebuild = true;
            break;
          }
          for (let i = 0; i < after.length; i++) {
            if (before[i].materialIndex === after[i].materialIndex) continue;
            if (!scene.setEditorDrawOpMaterial?.(sceneKey, modelName, i, after[i].materialIndex)) rebuild = true;
          }
        }
      } catch {
        rebuild = true;
      }
      if (rebuild) {
        sceneBytesRef.current.clear();
        refreshScene();
        break;
      }
    }
  }, [active, track, refreshScene]);

  // --- render toggles, visibility, animations ---------------------------------------------------

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
    (sceneArchivePath: string, row: VisualSceneAnimation, enabled: boolean) => {
      const applied = sceneRef.current?.setEditorAnimationEnabled?.(sceneArchivePath, row.kind, row.name, enabled);
      if (applied) {
        setSceneVersion((version) => version + 1);
        setStatus(`${enabled ? 'Playing' : 'Stopped'} ${row.name}.`);
      }
    },
    [setStatus],
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

  // --- textures ----------------------------------------------------------------------------------

  const replaceTexture = useCallback(
    async (texture: VisualTextureInfo, file: File, options: BuildReplacementOptions): Promise<string[]> => {
      const currentTrack = track;
      if (!currentTrack || !scopePath) throw new Error('Load a track before replacing a texture.');
      // A model from the game's shared files is copied into the track first, so the edit exports.
      const local = ensureTrackLocalArchive(currentTrack, commonArchive, scopePath);
      const bytes = findTrackArchiveEntry(local.track, local.path)?.data;
      if (!bytes) throw new Error(`${scopePath} is not in this track any more.`);

      const image = await readImageFile(file);
      const replacement = buildTextureReplacement(image, texture, options);
      const nextBytes = applyTextureReplacement(bytes, texture.name, replacement);
      history.applyEditorChange(
        replaceArchiveFile(local.track, local.path, nextBytes),
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
        notes.push('The viewport keeps the old pixels until the track is refreshed. It can only swap a texture in place at its original size and format.');
      }
      setTextureRevision((revision) => revision + 1);
      setStatus(`Replaced ${texture.name} with ${file.name}.`);
      return notes;
    },
    [track, commonArchive, scopePath, history, selection, setStatus],
  );

  const exportTexture = useCallback(
    async (texture: VisualTextureInfo) => {
      if (!scopeBytes) throw new Error('This file is not loaded.');
      await exportTextureAsPng(scopeBytes, texture);
      setStatus(`Saved ${texture.name}.png.`);
    },
    [scopeBytes, setStatus],
  );

  // --- the clicked surface and its slots ---------------------------------------------------------

  const allSlots = useMemo(() => {
    if (!active || !surfaceBrowsable || !scopeBytes) return [];
    try {
      return listModelSlots(scopeBytes, surface.modelName);
    } catch {
      return [];
    }
    // The surface is identified by its model; a new pick of the same model reuses the parse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, surfaceBrowsable, scopeBytes, surface?.modelName]);

  /** A track model has hundreds of meshes, so a click shows that mesh; an object shows every slot. */
  const visibleSlots = useMemo(
    () => (surfaceBrowsable && surface.kind === 'course' ? allSlots.filter((slot) => slot.shapeIndex === surface.shapeIndex) : allSlots),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allSlots, surfaceBrowsable, surface?.kind, surface?.shapeIndex],
  );
  const effectiveActive = visibleSlots.find((slot) => slot.drawOpIndex === activeDrawOp) ?? visibleSlots.find((slot) => slot.drawOpIndex === surface?.drawOpIndex) ?? visibleSlots[0] ?? null;

  const slotViews = useMemo<SlotView[]>(() => {
    const model = archive?.models.find((candidate) => candidate.name === surface?.modelName);
    return visibleSlots.map((slot) => ({
      drawOpIndex: slot.drawOpIndex,
      shapeName: slot.shapeName,
      materialIndex: slot.materialIndex,
      materialName: slot.materialName,
      info: model?.materials.find((material) => material.index === slot.materialIndex && material.name === slot.materialName) ?? model?.materials.find((material) => material.name === slot.materialName) ?? null,
    }));
  }, [archive, surface?.modelName, visibleSlots]);

  const pickSurface = useCallback((pick: SurfacePick | null) => {
    setSurface(pick);
    setActiveDrawOp(pick ? pick.drawOpIndex : null);
    setHoverDrawOp(null);
    setBrowsedMaterial(null);
    if (pick) setSelectedTexture(null);
  }, []);

  const clearSurface = useCallback(() => pickSurface(null), [pickSurface]);

  const activateSlot = useCallback((drawOpIndex: number) => {
    setActiveDrawOp(drawOpIndex);
    setDockTab('materials');
    if (dockRef.current && !dockRef.current.open) dockRef.current.onToggleOpen();
  }, []);

  const assignMaterial = useCallback(
    (model: VisualModelInfo, material: VisualMaterialInfo) => {
      if (!track || !surface || !effectiveActive) return;
      if (model.name !== surface.modelName) return;
      let result;
      try {
        result = assignDrawOpMaterial(track, commonArchive, {
          archivePath: surface.archivePath,
          modelName: surface.modelName,
          drawOpIndex: effectiveActive.drawOpIndex,
          materialIndex: material.index,
        });
      } catch (error) {
        setStatus(`Could not change the material: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      if (!result.changed) {
        setStatus(`That mesh already uses ${material.name}.`);
        return;
      }
      history.applyEditorChange(result.track, selection.selectedIdRef.current, true, selection.selectedIdsRef.current);
      const swapped = sceneRef.current?.setEditorDrawOpMaterial?.(surface.archivePath, surface.modelName, effectiveActive.drawOpIndex, material.index) === true;
      if (swapped) sceneBytesRef.current.set(result.path.replace(/^\.\//, '').toLowerCase(), result.bytes);
      else {
        sceneBytesRef.current.clear();
        refreshScene();
      }
      setSurface({ ...surface, drawOpIndex: result.drawOpIndex, materialIndex: material.index, materialName: material.name, source: 'track' });
      setActiveDrawOp(result.drawOpIndex);
      setTextureRevision((revision) => revision + 1);
      setStatus(`Changed the material of ${surface.shapeName || surface.modelName} to ${material.name}.`);
    },
    [track, surface, effectiveActive, commonArchive, history, selection, setStatus, refreshScene],
  );

  const pickMaterial = useCallback(
    (model: VisualModelInfo, material: VisualMaterialInfo) => {
      if (surfaceBrowsable && effectiveActive) {
        assignMaterial(model, material);
        return;
      }
      // Nothing to give it to: just show where it is used.
      setBrowsedMaterial((current) =>
        current?.modelName === model.name && current.materialIndex === material.index ? null : { modelName: model.name, materialIndex: material.index },
      );
    },
    [assignMaterial, effectiveActive, surfaceBrowsable],
  );

  const highlight = useMemo<SurfaceHighlight[] | null>(() => {
    if (!active) return null;
    const out: SurfaceHighlight[] = [];
    if (surfaceBrowsable && surface) {
      if (effectiveActive) out.push({ kind: 'surface', archivePath: surface.archivePath, modelName: surface.modelName, drawOpIndex: effectiveActive.drawOpIndex, style: 'selected' });
      if (hoverDrawOp !== null && hoverDrawOp !== effectiveActive?.drawOpIndex) {
        out.push({ kind: 'surface', archivePath: surface.archivePath, modelName: surface.modelName, drawOpIndex: hoverDrawOp, style: 'hover' });
      }
    } else if (browsedMaterial && scopePath) {
      const model = archive?.models.find((candidate) => candidate.name === browsedMaterial.modelName);
      const material = model?.materials.find((candidate) => candidate.index === browsedMaterial.materialIndex);
      if (material) out.push({ kind: 'material', archivePath: toSceneArchivePath(scopePath), modelName: browsedMaterial.modelName, materialName: material.name, style: 'selected' });
    }
    return out;
  }, [active, surfaceBrowsable, surface, effectiveActive, hoverDrawOp, browsedMaterial, scopePath, archive]);

  const surfacePicking = useMemo<SurfacePickingOptions | null>(
    () => (active ? { onPick: pickSurface, highlight, includeSkybox: true } : null),
    [active, pickSurface, highlight],
  );

  if (!active) return {};

  const selectedTextureInfo = selectedTexture ? (archive?.textures.find((texture) => texture.name === selectedTexture) ?? null) : null;
  const assigning = surfaceBrowsable && effectiveActive !== null;
  const readOnlyReason =
    surface?.kind === 'placed'
      ? 'This is a model you placed in Model mode. Its materials are changed there.'
      : null;

  return {
    viewportProps: {
      mode: 'visual',
      showKmpEditorOverlay: false,
      onVisualSceneChange,
      surfacePicking,
    },
    leftPanel: (
      <EnvironmentPanel
        env={env}
        hasTrack={track !== null}
        hasScene={sceneRef.current !== null}
        settings={settings}
        onChangeSettings={changeSettings}
        models={displayModels}
        onSetModelVisible={setModelVisible}
        animationGroups={animationGroups}
        animationsPlaying={animationsPlaying}
        animationFrame={animationFrame}
        animationLength={animationLength}
        onSetAnimationsPlaying={setPlaying}
        onScrubAnimations={scrubAnimations}
        onSetAnimationEnabled={setAnimationEnabled}
        postEffectActions={postEffectActions}
      />
    ),
    inspector: (
      <VisualDetails
        hasTrack={track !== null}
        surface={surface}
        slots={slotViews}
        activeDrawOp={effectiveActive?.drawOpIndex ?? null}
        onActivateSlot={activateSlot}
        onHoverSlot={setHoverDrawOp}
        onClearSurface={clearSurface}
        onOpenMaterialEditor={
          surface && !readOnlyReason
            ? () =>
                ctx.openMaterialEditor(
                  effectiveActive
                    ? {
                        ...surface,
                        drawOpIndex: effectiveActive.drawOpIndex,
                        shapeIndex: effectiveActive.shapeIndex,
                        shapeName: effectiveActive.shapeName,
                        materialIndex: effectiveActive.materialIndex,
                        materialName: effectiveActive.materialName,
                      }
                    : surface,
                )
            : undefined
        }
        archive={archive}
        archiveBytes={scopeBytes}
        textureRevision={textureRevision}
        texture={selectedTextureInfo}
        textureProps={{ onReplace: replaceTexture, onExport: exportTexture, onClose: () => setSelectedTexture(null) }}
        resources={env.resources}
        readOnlyReason={readOnlyReason}
      />
    ),
    topRightOverlay: <VisualRenderOverlay settings={settings} onChange={changeSettings} hasScene={sceneRef.current !== null} />,
    bottomDock: (dock) => {
      dockRef.current = dock;
      return (
        <MaterialsDock
          dock={dock}
          tab={dockTab}
          onChangeTab={setDockTab}
          archivePaths={archivePaths}
          scopePath={scopePath}
          followingSurface={surfaceBrowsable}
          onSelectArchive={(path) => {
            setArchivePath(path);
            setBrowsedMaterial(null);
          }}
          archive={archive}
          archiveBytes={scopeBytes}
          loading={loading}
          textureRevision={textureRevision}
          modelFilter={surfaceBrowsable ? surface.modelName : null}
          currentMaterial={assigning && effectiveActive ? { modelName: surface.modelName, materialIndex: effectiveActive.materialIndex } : null}
          assigning={assigning}
          assigningLabel={assigning && effectiveActive ? (visibleSlots.length > 1 ? `slot ${visibleSlots.indexOf(effectiveActive) + 1}` : surface.shapeName || surface.modelName) : null}
          onPickMaterial={pickMaterial}
          browsedMaterial={browsedMaterial}
          selectedTexture={selectedTexture}
          onSelectTexture={setSelectedTexture}
        />
      );
    },
  };
}

function modelNamesOf(bytes: Uint8Array): string[] {
  try {
    return listModelNames(bytes);
  } catch {
    return [];
  }
}
