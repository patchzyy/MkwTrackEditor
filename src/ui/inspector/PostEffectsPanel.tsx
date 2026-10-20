import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  type PostEffectBlightFile,
  type PostEffectBloomFile,
  type PostEffectDofFile,
} from '../../lib/posteffects';
import { Button } from '../components/Button';
import { NumberInput } from '../components/NumberInput';
import { Select } from '../components/Select';
import { RgbaColorField } from './fields/RgbaColorField';
import { RgbColorField } from './fields/RgbColorField';
import { DetailsCategory, PropertyRow } from './PropertySheet';
import type { AreaFogPreset, PostEffectResources } from './postEffectResources';

const fogTypeOptions = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Perspective Linear' },
  { value: 2, label: 'Perspective Exp' },
  { value: 3, label: 'Perspective Exp2' },
  { value: 4, label: 'Perspective InvExp' },
  { value: 5, label: 'Perspective InvExp2' },
  { value: 6, label: 'Orthographic Linear' },
  { value: 7, label: 'Orthographic Exp' },
  { value: 8, label: 'Orthographic Exp2' },
  { value: 9, label: 'Orthographic InvExp' },
  { value: 10, label: 'Orthographic InvExp2' },
];

const dofDrawModeOptions = [
  { value: 0, label: 'Off / Unknown' },
  { value: 1, label: 'Inverse Only' },
  { value: 2, label: 'Normal + Inverse' },
];

const dofDrawAmountOptions = [
  { value: 0, label: 'Wide Blur' },
  { value: 1, label: 'Tighter Blur' },
];

const lightTypeOptions = [
  { value: 0, label: 'Omni' },
  { value: 1, label: 'Directional' },
  { value: 2, label: 'Spotlight' },
];

const lightCoordinateOptions = [
  { value: 1, label: 'World' },
  { value: 2, label: 'View' },
  { value: 3, label: 'Top-Down' },
  { value: 4, label: 'Bottom-Up' },
];

const lightSpotFunctionOptions = [
  { value: 0, label: 'Disabled' },
  { value: 1, label: 'Flat' },
  { value: 2, label: 'Cosine' },
  { value: 3, label: 'Cosine Smooth' },
  { value: 4, label: 'Sharp' },
  { value: 5, label: 'Ring Dim' },
  { value: 6, label: 'Ring' },
];

