// The slice of the noclip Mario Kart Wii renderer that Visual mode drives. Declared structurally
// (like `EditorMeshRendererScene` in `src/lib/brresRenderAdapter.ts`) so `src/ui` never imports
// vendored types directly, and every member is optional so an older scene simply does nothing.
import type { EditorMeshRendererScene } from '../../lib/brresRenderAdapter';

export type VisualAnimationKind = 'srt0' | 'pat0' | 'clr0' | 'chr0' | 'vis0' | 'scn0';

export interface VisualSceneModel {
  archivePath: string;
  modelName: string;
  kind: 'course' | 'skybox' | 'imported';
  visible: boolean;
  materialCount: number;
  shapeCount: number;
  nodeCount: number;
}

export interface VisualSceneAnimation {
  kind: VisualAnimationKind;
  name: string;
  duration: number;
  loopMode: number;
  enabled: boolean;
  /** False for animation kinds the BRRES renderer cannot play (SCN0). */
  supported: boolean;
}

export interface VisualSceneCapabilities {
  bloom: boolean;
  dof: boolean;
  fog: boolean;
  lighting: boolean;
  wireframe: boolean;
}

export interface VisualRendererScene extends EditorMeshRendererScene {
  listEditorSceneModels?: () => VisualSceneModel[];
  setEditorSceneModelVisible?: (archivePath: string, visible: boolean) => boolean;
  setEditorObjectPreviewsVisible?: (visible: boolean) => void;
  listEditorAnimations?: (archivePath: string) => VisualSceneAnimation[];
  setEditorAnimationEnabled?: (archivePath: string, kind: string, name: string, enabled: boolean) => boolean;
  setEditorAnimationsPlaying?: (playing: boolean) => void;
  setEditorSceneTimeFrames?: (frames: number | null) => void;
  getEditorSceneTimeFrames?: () => number;
  setEditorVertexColorsEnabled?: (enabled: boolean) => void;
  setEditorTexturesEnabled?: (enabled: boolean) => void;
  setEditorLightingEnabled?: (enabled: boolean) => void;
  setEditorWireframe?: (enabled: boolean) => boolean;
  setEditorBloomEnabled?: (enabled: boolean) => void;
  setEditorFogEnabled?: (enabled: boolean) => void;
  setEditorPostProcessingEnabled?: (enabled: boolean) => void;
  setEditorDOFMode?: (mode: 'full' | 'reduced' | 'off') => void;
  getEditorVisualCapabilities?: () => VisualSceneCapabilities;
  reloadEditorTexture?: (
    name: string,
    texture: { format: number; width: number; height: number; mipCount: number; data: Uint8Array },
  ) => boolean;
  listEditorTextureNames?: () => string[];
}

/** Everything Visual mode can switch on and off in the viewport. */
export interface VisualRenderSettings {
  textures: boolean;
  vertexColors: boolean;
  lighting: boolean;
  fog: boolean;
  bloom: boolean;
  depthOfField: boolean;
  wireframe: boolean;
  skybox: boolean;
  objects: boolean;
}

export const defaultVisualRenderSettings: VisualRenderSettings = {
  textures: true,
  vertexColors: true,
  lighting: true,
  fog: true,
  bloom: true,
  depthOfField: false,
  wireframe: false,
  skybox: true,
  objects: true,
};

export type VisualPresetId = 'game' | 'flat' | 'wireframe';

export interface VisualPreset {
  id: VisualPresetId;
  label: string;
  hint: string;
  /** Applied on top of the current settings; anything omitted is left alone. */
  settings: Partial<VisualRenderSettings>;
}

export const visualPresets: VisualPreset[] = [
  {
    id: 'game',
    label: 'Game look',
    hint: 'Everything on: textures, lighting, fog and bloom, exactly as the track ships.',
    settings: { textures: true, vertexColors: true, lighting: true, fog: true, bloom: true, wireframe: false, skybox: true },
  },
  {
    id: 'flat',
    label: 'Flat',
    hint: 'Textures without lighting, fog or bloom — the clearest way to read the artwork.',
    settings: { textures: true, vertexColors: false, lighting: false, fog: false, bloom: false, wireframe: false, skybox: true },
  },
  {
    id: 'wireframe',
    label: 'Wireframe',
    hint: 'Untextured wireframe over a hidden skybox, for looking at the geometry itself.',
    settings: { textures: false, vertexColors: false, lighting: false, fog: false, bloom: false, wireframe: true, skybox: false },
  },
];

/** Applies the whole settings object to the renderer. Safe to call on every change. */
export function applyVisualRenderSettings(
  scene: VisualRendererScene | null,
  settings: VisualRenderSettings,
  skyboxArchivePath: string,
): void {
  if (!scene) return;
  scene.setEditorTexturesEnabled?.(settings.textures);
  scene.setEditorVertexColorsEnabled?.(settings.vertexColors);
  scene.setEditorLightingEnabled?.(settings.lighting);
  scene.setEditorFogEnabled?.(settings.fog);
  scene.setEditorBloomEnabled?.(settings.bloom);
  scene.setEditorDOFMode?.(settings.depthOfField ? 'full' : 'off');
  scene.setEditorWireframe?.(settings.wireframe);
  scene.setEditorObjectPreviewsVisible?.(settings.objects);
  scene.setEditorSceneModelVisible?.(skyboxArchivePath, settings.skybox);
}

/** True when `settings` matches every value the preset pins down. */
export function matchesVisualPreset(settings: VisualRenderSettings, preset: VisualPreset): boolean {
  return Object.entries(preset.settings).every(
    ([key, value]) => settings[key as keyof VisualRenderSettings] === value,
  );
}
