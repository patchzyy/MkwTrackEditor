import { Box, ChevronDown, ChevronRight, Globe, Layers, Map as MapIcon, Package, Search, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { GxMaterialRef } from '../../lib/gxMaterial';
import { EmptyState, IconButton, Tooltip } from '../components';
import { materialRefEquals, type MaterialArchiveRole, type MaterialTreeArchive } from './materialOutlinerModel';

const ROLE_ICON: Record<MaterialArchiveRole, ReactNode> = {
  course: <Layers size={13} />,
  skybox: <Globe size={13} />,
  minimap: <MapIcon size={13} />,
  object: <Package size={13} />,
};

export interface MaterialOutlinerProps {
  tree: MaterialTreeArchive[];
  query: string;
  onChangeQuery: (value: string) => void;
  expanded: string[];
  onChangeExpanded: (paths: string[]) => void;
  selected: GxMaterialRef | null;
  onSelect: (ref: GxMaterialRef | null) => void;
  onHover: (ref: GxMaterialRef | null) => void;
  loading: boolean;
  error: string | null;
  hasTrack: boolean;
}

/**
 * Left rail for Material mode: the track's BRRES archives, their models and their materials, with
 * the layer textures as the caption and a badge on materials that share a TEV shader block with
 * another one (editing those needs a decision, so it has to be visible before the edit).
 *
 * An archive is only listed once it is expanded, because listing walks the whole BRRES.
 */
export function MaterialOutliner({
  tree,
  query,
  onChangeQuery,
  expanded,
  onChangeExpanded,
  selected,
  onSelect,
  onHover,
  loading,
  error,
  hasTrack,
}: MaterialOutlinerProps) {
  const totalMaterials = tree.reduce((sum, archive) => sum + archive.materialCount, 0);
  const isExpanded = (path: string) => expanded.includes(path) || query.trim().length > 0;
  const toggle = (path: string) =>
    onChangeExpanded(expanded.includes(path) ? expanded.filter((entry) => entry !== path) : [...expanded, path]);

  return (
    <aside className="placeAssetsPanel materialPanel" aria-label="Materials">
      <div className="panelHeader placeAssetsHeader">
        <div>
          <h2>Materials</h2>
          <p className="panelSubtle">
            {error
              ? 'The material library could not be loaded.'
              : loading
                ? 'Loading the material library...'
                : totalMaterials > 0
                  ? `${totalMaterials} material${totalMaterials === 1 ? '' : 's'} in ${tree.length} archive${tree.length === 1 ? '' : 's'}`
                  : 'Shaders, layers, colours and blending.'}
          </p>
        </div>
      </div>

      <div className="materialPanelBody">
        <div className="materialSearch">
          <Search size={13} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="Search materials and textures"
            aria-label="Search materials"
            onChange={(event) => onChangeQuery(event.currentTarget.value)}
          />
          {query && (
            <IconButton size="sm" variant="ghost" icon={<X size={13} />} tooltip="Clear search" onClick={() => onChangeQuery('')} />
          )}
        </div>

        {!hasTrack && (
          <EmptyState
            icon={<Layers size={22} />}
            title="No track loaded"
            description="Open a .szs course archive to edit its materials."
          />
        )}

        {hasTrack && error && <p className="materialNote error">{error}</p>}

        {hasTrack && !error && tree.length === 0 && (
          <EmptyState
            icon={<Layers size={22} />}
            title="No models in this track"
            description="This archive has no .brres model files, so there are no materials to edit."
          />
        )}

        {tree.map((archive) => {
          const open = isExpanded(archive.path);
          return (
            <section className="materialArchive" key={archive.path}>
              <button
                type="button"
                className="materialArchiveHeader"
                aria-expanded={open}
                onClick={() => toggle(archive.path)}
              >
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {ROLE_ICON[archive.role]}
                <span className="materialArchiveName">{archive.label}</span>
                <span className="materialArchiveCount">{archive.loaded ? archive.materialCount : '…'}</span>
              </button>
              {open && !archive.loaded && <p className="materialEmpty">Reading {archive.path}...</p>}
              {open && archive.loaded && archive.models.length === 0 && (
                <p className="materialEmpty">This archive has no MDL0 models.</p>
              )}
              {open &&
                archive.models.map((model) => (
                  <div className="materialModel" key={model.id}>
                    <div className="materialModelHeader">
                      <Box size={12} aria-hidden="true" />
                      <span>{model.modelName}</span>
                    </div>
                    {model.materials.length === 0 && <p className="materialEmpty">No materials match the search.</p>}
                    {model.materials.map((material) => {
                      const isSelected = materialRefEquals(material.ref, selected);
                      return (
                        <button
                          key={material.id}
                          type="button"
                          className={isSelected ? 'materialRow selected' : 'materialRow'}
                          onClick={() => onSelect(material.ref)}
                          onPointerEnter={() => onHover(material.ref)}
                          onPointerLeave={() => onHover(null)}
                          onFocus={() => onHover(material.ref)}
                          onBlur={() => onHover(null)}
                        >
                          <span className="materialRowMain">
                            <strong>{material.summary.materialName}</strong>
                            <span className="materialRowMeta">{material.caption}</span>
                          </span>
                          <span className="materialRowTags">
                            {material.summary.translucent && (
                              <Tooltip label="Drawn in the translucent pass" side="left">
                                <span className="materialTag">Blend</span>
                              </Tooltip>
                            )}
                            {material.sharedBadge && (
                              <Tooltip label={`This material's shader block is shared with ${material.summary.sharedShaderWith.join(', ')}. Editing the shader copies it first.`} side="left">
                                <span className="materialTag shared">Shared</span>
                              </Tooltip>
                            )}
                            <span className="materialTag stages">{material.summary.stageCount}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
