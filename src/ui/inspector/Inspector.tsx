import { ArrowDown, ArrowUp, Route, RotateCcw, Trash2, Wand2 } from 'lucide-react';
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
import type { MenuItem, MenuSection } from '../components/Menu';
import type { ObjectOption } from '../objects/objectCatalog';
import type { ObjectInspectorProfile } from '../objects/objectProfiles';
import { AdvancedDisclosure, Disclosure } from './Disclosure';
import { useRegisterInspectorActions } from './InspectorActionsContext';
import { InspectorHeader } from './InspectorHeader';
import { describeKmpRecord, recordFieldPlan } from './recordSummary';
import { AdvancedObjectSection } from './sections/AdvancedObjectSection';
import { AreaSection } from './sections/AreaSection';
import { CameraSection } from './sections/CameraSection';
import { CheckpointSection } from './sections/CheckpointSection';
import { ObjectRouteSection } from './sections/ObjectRouteSection';
import { ObjectSetupSection } from './sections/ObjectSetupSection';
import { PathGroupSection } from './sections/PathGroupSection';
import { PlacementSection } from './sections/PlacementSection';
import { RespawnCannonSection } from './sections/RespawnCannonSection';
import { RoutePointSection } from './sections/RoutePointSection';
import { StageSection } from './sections/StageSection';
import { StartPointSection } from './sections/StartPointSection';
import './inspector.css';

const NO_ROUTE = 0xffff;

