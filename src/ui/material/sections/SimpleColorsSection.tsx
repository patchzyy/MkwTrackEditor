import type { GxMaterialDoc } from '../../../lib/gxMaterial';
import { ColorField, EmptyState, Field, FieldGroup } from '../../components';
import { AdvancedBlock } from '../AdvancedBlock';
import { konstColorName, colorRegisterName } from '../gxOptions';
import { colorToRgb255, registerToRgb255, rgb255ToColor, rgb255ToRegister, setColorRegister, setKonstColor } from '../materialDoc';
import type { MaterialDocChange } from '../MaterialInspector';
import { describeStages, usedColorRegisters, usedKonstColors } from '../materialSimple';
import { ColorsSection } from './ColorsSection';

/**
 * The colours this material's shader actually reads, and nothing else.
 *
 * A GX material always stores seven colours — four constants and three registers — but a typical
 * course material samples one or none of them, and showing seven swatches where six do nothing is
 * exactly the noise this view exists to remove. `usedKonstColors` looks for stages with a `KONST`
 * input rather than for the konst *selection*, which every stage names whether it reads it or
 * not; `usedColorRegisters` only counts a register read before anything writes to it, because a
 * register a stage overwrites on its way past is scratch space and its start colour is dead.
 *
 * All seven, plus the swap tables, are in the disclosure.
 */
export function SimpleColorsSection({ doc, onChange }: { doc: GxMaterialDoc; onChange: MaterialDocChange }) {
  const konst = usedKonstColors(doc.tevStages);
  const registers = usedColorRegisters(doc.tevStages);

  return (
    <>
      {konst.length === 0 && registers.length === 0 ? (
        <EmptyState
          size="sm"
          title="No colours in the shader"
          description="This material's stages take everything from its textures and its lighting, so none of the stored colours change what is drawn."
        />
      ) : (
        <FieldGroup>
          {konst.map(({ slot, stages }) => {
            const value = doc.konstColors[slot];
            return (
              <Field key={`k${slot}`} label={konstColorName(slot)} asGroup help={`Read by ${describeStages(stages)}.`}>
                <ColorField
                  label={konstColorName(slot)}
                  value={colorToRgb255(value)}
                  alpha={Math.round(value.a * 255)}
                  onChange={(rgb) => onChange(setKonstColor(doc, slot, rgb255ToColor(rgb, value.a)), { status: `${konstColorName(slot)} changed.` })}
                  onChangeAlpha={(alpha) => onChange(setKonstColor(doc, slot, { ...value, a: alpha / 255 }), { status: `${konstColorName(slot)} changed.` })}
                />
              </Field>
            );
          })}

          {registers.map(({ slot, stages }) => {
            const value = doc.colorRegisters[slot];
            return (
              <Field
                key={`c${slot}`}
                label={colorRegisterName(slot)}
                asGroup
                help={`${describeStages(stages).replace(/^s/, 'S')} reads it before anything writes to it.`}
              >
                <ColorField
                  label={colorRegisterName(slot)}
                  value={registerToRgb255(value)}
                  alpha={Math.max(0, Math.min(255, value.a))}
                  onChange={(rgb) => onChange(setColorRegister(doc, slot, rgb255ToRegister(rgb, value.a)), { status: `${colorRegisterName(slot)} changed.` })}
                  onChangeAlpha={(alpha) => onChange(setColorRegister(doc, slot, { ...value, a: alpha }), { status: `${colorRegisterName(slot)} changed.` })}
                />
              </Field>
            );
          })}
        </FieldGroup>
      )}

      <AdvancedBlock
        storageKey="colours"
        title="All colours"
        hint="Every constant and register, including the ones nothing reads, and the swap tables"
      >
        <ColorsSection doc={doc} onChange={onChange} />
      </AdvancedBlock>
    </>
  );
}
