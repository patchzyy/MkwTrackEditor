import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { NoclipBrresSummary } from '../../lib/noclipBrres';
import type { CommonResourceArchive } from '../../lib/objflow';
import { objectCatalog, type ObjectOption } from '../objects/objectCatalog';
import { ObjectThumbnail } from './ObjectThumbnail';

/** Left rail with the handful of objects that are dragged into the scene most often. */
export function PlaceAssetsRail({
  open,
  onToggle,
  onBeginResize,
  quickObjectOptions,
  objFlow,
  commonArchive,
  commonBrresSummaries,
}: {
  open: boolean;
  onToggle: () => void;
  onBeginResize: (event: ReactPointerEvent<HTMLElement>) => void;
  quickObjectOptions: ObjectOption[];
  objFlow: CommonResourceArchive['objFlow'] | null;
  commonArchive: CommonResourceArchive | null;
  commonBrresSummaries: Record<string, NoclipBrresSummary>;
}) {
  return (
  <aside className="placeAssetsPanel">
    {open && <div className="sidebarResizeHandle sidebarResizeHandleRight" onPointerDown={(event) => onBeginResize(event)} />}
    <div className="panelHeader placeAssetsHeader">
      <div>
        <h2>Place Assets</h2>
        {open && <p className="panelSubtle">Common draggable game objects</p>}
      </div>
      <button
        className="iconButton"
        type="button"
        onClick={onToggle}
        title={open ? 'Hide place assets' : 'Show place assets'}
        aria-label={open ? 'Hide place assets' : 'Show place assets'}
      >
        {open ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>
    </div>
    {open && (
      <div className="placeAssetsBody">
        {quickObjectOptions.length > 0 ? (
          <div className="placeAssetsGrid">
            {quickObjectOptions.map((option) => {
              const quickObject = objFlow?.byId.get(option.id) ?? objectCatalog.find((entry) => entry.id === option.id);
              return (
                <div
                  key={option.id}
                  className="placeAssetTile"
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('application/mkw-object-id', String(option.id))}
                >
                  {quickObject && <ObjectThumbnail object={quickObject} common={commonArchive} summaries={commonBrresSummaries} />}
                  <strong>{option.label}</strong>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">Load shared object data to place common objects from this rail. Use Import Common.szs once if the bundled archive is unavailable.</p>
        )}
      </div>
    )}
  </aside>
  );
}
