import type {
  getKmpCameraHeader,
  KmpAreaField,
  KmpBattleFinishField,
  KmpCameraField,
  KmpCameraHeaderField,
  KmpCannonField,
  KmpCheckpointField,
  KmpEntity,
  KmpRespawnField,
  KmpStageField,
  Vec3,
} from '../../lib/kmp';
import type { PathInfo, ReferenceCounts } from '../../lib/kmpEdit';
import type { AreaInspectorResources } from '../areas/areaInspectorConfig';
import type { ObjectOption } from '../objects/objectCatalog';
import type { ObjectInspectorProfile } from '../objects/objectProfiles';
import { ReferenceSelect } from './fields/ReferenceSelect';
import { VectorInputs } from './fields/VectorInputs';
import { AdvancedObjectSection } from './sections/AdvancedObjectSection';
import { AreaSection } from './sections/AreaSection';
import { CameraSection } from './sections/CameraSection';
import { CheckpointSection } from './sections/CheckpointSection';
import { ObjectSetupSection } from './sections/ObjectSetupSection';
import { PathGroupSection } from './sections/PathGroupSection';
import { RespawnCannonSection } from './sections/RespawnCannonSection';
import { RoutePointSection } from './sections/RoutePointSection';
import { StageSection } from './sections/StageSection';

