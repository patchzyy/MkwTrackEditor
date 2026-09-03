import type { GxMaterialDoc } from '../../../lib/gxMaterial';
import { Field, FieldGroup, NumberInput, Select, Toggle } from '../../components';
import { CULL_MODE_OPTIONS, TEX_MATRIX_MODE_OPTIONS } from '../gxOptions';
import type { MaterialDocChange } from '../MaterialInspector';

/**
 * The material's raw fixed-function identity: draw pass, the exact culling choice, the two SCN0
 * indices and the texture-matrix style.
 *
 * The name is edited in the inspector header and the shared-shader note is shown next to it, so
 * neither is repeated here. `Two-sided` in the simple view writes `cullMode` too — this is the
 * four-way choice behind it.
 */
export function MaterialSection({ doc, onChange }: { doc: GxMaterialDoc; onChange: MaterialDocChange }) {
  return (
    <FieldGroup title="Material">
      <Field label="Draw pass" help="Translucent materials are drawn after the opaque ones, back to front.">
        <Toggle
          label={doc.translucent ? 'Translucent' : 'Opaque'}
          checked={doc.translucent}
          onChange={(checked) => onChange({ ...doc, translucent: checked }, { status: `${doc.name} now draws in the ${checked ? 'translucent' : 'opaque'} pass.` })}
        />
      </Field>

      <Field label="Sides drawn" hint="cull">
        <Select
          label="Sides drawn"
          value={String(doc.cullMode)}
          options={CULL_MODE_OPTIONS}
          onChange={(value) => onChange({ ...doc, cullMode: Number(value) as GxMaterialDoc['cullMode'] }, { status: `${doc.name}: culling changed.` })}
        />
      </Field>

      <Field label="Light set" hint="-1 = none" help="Which SCN0 light set lights this material.">
        <NumberInput
          label="Light set"
          value={doc.lightSetIndex}
          min={-1}
          max={127}
          integer
          step={1}
          onChange={(value) => onChange({ ...doc, lightSetIndex: value }, { transient: true })}
          onCommit={(value) => onChange({ ...doc, lightSetIndex: value }, { status: `${doc.name}: light set ${value < 0 ? 'cleared' : value}.` })}
        />
      </Field>

      <Field label="Fog" hint="-1 = none" help="Which SCN0 fog entry applies. -1 leaves the material unfogged.">
        <NumberInput
          label="Fog index"
          value={doc.fogIndex}
          min={-1}
          max={127}
          integer
          step={1}
          onChange={(value) => onChange({ ...doc, fogIndex: value }, { transient: true })}
          onCommit={(value) => onChange({ ...doc, fogIndex: value }, { status: `${doc.name}: fog ${value < 0 ? 'off' : `entry ${value}`}.` })}
        />
      </Field>

      <Field label="Matrix style" help="How the layer SRT values are combined. Nintendo's exporter writes Maya.">
        <Select
          label="Texture matrix style"
          value={doc.texMatrixMode}
          options={TEX_MATRIX_MODE_OPTIONS}
          onChange={(value) => onChange({ ...doc, texMatrixMode: value as GxMaterialDoc['texMatrixMode'] }, { status: `${doc.name}: matrix style ${value}.` })}
        />
      </Field>

    </FieldGroup>
  );
}
