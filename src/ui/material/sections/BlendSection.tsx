import type { GxMaterialDoc } from '../../../lib/gxMaterial';
import { Field, FieldGroup, NumberInput, Select, Toggle } from '../../components';
import { ALPHA_OP_OPTIONS, BLEND_FACTOR_OPTIONS, BLEND_MODE_OPTIONS, COMPARE_OPTIONS, LOGIC_OP_OPTIONS } from '../gxOptions';
import type { MaterialDocChange } from '../MaterialInspector';
import { patchAlphaTest, patchBlend } from '../materialDoc';

/** How the material's result is combined with what is already on screen, and the alpha test. */
export function BlendSection({ doc, onChange }: { doc: GxMaterialDoc; onChange: MaterialDocChange }) {
  const blending = doc.blend.mode === 1;
  const logic = doc.blend.mode === 2;

  return (
    <>
      <FieldGroup title="Blending">
        <Field label="Mode">
          <Select
            label="Blend mode"
            value={String(doc.blend.mode)}
            options={BLEND_MODE_OPTIONS}
            onChange={(value) => onChange(patchBlend(doc, { mode: Number(value) as never }), { status: 'Blend mode changed.' })}
          />
        </Field>
        <Field label="Source factor" help={blending ? undefined : 'Only used when the mode is Blend.'}>
          <Select
            label="Blend source factor"
            value={String(doc.blend.srcFactor)}
            options={BLEND_FACTOR_OPTIONS}
            disabled={!blending}
            onChange={(value) => onChange(patchBlend(doc, { srcFactor: Number(value) as never }), { status: 'Blend factors changed.' })}
          />
        </Field>
        <Field label="Destination factor">
          <Select
            label="Blend destination factor"
            value={String(doc.blend.dstFactor)}
            options={BLEND_FACTOR_OPTIONS}
            disabled={!blending}
            onChange={(value) => onChange(patchBlend(doc, { dstFactor: Number(value) as never }), { status: 'Blend factors changed.' })}
          />
        </Field>
        <Field label="Logic operation" help={logic ? undefined : 'Only used when the mode is Logic operation.'}>
          <Select
            label="Blend logic operation"
            value={String(doc.blend.logicOp)}
            options={LOGIC_OP_OPTIONS}
            disabled={!logic}
            onChange={(value) => onChange(patchBlend(doc, { logicOp: Number(value) as never }), { status: 'Logic operation changed.' })}
          />
        </Field>
        <Field label="Force alpha out">
          <Toggle
            label={doc.blend.constantAlphaEnabled ? 'On' : 'Off'}
            checked={doc.blend.constantAlphaEnabled}
            onChange={(checked) => onChange(patchBlend(doc, { constantAlphaEnabled: checked }), { status: `Constant alpha ${checked ? 'on' : 'off'}.` })}
          />
        </Field>
        <Field label="Alpha written" hint="0..1">
          <NumberInput
            label="Constant alpha"
            value={doc.blend.constantAlpha}
            min={0}
            max={1}
            step={0.01}
            precision={3}
            disabled={!doc.blend.constantAlphaEnabled}
            onChange={(value) => onChange(patchBlend(doc, { constantAlpha: value }), { transient: true })}
            onCommit={(value) => onChange(patchBlend(doc, { constantAlpha: value }), { status: `Constant alpha ${value.toFixed(2)}.` })}
          />
        </Field>
      </FieldGroup>

      <FieldGroup title="Alpha test">
        <Field label="First test">
          <Select
            label="Alpha test A comparison"
            value={String(doc.alphaTest.compareA)}
            options={COMPARE_OPTIONS}
            onChange={(value) => onChange(patchAlphaTest(doc, { compareA: Number(value) as never }), { status: 'Alpha test changed.' })}
          />
        </Field>
        <Field label="First value" hint="0..1">
          <NumberInput
            label="Alpha test A reference"
            value={doc.alphaTest.referenceA}
            min={0}
            max={1}
            step={0.01}
            precision={3}
            onChange={(value) => onChange(patchAlphaTest(doc, { referenceA: value }), { transient: true })}
            onCommit={(value) => onChange(patchAlphaTest(doc, { referenceA: value }), { status: `Alpha test cut-off ${value.toFixed(2)}.` })}
          />
        </Field>
        <Field label="Combined with">
          <Select
            label="Alpha test operation"
            value={String(doc.alphaTest.op)}
            options={ALPHA_OP_OPTIONS}
            onChange={(value) => onChange(patchAlphaTest(doc, { op: Number(value) as never }), { status: 'Alpha test changed.' })}
          />
        </Field>
        <Field label="Second test">
          <Select
            label="Alpha test B comparison"
            value={String(doc.alphaTest.compareB)}
            options={COMPARE_OPTIONS}
            onChange={(value) => onChange(patchAlphaTest(doc, { compareB: Number(value) as never }), { status: 'Alpha test changed.' })}
          />
        </Field>
        <Field label="Second value" hint="0..1">
          <NumberInput
            label="Alpha test B reference"
            value={doc.alphaTest.referenceB}
            min={0}
            max={1}
            step={0.01}
            precision={3}
            onChange={(value) => onChange(patchAlphaTest(doc, { referenceB: value }), { transient: true })}
            onCommit={(value) => onChange(patchAlphaTest(doc, { referenceB: value }), { status: `Alpha test cut-off ${value.toFixed(2)}.` })}
          />
        </Field>
      </FieldGroup>
    </>
  );
}
