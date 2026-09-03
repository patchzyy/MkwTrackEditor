import { Palette } from 'lucide-react';
import type { GxMaterialDoc, GxMaterialRef, GxMaterialSummary, GxTextureSummary } from '../../lib/gxMaterial';
import { EmptyState, PanelSection } from '../components';
import { AdvancedSection } from './sections/AdvancedSection';
import { BlendSection } from './sections/BlendSection';
import { ColorsSection } from './sections/ColorsSection';
import { DepthSection } from './sections/DepthSection';
import { LayersSection } from './sections/LayersSection';
import { LightingSection } from './sections/LightingSection';
import { MaterialSection } from './sections/MaterialSection';
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
 * Right-hand inspector for the selected material. Every control writes a whole new
 * `GxMaterialDoc` through `onChange`; nothing here knows what a byte is.
 *
 * Sections follow the order an author works in: what the material is, its layers, how it is lit,
 * its colours, how it is composited, and finally the indirect-texture machinery that only a few
 * materials use.
 */
export function MaterialInspector({
  materialRef,
  doc,
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
          description="Pick a material in the list on the left to edit its layers, colours and shader."
        />
      </div>
    );
  }

  return (
    <div className="materialInspector">
      <div className="materialInspectorHeader">
        <strong>{doc.name}</strong>
        <span>
          {materialRef.modelName} · {archivePath.replace(/^\.\//, '')}
          {meshCount > 0 ? ` · ${meshCount} mesh${meshCount === 1 ? '' : 'es'}` : ''}
        </span>
      </div>

      <PanelSection title="Material" defaultOpen>
        <MaterialSection doc={doc} summary={summary} onChange={onChange} />
      </PanelSection>

      <PanelSection title={`Layers (${doc.samplers.length})`} defaultOpen>
        <LayersSection
          doc={doc}
          textures={textureInfos}
          archivePath={archivePath}
          archiveBytes={archiveBytes}
          onChange={onChange}
          onImportTexture={onImportTexture}
        />
      </PanelSection>

      <PanelSection title="Lighting" defaultOpen={false}>
        <LightingSection doc={doc} onChange={onChange} />
      </PanelSection>

      <PanelSection title="Colours" defaultOpen>
        <ColorsSection doc={doc} onChange={onChange} />
      </PanelSection>

      <PanelSection title="Blend & alpha" defaultOpen={false}>
        <BlendSection doc={doc} onChange={onChange} />
      </PanelSection>

      <PanelSection title="Depth" defaultOpen={false}>
        <DepthSection doc={doc} onChange={onChange} />
      </PanelSection>

      <PanelSection title="Advanced" defaultOpen={false}>
        <AdvancedSection doc={doc} onChange={onChange} />
      </PanelSection>
    </div>
  );
}
