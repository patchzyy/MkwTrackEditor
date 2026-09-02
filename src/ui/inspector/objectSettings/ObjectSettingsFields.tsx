import type { KmpEntity } from '../../../lib/kmp';
import type { ObjectInspectorProfile } from '../../objects/objectProfiles';
import { ObjectSettingsFields1 } from './ObjectSettingsFields1';
import { ObjectSettingsFields2 } from './ObjectSettingsFields2';
import { ObjectSettingsFields3 } from './ObjectSettingsFields3';

/**
 * Per-object setting controls. The blocks are mutually exclusive (each one tests
 * `objectProfile.title`), and they are split across three files only to keep each file readable.
 */
export function ObjectSettingsFields({
  entity,
  objectProfile,
  onChangeObjectSetting,
}: {
  entity: KmpEntity;
  objectProfile: ObjectInspectorProfile;
  onChangeObjectSetting: (settingIndex: number, value: number) => void;
}) {
  const props = { entity, objectProfile, onChangeObjectSetting };
  return (
    <>
      <ObjectSettingsFields1 {...props} />
      <ObjectSettingsFields2 {...props} />
      <ObjectSettingsFields3 {...props} />
    </>
  );
}
