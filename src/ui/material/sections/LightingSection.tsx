import type { GxChannelDoc, GxMaterialDoc } from '../../../lib/gxMaterial';
import { ColorField, EmptyState, Field, FieldGroup, Select, Toggle } from '../../components';
import { ATTENUATION_FUNCTION_OPTIONS, COLOR_SRC_OPTIONS, DIFFUSE_FUNCTION_OPTIONS } from '../gxOptions';
import type { MaterialDocChange } from '../MaterialInspector';
import { colorToRgb255, patchChannel, patchChannelControl, rgb255ToColor, toggleLitMaskBit } from '../materialDoc';

const CHANNEL_NAMES = ['Channel 1', 'Channel 2'];

/**
 * The two lighting channels. Each has a colour half and an alpha half; the halves choose whether
 * the material's own colour or the vertex colour feeds them, and which scene lights they see.
 */
export function LightingSection({ doc, onChange }: { doc: GxMaterialDoc; onChange: MaterialDocChange }) {
  if (doc.channels.length === 0) {
    return (
      <EmptyState
        size="sm"
        title="No lighting channels"
        description="This material takes its colour entirely from its textures and registers."
      />
    );
  }

  return (
    <div className="materialChannels">
      {doc.channels.map((channel, index) => (
        <section className="materialChannelCard" key={index}>
          <header className="materialLayerHeader">
            <span className="materialLayerIndex">{CHANNEL_NAMES[index] ?? `Channel ${index + 1}`}</span>
          </header>

          <FieldGroup>
            <Field label="Material colour" asGroup help="Used when the source below is set to this material.">
              <ColorField
                label={`${CHANNEL_NAMES[index]} material colour`}
                value={colorToRgb255(channel.materialColor)}
                alpha={Math.round(channel.materialColor.a * 255)}
                onChange={(rgb) => onChange(patchChannel(doc, index, { materialColor: rgb255ToColor(rgb, channel.materialColor.a) }), { status: 'Material colour changed.' })}
                onChangeAlpha={(alpha) => onChange(patchChannel(doc, index, { materialColor: { ...channel.materialColor, a: alpha / 255 } }), { status: 'Material colour changed.' })}
              />
            </Field>
            <Field label="Ambient colour" asGroup>
              <ColorField
                label={`${CHANNEL_NAMES[index]} ambient colour`}
                value={colorToRgb255(channel.ambientColor)}
                alpha={Math.round(channel.ambientColor.a * 255)}
                onChange={(rgb) => onChange(patchChannel(doc, index, { ambientColor: rgb255ToColor(rgb, channel.ambientColor.a) }), { status: 'Ambient colour changed.' })}
                onChangeAlpha={(alpha) => onChange(patchChannel(doc, index, { ambientColor: { ...channel.ambientColor, a: alpha / 255 } }), { status: 'Ambient colour changed.' })}
              />
            </Field>
          </FieldGroup>

          <ChannelHalf doc={doc} index={index} half="color" title="Colour" onChange={onChange} control={channel.color} />
          <ChannelHalf doc={doc} index={index} half="alpha" title="Alpha" onChange={onChange} control={channel.alpha} />
        </section>
      ))}
    </div>
  );
}

function ChannelHalf({
  doc,
  index,
  half,
  title,
  control,
  onChange,
}: {
  doc: GxMaterialDoc;
  index: number;
  half: 'color' | 'alpha';
  title: string;
  control: GxChannelDoc['color'];
  onChange: MaterialDocChange;
}) {
  const patch = (value: Partial<GxChannelDoc['color']>, status: string) =>
    onChange(patchChannelControl(doc, index, half, value), { status });

  return (
    <FieldGroup title={title}>
      <Field label="Lit by scene lights">
        <Toggle
          label={control.lightingEnabled ? 'On' : 'Off'}
          checked={control.lightingEnabled}
          onChange={(checked) => patch({ lightingEnabled: checked }, `${title} lighting ${checked ? 'on' : 'off'}.`)}
        />
      </Field>
      <Field label="Base colour from">
        <Select
          label={`${title} material source`}
          value={String(control.materialSource)}
          options={COLOR_SRC_OPTIONS}
          onChange={(value) => patch({ materialSource: Number(value) as never }, `${title} base colour source changed.`)}
        />
      </Field>
      <Field label="Ambient from">
        <Select
          label={`${title} ambient source`}
          value={String(control.ambientSource)}
          options={COLOR_SRC_OPTIONS}
          onChange={(value) => patch({ ambientSource: Number(value) as never }, `${title} ambient source changed.`)}
        />
      </Field>
      <Field label="Falloff">
        <Select
          label={`${title} diffuse function`}
          value={String(control.diffuseFunction)}
          options={DIFFUSE_FUNCTION_OPTIONS}
          onChange={(value) => patch({ diffuseFunction: Number(value) as never }, `${title} falloff changed.`)}
        />
      </Field>
      <Field label="Attenuation">
        <Select
          label={`${title} attenuation function`}
          value={String(control.attenuationFunction)}
          options={ATTENUATION_FUNCTION_OPTIONS}
          onChange={(value) => patch({ attenuationFunction: Number(value) as never }, `${title} attenuation changed.`)}
        />
      </Field>
      <Field label="Lights used" asGroup help="Which of the eight scene lights this half of the channel sees.">
        <span className="materialLightMask">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((bit) => (
            <Toggle
              key={bit}
              variant="checkbox"
              hideLabel
              label={`${title} light ${bit + 1}`}
              checked={(control.litMask & (1 << bit)) !== 0}
              onChange={(checked) => patch({ litMask: toggleLitMaskBit(control.litMask, bit, checked) }, `${title} light ${bit + 1} ${checked ? 'on' : 'off'}.`)}
            />
          ))}
        </span>
      </Field>
    </FieldGroup>
  );
}
