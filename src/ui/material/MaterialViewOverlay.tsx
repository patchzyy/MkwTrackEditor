import { Boxes, Crosshair, Eye } from 'lucide-react';
import type { GxMaterialRef } from '../../lib/gxMaterial';
import { Button } from '../components';

export interface MaterialViewOverlayProps {
  materialRef: GxMaterialRef | null;
  meshCount: number;
  solo: boolean;
  onToggleSolo: () => void;
  onFrame: () => void;
  /** Opens this material's archive in the Model Studio. Absent when the shell offers no studio. */
  onOpenInStudio?: () => void;
}

/**
 * Viewport top-right HUD for Material mode: what is selected, how much of the course it draws,
 * and the Solo switch that hides everything else so one material can be looked at on its own.
 */
export function MaterialViewOverlay({ materialRef, meshCount, solo, onToggleSolo, onFrame, onOpenInStudio }: MaterialViewOverlayProps) {
  return (
    <div className="viewportOverlayPanel materialOverlayPanel">
      <div className="viewportOverlayHeader">
        <strong>Material</strong>
      </div>
      {materialRef ? (
        <>
          <p className="materialOverlayName">{materialRef.materialName}</p>
          <p className="materialOverlayMeta">
            {meshCount > 0
              ? `${meshCount} mesh${meshCount === 1 ? '' : 'es'} in the viewport`
              : 'Not drawn in the viewport'}
          </p>
          <div className="materialOverlayActions">
            <Button
              size="sm"
              variant="ghost"
              icon={<Eye size={13} />}
              active={solo}
              disabled={meshCount === 0}
              disabledReason="The viewport is not drawing this material."
              tooltip="Hide every other mesh"
              onClick={onToggleSolo}
            >
              Solo
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Crosshair size={13} />}
              disabled={meshCount === 0}
              disabledReason="The viewport is not drawing this material."
              tooltip="Say which meshes use this material"
              onClick={onFrame}
            >
              Meshes
            </Button>
          </div>
          {onOpenInStudio && (
            <div className="materialOverlayActions">
              <Button
                size="sm"
                icon={<Boxes size={13} />}
                tooltip="Open this archive in the Model Studio: the model on its own, with its animations and a bigger shader canvas."
                onClick={onOpenInStudio}
              >
                Open in Model Studio
              </Button>
            </div>
          )}
        </>
      ) : (
        <p className="materialOverlayMeta">Pick a material on the left to highlight its meshes.</p>
      )}
      <p className="viewportOverlayHint">Solo only changes the preview. Nothing here is written to the track.</p>
    </div>
  );
}
