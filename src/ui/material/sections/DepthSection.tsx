import type { GxMaterialDoc } from '../../../lib/gxMaterial';
import { Field, FieldGroup, Select, Toggle } from '../../components';
import { COMPARE_OPTIONS } from '../gxOptions';
import type { MaterialDocChange } from '../MaterialInspector';
import { patchDepth } from '../materialDoc';

/** Depth buffer behaviour: whether the material tests, how, whether it writes, and when. */
export function DepthSection({ doc, onChange }: { doc: GxMaterialDoc; onChange: MaterialDocChange }) {
  return (
    <FieldGroup title="Depth buffer">
      <Field label="Depth test">
        <Toggle
          label={doc.depth.test ? 'On' : 'Off'}
          checked={doc.depth.test}
          onChange={(checked) => onChange(patchDepth(doc, { test: checked }), { status: `Depth test ${checked ? 'on' : 'off'}.` })}
        />
      </Field>
      <Field label="Passes when">
        <Select
          label="Depth comparison"
          value={String(doc.depth.func)}
          options={COMPARE_OPTIONS}
          disabled={!doc.depth.test}
          onChange={(value) => onChange(patchDepth(doc, { func: Number(value) as never }), { status: 'Depth comparison changed.' })}
        />
      </Field>
      <Field label="Writes depth" help="Turn this off for translucent surfaces that must not occlude each other.">
        <Toggle
          label={doc.depth.write ? 'On' : 'Off'}
          checked={doc.depth.write}
          onChange={(checked) => onChange(patchDepth(doc, { write: checked }), { status: `Depth write ${checked ? 'on' : 'off'}.` })}
        />
      </Field>
      <Field
        label="Test before texturing"
        help="Faster, but wrong for a material whose alpha test discards pixels."
      >
        <Toggle
          label={doc.depth.compareBeforeTexture ? 'Before' : 'After'}
          checked={doc.depth.compareBeforeTexture}
          onChange={(checked) => onChange(patchDepth(doc, { compareBeforeTexture: checked }), { status: `Depth compared ${checked ? 'before' : 'after'} texturing.` })}
        />
      </Field>
    </FieldGroup>
  );
}
