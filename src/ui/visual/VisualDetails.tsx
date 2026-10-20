import { ArrowUpRight, Box, MousePointerClick, X } from 'lucide-react';
import { useMemo } from 'react';
import type { SurfacePick } from '../../lib/surfacePick';
import type { PostEffectResources } from '../inspector/postEffectResources';
import { InspectorHeader } from '../inspector/InspectorHeader';
import { DetailsCategory, DetailsEmpty, PropertyRow } from '../inspector/PropertySheet';
import { brightnessOf, cssColor } from './colorMath';
import { MAIN_FOG_INDEX, bloomStrength, formatDistance, isBloomOn, isFogActive, readMainLight } from './environment';
import { LazyTexture } from './MaterialsDock';
import { TextureInspector, type TextureInspectorProps } from './TextureInspector';
import type { VisualArchiveInfo, VisualMaterialInfo, VisualTextureInfo } from './visualArchive';

/** One material slot of the clicked mesh: a draw call and the material it draws with. */
export interface SlotView {
  drawOpIndex: number;
  shapeName: string;
  materialIndex: number;
  materialName: string;
  /** The material, when the archive has been read far enough to know its textures. */
  info: VisualMaterialInfo | null;
}

export interface VisualDetailsProps {
  hasTrack: boolean;
  /** The clicked surface, or null. */
  surface: SurfacePick | null;
  slots: SlotView[];
  /** Draw call whose material the dock will change. */
  activeDrawOp: number | null;
  onActivateSlot: (drawOpIndex: number) => void;
  onHoverSlot: (drawOpIndex: number | null) => void;
  onClearSurface: () => void;
  /** Opens Material mode (the one place materials are edited). Omitted when unavailable. */
  onOpenMaterialEditor?: () => void;
  archive: VisualArchiveInfo | null;
  archiveBytes: Uint8Array | null;
  textureRevision: number;
  /** A texture picked in the dock; takes over the panel. */
  texture: VisualTextureInfo | null;
  textureProps: Omit<TextureInspectorProps, 'texture' | 'archivePath' | 'archiveBytes' | 'textureRevision'>;
  resources: PostEffectResources;
  /** Why material changes are not offered for this surface, or null. */
  readOnlyReason: string | null;
}

/** "Item Box" for an object, "Course" for the track itself. */
function surfaceKindLabel(surface: SurfacePick): string {
  switch (surface.kind) {
    case 'course':
      return 'Course';
    case 'skybox':
      return 'Sky';
    case 'placed':
      return 'Placed model';
    default:
      return surface.objectName ?? surface.modelName;
  }
}

/**
 * Right panel of Visual mode. A clicked surface shows its material slots; a texture picked in
 * the dock shows its replace/export controls; with nothing picked it says what to do and gives a
 * short summary of the track's look.
 */
