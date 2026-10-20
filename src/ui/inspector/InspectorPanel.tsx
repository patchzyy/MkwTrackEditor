import { PanelRightClose } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { IconButton } from '../components/Button';
import { DetailsSheet } from './PropertySheet';

/** Right sidebar: the Details panel. Every editor mode supplies what it shows. */
export function InspectorPanel({
  inspectorOpen,
  onBeginResize,
  onResetSize,
  onClose,
  modeContent,
}: {
  inspectorOpen: boolean;
  onBeginResize: (event: ReactPointerEvent<HTMLElement>) => void;
  onResetSize?: () => void;
  onClose: () => void;
  /** The active editor mode's Details content. */
  modeContent?: ReactNode;
}) {
  return (
    <aside className="inspector" aria-label="Inspector">
      {inspectorOpen && (
        <div
          className="sidebarResizeHandle sidebarResizeHandleLeft"
          onPointerDown={onBeginResize}
          onDoubleClick={onResetSize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize inspector"
          title="Drag to resize · double-click to reset"
        />
      )}
      <div className="panelHeader">
        <div>
          <h2>Details</h2>
        </div>
        <IconButton size="sm" variant="ghost" icon={<PanelRightClose size={15} />} tooltip="Hide inspector" tooltipSide="left" onClick={onClose} />
      </div>
      <div className="rightSidebarPanels">
        <section className="sidebarPane detailsPane">
          <div className="paneBody">{modeContent !== undefined && modeContent !== null && <DetailsSheet>{modeContent}</DetailsSheet>}</div>
        </section>
      </div>
    </aside>
  );
}
