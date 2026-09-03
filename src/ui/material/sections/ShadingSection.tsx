import type { GxMaterialDoc } from '../../../lib/gxMaterial';
import { ColorField, EmptyState, Field, FieldGroup, SegmentedControl } from '../../components';
import { AdvancedBlock } from '../AdvancedBlock';
import { colorToRgb255, patchChannel, rgb255ToColor } from '../materialDoc';
import type { MaterialDocChange } from '../MaterialInspector';
import { countLitLights, getShadingMode, setShadingMode, usesMaterialColor, type ShadingMode } from '../materialSimple';
import { LightingSection } from './LightingSection';

const MODES: Array<{ value: ShadingMode; label: string; tooltip: string }> = [
  { value: 'lit', label: 'Lit', tooltip: 'The course lights shade this material.' },
  { value: 'vertex', label: 'Vertex colours', tooltip: "The mesh's own painted colours, which is where a Mario Kart Wii track keeps its baked lighting." },
  { value: 'unlit', label: 'Unlit', tooltip: 'A flat colour from the material itself. Signs, skyboxes, anything that glows.' },
];

const MODE_HELP: Record<ShadingMode, string> = {
  lit: 'The scene lights shade this material as the kart drives past.',
  vertex: "The mesh's baked vertex colours light it. This is what almost every course surface does.",
  unlit: 'Flat and self-lit: the scene lights are ignored entirely.',
};

/**
 * Lighting as the three looks an author picks between, plus the two colours that mean something
 * once one is picked. The eight per-light mask bits, the falloff and attenuation functions and
 * the alpha half of each channel are hardware detail and live in the disclosure.
 */
export function ShadingSection({ doc, onChange }: { doc: GxMaterialDoc; onChange: MaterialDocChange }) {
  const channel = doc.channels[0];

  if (!channel) {
    return (
      <EmptyState
        size="sm"
        title="No lighting channels"
        description="This material takes its colour entirely from its textures and colours."
      />
    );
  }

  const mode = getShadingMode(doc);
  const litLights = countLitLights(doc);

  return (
    <>
      <FieldGroup>
        <Field label="Shading" asGroup help={MODE_HELP[mode]}>
          <SegmentedControl
            label="Shading"
            size="sm"
            value={mode}
            options={MODES}
            onChange={(next) => onChange(setShadingMode(doc, next), { status: `${doc.name}: ${next === 'lit' ? 'lit by the scene' : next === 'vertex' ? 'using vertex colours' : 'unlit'}.` })}
          />
        </Field>

        {usesMaterialColor(doc) && (
          <Field label="Base colour" asGroup help="The material's own colour. Multiply it into the texture to tint the surface.">
            <ColorField
              label="Base colour"
              value={colorToRgb255(channel.materialColor)}
              alpha={Math.round(channel.materialColor.a * 255)}
              onChange={(rgb) => onChange(patchChannel(doc, 0, { materialColor: rgb255ToColor(rgb, channel.materialColor.a) }), { status: 'Base colour changed.' })}
              onChangeAlpha={(alpha) => onChange(patchChannel(doc, 0, { materialColor: { ...channel.materialColor, a: alpha / 255 } }), { status: 'Base colour changed.' })}
            />
          </Field>
        )}

        {mode === 'lit' && (
          <Field label="Ambient colour" asGroup help={`Shows in shadow, where no light reaches. ${litLights === 0 ? 'No scene lights are switched on for this material, so this is all it gets.' : `${litLights} of the eight scene lights reach it.`}`}>
            <ColorField
              label="Ambient colour"
              value={colorToRgb255(channel.ambientColor)}
              alpha={Math.round(channel.ambientColor.a * 255)}
              onChange={(rgb) => onChange(patchChannel(doc, 0, { ambientColor: rgb255ToColor(rgb, channel.ambientColor.a) }), { status: 'Ambient colour changed.' })}
              onChangeAlpha={(alpha) => onChange(patchChannel(doc, 0, { ambientColor: { ...channel.ambientColor, a: alpha / 255 } }), { status: 'Ambient colour changed.' })}
            />
          </Field>
        )}
      </FieldGroup>

      <AdvancedBlock
        storageKey="lighting"
        title="Lighting channels"
        hint="Both channels, their alpha halves, falloff, attenuation and the eight light switches"
      >
        <LightingSection doc={doc} onChange={onChange} />
      </AdvancedBlock>
    </>
  );
}
