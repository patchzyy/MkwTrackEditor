import { useState } from 'react';
import { Pause, Play, SkipBack } from 'lucide-react';
import { TexturePreview } from './TexturePreview';
import { VisualGroup } from './VisualGroup';
import {
  animationKindLabel,
  formatByteSize,
  sumTextureBytes,
  type VisualAnimationRow,
  type VisualArchiveInfo,
  type VisualSelection,
} from './visualArchive';
import type { VisualSceneModel } from './visualScene';

export interface VisualOutlinerProps {
  /** Every `.brres` in the track, in "most interesting first" order. */
  archivePaths: string[];
  archivePath: string | null;
  onSelectArchive: (path: string) => void;
  archive: VisualArchiveInfo | null;
  archiveBytes: Uint8Array | null;
  loading: boolean;
  /** Bumped whenever the archive's textures change, to invalidate cached previews. */
  textureRevision: number;
  sceneModels: VisualSceneModel[];
  animations: VisualAnimationRow[];
  selection: VisualSelection;
  onSelect: (selection: VisualSelection) => void;
  onSetModelVisible: (sceneArchivePath: string, visible: boolean) => void;
  onSetAnimationEnabled: (row: VisualAnimationRow, enabled: boolean) => void;
  animationsPlaying: boolean;
  animationFrame: number | null;
  animationLength: number;
  onSetAnimationsPlaying: (playing: boolean) => void;
  onScrubAnimations: (frame: number | null) => void;
}

type GroupId = 'models' | 'materials' | 'textures' | 'animations' | 'effects';

/**
 * Left rail for Visual mode: the track's BRRES archives and, for the selected one, its models,
 * materials, textures and animations. Nothing here is KMP data — Visual mode is only the look.
 */