const lightDistanceOptions = [
  { value: 0, label: 'Disabled' },
  { value: 1, label: 'Gentle' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Steep' },
];

type Options = ReadonlyArray<{ value: number; label: string }>;

/** One number in a property row. Typing commits on blur or Enter; dragging is off so a scrub is not a hundred undo steps. */
function NumRow({
  label,
  name,
  value,
  step = 0.01,
  min,
  max,
  integer,
  onChange,
}: {
  label: string;
  /** Accessible name; includes the file it belongs to. */
  name: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <PropertyRow label={label}>
      <NumberInput
        value={Number.isFinite(value) ? value : 0}
        label={name}
        step={step}
        min={min}
        max={max}
        integer={integer}
        scrub={false}
        onChange={(next) => {
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </PropertyRow>
  );
}

function ChoiceRow({ label, name, value, options, onChange }: { label: string; name: string; value: number; options: Options; onChange: (value: number) => void }) {
  const shown = options.some((option) => option.value === value) ? options : [...options, { value, label: `Unknown (${value})` }];
  return (
    <PropertyRow label={label}>
      <Select label={name} value={value} options={shown} size="sm" onChange={(next) => onChange(Number(next))} />
    </PropertyRow>
  );
}

/** One file's worth of rows, folded away until asked for. */
function FileGroup({ name, help, children }: { name: string; help?: string; children: ReactNode }) {
  return (
    <DetailsCategory name={name} help={help} defaultOpen={false} className="visualNested">
      {children}
    </DetailsCategory>
  );
}

/** A file the track does not have (or may want another of), with the buttons that add it. */
function CreateRow({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="visualMissing">
      <span>{text}</span>
      <span className="rawEffectButtons">{children}</span>
    </div>
  );
}

/**
 * Every value in the track's posteffect files, for experts. Visual mode's Environment panel holds
 * the friendly Light, Fog and Glow controls; this is the long tail underneath them (blur passes,
 * indirect-texture scrolls, per-light attenuation). Missing files can be created here and export
 * with the track.
 */
export function PostEffectsPanel({
  resources,
  onCreateFog,
  onChangeFogPreset,
  onAddBloom,
  onChangeBloomFile,
  onCreateDof,
  onChangeDofFile,
  onCreateBlight,
  onChangeBlight,
}: {
  resources: PostEffectResources;
  onCreateFog: () => void;
  onChangeFogPreset: (index: number, patch: (entry: AreaFogPreset) => AreaFogPreset) => void;
  onAddBloom: () => void;
  onChangeBloomFile: (path: string, data: PostEffectBloomFile) => void;
  onCreateDof: (kind: 'main' | 'demo') => void;
  onChangeDofFile: (path: string, data: PostEffectDofFile) => void;
  onCreateBlight: () => void;
  onChangeBlight: (data: PostEffectBlightFile) => void;
}) {
  const blight = resources.blight;
  const patchLight = (index: number, patch: Partial<PostEffectBlightFile['lightObjects'][number]>) => {
    if (!blight) return;
    onChangeBlight({ ...blight, lightObjects: blight.lightObjects.map((entry, lightIndex) => (lightIndex === index ? { ...entry, ...patch } : entry)) });
  };

  return (
    <>
      {resources.fogPath ? (
        resources.fogPresets.map((preset) => {
          const set = (patch: Partial<AreaFogPreset>) => onChangeFogPreset(preset.index, (entry) => ({ ...entry, ...patch }));
          const name = `Fog preset ${preset.index}`;
          return (
            <FileGroup key={`fog-${preset.index}`} name={name} help="Type, near and far distance, colour and fade speed. Area type 2 can swap these presets in-game.">
              <ChoiceRow label="Type" name={`${name} type`} value={preset.fogType} options={fogTypeOptions} onChange={(fogType) => set({ fogType })} />
              <NumRow label="Start distance" name={`${name} start Z`} step={1} value={preset.startZ} onChange={(startZ) => set({ startZ })} />
              <NumRow label="End distance" name={`${name} end Z`} step={1} value={preset.endZ} onChange={(endZ) => set({ endZ })} />
              <PropertyRow label="Colour">
                <RgbColorField value={preset.color} onChange={(color) => set({ color })} />
              </PropertyRow>
              <NumRow label="Fade speed" name={`${name} fade speed`} value={preset.fadeSpeed} onChange={(fadeSpeed) => set({ fadeSpeed })} />
            </FileGroup>
          );
        })
      ) : (
        <CreateRow text="No fog file yet.">
          <Button size="sm" icon={<Plus size={13} />} onClick={onCreateFog}>
            Create fog file
          </Button>
        </CreateRow>
      )}

      {resources.bloomFiles.map((file) => {
        const set = (patch: Partial<PostEffectBloomFile>) => onChangeBloomFile(file.path, { ...file.data, ...patch });
        const base = file.path;
        return (
          <FileGroup key={file.path} name={`Glow preset ${file.index}`} help={`Threshold, colours, blur passes and glow scales for ${file.path.split('/').pop()}.`}>
            <NumRow label="Threshold" name={`${base} threshold amount`} value={file.data.thresholdAmount} onChange={(thresholdAmount) => set({ thresholdAmount })} />
            <PropertyRow label="Threshold colour">
              <RgbaColorField value={file.data.thresholdColor} onChange={(thresholdColor) => set({ thresholdColor })} />
            </PropertyRow>
            <PropertyRow label="Glow colour">
              <RgbaColorField value={file.data.compositeColor} onChange={(compositeColor) => set({ compositeColor })} />
            </PropertyRow>
            <NumRow label="Blur flags" name={`${base} blur flags`} step={1} integer min={0} max={0xffff} value={file.data.blurFlags} onChange={(blurFlags) => set({ blurFlags })} />
            <NumRow label="Blur 0 radius" name={`${base} blur 0 radius`} value={file.data.blur0Radius} onChange={(blur0Radius) => set({ blur0Radius })} />
            <NumRow label="Blur 0 intensity" name={`${base} blur 0 intensity`} value={file.data.blur0Intensity} onChange={(blur0Intensity) => set({ blur0Intensity })} />
            <NumRow label="Blur 1 radius" name={`${base} blur 1 radius`} value={file.data.blur1Radius} onChange={(blur1Radius) => set({ blur1Radius })} />
            <NumRow label="Blur 1 intensity" name={`${base} blur 1 intensity`} value={file.data.blur1Intensity} onChange={(blur1Intensity) => set({ blur1Intensity })} />
            <NumRow label="Blend mode" name={`${base} blend mode`} step={1} integer min={0} max={255} value={file.data.compositeBlendMode} onChange={(compositeBlendMode) => set({ compositeBlendMode })} />
            <NumRow label="Second blur passes" name={`${base} second blur passes`} step={1} integer min={0} max={255} value={file.data.blur1NumPasses} onChange={(blur1NumPasses) => set({ blur1NumPasses })} />
            <NumRow label="Bokeh scale 0" name={`${base} bokeh scale 0`} value={file.data.bokehColorScale0} onChange={(bokehColorScale0) => set({ bokehColorScale0 })} />
            <NumRow label="Bokeh scale 1" name={`${base} bokeh scale 1`} value={file.data.bokehColorScale1} onChange={(bokehColorScale1) => set({ bokehColorScale1 })} />
          </FileGroup>
        );
      })}
      <CreateRow text={resources.bloomFiles.length === 0 ? 'No glow file yet.' : 'More glow presets'}>
        <Button size="sm" icon={<Plus size={13} />} onClick={onAddBloom}>
          Add glow preset
        </Button>
      </CreateRow>

      {resources.dofFiles.map((file) => {
        const set = (patch: Partial<PostEffectDofFile>) => onChangeDofFile(file.path, { ...file.data, ...patch });
        const base = file.path;
        return (
          <FileGroup key={file.path} name={file.label} help={`Focus plane, blur strength and warp-scroll controls for ${file.path.split('/').pop()}.`}>
            <NumRow label="Flags" name={`${base} flags`} step={1} integer min={0} max={0xffff} value={file.data.flags} onChange={(flags) => set({ flags })} />
            <ChoiceRow label="Draw mode" name={`${base} draw mode`} value={file.data.drawMode} options={dofDrawModeOptions} onChange={(drawMode) => set({ drawMode })} />
            <ChoiceRow label="Blur amount" name={`${base} blur draw amount`} value={file.data.blurDrawAmount} options={dofDrawAmountOptions} onChange={(blurDrawAmount) => set({ blurDrawAmount })} />
            <NumRow label="Curve type" name={`${base} curve type`} step={1} integer min={0} max={255} value={file.data.depthCurveType} onChange={(depthCurveType) => set({ depthCurveType })} />
            <NumRow label="Inverse alpha" name={`${base} inverse alpha`} step={1} integer min={0} max={255} value={file.data.blurAlpha[0]} onChange={(next) => set({ blurAlpha: [next, file.data.blurAlpha[1]] })} />
            <NumRow label="Alpha" name={`${base} alpha`} step={1} integer min={0} max={255} value={file.data.blurAlpha[1]} onChange={(next) => set({ blurAlpha: [file.data.blurAlpha[0], next] })} />
            <NumRow label="Focus distance" name={`${base} focus distance`} value={file.data.focusCenter} onChange={(focusCenter) => set({ focusCenter })} />
            <NumRow label="Focus range" name={`${base} focus range`} value={file.data.focusRange} onChange={(focusRange) => set({ focusRange })} />
            <NumRow label="Blur radius" name={`${base} blur radius`} value={file.data.blurRadius} onChange={(blurRadius) => set({ blurRadius })} />
            <NumRow label="Scroll S" name={`${base} scroll s`} value={file.data.indTexTransSScroll} onChange={(indTexTransSScroll) => set({ indTexTransSScroll })} />
            <NumRow label="Scroll T" name={`${base} scroll t`} value={file.data.indTexTransTScroll} onChange={(indTexTransTScroll) => set({ indTexTransTScroll })} />
            <NumRow label="Indirect scale S" name={`${base} indirect scale s`} value={file.data.indTexIndScaleS} onChange={(indTexIndScaleS) => set({ indTexIndScaleS })} />
            <NumRow label="Indirect scale T" name={`${base} indirect scale t`} value={file.data.indTexIndScaleT} onChange={(indTexIndScaleT) => set({ indTexIndScaleT })} />
            <NumRow label="Texture scale S" name={`${base} texture scale s`} value={file.data.indTexScaleS} onChange={(indTexScaleS) => set({ indTexScaleS })} />
            <NumRow label="Texture scale T" name={`${base} texture scale t`} value={file.data.indTexScaleT} onChange={(indTexScaleT) => set({ indTexScaleT })} />
          </FileGroup>
        );
      })}
      <CreateRow text={resources.dofFiles.length === 0 ? 'No depth-of-field file yet.' : 'More depth-of-field files'}>
        <Button size="sm" icon={<Plus size={13} />} onClick={() => onCreateDof('main')}>
          Main
        </Button>
        <Button size="sm" icon={<Plus size={13} />} onClick={() => onCreateDof('demo')}>
          Intro
        </Button>
      </CreateRow>

      {blight ? (
        <>
          <FileGroup name="Lighting base" help="Global ambient-black colour from posteffect.blight.">
            <PropertyRow label="Ambient black">
              <RgbaColorField value={blight.ambientBlackColor} onChange={(ambientBlackColor) => onChangeBlight({ ...blight, ambientBlackColor })} />
            </PropertyRow>
          </FileGroup>
          {blight.ambientLights.map((ambient, index) => (
            <FileGroup key={`ambient-light-${index}`} name={`Ambient light ${index}`} help="Ambient light colour linked by light objects and by KCL light IDs.">
              <PropertyRow label="Colour">
                <RgbaColorField
                  value={ambient}
                  onChange={(nextAmbient) => onChangeBlight({ ...blight, ambientLights: blight.ambientLights.map((value, ambientIndex) => (ambientIndex === index ? nextAmbient : value)) })}
                />
              </PropertyRow>
            </FileGroup>
          ))}
          {blight.lightObjects.slice(0, 8).map((light, index) => {
            const name = `BLIGHT light ${index}`;
            return (
              <FileGroup key={`light-object-${index}`} name={`Light object ${index}`} help="Core lighting setup for KCL light IDs 0 through 7: type, ambient link, colour, intensity and attenuation.">
                <ChoiceRow label="Type" name={`${name} type`} value={light.lightType} options={lightTypeOptions} onChange={(lightType) => patchLight(index, { lightType })} />
                <ChoiceRow label="Coordinates" name={`${name} coordinates`} value={light.coordinateSystem} options={lightCoordinateOptions} onChange={(coordinateSystem) => patchLight(index, { coordinateSystem })} />
                <NumRow label="Flags" name={`${name} flags`} step={1} integer min={0} max={0xffff} value={light.flags} onChange={(flags) => patchLight(index, { flags })} />
                <NumRow label="Ambient link" name={`${name} ambient link`} step={1} integer min={0} max={15} value={light.ambientLightIndex} onChange={(ambientLightIndex) => patchLight(index, { ambientLightIndex })} />
                <ChoiceRow label="Spot function" name={`${name} spot function`} value={light.spotFunction} options={lightSpotFunctionOptions} onChange={(spotFunction) => patchLight(index, { spotFunction })} />
                <ChoiceRow label="Distance falloff" name={`${name} distance falloff`} value={light.distAttnFunction} options={lightDistanceOptions} onChange={(distAttnFunction) => patchLight(index, { distAttnFunction })} />
                <NumRow label="Intensity" name={`${name} intensity`} value={light.intensity} onChange={(intensity) => patchLight(index, { intensity })} />
                <PropertyRow label="Colour">
                  <RgbaColorField value={light.color} onChange={(color) => patchLight(index, { color })} />
                </PropertyRow>
                <PropertyRow label="Specular colour">
                  <RgbaColorField value={light.specColor} onChange={(specColor) => patchLight(index, { specColor })} />
                </PropertyRow>
                <NumRow label="Cutoff" name={`${name} cutoff`} value={light.spotCutoff} onChange={(spotCutoff) => patchLight(index, { spotCutoff })} />
                <NumRow label="Reference distance" name={`${name} reference distance`} value={light.refDist} onChange={(refDist) => patchLight(index, { refDist })} />
                <NumRow label="Reference brightness" name={`${name} reference brightness`} value={light.refBrightness} onChange={(refBrightness) => patchLight(index, { refBrightness })} />
                <NumRow label="Vector shift link" name={`${name} vector shift link`} step={1} integer min={0} max={15} value={light.linkedLightIndex} onChange={(linkedLightIndex) => patchLight(index, { linkedLightIndex })} />
              </FileGroup>
            );
          })}
        </>
      ) : (
        <CreateRow text="No lighting file yet.">
          <Button size="sm" icon={<Plus size={13} />} onClick={onCreateBlight}>
            Create lighting file
          </Button>
        </CreateRow>
      )}
    </>
  );
}
