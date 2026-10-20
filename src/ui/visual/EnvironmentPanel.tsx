import { CloudFog, Eye, Focus, Film, Pause, Play, Plus, SkipBack, Sparkles, Sun, Sunrise } from 'lucide-react';
import { useMemo, useRef, type CSSProperties } from 'react';
import type { PostEffectBlightFile, RgbColor } from '../../lib/posteffects';
import { Button, IconButton } from '../components/Button';
import { Toggle } from '../components/Toggle';
import { PostEffectsPanel } from '../inspector/PostEffectsPanel';
import { DetailsCategory, PropertyRow } from '../inspector/PropertySheet';
import type { PostEffectActions } from '../state/usePostEffectActions';
import { brightnessOf, withBrightness } from './colorMath';
import {
  DOF_MAX_BLUR,
  DOF_MAX_DISTANCE,
  DOF_PREVIEW_DRAW_MODE,
  FOG_MAX_DISTANCE,
  MAIN_FOG_INDEX,
  bloomStrength,
  distanceToSlider,
  formatDistance,
  isBloomOn,
  isCourseLight,
  isFogActive,
  isLightEnabled,
  readMainLight,
  sliderToDistance,
} from './environment';
import { LOOK_PRESETS, presetSwatch } from './lookPresets';
import { LiveSlider, LiveSwatch, LookStrip } from './LiveControls';
import type { EnvironmentEditor } from './useEnvironment';
import { animationKindLabel } from './visualArchive';
import {
  matchesVisualPreset,
  visualPresets,
  type VisualRenderSettings,
  type VisualSceneAnimation,
  type VisualSceneModel,
} from './visualScene';

export interface AnimationGroup {
  /** Path the renderer knows the archive by (`./course_model.brres`). */
  archivePath: string;
  label: string;
  rows: VisualSceneAnimation[];
}

