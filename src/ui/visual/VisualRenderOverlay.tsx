import {
  matchesVisualPreset,
  visualPresets,
  type VisualRenderSettings,
  type VisualSceneCapabilities,
} from './visualScene';

export interface VisualRenderOverlayProps {
  settings: VisualRenderSettings;
  onChange: (patch: Partial<VisualRenderSettings>) => void;
  /** What this particular track can drive; a track with no `posteffect.bblm` has no bloom. */
  capabilities: VisualSceneCapabilities | null;
  hasScene: boolean;
}

interface ToggleSpec {
  key: keyof VisualRenderSettings;
  label: string;
  title: string;
  /** Set when the toggle depends on a track resource that may be missing. */
  capability?: keyof VisualSceneCapabilities;
}

const toggles: ToggleSpec[] = [
  { key: 'textures', label: 'Textures', title: 'Draw materials with their textures instead of flat colours' },
  { key: 'vertexColors', label: 'Vertex colours', title: 'Use the baked per-vertex colours' },
  { key: 'lighting', label: 'Lighting', title: 'Light the course with posteffect.blight', capability: 'lighting' },
  { key: 'fog', label: 'Fog', title: 'Draw the course fog from posteffect.bfg', capability: 'fog' },
  { key: 'bloom', label: 'Bloom', title: 'Draw the bloom pass from posteffect.bblm', capability: 'bloom' },
  { key: 'depthOfField', label: 'Depth of field', title: 'Draw the depth-of-field pass from posteffect.bdof', capability: 'dof' },
  { key: 'skybox', label: 'Skybox', title: 'Show vrcorn_model.brres' },
  { key: 'objects', label: 'Objects', title: 'Show the models spawned from the KMP object list' },
  { key: 'wireframe', label: 'Wireframe', title: 'Draw the course as wireframe', capability: 'wireframe' },
];

/**
 * Viewport top-right HUD for Visual mode: the three look presets and the individual render
 * toggles behind them, so an author can isolate exactly what they are looking at.
 */
export function VisualRenderOverlay({ settings, onChange, capabilities, hasScene }: VisualRenderOverlayProps) {
  return (
    <div className="viewportOverlayPanel visualOverlayPanel">
      <div className="viewportOverlayHeader">
        <strong>Look</strong>
      </div>
      <div className="visualPresetRow">
        {visualPresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={matchesVisualPreset(settings, preset) ? 'visualInlineButton active' : 'visualInlineButton'}
            title={preset.hint}
            disabled={!hasScene}
            onClick={() => onChange(preset.settings)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="visualOverlayDivider" />
      <div className="visualOverlayToggles">
        {toggles.map((toggle) => {
          const available = !toggle.capability || capabilities === null || capabilities[toggle.capability];
          const disabled = !hasScene || !available;
          return (
            <label
              key={toggle.key}
              className={disabled ? 'visualToggle disabled' : 'visualToggle'}
              title={available ? toggle.title : `${toggle.title} — this track has no such resource.`}
            >
              <input
                type="checkbox"
                checked={Boolean(settings[toggle.key])}
                disabled={disabled}
                onChange={(event) => onChange({ [toggle.key]: event.currentTarget.checked } as Partial<VisualRenderSettings>)}
              />
              {toggle.label}
            </label>
          );
        })}
      </div>
      <p className="viewportOverlayHint">These toggles only change the preview. Nothing here is written to the track.</p>
    </div>
  );
}
