import type { GxMaterialDoc, GxMaterialSummary } from '../../../lib/gxMaterial';
import { Field, FieldGroup, Toggle } from '../../components';
import { AdvancedBlock } from '../AdvancedBlock';
import type { MaterialDocChange } from '../MaterialInspector';
import { isTwoSided, setTwoSided } from '../materialSimple';
import { MaterialSection } from './MaterialSection';

/**
 * The one thing about a surface that is not about its textures, its transparency or its light:
 * whether the back of a triangle is drawn.
 *
 * Everything else the MDL0 stores about the material as a whole — the draw pass, the exact
 * culling choice, the SCN0 light set and fog indices, the texture-matrix style — is bookkeeping
 * an author sets once, so it is in the disclosure.
 */
export function SurfaceSection({
  doc,
  summary,
  onChange,
}: {
  doc: GxMaterialDoc;
  summary: GxMaterialSummary | null;
  onChange: MaterialDocChange;
}) {
  const twoSided = isTwoSided(doc);
  return (
    <>
      <FieldGroup>
        <Field
          label="Two-sided"
          help={twoSided
            ? 'Both faces of every triangle are drawn. Costs twice the fill rate, and needed for flat things like banners and leaves.'
            : 'Only the front of each triangle is drawn, so the inside of a closed shape is invisible.'}
        >
          <Toggle
            label={twoSided ? 'Both sides' : 'Front only'}
            checked={twoSided}
            onChange={(checked) => onChange(setTwoSided(doc, checked), { status: `${doc.name} draws ${checked ? 'both sides' : 'front faces only'}.` })}
          />
        </Field>
      </FieldGroup>

      {summary && summary.sharedShaderWith.length > 0 && (
        <p className="detailsNote" title={`Shared with ${summary.sharedShaderWith.join(', ')}. Editing the graph gives this material its own copy so the others are left alone.`}>
          Shader shared with {summary.sharedShaderWith.length} other material{summary.sharedShaderWith.length === 1 ? '' : 's'}
        </p>
      )}

      <AdvancedBlock
        storageKey="material"
        hint="Draw pass, the exact culling choice, light set, fog and the matrix style"
      >
        <MaterialSection doc={doc} onChange={onChange} />
      </AdvancedBlock>
    </>
  );
}