export function VisualDetails({
  hasTrack,
  surface,
  slots,
  activeDrawOp,
  onActivateSlot,
  onHoverSlot,
  onClearSurface,
  onOpenMaterialEditor,
  archive,
  archiveBytes,
  textureRevision,
  texture,
  textureProps,
  resources,
  readOnlyReason,
}: VisualDetailsProps) {
  const textureByName = useMemo(() => new Map((archive?.textures ?? []).map((candidate) => [candidate.name, candidate])), [archive]);

  if (texture) {
    return (
      <TextureInspector
        archivePath={archive?.path ?? ''}
        archiveBytes={archiveBytes}
        texture={texture}
        textureRevision={textureRevision}
        {...textureProps}
      />
    );
  }

  if (!surface) return <LookSummary hasTrack={hasTrack} resources={resources} />;

  const active = slots.find((slot) => slot.drawOpIndex === activeDrawOp) ?? slots[0] ?? null;
  const activeTextures = active?.info?.textures ?? [];
  const meshName = surface.shapeName || surface.modelName;

  return (
    <>
      <InspectorHeader
        title={meshName}
        typeName={surfaceKindLabel(surface)}
        description="The part of the model you clicked and the materials it is drawn with."
        media={<Box size={16} aria-hidden="true" />}
        actions={[{ id: 'clear', label: 'Deselect', icon: <X size={14} />, onClick: onClearSurface }]}
        sections={[]}
      />

      <DetailsCategory name="Materials" badge={slots.length > 1 ? `${slots.length} slots` : undefined} defaultOpen>
        {readOnlyReason ? (
          <p className="visualRowNote">{readOnlyReason}</p>
        ) : slots.length === 0 ? (
          <p className="visualRowNote">Reading the materials of this model...</p>
        ) : (
          <div className="visualSlotList">
            {slots.map((slot, index) => {
              const isActive = slot.drawOpIndex === (active?.drawOpIndex ?? -1);
              const textureName = slot.info?.textures[0];
              const texturePreview = textureName ? (textureByName.get(textureName) ?? null) : null;
              return (
                <div
                  key={slot.drawOpIndex}
                  className={`visualSlot${isActive ? ' isActive' : ''}`}
                  onMouseEnter={() => onHoverSlot(slot.drawOpIndex)}
                  onMouseLeave={() => onHoverSlot(null)}
                >
                  <LazyTexture archivePath={archive?.path ?? ''} archiveBytes={archiveBytes} texture={texturePreview} revision={textureRevision} />
                  <span className="visualSlotText">
                    <strong title={slot.materialName}>{slot.materialName}</strong>
                    <span title={slot.info?.textures.join(', ')}>
                      {slots.length > 1 ? `Slot ${index + 1}${slot.shapeName ? ` · ${slot.shapeName}` : ''}` : textureName ? textureName : 'Flat colour'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="visualSlotPick"
                    aria-pressed={isActive}
                    title="Choose a different material from the browser below"
                    onClick={() => onActivateSlot(slot.drawOpIndex)}
                  >
                    Change
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {!readOnlyReason && slots.length > 0 && (
          <p className="visualRowNote">Pick a material in the browser below to put it on {slots.length > 1 ? 'the highlighted slot' : 'this mesh'}.</p>
        )}
        {onOpenMaterialEditor && !readOnlyReason && (
          <button type="button" className="visualLinkButton visualLinkRow" onClick={onOpenMaterialEditor}>
            Edit this material in the Material tab <ArrowUpRight size={12} aria-hidden="true" />
          </button>
        )}
      </DetailsCategory>

      {activeTextures.length > 0 && (
        <DetailsCategory name="Textures" badge={activeTextures.length} defaultOpen>
          {activeTextures.map((name) => {
            const info = textureByName.get(name);
            return (
              <div key={name} className="visualTextureRow">
                <LazyTexture archivePath={archive?.path ?? ''} archiveBytes={archiveBytes} texture={info ?? null} revision={textureRevision} />
                <span className="visualSlotText">
                  <strong title={name}>{name}</strong>
                  <span>{info ? `${info.width} x ${info.height}` : 'Not in this file'}</span>
                </span>
              </div>
            );
          })}
          <p className="visualRowNote">Pick a texture in the Textures tab below to replace or export it.</p>
        </DetailsCategory>
      )}

      <DetailsCategory name="Advanced" defaultOpen={false}>
        <PropertyRow label="Model">
          <span className="visualMuted">{surface.modelName}</span>
        </PropertyRow>
        <PropertyRow label="File">
          <span className="visualMuted">{surface.archivePath.replace(/^\.\//, '')}</span>
        </PropertyRow>
        <PropertyRow label="Mesh">
          <span className="visualMuted">{surface.shapeName}</span>
        </PropertyRow>
        <PropertyRow label="Draw call" help="The position of this mesh in the model's draw list.">
          <span className="visualMuted">{surface.drawOpIndex}</span>
        </PropertyRow>
        {surface.source === 'common' && (
          <p className="visualRowNote">This model comes from the game's shared files. Changing it copies it into your track first.</p>
        )}
      </DetailsCategory>
    </>
  );
}

/** Nothing clicked: say what to do, then show how the track looks overall. */
function LookSummary({ hasTrack, resources }: { hasTrack: boolean; resources: PostEffectResources }) {
  const main = useMemo(() => readMainLight(resources.blight), [resources.blight]);
  const fog = resources.fogPresets.find((entry) => entry.index === MAIN_FOG_INDEX);
  const glow = resources.bloomFiles.find((file) => file.index === 0)?.data;
  if (!hasTrack) return <DetailsEmpty icon={<MousePointerClick size={22} />}>Open a track to look at its materials.</DetailsEmpty>;
  return (
    <>
      <DetailsEmpty icon={<MousePointerClick size={22} />}>Click any surface in the viewport to see its material.</DetailsEmpty>
      <DetailsCategory name="Track look" help="How this track is lit right now. Change it in the Environment panel on the left." defaultOpen>
        <PropertyRow label="Sunlight">
          {main ? (
            <span className="visualSummaryValue">
              <i className="visualDot" style={{ background: cssColor(main.color) }} />
              {Math.round(brightnessOf(main.color) * 100)}% bright
            </span>
          ) : (
            <span className="visualMuted">No lighting</span>
          )}
        </PropertyRow>
        <PropertyRow label="Shadows">
          {main ? (
            <span className="visualSummaryValue">
              <i className="visualDot" style={{ background: cssColor(main.shadow) }} />
              {Math.round(brightnessOf(main.shadow) * 100)}% bright
            </span>
          ) : (
            <span className="visualMuted">-</span>
          )}
        </PropertyRow>
        <PropertyRow label="Fog">
          {fog && isFogActive(fog) ? (
            <span className="visualSummaryValue">
              <i className="visualDot" style={{ background: cssColor(fog.color) }} />
              from {formatDistance(fog.startZ)}
            </span>
          ) : (
            <span className="visualMuted">Off</span>
          )}
        </PropertyRow>
        <PropertyRow label="Glow">
          {glow && isBloomOn(glow) ? <span className="visualSummaryValue">{Math.round(bloomStrength(glow) * 100)}% strong</span> : <span className="visualMuted">Off</span>}
        </PropertyRow>
      </DetailsCategory>
    </>
  );
}