export interface EnvironmentPanelProps {
  env: EnvironmentEditor;
  hasTrack: boolean;
  hasScene: boolean;
  settings: VisualRenderSettings;
  onChangeSettings: (patch: Partial<VisualRenderSettings>) => void;
  /** The course and skybox models the renderer holds, for the show/hide switches. */
  models: VisualSceneModel[];
  onSetModelVisible: (sceneArchivePath: string, visible: boolean) => void;
  animationGroups: AnimationGroup[];
  animationsPlaying: boolean;
  animationFrame: number | null;
  animationLength: number;
  onSetAnimationsPlaying: (playing: boolean) => void;
  onScrubAnimations: (frame: number | null) => void;
  onSetAnimationEnabled: (archivePath: string, row: VisualSceneAnimation, enabled: boolean) => void;
  /** Edits for the raw posteffect files; the "Raw effect files" category is left out without it. */
  postEffectActions?: PostEffectActions;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * Remembers the colour a brightness drag started from. Scaling the colour that is on screen
 * would lose its hue as it rounds at the dim end; scaling the starting colour does not.
 */
function useDragBase() {
  const base = useRef<RgbColor | null>(null);
  return {
    from: (current: RgbColor) => (base.current ??= current),
    release: () => {
      base.current = null;
    },
  };
}

/** A control the track cannot have yet, with the one button that adds it. */
function MissingEffect({ text, action, onAdd }: { text: string; action: string; onAdd: () => void }) {
  return (
    <div className="visualMissing">
      <span>{text}</span>
      <Button size="sm" icon={<Plus size={13} />} onClick={onAdd}>
        {action}
      </Button>
    </div>
  );
}

/**
 * Left panel of Visual mode: everything that gives the track its mood, in plain words. Every
 * control previews in the viewport while it is being dragged and writes one undo step when it
 * is released. The numbers behind them live in the track's `posteffect/` files.
 */
export function EnvironmentPanel({
  env,
  hasTrack,
  hasScene,
  settings,
  onChangeSettings,
  models,
  onSetModelVisible,
  animationGroups,
  animationsPlaying,
  animationFrame,
  animationLength,
  onSetAnimationsPlaying,
  onScrubAnimations,
  onSetAnimationEnabled,
  postEffectActions,
}: EnvironmentPanelProps) {
  const { resources, tools, commit } = env;
  const sunBase = useDragBase();
  const shadowBase = useDragBase();
  const blight = resources.blight;
  const main = useMemo(() => readMainLight(blight), [blight]);
  const fog = resources.fogPresets.find((entry) => entry.index === MAIN_FOG_INDEX) ?? null;
  const fogOn = isFogActive(fog ?? undefined);
  const glow = resources.bloomFiles.find((file) => file.index === 0)?.data ?? null;
  const glowOn = isBloomOn(glow ?? undefined);
  const dof = resources.dofFiles.find((file) => !/_demo$/i.test(file.path))?.data ?? null;
  const stage = env.stageInfo;
  const gameLook = visualPresets[0];
  const previewIsGame = matchesVisualPreset(settings, gameLook);
  const previewName = visualPresets.find((preset) => matchesVisualPreset(settings, preset))?.label ?? 'a custom preview';
  const skybox = models.find((model) => model.kind === 'skybox');
  const trackModels = models.filter((model) => model.kind !== 'skybox');

  if (!hasTrack) {
    return (
      <aside className="placeAssetsPanel visualPanel">
        <div className="panelHeader placeAssetsHeader">
          <h2>Environment</h2>
        </div>
        <div className="visualPanelBody">
          <p className="visualEmpty">Open a track to change its lighting, fog and mood.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="placeAssetsPanel visualPanel" aria-label="Environment">
      <div className="panelHeader placeAssetsHeader">
        <h2>Environment</h2>
      </div>

      <div className="visualPanelBody">
        <div className="detailsSheet visualSheet">
          {!previewIsGame && (
            <div className="visualPreviewBanner" role="status">
              <Eye size={13} aria-hidden="true" />
              <span>Previewing the {previewName.toLowerCase()} look. Fog, glow and lighting may be hidden.</span>
              <button type="button" onClick={() => onChangeSettings(gameLook.settings)}>
                Back to game look
              </button>
            </div>
          )}

          <DetailsCategory name="Look" help="One click re-tints the track's own lighting, fog and glow. Your track's colours are kept, only shifted, and one Undo takes it back." defaultOpen>
            <div className="visualLookGrid" role="group" aria-label="Looks">
              {LOOK_PRESETS.map((preset) => {
                const swatch = presetSwatch(preset, env.originalLook);
                const active = env.activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`visualLookChip${active ? ' isActive' : ''}`}
                    title={preset.hint}
                    aria-pressed={active}
                    onClick={() => env.applyPreset(preset.id)}
                  >
                    <LookStrip colors={[swatch.sun, swatch.shadow, swatch.fog]} />
                    <span>{preset.label}</span>
                  </button>
                );
              })}
            </div>
          </DetailsCategory>

          <DetailsCategory name="Light" help="The sun and the shadow colour the track is lit with." defaultOpen>
            {main && blight ? (
              <>
                <PropertyRow label="Sunlight" help="The colour of the main light that lights the track. The slider sets how bright it is.">
                  <span className="visualColorSlider">
                    <LiveSwatch value={main.color} label="Sunlight colour" onPreview={tools.sunColor} onCommit={() => commit('Changed the sunlight.')} />
                    <LiveSlider
                      value={brightnessOf(main.color)}
                      label="Sunlight brightness"
                      format={percent}
                      onPreview={(value) => tools.sunColor(withBrightness(sunBase.from(main.color), value))}
                      onCommit={() => {
                        sunBase.release();
                        commit('Changed the sunlight.');
                      }}
                    />
                  </span>
                </PropertyRow>
                <PropertyRow label="Shadows" help="The colour things take on where the sun does not reach. Lighter shadows flatten the look; darker ones add contrast.">
                  <span className="visualColorSlider">
                    <LiveSwatch value={main.shadow} label="Shadow colour" onPreview={tools.shadowColor} onCommit={() => commit('Changed the shadow colour.')} />
                    <LiveSlider
                      value={brightnessOf(main.shadow)}
                      label="Shadow brightness"
                      format={percent}
                      onPreview={(value) => tools.shadowColor(withBrightness(shadowBase.from(main.shadow), value))}
                      onCommit={() => {
                        shadowBase.release();
                        commit('Changed the shadow colour.');
                      }}
                    />
                  </span>
                </PropertyRow>
                <AllLights blight={blight} env={env} />
              </>
            ) : blight ? (
              <p className="visualRowNote">This track's lighting has no light switched on.</p>
            ) : (
              <MissingEffect
                text="This track has no lighting file, so it is lit flat."
                action="Add lighting"
                onAdd={() => {
                  env.tools.addLighting();
                  commit('Added lighting.');
                }}
              />
            )}
          </DetailsCategory>

          <DetailsCategory name="Fog" help="Distant parts of the track fade into a colour. The viewport shows the fog the track starts a race with." defaultOpen>
            {fog ? (
              <>
                <PropertyRow label="Fog" help="Turn the haze on or off. Off keeps your settings so you can bring it back.">
                  <Toggle
                    label="Fog"
                    hideLabel
                    checked={fogOn}
                    onChange={(on) => {
                      tools.fogEnabled(on);
                      commit(on ? 'Turned the fog on.' : 'Turned the fog off.');
                    }}
                  />
                </PropertyRow>
                {fogOn && (
                  <>
                    <PropertyRow label="Colour" help="The colour the distance fades into. Match it to your skybox horizon.">
                      <LiveSwatch value={[fog.color[0], fog.color[1], fog.color[2]]} label="Fog colour" showHex onPreview={tools.fogColor} onCommit={() => commit('Changed the fog colour.')} />
                    </PropertyRow>
                    <PropertyRow label="Starts at" help="How far away the haze begins. Smaller numbers pull the fog in close.">
                      <LiveSlider
                        value={distanceToSlider(fog.startZ)}
                        min={0}
                        max={1}
                        step={0.005}
                        label="Fog starts at"
                        format={(position) => formatDistance(sliderToDistance(position))}
                        onPreview={(position) => tools.fogDistance('start', sliderToDistance(position))}
                        onCommit={() => commit('Changed where the fog starts.')}
                      />
                    </PropertyRow>
                    <PropertyRow label="Fully foggy at" help="How far away you can no longer see anything through the fog.">
                      <LiveSlider
                        value={distanceToSlider(fog.endZ)}
                        min={0}
                        max={1}
                        step={0.005}
                        label="Fog fully foggy at"
                        format={(position) => formatDistance(sliderToDistance(position, FOG_MAX_DISTANCE))}
                        onPreview={(position) => tools.fogDistance('end', sliderToDistance(position))}
                        onCommit={() => commit('Changed where the fog is thickest.')}
                      />
                    </PropertyRow>
                  </>
                )}
              </>
            ) : (
              <MissingEffect
                text="This track has no fog."
                action="Add fog"
                onAdd={() => {
                  tools.addFog();
                  commit('Added fog.');
                }}
              />
            )}
          </DetailsCategory>

          <DetailsCategory name="Glow" help="Bright parts of the picture bleed a soft light around them (bloom)." defaultOpen>
            {glow ? (
              <>
                <PropertyRow label="Glow" help="Turn the glow on or off. Off keeps your settings so you can bring it back.">
                  <Toggle
                    label="Glow"
                    hideLabel
                    checked={glowOn}
                    onChange={(on) => {
                      tools.glowEnabled(on);
                      commit(on ? 'Turned the glow on.' : 'Turned the glow off.');
                    }}
                  />
                </PropertyRow>
                {glowOn && (
                  <>
                    <PropertyRow label="Strength" help="How strong the glow is.">
                      <LiveSlider
                        value={bloomStrength(glow)}
                        label="Glow strength"
                        format={percent}
                        onPreview={tools.glowStrength}
                        onCommit={() => commit('Changed the glow strength.')}
                      />
                    </PropertyRow>
                    <PropertyRow label="Colour" help="The tint of the glow.">
                      <LiveSwatch
                        value={[glow.compositeColor[0], glow.compositeColor[1], glow.compositeColor[2]]}
                        label="Glow colour"
                        showHex
                        onPreview={tools.glowColor}
                        onCommit={() => commit('Changed the glow colour.')}
                      />
                    </PropertyRow>
                    <PropertyRow label="What glows" help="Slide left and almost everything glows. Slide right and only the very brightest things do.">
                      <LiveSlider
                        value={glow.thresholdAmount}
                        label="What glows"
                        lowLabel="Everything"
                        highLabel="Brightest only"
                        onPreview={tools.glowThreshold}
                        onCommit={() => commit('Changed what glows.')}
                      />
                    </PropertyRow>
                  </>
                )}
              </>
            ) : (
              <MissingEffect
                text="This track has no glow."
                action="Add glow"
                onAdd={() => {
                  tools.addGlow();
                  commit('Added glow.');
                }}
              />
            )}
          </DetailsCategory>

          <DetailsCategory name="Depth of field" help="Blurs what is far from the point of focus, like a camera lens." defaultOpen={false}>
            <PropertyRow label="Show it" help="Preview the blur in the viewport. It is off by default because it is slow; this does not change the track.">
              <Toggle label="Show depth of field" hideLabel checked={settings.depthOfField} disabled={!hasScene} onChange={(on) => onChangeSettings({ depthOfField: on })} />
            </PropertyRow>
            {dof ? (
              <>
                {dof.drawMode !== DOF_PREVIEW_DRAW_MODE && (
                  <p className="visualRowNote">This track uses a blur style the viewport cannot preview, but your changes are still saved.</p>
                )}
                <PropertyRow label="Focus distance" help="How far from the camera things are sharpest.">
                  <LiveSlider
                    value={distanceToSlider(dof.focusCenter, DOF_MAX_DISTANCE)}
                    max={1}
                    step={0.005}
                    label="Focus distance"
                    format={(position) => formatDistance(sliderToDistance(position, DOF_MAX_DISTANCE))}
                    onPreview={(position) => {
                      onChangeSettings({ depthOfField: true });
                      tools.dofField('focusCenter', sliderToDistance(position, DOF_MAX_DISTANCE));
                    }}
                    onCommit={() => commit('Changed the focus distance.')}
                  />
                </PropertyRow>
                <PropertyRow label="Sharp zone" help="How deep the in-focus area is. Larger keeps more of the scene sharp.">
                  <LiveSlider
                    value={distanceToSlider(dof.focusRange, DOF_MAX_DISTANCE)}
                    max={1}
                    step={0.005}
                    label="Sharp zone depth"
                    format={(position) => formatDistance(sliderToDistance(position, DOF_MAX_DISTANCE))}
                    onPreview={(position) => {
                      onChangeSettings({ depthOfField: true });
                      tools.dofField('focusRange', sliderToDistance(position, DOF_MAX_DISTANCE));
                    }}
                    onCommit={() => commit('Changed the sharp zone.')}
                  />
                </PropertyRow>
                <PropertyRow label="Blur amount" help="How soft the out-of-focus areas get.">
                  <LiveSlider
                    value={dof.blurRadius}
                    min={0}
                    max={DOF_MAX_BLUR}
                    step={0.05}
                    label="Blur amount"
                    format={(value) => value.toFixed(1)}
                    onPreview={(value) => {
                      onChangeSettings({ depthOfField: true });
                      tools.dofField('blurRadius', value);
                    }}
                    onCommit={() => commit('Changed the blur amount.')}
                  />
                </PropertyRow>
              </>
            ) : (
              <MissingEffect
                text="This track has no depth of field."
                action="Add depth of field"
                onAdd={() => {
                  tools.addDof();
                  commit('Added depth of field.');
                  onChangeSettings({ depthOfField: true });
                }}
              />
            )}
          </DetailsCategory>

          <DetailsCategory name="Sky" help="The skybox and the sun flare drawn over the track." defaultOpen={false}>
            <PropertyRow label="Show sky" help="Hide the skybox to see the track against black. This only changes the preview.">
              <Toggle
                label="Show sky"
                hideLabel
                checked={settings.skybox}
                disabled={!hasScene || !skybox}
                onChange={(on) => onChangeSettings({ skybox: on })}
              />
            </PropertyRow>
            {stage ? (
              <>
                <PropertyRow label="Sun flare" help="The colour and strength of the sun flare drawn over the track. The viewport does not draw it; it shows in the game.">
                  <LiveSwatch
                    value={[stage.flareColor[0], stage.flareColor[1], stage.flareColor[2]]}
                    label="Sun flare colour"
                    showHex
                    onCommit={(color) => env.commitStage({ color: [color[0], color[1], color[2], stage.flareColor[3]] }, 'Changed the sun flare colour.')}
                  />
                </PropertyRow>
                <PropertyRow label="Flare strength" help="How strong the sun flare is.">
                  <LiveSlider
                    value={stage.flareColor[3] / 255}
                    label="Sun flare strength"
                    format={percent}
                    onCommit={(value) =>
                      env.commitStage({ color: [stage.flareColor[0], stage.flareColor[1], stage.flareColor[2], Math.round(value * 255)] }, 'Changed the sun flare strength.')
                    }
                  />
                </PropertyRow>
                <PropertyRow label="Sun flash" help="Turns on the white flash the sun flare makes as it passes the camera.">
                  <Toggle
                    label="Sun flash"
                    hideLabel
                    checked={stage.flash}
                    onChange={(on) => env.commitStage({ flash: on }, on ? 'Turned the sun flash on.' : 'Turned the sun flash off.')}
                  />
                </PropertyRow>
              </>
            ) : null}
          </DetailsCategory>

          <DetailsCategory name="Show and hide" help="Preview only. Hides parts of the scene so you can look at the rest." defaultOpen={false}>
            {trackModels
              .filter((model) => model.kind !== 'imported')
              .map((model) => (
                <PropertyRow key={model.archivePath} label={model.kind === 'course' ? 'Track' : model.modelName}>
                  <Toggle
                    label={`Show ${model.modelName}`}
                    hideLabel
                    checked={model.visible}
                    onChange={(on) => onSetModelVisible(model.archivePath, on)}
                  />
                </PropertyRow>
              ))}
            <PropertyRow label="Objects" help="The objects placed in the track (item boxes, trees, enemies).">
              <Toggle label="Show objects" hideLabel checked={settings.objects} disabled={!hasScene} onChange={(on) => onChangeSettings({ objects: on })} />
            </PropertyRow>
          </DetailsCategory>

          <DetailsCategory name="Animations" help="Moving water, spinning signs and other animated parts of the track." defaultOpen={false}>
            {animationGroups.every((group) => group.rows.length === 0) ? (
              <p className="visualRowNote">This track has no animations the viewport can play.</p>
            ) : (
              <>
                <div className="visualScrubber">
                  <div className="visualScrubberRow">
                    <IconButton
                      size="sm"
                      variant="ghost"
                      icon={animationsPlaying ? <Pause size={14} /> : <Play size={14} />}
                      tooltip={animationsPlaying ? 'Pause every animation' : 'Play every animation'}
                      onClick={() => onSetAnimationsPlaying(!animationsPlaying)}
                    />
                    <IconButton size="sm" variant="ghost" icon={<SkipBack size={14} />} tooltip="Back to the start" onClick={() => onScrubAnimations(0)} />
                    <input
                      type="range"
                      className="visualSlider"
                      min={0}
                      max={Math.max(1, animationLength)}
                      step={1}
                      aria-label="Animation time"
                      value={Math.min(animationFrame ?? 0, Math.max(1, animationLength))}
                      style={{ '--fill': `${(Math.min(animationFrame ?? 0, Math.max(1, animationLength)) / Math.max(1, animationLength)) * 100}%` } as CSSProperties}
                      onChange={(event) => onScrubAnimations(Number(event.currentTarget.value))}
                    />
                  </div>
                  {animationFrame !== null && (
                    <button type="button" className="visualLinkButton" onClick={() => onScrubAnimations(null)}>
                      Let it play on its own again
                    </button>
                  )}
                </div>
                {animationGroups.map((group) =>
                  group.rows.map((row) => (
                    <PropertyRow
                      key={`${group.archivePath}/${row.kind}/${row.name}`}
                      label={row.name}
                      help={`${animationKindLabel(row.kind)} in ${group.label}, ${Math.round(row.duration)} frames.${row.supported ? '' : ' The viewport cannot play this kind.'}`}
                    >
                      <Toggle
                        label={`Play ${row.name}`}
                        hideLabel
                        checked={row.enabled}
                        disabled={!row.supported}
                        onChange={(on) => onSetAnimationEnabled(group.archivePath, row, on)}
                      />
                    </PropertyRow>
                  )),
                )}
              </>
            )}
          </DetailsCategory>

          {postEffectActions && (
            <DetailsCategory name="Raw effect files" help="Every value in the track's posteffect files, for experts." defaultOpen={false}>
              <PostEffectsPanel resources={resources} {...postEffectActions} />
            </DetailsCategory>
          )}
        </div>
      </div>
    </aside>
  );
}