/**
 * Property sheet for the selected KMP record.
 *
 * Simple by default: what the record is, where it sits, the handful of choices that have a
 * plain-language meaning, and nothing else. Every raw number, id and reserved byte is one
 * click away in the single **Advanced** disclosure at the bottom, and every rare or
 * destructive command is one click away in the header's **⋯** menu — which the surrounding
 * mode panel hosts when there is one, so a selection has exactly one row of controls.
 */
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
  onChangeStartPlayerIndex,
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
  onChangeStartPlayerIndex: (playerIndex: number) => void;
  onChangeRotation: (rotation: Vec3) => void;
  onChangeScale: (scale: Vec3) => void;
  onChangeObjectId: (objectId: number) => void;
  onChangeRouteIndex: (routeIndex: number) => void;
  onChangeObjectSetting: (settingIndex: number, value: number) => void;
  onChangePresenceFlags: (value: number) => void;
}) {
  const summary = describeKmpRecord(entity);
  const isObject = summary.kind === 'object';
  const hasRoute = entity.routeIndex !== undefined && entity.routeIndex !== NO_ROUTE;
  const showRouteRow = entity.routeIndex !== undefined && (isObject || hasRoute);

  const actionSections: MenuSection[] = [];
  const recordItems: MenuItem[] = [];
  if (onMoveEarlier) recordItems.push({ id: 'move-earlier', label: 'Move earlier in the list', icon: <ArrowUp size={14} />, onSelect: onMoveEarlier });
  if (onMoveLater) recordItems.push({ id: 'move-later', label: 'Move later in the list', icon: <ArrowDown size={14} />, onSelect: onMoveLater });
  if (entity.routePoint) recordItems.push({ id: 'add-node', label: 'Add a node to this path', icon: <Route size={14} />, onSelect: onAddPotiNode });
  if (onSplitPathGroup) recordItems.push({ id: 'split-group', label: 'Start a new group here', onSelect: onSplitPathGroup });
  if (onMergePathGroup) recordItems.push({ id: 'merge-group', label: 'Join this group with the next', onSelect: onMergePathGroup });
  if (recordItems.length > 0) actionSections.push({ id: 'record', title: 'This record', items: recordItems });

  if (isObject) {
    const objectItems: MenuItem[] = [];
    if (onSelectObjectRoute && hasRoute) objectItems.push({ id: 'select-route', label: 'Select its movement path', icon: <Route size={14} />, onSelect: onSelectObjectRoute });
    if (onCreateObjectRoute && !hasRoute) objectItems.push({ id: 'create-route', label: 'Create a movement path', icon: <Route size={14} />, onSelect: onCreateObjectRoute });
    if (onClearObjectRoute && hasRoute) objectItems.push({ id: 'clear-route', label: 'Stop following its path', onSelect: onClearObjectRoute });
    if (onResetObjectBehavior) objectItems.push({ id: 'reset', label: 'Reset settings to defaults', icon: <RotateCcw size={14} />, onSelect: onResetObjectBehavior });
    if (objectProfile?.title === 'Falling Rock' && onApplySafeFallingRockDefaults) {
      objectItems.push({ id: 'safe-rock', label: 'Apply safe defaults', icon: <Wand2 size={14} />, onSelect: onApplySafeFallingRockDefaults });
    }
    if (objectProfile?.title === 'Cannon Object' && onCreateCannonPointFromObject) {
      objectItems.push({ id: 'cannon-point', label: 'Create a cannon point here', icon: <Wand2 size={14} />, onSelect: onCreateCannonPointFromObject });
    }
    if (objectProfile?.title === 'Roulette Platform' && onApplyRoulettePlatformDefaults) {
      objectItems.push({ id: 'roulette', label: 'Apply required defaults', icon: <Wand2 size={14} />, onSelect: onApplyRoulettePlatformDefaults });
    }
    if (objectItems.length > 0) actionSections.push({ id: 'object', title: 'This object', items: objectItems });
  }

  if (onDelete) actionSections.push({ id: 'danger', items: [{ id: 'delete', label: 'Delete', icon: <Trash2 size={14} />, danger: true, onSelect: onDelete }] });

  const hosted = useRegisterInspectorActions('record-properties', actionSections);
  const title = objectProfile?.title ?? summary.typeName;
  const plan = recordFieldPlan(summary.kind);
  // Only offer the disclosure when it would actually hold something.
  const hasAdvanced = plan.advanced.length > 0 ? (summary.kind !== 'camera' || cameraHeader !== null) : pathInfo !== null;

  const advanced = (
    <>
      {isObject && (
        <AdvancedObjectSection
          entity={entity}
          objectOptions={objectOptions}
          onChangeObjectId={onChangeObjectId}
          onChangeObjectSetting={onChangeObjectSetting}
          onChangePresenceFlags={onChangePresenceFlags}
        />
      )}
      {entity.checkpoint && (
        <>
          <PlacementSection entity={entity} summary={summary} onChangePosition={onChangePosition} onChangeRotation={onChangeRotation} onChangeScale={onChangeScale} />
          <CheckpointSection scope="advanced" entity={entity} referenceCounts={referenceCounts} onChangeCheckpointEndpoint={onChangeCheckpointEndpoint} onChangeCheckpointField={onChangeCheckpointField} />
        </>
      )}
      <RoutePointSection
        scope="advanced"
        entity={entity}
        onChangePointDeviation={onChangePointDeviation}
        onChangePointSetting={onChangePointSetting}
        onChangePotiRouteSetting={onChangePotiRouteSetting}
        onChangePotiPointSetting={onChangePotiPointSetting}
      />
      <AreaSection scope="advanced" entity={entity} referenceCounts={referenceCounts} areaInspectorResources={areaInspectorResources} onChangeAreaField={onChangeAreaField} />
      <CameraSection
        scope="advanced"
        entity={entity}
        cameraHeader={cameraHeader}
        referenceCounts={referenceCounts}
        onChangeCameraField={onChangeCameraField}
        onChangeCameraHeaderField={onChangeCameraHeaderField}
        onChangeCameraViewPosition={onChangeCameraViewPosition}
      />
      <RespawnCannonSection
        scope="advanced"
        entity={entity}
        onChangeRespawnField={onChangeRespawnField}
        onChangeCannonField={onChangeCannonField}
        onChangeBattleFinishField={onChangeBattleFinishField}
      />
      <StageSection scope="advanced" entity={entity} onChangeStageField={onChangeStageField} onChangeStageFlareColor={onChangeStageFlareColor} />
      <PathGroupSection pathInfo={pathInfo} onChangePathGroupLinks={onChangePathGroupLinks} />
    </>
  );

  return (
    <div className="inspectorSheet">
      {!hosted && (
        <InspectorHeader
          title={title}
          typeName={`${summary.typeName} ${summary.ordinal}`}
          description={objectProfile?.summary ?? summary.description}
          sections={actionSections}
        />
      )}
      {hosted && objectProfile && <p className="inspectorLead">{objectProfile.summary}</p>}

      <PlacementSection
        entity={entity}
        summary={summary}
        showPosition={!entity.checkpoint}
        onChangePosition={onChangePosition}
        onChangeRotation={onChangeRotation}
        onChangeScale={onChangeScale}
      />
      <CheckpointSection scope="essentials" entity={entity} referenceCounts={referenceCounts} onChangeCheckpointEndpoint={onChangeCheckpointEndpoint} onChangeCheckpointField={onChangeCheckpointField} />
      {showRouteRow && (
        <ObjectRouteSection
          entity={entity}
          objectProfile={objectProfile}
          referenceCounts={referenceCounts}
          onChangeRouteIndex={onChangeRouteIndex}
          onCreateObjectRoute={onCreateObjectRoute}
          onSelectObjectRoute={onSelectObjectRoute}
        />
      )}
      <ObjectSetupSection
        entity={entity}
        objectProfile={objectProfile}
        objectVariantOptions={objectVariantOptions}
        onChangeObjectId={onChangeObjectId}
        onChangePresenceFlags={onChangePresenceFlags}
        onChangeObjectSetting={onChangeObjectSetting}
      />
      <RoutePointSection
        scope="essentials"
        entity={entity}
        onChangePointDeviation={onChangePointDeviation}
        onChangePointSetting={onChangePointSetting}
        onChangePotiRouteSetting={onChangePotiRouteSetting}
        onChangePotiPointSetting={onChangePotiPointSetting}
      />
      <AreaSection scope="essentials" entity={entity} referenceCounts={referenceCounts} areaInspectorResources={areaInspectorResources} onChangeAreaField={onChangeAreaField} />
      <CameraSection
        scope="essentials"
        entity={entity}
        cameraHeader={cameraHeader}
        referenceCounts={referenceCounts}
        onChangeCameraField={onChangeCameraField}
        onChangeCameraHeaderField={onChangeCameraHeaderField}
        onChangeCameraViewPosition={onChangeCameraViewPosition}
      />
      <RespawnCannonSection
        scope="essentials"
        entity={entity}
        onChangeRespawnField={onChangeRespawnField}
        onChangeCannonField={onChangeCannonField}
        onChangeBattleFinishField={onChangeBattleFinishField}
      />
      <StartPointSection entity={entity} onChangePlayerIndex={onChangeStartPlayerIndex} />
      <StageSection scope="essentials" entity={entity} onChangeStageField={onChangeStageField} onChangeStageFlareColor={onChangeStageFlareColor} />

      {objectProfile && (objectProfile.tips.length > 0 || (objectProfile.cautions?.length ?? 0) > 0) && (
        <Disclosure id="tips" title="How to use this" hint={`${objectProfile.tips.length + (objectProfile.cautions?.length ?? 0)} tips`}>
          <ul className="inspectorTips">
            {objectProfile.cautions?.map((caution) => (
              <li className="is-warning" key={caution}>
                {caution}
              </li>
            ))}
            {objectProfile.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </Disclosure>
      )}

      {hasAdvanced && <AdvancedDisclosure hint={isObject ? 'raw values and ids' : 'low-level fields'}>{advanced}</AdvancedDisclosure>}
    </div>
  );
}
