import { PostEffectsPanel } from '../inspector/PostEffectsPanel';
import type { PostEffectResources } from '../inspector/postEffectResources';
import type { PostEffectActions } from '../state/usePostEffectActions';
import { TextureInspector } from './TextureInspector';
import type { BuildReplacementOptions } from './textureReplace';
import {
  animationKindLabel,
  formatByteSize,
  type VisualAnimationRow,
  type VisualArchiveInfo,
  type VisualSelection,
  type VisualTextureInfo,
} from './visualArchive';

export interface VisualInspectorProps {
  archive: VisualArchiveInfo | null;
  archiveBytes: Uint8Array | null;
  textureRevision: number;
  loading: boolean;
  selection: VisualSelection;
  onSelect: (selection: VisualSelection) => void;
  animations: VisualAnimationRow[];
  onSetAnimationEnabled: (row: VisualAnimationRow, enabled: boolean) => void;
  onReplaceTexture: (texture: VisualTextureInfo, file: File, options: BuildReplacementOptions) => Promise<string[]>;
  onExportTexture: (texture: VisualTextureInfo) => Promise<void>;
  postEffectResources: PostEffectResources;
  postEffectActions: PostEffectActions;
}

/** The inspector body for Visual mode: whatever the left panel has focused. */
export function VisualInspector({
  archive,
  archiveBytes,
  textureRevision,
  loading,
  selection,
  onSelect,
  animations,
  onSetAnimationEnabled,
  onReplaceTexture,
  onExportTexture,
  postEffectResources,
  postEffectActions,
}: VisualInspectorProps) {
  if (selection?.kind === 'postEffects') {
    return (
      <>
        <PostEffectsPanel resources={postEffectResources} {...postEffectActions} />
        {postEffectResources.fogPresets.length > 0 && (
          <p className="visualNote">
            Fog, bloom, depth of field and lighting all update in the viewport as you edit them. Fog is drawn the way the game
            draws it — per material, on the materials the track marks as fogged — so a material set to "Not fogged" stays clear.
            The viewport shows fog preset 0; the others are what AREA type 2 swaps to in-game.
          </p>
        )}
      </>
    );
  }

  if (selection?.kind === 'texture') {
    const texture = archive?.textures.find((candidate) => candidate.name === selection.textureName);
    if (!texture) return <p className="visualNote">That texture is not in {archive?.label ?? 'this archive'} any more.</p>;
    return (
      <TextureInspector
        archivePath={archive?.path ?? ''}
        archiveBytes={archiveBytes}
        texture={texture}
        textureRevision={textureRevision}
        onReplace={onReplaceTexture}
        onExport={onExportTexture}
        onSelectMaterial={(modelName, materialName) => {
          const model = archive?.models.find((candidate) => candidate.name === modelName);
          const material = model?.materials.find((candidate) => candidate.name === materialName);
          if (material) onSelect({ kind: 'material', modelName, materialIndex: material.index });
        }}
      />
    );
  }

  if (selection?.kind === 'material') {
    const model = archive?.models.find((candidate) => candidate.name === selection.modelName);
    const material = model?.materials.find((candidate) => candidate.index === selection.materialIndex);
    if (!model || !material) return <p className="visualNote">That material is not in {archive?.label ?? 'this archive'} any more.</p>;
    return (
      <>
        <h2>Material</h2>
        <div className="visualInspectorHeader">
          <strong>{material.name}</strong>
          <div className="visualTagRow">
            <span className="visualTag">{model.name}</span>
            <span className="visualTag">{material.translucent ? 'Translucent' : 'Opaque'}</span>
            <span className="visualTag">{material.tevStageCount} TEV stages</span>
          </div>
        </div>
        <div className="propertyGrid">
          <label>
            Blending
            <span>{material.blendModeLabel}</span>
          </label>
          <label>
            Culling
            <span>{material.cullModeLabel}</span>
          </label>
          <label>
            Alpha test
            <span>{material.alphaTestLabel}</span>
          </label>
          <label>
            Depth write
            <span>{material.depthWrite ? 'On' : 'Off'}</span>
          </label>
          <label>
            Texture coordinates
            <span>
              {material.texGenCount} generated{material.indirectStageCount > 0 ? `, ${material.indirectStageCount} indirect` : ''}
            </span>
          </label>
          <label>
            Light set
            <span>{material.lightSetIndex < 0 ? 'None (unlit)' : `Set ${material.lightSetIndex} from posteffect.blight`}</span>
          </label>
          <label>
            Fog
            <span>{material.fogIndex < 0 ? 'Not fogged' : `Fog ${material.fogIndex}`}</span>
          </label>
        </div>
        <h2>Textures</h2>
        {material.textures.length === 0 ? (
          <p className="visualNote">This material draws a flat colour — it samples no texture.</p>
        ) : (
          <div className="visualButtonRow">
            {material.textures.map((name) => (
              <button key={name} type="button" className="visualInlineButton" onClick={() => onSelect({ kind: 'texture', textureName: name })}>
                {name}
              </button>
            ))}
          </div>
        )}
      </>
    );
  }

  if (selection?.kind === 'animation') {
    const animation = animations.find(
      (candidate) => candidate.kind === selection.animationKind && candidate.name === selection.name,
    );
    if (!animation) return <p className="visualNote">That animation is not in {archive?.label ?? 'this archive'} any more.</p>;
    return (
      <>
        <h2>Animation</h2>
        <div className="visualInspectorHeader">
          <strong>{animation.name}</strong>
          <div className="visualTagRow">
            <span className="visualTag">{animation.kind.toUpperCase()}</span>
            <span className="visualTag">{animationKindLabel(animation.kind)}</span>
          </div>
        </div>
        <div className="propertyGrid">
          <label>
            Length
            <span>
              {Math.round(animation.duration)} frames ({(animation.duration / 60).toFixed(2)} s at 60 fps)
            </span>
          </label>
          <label>
            Repeat
            <span>{animation.loops ? 'Loops' : 'Plays once'}</span>
          </label>
          <label>
            In the viewport
            <span>
              {animation.togglable
                ? animation.enabled
                  ? 'Bound and playing'
                  : 'Not bound'
                : animation.kind === 'scn0'
                  ? 'SCN0 scene animations cannot be played by this renderer'
                  : 'This archive is not loaded in the viewport'}
            </span>
          </label>
        </div>
        {animation.togglable && (
          <div className="visualButtonRow">
            <button type="button" className="visualInlineButton" onClick={() => onSetAnimationEnabled(animation, !animation.enabled)}>
              {animation.enabled ? 'Stop this animation' : 'Play this animation'}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <h2>{archive?.label ?? 'Visual'}</h2>
      {archive ? (
        <div className="propertyGrid">
          <label>
            Archive
            <span>
              {archive.path} ({formatByteSize(archive.byteLength)})
            </span>
          </label>
          <label>
            Models
            <span>
              {archive.models.length} — {archive.models.reduce((total, model) => total + model.triangleCount, 0).toLocaleString()} triangles
            </span>
          </label>
          <label>
            Materials
            <span>{archive.models.reduce((total, model) => total + model.materialCount, 0)}</span>
          </label>
          <label>
            Textures
            <span>{archive.textures.length}</span>
          </label>
          <label>
            Animations
            <span>{archive.animations.length}</span>
          </label>
        </div>
      ) : (
        <p className="visualNote">{loading ? 'Reading the archive...' : 'Load a track to browse its materials and textures.'}</p>
      )}
      <p className="visualNote">Pick a material, texture or animation on the left to edit it.</p>
    </>
  );
}
