import { useMemo, useState } from 'react';
import { Box, Copy, Eye, EyeOff, Trash2 } from 'lucide-react';
import { courseMeshTarget, describeCourseMesh, type CourseMeshInfo } from '../../lib/brres/courseMeshes';
import { COURSE_MODEL_PATH } from '../../lib/track';
import type { ModelEditing } from './useModelEditing';

/**
 * The list of everything in the course model. Replaces the "Place Assets" rail while Model mode
 * is active; clicking a row selects the same mesh a click in the viewport would.
 */
export function ModelOutliner({ editing, onPlaceObject }: { editing: ModelEditing; onPlaceObject: () => void }) {
  const [query, setQuery] = useState('');
  const meshes = editing.meshList?.meshes ?? [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return meshes;
    return meshes.filter(
      (mesh) =>
        describeCourseMesh(mesh).toLowerCase().includes(needle) ||
        mesh.shapeName.toLowerCase().includes(needle) ||
        mesh.materialName.toLowerCase().includes(needle) ||
        mesh.nodeName.toLowerCase().includes(needle),
    );
  }, [meshes, query]);

  const selectedDrawOps = useMemo(() => new Set(editing.selection.map((target) => target.drawOpIndex)), [editing.selection]);
  function rowState(mesh: CourseMeshInfo) {
    return editing.editStateByDrawOp.get(mesh.drawOpIndex);
  }

  function selectMesh(mesh: CourseMeshInfo, additive: boolean) {
    editing.selectMeshes([courseMeshTarget(COURSE_MODEL_PATH, mesh, editing.granularity)], additive);
  }

  return (
    <aside className="placeAssetsPanel modelOutliner">
      <div className="panelHeader placeAssetsHeader">
        <div>
          <h2>Track Geometry</h2>
          <p className="panelSubtle">
            {meshes.length > 0 ? `${meshes.length} meshes in ${editing.meshList?.modelName ?? 'the course model'}` : 'No course model loaded'}
          </p>
        </div>
      </div>

      <div className="modelOutlinerBody">
        <input
          className="modelOutlinerSearch"
          type="search"
          placeholder="Search meshes"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <button className="inlineAction modelPlaceButton" type="button" onClick={onPlaceObject} disabled={!editing.courseModel}>
          <Box size={14} /> Place an object as scenery
        </button>

        {editing.placedObjects.length > 0 && (
          <section className="modelOutlinerSection">
            <h3>Placed by you</h3>
            <ul className="modelOutlinerList">
              {editing.placedObjects.map((mesh) => (
                <li key={mesh.id}>
                  <button
                    type="button"
                    className={editing.activePlaced?.id === mesh.id ? 'modelOutlinerRow selected' : 'modelOutlinerRow'}
                    onClick={() => editing.selectPlaced(mesh.id)}
                  >
                    <span className="modelOutlinerName">
                      {mesh.sourceShape ? <Copy size={13} /> : <Box size={13} />}
                      {mesh.label ?? mesh.sourcePath}
                    </span>
                    <span className="modelOutlinerMeta">{mesh.visible ? '' : 'hidden'}</span>
                  </button>
                  <button
                    className="iconButton modelRowAction"
                    type="button"
                    title={mesh.visible ? 'Hide' : 'Show'}
                    aria-label={mesh.visible ? 'Hide this object' : 'Show this object'}
                    onClick={() => editing.updatePlaced(mesh.id, { visible: !mesh.visible })}
                  >
                    {mesh.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  <button
                    className="iconButton modelRowAction"
                    type="button"
                    title="Remove"
                    aria-label="Remove this object"
                    onClick={() => editing.removePlaced(mesh.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="modelOutlinerSection">
          <h3>Course meshes</h3>
          {filtered.length === 0 ? (
            <p className="panelSubtle">{meshes.length === 0 ? 'This track has no editable course model.' : 'Nothing matches that search.'}</p>
          ) : (
            <ul className="modelOutlinerList">
              {filtered.map((mesh) => {
                const state = rowState(mesh);
                const selected = selectedDrawOps.has(mesh.drawOpIndex);
                return (
                  <li key={mesh.drawOpIndex}>
                    <button
                      type="button"
                      className={[
                        'modelOutlinerRow',
                        selected ? 'selected' : '',
                        state?.deleted ? 'deleted' : '',
                        state?.hidden ? 'hidden' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={(event) => selectMesh(mesh, event.shiftKey || event.ctrlKey || event.metaKey)}
                      title={`${mesh.shapeName} · material ${mesh.materialName || 'none'} · bone ${mesh.nodeName}`}
                    >
                      <span className="modelOutlinerName">{describeCourseMesh(mesh)}</span>
                      <span className="modelOutlinerMeta">
                        {state?.deleted
                          ? 'deleted'
                          : state?.hidden
                            ? 'hidden'
                            : `${mesh.triangleCount.toLocaleString()} tris${state?.moved ? ' · moved' : ''}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