/** Property inspector for the primary selected KMP record. */
export function Inspector({
  entity,
  pathInfo,
  cameraHeader,
  referenceCounts,
  areaInspectorResources,
  objectProfile,
  objectOptions,
  objectVariantOptions,
  onChangePosition,
  onDelete,
  onMoveEarlier,
  onMoveLater,
  onChangeCheckpointEndpoint,
  onChangeCheckpointField,
  onChangePointDeviation,
  onChangePathGroupLinks,
  onSplitPathGroup,
  onMergePathGroup,
  onChangePointSetting,
  onChangePotiRouteSetting,
  onChangePotiPointSetting,
  onAddPotiNode,
  onCreateObjectRoute,
  onResetObjectBehavior,
  onClearObjectRoute,
  onSelectObjectRoute,
  onApplySafeFallingRockDefaults,
  onCreateCannonPointFromObject,
  onApplyRoulettePlatformDefaults,
  onChangeAreaField,
  onChangeCameraField,
  onChangeCameraHeaderField,
  onChangeCameraViewPosition,
  onChangeRespawnField,
  onChangeCannonField,
  onChangeBattleFinishField,
  onChangeStageField,
  onChangeStageFlareColor,
  onChangeRotation,
  onChangeScale,
  onChangeObjectId,
  onChangeRouteIndex,
  onChangeObjectSetting,
  onChangePresenceFlags,
}: {
  entity: KmpEntity;
  pathInfo: PathInfo | null;
  cameraHeader: ReturnType<typeof getKmpCameraHeader> | null;
  referenceCounts: ReferenceCounts;
  areaInspectorResources: AreaInspectorResources;
  objectProfile: ObjectInspectorProfile | null;
  objectOptions: ObjectOption[];
  objectVariantOptions: ObjectOption[];
  onChangePosition: (position: Vec3) => void;
  onDelete?: () => void;
  onMoveEarlier?: () => void;
  onMoveLater?: () => void;
  onChangeCheckpointEndpoint: (side: 'left' | 'right', position: Vec3) => void;
  onChangeCheckpointField: (field: KmpCheckpointField, value: number) => void;
  onChangePointDeviation: (value: number) => void;
  onChangePathGroupLinks: (side: 'prev' | 'next', links: number[]) => void;
  onSplitPathGroup?: () => void;
  onMergePathGroup?: () => void;
  onChangePointSetting: (settingIndex: number, value: number) => void;
  onChangePotiRouteSetting: (settingIndex: number, value: number) => void;
  onChangePotiPointSetting: (settingIndex: number, value: number) => void;
  onAddPotiNode: () => void;
  onCreateObjectRoute?: () => void;
  onResetObjectBehavior?: () => void;
  onClearObjectRoute?: () => void;
  onSelectObjectRoute?: () => void;
  onApplySafeFallingRockDefaults?: () => void;
  onCreateCannonPointFromObject?: () => void;
  onApplyRoulettePlatformDefaults?: () => void;
  onChangeAreaField: (field: KmpAreaField, value: number) => void;
  onChangeCameraField: (field: KmpCameraField, value: number) => void;
  onChangeCameraHeaderField: (field: KmpCameraHeaderField, value: number) => void;
  onChangeCameraViewPosition: (side: 'start' | 'end', position: Vec3) => void;
  onChangeRespawnField: (field: KmpRespawnField, value: number) => void;
  onChangeCannonField: (field: KmpCannonField, value: number) => void;
  onChangeBattleFinishField: (field: KmpBattleFinishField, value: number) => void;
  onChangeStageField: (field: KmpStageField, value: number) => void;
  onChangeStageFlareColor: (channelIndex: number, value: number) => void;
  onChangeRotation: (rotation: Vec3) => void;
  onChangeScale: (scale: Vec3) => void;
  onChangeObjectId: (objectId: number) => void;
  onChangeRouteIndex: (routeIndex: number) => void;
  onChangeObjectSetting: (settingIndex: number, value: number) => void;
  onChangePresenceFlags: (value: number) => void;
}) {
  return (
    <div className="propertyGrid">
      <div className="detailsSectionHeader">General</div>
      {onDelete && (
        <label>
          Delete
          <button className="inlineAction" type="button" onClick={onDelete}>
            Delete selected record
          </button>
        </label>
      )}
      {(onMoveEarlier || onMoveLater) && (
        <label>
          Order
          <div className="actionRow">
            <button className="inlineAction" type="button" onClick={onMoveEarlier} disabled={!onMoveEarlier}>
              Earlier
            </button>
            <button className="inlineAction" type="button" onClick={onMoveLater} disabled={!onMoveLater}>
              Later
            </button>
          </div>
        </label>
      )}
      {entity.section !== 'STGI' && (
        <label>
          Position
          <VectorInputs value={entity.position} onChange={onChangePosition} />
        </label>
      )}
      <CheckpointSection
        entity={entity}
        referenceCounts={referenceCounts}
        onChangeCheckpointEndpoint={onChangeCheckpointEndpoint}
        onChangeCheckpointField={onChangeCheckpointField}
      />
      {(entity.pointSettings || entity.poti) && <div className="detailsSectionHeader">Route / Point Data</div>}
      <RoutePointSection
        entity={entity}
        onChangePointDeviation={onChangePointDeviation}
        onChangePointSetting={onChangePointSetting}
        onChangePotiRouteSetting={onChangePotiRouteSetting}
        onChangePotiPointSetting={onChangePotiPointSetting}
      />
      {(entity.area || entity.camera || entity.respawn || entity.cannon || entity.battleFinish || entity.stage) && <div className="detailsSectionHeader">Behavior</div>}
      <AreaSection
        entity={entity}
        referenceCounts={referenceCounts}
        areaInspectorResources={areaInspectorResources}
        onChangeAreaField={onChangeAreaField}
      />
      <CameraSection
        entity={entity}
        cameraHeader={cameraHeader}
        referenceCounts={referenceCounts}
        onChangeCameraField={onChangeCameraField}
        onChangeCameraHeaderField={onChangeCameraHeaderField}
        onChangeCameraViewPosition={onChangeCameraViewPosition}
      />
      <RespawnCannonSection
        entity={entity}
        onChangeRespawnField={onChangeRespawnField}
        onChangeCannonField={onChangeCannonField}
        onChangeBattleFinishField={onChangeBattleFinishField}
      />
      <StageSection entity={entity} onChangeStageField={onChangeStageField} onChangeStageFlareColor={onChangeStageFlareColor} />
      {(entity.rotation || entity.scale) && <div className="detailsSectionHeader">Transform</div>}
      {entity.rotation && (
        <label>
          Rotation
          <VectorInputs value={entity.rotation} onChange={onChangeRotation} />
        </label>
      )}
      {entity.scale && (
        <label>
          Scale
          <VectorInputs value={entity.scale} onChange={onChangeScale} step={0.1} />
        </label>
      )}
      <ObjectSetupSection
        entity={entity}
        objectProfile={objectProfile}
        objectVariantOptions={objectVariantOptions}
        onChangeObjectId={onChangeObjectId}
        onChangePresenceFlags={onChangePresenceFlags}
        onChangeObjectSetting={onChangeObjectSetting}
        onResetObjectBehavior={onResetObjectBehavior}
        onClearObjectRoute={onClearObjectRoute}
        onSelectObjectRoute={onSelectObjectRoute}
        onApplySafeFallingRockDefaults={onApplySafeFallingRockDefaults}
        onCreateCannonPointFromObject={onCreateCannonPointFromObject}
        onApplyRoulettePlatformDefaults={onApplyRoulettePlatformDefaults}
      />
      {entity.routeIndex !== undefined && <div className="detailsSectionHeader">Route Binding</div>}
      {entity.routeIndex !== undefined && (
        <label>
          {objectProfile?.routeLabel ?? 'Path'}
          <div className="actionStack">
            <ReferenceSelect label={objectProfile?.routeLabel ?? 'Object route'} value={entity.routeIndex} noneValue={0xffff} count={referenceCounts.routes} optionLabel="Route" onChange={onChangeRouteIndex} />
            {objectProfile?.routeLabel && entity.routeIndex === 0xffff && onCreateObjectRoute && (
              <button className="inlineAction" type="button" onClick={onCreateObjectRoute}>
                Create movement path
              </button>
            )}
          </div>
        </label>
      )}
      {(entity.objectId !== undefined || entity.objectSettings || entity.presenceFlags !== undefined) && <div className="detailsSectionHeader">Advanced</div>}
      <AdvancedObjectSection
        entity={entity}
        objectOptions={objectOptions}
        onChangeObjectId={onChangeObjectId}
        onChangeObjectSetting={onChangeObjectSetting}
        onChangePresenceFlags={onChangePresenceFlags}
      />
      {(entity.routePoint || pathInfo) && <div className="detailsSectionHeader">Path Group</div>}
      {entity.routePoint && (
        <label>
          Route Node
          <div className="actionRow">
            <span>
              route {entity.routePoint.routeIndex} · node {entity.routePoint.pointIndex}
            </span>
            <button className="inlineAction" type="button" onClick={onAddPotiNode}>
              Add Node
            </button>
          </div>
        </label>
      )}
      <PathGroupSection
        pathInfo={pathInfo}
        onChangePathGroupLinks={onChangePathGroupLinks}
        onSplitPathGroup={onSplitPathGroup}
        onMergePathGroup={onMergePathGroup}
      />
    </div>
  );
}
