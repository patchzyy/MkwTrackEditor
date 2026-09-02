import {
  type PostEffectBlightFile,
  type PostEffectBloomFile,
  type PostEffectDofFile,
} from '../../lib/posteffects';
import { RgbaColorField } from './fields/RgbaColorField';
import { RgbColorField } from './fields/RgbColorField';
import { clampByte, type AreaFogPreset, type PostEffectResources } from './postEffectResources';

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
  return (
    <>
      <h2>Post Effects</h2>
      <div className="propertyGrid">
        <label>
          Overview
          <span>Edit fog, bloom, and depth-of-field directly from the loaded track archive. Missing files can be created here and will export with the track.</span>
        </label>
        {resources.fogPath ? (
          resources.fogPresets.map((preset) => (
            <label key={`fog-${preset.index}`}>
              Fog Preset {preset.index}
              <div className="postEffectEditor">
                <select value={preset.fogType} onChange={(event) => onChangeFogPreset(preset.index, (entry) => ({ ...entry, fogType: Number(event.currentTarget.value) }))}>
                  {fogTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="1"
                  value={Number.isFinite(preset.startZ) ? Number(preset.startZ.toFixed(2)) : 0}
                  title="Start Z"
                  aria-label={`Fog preset ${preset.index} start Z`}
                  onChange={(event) => {
                    const next = Number(event.currentTarget.value);
                    if (Number.isFinite(next)) onChangeFogPreset(preset.index, (entry) => ({ ...entry, startZ: next }));
                  }}
                />
                <input
                  type="number"
                  step="1"
                  value={Number.isFinite(preset.endZ) ? Number(preset.endZ.toFixed(2)) : 0}
                  title="End Z"
                  aria-label={`Fog preset ${preset.index} end Z`}
                  onChange={(event) => {
                    const next = Number(event.currentTarget.value);
                    if (Number.isFinite(next)) onChangeFogPreset(preset.index, (entry) => ({ ...entry, endZ: next }));
                  }}
                />
                <RgbColorField value={preset.color} onChange={(color) => onChangeFogPreset(preset.index, (entry) => ({ ...entry, color }))} />
                <input
                  type="number"
                  step="0.01"
                  value={Number.isFinite(preset.fadeSpeed) ? Number(preset.fadeSpeed.toFixed(3)) : 0}
                  title="Fade Speed"
                  aria-label={`Fog preset ${preset.index} fade speed`}
                  onChange={(event) => {
                    const next = Number(event.currentTarget.value);
                    if (Number.isFinite(next)) onChangeFogPreset(preset.index, (entry) => ({ ...entry, fadeSpeed: next }));
                  }}
                />
              </div>
              <span>Type, near Z, far Z, color, and fade speed. AREA type 2 can swap these presets in-game.</span>
            </label>
          ))
        ) : (
          <label>
            Fog
            <button className="inlineAction" type="button" onClick={onCreateFog}>
              Create Fog File
            </button>
          </label>
        )}
        <label>
          Bloom Files
          <div className="actionStack">
            <button className="inlineAction" type="button" onClick={onAddBloom}>
              Add Bloom Preset
            </button>
            <span>AREA type 6 can swap between `posteffect.bblm`, `posteffect.bblm1`, and later files.</span>
          </div>
        </label>
        {resources.bloomFiles.map((file) => (
          <label key={file.path}>
            Bloom Preset {file.index}
            <div className="postEffectEditor">
              <input
                type="number"
                step="0.01"
                value={Number.isFinite(file.data.thresholdAmount) ? Number(file.data.thresholdAmount.toFixed(3)) : 0}
                title="Threshold Amount"
                aria-label={`${file.path} threshold amount`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeBloomFile(file.path, { ...file.data, thresholdAmount: next });
                }}
              />
              <RgbaColorField value={file.data.thresholdColor} onChange={(thresholdColor) => onChangeBloomFile(file.path, { ...file.data, thresholdColor })} />
              <RgbaColorField value={file.data.compositeColor} onChange={(compositeColor) => onChangeBloomFile(file.path, { ...file.data, compositeColor })} />
              <input
                type="number"
                min="0"
                max="65535"
                value={file.data.blurFlags}
                title="Blur Flags"
                aria-label={`${file.path} blur flags`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeBloomFile(file.path, { ...file.data, blurFlags: Math.max(0, Math.min(0xffff, Math.trunc(next))) });
                }}
              />
              <input
                type="number"
                step="0.01"
                value={Number.isFinite(file.data.blur0Radius) ? Number(file.data.blur0Radius.toFixed(3)) : 0}
                title="Blur 0 Radius"
                aria-label={`${file.path} blur 0 radius`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeBloomFile(file.path, { ...file.data, blur0Radius: next });
                }}
              />
              <input
                type="number"
                step="0.01"
                value={Number.isFinite(file.data.blur0Intensity) ? Number(file.data.blur0Intensity.toFixed(3)) : 0}
                title="Blur 0 Intensity"
                aria-label={`${file.path} blur 0 intensity`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeBloomFile(file.path, { ...file.data, blur0Intensity: next });
                }}
              />
              <input
                type="number"
                step="0.01"
                value={Number.isFinite(file.data.blur1Radius) ? Number(file.data.blur1Radius.toFixed(3)) : 0}
                title="Blur 1 Radius"
                aria-label={`${file.path} blur 1 radius`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeBloomFile(file.path, { ...file.data, blur1Radius: next });
                }}
              />
              <input
                type="number"
                step="0.01"
                value={Number.isFinite(file.data.blur1Intensity) ? Number(file.data.blur1Intensity.toFixed(3)) : 0}
                title="Blur 1 Intensity"
                aria-label={`${file.path} blur 1 intensity`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeBloomFile(file.path, { ...file.data, blur1Intensity: next });
                }}
              />
              <input
                type="number"
                min="0"
                max="255"
                value={file.data.compositeBlendMode}
                title="Blend Mode"
                aria-label={`${file.path} blend mode`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeBloomFile(file.path, { ...file.data, compositeBlendMode: Math.max(0, Math.min(0xff, Math.trunc(next))) });
                }}
              />
              <input
                type="number"
                min="0"
                max="255"
                value={file.data.blur1NumPasses}
                title="Second Blur Passes"
                aria-label={`${file.path} second blur passes`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeBloomFile(file.path, { ...file.data, blur1NumPasses: Math.max(0, Math.min(0xff, Math.trunc(next))) });
                }}
              />
              <input
                type="number"
                step="0.01"
                value={Number.isFinite(file.data.bokehColorScale0) ? Number(file.data.bokehColorScale0.toFixed(3)) : 0}
                title="Bokeh Scale 0"
                aria-label={`${file.path} bokeh scale 0`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeBloomFile(file.path, { ...file.data, bokehColorScale0: next });
                }}
              />
              <input
                type="number"
                step="0.01"
                value={Number.isFinite(file.data.bokehColorScale1) ? Number(file.data.bokehColorScale1.toFixed(3)) : 0}
                title="Bokeh Scale 1"
                aria-label={`${file.path} bokeh scale 1`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeBloomFile(file.path, { ...file.data, bokehColorScale1: next });
                }}
              />
            </div>
            <span>Threshold, colors, blur passes, and glow scales for {file.path.split('/').pop()}.</span>
          </label>
        ))}
        {resources.bloomFiles.length === 0 && (
          <label>
            Bloom
            <span>No bloom files are in this archive yet. Add one above to create a swappable bloom preset.</span>
          </label>
        )}
        <label>
          Depth Of Field
          <div className="actionRow">
            <button className="inlineAction" type="button" onClick={() => onCreateDof('main')}>
              Create Main DOF
            </button>
            <button className="inlineAction" type="button" onClick={() => onCreateDof('demo')}>
              Create Intro DOF
            </button>
          </div>
        </label>
        {resources.dofFiles.map((file) => (
          <label key={file.path}>
            {file.label}
            <div className="postEffectEditor">
              <input
                type="number"
                min="0"
                max="65535"
                value={file.data.flags}
                title="Flags"
                aria-label={`${file.path} flags`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeDofFile(file.path, { ...file.data, flags: Math.max(0, Math.min(0xffff, Math.trunc(next))) });
                }}
              />
              <select value={file.data.drawMode} onChange={(event) => onChangeDofFile(file.path, { ...file.data, drawMode: Number(event.currentTarget.value) })}>
                {dofDrawModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select value={file.data.blurDrawAmount} onChange={(event) => onChangeDofFile(file.path, { ...file.data, blurDrawAmount: Number(event.currentTarget.value) })}>
                {dofDrawAmountOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                max="255"
                value={file.data.depthCurveType}
                title="Curve Type"
                aria-label={`${file.path} curve type`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeDofFile(file.path, { ...file.data, depthCurveType: Math.max(0, Math.min(0xff, Math.trunc(next))) });
                }}
              />
              <input
                type="number"
                min="0"
                max="255"
                value={file.data.blurAlpha[0]}
                title="Inverse Alpha"
                aria-label={`${file.path} inverse alpha`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeDofFile(file.path, { ...file.data, blurAlpha: [clampByte(next), file.data.blurAlpha[1]] });
                }}
              />
              <input
                type="number"
                min="0"
                max="255"
                value={file.data.blurAlpha[1]}
                title="Alpha"
                aria-label={`${file.path} alpha`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeDofFile(file.path, { ...file.data, blurAlpha: [file.data.blurAlpha[0], clampByte(next)] });
                }}
              />
              <input
                type="number"
                step="0.01"
                value={Number.isFinite(file.data.focusCenter) ? Number(file.data.focusCenter.toFixed(3)) : 0}
                title="Focus Distance"
                aria-label={`${file.path} focus distance`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeDofFile(file.path, { ...file.data, focusCenter: next });
                }}
              />
              <input
                type="number"
                step="0.01"
                value={Number.isFinite(file.data.focusRange) ? Number(file.data.focusRange.toFixed(3)) : 0}
                title="Focus Range"
                aria-label={`${file.path} focus range`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeDofFile(file.path, { ...file.data, focusRange: next });
                }}
              />
              <input
                type="number"
                step="0.01"
                value={Number.isFinite(file.data.blurRadius) ? Number(file.data.blurRadius.toFixed(3)) : 0}
                title="Blur Radius"
                aria-label={`${file.path} blur radius`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeDofFile(file.path, { ...file.data, blurRadius: next });
                }}
              />
              <input
                type="number"
                step="0.01"
                value={Number.isFinite(file.data.indTexTransSScroll) ? Number(file.data.indTexTransSScroll.toFixed(3)) : 0}
                title="Scroll S"
                aria-label={`${file.path} scroll s`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeDofFile(file.path, { ...file.data, indTexTransSScroll: next });
                }}
              />
              <input
                type="number"
                step="0.01"
                value={Number.isFinite(file.data.indTexTransTScroll) ? Number(file.data.indTexTransTScroll.toFixed(3)) : 0}
                title="Scroll T"
                aria-label={`${file.path} scroll t`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeDofFile(file.path, { ...file.data, indTexTransTScroll: next });
                }}
              />
              <input
                type="number"
                step="0.01"
                value={Number.isFinite(file.data.indTexIndScaleS) ? Number(file.data.indTexIndScaleS.toFixed(3)) : 0}
                title="Indirect Scale S"
                aria-label={`${file.path} indirect scale s`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeDofFile(file.path, { ...file.data, indTexIndScaleS: next });
                }}
              />
              <input
                type="number"
                step="0.01"
                value={Number.isFinite(file.data.indTexIndScaleT) ? Number(file.data.indTexIndScaleT.toFixed(3)) : 0}
                title="Indirect Scale T"
                aria-label={`${file.path} indirect scale t`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeDofFile(file.path, { ...file.data, indTexIndScaleT: next });
                }}
              />
              <input
                type="number"
                step="0.01"
                value={Number.isFinite(file.data.indTexScaleS) ? Number(file.data.indTexScaleS.toFixed(3)) : 0}
                title="Texture Scale S"
                aria-label={`${file.path} texture scale s`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeDofFile(file.path, { ...file.data, indTexScaleS: next });
                }}
              />
              <input
                type="number"
                step="0.01"
                value={Number.isFinite(file.data.indTexScaleT) ? Number(file.data.indTexScaleT.toFixed(3)) : 0}
                title="Texture Scale T"
                aria-label={`${file.path} texture scale t`}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeDofFile(file.path, { ...file.data, indTexScaleT: next });
                }}
              />
            </div>
            <span>Focus plane, blur strength, and warp-scroll controls for {file.path.split('/').pop()}.</span>
          </label>
        ))}
        {resources.dofFiles.length === 0 && (
          <label>
            DOF
            <span>No depth-of-field files are in this archive yet. Create the main or intro file above when you need one.</span>
          </label>
        )}
        {resources.blight ? (
          <>
            <label>
              Lighting Base
              <div className="postEffectEditor">
                <RgbaColorField
                  value={resources.blight.ambientBlackColor}
                  onChange={(ambientBlackColor) => onChangeBlight({ ...resources.blight!, ambientBlackColor })}
                />
              </div>
              <span>Global ambient-black color from `posteffect.blight`.</span>
            </label>
            {resources.blight.ambientLights.map((ambient, index) => (
              <label key={`ambient-light-${index}`}>
                Ambient Light {index}
                <div className="postEffectEditor">
                  <RgbaColorField
                    value={ambient}
                    onChange={(nextAmbient) => {
                      const ambientLights = resources.blight!.ambientLights.map((value, ambientIndex) => (ambientIndex === index ? nextAmbient : value));
                      onChangeBlight({ ...resources.blight!, ambientLights });
                    }}
                  />
                </div>
                <span>Ambient light color linked by BLIGHT light objects and KCL light IDs.</span>
              </label>
            ))}
            {resources.blight.lightObjects.slice(0, 8).map((light, index) => (
              <label key={`light-object-${index}`}>
                Light Object {index}
                <div className="postEffectEditor">
                  <select
                    value={light.lightType}
                    onChange={(event) => {
                      const lightObjects = resources.blight!.lightObjects.map((entry, lightIndex) => (lightIndex === index ? { ...entry, lightType: Number(event.currentTarget.value) } : entry));
                      onChangeBlight({ ...resources.blight!, lightObjects });
                    }}
                  >
                    {lightTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={light.coordinateSystem}
                    onChange={(event) => {
                      const lightObjects = resources.blight!.lightObjects.map((entry, lightIndex) => (lightIndex === index ? { ...entry, coordinateSystem: Number(event.currentTarget.value) } : entry));
                      onChangeBlight({ ...resources.blight!, lightObjects });
                    }}
                  >
                    {lightCoordinateOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    max="65535"
                    value={light.flags}
                    title="Flags"
                    aria-label={`BLIGHT light ${index} flags`}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      if (!Number.isFinite(next)) return;
                      const lightObjects = resources.blight!.lightObjects.map((entry, lightIndex) => (lightIndex === index ? { ...entry, flags: Math.max(0, Math.min(0xffff, Math.trunc(next))) } : entry));
                      onChangeBlight({ ...resources.blight!, lightObjects });
                    }}
                  />
                  <input
                    type="number"
                    min="0"
                    max="15"
                    value={light.ambientLightIndex}
                    title="Ambient Link"
                    aria-label={`BLIGHT light ${index} ambient link`}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      if (!Number.isFinite(next)) return;
                      const lightObjects = resources.blight!.lightObjects.map((entry, lightIndex) => (lightIndex === index ? { ...entry, ambientLightIndex: Math.max(0, Math.min(15, Math.trunc(next))) } : entry));
                      onChangeBlight({ ...resources.blight!, lightObjects });
                    }}
                  />
                  <select
                    value={light.spotFunction}
                    onChange={(event) => {
                      const lightObjects = resources.blight!.lightObjects.map((entry, lightIndex) => (lightIndex === index ? { ...entry, spotFunction: Number(event.currentTarget.value) } : entry));
                      onChangeBlight({ ...resources.blight!, lightObjects });
                    }}
                  >
                    {lightSpotFunctionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={light.distAttnFunction}
                    onChange={(event) => {
                      const lightObjects = resources.blight!.lightObjects.map((entry, lightIndex) => (lightIndex === index ? { ...entry, distAttnFunction: Number(event.currentTarget.value) } : entry));
                      onChangeBlight({ ...resources.blight!, lightObjects });
                    }}
                  >
                    {lightDistanceOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    value={Number.isFinite(light.intensity) ? Number(light.intensity.toFixed(3)) : 0}
                    title="Intensity"
                    aria-label={`BLIGHT light ${index} intensity`}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      if (!Number.isFinite(next)) return;
                      const lightObjects = resources.blight!.lightObjects.map((entry, lightIndex) => (lightIndex === index ? { ...entry, intensity: next } : entry));
                      onChangeBlight({ ...resources.blight!, lightObjects });
                    }}
                  />
                  <RgbaColorField
                    value={light.color}
                    onChange={(color) => {
                      const lightObjects = resources.blight!.lightObjects.map((entry, lightIndex) => (lightIndex === index ? { ...entry, color } : entry));
                      onChangeBlight({ ...resources.blight!, lightObjects });
                    }}
                  />
                  <RgbaColorField
                    value={light.specColor}
                    onChange={(specColor) => {
                      const lightObjects = resources.blight!.lightObjects.map((entry, lightIndex) => (lightIndex === index ? { ...entry, specColor } : entry));
                      onChangeBlight({ ...resources.blight!, lightObjects });
                    }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={Number.isFinite(light.spotCutoff) ? Number(light.spotCutoff.toFixed(3)) : 0}
                    title="Cutoff"
                    aria-label={`BLIGHT light ${index} cutoff`}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      if (!Number.isFinite(next)) return;
                      const lightObjects = resources.blight!.lightObjects.map((entry, lightIndex) => (lightIndex === index ? { ...entry, spotCutoff: next } : entry));
                      onChangeBlight({ ...resources.blight!, lightObjects });
                    }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={Number.isFinite(light.refDist) ? Number(light.refDist.toFixed(3)) : 0}
                    title="Reference Distance"
                    aria-label={`BLIGHT light ${index} reference distance`}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      if (!Number.isFinite(next)) return;
                      const lightObjects = resources.blight!.lightObjects.map((entry, lightIndex) => (lightIndex === index ? { ...entry, refDist: next } : entry));
                      onChangeBlight({ ...resources.blight!, lightObjects });
                    }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={Number.isFinite(light.refBrightness) ? Number(light.refBrightness.toFixed(3)) : 0}
                    title="Reference Brightness"
                    aria-label={`BLIGHT light ${index} reference brightness`}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      if (!Number.isFinite(next)) return;
                      const lightObjects = resources.blight!.lightObjects.map((entry, lightIndex) => (lightIndex === index ? { ...entry, refBrightness: next } : entry));
                      onChangeBlight({ ...resources.blight!, lightObjects });
                    }}
                  />
                  <input
                    type="number"
                    min="0"
                    max="15"
                    value={light.linkedLightIndex}
                    title="Vector Shift Link"
                    aria-label={`BLIGHT light ${index} vector shift link`}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      if (!Number.isFinite(next)) return;
                      const lightObjects = resources.blight!.lightObjects.map((entry, lightIndex) => (lightIndex === index ? { ...entry, linkedLightIndex: Math.max(0, Math.min(15, Math.trunc(next))) } : entry));
                      onChangeBlight({ ...resources.blight!, lightObjects });
                    }}
                  />
                </div>
                <span>Core lighting setup for KCL light IDs 0 through 7: type, ambient link, color, intensity, and attenuation.</span>
              </label>
            ))}
          </>
        ) : (
          <label>
            Lighting
            <button className="inlineAction" type="button" onClick={onCreateBlight}>
              Create Lighting File
            </button>
          </label>
        )}
      </div>
    </>
  );
}
