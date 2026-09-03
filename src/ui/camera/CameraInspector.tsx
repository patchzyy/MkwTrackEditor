import { Crosshair, Eye, MapPin, Play, TriangleAlert } from 'lucide-react';
import type { TrackIssue } from '../../lib/track';
import type { KmpEntity } from '../../lib/kmp';
import { getCameraTypeInfo } from '../../lib/cameraPreview';
import { DetailsSummaryBar } from '../inspector/DetailsSummaryBar';
import { CameraFields } from './CameraFields';
import { NO_CAMERA_LINK, type CameraRow, type CameraValues } from './cameraDocument';

export interface CameraInspectorProps {
  entity: KmpEntity | null;
  row: CameraRow | null;
  cameraCount: number;
  routeCount: number;
  routePointCounts: number[];
  /** Camera issues from the track validator, already filtered to this camera plus the chains. */
  issues: TrackIssue[];
  hasViewport: boolean;
  onChange: (values: Partial<CameraValues>, statusMessage?: string) => void;
  onPreview: () => void;
  onLookFromCamera: () => void;
  onSetFromViewport: () => void;
  onSetViewPointFromViewport: (which: 'start' | 'end') => void;
  onJumpToIssue: (issue: TrackIssue) => void;
}

/** Right-hand inspector for the selected camera while Camera mode is active. */
export function CameraInspector({
  entity,
  row,
  cameraCount,
  routeCount,
  routePointCounts,
  issues,
  hasViewport,
  onChange,
  onPreview,
  onLookFromCamera,
  onSetFromViewport,
  onSetViewPointFromViewport,
  onJumpToIssue,
}: CameraInspectorProps) {
  if (!entity || !entity.camera || !row) {
    return (
      <div className="cameraInspector">
        <h2>Camera</h2>
        <p className="muted">Select a camera in the list on the left, or click one of the camera markers in the viewport.</p>
      </div>
    );
  }

  const typeInfo = getCameraTypeInfo(row.type);
  return (
    <div className="cameraInspector">
      <DetailsSummaryBar
        items={[
          { label: 'Selection', value: `Camera ${row.index}` },
          { label: 'Type', value: typeInfo.label },
          { label: 'Opening', value: row.openingOrder > 0 ? `Shot ${row.openingOrder}` : '' },
          { label: 'Movement path', value: row.routeIndex === NO_CAMERA_LINK ? '' : `Path ${row.routeIndex}` },
          { label: 'Triggered by', value: row.usedByAreas.length > 0 ? row.usedByAreas.map((index) => `Area ${index}`).join(', ') : '' },
        ]}
      />

      <div className="cameraInspectorActions">
        <button type="button" className="button" onClick={onPreview} title="Play this shot in the viewport">
          <Play size={14} />
          Preview
        </button>
        <button type="button" className="button" onClick={onLookFromCamera} disabled={!hasViewport} title="Move the free camera to this camera's pose">
          <Eye size={14} />
          Look from camera
        </button>
        <button type="button" className="button" onClick={onSetFromViewport} disabled={!hasViewport} title="Copy where you are flying into this camera's position and rotation">
          <MapPin size={14} />
          Set from viewport
        </button>
        <button
          type="button"
          className="button"
          onClick={() => onSetViewPointFromViewport('start')}
          disabled={!hasViewport}
          title="Put the start look-at point on the surface under the middle of the viewport"
        >
          <Crosshair size={14} />
          Look-at start here
        </button>
        <button
          type="button"
          className="button"
          onClick={() => onSetViewPointFromViewport('end')}
          disabled={!hasViewport}
          title="Put the end look-at point on the surface under the middle of the viewport"
        >
          <Crosshair size={14} />
          Look-at end here
        </button>
      </div>

      {issues.length > 0 && (
        <div className="cameraIssues">
          <div className="detailsSectionHeader">Problems</div>
          {issues.map((issue, index) => (
            <div key={`${issue.code}-${index}`} className={issue.level === 'error' ? 'cameraIssue isError' : 'cameraIssue'}>
              <TriangleAlert size={14} />
              <span>{issue.message}</span>
              {issue.entityId && (
                <button type="button" className="inlineAction" onClick={() => onJumpToIssue(issue)}>
                  Show
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <CameraFields entity={entity} cameraCount={cameraCount} routeCount={routeCount} routePointCounts={routePointCounts} onChange={onChange} />
    </div>
  );
}
