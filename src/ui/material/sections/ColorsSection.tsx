import type { GxMaterialDoc } from '../../../lib/gxMaterial';
import { ColorField, Field, FieldGroup, NumberInput } from '../../components';
import type { MaterialDocChange } from '../MaterialInspector';
import { colorToRgb255, registerToRgb255, rgb255ToColor, rgb255ToRegister, setColorRegister, setKonstColor } from '../materialDoc';

/**
 * The seven colours a TEV shader can start from: the three colour registers C0..C2 (which stages
 * can also write into) and the four konst colours K0..K3 (which they can only read).
 *
 * Editing one is a committed edit, so it goes into the undo stack and is pushed at the viewport
 * straight away — colour is the thing an author tweaks while looking at the course.
 */
export function ColorsSection({ doc, onChange }: { doc: GxMaterialDoc; onChange: MaterialDocChange }) {
  return (
    <>
      <FieldGroup title="Registers">
        {doc.colorRegisters.map((register, index) => (
          <Field
            key={index}
            label={`C${index}`}
            asGroup
            hint="s10"
            help={index === 0 ? 'A stage can write its result into a register instead of passing it on.' : undefined}
          >
            <ColorField
              label={`Colour register C${index}`}
              value={registerToRgb255(register)}
              alpha={Math.max(0, Math.min(255, register.a))}
              onChange={(rgb) => onChange(setColorRegister(doc, index, rgb255ToRegister(rgb, register.a)), { status: `Colour register C${index} changed.` })}
              onChangeAlpha={(alpha) => onChange(setColorRegister(doc, index, { ...register, a: alpha }), { status: `Colour register C${index} changed.` })}
            />
          </Field>
        ))}
      </FieldGroup>

      <FieldGroup title="Constants">
        {doc.konstColors.map((konst, index) => (
          <Field key={index} label={`K${index}`} asGroup>
            <ColorField
              label={`Constant colour K${index}`}
              value={colorToRgb255(konst)}
              alpha={Math.round(konst.a * 255)}
              onChange={(rgb) => onChange(setKonstColor(doc, index, rgb255ToColor(rgb, konst.a)), { status: `Constant colour K${index} changed.` })}
              onChangeAlpha={(alpha) => onChange(setKonstColor(doc, index, { ...konst, a: alpha / 255 }), { status: `Constant colour K${index} changed.` })}
            />
          </Field>
        ))}
      </FieldGroup>

      <FieldGroup title="Swap tables">
        {doc.swapTables.map((table, index) => (
          <Field key={index} label={`Table ${index}`} asGroup hint="R G B A">
            <span className="materialSwapRow">
              {table.map((channel, position) => (
                <NumberInput
                  key={position}
                  label={`Swap table ${index} channel ${position}`}
                  value={channel}
                  min={0}
                  max={3}
                  integer
                  step={1}
                  scrub={false}
                  onChange={(value) => {
                    const swapTables = doc.swapTables.map((entry, i) =>
                      i === index ? (entry.map((current, j) => (j === position ? value : current)) as typeof entry) : entry,
                    ) as GxMaterialDoc['swapTables'];
                    onChange({ ...doc, swapTables }, { status: `Swap table ${index} changed.` });
                  }}
                />
              ))}
            </span>
          </Field>
        ))}
      </FieldGroup>
    </>
  );
}
