import type { GxMaterialDoc } from '../../../lib/gxMaterial';
import { Field, FieldGroup, NumberInput, SegmentedControl, Toggle } from '../../components';
import { AdvancedBlock } from '../AdvancedBlock';
import type { MaterialDocChange } from '../MaterialInspector';
import {
  getCutoutThreshold,
  getTransparencyMode,
  getWritesDepth,
  setCutoutThreshold,
  setTransparencyMode,
  setWritesDepth,
  type TransparencyMode,
} from '../materialSimple';
import { BlendSection } from './BlendSection';
import { DepthSection } from './DepthSection';

const MODES: Array<{ value: TransparencyMode; label: string; tooltip: string }> = [
  { value: 'opaque', label: 'Opaque', tooltip: 'Solid. Nothing shows through.' },
  { value: 'cutout', label: 'Cutout', tooltip: 'Hard-edged holes where the texture is see-through: leaves, fences, grates.' },
  { value: 'transparent', label: 'Transparent', tooltip: 'Blended against what is behind it, and drawn after the solid parts of the course.' },
];

const MODE_HELP: Record<TransparencyMode, string> = {
  opaque: 'The surface is solid: no blending, and every texel is drawn.',
  cutout: 'Texels below the cut-off are thrown away and the rest are solid. Cheap, sorts correctly, and the right choice for foliage.',
  transparent: 'The surface is blended over whatever is behind it and drawn in the see-through pass, back to front.',
};

/**
 * One control for the three things that have to agree — the blend mode, the alpha test and the
 * draw pass — plus the cut-off when the material is cutting holes.
 *
 * Getting these out of step is the classic way a custom track ends up with black boxes round its
 * trees, so the simple view refuses to let them disagree. The raw blend factors, the logic
 * operation and the two-part alpha test are all still here, one disclosure away.
 */
export function TransparencySection({ doc, onChange }: { doc: GxMaterialDoc; onChange: MaterialDocChange }) {
  const mode = getTransparencyMode(doc);
  const threshold = getCutoutThreshold(doc);

  return (
    <>
      <FieldGroup>
        <Field label="Mode" asGroup help={MODE_HELP[mode]}>
          <SegmentedControl
            label="Transparency"
            size="sm"
            value={mode}
            options={MODES}
            onChange={(next) =>
              onChange(setTransparencyMode(doc, next), {
                status: `${doc.name} is now ${next === 'opaque' ? 'opaque' : next === 'cutout' ? 'cut out' : 'transparent'}.`,
              })
            }
          />
        </Field>

        {mode === 'cutout' && (
          <Field label="Cut-off" hint="0..1" help="Texels whose alpha is below this vanish. Raise it to eat away soft edges.">
            <NumberInput
              label="Cutout threshold"
              value={threshold}
              min={0}
              max={1}
              step={0.01}
              precision={3}
              onChange={(value) => onChange(setCutoutThreshold(doc, value), { transient: true })}
              onCommit={(value) => onChange(setCutoutThreshold(doc, value), { status: `Cut-off ${value.toFixed(2)}.` })}
            />
          </Field>
        )}

        <Field
          label="Hides what is behind"
          help="Turn this off for glass, decals and effects that must not hide each other."
        >
          <Toggle
            label={getWritesDepth(doc) ? 'Yes' : 'No'}
            checked={getWritesDepth(doc)}
            onChange={(checked) => onChange(setWritesDepth(doc, checked), { status: `${doc.name} ${checked ? 'hides' : 'no longer hides'} what is behind it.` })}
          />
        </Field>
      </FieldGroup>

      <AdvancedBlock
        storageKey="transparency"
        hint="Blend factors, the logic operation, the two-part alpha test and the depth comparison"
      >
        <BlendSection doc={doc} onChange={onChange} />
        <DepthSection doc={doc} onChange={onChange} />
      </AdvancedBlock>
    </>
  );
}
