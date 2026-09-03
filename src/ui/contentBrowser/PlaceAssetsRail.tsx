import { PanelLeftClose, Shapes } from 'lucide-react';
import type { NoclipBrresSummary } from '../../lib/noclipBrres';
import type { CommonResourceArchive } from '../../lib/objflow';
import { IconButton } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { objectCatalog, type ObjectOption } from '../objects/objectCatalog';
import { ObjectThumbnail } from './ObjectThumbnail';

/**
 * Left dock for KMP mode: the handful of objects that get dragged into the scene most often.
 * The dock's resize handle and collapsed rail belong to the shell, not to this panel, so
 * every mode's left panel gets them for free.
 */
export function PlaceAssetsRail({
  onToggle,
  quickObjectOptions,
  objFlow,
  commonArchive,
  commonBrresSummaries,
}: {
  onToggle: () => void;
  quickObjectOptions: ObjectOption[];
  objFlow: CommonResourceArchive['objFlow'] | null;
  commonArchive: CommonResourceArchive | null;
  commonBrresSummaries: Record<string, NoclipBrresSummary>;
}) {
  return (
    <aside className="placeAssetsPanel">
      <div className="panelHeader placeAssetsHeader">
        <div>
          <h2>Place Assets</h2>
          <p className="panelSubtle">Drag into the viewport</p>
        </div>
        <IconButton size="sm" variant="ghost" icon={<PanelLeftClose size={15} />} tooltip="Hide left panel" tooltipSide="right" onClick={onToggle} />
      </div>
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
                  tabIndex={0}
                  title={`${option.label} — drag into the viewport to place`}
                  onDragStart={(event) => event.dataTransfer.setData('application/mkw-object-id', String(option.id))}
                >
                  {quickObject && <ObjectThumbnail object={quickObject} common={commonArchive} summaries={commonBrresSummaries} />}
                  <strong>{option.label}</strong>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            size="sm"
            icon={<Shapes size={18} />}
            title="No shared objects yet"
            description="Import Common.szs from the File menu to place the game's built-in objects."
          />
        )}
      </div>
    </aside>
  );
}
