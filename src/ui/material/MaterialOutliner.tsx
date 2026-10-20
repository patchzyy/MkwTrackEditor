import { Box, ChevronDown, ChevronRight, Globe, Layers, Map as MapIcon, Package, Search, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { GxMaterialRef } from '../../lib/gxMaterial';
import { EmptyState, IconButton, Tooltip } from '../components';
import {
  MATERIAL_GROUPS,
  materialRefEquals,
  materialRefKey,
  type MaterialArchiveRole,
  type MaterialGroupId,
  type MaterialTreeArchive,
} from './materialOutlinerModel';

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
  /** Folders (Course, Sky, Objects) that are open. */
  expandedGroups: string[];
  onChangeExpandedGroups: (groups: string[]) => void;
  /** Models (archives) that are open. */
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
 * Left rail for Material mode, the secondary way in: every model the viewport can show, grouped as
 * Course, Sky and Objects with friendly names, and the materials each one draws with. Clicking
 * something in the viewport is the quick way; this list is for what is not on screen, for
 * searching by texture, and for seeing the whole picture. Selection works both ways: a click in
 * the viewport opens the folder and scrolls to the row.
 *
 * A model is only read once it is opened, because listing walks the whole BRRES.
 */
export function MaterialOutliner({
  tree,
  query,
  onChangeQuery,
  expandedGroups,
  onChangeExpandedGroups,
  expanded,
  onChangeExpanded,
  selected,
  onSelect,
  onHover,
  loading,
  error,
  hasTrack,
}: MaterialOutlinerProps) {
  const searching = query.trim().length > 0;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const selectedKey = selected ? materialRefKey(selected) : '';
  const loadedSignature = tree.map((archive) => (archive.loaded ? '1' : '0')).join('');

  // A click in the viewport lands here: bring the row into view once its folder is open and read.
  useEffect(() => {
    if (!selectedKey) return;
    const handle = window.requestAnimationFrame(() => {
      bodyRef.current?.querySelector('.materialRow.selected')?.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(handle);
  }, [selectedKey, loadedSignature, expanded.length, expandedGroups.length]);

  const toggleArchive = (path: string) =>
    onChangeExpanded(expanded.includes(path) ? expanded.filter((entry) => entry !== path) : [...expanded, path]);
  const toggleGroup = (id: string) =>
    onChangeExpandedGroups(expandedGroups.includes(id) ? expandedGroups.filter((entry) => entry !== id) : [...expandedGroups, id]);

  const renderArchive = (archive: MaterialTreeArchive, headerLabel?: string, flat = false) => {
    const open = expanded.includes(archive.path) || searching;
    return (
      <section className={flat ? 'materialArchive materialArchive--flat' : 'materialArchive'} key={archive.path}>
        <button
          type="button"
          className={flat ? 'materialArchiveHeader materialGroupHeader' : 'materialArchiveHeader'}
          aria-expanded={open}
          onClick={() => toggleArchive(archive.path)}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {ROLE_ICON[archive.role]}
          <span className="materialArchiveName">{headerLabel ?? archive.label}</span>
          <span className="materialArchiveCount">{archive.loaded ? archive.materialCount : ''}</span>
        </button>
        {open && !archive.loaded && <p className="materialEmpty">Reading…</p>}
        {open && archive.loaded && archive.models.length === 0 && (
          <p className="materialEmpty">{searching ? 'Nothing matches.' : 'This model has no materials.'}</p>
        )}
        {open &&
          archive.models.map((model) => (
            <div className="materialModel" key={model.id}>
              {archive.models.length > 1 && (
                <div className="materialModelHeader">
                  <Box size={12} aria-hidden="true" />
                  <span>{model.modelName}</span>
                </div>
              )}
              {model.materials.length === 0 && <p className="materialEmpty">No materials match the search.</p>}
              {model.materials.map((material) => {
                const isSelected = materialRefEquals(material.ref, selected);
                const meshCount = material.summary.meshes.length;
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
                        <Tooltip label="Drawn with transparency" side="left">
                          <span className="materialTag">Blend</span>
                        </Tooltip>
                      )}
                      {meshCount > 1 && (
                        <Tooltip label={`Paints ${meshCount} meshes: ${material.summary.meshes.slice(0, 8).join(', ')}${meshCount > 8 ? '…' : ''}`} side="left">
                          <span className="materialTag meshes">×{meshCount}</span>
                        </Tooltip>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
      </section>
    );
  };

  return (
    <aside className="placeAssetsPanel materialPanel" aria-label="All materials">
      <div className="panelHeader placeAssetsHeader">
        <div>
          <h2>All materials</h2>
          {(error || loading) && (
            <p className="panelSubtle">{error ? 'The material library could not be loaded.' : 'Loading the material library...'}</p>
          )}
        </div>
      </div>

      <div className="materialPanelBody" ref={bodyRef}>
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

        {MATERIAL_GROUPS.map((group) => {
          const archives = tree.filter((archive) => archive.group === group.id);
          if (archives.length === 0) return null;
          // A folder with one model in it is just that model: no second level to open.
          if (archives.length === 1 && group.id !== 'objects' && group.id !== 'other') {
            return renderArchive(archives[0], group.label, true);
          }
          const open = expandedGroups.includes(group.id) || searching;
          const visibleArchives = searching ? archives.filter((archive) => !archive.loaded || archive.materialCount > 0) : archives;
          return (
            <section className="materialGroup" key={group.id}>
              <button
                type="button"
                className="materialArchiveHeader materialGroupHeader"
                aria-expanded={open}
                onClick={() => toggleGroup(group.id as MaterialGroupId)}
              >
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span className="materialArchiveName">{group.label}</span>
                <span className="materialArchiveCount">{archives.length}</span>
              </button>
              {open && visibleArchives.map((archive) => renderArchive(archive))}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
