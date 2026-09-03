import type { GxMaterialDoc, GxMaterialSummary } from '../../../lib/gxMaterial';
import { Field, FieldGroup, NumberInput, Select, Toggle } from '../../components';
import { CULL_MODE_OPTIONS, TEX_MATRIX_MODE_OPTIONS } from '../gxOptions';
import type { MaterialDocChange } from '../MaterialInspector';

/** Name, draw pass, culling and the two SCN0 indices — what the material *is*. */
export function MaterialSection({
  doc,
  summary,
  onChange,
}: {
  doc: GxMaterialDoc;
  summary: GxMaterialSummary | null;
  onChange: MaterialDocChange;
}) {
  return (
    <FieldGroup>
      <Field label="Name" help="Renaming rewrites every reference to this material in the model.">
        <input
          className="materialTextInput"
          type="text"
          value={doc.name}
          aria-label="Material name"
          onChange={(event) => onChange({ ...doc, name: event.currentTarget.value }, { transient: true })}
          onBlur={(event) => onChange({ ...doc, name: event.currentTarget.value }, { status: `Renamed the material to ${event.currentTarget.value}.` })}
        />
      </Field>

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

      {summary && summary.sharedShaderWith.length > 0 && (
        <p className="materialNote">
          This material's shader is shared with {summary.sharedShaderWith.join(', ')}. Editing the graph gives this
          material its own copy so the others are left alone.
        </p>
      )}
    </FieldGroup>
  );
}
