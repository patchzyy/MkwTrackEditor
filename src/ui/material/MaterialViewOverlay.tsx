import { Crosshair, Eye } from 'lucide-react';
import type { GxMaterialRef } from '../../lib/gxMaterial';

export interface MaterialViewOverlayProps {
  materialRef: GxMaterialRef | null;
  meshCount: number;
  solo: boolean;
  onToggleSolo: () => void;
  onFrame: () => void;
}

/**
 * Viewport top-right HUD for Material mode: what is selected, how much of the course it draws,
 * and the Solo switch that hides everything else so one material can be looked at on its own.
 */
export function MaterialViewOverlay({ materialRef, meshCount, solo, onToggleSolo, onFrame }: MaterialViewOverlayProps) {
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
            <button
              type="button"
              className={solo ? 'materialInlineButton active' : 'materialInlineButton'}
              disabled={meshCount === 0}
              title={meshCount === 0 ? 'The viewport is not drawing this material.' : 'Hide every other mesh'}
              onClick={onToggleSolo}
            >
              <Eye size={13} /> Solo
            </button>
            <button
              type="button"
              className="materialInlineButton"
              disabled={meshCount === 0}
              title="Report which meshes use this material"
              onClick={onFrame}
            >
              <Crosshair size={13} /> Meshes
            </button>
          </div>
        </>
      ) : (
        <p className="materialOverlayMeta">Pick a material on the left to highlight its meshes.</p>
      )}
      <p className="viewportOverlayHint">Solo only changes the preview. Nothing here is written to the track.</p>
    </div>
  );
}