/** Every light the file has switched on, for the author who wants more than the sun and shadows. */
function AllLights({ blight, env }: { blight: PostEffectBlightFile; env: EnvironmentEditor }) {
  const lights = blight.lightObjects.map((light, index) => ({ light, index })).filter(({ light }) => isLightEnabled(light));
  return (
    <DetailsCategory name="All lights" help="Every light this track switches on. Lights marked 'course' light the track model; the others light objects and karts." defaultOpen={false} className="visualNested">
      {lights.map(({ light, index }) => {
        const shadow = blight.ambientLights[light.ambientLightIndex];
        return (
          <PropertyRow key={index} label={`Light ${index + 1}`} help={isCourseLight(light) ? 'Lights the track model.' : 'Lights objects and karts.'}>
            <span className="visualLightRow">
              <LiveSwatch
                size="sm"
                value={[light.color[0], light.color[1], light.color[2]]}
                label={`Light ${index + 1} colour`}
                onPreview={(color) => env.tools.lightColor(index, color)}
                onCommit={() => env.commit(`Changed light ${index + 1}.`)}
              />
              {shadow && (
                <LiveSwatch
                  size="sm"
                  value={[shadow[0], shadow[1], shadow[2]]}
                  label={`Light ${index + 1} shadow colour`}
                  onPreview={(color) => env.tools.ambientColor(light.ambientLightIndex, color)}
                  onCommit={() => env.commit(`Changed the shadow colour of light ${index + 1}.`)}
                />
              )}
              {isCourseLight(light) && <span className="visualLightTag">course</span>}
            </span>
          </PropertyRow>
        );
      })}
    </DetailsCategory>
  );
}

// Icons exported for the Details summary so the two panels agree on what each effect looks like.
export const ENVIRONMENT_ICONS = { light: Sun, fog: CloudFog, glow: Sparkles, focus: Focus, sky: Sunrise, animation: Film };
