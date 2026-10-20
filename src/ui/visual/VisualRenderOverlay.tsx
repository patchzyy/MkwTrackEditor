import { matchesVisualPreset, visualPresets, type VisualRenderSettings } from './visualScene';

export interface VisualRenderOverlayProps {
  settings: VisualRenderSettings;
  onChange: (patch: Partial<VisualRenderSettings>) => void;
  hasScene: boolean;
}

/**
 * The small "how am I looking at it" switch in the viewport corner: the game look, flat
 * textures, or wireframe, plus the two toggles people actually reach for. Everything about the
 * track's own mood (fog, glow, lighting) lives in the Environment panel, not here, and none of
 * this is written to the track.
 */
export function VisualRenderOverlay({ settings, onChange, hasScene }: VisualRenderOverlayProps) {
  return (
    <div className="viewportOverlayPanel visualOverlayPanel" role="group" aria-label="Preview">
      <div className="visualPresetRow" role="radiogroup" aria-label="Preview style">
        {visualPresets.map((preset) => {
          const active = matchesVisualPreset(settings, preset);
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={active ? 'visualInlineButton active' : 'visualInlineButton'}
              title={preset.hint}
              disabled={!hasScene}
              onClick={() => onChange(preset.settings)}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <div className="visualOverlayToggles">
        <label className={hasScene ? 'visualToggle' : 'visualToggle disabled'} title="Draw materials with their textures instead of flat colours">
          <input type="checkbox" checked={settings.textures} disabled={!hasScene} onChange={(event) => onChange({ textures: event.currentTarget.checked })} />
          Textures
        </label>
        <label className={hasScene ? 'visualToggle' : 'visualToggle disabled'} title="Use the colours painted into the track's vertices">
          <input type="checkbox" checked={settings.vertexColors} disabled={!hasScene} onChange={(event) => onChange({ vertexColors: event.currentTarget.checked })} />
          Painted colours
        </label>
      </div>
    </div>
  );
}
