// AREA inspector configuration: per-area-type labels, notes, and the preset pickers that are
// derived from the track's post-effect files. Extracted from src/ui/App.tsx.
import type { RgbColor } from '../../lib/posteffects';
import type { TrackDocument } from '../../lib/track';
import { formatCompactFloat, getFogTypeLabel, getTrackPostEffectResources, type AreaFogPreset } from '../inspector/postEffectResources';

export interface AreaInspectorOption {
  value: number;
  label: string;
}
export interface AreaBloomPreset {
  index: number;
  thresholdAmount: number;
  tintColor: RgbColor;
  blur0Radius: number;
  blur0Intensity: number;
  blur1Radius: number;
  blur1Intensity: number;
}

export interface AreaInspectorResources {
  fogPresets: AreaFogPreset[];
  bloomPresets: AreaBloomPreset[];
}
export interface AreaInspectorConfig {
  cameraLabel?: string;
  routeLabel?: string;
  enemyLabel?: string;
  setting1Label?: string;
  setting2Label?: string;
  setting1Options?: AreaInspectorOption[];
  notes?: string[];
}

export const emptyAreaInspectorResources: AreaInspectorResources = { fogPresets: [], bloomPresets: [] };
export function getAreaInspectorResources(track: TrackDocument | null): AreaInspectorResources {
  const resources = getTrackPostEffectResources(track);
  return {
    fogPresets: resources.fogPresets,
    bloomPresets: resources.bloomFiles.map((preset) => ({
      index: preset.index,
      thresholdAmount: preset.data.thresholdAmount,
      tintColor: preset.data.compositeColor.slice(0, 3) as RgbColor,
      blur0Radius: preset.data.blur0Radius,
      blur0Intensity: preset.data.blur0Intensity,
      blur1Radius: preset.data.blur1Radius,
      blur1Intensity: preset.data.blur1Intensity,
    })),
  };
}
export const areaEnvironmentEffectOptions = [
  { value: 0, label: 'EnvKareha' },
  { value: 1, label: 'EnvKarehaUp' },
];
export const areaGroupIdOptions = Array.from({ length: 16 }, (_, value) => ({
  value,
  label: `Group ${value}`,
}));
export function getAreaInspectorConfig(type: number, resources: AreaInspectorResources): AreaInspectorConfig {
  switch (type) {
    case 0:
      return {
        cameraLabel: 'Area Camera',
        notes: ['Activates the linked camera while the player is inside this AREA. Higher priority wins when multiple camera AREAs overlap.'],
      };
    case 1:
      return {
        setting1Label: 'Environment Variant',
        setting1Options: areaEnvironmentEffectOptions,
        notes: ['Overrides the local environment effect. Nintendo uses this to force EnvKareha or EnvKarehaUp in specific regions.'],
      };
    case 2:
      return {
        setting1Label: 'Fog Preset',
        setting1Options: resources.fogPresets.map((preset) => ({
          value: preset.index,
          label: `Preset ${preset.index} - ${getFogTypeLabel(preset.fogType)} - RGB ${preset.color.join('/')} - Z ${formatCompactFloat(preset.startZ)} to ${formatCompactFloat(preset.endZ)}`,
        })),
        notes: [
          'Swaps to a posteffect.bfg fog entry while inside this AREA.',
          resources.fogPresets.length > 0
            ? 'The picker below comes from the loaded track archive.'
            : 'No posteffect.bfg was found in the loaded track archive, so this stays as a raw index.',
        ],
      };
    case 3:
      return {
        routeLabel: 'Moving Terrain Route',
        setting1Label: 'Accel / Decel Amplifier',
        setting2Label: 'Water Speed',
        notes: ['Used by moving terrain. The route matters for moving-water setups, and these two settings are especially relevant for the 0x0002 KCL variant.'],
      };
    case 4:
      return {
        enemyLabel: 'Destination Enemy Point',
        notes: ['Used with Force Recalculation collision. This AREA redirects CPUs, and the AREA position and rotation are also part of the setup.'],
      };
    case 5:
      return {
        notes: ['Controls minimap behavior such as culling, visibility, and special cropped-mission-style usage. The raw parameters are not documented well enough for a high-level editor yet.'],
      };
    case 6:
      return {
        setting1Label: 'Bloom / Blur Preset',
        setting2Label: 'Transition Frames',
        setting1Options: resources.bloomPresets.map((preset) => ({
          value: preset.index,
          label: `Preset ${preset.index} - Tint ${preset.tintColor.join('/')} - Threshold ${formatCompactFloat(preset.thresholdAmount)} - Blur ${formatCompactFloat(preset.blur0Radius)}/${formatCompactFloat(preset.blur1Radius)}`,
        })),
        notes: [
          'Swaps the active posteffect.bblm file while inside this AREA.',
          resources.bloomPresets.length > 0
            ? 'Transition time is measured in frames.'
            : 'No posteffect.bblm files were found in the loaded track archive, so this stays as a raw index.',
        ],
      };
    case 7:
      return {
        notes: ['Defines a region where flying Boos can appear. There are no extra numeric parameters for the vanilla behavior.'],
      };
    case 8:
      return {
        setting1Label: 'Group ID',
        setting1Options: areaGroupIdOptions,
        notes: ['Groups objects together. Type 9 can unload matching type 8 groups that share the same group ID.'],
      };
    case 9:
      return {
        setting1Label: 'Group ID',
        setting1Options: areaGroupIdOptions,
        notes: ['Unloads objects from type 8 AREAs that use the same group ID while the player is inside this AREA.'],
      };
    case 10:
      return {
        setting1Label: 'Checkpoint Start',
        setting2Label: 'Checkpoint End',
        notes: ['Adds a fall boundary without changing KCL. In vanilla this is mainly used for tournaments and custom conditional OOB patches.'],
      };
    default:
      return {};
  }
}