export function VisualOutliner({
  archivePaths,
  archivePath,
  onSelectArchive,
  archive,
  archiveBytes,
  loading,
  textureRevision,
  sceneModels,
  animations,
  selection,
  onSelect,
  onSetModelVisible,
  onSetAnimationEnabled,
  animationsPlaying,
  animationFrame,
  animationLength,
  onSetAnimationsPlaying,
  onScrubAnimations,
}: VisualOutlinerProps) {
  const [open, setOpen] = useState<Record<GroupId, boolean>>({
    models: true,
    materials: false,
    textures: true,
    animations: true,
    effects: false,
  });
  const toggle = (id: GroupId) => setOpen((current) => ({ ...current, [id]: !current[id] }));

  const materials = archive?.models.flatMap((model) => model.materials.map((material) => ({ model, material }))) ?? [];
  const textures = archive?.textures ?? [];
  const visibleSceneModels = sceneModels.filter((model) => model.kind !== 'imported');

  return (
    <aside className="placeAssetsPanel visualPanel">
      <div className="panelHeader placeAssetsHeader visualPanelHeader">
        <div>
          <h2>Visual</h2>
          <p className="panelSubtle">
            {archive
              ? `${archive.label} — ${archive.models.length} model${archive.models.length === 1 ? '' : 's'}, ${textures.length} texture${textures.length === 1 ? '' : 's'} (${formatByteSize(sumTextureBytes(archive))})`
              : loading
                ? 'Reading the track archives...'
                : 'Materials, textures, animations and post effects.'}
          </p>
        </div>
      </div>

      <div className="visualPanelBody">
        <label className="visualArchivePicker">
          Archive
          <select
            value={archivePath ?? ''}
            aria-label="Archive"
            disabled={archivePaths.length === 0}
            onChange={(event) => onSelectArchive(event.currentTarget.value)}
          >
            {archivePaths.length === 0 && <option value="">No .brres in this track</option>}
            {archivePaths.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
        </label>

        {archive?.error && <p className="visualNote error">{archive.label} could not be read: {archive.error}</p>}

        <VisualGroup title="Models" count={visibleSceneModels.length || archive?.models.length || 0} open={open.models} onToggle={() => toggle('models')}>
          {visibleSceneModels.length === 0 && archive?.models.length === 0 && <p className="visualEmpty">This archive has no MDL0 models.</p>}
          <div className="visualList">
            {visibleSceneModels.map((model) => (
              <div key={model.archivePath} className="visualRow">
                <span className="visualRowMain">
                  <strong>{model.modelName}</strong>
                  <span className="visualRowMeta">
                    {model.archivePath.replace(/^\.\//, '')} — {model.materialCount} materials, {model.shapeCount} shapes
                  </span>
                </span>
                <label className="visualToggle" title={`Show or hide ${model.modelName} in the viewport`}>
                  <input type="checkbox" checked={model.visible} onChange={(event) => onSetModelVisible(model.archivePath, event.currentTarget.checked)} />
                  Show
                </label>
              </div>
            ))}
            {/* Archives the renderer never loads (map_model.brres) still list their models. */}
            {visibleSceneModels.length === 0 &&
              (archive?.models ?? []).map((model) => (
                <div key={model.name} className="visualRow">
                  <span className="visualRowMain">
                    <strong>{model.name}</strong>
                    <span className="visualRowMeta">
                      {model.materialCount} materials, {model.triangleCount.toLocaleString()} triangles
                    </span>
                  </span>
                  <span className="visualRowAside">not rendered</span>
                </div>
              ))}
          </div>
        </VisualGroup>

        <VisualGroup title="Materials" count={materials.length} open={open.materials} onToggle={() => toggle('materials')}>
          {materials.length === 0 && <p className="visualEmpty">{loading ? 'Reading materials...' : 'No materials in this archive.'}</p>}
          <div className="visualList">
            {materials.map(({ model, material }) => {
              const isSelected =
                selection?.kind === 'material' && selection.modelName === model.name && selection.materialIndex === material.index;
              return (
                <button
                  key={`${model.name}/${material.index}`}
                  type="button"
                  className={isSelected ? 'visualRow selected' : 'visualRow'}
                  onClick={() => onSelect({ kind: 'material', modelName: model.name, materialIndex: material.index })}
                >
                  <span className="visualRowMain">
                    <strong>{material.name}</strong>
                    <span className="visualRowMeta">
                      {material.translucent ? 'Translucent' : 'Opaque'} — {material.tevStageCount} TEV
                      {material.textures.length > 0 ? ` — ${material.textures.join(', ')}` : ' — no texture'}
                    </span>
                  </span>
                  <span className="visualRowAside">{model.name}</span>
                </button>
              );
            })}
          </div>
        </VisualGroup>

        <VisualGroup title="Textures" count={textures.length} open={open.textures} onToggle={() => toggle('textures')}>
          {textures.length === 0 && <p className="visualEmpty">{loading ? 'Decoding textures...' : 'No TEX0 textures in this archive.'}</p>}
          <div className="visualTextureGrid">
            {textures.map((texture) => {
              const isSelected = selection?.kind === 'texture' && selection.textureName === texture.name;
              return (
                <button
                  key={texture.name}
                  type="button"
                  className={isSelected ? 'visualTextureTile selected' : 'visualTextureTile'}
                  title={`${texture.name} — ${texture.width}x${texture.height} ${texture.formatLabel}`}
                  onClick={() => onSelect({ kind: 'texture', textureName: texture.name })}
                >
                  <TexturePreview
                    archivePath={archive?.path ?? ''}
                    archiveBytes={archiveBytes}
                    texture={texture}
                    revision={textureRevision}
                  />
                  <strong>{texture.name}</strong>
                  <span>
                    {texture.width}x{texture.height} {texture.formatLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </VisualGroup>

        <VisualGroup title="Animations" count={animations.length} open={open.animations} onToggle={() => toggle('animations')}>
          {animations.length === 0 ? (
            <p className="visualEmpty">{loading ? 'Reading animations...' : 'This archive has no animations.'}</p>
          ) : (
            <>
              <div className="visualScrubber">
                <div className="visualScrubberRow">
                  <button
                    type="button"
                    className="visualInlineButton"
                    title={animationsPlaying ? 'Pause every animation' : 'Play every animation'}
                    onClick={() => onSetAnimationsPlaying(!animationsPlaying)}
                  >
                    {animationsPlaying ? <Pause size={13} /> : <Play size={13} />}
                  </button>
                  <button type="button" className="visualInlineButton" title="Back to frame 0" onClick={() => onScrubAnimations(0)}>
                    <SkipBack size={13} />
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(1, animationLength)}
                    step={1}
                    aria-label="Animation frame"
                    value={Math.min(animationFrame ?? 0, Math.max(1, animationLength))}
                    onChange={(event) => onScrubAnimations(Number(event.currentTarget.value))}
                  />
                  <span className="visualScrubberValue">
                    {animationFrame === null ? 'live' : `${Math.round(animationFrame)} / ${animationLength}`}
                  </span>
                </div>
                {animationFrame !== null && (
                  <button type="button" className="visualInlineButton" onClick={() => onScrubAnimations(null)}>
                    Release the scrubber (run at 60 fps)
                  </button>
                )}
              </div>
              <div className="visualList">
                {animations.map((animation) => {
                  const isSelected =
                    selection?.kind === 'animation' && selection.animationKind === animation.kind && selection.name === animation.name;
                  return (
                    <div key={`${animation.kind}/${animation.name}`} className={isSelected ? 'visualRow selected' : 'visualRow'}>
                      <button
                        type="button"
                        className="visualRowMain visualRowButton"
                        onClick={() => onSelect({ kind: 'animation', animationKind: animation.kind, name: animation.name })}
                      >
                        <strong>{animation.name}</strong>
                        <span className="visualRowMeta">
                          {animationKindLabel(animation.kind)} — {Math.round(animation.duration)} frames{animation.loops ? ', loops' : ''}
                        </span>
                      </button>
                      <label
                        className={animation.togglable ? 'visualToggle' : 'visualToggle disabled'}
                        title={
                          animation.togglable
                            ? `Play or stop ${animation.name}`
                            : animation.kind === 'scn0'
                              ? 'SCN0 scene animations are listed for reference; this renderer cannot play them.'
                              : 'This archive is not loaded in the viewport, so its animations cannot be played.'
                        }
                      >
                        <input
                          type="checkbox"
                          checked={animation.enabled}
                          disabled={!animation.togglable}
                          onChange={(event) => onSetAnimationEnabled(animation, event.currentTarget.checked)}
                        />
                        Play
                      </label>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </VisualGroup>

        <VisualGroup title="Post effects" open={open.effects} onToggle={() => toggle('effects')}>
          <p className="visualEmpty">Fog, bloom, depth of field and lighting come from the track's `posteffect/` files, not from a BRRES.</p>
          <button
            type="button"
            className={selection?.kind === 'postEffects' ? 'visualInlineButton active' : 'visualInlineButton'}
            onClick={() => onSelect({ kind: 'postEffects' })}
          >
            Edit post effects
          </button>
        </VisualGroup>
      </div>
    </aside>
  );
}
