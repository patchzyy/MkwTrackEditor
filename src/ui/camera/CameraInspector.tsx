import { Camera, Crosshair, Eye, MapPin, Play, TriangleAlert } from 'lucide-react';
import type { TrackIssue } from '../../lib/track';
import type { KmpEntity } from '../../lib/kmp';
import { getCameraTypeInfo } from '../../lib/cameraPreview';
import type { MenuSection } from '../components/Menu';
import { InspectorHeader } from '../inspector/InspectorHeader';
import { DetailsCategory, DetailsEmpty } from '../inspector/PropertySheet';
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
        <DetailsEmpty icon={<Camera size={22} />}>Click a camera in the viewport or the list to edit it</DetailsEmpty>
      </div>
    );
  }

  const typeInfo = getCameraTypeInfo(row.type);
  const menuSections: MenuSection[] = [
    {
      id: 'look-at',
      title: 'Look-at points',
      items: [
        {
          id: 'look-start',
          label: 'Put the look-at start here',
          icon: <Crosshair size={14} />,
          disabled: !hasViewport,
          onSelect: () => onSetViewPointFromViewport('start'),
        },
        {
          id: 'look-end',
          label: 'Put the look-at end here',
          icon: <Crosshair size={14} />,
          disabled: !hasViewport,
          onSelect: () => onSetViewPointFromViewport('end'),
        },
      ],
    },
  ];
  return (
    <div className="cameraInspector">
      <InspectorHeader
        media={<Camera size={20} aria-hidden="true" />}
        title={`Camera ${row.index}`}
        typeName={typeInfo.label}
        description={typeInfo.description}
        chips={[
          row.openingOrder > 0 ? `Opening shot ${row.openingOrder}` : null,
          row.routeIndex === NO_CAMERA_LINK ? null : `Path ${row.routeIndex}`,
          row.usedByAreas.length > 0 ? `Triggered by ${row.usedByAreas.map((index) => `area ${index}`).join(', ')}` : null,
        ]}
        actions={[
          { id: 'preview', label: 'Preview this shot', icon: <Play size={14} />, onClick: onPreview },
          { id: 'look-from', label: "Fly the viewport to this camera's view", icon: <Eye size={14} />, onClick: onLookFromCamera, disabled: !hasViewport },
          { id: 'set-from', label: "Copy the viewport's view into this camera", icon: <MapPin size={14} />, onClick: onSetFromViewport, disabled: !hasViewport },
        ]}
        sections={menuSections}
      />

      {issues.length > 0 && (
        <DetailsCategory name="Problems" badge={`${issues.length}`}>
          <div className="cameraIssues">
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
        </DetailsCategory>
      )}

      <CameraFields entity={entity} cameraCount={cameraCount} routeCount={routeCount} routePointCounts={routePointCounts} onChange={onChange} />
    </div>
  );
}
