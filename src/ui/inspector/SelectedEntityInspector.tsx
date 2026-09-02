import {
  getKmpCameraHeader,
  patchKmpAreaField,
  patchKmpBattleFinishField,
  patchKmpCameraField,
  patchKmpCameraViewPosition,
  patchKmpCannonField,
  patchKmpCheckpointEndpoint,
  patchKmpCheckpointField,
  patchKmpEntityPosition,
  patchKmpEntityRotation,
  patchKmpEntityRouteIndex,
  patchKmpEntityScale,
  patchKmpGobjObjectId,
  patchKmpGobjPresenceFlags,
  patchKmpGobjSetting,
  patchKmpPointDeviation,
  patchKmpPointSetting,
  patchKmpPotiPointSetting,
  patchKmpPotiRouteSetting,
  patchKmpRespawnField,
  patchKmpStageField,
  patchKmpStageFlareColor,
  type KmpEntity,
} from '../../lib/kmp';
import type { PathInfo, ReferenceCounts } from '../../lib/kmpEdit';
import type { AreaInspectorResources } from '../areas/areaInspectorConfig';
import type { ObjectOption } from '../objects/objectCatalog';
import type { ObjectInspectorProfile } from '../objects/objectProfiles';
import type { KmpEditActions } from '../state/useKmpEditActions';
import { Inspector } from './Inspector';

/** Binds the selected KMP record to the editor's KMP mutation actions. */
export function SelectedEntityInspector({
  entity,
  pathInfo,
  cameraHeader,
  referenceCounts,
  areaInspectorResources,
  objectProfile,
  objectOptions,
  objectVariantOptions,
  actions,
}: {
  entity: KmpEntity;
  pathInfo: PathInfo | null;
  cameraHeader: ReturnType<typeof getKmpCameraHeader> | null;
  referenceCounts: ReferenceCounts;
  areaInspectorResources: AreaInspectorResources;
  objectProfile: ObjectInspectorProfile | null;
  objectOptions: ObjectOption[];
  objectVariantOptions: ObjectOption[];
  actions: KmpEditActions;
}) {
  const { patchSelectedEntity } = actions;
  return (
<Inspector
  entity={entity}
  pathInfo={pathInfo}
  cameraHeader={cameraHeader}
  referenceCounts={referenceCounts}
  areaInspectorResources={areaInspectorResources}
  objectProfile={objectProfile}
  objectOptions={objectOptions}
  objectVariantOptions={objectVariantOptions}
  onChangePosition={(position) => patchSelectedEntity((kmp, entity) => patchKmpEntityPosition(kmp, entity, position))}
  onDelete={entity.section === 'STGI' ? undefined : actions.deleteSelectedEntity}
  onMoveEarlier={entity.section === 'STGI' ? undefined : () => actions.moveSelectedEntity(-1)}
  onMoveLater={entity.section === 'STGI' ? undefined : () => actions.moveSelectedEntity(1)}
  onChangeCheckpointEndpoint={(side, position) => patchSelectedEntity((kmp, entity) => patchKmpCheckpointEndpoint(kmp, entity, side, position))}
  onChangeCheckpointField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpCheckpointField(kmp, entity, field, value))}
  onChangePointDeviation={(value) => patchSelectedEntity((kmp, entity) => patchKmpPointDeviation(kmp, entity, value))}
  onChangePathGroupLinks={actions.changePathGroupLinks}
  onSplitPathGroup={pathInfo && pathInfo.localIndex < pathInfo.groupSize - 1 ? actions.splitSelectedPathGroup : undefined}
  onMergePathGroup={pathInfo && pathInfo.nextGroups.length === 1 ? actions.mergeSelectedPathGroup : undefined}
  onChangePointSetting={(settingIndex, value) => patchSelectedEntity((kmp, entity) => patchKmpPointSetting(kmp, entity, settingIndex, value))}
  onChangePotiRouteSetting={(settingIndex, value) => patchSelectedEntity((kmp, entity) => patchKmpPotiRouteSetting(kmp, entity, settingIndex, value))}
  onChangePotiPointSetting={(settingIndex, value) => patchSelectedEntity((kmp, entity) => patchKmpPotiPointSetting(kmp, entity, settingIndex, value))}
  onAddPotiNode={() => actions.addPotiNode(entity)}
  onCreateObjectRoute={() => actions.createObjectRoute(entity)}
  onResetObjectBehavior={() => actions.resetObjectBehavior(entity)}
  onClearObjectRoute={() => actions.clearObjectRoute(entity)}
  onSelectObjectRoute={() => actions.selectObjectRoute(entity)}
  onApplySafeFallingRockDefaults={() => actions.applySafeFallingRockDefaults(entity)}
  onCreateCannonPointFromObject={() => actions.createCannonPointFromObject(entity)}
  onApplyRoulettePlatformDefaults={() => actions.applyRoulettePlatformDefaults(entity)}
  onChangeAreaField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpAreaField(kmp, entity, field, value))}
  onChangeCameraField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpCameraField(kmp, entity, field, value))}
  onChangeCameraHeaderField={actions.changeCameraHeaderField}
  onChangeCameraViewPosition={(side, position) => patchSelectedEntity((kmp, entity) => patchKmpCameraViewPosition(kmp, entity, side, position))}
  onChangeRespawnField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpRespawnField(kmp, entity, field, value))}
  onChangeCannonField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpCannonField(kmp, entity, field, value))}
  onChangeBattleFinishField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpBattleFinishField(kmp, entity, field, value))}
  onChangeStageField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpStageField(kmp, entity, field, value))}
  onChangeStageFlareColor={(channelIndex, value) => patchSelectedEntity((kmp, entity) => patchKmpStageFlareColor(kmp, entity, channelIndex, value))}
  onChangeRotation={(rotation) => patchSelectedEntity((kmp, entity) => patchKmpEntityRotation(kmp, entity, rotation))}
  onChangeScale={(scale) => patchSelectedEntity((kmp, entity) => patchKmpEntityScale(kmp, entity, scale))}
  onChangeObjectId={(objectId) => patchSelectedEntity((kmp, entity) => patchKmpGobjObjectId(kmp, entity, objectId))}
  onChangeRouteIndex={(routeIndex) => patchSelectedEntity((kmp, entity) => patchKmpEntityRouteIndex(kmp, entity, routeIndex))}
  onChangeObjectSetting={(settingIndex, value) => patchSelectedEntity((kmp, entity) => patchKmpGobjSetting(kmp, entity, settingIndex, value))}
  onChangePresenceFlags={(value) => patchSelectedEntity((kmp, entity) => patchKmpGobjPresenceFlags(kmp, entity, value))}
/>
  );
}
