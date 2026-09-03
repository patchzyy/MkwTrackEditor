import { AlertTriangle, Palette } from 'lucide-react';
import type { GxMaterialDoc, GxMaterialRef, GxMaterialSummary, GxTextureSummary, MaterialIssue } from '../../lib/gxMaterial';
import { EmptyState, PanelSection, Tooltip } from '../components';
import { TexturePreview } from '../visual/TexturePreview';
import { LayersSection } from './sections/LayersSection';
import { ShadingSection } from './sections/ShadingSection';
import { SimpleColorsSection } from './sections/SimpleColorsSection';
import { SurfaceSection } from './sections/SurfaceSection';
import { TransparencySection } from './sections/TransparencySection';
import { describeMaterial } from './materialSimple';
import { useArchiveTextures } from './useArchiveTextures';

export type MaterialDocChange = (next: GxMaterialDoc, options?: { transient?: boolean; status?: string }) => void;

export interface ImportedTexture {
  name: string;
  format: number;
  width: number;
  height: number;
  mipCount: number;
  data: Uint8Array;
}

export interface MaterialInspectorProps {
  materialRef: GxMaterialRef | null;
  doc: GxMaterialDoc | null;
  /**
   * What is wrong with `doc` right now (`collectMaterialIssues`). Retail materials really do ship
   * with defects — a stage sampling a texture slot the material has no layer for — so these are
   * shown, not blocked; `applyMaterial` only refuses the ones the edit introduced.
   */
  issues: readonly MaterialIssue[];
  summary: GxMaterialSummary | null;
  textures: readonly GxTextureSummary[];
  archivePath: string;
  archiveBytes: Uint8Array | null;
  meshCount: number;
  onChange: MaterialDocChange;
  onImportTexture: (texture: ImportedTexture) => boolean;
  hasTrack: boolean;
}

/**
 * Right-hand inspector for the selected material: **simple by default, advanced on demand**.
 *
 * A GX material is a pile of hardware state — blend factors, depth comparisons, konst selectors,
 * texgen matrices — and showing all of it at once is how the first version of this panel read. So
 * every section now leads with the handful of choices an author actually makes, in words, and
 * keeps the machinery behind an `AdvancedBlock` that remembers whether it was open. Nothing is
 * gone: each raw field is one disclosure away from where it used to be.
 *
 * The mapping from a friendly control to the fields underneath lives in `materialSimple.ts`, on
 * its own, with tests — including the one that matters most, that reading a value and writing it
 * straight back changes nothing at all.
 *
 * Every control writes a whole new `GxMaterialDoc` through `onChange`; nothing here knows what a
 * byte is.
 */
export function MaterialInspector({
  materialRef,
  doc,
  issues,
  summary,
  textures,
  archivePath,
  archiveBytes,
  meshCount,
  onChange,
  onImportTexture,
  hasTrack,
}: MaterialInspectorProps) {
  const textureInfos = useArchiveTextures(archiveBytes, textures);

  if (!hasTrack) {
    return (
      <div className="materialInspector">
        <EmptyState
          icon={<Palette size={22} />}
          title="No track loaded"
          description="Open a .szs course archive, then pick a material on the left."
        />
      </div>
    );
  }

  if (!materialRef || !doc) {
    return (
      <div className="materialInspector">
        <EmptyState
          icon={<Palette size={22} />}
          title="No material selected"
          description="Pick a material in the list on the left to edit its textures, colours and shader."
        />
      </div>
    );
  }

  return (
    <div className="materialInspector">
      <div className="materialInspectorHeader">
        <input
          className="materialNameInput"
          type="text"
          value={doc.name}
          aria-label="Material name"
          title="Renaming rewrites every reference to this material in the model."
          onChange={(event) => onChange({ ...doc, name: event.currentTarget.value }, { transient: true })}
          onBlur={(event) => onChange({ ...doc, name: event.currentTarget.value }, { status: `Renamed the material to ${event.currentTarget.value}.` })}
        />
        <span className="materialInspectorWhere">
          {materialRef.modelName} · {archivePath.replace(/^\.\//, '')}
          {meshCount > 0 ? ` · ${meshCount} mesh${meshCount === 1 ? '' : 'es'}` : ''}
        </span>
        <span className="materialInspectorSummary">{describeMaterial(doc)}</span>
        {doc.samplers.length > 0 && (
          <div className="materialThumbStrip" aria-label="Textures this material uses">
            {doc.samplers.map((sampler, index) => (
              <Tooltip key={index} label={`Texture ${index + 1}: ${sampler.texture || 'none'}`} side="left">
                <span className="materialThumb">
                  <TexturePreview
                    archivePath={archivePath}
                    archiveBytes={archiveBytes}
                    texture={textureInfos.find((entry) => entry.name === sampler.texture) ?? null}
                    revision={0}
                  />
                </span>
              </Tooltip>
            ))}
          </div>
        )}
      </div>

      {issues.length > 0 && (
        <div className="materialIssues" role="status">
          <AlertTriangle size={13} aria-hidden="true" />
          <ul>
            {issues.map((issue) => (
              <li key={issue.code}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      <PanelSection title={`Textures (${doc.samplers.length})`} defaultOpen>
        <LayersSection
          doc={doc}
          textures={textureInfos}
          archivePath={archivePath}
          archiveBytes={archiveBytes}
          onChange={onChange}
          onImportTexture={onImportTexture}
        />
      </PanelSection>

      <PanelSection title="Transparency" defaultOpen>
        <TransparencySection doc={doc} onChange={onChange} />
      </PanelSection>

      <PanelSection title="Lighting" defaultOpen>
        <ShadingSection doc={doc} onChange={onChange} />
      </PanelSection>

      <PanelSection title="Colours" defaultOpen>
        <SimpleColorsSection doc={doc} onChange={onChange} />
      </PanelSection>

      <PanelSection title="Surface" defaultOpen>
        <SurfaceSection doc={doc} summary={summary} onChange={onChange} />
      </PanelSection>
    </div>
  );
}
