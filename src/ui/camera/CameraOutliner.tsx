import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Clapperboard, Copy, Film, Plus, Target, Trash2, Video } from 'lucide-react';
import { getCameraTypeInfo } from '../../lib/cameraPreview';
import { NO_CAMERA_LINK, filterCameraRows, type CameraRow } from './cameraDocument';

/** One icon per camera family, so the list can be read at a glance. */
function CameraIcon({ type }: { type: number }) {
  const usage = getCameraTypeInfo(type).usage;
  if (usage === 'opening') return <Clapperboard size={15} />;
  if (usage === 'goal') return <Target size={15} />;
  if (usage === 'unused') return <Film size={15} />;
  return <Video size={15} />;
}

export interface CameraOutlinerProps {
  rows: CameraRow[];
  selectedId: string | null;
  canEdit: boolean;
  introGenerator?: ReactNode;
  onSelect: (row: CameraRow) => void;
  onPreview: (row: CameraRow) => void;
  onAdd: () => void;
  onDuplicate: (row: CameraRow) => void;
  onDelete: (row: CameraRow) => void;
  onMove: (row: CameraRow, direction: -1 | 1) => void;
  onSetChainStart: (kind: 'opening' | 'selection', index: number) => void;
}

/** Left rail for Camera mode: every camera in the track. The pan sequences live in the timeline dock. */
export function CameraOutliner({
  rows,
  selectedId,
  canEdit,
  introGenerator,
  onSelect,
  onPreview,
  onAdd,
  onDuplicate,
  onDelete,
  onMove,
  onSetChainStart,
}: CameraOutlinerProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => filterCameraRows(rows, query), [rows, query]);
  const selectedRow = rows.find((row) => row.id === selectedId) ?? null;

  return (
    <aside className="placeAssetsPanel cameraPanel">
      <div className="panelHeader placeAssetsHeader">
        <div>
          <h2>Cameras</h2>
          <p className="panelSubtle">
            {rows.length === 0 ? 'This track has no cameras yet.' : `${rows.length} camera${rows.length === 1 ? '' : 's'} in this track.`}
          </p>
        </div>
        <button type="button" className="button cameraAddButton" onClick={onAdd} disabled={!canEdit} title="Add a camera where you are looking from">
          <Plus size={14} />
          Add
        </button>
      </div>

      <div className="cameraPanelBody">
        {introGenerator}
        <input
          className="browserSearchInput cameraFilter"
          type="search"
          placeholder="Filter cameras"
          aria-label="Filter cameras"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />

        <ul className="cameraList">
          {filtered.length === 0 && <li className="cameraListEmpty">{rows.length === 0 ? 'Use Add to place your first camera.' : 'No camera matches that filter.'}</li>}
          {filtered.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className={row.id === selectedId ? 'cameraRow isSelected' : 'cameraRow'}
                onClick={() => onSelect(row)}
                onDoubleClick={() => onPreview(row)}
                title={`${row.typeInfo.description} Double-click to preview.`}
              >
                <span className="cameraRowIcon" style={{ color: toCssColor(row.typeInfo.color) }}>
                  <CameraIcon type={row.type} />
                </span>
                <span className="cameraRowText">
                  <span className="cameraRowTitle">
                    <span className="cameraRowName">Camera {row.index}</span>
                    <span className="cameraRowType">{row.typeInfo.label}</span>
                  </span>
                  <span className="cameraRowBadges">
                    {row.openingOrder > 0 && <span className="cameraBadge isOpening">Opening {row.openingOrder}</span>}
                    {row.selectionOrder > 0 && <span className="cameraBadge isSelection">Menu {row.selectionOrder}</span>}
                    {describeAreaUse(row.usedByAreas) && (
                      <span className="cameraBadge isArea" title={`Triggered by ${row.usedByAreas.map((index) => `area ${index}`).join(', ')}`}>
                        {describeAreaUse(row.usedByAreas)}
                      </span>
                    )}
                    {row.routeIndex !== NO_CAMERA_LINK && <span className="cameraBadge isRoute">Path {row.routeIndex}</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="cameraRowActions">
          <button type="button" className="button" disabled={!selectedRow} onClick={() => selectedRow && onDuplicate(selectedRow)} title="Make a copy of the selected camera">
            <Copy size={14} />
            Duplicate
          </button>
          <button type="button" className="button" disabled={!selectedRow} onClick={() => selectedRow && onDelete(selectedRow)} title="Delete the selected camera and renumber every reference">
            <Trash2 size={14} />
            Delete
          </button>
          <button
            type="button"
            className="button"
            disabled={!selectedRow || selectedRow.index === 0}
            onClick={() => selectedRow && onMove(selectedRow, -1)}
            title="Move the selected camera one place earlier in the list"
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            className="button"
            disabled={!selectedRow || selectedRow.index >= rows.length - 1}
            onClick={() => selectedRow && onMove(selectedRow, 1)}
            title="Move the selected camera one place later in the list"
          >
            <ArrowDown size={14} />
          </button>
        </div>
        <div className="cameraRowActions">
          <button
            type="button"
            className="button"
            disabled={!selectedRow || selectedRow.isSelectionStart}
            onClick={() => selectedRow && onSetChainStart('selection', selectedRow.index)}
            title="Make the character-selection pan start at the selected camera"
          >
            Use for the selection screen
          </button>
        </div>

      </div>
    </aside>
  );
}

/** One badge for the areas that trigger a camera; a long list collapses to a count. */
function describeAreaUse(areas: readonly number[]): string | null {
  if (areas.length === 0) return null;
  if (areas.length === 1) return `Used by area ${areas[0]}`;
  if (areas.length === 2) return `Used by areas ${areas[0]} and ${areas[1]}`;
  return `Used by ${areas.length} areas`;
}

function toCssColor(color: [number, number, number]): string {
  const channel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255);
  return `rgb(${channel(color[0])}, ${channel(color[1])}, ${channel(color[2])})`;
}
